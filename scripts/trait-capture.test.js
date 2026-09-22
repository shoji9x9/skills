// 静止画に写らない computed style を固定集合に入れ、解決しない名前で fail closed する回帰テスト（Issue #342）。
// 併せて、採った対象が「画面に描かれているもの」かの判定と子の inline style の記録（Issue #386）。

import { expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repoRoot, "skills/parity-suite/scripts/trait-capture.mjs");
const { FIXED_PROPERTIES, VERSION, captureTraits } = await import(script);

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
      };
      const previousStyle = globalThis.getComputedStyle;
      const previousLocation = globalThis.location;
      const previousDocument = globalThis.document;
      const previousScrollX = globalThis.scrollX;
      const previousScrollY = globalThis.scrollY;
      const previousInnerWidth = globalThis.innerWidth;
      const previousInnerHeight = globalThis.innerHeight;
      globalThis.getComputedStyle = (_element, pseudo) => ({
        content: pseudo ? pseudoContent : "normal",
        getPropertyValue: (prop) => (pseudo ? pseudoStyles : styles)[prop] ?? "",
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
  expect(VERSION).toBe("4");
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
