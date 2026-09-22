// 要素スクリーンショットの clip を整数へ丸める回帰テスト（Issue #434）。
//
// Playwright の locator.screenshot() は要素の矩形を**外接**整数矩形へ広げてから撮るため
// （v1.56.1 helper.enclosingIntRect: floor(x+1e-3) / ceil(x+w-1e-3)）、絶対座標が小数だと
// PNG が軸ごと最大 1px 大きくなる。現行が小数座標・新側が整数座標だと、同じ CSS box でも
// PNG の寸法が食い違い、寸法一致を要求する画素比較が実行不能になる。

import { expect, test } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repoRoot, "skills/parity-suite/scripts/element-shot.mjs");
const { VERSION, planElementClip, captureElementShot } = await import(script);

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
  expect(VERSION).toBe("4");
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
 * `readRectAndViewport` が読む形の偽要素。`view.top` を自分自身にすると最上位フレーム相当、
 * 別オブジェクトにすると iframe の中に居る相当になる（座標系が食い違う側）。
 */
function fakeElement({ inFrame = false, rect } = {}) {
  const view = { innerWidth: VIEWPORT.width, innerHeight: VIEWPORT.height };
  view.top = inFrame ? { innerWidth: 3840, innerHeight: 2160 } : view;
  return {
    ownerDocument: { defaultView: view },
    getBoundingClientRect: () => rect ?? { x: 1328.8125, y: 219.296875, width: 25, height: 28 },
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
      return Buffer.from("png");
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
  expect(readFileSync(target).toString()).toBe("png");
  expect(out.clip).toEqual({ x: 1329, y: 219, width: 25, height: 28 });
  expect(out.rect).toEqual({ x: 1328.8125, y: 219.296875, width: 25, height: 28 });
  expect(out.tool_version).toBe(VERSION);
});

// iframe の中の要素は、`getBoundingClientRect()` がそのフレームのビューポート座標を返すのに対し
// `page.screenshot({ clip })` は最上位フレームのビューポート座標として解釈するため、座標系が食い違う。
// はみ出し判定もフレーム側の innerWidth / innerHeight で通ってしまうので、撮る前に落とす。
test("フレームの中の要素は撮らずに失敗する（座標系が食い違う）", async () => {
  const page = {
    screenshot: async () => {
      throw new Error("撮ってはいけない");
    },
  };
  const locator = {
    scrollIntoViewIfNeeded: async () => {},
    evaluate: async (fn) => fn(fakeElement({ inFrame: true })),
  };
  await expect(captureElementShot(page, locator)).rejects.toThrow(/inside a frame/);

  // 陽性コントロール: 同じ矩形でも最上位フレームなら撮れる（判定が矩形ではなくフレームで効いている）。
  const shots = [];
  const okPage = {
    screenshot: async (options) => {
      shots.push(options);
      return Buffer.alloc(0);
    },
  };
  await captureElementShot(okPage, {
    scrollIntoViewIfNeeded: async () => {},
    evaluate: async (fn) => fn(fakeElement()),
  });
  expect(shots).toHaveLength(1);
});

test("scrollIntoView: false なら見える位置へ入れない", async () => {
  const calls = [];
  const locator = {
    scrollIntoViewIfNeeded: async () => calls.push("scroll"),
    evaluate: async (fn) => fn(fakeElement({ rect: { x: 0, y: 0, width: 10, height: 10 } })),
  };
  const page = { screenshot: async () => Buffer.alloc(0) };
  await captureElementShot(page, locator, { scrollIntoView: false });
  expect(calls).toEqual([]);
});

// --- アニメーションの既定 ---------------------------------------------------
//
// Playwright の screenshot は `animations` の既定が `"allow"`（実測: types.d.ts
// 「Defaults to "allow" that leaves animations untouched.」）。トランジション中の要素を撮ると
// 途中フレームが PNG になり run ごとに揺れるのに、撮影条件は `animations: disabled` として
// 記録される。記録と実体を食い違わせない。

function shotSpy(rect = { x: 0, y: 0, width: 10, height: 10 }) {
  const calls = [];
  const locator = {
    scrollIntoViewIfNeeded: async () => {},
    evaluate: async () => ({ rect, viewport: VIEWPORT, top_frame: true }),
  };
  const page = {
    screenshot: async (options) => {
      calls.push(options);
      return Buffer.alloc(0);
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
    evaluate: async () => ({
      rect: rects[Math.min(call++, rects.length - 1)],
      viewport: VIEWPORT,
      top_frame: true,
    }),
  };
  const page = {
    screenshot: async (options) => {
      calls.push(options);
      // Playwright は `path` を渡されるとその場で書き出す。fake も同じ振る舞いにしないと、
      // 「検査前に書いていないか」を測るテストが素通りする。
      const data = Buffer.from("png");
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
