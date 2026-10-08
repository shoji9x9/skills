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
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * ツールのバージョン（原本）。判定規則・出力の形を変えたら上げる。
 * @type {string}
 */
export const VERSION = "1";

/** 採取の形式の版。雛形の `PERF_SAMPLES_VERSION` と同じ値にする。 */
export const SAMPLES_VERSION = "1";

/** 比べる指標。`lcp`・`tbt`・`ttfb` はミリ秒、`cls` は単位の無いスコアである。 */
export const METRICS = ["lcp", "cls", "tbt", "ttfb"];

/**
 * 指標ごとの許容幅の絶対の下限（デフォルト）。四分位範囲が 0 に近い環境で、1ms の差まで回帰にしないための値である。
 * summarize の `--floor <指標>=<値>` で上書きでき、使った値は metadata.json の performance.floors に残る。
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
 * @returns {v is Record<string, unknown>}
 */
function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * @param {unknown} v
 * @returns {v is string}
 */
function isNonEmptyString(v) {
  return typeof v === "string" && v.trim() !== "";
}

/**
 * ドット区切りのパスで値を取る。
 * @param {Record<string, unknown>} obj
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
 * @returns {v is string}
 */
function isKeyPart(v) {
  return isNonEmptyString(v) && !v.includes(KEY_SEPARATOR);
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
    if (!isNonEmptyString(getPath(doc.environment, key))) {
      throw new UsageError(`採取の environment.${key} が空でない文字列でない`);
    }
  }
  const channel = getPath(doc.environment, "channel");
  if (channel !== null && !isNonEmptyString(channel)) {
    throw new UsageError("採取の environment.channel が null か空でない文字列でない");
  }
  const cpuCount = getPath(doc.environment, "runner.cpu_count");
  if (!Number.isInteger(cpuCount) || /** @type {number} */ (cpuCount) < 1) {
    throw new UsageError("採取の environment.runner.cpu_count が 1 以上の整数でない");
  }
  if (
    !TARGET_PLACEMENTS.includes(
      /** @type {string} */ (getPath(doc.environment, "target_placement")),
    )
  ) {
    throw new UsageError(
      `採取の environment.target_placement が ${TARGET_PLACEMENTS.join(" / ")} でない`,
    );
  }
  for (const key of ["context_options", "launch_options"]) {
    if (!isPlainObject(getPath(doc.environment, key))) {
      throw new UsageError(`採取の environment.${key} がオブジェクトでない`);
    }
  }
  const settings = doc.settings;
  if (!isPlainObject(settings)) throw new UsageError("採取に settings が無い");
  if (!Number.isInteger(settings.runs) || /** @type {number} */ (settings.runs) < MIN_RUNS) {
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
  if (!Number.isInteger(settings.settle_ms) || /** @type {number} */ (settings.settle_ms) < 0) {
    throw new UsageError(
      `settings.settle_ms が 0 以上の整数でない: ${JSON.stringify(settings.settle_ms)}`,
    );
  }
  if (settings.cache !== "cold") {
    throw new UsageError(`settings.cache が "cold" でない: ${JSON.stringify(settings.cache)}`);
  }
  if (!Array.isArray(doc.samples) || doc.samples.length === 0) {
    throw new UsageError("採取の samples が空か配列でない");
  }
  /** @type {Map<string, { page:string, viewport:string, values: Record<string, (number|null)[]>, runs: Set<number> }>} */
  const groups = new Map();
  doc.samples.forEach((s, i) => {
    if (!isPlainObject(s)) throw new UsageError(`samples[${i}] がオブジェクトでない`);
    if (!isKeyPart(s.page) || !isKeyPart(s.viewport)) {
      throw new UsageError(`samples[${i}] の page / viewport が空か "${KEY_SEPARATOR}" を含む`);
    }
    if (
      !Number.isInteger(s.run) ||
      /** @type {number} */ (s.run) < 1 ||
      /** @type {number} */ (s.run) > /** @type {number} */ (settings.runs)
    ) {
      // 重複が無く件数も合えば、run の集合は 1..settings.runs と一致する
      throw new UsageError(`samples[${i}] の run が 1 から settings.runs までの整数でない`);
    }
    const key = pairKey(s.page, s.viewport);
    let g = groups.get(key);
    if (!g) {
      g = { page: s.page, viewport: s.viewport, values: {}, runs: new Set() };
      for (const m of METRICS) g.values[m] = [];
      groups.set(key, g);
    }
    if (g.runs.has(/** @type {number} */ (s.run))) {
      throw new UsageError(`samples[${i}] の run が組 ${key} の中で重複する: ${s.run}`);
    }
    g.runs.add(/** @type {number} */ (s.run));
    for (const m of METRICS) {
      const v = s[m];
      // LCP だけは候補が出ない回がある（描画する内容が無い頁）。他の指標は必ず値がある
      const nullable = m === "lcp";
      if (v === null && nullable) {
        g.values[m].push(null);
      } else if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
        g.values[m].push(v);
      } else {
        throw new UsageError(`samples[${i}] の ${m} が 0 以上の数でない: ${JSON.stringify(v)}`);
      }
    }
  });
  for (const [key, g] of groups) {
    if (g.runs.size !== settings.runs) {
      throw new UsageError(
        `組 ${key} の回数 ${g.runs.size} が settings.runs ${settings.runs} と違う`,
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
  if (!Array.isArray(cc.pages) || cc.pages.length === 0) {
    throw new UsageError("capture_conditions.pages が空か配列でない");
  }
  if (!Array.isArray(cc.viewports) || cc.viewports.length === 0) {
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
  const cc = /** @type {Record<string, unknown>} */ (metadata.capture_conditions ?? {});
  const pages = Array.isArray(cc.pages) ? cc.pages : [];
  const viewports = Array.isArray(cc.viewports) ? cc.viewports : [];
  return {
    pages: pages.map((p) => ({ name: p?.name ?? null, path: p?.path ?? null })),
    viewports: viewports.map((v) => ({
      label: v?.label ?? null,
      width: v?.width ?? null,
      height: v?.height ?? null,
    })),
  };
}

/**
 * 採取ファイルが記録した組の定義が、metadata.json の今の定義と一致するか。
 * @param {unknown} samplesDoc
 * @param {Record<string, unknown>} metadata
 * @returns {boolean}
 */
export function captureMatches(samplesDoc, metadata) {
  const doc = /** @type {Record<string, unknown>} */ (samplesDoc);
  return (
    isPlainObject(doc.capture) &&
    JSON.stringify(captureDefinition({ capture_conditions: doc.capture })) ===
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
  if (!isNonEmptyString(metadata.slug)) throw new UsageError("metadata.json に slug が無い");
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
  const doc = /** @type {Record<string, unknown>} */ (samplesDoc);
  const pairs = expected
    .filter((k) => groups.has(k))
    .map((k) => {
      const g =
        /** @type {{ page:string, viewport:string, values: Record<string, (number|null)[]> }} */ (
          groups.get(k)
        );
      /** @type {Record<string, ReturnType<typeof summarizeValues>>} */
      const metrics = {};
      for (const m of METRICS) metrics[m] = summarizeValues(g.values[m]);
      return { page: g.page, viewport: g.viewport, metrics };
    });
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
      capture: captureDefinition(metadata),
      pairs,
      reason: null,
    },
  };
}

/**
 * 1 つの指標を判定する。
 * @param {ReturnType<typeof summarizeValues>} cur
 * @param {ReturnType<typeof summarizeValues>} neu
 * @param {number} floor - 絶対の下限
 * @param {number} [relativeFloor] - 現側の中央値に対する割合の下限
 * @returns {{ status: string, delta: (number|null), tolerance: (number|null) }}
 */
export function judgeMetric(cur, neu, floor, relativeFloor = 0) {
  if (cur.nulls === cur.n && neu.nulls === neu.n) {
    return { status: "not_applicable", delta: null, tolerance: null };
  }
  // 片側だけ・一部の回だけ値が無いのは、描画が安定していないか、片側で候補が出ていない
  if (cur.nulls > 0 || neu.nulls > 0) return { status: "missing", delta: null, tolerance: null };
  // 許容幅は、現側のばらつき・絶対の下限・現側の中央値に対する割合の、いちばん大きいもの
  const tolerance = Math.max(
    /** @type {number} */ (cur.iqr),
    floor,
    relativeFloor * /** @type {number} */ (cur.median),
  );
  const delta = /** @type {number} */ (neu.median) - /** @type {number} */ (cur.median);
  // 新側のばらつきが許容幅を超えると、中央値の差がノイズか回帰かを決められない
  if (/** @type {number} */ (neu.iqr) > tolerance) return { status: "noisy", delta, tolerance };
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
  const doc = /** @type {Record<string, unknown>} */ (currentDoc);
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
  const pairs = /** @type {Record<string, unknown>[]} */ (perf.pairs);
  if (pairs.length !== groups.size) return false;
  return pairs.every((p) => {
    const g = groups.get(
      pairKey(/** @type {string} */ (p.page), /** @type {string} */ (p.viewport)),
    );
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
    const a = getPath(/** @type {Record<string, unknown>} */ (cur.environment ?? {}), key);
    const b = getPath(/** @type {Record<string, unknown>} */ (neu.environment ?? {}), key);
    // context_options・launch_options はキーの順序が書き手で変わりうるので、並べ替えてから比べる
    if (canonicalJson(a) !== canonicalJson(b)) {
      diffs.push(`environment.${key}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
    }
  }
  for (const key of SETTINGS_KEYS) {
    const a = getPath(/** @type {Record<string, unknown>} */ (cur.settings ?? {}), key);
    const b = getPath(/** @type {Record<string, unknown>} */ (neu.settings ?? {}), key);
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
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (isPlainObject(v)) {
    const o = /** @type {Record<string, unknown>} */ (v);
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
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
  for (const [kind, defaults] of [
    ["floors", DEFAULT_FLOORS],
    ["relative_floors", DEFAULT_RELATIVE_FLOORS],
  ]) {
    const table = /** @type {Record<string, number>} */ (perf[/** @type {string} */ (kind)]);
    for (const m of METRICS) {
      const d = /** @type {Record<string, number>} */ (defaults)[m];
      if (table[m] > d)
        out.push({ metric: m, kind: /** @type {string} */ (kind), value: table[m], default: d });
    }
  }
  return out;
}

/**
 * 新側の採取を、metadata.json の performance と比べる。
 * @param {Record<string, unknown>} metadata
 * @param {unknown} samplesDoc
 * @param {{ currentSamplesSha256: (string|null), currentSamplesDoc?: unknown, target: string }} opts - 現側の採取ファイルを今読んだ sha256（読めなければ null）
 * @returns {Record<string, unknown>}
 */
export function compare(metadata, samplesDoc, opts) {
  if (!isNonEmptyString(opts.target))
    throw new UsageError("比べる新側の target が無い（--target）");
  const perf = metadata.performance;
  if (!isPlainObject(perf)) {
    throw new UsageError("metadata.json に performance が無い（判定しない分岐は呼ぶ側で扱う）");
  }
  if (perf.declared !== true) {
    throw new UsageError(
      "metadata.json の performance.declared が true でない（判定しない分岐は呼ぶ側で扱う）",
    );
  }
  if (!isNonEmptyString(metadata.slug)) throw new UsageError("metadata.json に slug が無い");
  if (!Array.isArray(perf.pairs) || perf.pairs.length === 0) {
    throw new UsageError("performance.pairs が空か配列でない");
  }
  if (!isPlainObject(perf.floors)) throw new UsageError("performance.floors が無い");
  if (typeof perf.samples_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(perf.samples_sha256)) {
    throw new UsageError("performance.samples_sha256 が sha256 の形でない（summarize を通し直す）");
  }
  if (!isPlainObject(perf.relative_floors)) {
    throw new UsageError("performance.relative_floors が無い（summarize を通し直す）");
  }
  for (const key of ["floors", "relative_floors"]) {
    const table = /** @type {Record<string, unknown>} */ (perf[key]);
    for (const m of METRICS) {
      const f = table[m];
      if (typeof f !== "number" || !Number.isFinite(f) || f < 0) {
        throw new UsageError(`performance.${key}.${m} が 0 以上の数でない`);
      }
    }
  }
  if (perf.tool_version !== VERSION) {
    // 判定の規則が変わった版で、古い版が書いた基準を読まない
    throw new UsageError(
      `performance.tool_version ${JSON.stringify(perf.tool_version)} が ${VERSION} でない（summarize を通し直す）`,
    );
  }
  if (!isPlainObject(perf.capture)) {
    throw new UsageError("performance.capture が無い（summarize を通し直す）");
  }
  const groups = groupSamples(samplesDoc, {
    side: "new",
    slug: metadata.slug,
    target: opts.target,
  });
  const neuDoc = /** @type {Record<string, unknown>} */ (samplesDoc);
  // 基準を採った後にページ・ビューポートが増減したか、path や寸法が変わったら、基準は今の組を表さない
  const staleCapture = JSON.stringify(perf.capture) !== JSON.stringify(captureDefinition(metadata));
  if (!captureMatches(samplesDoc, metadata)) {
    throw new UsageError(
      "新側の採取の capture が metadata.json の capture_conditions と違う（今の定義で採り直す）",
    );
  }
  // 基準の統計は採取ファイルから計算し直したものと一致しなければ使わない（手で書き換えた中央値で回帰を隠さない）
  const staleSummary =
    opts.currentSamplesDoc == null || !summaryMatches(perf, opts.currentSamplesDoc, metadata.slug);

  // 基準を採った採取が、集計した後に採り直されていないか（集計は採取から作るので、元が変われば古い）。
  // 読めなかった（null）ときも sha256 の文字列と一致しないので、古い基準と同じく通さない。
  // 古い基準のときは、組 × 指標をすべて stale_baseline にする（regressed を出さない）
  const staleBaseline =
    opts.currentSamplesSha256 !== perf.samples_sha256 || staleCapture || staleSummary;

  const differences = environmentDifferences(perf, neuDoc);
  const results = [];
  const seen = new Set();
  for (const p of perf.pairs) {
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
    const g = groups.get(key);
    for (const m of METRICS) {
      const cur = /** @type {ReturnType<typeof summarizeValues>} */ (p.metrics[m]);
      if (!isPlainObject(cur) || !Number.isInteger(cur.n) || !Number.isInteger(cur.nulls)) {
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
          ? [cur.median, cur.iqr].every(
              (v) => typeof v === "number" && Number.isFinite(v) && v >= 0,
            )
          : cur.median === null && cur.iqr === null;
      if (!statsValid) {
        throw new UsageError(
          `performance.pairs の ${key} の ${m} の median / iqr が回数と合わない（値のある組は 0 以上の数、すべて null の組は null）`,
        );
      }
      if (!g) {
        results.push({
          page: p.page,
          viewport: p.viewport,
          metric: m,
          status: "missing",
          reason: "新側の採取に組が無い",
        });
        continue;
      }
      const neu = summarizeValues(g.values[m]);
      const floor = /** @type {number} */ (perf.floors[m]);
      const relativeFloor = /** @type {number} */ (perf.relative_floors[m]);
      // 古い基準と比べた regressed を出すと、parity-diff が判定に使えない値で差し戻す。環境の違いと同じく判定しない
      const unjudged = staleBaseline
        ? { status: "stale_baseline", delta: null, tolerance: null }
        : null;
      const verdict =
        unjudged ??
        (differences.length > 0
          ? { status: "env_mismatch", delta: null, tolerance: null }
          : judgeMetric(cur, neu, floor, relativeFloor));
      results.push({
        page: p.page,
        viewport: p.viewport,
        metric: m,
        ...verdict,
        current: { median: cur.median, iqr: cur.iqr, n: cur.n, nulls: cur.nulls },
        new: { median: neu.median, iqr: neu.iqr, n: neu.n, nulls: neu.nulls },
      });
    }
  }
  const extra = [...groups.keys()].filter((k) => !seen.has(k));
  /** @type {Record<string, number>} */
  const counts = {};
  for (const r of results) counts[r.status] = (counts[r.status] ?? 0) + 1;
  const ok =
    !staleBaseline &&
    differences.length === 0 &&
    extra.length === 0 &&
    results.every((r) => PASSING_STATUSES.includes(r.status));
  return {
    tool: "perf-stats",
    version: VERSION,
    command: "compare",
    judged: true,
    ok,
    stale_baseline: staleBaseline,
    stale_capture: staleCapture,
    stale_summary: staleSummary,
    environment_differences: differences,
    extra_pairs: extra,
    floors: perf.floors,
    relative_floors: perf.relative_floors,
    loosened_floors: loosenedFloors(perf),
    counts,
    regressed: results.filter((r) => r.status === "regressed"),
    results,
    new_measured_at: neuDoc.measured_at ?? null,
  };
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

/**
 * @param {string[]} argv - process.argv.slice(2)
 * @param {{ readFile?: (p: string) => string, writeFile?: (p: string, s: string) => void, cwd?: string, stdout?: (s: string) => void, stderr?: (s: string) => void }} [deps]
 * @returns {number}
 */
export function main(argv, deps = {}) {
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
  const stdout = deps.stdout ?? ((s) => process.stdout.write(s));
  const stderr = deps.stderr ?? ((s) => process.stderr.write(s));
  const usage = [
    "usage: perf-stats.mjs summarize --metadata <metadata.json> --samples <perf-samples.json> [--floor <指標>=<ms> ...] [--relative-floor <指標>=<割合> ...] [--write]",
    "       perf-stats.mjs compare   --metadata <現側 metadata.json> --samples <新側 perf-samples.json> --target <新側の target> [--write <diff-metadata.json>]",
  ].join("\n");
  const [command, ...rest] = argv;
  if (command !== "summarize" && command !== "compare") {
    stderr(`error: サブコマンドが無い・不明: ${command ?? ""}\n${usage}\n`);
    return 2;
  }
  /** @type {Record<string, string>} */
  const opts = {};
  /** @type {string[]} */
  const floorSpecs = [];
  /** @type {string[]} */
  const relativeFloorSpecs = [];
  let writeFlag = false;
  try {
    for (let i = 0; i < rest.length; i += 1) {
      const a = rest[i];
      if (command === "summarize" && a === "--write") {
        writeFlag = true;
        continue;
      }
      const allowed =
        command === "summarize"
          ? ["--metadata", "--samples", "--floor", "--relative-floor"]
          : ["--metadata", "--samples", "--target", "--write"];
      if (!allowed.includes(a)) throw new UsageError(`不明な引数 ${a}`);
      const v = rest[i + 1];
      if (v === undefined || v === "" || v.startsWith("--"))
        throw new UsageError(`${a} に値が無い`);
      i += 1;
      if (a === "--floor") {
        floorSpecs.push(v);
        continue;
      }
      if (a === "--relative-floor") {
        relativeFloorSpecs.push(v);
        continue;
      }
      if (Object.hasOwn(opts, a.slice(2))) throw new UsageError(`${a} が重複している`);
      opts[a.slice(2)] = v;
    }
    if (!opts.metadata || !opts.samples) throw new UsageError("--metadata と --samples が要る");
    const metadataPath = resolve(cwd, opts.metadata);
    /** @type {Record<string, unknown>} */
    let metadata;
    try {
      metadata = JSON.parse(readFile(metadataPath));
    } catch (e) {
      throw new UsageError(
        `metadata.json を読めない: ${opts.metadata}（${e instanceof Error ? e.message : e}）`,
      );
    }
    if (!isPlainObject(metadata)) throw new UsageError("metadata.json がオブジェクトでない");
    let samplesText;
    try {
      samplesText = readFile(resolve(cwd, opts.samples));
    } catch (e) {
      throw new UsageError(
        `採取を読めない: ${opts.samples}（${e instanceof Error ? e.message : e}）`,
      );
    }
    let samplesDoc;
    try {
      samplesDoc = JSON.parse(samplesText);
    } catch (e) {
      throw new UsageError(
        `採取が JSON でない: ${opts.samples}（${e instanceof Error ? e.message : e}）`,
      );
    }

    if (command === "summarize") {
      // 記録したパスは別の機械の compare がリポジトリのルートから読む。絶対パスと外へ出るパスは残さない
      if (isAbsolute(opts.samples) || opts.samples.split(/[\\/]/).includes("..")) {
        throw new UsageError(
          `--samples はリポジトリのルートからの相対パスで渡す（絶対パスと .. は受けない）: ${opts.samples}`,
        );
      }
      const result = summarize(metadata, samplesDoc, {
        floors: parseFloors(floorSpecs),
        relativeFloors: parseFloors(
          relativeFloorSpecs,
          DEFAULT_RELATIVE_FLOORS,
          "--relative-floor",
        ),
        samplesPath: opts.samples,
        samplesSha256: samplesFingerprint(samplesText),
      });
      if (!result.ok) {
        stderr(
          `error: 採取の組が capture_conditions と合わない（足りない: ${JSON.stringify(result.missing)}、余分: ${JSON.stringify(result.extra)}）\n`,
        );
        return 1;
      }
      if (writeFlag) {
        metadata.performance = result.performance;
        writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
      }
      stdout(
        `${JSON.stringify({ tool: "perf-stats", version: VERSION, command, written: writeFlag, performance: result.performance }, null, 2)}\n`,
      );
      return 0;
    }

    const perf = metadata.performance;
    /** @type {string|null} */
    let currentSha = null;
    /** @type {unknown} */
    let currentDoc = null;
    if (isPlainObject(perf) && isNonEmptyString(perf.samples)) {
      try {
        const text = readFile(resolve(cwd, perf.samples));
        currentSha = samplesFingerprint(text);
        currentDoc = JSON.parse(text);
      } catch {
        currentSha = null; // 読めない基準を、今の基準として扱わない
        currentDoc = null;
      }
    }
    const result = compare(metadata, samplesDoc, {
      currentSamplesSha256: currentSha,
      currentSamplesDoc: currentDoc,
      target: opts.target ?? "",
    });
    // 書き込みに失敗しても判定の結果が残るよう、先に出力する
    stdout(`${JSON.stringify(result, null, 2)}\n`);
    if (opts.write) {
      const diffPath = resolve(cwd, opts.write);
      /** @type {Record<string, unknown>} */
      let diffMetadata;
      try {
        diffMetadata = JSON.parse(readFile(diffPath));
      } catch (e) {
        throw new UsageError(
          `diff-metadata.json を読めない（今回の実行の diff-metadata.json を手順 3 で書いてから通す）: ${opts.write}（${e instanceof Error ? e.message : e}）`,
        );
      }
      if (!isPlainObject(diffMetadata))
        throw new UsageError("diff-metadata.json がオブジェクトでない");
      diffMetadata.performance = {
        ...result,
        new_samples: opts.samples,
        new_samples_sha256: samplesFingerprint(samplesText),
      };
      writeFile(diffPath, `${JSON.stringify(diffMetadata, null, 2)}\n`);
    }
    const loosened =
      /** @type {{ metric: string, kind: string, value: number, default: number }[]} */ (
        result.loosened_floors
      );
    if (loosened.length > 0) {
      // 合否に関わらず出す。緩めた下限は回帰を許容幅の中に入れうるので、報告に載せて人が確かめる
      stderr(
        `warning: デフォルトより緩い下限で判定した（報告に載せる）: ${loosened
          .map((l) => `${l.kind}.${l.metric}=${l.value}（デフォルト ${l.default}）`)
          .join(", ")}\n`,
      );
    }
    if (!result.ok) {
      const reasons = [];
      if (result.stale_summary && !result.stale_capture)
        reasons.push("基準の統計が現側の採取から計算し直した値と違う（summarize を通し直す）");
      if (result.stale_capture)
        reasons.push(
          "基準を採った後に capture_conditions の組が変わった（採り直して summarize を通し直す）",
        );
      else if (result.stale_baseline)
        reasons.push("現側の基準が古いか、採取ファイルを読めない（summarize を通し直す）");
      if (/** @type {string[]} */ (result.environment_differences).length > 0) {
        reasons.push(
          `環境・測り方が現側と違う: ${/** @type {string[]} */ (result.environment_differences).join(", ")}`,
        );
      }
      if (/** @type {string[]} */ (result.extra_pairs).length > 0) {
        reasons.push(`現側に無い組: ${JSON.stringify(result.extra_pairs)}`);
      }
      reasons.push(`状態の件数: ${JSON.stringify(result.counts)}`);
      stderr(`error: 性能の比較が通らない。${reasons.join(" / ")}\n`);
      return 1;
    }
    return 0;
  } catch (e) {
    stderr(`error: ${e instanceof Error ? e.message : e}\n${usage}\n`);
    return 2;
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
