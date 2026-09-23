#!/usr/bin/env node
// 部品の「操作の結果」を現行とカタログで突き合わせる検査（正本）。Issue #446。
//
// 何のためか: 部品の照合（画素・特性・当たっている CSS 規則）が見るのは「その状態に置いたときの見た目」だけで、
// **操作した結果が現行と同じか**はどの工程も見ていない。隅のアイコンを押すと列ピッカーではなく全選択になる、
// 全選択の後に 1 行外しても見出しのチェックが残る、書き出しで落ちる——どれも状態ごとの見た目は基準と一致したまま、
// 部品の完了判定（未説明差分ゼロ）を通った（Issue #446 のコメントの実例）。機能単位の parity-suite はページが
// できてから動くので、部品を先に作る進め方では画面の実装まで誰も突き合わせない。
//
// そこで capture が現行で操作した結果（`baseline/<instance>/behaviors.json`）と、build がカタログの見本で
// 同じ操作をした結果（`new/<target>/behavior-comparison.json`）を、**操作 × インスタンス**の組み合わせごとに比べる。
// 比べるのは観測した状態の値（選択範囲・チェック・行の並び・開いた要素・書き出したファイルの有無・例外の件数など）で、
// 画素は比べない。
//
// fail-closed の方針:
//   - 観測項目は操作ごとに `capture.operations[].observe` で固定し、**両側ともちょうどその集合を要求する**。
//     観測を空にした記録同士は `{}` と `{}` で一致してしまうので、項目の欠落・余分は不一致ではなく記録の不備として落とす
//   - 到達できない操作（禁止された書き込みで作る結果等）は `instances[].unreachable_operations` の宣言だけが除外の根拠。
//     宣言の無い欠落は採り忘れと区別できないので未採取として落とす
//   - 突き合わせ表が無い・読めないのは「まだ突き合わせていない」と区別できないので、全組み合わせを未突合として数える
//   - 母集合に無い組み合わせの行（基準の無い突き合わせ）も落とす。照合されない記録が合格の証拠に見えるため
//   - 比べないことを選ぶ・差を残すことを選ぶには利用者の承認（`disposition: accepted` ＋ 理由・承認者・承認日時）が要る
//   - 比べる組み合わせが 0 件なら合格にしない（`capture.operations_none_reason` で操作の無い部品と宣言した場合だけ判定しない）
//
// 鮮度（記録の後に実装を変えたか）はこの検査では見ない。build の照合は commit 前の作業ツリーに対して行うため、
// commit SHA で版を特定できない（見た目の照合も同じ性質を持つ）。実装を変えたら取り直すことは手順側の規律である。
//
// 決定論的: 乱数・現在時刻・ネットワークに依存しない。読むのは JSON だけで、ブラウザは駆動しない。
//
// 使い方: node behavior-compare.mjs --baseline <部品の成果物ディレクトリ> --comparison <突き合わせ表> --target <new target 名>
// 終了コード: 0 ＝ 条件を満たす（判定しない場合を含む）、1 ＝ 未突合・不一致・記録の不備が残る、2 ＝ 使い方の誤り・型崩れ。

import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** ツールのバージョン（正本）。判定規則・出力形状を変えたら上げる。 */
export const VERSION = "1";

/** 突き合わせ表の行が取れる扱いの語彙（正本）。null は「比べた」。 */
export const DISPOSITIONS = ["accepted"];

/**
 * 空でない文字列か。
 * @param {unknown} value
 * @returns {boolean}
 */
function nonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * 操作 × インスタンスの鍵。区切り文字を持つ連結にせず JSON の配列にする
 * （`("a|b","c")` と `("a","b|c")` が同じ鍵に潰れない）。
 * @param {string} operation
 * @param {string} instance
 * @returns {string}
 */
export function cellKey(operation, instance) {
  return JSON.stringify([operation, instance]);
}

/**
 * キーを整列した正規形の JSON。オブジェクトのキー順だけが違う観測値を不一致にしない。
 * 配列は順序ごと比べる（行の並び・選択範囲の順は観測の内容そのもの）。
 * @param {unknown} value
 * @returns {string}
 */
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  }
  // undefined は JSON に現れないので、ここへ来るのは JSON 由来の値だけ。
  return JSON.stringify(value);
}

/**
 * 観測値のキーが期待集合とちょうど一致するか。一致しなければ欠落と余分を返す。
 * @param {unknown} observed
 * @param {string[]} expected
 * @returns {{ ok: boolean, missing: string[], extra: string[] }}
 */
function observationShape(observed, expected) {
  if (observed === null || typeof observed !== "object" || Array.isArray(observed)) {
    return { ok: false, missing: [...expected], extra: [] };
  }
  const keys = Object.keys(observed);
  const missing = expected.filter((k) => !Object.prototype.hasOwnProperty.call(observed, k));
  const extra = keys.filter((k) => !expected.includes(k));
  return { ok: missing.length === 0 && extra.length === 0, missing, extra };
}

/**
 * 操作の結果を突き合わせる（純関数）。
 *
 * @param {{
 *   metadata: any,
 *   behaviors: Record<string, any>,
 *   comparison: any,
 *   target: string,
 * }} input
 *   - metadata: capture の `metadata.json`
 *   - behaviors: インスタンス id → `baseline/<id>/behaviors.json` の中身（読めなければ null）
 *   - comparison: `new/<target>/behavior-comparison.json` の中身（読めなければ null）
 *   - target: 判定対象の new target 名
 * @returns {{ structural: boolean, judged: boolean, findings: object[], counts: Record<string, number> }}
 */
export function compareBehaviors({ metadata, behaviors, comparison, target }) {
  /** @type {object[]} */
  const findings = [];
  const counts = {
    cells: 0,
    not_compared: 0,
    matched: 0,
    mismatched: 0,
    uncompared: 0,
    accepted: 0,
  };
  const structural = (detail) => ({
    structural: true,
    judged: false,
    findings: [{ code: "structural", detail }],
    counts,
  });

  const capture = metadata && metadata.capture;
  const operations = capture && capture.operations;
  if (!Array.isArray(operations)) {
    return structural("metadata.json の capture.operations が配列でない（操作の列挙が無い）");
  }
  if (operations.length === 0) {
    // 操作を持たない部品（静的なラベル等）だけが判定しないで通れる。理由の無い 0 件は採り忘れと区別できない。
    if (nonEmptyString(capture.operations_none_reason)) {
      return { structural: false, judged: false, findings: [], counts };
    }
    return structural(
      "capture.operations が空で capture.operations_none_reason も無い（操作が無いのか採っていないのか区別できない）",
    );
  }
  /** @type {Map<string, string[]>} */
  const observeOf = new Map();
  for (const op of operations) {
    const id = op && op.id;
    if (!nonEmptyString(id)) return structural("capture.operations[].id が空");
    if (observeOf.has(id)) return structural(`capture.operations[].id が重複: ${id}`);
    const observe = op.observe;
    if (
      !Array.isArray(observe) ||
      observe.length === 0 ||
      !observe.every(nonEmptyString) ||
      new Set(observe).size !== observe.length
    ) {
      return structural(
        `capture.operations[${JSON.stringify(id)}].observe が空・重複・非文字列（観測項目を固定しないと空の観測同士が一致する）`,
      );
    }
    observeOf.set(id, observe);
  }
  const instances = metadata.instances;
  if (!Array.isArray(instances) || instances.length === 0) {
    return structural("metadata.json の instances が空");
  }
  const instanceIds = [];
  for (const inst of instances) {
    const id = inst && inst.id;
    if (!nonEmptyString(id)) return structural("instances[].id が空");
    if (instanceIds.includes(id)) return structural(`instances[].id が重複: ${id}`);
    instanceIds.push(id);
  }
  if (!nonEmptyString(target)) return structural("--target が空");
  // 部品の照合を省ける形にしない——slug が無いと、別の部品の突き合わせ表がそのまま通る。
  if (!nonEmptyString(metadata.slug)) return structural("metadata.json の slug が空");

  // 母集合: 操作 × インスタンスから、宣言済みの到達できない操作を除いたもの。
  /** @type {Map<string, { operation: string, instance: string }>} */
  const population = new Map();
  /** @type {Set<string>} */
  const unreachable = new Set();
  for (const inst of instances) {
    const declared = Array.isArray(inst.unreachable_operations) ? inst.unreachable_operations : [];
    if (inst.unreachable_operations !== undefined && !Array.isArray(inst.unreachable_operations)) {
      findings.push({
        code: "unreachable-declaration-invalid",
        instance: inst.id,
        detail: "unreachable_operations が配列でない",
      });
    }
    for (const u of declared) {
      const op = u && u.operation;
      if (!nonEmptyString(op) || !observeOf.has(op)) {
        findings.push({
          code: "unreachable-declaration-invalid",
          instance: inst.id,
          operation: op ?? null,
          detail: "列挙に無い操作を到達できないと宣言している",
        });
        continue;
      }
      if (!nonEmptyString(u.reason)) {
        // 理由の無い宣言は除外にしない（採り忘れを除外に化けさせない）。母集合に残す。
        findings.push({
          code: "unreachable-declaration-invalid",
          instance: inst.id,
          operation: op,
          detail: "到達できない理由が無い（除外として扱わない）",
        });
        continue;
      }
      unreachable.add(cellKey(op, inst.id));
    }
    for (const op of observeOf.keys()) {
      const key = cellKey(op, inst.id);
      if (unreachable.has(key)) {
        counts.not_compared += 1;
        continue;
      }
      population.set(key, { operation: op, instance: inst.id });
    }
  }
  counts.cells = population.size;

  // 現行側の採取結果。
  /** @type {Map<string, unknown>} */
  const baseline = new Map();
  for (const id of instanceIds) {
    const doc = behaviors[id];
    if (doc === null || doc === undefined) continue; // 欠落は下の未採取で数える
    if (doc.instance !== id) {
      findings.push({
        code: "behavior-baseline-instance-mismatch",
        instance: id,
        detail: `behaviors.json の instance が ${JSON.stringify(doc.instance)}`,
      });
      continue;
    }
    const results = Array.isArray(doc.results) ? doc.results : [];
    for (const r of results) {
      const op = r && r.operation;
      const key = nonEmptyString(op) ? cellKey(op, id) : null;
      if (key === null || !population.has(key)) {
        findings.push({
          code: "behavior-baseline-unknown",
          instance: id,
          operation: op ?? null,
          detail: unreachable.has(key)
            ? "到達できないと宣言した操作に結果がある"
            : "列挙に無い操作の結果",
        });
        continue;
      }
      if (baseline.has(key)) {
        findings.push({ code: "behavior-baseline-duplicate", instance: id, operation: op });
        continue;
      }
      const shape = observationShape(r.observed, observeOf.get(op));
      if (!shape.ok) {
        findings.push({
          code: "behavior-baseline-incomplete",
          instance: id,
          operation: op,
          missing: shape.missing,
          extra: shape.extra,
        });
        // 不備のある基準は比較の相手にしない（未採取として扱う）。
        baseline.set(key, undefined);
        continue;
      }
      baseline.set(key, r.observed);
    }
  }
  for (const [key, cell] of population) {
    if (!baseline.has(key)) {
      findings.push({
        code: "behavior-baseline-missing",
        instance: cell.instance,
        operation: cell.operation,
        detail:
          "現行での操作の結果が無い（到達できないなら unreachable_operations に理由付きで宣言する）",
      });
    }
  }

  // 新側（カタログ）の突き合わせ。
  if (comparison === null || comparison === undefined) {
    findings.push({
      code: "comparison-missing",
      detail: "突き合わせ表が無い・読めない（全組み合わせを未突合として数える）",
    });
    counts.uncompared = population.size;
    return { structural: false, judged: true, findings, counts };
  }
  if (comparison.target !== target) {
    findings.push({
      code: "comparison-target-mismatch",
      detail: `突き合わせ表の target が ${JSON.stringify(comparison.target)}（判定対象は ${JSON.stringify(target)}）`,
    });
  }
  if (comparison.component !== metadata.slug) {
    findings.push({
      code: "comparison-component-mismatch",
      detail: `突き合わせ表の component が ${JSON.stringify(comparison.component)}（採取は ${JSON.stringify(metadata.slug)}）`,
    });
  }
  const rows = Array.isArray(comparison.rows) ? comparison.rows : [];
  if (!Array.isArray(comparison.rows)) {
    findings.push({ code: "comparison-rows-invalid", detail: "rows が配列でない" });
  }
  /** @type {Set<string>} */
  const seen = new Set();
  for (const row of rows) {
    const op = row && row.operation;
    const inst = row && row.instance;
    const key = nonEmptyString(op) && nonEmptyString(inst) ? cellKey(op, inst) : null;
    if (key === null || !population.has(key)) {
      findings.push({
        code: "behavior-unbaselined",
        operation: op ?? null,
        instance: inst ?? null,
        detail: "母集合に無い組み合わせの突き合わせ（照合相手の基準が無い）",
      });
      continue;
    }
    if (seen.has(key)) {
      findings.push({ code: "behavior-duplicate-row", operation: op, instance: inst });
      continue;
    }
    seen.add(key);
    const disposition = row.disposition ?? null;
    if (disposition !== null) {
      if (!DISPOSITIONS.includes(disposition)) {
        findings.push({
          code: "behavior-disposition-invalid",
          operation: op,
          instance: inst,
          detail: `disposition は null か ${DISPOSITIONS.join(" / ")}: ${JSON.stringify(disposition)}`,
        });
        counts.uncompared += 1;
        continue;
      }
      if (
        !nonEmptyString(row.reason) ||
        !nonEmptyString(row.approved_by) ||
        !nonEmptyString(row.approved_at)
      ) {
        findings.push({
          code: "behavior-acceptance-unapproved",
          operation: op,
          instance: inst,
          detail: "accepted には reason / approved_by / approved_at が要る",
        });
        counts.uncompared += 1;
        continue;
      }
      counts.accepted += 1;
      continue;
    }
    const shape = observationShape(row.observed, observeOf.get(op));
    if (!shape.ok) {
      findings.push({
        code: "behavior-observation-incomplete",
        operation: op,
        instance: inst,
        missing: shape.missing,
        extra: shape.extra,
      });
      counts.uncompared += 1;
      continue;
    }
    const expected = baseline.get(key);
    if (expected === undefined) {
      // 基準が無い・不備（上で finding 済み）。比べる相手が無いので一致とも不一致とも言わない。
      counts.uncompared += 1;
      continue;
    }
    const differing = observeOf
      .get(op)
      .filter((name) => canonical(row.observed[name]) !== canonical(expected[name]));
    if (differing.length > 0) {
      counts.mismatched += 1;
      findings.push({
        code: "behavior-mismatch",
        operation: op,
        instance: inst,
        differing: differing.map((name) => ({
          observation: name,
          current: expected[name],
          new: row.observed[name],
        })),
      });
      continue;
    }
    counts.matched += 1;
  }
  for (const [key, cell] of population) {
    if (!seen.has(key)) {
      counts.uncompared += 1;
      findings.push({
        code: "behavior-uncompared",
        operation: cell.operation,
        instance: cell.instance,
      });
    }
  }
  if (population.size === 0) {
    findings.push({
      code: "behavior-nothing-compared",
      detail: "全組み合わせが到達できないと宣言されており、比べた操作が 0 件",
    });
  }
  return { structural: false, judged: true, findings, counts };
}

/**
 * パスの 1 セグメントとして安全か（`../` で baseline の外を読ませない）。
 * @param {unknown} value
 * @returns {boolean}
 */
function safeSegment(value) {
  return (
    typeof value === "string" &&
    value !== "" &&
    value !== "." &&
    value !== ".." &&
    !/[/\\\0]/.test(value)
  );
}

/**
 * 部品の成果物ディレクトリから metadata.json と各インスタンスの behaviors.json を読む。
 * behaviors.json が無い・読めないインスタンスは null（未採取として判定側が数える）。
 * @param {string} dir
 * @returns {{ metadata: any, behaviors: Record<string, any> }}
 */
export function loadBaseline(dir) {
  const metadata = JSON.parse(readFileSync(join(dir, "metadata.json"), "utf8"));
  /** @type {Record<string, any>} */
  const behaviors = {};
  const instances = Array.isArray(metadata && metadata.instances) ? metadata.instances : [];
  const baselineRoot = resolve(dir, "baseline");
  for (const inst of instances) {
    const id = inst && inst.id;
    if (!safeSegment(id)) {
      throw new Error(`instances[].id がパスの 1 セグメントとして不正: ${JSON.stringify(id)}`);
    }
    const path = resolve(baselineRoot, id, "behaviors.json");
    let realPath;
    try {
      realPath = realpathSync(path);
    } catch {
      behaviors[id] = null;
      continue;
    }
    // 包含の判定は両辺を実パスに解決してから行う（リンク経由で外のファイルを読ませない）。
    const rel = relative(realpathSync(baselineRoot), realPath);
    if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new Error(`採取物のパスが baseline の外を指す: ${path} → ${realPath}`);
    }
    try {
      behaviors[id] = JSON.parse(readFileSync(realPath, "utf8"));
    } catch {
      behaviors[id] = null;
    }
  }
  return { metadata, behaviors };
}

/**
 * CLI 本体。
 * @param {string[]} argv
 * @param {{ cwd?: string, write?: (s: string) => void }} [io]
 * @returns {number} 終了コード
 */
export function main(argv, { cwd = process.cwd(), write = (s) => process.stdout.write(s) } = {}) {
  const out = (obj) =>
    write(`${JSON.stringify({ tool: "behavior-compare", version: VERSION, ...obj }, null, 2)}\n`);
  const fail = (message) => {
    out({ ok: false, structural: true, error: message });
    return 2;
  };
  /** @type {Record<string, string>} */
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--")) return fail(`不明な引数: ${key}`);
    const value = argv[i + 1];
    if (typeof value !== "string" || value.startsWith("--")) return fail(`${key} に値がない`);
    if (args[key] !== undefined) return fail(`${key} が複数ある`);
    args[key] = value;
    i += 1;
  }
  const known = ["--baseline", "--comparison", "--target"];
  const unknown = Object.keys(args).filter((k) => !known.includes(k));
  if (unknown.length > 0) return fail(`不明な引数: ${unknown.join(", ")}`);
  for (const key of known) {
    // 空白だけの値を通さない。`--target " "` を受けると target の照合が別環境の記録を通す。
    if (!nonEmptyString(args[key])) return fail(`${key} は必須（空白だけの値も不可）`);
  }
  let loaded;
  try {
    loaded = loadBaseline(resolve(cwd, args["--baseline"]));
  } catch (error) {
    return fail(`採取物を読めない: ${error && error.message}`);
  }
  let comparison = null;
  try {
    comparison = JSON.parse(readFileSync(resolve(cwd, args["--comparison"]), "utf8"));
  } catch {
    // 無い・壊れているのは「まだ突き合わせていない」と区別できないので、未突合として数える。
    comparison = null;
  }
  const result = compareBehaviors({
    metadata: loaded.metadata,
    behaviors: loaded.behaviors,
    comparison,
    target: args["--target"],
  });
  if (result.structural) {
    out({ ok: false, structural: true, findings: result.findings, counts: result.counts });
    return 2;
  }
  out({
    ok: result.findings.length === 0,
    judged: result.judged,
    findings: result.findings,
    counts: { ...result.counts, findings: result.findings.length },
  });
  return result.findings.length === 0 ? 0 : 1;
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
  // process.exit は書き込み中の stdout を捨てるため、終了コードだけ設定して自然終了させる。
  process.exitCode = main(process.argv.slice(2));
}
