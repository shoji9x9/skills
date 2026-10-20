#!/usr/bin/env node
// 部品の動き（出し入れ・開閉のアニメーション）を現行とカタログで突き合わせる検査（検査の仕方はこのスクリプトで定義する）。
//
// 何のためか: 見た目の照合は `animations: "disabled"` で止めて撮るので、現行の部品が持つ動きは
// 採取物にも見本の照合にも記録されない。新側が動きを持たないまま（即時に出る・消える）、部品の照合・
// パリティスイート・parity-diff がすべて緑になり、利用者が画面を触って初めて気づいた（実際の移行で起きた）。
//
// そこで、capture が現行で採った時系列と、build がカタログの見本で同じ操作をして採った時系列を比べる。
// 現行の時系列は `baseline/<instance>/motions.json` で、同梱の motion-probe.mjs の出力を同じ条件で 2 回以上採ったものである。
// 見本の時系列は `new/<target>/motion-comparison.json` である。比べる単位は、**遷移 × インスタンス**の組み合わせである。
// 比べるのは次の数値で、画素は比べない。
//   - 在るか（操作の前と、落ち着いた後）: 一致を要求する（出る動きが消える動きになっていないか）
//   - 始まるまでの遅れ（操作から最初の変化まで）と長さ（最初の変化から最後の変化まで）
//   - 軌跡: 最初の変化からの経過時間ごとの、基準の矩形からのずれ（x / y / width / height）と実効の不透明度。
//     基準の矩形は「落ち着いた後に在ればその矩形、無ければ操作の前の矩形」。現行のページとカタログでは
//     部品の置き場所が違うので、絶対座標は比べない
//
// 許容差は測った揺れから決める: 現行の 1 回目と 2 回目の差（ノイズ）の NOISE_FACTOR 倍と、下限 FLOORS の大きい方。
// フレームの刻み（約 16.7ms）と操作が届くまでの遅れで、同じ実装でも値は揺れる（実測で、
// 動きを揃えた後も位置の差は最大 6.1px 残った）。揺れを測らずに固定の許容差を置くと、
// 厳しすぎて永久に落ちるか、緩すぎて動きの欠落まで通すかのどちらかになる。
//
// 判定できない入力は、失敗として扱う（behavior-compare.mjs と同じ形）。
//   - 動きの列挙（`capture.motions`）が無いのは「動きが無い」と区別できないので、型の誤りとして失敗にする。
//     動きの無い部品は `transitions` を空にし、`none_reason` に理由を書く（その場合だけ判定しない）
//   - 到達できない遷移を除外する根拠は、`instances[].unreachable_motions` の宣言だけである。宣言の無い欠落は未採取
//   - 現行の時系列が 2 回分に満たないと揺れを測れないので、比べずに失敗にする
//   - 打ち切り（timed_out）・要素が一度も無かった時系列は、終わりや対象を見ていないので比較に使わない
//   - 突き合わせ表が無い・母集合に無い行・承認の無い accepted は behavior-compare.mjs と同じに扱う
//
// 決定論的: 乱数・現在時刻・ネットワークに依存しない。読むのは JSON だけで、ブラウザは駆動しない。
//
// 使い方は次のとおりである。
//
//     node motion-compare.mjs --baseline <部品の成果物ディレクトリ> --comparison <突き合わせ表> --target <new target 名>
//
// 終了コード: 0 ＝ 条件を満たす（判定しない場合を含む）、1 ＝ 未突合・不一致・記録の不備が残る、2 ＝ 使い方の誤り・型崩れ。

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isArray } from "./lib/is-array.mjs";

import { cellKey, isoDateTime } from "./behavior-compare.mjs";
import { loadBaseline } from "./lib/baseline.mjs";
import { isCliEntry } from "./lib/cli.mjs";
import {
  field,
  filled,
  isFiniteNumber,
  isObjectLike,
  isPlainObject,
  nonEmptyString,
} from "./lib/guards.mjs";

/** ツールのバージョン（このスクリプトで定義する）。判定の規則・許容差・出力の形を変えたら上げる。 */
export const VERSION = "1";

/** 突き合わせ表の行がとりうる扱いの語彙（このスクリプトで定義する）。null は「比べた」。 */
export const DISPOSITIONS = ["accepted"];

/** 変化とみなす最小の差（原本は motion-probe.mjs の CHANGE_EPSILON。同じ値にする）。 */
export const CHANGE_EPSILON = { px: 0.01, opacity: 0.001 };

/** 許容差の下限（揺れが測れても、これより細かい差は落とさない）。 */
export const FLOORS = { delay_ms: 50, duration_ms: 50, px: 2, opacity: 0.05 };

/** 測った揺れに掛ける倍率。 */
export const NOISE_FACTOR = 2;

/**
 * 現行の 2 回の差として許す揺れの上限（これを超えたら基準にしない）。
 * 倍率だけで許容差を決めると、揺れの大きい現行（600ms と即時が 1 回ずつ等）では許容差が青天井になり、
 * 動きの欠落まで通す。時間は「上限 ms」と「基準の値に対する割合」の大きい方、軌跡は px / 不透明度の上限。
 */
export const MAX_NOISE = { ms: 100, ratio: 0.25, px: 20, opacity: 0.2 };

/** 軌跡を比べる点の数（最初の変化から、長い方の長さまでを等分する）。 */
export const TRAJECTORY_POINTS = 20;

/**
 * 軌跡で比べる量の名前。
 * @typedef {"dx" | "dy" | "dw" | "dh" | "opacity"} TrajectoryMetric
 */

/**
 * 軌跡の 1 点。t は最初の変化の直前の標本からの時刻（ms）、dx / dy / dw / dh は基準の矩形からのずれ（px）。
 * 要素が無い点では、時刻以外の量が null になる。
 * @typedef {{
 *   t: number,
 *   present: boolean,
 *   dx: number | null,
 *   dy: number | null,
 *   dw: number | null,
 *   dh: number | null,
 *   opacity: number | null,
 * }} MotionPoint
 */

/**
 * 比較に使う時系列の要約（summarizeTimeline が標本から組み立てる）。
 * probe_version は時系列の記録の値のまま（無ければ null）。
 * @typedef {{
 *   probe_version: unknown,
 *   present_start: boolean,
 *   present_end: boolean,
 *   changed: boolean,
 *   delay_ms: number | null,
 *   duration_ms: number,
 *   series: MotionPoint[],
 * }} MotionSummary
 */

/**
 * 検査を通った標本 1 件（summarizeTimeline が present と各量を確かめた後の形）。
 * 在る標本だけが位置・大きさ・不透明度を持つ。
 * @typedef {{ t: number, present: true, x: number, y: number, width: number, height: number, opacity: number }
 *   | { t: number, present: false }} MotionSample
 */

/**
 * 許容差を超えた量 1 件。在る／無い・遅れ・長さは current / new を、軌跡は gap を持つ。
 * @typedef {{ measure: string, current?: unknown, new?: unknown, gap?: number, tolerance: number }} MotionDiffering
 */

/**
 * 突き合わせの指摘 1 件。code は必ずあり、ほかの欄は code ごとに付く。
 * instance と transition は入力の値をそのまま載せるので、文字列とは限らない（読めなければ null）。
 * @typedef {{
 *   code: string,
 *   detail?: string,
 *   instance?: unknown,
 *   transition?: unknown,
 *   side?: "current" | "new",
 *   run?: number,
 *   differing?: MotionDiffering[],
 * }} MotionFinding
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
 * }} MotionCounts
 */

/**
 * 軌跡で比べる量。dx / dy / dw / dh は基準の矩形からのずれ（px）、opacity は実効の不透明度。
 * @type {readonly TrajectoryMetric[]}
 */
const TRAJECTORY_METRICS = ["dx", "dy", "dw", "dh", "opacity"];

/**
 * 2 つの標本が違うか（motion-probe.mjs のページ側の判定と同じ）。
 * @param {MotionSample} a
 * @param {MotionSample} b
 * @returns {boolean}
 */
function differs(a, b) {
  if (a.present !== b.present) return true;
  // ここでは a.present と b.present が等しいので、b の判定は a の判定と同じ結果になる（型の絞り込みのため）。
  if (!a.present || !b.present) return false;
  return (
    Math.abs(a.x - b.x) > CHANGE_EPSILON.px ||
    Math.abs(a.y - b.y) > CHANGE_EPSILON.px ||
    Math.abs(a.width - b.width) > CHANGE_EPSILON.px ||
    Math.abs(a.height - b.height) > CHANGE_EPSILON.px ||
    Math.abs(a.opacity - b.opacity) > CHANGE_EPSILON.opacity
  );
}

/**
 * 時系列を読み、比較に使う要約を返す（読めなければ理由）。
 * 記録された要約値は信用せず、標本から組み立て直す（書き手の不変条件を読み手で検査する）。
 * @param {unknown} timeline motion-probe.mjs の出力（形はここで検査する）
 * @returns {{ ok: true, summary: MotionSummary } | { ok: false, reason: string }}
 */
export function summarizeTimeline(timeline) {
  if (!isPlainObject(timeline)) {
    return { ok: false, reason: "時系列がオブジェクトでない" };
  }
  if (timeline.timed_out !== false) {
    return {
      ok: false,
      reason: "打ち切られた時系列（timed_out が false でない。終わりを見ていない）",
    };
  }
  const samples = timeline.samples;
  if (!isArray(samples) || samples.length === 0) {
    return { ok: false, reason: "samples が空" };
  }
  /**
   * @param {string} key
   * @returns {{ ok: false, reason: string }}
   */
  const notFinite = (key) => ({ ok: false, reason: `在る標本の ${key} が有限の数でない` });
  /** @type {MotionSample[]} 検査を通った標本（並びは samples のまま） */
  const checked = [];
  let previousT = -Infinity;
  for (const raw of samples) {
    if (!isObjectLike(raw) || typeof raw.present !== "boolean") {
      return { ok: false, reason: "標本の present が真偽値でない" };
    }
    const t = raw.t;
    if (!isFiniteNumber(t) || t < previousT) {
      return { ok: false, reason: "標本の t が有限の非減少列でない" };
    }
    previousT = t;
    if (!raw.present) {
      checked.push({ t, present: false });
      continue;
    }
    const { x, y, width, height, opacity } = raw;
    if (!isFiniteNumber(x)) return notFinite("x");
    if (!isFiniteNumber(y)) return notFinite("y");
    if (!isFiniteNumber(width)) return notFinite("width");
    if (!isFiniteNumber(height)) return notFinite("height");
    if (!isFiniteNumber(opacity)) return notFinite("opacity");
    checked.push({ t, present: true, x, y, width, height, opacity });
  }
  const first = checked[0];
  const last = checked[checked.length - 1];
  const reference = last.present ? last : first.present ? first : checked.find((s) => s.present);
  if (!reference) {
    return { ok: false, reason: "要素が一度も在らなかった（セレクタが対象を引けていない疑い）" };
  }
  let firstChange = null;
  let lastChange = null;
  for (let i = 1; i < checked.length; i += 1) {
    if (differs(checked[i - 1], checked[i])) {
      if (firstChange === null) firstChange = i;
      lastChange = i;
    }
  }
  // 最初の変化の直前の標本を起点にする（変化はその次のフレームで初めて見えるため）。
  const originIndex = firstChange === null ? 0 : firstChange - 1;
  const origin = checked[originIndex].t;
  const series = checked.slice(originIndex).map((s) => ({
    t: s.t - origin,
    present: s.present,
    dx: s.present ? s.x - reference.x : null,
    dy: s.present ? s.y - reference.y : null,
    dw: s.present ? s.width - reference.width : null,
    dh: s.present ? s.height - reference.height : null,
    opacity: s.present ? s.opacity : null,
  }));
  return {
    ok: true,
    summary: {
      probe_version: timeline.probe_version ?? null,
      present_start: first.present,
      present_end: last.present,
      changed: firstChange !== null,
      delay_ms: firstChange === null ? null : checked[originIndex].t - first.t,
      // firstChange と lastChange は同時に決まるので、lastChange の null の判定は型の絞り込みのため。
      duration_ms: firstChange === null || lastChange === null ? 0 : checked[lastChange].t - origin,
      series,
    },
  };
}

/**
 * 系列のある時刻の値（前後の標本の線形補間。どちらかが無ければ null）。終わりより後は最後の値を保つ。
 * @param {MotionPoint[]} series
 * @param {number} t
 * @param {TrajectoryMetric} metric
 * @returns {number | null}
 */
function valueAt(series, t, metric) {
  let before = series[0];
  if (t <= before.t) return before[metric];
  for (let i = 1; i < series.length; i += 1) {
    const after = series[i];
    if (after.t >= t) {
      if (before[metric] === null || after[metric] === null) return null;
      if (after.t === before.t) return after[metric];
      const ratio = (t - before.t) / (after.t - before.t);
      return before[metric] + (after[metric] - before[metric]) * ratio;
    }
    before = after;
  }
  return before[metric];
}

/**
 * 2 つの要約の軌跡の差（量ごとの最大の差）。両方が在る点だけで比べる。
 * @param {MotionSummary} a
 * @param {MotionSummary} b
 * @returns {Record<string, number>}
 */
export function trajectoryGap(a, b) {
  const span = Math.max(a.duration_ms, b.duration_ms);
  /** @type {Record<string, number>} */
  const gap = Object.fromEntries(TRAJECTORY_METRICS.map((m) => [m, 0]));
  // 等間隔の点だけで比べると、点と点の間に収まる短い動き（一瞬の点滅・行き過ぎ）を見逃す。
  // 両側が実際に採った標本の時刻も比較点に加える。
  const times = new Set();
  for (let i = 0; i <= TRAJECTORY_POINTS; i += 1) times.add((span * i) / TRAJECTORY_POINTS);
  for (const s of [...a.series, ...b.series]) if (s.t <= span) times.add(s.t);
  for (const t of times) {
    for (const metric of TRAJECTORY_METRICS) {
      const va = valueAt(a.series, t, metric);
      const vb = valueAt(b.series, t, metric);
      if (va === null || vb === null) continue;
      gap[metric] = Math.max(gap[metric], Math.abs(va - vb));
    }
  }
  return gap;
}

/**
 * 時間の量の差（片方だけ null なら比べられない＝無限大）。
 * @param {number | null} a
 * @param {number | null} b
 * @returns {number}
 */
function timeGap(a, b) {
  if (a === null && b === null) return 0;
  if (a === null || b === null) return Infinity;
  return Math.abs(a - b);
}

/**
 * 現行の 2 回（基準・揺れ）が割れていないかを見る。割れた量の名前を返す（空なら基準にできる）。
 * 在る／無い・動いた／動かないの割れと、遅れ・長さ・軌跡の揺れが上限（MAX_NOISE）を超えたもの。
 * 新側の記録に依らず現行の 2 回だけで決まるので、基準を登録する時点で判定する
 * （突き合わせの行の中で判定すると、突き合わせ表の無い capture の前提判定や、比較まで届かない行で素通りする）。
 * @param {MotionSummary} base 現行の 1 回目の要約
 * @param {MotionSummary} noise 現行の 2 回目の要約
 * @returns {string[]}
 */
export function baselineInstability(base, noise) {
  /** @type {string[]} */
  const unstable = [];
  /** @type {readonly ("present_start" | "present_end" | "changed")[]} */
  const presenceKeys = ["present_start", "present_end", "changed"];
  for (const key of presenceKeys) {
    if (base[key] !== noise[key]) unstable.push(key);
  }
  /** @type {readonly ("delay_ms" | "duration_ms")[]} */
  const timeKeys = ["delay_ms", "duration_ms"];
  for (const key of timeKeys) {
    const limit = Math.max(MAX_NOISE.ms, MAX_NOISE.ratio * (base[key] ?? 0));
    if (timeGap(base[key], noise[key]) > limit) unstable.push(key);
  }
  const noiseGapForLimit = trajectoryGap(base, noise);
  for (const metric of TRAJECTORY_METRICS) {
    const limit = metric === "opacity" ? MAX_NOISE.opacity : MAX_NOISE.px;
    if (noiseGapForLimit[metric] > limit) unstable.push(`trajectory.${metric}`);
  }
  return unstable;
}

/**
 * 現行の 2 回（基準・揺れ）と新側 1 回を比べ、許容差を超えた量を返す。
 * 現行の 2 回が割れていないこと（baselineInstability が空）は、基準を登録する時点で確かめ済みの前提。
 * @param {MotionSummary} base 現行の 1 回目の要約
 * @param {MotionSummary} noise 現行の 2 回目の要約
 * @param {MotionSummary} candidate 新側の要約
 * @returns {{ differing: MotionDiffering[] }}
 */
export function judgeMotion(base, noise, candidate) {
  const noiseGapForLimit = trajectoryGap(base, noise);
  /** @type {MotionDiffering[]} */
  const differing = [];
  /** @type {readonly ("present_start" | "present_end")[]} */
  const presenceKeys = ["present_start", "present_end"];
  for (const key of presenceKeys) {
    if (base[key] !== candidate[key]) {
      differing.push({ measure: key, current: base[key], new: candidate[key], tolerance: 0 });
    }
  }
  /** @type {readonly ["delay_ms" | "duration_ms", number][]} */
  const timeMeasures = [
    ["delay_ms", FLOORS.delay_ms],
    ["duration_ms", FLOORS.duration_ms],
  ];
  for (const [key, floor] of timeMeasures) {
    const tolerance = Math.max(floor, NOISE_FACTOR * timeGap(base[key], noise[key]));
    if (timeGap(base[key], candidate[key]) > tolerance) {
      differing.push({ measure: key, current: base[key], new: candidate[key], tolerance });
    }
  }
  const gap = trajectoryGap(base, candidate);
  for (const metric of TRAJECTORY_METRICS) {
    const floor = metric === "opacity" ? FLOORS.opacity : FLOORS.px;
    const tolerance = Math.max(floor, NOISE_FACTOR * noiseGapForLimit[metric]);
    if (gap[metric] > tolerance) {
      differing.push({ measure: `trajectory.${metric}`, gap: gap[metric], tolerance });
    }
  }
  return { differing };
}

/**
 * 動きを突き合わせる（純関数）。
 *
 * @param {{ metadata: unknown, motions: Record<string, unknown>, comparison: unknown, target: string }} input 突き合わせの入力（形はここで検査する）。
 *   - metadata: capture の `metadata.json`
 *   - motions: インスタンス id → `baseline/<id>/motions.json` の中身（読めなければ null）
 *   - comparison: `new/<target>/motion-comparison.json` の中身（読めなければ null）
 *   - target: 判定対象の new target 名
 * @returns {{ structural: boolean, judged: boolean, findings: MotionFinding[], counts: MotionCounts }}
 */
export function compareMotions({ metadata, motions, comparison, target }) {
  /** @type {MotionFinding[]} */
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
  const declared = field(capture, "motions");
  // declared がオブジェクトなら metadata と capture もオブジェクトなので、絞り込みを足しても判定は変わらない。
  if (!isObjectLike(metadata) || !isObjectLike(capture) || !isPlainObject(declared)) {
    return structural(
      "metadata.json の capture.motions が無い（動きが無いのか数えていないのか区別できない）",
    );
  }
  if (!isArray(declared.source_scan)) {
    return structural(
      "capture.motions.source_scan が配列でない（現行のソースで動きを数えた記録が無い）",
    );
  }
  const transitions = declared.transitions;
  if (!isArray(transitions)) {
    return structural("capture.motions.transitions が配列でない");
  }
  if (transitions.length === 0) {
    if (filled(declared.none_reason)) return { structural: false, judged: false, findings, counts };
    return structural(
      "capture.motions.transitions が空で none_reason も無い（動きが無いのか採っていないのか区別できない）",
    );
  }
  if (declared.none_reason !== null && declared.none_reason !== undefined) {
    return structural("capture.motions は transitions と none_reason を同時に持てない");
  }
  const operationIds = new Set(
    (isArray(capture.operations) ? capture.operations : []).map((op) => field(op, "id")),
  );
  /** @type {Set<string>} */
  const transitionIds = new Set();
  for (const tr of transitions) {
    const id = field(tr, "id");
    if (!filled(id))
      return structural("capture.motions.transitions[].id が空かプレースホルダのまま");
    if (transitionIds.has(id)) return structural(`capture.motions.transitions[].id が重複: ${id}`);
    // 手順が無いと、capture と build が同じ id で別の操作から動きを起こしても通る。
    if (!filled(field(tr, "description")) || !filled(field(tr, "trigger"))) {
      return structural(
        `capture.motions.transitions[${JSON.stringify(id)}] の description / trigger が空かプレースホルダのまま（両側で同じ操作を再生できない）`,
      );
    }
    const onComplete = field(tr, "on_complete");
    if (onComplete !== undefined) {
      if (!isArray(onComplete) || !onComplete.every((op) => operationIds.has(op))) {
        return structural(
          `capture.motions.transitions[${JSON.stringify(id)}].on_complete は capture.operations の id の配列（動きの完了で始まる処理は操作として列挙する）`,
        );
      }
    }
    transitionIds.add(id);
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
  if (!filled(metadata.slug)) return structural("metadata.json の slug が空かプレースホルダのまま");
  const probeVersion = field(capture.tools, "motion_probe_version");
  if (!filled(probeVersion)) {
    return structural(
      "capture.tools.motion_probe_version が空（どの版のプローブで採った時系列かを照合できない）",
    );
  }

  // 母集合: 遷移 × インスタンスから、宣言済みの到達できない遷移を除いたもの。
  /** @type {Map<string, { transition: string, instance: string }>} */
  const population = new Map();
  /** @type {Set<string>} */
  const unreachable = new Set();
  for (const { id: instanceId, record: inst } of instanceRecords) {
    if (inst.unreachable_motions !== undefined && !isArray(inst.unreachable_motions)) {
      findings.push({
        code: "unreachable-declaration-invalid",
        instance: instanceId,
        detail: "unreachable_motions が配列でない",
      });
    }
    const list = isArray(inst.unreachable_motions) ? inst.unreachable_motions : [];
    for (const u of list) {
      const tr = field(u, "transition");
      if (!nonEmptyString(tr) || !transitionIds.has(tr)) {
        findings.push({
          code: "unreachable-declaration-invalid",
          instance: instanceId,
          transition: tr ?? null,
          detail: "列挙に無い遷移を到達できないと宣言している",
        });
        continue;
      }
      if (!filled(field(u, "reason"))) {
        findings.push({
          code: "unreachable-declaration-invalid",
          instance: instanceId,
          transition: tr,
          detail: "到達できない理由が無いかプレースホルダのまま（除外として扱わない）",
        });
        continue;
      }
      unreachable.add(cellKey(tr, instanceId));
    }
    for (const tr of transitionIds) {
      const key = cellKey(tr, instanceId);
      if (unreachable.has(key)) {
        counts.not_compared += 1;
        continue;
      }
      population.set(key, { transition: tr, instance: instanceId });
    }
  }
  counts.cells = population.size;

  // 現行側: 各組み合わせに、比較に使える時系列の要約を 2 つ（基準と揺れ）。
  /** @type {Map<string, [MotionSummary, MotionSummary] | undefined>} */
  const baseline = new Map();
  for (const id of instanceIds) {
    const raw = motions[id];
    if (raw === null || raw === undefined) continue;
    // オブジェクトでない値は空の表として読む。どの欄も undefined になるので、直後の instance の照合で不一致として報告する。
    /** @type {Record<string, unknown>} */
    const doc = isObjectLike(raw) ? raw : {};
    if (doc.instance !== id) {
      findings.push({
        code: "motion-baseline-instance-mismatch",
        instance: id,
        detail: `motions.json の instance が ${JSON.stringify(doc.instance)}`,
      });
      continue;
    }
    const results = isArray(doc.results) ? doc.results : [];
    for (const r of results) {
      const tr = field(r, "transition");
      const key = nonEmptyString(tr) ? cellKey(tr, id) : null;
      if (key === null || !population.has(key)) {
        findings.push({
          code: "motion-baseline-unknown",
          instance: id,
          transition: tr ?? null,
          detail:
            key !== null && unreachable.has(key)
              ? "到達できないと宣言した遷移に時系列がある"
              : "列挙に無い遷移の時系列",
        });
        continue;
      }
      if (baseline.has(key)) {
        findings.push({ code: "motion-baseline-duplicate", instance: id, transition: tr });
        continue;
      }
      const declaredRuns = field(r, "runs");
      const runs = isArray(declaredRuns) ? declaredRuns : [];
      /** @type {MotionSummary[]} */
      const summaries = [];
      for (const [index, run] of runs.entries()) {
        const read = summarizeTimeline(run);
        if (!read.ok) {
          findings.push({
            code: "motion-timeline-invalid",
            side: "current",
            instance: id,
            transition: tr,
            run: index,
            detail: read.reason,
          });
          continue;
        }
        if (read.summary.probe_version !== probeVersion) {
          findings.push({
            code: "motion-probe-version-mismatch",
            side: "current",
            instance: id,
            transition: tr,
            run: index,
            detail: `probe_version ${JSON.stringify(read.summary.probe_version)}（記録は ${JSON.stringify(probeVersion)}）`,
          });
          continue;
        }
        summaries.push(read.summary);
      }
      if (summaries.length < 2) {
        findings.push({
          code: "motion-noise-missing",
          instance: id,
          transition: tr,
          detail: `比較に使える現行の時系列が ${summaries.length} 回分（揺れを測るには同じ条件で 2 回以上要る）`,
        });
        baseline.set(key, undefined);
        continue;
      }
      // 遷移に入れるのは、プローブが採れる動き（矩形か実効の不透明度が変わるもの）だけである。そのため、現行で一度も
      // 変化しなかったのは、プローブが動きを捉えていない疑いが濃い（アニメーションを止めたまま採った、セレクタが
      // 静止した別の要素に当たった、など）。ソースに宣言の無い、実機でだけ見つかった動きも同じく失敗にする。
      // 基準にすると、新側も動かなければ「動きなし」同士で一致してしまう。
      if (!summaries[0].changed) {
        findings.push({
          code: "motion-baseline-static",
          instance: id,
          transition: tr,
          detail:
            "現行の時系列が一度も変化していない（止めたまま採った・別の要素を探した疑い。色だけの動きのようにプローブで採れない動きなら、遷移に入れず gaps.md へ残す）",
        });
        baseline.set(key, undefined);
        continue;
      }
      // 揺れは最初の 2 回の差から測る（3 回目以降は使わない）。
      const unstable = baselineInstability(summaries[0], summaries[1]);
      if (unstable.length > 0) {
        // 現行の 2 回で在る／無い・動く／動かないが割れた・揺れが上限を超えたなら、どちらを基準にするかを決められない。
        findings.push({
          code: "motion-baseline-unstable",
          instance: id,
          transition: tr,
          detail: `現行の 2 回で ${unstable.join(" / ")} が割れた（遷移の手順か初期状態が揃っていない）`,
        });
        baseline.set(key, undefined);
        continue;
      }
      baseline.set(key, [summaries[0], summaries[1]]);
    }
  }
  for (const [key, cell] of population) {
    if (!baseline.has(key)) {
      findings.push({
        code: "motion-baseline-missing",
        instance: cell.instance,
        transition: cell.transition,
        detail: "現行の時系列が無い（到達できないなら unreachable_motions に理由付きで宣言する）",
      });
    }
  }

  if (comparison === null || comparison === undefined) {
    findings.push({
      code: "comparison-missing",
      detail: "突き合わせ表が無い・読めない（全組み合わせを未突合として数える）",
    });
    counts.uncompared = population.size;
    return { structural: false, judged: true, findings, counts };
  }
  // オブジェクトでない値は空の表として読む。どの欄も undefined になるので、直後の target の照合で不一致として報告する。
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
    const tr = field(row, "transition");
    const inst = field(row, "instance");
    const key = nonEmptyString(tr) && nonEmptyString(inst) ? cellKey(tr, inst) : null;
    if (key === null || !population.has(key)) {
      findings.push({
        code: "motion-unbaselined",
        transition: tr ?? null,
        instance: inst ?? null,
        detail: "母集合に無い組み合わせの突き合わせ（照合相手の基準が無い）",
      });
      continue;
    }
    if (seen.has(key)) {
      findings.push({ code: "motion-duplicate-row", transition: tr, instance: inst });
      continue;
    }
    seen.add(key);
    const disposition = field(row, "disposition") ?? null;
    if (disposition !== null) {
      // DISPOSITIONS は文字列だけなので、typeof は型を絞るためだけにある（判定は変わらない）。
      if (typeof disposition !== "string" || !DISPOSITIONS.includes(disposition)) {
        findings.push({
          code: "motion-disposition-invalid",
          transition: tr,
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
          code: "motion-acceptance-unapproved",
          transition: tr,
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
    if (!filled(field(row, "story"))) {
      findings.push({
        code: "motion-story-missing",
        transition: tr,
        instance: inst,
        detail: "動きを採った見本の識別子（story）が空かプレースホルダのまま",
      });
      counts.uncompared += 1;
      continue;
    }
    const read = summarizeTimeline(field(row, "timeline"));
    if (!read.ok) {
      findings.push({
        code: "motion-timeline-invalid",
        side: "new",
        transition: tr,
        instance: inst,
        detail: read.reason,
      });
      counts.uncompared += 1;
      continue;
    }
    if (read.summary.probe_version !== probeVersion) {
      findings.push({
        code: "motion-probe-version-mismatch",
        side: "new",
        transition: tr,
        instance: inst,
        detail: `probe_version ${JSON.stringify(read.summary.probe_version)}（現行は ${JSON.stringify(probeVersion)}）`,
      });
      counts.uncompared += 1;
      continue;
    }
    const pair = baseline.get(key);
    if (pair === undefined) {
      counts.uncompared += 1;
      continue;
    }
    const verdict = judgeMotion(pair[0], pair[1], read.summary);
    if (verdict.differing.length > 0) {
      counts.mismatched += 1;
      findings.push({
        code: "motion-mismatch",
        transition: tr,
        instance: inst,
        differing: verdict.differing,
      });
      continue;
    }
    counts.matched += 1;
  }
  for (const [key, cell] of population) {
    if (!seen.has(key)) {
      counts.uncompared += 1;
      findings.push({
        code: "motion-uncompared",
        transition: cell.transition,
        instance: cell.instance,
      });
    }
  }
  if (population.size === 0) {
    findings.push({
      code: "motion-nothing-compared",
      detail: "全組み合わせが到達できないと宣言されており、比べた遷移が 0 件",
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
    write(`${JSON.stringify({ tool: "motion-compare", version: VERSION, ...obj }, null, 2)}\n`);
  const usage =
    "usage: motion-compare.mjs --baseline <部品の成果物ディレクトリ> --comparison <new/<target>/motion-comparison.json> --target <name>";
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
    if (!nonEmptyString(args[key])) return fail(`${key} は必須（空白だけの値も不可）`);
  }
  let loaded;
  try {
    loaded = loadBaseline(resolve(cwd, args["--baseline"]), "motions.json");
  } catch (error) {
    return fail(`採取物を読めない: ${field(error, "message")}`);
  }
  let comparison = null;
  try {
    comparison = JSON.parse(readFileSync(resolve(cwd, args["--comparison"]), "utf8"));
  } catch {
    comparison = null;
  }
  const result = compareMotions({
    metadata: loaded.metadata,
    motions: loaded.byInstance,
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
  process.exitCode = main(process.argv.slice(2));
}
