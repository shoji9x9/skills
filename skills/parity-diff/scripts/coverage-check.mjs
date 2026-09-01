// 部品被覆表（component-coverage.json）の未測定を数え直して収束条件を判定する（正本）。
// 正本はこのスキル側にあり、実行時はスキルディレクトリ内から直接実行する
// （プロジェクトへコピーしない。gh skill update の自動更新を効かせるため）。
//
// 何をするか: 現側 metadata.json の component_coverage 宣言を読み、declared: true のときだけ
// 被覆表を開いて 機能表の項目 × 部品インスタンス の期待セルを列挙し、未測定を数える。
// 宣言された件数は参照せず必ず数え直す（宣言値を信用すると、被覆表を直さずに件数だけ 0 と書けてしまう）。
//
// 何をしないか: 被覆表の作成（parity-suite の仕事）・差分の検出や分類（diff-normalize / triage の仕事）は行わない。
//
// 後方互換: component_coverage を持たない旧成果物と declared: false は判定に入れない（judged: false）。
// ただし黙って合格にしない——判定しなかった理由を出力に残し、利用側は diff-metadata.json の
// component_coverage と diff.md の未検証領域へ転記する。
//
// fail-closed: 未測定は「value: unmeasured」だけではない。行が無い組み合わせ・evidence の空・
// present なのに covered_by が空・同じ組み合わせの重複行も未測定として数える
// （「測っていない」と「測ったが証拠が無い」を同じ空欄で通さない。重複は黙って先勝ちにしない）。
// 列挙側（部品・項目・インスタンス）の id が空／重複している場合も同じ——空 id は全要素が同じキーへ
// 潰れて 1 行で全セルを満たせてしまい、重複 id は期待セルを二重に数えるため、展開に使わず未測定として数える。
// declared: true なのに被覆表が読めない場合も合格に倒さない。
//
// 決定論的: 乱数・現在時刻に依存しない。入力順を保って数える。
// TypeScript 構文は使わない（型は JSDoc）。

import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * ツールのバージョン（正本）。判定ロジック・出力形状を変えたら上げる。
 * diff-metadata.json の differ_versions.coverage_check に記録する値はこれを使う（手入力にしない）。
 * @type {string}
 */
export const VERSION = "1";

/** 被覆表のセルが取りうる値。 */
const VALUES = ["present", "absent", "unmeasured"];

/**
 * 空でない文字列か。
 * @param {unknown} v
 * @returns {boolean}
 */
function nonEmptyString(v) {
  return typeof v === "string" && v.trim() !== "";
}

/**
 * 現側 metadata.json の component_coverage 宣言を読む。返す状態は 3 つ:
 * judged: true（判定に入れる）／judged: false（後方互換で判定に入れない。キー欠落 = 旧成果物、declared: false）／
 * malformed: true（型崩れ。後方互換に倒さず使い方の誤りとして扱う）。
 * **型崩れを「旧成果物」に倒さない**——倒すと metadata.json が配列や壊れた形のときに judged: false → exit 0 で
 * 収束条件を素通りできる（後方互換の経路が fail-open の抜け道になる）。
 * @param {unknown} metadata
 * @returns {{judged: boolean, malformed: boolean, reason: string|null, path: string|null}}
 */
export function readDeclaration(metadata) {
  const bad = (reason) => ({ judged: false, malformed: true, reason, path: null });
  const skip = (reason) => ({ judged: false, malformed: false, reason, path: null });
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return bad("metadata.json が JSON オブジェクトではない（型崩れ）");
  }
  const decl = /** @type {Record<string, unknown>} */ (metadata).component_coverage;
  if (decl === undefined || decl === null) {
    return skip("旧成果物: metadata.json に component_coverage キーが無い（判定に入れない）");
  }
  if (typeof decl !== "object" || Array.isArray(decl)) {
    return bad("component_coverage が JSON オブジェクトではない（型崩れ）");
  }
  const d = /** @type {Record<string, unknown>} */ (decl);
  if (d.declared === false) {
    // 免除経路は理由の記録とセットでだけ成立する。理由が無い declared: false を通すと、
    // 「測らなかった事実」がどの成果物にも残らないまま収束条件を外せる（緩和経路の抜け道）。
    if (!nonEmptyString(d.reason)) {
      return bad("component_coverage.declared: false なのに reason が空（免除の根拠が残らない）");
    }
    return skip(`declared: false（${String(d.reason)}）`);
  }
  if (d.declared !== true) {
    return bad("component_coverage.declared が真偽値ではない（型崩れ）");
  }
  if (d.path !== undefined && d.path !== null && !nonEmptyString(d.path)) {
    return bad("component_coverage.path が空でない文字列ではない（型崩れ）");
  }
  return {
    judged: true,
    malformed: false,
    reason: null,
    path: nonEmptyString(d.path) ? String(d.path) : null,
  };
}

/**
 * 部品・項目・インスタンスの id 列を取り出す。空 id と重複 id は展開に使わず問題として記録する
 * （id が空だと全要素が同じキーへ潰れ、1 行で全セルを満たせてしまう。重複は期待セルを二重に数える）。
 * @param {unknown[]} entries
 * @param {string} label - 問題文に出す位置（例: 部品 grid の items）
 * @param {string[]} problems - 問題の追記先
 * @returns {{ids: string[], rejected: number}} rejected は展開に使えなかった要素数（未測定として数える）
 */
function collectIds(entries, label, problems) {
  /** @type {string[]} */
  const ids = [];
  /** @type {Set<string>} */
  const seen = new Set();
  let rejected = 0;
  entries.forEach((entry, index) => {
    const raw =
      entry && typeof entry === "object" && !Array.isArray(entry)
        ? /** @type {Record<string, unknown>} */ (entry).id
        : undefined;
    if (!nonEmptyString(raw)) {
      problems.push(`${label}[${index}]: id が空（識別できないので未測定として数える）`);
      rejected += 1;
      return;
    }
    const id = String(raw);
    if (seen.has(id)) {
      problems.push(`${label}[${index}]: id ${id} が重複している（先勝ちにしない）`);
      rejected += 1;
      return;
    }
    seen.add(id);
    ids.push(id);
  });
  return { ids, rejected };
}

/**
 * 被覆表を数え直す。宣言された件数（metadata.json 側の cells / unmeasured）は参照しない。
 * @param {unknown} coverage - component-coverage.json をパースしたもの
 * @param {string|null} slug - 突き合わせる slug（metadata.json の slug）。null なら照合しない
 * @returns {{cells: number, present: number, absent: number, unmeasured: number, problems: string[]}}
 */
export function countCoverage(coverage, slug) {
  /** @type {string[]} */
  const problems = [];
  // 配列は typeof で "object" を通るため明示的に弾く。通すと slug 不一致・components 空といった
  // 別の問題文にすり替わり、原因の切り分けを誤らせる（JSON オブジェクト判定はこのファイル内で同じ形に揃える）。
  if (!coverage || typeof coverage !== "object" || Array.isArray(coverage)) {
    return {
      cells: 0,
      present: 0,
      absent: 0,
      unmeasured: 1,
      problems: ["被覆表が JSON オブジェクトではない"],
    };
  }
  const cov = /** @type {Record<string, unknown>} */ (coverage);
  if (slug !== null && cov.slug !== slug) {
    problems.push(`被覆表の slug（${String(cov.slug)}）が metadata.json の slug（${slug}）と違う`);
  }
  const components = Array.isArray(cov.components) ? cov.components : [];
  if (components.length === 0) {
    problems.push("components が空（declared: true なら 1 つ以上の部品が要る）");
  }

  // セル行を 部品／項目／インスタンス で索引する。重複は先勝ちにせず記録する。
  // キーは JSON 配列にして区切り文字を含む id でも衝突しないようにする。
  const rows = Array.isArray(cov.cells) ? cov.cells : [];
  /** @type {Map<string, Record<string, unknown>>} */
  const byKey = new Map();
  /** @type {Set<string>} */
  const duplicated = new Set();
  const keyOf = (c, i, n) => JSON.stringify([c, i, n]);
  rows.forEach((row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      problems.push(`cells[${index}]: JSON オブジェクトでない要素がある`);
      return;
    }
    const r = /** @type {Record<string, unknown>} */ (row);
    if (!nonEmptyString(r.component) || !nonEmptyString(r.item) || !nonEmptyString(r.instance)) {
      // どのセルの行か決まらない行は索引に入れない（空欄が全セルに効く事故を防ぐ）。
      problems.push(`cells[${index}]: component / item / instance のいずれかが空`);
      return;
    }
    const key = keyOf(String(r.component), String(r.item), String(r.instance));
    if (byKey.has(key)) duplicated.add(key);
    else byKey.set(key, r);
  });

  let cells = 0;
  let present = 0;
  let absent = 0;
  let unmeasured = 0;
  /** @type {Set<string>} */
  const expected = new Set();

  /** @type {Set<string>} */
  const seenComponents = new Set();

  for (const [componentIndex, component] of components.entries()) {
    const c = /** @type {Record<string, unknown>} */ (component || {});
    const items = Array.isArray(c.items) ? c.items : [];
    const instances = Array.isArray(c.instances) ? c.instances : [];
    // 期待セル数は部品を識別できるかに依らず「項目数 × インスタンス数」で数える。部品側の id が
    // 空・重複でもセルは実在するので、1 セルに丸めるとレポート値が定義より小さく出る（列挙が
    // 空のときだけ 0 に落ちてしまうため、fail-closed の下限として 1 を取る）。
    const declaredCells = Math.max(items.length * instances.length, 1);
    if (!nonEmptyString(c.id)) {
      problems.push(`components[${componentIndex}]: id が空（識別できないので未測定として数える）`);
      cells += declaredCells;
      unmeasured += declaredCells;
      continue;
    }
    const cid = String(c.id);
    if (seenComponents.has(cid)) {
      problems.push(`components[${componentIndex}]: id ${cid} が重複している（先勝ちにしない）`);
      cells += declaredCells;
      unmeasured += declaredCells;
      continue;
    }
    seenComponents.add(cid);
    if (items.length === 0 || instances.length === 0) {
      // 空の列挙は期待セル 0 ＝ 未測定 0 に化けるので、fail-closed で 1 件の未測定として数える。
      problems.push(`部品 ${cid}: items または instances が空（列挙が起きていない）`);
      cells += 1;
      unmeasured += 1;
      continue;
    }
    const { ids: itemIds, rejected: itemRejected } = collectIds(
      items,
      `部品 ${cid} の items`,
      problems,
    );
    const { ids: instanceIds, rejected: instanceRejected } = collectIds(
      instances,
      `部品 ${cid} の instances`,
      problems,
    );
    // 期待セル数は定義どおり「項目数 × インスタンス数」で数える。id が空・重複の要素も項目／インスタンスとしては
    // 実在するので、その要素が関わるセルは全て期待セルであり、識別できない以上すべて未測定になる
    // （rejected を 1 セルとして数えると、件数が定義より小さく出て収束レポートが過小になる）。
    const itemTotal = itemIds.length + itemRejected;
    const instanceTotal = instanceIds.length + instanceRejected;
    cells += itemTotal * instanceTotal;
    unmeasured += itemTotal * instanceTotal - itemIds.length * instanceIds.length;
    for (const iid of itemIds) {
      for (const nid of instanceIds) {
        const key = keyOf(cid, iid, nid);
        expected.add(key);
        if (duplicated.has(key)) {
          problems.push(`セル ${key}: 同じ組み合わせの行が複数ある（先勝ちにしない）`);
          unmeasured += 1;
          continue;
        }
        const row = byKey.get(key);
        if (!row) {
          unmeasured += 1;
          continue;
        }
        const value = row.value;
        if (typeof value !== "string" || !VALUES.includes(value)) {
          problems.push(`セル ${key}: value が ${VALUES.join(" / ")} のいずれでもない`);
          unmeasured += 1;
          continue;
        }
        if (value === "unmeasured") {
          unmeasured += 1;
          continue;
        }
        if (!nonEmptyString(row.evidence)) {
          problems.push(`セル ${key}: value: ${value} なのに evidence が空`);
          unmeasured += 1;
          continue;
        }
        if (value === "present") {
          const coveredBy = Array.isArray(row.covered_by) ? row.covered_by : [];
          if (coveredBy.filter(nonEmptyString).length === 0) {
            problems.push(
              `セル ${key}: value: present なのに covered_by が空（採取状態・assertion に落ちていない）`,
            );
            unmeasured += 1;
            continue;
          }
          present += 1;
          continue;
        }
        absent += 1;
      }
    }
  }

  for (const key of byKey.keys()) {
    if (!expected.has(key)) {
      problems.push(`セル ${key}: components に無い 部品／項目／インスタンス を参照している`);
    }
  }

  return { cells, present, absent, unmeasured, problems };
}

/**
 * CLI 本体。
 * `node coverage-check.mjs --metadata <.replace/parity/<slug>/metadata.json> [--coverage <path>]`
 * 判定結果を JSON で標準出力へ、問題を stderr へ出す。
 * 終了コード: 0 ＝ 収束条件を満たす（判定しない場合を含む）／1 ＝ 未測定・不整合が残る／2 ＝ 使い方の誤り。
 * @param {string[]} argv - process.argv.slice(2)
 * @param {{readFile?: (p: string) => string}} [deps]
 * @returns {number}
 */
export function main(argv, deps = {}) {
  const readFile = deps.readFile ?? ((p) => readFileSync(p, "utf8"));
  const usage =
    "usage: node coverage-check.mjs --metadata <metadata.json> [--coverage <component-coverage.json>]\n";
  /** @type {Record<string, string>} */
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--metadata" || a === "--coverage") {
      const v = argv[i + 1];
      if (v === undefined) {
        process.stderr.write(usage);
        return 2;
      }
      if (opts[a.slice(2)] !== undefined) {
        // 同じフラグの重複指定を黙って後勝ちにしない（どちらを読んだか出力から分からなくなる）。
        process.stderr.write(`error: ${a} が複数回指定されている\n${usage}`);
        return 2;
      }
      opts[a.slice(2)] = v;
      i += 1;
      continue;
    }
    process.stderr.write(`unknown argument: ${a}\n${usage}`);
    return 2;
  }
  if (!opts.metadata) {
    process.stderr.write(usage);
    return 2;
  }

  /** @type {unknown} */
  let metadata;
  try {
    metadata = JSON.parse(readFile(opts.metadata));
  } catch (e) {
    process.stderr.write(`error: metadata.json を読めない: ${opts.metadata}: ${String(e)}\n`);
    return 2;
  }
  const slug =
    metadata &&
    typeof metadata === "object" &&
    !Array.isArray(metadata) &&
    nonEmptyString(/** @type {Record<string, unknown>} */ (metadata).slug)
      ? String(/** @type {Record<string, unknown>} */ (metadata).slug)
      : null;

  const decl = readDeclaration(metadata);
  if (decl.malformed) {
    // 型崩れは後方互換（judged: false → exit 0）に倒さず、使い方の誤りとして落とす。
    process.stdout.write(
      `${JSON.stringify({ tool: "coverage-check", version: VERSION, judged: false, malformed: true, reason: decl.reason, source: null, cells: 0, unmeasured: null }, null, 2)}\n`,
    );
    process.stderr.write(`error: ${decl.reason} — 旧成果物として扱わない（${opts.metadata}）\n`);
    return 2;
  }
  if (!decl.judged) {
    // 判定に入れないことを出力に残す（黙って合格にしない）。
    process.stdout.write(
      `${JSON.stringify({ tool: "coverage-check", version: VERSION, judged: false, reason: decl.reason, source: null, cells: 0, unmeasured: 0 }, null, 2)}\n`,
    );
    process.stderr.write(
      `note: 被覆表を判定に入れない（${decl.reason}）。diff-metadata.json と diff.md の未検証領域へ残す\n`,
    );
    if (opts.coverage) {
      // 明示的に渡された被覆表を黙って読み飛ばさない（サイレント no-op にしない）。
      process.stderr.write(
        `note: --coverage ${opts.coverage} は読んでいない（宣言が無い／declared: false のため）。判定に入れるなら現側 metadata.json に component_coverage.declared: true を書くのは parity-suite の仕事\n`,
      );
    }
    return 0;
  }

  const source = opts.coverage ?? decl.path;
  if (!source) {
    // declared: true なら判定した記録を必ず残す（他の経路と同じ形で出力する）。
    const problem =
      "declared: true なのに component_coverage.path が無く --coverage も渡されていない";
    process.stdout.write(
      `${JSON.stringify({ tool: "coverage-check", version: VERSION, judged: true, reason: null, source: null, cells: 0, unmeasured: null, problems: [problem] }, null, 2)}\n`,
    );
    process.stderr.write(`error: ${problem}\n`);
    return 1;
  }
  /** @type {unknown} */
  let coverage;
  try {
    coverage = JSON.parse(readFile(source));
  } catch (e) {
    // declared: true なのに読めないときは合格に倒さない。
    process.stdout.write(
      `${JSON.stringify({ tool: "coverage-check", version: VERSION, judged: true, reason: null, source, cells: 0, unmeasured: null, problems: [`被覆表を読めない: ${String(e)}`] }, null, 2)}\n`,
    );
    process.stderr.write(`error: 被覆表を読めない: ${source}: ${String(e)}\n`);
    return 1;
  }

  const counted = countCoverage(coverage, slug);
  const ok = counted.unmeasured === 0 && counted.problems.length === 0;
  process.stdout.write(
    `${JSON.stringify({ tool: "coverage-check", version: VERSION, judged: true, reason: null, source, ...counted }, null, 2)}\n`,
  );
  for (const p of counted.problems) process.stderr.write(`warn: ${p}\n`);
  // exit 1 の理由は必ず error 行として出す。problems はあるが未測定 0（components が空など）のとき
  // warn だけだと、終了コードが 1 になった理由が利用者から読めない。
  if (counted.unmeasured > 0) {
    process.stderr.write(
      `error: 未測定 ${counted.unmeasured} / 期待セル ${counted.cells} — 収束させず parity-suite へ戻す\n`,
    );
  }
  if (counted.problems.length > 0) {
    process.stderr.write(
      `error: 被覆表の不整合 ${counted.problems.length} 件（上の warn を参照）— 収束させず parity-suite へ戻す\n`,
    );
  }
  return ok ? 0 : 1;
}

// CLI エントリ判定は両辺を実パスに解決してから突き合わせる。
// process.argv[1] は起動時のパスのまま、import.meta.url も --preserve-symlinks(-main)
// （NODE_OPTIONS 経由でも付く）では未解決のままなので、片側だけ解決すると
// シンボリックリンク経由（.claude/skills/<name> → .agents/skills/<name>）の起動で条件が偽になり、
// main() が呼ばれず何も出力せず exit 0 になる（サイレント no-op）。
const invokedAsCli = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  const self = fileURLToPath(import.meta.url);
  try {
    return realpathSync(entry) === realpathSync(self);
  } catch {
    // 実パス解決に失敗したら生パスで突き合わせる（サイレント no-op より誤検出を選ぶ）。
    return entry === self;
  }
})();

if (invokedAsCli) {
  process.exit(main(process.argv.slice(2)));
}
