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

import { isArray } from "./lib/is-array.mjs";

import {
  cellKey,
  judgeDisposition,
  readComparisonRows,
  runCompareCli,
  valueKind,
} from "./behavior-compare.mjs";
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
export const VERSION = "2";

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
 * 在る標本の量が有限の数でないときの、読めない理由。
 * @param {string} key
 * @returns {{ ok: false, reason: string }}
 */
function notFinite(key) {
  return { ok: false, reason: `在る標本の ${key} が有限の数でない` };
}

/**
 * 標本 1 件を検査し、検査を通った形を返す（読めなければ理由）。
 * @param {unknown} raw
 * @param {number} previousT 直前の標本の時刻（最初の標本では -Infinity）
 * @returns {{ ok: true, sample: MotionSample } | { ok: false, reason: string }}
 */
function checkSample(raw, previousT) {
  if (!isObjectLike(raw) || typeof raw.present !== "boolean") {
    return { ok: false, reason: "標本の present が真偽値でない" };
  }
  const t = raw.t;
  if (!isFiniteNumber(t) || t < previousT) {
    return { ok: false, reason: "標本の t が有限の非減少列でない" };
  }
  if (!raw.present) return { ok: true, sample: { t, present: false } };
  const { x, y, width, height, opacity } = raw;
  if (!isFiniteNumber(x)) return notFinite("x");
  if (!isFiniteNumber(y)) return notFinite("y");
  if (!isFiniteNumber(width)) return notFinite("width");
  if (!isFiniteNumber(height)) return notFinite("height");
  if (!isFiniteNumber(opacity)) return notFinite("opacity");
  return { ok: true, sample: { t, present: true, x, y, width, height, opacity } };
}

/**
 * 標本の列を検査する。最初に読めなかった標本の理由で止める。
 * @param {unknown[]} samples
 * @returns {{ ok: true, checked: MotionSample[] } | { ok: false, reason: string }}
 */
function checkSamples(samples) {
  /** @type {MotionSample[]} 検査を通った標本（並びは samples のまま） */
  const checked = [];
  let previousT = -Infinity;
  for (const raw of samples) {
    const read = checkSample(raw, previousT);
    if (!read.ok) return read;
    checked.push(read.sample);
    previousT = read.sample.t;
  }
  return { ok: true, checked };
}

/**
 * 直前の標本と違う標本のうち、最初と最後の位置を返す（変化が無ければ両方 null）。
 * @param {MotionSample[]} checked
 * @returns {{ firstChange: number | null, lastChange: number | null }}
 */
function findChanges(checked) {
  let firstChange = null;
  let lastChange = null;
  for (let i = 1; i < checked.length; i += 1) {
    if (differs(checked[i - 1], checked[i])) {
      if (firstChange === null) firstChange = i;
      lastChange = i;
    }
  }
  return { firstChange, lastChange };
}

/**
 * 起点からの標本を、起点からの時刻と基準の矩形からのずれの列にする。
 * @param {MotionSample[]} fromOrigin 起点（最初の変化の直前の標本）から後の標本
 * @param {{ x: number, y: number, width: number, height: number }} reference 基準の矩形
 * @returns {MotionPoint[]}
 */
function toSeries(fromOrigin, reference) {
  const origin = fromOrigin[0].t;
  return fromOrigin.map((s) => ({
    t: s.t - origin,
    present: s.present,
    dx: s.present ? s.x - reference.x : null,
    dy: s.present ? s.y - reference.y : null,
    dw: s.present ? s.width - reference.width : null,
    dh: s.present ? s.height - reference.height : null,
    opacity: s.present ? s.opacity : null,
  }));
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
  const read = checkSamples(samples);
  if (!read.ok) return read;
  const checked = read.checked;
  const first = checked[0];
  const last = checked[checked.length - 1];
  const reference = last.present ? last : first.present ? first : checked.find((s) => s.present);
  if (!reference) {
    return { ok: false, reason: "要素が一度も在らなかった（セレクタが対象を引けていない疑い）" };
  }
  const { firstChange, lastChange } = findChanges(checked);
  // 最初の変化の直前の標本を起点にする（変化はその次のフレームで初めて見えるため）。
  const originIndex = firstChange === null ? 0 : firstChange - 1;
  const origin = checked[originIndex].t;
  const series = toSeries(checked.slice(originIndex), reference);
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
 * metadata.json から読んだ動きの宣言（compareMotions が母集合と基準を組むのに使う）。
 * @typedef {{
 *   slug: unknown,
 *   transitionIds: Set<string>,
 *   instanceIds: string[],
 *   instanceRecords: { id: string, record: Record<string, unknown> }[],
 *   probeVersion: unknown,
 * }} MotionDeclaration
 */

/**
 * 突き合わせの途中の状態（compareMotions の各段が読み書きする）。
 * baseline の値が undefined の組み合わせは、時系列はあったが基準にできなかったもの。
 * @typedef {{
 *   findings: MotionFinding[],
 *   counts: MotionCounts,
 *   probeVersion: unknown,
 *   population: Map<string, { transition: string, instance: string }>,
 *   unreachable: Set<string>,
 *   baseline: Map<string, [MotionSummary, MotionSummary] | undefined>,
 * }} MotionContext
 */

/**
 * capture.motions の枠（source_scan・transitions・none_reason）を検査する。
 * @param {unknown} metadata
 * @returns {{ error: string } | { none: true } | { capture: Record<string, unknown>, transitions: unknown[] }}
 */
function readMotionsBlock(metadata) {
  const capture = field(metadata, "capture");
  const declared = field(capture, "motions");
  // declared がオブジェクトなら metadata と capture もオブジェクトなので、絞り込みを足しても判定は変わらない。
  if (!isObjectLike(metadata) || !isObjectLike(capture) || !isPlainObject(declared)) {
    return {
      error:
        "metadata.json の capture.motions が無い（動きが無いのか数えていないのか区別できない）",
    };
  }
  if (!isArray(declared.source_scan)) {
    return {
      error: "capture.motions.source_scan が配列でない（現行のソースで動きを数えた記録が無い）",
    };
  }
  const transitions = declared.transitions;
  if (!isArray(transitions)) {
    return { error: "capture.motions.transitions が配列でない" };
  }
  if (transitions.length === 0) {
    if (filled(declared.none_reason)) return { none: true };
    return {
      error:
        "capture.motions.transitions が空で none_reason も無い（動きが無いのか採っていないのか区別できない）",
    };
  }
  if (declared.none_reason !== null && declared.none_reason !== undefined) {
    return { error: "capture.motions は transitions と none_reason を同時に持てない" };
  }
  return { capture, transitions };
}

/**
 * 遷移の列挙を検査し、遷移の id の集合を返す（読めなければ理由）。
 * @param {unknown[]} transitions
 * @param {Record<string, unknown>} capture
 * @returns {{ error: string } | { ids: Set<string> }}
 */
function readTransitionIds(transitions, capture) {
  const operationIds = new Set(
    (isArray(capture.operations) ? capture.operations : []).map((op) => field(op, "id")),
  );
  /** @type {Set<string>} */
  const ids = new Set();
  for (const tr of transitions) {
    const id = field(tr, "id");
    if (!filled(id))
      return { error: "capture.motions.transitions[].id が空かプレースホルダのまま" };
    if (ids.has(id)) return { error: `capture.motions.transitions[].id が重複: ${id}` };
    // 手順が無いと、capture と build が同じ id で別の操作から動きを起こしても通る。
    if (!filled(field(tr, "description")) || !filled(field(tr, "trigger"))) {
      return {
        error: `capture.motions.transitions[${JSON.stringify(id)}] の description / trigger が空かプレースホルダのまま（両側で同じ操作を再生できない）`,
      };
    }
    const onComplete = field(tr, "on_complete");
    if (onComplete !== undefined) {
      if (!isArray(onComplete) || !onComplete.every((op) => operationIds.has(op))) {
        return {
          error: `capture.motions.transitions[${JSON.stringify(id)}].on_complete は capture.operations の id の配列（動きの完了で始まる処理は操作として列挙する）`,
        };
      }
    }
    ids.add(id);
  }
  return { ids };
}

/**
 * インスタンスの列挙を検査する（読めなければ理由）。
 * @param {unknown} instances
 * @returns {{ error: string } | { instanceIds: string[], instanceRecords: { id: string, record: Record<string, unknown> }[] }}
 */
function readInstances(instances) {
  if (!isArray(instances) || instances.length === 0) {
    return { error: "metadata.json の instances が空" };
  }
  /** @type {string[]} */
  const instanceIds = [];
  /** @type {{ id: string, record: Record<string, unknown> }[]} id を確かめたインスタンス（並びは instances のまま） */
  const instanceRecords = [];
  for (const inst of instances) {
    const id = field(inst, "id");
    if (!filled(id)) return { error: "instances[].id が空かプレースホルダのまま" };
    if (instanceIds.includes(id)) return { error: `instances[].id が重複: ${id}` };
    instanceIds.push(id);
    // id が文字列なら inst はオブジェクトなので、isObjectLike は型を絞るためだけにある（判定は変わらない）。
    if (isObjectLike(inst)) instanceRecords.push({ id, record: inst });
  }
  return { instanceIds, instanceRecords };
}

/**
 * metadata.json の動きの宣言と --target を検査する。
 * 動きの無い部品（transitions が空で none_reason がある）は none を返す。
 * @param {unknown} metadata
 * @param {string} target
 * @returns {{ error: string } | { none: true } | { declaration: MotionDeclaration }}
 */
function readMotionDeclaration(metadata, target) {
  const block = readMotionsBlock(metadata);
  if (!("capture" in block)) return block;
  const { capture } = block;
  const transitionRead = readTransitionIds(block.transitions, capture);
  if ("error" in transitionRead) return transitionRead;
  // readMotionsBlock が capture を返したなら metadata はオブジェクトなので、field で読んだ値は metadata.instances と同じ。
  const instanceRead = readInstances(field(metadata, "instances"));
  if ("error" in instanceRead) return instanceRead;
  if (!nonEmptyString(target)) return { error: "--target が空" };
  const slug = field(metadata, "slug");
  if (!filled(slug)) return { error: "metadata.json の slug が空かプレースホルダのまま" };
  const probeVersion = field(capture.tools, "motion_probe_version");
  if (!filled(probeVersion)) {
    return {
      error:
        "capture.tools.motion_probe_version が空（どの版のプローブで採った時系列かを照合できない）",
    };
  }
  return {
    declaration: {
      slug,
      transitionIds: transitionRead.ids,
      instanceIds: instanceRead.instanceIds,
      instanceRecords: instanceRead.instanceRecords,
      probeVersion,
    },
  };
}

/**
 * インスタンス 1 件の到達できない遷移の宣言を読み、除外する組み合わせを unreachable に足す。
 * 読めない宣言は指摘にし、除外しない。
 * @param {MotionContext} ctx
 * @param {{ id: string, record: Record<string, unknown> }} instance
 * @param {Set<string>} transitionIds
 */
function addUnreachable(ctx, { id: instanceId, record: inst }, transitionIds) {
  const { findings, unreachable } = ctx;
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
}

/**
 * 母集合（遷移 × インスタンスから、宣言済みの到達できない遷移を除いたもの）を組む。
 * @param {MotionContext} ctx
 * @param {MotionDeclaration} declaration
 */
function buildPopulation(ctx, declaration) {
  const { counts, population, unreachable } = ctx;
  for (const instance of declaration.instanceRecords) {
    addUnreachable(ctx, instance, declaration.transitionIds);
    for (const tr of declaration.transitionIds) {
      const key = cellKey(tr, instance.id);
      if (unreachable.has(key)) {
        counts.not_compared += 1;
        continue;
      }
      population.set(key, { transition: tr, instance: instance.id });
    }
  }
  counts.cells = population.size;
}

/**
 * 現行の 1 つの組み合わせの時系列（runs）を読み、比較に使える要約を返す。読めない時系列は指摘にして外す。
 * @param {MotionContext} ctx
 * @param {unknown} runs
 * @param {{ instance: string, transition: string }} cell
 * @returns {MotionSummary[]}
 */
function readBaselineRuns(ctx, runs, { instance: id, transition: tr }) {
  const { findings, probeVersion } = ctx;
  /** @type {MotionSummary[]} */
  const summaries = [];
  for (const [index, run] of (isArray(runs) ? runs : []).entries()) {
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
  return summaries;
}

/**
 * 現行の要約から基準（基準と揺れの 2 回）を決める。決められなければ指摘を足して undefined を返す。
 * @param {MotionContext} ctx
 * @param {MotionSummary[]} summaries
 * @param {{ instance: string, transition: string }} cell
 * @returns {[MotionSummary, MotionSummary] | undefined}
 */
function pickBaselinePair(ctx, summaries, { instance: id, transition: tr }) {
  const { findings } = ctx;
  if (summaries.length < 2) {
    findings.push({
      code: "motion-noise-missing",
      instance: id,
      transition: tr,
      detail: `比較に使える現行の時系列が ${summaries.length} 回分（揺れを測るには同じ条件で 2 回以上要る）`,
    });
    return undefined;
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
    return undefined;
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
    return undefined;
  }
  return [summaries[0], summaries[1]];
}

/**
 * motions.json の results の 1 件を、母集合の組み合わせの基準として登録する。
 * @param {MotionContext} ctx
 * @param {string} id インスタンスの id
 * @param {unknown} r results の 1 件
 */
function registerBaselineResult(ctx, id, r) {
  const { findings, population, unreachable, baseline } = ctx;
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
    return;
  }
  if (baseline.has(key)) {
    findings.push({ code: "motion-baseline-duplicate", instance: id, transition: tr });
    return;
  }
  // key が null でないなら tr は空でない文字列なので、String は型を絞るためだけにある。
  const cell = { instance: id, transition: String(tr) };
  const summaries = readBaselineRuns(ctx, field(r, "runs"), cell);
  baseline.set(key, pickBaselinePair(ctx, summaries, cell));
}

/**
 * 現行側の基準を組む。各組み合わせに、比較に使える時系列の要約を 2 つ（基準と揺れ）。
 * @param {MotionContext} ctx
 * @param {Record<string, unknown>} motions インスタンス id → motions.json の中身
 * @param {string[]} instanceIds
 */
function buildBaseline(ctx, motions, instanceIds) {
  const { findings, population, baseline } = ctx;
  for (const id of instanceIds) {
    const raw = motions[id];
    if (raw === null || raw === undefined) continue;
    // オブジェクトでない値は、instance の不一致として報告する。instance を書き忘れた採取物と見分けられるよう、値の型を書く。
    if (!isPlainObject(raw)) {
      findings.push({
        code: "motion-baseline-instance-mismatch",
        instance: id,
        detail: `motions.json がオブジェクトでない（${valueKind(raw)}）`,
      });
      continue;
    }
    const doc = raw;
    if (doc.instance !== id) {
      findings.push({
        code: "motion-baseline-instance-mismatch",
        instance: id,
        detail: `motions.json の instance が ${JSON.stringify(doc.instance)}`,
      });
      continue;
    }
    const results = isArray(doc.results) ? doc.results : [];
    for (const r of results) registerBaselineResult(ctx, id, r);
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
}

/**
 * 新側の時系列を読む。読めなければ指摘を足して null を返す。
 * @param {MotionContext} ctx
 * @param {unknown} row
 * @param {{ transition: unknown, instance: unknown }} cell
 * @returns {MotionSummary | null}
 */
function readCandidate(ctx, row, { transition: tr, instance: inst }) {
  const { findings, probeVersion } = ctx;
  if (!filled(field(row, "story"))) {
    findings.push({
      code: "motion-story-missing",
      transition: tr,
      instance: inst,
      detail: "動きを採った見本の識別子（story）が空かプレースホルダのまま",
    });
    return null;
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
    return null;
  }
  if (read.summary.probe_version !== probeVersion) {
    findings.push({
      code: "motion-probe-version-mismatch",
      side: "new",
      transition: tr,
      instance: inst,
      detail: `probe_version ${JSON.stringify(read.summary.probe_version)}（現行は ${JSON.stringify(probeVersion)}）`,
    });
    return null;
  }
  return read.summary;
}

/**
 * 比べる行（disposition が null の行）を、新側の時系列と現行の基準で判定して数える。
 * @param {MotionContext} ctx
 * @param {unknown} row
 * @param {{ key: string, transition: unknown, instance: unknown }} cell
 */
function judgeRow(ctx, row, { key, transition: tr, instance: inst }) {
  const { findings, counts, baseline } = ctx;
  const candidate = readCandidate(ctx, row, { transition: tr, instance: inst });
  const pair = baseline.get(key);
  if (candidate === null || pair === undefined) {
    counts.uncompared += 1;
    return;
  }
  const verdict = judgeMotion(pair[0], pair[1], candidate);
  if (verdict.differing.length > 0) {
    counts.mismatched += 1;
    findings.push({
      code: "motion-mismatch",
      transition: tr,
      instance: inst,
      differing: verdict.differing,
    });
    return;
  }
  counts.matched += 1;
}

/**
 * 突き合わせ表の行を 1 件ずつ母集合と照合して判定する。照合した組み合わせを seen に足す。
 * @param {MotionContext} ctx
 * @param {unknown[]} rows
 * @param {Set<string>} seen
 */
function judgeRows(ctx, rows, seen) {
  const { findings, population } = ctx;
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
      judgeDisposition({
        row,
        disposition,
        prefix: "motion",
        where: { transition: tr, instance: inst },
        ctx,
      });
      continue;
    }
    judgeRow(ctx, row, { key, transition: tr, instance: inst });
  }
}

/**
 * 突き合わせ表を母集合と照合する。表に無い組み合わせは未突合として数える。
 * @param {MotionContext} ctx
 * @param {unknown} comparison
 * @param {{ target: string, slug: unknown }} expected
 */
function judgeComparison(ctx, comparison, expected) {
  const { findings, counts, population } = ctx;
  const rows = readComparisonRows({
    comparison,
    target: expected.target,
    slug: expected.slug,
    findings: ctx.findings,
  });
  /** @type {Set<string>} */
  const seen = new Set();
  judgeRows(ctx, rows, seen);
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
  const read = readMotionDeclaration(metadata, target);
  if ("error" in read) {
    return {
      structural: true,
      judged: false,
      findings: [{ code: "structural", detail: read.error }],
      counts,
    };
  }
  if ("none" in read) return { structural: false, judged: false, findings, counts };
  const { declaration } = read;
  /** @type {MotionContext} */
  const ctx = {
    findings,
    counts,
    probeVersion: declaration.probeVersion,
    population: new Map(),
    unreachable: new Set(),
    baseline: new Map(),
  };
  buildPopulation(ctx, declaration);
  buildBaseline(ctx, motions, declaration.instanceIds);

  if (comparison === null || comparison === undefined) {
    findings.push({
      code: "comparison-missing",
      detail: "突き合わせ表が無い・読めない（全組み合わせを未突合として数える）",
    });
    counts.uncompared = ctx.population.size;
    return { structural: false, judged: true, findings, counts };
  }
  judgeComparison(ctx, comparison, { target, slug: declaration.slug });
  return { structural: false, judged: true, findings, counts };
}

/**
 * CLI 本体。
 * @param {string[]} argv
 * @param {{ cwd?: string, write?: (s: string) => void, writeErr?: (s: string) => void }} [io]
 * @returns {number} 終了コード
 */
export function main(argv, io = {}) {
  return runCompareCli(argv, io, {
    tool: "motion-compare",
    version: VERSION,
    usage:
      "usage: motion-compare.mjs --baseline <部品の成果物ディレクトリ> --comparison <new/<target>/motion-comparison.json> --target <name>",
    fileName: "motions.json",
    judge: ({ metadata, byInstance, comparison, target }) =>
      compareMotions({ metadata, motions: byInstance, comparison, target }),
  });
}

if (isCliEntry(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
