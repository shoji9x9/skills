// trait-capture.test.ts が使うヘルパーと fixture。
import { assert } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const script = join(repoRoot, "skills/parity-suite/scripts/trait-capture.mjs");
export const {
  FIXED_PROPERTIES,
  TEXT_OWNER_PROPERTIES,
  SCROLLBAR_PROPERTIES,
  SCROLLBAR_PSEUDOS,
  SCROLLBAR_PSEUDO_PROPERTIES,
  VERSION,
  captureTraits,
  captureElementTraits,
}: typeof import("../../../../skills/parity-suite/scripts/trait-capture.mjs") = await import(
  script
);

export type Rect = { x: number; y: number; width: number; height: number };
export type Styles = Record<string, string>;
// 偽の DOM のノード。テキストノードと要素で持つ項目が違い、テストごとに足す項目（getBoundingClientRect など）もあるので開いた形にする
export type FakeNode = { [key: string]: unknown; parentNode?: FakeNode; parentElement?: FakeNode };
// Range が選ぶテキストノードの形（textNode が作る）
type RangeTarget = { rect: Rect; fragments?: Rect[]; lead?: number; trail?: number };
type FakeLocatorOptions = {
  pseudoContent?: string;
  pseudoStyles?: Styles;
  origin?: string;
  rect?: Rect;
  scroll?: { x: number; y: number };
  viewport?: { width: number; height: number };
  documentSize?: { width: number; height: number };
  children?: { tag?: string; style?: string }[];
  childNodes?: FakeNode[];
  shadowRoot?: { childNodes: FakeNode[] } | null;
  rootTextStyle?: Styles | null;
  box?: Record<string, number> | null;
  pseudoStylesBy?: Record<string, Styles>;
  webkitSupported?: boolean | null;
};
type FakeComputedStyle = { content: string; getPropertyValue: (prop: string) => string };
// lib に DOM を入れていないので、偽ロケータが差し替えるブラウザの大域変数の型をここで宣言する
type FakeBrowserGlobals = {
  getComputedStyle: (
    element: { textStyle?: Styles } | null | undefined,
    pseudo?: string,
  ) => FakeComputedStyle;
  location: { origin: string };
  document: { documentElement: { scrollWidth: number; scrollHeight: number } };
  scrollX: number;
  scrollY: number;
  innerWidth: number;
  innerHeight: number;
  CSS: { supports: (query: string) => boolean } | undefined;
};
// oxlint-disable-next-line typescript/consistent-type-assertions -- テストが後から足す偽の大域変数は、globalThis の型に無いので宣言で足せない
const browser = globalThis as typeof globalThis & FakeBrowserGlobals;

/** captureTraits が返す 1 要素の特性。 */
type CapturedTrait = Awaited<ReturnType<typeof captureTraits>>[number];

/** スクロールするコンテナとして採った特性の scroll（コンテナでなければテストを失敗させる）。 */
export function scrollOf(trait: CapturedTrait) {
  assert.exists(trait.scroll, `${trait.name} の scroll が null`);
  return trait.scroll;
}

/** ::-webkit-scrollbar 系を読めたブラウザで採った webkit（unsupported ならテストを失敗させる）。 */
export function webkitOf(trait: CapturedTrait) {
  const { webkit } = scrollOf(trait);
  assert(webkit !== "unsupported", `${trait.name} の webkit が unsupported`);
  return webkit;
}

// fakeLocator の既定値を埋めた後の設定
type ResolvedLocatorOptions = Required<FakeLocatorOptions>;

function resolveLocatorOptions(
  styles: Styles,
  {
    pseudoContent = "none",
    pseudoStyles = styles,
    origin = "http://legacy.example:8811",
    rect = { x: 1, y: 2, width: 3, height: 4 },
    scroll = { x: 0, y: 0 },
    viewport = { width: 1280, height: 800 },
    documentSize = { width: 1280, height: 800 },
    children = [],
    childNodes = [],
    shadowRoot = null,
    // el 自身が文字の持ち主になる場合の計算値（styles に重ねる。省略時は textStyle を持たない）
    rootTextStyle = null,
    // コンテナの寸法（offsetWidth 等）。省略時は offsetWidth を持たない（HTML 要素でない）扱いで scroll は null
    box = null,
    // 擬似要素ごとの計算値（::-webkit-scrollbar 系）。無い擬似要素は pseudoStyles を返す
    pseudoStylesBy = {},
    // CSS.supports("selector(::-webkit-scrollbar)") の答え。null なら CSS を置かない
    webkitSupported = true,
  }: FakeLocatorOptions,
): ResolvedLocatorOptions {
  return {
    pseudoContent,
    pseudoStyles,
    origin,
    rect,
    scroll,
    viewport,
    documentSize,
    children,
    childNodes,
    shadowRoot,
    rootTextStyle,
    box,
    pseudoStylesBy,
    webkitSupported,
  };
}

// canvas の measureText は文字数 × 13 の幅と 12 + 3 の高さを返す偽（ボタンとして描く <input> 用）
// 大文字を含む文字列には 1000 を足し、letterSpacing は 1 文字ごとに足す（渡した形を区別するため）
function fakeCanvas() {
  return {
    getContext: () => ({
      font: "",
      letterSpacing: "0px",
      measureText(t: string) {
        const spacing = parseFloat(this.letterSpacing) || 0;
        return {
          width: t.length * 13 + spacing * t.length + (/[A-Z]/.test(t) ? 1000 : 0),
          fontBoundingBoxAscent: 12,
          fontBoundingBoxDescent: 3,
        };
      },
    }),
  };
}

// Range は selectNodeContents したテキストノードの矩形（textNode の rect）を返す
function fakeRange() {
  let target: RangeTarget | null = null;
  let start: number | null = null;
  // captureElement は範囲を選んでから矩形を読むので、読む時点で target は入っている
  const selected = (): RangeTarget => {
    assert.exists(target, "範囲を選ぶ前に矩形を読んだ");
    return target;
  };
  return {
    selectNodeContents: (node: RangeTarget) => {
      target = node;
    },
    // 部分範囲（端の空白の幅を測る）。先頭からの範囲は lead、それ以外は trail の幅を返す
    setStart: (node: RangeTarget, offset: number) => {
      target = node;
      start = offset;
    },
    setEnd: () => {},
    getBoundingClientRect: () => selected().rect,
    // 行の断片。折り返す文字は fragments で複数を渡す（省略時は矩形 1 つ）
    getClientRects: () =>
      start === null
        ? (selected().fragments ?? [selected().rect])
        : [
            {
              x: 0,
              y: 0,
              width: (start === 0 ? selected().lead : selected().trail) ?? 0,
              height: 1,
            },
          ],
  };
}

// captureElement に渡す要素 el の偽
function fakeElement(styles: Styles, o: ResolvedLocatorOptions) {
  return {
    getBoundingClientRect: () => o.rect,
    children: o.children.map((child) => ({
      tagName: (child.tag ?? "span").toUpperCase(),
      getAttribute: (name: string) => (name === "style" ? (child.style ?? null) : null),
    })),
    tagName: "BUTTON",
    textStyle: o.rootTextStyle ? { ...styles, ...o.rootTextStyle } : undefined,
    childNodes: o.childNodes,
    shadowRoot: o.shadowRoot,
    ...o.box,
    ownerDocument: { createElement: fakeCanvas, createRange: fakeRange },
  };
}

// ブラウザの大域変数を偽に差し替え、元に戻す関数を返す
function installBrowserGlobals(styles: Styles, o: ResolvedLocatorOptions) {
  const previous = {
    getComputedStyle: browser.getComputedStyle,
    location: browser.location,
    document: browser.document,
    scrollX: browser.scrollX,
    scrollY: browser.scrollY,
    innerWidth: browser.innerWidth,
    innerHeight: browser.innerHeight,
    CSS: browser.CSS,
  };
  browser.getComputedStyle = (element, pseudo) => ({
    content: pseudo ? o.pseudoContent : "normal",
    getPropertyValue: (prop: string) =>
      (element && element.textStyle
        ? element.textStyle
        : pseudo
          ? (o.pseudoStylesBy[pseudo] ?? o.pseudoStyles)
          : styles)[prop] ?? "",
  });
  browser.CSS =
    o.webkitSupported === null
      ? undefined
      : {
          supports: (query: string) =>
            query === "selector(::-webkit-scrollbar)" && o.webkitSupported === true,
        };
  browser.location = { origin: o.origin };
  browser.document = {
    documentElement: { scrollWidth: o.documentSize.width, scrollHeight: o.documentSize.height },
  };
  browser.scrollX = o.scroll.x;
  browser.scrollY = o.scroll.y;
  browser.innerWidth = o.viewport.width;
  browser.innerHeight = o.viewport.height;
  return () => Object.assign(browser, previous);
}

// 採るプロパティの固定集合（captureTraits が evaluate へ渡す引数）。
type CaptureProps = Parameters<typeof captureElementTraits>[1];
// evaluate に渡された関数を偽の要素に当てる方法。
export type PageRun = (
  fn: (el: FakeElement, props: CaptureProps) => unknown,
  el: FakeElement,
  props: CaptureProps,
) => unknown;
type FakeElement = ReturnType<typeof fakeElement>;

/**
 * describe.each に渡す 2 通りの当て方。モジュールの関数は、渡された関数を使わずに captureElementTraits を呼び、
 * カバレッジを記録する。ページへ渡すソースは、captureTraits が組み立てた関数をそのまま当てる。
 * ページ側の関数がヘルパーの一覧を通さずに互いを呼ぶと、モジュールの関数として呼んだときはモジュールのスコープで
 * 名前が解決されて通るが、こちらでは名前が解決できずに失敗する。
 */
export const PAGE_RUNS: [string, PageRun][] = [
  ["モジュールの関数", (_fn, el, props) => captureElementTraits(el, props)],
  ["ページへ渡すソース", (fn, el, props) => fn(el, props)],
];

// captureElement は locator.evaluate に文字列化して渡る純関数なので、
// evaluate を「渡された関数をブラウザ相当のスタブへ当てる」偽ロケータで実行して検証する。
// 当て方は run で選ぶ（PAGE_RUNS）。
export function fakeLocator(run: PageRun, styles: Styles, options: FakeLocatorOptions = {}) {
  const o = resolveLocatorOptions(styles, options);
  return {
    evaluate(fn: (el: FakeElement, props: CaptureProps) => unknown, props: CaptureProps) {
      const el = fakeElement(styles, o);
      const restore = installBrowserGlobals(styles, o);
      try {
        return Promise.resolve(run(fn, el, props));
      } finally {
        restore();
      }
    },
  };
}

// 実測（Chrome 経由）: cursor: url(cur.png) の計算値は自分のオリジンで絶対化され、
// 同じ CSS が http://127.0.0.1:8811 と :8822 で別文字列になる。
export const cursorOn = (origin: string, path: string) => `url("${origin}/${path}"), pointer`;

export function allResolved(overrides: Styles = {}): Styles {
  return Object.fromEntries(
    FIXED_PROPERTIES.map((prop: string) => [prop, overrides[prop] ?? "0px"]),
  );
}

// 偽の DOM。要素は textStyle（その要素の計算値）を持ち、テキストノードは rect（Range の矩形）を持つ。
// parentElement / parentNode は組み立て後に張る。
// textNode の fragments は行ごとの矩形、lead / trail は前後の空白の幅。
// elementNode にそれ以外のプロパティを足すときは、呼び出し側で Object.assign する。
export function textNode(
  value: string,
  rect: Rect = { x: 0, y: 0, width: 24, height: 14 },
  { fragments, ...edges }: { fragments?: Rect[]; lead?: number; trail?: number } = {},
): FakeNode {
  return { nodeType: 3, nodeValue: value, rect, fragments, ...edges };
}
export function elementNode(
  tag: string,
  childNodes: FakeNode[] = [],
  textStyle: Styles = {},
): FakeNode {
  const node: FakeNode = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    childNodes,
    textStyle,
  };
  for (const child of childNodes) {
    child.parentNode = node;
    child.parentElement = node;
  }
  return node;
}
export function fontOf(overrides: Styles = {}): Styles {
  return {
    "font-family": "arial, sans-serif",
    "font-size": "13.3333px",
    "font-style": "normal",
    "font-weight": "400",
    "line-height": "normal",
    visibility: "visible",
    "overflow-x": "visible",
    "overflow-y": "visible",
    clip: "auto",
    ...overrides,
  };
}
// 名前を付けた要素自身。直下のテキストノードの親は el 自身なので、el と同じ計算値（styles）を返す偽を張る。
export function rootWith(childNodes: FakeNode[], rootStyle: Styles = fontOf()) {
  const root: FakeNode = { textStyle: rootStyle, tagName: "BUTTON", nodeType: 1 };
  for (const child of childNodes) {
    child.parentNode = root;
    child.parentElement = root;
  }
  return root;
}

// スクロールするコンテナ（Issue #495）。実例: ダイアログの中のデータグリッドで、現行は overflow: auto、新側は
// overflow-x: hidden。スクロールバーが場所を取る撮影では、現行だけ縦のバーの 15px で中身がはみ出して横のバーが出る。
// 値は Chrome 149 の実測（枠 0・コンテナ 628×298、中身 628 幅）に合わせている。
export function scrollStyles(overrides: Styles = {}): Styles {
  // allResolved は固定集合のキーしか持たないので、スクロールバーの宣言は外で重ねる
  return {
    ...allResolved({
      "overflow-x": "auto",
      "overflow-y": "auto",
      "border-top-width": "0px",
      "border-right-width": "0px",
      "border-bottom-width": "0px",
      "border-left-width": "0px",
    }),
    "scrollbar-width": "auto",
    "scrollbar-color": "auto",
    "scrollbar-gutter": "auto",
    ...overrides,
  };
}
export function scrollbarPseudo(overrides: Styles = {}): Styles {
  return Object.fromEntries(
    SCROLLBAR_PSEUDO_PROPERTIES.map((prop: string) => [
      prop,
      overrides[prop] ?? (prop.endsWith("color") ? "rgba(0, 0, 0, 0)" : "auto"),
    ]),
  );
}
export const gridBox = (clientWidth: number, clientHeight: number) => ({
  offsetWidth: 628,
  offsetHeight: 298,
  clientWidth,
  clientHeight,
  scrollWidth: 628,
  scrollHeight: 900,
});
