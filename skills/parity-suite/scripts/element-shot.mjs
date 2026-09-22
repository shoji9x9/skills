// 要素スクリーンショットの撮影（正本）。
// 正本はこのスキル側にあり、実行時はプロジェクトの
// `<parity_suite_dir>/parity/lib/tools/vendor/` へコピーして使う（配布スキルの成果物同梱規約。
// コピー先は trait-capture.mjs / trait-compare.mjs と同じ規約に従う）。
//
// なぜ要るか: Playwright の `locator.screenshot()` は、要素の矩形を**外接する整数矩形**へ広げてから
// 撮る。実装は次のとおりで（v1.56.1 の `packages/playwright-core/src/server/screenshotter.ts`
// `screenshotElement` が `helper.enclosingIntRect(documentRect)` を通す。`helper.ts`）:
//
//   x  = floor(rect.x + 1e-3)
//   y  = floor(rect.y + 1e-3)
//   x2 = ceil(rect.x + rect.width  - 1e-3)
//   y2 = ceil(rect.y + rect.height - 1e-3)
//
// 絶対座標が小数だと、要素自身の CSS box の寸法とは無関係に PNG が軸ごと最大 1px 大きくなる
// （x = 1328.8125 / width = 25 なら 1328..1354 の 26px)。現行アプリが小数座標で組まれ、新側
// （カタログ・Storybook 等の単純なレイアウト）が整数座標だと、同じ寸法の部品でも PNG の寸法が
// 食い違い、寸法一致を要求する `pixel-strict-count.mjs` / `pixel-crops.mjs` が**実行不能**になる。
// 実測では現行ベースライン 180 ファイル中 167 ファイルが小数座標を持ち、`button` の照合は
// 84/84 セル全てが実行不能だった（Issue #434）。
//
// 何をするか: 要素の矩形を**丸めた寸法そのもの**（`round(width) × round(height)`）の clip にして
// `page.screenshot({ clip })` で撮る。外接ではなく最近接に丸めるので、CSS box が 25px なら
// 現行側も新側も 25px の PNG になる。小数ぶんの位置ずれ（最大 0.5px）はアンチエイリアスの揺れとして
// ノイズ基準値の側が引き受ける——「比較できない」より「揺れとして測れる」方を採る。
//
// clip の座標系: `page.screenshot` は `fullPage` なしのとき clip を**ビューポート座標**として扱う
// （v1.56.1 `screenshotter.ts` の `screenshotPage`: clip を `trimClipToSize(options.clip, viewportSize)`
// に通して `viewportRect` として渡す）。`getBoundingClientRect()` もビューポート座標なので、
// 変換せずそのまま使える。出典: <https://github.com/microsoft/playwright/blob/v1.56.1/packages/playwright-core/src/server/screenshotter.ts>
//
// fail-closed: `trimClipToSize` は clip をビューポートへ**黙って切り詰める**ため、ビューポートから
// はみ出た要素は PNG が小さくなり、部品の一部だけを撮った成果物が「撮れた」として残る。
// 本ツールは切り詰めが起きる形を撮る前に失敗させる（ビューポートを広げるか、
// 撮れないことを `gaps.md` に残す）。面積 0 の矩形も撮らずに失敗させる。
//
// fail-closed（フレーム）: clip は**最上位フレーム**のビューポート座標として解釈されるので、iframe の中の
// 要素は `getBoundingClientRect()` と座標系が食い違う。フレーム側の innerWidth / innerHeight では
// はみ出し判定も通ってしまい、別の場所を切り出した PNG が黙って残る。最上位フレーム以外は撮らずに失敗させる
// （カタログが iframe で描くなら、その iframe の URL をページとして開いて撮る）。
//
// 決定論的: 乱数・現在時刻に依存しない。状態遷移・矩形が落ち着くまでの待ちは呼び出し側の責務で、
// 本ツールは「いまの矩形」を撮るだけ（trait-capture.mjs と同じ分担）。
// Playwright はピア前提であり import しない（Locator / Page は引数で受け取る）。
// TypeScript 構文は使わない（型は JSDoc）。

/**
 * ツールのバージョン（正本）。clip の算出規則・失敗条件・撮影オプションの既定を変えたら上げる。
 * metadata.json の `capture.tools.element_shot_version` に記録する値はこれを使う（手入力にしない）。
 * @type {string}
 */
export const VERSION = "2";

/**
 * 要素の矩形とビューポートから clip を決める純関数（ブラウザに依存しないのでここで単体検査できる）。
 *
 * 丸めは `Math.round` で行い、**外接（floor / ceil）にしない**——外接は要素の寸法に無関係な
 * 1px を足すので、同じ CSS box でも両側の PNG がずれる（このツールが存在する理由そのもの）。
 * `-0` は 0 に畳む（JSON へ `-0` が出ると採取物の差分がノイズになる）。
 *
 * @param {{ x:number, y:number, width:number, height:number }} rect - getBoundingClientRect() の値（ビューポート座標）
 * @param {{ width:number, height:number }} viewport - ビューポートの CSS ピクセル寸法
 * @returns {{ x:number, y:number, width:number, height:number }}
 * @throws {Error} 丸めた clip が面積 0 になる／ビューポートからはみ出す場合
 */
export function planElementClip(rect, viewport) {
  for (const [label, value] of [
    ["rect.x", rect && rect.x],
    ["rect.y", rect && rect.y],
    ["rect.width", rect && rect.width],
    ["rect.height", rect && rect.height],
    ["viewport.width", viewport && viewport.width],
    ["viewport.height", viewport && viewport.height],
  ]) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`element clip: ${label} must be a finite number (got ${String(value)})`);
    }
  }
  if (viewport.width <= 0 || viewport.height <= 0) {
    throw new Error(
      `element clip: viewport must be positive (got ${viewport.width}x${viewport.height})`,
    );
  }

  const zero = (n) => (n === 0 ? 0 : n);
  const x = zero(Math.round(rect.x));
  const y = zero(Math.round(rect.y));
  const width = Math.round(rect.width);
  const height = Math.round(rect.height);

  if (width <= 0 || height <= 0) {
    throw new Error(
      `element clip: rounded size is empty (rect=${rect.width}x${rect.height} -> ${width}x${height}).` +
        `the element is not drawn in this state; record it in gaps.md instead of capturing an empty PNG`,
    );
  }
  // trimClipToSize はビューポートの外を黙って落とす。切り詰めが起きる形は撮らせない。
  if (x < 0 || y < 0 || x + width > viewport.width || y + height > viewport.height) {
    throw new Error(
      `element clip: clip (${x}, ${y}, ${width}, ${height}) is not fully inside the viewport` +
        `(${viewport.width}x${viewport.height}); playwright would silently trim it and leave a partial PNG.` +
        `scroll the element into view, widen the viewport (and record the new capture condition),` +
        `or record the element as uncapturable in gaps.md`,
    );
  }
  return { x, y, width, height };
}

/**
 * ブラウザ内で矩形とビューポートを読む純関数（locator.evaluate に渡す）。
 * この関数は文字列化して evaluate に渡るため、外部スコープを参照しない。
 * @param {Element} el
 */
function readRectAndViewport(el) {
  const box = el.getBoundingClientRect();
  const view = el.ownerDocument.defaultView;
  let topFrame;
  try {
    topFrame = view === view.top;
  } catch {
    topFrame = false;
  }
  return {
    rect: { x: box.x, y: box.y, width: box.width, height: box.height },
    viewport: { width: view.innerWidth, height: view.innerHeight },
    top_frame: topFrame,
  };
}

/**
 * 要素を丸めた整数 clip で撮る。呼び出し側が目的の状態へ遷移させ、矩形が落ち着くまで待ってから呼ぶこと。
 *
 * `locator.screenshot()` を置き換える経路なので、**採取側とカタログ側の両方で同じこの関数を使う**
 * （片側だけ差し替えると、外接の 1px がそのまま寸法差として残り、塞いだはずの穴が戻る）。
 *
 * @param {import('playwright').Page} page - clip 付き撮影に使う Page（locator と同じ最上位フレームのページ）
 * @param {import('playwright').Locator} locator - 撮る要素（一意に解決すること）
 * @param {{ path?: string, scrollIntoView?: boolean, animations?: ("disabled"|"allow") }} [options]
 *   path を渡すとそこへ書き出す。scrollIntoView は既定 true（`locator.screenshot()` と同じく、撮る前に見える位置へ入れる）。
 *   animations は既定 `"disabled"`——Playwright の既定は `"allow"` で、アニメーション・トランジションの
 *   途中フレームがそのまま PNG になり run ごとに揺れる。採取条件は `animations: disabled` として
 *   記録される運用なので、記録と実体が食い違わないよう既定で止める
 *   （出典: <https://playwright.dev/docs/api/class-page#page-screenshot>）
 * @returns {Promise<{ buffer: Buffer, clip: { x:number, y:number, width:number, height:number },
 *                     rect: { x:number, y:number, width:number, height:number }, tool_version: string }>}
 * @throws {Error} 要素が最上位フレームに無い（clip の座標系が食い違う）場合

 */
export async function captureElementShot(page, locator, options = {}) {
  const { path, scrollIntoView = true, animations = "disabled" } = options;
  if (animations !== "disabled" && animations !== "allow") {
    throw new Error(
      `element clip: animations must be "disabled" or "allow" (got ${String(animations)})`,
    );
  }
  if (scrollIntoView) await locator.scrollIntoViewIfNeeded();
  const measured = await locator.evaluate(readRectAndViewport);
  // フレームの中の要素は撮れない。`getBoundingClientRect()` はそのフレームのビューポート座標だが、
  // `page.screenshot({ clip })` は**最上位フレーム**のビューポート座標として解釈されるため、
  // 座標系が食い違ったまま別の場所を切り出した PNG が「撮れた」として残る（ビューポート内判定も
  // フレーム側の innerWidth / innerHeight で通ってしまうので気付けない）。
  // Storybook のようにカタログが iframe で描く場合は、iframe の URL 自体をページとして開いて撮る
  // （`/iframe.html?id=<story>`）。
  if (measured.top_frame !== true) {
    throw new Error(
      "element clip: the element lives inside a frame. getBoundingClientRect() is relative to that " +
        "frame, but page.screenshot({ clip }) is relative to the top-level viewport, so the crop " +
        "would silently land on the wrong region. open the frame's own URL as a page " +
        "(Storybook: /iframe.html?id=<story>) and capture the element there",
    );
  }
  const clip = planElementClip(measured.rect, measured.viewport);
  const shot = { clip, animations };
  if (path !== undefined) shot.path = path;
  const buffer = await page.screenshot(shot);
  return { buffer, clip, rect: measured.rect, animations, tool_version: VERSION };
}
