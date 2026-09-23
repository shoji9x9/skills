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
// フレーム: clip は**最上位フレーム**のビューポート座標として解釈されるので、iframe の中の要素は
// `getBoundingClientRect()`（そのフレームの座標）をそのまま使えない。フレームを 1 段ずつ遡り、
// フレーム要素の矩形 + 枠線（計算後スタイルの border-*-width）+ padding を足して最上位の座標へ直す（Issue #436。
// ダイアログ内 iframe の部品は、ローカル座標が整数でも親のオフセットが小数なら `locator.screenshot()` の
// 外接で PNG が 1px 膨らんでいた）。直せない形は撮る前に失敗させる:
//   - 読めないフレーム（クロスオリジンで `frameElement` が null）: 足すべきオフセットが分からない
//   - 変形されたフレーム（transform で拡縮）: 足し算では座標が決まらない
//   - 途中のフレームの見える範囲からはみ出す要素: そのフレームが切るので、部品の一部だけの PNG になる
//
// 記録: `path` を渡すと、PNG の隣に `<名前>.shot.json` を書く（実際に使った clip・出力 PNG の実寸・
// 最上位座標の矩形）。trait-capture.mjs の `rect` はフレーム内の座標で、撮影のスクロール前に採られることも
// あるため、`rect` から PNG の実寸は導出できない（Issue #436）。撮った側が撮った値を同じ場で残す。
//
// 決定論的: 乱数・現在時刻に依存しない。状態遷移・矩形が落ち着くまでの待ちは呼び出し側の責務で、
// 本ツールは「いまの矩形」を撮るだけ（trait-capture.mjs と同じ分担）。
// Playwright はピア前提であり import しない（Locator / Page は引数で受け取る）。
// TypeScript 構文は使わない（型は JSDoc）。

import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/**
 * ツールのバージョン（正本）。clip の算出規則・失敗条件・撮影オプションの既定を変えたら上げる。
 * 3: 撮影後に矩形を測り直し、撮影中に動いていたら失敗させる。
 * 4: `path` は Playwright へ渡さず、検査を通ってから自分で書く（拒否した PNG を残さない）。
 * 5: 撮る前に生きているアニメーションを数え、`animations: "disabled"` なら撮らずに失敗させる。
 * 6: 同一オリジンの iframe の中の要素を、フレームのオフセットを足して撮る。`path` の隣に `.shot.json` を書く。
 * metadata.json の `capture.tools.element_shot_version` に記録する値はこれを使う（手入力にしない）。
 * @type {string}
 */
export const VERSION = "6";

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
 *
 * iframe の中なら、フレームを 1 段ずつ遡って最上位のビューポート座標（`page_rect`）へ直す。
 * 各段のオフセットは「フレーム要素の矩形 + 枠線 + padding」で、フレームの中身はそこから始まる。
 * 各段で要素がそのフレームの見える範囲に収まっているかを Node 側で判定できるよう、
 * 段ごとの矩形と見える範囲を `frames` に並べる（内側から外側へ。最上位は含めない）。
 * @param {Element} el
 */
function readRectAndViewport(el) {
  const box = el.getBoundingClientRect();
  // 生きているアニメーションを数える。`animations: "disabled"` は**撮影の中で**有限のものを
  // 完了まで早送りし、無限のものを初期状態へ戻してから撮り、撮り終えたら元の時刻へ復帰させる。
  // そのため撮影の前後で測った矩形が同じでも、PNG は別の幾何で撮られている（一時停止した無限
  // アニメーションが典型）。撮る前に件数を見て、生きているなら clip を信用しない。
  let liveAnimations = null;
  try {
    liveAnimations = el
      .getAnimations({ subtree: true })
      .filter((a) => a.playState !== "finished" && a.playState !== "idle").length;
  } catch {
    liveAnimations = null; // getAnimations を持たない環境では数えられない（判定しない）
  }
  const rect = { x: box.x, y: box.y, width: box.width, height: box.height };
  let view = el.ownerDocument.defaultView;
  let x = box.x;
  let y = box.y;
  const frames = [];
  let frameError = null;
  for (;;) {
    let isTop;
    try {
      isTop = view === view.top;
    } catch {
      isTop = false;
    }
    if (isTop) break;
    let frameEl = null;
    try {
      frameEl = view.frameElement;
    } catch {
      frameEl = null;
    }
    if (!frameEl) {
      frameError = "unreadable";
      break;
    }
    // 見える範囲はスクロールバーを除いた寸法（scrollingElement は quirks なら body、標準なら html）。
    const doc = view.document;
    const scroller = doc.scrollingElement || doc.documentElement;
    frames.push({
      rect: { x, y, width: box.width, height: box.height },
      viewport: { width: scroller.clientWidth, height: scroller.clientHeight },
    });
    const parent = view.parent;
    const frameBox = frameEl.getBoundingClientRect();
    // transform で拡縮されたフレームは、矩形（変形後）とレイアウト寸法（変形前）が食い違う。
    // 中身の座標も同じ倍率で縮むので、足し算では最上位の座標が決まらない。
    // offsetWidth / offsetHeight は整数へ丸められるので（枠線・padding が小数なら矩形と 1px 未満ずれる。
    // 実測: 610.5px のフレームで offsetWidth=611）、1px 以上の食い違いだけを変形とみなす。
    // それより小さい倍率ずれは、フレーム全体でも位置の誤差が 1px 未満で、clip の丸めと同じ桁に収まる。
    if (
      Math.abs(frameBox.width - frameEl.offsetWidth) >= 1 ||
      Math.abs(frameBox.height - frameEl.offsetHeight) >= 1
    ) {
      frameError = "transformed";
      break;
    }
    const style = parent.getComputedStyle(frameEl);
    // 枠線は clientLeft / clientTop ではなく計算後スタイルから読む。clientLeft は整数へ丸められるが、
    // 枠線はデバイスピクセルへスナップされて小数になる（実測: deviceScaleFactor 1.5 で 1px の枠線は
    // borderLeftWidth=0.666667px・clientLeft=1）。丸めた値を足すと最上位の座標が 1/3px ずれ、clip の丸めが 1px 反転しうる。
    x += frameBox.x + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
    y += frameBox.y + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop);
    view = parent;
  }
  return {
    rect,
    page_rect: { x, y, width: box.width, height: box.height },
    viewport: { width: view.innerWidth, height: view.innerHeight },
    frames,
    frame_error: frameError,
    live_animations: liveAnimations,
  };
}

/**
 * PNG の IHDR から実寸を読む。`page.screenshot()` は PNG を返すはずだが、実寸を記録する以上
 * 読めないものを黙って null にしない（記録と実体が食い違う成果物を作らない）。
 * @param {Buffer} buffer
 * @returns {{ width:number, height:number }}
 */
export function readPngSize(buffer) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (
    !Buffer.isBuffer(buffer) ||
    buffer.length < 24 ||
    signature.some((b, i) => buffer[i] !== b) ||
    buffer.toString("latin1", 12, 16) !== "IHDR"
  ) {
    throw new Error("element clip: page.screenshot() did not return a PNG (no IHDR header)");
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/**
 * `element.png` の隣に置く記録ファイルのパス（`element.png` → `element.shot.json`）。
 * @param {string} path - PNG のパス（`.png` で終わること）
 */
export function shotRecordPath(path) {
  if (typeof path !== "string" || !path.endsWith(".png")) {
    throw new Error(`element clip: path must end with .png (got ${String(path)})`);
  }
  return join(dirname(path), `${basename(path, ".png")}.shot.json`);
}

/** 2 つの矩形が同じ値か。 */
function sameRect(a, b) {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/**
 * 要素を丸めた整数 clip で撮る。呼び出し側が目的の状態へ遷移させ、矩形が落ち着くまで待ってから呼ぶこと。
 *
 * `locator.screenshot()` を置き換える経路なので、**採取側とカタログ側の両方で同じこの関数を使う**
 * （片側だけ差し替えると、外接の 1px がそのまま寸法差として残り、塞いだはずの穴が戻る）。
 *
 * @param {import('playwright').Page} page - clip 付き撮影に使う Page（locator が居るフレームを含む最上位のページ）
 * @param {import('playwright').Locator} locator - 撮る要素（一意に解決すること。同一オリジンの iframe の中でもよい）
 * @param {{ path?: string, scrollIntoView?: boolean, animations?: ("disabled"|"allow") }} [options]
 *   path（`.png` で終わる）を渡すとそこへ書き出し、隣に `<名前>.shot.json`（clip・PNG 実寸・矩形）を書く。
 *   scrollIntoView は既定 true（`locator.screenshot()` と同じく、撮る前に見える位置へ入れる）。
 *   animations は既定 `"disabled"`——Playwright の既定は `"allow"` で、アニメーション・トランジションの
 *   途中フレームがそのまま PNG になり run ごとに揺れる。採取条件は `animations: disabled` として
 *   記録される運用なので、記録と実体が食い違わないよう既定で止める
 *   （出典: <https://playwright.dev/docs/api/class-page#page-screenshot>）。
 *   clip は撮影前の矩形から決まる一方で `animations` は撮影時に効くため、**撮影後にもう一度矩形を測り、
 *   変わっていたら失敗させる**（早送りで動いた要素を古い矩形で切った PNG を基準にしない）
 * @returns {Promise<{ buffer: Buffer, clip: { x:number, y:number, width:number, height:number },
 *                     png: { width:number, height:number },
 *                     rect: { x:number, y:number, width:number, height:number },
 *                     page_rect: { x:number, y:number, width:number, height:number },
 *                     frame_depth: number, animations: string, tool_version: string }>}
 *   `rect` は要素が居るフレームの座標（trait-capture.mjs の `rect` と同じ座標系）、`page_rect` は最上位の座標。
 * @throws {Error} フレームの座標を最上位へ直せない（読めない・変形された・フレームが切る）場合
 */
export async function captureElementShot(page, locator, options = {}) {
  const { path, scrollIntoView = true, animations = "disabled" } = options;
  if (animations !== "disabled" && animations !== "allow") {
    throw new Error(
      `element clip: animations must be "disabled" or "allow" (got ${String(animations)})`,
    );
  }
  const recordPath = path === undefined ? undefined : shotRecordPath(path);
  if (scrollIntoView) await locator.scrollIntoViewIfNeeded();
  const measured = await locator.evaluate(readRectAndViewport);
  // フレームの中の要素は、最上位の座標へ直せたときだけ撮る。直せないまま撮ると、
  // `page.screenshot({ clip })` が最上位の座標として解釈して別の場所を切り出した PNG が「撮れた」として残る。
  if (measured.frame_error === "unreadable") {
    throw new Error(
      "element clip: the element lives inside a frame whose offset cannot be read (cross-origin: " +
        "frameElement is null), so its box cannot be mapped to the top-level viewport that " +
        "page.screenshot({ clip }) uses. open the frame's own URL as a page and capture the element there",
    );
  }
  if (measured.frame_error === "transformed") {
    throw new Error(
      "element clip: the element lives inside a frame scaled by a CSS transform; adding offsets cannot " +
        "map its box to the top-level viewport. remove the transform for the capture or open the frame's " +
        "own URL as a page",
    );
  }
  // 途中のフレームの見える範囲からはみ出す要素は、そのフレームに切られて部品の一部だけが写る。
  // 最上位の判定（planElementClip）と同じ丸めで各段を判定する。
  measured.frames.forEach((frame, depth) => {
    try {
      planElementClip(frame.rect, frame.viewport);
    } catch (error) {
      throw new Error(
        `element clip: inside frame level ${depth + 1} (innermost = 1), ${error.message.replace(/^element clip: /, "")}`,
      );
    }
  });
  // 生きているアニメーションがあるなら、撮影中に幾何が変わっても前後の測定は同じ値になりうる
  // （撮影後の測り直しでは捕まえられない）。撮る前に落とす。
  if (
    animations === "disabled" &&
    typeof measured.live_animations === "number" &&
    measured.live_animations > 0
  ) {
    throw new Error(
      `element clip: ${measured.live_animations} live animation(s) on the element or its subtree. ` +
        `animations: "disabled" fast-forwards or resets them inside page.screenshot() and restores them ` +
        `afterwards, so the clip measured before the capture can describe a different geometry than the PNG ` +
        `(the post-capture rect check cannot see this). quiesce animations and transitions at the page level ` +
        `before capturing, or pass animations: "allow" and record that the capture condition differs`,
    );
  }
  const clip = planElementClip(measured.page_rect, measured.viewport);
  // `path` は Playwright へ渡さずバッファで受け取る。撮影後の検査で落ちる run が、
  // 拒否したはずのフレームを基準ファイルとして書き残す（または上書きする）のを避けるため——
  // 後段の「ファイルがあるか」で確かめる手順が、無効な成果物を読んでしまう。
  const buffer = await page.screenshot({ clip, animations });

  // clip は撮影**前**に測った矩形から決まるが、`animations: "disabled"` は撮影のときに効く
  // （有限のアニメーションは完了まで早送りされ、無限のものは初期状態へ戻る）。その早送りで
  // 要素の位置・寸法が変われば、古い矩形で切った PNG が別の領域を写したまま残る。
  // 撮った後にもう一度測って、変わっていたら失敗させる——撮影条件を記録しながら
  // 中身が条件と食い違う成果物を基準にしない。フレームの中なら、フレームが動いても同じなので最上位の座標でも比べる。
  const after = await locator.evaluate(readRectAndViewport);
  if (!sameRect(after.rect, measured.rect) || !sameRect(after.page_rect, measured.page_rect)) {
    throw new Error(
      `element clip: the element's box changed while capturing ` +
        `(${measured.page_rect.width}x${measured.page_rect.height} at ${measured.page_rect.x},${measured.page_rect.y} -> ` +
        `${after.page_rect.width}x${after.page_rect.height} at ${after.page_rect.x},${after.page_rect.y}). ` +
        `the clip was computed before the screenshot applied animations: "${animations}", so the PNG may ` +
        `show a different region. quiesce animations and transitions at the page level (or wait until the ` +
        `rect is stable across two reads) before capturing`,
    );
  }
  const png = readPngSize(buffer);

  const result = {
    clip,
    png,
    rect: measured.rect,
    page_rect: measured.page_rect,
    frame_depth: measured.frames.length,
    animations,
    tool_version: VERSION,
  };
  // 検査を通ってから書く。PNG と記録は同じ run の値で対にする（片方だけ古い組を残さない）。
  if (path !== undefined) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, buffer);
    writeFileSync(recordPath, `${JSON.stringify(result, null, 2)}\n`);
  }
  return { buffer, ...result };
}
