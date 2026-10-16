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

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isArray } from "./lib/is-array.mjs";
import { loadBaseline } from "./lib/baseline.mjs";
import { isCliEntry } from "./lib/cli.mjs";
import { field, filled, isObjectLike, isPlainObject, nonEmptyString } from "./lib/guards.mjs";

/** ツールのバージョン（このスクリプトで定義する）。判定の規則・出力の形を変えたら上げる。 */
export const VERSION = "1";

/** 突き合わせ表の行がとりうる扱いの語彙（このスクリプトで定義する）。null は「比べた」。 */
export const DISPOSITIONS = ["accepted"];

/** 操作の導出元の語彙（このスクリプトで定義する。metadata-template.json の capture.operation_source と同じ）。 */
export const OPERATION_SOURCES = [
  "vendor-feature-list",
  "component-catalog",
  "current-source",
  "app-ui",
];

/**
 * ISO 8601 の日付・日時として読めるか（承認日時の検査。プレースホルダや自由記述を通さない）。
 * **暦の上で実在する値だけを通す。** `Date.parse("2026-02-30")` は 3 月 2 日へ繰り上げて成功するので、
 * 解析の成否ではなく各欄の範囲と、年月日を UTC で組み直して同じ日に戻ることを確かめる。
 * @param {unknown} value
 * @returns {boolean}
 */
export function isoDateTime(value) {
  if (typeof value !== "string") return false;
  const m =
    /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-](\d{2}):(\d{2}))?)?$/.exec(
      value,
    );
  if (!m) return false;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return false;
  }
  /**
   * @param {string | undefined} part
   * @param {number} max
   */
  const within = (part, max) => part === undefined || Number(part) <= max;
  return (
    within(m[4], 23) && within(m[5], 59) && within(m[6], 59) && within(m[8], 23) && within(m[9], 59)
  );
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
  /** @type {BehaviorFinding[]} */
  const findings = [];
  const counts = {
    cells: 0,
    not_compared: 0,
    matched: 0,
    mismatched: 0,
    uncompared: 0,
    accepted: 0,
  };
  /** @param {string} detail */
  const structural = (detail) => ({
    structural: true,
    judged: false,
    findings: [{ code: "structural", detail }],
    counts,
  });

  const capture = field(metadata, "capture");
  const operations = field(capture, "operations");
  // operations が配列なら metadata と capture はオブジェクトなので、絞り込みを足しても判定は変わらない。
  if (!isObjectLike(metadata) || !isObjectLike(capture) || !isArray(operations)) {
    return structural("metadata.json の capture.operations が配列でない（操作の列挙が無い）");
  }
  if (operations.length === 0) {
    // 操作を持たない部品（静的なラベル等）だけが判定しないで通れる。理由の無い 0 件は採り忘れと区別できない。
    if (filled(capture.operations_none_reason)) {
      return { structural: false, judged: false, findings: [], counts };
    }
    return structural(
      "capture.operations が空で capture.operations_none_reason も無い（操作が無いのか採っていないのか区別できない）",
    );
  }
  // 導出源が無いと、任意の一部だけを列挙した操作の集合が「部品の操作」として完了を示してしまう。
  if (!OPERATION_SOURCES.some((source) => source === capture.operation_source)) {
    return structural(
      `capture.operation_source は ${OPERATION_SOURCES.join(" / ")} のいずれか: ${JSON.stringify(capture.operation_source)}`,
    );
  }
  /** @type {Map<string, string[]>} */
  const observeOf = new Map();
  /**
   * 母集合に入った操作の観測項目。母集合の鍵は observeOf の操作からだけ作るので、無いことは起きない。
   * @param {string} op
   * @returns {string[]}
   */
  const observeFor = (op) => {
    const observe = observeOf.get(op);
    if (observe === undefined) throw new Error(`観測項目の無い操作: ${op}`);
    return observe;
  };
  for (const op of operations) {
    const id = field(op, "id");
    if (!filled(id)) return structural("capture.operations[].id が空かプレースホルダのまま");
    if (observeOf.has(id)) return structural(`capture.operations[].id が重複: ${id}`);
    const observe = field(op, "observe");
    if (
      !isArray(observe) ||
      observe.length === 0 ||
      !observe.every(filled) ||
      new Set(observe).size !== observe.length
    ) {
      return structural(
        `capture.operations[${JSON.stringify(id)}].observe が空・重複・非文字列（観測項目を固定しないと空の観測同士が一致する）`,
      );
    }
    // 手順が無いと、capture と build が同じ id で別の操作をしても観測が一致すれば通る（一致が挙動の一致を示さない）。
    if (!filled(field(op, "description")) || !filled(field(op, "steps"))) {
      return structural(
        `capture.operations[${JSON.stringify(id)}] の description / steps が空かプレースホルダのまま（両側で同じ操作を再生できない）`,
      );
    }
    observeOf.set(id, observe);
  }
  const instances = metadata.instances;
  if (!isArray(instances) || instances.length === 0) {
    return structural("metadata.json の instances が空");
  }
  /** @type {string[]} */
  const instanceIds = [];
  /** @type {{ id: string, record: Record<string, unknown> }[]} id を確かめたインスタンス（並びは instances のまま） */
  const instanceRecords = [];
  for (const inst of instances) {
    const id = field(inst, "id");
    if (!filled(id)) return structural("instances[].id が空かプレースホルダのまま");
    if (instanceIds.includes(id)) return structural(`instances[].id が重複: ${id}`);
    instanceIds.push(id);
    // id が文字列なら inst はオブジェクトなので、isObjectLike は型を絞るためだけにある（判定は変わらない）。
    if (isObjectLike(inst)) instanceRecords.push({ id, record: inst });
  }
  if (!nonEmptyString(target)) return structural("--target が空");
  // 部品の照合を省ける形にしない。slug が無いと、別の部品の突き合わせ表がそのまま通る。
  if (!filled(metadata.slug)) return structural("metadata.json の slug が空かプレースホルダのまま");

  // 母集合: 操作 × インスタンスから、宣言済みの到達できない操作を除いたもの。
  /** @type {Map<string, { operation: string, instance: string }>} */
  const population = new Map();
  /** @type {Set<string>} */
  const unreachable = new Set();
  for (const { id: instanceId, record: inst } of instanceRecords) {
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

  // 現行側の採取結果。
  /** @type {Map<string, Record<string, unknown> | undefined>} */
  const baseline = new Map();
  for (const id of instanceIds) {
    const raw = behaviors[id];
    if (raw === null || raw === undefined) continue; // 欠落は下の未採取で数える
    // オブジェクトでない値の欄は undefined として読む（プロパティアクセスと同じ）。
    /** @type {Record<string, unknown>} */
    const doc = isObjectLike(raw) ? raw : {};
    if (doc.instance !== id) {
      findings.push({
        code: "behavior-baseline-instance-mismatch",
        instance: id,
        detail: `behaviors.json の instance が ${JSON.stringify(doc.instance)}`,
      });
      continue;
    }
    const results = isArray(doc.results) ? doc.results : [];
    for (const r of results) {
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
        continue;
      }
      if (baseline.has(key)) {
        findings.push({ code: "behavior-baseline-duplicate", instance: id, operation: op });
        continue;
      }
      const shape = observationShape(field(r, "observed"), observeFor(cell.operation));
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
      baseline.set(key, shape.observed);
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
  // オブジェクトでない値の欄は undefined として読む（プロパティアクセスと同じ）。
  /** @type {Record<string, unknown>} */
  const table = isObjectLike(comparison) ? comparison : {};
  if (table.target !== target) {
    findings.push({
      code: "comparison-target-mismatch",
      detail: `突き合わせ表の target が ${JSON.stringify(table.target)}（判定対象は ${JSON.stringify(target)}）`,
    });
  }
  if (table.component !== metadata.slug) {
    findings.push({
      code: "comparison-component-mismatch",
      detail: `突き合わせ表の component が ${JSON.stringify(table.component)}（採取は ${JSON.stringify(metadata.slug)}）`,
    });
  }
  const rows = isArray(table.rows) ? table.rows : [];
  if (!isArray(table.rows)) {
    findings.push({ code: "comparison-rows-invalid", detail: "rows が配列でない" });
  }
  /** @type {Set<string>} */
  const seen = new Set();
  for (const row of rows) {
    const op = field(row, "operation");
    const inst = field(row, "instance");
    const key = nonEmptyString(op) && nonEmptyString(inst) ? cellKey(op, inst) : null;
    const cell = key === null ? undefined : population.get(key);
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
      // DISPOSITIONS は文字列だけなので、typeof は型を絞るためだけにある（判定は変わらない）。
      if (typeof disposition !== "string" || !DISPOSITIONS.includes(disposition)) {
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
        !filled(field(row, "reason")) ||
        !filled(field(row, "approved_by")) ||
        !isoDateTime(field(row, "approved_at"))
      ) {
        findings.push({
          code: "behavior-acceptance-unapproved",
          operation: op,
          instance: inst,
          detail:
            "accepted には記入済みの reason / approved_by と ISO 8601 の approved_at が要る（テンプレートのプレースホルダは承認ではない）",
        });
        counts.uncompared += 1;
        continue;
      }
      counts.accepted += 1;
      continue;
    }
    // 検査はカタログを駆動しないので、見本の識別子が観測と見本を結ぶ唯一の証拠になる。
    if (!filled(field(row, "story"))) {
      findings.push({
        code: "behavior-story-missing",
        operation: op,
        instance: inst,
        detail: "操作を実施した見本の識別子（story）が空かプレースホルダのまま",
      });
      counts.uncompared += 1;
      continue;
    }
    const shape = observationShape(field(row, "observed"), observeFor(cell.operation));
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
    const differing = observeFor(cell.operation).filter(
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
 * CLI 本体。
 * @param {string[]} argv
 * @param {{ cwd?: string, write?: (s: string) => void, writeErr?: (s: string) => void }} [io]
 * @returns {number} 終了コード
 */
export function main(
  argv,
  {
    cwd = process.cwd(),
    write = (s) => process.stdout.write(s),
    writeErr = (s) => process.stderr.write(s),
  } = {},
) {
  /** @param {Record<string, unknown>} obj */
  const out = (obj) =>
    write(`${JSON.stringify({ tool: "behavior-compare", version: VERSION, ...obj }, null, 2)}\n`);
  const usage =
    "usage: behavior-compare.mjs --baseline <部品の成果物ディレクトリ> --comparison <new/<target>/behavior-comparison.json> --target <name>";
  // 引数・入力の誤りは判定結果ではないので stdout の JSON に混ぜず stderr へ知らせる（同梱スクリプト共通の CLI 規約）。
  /** @param {string} message */
  const fail = (message) => {
    writeErr(`error: ${message}\n${usage}\n`);
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
    loaded = loadBaseline(resolve(cwd, args["--baseline"]), "behaviors.json");
  } catch (error) {
    return fail(`採取物を読めない: ${field(error, "message")}`);
  }
  let comparison = null;
  try {
    comparison = JSON.parse(readFileSync(resolve(cwd, args["--comparison"]), "utf8"));
  } catch {
    // 無い・読めないのは「まだ突き合わせていない」と区別できないので、未突合として数える。
    comparison = null;
  }
  const result = compareBehaviors({
    metadata: loaded.metadata,
    behaviors: loaded.byInstance,
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

if (isCliEntry(import.meta.url)) {
  // process.exit は書き込み中の stdout を捨てるため、終了コードだけ設定して自然終了させる。
  process.exitCode = main(process.argv.slice(2));
}
