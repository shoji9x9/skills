// 静止画に写らない computed style を固定集合に入れ、解決しない名前で fail closed する回帰テスト（Issue #342）。
// 併せて、採った対象が「画面に描かれているもの」かの判定と子の inline style の記録（Issue #386）、
// 文字の持ち主（text_owners）の採取（Issue #459）。

import { expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repoRoot, "skills/parity-suite/scripts/trait-capture.mjs");
const { FIXED_PROPERTIES, TEXT_OWNER_PROPERTIES, VERSION, captureTraits } = await import(script);

// captureElement は locator.evaluate に文字列化して渡る純関数なので、
// evaluate を「渡された関数をブラウザ相当のスタブへ当てる」偽ロケータで実行して検証する。
function fakeLocator(
  styles,
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
  } = {},
) {
  return {
    evaluate(fn, props) {
      const el = {
        getBoundingClientRect: () => rect,
        children: children.map((child) => ({
          tagName: (child.tag ?? "span").toUpperCase(),
          getAttribute: (name) => (name === "style" ? (child.style ?? null) : null),
        })),
        tagName: "BUTTON",
        textStyle: rootTextStyle ? { ...styles, ...rootTextStyle } : undefined,
        childNodes,
        shadowRoot,
        ownerDocument: {
          // canvas の measureText は文字数 × 13 の幅と 12 + 3 の高さを返す偽（ボタンとして描く <input> 用）
          // 大文字を含む文字列には 1000 を足し、letterSpacing は 1 文字ごとに足す（渡した形を弁別するため）
          createElement: () => ({
            getContext: () => ({
              font: "",
              letterSpacing: "0px",
              measureText(t) {
                const spacing = parseFloat(this.letterSpacing) || 0;
                return {
                  width: t.length * 13 + spacing * t.length + (/[A-Z]/.test(t) ? 1000 : 0),
                  fontBoundingBoxAscent: 12,
                  fontBoundingBoxDescent: 3,
                };
              },
            }),
          }),
          // Range は selectNodeContents したテキストノードの矩形（textNode の rect）を返す
          createRange: () => {
            let target = null;
            let start = null;
            return {
              selectNodeContents: (node) => {
                target = node;
              },
              // 部分範囲（端の空白の幅を測る）。先頭からの範囲は lead、それ以外は trail の幅を返す
              setStart: (node, offset) => {
                target = node;
                start = offset;
              },
              setEnd: () => {},
              getBoundingClientRect: () => target.rect,
              // 行の断片。折り返す文字は fragments で複数を渡す（省略時は矩形 1 つ）
              getClientRects: () =>
                start === null
                  ? (target.fragments ?? [target.rect])
                  : [
                      {
                        x: 0,
                        y: 0,
                        width: (start === 0 ? target.lead : target.trail) ?? 0,
                        height: 1,
                      },
                    ],
            };
          },
        },
      };
      const previousStyle = globalThis.getComputedStyle;
      const previousLocation = globalThis.location;
      const previousDocument = globalThis.document;
      const previousScrollX = globalThis.scrollX;
      const previousScrollY = globalThis.scrollY;
      const previousInnerWidth = globalThis.innerWidth;
      const previousInnerHeight = globalThis.innerHeight;
      globalThis.getComputedStyle = (element, pseudo) => ({
        content: pseudo ? pseudoContent : "normal",
        getPropertyValue: (prop) =>
          (element && element.textStyle ? element.textStyle : pseudo ? pseudoStyles : styles)[
            prop
          ] ?? "",
      });
      globalThis.location = { origin };
      globalThis.document = {
        documentElement: { scrollWidth: documentSize.width, scrollHeight: documentSize.height },
      };
      globalThis.scrollX = scroll.x;
      globalThis.scrollY = scroll.y;
      globalThis.innerWidth = viewport.width;
      globalThis.innerHeight = viewport.height;
      try {
        return Promise.resolve(fn(el, props));
      } finally {
        globalThis.getComputedStyle = previousStyle;
        globalThis.location = previousLocation;
        globalThis.document = previousDocument;
        globalThis.scrollX = previousScrollX;
        globalThis.scrollY = previousScrollY;
        globalThis.innerWidth = previousInnerWidth;
        globalThis.innerHeight = previousInnerHeight;
      }
    },
  };
}

// 実測（Chrome 経由）: cursor: url(cur.png) の計算値は自分のオリジンで絶対化され、
// 同じ CSS が http://127.0.0.1:8811 と :8822 で別文字列になる。
const cursorOn = (origin, path) => `url("${origin}/${path}"), pointer`;

function allResolved(overrides = {}) {
  return Object.fromEntries(FIXED_PROPERTIES.map((prop) => [prop, overrides[prop] ?? "0px"]));
}

test.each([
  // 操作の手応えを決めるが静止画に出ない
  "cursor",
  "user-select",
  "pointer-events",
  // 要素が「どこに置かれるか」を決めるが、切り出しが要素についてくるので矩形の中に出ない（Issue #434）
  "position",
  "top",
  "right",
  "bottom",
  "left",
  // 矩形の外に描かれる／下地に依存して弁別できない（Issue #434）
  "box-shadow",
  "opacity",
  // 折り返し・省略を決めるが、採取時の文字列が短ければ静止画に差として出ない（Issue #434）
  "white-space",
  "overflow-x",
  "overflow-y",
  "text-overflow",
  "word-break",
])("要素の矩形を撮った静止画に写らない %s が固定集合に入っている", (prop) => {
  expect(FIXED_PROPERTIES).toContain(prop);
});

// 集合の中身が変わったら version を上げる契約（parity-diff は property_set を正とする）。
// 陳腐化判定はこの版でしか働かないので、集合だけ変えて版を据え置く変異をここで落とす。
test("固定集合の要素数と VERSION が対応している", () => {
  expect(FIXED_PROPERTIES).toHaveLength(48);
  expect(VERSION).toBe("5");
});

test("固定集合に重複が無い", () => {
  expect(new Set(FIXED_PROPERTIES).size).toBe(FIXED_PROPERTIES.length);
});

// 集合に名前があることだけを見るテストでは、captureElement のループが特定の名前を読み落とす
// 変異を捕まえられない。3 プロパティとも computed へ入って差分になることを同じ形で確かめる。
test.each([
  ["cursor", "pointer", "default"],
  ["user-select", "none", "auto"],
  ["pointer-events", "none", "auto"],
  ["top", "5px", "0px"],
  ["left", "2px", "0px"],
  ["box-shadow", "none", "rgb(204, 204, 204) 0px 0px 0px 1px inset"],
  ["opacity", "0.5", "1"],
  ["white-space", "nowrap", "normal"],
  ["text-overflow", "ellipsis", "clip"],
])(
  "%s の差は computed に現れる（画素に写らない差を特性照合へ渡す）",
  async (prop, before, after) => {
    const [legacy] = await captureTraits([
      { name: "detail.save", locator: fakeLocator(allResolved({ [prop]: before })) },
    ]);
    const [replacement] = await captureTraits([
      { name: "detail.save", locator: fakeLocator(allResolved({ [prop]: after })) },
    ]);

    expect(legacy.computed[prop]).toBe(before);
    expect(replacement.computed[prop]).toBe(after);
    expect(legacy.computed[prop]).not.toBe(replacement.computed[prop]);
  },
);

test("擬似要素は content が none なら null になる", async () => {
  const [trait] = await captureTraits([
    { name: "detail.save", locator: fakeLocator(allResolved()) },
  ]);
  expect(trait.before).toBeNull();
  expect(trait.after).toBeNull();
  expect(trait.rect).toEqual({ x: 1, y: 2, width: 3, height: 4 });
});

test("解決しないプロパティ名は空文字で通さず論理名付きで落ちる", async () => {
  const styles = allResolved();
  delete styles["user-select"];

  await expect(
    captureTraits([{ name: "detail.save", locator: fakeLocator(styles) }]),
  ).rejects.toThrow(/detail\.save[\s\S]*user-select/);
});

// 本体側は全部解決させ、擬似要素側だけを欠かす。本体側も欠かすと pick(null) が先に落ちるため、
// 擬似要素の分岐を無効化しても green のままになる（弁別できない）。
test("擬似要素側だけで解決しないプロパティ名も落ちる", async () => {
  const pseudoStyles = allResolved();
  delete pseudoStyles.cursor;

  await expect(
    captureTraits([
      {
        name: "detail.save",
        locator: fakeLocator(allResolved(), { pseudoContent: '"x"', pseudoStyles }),
      },
    ]),
  ).rejects.toThrow(/detail\.save[\s\S]*::before[\s\S]*cursor/);
});

test("同一オリジンの url() は畳まれ、現・新のホスト違いが偽の差分にならない", async () => {
  const [legacy] = await captureTraits([
    {
      name: "detail.save",
      locator: fakeLocator(
        allResolved({ cursor: cursorOn("http://legacy.example:8811", "cur.png") }),
        {
          origin: "http://legacy.example:8811",
        },
      ),
    },
  ]);
  const [replacement] = await captureTraits([
    {
      name: "detail.save",
      locator: fakeLocator(
        allResolved({ cursor: cursorOn("http://new.example:3000", "cur.png") }),
        {
          origin: "http://new.example:3000",
        },
      ),
    },
  ]);

  expect(legacy.computed.cursor).toBe('url("<same-origin>/cur.png"), pointer');
  expect(legacy.computed.cursor).toBe(replacement.computed.cursor);
});

test("同一オリジンでもパスが違えば差分として残る（畳んで本物の差を消さない）", async () => {
  const [legacy] = await captureTraits([
    {
      name: "detail.save",
      locator: fakeLocator(
        allResolved({ cursor: cursorOn("http://legacy.example:8811", "cur.png") }),
        {
          origin: "http://legacy.example:8811",
        },
      ),
    },
  ]);
  const [replacement] = await captureTraits([
    {
      name: "detail.save",
      locator: fakeLocator(
        allResolved({ cursor: cursorOn("http://new.example:3000", "other.png") }),
        {
          origin: "http://new.example:3000",
        },
      ),
    },
  ]);

  expect(legacy.computed.cursor).not.toBe(replacement.computed.cursor);
});

test.each([
  ["data URI", 'url("data:image/gif;base64,R0lGODlhAQABAAAAACw="), auto'],
  ["別オリジン", 'url("https://cdn.example.com/x.png"), auto'],
  ["自オリジンを前方一致で含む別ホスト", 'url("http://legacy.example:8811.evil/x.png"), auto'],
  [
    "他オリジン URL のパスに自オリジンが現れる値",
    'url("https://cdn.example/redirect/http://legacy.example:8811/x.png"), auto',
  ],
  [
    "url() の外に自オリジンが現れる値",
    'url("https://cdn.example/x.png") http://legacy.example:8811/note, auto',
  ],
])("%s の url() は畳まず原文のまま残す", async (_name, value) => {
  const [trait] = await captureTraits([
    {
      name: "detail.save",
      locator: fakeLocator(allResolved({ cursor: value }), {
        origin: "http://legacy.example:8811",
      }),
    },
  ]);
  expect(trait.computed.cursor).toBe(value);
});

// origin が http(s) でないときは畳まない。"" を含めるのはガードの弁別のため——ガードを外すと
// 空オリジンが value.includes("/") に化けて、あらゆるスラッシュを印へ置換し値を壊す。
test.each([
  ["file:// 等で origin が null", "null"],
  ["origin が空", ""],
])("%s のときは畳まず原文のまま残す（黙って一致させない）", async (_name, origin) => {
  const value = cursorOn("http://legacy.example:8811", "cur.png");
  const [trait] = await captureTraits([
    { name: "detail.save", locator: fakeLocator(allResolved({ cursor: value }), { origin }) },
  ]);
  expect(trait.computed.cursor).toBe(value);
});

// --- 採った対象が「画面に描かれているもの」か（Issue #386 形 2） ---

// 実測（2026-09-14）: 市販のデータグリッド（Wijmo FlexGrid 5.20261）は列見出しを 2 つの木に作り、
// getByRole("columnheader") が返すのは y = -32000 に置かれた支援技術のための写しだった。
// 写しから採った 34 プロパティは全部一致し、画素だけが差を出した。
test("文書の外に置かれた写しからの採取は論理名付きで落ちる", async () => {
  await expect(
    captureTraits([
      {
        name: "list.columnheader",
        locator: fakeLocator(allResolved(), {
          rect: { x: 0, y: -32000, width: 120, height: 32 },
          documentSize: { width: 1280, height: 2400 },
        }),
      },
    ]),
  ).rejects.toThrow(/list\.columnheader[\s\S]*outside the document/);
});

test.each([
  [
    "折り返しの下にある要素（full_page 撮影では写る）",
    {
      rect: { x: 10, y: 1800, width: 120, height: 32 },
      documentSize: { width: 1280, height: 2400 },
    },
  ],
  [
    "スクロールで視野の上へ出た要素",
    {
      rect: { x: 10, y: -100, width: 120, height: 32 },
      scroll: { x: 0, y: 500 },
      documentSize: { width: 1280, height: 2400 },
    },
  ],
  [
    "面積 0 の矩形（display: none 等の状態）",
    { rect: { x: 0, y: 0, width: 0, height: 0 }, documentSize: { width: 1280, height: 2400 } },
  ],
  // ガード（box.width > 0 && box.height > 0）が効いていることの陽性コントロール。
  // 文書の外の座標かつ面積 0 なので、ガードを外すと判定に掛かって落ちる（＝この行が赤くなる）。
  // 素通りするのは仕様——面積 0 は display: none を正当に採るための除外で、その射程は
  // skills/parity-suite/references/baseline.md に限界として書いてある。
  [
    "文書の外に置かれた面積 0 の矩形（判定の射程外）",
    {
      rect: { x: 0, y: -32000, width: 0, height: 0 },
      documentSize: { width: 1280, height: 2400 },
    },
  ],
  [
    "文書の右端に接する要素",
    {
      rect: { x: 1160, y: 10, width: 120, height: 32 },
      documentSize: { width: 1280, height: 2400 },
    },
  ],
  // RTL の横スクロール文書では scrollX が負になり、見えている矩形でも
  // docX + width <= 0 が成り立つ。ビューポートに掛かっていれば文書座標を見るまでもなく描かれている。
  [
    "scrollX が負の文書（RTL の横スクロール）でビューポートに掛かる要素",
    {
      rect: { x: 10, y: 10, width: 50, height: 32 },
      scroll: { x: -100, y: 0 },
      documentSize: { width: 1280, height: 2400 },
    },
  ],
])("%s は描かれている扱いで採れる（陽性コントロール）", async (_name, options) => {
  const [trait] = await captureTraits([
    { name: "list.cell", locator: fakeLocator(allResolved(), options) },
  ]);
  expect(trait.rect).toEqual(options.rect);
});

// --- 子の inline style（Issue #386 形 1） ---

// 実測: 共通ヘッダーの Back が <a><span style="font-weight: bold;">Back</span></a> の形で、
// a の 34 プロパティは全一致（a 自身は font-weight: 400）のまま画素だけ 62 画素の差を出した。
test("1 段下の子の inline style を記録する（装飾がどこに乗っているかを残す）", async () => {
  const [trait] = await captureTraits([
    {
      name: "header.back",
      locator: fakeLocator(allResolved(), {
        children: [
          { tag: "span", style: "font-weight: bold;" },
          { tag: "span" },
          { tag: "i", style: "   " },
          { tag: "em", style: " color: red; " },
        ],
      }),
    },
  ]);

  expect(trait.child_inline_styles).toEqual([
    { index: 0, tag: "span", style: "font-weight: bold;" },
    { index: 3, tag: "em", style: "color: red;" },
  ]);
});

test("子に inline style が無ければ空配列になる（キーの欠落と区別する）", async () => {
  const [trait] = await captureTraits([
    {
      name: "header.back",
      locator: fakeLocator(allResolved(), { children: [{ tag: "span" }] }),
    },
  ]);
  expect(trait.child_inline_styles).toEqual([]);
});

// --- 文字の持ち主（Issue #459） ---

// 偽の DOM。要素は textStyle（その要素の計算値）を持ち、テキストノードは rect（Range の矩形）を持つ。
// parentElement / parentNode は組み立て後に張る。
function textNode(value, rect = { x: 0, y: 0, width: 24, height: 14 }, fragments, edges = {}) {
  return { nodeType: 3, nodeValue: value, rect, fragments, ...edges };
}
function elementNode(tag, childNodes = [], textStyle = {}, extra = {}) {
  const node = { nodeType: 1, tagName: tag.toUpperCase(), childNodes, textStyle, ...extra };
  for (const child of childNodes) {
    child.parentNode = node;
    child.parentElement = node;
  }
  return node;
}
function fontOf(overrides = {}) {
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
function rootWith(childNodes, rootStyle = fontOf()) {
  const root = { textStyle: rootStyle, tagName: "BUTTON", nodeType: 1 };
  for (const child of childNodes) {
    child.parentNode = root;
    child.parentElement = root;
  }
  return root;
}

test("文字の持ち主の固定集合と VERSION が対応している", () => {
  expect([...TEXT_OWNER_PROPERTIES]).toEqual([
    "font-family",
    "font-size",
    "font-style",
    "font-weight",
    "line-height",
  ]);
  expect(VERSION).toBe("5");
});

// 実例（Issue #459）: <button>（arial・13.3333px）の中の <div>（Roboto・14px）の中の <span>（12px）が文字を持つ。
// 要素自身の計算値は採れても、文字を描く span の書体・大きさはどこにも残らなかった。
test("入れ子の子孫が持つ文字の書体・大きさ・矩形を、持ち主の行として採る", async () => {
  const text = textNode("設定", { x: 16, y: 14, width: 24.015625, height: 14 });
  const span = elementNode(
    "span",
    [text],
    fontOf({ "font-family": "Roboto, sans-serif", "font-size": "12px" }),
  );
  const div = elementNode(
    "div",
    [span],
    fontOf({ "font-family": "Roboto, sans-serif", "font-size": "14px" }),
  );
  const locator = fakeLocator(allResolved(), { childNodes: [div] });
  rootWith([div]);

  const [trait] = await captureTraits([{ name: "toolbar.settings", locator }]);

  expect(trait.text_owners).toEqual([
    {
      path: "div[0]>span[0]",
      tag: "span",
      text: "設定",
      style: {
        "font-family": "Roboto, sans-serif",
        "font-size": "12px",
        "font-style": "normal",
        "font-weight": "400",
        "line-height": "normal",
      },
      advance: 24.015625,
      glyph_height: 14,
      lines: 1,
      rect: { x: 16, y: 14, width: 24.015625, height: 14 },
    },
  ]);
});

test("要素自身が文字を持つなら持ち主の path は空文字になる", async () => {
  const text = textNode("設定");
  rootWith([text], fontOf());
  const locator = fakeLocator(allResolved(), { childNodes: [text], rootTextStyle: fontOf() });
  const [trait] = await captureTraits([{ name: "toolbar.settings", locator }]);
  expect(trait.text_owners.map((o) => [o.path, o.tag, o.text])).toEqual([["", "button", "設定"]]);
});

test.each([
  ["空白だけの文字", () => textNode("  \n\t ")],
  [
    "矩形の幅が 0 の文字（display: none の中）",
    () => textNode("無", { x: 0, y: 0, width: 0, height: 14 }),
  ],
  ["矩形の高さが 0 の文字", () => textNode("無", { x: 0, y: 0, width: 10, height: 0 })],
])("%s は持ち主として数えない", async (_name, make) => {
  const visible = textNode("見");
  const hiddenText = make();
  const hidden = elementNode("span", [hiddenText], fontOf());
  const shown = elementNode("span", [visible], fontOf());
  const locator = fakeLocator(allResolved(), { childNodes: [hidden, shown] });
  rootWith([hidden, shown]);
  const [trait] = await captureTraits([{ name: "x", locator }]);
  expect(trait.text_owners.map((o) => [o.path, o.text])).toEqual([["span[1]", "見"]]);
});

test("visibility が visible でない要素の文字は数えない", async () => {
  const hidden = elementNode("span", [textNode("隠")], fontOf({ visibility: "hidden" }));
  const shown = elementNode("span", [textNode("見")], fontOf());
  const locator = fakeLocator(allResolved(), { childNodes: [hidden, shown] });
  rootWith([hidden, shown]);
  const [trait] = await captureTraits([{ name: "x", locator }]);
  expect(trait.text_owners.map((o) => o.text)).toEqual(["見"]);
});

test("同じ持ち主の文字は 1 行にまとめ、寸法は断片の合計、矩形はそれらを覆う範囲にする", async () => {
  const bold = elementNode(
    "b",
    [textNode("太", { x: 30, y: 10, width: 10, height: 14 })],
    fontOf({ "font-weight": "700" }),
  );
  const p = elementNode(
    "p",
    [
      textNode(" 前  ", { x: 10, y: 10, width: 20, height: 14 }),
      bold,
      textNode("後", { x: 40, y: 12, width: 15, height: 16 }),
    ],
    fontOf(),
  );
  const locator = fakeLocator(allResolved(), { childNodes: [p] });
  rootWith([p]);
  const [trait] = await captureTraits([{ name: "x", locator }]);
  expect(
    trait.text_owners.map((o) => [o.path, o.text, o.advance, o.glyph_height, o.lines, o.rect]),
  ).toEqual([
    ["p[0]", "前 後", 35, 16, 1, { x: 10, y: 10, width: 45, height: 18 }],
    ["p[0]>b[0]", "太", 10, 14, 1, { x: 30, y: 10, width: 10, height: 14 }],
  ]);
});

// 実ブラウザでは折り返した Text ノードの外接矩形が「1 行目の左端〜最終行の右端」まで広がる。
// 比較に使う寸法は行の断片から出し、外接矩形の幅を使わない。
test("折り返した文字の寸法は行の断片から出す（外接矩形の幅を使わない）", async () => {
  const text = textNode("長い説明文", { x: 0, y: 0, width: 100, height: 32 }, [
    { x: 0, y: 0, width: 100, height: 16 },
    { x: 0, y: 16, width: 30, height: 16 },
    { x: 30, y: 16, width: 0, height: 0 },
  ]);
  const span = elementNode("span", [text], fontOf());
  const locator = fakeLocator(allResolved(), { childNodes: [span] });
  rootWith([span]);
  const [trait] = await captureTraits([{ name: "x", locator }]);
  expect(trait.text_owners.map((o) => [o.advance, o.glyph_height, o.lines, o.rect.width])).toEqual([
    [130, 16, 2, 100],
  ]);
});

// フレームワークは 1 つの要素の文字を複数のテキストノードに分けることがある（React の <span>{count}件</span>）。
// ノードごとに trim して " " で繋ぐと "3 件" になり、1 ノードで描く側の "3件" と食い違って寸法の照合が省かれる。
test("同じ持ち主の文字が複数のテキストノードに分かれていても、1 ノードと同じ文字列・行数になる", async () => {
  const split = elementNode(
    "span",
    [
      textNode("3", { x: 0, y: 0, width: 8, height: 14 }),
      textNode("件", { x: 8, y: 0, width: 13, height: 14 }),
    ],
    fontOf(),
  );
  const spaced = elementNode(
    "em",
    [
      textNode("合計 ", { x: 0, y: 20, width: 30, height: 14 }),
      textNode("  ", { x: 30, y: 20, width: 4, height: 14 }),
      textNode("3", { x: 34, y: 20, width: 8, height: 14 }),
    ],
    fontOf(),
  );
  const locator = fakeLocator(allResolved(), { childNodes: [split, spaced] });
  rootWith([split, spaced]);
  const [trait] = await captureTraits([{ name: "x", locator }]);
  expect(trait.text_owners.map((o) => [o.text, o.lines])).toEqual([
    ["3件", 1],
    ["合計 3", 1],
  ]);
});

// 行の断片の高さは行送りではなく書体の高さなので、line-height を詰めると上下の行の断片が重なる
// （実測: 16px・line-height: 1 で断片の高さ 18、行送り 16）。重なりで数えると 3 行の折り返しが 1 行になる。
test("line-height を詰めて行の断片が縦に重なっても、折り返した行を数える", async () => {
  const text = textNode("長い説明文", { x: 0, y: 0, width: 100, height: 50 }, [
    { x: 0, y: 0, width: 100, height: 18 },
    { x: 0, y: 16, width: 100, height: 18 },
    { x: 0, y: 32, width: 40, height: 18 },
  ]);
  const span = elementNode("span", [text], fontOf());
  const locator = fakeLocator(allResolved(), { childNodes: [span] });
  rootWith([span]);
  const [trait] = await captureTraits([{ name: "x", locator }]);
  expect(trait.text_owners.map((o) => o.lines)).toEqual([3]);
});

// 視覚的に隠した文字（sr-only）は矩形の面積も visibility も通常の文字と同じなので、祖先の切り抜きで判定する。
// 数えると、現行の <span class="sr-only">閉じる</span> と新側の aria-label で見た目が同じでも件数差が出る。
test.each([
  ["1px の箱に overflow: hidden で閉じ込めた文字（sr-only）", { width: 1, height: 1 }, {}, []],
  [
    "clip: rect(0 0 0 0) の文字",
    { width: 100, height: 20 },
    { clip: "rect(0px, 0px, 0px, 0px)" },
    [],
  ],
  [
    "省略記号で切られた長い文字（見えている部分が残る）",
    { width: 80, height: 20 },
    {},
    ["長い説明"],
  ],
])("%s", async (_name, boxSize, clipStyle, expected) => {
  const text = textNode("長い説明", { x: 0, y: 0, width: 270, height: 17 });
  const box = elementNode(
    "span",
    [text],
    fontOf({ "overflow-x": "hidden", "overflow-y": "hidden", ...clipStyle }),
    {
      getBoundingClientRect: () => ({ x: 0, y: 0, ...boxSize }),
    },
  );
  const locator = fakeLocator(allResolved(), { childNodes: [box] });
  rootWith([box]);
  const [trait] = await captureTraits([{ name: "x", locator }]);
  expect(trait.text_owners.map((o) => o.text)).toEqual(expected);
});

// <input type=submit value="検索"> はテキストノードを持たずに文字を描く。数えないと <button>検索</button> への
// 置き換えで、見た目が同じでも件数の差が出る。
test("ボタンとして描く <input> の value を文字の持ち主として採る", async () => {
  const input = elementNode("input", [], fontOf(), {
    type: "submit",
    value: "検索",
    hasAttribute: (name) => name === "value",
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 60, height: 24 }),
  });
  const text = elementNode("input", [], fontOf(), {
    type: "text",
    value: "入力値",
    hasAttribute: (name) => name === "value",
    getBoundingClientRect: () => ({ x: 0, y: 30, width: 60, height: 24 }),
  });
  const locator = fakeLocator(allResolved(), { childNodes: [input, text] });
  rootWith([input, text]);
  const [trait] = await captureTraits([{ name: "x", locator }]);
  expect(
    trait.text_owners.map((o) => [o.path, o.tag, o.text, o.advance, o.glyph_height, o.lines]),
  ).toEqual([["input[0]", "input", "検索", 26, 15, 1]]);
});

// 文字列は空白を畳んで trim して比べるので、寸法も持ち主の端の空白を外して測る。外さないと、境目の空白が
// どちらの持ち主に付くかだけで幅が変わる（実測: <p>合計 <b>3件</b></p> と <p>合計<b> 3件</b></p>）。
test("持ち主の端の空白の幅は数えず、中の空白（空白だけのノードを含む）の幅は数える", async () => {
  const capture = async (nodes) => {
    const p = elementNode("p", nodes, fontOf());
    const locator = fakeLocator(allResolved(), { childNodes: [p] });
    rootWith([p]);
    const [trait] = await captureTraits([{ name: "x", locator }]);
    return trait.text_owners.map((o) => [o.text, o.advance]);
  };
  const b = (text, width, edges) =>
    elementNode(
      "b",
      [textNode(text, { x: 0, y: 0, width, height: 14 }, undefined, edges)],
      fontOf(),
    );
  // 境目の空白が p 側にある形と b 側にある形
  const trailing = await capture([
    textNode("合計 ", { x: 0, y: 0, width: 36, height: 14 }, undefined, { trail: 4 }),
    b("3件", 25),
  ]);
  const leading = await capture([
    textNode("合計", { x: 0, y: 0, width: 32, height: 14 }),
    b(" 3件", 29, { lead: 4 }),
  ]);
  expect(trailing).toEqual([
    ["合計", 32],
    ["3件", 25],
  ]);
  expect(leading).toEqual(trailing);
  // 空白だけのノードが中にある形は、1 ノードで描いた幅と同じになる
  const split = await capture([
    textNode("合計", { x: 0, y: 0, width: 32, height: 14 }),
    textNode(" ", { x: 32, y: 0, width: 4, height: 14 }, undefined, { lead: 4, trail: 4 }),
    textNode("3", { x: 36, y: 0, width: 9, height: 14 }),
  ]);
  expect(split).toEqual([["合計 3", 45]]);
});

// canvas は text-transform と letter-spacing を当てないので、描く側と同じ形へ寄せてから測る。
test("ボタンとして描く <input> の文字は text-transform と letter-spacing を当てて測る", async () => {
  const input = elementNode(
    "input",
    [],
    fontOf({ "text-transform": "uppercase", "letter-spacing": "1px" }),
    {
      type: "submit",
      value: "search",
      hasAttribute: (name) => name === "value",
      getBoundingClientRect: () => ({ x: 0, y: 0, width: 120, height: 24 }),
    },
  );
  const locator = fakeLocator(allResolved(), { childNodes: [input] });
  rootWith([input]);
  const [trait] = await captureTraits([{ name: "x", locator }]);
  expect(trait.text_owners.map((o) => [o.text, o.advance])).toEqual([
    ["search", 6 * 13 + 6 + 1000],
  ]);
});

// value 属性の無い submit / reset は、ブラウザが既定の文言を描くが DOM から読めない。
test("value 属性の無い submit は文字列を空にした行として数え、type=button は数えない", async () => {
  const box = () => ({ x: 0, y: 0, width: 60, height: 24 });
  const submit = elementNode("input", [], fontOf(), {
    type: "submit",
    value: "",
    hasAttribute: () => false,
    getBoundingClientRect: box,
  });
  const button = elementNode("input", [], fontOf(), {
    type: "button",
    value: "",
    hasAttribute: () => false,
    getBoundingClientRect: box,
  });
  const locator = fakeLocator(allResolved(), { childNodes: [submit, button] });
  rootWith([submit, button]);
  const [trait] = await captureTraits([{ name: "x", locator }]);
  expect(trait.text_owners.map((o) => [o.path, o.text])).toEqual([["input[0]", ""]]);
});

// 開いたシャドウルートは中を辿り、ライト DOM の子は <slot> に割り当てられた位置で数える（描かれる順）。
test("シャドウルートの中と slot に割り当てられた文字を、描かれる順に採る", async () => {
  const label = elementNode("span", [textNode("ラベル")], fontOf());
  const slot = elementNode("slot", [], fontOf(), { assignedNodes: () => [label] });
  const before = elementNode("b", [textNode("前")], fontOf({ "font-size": "20px" }));
  const after = elementNode("i", [textNode("後")], fontOf());
  const shadowRoot = { childNodes: [before, slot, after] };
  const locator = fakeLocator(allResolved(), { childNodes: [label], shadowRoot });
  const [trait] = await captureTraits([{ name: "x", locator }]);
  expect(trait.text_owners.map((o) => [o.path, o.text])).toEqual([
    ["#shadow-root>b[0]", "前"],
    ["#shadow-root>slot[1]>span[0]", "ラベル"],
    ["#shadow-root>i[2]", "後"],
  ]);
});

// slot に直接割り当てられた文字は、DOM の親（ホスト）ではなく平坦木の親（slot）から書体を継承する。
// 実測: シャドウ内の <button style="font-size:30px"><slot> に割り当てた文字を parentElement で採ると、ホストの 16px が記録された。
test("slot に割り当てられた文字の持ち主は、DOM の親ではなく slot になる", async () => {
  const label = textNode("ラベル");
  const slot = elementNode("slot", [], fontOf({ "font-size": "30px" }), {
    assignedNodes: () => [label],
  });
  const shadowRoot = { childNodes: [slot] };
  const locator = fakeLocator(allResolved(), {
    childNodes: [label],
    shadowRoot,
    rootTextStyle: fontOf({ "font-size": "16px" }),
  });
  rootWith([label], fontOf({ "font-size": "16px" }));
  const [trait] = await captureTraits([{ name: "x", locator }]);
  expect(trait.text_owners.map((o) => [o.path, o.tag, o.style["font-size"]])).toEqual([
    ["#shadow-root>slot[0]", "slot", "30px"],
  ]);
});

test("文字の持ち主で解決しないプロパティ名は空文字で通さず論理名付きで落ちる", async () => {
  const style = fontOf();
  delete style["line-height"];
  const span = elementNode("span", [textNode("設定")], style);
  const locator = fakeLocator(allResolved(), { childNodes: [span] });
  rootWith([span]);
  await expect(captureTraits([{ name: "toolbar.settings", locator }])).rejects.toThrow(
    /toolbar\.settings[\s\S]*computed style did not resolve for text owner[\s\S]*line-height/,
  );
});

test("文字が無ければ空配列になる（キーの欠落と区別する）", async () => {
  const [trait] = await captureTraits([{ name: "x", locator: fakeLocator(allResolved()) }]);
  expect(trait.text_owners).toEqual([]);
});
