#!/usr/bin/env node
// 部品の「操作の結果」を現行とカタログで突き合わせる検査（検査の仕方はこのスクリプトで定義する）。
//
// 何のためか: 部品の照合（画素・特性・当たっている CSS 規則）が見るのは「その状態に置いたときの見た目」だけで、
// **操作した結果が現行と同じか**は、どの工程も見ていない。実際の移行で、次の不具合が起きた。
// 隅のアイコンを押すと列ピッカーではなく全選択になる。全選択の後に 1 行外しても見出しのチェックが残る。書き出しで失敗する。
// どれも状態ごとの見た目は基準と一致したまま、部品の完了判定（未説明差分ゼロ）を通った。機能単位の parity-suite は
// ページができてから動くので、部品を先に作る進め方では、画面の実装まで誰も突き合わせない。
//
// そこで capture が現行で操作した結果（`baseline/<instance>/behaviors.json`）と、build がカタログの見本で
// 同じ操作をした結果（`new/<target>/behavior-comparison.json`）を、**操作 × インスタンス**の組み合わせごとに比べる。
// 比べるのは観測した状態の値（選択範囲・チェック・行の並び・開いた要素・書き出したファイルの有無・例外の件数など）で、
// 画素は比べない。
//
// 判定できない入力は、失敗として扱う。
//   - 観測項目は操作ごとに `capture.operations[].observe` で固定し、**両側ともちょうどその集合を要求する**。
//     観測を空にした記録同士は `{}` と `{}` で一致してしまうので、項目の欠落・余分は不一致ではなく記録の不備として失敗にする
//   - 到達できない操作（禁止された書き込みで作る結果など）を除外する根拠は、`instances[].unreachable_operations` の宣言だけである。
//     宣言の無い欠落は採り忘れと区別できないので、未採取として失敗にする
//   - 突き合わせ表が無い・読めないのは「まだ突き合わせていない」と区別できないので、すべての組み合わせを未突合として数える
//   - 母集合に無い組み合わせの行（基準の無い突き合わせ）も失敗にする。照合されない記録が合格の証拠に見えるため
//   - 比べないことや差を残すことを選ぶには、利用者の承認（`disposition: accepted` ＋ 理由・承認者・承認日時）が要る
//   - 比べる組み合わせが 0 件なら合格にしない（`capture.operations_none_reason` で操作の無い部品と宣言した場合だけ判定しない）
//
// 鮮度（記録の後に実装を変えたか）はこの検査では見ない。build の照合は commit 前の作業ツリーに対して行うため、
// commit SHA で版を特定できない（見た目の照合も同じ性質を持つ）。実装を変えたら採り直すことは、手順の側の規律である。
//
// 決定論的: 乱数・現在時刻・ネットワークに依存しない。読むのは JSON だけで、ブラウザは駆動しない。
//
// 使い方は次のとおりである。
//
//     node behavior-compare.mjs --baseline <部品の成果物ディレクトリ> --comparison <突き合わせ表> --target <new target 名>
//
// 終了コード: 0 ＝ 条件を満たす（判定しない場合を含む）、1 ＝ 未突合・不一致・記録の不備が残る、2 ＝ 使い方の誤り・型崩れ。

import { isArray } from "./lib/is-array.mjs";
import { isCliEntry } from "./lib/cli.mjs";
import {
  cellKey,
  judgeDisposition,
  readComparisonRows,
  runCompareCli,
  valueKind,
} from "./lib/comparison.mjs";
import { field, filled, isObjectLike, isPlainObject, nonEmptyString } from "./lib/guards.mjs";

/** ツールのバージョン（このスクリプトで定義する）。判定の規則・出力の形を変えたら上げる。 */
export const VERSION = "2";

/** 操作の導出元の語彙（このスクリプトで定義する。metadata-template.json の capture.operation_source と同じ）。 */
export const OPERATION_SOURCES = [
  "vendor-feature-list",
  "component-catalog",
  "current-source",
  "app-ui",
];

/**
 * キーを整列した正規形の JSON。オブジェクトのキー順だけが違う観測値を不一致にしない。
 * 配列は順序ごと比べる（行の並び・選択範囲の順は観測の内容そのもの）。
 * @param {unknown} value
 * @returns {string}
 */
export function canonical(value) {
  if (isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isObjectLike(value)) {
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
 * @returns {{ ok: true, observed: Record<string, unknown> } | { ok: false, missing: string[], extra: string[] }}
 *   一致したときは、観測値をオブジェクトとして読める形で返す。
 */
function observationShape(observed, expected) {
  if (!isPlainObject(observed)) {
    return { ok: false, missing: [...expected], extra: [] };
  }
  const keys = Object.keys(observed);
  const missing = expected.filter((k) => !Object.prototype.hasOwnProperty.call(observed, k));
  const extra = keys.filter((k) => !expected.includes(k));
  // 観測値そのものはプレースホルダ判定をしない。部品の出力として `<button>` や `<none>` は正当な値で、
  // 弾くと一致していても永久に通らない。テンプレートの行は観測項目名がプレースホルダなので、
  // observe の集合と食い違って missing / extra で落ちる。
  if (missing.length === 0 && extra.length === 0) return { ok: true, observed };
  return { ok: false, missing, extra };
}

/**
 * 突き合わせの指摘 1 件。code は必ずあり、ほかの欄は code ごとに付く。
 * instance と operation は入力の値をそのまま載せるので、文字列とは限らない（読めなければ null）。
 * @typedef {{
 *   code: string,
 *   detail?: string,
 *   instance?: unknown,
 *   operation?: unknown,
 *   missing?: string[],
 *   extra?: string[],
 *   differing?: { observation: string, current: unknown, new: unknown }[],
 * }} BehaviorFinding
 */

/**
 * 突き合わせの件数。
 * @typedef {{
 *   cells: number,
 *   not_compared: number,
 *   matched: number,
 *   mismatched: number,
 *   uncompared: number,
 *   accepted: number,
 * }} BehaviorCounts
 */

/**
 * 型崩れの結果を作る。
 * @param {string} detail
 * @param {BehaviorCounts} counts
 */
function structuralResult(detail, counts) {
  return {
    structural: true,
    judged: false,
    findings: [{ code: "structural", detail }],
    counts,
  };
}

/**
 * 母集合に入った操作の観測項目。母集合の鍵は observeOf の操作からだけ作るので、無いことは起きない。
 * @param {Map<string, string[]>} observeOf
 * @param {string} op
 * @returns {string[]}
 */
function observeFor(observeOf, op) {
  const observe = observeOf.get(op);
  if (observe === undefined) throw new Error(`観測項目の無い操作: ${op}`);
  return observe;
}

/**
 * capture.operations の 1 件を検査する。誤っていれば型崩れの理由を返し、正しければ観測項目を observeOf に足す。
 * @param {unknown} op
 * @param {Map<string, string[]>} observeOf
 * @returns {string | undefined}
 */
function addOperation(op, observeOf) {
  const id = field(op, "id");
  if (!filled(id)) return "capture.operations[].id が空かプレースホルダのまま";
  if (observeOf.has(id)) return `capture.operations[].id が重複: ${id}`;
  const observe = field(op, "observe");
  if (
    !isArray(observe) ||
    observe.length === 0 ||
    !observe.every(filled) ||
    new Set(observe).size !== observe.length
  ) {
    return `capture.operations[${JSON.stringify(id)}].observe が空・重複・非文字列（観測項目を固定しないと空の観測同士が一致する）`;
  }
  // 手順が無いと、capture と build が同じ id で別の操作をしても観測が一致すれば通る（一致が挙動の一致を示さない）。
  if (!filled(field(op, "description")) || !filled(field(op, "steps"))) {
    return `capture.operations[${JSON.stringify(id)}] の description / steps が空かプレースホルダのまま（両側で同じ操作を再生できない）`;
  }
  observeOf.set(id, observe);
  return undefined;
}

/**
 * metadata.json の capture から操作の列挙を読む。
 * 型崩れなら detail を、操作の無い部品と宣言していれば none: true を、読めれば操作 id → 観測項目を返す。
 * @param {unknown} metadata
 * @returns {{ detail: string } | { none: true } | { observeOf: Map<string, string[]> }}
 */
function readOperations(metadata) {
  const capture = field(metadata, "capture");
  const operations = field(capture, "operations");
  // operations が配列なら metadata と capture はオブジェクトなので、絞り込みを足しても判定は変わらない。
  if (!isObjectLike(metadata) || !isObjectLike(capture) || !isArray(operations)) {
    return { detail: "metadata.json の capture.operations が配列でない（操作の列挙が無い）" };
  }
  if (operations.length === 0) {
    // 操作を持たない部品（静的なラベル等）だけが判定しないで通れる。理由の無い 0 件は採り忘れと区別できない。
    if (filled(capture.operations_none_reason)) return { none: true };
    return {
      detail:
        "capture.operations が空で capture.operations_none_reason も無い（操作が無いのか採っていないのか区別できない）",
    };
  }
  // 導出源が無いと、任意の一部だけを列挙した操作の集合が「部品の操作」として完了を示してしまう。
  if (!OPERATION_SOURCES.some((source) => source === capture.operation_source)) {
    return {
      detail: `capture.operation_source は ${OPERATION_SOURCES.join(" / ")} のいずれか: ${JSON.stringify(capture.operation_source)}`,
    };
  }
  /** @type {Map<string, string[]>} */
  const observeOf = new Map();
  for (const op of operations) {
    const detail = addOperation(op, observeOf);
    if (detail !== undefined) return { detail };
  }
  return { observeOf };
}

/**
 * metadata.json の instances を読む。型崩れなら detail を返す。
 * @param {unknown} metadata
 * @returns {{ detail: string } | {
 *   detail?: undefined,
 *   instanceIds: string[],
 *   instanceRecords: { id: string, record: Record<string, unknown> }[],
 * }}
 */
function readInstances(metadata) {
  const instances = field(metadata, "instances");
  if (!isArray(instances) || instances.length === 0) {
    return { detail: "metadata.json の instances が空" };
  }
  /** @type {string[]} */
  const instanceIds = [];
  /** @type {{ id: string, record: Record<string, unknown> }[]} id を確かめたインスタンス（並びは instances のまま） */
  const instanceRecords = [];
  for (const inst of instances) {
    const id = field(inst, "id");
    if (!filled(id)) return { detail: "instances[].id が空かプレースホルダのまま" };
    if (instanceIds.includes(id)) return { detail: `instances[].id が重複: ${id}` };
    instanceIds.push(id);
    // id が文字列なら inst はオブジェクトなので、isObjectLike は型を絞るためだけにある（判定は変わらない）。
    if (isObjectLike(inst)) instanceRecords.push({ id, record: inst });
  }
  return { instanceIds, instanceRecords };
}

/**
 * 突き合わせの途中の状態。
 * @typedef {{
 *   findings: BehaviorFinding[],
 *   counts: BehaviorCounts,
 *   observeOf: Map<string, string[]>,
 *   population: Map<string, { operation: string, instance: string }>,
 *   unreachable: Set<string>,
 * }} BehaviorContext
 */

/**
 * 1 つのインスタンスの unreachable_operations を読み、理由付きで宣言された操作の鍵を unreachable に足す。
 * @param {{ instanceId: string, inst: Record<string, unknown>, ctx: BehaviorContext }} arg
 */
function addUnreachable({ instanceId, inst, ctx }) {
  const { findings, observeOf, unreachable } = ctx;
  const declared = isArray(inst.unreachable_operations) ? inst.unreachable_operations : [];
  if (inst.unreachable_operations !== undefined && !isArray(inst.unreachable_operations)) {
    findings.push({
      code: "unreachable-declaration-invalid",
      instance: instanceId,
      detail: "unreachable_operations が配列でない",
    });
  }
  for (const u of declared) {
    const op = field(u, "operation");
    if (!nonEmptyString(op) || !observeOf.has(op)) {
      findings.push({
        code: "unreachable-declaration-invalid",
        instance: instanceId,
        operation: op ?? null,
        detail: "列挙に無い操作を到達できないと宣言している",
      });
      continue;
    }
    if (!filled(field(u, "reason"))) {
      // 理由の無い宣言は除外にしない（採り忘れを誤って除外として扱わない）。母集合に残す。
      findings.push({
        code: "unreachable-declaration-invalid",
        instance: instanceId,
        operation: op,
        detail: "到達できない理由が無いかプレースホルダのまま（除外として扱わない）",
      });
      continue;
    }
    unreachable.add(cellKey(op, instanceId));
  }
}

/**
 * 母集合（操作 × インスタンスから、宣言済みの到達できない操作を除いたもの）を作る。
 * @param {{ id: string, record: Record<string, unknown> }[]} instanceRecords
 * @param {BehaviorContext} ctx
 */
function buildPopulation(instanceRecords, ctx) {
  const { counts, observeOf, population, unreachable } = ctx;
  for (const { id: instanceId, record: inst } of instanceRecords) {
    addUnreachable({ instanceId, inst, ctx });
    for (const op of observeOf.keys()) {
      const key = cellKey(op, instanceId);
      if (unreachable.has(key)) {
        counts.not_compared += 1;
        continue;
      }
      population.set(key, { operation: op, instance: instanceId });
    }
  }
  counts.cells = population.size;
}

/**
 * 現行側の採取物の結果 1 件を読み、基準に足す。
 * @param {{ r: unknown, id: string, baseline: Map<string, Record<string, unknown> | undefined>, ctx: BehaviorContext }} arg
 */
function addBaselineResult({ r, id, baseline, ctx }) {
  const { findings, observeOf, population, unreachable } = ctx;
  const op = field(r, "operation");
  const key = nonEmptyString(op) ? cellKey(op, id) : null;
  const cell = key === null ? undefined : population.get(key);
  if (key === null || cell === undefined) {
    findings.push({
      code: "behavior-baseline-unknown",
      instance: id,
      operation: op ?? null,
      detail:
        key !== null && unreachable.has(key)
          ? "到達できないと宣言した操作に結果がある"
          : "列挙に無い操作の結果",
    });
    return;
  }
  if (baseline.has(key)) {
    findings.push({ code: "behavior-baseline-duplicate", instance: id, operation: op });
    return;
  }
  const shape = observationShape(field(r, "observed"), observeFor(observeOf, cell.operation));
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
    return;
  }
  baseline.set(key, shape.observed);
}

/**
 * 現行側の採取結果を読み、鍵 → 観測値の基準を作る。採取の無い組み合わせは findings に積む。
 * @param {{ instanceIds: string[], behaviors: Record<string, unknown>, ctx: BehaviorContext }} arg
 * @returns {Map<string, Record<string, unknown> | undefined>}
 */
function readBehaviorBaseline({ instanceIds, behaviors, ctx }) {
  const { findings, population } = ctx;
  /** @type {Map<string, Record<string, unknown> | undefined>} */
  const baseline = new Map();
  for (const id of instanceIds) {
    const raw = behaviors[id];
    if (raw === null || raw === undefined) continue; // 欠落は下の未採取で数える
    // オブジェクトでない値は、instance の不一致として報告する。instance を書き忘れた採取物と見分けられるよう、値の型を書く。
    if (!isPlainObject(raw)) {
      findings.push({
        code: "behavior-baseline-instance-mismatch",
        instance: id,
        detail: `behaviors.json がオブジェクトでない（${valueKind(raw)}）`,
      });
      continue;
    }
    const doc = raw;
    if (doc.instance !== id) {
      findings.push({
        code: "behavior-baseline-instance-mismatch",
        instance: id,
        detail: `behaviors.json の instance が ${JSON.stringify(doc.instance)}`,
      });
      continue;
    }
    const results = isArray(doc.results) ? doc.results : [];
    for (const r of results) addBaselineResult({ r, id, baseline, ctx });
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
  return baseline;
}

/**
 * 比べた行の観測値を、現行の基準と突き合わせて件数を数える。
 * @param {{
 *   row: unknown,
 *   cell: { operation: string, instance: string },
 *   expected: Record<string, unknown> | undefined,
 *   ctx: BehaviorContext,
 * }} arg
 */
function judgeObserved({ row, cell, expected, ctx }) {
  const { findings, counts, observeOf } = ctx;
  const { operation: op, instance: inst } = cell;
  // 検査はカタログを駆動しないので、見本の識別子が観測と見本を結ぶ唯一の証拠になる。
  if (!filled(field(row, "story"))) {
    findings.push({
      code: "behavior-story-missing",
      operation: op,
      instance: inst,
      detail: "操作を実施した見本の識別子（story）が空かプレースホルダのまま",
    });
    counts.uncompared += 1;
    return;
  }
  const shape = observationShape(field(row, "observed"), observeFor(observeOf, op));
  if (!shape.ok) {
    findings.push({
      code: "behavior-observation-incomplete",
      operation: op,
      instance: inst,
      missing: shape.missing,
      extra: shape.extra,
    });
    counts.uncompared += 1;
    return;
  }
  if (expected === undefined) {
    // 基準が無い・不備（上で finding 済み）。比べる相手が無いので一致とも不一致とも言わない。
    counts.uncompared += 1;
    return;
  }
  const differing = observeFor(observeOf, op).filter(
    (name) => canonical(shape.observed[name]) !== canonical(expected[name]),
  );
  if (differing.length > 0) {
    counts.mismatched += 1;
    findings.push({
      code: "behavior-mismatch",
      operation: op,
      instance: inst,
      differing: differing.map((name) => ({
        observation: name,
        current: expected[name],
        new: shape.observed[name],
      })),
    });
    return;
  }
  counts.matched += 1;
}

/**
 * 突き合わせ表の行 1 件の操作とインスタンスを読み、母集合から組み合わせを取得する。
 * 操作かインスタンスが空でない文字列でなければ、key を null にする。
 * @param {unknown} row
 * @param {Map<string, { operation: string, instance: string }>} population
 * @returns {{ op: unknown, inst: unknown, key: string | null, cell: { operation: string, instance: string } | undefined }}
 */
function lookupRowCell(row, population) {
  const op = field(row, "operation");
  const inst = field(row, "instance");
  const key = nonEmptyString(op) && nonEmptyString(inst) ? cellKey(op, inst) : null;
  const cell = key === null ? undefined : population.get(key);
  return { op, inst, key, cell };
}

/**
 * 突き合わせ表の行を、母集合と基準に照らして判定する。
 * @param {{
 *   rows: unknown[],
 *   baseline: Map<string, Record<string, unknown> | undefined>,
 *   ctx: BehaviorContext,
 * }} arg
 * @returns {Set<string>} 突き合わせ表にあった組み合わせの鍵
 */
function judgeRows({ rows, baseline, ctx }) {
  const { findings, population } = ctx;
  /** @type {Set<string>} */
  const seen = new Set();
  for (const row of rows) {
    const { op, inst, key, cell } = lookupRowCell(row, population);
    if (key === null || cell === undefined) {
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
    const disposition = field(row, "disposition") ?? null;
    if (disposition !== null) {
      judgeDisposition({
        row,
        disposition,
        prefix: "behavior",
        where: { operation: cell.operation, instance: cell.instance },
        ctx,
      });
      continue;
    }
    judgeObserved({ row, cell, expected: baseline.get(key), ctx });
  }
  return seen;
}

/**
 * 突き合わせ表に無い組み合わせと、比べる組み合わせが 0 件のことを findings に積む。
 * @param {Set<string>} seen
 * @param {BehaviorContext} ctx
 */
function reportUncompared(seen, ctx) {
  const { findings, counts, population } = ctx;
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
}

/**
 * 操作の結果を突き合わせる（純関数）。
 *
 * @param {{ metadata: unknown, behaviors: Record<string, unknown>, comparison: unknown, target: string }} input 突き合わせの入力（形はここで検査する）。
 *   - metadata: capture の `metadata.json`
 *   - behaviors: インスタンス id → `baseline/<id>/behaviors.json` の中身（読めなければ null）
 *   - comparison: `new/<target>/behavior-comparison.json` の中身（読めなければ null）
 *   - target: 判定の対象の new target 名
 * @returns {{ structural: boolean, judged: boolean, findings: BehaviorFinding[], counts: BehaviorCounts }}
 */
export function compareBehaviors({ metadata, behaviors, comparison, target }) {
  /** @type {BehaviorCounts} */
  const counts = {
    cells: 0,
    not_compared: 0,
    matched: 0,
    mismatched: 0,
    uncompared: 0,
    accepted: 0,
  };
  const operations = readOperations(metadata);
  if ("detail" in operations) return structuralResult(operations.detail, counts);
  if ("none" in operations) return { structural: false, judged: false, findings: [], counts };
  const instances = readInstances(metadata);
  if (instances.detail !== undefined) return structuralResult(instances.detail, counts);
  if (!nonEmptyString(target)) return structuralResult("--target が空", counts);
  // 部品の照合を省ける形にしない。slug が無いと、別の部品の突き合わせ表がそのまま通る。
  const slug = field(metadata, "slug");
  if (!filled(slug)) {
    return structuralResult("metadata.json の slug が空かプレースホルダのまま", counts);
  }
  /** @type {BehaviorContext} */
  const ctx = {
    findings: [],
    counts,
    observeOf: operations.observeOf,
    population: new Map(),
    unreachable: new Set(),
  };
  buildPopulation(instances.instanceRecords, ctx);
  const baseline = readBehaviorBaseline({ instanceIds: instances.instanceIds, behaviors, ctx });
  // 新側（カタログ）の突き合わせ。
  if (comparison === null || comparison === undefined) {
    ctx.findings.push({
      code: "comparison-missing",
      detail: "突き合わせ表が無い・読めない（全組み合わせを未突合として数える）",
    });
    counts.uncompared = ctx.population.size;
    return { structural: false, judged: true, findings: ctx.findings, counts };
  }
  const rows = readComparisonRows({ comparison, target, slug, findings: ctx.findings });
  const seen = judgeRows({ rows, baseline, ctx });
  reportUncompared(seen, ctx);
  return { structural: false, judged: true, findings: ctx.findings, counts };
}

/**
 * CLI 本体。
 * @param {string[]} argv
 * @param {{ cwd?: string, write?: (s: string) => void, writeErr?: (s: string) => void }} [io]
 * @returns {number} 終了コード
 */
export function main(argv, io = {}) {
  return runCompareCli(argv, io, {
    tool: "behavior-compare",
    version: VERSION,
    usage:
      "usage: behavior-compare.mjs --baseline <部品の成果物ディレクトリ> --comparison <new/<target>/behavior-comparison.json> --target <name>",
    fileName: "behaviors.json",
    judge: ({ metadata, byInstance, comparison, target }) =>
      compareBehaviors({ metadata, behaviors: byInstance, comparison, target }),
  });
}

if (isCliEntry(import.meta.url)) {
  // process.exit は書き込み中の stdout を捨てるため、終了コードだけ設定して自然終了させる。
  process.exitCode = main(process.argv.slice(2));
}
