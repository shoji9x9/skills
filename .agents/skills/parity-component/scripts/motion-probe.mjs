// 部品の動き（出し入れ・開閉のアニメーション）の時系列を採る探針（正本）。Issue #456。
// 正本はこのスキル側にあり、実行時はプロジェクトの `<parity_suite_dir>/parity/lib/tools/vendor/` へ
// コピーして使う（Playwright のスペックから import するため。parity-suite 同梱の element-shot.mjs と同じ規約）。
//
// 何のためか: 見た目の照合は `animations: "disabled"` で止めて撮るので、現行の部品が持つ動き
// （jQuery の `show('slide')` / `fadeIn`、CSS の `transition` / `animation`）は採取物にも見本の照合にも写らない。
// 新側が動きを持たないまま、部品の照合・スイート・parity-diff がすべて緑になる（Issue #456 の実例）。
// 画素では比べられなくても、`requestAnimationFrame` ごとに要素の矩形と不透明度を採れば、
// 動きの長さ・始まるまでの遅れ・軌跡は数値で比べられる。比較は同梱の motion-compare.mjs が行う。
//
// 何をするか: 呼び出し側が渡した `trigger`（動きを起こす操作）の直前に、ページ側で rAF ごとの採取を始め、
// 最後の変化から `settleMs` のあいだ何も変わらなくなるまで（または `timeoutMs` まで）採り続ける。
// 各フレームで、要素が在るか・矩形（x / y / width / height）・実効の不透明度（祖先まで掛け合わせた値）を記録する。
//
// 要素は CSS セレクタで引く（論理名ではない）。出現する動きでは、操作の前に要素がまだ無いので
// ロケータを先に解決できず、ページ側で毎フレーム引き直すしかないため。セレクタは片側の実装に固有でよい
// （現行と新側で別のセレクタを使う）——比べるのは時系列の数値で、セレクタは比べない。
// 引いた要素が複数あるときは採らずに失敗させる（どの要素の動きかを後から決められない）。
//
// 前提: 探針のあいだはアニメーションを止めない（element-shot.mjs の `animations: "disabled"` や、
// ページ側で全体を止める仕掛けを外して開く）。止めたまま採ると、動きのある部品も長さ 0 に記録される。
//
// 決定論的: 乱数に依存しない。時刻はページの `performance.now()` だけを使い、値は丸めて記録する。
// Playwright はピア前提であり import しない（Page / Frame は引数で受け取る）。TypeScript 構文は使わない（型は JSDoc）。

/**
 * ツールのバージョン（正本）。採る値・変化の判定・終わりの判定・出力の形を変えたら上げる。
 */
export const VERSION = "1";

/**
 * 変化とみなす最小の差（正本。motion-compare.mjs の CHANGE_EPSILON と同じ値にする）。
 * 採った値は丸めて記録するので、丸めの桁より細かい差は変化にしない。
 */
export const CHANGE_EPSILON = { px: 0.01, opacity: 0.001 };

/** 記録するフレーム数の上限。これを超えたら打ち切りとして記録する（timed_out）。 */
export const MAX_SAMPLES = 5000;

/**
 * ページ側で採取を始める（`page.evaluate` に渡す関数。直列化されるので外側の名前を参照しない）。
 * 既に採取中のものがあれば上書きせずに失敗させる（前の探針が終わっていない）。
 * @param {{ selector: string, settleMs: number, timeoutMs: number, epsilon: { px: number, opacity: number }, maxSamples: number }} arg
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function installSampler({ selector, settleMs, timeoutMs, epsilon, maxSamples }) {
  const g = globalThis;
  if (g.__parityMotionProbe && !g.__parityMotionProbe.done) {
    return { ok: false, error: "another motion probe is still running on this page" };
  }
  const round = (value, digits) => {
    const p = 10 ** digits;
    return Math.round(value * p) / p;
  };
  const read = () => {
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
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
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
  };
  const differs = (a, b) => {
    if (a.present !== b.present) return true;
    if (!a.present) return false;
    return (
      Math.abs(a.x - b.x) > epsilon.px ||
      Math.abs(a.y - b.y) > epsilon.px ||
      Math.abs(a.width - b.width) > epsilon.px ||
      Math.abs(a.height - b.height) > epsilon.px ||
      Math.abs(a.opacity - b.opacity) > epsilon.opacity
    );
  };
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
    if (state.done) return;
    const now = g.performance.now();
    const t = round(now - state.startedAt, 1);
    let sample;
    try {
      sample = read();
    } catch (error) {
      // 不正なセレクタ等で投げたまま抜けると done が偽のまま残り、同じページの採り直しが
      // 「another motion probe is still running」で永久に弾かれる（rAF の中なら待つ側も上限まで待つ）。
      sample = {
        error: `sampler failed: ${error && error.message ? error.message : String(error)}`,
      };
    }
    if (sample.error) {
      state.error = sample.error;
      state.done = true;
      return;
    }
    const previous = state.samples[state.samples.length - 1];
    if (previous && differs(previous, sample)) state.lastChangeAt = now;
    state.samples.push({ t, ...sample });
    const settled = state.lastChangeAt !== null && now - state.lastChangeAt >= settleMs;
    if (settled) {
      state.done = true;
      return;
    }
    if (now - state.startedAt >= timeoutMs || state.samples.length >= maxSamples) {
      // 変化が一度も無いまま時間が尽きたのは「動かなかった」という観測で、打ち切りではない。
      // 変化の途中で尽きたときだけ、終わりを見ていないので打ち切りとして記録する。
      state.timed_out = state.lastChangeAt !== null || state.samples.length >= maxSamples;
      state.done = true;
      return;
    }
    g.requestAnimationFrame(step);
  };
  step();
  // 最初の採取で失敗した（不正なセレクタ・操作の前から複数に当たる）なら、操作を起こす前に返す。
  // ok: true を返すと呼び出し側が trigger を実行し、失敗が報告される前にクリック・送信・遷移が現行へ届く。
  if (state.error) return { ok: false, error: state.error };
  return { ok: true };
}

/**
 * ページ側の採取が終わったか（`page.waitForFunction` に渡す関数）。
 * @returns {boolean}
 */
export function samplerDone() {
  const state = globalThis.__parityMotionProbe;
  // 状態が消えた（ページが遷移した）ら待ち続けず終わらせ、readSampler の null で理由を報告する。
  return !state || Boolean(state.done);
}

/**
 * ページ側の採取結果を取り出す（`page.evaluate` に渡す関数）。
 * @returns {{ timed_out: boolean, error: string | null, samples: object[] } | null}
 */
export function readSampler() {
  const state = globalThis.__parityMotionProbe;
  if (!state) return null;
  return { timed_out: state.timed_out, error: state.error, samples: state.samples };
}

/**
 * 動きを 1 回採る。
 *
 * @param {{ evaluate: Function, waitForFunction: Function }} page Playwright の Page か Frame（要素が居る文書）
 * @param {{
 *   selector: string,
 *   trigger: () => Promise<unknown>,
 *   settleMs?: number,
 *   timeoutMs?: number,
 * }} options
 *   - selector: 動く要素を引く CSS セレクタ（その文書で高々 1 件に当たること）
 *   - trigger: 動きを起こす操作。採取を始めた直後に呼ぶ（論理名の手順で書く）
 *   - settleMs: 最後の変化からこの時間なにも変わらなければ終わりとみなす（既定 500ms）
 *   - timeoutMs: 採取の上限（既定 10000ms。自動で閉じるまでの時間を測るなら、その時間より長くする）
 * @returns {Promise<{ probe_version: string, selector: string, settle_ms: number, timeout_ms: number, timed_out: boolean, samples: object[] }>}
 */
export async function probeMotion(page, options) {
  const { selector, trigger, settleMs = 500, timeoutMs = 10000 } = options ?? {};
  if (typeof selector !== "string" || selector.trim() === "") {
    throw new Error("motion probe: selector is required");
  }
  if (typeof trigger !== "function") throw new Error("motion probe: trigger must be a function");
  for (const [name, value] of [
    ["settleMs", settleMs],
    ["timeoutMs", timeoutMs],
  ]) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`motion probe: ${name} must be a positive number (got ${String(value)})`);
    }
  }
  if (settleMs >= timeoutMs) {
    throw new Error("motion probe: settleMs must be shorter than timeoutMs");
  }
  const installed = await page.evaluate(installSampler, {
    selector,
    settleMs,
    timeoutMs,
    epsilon: CHANGE_EPSILON,
    maxSamples: MAX_SAMPLES,
  });
  if (!installed || !installed.ok) {
    throw new Error(`motion probe: ${installed ? installed.error : "sampler did not start"}`);
  }
  try {
    await trigger();
  } catch (error) {
    // 操作が失敗したらページ側の採取も止める。止めないと上限まで採り続け、同じページでの採り直しが
    // 「another motion probe is still running」で弾かれる。
    await page
      .evaluate(() => {
        const state = globalThis.__parityMotionProbe;
        if (state) state.done = true;
      })
      .catch(() => {});
    throw error;
  }
  // ページ側の上限に、往復の遅れのぶんの余裕を足して待つ（ページ側が必ず先に done になる）。
  await page.waitForFunction(samplerDone, undefined, { timeout: timeoutMs + 5000, polling: 50 });
  const result = await page.evaluate(readSampler);
  if (!result) throw new Error("motion probe: sampler state disappeared (the page navigated?)");
  if (result.error) throw new Error(`motion probe: ${result.error} (${selector})`);
  return {
    probe_version: VERSION,
    selector,
    settle_ms: settleMs,
    timeout_ms: timeoutMs,
    timed_out: result.timed_out,
    samples: result.samples,
  };
}
