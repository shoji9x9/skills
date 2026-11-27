// 全画面を撮る前に文書の末尾までスクロールする処理のうち、ページで実行するコード。scroll-settle.mjs が scrollThroughInPage を
// import し、page.evaluate へそのまま渡す。
// page.evaluate は関数のソースだけをページへ送るので、scrollThroughInPage は本体の外の名前を参照しない。
// 本体が呼ぶ関数はすべて本体の中に入れ子で書き、読むのは引数と素のグローバル（window・document・setTimeout など）だけにする。
// このファイルは import を持たない。scroll-settle.mjs と一緒に、その隣の page/ へコピーして使う。
// スクロールの仕方・待つ対象・上書きするスタイル・返す値の形を変えたら、scroll-settle.mjs の VERSION とこのファイルの
// PAGE_VERSION を同じ値に上げる。

/** このファイルのバージョン。scroll-settle.mjs の VERSION と同じ値にする。 */
export const PAGE_VERSION = "1";

/**
 * 文書の末尾まで 1 画面ずつスクロールし、各位置で見えている画像の読み込みを上限付きで待ち、始めの位置に戻す（ページへ渡す関数の本体）。
 *
 * スクロールの前に、`content-visibility: auto` の要素を `visible` に上書きする。auto の要素は画面の外にあると描画を省かれ、
 * 末尾までスクロールしても、始めの位置に戻すと再び省かれるので、全画面の撮影では空白になる（Chrome 156 で実測）。
 * 上書きは要素の style 属性に important を付けて書き、外さない。撮影・マスクの矩形・特性・aria を同じ配置で採るためである。
 * 上書きするのは、呼んだ時点で主文書にある auto の要素だけである。shadow DOM の中の要素と、呼んだ後に足された要素は上書きしない。
 *
 * 時間は setTimeout だけで測る。撮る前に page.clock.setFixedTime で時刻を固定すると Date が進まないが、タイマーは進むからである。
 * 各位置では 2 フレーム待ってから画像を集める。loading="lazy" の画像の読み込みの開始と IntersectionObserver のコールバックは、
 * スクロールした後の描画の更新で行われるので、待たずに集めると読み込みを始める前の画像を見落とす。
 * 記録する画像の URL は、クエリとフラグメントを外す（署名つきの URL のトークンを成果物に残さない）。data: と blob: は方式だけを残す。
 * @param {{ stepTimeoutMs: number, totalTimeoutMs: number, maxSteps: number }} options
 * @returns {Promise<{
 *   start: { x: number, y: number },
 *   end: { x: number, y: number },
 *   steps: number,
 *   scroll_height: number,
 *   viewport_height: number,
 *   stopped: "max_steps" | "total_timeout" | "not_scrolled" | null,
 *   timed_out_images: { url: string, y: number }[],
 *   content_visibility_overridden: number,
 * }>}
 */
export async function scrollThroughInPage(options) {
  const { stepTimeoutMs, totalTimeoutMs, maxSteps } = options;
  const root = document.scrollingElement ?? document.documentElement;
  const start = { x: window.scrollX, y: window.scrollY };

  /** 2 フレーム待つ。スクロールや上書きの後の描画の更新（IntersectionObserver のコールバックを含む）を終わらせるためである。 */
  const twoFrames = async () => {
    for (let i = 0; i < 2; i += 1) {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    }
  };

  /** @param {Element} el */
  const inView = (el) => {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
  };

  /** @param {HTMLImageElement} img */
  const urlOf = (img) => {
    const raw = img.currentSrc || img.src;
    if (/^(data|blob):/i.test(raw)) return `${raw.slice(0, raw.indexOf(":"))}:`;
    return raw.replace(/[?#].*$/s, "");
  };

  /**
   * 画像の読み込み（成功か失敗）を、ms ミリ秒まで待つ。読み込みを終えたら true、上限で打ち切ったら false を返す。
   * @param {HTMLImageElement} img
   * @param {number} ms
   * @returns {Promise<boolean>}
   */
  const settle = (img, ms) =>
    new Promise((resolve) => {
      if (img.complete) {
        resolve(true);
        return;
      }
      const timer = setTimeout(() => resolve(img.complete), ms);
      const done = () => {
        clearTimeout(timer);
        resolve(true);
      };
      img.addEventListener("load", done, { once: true });
      img.addEventListener("error", done, { once: true });
    });

  /**
   * content-visibility: auto の要素を visible に上書きし、上書きした数を返す。hidden の要素は、ページが意図して隠しているので触らない。
   * @returns {Promise<number>}
   */
  const overrideAutoVisibility = async () => {
    const autoElements = [...document.querySelectorAll("*")].filter(
      (el) => getComputedStyle(el).contentVisibility === "auto",
    );
    for (const el of autoElements) {
      if (el instanceof HTMLElement || el instanceof SVGElement) {
        el.style.setProperty("content-visibility", "visible", "important");
      }
    }
    if (autoElements.length > 0) await twoFrames();
    return autoElements.length;
  };

  /** @type {Set<HTMLImageElement>} 打ち切りを記録した画像。末尾の位置は前の位置と重なるので、同じ画像を 2 回記録しない */
  const recorded = new Set();
  /**
   * いまの位置で見えている、読み込みを終えていない画像を待ち、上限で打ち切った画像を timedOut に足す。
   * @param {{ url: string, y: number }[]} timedOut
   */
  const waitImagesInView = async (timedOut) => {
    const waiting = [...document.images].filter((img) => !img.complete && inView(img));
    const results = await Promise.all(waiting.map((img) => settle(img, stepTimeoutMs)));
    waiting.forEach((img, i) => {
      if (results[i] || recorded.has(img)) return;
      recorded.add(img);
      timedOut.push({ url: urlOf(img), y: window.scrollY });
    });
  };

  /**
   * 次の位置へ進まずに終える理由を返す。末尾に届いたら "bottom"、進めるなら null。
   * @param {{ steps: number, previous: number, expired: boolean }} progress
   * @returns {"bottom" | "max_steps" | "total_timeout" | "not_scrolled" | null}
   */
  const reasonToStop = ({ steps, previous, expired }) => {
    const bottom = Math.max(0, root.scrollHeight - window.innerHeight);
    // scrollHeight は整数に丸められ、scrollY は小数になりうる（deviceScaleFactor が 1 でないときなど）。
    // 1px 未満の残りは末尾に届いたとして扱い、末尾で止まったのを not_scrolled として記録しない
    if (window.scrollY >= bottom - 1) return "bottom";
    // 前の位置から進めなかった（スクロールのたびに位置を戻すページなど）。同じ位置で待ち続けない
    if (window.scrollY <= previous) return "not_scrolled";
    if (steps >= maxSteps) return "max_steps";
    if (expired) return "total_timeout";
    return null;
  };

  /**
   * 始めの位置に戻した後の状態を、返す記録にする。末尾に届いたとき（"bottom"）は、止めた理由を null にする。
   * @param {{ steps: number, reason: "bottom" | "max_steps" | "total_timeout" | "not_scrolled" | null, timedOut: { url: string, y: number }[], overridden: number }} done
   */
  const report = ({ steps, reason, timedOut, overridden }) => ({
    start,
    end: { x: window.scrollX, y: window.scrollY },
    steps,
    scroll_height: root.scrollHeight,
    viewport_height: window.innerHeight,
    stopped: reason === "bottom" ? null : reason,
    timed_out_images: timedOut,
    content_visibility_overridden: overridden,
  });

  const overridden = await overrideAutoVisibility();
  const progress = { steps: 0, previous: -1, expired: false };
  const totalTimer = setTimeout(() => {
    progress.expired = true;
  }, totalTimeoutMs);
  /** @type {{ url: string, y: number }[]} */
  const timedOut = [];
  /** @type {"bottom" | "max_steps" | "total_timeout" | "not_scrolled" | null} */
  let reason = null;
  let y = 0;
  try {
    while (reason === null) {
      window.scrollTo({ left: start.x, top: y, behavior: "instant" });
      await twoFrames();
      await waitImagesInView(timedOut);
      progress.steps += 1;
      reason = reasonToStop(progress);
      progress.previous = window.scrollY;
      y = window.scrollY + window.innerHeight;
    }
  } finally {
    clearTimeout(totalTimer);
    window.scrollTo({ left: start.x, top: start.y, behavior: "instant" });
  }
  await twoFrames();
  return report({ steps: progress.steps, reason, timedOut, overridden });
}
