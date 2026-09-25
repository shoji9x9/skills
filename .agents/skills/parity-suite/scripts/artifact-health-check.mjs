// 採取物と工程の健全性を数える（正本）。
// 正本は parity-suite にあり、スキルディレクトリ内から直接実行する（プロジェクトへコピーしない）。
// parity-diff は収束判定でインストール済みの parity-suite から同じスクリプトを呼ぶ。
//
// 何をするか（metadata.json の宣言を読んで数え直す）:
//   1. 採取物（artifact_health）: 採取物ごとに「読むスペック」と「何から作ったか」の宣言を要求する。
//      読み手は字面の照合（スペックの中に basename が現れるか）で足りる——assertion に使っているかまでは見ない。
//      加工物（kind: derived）は元の実体の sha256 を数え直し、一致しなければ古いものとして落とす。
//      baseline_dir に在るのに entries に無いファイルは未宣言として落とす（宣言の無いものだけを落とす）。
//   2. 反復実行（suite.state_mutating / suite.repeat_run）: 状態を変えるスイートは 2 回続けて緑であることを求める。
//      1 回目は初期状態から始まるため後始末の有無が結果に現れない。
//      記録は suite_fingerprint で「どの版のスイートを回したか」に結びつける——
//      結びつけないと、2 回緑を記録した後にスペックや後始末を変えても古い記録で緑のまま通る。
//      repeat_run.specs（スペックごとの分類）を持つ成果物はスペック単位で判定する（Issue #473）——
//      2 回を求めるのは状態を変えるスペックだけで、記録はスペックごとの指紋と共有の土台の指紋に結びつける。
//      記録する指紋は --fingerprint で出す（手で計算しない）。
//   3. 未測定（unmeasured）: gaps.md の散文と対になる機械可読の宣言。disposition: blocking が残る間は収束させない。
//   4. 工程の成果物（--target）: suite.new_green が真なら同じ場所に diff-metadata.json が在り、
//      それが「いまの新側」（new.commit と loop.iterations）に対応していることを求める
//      （converged が偽でも落とさない）。dataset_version は数値の一致では見ない——陳腐化の正本は
//      golden-dataset の references/versioning.md で、交差を見るまでもなく確定する形だけをここで落とす。
//      投入対象でない target は dataset_version: null ＋ dataset_version_exempt で免除される（parity-diff の references/preflight.md）。
//
// 何をしないか: 採取・加工・スイートの実行はしない。ここでは記録と実体を突き合わせるだけ。
//
// fail-closed: 宣言が無い・読み手が無い・元が読めない・対象 0 件・判定不能は合格に倒さない。
// 後方互換: artifact_health / unmeasured / suite.state_mutating をキーごと持たない旧成果物は
//           その節を判定しない（judged: false。理由を出力に残す）。
//
// 決定論的: 乱数・現在時刻に依存しない。TypeScript 構文は使わない（型は JSDoc）。

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  posix,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// 同じディレクトリの evidence-carry.mjs は、このファイルの実パスから引く。静的な "./evidence-carry.mjs" は
// --preserve-symlinks-main でファイル単位のシンボリックリンクから起動されると、リンクの置き場所から解決して
// 見つからず、持ち越しを使わない実行（引数不足の usage 表示を含む）まで起動時に落ちる。
const { EVIDENCE_CARRY_FILE, judgeCarry } = await import(
  pathToFileURL(join(dirname(realpathSync(fileURLToPath(import.meta.url))), "evidence-carry.mjs"))
    .href
);

/**
 * ツールのバージョン（正本）。判定ロジック・出力形状を変えたら上げる。
 * @type {string}
 */
export const VERSION = "9";

/** 採取物の種別。derived は元の実体から作った加工物。 */
const ARTIFACT_KINDS = ["captured", "derived"];

/** 未測定の処置。語彙外・欠落は blocking として数える（fail-closed）。 */
const DISPOSITIONS = ["blocking", "accepted"];

/**
 * 呼び出し元の工程。同じ記録でも「誰のゲートか」で blocking の扱いが変わる。
 * - diff（既定・最も厳しい）: parity-diff の収束判定。blocking が残る間は収束させない
 * - suite: parity-suite の完了判定。blocking は本スキルが書く出力そのものなので落とさない
 *   （記録の不備——item の空・重複・reason の空・語彙外の disposition・承認記録の無い accepted——は
 *   どちらの工程でも落とす。測定待ちと壊れた記録は別物）
 */
const STAGES = ["diff", "suite"];

/** 反復実行で緑と数える結果。 */
const GREEN = "green";

/** 新側リポジトリがコミットを持たないことを表す語彙上のセンチネル（リポジトリ共通）。 */
const NO_COMMIT = "none";

/**
 * 反復回数を整数として読む。**数字列は受けない**——同じ `loop.iterations` を読む
 * component-comparison-check.mjs は数値だけを受けるので、片方だけ緩めると 2 つの検査器が
 * 同じ記録に矛盾した判定（片方合格・片方 unversionable）を出す。正本のテンプレートも数値。
 * dataset の版（`toInteger`）とは入力の出所が違うので共有しない。
 * @param {unknown} value
 * @returns {number | null}
 */
function toIterationCount(value) {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

/** 走査で辿らないディレクトリ名。 */
const SKIP_DIRS = new Set([".git", "node_modules"]);

/** 使い方の誤り・型崩れ（exit 2）。 */
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
 * 実在する最も深い祖先まで `realpathSync` で解いてから、残りの区間を継ぎ足して実パスを組む。
 *
 * **まだ存在しないパスでも実パスで判定できるようにする**——存在しないことを理由に
 * 文字列のまま扱うと、途中のディレクトリがシンボリックリンクでも閉じ込めを確かめられない。
 * ENOENT 以外（ELOOP・EACCES 等）は「解けなかった」であって「外でない」ではないので、
 * 合格に倒さず null を返す（fail-closed）。
 * @param {string} p
 * @returns {string | null}
 */
function realPathOf(p) {
  let current = resolve(p);
  /** @type {string[]} */
  const tail = [];
  for (;;) {
    try {
      const real = realpathSync(current);
      return tail.length === 0 ? real : join(real, ...tail);
    } catch (e) {
      if (/** @type {NodeJS.ErrnoException} */ (e).code !== "ENOENT") return null;
    }
    const parent = dirname(current);
    // ルートまで遡っても解けない（存在しないドライブ等）。文字列のまま通さない。
    if (parent === current) return null;
    tail.unshift(basename(current));
    current = parent;
  }
}

/**
 * 相対パスが基準ディレクトリの外へ出ないことを確かめてから解決する。
 *
 * **文字列の比較だけでは閉じ込められない**——`baseline_dir` の直下に外を指すシンボリックリンクを
 * 置くと `resolve()` / `relative()` は中に見え、その後の `readFileSync` はリンクを解いて
 * ルートの外のファイルを読み、そのハッシュを検証に使う（何の finding も出さずに）。
 * 同じファイルの CLI 自己起動判定が `realpathSync` で両辺を実パスに揃えているのと同じ扱いにする。
 * @param {string} baseDir
 * @param {string} relPath
 * @returns {string | null} 基準の外・絶対パス・実パスを解けないなら null
 */
function resolveInside(baseDir, relPath) {
  if (typeof relPath !== "string" || relPath.trim() === "" || isAbsolute(relPath)) return null;
  const resolved = resolve(baseDir, relPath);
  const rel = relative(baseDir, resolved);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return null;
  const realBase = realPathOf(baseDir);
  const realTarget = realPathOf(resolved);
  if (realBase === null || realTarget === null) return null;
  const realRel = relative(realBase, realTarget);
  if (realRel === "" || realRel.startsWith("..") || isAbsolute(realRel)) return null;
  return resolved;
}

/**
 * ディレクトリ直下を再帰的に列挙し、基準からの相対パスを返す（POSIX 区切りに揃える）。
 * @param {string} dir
 * @returns {string[]}
 */
function listFiles(dir) {
  /** @type {string[]} */
  const out = [];
  /** @param {string} current */
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : 1,
    )) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(join(current, entry.name));
      } else if (entry.isFile()) {
        out.push(relative(dir, join(current, entry.name)).split(sep).join("/"));
      }
    }
  };
  walk(dir);
  return out.sort();
}

/**
 * JSON を読む。読めない・壊れているは型崩れ（exit 2）。
 * @param {string} path
 * @param {string} label
 * @returns {unknown}
 */
function readJson(path, label) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    throw new UsageError(
      `${label} を読めない: ${path}（${e instanceof Error ? e.message : String(e)}）`,
    );
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new UsageError(
      `${label} が JSON として壊れている: ${path}（${e instanceof Error ? e.message : String(e)}）`,
    );
  }
}

/**
 * @param {string} path
 * @returns {string} sha256（16 進小文字）
 */
function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * コメントを除いて指紋を取る拡張子。TypeScript（`.ts` / `.mts` / `.cts`）だけにする——TypeScript で JSX を書けるのは
 * `.tsx` だけだが、JavaScript はトランスパイルで拡張子に関係なく JSX を書ける。JSX のテキスト（`<p>http://x</p>`）の `//` は
 * この字句解析ではコメントと区別できず、テキストの書き換えを見逃すので、`.js` 系と `.jsx` / `.tsx` は生バイトで数える。
 */
const JS_FAMILY_EXTENSIONS = new Set([".ts", ".mts", ".cts"]);

/**
 * 残すコメント（指示コメント）か。ツール・コンパイラへの指示はコメントの形でも動きを変えうるので、
 * 除かずに正規形へ残す（残しすぎは回し直しを 1 回増やすだけで、除きすぎは変更を見逃す）。
 * 対象: `///`・`//#`・`/*!`、`@` で始まるもの（`@ts-*`・`@vite-ignore`・JSDoc 冒頭の `@jsx` 等）、
 * 既知のツール名で始まるもの（eslint・istanbul・webpack 等）。
 * @param {string} body `//` の後、またはブロックコメントの開きと閉じの間
 * @returns {boolean}
 */
function isDirectiveComment(body) {
  if (/^[/#!]/.test(body)) return true;
  const t = body.replace(/^[\s*]+/, "");
  return (
    t.startsWith("@") ||
    /^(eslint|istanbul|c8|v8|webpack|vite-|prettier-|jshint|jscs|globals?\b|exported\b|tslint|biome-|oxlint-|deno-|swc-|esbuild-|rollup-|turbopack)/i.test(
      t,
    )
  );
}

/** 直後の `/` を正規表現リテラルの開始と読むキーワード（それ以外の識別子・数値の後は除算）。 */
const REGEX_AFTER_KEYWORDS = new Set([
  "return",
  "typeof",
  "instanceof",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "case",
  "do",
  "else",
  "yield",
  "await",
]);

/**
 * JS / TS 系のソースからコメントを除き、コメントの書き換えで変わらない正規形にする。
 *
 * 正規化の選択（指紋を「動きに効く書き換え」だけで変えるため）:
 * - コメントは空白として扱う（`a/**\/b` を `ab` に潰さない）。
 * - 文字列・テンプレートリテラル（`${}` の入れ子を含む）・正規表現リテラルの外では、空白の連なりを
 *   改行を含むなら `\n` 1 個、含まなければ空白 1 個に畳む。改行の有無は ASI に効くので残し、
 *   個数・インデント・コメントの行数は捨てる。行末コメントの有無・JSDoc の行数を変えても指紋は変わらない。
 * - 文字列・テンプレート・正規表現の中身は 1 バイトも変えない（`test.skip` の理由のような文字列は
 *   動きに効かないと言い切れないため対象外。中の `//` `/*` もコメントとして扱わない）。
 * - `/` が正規表現か除算かは直前の有意なトークンで決める。識別子（上のキーワードを除く）・数値・
 *   文字列・`)` `]` の後は除算、それ以外（`}` を含む）は正規表現。`}` を正規表現側に倒すのは、
 *   正規表現を除算と読み違えると `/a\//` の `//` を行コメントとして読み、コードを捨てて変更を見逃すため。
 * - 指示コメント（isDirectiveComment）は除かず残す。
 * 限界: JSX のテキスト（`<p>http://x</p>`）の `//` はコメントと読むので、`.jsx` / `.tsx` には当てない
 * （JS_FAMILY_EXTENSIONS）。字句解析が閉じない
 * （終わらない文字列・コメント・正規表現）ときは null を返し、呼び出し側は生バイトで指紋を取る。
 * @param {string} src
 * @returns {string | null}
 */
export function stripJsComments(src) {
  let out = "";
  /** @type {"" | " " | "\n"} */
  let pendingWs = "";
  /** 直前の有意なトークン: "div" なら次の `/` は除算、"re" なら正規表現。 */
  let prev = "re";
  /** `{` の入れ子。"t" はテンプレートの `${` で、対応する `}` でテンプレートへ戻る。 */
  /** @type {string[]} */
  const braces = [];
  let i = 0;
  const n = src.length;
  const isWs = (c) => /\s/.test(c);
  const isIdent = (c) => /[\w$\\]/.test(c) || c.charCodeAt(0) > 0x7f;
  const emit = (s) => {
    if (pendingWs !== "" && out !== "") out += pendingWs;
    pendingWs = "";
    out += s;
  };
  const ws = (hasNewline) => {
    if (hasNewline) pendingWs = "\n";
    else if (pendingWs === "") pendingWs = " ";
  };
  /** テンプレートの本文を読む。`}` で戻ってきた直後か開始の `` ` `` の直後から。 */
  const scanTemplate = () => {
    const start = i;
    while (i < n) {
      const c = src[i];
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === "`") {
        i += 1;
        out += src.slice(start, i);
        prev = "div";
        return true;
      }
      if (c === "$" && src[i + 1] === "{") {
        i += 2;
        out += src.slice(start, i);
        braces.push("t");
        prev = "re";
        return true;
      }
      i += 1;
    }
    return false;
  };
  while (i < n) {
    const c = src[i];
    if (isWs(c)) {
      const start = i;
      while (i < n && isWs(src[i])) i += 1;
      ws(/[\n\r\u2028\u2029]/.test(src.slice(start, i)));
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      const start = i;
      while (i < n && !/[\n\r\u2028\u2029]/.test(src[i])) i += 1;
      // 指示コメントは残す。直前・直後の有意なトークンの読み（prev）はコメントで変えない
      if (isDirectiveComment(src.slice(start + 2, i))) emit(src.slice(start, i).trimEnd());
      else ws(false);
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      if (end < 0) return null;
      if (isDirectiveComment(src.slice(i + 2, end))) emit(src.slice(i, end + 2));
      else ws(/[\n\r\u2028\u2029]/.test(src.slice(i + 2, end)));
      i = end + 2;
      continue;
    }
    if (c === "'" || c === '"') {
      const start = i;
      i += 1;
      while (i < n && src[i] !== c) {
        if (src[i] === "\\") i += 1;
        else if (src[i] === "\n") return null;
        i += 1;
      }
      if (i >= n) return null;
      i += 1;
      emit(src.slice(start, i));
      prev = "div";
      continue;
    }
    if (c === "`") {
      emit("`");
      i += 1;
      if (!scanTemplate()) return null;
      continue;
    }
    if (c === "/" && prev === "re") {
      const start = i;
      i += 1;
      let inClass = false;
      while (i < n) {
        const d = src[i];
        if (d === "\\") i += 1;
        else if (d === "\n") return null;
        else if (d === "[") inClass = true;
        else if (d === "]") inClass = false;
        else if (d === "/" && !inClass) break;
        i += 1;
      }
      if (i >= n) return null;
      i += 1;
      while (i < n && isIdent(src[i])) i += 1;
      emit(src.slice(start, i));
      prev = "div";
      continue;
    }
    if (isIdent(c)) {
      const start = i;
      while (i < n && isIdent(src[i])) i += 1;
      const word = src.slice(start, i);
      emit(word);
      prev = REGEX_AFTER_KEYWORDS.has(word) ? "re" : "div";
      continue;
    }
    // 記号 1 文字。`.5` のような数値の小数点も記号として出すが、正規形として決定的なので問題ない。
    if (c === "/" && out.endsWith(")")) {
      // `)` の後の `/` は、`(a + b) / 2` なら除算、`if (x) /[//]/.test(v)` なら正規表現で、字句だけでは決まらない。
      // 除算と読んだまま同じ行の残りに `//` `/*` があると、正規表現の中身をコメントとして捨ててコードの変更を
      // 見逃しうるので、その形は読めないとして生バイトに倒す（null）
      const eol = src.slice(i + 1).search(/[\n\r\u2028\u2029]/);
      const rest = eol < 0 ? src.slice(i + 1) : src.slice(i + 1, i + 1 + eol);
      if (rest.includes("//") || rest.includes("/*")) return null;
    }
    i += 1;
    if (c === "{") braces.push("b");
    if (c === "}" && braces.pop() === "t") {
      // テンプレートの `${ ... }` を閉じた。空白はテンプレートの本文に属するので、保留した空白は捨てる。
      pendingWs = "";
      out += "}";
      if (!scanTemplate()) return null;
      continue;
    }
    emit(c);
    if (c === ")" || c === "]") prev = "div";
    else if ((c === "+" || c === "-") && src[i - 2] === c) prev = "div"; // 後置 ++ / --
    else prev = "re";
  }
  return out;
}

/**
 * スペックの本文に採取物の名前が「ファイル名として」現れるかを見る。
 * 素の部分文字列一致にすると orders.xlsx が orders.xlsx.json にも当たり、
 * 実際には読まれていない採取物が読み手ありとして素通りする。
 * 前後がファイル名を構成しうる文字（英数・. _ -）でないことまで確かめる。
 * @param {string} text
 * @param {string} name
 * @returns {boolean}
 */
export function includesAsName(text, name) {
  const namePart = /[A-Za-z0-9._-]/;
  let from = 0;
  for (;;) {
    const at = text.indexOf(name, from);
    if (at === -1) return false;
    const before = at === 0 ? "" : text[at - 1];
    const after = text[at + name.length] ?? "";
    if (!namePart.test(before) && !namePart.test(after)) return true;
    from = at + 1;
  }
}

/**
 * 採取物の節を数え直す。
 * @param {Record<string, unknown>} metadata
 * @param {{ root: string }} ctx
 * @returns {{ judged: boolean, findings: string[], notes: string[] }}
 */
export function checkArtifacts(metadata, ctx) {
  /** @type {string[]} */
  const findings = [];
  /** @type {string[]} */
  const notes = [];
  if (!("artifact_health" in metadata)) {
    return {
      judged: false,
      findings,
      notes: ["artifact_health をキーごと持たない旧成果物のため採取物の節を判定しない"],
    };
  }
  const health = metadata.artifact_health;
  if (!isPlainObject(health)) throw new UsageError("artifact_health がオブジェクトでない");
  if (typeof health.declared !== "boolean")
    throw new UsageError("artifact_health.declared が真偽値でない");
  if (!health.declared) {
    if (!nonEmptyString(health.reason))
      throw new UsageError(
        "artifact_health.declared: false なのに reason が空（免除の根拠が残らない）",
      );
    return {
      judged: false,
      findings,
      notes: [
        `artifact_health.declared: false のため判定しない（理由: ${String(health.reason).trim()}）`,
      ],
    };
  }

  if (!nonEmptyString(health.baseline_dir))
    throw new UsageError("artifact_health.baseline_dir が空でない文字列でない");
  const baselineDir = resolveInside(ctx.root, String(health.baseline_dir));
  if (baselineDir === null)
    throw new UsageError(
      `artifact_health.baseline_dir がルートの外を指しているか実パスを解決できない: ${String(health.baseline_dir)}`,
    );
  if (!Array.isArray(health.entries)) throw new UsageError("artifact_health.entries が配列でない");

  let present = [];
  if (!existsSync(baselineDir) || !statSync(baselineDir).isDirectory()) {
    findings.push(`artifact_health.declared: true なのに baseline_dir が無い: ${baselineDir}`);
  } else {
    present = listFiles(baselineDir);
  }

  /** @type {Map<string, Record<string, unknown>>} */
  const byPath = new Map();
  const seen = new Set();
  for (const [i, entry] of health.entries.entries()) {
    if (!isPlainObject(entry))
      throw new UsageError(`artifact_health.entries[${i}] がオブジェクトでない`);
    if (!nonEmptyString(entry.path))
      throw new UsageError(`artifact_health.entries[${i}].path が空でない文字列でない`);
    const p = String(entry.path).trim();
    if (seen.has(p)) {
      findings.push(`採取物の宣言が重複している（先勝ちにしない）: ${p}`);
      continue;
    }
    seen.add(p);
    byPath.set(p, entry);
  }

  if (present.length === 0 && byPath.size === 0) {
    findings.push(`採取物が 0 件（宣言も実体も無い）。対象 0 件を合格に倒さない: ${baselineDir}`);
  }

  for (const file of present) {
    if (!byPath.has(file))
      findings.push(`採取物が宣言されていない（読み手が居るか分からない）: ${file}`);
  }

  for (const [p, entry] of byPath) {
    const target = resolveInside(baselineDir, p);
    if (target === null) {
      findings.push(`採取物のパスが baseline_dir の外を指しているか実パスを解決できない: ${p}`);
      continue;
    }
    if (!existsSync(target)) {
      findings.push(`宣言された採取物の実体が無い: ${p}`);
      continue;
    }

    const kind = entry.kind;
    if (!ARTIFACT_KINDS.includes(/** @type {string} */ (kind))) {
      findings.push(`採取物の kind が語彙外（${ARTIFACT_KINDS.join(" / ")}）: ${p}`);
    }

    // 読み手（字面の照合）
    const readBy = entry.read_by;
    if (readBy !== undefined && readBy !== null && !Array.isArray(readBy)) {
      throw new UsageError(`artifact_health.entries[${p}].read_by が配列でない`);
    }
    const readers = Array.isArray(readBy) ? readBy : [];
    if (readers.length === 0) {
      if (!nonEmptyString(entry.unread_reason)) {
        findings.push(
          `読み手が宣言されておらず unread_reason も空（採っただけの採取物になる）: ${p}`,
        );
      }
    } else {
      const name = basename(p);
      for (const reader of readers) {
        if (!nonEmptyString(reader)) {
          findings.push(`read_by に空の要素がある: ${p}`);
          continue;
        }
        const specPath = resolveInside(ctx.root, String(reader).trim());
        // **閉じ込め拒否と不在を同じ文言にしない**——リンク越しにルート外を指す宣言は実体が在るのに
        // ここで null になるため、「無い」と報告すると原因（閉じ込め拒否）に辿り着けない。
        if (specPath === null) {
          findings.push(
            `read_by が指すスペックがルートの外を指しているか実パスを解決できない: ${String(reader).trim()}（採取物 ${p}）`,
          );
          continue;
        }
        if (!existsSync(specPath)) {
          findings.push(`read_by が指すスペックが無い: ${String(reader).trim()}（採取物 ${p}）`);
          continue;
        }
        let text;
        try {
          text = readFileSync(specPath, "utf8");
        } catch (e) {
          findings.push(
            `read_by が指すスペックを読めない: ${String(reader).trim()}（${e instanceof Error ? e.message : String(e)}）`,
          );
          continue;
        }
        if (!includesAsName(text, name)) {
          findings.push(
            `read_by が指すスペックに採取物の名前が現れない（字面の照合で不一致）: ${name} ∉ ${String(reader).trim()}`,
          );
        }
      }
    }

    // 鮮度（何から作ったか）
    const derivedFrom = entry.derived_from;
    if (kind === "derived") {
      if (derivedFrom === undefined || derivedFrom === null) {
        if (!nonEmptyString(entry.freshness_unverified_reason)) {
          findings.push(
            `加工物に derived_from が無く freshness_unverified_reason も空（古いかもしれないが未検証としても残らない）: ${p}`,
          );
        }
        continue;
      }
      if (!isPlainObject(derivedFrom))
        throw new UsageError(`artifact_health.entries[${p}].derived_from がオブジェクトでない`);
      if (!nonEmptyString(derivedFrom.path) || !nonEmptyString(derivedFrom.sha256)) {
        findings.push(`derived_from の path / sha256 が空: ${p}`);
        continue;
      }
      const srcRel = String(derivedFrom.path).trim();
      if (!byPath.has(srcRel)) {
        findings.push(
          `derived_from が宣言されていない採取物を指している: ${srcRel}（加工物 ${p}）`,
        );
        continue;
      }
      const srcPath = resolveInside(baselineDir, srcRel);
      if (srcPath === null) {
        findings.push(
          `derived_from の実体が baseline_dir の外を指しているか実パスを解決できない: ${srcRel}（加工物 ${p}）`,
        );
        continue;
      }
      if (!existsSync(srcPath)) {
        findings.push(`derived_from の実体が無い: ${srcRel}（加工物 ${p}）`);
        continue;
      }
      const actual = sha256File(srcPath);
      if (actual !== String(derivedFrom.sha256).trim().toLowerCase()) {
        findings.push(
          `加工物が古い（元の実体の sha256 が宣言と一致しない）: ${p} ← ${srcRel}（宣言 ${String(derivedFrom.sha256).trim()} / 実測 ${actual}）`,
        );
      }
    } else if (derivedFrom !== undefined && derivedFrom !== null) {
      findings.push(`kind: captured なのに derived_from がある（採取か加工かが決まらない）: ${p}`);
    }
  }

  notes.push(`採取物 ${byPath.size} 件を宣言、${present.length} 件を baseline_dir に実測`);
  return { judged: true, findings, notes };
}

/** 反復実行の記録が指す「スイートそのもの」を構成する metadata.suite のキー。 */
const SUITE_SOURCE_KEYS = ["specs", "locator_map", "expectations", "interactions", "tools"];

/**
 * 現在のスイートの指紋を計算する。
 *
 * 2 回緑を記録した後にスペックを書き換えたり後始末を外したりしても、記録だけを見る検査は緑のまま通る。
 * 記録が「どの版のスイートを 2 回回したか」を持たないためで、指紋を記録・照合して初めて
 * 「いまのスイートが 2 回続けて回った」と言える。
 *
 * 列挙は宣言されたパス（suite.specs / locator_map / interactions）から行い、
 * ディレクトリは再帰、並びはソートで固定する。1 つでも実体が無ければ判定不能として null を返す。
 *
 * 既定（接頭辞 `sha256-nc:`）は JS / TS 系のファイルをコメントを除いた正規形（stripJsComments）で数える。
 * 注記を書き換えただけで指紋が変わると、テストの動きが同じなのに現行で 2 回回し直すことになるため（#457）。
 * それ以外の拡張子と、字句解析が閉じない JS / TS 系のファイルは生バイトで数える。
 * `legacy: true` は旧方式（接頭辞 `sha256:`・全ファイル生バイト）で、`sha256:` で記録済みの runs と照合するのに使う。
 * @param {Record<string, unknown>} suiteObj
 * @param {string} root
 * @param {{ legacy?: boolean }} [opts]
 * @returns {{ fingerprint: string | null, files: number, missing: string[], unparsed: string[] }}
 */
export function suiteFingerprint(suiteObj, root, opts = {}) {
  const legacy = opts.legacy === true;
  const listed = listSuiteFiles(suiteObj, root);
  if (listed.declared === 0 || listed.missing.length > 0)
    return { fingerprint: null, files: 0, missing: listed.missing, unparsed: [] };
  const files = listed.byKey.flatMap((k) => k.files).sort();
  const d = digestFiles(files, root, legacy);
  return {
    fingerprint: d.fingerprint,
    files: d.fingerprint === null ? 0 : files.length,
    missing: d.missing,
    unparsed: d.unparsed,
  };
}

/**
 * suite の宣言パス（SUITE_SOURCE_KEYS）の下のファイルを列挙する。ディレクトリは再帰、パスは宣言の字面に継ぎ足す。
 * @param {Record<string, unknown>} suiteObj
 * @param {string} root
 * @returns {{ declared: number, missing: string[], byKey: { key: string, rel: string, files: string[] }[] }}
 */
function listSuiteFiles(suiteObj, root) {
  /** @type {string[]} */
  const missing = [];
  /** @type {{ key: string, rel: string, files: string[] }[]} */
  const byKey = [];
  let declared = 0;
  for (const key of SUITE_SOURCE_KEYS) {
    const value = suiteObj[key];
    if (!nonEmptyString(value)) continue;
    declared += 1;
    const rel = String(value).trim();
    const abs = resolveInside(root, rel);
    if (abs === null) {
      missing.push(`${rel}（ルートの外を指しているか実パスを解決できない）`);
      continue;
    }
    if (!existsSync(abs)) {
      missing.push(`${rel}（実体が無い）`);
      continue;
    }
    const files = statSync(abs).isDirectory() ? listFiles(abs).map((f) => `${rel}/${f}`) : [rel];
    byKey.push({ key, rel, files });
  }
  return { declared, missing, byKey };
}

/**
 * ファイルの並びから指紋を計算する（並びは呼び出し側で固定する）。
 * 既定（`sha256-nc:`）は JS / TS 系をコメントを除いた正規形で数え、字句解析が閉じないものは生バイトで数える。
 * @param {string[]} files - root 基準の相対パス
 * @param {string} root
 * @param {boolean} legacy - 旧方式（`sha256:`・全ファイル生バイト）
 * @returns {{ fingerprint: string | null, missing: string[], unparsed: string[] }}
 */
function digestFiles(files, root, legacy) {
  /** @type {string[]} コメントを除けず生バイトで数えた JS / TS 系のファイル */
  const unparsed = [];
  const digest = createHash("sha256");
  for (const rel of files) {
    const abs = resolveInside(root, rel);
    if (abs === null)
      return {
        fingerprint: null,
        missing: [`${rel}（ルートの外を指しているか実パスを解決できない）`],
        unparsed,
      };
    if (!existsSync(abs)) return { fingerprint: null, missing: [`${rel}（実体が無い）`], unparsed };
    let fileHash = null;
    if (!legacy && JS_FAMILY_EXTENSIONS.has(extname(rel).toLowerCase())) {
      const stripped = stripJsComments(readFileSync(abs, "utf8"));
      if (stripped === null) unparsed.push(rel);
      else fileHash = createHash("sha256").update(stripped).digest("hex");
    }
    digest.update(rel);
    digest.update("\0");
    digest.update(fileHash ?? sha256File(abs));
    digest.update("\n");
  }
  const prefix = legacy ? "sha256" : "sha256-nc";
  return { fingerprint: `${prefix}:${digest.digest("hex")}`, missing: [], unparsed };
}

/**
 * Playwright の既定の testMatch（`**\/*.@(spec|test).?(c|m)[jt]s?(x)`）。suite.specs の下でこれに当たるファイルをスペックとして数える。
 * testMatch を変えたプロジェクトのスペックはこれに当たらないことがあるので、分類表（repeat_run.specs）に書いたパスもスペックとして数える。
 */
const SPEC_FILE_PATTERN = /\.(spec|test)\.[cm]?[jt]sx?$/i;

/** JS / TS 系の拡張子。suite.specs の下で命名規則に当たらないこれらのファイルは、スペックか土台かの宣言を要る。 */
const JS_TS_FILE_PATTERN = /\.[cm]?[jt]sx?$/i;

/**
 * パスを / 区切りの正規形にする（宣言の字面の揺れ〈末尾の /・./〉で同じファイルを別物として数えない）。
 * @param {string} p
 */
function normalizeRel(p) {
  return posix.normalize(p.trim().split(sep).join("/")).replace(/\/+$/, "");
}

/**
 * パス f が根 r の下（r 自身を含む）にあるか（どちらも normalizeRel 済み）。
 * @param {string} f
 * @param {string} r
 */
function underRel(f, r) {
  return f === r || f.startsWith(`${r}/`);
}

/**
 * スペック単位の指紋を計算する（Issue #473）。
 *
 * スイート全体の 1 つの指紋に 2 回の記録を結びつけると、状態を変えないスペックを 1 行変えただけで
 * 状態を変えるスペックまで現行へ 2 回回し直すことになる。2 回目が意味を持つのは状態を変えるスペックだけなので、
 * 記録はスペックごとの指紋と、スペックが共通に読む土台（shared）の指紋に結びつける。
 *
 * - スペック: suite.specs の下で SPEC_FILE_PATTERN に当たるファイルと、分類表に書いたファイル。1 ファイルずつ指紋を取る
 * - 土台（shared）: それ以外の宣言パスの全ファイル（locator_map / expectations / interactions / tools と、
 *   suite.specs の下のスペック以外——スペックが読む共通の関数・fixture）。変われば全スペックの記録が失効する
 * - 外すもの: excluded（current プロジェクトが testIgnore で走らせないディレクトリ。新側専用スペック等）の下。
 *   現行へ走らないものは現行の状態を変えられず、記録を失効させる理由にならない
 * @param {Record<string, unknown>} suiteObj
 * @param {string} root
 * @param {{ declared?: string[], sharedDeclared?: string[], excluded?: string[] }} [opts] - いずれも normalizeRel 済みの root 基準の相対パス
 * @returns {{ shared: string | null, specs: Record<string, string>, specFiles: string[], sharedFiles: number, specsTreeShared: string[], undeclared: string[], missing: string[], unparsed: string[] }}
 */
export function specFingerprints(suiteObj, root, opts = {}) {
  const declared = new Set(opts.declared ?? []);
  const sharedDeclared = new Set(opts.sharedDeclared ?? []);
  const excluded = opts.excluded ?? [];
  const listed = listSuiteFiles(suiteObj, root);
  const empty = {
    shared: null,
    specs: {},
    specFiles: [],
    sharedFiles: 0,
    specsTreeShared: [],
    undeclared: [],
    unparsed: [],
  };
  if (listed.declared === 0 || listed.missing.length > 0)
    return { ...empty, missing: listed.missing };
  /** @type {Set<string>} */
  const specFiles = new Set();
  /** @type {Set<string>} */
  const sharedFiles = new Set();
  for (const { key, files } of listed.byKey) {
    for (const raw of files) {
      const f = normalizeRel(raw);
      if (key === "specs" && excluded.some((e) => underRel(f, e))) continue;
      if (key === "specs" && (SPEC_FILE_PATTERN.test(f) || declared.has(f))) specFiles.add(f);
      else sharedFiles.add(f);
    }
  }
  // 同じファイルが specs と別のキーの両方に入る宣言（tools を specs の下に置く等）は、スペックとして数える
  for (const f of specFiles) sharedFiles.delete(f);
  // suite.specs の下で命名規則にも分類表にも当たらない JS / TS 系のファイルは、repeat_run.shared_files に宣言していなければ落とす。
  // 字面（test( の呼び出し）でスペックかどうかを推測すると、別名 import（test as it）等ですり抜け、状態を変えるスペックが
  // 2 回続けての緑を求められないまま土台に紛れる（Codex レビュー、PR #475）。推測せず宣言を求める（fail-closed）
  /** @type {string[]} */
  const specsTreeShared = [];
  /** @type {string[]} */
  const undeclared = [];
  for (const { key, files } of listed.byKey) {
    if (key !== "specs") continue;
    for (const raw of files) {
      const f = normalizeRel(raw);
      if (!sharedFiles.has(f)) continue;
      specsTreeShared.push(f);
      if (JS_TS_FILE_PATTERN.test(f) && !sharedDeclared.has(f)) undeclared.push(f);
    }
  }
  /** @type {string[]} */
  const unparsed = [];
  const shared = digestFiles([...sharedFiles].sort(), root, false);
  if (shared.fingerprint === null) return { ...empty, missing: shared.missing };
  unparsed.push(...shared.unparsed);
  /** @type {Record<string, string>} */
  const specs = {};
  const sortedSpecs = [...specFiles].sort();
  for (const f of sortedSpecs) {
    const d = digestFiles([f], root, false);
    if (d.fingerprint === null) return { ...empty, missing: d.missing };
    unparsed.push(...d.unparsed);
    specs[f] = d.fingerprint;
  }
  return {
    shared: shared.fingerprint,
    specs,
    specFiles: sortedSpecs,
    sharedFiles: sharedFiles.size,
    specsTreeShared: specsTreeShared.sort(),
    undeclared: undeclared.sort(),
    missing: [],
    unparsed,
  };
}

/**
 * 連続する 2 回の記録が、どちらも緑で、別の日時に順に始まったかを数える。
 * @param {Record<string, unknown>[]} tail - 連続する 2 回（オブジェクトであることは呼び出し側で確かめる）
 * @param {string} label - 所見の接頭辞（スペック単位の判定ではスペックのパス）
 * @returns {string[]}
 */
function pairFindings(tail, label) {
  /** @type {string[]} */
  const findings = [];
  /** @type {string[]} */
  const startedAt = [];
  for (const [i, run] of tail.entries()) {
    if (run.result !== GREEN) {
      findings.push(
        `${label}連続する 2 回のうち ${i + 1} 回目が緑でない（result: ${JSON.stringify(run.result)}）`,
      );
    }
    if (!nonEmptyString(run.started_at)) {
      findings.push(`${label}連続する 2 回のうち ${i + 1} 回目の started_at が空`);
    } else {
      startedAt.push(String(run.started_at).trim());
    }
  }
  if (startedAt.length === 2) {
    if (startedAt[0] === startedAt[1]) {
      findings.push(
        `${label}連続する 2 回の started_at が同じ（1 回の記録の写しと区別が付かない）: ${startedAt[0]}`,
      );
    } else {
      const t0 = Date.parse(startedAt[0]);
      const t1 = Date.parse(startedAt[1]);
      if (Number.isNaN(t0) || Number.isNaN(t1)) {
        findings.push(`${label}started_at が日時として読めない: ${startedAt.join(" / ")}`);
      } else if (t1 <= t0) {
        findings.push(
          `${label}2 回目の started_at が 1 回目より後になっていない: ${startedAt.join(" → ")}`,
        );
      }
    }
  }
  return findings;
}

/**
 * 分類表（repeat_run.specs）と current_excluded を読む。型崩れは UsageError、記録の不備は所見。
 * @param {Record<string, unknown>} record - suite.repeat_run
 * @param {string} root
 * @param {unknown} specsDecl - suite.specs（current_excluded はこの下に限る）
 * @returns {{ findings: string[], declared: Map<string, boolean>, sharedDeclared: Set<string>, excluded: string[] }}
 */
function readSpecClassification(record, root, specsDecl) {
  const specsRoot = nonEmptyString(specsDecl) ? normalizeRel(String(specsDecl)) : null;
  /** @type {string[]} */
  const findings = [];
  const rawExcluded = record.current_excluded ?? [];
  if (!Array.isArray(rawExcluded))
    throw new UsageError("suite.repeat_run.current_excluded が配列でない");
  /** @type {string[]} */
  const excluded = [];
  for (const [i, e] of rawExcluded.entries()) {
    if (!isPlainObject(e))
      throw new UsageError(`suite.repeat_run.current_excluded[${i}] がオブジェクトでない`);
    if (!nonEmptyString(e.path)) {
      findings.push(`current_excluded[${i}] の path が空`);
      continue;
    }
    const rel = String(e.path).trim();
    if (!nonEmptyString(e.reason)) {
      // 外したものは記録を失効させなくなる（緩和）ので、現行へ走らない根拠が無いものは外さない
      findings.push(
        `current_excluded の ${rel} に reason が無い（current プロジェクトが走らせない根拠が残らない）。外さずに数える`,
      );
      continue;
    }
    if (resolveInside(root, rel) === null) {
      findings.push(`current_excluded の ${rel} がルートの外を指しているか実パスを解決できない`);
      continue;
    }
    // 外せるのは suite.specs の下（current が走らせないスペックの置き場所）だけ。土台（locator_map 等）やその祖先を外すと、
    // 土台を変えても記録が失効しなくなる。suite.specs そのものも外せない（全スペックが判定から消える）
    const normalized = normalizeRel(rel);
    if (specsRoot === null || normalized === specsRoot || !underRel(normalized, specsRoot)) {
      findings.push(
        `current_excluded の ${rel} が suite.specs（${specsRoot ?? "未宣言"}）の下でない（外せるのは current が走らせないスペックの置き場所だけ）。外さずに数える`,
      );
      continue;
    }
    excluded.push(normalizeRel(rel));
  }
  const specs = record.specs;
  if (!Array.isArray(specs)) throw new UsageError("suite.repeat_run.specs が配列でない");
  /** @type {Map<string, boolean>} */
  const declared = new Map();
  for (const [i, e] of specs.entries()) {
    if (!isPlainObject(e))
      throw new UsageError(`suite.repeat_run.specs[${i}] がオブジェクトでない`);
    if (!nonEmptyString(e.path)) {
      findings.push(`repeat_run.specs[${i}] の path が空`);
      continue;
    }
    const rel = normalizeRel(String(e.path));
    if (typeof e.state_mutating !== "boolean")
      throw new UsageError(`suite.repeat_run.specs の ${rel} の state_mutating が真偽値でない`);
    if (!nonEmptyString(e.reason)) {
      findings.push(
        `repeat_run.specs の ${rel} に reason が無い（状態を変えるか変えないかの判断の根拠が残らない）`,
      );
    }
    if (declared.has(rel)) {
      findings.push(`repeat_run.specs に ${rel} が重複している（分類が 1 つに決まらない）`);
      continue;
    }
    declared.set(rel, e.state_mutating);
  }
  const rawShared = record.shared_files ?? [];
  if (!Array.isArray(rawShared)) throw new UsageError("suite.repeat_run.shared_files が配列でない");
  /** @type {Set<string>} */
  const sharedDeclared = new Set();
  for (const [i, e] of rawShared.entries()) {
    if (!isPlainObject(e))
      throw new UsageError(`suite.repeat_run.shared_files[${i}] がオブジェクトでない`);
    if (!nonEmptyString(e.path)) {
      findings.push(`repeat_run.shared_files[${i}] の path が空`);
      continue;
    }
    const rel = normalizeRel(String(e.path));
    // 土台と宣言すると 2 回続けての緑を求めなくなる（緩和）ので、テストを定義しない根拠が無いものは土台と認めない
    if (!nonEmptyString(e.reason)) {
      findings.push(
        `repeat_run.shared_files の ${rel} に reason が無い（テストを定義しない共通の関数だと判断した根拠が残らない）。土台と認めない`,
      );
      continue;
    }
    if (declared.has(rel)) {
      findings.push(
        `${rel} が repeat_run.specs と repeat_run.shared_files の両方にある（スペックか土台かが決まらない）`,
      );
      continue;
    }
    if (sharedDeclared.has(rel)) {
      findings.push(`repeat_run.shared_files に ${rel} が重複している`);
      continue;
    }
    sharedDeclared.add(rel);
  }
  return { findings, declared, sharedDeclared, excluded };
}

/**
 * スペック単位の反復実行を数え直す（Issue #473。repeat_run.specs を持つ成果物）。
 *
 * 状態を変えるスペックごとに、そのスペックを含む直近 2 回の記録が緑・別の日時で順に始まり、
 * どちらもそのスペックの指紋と土台（shared）の指紋が現在と一致することを求める。
 * 状態を変えないスペックは 1 回の緑（current_green）で足りる。分類されていないスペックは落とす（fail-closed）。
 * @param {Record<string, unknown>} suiteObj
 * @param {Record<string, unknown>} record - suite.repeat_run
 * @param {string} root
 * @returns {{ findings: string[], notes: string[] }}
 */
function checkRepeatRunPerSpec(suiteObj, record, root) {
  const { findings, declared, sharedDeclared, excluded } = readSpecClassification(
    record,
    root,
    suiteObj.specs,
  );
  /** @type {string[]} */
  const notes = [];
  const current = specFingerprints(suiteObj, root, {
    declared: [...declared.keys()],
    sharedDeclared: [...sharedDeclared],
    excluded,
  });
  if (current.shared === null) {
    findings.push(
      `現在のスイートの指紋を計算できない（判定不能を合格に倒さない）: ${current.missing.length > 0 ? `読めない ${current.missing.join(" / ")}` : "suite.specs / locator_map / interactions がどれも宣言されていない"}`,
    );
    return { findings, notes };
  }
  const specSet = new Set(current.specFiles);
  for (const f of current.specFiles) {
    if (!declared.has(f)) {
      findings.push(
        `repeat_run.specs で分類されていないスペック: ${f}（状態を変えるかどうかが決まらない。state_mutating と reason を書く）`,
      );
    }
  }
  for (const f of current.undeclared) {
    findings.push(
      `suite.specs の下で命名規則（*.spec.* / *.test.*）に当たらず、repeat_run.specs にも repeat_run.shared_files にも無いファイル: ${f}（スペックなら specs に、テストを定義しない共通の関数・fixture なら shared_files に理由を付けて書く）`,
    );
  }
  const treeShared = new Set(current.specsTreeShared);
  for (const f of sharedDeclared) {
    if (!treeShared.has(f)) {
      findings.push(
        `repeat_run.shared_files のファイルが suite.specs の下の土台に無い: ${f}（実体が無い・suite.specs の外・current_excluded の下のいずれか）`,
      );
    }
  }
  for (const f of declared.keys()) {
    if (!specSet.has(f)) {
      findings.push(
        `repeat_run.specs のスペックが suite.specs の下に無い: ${f}（実体が無い・suite.specs の外・current_excluded の下のいずれか）`,
      );
    }
  }
  const mutating = [...declared].filter(([f, m]) => m && specSet.has(f)).map(([f]) => f);
  if (mutating.length === 0 && [...declared.values()].every((m) => !m)) {
    findings.push(
      "suite.state_mutating: true なのに repeat_run.specs に状態を変えるスペックが 1 件も無い（状態を変えないなら suite.state_mutating: false と reason を書く）",
    );
  }

  const runs = record.runs;
  if (runs !== undefined && runs !== null && !Array.isArray(runs))
    throw new UsageError("suite.repeat_run.runs が配列でない");
  const list = Array.isArray(runs) ? runs : [];
  let withoutSpecPrints = 0;
  for (const [i, run] of list.entries()) {
    if (!isPlainObject(run))
      throw new UsageError(`suite.repeat_run.runs[${i}] がオブジェクトでない`);
    const prints = run.spec_fingerprints;
    if (prints === undefined || prints === null) {
      withoutSpecPrints += 1;
      continue;
    }
    if (!isPlainObject(prints) || !Object.values(prints).every((v) => nonEmptyString(v))) {
      throw new UsageError(
        `suite.repeat_run.runs[${i}].spec_fingerprints が「スペックのパス → 指紋」のオブジェクトでない`,
      );
    }
    // 正規化すると同じスペックになるキーが 2 つあると、どちらを読むかが挿入順で決まり、矛盾した記録が黙って通る（--fingerprint は書かない形）
    const normalizedKeys = Object.keys(prints).map((k) => normalizeRel(k));
    const dup = normalizedKeys.find((k, j) => normalizedKeys.indexOf(k) !== j);
    if (dup !== undefined) {
      throw new UsageError(
        `suite.repeat_run.runs[${i}].spec_fingerprints に同じスペック ${dup} を指すキーが複数ある`,
      );
    }
  }
  for (const spec of mutating) {
    const hits = list.filter(
      (run) =>
        isPlainObject(run.spec_fingerprints) &&
        Object.keys(run.spec_fingerprints).some((k) => normalizeRel(k) === spec),
    );
    if (hits.length < 2) {
      findings.push(
        `状態を変えるスペック ${spec} の実行記録が ${hits.length} 件（そのスペックを 2 回続けて回さないと後始末の有無が結果に現れない）`,
      );
      continue;
    }
    const tail = hits.slice(-2);
    findings.push(...pairFindings(tail, `スペック ${spec}: `));
    const recorded = tail.map((run) => {
      const prints = /** @type {Record<string, unknown>} */ (run.spec_fingerprints);
      const key = Object.keys(prints).find((k) => normalizeRel(k) === spec);
      return String(prints[/** @type {string} */ (key)]).trim();
    });
    if (recorded.some((fp) => fp !== current.specs[spec])) {
      findings.push(
        `状態を変えるスペック ${spec} の 2 回の記録は現在のスペックのものでない（記録 ${recorded.join(" / ")} ≠ 実測 ${current.specs[spec]}）。このスペックを 2 回続けて回し直す`,
      );
    }
    const shared = tail.map((run) =>
      nonEmptyString(run.shared_fingerprint) ? String(run.shared_fingerprint).trim() : null,
    );
    if (shared.some((fp) => fp === null)) {
      findings.push(
        `スペック ${spec} の記録に shared_fingerprint が無い（スペックが共通に読む土台のどの版で回したか対応づかない）`,
      );
    } else if (shared.some((fp) => fp !== current.shared)) {
      findings.push(
        `スペック ${spec} の 2 回の記録は現在の土台のものでない（shared_fingerprint ${shared.join(" / ")} ≠ 実測 ${current.shared}）。` +
          "土台（locator_map / expectations / interactions / tools・suite.specs の下のスペック以外）を変えたら、状態を変えるスペックをすべて 2 回続けて回し直す",
      );
    }
  }
  // 状態を変えないスペックは 1 回の緑で足りるが、その 1 回も現在の版に結びつける。
  // 結びつけないと、状態を変えないスペックを書き換えた（壊した）後も、状態を変えるスペックの記録だけで通る
  const readOnly = current.specFiles.filter((f) => declared.get(f) === false);
  for (const spec of readOnly) {
    const last = list
      .filter(
        (run) =>
          isPlainObject(run.spec_fingerprints) &&
          Object.keys(run.spec_fingerprints).some((k) => normalizeRel(k) === spec),
      )
      .at(-1);
    if (last === undefined) {
      findings.push(
        `状態を変えないスペック ${spec} の実行記録が 0 件（1 回の緑を現在のスペックに結びつける記録が無い）`,
      );
      continue;
    }
    const prints = /** @type {Record<string, unknown>} */ (last.spec_fingerprints);
    const key = /** @type {string} */ (Object.keys(prints).find((k) => normalizeRel(k) === spec));
    const recorded = String(prints[key]).trim();
    const shared = nonEmptyString(last.shared_fingerprint)
      ? String(last.shared_fingerprint).trim()
      : null;
    if (last.result !== GREEN) {
      findings.push(
        `状態を変えないスペック ${spec} の直近の記録が緑でない（result: ${JSON.stringify(last.result)}）`,
      );
    } else if (recorded !== current.specs[spec] || shared !== current.shared) {
      findings.push(
        `状態を変えないスペック ${spec} の直近の緑は現在のスペック・土台のものでない（spec ${recorded} / shared ${shared} ≠ 実測 ${current.specs[spec]} / ${current.shared}）。このスペックを 1 回回して記録を足す`,
      );
    }
  }
  notes.push(
    `スペック単位で判定: 状態を変えるスペック ${mutating.length} 件は 2 回続けての緑、状態を変えないスペック ${readOnly.length} 件は現在の版での 1 回の緑で足りる（土台 ${current.sharedFiles} ファイル、current_excluded ${excluded.length} 件）`,
  );
  if (withoutSpecPrints > 0) {
    notes.push(
      `spec_fingerprints を持たない実行記録 ${withoutSpecPrints} 件はスペック単位の判定に使わない`,
    );
  }
  if (current.unparsed.length > 0) {
    notes.push(
      `コメントを除けず生バイトで数えたファイル（字句解析が閉じない）: ${current.unparsed.join(" / ")}`,
    );
  }
  return { findings, notes };
}

/**
 * 状態を変えるスイートの反復実行を数え直す。
 * @param {Record<string, unknown>} metadata
 * @param {{ artifactHealthPresent: boolean, root: string }} ctx
 * @returns {{ judged: boolean, findings: string[], notes: string[] }}
 */
export function checkRepeatRun(metadata, ctx) {
  /** @type {string[]} */
  const findings = [];
  const suite = metadata.suite;
  if (suite !== undefined && suite !== null && !isPlainObject(suite))
    throw new UsageError("suite がオブジェクトでない");
  // suite をキーごと持たない成果物も「state_mutating が無い」と同じ扱いにする（型崩れに倒さない）。
  // artifact_health を宣言していれば下の分岐が未検証として落とすので、後方互換は fail-open にならない。
  const suiteObj = isPlainObject(suite) ? suite : {};
  if (!("state_mutating" in suiteObj)) {
    // 判定の根拠は artifact_health の「宣言の有無」ではなく「キーの有無」。
    // declared: false は視覚採取物を持たない成果物（api-resource 等）の免除であって旧成果物ではなく、
    // 書き込み系 API のスイートこそ 2 回続けての緑を要る側なので、ここで外さない。
    if (ctx.artifactHealthPresent) {
      findings.push(
        "artifact_health を持つ成果物なのに suite.state_mutating が無い（状態を変えるかどうかが決まらない）",
      );
      return { judged: true, findings, notes: [] };
    }
    return {
      judged: false,
      findings,
      notes: ["suite.state_mutating をキーごと持たない旧成果物のため反復実行の節を判定しない"],
    };
  }
  if (typeof suiteObj.state_mutating !== "boolean")
    throw new UsageError("suite.state_mutating が真偽値でない");

  const repeat = suiteObj.repeat_run;
  if (repeat !== undefined && repeat !== null && !isPlainObject(repeat)) {
    throw new UsageError("suite.repeat_run がオブジェクトでない");
  }
  const record = isPlainObject(repeat) ? repeat : {};

  if (!suiteObj.state_mutating) {
    if (record.specs !== undefined && record.specs !== null && !Array.isArray(record.specs))
      throw new UsageError("suite.repeat_run.specs が配列でない");
    if (
      Array.isArray(record.specs) &&
      record.specs.some((e) => isPlainObject(e) && e.state_mutating === true)
    ) {
      findings.push(
        "suite.state_mutating: false なのに repeat_run.specs に状態を変えるスペックがある（どちらの宣言が正しいか決まらない）",
      );
    }
    if (!nonEmptyString(record.reason)) {
      findings.push(
        "suite.state_mutating: false なのに repeat_run.reason が空（状態を変えないと判断した根拠が残らない）",
      );
    }
    return {
      judged: true,
      findings,
      notes: ["suite.state_mutating: false のため 2 回続けての緑は求めない"],
    };
  }

  if (record.cleanup_in_suite !== true) {
    findings.push(
      "状態を変えるスイートなのに repeat_run.cleanup_in_suite が true でない（後始末が外の道具に依存すると次の実行が壊れる）",
    );
  }
  // 分類表を持つ成果物はスペック単位で判定する（持たない成果物は従来どおりスイート全体の指紋で判定する）
  if (record.specs !== undefined && record.specs !== null) {
    const perSpec = checkRepeatRunPerSpec(suiteObj, record, ctx.root);
    findings.push(...perSpec.findings);
    return { judged: true, findings, notes: perSpec.notes };
  }
  const runs = record.runs;
  if (runs !== undefined && runs !== null && !Array.isArray(runs))
    throw new UsageError("suite.repeat_run.runs が配列でない");
  const list = Array.isArray(runs) ? runs : [];
  if (list.length < 2) {
    findings.push(
      `状態を変えるスイートの実行記録が ${list.length} 件（2 回続けて回さないと後始末の有無が結果に現れない）`,
    );
    return { judged: true, findings, notes: [] };
  }
  const tail = list.slice(-2);
  for (const [i, run] of tail.entries()) {
    if (!isPlainObject(run))
      throw new UsageError(`suite.repeat_run.runs の末尾 ${i + 1} 件目がオブジェクトでない`);
  }
  findings.push(...pairFindings(tail, ""));
  /** @type {string[]} */
  const notes = [`状態を変えるスイートの実行記録 ${list.length} 件のうち末尾 2 件を判定`];

  // 記録を「いまのスイート」に結びつける。指紋が無い旧成果物はこの軸を判定しない（理由は残す）。
  const prints = tail.map((run) => (isPlainObject(run) ? run.suite_fingerprint : undefined));
  if (prints.every((p) => p === undefined || p === null)) {
    notes.push(
      "runs[].suite_fingerprint を持たない旧成果物のため、記録が現在のスイートのものかは判定しない",
    );
  } else if (!prints.every((p) => nonEmptyString(p))) {
    findings.push(
      "連続する 2 回のうち片方だけ suite_fingerprint を持つ（どの版のスイートを回したか対応づかない）",
    );
  } else {
    const recorded = prints.map((p) => String(p).trim());
    if (recorded[0] !== recorded[1]) {
      findings.push(
        `連続する 2 回で suite_fingerprint が違う（同じスイートを 2 回続けて回していない）: ${recorded.join(" / ")}`,
      );
    } else {
      // 記録の接頭辞で照合の方式を決める。旧方式（sha256:）の記録は旧方式で数え直す
      // （新方式へ一律に切り替えると、スイートを変えていない記録まで全部取り直しになる）。
      const scheme = recorded[0].startsWith("sha256-nc:")
        ? "nc"
        : recorded[0].startsWith("sha256:")
          ? "legacy"
          : null;
      const current =
        scheme === null
          ? null
          : suiteFingerprint(suiteObj, ctx.root, { legacy: scheme === "legacy" });
      if (current === null) {
        findings.push(
          `suite_fingerprint の方式を読めない（接頭辞が sha256-nc: でも sha256: でもない）: ${recorded[0]}。--fingerprint の出力で記録し直す`,
        );
      } else if (current.fingerprint === null) {
        findings.push(
          `現在のスイートの指紋を計算できない（判定不能を合格に倒さない）: ${current.missing.length > 0 ? `読めない ${current.missing.join(" / ")}` : "suite.specs / locator_map / interactions がどれも宣言されていない"}`,
        );
      } else if (current.fingerprint !== recorded[0]) {
        findings.push(
          `記録した 2 回は現在のスイートのものでない（suite_fingerprint ${recorded[0]} ≠ 実測 ${current.fingerprint}${scheme === "legacy" ? "。旧方式 sha256: の記録なのでコメントの書き換えも差として数えた" : ""}）。スイートを変えたら 2 回続けて回し直す`,
        );
      } else {
        notes.push(
          `スイートの指紋が記録と一致（${current.files} ファイル、${scheme === "legacy" ? "旧方式 sha256: の記録なのでコメントも含めて照合" : "JS / TS 系はコメントを除いて照合"}）`,
        );
      }
      if (current !== null && current.unparsed.length > 0) {
        notes.push(
          `コメントを除けず生バイトで数えたファイル（字句解析が閉じない）: ${current.unparsed.join(" / ")}`,
        );
      }
    }
  }

  return { judged: true, findings, notes };
}

/**
 * 未測定の宣言を数え直す。
 * @param {Record<string, unknown>} metadata
 * @param {{ stage?: string }} [ctx] stage: "suite" なら blocking を落とさない（既定 "diff"）
 * @returns {{ judged: boolean, findings: string[], notes: string[], blocking: number }}
 */
export function checkUnmeasured(metadata, ctx) {
  const stage = ctx?.stage ?? "diff";
  /** @type {string[]} */
  const findings = [];
  /** @type {string[]} */
  const pending = [];
  if (!("unmeasured" in metadata)) {
    return {
      judged: false,
      findings,
      notes: ["unmeasured をキーごと持たない旧成果物のため未測定の節を判定しない"],
      blocking: 0,
    };
  }
  const decl = metadata.unmeasured;
  if (!isPlainObject(decl)) throw new UsageError("unmeasured がオブジェクトでない");
  if (typeof decl.declared !== "boolean")
    throw new UsageError("unmeasured.declared が真偽値でない");
  if (!decl.declared) {
    if (!nonEmptyString(decl.reason))
      throw new UsageError("unmeasured.declared: false なのに reason が空（免除の根拠が残らない）");
    return {
      judged: false,
      findings,
      notes: [`unmeasured.declared: false のため判定しない（理由: ${String(decl.reason).trim()}）`],
      blocking: 0,
    };
  }
  if (!Array.isArray(decl.entries)) throw new UsageError("unmeasured.entries が配列でない");

  let blocking = 0;
  const seen = new Set();
  for (const [i, entry] of decl.entries.entries()) {
    if (!isPlainObject(entry))
      throw new UsageError(`unmeasured.entries[${i}] がオブジェクトでない`);
    const item = nonEmptyString(entry.item) ? String(entry.item).trim() : null;
    if (item === null) {
      findings.push(`unmeasured.entries[${i}].item が空（照合キーが無い）`);
      blocking += 1;
      continue;
    }
    if (seen.has(item)) {
      findings.push(`未測定の項目が重複している（先勝ちにしない）: ${item}`);
      blocking += 1;
      continue;
    }
    seen.add(item);
    if (!nonEmptyString(entry.reason)) {
      findings.push(`未測定の理由が空: ${item}`);
      blocking += 1;
      continue;
    }
    const disposition = entry.disposition;
    if (!DISPOSITIONS.includes(/** @type {string} */ (disposition))) {
      findings.push(
        `未測定の disposition が語彙外（${DISPOSITIONS.join(" / ")}）のため blocking として数える: ${item}`,
      );
      blocking += 1;
      continue;
    }
    if (disposition === "accepted") {
      if (!nonEmptyString(entry.approved_by) || !nonEmptyString(entry.approved_at)) {
        findings.push(
          `accepted なのに approved_by / approved_at が空のため blocking として数える: ${item}`,
        );
        blocking += 1;
      }
      continue;
    }
    blocking += 1;
    // suite 工程では blocking は「これから測る」の記録なので落とさない（書いた本人のゲートを止めない）。
    // diff 工程では収束を止める（正本: parity-suite の references/coverage.md「未測定を機械可読にする」）。
    if (stage === "suite") pending.push(item);
    else findings.push(`未測定が残っている（disposition: blocking）: ${item}`);
  }
  const notes = [`未測定の宣言 ${decl.entries.length} 件のうち blocking ${blocking} 件`];
  if (pending.length > 0) {
    notes.push(
      `stage: suite のため blocking ${pending.length} 件は落とさない（parity-diff の収束判定が受け取る）: ${pending.join(" / ")}`,
    );
  }
  return { judged: true, findings, notes, blocking };
}

/**
 * 整数として読める値に直す（数値・数字だけの文字列を受ける）。版と反復回数の両方で使う。
 * @param {unknown} v
 * @returns {number | null}
 */
function toInteger(v) {
  if (typeof v === "number") return Number.isInteger(v) ? v : null;
  if (typeof v === "string" && /^\d+$/.test(v.trim())) return Number.parseInt(v.trim(), 10);
  return null;
}

/**
 * 記録済みの版 V より後、現在の版 C までの changes[].affects を集める。
 * 履歴が壊れている（欠番・重複・affects が配列でない）ときは null を返す——
 * 正本（golden-dataset の references/versioning.md）が「影響なしへ倒さない」と定めているため、
 * 呼び出し側はこれを陳腐化として扱う。
 * @param {unknown} changes
 * @param {number} v
 * @param {number} c
 * @returns {string[] | null}
 */
export function affectsBetween(changes, v, c) {
  if (!Array.isArray(changes)) return null;
  /** @type {Map<number, string[]>} */
  const byVersion = new Map();
  for (const change of changes) {
    if (!isPlainObject(change)) return null;
    const ver = toInteger(change.version);
    if (ver === null || ver < 1) return null;
    if (byVersion.has(ver)) return null;
    if (!Array.isArray(change.affects)) return null;
    for (const a of change.affects) if (!nonEmptyString(a)) return null;
    byVersion.set(
      ver,
      change.affects.map((a) => String(a).trim()),
    );
  }
  for (let i = 1; i <= c; i += 1) if (!byVersion.has(i)) return null;
  /** @type {string[]} */
  const out = [];
  for (let i = v + 1; i <= c; i += 1) out.push(.../** @type {string[]} */ (byVersion.get(i)));
  return [...new Set(out)];
}

/**
 * 工程が残す成果物の在否と鮮度を数え直す（--target のときだけ）。
 *
 * new.commit が両側とも SHA で食い違うときは、evidence-carry.mjs の judgeCarry で描画入力の差分から
 * 持ち越せるかを判定する（replace-metadata.json に new.render_inputs があるときだけ。無ければ従来どおり落とす）。
 * component-comparison-check.mjs の comparison-implementation-stale と同じ関数で判定し、2 つの検査器の判定を揃える。
 * @param {{ root: string, slugDir: string, target: string, newRepo?: string | null, replaceRoot?: string | null, featureMetadata?: unknown }} ctx
 * @returns {{ judged: boolean, findings: string[], notes: string[] }}
 */
export function checkStage(ctx) {
  /** @type {string[]} */
  const findings = [];
  /** @type {string[]} */
  const notes = [];
  const stageDir = join(ctx.slugDir, "new", ctx.target);
  const replacePath = join(stageDir, "replace-metadata.json");
  if (!existsSync(replacePath)) {
    return {
      judged: false,
      findings,
      notes: [`${replacePath} が無いため工程の節を判定しない（新側の工程が回っていない）`],
    };
  }
  const replaceMeta = readJson(replacePath, "replace-metadata.json");
  if (!isPlainObject(replaceMeta))
    throw new UsageError("replace-metadata.json がオブジェクトでない");
  const replaceSuite = replaceMeta.suite;
  if (replaceSuite !== undefined && replaceSuite !== null && !isPlainObject(replaceSuite)) {
    throw new UsageError("replace-metadata.json の suite がオブジェクトでない");
  }
  const newGreen = isPlainObject(replaceSuite) ? replaceSuite.new_green : undefined;
  if (newGreen !== true) {
    return {
      judged: false,
      findings,
      notes: [`suite.new_green が真でないため工程の節を判定しない（${replacePath}）`],
    };
  }

  const diffPath = join(stageDir, "diff-metadata.json");
  if (!existsSync(diffPath)) {
    findings.push(
      `suite.new_green: true なのに diff-metadata.json が無い（工程の完了が記憶に委ねられている）: ${diffPath}`,
    );
    return { judged: true, findings, notes };
  }
  const diffMeta = readJson(diffPath, "diff-metadata.json");
  if (!isPlainObject(diffMeta)) throw new UsageError("diff-metadata.json がオブジェクトでない");

  // 同じ target の diff-metadata.json が「いまの新側」に対応しているかを見る。
  // dataset_version だけを鮮度にすると、データセットを変えずに parity-replace が作り直した実装に対して、
  // 前の反復で収束した古い diff-metadata.json がそのままこのゲートを満たす（差分を採り直していないのに「済んだ」に見える）。
  // 対応づけは両成果物が既に持っている識別子で取る——新側のコミット SHA と反復回数。
  const replaceNew = isPlainObject(replaceMeta.new) ? replaceMeta.new : null;
  const diffNew = isPlainObject(diffMeta.new) ? diffMeta.new : null;

  // 環境の対応づけ。同じコミット・同じ反復は環境をまたいで一致しうるので、
  // 両成果物が記録している target 名を --target と突き合わせる
  // （別 target のディレクトリへ写しただけの成果物が、その環境で差分を採らずに通るのを塞ぐ）。
  for (const [label, value] of /** @type {[string, unknown][]} */ ([
    ["replace-metadata.json", replaceNew === null ? undefined : replaceNew.target],
    ["diff-metadata.json", diffNew === null ? undefined : diffNew.target],
  ])) {
    if (!nonEmptyString(value)) {
      notes.push(`${label} が new.target を持たないため環境の対応を判定しない（旧成果物）`);
      continue;
    }
    if (String(value).trim() !== ctx.target) {
      findings.push(
        `${label} が別の環境の成果物（new.target ${String(value).trim()} ≠ --target ${ctx.target}）: ${stageDir}`,
      );
    }
  }

  // 未コミット変更のある木では「差分を採った実装」を特定できない。
  // コミットの比較方法（一致 / none / 片側欠落）を選ぶ前に落とす——
  // none の枝へ入ると dirty の判定へ到達せず、同じ反復のまま中身だけ変わった実装が素通りする。
  if (replaceNew !== null && replaceNew.dirty === true) {
    findings.push(
      `新側の版を特定できない（replace-metadata.json の new.dirty: true。未コミット変更があるので版の同一性を確かめられない）: ${diffPath}`,
    );
  }

  const replaceCommit = replaceNew === null ? undefined : replaceNew.commit;
  const diffCommit = diffNew === null ? undefined : diffNew.commit;
  // commit が `none` センチネルで、版の対応が反復回数だけに委ねられたか。
  // 委ねた先も読めないときに合格へ倒さないための材料（下の反復回数の判定で使う）。
  let versionDelegatedToIteration = false;
  if (nonEmptyString(replaceCommit) && nonEmptyString(diffCommit)) {
    const wanted = String(replaceCommit).trim();
    const recordedCommit = String(diffCommit).trim();
    // **反復回数へ委ねるのは両側とも `${NO_COMMIT}` のときだけ**——片側だけが `none` なら
    // 記録した SHA と現在の `none`（またはその逆）は同じ版を指さないので、反復回数が
    // たまたま一致しただけで合格に倒すと、git 管理の有無が変わった新側で古い成果物が通る
    // （component-comparison-check.mjs と同じ規則。正本は references/coverage.md）。
    if (wanted === NO_COMMIT && recordedCommit === NO_COMMIT) {
      versionDelegatedToIteration = true;
      notes.push(
        `new.commit が ${NO_COMMIT}（新側リポジトリのコミットを持たない）ため版の対応は反復回数だけで判定する: ${diffPath}`,
      );
    } else if (wanted !== recordedCommit) {
      // SHA の不一致を即失効にせず、ページの描画入力の差分で持ち越せるかを見る（Issue #454）。
      // 判定の正本は evidence-carry.mjs。component-comparison-check.mjs も同じ関数で判定する。
      const carry = judgeCarry({
        recordedCommit,
        wantedCommit: wanted,
        renderInputs: replaceNew === null ? undefined : replaceNew.render_inputs,
        repo: ctx.newRepo ?? null,
        evidenceCarryPath: join(stageDir, EVIDENCE_CARRY_FILE),
        featureSlug: basename(ctx.slugDir),
        featureMetadata: ctx.featureMetadata,
        replaceRoot: ctx.replaceRoot ?? join(ctx.root, ".replace"),
      });
      if (carry.ok) {
        notes.push(...carry.notes.map((note) => `${note}: ${diffPath}`));
      } else {
        findings.push(
          `diff-metadata.json が今の新側の版に対応していない（new.commit ${recordedCommit} ≠ replace-metadata.json の ${wanted}）: ${diffPath}`,
        );
        findings.push(...carry.findings.map((f) => `証跡を持ち越せない: ${f}`));
        notes.push(...carry.notes);
      }
    }
  } else {
    notes.push(
      "new.commit を片側が持たないため新側の版の対応を判定しない（旧成果物）: 記録があれば次の実行から判定する",
    );
  }

  const loop = isPlainObject(replaceMeta.loop) ? replaceMeta.loop : null;
  const iterations = toIterationCount(loop === null ? undefined : loop.iterations);
  const recordedIteration = toIterationCount(diffMeta.iteration);
  if (iterations !== null && recordedIteration !== null) {
    if (recordedIteration !== iterations) {
      findings.push(
        `diff-metadata.json が前の反復のもの（iteration ${recordedIteration} ≠ replace-metadata.json の loop.iterations ${iterations}）: ${diffPath}`,
      );
    }
  } else if (versionDelegatedToIteration) {
    // **委譲した先が読めないことを合格に倒さない**——commit が `none` の枝は版の対応を
    // 反復回数へ委ねている。その反復回数も読めないと、実装を変えても古い成果物が
    // 版の検査を 1 つも通らずに素通りする（component-comparison-check.mjs の
    // comparison-implementation-unversionable と同じ扱いにする）。
    findings.push(
      `新側の版を対応づける指標が無い（new.commit が ${NO_COMMIT} なのに iteration: ${recordedIteration === null ? "読めない" : recordedIteration} / loop.iterations: ${iterations === null ? "読めない" : iterations}）: ${diffPath}`,
    );
  } else {
    notes.push(
      "iteration / loop.iterations を片側が持たないため反復の対応を判定しない（旧成果物）: 記録があれば次の実行から判定する",
    );
  }

  // 投入対象でない target（db を持たない／seedable の無い読み取り専用）は phase B との整合を免除できる。
  // 正本: parity-diff の references/preflight.md と assets/diff-metadata-template.json の dataset_version_exempt。
  // 免除は dataset_version: null と対で書かれるので、空の判定より先に見る（正規の記録を落とさない）。
  const exempt = diffMeta.dataset_version_exempt;
  if (exempt !== undefined && exempt !== null && typeof exempt !== "string") {
    throw new UsageError("diff-metadata.json の dataset_version_exempt が文字列でも null でもない");
  }
  if (nonEmptyString(exempt)) {
    // 免除は「dataset_version: null ＋ 理由」という閉じた対（正本の定める形）。
    // 理由が残っているだけで版の検査を飛ばすと、投入対象の target に古い免除文字列が残ったまま
    // 鮮度の判定が丸ごと外れる。対になっていなければ免除ではなく記録の不整合として落とす。
    if (diffMeta.dataset_version !== null) {
      findings.push(
        `dataset_version_exempt があるのに dataset_version が null でない（免除は null と対の記録。現在 ${JSON.stringify(diffMeta.dataset_version)}）: ${diffPath}`,
      );
    } else {
      notes.push(`dataset_version を免除して判定（理由: ${String(exempt).trim()}）: ${diffPath}`);
      notes.push(
        `工程の成果物を判定（converged: ${JSON.stringify(diffMeta.converged)} は判定に入れない）`,
      );
      return { judged: true, findings, notes };
    }
  }

  const datasetPath = join(ctx.root, ".replace", "dataset", "metadata.json");
  if (!existsSync(datasetPath)) {
    findings.push(
      `データセットの版を読めないため鮮度を判定できない（判定不能を合格に倒さない）: ${datasetPath}`,
    );
    return { judged: true, findings, notes };
  }
  const datasetMeta = readJson(datasetPath, "dataset/metadata.json");
  if (!isPlainObject(datasetMeta))
    throw new UsageError("dataset/metadata.json がオブジェクトでない");
  const current = datasetMeta.version;
  const recorded = diffMeta.dataset_version;
  if (current === undefined || current === null || String(current).trim() === "") {
    findings.push(`データセットの version が空のため鮮度を判定できない: ${datasetPath}`);
    return { judged: true, findings, notes };
  }
  if (recorded === undefined || recorded === null || String(recorded).trim() === "") {
    findings.push(
      `diff-metadata.json の dataset_version が空で dataset_version_exempt も空（古いかどうかを判定できない）: ${diffPath}`,
    );
    return { judged: true, findings, notes };
  }

  // 数値が古いだけでは陳腐化にしない。正本は golden-dataset の references/versioning.md——
  // 記録済み V・現在 C として 1 <= V <= C を確かめ、V < change.version <= C の affects が
  // slug の実効参照テーブルと交差するときだけ陳腐化する。実効参照テーブルは .replace/features.md から
  // 導くもので導出規則の正本は golden-dataset 側にあるため、ここで 2 つ目の実装を作らない。
  // ここで落とすのは、交差を見るまでもなく陳腐化が確定する形（版が読めない・区間に * がある・履歴が壊れている）だけ。
  const v = toInteger(recorded);
  const c = toInteger(current);
  if (v === null || c === null) {
    findings.push(
      `dataset_version が整数として読めない（記録 ${JSON.stringify(recorded)} / 現在 ${JSON.stringify(current)}）: ${diffPath}`,
    );
    return { judged: true, findings, notes };
  }
  if (v < 1 || v > c) {
    findings.push(
      `dataset_version の範囲が不正（記録 ${v} / 現在 ${c}。1 <= 記録 <= 現在 を満たさない）: ${diffPath}`,
    );
    return { judged: true, findings, notes };
  }
  if (v < c) {
    const affects = affectsBetween(datasetMeta.changes, v, c);
    if (affects === null) {
      findings.push(
        `dataset の changes 履歴が壊れている（欠番・重複・affects が配列でない）ため影響なしに倒さない（記録 ${v} / 現在 ${c}）: ${datasetPath}`,
      );
    } else if (affects.includes("*")) {
      findings.push(
        `記録後の変更が全機能に影響する（changes[].affects に * がある。記録 ${v} / 現在 ${c}）: ${diffPath}`,
      );
    } else {
      notes.push(
        `dataset_version は記録 ${v} / 現在 ${c}。区間の affects（${affects.join(", ") || "なし"}）と slug の実効参照テーブルの交差判定は golden-dataset の references/versioning.md が正本のためここでは数えない`,
      );
    }
  }
  // converged が偽でも落とさない——偽は「まだ直っていない」の記録であり、隠す相手ではない。
  notes.push(
    `工程の成果物を判定（converged: ${JSON.stringify(diffMeta.converged)} は判定に入れない）`,
  );
  return { judged: true, findings, notes };
}

/**
 * metadata.json のパスからリポジトリルートを導く（.replace の親）。
 * @param {string} metadataPath
 * @returns {string | null}
 */
export function deriveRoot(metadataPath) {
  const parts = resolve(metadataPath).split(sep);
  const i = parts.lastIndexOf(".replace");
  if (i <= 0) return null;
  return parts.slice(0, i).join(sep) || sep;
}

/**
 * @param {string[]} argv
 * @returns {{ metadata: string, root: string | null, target: string | null, stage: string, newRepo: string | null, replaceRoot: string | null, fingerprint: boolean }}
 */
export function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const opts = {};
  let fingerprint = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--fingerprint") {
      fingerprint = true;
      continue;
    }
    if (
      arg === "--metadata" ||
      arg === "--root" ||
      arg === "--target" ||
      arg === "--stage" ||
      arg === "--new-repo" ||
      arg === "--replace-root"
    ) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) throw new UsageError(`${arg} に値が無い`);
      opts[arg.slice(2)] = value;
      i += 1;
      continue;
    }
    throw new UsageError(
      `使い方: artifact-health-check.mjs --metadata <path> [--root <dir>] [--target <name>] [--stage diff|suite] [--new-repo <path>] [--replace-root <dir>] [--fingerprint]（不明な引数: ${arg}）`,
    );
  }
  if (!nonEmptyString(opts.metadata)) throw new UsageError("--metadata は必須");
  const stage = opts.stage ?? "diff";
  if (!STAGES.includes(stage)) {
    throw new UsageError(`--stage は ${STAGES.join(" | ")} のいずれか（渡された値: ${stage}）`);
  }
  return {
    metadata: opts.metadata,
    root: opts.root ?? null,
    target: opts.target ?? null,
    stage,
    newRepo: opts["new-repo"] !== undefined ? resolve(opts["new-repo"]) : null,
    replaceRoot: opts["replace-root"] !== undefined ? resolve(opts["replace-root"]) : null,
    fingerprint,
  };
}

/**
 * 反復実行の記録に書く指紋を出す（--fingerprint）。検査はしない。
 * spec_fingerprints は分類表と current_excluded を反映した全スペックの指紋で、runs[] にはその回に回したスペックの分だけを写す。
 * @param {Record<string, unknown>} metadata
 * @param {string} root
 * @returns {Record<string, unknown>}
 */
export function fingerprintReport(metadata, root) {
  const suite = isPlainObject(metadata.suite) ? metadata.suite : {};
  const record = isPlainObject(suite.repeat_run) ? suite.repeat_run : {};
  const whole = suiteFingerprint(suite, root);
  /** @type {string[]} */
  let declared = [];
  /** @type {string[]} */
  let sharedDeclared = [];
  /** @type {string[]} */
  let excluded = [];
  if (record.specs !== undefined && record.specs !== null) {
    const c = readSpecClassification(record, root, suite.specs);
    declared = [...c.declared.keys()];
    sharedDeclared = [...c.sharedDeclared];
    excluded = c.excluded;
  }
  const perSpec = specFingerprints(suite, root, { declared, sharedDeclared, excluded });
  const missing = [...new Set([...whole.missing, ...perSpec.missing])];
  if (whole.fingerprint === null || perSpec.shared === null) {
    throw new UsageError(
      `スイートの指紋を計算できない: ${missing.length > 0 ? missing.join(" / ") : "suite.specs / locator_map / interactions がどれも宣言されていない"}`,
    );
  }
  return {
    tool: "artifact-health-check",
    version: VERSION,
    suite_fingerprint: whole.fingerprint,
    shared_fingerprint: perSpec.shared,
    spec_fingerprints: perSpec.specs,
  };
}

/**
 * @param {string[]} argv
 * @param {{ log: (line: string) => void }} io
 * @returns {number} 終了コード
 */
export function run(argv, io) {
  const args = parseArgs(argv);
  const metadataPath = resolve(args.metadata);
  if (!existsSync(metadataPath)) throw new UsageError(`metadata.json が無い: ${metadataPath}`);
  const metadata = readJson(metadataPath, "metadata.json");
  if (!isPlainObject(metadata)) throw new UsageError("metadata.json がオブジェクトでない");

  const root = args.root !== null ? resolve(args.root) : deriveRoot(metadataPath);
  if (root === null) {
    throw new UsageError(
      `metadata.json のパスから .replace を見つけられないため --root を渡す: ${metadataPath}`,
    );
  }
  const slugDir = resolve(metadataPath, "..");

  if (args.fingerprint) {
    io.log(JSON.stringify(fingerprintReport(metadata, root), null, 2));
    return 0;
  }

  /** @type {string[]} */
  const findings = [];
  /** @type {string[]} */
  const notes = [];

  const artifacts = checkArtifacts(metadata, { root });
  findings.push(...artifacts.findings);
  notes.push(...artifacts.notes);

  const repeat = checkRepeatRun(metadata, {
    artifactHealthPresent: "artifact_health" in metadata,
    root,
  });
  findings.push(...repeat.findings);
  notes.push(...repeat.notes);

  const unmeasured = checkUnmeasured(metadata, { stage: args.stage });
  findings.push(...unmeasured.findings);
  notes.push(...unmeasured.notes);

  if (args.target !== null) {
    if (!nonEmptyString(args.target)) throw new UsageError("--target が空");
    const stage = checkStage({
      root,
      slugDir,
      target: args.target.trim(),
      newRepo: args.newRepo,
      replaceRoot: args.replaceRoot,
      featureMetadata: metadata,
    });
    findings.push(...stage.findings);
    notes.push(...stage.notes);
  } else {
    notes.push("--target が無いため工程の節を判定しない");
  }

  for (const note of notes) io.log(`note: ${note}`);
  for (const finding of findings) io.log(`warn: ${finding}`);
  if (findings.length > 0) {
    io.log(
      `error: 採取物・工程の健全性に ${findings.length} 件の未検証／不整合が残る — 収束させず直す`,
    );
    return 1;
  }
  io.log(`ok: 採取物・工程の健全性は条件を満たす（artifact-health-check ${VERSION}）`);
  return 0;
}

/** 使い方（stderr に出す。CLI エントリ判定が壊れたときのサイレント no-op を検出できるようにする）。 */
const usage = [
  "usage: artifact-health-check.mjs --metadata <path> [--root <dir>] [--target <name>] [--stage diff|suite] [--new-repo <path>] [--replace-root <dir>] [--fingerprint]",
  "  --metadata  .replace/parity/<slug>/metadata.json のパス（必須）",
  "  --root      リポジトリルート（省略時は metadata のパスの .replace の親から導く）",
  "  --target    新側 target 名。渡したときだけ工程の成果物（diff-metadata.json）の在否と鮮度を判定する",
  "  --stage     呼び出し元の工程。diff（既定・収束判定。未測定の blocking で落とす） | suite（完了判定。blocking は落とさない）",
  "  --new-repo  新側リポジトリの最上位。new.commit が食い違うとき、new.render_inputs の差分で証跡を持ち越せるかを判定する（無ければ持ち越さない）",
  "  --fingerprint  検査せず、反復実行の記録に書く指紋（suite_fingerprint / shared_fingerprint / spec_fingerprints）を JSON で出す",
  "  --replace-root  .replace ディレクトリ（省略時は <root>/.replace）。変更宣言・部品 metadata・evidence-carry.json の相対パスはその親から解決する",
  "exit: 0 = 条件を満たす（判定しない節を含む） / 1 = 未検証・不整合が残る / 2 = 使い方の誤り・型崩れ",
].join("\n");

/**
 * @param {string[]} argv
 * @returns {number} 終了コード
 */
export function main(argv) {
  try {
    return run(argv, { log: (line) => process.stdout.write(`${line}\n`) });
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
