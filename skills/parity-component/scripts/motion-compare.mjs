#!/usr/bin/env node
// 部品の動き（出し入れ・開閉のアニメーション）を現行とカタログで突き合わせる検査（正本）。Issue #456。
//
// 何のためか: 見た目の照合は `animations: "disabled"` で止めて撮るので、現行の部品が持つ動きは
// 採取物にも見本の照合にも写らない。新側が動きを持たないまま（即時に出る・消える）、部品の照合・
// パリティスイート・parity-diff がすべて緑になり、利用者が画面を触って初めて気づいた（Issue #456 の実例）。
//
// そこで capture が現行で採った時系列（`baseline/<instance>/motions.json`。同梱の motion-probe.mjs の出力を
// 同じ条件で 2 回以上）と、build がカタログの見本で同じ操作をして採った時系列
// （`new/<target>/motion-comparison.json`）を、**遷移 × インスタンス**の組み合わせごとに比べる。
// 比べるのは次の数値で、画素は比べない。
//   - 在るか（操作の前と、落ち着いた後）: 一致を要求する（出る動きが消える動きになっていないか）
//   - 始まるまでの遅れ（操作から最初の変化まで）と長さ（最初の変化から最後の変化まで）
//   - 軌跡: 最初の変化からの経過時間ごとの、基準の矩形からのずれ（x / y / width / height）と実効の不透明度。
//     基準の矩形は「落ち着いた後に在ればその矩形、無ければ操作の前の矩形」。現行のページとカタログでは
//     部品の置き場所が違うので、絶対座標は比べない
//
// 許容差は測った揺れから決める: 現行の 1 回目と 2 回目の差（ノイズ）の NOISE_FACTOR 倍と、下限 FLOORS の大きい方。
// フレームの刻み（約 16.7ms）と操作が届くまでの遅れで、同じ実装でも値は揺れる（Issue #456 の実測で、
// 動きを揃えた後も位置の差は最大 6.1px 残った）。揺れを測らずに固定の許容差を置くと、
// 厳しすぎて永久に落ちるか、緩すぎて動きの欠落まで通すかのどちらかになる。
//
// fail-closed の方針（behavior-compare.mjs と同じ形）:
//   - 動きの列挙（`capture.motions`）が無いのは「動きが無い」と区別できないので型崩れとして落とす。
//     動きの無い部品は `transitions` を空にし `none_reason` に理由を書く（その場合だけ判定しない）
//   - 到達できない遷移は `instances[].unreachable_motions` の宣言だけが除外の根拠。宣言の無い欠落は未採取
//   - 現行の時系列が 2 回分に満たないと揺れを測れないので、比べずに落とす
//   - 打ち切り（timed_out）・要素が一度も在らなかった時系列は、終わりや対象を見ていないので比較に使わない
//   - 突き合わせ表が無い・母集合に無い行・承認の無い accepted は behavior-compare.mjs と同じ扱い
//
// 決定論的: 乱数・現在時刻・ネットワークに依存しない。読むのは JSON だけで、ブラウザは駆動しない。
//
// 使い方: node motion-compare.mjs --baseline <部品の成果物ディレクトリ> --comparison <突き合わせ表> --target <new target 名>
// 終了コード: 0 ＝ 条件を満たす（判定しない場合を含む）、1 ＝ 未突合・不一致・記録の不備が残る、2 ＝ 使い方の誤り・型崩れ。

import { readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// 共通の判定（記入済みか・承認日時・鍵・パスの 1 セグメント）は behavior-compare.mjs と同じものを使う。
// 静的な `./behavior-compare.mjs` の import は、このファイルへのシンボリックリンクを
// `--preserve-symlinks-main` で起動するとリンク側のディレクトリで解決されて見つからない（実測）。
// 実パスに解決したディレクトリから読む。
const { cellKey, filled, isoDateTime, nonEmptyString, safeSegment } = await import(
  pathToFileURL(join(dirname(realpathSync(fileURLToPath(import.meta.url))), "behavior-compare.mjs"))
    .href
);

/** ツールのバージョン（正本）。判定規則・許容差・出力形状を変えたら上げる。 */
export const VERSION = "1";

/** 突き合わせ表の行が取れる扱いの語彙（正本）。null は「比べた」。 */
export const DISPOSITIONS = ["accepted"];

/** 変化とみなす最小の差（正本は motion-probe.mjs の CHANGE_EPSILON。同じ値にする）。 */
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

/** 軌跡で比べる量。dx / dy / dw / dh は基準の矩形からのずれ（px）、opacity は実効の不透明度。 */
const TRAJECTORY_METRICS = ["dx", "dy", "dw", "dh", "opacity"];

/**
 * 2 つの標本が違うか（motion-probe.mjs のページ側の判定と同じ）。
 * @param {any} a
 * @param {any} b
 * @returns {boolean}
 */
function differs(a, b) {
  if (a.present !== b.present) return true;
  if (!a.present) return false;
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
 * @param {any} timeline motion-probe.mjs の出力
 * @returns {{ ok: true, summary: object } | { ok: false, reason: string }}
 */
export function summarizeTimeline(timeline) {
  if (timeline === null || typeof timeline !== "object" || Array.isArray(timeline)) {
    return { ok: false, reason: "時系列がオブジェクトでない" };
  }
  if (timeline.timed_out !== false) {
    return {
      ok: false,
      reason: "打ち切られた時系列（timed_out が false でない。終わりを見ていない）",
    };
  }
  const samples = timeline.samples;
  if (!Array.isArray(samples) || samples.length === 0) {
    return { ok: false, reason: "samples が空" };
  }
  let previousT = -Infinity;
  for (const s of samples) {
    if (s === null || typeof s !== "object" || typeof s.present !== "boolean") {
      return { ok: false, reason: "標本の present が真偽値でない" };
    }
    if (!Number.isFinite(s.t) || s.t < previousT) {
      return { ok: false, reason: "標本の t が有限の非減少列でない" };
    }
    previousT = s.t;
    if (s.present) {
      for (const key of ["x", "y", "width", "height", "opacity"]) {
        if (!Number.isFinite(s[key])) {
          return { ok: false, reason: `在る標本の ${key} が有限の数でない` };
        }
      }
    }
  }
  const first = samples[0];
  const last = samples[samples.length - 1];
  const reference = last.present ? last : first.present ? first : samples.find((s) => s.present);
  if (!reference) {
    return { ok: false, reason: "要素が一度も在らなかった（セレクタが対象を引けていない疑い）" };
  }
  let firstChange = null;
  let lastChange = null;
  for (let i = 1; i < samples.length; i += 1) {
    if (differs(samples[i - 1], samples[i])) {
      if (firstChange === null) firstChange = i;
      lastChange = i;
    }
  }
  // 最初の変化の直前の標本を起点にする（変化はその次のフレームで初めて見えるため）。
  const originIndex = firstChange === null ? 0 : firstChange - 1;
  const origin = samples[originIndex].t;
  const series = samples.slice(originIndex).map((s) => ({
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
      delay_ms: firstChange === null ? null : samples[originIndex].t - first.t,
      duration_ms: firstChange === null ? 0 : samples[lastChange].t - origin,
      series,
    },
  };
}

/**
 * 系列のある時刻の値（前後の標本の線形補間。どちらかが無ければ null）。終わりより後は最後の値を保つ。
 * @param {object[]} series
 * @param {number} t
 * @param {string} metric
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
 * @param {any} a
 * @param {any} b
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
 * 現行の 2 回（基準・揺れ）と新側 1 回を比べ、許容差を超えた量を返す。
 * @param {any} base 現行の 1 回目の要約
 * @param {any} noise 現行の 2 回目の要約
 * @param {any} candidate 新側の要約
 * @returns {{ unstable: string[], differing: object[] }}
 */
export function judgeMotion(base, noise, candidate) {
  const unstable = [];
  for (const key of ["present_start", "present_end", "changed"]) {
    if (base[key] !== noise[key]) unstable.push(key);
  }
  for (const key of ["delay_ms", "duration_ms"]) {
    const limit = Math.max(MAX_NOISE.ms, MAX_NOISE.ratio * (base[key] ?? 0));
    if (timeGap(base[key], noise[key]) > limit) unstable.push(key);
  }
  const noiseGapForLimit = trajectoryGap(base, noise);
  for (const metric of TRAJECTORY_METRICS) {
    const limit = metric === "opacity" ? MAX_NOISE.opacity : MAX_NOISE.px;
    if (noiseGapForLimit[metric] > limit) unstable.push(`trajectory.${metric}`);
  }
  const differing = [];
  for (const key of ["present_start", "present_end"]) {
    if (base[key] !== candidate[key]) {
      differing.push({ measure: key, current: base[key], new: candidate[key], tolerance: 0 });
    }
  }
  for (const [key, floor] of [
    ["delay_ms", FLOORS.delay_ms],
    ["duration_ms", FLOORS.duration_ms],
  ]) {
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
  return { unstable, differing };
}

/**
 * 動きを突き合わせる（純関数）。
 *
 * @param {{ metadata: any, motions: Record<string, any>, comparison: any, target: string }} input
 *   - metadata: capture の `metadata.json`
 *   - motions: インスタンス id → `baseline/<id>/motions.json` の中身（読めなければ null）
 *   - comparison: `new/<target>/motion-comparison.json` の中身（読めなければ null）
 *   - target: 判定対象の new target 名
 * @returns {{ structural: boolean, judged: boolean, findings: object[], counts: Record<string, number> }}
 */
export function compareMotions({ metadata, motions, comparison, target }) {
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

  const declared = metadata && metadata.capture && metadata.capture.motions;
  if (declared === null || typeof declared !== "object" || Array.isArray(declared)) {
    return structural(
      "metadata.json の capture.motions が無い（動きが無いのか数えていないのか区別できない）",
    );
  }
  if (!Array.isArray(declared.source_scan)) {
    return structural(
      "capture.motions.source_scan が配列でない（現行のソースで動きを数えた記録が無い）",
    );
  }
  const transitions = declared.transitions;
  if (!Array.isArray(transitions)) {
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
    (Array.isArray(metadata.capture.operations) ? metadata.capture.operations : []).map(
      (op) => op && op.id,
    ),
  );
  /** @type {Set<string>} */
  const transitionIds = new Set();
  for (const tr of transitions) {
    const id = tr && tr.id;
    if (!filled(id))
      return structural("capture.motions.transitions[].id が空かプレースホルダのまま");
    if (transitionIds.has(id)) return structural(`capture.motions.transitions[].id が重複: ${id}`);
    // 手順が無いと、capture と build が同じ id で別の操作から動きを起こしても通る。
    if (!filled(tr.description) || !filled(tr.trigger)) {
      return structural(
        `capture.motions.transitions[${JSON.stringify(id)}] の description / trigger が空かプレースホルダのまま（両側で同じ操作を再生できない）`,
      );
    }
    if (tr.on_complete !== undefined) {
      if (!Array.isArray(tr.on_complete) || !tr.on_complete.every((op) => operationIds.has(op))) {
        return structural(
          `capture.motions.transitions[${JSON.stringify(id)}].on_complete は capture.operations の id の配列（動きの完了で始まる処理は操作として列挙する）`,
        );
      }
    }
    transitionIds.add(id);
  }
  const instances = metadata.instances;
  if (!Array.isArray(instances) || instances.length === 0) {
    return structural("metadata.json の instances が空");
  }
  const instanceIds = [];
  for (const inst of instances) {
    const id = inst && inst.id;
    if (!filled(id)) return structural("instances[].id が空かプレースホルダのまま");
    if (instanceIds.includes(id)) return structural(`instances[].id が重複: ${id}`);
    instanceIds.push(id);
  }
  if (!nonEmptyString(target)) return structural("--target が空");
  if (!filled(metadata.slug)) return structural("metadata.json の slug が空かプレースホルダのまま");
  const probeVersion = metadata.capture.tools && metadata.capture.tools.motion_probe_version;
  if (!filled(probeVersion)) {
    return structural(
      "capture.tools.motion_probe_version が空（どの版の探針で採った時系列かを照合できない）",
    );
  }

  // 母集合: 遷移 × インスタンスから、宣言済みの到達できない遷移を除いたもの。
  /** @type {Map<string, { transition: string, instance: string }>} */
  const population = new Map();
  /** @type {Set<string>} */
  const unreachable = new Set();
  for (const inst of instances) {
    if (inst.unreachable_motions !== undefined && !Array.isArray(inst.unreachable_motions)) {
      findings.push({
        code: "unreachable-declaration-invalid",
        instance: inst.id,
        detail: "unreachable_motions が配列でない",
      });
    }
    const list = Array.isArray(inst.unreachable_motions) ? inst.unreachable_motions : [];
    for (const u of list) {
      const tr = u && u.transition;
      if (!nonEmptyString(tr) || !transitionIds.has(tr)) {
        findings.push({
          code: "unreachable-declaration-invalid",
          instance: inst.id,
          transition: tr ?? null,
          detail: "列挙に無い遷移を到達できないと宣言している",
        });
        continue;
      }
      if (!filled(u.reason)) {
        findings.push({
          code: "unreachable-declaration-invalid",
          instance: inst.id,
          transition: tr,
          detail: "到達できない理由が無いかプレースホルダのまま（除外として扱わない）",
        });
        continue;
      }
      unreachable.add(cellKey(tr, inst.id));
    }
    for (const tr of transitionIds) {
      const key = cellKey(tr, inst.id);
      if (unreachable.has(key)) {
        counts.not_compared += 1;
        continue;
      }
      population.set(key, { transition: tr, instance: inst.id });
    }
  }
  counts.cells = population.size;

  // 現行側: 各組み合わせに、比較に使える時系列の要約を 2 つ（基準と揺れ）。
  /** @type {Map<string, [object, object] | undefined>} */
  const baseline = new Map();
  for (const id of instanceIds) {
    const doc = motions[id];
    if (doc === null || doc === undefined) continue;
    if (doc.instance !== id) {
      findings.push({
        code: "motion-baseline-instance-mismatch",
        instance: id,
        detail: `motions.json の instance が ${JSON.stringify(doc.instance)}`,
      });
      continue;
    }
    const results = Array.isArray(doc.results) ? doc.results : [];
    for (const r of results) {
      const tr = r && r.transition;
      const key = nonEmptyString(tr) ? cellKey(tr, id) : null;
      if (key === null || !population.has(key)) {
        findings.push({
          code: "motion-baseline-unknown",
          instance: id,
          transition: tr ?? null,
          detail: unreachable.has(key)
            ? "到達できないと宣言した遷移に時系列がある"
            : "列挙に無い遷移の時系列",
        });
        continue;
      }
      if (baseline.has(key)) {
        findings.push({ code: "motion-baseline-duplicate", instance: id, transition: tr });
        continue;
      }
      const runs = Array.isArray(r.runs) ? r.runs : [];
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
      // 遷移に入れるのは探針が採れる動き（矩形か実効の不透明度が変わるもの）だけなので、現行で一度も
      // 変化しなかったのは探針が動きを捉えていない疑いが濃い（アニメーションを止めたまま採った・セレクタが
      // 静止した別の要素に当たった）。ソースに宣言の無い、実機でだけ見つかった動きも同じく落とす——
      // 基準にすると、新側も動かなければ「動きなし」同士で一致してしまう。
      if (!summaries[0].changed) {
        findings.push({
          code: "motion-baseline-static",
          instance: id,
          transition: tr,
          detail:
            "現行の時系列が一度も変化していない（止めたまま採った・別の要素を引いた疑い。色だけの動きのように探針の射程外なら、遷移に入れず gaps.md へ残す）",
        });
        baseline.set(key, undefined);
        continue;
      }
      // 揺れは最初の 2 回の差から測る（3 回目以降は使わない）。
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
    const tr = row && row.transition;
    const inst = row && row.instance;
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
    const disposition = row.disposition ?? null;
    if (disposition !== null) {
      if (!DISPOSITIONS.includes(disposition)) {
        findings.push({
          code: "motion-disposition-invalid",
          transition: tr,
          instance: inst,
          detail: `disposition は null か ${DISPOSITIONS.join(" / ")}: ${JSON.stringify(disposition)}`,
        });
        counts.uncompared += 1;
        continue;
      }
      if (!filled(row.reason) || !filled(row.approved_by) || !isoDateTime(row.approved_at)) {
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
    if (!filled(row.story)) {
      findings.push({
        code: "motion-story-missing",
        transition: tr,
        instance: inst,
        detail: "動きを採った見本の識別子（story）が空かプレースホルダのまま",
      });
      counts.uncompared += 1;
      continue;
    }
    const read = summarizeTimeline(row.timeline);
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
    if (verdict.unstable.length > 0) {
      // 現行の 2 回で在る／無い・動く／動かないが割れたら、どちらを基準にするかを決められない。
      findings.push({
        code: "motion-baseline-unstable",
        transition: tr,
        instance: inst,
        detail: `現行の 2 回で ${verdict.unstable.join(" / ")} が割れた（遷移の手順か初期状態が揃っていない）`,
      });
      counts.uncompared += 1;
      continue;
    }
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
 * 部品の成果物ディレクトリから metadata.json と各インスタンスの motions.json を読む。
 * motions.json が無い・読めないインスタンスは null（未採取として判定側が数える）。
 * @param {string} dir
 * @returns {{ metadata: any, motions: Record<string, any> }}
 */
export function loadBaseline(dir) {
  const metadata = JSON.parse(readFileSync(join(dir, "metadata.json"), "utf8"));
  /** @type {Record<string, any>} */
  const motions = {};
  const instances = Array.isArray(metadata && metadata.instances) ? metadata.instances : [];
  const baselineRoot = resolve(dir, "baseline");
  for (const inst of instances) {
    const id = inst && inst.id;
    if (!safeSegment(id)) {
      throw new Error(`instances[].id がパスの 1 セグメントとして不正: ${JSON.stringify(id)}`);
    }
    const path = resolve(baselineRoot, id, "motions.json");
    let realPath;
    try {
      realPath = realpathSync(path);
    } catch {
      motions[id] = null;
      continue;
    }
    const rel = relative(realpathSync(baselineRoot), realPath);
    if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new Error(`採取物のパスが baseline の外を指す: ${path} → ${realPath}`);
    }
    try {
      motions[id] = JSON.parse(readFileSync(realPath, "utf8"));
    } catch {
      motions[id] = null;
    }
  }
  return { metadata, motions };
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
  const out = (obj) =>
    write(`${JSON.stringify({ tool: "motion-compare", version: VERSION, ...obj }, null, 2)}\n`);
  const usage =
    "usage: motion-compare.mjs --baseline <部品の成果物ディレクトリ> --comparison <new/<target>/motion-comparison.json> --target <name>";
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
    loaded = loadBaseline(resolve(cwd, args["--baseline"]));
  } catch (error) {
    return fail(`採取物を読めない: ${error && error.message}`);
  }
  let comparison = null;
  try {
    comparison = JSON.parse(readFileSync(resolve(cwd, args["--comparison"]), "utf8"));
  } catch {
    comparison = null;
  }
  const result = compareMotions({
    metadata: loaded.metadata,
    motions: loaded.motions,
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
  process.exitCode = main(process.argv.slice(2));
}
