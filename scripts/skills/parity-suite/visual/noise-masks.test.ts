// 2 回撮りで揺れた要素からマスクの候補を出す処理（parity-suite 同梱の noise-masks.mjs）のテスト（Issue #1106）。
// 期待値は parity-suite の references/baseline.md「揺れた要素からマスクの候補を出す」から決める。
// 領域を覆う要素を選ぶこと、切り取る祖先を優先すること、特定できないときは座標だけを返すことを確かめる。

import { afterEach, assert, describe, expect, test } from "vitest";
import {
  diffRegions,
  groupLocatedRegions,
  toCssRect,
} from "../../../../skills/parity-suite/scripts/noise-masks.mjs";
import { locateRegionsInPage } from "../../../../skills/parity-suite/scripts/page/noise-masks.page.mjs";
import { isArray } from "../../../lib/is-array.ts";
import { runFromSource } from "./page-source.ts";

type Rect = { x: number; y: number; width: number; height: number };

/** width × height の RGBA 画像。changed の座標だけ色を変えた 2 枚目と組にする。 */
function imagePair(width: number, height: number, changed: [number, number][]) {
  const first = new Uint8Array(width * height * 4).fill(255);
  const second = Uint8Array.from(first);
  for (const [x, y] of changed) second[(y * width + x) * 4] = 0;
  return { first, second };
}

describe("diffRegions", () => {
  test("同じ画像なら領域は無い", () => {
    const { first, second } = imagePair(16, 16, []);
    expect(diffRegions(first, second, { width: 16, height: 16, cell: 4 })).toEqual([]);
  });

  test("違う画素を囲む最小の矩形を返す（升目ではなく画素で囲む）", () => {
    const { first, second } = imagePair(16, 16, [
      [5, 6],
      [6, 7],
    ]);
    expect(diffRegions(first, second, { width: 16, height: 16, cell: 4 })).toEqual([
      { x: 5, y: 6, width: 2, height: 2 },
    ]);
  });

  test("アルファだけが違う画素も差にする", () => {
    const first = new Uint8Array(4 * 4 * 4).fill(255);
    const second = Uint8Array.from(first);
    second[(1 * 4 + 2) * 4 + 3] = 0;
    expect(diffRegions(first, second, { width: 4, height: 4, cell: 2 })).toEqual([
      { x: 2, y: 1, width: 1, height: 1 },
    ]);
  });

  test("斜めに隣り合う升目は 1 つの領域にまとめる", () => {
    const { first, second } = imagePair(16, 16, [
      [3, 3],
      [4, 4],
    ]);
    expect(diffRegions(first, second, { width: 16, height: 16, cell: 4 })).toEqual([
      { x: 3, y: 3, width: 2, height: 2 },
    ]);
  });

  test("離れた升目は別の領域にし、上から、同じ高さなら左から並べる", () => {
    const { first, second } = imagePair(24, 24, [
      [20, 1],
      [1, 1],
      [10, 20],
    ]);
    expect(diffRegions(first, second, { width: 24, height: 24, cell: 4 })).toEqual([
      { x: 1, y: 1, width: 1, height: 1 },
      { x: 20, y: 1, width: 1, height: 1 },
      { x: 10, y: 20, width: 1, height: 1 },
    ]);
  });

  test("升目を 1 つ空けた画素は別の領域にする", () => {
    const { first, second } = imagePair(16, 4, [
      [0, 0],
      [8, 0],
    ]);
    expect(diffRegions(first, second, { width: 16, height: 4, cell: 4 })).toHaveLength(2);
  });

  test("画像の端の升目（幅が升目で割り切れない）も数える", () => {
    const { first, second } = imagePair(10, 10, [[9, 9]]);
    expect(diffRegions(first, second, { width: 10, height: 10, cell: 4 })).toEqual([
      { x: 9, y: 9, width: 1, height: 1 },
    ]);
  });

  test("寸法と長さが合わない・升目が正の整数でないなら例外にする", () => {
    const { first, second } = imagePair(4, 4, []);
    expect(() => diffRegions(first, second, { width: 5, height: 4, cell: 2 })).toThrow(/length/);
    expect(() => diffRegions(first, second, { width: 4, height: 4, cell: 0 })).toThrow(/cell/);
  });
});

test("toCssRect は外側へ丸める", () => {
  expect(toCssRect({ x: 3, y: 5, width: 2, height: 1 }, 2)).toEqual({
    x: 1,
    y: 2,
    width: 2,
    height: 1,
  });
  expect(toCssRect({ x: 4, y: 4, width: 4, height: 4 }, 2)).toEqual({
    x: 2,
    y: 2,
    width: 2,
    height: 2,
  });
  expect(toCssRect({ x: 7, y: 7, width: 1, height: 1 }, 1)).toEqual({
    x: 7,
    y: 7,
    width: 1,
    height: 1,
  });
});

describe("groupLocatedRegions", () => {
  const region = (x: number): Rect => ({ x, y: 0, width: 1, height: 1 });
  const box: Rect = { x: 0, y: 0, width: 10, height: 10 };

  test("同じセレクタの領域を 1 つの候補にまとめ、特定できなかった領域は座標と理由だけにする", () => {
    expect(
      groupLocatedRegions([
        { region: region(1), selector: "#a", basis: "covering", element_rect: box },
        { region: region(2), reason: "no element" },
        { region: region(3), selector: "#b", basis: "clipping-ancestor", element_rect: box },
        { region: region(4), selector: "#a", basis: "covering", element_rect: box },
      ]),
    ).toEqual({
      candidates: [
        { selector: "#a", basis: "covering", element_rect: box, regions: [region(1), region(4)] },
        { selector: "#b", basis: "clipping-ancestor", element_rect: box, regions: [region(3)] },
      ],
      unlocated: [{ region: region(2), reason: "no element" }],
    });
  });
});

/** ページの要素の偽物。rect はビューポートの座標。 */
type FakeElement = {
  localName: string;
  id: string;
  attributes: Record<string, string>;
  rect: Rect;
  overflow: string;
  parentElement: FakeElement | null;
  previousElementSibling: FakeElement | null;
  getBoundingClientRect: () => Rect;
  getAttribute: (name: string) => string | null;
};

function element(
  localName: string,
  rect: Rect,
  options: {
    id?: string;
    attributes?: Record<string, string>;
    overflow?: string;
    parent?: FakeElement | null;
  } = {},
): FakeElement {
  const { id = "", attributes = {}, overflow = "visible", parent = null } = options;
  const el: FakeElement = {
    localName,
    id,
    attributes,
    rect,
    overflow,
    parentElement: parent,
    previousElementSibling: null,
    getBoundingClientRect: () => el.rect,
    getAttribute: (name) => attributes[name] ?? null,
  };
  return el;
}

/** 要素の一覧から、querySelectorAll が読む素朴なセレクタの解釈を作る（#id・tag[attr="v"]・> でつないだ tag:nth-of-type(n)）。 */
/** セレクタの 1 段が、要素に当たるか（#id・tag[attr="v"]・tag:nth-of-type(n)・tag）。 */
function matchesPart(el: FakeElement, part: string, all: FakeElement[]): boolean {
  const byId = /^#(.+)$/.exec(part);
  if (byId) return el.id === byId[1];
  const byAttribute = /^(\w+)\[([\w-]+)="(.*)"\]$/.exec(part);
  if (byAttribute) {
    return el.localName === byAttribute[1] && el.attributes[byAttribute[2]] === byAttribute[3];
  }
  const byIndex = /^(\w+):nth-of-type\((\d+)\)$/.exec(part);
  if (byIndex) {
    const siblings = all.filter(
      (o) => o.parentElement === el.parentElement && o.localName === el.localName,
    );
    return el.localName === byIndex[1] && siblings.indexOf(el) + 1 === Number(byIndex[2]);
  }
  return el.localName === part;
}

/** 要素の一覧から、querySelectorAll が読む素朴なセレクタ（> でつないだ段）の解釈を作る。 */
function matches(el: FakeElement, selector: string, all: FakeElement[]): boolean {
  let current: FakeElement | null = el;
  for (const part of selector.split(" > ").reverse()) {
    if (current === null || !matchesPart(current, part, all)) return false;
    current = current.parentElement;
  }
  return true;
}

/** 偽物の DOM を大域に置く。stack は elementsFromPoint が返す要素（上から順）。 */
function installDom(all: FakeElement[], stack: FakeElement[], scroll = { x: 0, y: 0 }) {
  const [html, body] = all;
  const window = {
    scrollX: scroll.x,
    scrollY: scroll.y,
    innerWidth: 800,
    innerHeight: 600,
    scrollTo(x: number, y: number) {
      window.scrollX = x;
      window.scrollY = y;
    },
  };
  const document = {
    documentElement: html,
    body,
    scrollingElement: html,
    elementsFromPoint: () => stack,
    querySelectorAll: (selector: string): FakeElement[] =>
      all.filter((el) => matches(el, selector, all)),
  };
  Object.assign(globalThis, {
    window,
    document,
    getComputedStyle: (el: FakeElement) => ({ overflowX: el.overflow, overflowY: el.overflow }),
    CSS: { escape: (value: string) => value },
  });
  return { window, document };
}

afterEach(() => {
  for (const name of ["window", "document", "getComputedStyle", "CSS"]) {
    Reflect.deleteProperty(globalThis, name);
  }
});

/** ページで探した結果。特定できたら selector・basis・element_rect を、できなければ reason を持つ。 */
type Located = {
  region: Rect;
  selector?: string;
  basis?: string;
  element_rect?: Rect;
  reason?: string;
};

function isLocatedList(value: unknown): value is Located[] {
  return isArray(value) && value.every((e) => typeof e === "object" && e !== null && "region" in e);
}

/** ページへ渡すのと同じく、関数のソースだけを評価し直して呼ぶ（本体の外の名前を参照すると失敗する）。 */
function locate(input: { regions: Rect[]; fullPage: boolean }): Located[] {
  const located = runFromSource(locateRegionsInPage, [input]);
  assert(isLocatedList(located), "locateRegionsInPage の戻り値が領域の配列でない");
  return located;
}

describe("locateRegionsInPage", () => {
  const page: Rect = { x: 0, y: 0, width: 800, height: 600 };

  function tree() {
    const html = element("html", page);
    const body = element("body", page, { parent: html });
    const viewport = element(
      "div",
      { x: 10, y: 10, width: 200, height: 40 },
      { overflow: "hidden", parent: body },
    );
    const track = element("div", { x: -190, y: 10, width: 600, height: 40 }, { parent: viewport });
    const clock = element(
      "p",
      { x: 0, y: 100, width: 800, height: 20 },
      { id: "clock", parent: body },
    );
    const span = element("span", { x: 300, y: 102, width: 80, height: 16 }, { parent: clock });
    const tested = element(
      "div",
      { x: 0, y: 200, width: 400, height: 20 },
      { attributes: { "data-testid": "uuid" }, parent: body },
    );
    const first = element("li", { x: 0, y: 300, width: 400, height: 20 }, { parent: body });
    const second = element("li", { x: 0, y: 320, width: 400, height: 20 }, { parent: body });
    second.previousElementSibling = first;
    return { html, body, viewport, track, clock, span, tested, first, second };
  }

  test("領域を覆ういちばん上の要素を選び、id でセレクタを作る", () => {
    const t = tree();
    installDom(Object.values(t), [t.span, t.clock, t.body, t.html]);
    const region = { x: 310, y: 103, width: 20, height: 10 };
    expect(locate({ regions: [region], fullPage: false })).toEqual([
      {
        region,
        selector: "#clock > span:nth-of-type(1)",
        basis: "covering",
        element_rect: t.span.rect,
      },
    ]);
  });

  test("領域を丸ごと覆わない要素は飛ばして、覆う祖先を選ぶ", () => {
    const t = tree();
    installDom(Object.values(t), [t.span, t.clock, t.body, t.html]);
    const region = { x: 250, y: 103, width: 100, height: 10 };
    const [located] = locate({ regions: [region], fullPage: false });
    expect(located.selector).toBe("#clock");
    expect(located.basis).toBe("covering");
  });

  test("overflow で切り取る祖先が領域を覆えば、動く中身ではなく祖先を選ぶ", () => {
    const t = tree();
    installDom(Object.values(t), [t.track, t.viewport, t.body, t.html]);
    const region = { x: 60, y: 20, width: 30, height: 10 };
    const [located] = locate({ regions: [region], fullPage: false });
    expect(located.selector).toBe("html > body:nth-of-type(1) > div:nth-of-type(1)");
    expect(located.basis).toBe("clipping-ancestor");
    expect(located.element_rect).toEqual(t.viewport.rect);
  });

  test("切り取る祖先が領域を覆わなければ、覆う要素のままにする", () => {
    const t = tree();
    t.clock.overflow = "hidden";
    t.clock.rect = { x: 300, y: 100, width: 40, height: 20 };
    installDom(Object.values(t), [t.span, t.clock, t.body, t.html]);
    const region = { x: 310, y: 103, width: 60, height: 10 };
    const [located] = locate({ regions: [region], fullPage: false });
    expect(located.basis).toBe("covering");
    expect(located.element_rect).toEqual(t.span.rect);
  });

  test("テスト用の属性でセレクタを作る", () => {
    const t = tree();
    installDom(Object.values(t), [t.tested, t.body, t.html]);
    const [located] = locate({
      regions: [{ x: 5, y: 202, width: 50, height: 10 }],
      fullPage: false,
    });
    expect(located.selector).toBe('div[data-testid="uuid"]');
  });

  test("同じ名前の兄弟の位置でセレクタを作る", () => {
    const t = tree();
    installDom(Object.values(t), [t.second, t.body, t.html]);
    const [located] = locate({
      regions: [{ x: 5, y: 322, width: 50, height: 10 }],
      fullPage: false,
    });
    expect(located.selector).toBe("html > body:nth-of-type(1) > li:nth-of-type(2)");
  });

  test("html と body しか覆わない領域は、座標と理由だけを返す", () => {
    const t = tree();
    installDom(Object.values(t), [t.body, t.html]);
    const region = { x: 400, y: 400, width: 20, height: 20 };
    expect(locate({ regions: [region], fullPage: false })).toEqual([
      { region, reason: "no element other than html / body covers the region" },
    ]);
  });

  test("切り取る祖先を探すときも html と body は選ばない", () => {
    const t = tree();
    t.body.overflow = "hidden";
    installDom(Object.values(t), [t.span, t.clock, t.body, t.html]);
    const [located] = locate({
      regions: [{ x: 310, y: 103, width: 20, height: 10 }],
      fullPage: false,
    });
    expect(located.basis).toBe("covering");
  });

  test("1 つだけを指すセレクタを作れなければ、特定できたことにしない", () => {
    const t = tree();
    const twin = element(
      "p",
      { x: 0, y: 500, width: 10, height: 10 },
      { id: "clock", parent: t.body },
    );
    const { document } = installDom([...Object.values(t), twin], [t.clock, t.body, t.html]);
    // 同じ id の要素が 2 つあり、位置のセレクタも p:nth-of-type(1) が clock だけを指すので、位置で作れる
    const [byPath] = locate({
      regions: [{ x: 5, y: 102, width: 20, height: 10 }],
      fullPage: false,
    });
    expect(byPath.selector).toBe("html > body:nth-of-type(1) > p:nth-of-type(1)");
    // querySelectorAll が要素を見つけない文書では、どの形も 1 つに決まらない
    document.querySelectorAll = () => [];
    const [none] = locate({
      regions: [{ x: 5, y: 102, width: 20, height: 10 }],
      fullPage: false,
    });
    expect(none).toEqual({
      region: { x: 5, y: 102, width: 20, height: 10 },
      reason: "no CSS selector points only to the covering element",
    });
  });

  test("全画面の撮影では、文書の座標で比べ、探した後にスクロールを戻す", () => {
    const t = tree();
    // 文書の y=1500 にある要素。スクロールした後のビューポートの座標で矩形を返す
    const late = element(
      "p",
      { x: 0, y: 0, width: 800, height: 20 },
      { id: "late", parent: t.body },
    );
    const { window } = installDom([...Object.values(t), late], [late, t.body, t.html], {
      x: 0,
      y: 40,
    });
    late.getBoundingClientRect = () => ({ x: 0, y: 1500 - window.scrollY, width: 800, height: 20 });
    const region = { x: 100, y: 1503, width: 30, height: 10 };
    const [located] = locate({ regions: [region], fullPage: true });
    expect(located.selector).toBe("#late");
    expect(located.element_rect).toEqual({ x: 0, y: 1500, width: 800, height: 20 });
    expect([window.scrollX, window.scrollY]).toEqual([0, 40]);
  });

  test("ビューポートの撮影では、スクロールしていてもビューポートの座標で比べる", () => {
    const t = tree();
    const { window } = installDom(Object.values(t), [t.span, t.clock, t.body, t.html], {
      x: 0,
      y: 500,
    });
    const [located] = locate({
      regions: [{ x: 310, y: 103, width: 20, height: 10 }],
      fullPage: false,
    });
    expect(located.element_rect).toEqual(t.span.rect);
    expect(window.scrollY).toBe(500);
  });
});
