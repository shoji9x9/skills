// 要素スクリーンショットの clip を整数へ丸める回帰テスト（Issue #434）。
//
// Playwright の locator.screenshot() は要素の矩形を**外接**整数矩形へ広げてから撮るため
// （v1.56.1 helper.enclosingIntRect: floor(x+1e-3) / ceil(x+w-1e-3)）、絶対座標が小数だと
// PNG が軸ごと最大 1px 大きくなる。現行が小数座標・新側が整数座標だと、同じ CSS box でも
// PNG の寸法が食い違い、寸法一致を要求する画素比較が実行不能になる。

import { expect, test } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repoRoot, "skills/parity-suite/scripts/element-shot.mjs");
const { VERSION, planElementClip, captureElementShot, readPngSize, shotRecordPath } = await import(
  script
);

/** IHDR まで持つ最小の PNG ヘッダ（fake の page.screenshot が返す。実寸の記録を測るため）。 */
function pngHeader(width, height) {
  const buf = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write("IHDR", 12, "latin1");
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

const VIEWPORT = { width: 1920, height: 1080 };

/** Playwright v1.56.1 の helper.enclosingIntRect（比較対象。ここが直そうとしている丸め）。 */
function enclosingIntRect(rect) {
  const x = Math.floor(rect.x + 1e-3);
  const y = Math.floor(rect.y + 1e-3);
  const x2 = Math.ceil(rect.x + rect.width - 1e-3);
  const y2 = Math.ceil(rect.y + rect.height - 1e-3);
  return { x, y, width: x2 - x, height: y2 - y };
}

test("VERSION を持つ", () => {
  expect(VERSION).toBe("6");
});

// 実測された 4 例（Issue #434 の再現手順 2）。いずれも width / height は整数だが原点が小数。
const FRACTIONAL = [
  { label: "button/main-list-search", rect: { x: 1328.8125, y: 100, width: 25, height: 28 } },
  {
    label: "locale-switcher/role-management-screen",
    rect: { x: 1538.4375, y: 8, width: 120, height: 32 },
  },
  { label: "menu-back-link/test-data-download", rect: { x: 12, y: 40, width: 71.125, height: 20 } },
  { label: "data-grid/main-list", rect: { x: 16, y: 219.296875, width: 800, height: 400 } },
];

test.each(FRACTIONAL.map((c) => [c.label, c.rect]))(
  "%s: 丸めた clip は矩形の寸法と一致し、外接矩形とは違う",
  (_label, rect) => {
    const clip = planElementClip(rect, VIEWPORT);
    expect(clip.width).toBe(Math.round(rect.width));
    expect(clip.height).toBe(Math.round(rect.height));

    // 陽性コントロール: 現行の locator.screenshot() 相当（外接）ならどれかの軸が 1px 膨らむ。
    // 膨らまない入力で測っていると、この検査は何も実証しない。
    const enclosing = enclosingIntRect(rect);
    expect(enclosing.width !== clip.width || enclosing.height !== clip.height).toBe(true);
  },
);

test("整数座標の側は外接でも丸めでも同じ（現・新で同じ寸法になることの対照）", () => {
  const current = planElementClip({ x: 1328.8125, y: 100, width: 25, height: 28 }, VIEWPORT);
  const fresh = planElementClip({ x: 100, y: 200, width: 25, height: 28 }, VIEWPORT);
  expect([current.width, current.height]).toEqual([fresh.width, fresh.height]);

  // 陽性コントロール: 外接だと両側の寸法が食い違い、画素比較が実行不能になっていた。
  const currentEnclosing = enclosingIntRect({ x: 1328.8125, y: 100, width: 25, height: 28 });
  const freshEnclosing = enclosingIntRect({ x: 100, y: 200, width: 25, height: 28 });
  expect(currentEnclosing.width).not.toBe(freshEnclosing.width);
});

test("本物の寸法差は丸めても残る（1px の丸めで差を飲まない）", () => {
  const a = planElementClip({ x: 0, y: 0, width: 25, height: 28 }, VIEWPORT);
  const b = planElementClip({ x: 0, y: 0, width: 27, height: 28 }, VIEWPORT);
  expect(a.width).not.toBe(b.width);
});

test("-0 を 0 に畳む", () => {
  const clip = planElementClip({ x: -0.2, y: -0.1, width: 10, height: 10 }, VIEWPORT);
  expect(Object.is(clip.x, 0)).toBe(true);
  expect(Object.is(clip.y, 0)).toBe(true);
});

test("面積 0 の矩形は撮らずに失敗する", () => {
  expect(() => planElementClip({ x: 5, y: 5, width: 0.4, height: 10 }, VIEWPORT)).toThrow(
    /rounded size is empty/,
  );
});

test("ビューポートからはみ出す clip は失敗する（黙って切り詰めさせない）", () => {
  expect(() => planElementClip({ x: 1900, y: 10, width: 100, height: 10 }, VIEWPORT)).toThrow(
    /not fully inside the viewport/,
  );
  expect(() => planElementClip({ x: -5, y: 10, width: 10, height: 10 }, VIEWPORT)).toThrow(
    /not fully inside the viewport/,
  );
  expect(() => planElementClip({ x: 10, y: 1075, width: 10, height: 10 }, VIEWPORT)).toThrow(
    /not fully inside the viewport/,
  );
});

test.each([
  ["rect.x", { x: Number.NaN, y: 0, width: 10, height: 10 }, VIEWPORT],
  ["rect.width", { x: 0, y: 0, width: "10", height: 10 }, VIEWPORT],
  ["viewport.height", { x: 0, y: 0, width: 10, height: 10 }, { width: 100, height: undefined }],
])("%s が数でなければ失敗する", (label, rect, viewport) => {
  expect(() => planElementClip(rect, viewport)).toThrow(new RegExp(label.replace(".", "\\.")));
});

test("ビューポートが 0 以下なら失敗する", () => {
  expect(() =>
    planElementClip({ x: 0, y: 0, width: 1, height: 1 }, { width: 0, height: 10 }),
  ).toThrow(/viewport must be positive/);
});

/**
 * `readRectAndViewport` が読む形の偽のビュー。`frames` を渡すと、その数だけ入れ子の iframe の中に居る相当になる
 * （内側から外側へ。各段は `{ frameEl, visible, style }`。`frameEl: null` はクロスオリジンで読めないフレーム）。
 */
function fakeView({ frames = [] } = {}) {
  const top = { innerWidth: VIEWPORT.width, innerHeight: VIEWPORT.height, document: fakeTree() };
  top.top = top;
  let outer = top;
  // 外側から組み立てる。
  for (const frame of [...frames].reverse()) {
    const view = {
      innerWidth: frame.visible.width + 15,
      innerHeight: frame.visible.height + 15,
      frameElement: frame.frameEl,
      parent: outer,
      top,
      document: {
        scrollingElement: { clientWidth: frame.visible.width, clientHeight: frame.visible.height },
        ...fakeTree(),
      },
    };
    // フレーム要素が置かれた文書（外側のビューの文書）のアニメーション。
    if (frame.parentAnimations)
      outer.document = { ...outer.document, ...fakeTree(frame.parentAnimations) };
    // 枠線は計算後スタイルから読まれる（clientLeft は整数へ丸められるため）。既定はフレーム要素の枠線の値。
    const border = frame.frameEl ? frame.frameEl.clientLeft : 0;
    // フレーム要素にはフレームの style、祖先には各要素の `computed` を返す（変形の検査は祖先まで辿る）。
    outer.getComputedStyle = (node) => ({
      paddingLeft: "0px",
      paddingTop: "0px",
      borderLeftWidth: `${border}px`,
      borderTopWidth: `${border}px`,
      transform: "none",
      rotate: "none",
      scale: "none",
      ...(node === frame.frameEl ? frame.style : node.computed),
    });
    outer.DOMMatrixReadOnly = FakeMatrix;
    outer = view;
  }
  return outer;
}

/** `playState` の列から Animation の代わりを作る。 */
const anims = (...states) => states.map((playState) => ({ playState }));

/** getAnimations / querySelectorAll を持つ偽の文書（シャドウルートも同じ形）。`hosts` は shadowRoot を持つ要素。 */
function fakeTree(animations = [], hosts = []) {
  return { getAnimations: () => animations, querySelectorAll: () => hosts };
}

function fakeElement({ rect, frames, animations = [], shadowHosts = [] } = {}) {
  return {
    ownerDocument: { defaultView: fakeView({ frames }), ...fakeTree(animations, shadowHosts) },
    getBoundingClientRect: () => rect ?? { x: 1328.8125, y: 219.296875, width: 25, height: 28 },
  };
}

/** 偽のフレーム要素（矩形 = 変形後、offset* = レイアウト寸法）。 */
/** `matrix(a, b, c, d, e, f)` だけを読む DOMMatrixReadOnly の代わり（Node には DOMMatrix が無い）。 */
class FakeMatrix {
  constructor(text) {
    const [a, b, c, d, e, f] = text
      .match(/^matrix\((.*)\)$/)[1]
      .split(",")
      .map(Number);
    Object.assign(this, { m11: a, m12: b, m13: 0, m14: 0, m21: c, m22: d, m23: 0, m24: 0 });
    Object.assign(this, { m31: 0, m32: 0, m33: 1, m34: 0, m41: e, m42: f, m43: 0, m44: 1 });
  }
}

/** 偽の祖先要素（親文書の中でフレーム要素を包む要素）。 */
function fakeAncestor(computed = {}, parentElement = null) {
  return { nodeType: 1, computed, parentElement, parentNode: parentElement };
}

function fakeFrameEl({
  x,
  y,
  width = 600,
  height = 800,
  border = 0,
  scale = 1,
  parentElement = null,
  parentNode = parentElement,
}) {
  return {
    getBoundingClientRect: () => ({ x, y, width: width * scale, height: height * scale }),
    offsetWidth: width,
    offsetHeight: height,
    clientLeft: border,
    clientTop: border,
    nodeType: 1,
    parentElement,
    parentNode,
  };
}

test("captureElementShot は丸めた clip で page.screenshot を呼び、path を渡す", async () => {
  const calls = [];
  const locator = {
    scrollIntoViewIfNeeded: async () => calls.push(["scroll"]),
    evaluate: async (fn) => fn(fakeElement()),
  };
  const page = {
    screenshot: async (options) => {
      calls.push(["screenshot", options]);
      return pngHeader(options.clip.width, options.clip.height);
    },
  };

  const dir = mkdtempSync(join(tmpdir(), "element-shot-"));
  const target = join(dir, "nested", "element.png");
  const out = await captureElementShot(page, locator, { path: target });
  expect(calls[0]).toEqual(["scroll"]);
  // path は Playwright へ渡さない（検査を通ってから自分で書く）。
  expect(calls[1][1]).toEqual({
    clip: { x: 1329, y: 219, width: 25, height: 28 },
    animations: "disabled",
  });
  expect(readFileSync(target)).toEqual(pngHeader(25, 28));
  expect(out.clip).toEqual({ x: 1329, y: 219, width: 25, height: 28 });
  expect(out.png).toEqual({ width: 25, height: 28 });
  expect(out.rect).toEqual({ x: 1328.8125, y: 219.296875, width: 25, height: 28 });
  expect(out.frame_depth).toBe(0);
  expect(out.tool_version).toBe(VERSION);
  // 隣に clip と PNG 実寸の記録を書く（rect とは別のフィールド。Issue #436）。
  const record = JSON.parse(readFileSync(join(dir, "nested", "element.shot.json"), "utf8"));
  expect(record).toEqual({
    clip: { x: 1329, y: 219, width: 25, height: 28 },
    png: { width: 25, height: 28 },
    rect: { x: 1328.8125, y: 219.296875, width: 25, height: 28 },
    page_rect: { x: 1328.8125, y: 219.296875, width: 25, height: 28 },
    frame_depth: 0,
    animations: "disabled",
    tool_version: VERSION,
  });
});

// --- iframe の中の要素（Issue #436） ---------------------------------------
//
// `getBoundingClientRect()` はその要素が居るフレームの座標、`page.screenshot({ clip })` は最上位の座標。
// フレームを遡ってオフセット（フレーム要素の矩形 + 枠線 + padding）を足して最上位へ直す。
// ダイアログ内 iframe の部品は、ローカル座標が整数でも親のオフセットが小数なら `locator.screenshot()` の
// 外接で PNG が 1px 膨らんでいた（実測: rect=(566, 407.765625, 80, 28) → 81x29）。

/** fake の element を evaluate する locator。`sequence` を渡すと呼ぶたびに次の element を使う。 */
function frameLocator(...sequence) {
  let call = 0;
  return {
    scrollIntoViewIfNeeded: async () => {},
    evaluate: async (fn) => fn(sequence[Math.min(call++, sequence.length - 1)]),
  };
}

function recordingPage() {
  const calls = [];
  return {
    calls,
    screenshot: async (options) => {
      calls.push(options);
      return pngHeader(options.clip.width, options.clip.height);
    },
  };
}

const LOCAL = { x: 66, y: 306.765625, width: 80, height: 28 };
// 内側から外側へ: 内側のフレームは外側のフレームの中の (7.4, 13.3) に枠線 2・padding 3.25 で、
// 外側のフレームは最上位の (100.5, 50.25) に枠線 3・padding 5.5 で置かれている。
const NESTED = [
  {
    frameEl: fakeFrameEl({ x: 7.4, y: 13.3, border: 2 }),
    visible: { width: 600, height: 800 },
    style: { paddingLeft: "3.25px", paddingTop: "3.25px" },
  },
  {
    frameEl: fakeFrameEl({ x: 100.5, y: 50.25, border: 3, width: 900, height: 1000 }),
    visible: { width: 900, height: 1000 },
    style: { paddingLeft: "5.5px", paddingTop: "5.5px" },
  },
];

test("入れ子の iframe の中の要素は、各段のオフセットを足した最上位の座標で撮る", async () => {
  const page = recordingPage();
  const out = await captureElementShot(
    page,
    frameLocator(fakeElement({ rect: LOCAL, frames: NESTED })),
  );
  // x = 66 + (7.4 + 2 + 3.25) + (100.5 + 3 + 5.5) = 187.65 / y = 306.765625 + 18.55 + 58.75 = 384.065625
  const pageRect = out.page_rect;
  expect(pageRect.x).toBeCloseTo(187.65, 9);
  expect(pageRect.y).toBeCloseTo(384.065625, 9);
  expect(page.calls[0].clip).toEqual({ x: 188, y: 384, width: 80, height: 28 });
  expect(out.png).toEqual({ width: 80, height: 28 });
  expect(out.rect).toEqual(LOCAL); // フレーム内の座標（trait-capture.mjs の rect と同じ座標系）は別に残す
  expect(out.frame_depth).toBe(2);

  // 陽性コントロール: オフセットを足さずフレーム内の座標で切ると別の場所になる（旧実装が拒否していた理由）。
  expect(planElementClip(LOCAL, VIEWPORT)).not.toEqual(page.calls[0].clip);
  // 陽性コントロール: 外接（locator.screenshot() 相当）だと最上位の小数座標で 1px 膨らむ。
  const enclosing = enclosingIntRect(pageRect);
  expect([enclosing.width, enclosing.height]).toEqual([81, 29]);
});

test("枠線は丸めた clientLeft ではなく計算後スタイルの小数で足す（deviceScaleFactor でスナップされる）", async () => {
  // 実測（chromium, deviceScaleFactor 1.5）: 1px の枠線は borderLeftWidth=0.666667px・clientLeft=1。
  const frameEl = { ...fakeFrameEl({ x: 8.6, y: 8.6 }), clientLeft: 1, clientTop: 1 };
  const frames = [
    {
      frameEl,
      visible: { width: 600, height: 800 },
      style: { borderLeftWidth: "0.666667px", borderTopWidth: "0.666667px" },
    },
  ];
  const page = recordingPage();
  const rect = { x: 10, y: 10, width: 5, height: 5 };
  await captureElementShot(page, frameLocator(fakeElement({ rect, frames })));
  // 8.6 + 0.666667 + 10 = 19.27 → 19（clientLeft を足すと 19.6 → 20 で 1px ずれる）
  expect(page.calls[0].clip).toEqual({ x: 19, y: 19, width: 5, height: 5 });
});

test("読めないフレーム（クロスオリジン）の中の要素は撮らずに失敗する", async () => {
  const page = recordingPage();
  const frames = [{ frameEl: null, visible: { width: 600, height: 800 } }];
  await expect(
    captureElementShot(page, frameLocator(fakeElement({ rect: LOCAL, frames }))),
  ).rejects.toThrow(/offset cannot be read/);
  expect(page.calls).toEqual([]);
});

test("外側のフレームが読めなくても撮らない（内側だけ読めても最上位へ直せない）", async () => {
  const page = recordingPage();
  const frames = [NESTED[0], { ...NESTED[1], frameEl: null }];
  await expect(
    captureElementShot(page, frameLocator(fakeElement({ rect: LOCAL, frames }))),
  ).rejects.toThrow(/offset cannot be read/);
  expect(page.calls).toEqual([]);
});

test("transform で拡縮されたフレームの中の要素は撮らずに失敗する", async () => {
  const page = recordingPage();
  const frames = [{ ...NESTED[0], frameEl: fakeFrameEl({ x: 10, y: 10, scale: 0.5 }) }];
  await expect(
    captureElementShot(page, frameLocator(fakeElement({ rect: LOCAL, frames }))),
  ).rejects.toThrow(/transformed by CSS/);
  expect(page.calls).toEqual([]);
});

test("寸法が小数のフレームは変形とみなさない（offsetWidth は整数へ丸められる）", async () => {
  // 実測: 幅 600 + 枠線 2x2 + padding 3.25x2 = 610.5px のフレームで offsetWidth は 611。
  const frameEl = {
    ...fakeFrameEl({ x: 7.4, y: 13.3, border: 2 }),
    offsetWidth: 611,
    offsetHeight: 811,
  };
  frameEl.getBoundingClientRect = () => ({ x: 7.4, y: 13.3, width: 610.5, height: 810.5 });
  const page = recordingPage();
  const frames = [{ ...NESTED[0], frameEl }];
  const out = await captureElementShot(page, frameLocator(fakeElement({ rect: LOCAL, frames })));
  expect(out.frame_depth).toBe(1);
  expect(page.calls).toHaveLength(1);
});

test.each([
  ["内側のフレームの右端を越える", { x: 540, y: 10, width: 80, height: 28 }, 1],
  ["内側のフレームの下端を越える", { x: 10, y: 790, width: 80, height: 28 }, 1],
  [
    "内側のフレームの上へ出る（フレーム内でスクロールされた）",
    { x: 10, y: -5, width: 80, height: 28 },
    1,
  ],
])("フレームの見える範囲からはみ出す要素は撮らない: %s", async (_label, rect, level) => {
  const page = recordingPage();
  await expect(
    captureElementShot(page, frameLocator(fakeElement({ rect, frames: NESTED }))),
  ).rejects.toThrow(new RegExp(`inside frame level ${level} `));
  expect(page.calls).toEqual([]);
});

test("外側のフレームの見える範囲からはみ出す要素も撮らない（内側に収まっていても）", async () => {
  const page = recordingPage();
  // 内側のフレームは外側の中で (500, 900) にあり、外側の見える範囲 900x1000 の下端近く。
  const frames = [
    { ...NESTED[0], frameEl: fakeFrameEl({ x: 500, y: 900, border: 0 }), style: undefined },
    NESTED[1],
  ];
  await expect(
    captureElementShot(
      page,
      frameLocator(fakeElement({ rect: { x: 10, y: 90, width: 80, height: 28 }, frames })),
    ),
  ).rejects.toThrow(/inside frame level 2 /);
  expect(page.calls).toEqual([]);
});

test("見える範囲はスクロールバーを除いた寸法で測る（innerWidth ではなく）", async () => {
  // fakeView の innerWidth は見える範囲 + 15（スクロールバー相当）。見える範囲 600 を 5px 越える要素は落とす。
  const page = recordingPage();
  await expect(
    captureElementShot(
      page,
      frameLocator(
        fakeElement({ rect: { x: 525, y: 10, width: 80, height: 28 }, frames: [NESTED[0]] }),
      ),
    ),
  ).rejects.toThrow(/inside frame level 1 /);
  expect(page.calls).toEqual([]);
});

test("撮影中にフレームが動いたら失敗する（フレーム内の矩形が同じでも）", async () => {
  const page = recordingPage();
  const moved = [
    NESTED[0],
    {
      ...NESTED[1],
      frameEl: fakeFrameEl({ x: 100.5, y: 74.25, border: 3, width: 900, height: 1000 }),
    },
  ];
  await expect(
    captureElementShot(
      page,
      frameLocator(
        fakeElement({ rect: LOCAL, frames: NESTED }),
        fakeElement({ rect: LOCAL, frames: moved }),
      ),
    ),
  ).rejects.toThrow(/box changed while capturing/);
});

test("path が .png で終わらなければ撮る前に失敗する（記録ファイルの名前が決まらない）", async () => {
  const page = recordingPage();
  const dir = mkdtempSync(join(tmpdir(), "element-shot-ext-"));
  await expect(
    captureElementShot(page, frameLocator(fakeElement()), { path: join(dir, "element.jpeg") }),
  ).rejects.toThrow(/must end with \.png/);
  expect(page.calls).toEqual([]);
  expect(shotRecordPath("/a/b/element.png")).toBe("/a/b/element.shot.json");
});

test("PNG でないものが返ったら実寸を記録せず失敗し、何も書かない", async () => {
  const page = { screenshot: async () => Buffer.from("not a png") };
  const dir = mkdtempSync(join(tmpdir(), "element-shot-notpng-"));
  const target = join(dir, "element.png");
  await expect(
    captureElementShot(page, frameLocator(fakeElement()), { path: target }),
  ).rejects.toThrow(/did not return a PNG/);
  expect(existsSync(target)).toBe(false);
  expect(existsSync(join(dir, "element.shot.json"))).toBe(false);
  // 陽性コントロール: PNG ヘッダなら読める。
  expect(readPngSize(pngHeader(81, 29))).toEqual({ width: 81, height: 29 });
});

test.each([
  ["短すぎる", Buffer.from("not a png")],
  [
    "長さは足りるが署名が違う（JPEG 等）",
    Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), pngHeader(1, 1).subarray(3)]),
  ],
  [
    "署名は PNG だが先頭チャンクが IHDR でない",
    Buffer.concat([
      pngHeader(1, 1).subarray(0, 12),
      Buffer.from("IDAT"),
      pngHeader(1, 1).subarray(16),
    ]),
  ],
])("PNG の実寸を読めない形は失敗させる: %s", (_label, buffer) => {
  expect(() => readPngSize(buffer)).toThrow(/did not return a PNG/);
});

// 外形の寸法を保つ変形（rotate(180deg) / scaleX(-1)）は、矩形と offset* の比較では見えない。
// 計算後スタイルの行列と個別プロパティで、平行移動以外の変形を拒否する。
test.each([
  ["フレーム要素の rotate(180deg)（行列）", { style: { transform: "matrix(-1, 0, 0, -1, 0, 0)" } }],
  ["フレーム要素の scaleX(-1)（行列）", { style: { transform: "matrix(-1, 0, 0, 1, 0, 0)" } }],
  ["フレーム要素の個別プロパティ rotate", { style: { rotate: "180deg" } }],
  ["フレーム要素の個別プロパティ scale", { style: { scale: "-1 1" } }],
  [
    "祖先の rotate(180deg)",
    { parentElement: fakeAncestor({ transform: "matrix(-1, 0, 0, -1, 0, 0)" }) },
  ],
  [
    "シャドウホストの向こうの祖先の変形",
    {
      parentElement: null,
      parentNode: { host: fakeAncestor({ transform: "matrix(-1, 0, 0, 1, 0, 0)" }) },
    },
  ],
])("外形を保つ変形も撮らずに失敗する: %s", async (_label, { style, ...where }) => {
  const page = recordingPage();
  const frames = [{ ...NESTED[0], frameEl: fakeFrameEl({ x: 10, y: 10, ...where }), style }];
  await expect(
    captureElementShot(page, frameLocator(fakeElement({ rect: LOCAL, frames }))),
  ).rejects.toThrow(/transformed by CSS/);
  expect(page.calls).toEqual([]);
});

// 要素を動かすのは部分木だけではない（祖先の移動・フレーム要素・前に並ぶ兄弟の幅の変化もレイアウトを通じて動かす）。
// それらも撮影の中で早送り／初期化されて撮り終えると戻るので、前後の矩形が一致したまま PNG だけ別の位置で切られる。
// 要素が居る文書と、iframe を遡った先の各文書の全体で数える。
test.each([
  ["要素が居る文書（兄弟・祖先を含む）", () => fakeElement({ animations: anims("running") })],
  [
    "親文書（フレーム要素・その祖先・兄弟を含む）",
    () =>
      fakeElement({
        rect: LOCAL,
        frames: [{ ...NESTED[0], parentAnimations: anims("paused") }],
      }),
  ],
  [
    "2 段外側の文書",
    () =>
      fakeElement({
        rect: LOCAL,
        frames: [NESTED[0], { ...NESTED[1], parentAnimations: anims("running") }],
      }),
  ],
  [
    "開いたシャドウルートの中（document.getAnimations は含まない）",
    () =>
      fakeElement({
        shadowHosts: [{ shadowRoot: fakeTree([], [{ shadowRoot: fakeTree(anims("running")) }]) }],
      }),
  ],
])("文書内のアニメーションが生きていれば撮らずに失敗する: %s", async (_label, make) => {
  const page = recordingPage();
  await expect(captureElementShot(page, frameLocator(make()))).rejects.toThrow(/live animation/);
  expect(page.calls).toEqual([]);
});

test("文書内のアニメーションが終わっていれば撮る（finished / idle は数えない）", async () => {
  const page = recordingPage();
  const el = fakeElement({
    rect: LOCAL,
    animations: anims("finished", "idle"),
    shadowHosts: [{ shadowRoot: fakeTree(anims("finished")) }],
    frames: [{ ...NESTED[0], parentAnimations: anims("finished") }],
  });
  await captureElementShot(page, frameLocator(el));
  expect(page.calls).toHaveLength(1);
});

test("平行移動だけの変形は撮る（getBoundingClientRect が移動後の位置を返すので足し算で合う）", async () => {
  const page = recordingPage();
  const frames = [
    {
      ...NESTED[0],
      frameEl: fakeFrameEl({
        x: 10,
        y: 10,
        parentElement: fakeAncestor({ transform: "matrix(1, 0, 0, 1, 30, 40)" }),
      }),
      style: { transform: "matrix(1, 0, 0, 1, 5, 5)" },
    },
  ];
  const out = await captureElementShot(page, frameLocator(fakeElement({ rect: LOCAL, frames })));
  expect(out.frame_depth).toBe(1);
  expect(page.calls).toHaveLength(1);
});

// PNG と記録は「両方置き換わるか、どちらも変わらないか」。記録の書き込みが落ちたのに PNG だけ
// 差し替わると、新しい PNG が古い（または無い）記録と組になり、後の比較が別 run の clip を読む。
test("記録を書けなければ既存の PNG も記録も差し替えない（一時ファイルも残さない）", async () => {
  const dir = mkdtempSync(join(tmpdir(), "element-shot-pair-"));
  const target = join(dir, "element.png");
  writeFileSync(target, "previous-png");
  mkdirSync(join(dir, "element.shot.json")); // 記録の置き場所がディレクトリで rename が落ちる
  await expect(
    captureElementShot(recordingPage(), frameLocator(fakeElement()), { path: target }),
  ).rejects.toThrow();
  expect(readFileSync(target).toString()).toBe("previous-png");
  expect(readdirSync(dir).sort()).toEqual(["element.png", "element.shot.json"]);
  expect(statSync(join(dir, "element.shot.json")).isDirectory()).toBe(true); // 退避して消していない
});

test("一時ファイルを書けなければ、書けた分の一時ファイルも消して既存の組を残す", async () => {
  const dir = mkdtempSync(join(tmpdir(), "element-shot-stage-"));
  const target = join(dir, "element.png");
  writeFileSync(target, "previous-png");
  writeFileSync(join(dir, "element.shot.json"), "previous-record");
  mkdirSync(join(dir, `element.shot.json.tmp-${process.pid}`)); // 記録の一時ファイルを書けない
  await expect(
    captureElementShot(recordingPage(), frameLocator(fakeElement()), { path: target }),
  ).rejects.toThrow();
  expect(readFileSync(target).toString()).toBe("previous-png");
  expect(readFileSync(join(dir, "element.shot.json"), "utf8")).toBe("previous-record");
  expect(existsSync(`${target}.tmp-${process.pid}`)).toBe(false);
});

test("既存の組は新しい組へまとめて置き換わる（バックアップも残さない）", async () => {
  const dir = mkdtempSync(join(tmpdir(), "element-shot-replace-"));
  const target = join(dir, "element.png");
  writeFileSync(target, "previous-png");
  writeFileSync(join(dir, "element.shot.json"), "{}");
  await captureElementShot(recordingPage(), frameLocator(fakeElement()), { path: target });
  expect(readFileSync(target)).toEqual(pngHeader(25, 28));
  expect(JSON.parse(readFileSync(join(dir, "element.shot.json"), "utf8")).png).toEqual({
    width: 25,
    height: 28,
  });
  expect(readdirSync(dir).sort()).toEqual(["element.png", "element.shot.json"]);
});

test("PNG の実寸は clip ではなく PNG から読む（deviceScaleFactor で倍になる）", async () => {
  const page = {
    screenshot: async (options) => pngHeader(options.clip.width * 2, options.clip.height * 2),
  };
  const out = await captureElementShot(page, frameLocator(fakeElement()));
  expect(out.clip).toEqual({ x: 1329, y: 219, width: 25, height: 28 });
  expect(out.png).toEqual({ width: 50, height: 56 });
});

test("scrollIntoView: false なら見える位置へ入れない", async () => {
  const calls = [];
  const locator = {
    scrollIntoViewIfNeeded: async () => calls.push("scroll"),
    evaluate: async (fn) => fn(fakeElement({ rect: { x: 0, y: 0, width: 10, height: 10 } })),
  };
  const page = {
    screenshot: async (options) => pngHeader(options.clip.width, options.clip.height),
  };
  await captureElementShot(page, locator, { scrollIntoView: false });
  expect(calls).toEqual([]);
});

// --- アニメーションの既定 ---------------------------------------------------
//
// Playwright の screenshot は `animations` の既定が `"allow"`（実測: types.d.ts
// 「Defaults to "allow" that leaves animations untouched.」）。トランジション中の要素を撮ると
// 途中フレームが PNG になり run ごとに揺れるのに、撮影条件は `animations: disabled` として
// 記録される。記録と実体を食い違わせない。

/** 最上位フレームの要素について readRectAndViewport が返す形。 */
function measuredTop(rect, liveAnimations) {
  return {
    rect,
    page_rect: rect,
    viewport: VIEWPORT,
    frames: [],
    frame_error: null,
    live_animations: liveAnimations,
  };
}

function shotSpy(rect = { x: 0, y: 0, width: 10, height: 10 }) {
  const calls = [];
  const locator = {
    scrollIntoViewIfNeeded: async () => {},
    evaluate: async () => measuredTop(rect, 0),
  };
  const page = {
    screenshot: async (options) => {
      calls.push(options);
      return pngHeader(options.clip.width, options.clip.height);
    },
  };
  return { calls, locator, page };
}

test("既定でアニメーションを止めて撮る", async () => {
  const { calls, locator, page } = shotSpy();
  const out = await captureElementShot(page, locator);
  expect(calls[0].animations).toBe("disabled");
  expect(out.animations).toBe("disabled");
  // path を渡さない呼び出しでも clip と animations は必ず載る。
  expect(Object.keys(calls[0]).sort()).toEqual(["animations", "clip"]);
});

test("animations: allow を明示すればそのまま渡す（止める一択にしない）", async () => {
  const { calls, locator, page } = shotSpy();
  const out = await captureElementShot(page, locator, { animations: "allow" });
  expect(calls[0].animations).toBe("allow");
  expect(out.animations).toBe("allow");
});

test("animations に未知の値を渡したら撮らずに失敗する", async () => {
  const { calls, locator, page } = shotSpy();
  await expect(captureElementShot(page, locator, { animations: "off" })).rejects.toThrow(
    /animations must be/,
  );
  expect(calls).toEqual([]);
});

// --- 撮影中に要素が動いていないかの検査 -------------------------------------
//
// clip は撮影前の矩形から決まるが、animations: "disabled" は撮影のときに効く
// （有限のアニメーションは完了まで早送りされる）。早送りで動いた要素を古い矩形で切ると、
// 別の領域を写した PNG がエラー無しで残る。

function movingSpy(before, after) {
  const rects = [before, after];
  let call = 0;
  const calls = [];
  const locator = {
    scrollIntoViewIfNeeded: async () => {},
    evaluate: async () => measuredTop(rects[Math.min(call++, rects.length - 1)], 0),
  };
  const page = {
    screenshot: async (options) => {
      calls.push(options);
      // Playwright は `path` を渡されるとその場で書き出す。fake も同じ振る舞いにしないと、
      // 「検査前に書いていないか」を測るテストが素通りする。
      const data = pngHeader(options.clip.width, options.clip.height);
      if (options.path !== undefined) {
        mkdirSync(dirname(options.path), { recursive: true });
        writeFileSync(options.path, data);
      }
      return data;
    },
  };
  return { calls, locator, page };
}

test("撮影中に矩形が変わったら失敗する", async () => {
  const { calls, locator, page } = movingSpy(
    { x: 10, y: 10, width: 40, height: 20 },
    { x: 10, y: 34, width: 40, height: 20 },
  );
  await expect(captureElementShot(page, locator)).rejects.toThrow(/box changed while capturing/);
  // 撮影自体は走っている（検知は事後）。撮れた PNG を基準にしないことが目的。
  expect(calls).toHaveLength(1);
});

test("矩形が変わらなければ従来どおり返す（何でも失敗させない）", async () => {
  const rect = { x: 10, y: 10, width: 40, height: 20 };
  const { locator, page } = movingSpy(rect, { ...rect });
  const out = await captureElementShot(page, locator);
  expect(out.clip).toEqual({ x: 10, y: 10, width: 40, height: 20 });
});

test("検査に落ちたら PNG を書かない（拒否したフレームを基準に残さない）", async () => {
  const { locator, page } = movingSpy(
    { x: 10, y: 10, width: 40, height: 20 },
    { x: 10, y: 34, width: 40, height: 20 },
  );
  const dir = mkdtempSync(join(tmpdir(), "element-shot-reject-"));
  const target = join(dir, "element.png");
  await expect(captureElementShot(page, locator, { path: target })).rejects.toThrow(
    /box changed while capturing/,
  );
  expect(existsSync(target)).toBe(false);
});

test("既存の基準ファイルを、落ちた run が上書きしない", async () => {
  const { locator, page } = movingSpy(
    { x: 10, y: 10, width: 40, height: 20 },
    { x: 10, y: 34, width: 40, height: 20 },
  );
  const dir = mkdtempSync(join(tmpdir(), "element-shot-keep-"));
  const target = join(dir, "element.png");
  writeFileSync(target, "previous");
  await expect(captureElementShot(page, locator, { path: target })).rejects.toThrow();
  expect(readFileSync(target).toString()).toBe("previous");
});

// --- 生きているアニメーションの検出 -----------------------------------------
//
// animations: "disabled" は撮影の中で有限のものを早送りし、無限のものを初期状態へ戻して撮り、
// 撮り終えたら元の時刻へ復帰させる。一時停止した無限アニメーションでは、撮影の前後で測った矩形が
// どちらも同じ（停止時の幾何）なのに PNG だけ初期状態の幾何になる。事後の測り直しでは捕まらない。

function animatedSpy(liveAnimations, rect = { x: 0, y: 0, width: 10, height: 10 }) {
  const calls = [];
  const locator = {
    scrollIntoViewIfNeeded: async () => {},
    evaluate: async () => measuredTop(rect, liveAnimations),
  };
  const page = {
    screenshot: async (options) => {
      calls.push(options);
      return pngHeader(options.clip.width, options.clip.height);
    },
  };
  return { calls, locator, page };
}

test("生きているアニメーションがあれば撮らずに失敗する", async () => {
  const { calls, locator, page } = animatedSpy(2);
  await expect(captureElementShot(page, locator)).rejects.toThrow(/live animation/);
  expect(calls).toEqual([]); // 撮る前に落とす（事後検査ではない）
});

test("アニメーションが無ければ従来どおり撮る", async () => {
  const { calls, locator, page } = animatedSpy(0);
  await captureElementShot(page, locator);
  expect(calls).toHaveLength(1);
});

test('animations: "allow" なら生きていても撮る（呼び出し側が選んだ条件）', async () => {
  const { calls, locator, page } = animatedSpy(3);
  const out = await captureElementShot(page, locator, { animations: "allow" });
  expect(calls).toHaveLength(1);
  expect(out.animations).toBe("allow");
});

test("数えられない環境（getAnimations 無し）では判定しない", async () => {
  const { calls, locator, page } = animatedSpy(null);
  await captureElementShot(page, locator);
  expect(calls).toHaveLength(1);
});
