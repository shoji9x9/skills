// 追記専用（非破壊追記）の成果物が縮んでいないことを git の履歴と突き合わせて確かめる（正本）。
//
// スキル群は決定を積み上げる成果物を持ち、そこへの書き込みを「非破壊追記」と定めているが、
// 追記であることを確かめる道具が無いと、積み上げた文書を丸ごと書き直しても何も落ちない。
// 失われるのは過去の決定（なぜ許容したのか・いつ誰が承認したのか）で、現在の状態しか見ない
// 収束判定は通ってしまう。
//
// 何をするか:
//   1. 追記専用の成果物を機械可読な一覧（assets/append-only-manifest.json）から読む
//   2. 一覧のパターンに一致する追跡ファイルを列挙し、比較元の版（既定 HEAD）の内容を git から取る
//   3. 比較元に在った「単位」が現在も全部残っているかを数える（多重度まで見る）
//   4. 比較元に在ったファイルが消えていれば落とす
//
// 突き合わせの単位は一覧の unit で決める。全部を行として比べると、正本が明示的に求めている
// その場の更新（版の +1・状態列の 未→済・Issue 列の 未起票→番号・最終更新の日時）が
// 「失われた行」に化け、決定を 1 つも捨てていない成果物で収束が止まる:
//   - lines（既定）: 空白を畳んだ行の多重集合。書き換えず積み上げるだけの台帳に使う
//   - markdown-structure: 見出し・表の列名・表の行（先頭セルを鍵にする）・定義箇条書きの鍵・
//     それ以外の散文行。セルの値と箇条書きの値はその場で更新してよいが、行・列・節は消せない
//   - json-arrays: arrays に挙げた配列の要素（深い等価）。version のようなスカラは更新してよいが、
//     積み上げた要素（changes[] / component_diff_exceptions[]）は消せない。
//     要素の同一性を深い等価で取るので、2 つの要素の間でフィールドを入れ替える書き換え
//     （どの例外を誰がいつ承認したかの付け替え）も縮小として落ちる。
//     key を指定した配列は鍵で要素を対応づけ、フィールドごとに突き合わせる。既定は「鍵以外は不変」で、
//     正本が更新を認めている項目だけを fill_only（空 → 非空だけ。既に入っている値の差し替えは落とす）と
//     transitions（明示した <変更前>-><変更後> だけ。unmeasured.entries の blocking->accepted）で開ける。
//     markdown-structure の表の行も同様に、鍵（先頭セル）だけでなく行 × 列のセルを単位にし、
//     正本がその場の更新を定めている列だけ mutable_columns で外す（鍵だけだと残りのセルが自由に書き換わる）。
//     同じ鍵の行は出現順で区別する（区別しないと、同じ鍵の 2 行の間でセルを入れ替えても単位が変わらない）
//
// 行の突き合わせは空白を畳んで（連続する空白を 1 つに、前後を除去して）から行う——
// Markdown の表はフォーマッタが桁を詰め直すため、素の文字列比較では整形だけで落ちる。
// 空行は比較しない（節の間隔は決定ではない）。
//
// 何をしないか: 追記の中身の妥当性は見ない。消えていないことだけを数える。
//
// fail-closed: git が使えない・比較元の版を読めない・対象 0 件・一覧の unit が語彙外・
//              比較元の木に在るのに内容を取り出せないファイルは合格に倒さない（exit 2）。
//
// 決定論的: 乱数・現在時刻に依存しない。TypeScript 構文は使わない（型は JSDoc）。

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * ツールのバージョン（正本）。判定ロジック・出力形状を変えたら上げる。
 * @type {string}
 */
export const VERSION = "4";

/** 走査で辿らないディレクトリ名。 */
const SKIP_DIRS = new Set([".git", "node_modules"]);

/** 突き合わせの単位（一覧の unit）。 */
export const UNITS = ["lines", "markdown-structure", "json-arrays"];

/** 使い方の誤り・型崩れ・判定不能（exit 2）。 */
export class UsageError extends Error {}

/**
 * @param {unknown} v
 * @returns {boolean}
 */
function nonEmptyString(v) {
  return typeof v === "string" && v.trim() !== "";
}

/**
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * 実パスに解決する（解決できなければ渡された値のまま返す）。
 * git が返すトップレベルはシンボリックリンクを解決した形なので、片側だけ未解決だと prefix が取れない。
 * @param {string} p
 * @returns {string}
 */
function realpathOrSelf(p) {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * glob を正規表現へ変換する（`**` は複数階層、`*` は 1 階層に一致）。
 * @param {string} pattern
 * @returns {RegExp}
 */
export function globToRegExp(pattern) {
  let out = "^";
  for (let i = 0; i < pattern.length; i += 1) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        out += ".*";
        i += 1;
      } else {
        out += "[^/]*";
      }
      continue;
    }
    out += c.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`${out}$`);
}

/**
 * パターンのうち先頭の固定部分（最初のワイルドカードより前のディレクトリ）を返す。
 * 走査の起点を絞るために使う（リポジトリ全体を歩かない）。
 * @param {string} pattern
 * @returns {string}
 */
export function literalPrefix(pattern) {
  const star = pattern.indexOf("*");
  const head = star === -1 ? pattern : pattern.slice(0, star);
  const slash = head.lastIndexOf("/");
  return slash === -1 ? "" : head.slice(0, slash);
}

/**
 * 起点の直下を再帰的に列挙し、ルートからの相対パス（POSIX 区切り）を返す。
 * @param {string} root
 * @param {string} startRel
 * @returns {string[]}
 */
function listFiles(root, startRel) {
  const start = startRel === "" ? root : join(root, startRel);
  if (!existsSync(start) || !statSync(start).isDirectory()) return [];
  /** @type {string[]} */
  const out = [];
  /** @param {string} current */
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(join(current, entry.name));
        continue;
      }
      if (entry.isFile()) out.push(relative(root, join(current, entry.name)).split(sep).join("/"));
    }
  };
  walk(start);
  return out;
}

/**
 * 行を突き合わせ用に正規化する（空白を畳む。空行は落とす）。
 * @param {string} text
 * @returns {Map<string, number>} 正規化した行 → 出現回数
 */
export function normalizeLines(text) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (line === "") continue;
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  return counts;
}

/**
 * 正規化した 1 行（空白を畳む）。
 * @param {string} raw
 * @returns {string}
 */
function normalizeLine(raw) {
  return raw.replace(/\s+/g, " ").trim();
}

/**
 * 表の行をセルへ割る（先頭と末尾の空セルを落とす）。
 * @param {string} line
 * @returns {string[]}
 */
function tableCells(line) {
  const cells = line.split("|").map((c) => c.trim());
  if (cells.length > 0 && cells[0] === "") cells.shift();
  if (cells.length > 0 && cells[cells.length - 1] === "") cells.pop();
  return cells;
}

/**
 * Markdown の構造単位を数える。
 *
 * 落とさせない相手は「節・列・行・行の決定内容・箇条書きの鍵・散文」。
 * 行の同一性は先頭セル（slug・種類・箇所などの鍵）で見るが、**鍵だけを残すと残りのセルが
 * 自由に書き換えられる**（決定の出どころ・方針・理由を丸ごと差し替えても行は在る）。
 * そこで行 × 列のセルも単位にし、正本がその場の更新を定めている列だけ mutableColumns で外す。
 * 列を足す非破壊更新は新しい単位が増えるだけなので落ちない。
 * 箇条書きの値と散文は従来どおり——箇条書きは鍵、散文は行そのもの。
 * @param {string} text
 * @param {string[]} [mutableColumns] 値の更新を正本が認めている列名
 * @returns {Map<string, number>} 単位 → 出現回数
 */
export function markdownUnits(text, mutableColumns = []) {
  const mutable = new Set(mutableColumns.map((c) => c.trim()));
  // "*" は「セルの中身は契約の対象外」（一覧の requirement が節・列・行だけを守ると定めている成果物）。
  const allCellsMutable = mutable.has("*");
  /** @type {Map<string, number>} */
  const counts = new Map();
  /** @param {string} key */
  const add = (key) => counts.set(key, (counts.get(key) ?? 0) + 1);

  /** @type {string[]} */
  const headings = [];
  /** @type {string[]} */
  let columns = [];
  /** @type {Map<string, number>} 同じ鍵の行が何度目か */
  const rowOccurrences = new Map();
  let tableIndex = -1;
  let inTable = false;
  for (const raw of text.split("\n")) {
    const line = normalizeLine(raw);
    if (line === "") {
      inTable = false;
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading !== null) {
      const level = heading[1].length;
      headings.length = Math.min(headings.length, level - 1);
      while (headings.length < level - 1) headings.push("");
      headings.push(heading[2].trim());
      tableIndex = -1;
      inTable = false;
      add(`H:${headings.join(" > ")}`);
      continue;
    }
    const path = headings.join(" > ");
    if (line.startsWith("|") && line.endsWith("|")) {
      if (/^\|[\s:|-]+\|$/.test(line)) continue; // 区切り行は列を足すと変わる
      const cells = tableCells(line);
      if (!inTable) {
        inTable = true;
        tableIndex += 1;
        columns = cells;
        for (const cell of cells) add(`C:${path}#${tableIndex}|${cell}`);
        continue;
      }
      const rowKey = cells[0] ?? "";
      add(`R:${path}#${tableIndex}|${rowKey}`);
      // 同じ鍵の行は出現順で区別する。区別しないと列ごとの多重集合になり、
      // 同じ鍵を持つ 2 行の間でセルを入れ替えても単位が変わらない
      // （assets.md は方針を覆した行と現在の行が同じ「種類」で 2 行並ぶ——正本が想定する形）。
      // 追記専用の台帳なので既存行の並びは変わらず、出現順は安定した識別子になる。
      const seenKey = `${path}#${tableIndex}|${rowKey}`;
      const occurrence = rowOccurrences.get(seenKey) ?? 0;
      rowOccurrences.set(seenKey, occurrence + 1);
      if (!allCellsMutable) {
        for (const [i, cell] of cells.entries()) {
          if (i === 0) continue; // 先頭セルは鍵そのもの
          const column = columns[i] ?? `#${i}`;
          if (mutable.has(column)) continue; // 正本がその場の更新を定めている列
          add(`R:${seenKey}@${occurrence}|${column}=${cell}`);
        }
      }
      continue;
    }
    inTable = false;
    const bullet = /^[-*+]\s+([^:：]{1,80})[:：]/.exec(line);
    if (bullet !== null) {
      add(`B:${path}|${bullet[1].trim()}`);
      continue;
    }
    add(`L:${line}`);
  }
  return counts;
}

/**
 * ドット区切りのパスで JSON の値を辿る。
 * @param {unknown} value
 * @param {string} path
 * @returns {unknown}
 */
function atPath(value, path) {
  let current = value;
  for (const key of path.split(".")) {
    if (!isPlainObject(current)) return undefined;
    current = current[key];
  }
  return current;
}

/**
 * 鍵の順序に依らない JSON 文字列（要素の同一性に使う）。
 * @param {unknown} value
 * @returns {string}
 */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * JSON の指定した配列の要素を数える。
 * @param {string} text
 * @param {string[]} paths
 * @param {string} label 失敗メッセージ用（ファイル名＋版）
 * @param {string | null} [key] 指定すると要素そのものではなくこの項目の値を同一性にする
 * @returns {Map<string, number>} 単位 → 出現回数
 */
export function jsonArrayUnits(text, paths, label, key = null) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new UsageError(
      `JSON として読めないため追記であることを確かめられない: ${label}（${e instanceof Error ? e.message : String(e)}）`,
    );
  }
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const path of paths) {
    const value = atPath(parsed, path);
    if (value === undefined || value === null) continue; // まだ無い＝積み上げた要素も無い
    if (!Array.isArray(value)) {
      throw new UsageError(`一覧が配列と宣言した ${path} が配列でない: ${label}`);
    }
    for (const element of value) {
      let unit;
      if (key === null) {
        unit = `${path}|${canonicalJson(element)}`;
      } else {
        // 鍵が引けない要素を素通りさせない（全要素が同じ鍵へ潰れて 1 件が全件を満たす形を作らない）。
        if (!isPlainObject(element) || !nonEmptyString(element[key])) {
          throw new UsageError(
            `一覧が key: ${key} と宣言した ${path} の要素に、空でない文字列の ${key} が無い: ${label}`,
          );
        }
        unit = `${path}|${key}=${String(element[key]).trim()}`;
      }
      counts.set(unit, (counts.get(unit) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * JSON の指定した配列を鍵で対応づけ、フィールド単位で突き合わせる。
 *
 * 鍵だけを同一性にすると、鍵以外のフィールドが自由に書き換えられる（承認済みの項目の
 * 理由・承認者・承認日時を差し替えても鍵は残る）。そこで既定は「鍵以外は不変」にし、
 * 正本が更新を定めている項目だけを fill_only（空 → 非空だけ）と transitions（明示した値の遷移だけ）で開ける。
 * @param {string} beforeText
 * @param {string} afterText
 * @param {{ arrays: string[], key: string, fillOnly: string[], transitions: Record<string, string[]> }} artifact
 * @param {{ before: string, after: string }} labels
 * @returns {string[]} findings
 */
export function compareKeyedArrays(beforeText, afterText, artifact, labels) {
  /** @type {string[]} */
  const findings = [];
  const fillOnly = new Set(artifact.fillOnly);
  for (const path of artifact.arrays) {
    const before = keyedElements(beforeText, path, artifact.key, labels.before);
    const after = keyedElements(afterText, path, artifact.key, labels.after);
    for (const [key, baseList] of before) {
      const nowList = after.get(key) ?? [];
      if (nowList.length < baseList.length) {
        findings.push(
          `${path} の要素が失われている（${artifact.key}=${key}: 比較元 ${baseList.length} 件 → 現在 ${nowList.length} 件）`,
        );
      }
      // 同じ鍵が複数ある場合は並び順で対応づける（追記専用なので既存の並びは変わらない）。
      for (const [i, baseElement] of baseList.entries()) {
        const nowElement = nowList[i];
        if (nowElement === undefined) continue; // 件数の減少は上で数えた
        for (const field of Object.keys(baseElement)) {
          const from = baseElement[field];
          const to = nowElement[field];
          if (canonicalJson(from) === canonicalJson(to)) continue;
          const allowed = artifact.transitions[field];
          if (allowed !== undefined) {
            if (allowed.includes(`${stringify(from)}->${stringify(to)}`)) continue;
            findings.push(
              `${path} の ${field} が宣言に無い遷移で書き換えられている（${artifact.key}=${key}: ${stringify(from)} → ${stringify(to)}）`,
            );
            continue;
          }
          if (fillOnly.has(field)) {
            // 空 → 非空（記録の充填）だけ許す。既に入っている値の差し替えは決定の書き換え。
            if (!nonEmptyValue(from)) continue;
            findings.push(
              `${path} の ${field} が空でない値から書き換えられている（${artifact.key}=${key}: ${stringify(from)} → ${stringify(to)}）`,
            );
            continue;
          }
          findings.push(
            `${path} の ${field} が書き換えられている（${artifact.key}=${key}: ${stringify(from)} → ${stringify(to)}）`,
          );
        }
      }
    }
  }
  return findings;
}

/**
 * 表示用に値を短く文字列化する。
 * @param {unknown} v
 * @returns {string}
 */
function stringify(v) {
  const s = typeof v === "string" ? v : canonicalJson(v);
  return s.length > 60 ? `${s.slice(0, 57)}...` : s;
}

/**
 * @param {unknown} v
 * @returns {boolean}
 */
function nonEmptyValue(v) {
  if (v === undefined || v === null) return false;
  if (typeof v === "string") return v.trim() !== "";
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

/**
 * 配列を鍵ごとの要素リストにする。
 * @param {string} text
 * @param {string} path
 * @param {string} key
 * @param {string} label
 * @returns {Map<string, Record<string, unknown>[]>}
 */
function keyedElements(text, path, key, label) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new UsageError(
      `JSON として読めないため追記であることを確かめられない: ${label}（${e instanceof Error ? e.message : String(e)}）`,
    );
  }
  /** @type {Map<string, Record<string, unknown>[]>} */
  const out = new Map();
  const value = atPath(parsed, path);
  if (value === undefined || value === null) return out;
  if (!Array.isArray(value))
    throw new UsageError(`一覧が配列と宣言した ${path} が配列でない: ${label}`);
  for (const element of value) {
    if (!isPlainObject(element) || !nonEmptyString(element[key])) {
      throw new UsageError(
        `一覧が key: ${key} と宣言した ${path} の要素に、空でない文字列の ${key} が無い: ${label}`,
      );
    }
    const k = String(element[key]).trim();
    const list = out.get(k);
    if (list === undefined) out.set(k, [element]);
    else list.push(element);
  }
  return out;
}

/**
 * 一覧の unit に従って単位を数える。
 * @param {string} text
 * @param {{ unit: string, arrays: string[], key?: string | null, mutableColumns?: string[] }} artifact
 * @param {string} label
 * @returns {Map<string, number>}
 */
export function unitsOf(text, artifact, label) {
  if (artifact.unit === "markdown-structure") {
    return markdownUnits(text, artifact.mutableColumns ?? []);
  }
  if (artifact.unit === "json-arrays") {
    return jsonArrayUnits(text, artifact.arrays, label, artifact.key ?? null);
  }
  return normalizeLines(text);
}

/**
 * git コマンドを実行する。
 * @param {string} root
 * @param {string[]} args
 * @returns {{ status: number, stdout: string, stderr: string }}
 */
function git(root, args) {
  const r = spawnSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (r.error) throw new UsageError(`git を実行できない: ${r.error.message}`);
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/**
 * 一覧を読む。
 * @param {string} manifestPath
 * @returns {{ id: string, pattern: string, unit: string, arrays: string[], key: string | null, fillOnly: string[], transitions: Record<string, string[]>, mutableColumns: string[], requirement: string, source: string }[]}
 */
export function readManifest(manifestPath) {
  if (!existsSync(manifestPath)) throw new UsageError(`一覧が無い: ${manifestPath}`);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (e) {
    throw new UsageError(
      `一覧が JSON として壊れている: ${manifestPath}（${e instanceof Error ? e.message : String(e)}）`,
    );
  }
  if (!isPlainObject(parsed) || !Array.isArray(parsed.artifacts)) {
    throw new UsageError(`一覧に artifacts 配列が無い: ${manifestPath}`);
  }
  return parsed.artifacts.map((a, i) => {
    if (!isPlainObject(a)) throw new UsageError(`artifacts[${i}] がオブジェクトでない`);
    if (!nonEmptyString(a.id) || !nonEmptyString(a.pattern)) {
      throw new UsageError(`artifacts[${i}] の id / pattern が空`);
    }
    // unit を持たない旧い一覧は lines（このツールの初版の突き合わせ方）として読む。
    const unit = a.unit === undefined || a.unit === null ? "lines" : a.unit;
    if (!UNITS.includes(/** @type {string} */ (unit))) {
      throw new UsageError(
        `artifacts[${i}] の unit が語彙外（${UNITS.join(" / ")}）: ${JSON.stringify(a.unit)}`,
      );
    }
    /** @type {string[]} */
    let arrays = [];
    /** @type {string | null} */
    let key = null;
    /** @type {string[]} */
    let fillOnly = [];
    /** @type {Record<string, string[]>} */
    const transitions = {};
    /** @type {string[]} */
    let mutableColumns = [];
    if (unit === "json-arrays") {
      if (!Array.isArray(a.arrays) || a.arrays.length === 0) {
        throw new UsageError(`artifacts[${i}] の unit が json-arrays なのに arrays が空`);
      }
      for (const path of a.arrays) {
        if (!nonEmptyString(path)) throw new UsageError(`artifacts[${i}].arrays に空の要素がある`);
      }
      arrays = a.arrays.map((x) => String(x).trim());
      if (a.key !== undefined && a.key !== null) {
        if (!nonEmptyString(a.key)) throw new UsageError(`artifacts[${i}].key が空`);
        key = String(a.key).trim();
      }
      if (a.fill_only !== undefined && a.fill_only !== null) {
        if (key === null)
          throw new UsageError(`artifacts[${i}] は key が無いのに fill_only がある`);
        if (!Array.isArray(a.fill_only))
          throw new UsageError(`artifacts[${i}].fill_only が配列でない`);
        for (const f of a.fill_only) {
          if (!nonEmptyString(f))
            throw new UsageError(`artifacts[${i}].fill_only に空の要素がある`);
        }
        fillOnly = a.fill_only.map((x) => String(x).trim());
      }
      if (a.transitions !== undefined && a.transitions !== null) {
        if (key === null)
          throw new UsageError(`artifacts[${i}] は key が無いのに transitions がある`);
        if (!isPlainObject(a.transitions)) {
          throw new UsageError(`artifacts[${i}].transitions がオブジェクトでない`);
        }
        for (const [field, list] of Object.entries(a.transitions)) {
          if (!Array.isArray(list) || list.length === 0) {
            throw new UsageError(`artifacts[${i}].transitions.${field} が空の配列`);
          }
          for (const t of list) {
            // 「<変更前>-><変更後>」だけを受ける。曖昧な表記を黙って通さない。
            if (!nonEmptyString(t) || !/^[^>]+->[^>]+$/.test(String(t).trim())) {
              throw new UsageError(
                `artifacts[${i}].transitions.${field} の要素が <変更前>-><変更後> の形でない: ${JSON.stringify(t)}`,
              );
            }
          }
          transitions[field] = list.map((x) => String(x).trim());
        }
      }
      if (a.mutable_columns !== undefined && a.mutable_columns !== null) {
        throw new UsageError(
          `artifacts[${i}] の unit が json-arrays なのに mutable_columns がある`,
        );
      }
    } else {
      if (a.arrays !== undefined && a.arrays !== null) {
        throw new UsageError(`artifacts[${i}] の unit が ${unit} なのに arrays がある`);
      }
      if (a.key !== undefined && a.key !== null) {
        throw new UsageError(`artifacts[${i}] の unit が ${unit} なのに key がある`);
      }
      if (a.fill_only !== undefined || a.transitions !== undefined) {
        throw new UsageError(
          `artifacts[${i}] の unit が ${unit} なのに fill_only / transitions がある`,
        );
      }
      if (a.mutable_columns !== undefined && a.mutable_columns !== null) {
        if (unit !== "markdown-structure") {
          throw new UsageError(`artifacts[${i}] の unit が ${unit} なのに mutable_columns がある`);
        }
        if (!Array.isArray(a.mutable_columns)) {
          throw new UsageError(`artifacts[${i}].mutable_columns が配列でない`);
        }
        for (const c of a.mutable_columns) {
          if (!nonEmptyString(c))
            throw new UsageError(`artifacts[${i}].mutable_columns に空の要素がある`);
        }
        mutableColumns = a.mutable_columns.map((x) => String(x).trim());
      }
    }
    return {
      id: String(a.id).trim(),
      pattern: String(a.pattern).trim(),
      unit: String(unit),
      arrays,
      key,
      fillOnly,
      transitions,
      mutableColumns,
      requirement: nonEmptyString(a.requirement) ? String(a.requirement).trim() : "",
      source: nonEmptyString(a.source) ? String(a.source).trim() : "",
    };
  });
}

/**
 * @param {{ root: string, manifestPath: string, base: string }} opts
 * @returns {{ findings: string[], notes: string[], checked: number }}
 */
export function check(opts) {
  const { root, manifestPath, base } = opts;
  const artifacts = readManifest(manifestPath);
  if (artifacts.length === 0) throw new UsageError(`一覧の artifacts が 0 件: ${manifestPath}`);

  const inside = git(root, ["rev-parse", "--is-inside-work-tree"]);
  if (inside.status !== 0 || inside.stdout.trim() !== "true") {
    throw new UsageError(`git リポジトリではないため追記であることを確かめられない: ${root}`);
  }
  const baseRev = git(root, ["rev-parse", "--verify", `${base}^{commit}`]);
  if (baseRev.status !== 0) {
    throw new UsageError(`比較元の版を解決できない: ${base}（${baseRev.stderr.trim()}）`);
  }

  // root がリポジトリのトップレベルとは限らない（.replace が monorepo の一階層下に在る等）。
  // ls-tree の既定は cwd 相対のパスを返す一方、`git show <rev>:<path>` の path はトップレベル起点なので、
  // 揃えずに混ぜると全件が「比較元に無い＝新規」に化けて、突き合わせが 1 件も成立しない。
  // そこで --full-tree でトップレベル起点に揃え、root までの prefix で相互に変換する。
  const top = git(root, ["rev-parse", "--show-toplevel"]);
  if (top.status !== 0 || top.stdout.trim() === "") {
    throw new UsageError(`リポジトリのトップレベルを解決できない: ${root}（${top.stderr.trim()}）`);
  }
  const prefixRel = relative(realpathOrSelf(top.stdout.trim()), realpathOrSelf(root))
    .split(sep)
    .join("/");
  if (prefixRel.startsWith("..") || isAbsolute(prefixRel)) {
    throw new UsageError(
      `--root がリポジトリの外を指している: ${root}（トップレベル ${top.stdout.trim()}）`,
    );
  }
  const prefix = prefixRel === "" ? "" : `${prefixRel}/`;

  /** @type {string[]} */
  const findings = [];
  /** @type {string[]} */
  const notes = [];

  // 比較元に在って作業ツリーから消えたファイルも対象にする（消失は縮小の極端な形）。
  const tracked = git(root, ["ls-tree", "-r", "--name-only", "--full-tree", "-z", base]);
  if (tracked.status !== 0) {
    throw new UsageError(`比較元の版のファイル一覧を取れない: ${base}（${tracked.stderr.trim()}）`);
  }
  const trackedFiles = tracked.stdout
    .split("\0")
    .filter((f) => f !== "" && (prefix === "" || f.startsWith(prefix)))
    .map((f) => f.slice(prefix.length));

  const trackedSet = new Set(trackedFiles);

  // 同じ木を一覧のパターン数だけ歩かない（.replace/*.md が 4 パターンとも同じ起点になる）。
  /** @type {Map<string, string[]>} */
  const walked = new Map();
  /** @param {string} startRel */
  const listCached = (startRel) => {
    const hit = walked.get(startRel);
    if (hit !== undefined) return hit;
    const files = listFiles(root, startRel);
    walked.set(startRel, files);
    return files;
  };

  /** @type {Map<string, { id: string, pattern: string, unit: string, arrays: string[], key: string | null, fillOnly: string[], transitions: Record<string, string[]>, mutableColumns: string[] }>} */
  const byFile = new Map();
  /**
   * @param {string} file
   * @param {{ id: string, pattern: string, unit: string, arrays: string[], key: string | null, fillOnly: string[], transitions: Record<string, string[]>, mutableColumns: string[] }} artifact
   */
  const assign = (file, artifact) => {
    const prev = byFile.get(file);
    if (prev === undefined) {
      byFile.set(file, artifact);
      return;
    }
    if (prev.id === artifact.id) return;
    if (
      prev.unit !== artifact.unit ||
      prev.arrays.join(",") !== artifact.arrays.join(",") ||
      prev.key !== artifact.key ||
      prev.fillOnly.join(",") !== artifact.fillOnly.join(",") ||
      canonicalJson(prev.transitions) !== canonicalJson(artifact.transitions) ||
      prev.mutableColumns.join(",") !== artifact.mutableColumns.join(",")
    ) {
      // 先勝ちにすると一覧の並び替えで判定が変わる。突き合わせ方が割れたら止める。
      throw new UsageError(
        `同じファイルに突き合わせ方の違う一覧の項目が当たっている: ${file}（${prev.id}: ${prev.unit} / ${artifact.id}: ${artifact.unit}）`,
      );
    }
  };
  for (const artifact of artifacts) {
    const re = globToRegExp(artifact.pattern);
    for (const file of listCached(literalPrefix(artifact.pattern))) {
      if (re.test(file)) assign(file, artifact);
    }
    for (const file of trackedFiles) {
      if (re.test(file)) assign(file, artifact);
    }
  }

  const targets = [...byFile.keys()].sort();
  if (targets.length === 0) {
    throw new UsageError(
      `追記専用の成果物が 1 件も見つからない（対象 0 件を合格に倒さない）: root=${root} 一覧=${manifestPath}`,
    );
  }

  let checked = 0;
  for (const file of targets) {
    const artifact =
      /** @type {{ id: string, pattern: string, unit: string, arrays: string[], key: string | null, fillOnly: string[], transitions: Record<string, string[]>, mutableColumns: string[] }} */ (
        byFile.get(file)
      );
    const inBase = trackedSet.has(file);
    const before = git(root, ["show", `${base}:${prefix}${file}`]);
    if (before.status !== 0) {
      if (inBase) {
        // 比較元の木に在るのに取り出せない。「新規」に倒すと縮小が数えられないまま素通りする。
        throw new UsageError(
          `比較元 ${base} の木に在るのに内容を取り出せない: ${file}（${before.stderr.trim()}）`,
        );
      }
      notes.push(`新規（比較元 ${base} に無い）: ${file}`);
      continue;
    }
    checked += 1;
    const abs = join(root, file);
    if (!existsSync(abs)) {
      findings.push(`追記専用の成果物が消えている: ${file}（比較元 ${base} には在る）`);
      continue;
    }
    const afterText = readFileSync(abs, "utf8");
    if (artifact.unit === "json-arrays" && artifact.key !== null) {
      // 鍵で対応づけてフィールドごとに見る（多重集合では「鍵以外の書き換え」を表現できない）。
      const keyed = compareKeyedArrays(
        before.stdout,
        afterText,
        {
          arrays: artifact.arrays,
          key: artifact.key,
          fillOnly: artifact.fillOnly,
          transitions: artifact.transitions,
        },
        { before: `${file}@${base}`, after: file },
      );
      for (const finding of keyed) findings.push(`${finding}: ${file}`);
      continue;
    }
    const beforeUnits = unitsOf(before.stdout, artifact, `${file}@${base}`);
    const afterUnits = unitsOf(afterText, artifact, file);
    /** @type {string[]} */
    const lost = [];
    let lostCount = 0;
    for (const [unit, count] of beforeUnits) {
      const now = afterUnits.get(unit) ?? 0;
      if (now < count) {
        lostCount += count - now;
        if (lost.length < 3) lost.push(unit.length > 120 ? `${unit.slice(0, 117)}...` : unit);
      }
    }
    if (lostCount > 0) {
      findings.push(
        `追記専用の成果物から ${lostCount} 件（unit: ${artifact.unit}）が失われている: ${file}（例: ${lost.join(" / ")}）`,
      );
    }
  }

  notes.push(
    `一覧の ${artifacts.length} パターンに一致した ${targets.length} 件のうち、比較元にも在る ${checked} 件を突き合わせた`,
  );
  if (checked === 0) {
    findings.push(
      `比較元 ${base} に在る追記専用の成果物が 0 件（突き合わせが 1 件も成立していない）`,
    );
  }
  return { findings, notes, checked };
}

/** 同梱の一覧（正本）。 */
export function defaultManifestPath() {
  return resolve(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "assets",
    "append-only-manifest.json",
  );
}

/**
 * @param {string[]} argv
 * @returns {{ root: string, manifest: string, base: string }}
 */
export function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root" || arg === "--manifest" || arg === "--base") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) throw new UsageError(`${arg} に値が無い`);
      opts[arg.slice(2)] = value;
      i += 1;
      continue;
    }
    throw new UsageError(`不明な引数: ${arg}`);
  }
  if (!nonEmptyString(opts.root)) throw new UsageError("--root は必須（走査の起点を推測させない）");
  return {
    root: resolve(opts.root),
    manifest: opts.manifest !== undefined ? resolve(opts.manifest) : defaultManifestPath(),
    base: opts.base ?? "HEAD",
  };
}

/** 使い方（stderr に出す）。 */
const usage = [
  "usage: append-only-check.mjs --root <dir> [--manifest <path>] [--base <rev>]",
  "  --root      リポジトリルート（必須。走査の起点を推測させない）",
  "  --manifest  追記専用の成果物の一覧（既定: スキル同梱の assets/append-only-manifest.json）",
  "  --base      比較元の版（既定: HEAD）",
  "exit: 0 = 縮んでいない / 1 = 単位が失われている・成果物が消えている・比較元に在る成果物が 0 件 / 2 = 使い方の誤り・判定不能・作業ツリーの対象 0 件",
].join("\n");

/**
 * @param {string[]} argv
 * @returns {number}
 */
export function main(argv) {
  try {
    const args = parseArgs(argv);
    const { findings, notes } = check({
      root: args.root,
      manifestPath: args.manifest,
      base: args.base,
    });
    for (const note of notes) process.stdout.write(`note: ${note}\n`);
    for (const finding of findings) process.stdout.write(`warn: ${finding}\n`);
    if (findings.length > 0) {
      process.stdout.write(
        `error: 追記専用の成果物が ${findings.length} 件で縮んでいる — 過去の決定が失われている\n`,
      );
      return 1;
    }
    process.stdout.write(`ok: 追記専用の成果物は縮んでいない（append-only-check ${VERSION}）\n`);
    return 0;
  } catch (e) {
    if (e instanceof UsageError) {
      process.stderr.write(`error: ${e.message}\n${usage}\n`);
      return 2;
    }
    throw e;
  }
}

// CLI エントリ判定は両辺を実パスに解決してから突き合わせる（シンボリックリンク経由の起動でサイレント no-op にしない）。
const invokedAsCli = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  const self = fileURLToPath(import.meta.url);
  try {
    return realpathSync(entry) === realpathSync(self);
  } catch {
    return entry === self;
  }
})();

if (invokedAsCli) {
  process.exit(main(process.argv.slice(2)));
}
