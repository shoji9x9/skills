// 全画面を撮る前に、文書の末尾まで 1 画面ずつスクロールして、遅延読み込みの内容を読み込ませる（原本）。
// 原本はこのスキル側にあり、実行時はプロジェクトの `<parity_suite_dir>/parity/lib/tools/vendor/` へコピーして使う。
// ページで実行する page/scroll-settle.page.mjs も、同じバージョンから `vendor/page/` へコピーする。
// 現側の採取のスペックと、parity-diff の新側の採取の雛形が、同じコピーを import する（待ち方の差を差分にしない）。
//
// なぜ要るか: Playwright の全画面の撮影（`page.screenshot({ fullPage: true })`）は、スクロールせずにビューポートの外まで
// 描画させる。そのため、スクロールで表示が始まる内容（`loading="lazy"` の画像・IntersectionObserver で表示を始める要素）は、
// 表示が始まる前の状態のまま画像になる。新旧が同じ実装ならどちらも空白になって差が出ず、片方だけなら実装と関係の無い差が出る。
//
// 何をするか: 文書の先頭から末尾まで 1 画面ずつスクロールし、各位置で見えている画像の読み込み（成功か失敗）を上限付きで待ち、
// 始めの位置に戻す。戻せなかったら例外にする。戻さずに撮ると、mask-rects.json と traits.json の座標の基準が変わるからである。
// 上限で打ち切った画像と、末尾まで届かずに止めた理由は、返す記録（scroll-settle.json に書く）に残し、撮影は止めない。
//
// `content-visibility: auto` の要素は、スクロールしても始めの位置に戻すと再び描画を省かれるので、スクロールの前に visible に
// 上書きする（上書きした数を記録に残す）。扱いの原本は parity-suite の references/baseline.md「全画面を撮る前に末尾までスクロールする」である。
//
// 対象にしないもの: ビューポートの中だけの撮影（見えている範囲しか撮らないので、スクロールは要らない）。
// 文書の中のスクロールする箱（overflow: auto の一覧など）の中身。CSS の背景画像の読み込み。
//
// Playwright はピア前提であり import しない（Page は引数で受け取る）。TypeScript 構文は使わない（型は JSDoc）。

import { PAGE_VERSION, scrollThroughInPage } from "./page/scroll-settle.page.mjs";

/**
 * ツールのバージョン（原本）。スクロールの仕方・待つ対象・記録の形を変えたら上げる。
 * 上げるときは、page/scroll-settle.page.mjs の PAGE_VERSION も同じ値にする（違うと settleByScrolling がスクロールせずに止める）。
 * @type {string}
 */
export const VERSION = "1";

/**
 * 上限のデフォルト。1 つの位置で画像を待つ時間、全体でスクロールを続ける時間、スクロールする位置の数の上限である。
 * 全体の上限を過ぎても、その位置の画像を待ち終えるまでは続ける。
 */
export const DEFAULT_LIMITS = Object.freeze({
  stepTimeoutMs: 2_000,
  totalTimeoutMs: 20_000,
  maxSteps: 50,
});

/**
 * page ファイルの PAGE_VERSION が、このスクリプトの VERSION と同じかを確かめる。違えば、片方だけを古いバージョンのまま
 * コピーしてあるので、スクロールせずに失敗する。
 * @param {string} pageVersion
 */
export function assertPageVersion(pageVersion) {
  if (pageVersion !== VERSION) {
    throw new Error(
      `scroll-settle: page/scroll-settle.page.mjs has PAGE_VERSION ${pageVersion} but scroll-settle.mjs has VERSION ${VERSION}; copy both files from the same version`,
    );
  }
}

/**
 * 配列でも null でもないオブジェクトか。
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return Object.prototype.toString.call(value) === "[object Object]";
}

/**
 * 上限を読む。省いたキーはデフォルトにし、正の整数でない値は受け付けない。
 * @param {unknown} limits
 * @returns {{ stepTimeoutMs: number, totalTimeoutMs: number, maxSteps: number }}
 */
export function readLimits(limits = {}) {
  if (!isRecord(limits)) {
    throw new TypeError("scroll-settle: limits must be an object");
  }
  const known = Object.keys(DEFAULT_LIMITS);
  const unknown = Object.keys(limits).filter((key) => !known.includes(key));
  if (unknown.length > 0) {
    throw new TypeError(`scroll-settle: unknown limits: ${unknown.join(", ")}`);
  }
  /**
   * 省いたキー（undefined）だけをデフォルトにする。null はデフォルトにせず、型の誤りとして扱う。
   * @param {string} key
   * @param {number} fallback
   * @returns {number}
   */
  const positive = (key, fallback) => {
    const value = limits[key] === undefined ? fallback : limits[key];
    if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
      throw new TypeError(`scroll-settle: limits.${key} must be a positive integer`);
    }
    return value;
  };
  return {
    stepTimeoutMs: positive("stepTimeoutMs", DEFAULT_LIMITS.stepTimeoutMs),
    totalTimeoutMs: positive("totalTimeoutMs", DEFAULT_LIMITS.totalTimeoutMs),
    maxSteps: positive("maxSteps", DEFAULT_LIMITS.maxSteps),
  };
}

/**
 * 現側の組の scroll-settle.json（settleByScrolling が返した記録）から、同じ上限を読む。新側は、この上限で同じ待ち方をする。
 * 記録を書いた VERSION がこのスクリプトと違えば、待ち方が違うので失敗する（現側と新側を同じバージョンで撮り直す）。
 * @param {unknown} record
 * @returns {{ stepTimeoutMs: number, totalTimeoutMs: number, maxSteps: number }}
 */
export function limitsFromRecord(record) {
  if (!isRecord(record)) {
    throw new TypeError("scroll-settle: record must be an object (scroll-settle.json)");
  }
  if (record.version !== VERSION) {
    throw new Error(
      `scroll-settle: record was written by version ${JSON.stringify(record.version)} but scroll-settle.mjs has VERSION ${VERSION}; capture both sides with the same version`,
    );
  }
  const limits = record.limits;
  if (!isRecord(limits)) {
    throw new TypeError("scroll-settle: record.limits must be an object");
  }
  const keys = ["step_timeout_ms", "total_timeout_ms", "max_steps"];
  const extra = Object.keys(limits).filter((key) => !keys.includes(key));
  const missing = keys.filter((key) => !Object.hasOwn(limits, key));
  if (extra.length > 0 || missing.length > 0) {
    throw new TypeError(
      `scroll-settle: record.limits must have exactly ${keys.join(", ")} (missing: ${missing.join(", ") || "-"}, unknown: ${extra.join(", ") || "-"})`,
    );
  }
  return readLimits({
    stepTimeoutMs: limits.step_timeout_ms,
    totalTimeoutMs: limits.total_timeout_ms,
    maxSteps: limits.max_steps,
  });
}

/**
 * 全画面を撮る直前に呼ぶ。文書の末尾まで 1 画面ずつスクロールし、各位置で見えている画像の読み込みを上限付きで待ち、
 * 始めの位置に戻す。戻せなければ例外にする（撮らない）。返す記録は scroll-settle.json として撮影の組のディレクトリに書く。
 * @param {{ evaluate: (fn: typeof scrollThroughInPage, arg: { stepTimeoutMs: number, totalTimeoutMs: number, maxSteps: number }) => ReturnType<typeof scrollThroughInPage> }} page
 * @param {unknown} [limits]
 */
export async function settleByScrolling(page, limits) {
  assertPageVersion(PAGE_VERSION);
  const read = readLimits(limits);
  const result = await page.evaluate(scrollThroughInPage, read);
  if (result.end.x !== result.start.x || result.end.y !== result.start.y) {
    throw new Error(
      `scroll-settle: could not scroll back to (${result.start.x}, ${result.start.y}); now at (${result.end.x}, ${result.end.y}). ` +
        "撮影の座標の基準が変わるので撮らない（scroll-snap やスクロールで動く処理を確かめる）",
    );
  }
  return {
    version: VERSION,
    limits: {
      step_timeout_ms: read.stepTimeoutMs,
      total_timeout_ms: read.totalTimeoutMs,
      max_steps: read.maxSteps,
    },
    steps: result.steps,
    scroll_height: result.scroll_height,
    viewport_height: result.viewport_height,
    stopped: result.stopped,
    timed_out_images: result.timed_out_images,
    content_visibility_overridden: result.content_visibility_overridden,
  };
}

/**
 * settleByScrolling の記録が、末尾まで読み込み切れなかった組かを 1 行の警告にする。読み込み切れたなら null を返す。
 * 現側の採取のスペックと新側の雛形が、撮った後に同じ関数で警告を出す（読み込み切れなかった組を、記録を読まない実行でも利用者に知らせる）。
 * 撮影は止めない。その部分の画像は、遅延読み込みの前の状態を含みうる。
 * @param {{ stopped: string | null, timed_out_images: { url: string, y: number }[] }} record
 * @returns {string | null}
 */
export function incompleteSettle(record) {
  const parts = [];
  if (record.stopped !== null) parts.push(`stopped before the end (${record.stopped})`);
  if (record.timed_out_images.length > 0) {
    const urls = record.timed_out_images.map((image) => image.url).join(", ");
    parts.push(`${record.timed_out_images.length} image(s) timed out: ${urls}`);
  }
  return parts.length === 0
    ? null
    : `scroll-settle: ${parts.join("; ")}. 画面の外の遅延読み込みの内容を読み込み切れずに撮った`;
}
