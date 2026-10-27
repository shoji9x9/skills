// 部品の動き（出し入れ・開閉のアニメーション）の時系列を採るプローブ（採り方はこのスクリプトで定義する）。
// 原本はこのスキルの中にある。実行時はプロジェクトの `<parity_suite_dir>/parity/lib/tools/vendor/` へコピーして使う。
// Playwright のスペックから import するためで、parity-suite 同梱の element-shot.mjs と同じ取り決めである。
//
// 何のためか: 見た目の照合は `animations: "disabled"` で止めて撮る。そのため、現行の部品が持つ動き
// （jQuery の `show('slide')` / `fadeIn`、CSS の `transition` / `animation`）は、採取物にも見本の照合にも記録されない。
// 新側が動きを持たないまま、部品の照合・スイート・parity-diff がすべて緑になる（実際の移行で起きた）。
// 画素では比べられなくても、`requestAnimationFrame` ごとに要素の矩形と不透明度を採れば、
// 動きの長さ・始まるまでの遅れ・軌跡は数値で比べられる。比較は同梱の motion-compare.mjs が行う。
//
// 何をするか: 呼び出し側が渡した `trigger`（動きを起こす操作）の直前に、ページ側で rAF ごとの採取を始め、
// 最後の変化から `settleMs` のあいだ何も変わらなくなるまで（または `timeoutMs` まで）採り続ける。
// 各フレームで、要素が在るか・矩形（x / y / width / height）・実効の不透明度（祖先まで掛け合わせた値）を記録する。
//
// 要素は CSS セレクタで引く（論理名ではない）。出現する動きでは、操作の前に要素がまだ無いので
// ロケータを先に解決できず、ページ側で毎フレーム探し直すしかないためである。セレクタは片側の実装に固有でよい
// （現行と新側で別のセレクタを使う）。比べるのは時系列の数値で、セレクタは比べない。
// 引いた要素が複数あるときは採らずに失敗させる（どの要素の動きかを後から決められない）。
//
// 前提: 採取のあいだはアニメーションを止めない（element-shot.mjs の `animations: "disabled"` や、
// ページ側で全体を止める仕掛けを外して開く）。止めたまま採ると、動きのある部品も長さ 0 に記録される。
//
// 決定論的: 乱数に依存しない。時刻はページの `performance.now()` だけを使い、値は丸めて記録する。
// Playwright はピア前提であり import しない（Page / Frame は引数で受け取る）。TypeScript 構文は使わない（型は JSDoc）。

/**
 * ツールのバージョン（このスクリプトで定義する）。採る値・変化の判定・終わりの判定・出力の形を変えたら上げる。
 */
export const VERSION = "1";

/**
 * 変化とみなす最小の差（このスクリプトで定義する。motion-compare.mjs の CHANGE_EPSILON と同じ値にする）。
 * 採った値は丸めて記録するので、丸めの桁より細かい差は変化にしない。
 */
export const CHANGE_EPSILON = { px: 0.01, opacity: 0.001 };

/**
 * 記録するフレーム数の上限を決める想定の最大フレームレート（Hz）。上限は timeoutMs から導く。
 * 固定の件数にすると、自動で閉じるまでが長い部品で timeoutMs を延ばしても、上限の件数に先に達して
 * 動きの途中でなくても打ち切りと記録される（5000 件は 60Hz で約 83 秒）。
 */
export const MAX_FRAME_RATE = 240;

/**
 * timeoutMs に見合う、記録するフレーム数の上限。想定の最大フレームレートで timeoutMs を採り切れる件数にする。
 * これより速く描く環境（240Hz 超）でだけ timeoutMs より先に上限に達し、打ち切りとして記録される。
 * @param {number} timeoutMs
 * @returns {number}
 */
export function sampleLimit(timeoutMs) {
  return Math.ceil((timeoutMs * MAX_FRAME_RATE) / 1000) + 1;
}

/**
 * 1 フレームの標本。t は採取を始めてからの時刻（ms）。要素が無いフレームは present: false だけを持つ。
 * @typedef {{ t: number, present: false }
 *   | { t: number, present: true, x: number, y: number, width: number, height: number, opacity: number }} MotionSample
 */

/**
 * 1 フレームで読んだ要素の状態（時刻を付ける前の MotionSample）。error は読めなかったときだけ持つ。
 * @typedef {{ present: false, error?: undefined }
 *   | { present: true, x: number, y: number, width: number, height: number, opacity: number, error?: undefined }} MotionReading
 */

/**
 * ページ側の採取の状態（`globalThis.__parityMotionProbe` に置く）。
 * @typedef {{
 *   done: boolean,
 *   timed_out: boolean,
 *   error: string | null,
 *   samples: MotionSample[],
 *   startedAt: number,
 *   lastChangeAt: number | null,
 * }} MotionProbeState
 */

/**
 * 採取の状態を置くページのグローバル。
 * @typedef {typeof globalThis & { __parityMotionProbe?: MotionProbeState }} MotionProbeGlobal
 */

/**
 * 動きの時系列（probeMotion の返り値。motion-compare.mjs が読む）。
 * @typedef {{
 *   probe_version: string,
 *   selector: string,
 *   settle_ms: number,
 *   timeout_ms: number,
 *   timed_out: boolean,
 *   samples: MotionSample[],
 * }} MotionTimeline
 */

/**
 * 採取の条件（ページへ JSON で渡す）。
 * @typedef {{
 *   selector: string,
 *   settleMs: number,
 *   timeoutMs: number,
 *   epsilon: { px: number, opacity: number },
 *   maxSamples: number,
 * }} SamplerConfig
 */

/**
 * ページ側で使うヘルパー。installSampler へ引数で渡す。
 * ページへはソースとして渡るので、どのヘルパーも外側の名前を参照せず、互いを呼ぶときもこのオブジェクトを通す。
 * @typedef {{
 *   round: typeof roundTo,
 *   read: typeof readMotionElement,
 *   differs: typeof motionDiffers,
 *   failure: typeof samplerFailure,
 *   failed: typeof isFailedReading,
 *   takeSample: typeof takeSample,
 * }} SamplerHelpers
 */

/**
 * 値を digits 桁に丸める（ページ側のヘルパー）。
 * @param {number} value
 * @param {number} digits
 * @returns {number}
 */
function roundTo(value, digits) {
  const p = 10 ** digits;
  return Math.round(value * p) / p;
}

/**
 * セレクタで要素を探し、1 フレーム分の状態を読む（ページ側のヘルパー）。
 * @param {{ selector: string, round: typeof roundTo }} arg
 * @returns {MotionReading | { error: string }}
 */
function readMotionElement({ selector, round }) {
  /** @type {MotionProbeGlobal} */
  const g = globalThis;
  const found = g.document.querySelectorAll(selector);
  if (found.length > 1) return { error: `selector matched ${found.length} elements` };
  const el = found[0];
  if (!el || !el.isConnected) return { present: false };
  const style = g.getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  if (
    style.display === "none" ||
    style.visibility === "hidden" ||
    (rect.width === 0 && rect.height === 0)
  ) {
    return { present: false };
  }
  let opacity = 1;
  /** @type {Element | null} */
  let node = el;
  for (; node && node.nodeType === 1; node = node.parentElement) {
    opacity *= Number(g.getComputedStyle(node).opacity);
  }
  return {
    present: true,
    x: round(rect.x, 2),
    y: round(rect.y, 2),
    width: round(rect.width, 2),
    height: round(rect.height, 2),
    opacity: round(opacity, 3),
  };
}

/**
 * 2 つの読み取りが違うか（ページ側のヘルパー）。
 * @param {MotionReading} a
 * @param {MotionReading} b
 * @param {{ px: number, opacity: number }} epsilon
 * @returns {boolean}
 */
function motionDiffers(a, b, epsilon) {
  if (a.present !== b.present) return true;
  // ここでは a.present と b.present が等しいので、b の判定は a の判定と同じ結果になる（型の絞り込みのため）。
  if (!a.present || !b.present) return false;
  return (
    Math.abs(a.x - b.x) > epsilon.px ||
    Math.abs(a.y - b.y) > epsilon.px ||
    Math.abs(a.width - b.width) > epsilon.px ||
    Math.abs(a.height - b.height) > epsilon.px ||
    Math.abs(a.opacity - b.opacity) > epsilon.opacity
  );
}

/**
 * 読み取りで投げた例外を、読めなかったフレームにする（ページ側のヘルパー）。
 * @param {unknown} error
 * @returns {{ error: string }}
 */
function samplerFailure(error) {
  // message は、message を持つオブジェクトからだけ読む。読めないか、空でない文字列でなければ、String(error) を表示する。
  const message =
    typeof error === "object" && error !== null && "message" in error ? error.message : undefined;
  return {
    error: `sampler failed: ${typeof message === "string" && message ? message : String(error)}`,
  };
}

/**
 * 読めなかったフレームか（error が文字列か。ページ側のヘルパー）。MotionReading の error は undefined なので、判定は型と一致する。
 * @param {MotionReading | { error: string }} reading
 * @returns {reading is { error: string }}
 */
function isFailedReading(reading) {
  return typeof reading.error === "string";
}

/**
 * 1 フレームを採り、終わりを判定する（ページ側のヘルパー）。採取を続けるなら true を返す。
 * @param {{ state: MotionProbeState, helpers: SamplerHelpers, config: SamplerConfig }} arg
 * @returns {boolean}
 */
function takeSample({ state, helpers, config }) {
  if (state.done) return false;
  const { settleMs, timeoutMs, maxSamples } = config;
  const now = globalThis.performance.now();
  const t = helpers.round(now - state.startedAt, 1);
  /** @type {MotionReading | { error: string }} */
  let sample;
  try {
    sample = helpers.read({ selector: config.selector, round: helpers.round });
  } catch (error) {
    // 不正なセレクタ等で投げたまま抜けると done が偽のまま残り、同じページの採り直しが
    // 「another motion probe is still running」で永久に弾かれる（rAF の中なら待つ側も上限まで待つ）。
    sample = helpers.failure(error);
  }
  if (helpers.failed(sample)) {
    state.error = sample.error;
    state.done = true;
    return false;
  }
  const previous = state.samples[state.samples.length - 1];
  if (previous && helpers.differs(previous, sample, config.epsilon)) state.lastChangeAt = now;
  state.samples.push({ t, ...sample });
  const settled = state.lastChangeAt !== null && now - state.lastChangeAt >= settleMs;
  if (settled) {
    state.done = true;
    return false;
  }
  if (now - state.startedAt >= timeoutMs || state.samples.length >= maxSamples) {
    // 変化が一度も無いまま時間が尽きたのは「動かなかった」という観測で、打ち切りではない。
    // 変化の途中で尽きたときだけ、終わりを見ていないので打ち切りとして記録する。
    state.timed_out = state.lastChangeAt !== null || state.samples.length >= maxSamples;
    state.done = true;
    return false;
  }
  return true;
}

/**
 * ページ側で採取を始める（samplerScript がソースにしてページへ渡す関数。外側の名前を参照しない）。
 * 既に採取中のものがあれば、上書きせずに失敗させる（前の採取が終わっていない）。
 * @param {SamplerHelpers} helpers ページ側のヘルパー。
 * @param {SamplerConfig} config 採取の条件。
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function installSampler(helpers, config) {
  /** @type {MotionProbeGlobal} */
  const g = globalThis;
  if (g.__parityMotionProbe && !g.__parityMotionProbe.done) {
    return { ok: false, error: "another motion probe is still running on this page" };
  }
  /** @type {MotionProbeState} */
  const state = {
    done: false,
    timed_out: false,
    error: null,
    samples: [],
    startedAt: g.performance.now(),
    lastChangeAt: null,
  };
  g.__parityMotionProbe = state;
  const step = () => {
    if (helpers.takeSample({ state, helpers, config })) g.requestAnimationFrame(step);
  };
  step();
  // 最初の採取で失敗した（不正なセレクタ・操作の前から複数に当たる）なら、操作を起こす前に返す。
  // ok: true を返すと呼び出し側が trigger を実行し、失敗が報告される前にクリック・送信・遷移が現行へ届く。
  if (typeof state.error === "string") return { ok: false, error: state.error };
  return { ok: true };
}

/**
 * ページ側のヘルパー。samplerScript はこのオブジェクトの関数をそれぞれソースにして installSampler へ渡す。
 * @type {SamplerHelpers}
 */
export const SAMPLER_HELPERS = {
  round: roundTo,
  read: readMotionElement,
  differs: motionDiffers,
  failure: samplerFailure,
  failed: isFailedReading,
  takeSample,
};

/**
 * samplerScript が返す式のうち、採取の条件（JSON）より前の部分。
 * installSampler とヘルパーをそれぞれソースにして組み立てる。
 * 関数の宣言のソース（`function name(...) {...}`）は、引数やプロパティの値の位置に置くと関数式として評価される。
 */
export const SAMPLER_SCRIPT_HEAD = `(${String(installSampler)})({\n${Object.entries(SAMPLER_HELPERS)
  .map(([name, fn]) => `${name}: ${String(fn)}`)
  .join(",\n")}\n}, `;

/**
 * ページ側で採取を始める式のソース（`page.evaluate` に渡す）。条件は JSON で埋め込む。
 * ヘルパーを別の関数に分けても、ページのグローバルを増やさず、evaluate を 1 回で済ませるためにソースを組み立てる。
 * @param {SamplerConfig} config
 * @returns {string}
 */
export function samplerScript(config) {
  return `${SAMPLER_SCRIPT_HEAD}${JSON.stringify(config)})`;
}

/**
 * ページ側の採取が終わったか（`page.waitForFunction` に渡す関数）。
 * @returns {boolean}
 */
export function samplerDone() {
  /** @type {MotionProbeGlobal} */
  const g = globalThis;
  const state = g.__parityMotionProbe;
  // 状態が消えた（ページが遷移した）ら待ち続けず終わらせ、readSampler の null で理由を報告する。
  return !state || Boolean(state.done);
}

/**
 * ページ側の採取結果を取り出す（`page.evaluate` に渡す関数）。
 * @returns {{ timed_out: boolean, error: string | null, samples: MotionSample[] } | null}
 */
export function readSampler() {
  /** @type {MotionProbeGlobal} */
  const g = globalThis;
  const state = g.__parityMotionProbe;
  if (!state) return null;
  return { timed_out: state.timed_out, error: state.error, samples: state.samples };
}

/**
 * ページ側の採取を止める（`page.evaluate` に渡す関数）。
 */
export function stopSampler() {
  /** @type {MotionProbeGlobal} */
  const g = globalThis;
  const state = g.__parityMotionProbe;
  if (state) state.done = true;
}

/**
 * installSampler の返り値の形か。ページから返る値は型が付かないので、ここで確かめる。
 * @param {unknown} value
 * @returns {value is { ok: true } | { ok: false, error: string }}
 */
function isInstallResult(value) {
  if (typeof value !== "object" || value === null || !("ok" in value)) return false;
  return value.ok === true || ("error" in value && typeof value.error === "string");
}

/**
 * probeMotion の採取の条件を検査し、誤っていれば投げる。
 * @param {{ selector: unknown, trigger: unknown, settleMs: number, timeoutMs: number }} options
 */
function validateProbeOptions({ selector, trigger, settleMs, timeoutMs }) {
  if (typeof selector !== "string" || selector.trim() === "") {
    throw new Error("motion probe: selector is required");
  }
  if (typeof trigger !== "function") throw new Error("motion probe: trigger must be a function");
  /** @type {[string, number][]} */
  const limits = [
    ["settleMs", settleMs],
    ["timeoutMs", timeoutMs],
  ];
  for (const [name, value] of limits) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`motion probe: ${name} must be a positive number (got ${String(value)})`);
    }
  }
  if (settleMs >= timeoutMs) {
    throw new Error("motion probe: settleMs must be shorter than timeoutMs");
  }
}

/**
 * 動きを 1 回採る。
 *
 * @param {{
 *   evaluate<R, A>(fn: (arg: A) => R, arg?: A): Promise<R>,
 *   evaluate(script: string): Promise<unknown>,
 *   waitForFunction(
 *     fn: () => unknown,
 *     arg: undefined,
 *     options: { timeout: number, polling: number },
 *   ): Promise<unknown>,
 * }} page Playwright の Page か Frame（要素がある文書）。
 * @param {{ selector: string, trigger: () => Promise<unknown>, settleMs?: number, timeoutMs?: number }} options 採取の条件。
 *   - selector: 動く要素を探す CSS セレクタ（その文書で高々 1 件に当たること）
 *   - trigger: 動きを起こす操作。採取を始めた直後に呼ぶ（論理名の手順で書く）
 *   - settleMs: 最後の変化からこの時間なにも変わらなければ終わりとみなす（デフォルトは 500ms）
 *   - timeoutMs: 採取の上限（デフォルトは 10000ms。自動で閉じるまでの時間を測るなら、その時間より長くする）
 * @returns {Promise<MotionTimeline>}
 */
export async function probeMotion(page, options) {
  const { selector, trigger, settleMs = 500, timeoutMs = 10000 } = options ?? {};
  validateProbeOptions({ selector, trigger, settleMs, timeoutMs });
  const installed = await page.evaluate(
    samplerScript({
      selector,
      settleMs,
      timeoutMs,
      epsilon: CHANGE_EPSILON,
      maxSamples: sampleLimit(timeoutMs),
    }),
  );
  if (!isInstallResult(installed)) throw new Error("motion probe: sampler did not start");
  if (!installed.ok) throw new Error(`motion probe: ${installed.error}`);
  try {
    await trigger();
  } catch (error) {
    // 操作が失敗したらページ側の採取も止める。止めないと上限まで採り続け、同じページでの採り直しが
    // 「another motion probe is still running」で弾かれる。
    await page.evaluate(stopSampler).catch(() => {});
    throw error;
  }
  // ページ側の上限に、往復の遅れのぶんの余裕を足して待つ（ページ側が必ず先に done になる）。
  await page.waitForFunction(samplerDone, undefined, { timeout: timeoutMs + 5000, polling: 50 });
  const result = await page.evaluate(readSampler);
  if (!result) throw new Error("motion probe: sampler state disappeared (the page navigated?)");
  if (typeof result.error === "string")
    throw new Error(`motion probe: ${result.error} (${selector})`);
  return {
    probe_version: VERSION,
    selector,
    settle_ms: settleMs,
    timeout_ms: timeoutMs,
    timed_out: result.timed_out,
    samples: result.samples,
  };
}
