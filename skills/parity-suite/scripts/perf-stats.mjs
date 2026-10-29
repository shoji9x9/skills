// 性能のベースラインとノイズ基準値の集計と、新側との比較（原本）。
//
// 何のためか: 画素・特性照合・aria の 3 つの比較方法は、見た目と振る舞いしか比べない。
// 新側だけが目に見えて遅い・読み込み中にレイアウトが揺れる、という回帰はどれにも表れない。
// 性能の値は実行ごとにぶれるので、単発の値の比較では判定にできない。そこで、同じ条件で N 回測った分布を
// 現側の基準とし、ノイズの幅（四分位範囲と、指標ごとの下限の大きい方）を超えた悪化だけを回帰として数える。
//
// サブコマンドは 2 つある。
//   summarize: 現側の採取（perf-samples.json）を集計し、metadata.json の performance に書く（parity-suite の手順 6）。
//   compare:   新側の採取を、metadata.json の performance と比べる（parity-diff の手順 4）。
// parity-diff は、インストールした parity-suite から同じスクリプトを compare で呼ぶ。プロジェクトへコピーしない。
//
// 採取（Playwright で N 回読み込んで LCP・CLS・TBT 相当・TTFB を読む）は、同梱の雛形
// assets/perf-capture.spec.template.ts から起こしたスペックが行う。このスクリプトはブラウザを駆動しない。
//
// 決定論的: 乱数・現在時刻・ネットワークに依存しない。TypeScript 構文は使わない（型は JSDoc）。
//
// 終了コード: 0 ＝ 条件を満たす、1 ＝ 回帰・判定できない組・環境の不一致・古い基準が残る、2 ＝ 使い方の誤り・入力の型の誤り。

import { createHash } from "node:crypto";
import { readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { isAbsolute, resolve, sep } from "node:path";
import { isArray } from "./lib/is-array.mjs";
import { isCliEntry } from "./lib/cli.mjs";
import { errorMessage } from "./lib/errors.mjs";
import { parseFlags } from "./lib/flags.mjs";
import { isPlainObject, nonEmptyString, nonNegativeNumber } from "./lib/guards.mjs";

/**
 * ツールのバージョン（原本）。判定規則・出力の形を変えたら上げる。
 * @type {string}
 */
export const VERSION = "2";

/** 採取の形式のバージョン。雛形の `PERF_SAMPLES_VERSION` と同じ値にする。 */
export const SAMPLES_VERSION = "1";

/** 比べる指標。`lcp`・`tbt`・`ttfb` はミリ秒、`cls` は単位の無いスコアである。 */
export const METRICS = ["lcp", "cls", "tbt", "ttfb"];

/**
 * 指標ごとの許容幅の絶対の下限（デフォルト）。四分位範囲が 0 に近い環境で、1ms の差まで回帰にしないための値である。
 * summarize の `--floor <指標>=<値>` で上書きでき、使った値は metadata.json の performance.floors に残る。
 * `--floor` を省いた指標は、記録した前の下限を引き継ぐ（初めての集計だけデフォルト。baseFloors を参照）。
 * 下限を変えた summarize は performance.floor_history に追記する（floorHistory を参照）。
 * @type {Record<string, number>}
 */
export const DEFAULT_FLOORS = { lcp: 100, cls: 0.01, tbt: 50, ttfb: 50 };

/**
 * 指標ごとの許容幅の、現側の中央値に対する割合の下限（デフォルト）。
 * 絶対値だけだと、重いページ（LCP 1,000ms など）で 1 割の差まで回帰になる。値の大きさに合わせて許容幅を広げる。
 * CLS は 0 付近に集まるスコアで、割合では幅が出ないので 0 にする。
 * summarize の `--relative-floor <指標>=<割合>` で上書きでき、使った値は performance.relative_floors に残る。
 * @type {Record<string, number>}
 */
export const DEFAULT_RELATIVE_FLOORS = { lcp: 0.2, cls: 0, tbt: 0.2, ttfb: 0.2 };

/** 1 組あたりに要る測定の回数の下限（ウォームアップを除く）。 */
export const MIN_RUNS = 5;

/**
 * 現側と新側で一致を求める環境の項目。どれかが違えば、差が実装の差か環境の差かを切り分けられない。
 * target_placement は対象の置き場所（loopback か remote）で、違えばネットワークの遅れが TTFB・LCP に入る。
 * context_options はコンテキストの設定（locale・userAgent など）で、違えば別の内容や描画を測る。
 * launch_options はブラウザの起動の設定（args・executablePath など）で、違えば描画や負荷が変わる。
 */
export const ENVIRONMENT_KEYS = [
  "browser_name",
  "browser_version",
  "channel",
  "headless",
  "runner.platform",
  "runner.arch",
  "runner.cpu_model",
  "runner.cpu_count",
  "target_placement",
  "context_options",
  "launch_options",
];

/** target_placement がとる値。loopback は localhost・127.0.0.0/8・::1 だけを指す。 */
export const TARGET_PLACEMENTS = ["loopback", "remote"];

/** 組の鍵の区切り。ページ名・ビューポートの label にこの文字は使えない。 */
export const KEY_SEPARATOR = "|";

/** 現側と新側で一致を求める測り方の項目。`runs` は両側が下限以上なら違ってよい。 */
export const SETTINGS_KEYS = ["warmup", "settle_ms", "cache", "workers"];

class UsageError extends Error {}

/**
 * @param {unknown} v
 * @returns {v is number | null}
 */
function isNumberOrNull(v) {
  return typeof v === "number" || v === null;
}

/**
 * ドット区切りのパスで値を取る。
 * @param {unknown} obj
 * @param {string} path
 * @returns {unknown}
 */
function getPath(obj, path) {
  /** @type {unknown} */
  let cur = obj;
  for (const part of path.split(".")) {
    if (!isPlainObject(cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}

/**
 * 分位数（線形補間。R の type 7 と同じ）。`sorted` は昇順で、空でないこと。
 * @param {number[]} sorted
 * @param {number} q - 0〜1
 * @returns {number}
 */
export function quantile(sorted, q) {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * 1 つの指標の値の列を集計する。`null` は値の無い回（LCP の候補が出なかった回）として数える。
 * @param {(number|null)[]} values
 * @returns {{ n:number, nulls:number, median:(number|null), p25:(number|null), p75:(number|null), iqr:(number|null), min:(number|null), max:(number|null) }}
 */
export function summarizeValues(values) {
  const nums = values.filter((v) => v !== null).sort((a, b) => a - b);
  const nulls = values.length - nums.length;
  if (nums.length === 0) {
    return {
      n: values.length,
      nulls,
      median: null,
      p25: null,
      p75: null,
      iqr: null,
      min: null,
      max: null,
    };
  }
  const p25 = quantile(nums, 0.25);
  const p75 = quantile(nums, 0.75);
  return {
    n: values.length,
    nulls,
    median: quantile(nums, 0.5),
    p25,
    p75,
    iqr: p75 - p25,
    min: nums[0],
    max: nums[nums.length - 1],
  };
}

/**
 * 組の鍵。ページ名とビューポートの label を `|` でつなぐ。
 * @param {string} page
 * @param {string} viewport
 * @returns {string}
 */
export function pairKey(page, viewport) {
  return `${page}${KEY_SEPARATOR}${viewport}`;
}

/**
 * 鍵の材料として使えるか（区切りを含まない、空でない文字列）。区切りを含むと別の組が同じ鍵になる。
 * @param {unknown} v
 * @returns {v is string & { readonly __isKeyPart: true }}
 */
function isKeyPart(v) {
  return nonEmptyString(v) && !v.includes(KEY_SEPARATOR);
}

/**
 * 採取のバージョン・側・target・slug が、期待するものと一致するかを確かめる。
 * @param {Record<string, unknown>} doc
 * @param {{ side: "current" | "new", slug: string, target: (string|null) }} expect
 */
function checkSamplesHeader(doc, expect) {
  if (doc.version !== SAMPLES_VERSION) {
    throw new UsageError(
      `採取の version が ${SAMPLES_VERSION} でない: ${JSON.stringify(doc.version)}`,
    );
  }
  if (doc.side !== expect.side) {
    throw new UsageError(`採取の side が ${expect.side} でない: ${JSON.stringify(doc.side)}`);
  }
  if (doc.target !== expect.target) {
    // 別の target で採った値を、この target の採取として比べない（置き場所の違いが TTFB・LCP に入る）
    throw new UsageError(
      `採取の target が ${JSON.stringify(expect.target)} でない: ${JSON.stringify(doc.target)}`,
    );
  }
  if (doc.slug !== expect.slug) {
    throw new UsageError(`採取の slug が metadata.json と違う: ${JSON.stringify(doc.slug)}`);
  }
}

/**
 * 採取の environment の各項目の型を確かめる。
 * @param {Record<string, unknown>} doc
 */
function checkSamplesEnvironment(doc) {
  if (!isPlainObject(doc.environment)) throw new UsageError("採取に environment が無い");
  if (typeof getPath(doc.environment, "headless") !== "boolean") {
    throw new UsageError("採取の environment.headless が真偽値でない");
  }
  // 両側が同じ誤った形でも environmentDifferences は一致として通すので、型をここで確かめる。
  // 読めなかった項目（無い・null）を両側の一致として扱うと、別の機械で測った値を比べてしまう
  for (const key of [
    "browser_name",
    "browser_version",
    "runner.platform",
    "runner.arch",
    "runner.cpu_model",
  ]) {
    if (!nonEmptyString(getPath(doc.environment, key))) {
      throw new UsageError(`採取の environment.${key} が空でない文字列でない`);
    }
  }
  const channel = getPath(doc.environment, "channel");
  if (channel !== null && !nonEmptyString(channel)) {
    throw new UsageError("採取の environment.channel が null か空でない文字列でない");
  }
  const cpuCount = getPath(doc.environment, "runner.cpu_count");
  if (typeof cpuCount !== "number" || !Number.isInteger(cpuCount) || cpuCount < 1) {
    throw new UsageError("採取の environment.runner.cpu_count が 1 以上の整数でない");
  }
  const placement = getPath(doc.environment, "target_placement");
  if (typeof placement !== "string" || !TARGET_PLACEMENTS.includes(placement)) {
    throw new UsageError(
      `採取の environment.target_placement が ${TARGET_PLACEMENTS.join(" / ")} でない`,
    );
  }
  for (const key of ["context_options", "launch_options"]) {
    if (!isPlainObject(getPath(doc.environment, key))) {
      throw new UsageError(`採取の environment.${key} がオブジェクトでない`);
    }
  }
}

/**
 * 採取の settings（測り方）を確かめ、1 組あたりの回数を返す。
 * @param {Record<string, unknown>} settings
 * @returns {number}
 */
function checkSamplesSettings(settings) {
  const runs = settings.runs;
  if (typeof runs !== "number" || !Number.isInteger(runs) || runs < MIN_RUNS) {
    throw new UsageError(
      `settings.runs が ${MIN_RUNS} 以上の整数でない: ${JSON.stringify(settings.runs)}`,
    );
  }
  if (settings.workers !== 1) {
    // 並列に読み込むと CPU を取り合い、互いの値を遅くする
    throw new UsageError(`settings.workers が 1 でない: ${JSON.stringify(settings.workers)}`);
  }
  for (const key of SETTINGS_KEYS) {
    if (settings[key] === undefined) throw new UsageError(`採取の settings.${key} が無い`);
  }
  // 両側が同じ誤った値でも compare は一致として通すので、測り方の取り決めをここで確かめる
  // 採取のスペックはウォームアップを 1 回だけ捨てる。他の値は、測り方と記録が食い違っている
  if (settings.warmup !== 1) {
    throw new UsageError(`settings.warmup が 1 でない: ${JSON.stringify(settings.warmup)}`);
  }
  if (
    typeof settings.settle_ms !== "number" ||
    !Number.isInteger(settings.settle_ms) ||
    settings.settle_ms < 0
  ) {
    throw new UsageError(
      `settings.settle_ms が 0 以上の整数でない: ${JSON.stringify(settings.settle_ms)}`,
    );
  }
  if (settings.cache !== "cold") {
    throw new UsageError(`settings.cache が "cold" でない: ${JSON.stringify(settings.cache)}`);
  }
  return runs;
}

/**
 * groupSamples が組ごとにまとめる途中の値。`runs` は、組の中で見た回の番号である。
 * @typedef {{ page:string, viewport:string, values: Record<string, (number|null)[]>, runs: Set<number> }} SampleGroup
 */

/**
 * 1 回分の測定（samples の 1 要素）を検証し、その組に加える。
 * @param {{ groups: Map<string, SampleGroup>, runs: number }} ctx - runs は settings.runs
 * @param {unknown} s
 * @param {number} i - samples の中の位置（誤りの報告に使う）
 */
function addSample(ctx, s, i) {
  if (!isPlainObject(s)) throw new UsageError(`samples[${i}] がオブジェクトでない`);
  if (!isKeyPart(s.page) || !isKeyPart(s.viewport)) {
    throw new UsageError(`samples[${i}] の page / viewport が空か "${KEY_SEPARATOR}" を含む`);
  }
  const run = s.run;
  if (typeof run !== "number" || !Number.isInteger(run) || run < 1 || run > ctx.runs) {
    // 重複が無く件数も合えば、run の集合は 1..settings.runs と一致する
    throw new UsageError(`samples[${i}] の run が 1 から settings.runs までの整数でない`);
  }
  const key = pairKey(s.page, s.viewport);
  let g = ctx.groups.get(key);
  if (!g) {
    g = { page: s.page, viewport: s.viewport, values: {}, runs: new Set() };
    for (const m of METRICS) g.values[m] = [];
    ctx.groups.set(key, g);
  }
  if (g.runs.has(run)) {
    throw new UsageError(`samples[${i}] の run が組 ${key} の中で重複する: ${String(s.run)}`);
  }
  g.runs.add(run);
  for (const m of METRICS) {
    const v = s[m];
    // LCP だけは候補が出ない回がある（描画する内容が無い頁）。他の指標は必ず値がある
    const nullable = m === "lcp";
    if (v === null && nullable) {
      g.values[m].push(null);
    } else if (nonNegativeNumber(v)) {
      g.values[m].push(v);
    } else {
      throw new UsageError(`samples[${i}] の ${m} が 0 以上の数でない: ${JSON.stringify(v)}`);
    }
  }
}

/**
 * 採取ファイル（perf-samples.json）を検証し、組ごとの値の列にまとめる。
 * 形の誤りは UsageError にする（判定できない入力を、判定した結果として扱わない）。
 * @param {unknown} doc
 * @param {{ side: "current" | "new", slug: string, target: (string|null) }} expect - 現側の target は null
 * @returns {Map<string, { page:string, viewport:string, values: Record<string, (number|null)[]> }>}
 */
export function groupSamples(doc, expect) {
  if (!isPlainObject(doc)) throw new UsageError("採取がオブジェクトでない");
  checkSamplesHeader(doc, expect);
  checkSamplesEnvironment(doc);
  const settings = doc.settings;
  if (!isPlainObject(settings)) throw new UsageError("採取に settings が無い");
  const runs = checkSamplesSettings(settings);
  if (!isArray(doc.samples) || doc.samples.length === 0) {
    throw new UsageError("採取の samples が空か配列でない");
  }
  /** @type {Map<string, SampleGroup>} */
  const groups = new Map();
  doc.samples.forEach((s, i) => addSample({ groups, runs }, s, i));
  for (const [key, g] of groups) {
    if (g.runs.size !== settings.runs) {
      throw new UsageError(
        `組 ${key} の回数 ${g.runs.size} が settings.runs ${String(settings.runs)} と違う`,
      );
    }
  }
  return new Map(
    [...groups].map(([k, g]) => [k, { page: g.page, viewport: g.viewport, values: g.values }]),
  );
}

/**
 * metadata.json から、採取するはずの組（ページ × ビューポート）を導く。
 * @param {Record<string, unknown>} metadata
 * @returns {string[]}
 */
export function expectedPairs(metadata) {
  const cc = metadata.capture_conditions;
  if (!isPlainObject(cc)) throw new UsageError("metadata.json に capture_conditions が無い");
  if (!isArray(cc.pages) || cc.pages.length === 0) {
    throw new UsageError("capture_conditions.pages が空か配列でない");
  }
  if (!isArray(cc.viewports) || cc.viewports.length === 0) {
    throw new UsageError("capture_conditions.viewports が空か配列でない");
  }
  const pages = cc.pages.map((p, i) => {
    if (!isPlainObject(p) || !isKeyPart(p.name)) {
      throw new UsageError(`capture_conditions.pages[${i}].name が空か "${KEY_SEPARATOR}" を含む`);
    }
    return p.name;
  });
  const viewports = cc.viewports.map((v, i) => {
    if (!isPlainObject(v) || !isKeyPart(v.label)) {
      throw new UsageError(
        `capture_conditions.viewports[${i}].label が空か "${KEY_SEPARATOR}" を含む`,
      );
    }
    return v.label;
  });
  // 名前が重なると期待する組が 1 つにまとまり、片方を採らなくても揃って見える
  if (new Set(pages).size !== pages.length)
    throw new UsageError("capture_conditions.pages の name が重複する");
  if (new Set(viewports).size !== viewports.length) {
    throw new UsageError("capture_conditions.viewports の label が重複する");
  }
  return pages.flatMap((p) => viewports.map((v) => pairKey(p, v)));
}

/**
 * 基準を採ったときの組の定義（ページの name・path と、ビューポートの label・寸法）。
 * compare は今の capture_conditions と比べ、違えば古い基準として判定しない。
 * @param {Record<string, unknown>} metadata
 * @returns {{ pages: unknown[], viewports: unknown[] }}
 */
export function captureDefinition(metadata) {
  const rawCc = metadata.capture_conditions ?? {};
  // オブジェクトでない値は pages・viewports を持たないので、空のオブジェクトと同じ結果になる
  const cc = isPlainObject(rawCc) ? rawCc : {};
  const pages = isArray(cc.pages) ? cc.pages : [];
  const viewports = isArray(cc.viewports) ? cc.viewports : [];
  return {
    pages: pages.map((p) =>
      isPlainObject(p)
        ? { name: p.name ?? null, path: p.path ?? null }
        : { name: null, path: null },
    ),
    viewports: viewports.map((v) =>
      isPlainObject(v)
        ? { label: v.label ?? null, width: v.width ?? null, height: v.height ?? null }
        : { label: null, width: null, height: null },
    ),
  };
}

/**
 * 採取ファイルが記録した組の定義が、metadata.json の今の定義と一致するか。
 * @param {unknown} samplesDoc
 * @param {Record<string, unknown>} metadata
 * @returns {boolean}
 */
export function captureMatches(samplesDoc, metadata) {
  return (
    isPlainObject(samplesDoc) &&
    isPlainObject(samplesDoc.capture) &&
    JSON.stringify(captureDefinition({ capture_conditions: samplesDoc.capture })) ===
      JSON.stringify(captureDefinition(metadata))
  );
}

/**
 * `--floor lcp=150` / `--relative-floor lcp=0.3` の列を下限の表にする。
 * @param {string[]} specs
 * @param {Record<string, number>} defaults
 * @param {string} flag - 誤りの報告に使う引数の名前
 * @returns {Record<string, number>}
 */
export function parseFloors(specs, defaults = DEFAULT_FLOORS, flag = "--floor") {
  const floors = { ...defaults };
  for (const spec of specs) {
    const m = /^([a-z]+)=(.+)$/.exec(spec);
    if (!m || !METRICS.includes(m[1]))
      throw new UsageError(`${flag} の形が <指標>=<値> でない: ${spec}`);
    const n = Number(m[2]);
    if (!Number.isFinite(n) || n < 0)
      throw new UsageError(`${flag} の値が 0 以上の数でない: ${spec}`);
    floors[m[1]] = n;
  }
  return floors;
}

/**
 * 期待する組の順に、採取した組の各指標を集計する。採取に無い組は飛ばす。
 * @param {string[]} expected
 * @param {Map<string, { page:string, viewport:string, values: Record<string, (number|null)[]> }>} groups
 */
function summarizePairs(expected, groups) {
  return expected.flatMap((k) => {
    const g = groups.get(k);
    if (!g) return [];
    /** @type {Record<string, ReturnType<typeof summarizeValues>>} */
    const metrics = {};
    for (const m of METRICS) metrics[m] = summarizeValues(g.values[m]);
    return [{ page: g.page, viewport: g.viewport, metrics }];
  });
}

/**
 * 現側の採取を集計する。
 * @param {Record<string, unknown>} metadata
 * @param {unknown} samplesDoc
 * @param {{ floors: Record<string, number>, relativeFloors: Record<string, number>, samplesPath: string, samplesSha256: string }} opts
 * @returns {{ ok: boolean, performance: Record<string, unknown>, missing: string[], extra: string[] }}
 */
export function summarize(metadata, samplesDoc, opts) {
  if (metadata.mode !== "feature") {
    throw new UsageError(
      `性能を採るのは feature モードだけ（mode: ${JSON.stringify(metadata.mode)}）`,
    );
  }
  if (!nonEmptyString(metadata.slug)) throw new UsageError("metadata.json に slug が無い");
  const groups = groupSamples(samplesDoc, {
    side: "current",
    slug: metadata.slug,
    target: null,
  });
  const expected = expectedPairs(metadata);
  // 採った後に path や寸法を変えた定義で集計し直すと、古い値に新しい組の名前を付けることになる
  if (!captureMatches(samplesDoc, metadata)) {
    throw new UsageError(
      "採取の capture が metadata.json の capture_conditions と違う（今の定義で採り直してから summarize を通す）",
    );
  }
  const missing = expected.filter((k) => !groups.has(k));
  const extra = [...groups.keys()].filter((k) => !expected.includes(k));
  // groupSamples がオブジェクトでない採取を先に拒否しているので、ここには到達しない
  if (!isPlainObject(samplesDoc)) throw new UsageError("採取がオブジェクトでない");
  const doc = samplesDoc;
  return {
    ok: missing.length === 0 && extra.length === 0,
    missing,
    extra,
    performance: {
      declared: true,
      tool_version: VERSION,
      samples: opts.samplesPath,
      samples_sha256: opts.samplesSha256,
      measured_at: doc.measured_at ?? null,
      environment: doc.environment,
      settings: doc.settings,
      floors: opts.floors,
      relative_floors: opts.relativeFloors,
      floor_history: floorHistory(metadata.performance, samplesDoc, opts),
      capture: captureDefinition(metadata),
      pairs: summarizePairs(expected, groups),
      reason: null,
    },
  };
}

/**
 * 下限の変更の履歴を作る。履歴が空か、最後の要素か書き換える前の表の下限が今回の下限と違えば、1 件追記する。
 * 下限は採取から導けない利用者の決定なので、compare は値の正しさを確かめられない。
 * 変えた記録を残し、replace-strategy の append-only-check.mjs が、履歴を追記せずに下限を変えた変更を落とす。
 * 比べる相手は、前の performance.floors ではなく履歴の最後の要素である。append-only-check.mjs も最後の要素と今の値を突き合わせる。
 * 前の floors と比べると、手で書き換えた下限に summarize を通し直しても追記されず、チェックが通らないまま残る。
 * 履歴が空なら（雛形のまま・履歴を持たない前のバージョンの基準）、今の下限を最初の記録として追記する。
 * 既存の要素は変えずにそのまま残す。
 * @param {unknown} previous - 書き換える前の metadata.json の performance
 * @param {unknown} samplesDoc
 * @param {{ floors: Record<string, number>, relativeFloors: Record<string, number>, samplesSha256: string }} opts
 * @returns {unknown[]}
 */
export function floorHistory(previous, samplesDoc, opts) {
  const prev = isPlainObject(previous) ? previous : {};
  const history = prev.floor_history ?? [];
  if (!isArray(history)) {
    throw new UsageError(
      "performance.floor_history が配列でない（手で書き換えていないか確かめる）",
    );
  }
  const last = history.length === 0 ? null : history[history.length - 1];
  const unchanged =
    isPlainObject(last) &&
    canonicalJson(last.floors ?? null) === canonicalJson(opts.floors) &&
    canonicalJson(last.relative_floors ?? null) === canonicalJson(opts.relativeFloors);
  // 書き換える前の表とも比べる。append-only-check.mjs は commit 済みの表と今の表が違えば追記を求めるので、
  // 表が履歴の最後の要素と食い違っている（新規のファイルとして commit された等）ときに追記しないと、
  // 下限を履歴の値へ戻した正規の出力がチェックを通らない。表が無い（declared: false 等）ときも、書くので追記する。
  const tableUnchanged =
    canonicalJson(prev.floors ?? null) === canonicalJson(opts.floors) &&
    canonicalJson(prev.relative_floors ?? null) === canonicalJson(opts.relativeFloors);
  if (unchanged && tableUnchanged) return history;
  return [
    ...history,
    {
      floors: opts.floors,
      relative_floors: opts.relativeFloors,
      samples_sha256: opts.samplesSha256,
      measured_at: isPlainObject(samplesDoc) ? (samplesDoc.measured_at ?? null) : null,
    },
  ];
}

/**
 * 下限を引き継ぐ表と、エラーに出すその表の名前を決める（baseFloors の説明の順で選ぶ）。
 * 履歴が無く集計済みでもなければ、デフォルトを使うので null を返す。
 * @param {Record<string, unknown>} previous - 書き換える前の metadata.json の performance
 * @param {string} key - `floors` か `relative_floors`
 * @returns {{ table: unknown, label: string } | null}
 */
function inheritedSource(previous, key) {
  const history = isArray(previous.floor_history) ? previous.floor_history : [];
  if (history.length > 0) {
    const tail = history[history.length - 1];
    if (!isPlainObject(tail)) {
      throw new UsageError(
        "前の performance.floor_history の最後の要素がオブジェクトでない（履歴を直してから通す）",
      );
    }
    return { table: tail[key], label: `performance.floor_history の最後の要素の ${key}` };
  }
  if (previous.declared === true) {
    return { table: previous[key], label: `performance.${key}` };
  }
  return null;
}

/**
 * `--floor` / `--relative-floor` を省いた指標に使う下限を決める。
 * 記録した下限を引き継ぐ。省いただけで決めた下限がデフォルトへ戻ると、
 * 採り直しのときにフラグを付け忘れただけで下限が変わり、デフォルトより緩くなければ compare の loosened_floors にも出ない。
 * 引き継ぐのは floor_history の最後の要素（記録した決定）である。declared に関わらず、履歴があれば履歴から引き継ぐ。
 * 履歴が無いときだけ、集計済み（declared: true）の前の performance の表を使う（履歴を持たない前のバージョンの基準）。
 * 今の表から引き継ぐと、手で緩めた下限にフラグなしで summarize を通しただけで、その値が正規の記録として履歴に残る。
 * 同じ理由で、履歴の最後の要素がオブジェクトでなければ、今の表へ戻らずに使い方の誤りにする。
 * 履歴も無く集計済みでもなければ（performance が無い・雛形のまま）、デフォルトを使う。
 * 引き継ぐ表や指標が無ければ、その分はデフォルトを使う（前のバージョンの基準でも summarize で通し直せるようにする）。
 * 値が在るのに 0 以上の数でなければ、デフォルトへ戻さずに使い方の誤りにする。ただし、その指標をフラグで渡したときは上書きするので止めない。
 * @param {unknown} previous - 書き換える前の metadata.json の performance
 * @param {{ key: string, defaults: Record<string, number>, overridden?: string[] }} spec - key は `floors` か `relative_floors`、overridden はフラグで渡した指標
 * @returns {Record<string, number>}
 */
export function baseFloors(previous, { key, defaults, overridden = [] }) {
  // すべての指標をフラグで渡したときは何も引き継がないので、履歴の末尾や表が読めなくても止めない（フラグだけで復旧できる）。
  // 履歴そのものが配列でないときは、ここでは空として扱うが、続く floorHistory がフラグに関わらず止める（フラグでは復旧できない）。
  if (!isPlainObject(previous) || METRICS.every((m) => overridden.includes(m)))
    return { ...defaults };
  const source = inheritedSource(previous, key);
  if (source === null) return { ...defaults };
  const { table, label } = source;
  if (table === undefined || table === null) return { ...defaults };
  if (!isPlainObject(table)) throw new UsageError(`前の ${label} がオブジェクトでない`);
  /** @type {Record<string, number>} */
  const out = { ...defaults };
  for (const m of METRICS) {
    const v = table[m];
    if (v === undefined || v === null || overridden.includes(m)) continue;
    if (!nonNegativeNumber(v)) {
      throw new UsageError(
        `前の ${label}.${m} が 0 以上の数でない（フラグでこの指標の値を渡せば上書きできる）`,
      );
    }
    out[m] = v;
  }
  return out;
}

/**
 * フラグで渡した下限（parseFloors が検査した表）を、引き継ぐ下限に重ねる。
 * @param {Record<string, number>} given - フラグで渡した指標だけの表
 * @param {unknown} previous
 * @param {{ key: string, defaults: Record<string, number> }} spec
 * @returns {Record<string, number>}
 */
function withBase(given, previous, { key, defaults }) {
  return { ...baseFloors(previous, { key, defaults, overridden: Object.keys(given) }), ...given };
}

/**
 * 1 つの指標の集計のうち、判定に使う欄。summarizeValues の戻り値もこの形を満たす。
 * @typedef {{ n: number, nulls: number, median: (number|null), iqr: (number|null) }} MetricStats
 */

/**
 * 1 つの指標を判定する。
 * @param {MetricStats} cur
 * @param {MetricStats} neu
 * @param {{ floor: number, relativeFloor?: number }} limits - floor は絶対の下限、relativeFloor は現側の中央値に対する割合の下限
 * @returns {{ status: string, delta: (number|null), tolerance: (number|null) }}
 */
export function judgeMetric(cur, neu, { floor, relativeFloor = 0 }) {
  if (cur.nulls === cur.n && neu.nulls === neu.n) {
    return { status: "not_applicable", delta: null, tolerance: null };
  }
  // 片側だけ・一部の回だけ値が無いのは、描画が安定していないか、片側で候補が出ていない
  if (cur.nulls > 0 || neu.nulls > 0) return { status: "missing", delta: null, tolerance: null };
  // 許容幅は、現側のばらつき・絶対の下限・現側の中央値に対する割合の、いちばん大きいもの
  // nulls が 0 なら値はすべて数である。Number() は演算子が null に当てる変換（0）と同じ値を返す
  const tolerance = Math.max(Number(cur.iqr), floor, relativeFloor * Number(cur.median));
  const delta = Number(neu.median) - Number(cur.median);
  // 新側のばらつきが許容幅を超えると、中央値の差がノイズか回帰かを決められない
  if (Number(neu.iqr) > tolerance) return { status: "noisy", delta, tolerance };
  if (delta > tolerance) return { status: "regressed", delta, tolerance };
  if (delta < -tolerance) return { status: "improved", delta, tolerance };
  return { status: "within_noise", delta, tolerance };
}

/** 合格として数える状態。これ以外が 1 件でもあれば exit 1 にする。 */
export const PASSING_STATUSES = ["within_noise", "improved", "not_applicable"];

/**
 * 基準の統計（performance.pairs の metrics）と環境・測り方（environment・settings）が、現側の採取ファイルから作り直したものと一致するか。
 * 採取ファイルが読めない・形が違うときも一致しないとする。
 * @param {Record<string, unknown>} perf
 * @param {unknown} currentDoc
 * @param {string} slug
 * @returns {boolean}
 */
export function summaryMatches(perf, currentDoc, slug) {
  /** @type {Map<string, { values: Record<string, (number|null)[]> }>} */
  let groups;
  try {
    groups = groupSamples(currentDoc, { side: "current", slug, target: null });
  } catch {
    return false;
  }
  // 環境と測り方も採取から転記した値なので、書き換えて新側の値に合わせれば env_mismatch を通り抜けられる
  // groupSamples がオブジェクトでない採取を先に拒否しているので、ここには到達しない
  if (!isPlainObject(currentDoc)) return false;
  const doc = currentDoc;
  for (const key of ["environment", "settings"]) {
    if (JSON.stringify(perf[key]) !== JSON.stringify(doc[key])) return false;
  }
  // 組の定義も同じである。capture_conditions と performance.capture だけを書き換えると、古い採取が今の定義として通る
  if (
    !isPlainObject(doc.capture) ||
    JSON.stringify(captureDefinition({ capture_conditions: doc.capture })) !==
      JSON.stringify(perf.capture)
  ) {
    return false;
  }
  const pairs = perf.pairs;
  if (!isArray(pairs) || pairs.length !== groups.size) return false;
  return pairs.every((p) => {
    if (!isPlainObject(p)) return false;
    // 記録の page・viewport は文字列と限らない。鍵の連結と同じく文字列に変えてから突き合わせる
    const g = groups.get(pairKey(String(p.page), String(p.viewport)));
    if (!g) return false;
    /** @type {Record<string, unknown>} */
    const recomputed = {};
    for (const m of METRICS) recomputed[m] = summarizeValues(g.values[m]);
    return JSON.stringify(recomputed) === JSON.stringify(p.metrics);
  });
}

/**
 * 現側の環境・測り方と、新側のものの違いを挙げる。
 * @param {Record<string, unknown>} cur
 * @param {Record<string, unknown>} neu
 * @returns {string[]}
 */
export function environmentDifferences(cur, neu) {
  const diffs = [];
  for (const key of ENVIRONMENT_KEYS) {
    const a = getPath(cur.environment ?? {}, key);
    const b = getPath(neu.environment ?? {}, key);
    // context_options・launch_options はキーの順序が書き手で変わりうるので、並べ替えてから比べる
    if (canonicalJson(a) !== canonicalJson(b)) {
      diffs.push(`environment.${key}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
    }
  }
  for (const key of SETTINGS_KEYS) {
    const a = getPath(cur.settings ?? {}, key);
    const b = getPath(neu.settings ?? {}, key);
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      diffs.push(`settings.${key}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
    }
  }
  return diffs;
}

/**
 * キーを並べ替えた JSON。オブジェクトの中のキーの順序だけが違う値を等しく扱う。
 * @param {unknown} v
 * @returns {string}
 */
function canonicalJson(v) {
  if (isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (isPlainObject(v)) {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

/**
 * デフォルトより緩い下限を挙げる。下限は採取から導けない利用者の決定なので、compare は値を検証できない。
 * 判定は変えず、緩めた下限を結果に載せて、報告で人が気付けるようにする。
 * @param {Record<string, unknown>} perf
 * @returns {{ metric: string, kind: string, value: number, default: number }[]}
 */
export function loosenedFloors(perf) {
  const out = [];
  /** @type {[string, Record<string, number>][]} */
  const kinds = [
    ["floors", DEFAULT_FLOORS],
    ["relative_floors", DEFAULT_RELATIVE_FLOORS],
  ];
  for (const [kind, defaults] of kinds) {
    // compare が表と各指標の値を先に確かめているので、次の 2 つの throw には到達しない
    const table = perf[kind];
    if (!isPlainObject(table)) throw new UsageError(`performance.${kind} が無い`);
    for (const m of METRICS) {
      const d = defaults[m];
      const value = table[m];
      if (typeof value !== "number") throw new UsageError(`performance.${kind}.${m} が数でない`);
      if (value > d) out.push({ metric: m, kind, value, default: d });
    }
  }
  return out;
}

/**
 * performance.floors・relative_floors の各指標が 0 以上の数であることを確かめる。
 * @param {Record<string, unknown>} perf
 */
function checkFloorTables(perf) {
  for (const key of ["floors", "relative_floors"]) {
    const table = perf[key];
    // 直前で floors・relative_floors がオブジェクトであることを確かめているので、ここには到達しない。
    // 到達したらこのスクリプトの不具合なので、TypeError にする（UsageError にすると、直前の確かめを外しても同じ出口で通ってしまう）
    if (!isPlainObject(table)) throw new TypeError(`performance.${key} の欄を読めない`);
    for (const m of METRICS) {
      const f = table[m];
      if (!nonNegativeNumber(f)) {
        throw new UsageError(`performance.${key}.${m} が 0 以上の数でない`);
      }
    }
  }
}

/**
 * compare が読む基準（metadata.json の performance）の形を確かめ、確かめた欄を返す。
 * @param {Record<string, unknown>} metadata
 * @param {{ target: string }} opts
 */
function checkBaseline(metadata, opts) {
  if (!nonEmptyString(opts.target)) throw new UsageError("比べる新側の target が無い（--target）");
  const perf = metadata.performance;
  if (!isPlainObject(perf)) {
    throw new UsageError("metadata.json に performance が無い（判定しない分岐は呼ぶ側で扱う）");
  }
  if (perf.declared !== true) {
    throw new UsageError(
      "metadata.json の performance.declared が true でない（判定しない分岐は呼ぶ側で扱う）",
    );
  }
  if (!nonEmptyString(metadata.slug)) throw new UsageError("metadata.json に slug が無い");
  if (!isArray(perf.pairs) || perf.pairs.length === 0) {
    throw new UsageError("performance.pairs が空か配列でない");
  }
  if (!isPlainObject(perf.floors)) throw new UsageError("performance.floors が無い");
  if (typeof perf.samples_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(perf.samples_sha256)) {
    throw new UsageError("performance.samples_sha256 が sha256 の形でない（summarize を通し直す）");
  }
  if (!isPlainObject(perf.relative_floors)) {
    throw new UsageError("performance.relative_floors が無い（summarize を通し直す）");
  }
  checkFloorTables(perf);
  if (perf.tool_version !== VERSION) {
    // 判定の規則が変わったバージョンで、古いバージョンが書いた基準を読まない
    throw new UsageError(
      `performance.tool_version ${JSON.stringify(perf.tool_version)} が ${VERSION} でない（summarize を通し直す）`,
    );
  }
  if (!isPlainObject(perf.capture)) {
    throw new UsageError("performance.capture が無い（summarize を通し直す）");
  }
  return {
    perf,
    slug: metadata.slug,
    pairs: perf.pairs,
    floors: perf.floors,
    relativeFloors: perf.relative_floors,
  };
}

/**
 * 基準が今の採取と組の定義を表しているかを調べる。どれかが真なら、基準は古い。
 * @param {Record<string, unknown>} metadata
 * @param {ReturnType<typeof checkBaseline>} base
 * @param {{ currentSamplesSha256: (string|null), currentSamplesDoc?: unknown }} opts
 */
function baselineStaleness(metadata, base, opts) {
  const { perf } = base;
  // 基準を採った後にページ・ビューポートが増減したか、path や寸法が変わったら、基準は今の組を表さない
  const staleCapture = JSON.stringify(perf.capture) !== JSON.stringify(captureDefinition(metadata));
  // 基準の統計は採取ファイルから計算し直したものと一致しなければ使わない（手で書き換えた中央値で回帰を隠さない）
  const staleSummary =
    opts.currentSamplesDoc == null || !summaryMatches(perf, opts.currentSamplesDoc, base.slug);

  // 基準を採った採取が、集計した後に採り直されていないか（集計は採取から作るので、元が変われば古い）。
  // 読めなかった（null）ときも sha256 の文字列と一致しないので、古い基準と同じく通さない。
  // 古い基準のときは、組 × 指標をすべて stale_baseline にする（regressed を出さない）
  // 基準の組が今の定義（ページ × ビューポート）とそろっているか。現側・新側の採取と基準から同じ組を削った成果物は、
  // 統計と sha256 が合っても欠けた組を含むので、古い基準として扱う
  const expected = expectedPairs(metadata);
  const baselineKeys = base.pairs.map((p) =>
    isPlainObject(p) && isKeyPart(p.page) && isKeyPart(p.viewport)
      ? pairKey(p.page, p.viewport)
      : null,
  );
  const stalePairs =
    expected.some((k) => !baselineKeys.includes(k)) ||
    baselineKeys.some((k) => k === null || !expected.includes(k));
  const staleBaseline =
    opts.currentSamplesSha256 !== perf.samples_sha256 || staleCapture || staleSummary || stalePairs;
  return { staleBaseline, staleCapture, staleSummary, stalePairs };
}

/**
 * 基準の 1 組 × 1 指標の統計の形を確かめ、判定に使う欄を返す。
 * @param {unknown} cur - performance.pairs の要素の metrics の 1 指標
 * @param {string} key - 組の鍵
 * @param {string} m - 指標
 * @returns {{ n: number, nulls: number, median: (number|null), iqr: (number|null) }}
 */
function baselineMetric(cur, key, m) {
  if (
    !isPlainObject(cur) ||
    typeof cur.n !== "number" ||
    !Number.isInteger(cur.n) ||
    typeof cur.nulls !== "number" ||
    !Number.isInteger(cur.nulls)
  ) {
    throw new UsageError(`performance.pairs の ${key} の ${m} の形が違う`);
  }
  // 手で書き換えた基準で、回数の足りない組や値の無い組を not_applicable として通さない
  if (cur.n < MIN_RUNS || cur.nulls < 0 || cur.nulls > cur.n) {
    throw new UsageError(
      `performance.pairs の ${key} の ${m} の回数が範囲外（n は ${MIN_RUNS} 以上、nulls は 0 から n まで）`,
    );
  }
  // 値のある組は 0 以上の数、すべて null の組は null（summarizeValues が書く形）でなければ、基準として読まない
  const statsValid =
    cur.nulls < cur.n
      ? [cur.median, cur.iqr].every(nonNegativeNumber)
      : cur.median === null && cur.iqr === null;
  // statsValid が真なら median と iqr は数か null なので、後ろの 2 つの条件は判定を変えない
  if (!statsValid || !isNumberOrNull(cur.median) || !isNumberOrNull(cur.iqr)) {
    throw new UsageError(
      `performance.pairs の ${key} の ${m} の median / iqr が回数と合わない（値のある組は 0 以上の数、すべて null の組は null）`,
    );
  }
  return { n: cur.n, nulls: cur.nulls, median: cur.median, iqr: cur.iqr };
}

/**
 * compare が組ごとの判定に使う、判定の前に決めた値。
 * @typedef {{ groups: Map<string, { values: Record<string, (number|null)[]> }>, floors: Record<string, unknown>, relativeFloors: Record<string, unknown>, staleBaseline: boolean, differences: string[] }} JudgeContext
 */

/**
 * 1 組 × 1 指標の判定の結果を作る。
 * @param {{ page: string, viewport: string, metric: string, cur: MetricStats }} target - cur は基準の統計
 * @param {JudgeContext} ctx
 * @param {string} key - 組の鍵
 */
function judgePairMetric(target, ctx, key) {
  const { page, viewport, metric: m, cur } = target;
  const g = ctx.groups.get(key);
  if (!g) {
    return {
      page,
      viewport,
      metric: m,
      status: "missing",
      reason: "新側の採取に組が無い",
    };
  }
  const neu = summarizeValues(g.values[m]);
  const floor = ctx.floors[m];
  const relativeFloor = ctx.relativeFloors[m];
  // 冒頭で floors・relative_floors の各指標が 0 以上の数であることを確かめているので、ここには到達しない
  if (typeof floor !== "number" || typeof relativeFloor !== "number") {
    throw new UsageError(`performance.floors / relative_floors の ${m} が数でない`);
  }
  // 古い基準と比べた regressed を出すと、parity-diff が判定に使えない値で差し戻す。環境の違いと同じく判定しない
  const unjudged = ctx.staleBaseline
    ? { status: "stale_baseline", delta: null, tolerance: null }
    : null;
  const verdict =
    unjudged ??
    (ctx.differences.length > 0
      ? { status: "env_mismatch", delta: null, tolerance: null }
      : judgeMetric(cur, neu, { floor, relativeFloor }));
  return {
    page,
    viewport,
    metric: m,
    ...verdict,
    current: { median: cur.median, iqr: cur.iqr, n: cur.n, nulls: cur.nulls },
    new: { median: neu.median, iqr: neu.iqr, n: neu.n, nulls: neu.nulls },
  };
}

/**
 * 基準の組ごとに、指標を判定する。
 * @param {unknown[]} pairs - performance.pairs
 * @param {JudgeContext} ctx
 * @returns {{ results: ReturnType<typeof judgePairMetric>[], seen: Set<string> }}
 */
function judgePairs(pairs, ctx) {
  const results = [];
  const seen = new Set();
  for (const p of pairs) {
    if (
      !isPlainObject(p) ||
      !isKeyPart(p.page) ||
      !isKeyPart(p.viewport) ||
      !isPlainObject(p.metrics)
    ) {
      throw new UsageError("performance.pairs の要素の形が違う");
    }
    const key = pairKey(p.page, p.viewport);
    if (seen.has(key)) throw new UsageError(`performance.pairs の組が重複する: ${key}`);
    seen.add(key);
    for (const m of METRICS) {
      const cur = baselineMetric(p.metrics[m], key, m);
      results.push(
        judgePairMetric({ page: p.page, viewport: p.viewport, metric: m, cur }, ctx, key),
      );
    }
  }
  return { results, seen };
}

/**
 * 新側の採取を検証し、組ごとの値の列にまとめる。
 * @param {Record<string, unknown>} metadata
 * @param {unknown} samplesDoc
 * @param {{ slug: string, target: string }} expect
 */
function groupNewSamples(metadata, samplesDoc, expect) {
  const groups = groupSamples(samplesDoc, { side: "new", ...expect });
  // groupSamples がオブジェクトでない採取を先に拒否しているので、ここには到達しない
  if (!isPlainObject(samplesDoc)) throw new UsageError("採取がオブジェクトでない");
  if (!captureMatches(samplesDoc, metadata)) {
    throw new UsageError(
      "新側の採取の capture が metadata.json の capture_conditions と違う（今の定義で採り直す）",
    );
  }
  return { groups, neuDoc: samplesDoc };
}

/**
 * 新側の採取を、metadata.json の performance と比べる。
 * @param {Record<string, unknown>} metadata
 * @param {unknown} samplesDoc
 * @param {{ currentSamplesSha256: (string|null), currentSamplesDoc?: unknown, target: string }} opts - 現側の採取ファイルを今読んだ sha256（読めなければ null）
 */
export function compare(metadata, samplesDoc, opts) {
  const base = checkBaseline(metadata, opts);
  const { perf } = base;
  const { groups, neuDoc } = groupNewSamples(metadata, samplesDoc, {
    slug: base.slug,
    target: opts.target,
  });
  const stale = baselineStaleness(metadata, base, opts);
  const differences = environmentDifferences(perf, neuDoc);
  const { results, seen } = judgePairs(base.pairs, {
    groups,
    floors: base.floors,
    relativeFloors: base.relativeFloors,
    staleBaseline: stale.staleBaseline,
    differences,
  });
  const extra = [...groups.keys()].filter((k) => !seen.has(k));
  /** @type {Record<string, number>} */
  const counts = {};
  for (const r of results) counts[r.status] = (counts[r.status] ?? 0) + 1;
  const ok =
    !stale.staleBaseline &&
    differences.length === 0 &&
    extra.length === 0 &&
    results.every((r) => PASSING_STATUSES.includes(r.status));
  return {
    tool: "perf-stats",
    version: VERSION,
    command: "compare",
    judged: true,
    ok,
    stale_baseline: stale.staleBaseline,
    stale_capture: stale.staleCapture,
    stale_summary: stale.staleSummary,
    stale_pairs: stale.stalePairs,
    environment_differences: differences,
    extra_pairs: extra,
    floors: base.floors,
    relative_floors: base.relativeFloors,
    loosened_floors: loosenedFloors(perf),
    counts,
    regressed: results.filter((r) => r.status === "regressed"),
    results,
    new_measured_at: neuDoc.measured_at ?? null,
  };
}

/**
 * リポジトリのルートからの相対パスか。summarize の --samples と、compare が読む performance.samples の両方に当てる。
 * @param {string} path
 * @returns {boolean}
 */
function isRepoRelative(path) {
  return !isAbsolute(path) && !path.split(/[\\/]/).includes("..");
}

/**
 * 採取ファイルの指紋。整形・改行コードの違いで変わらないよう、パースし直した JSON の sha256 を取る。
 * @param {string} text
 * @returns {string}
 */
export function samplesFingerprint(text) {
  return createHash("sha256")
    .update(JSON.stringify(JSON.parse(text)))
    .digest("hex");
}

const USAGE = [
  "usage: perf-stats.mjs summarize --metadata <metadata.json> --samples <perf-samples.json> [--floor <指標>=<ms> ...] [--relative-floor <指標>=<割合> ...] [--write]",
  "       perf-stats.mjs compare   --metadata <現側 metadata.json> --samples <新側 perf-samples.json> --target <新側の target> [--write <diff-metadata.json>]",
].join("\n");

/**
 * main が使う入出力。テストはメモリ上のファイルを渡す。
 * @typedef {{ readFile: (p: string) => string, writeFile: (p: string, s: string) => void, realpath: (p: string) => string, cwd: string, stdout: (s: string) => void, stderr: (s: string) => void }} CliIo
 */

/**
 * 渡されなかった入出力を、実際のファイルと標準出力で補う。
 * @param {Partial<CliIo>} deps
 * @returns {CliIo}
 */
function cliIo(deps) {
  const readFile = deps.readFile ?? ((p) => readFileSync(p, "utf8"));
  const writeFile =
    deps.writeFile ??
    ((p, s) => {
      // 途中で落ちても半分だけ書かれた JSON を残さない
      const tmp = `${p}.tmp-${process.pid}`;
      writeFileSync(tmp, s);
      renameSync(tmp, p);
    });
  const cwd = deps.cwd ?? process.cwd();
  const realpath = deps.realpath ?? ((p) => realpathSync(p));
  const stdout = deps.stdout ?? ((s) => process.stdout.write(s));
  const stderr = deps.stderr ?? ((s) => process.stderr.write(s));
  return { readFile, writeFile, cwd, realpath, stdout, stderr };
}

/**
 * パスの綴りだけでなく、シンボリックリンクを解決した実体もリポジトリの中にあるか。読めなければ null を返す。
 * @param {string} path - リポジトリのルートからの相対パス
 * @param {CliIo} io
 * @returns {boolean|null}
 */
function realInsideRoot(path, io) {
  let real;
  try {
    real = io.realpath(resolve(io.cwd, path));
  } catch {
    return null;
  }
  const root = io.realpath(io.cwd);
  return real === root || real.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
}

/** サブコマンドごとに受け付ける引数。--floor と --relative-floor だけは重ねてよい。 */
const FLAG_SPECS = {
  summarize: {
    values: ["--metadata", "--samples", "--floor", "--relative-floor"],
    repeat: ["--floor", "--relative-floor"],
    bools: ["--write"],
  },
  compare: { values: ["--metadata", "--samples", "--target", "--write"] },
};

/**
 * サブコマンドの後の引数を読む。
 * @param {"summarize" | "compare"} command
 * @param {string[]} rest
 * @returns {{ opts: Record<string, string>, floorSpecs: string[], relativeFloorSpecs: string[], writeFlag: boolean }}
 */
function parseArgs(command, rest) {
  const parsed = parseFlags(rest, FLAG_SPECS[command]);
  if (parsed.error !== undefined) throw new UsageError(parsed.error);
  const { strings, lists, bools } = parsed;
  /** @type {Record<string, string>} */
  const opts = {};
  for (const name of ["--metadata", "--samples", "--target"]) {
    const value = strings[name];
    if (value !== undefined) opts[name.slice(2)] = value;
  }
  if (command === "compare" && strings["--write"] !== undefined) opts.write = strings["--write"];
  const floorSpecs = lists["--floor"] ?? [];
  const relativeFloorSpecs = lists["--relative-floor"] ?? [];
  const writeFlag = command === "summarize" && bools["--write"] === true;
  if (!opts.metadata || !opts.samples) throw new UsageError("--metadata と --samples が要る");
  return { opts, floorSpecs, relativeFloorSpecs, writeFlag };
}

/**
 * --samples のパスがリポジトリの中を指すことを確かめ、採取を読む。
 * @param {string} samples - --samples の値
 * @param {CliIo} io
 * @returns {{ samplesText: string, samplesDoc: unknown }}
 */
function readSamples(samples, io) {
  // summarize は記録したパスを別の機械の compare がルートから読み、compare は新側のパスを diff-metadata.json に残す。
  // どちらもリポジトリの外のファイルを採取として読まない
  if (!isRepoRelative(samples)) {
    throw new UsageError(
      `--samples はリポジトリのルートからの相対パスで渡す（絶対パスと .. は受けない）: ${samples}`,
    );
  }
  if (realInsideRoot(samples, io) === false) {
    throw new UsageError(
      `--samples の実体がリポジトリの外にある（シンボリックリンク）: ${samples}`,
    );
  }
  let samplesText;
  try {
    samplesText = io.readFile(resolve(io.cwd, samples));
  } catch (e) {
    throw new UsageError(`採取を読めない: ${samples}（${errorMessage(e)}）`);
  }
  /** @type {unknown} */
  let samplesDoc;
  try {
    samplesDoc = JSON.parse(samplesText);
  } catch (e) {
    throw new UsageError(`採取が JSON でない: ${samples}（${errorMessage(e)}）`);
  }
  return { samplesText, samplesDoc };
}

/**
 * metadata.json と採取を読む。
 * @param {Record<string, string>} opts - parseArgs が読んだ引数
 * @param {CliIo} io
 * @returns {{ metadataPath: string, metadata: Record<string, unknown>, samplesText: string, samplesDoc: unknown }}
 */
function readInputs(opts, io) {
  const metadataPath = resolve(io.cwd, opts.metadata);
  /** @type {unknown} */
  let metadata;
  try {
    metadata = JSON.parse(io.readFile(metadataPath));
  } catch (e) {
    throw new UsageError(`metadata.json を読めない: ${opts.metadata}（${errorMessage(e)}）`);
  }
  if (!isPlainObject(metadata)) throw new UsageError("metadata.json がオブジェクトでない");
  return { metadataPath, metadata, ...readSamples(opts.samples, io) };
}

/**
 * CLI の 1 回の実行で読んだ引数と入力。
 * @typedef {{ args: ReturnType<typeof parseArgs>, input: ReturnType<typeof readInputs>, io: CliIo }} CliRun
 */

/**
 * summarize を実行し、終了コードを返す。
 * @param {CliRun} run
 * @returns {number}
 */
function runSummarize({ args, input, io }) {
  const { metadata } = input;
  const result = summarize(metadata, input.samplesDoc, {
    floors: withBase(parseFloors(args.floorSpecs, {}), metadata.performance, {
      key: "floors",
      defaults: DEFAULT_FLOORS,
    }),
    relativeFloors: withBase(
      parseFloors(args.relativeFloorSpecs, {}, "--relative-floor"),
      metadata.performance,
      { key: "relative_floors", defaults: DEFAULT_RELATIVE_FLOORS },
    ),
    samplesPath: args.opts.samples,
    samplesSha256: samplesFingerprint(input.samplesText),
  });
  if (!result.ok) {
    io.stderr(
      `error: 採取の組が capture_conditions と合わない（足りない: ${JSON.stringify(result.missing)}、余分: ${JSON.stringify(result.extra)}）\n`,
    );
    return 1;
  }
  if (args.writeFlag) {
    metadata.performance = result.performance;
    io.writeFile(input.metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
  }
  io.stdout(
    `${JSON.stringify({ tool: "perf-stats", version: VERSION, command: "summarize", written: args.writeFlag, performance: result.performance }, null, 2)}\n`,
  );
  return 0;
}

/**
 * metadata.json の performance.samples が指す現側の採取を読む。読めなければ、どちらも null にする。
 * @param {unknown} perf - metadata.json の performance
 * @param {CliIo} io
 * @returns {{ currentSha: (string|null), currentDoc: unknown }}
 */
function readCurrentSamples(perf, io) {
  if (!isPlainObject(perf) || !nonEmptyString(perf.samples)) {
    return { currentSha: null, currentDoc: null };
  }
  // 手で書き換えた metadata.json で、リポジトリの外の JSON を現側の基準として読まない
  if (!isRepoRelative(perf.samples)) {
    throw new UsageError(
      `performance.samples がリポジトリのルートからの相対パスでない（絶対パスと .. は受けない）: ${perf.samples}`,
    );
  }
  if (realInsideRoot(perf.samples, io) === false) {
    throw new UsageError(
      `performance.samples の実体がリポジトリの外にある（シンボリックリンク）: ${perf.samples}`,
    );
  }
  try {
    const text = io.readFile(resolve(io.cwd, perf.samples));
    return { currentSha: samplesFingerprint(text), currentDoc: JSON.parse(text) };
  } catch {
    return { currentSha: null, currentDoc: null }; // 読めない基準を、今の基準として扱わない
  }
}

/**
 * compare の結果を、--write で渡した diff-metadata.json の performance に書く。
 * @param {ReturnType<typeof compare>} result
 * @param {CliRun} run
 */
function writeDiffMetadata(result, { args, input, io }) {
  const write = args.opts.write;
  const diffPath = resolve(io.cwd, write);
  /** @type {unknown} */
  let diffMetadata;
  try {
    diffMetadata = JSON.parse(io.readFile(diffPath));
  } catch (e) {
    throw new UsageError(
      `diff-metadata.json を読めない（今回の実行の diff-metadata.json を手順 3 で書いてから通す）: ${write}（${errorMessage(e)}）`,
    );
  }
  if (!isPlainObject(diffMetadata)) throw new UsageError("diff-metadata.json がオブジェクトでない");
  diffMetadata.performance = {
    ...result,
    new_samples: args.opts.samples,
    new_samples_sha256: samplesFingerprint(input.samplesText),
  };
  io.writeFile(diffPath, `${JSON.stringify(diffMetadata, null, 2)}\n`);
}

/**
 * 通らなかった compare の結果から、利用者に示す理由を並べる。
 * @param {ReturnType<typeof compare>} result
 * @returns {string[]}
 */
function compareFailureReasons(result) {
  const reasons = [];
  if (result.stale_pairs && !result.stale_capture)
    reasons.push(
      "基準の組が capture_conditions のページ × ビューポートとそろっていない（採り直して summarize を通し直す）",
    );
  if (result.stale_summary && !result.stale_capture)
    reasons.push("基準の統計が現側の採取から計算し直した値と違う（summarize を通し直す）");
  if (result.stale_capture)
    reasons.push(
      "基準を採った後に capture_conditions の組が変わった（採り直して summarize を通し直す）",
    );
  else if (result.stale_baseline)
    reasons.push("現側の基準が古いか、採取ファイルを読めない（summarize を通し直す）");
  if (result.environment_differences.length > 0) {
    reasons.push(`環境・測り方が現側と違う: ${result.environment_differences.join(", ")}`);
  }
  if (result.extra_pairs.length > 0) {
    reasons.push(`現側に無い組: ${JSON.stringify(result.extra_pairs)}`);
  }
  reasons.push(`状態の件数: ${JSON.stringify(result.counts)}`);
  return reasons;
}

/**
 * compare を実行し、終了コードを返す。
 * @param {CliRun} run
 * @returns {number}
 */
function runCompare(run) {
  const { args, input, io } = run;
  const { currentSha, currentDoc } = readCurrentSamples(input.metadata.performance, io);
  const result = compare(input.metadata, input.samplesDoc, {
    currentSamplesSha256: currentSha,
    currentSamplesDoc: currentDoc,
    target: args.opts.target ?? "",
  });
  // 書き込みに失敗しても判定の結果が残るよう、先に出力する
  io.stdout(`${JSON.stringify(result, null, 2)}\n`);
  if (args.opts.write) writeDiffMetadata(result, run);
  const loosened = result.loosened_floors;
  if (loosened.length > 0) {
    // 合否に関わらず出す。緩めた下限は回帰を許容幅の中に入れうるので、報告に載せて人が確かめる
    io.stderr(
      `warning: デフォルトより緩い下限で判定した（報告に載せる）: ${loosened
        .map((l) => `${l.kind}.${l.metric}=${l.value}（デフォルト ${l.default}）`)
        .join(", ")}\n`,
    );
  }
  if (!result.ok) {
    io.stderr(`error: 性能の比較が通らない。${compareFailureReasons(result).join(" / ")}\n`);
    return 1;
  }
  return 0;
}

/**
 * @param {string[]} argv - process.argv.slice(2)
 * @param {Partial<CliIo>} [deps]
 * @returns {number}
 */
export function main(argv, deps = {}) {
  const io = cliIo(deps);
  const [command, ...rest] = argv;
  if (command !== "summarize" && command !== "compare") {
    io.stderr(`error: サブコマンドが無い・不明: ${command ?? ""}\n${USAGE}\n`);
    return 2;
  }
  try {
    const args = parseArgs(command, rest);
    const run = { args, input: readInputs(args.opts, io), io };
    return command === "summarize" ? runSummarize(run) : runCompare(run);
  } catch (e) {
    io.stderr(`error: ${errorMessage(e)}\n${USAGE}\n`);
    return 2;
  }
}

if (isCliEntry(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
