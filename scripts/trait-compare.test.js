// 文字の持ち主（text_owners）の照合の回帰テスト（Issue #459）。
// 名前を付けた要素の計算値が一致していても、文字を描く子孫の書体・大きさの差を kind "text" で出すこと。
// スクロールする器の特性（scroll）の照合（Issue #495）。

import { expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const { VERSION, compareTraits } = await import(
  join(repoRoot, "skills/parity-suite/scripts/trait-compare.mjs")
);

const font = (overrides = {}) => ({
  "font-family": "arial, sans-serif",
  "font-size": "13.3333px",
  "font-style": "normal",
  "font-weight": "400",
  "line-height": "normal",
  ...overrides,
});
const owner = (text, style, dims = {}, path = "") => ({
  path,
  tag: path === "" ? "button" : "span",
  text,
  style,
  advance: 26.65625,
  glyph_height: 15,
  lines: 1,
  rect: { x: 16, y: 14, width: 26.65625, height: 15 },
  ...dims,
});
const trait = (textOwners, name = "toolbar.settings") => ({
  name,
  computed: { "font-family": "arial, sans-serif", "font-size": "13.3333px" },
  before: null,
  after: null,
  rect: { x: 10, y: 10, width: 40, height: 24 },
  child_inline_styles: [],
  ...(textOwners === undefined ? {} : { text_owners: textOwners }),
});

test("VERSION は 3（scroll の照合を足した）", () => {
  expect(VERSION).toBe("3");
});

// 実測（Chrome 149）: 現行 <button><div><span>設定</span></div></button> と新側 <button>設定</button>。
// 要素自身の計算値は一致し、文字の持ち主だけが違った。
test("要素の計算値が一致していても、文字を描く子孫の書体・大きさ・幅の差を出す", () => {
  const current = trait([
    owner(
      "設定",
      font({ "font-family": "Roboto, sans-serif", "font-size": "12px" }),
      { advance: 24.015625, glyph_height: 14 },
      "div[0]>span[0]",
    ),
  ]);
  const replacement = trait([owner("設定", font())]);

  expect(compareTraits([current], [replacement])).toEqual([
    {
      name: "toolbar.settings",
      kind: "text",
      prop: "text[0]/font-family",
      expected: "Roboto, sans-serif",
      actual: "arial, sans-serif",
      text: "設定",
    },
    {
      name: "toolbar.settings",
      kind: "text",
      prop: "text[0]/font-size",
      expected: "12px",
      actual: "13.3333px",
      text: "設定",
    },
    {
      name: "toolbar.settings",
      kind: "text",
      prop: "text[0]/advance",
      expected: "24.015625",
      actual: "26.65625",
      text: "設定",
    },
  ]);
});

test("入れ子の深さ（path）と外接矩形だけが違い、書体・寸法が同じなら差分にしない", () => {
  const current = trait([
    owner("設定", font(), { rect: { x: 0, y: 0, width: 90, height: 40 } }, "div[0]>span[0]"),
  ]);
  const replacement = trait([owner("設定", font())]);
  expect(compareTraits([current], [replacement])).toEqual([]);
});

test.each([
  ["許容誤差ちょうど", 1, []],
  ["許容誤差を超える", 1.01, ["text[0]/advance"]],
])("文字の幅の合計は alignTolerance で比べる（%s）", (_name, delta, props) => {
  const current = trait([owner("設定", font(), { advance: 26 })]);
  const replacement = trait([owner("設定", font(), { advance: 26 + delta })]);
  expect(compareTraits([current], [replacement], { alignTolerance: 1 }).map((d) => d.prop)).toEqual(
    props,
  );
});

test("文字の高さの差も出す", () => {
  const current = trait([owner("設定", font(), { glyph_height: 14 })]);
  const replacement = trait([owner("設定", font(), { glyph_height: 17 })]);
  expect(compareTraits([current], [replacement]).map((d) => d.prop)).toEqual([
    "text[0]/glyph_height",
  ]);
});

test("折り返しの行数が違えば行数の差だけを出し、幅の合計は比べない", () => {
  const current = trait([owner("長い説明文", font(), { lines: 1, advance: 130 })]);
  const replacement = trait([owner("長い説明文", font(), { lines: 2, advance: 150 })]);
  expect(compareTraits([current], [replacement])).toEqual([
    {
      name: "toolbar.settings",
      kind: "text",
      prop: "text[0]/lines",
      expected: "1",
      actual: "2",
      text: "長い説明文",
    },
  ]);
});

test("文字列が違う組は寸法を比べず、書体の差だけを出す", () => {
  const current = trait([owner("設定", font(), { advance: 26 })]);
  const replacement = trait([
    owner("環境設定", font({ "font-weight": "700" }), { advance: 52, lines: 2 }),
  ]);
  expect(compareTraits([current], [replacement])).toEqual([
    {
      name: "toolbar.settings",
      kind: "text",
      prop: "text[0]/font-weight",
      expected: "400",
      actual: "700",
      text: "設定",
    },
  ]);
});

test.each([
  [
    "新側に足りない",
    [owner("前", font()), owner("後", font())],
    [owner("前", font())],
    { prop: "text[1]", expected: "present", actual: "absent", text: "後" },
  ],
  [
    "新側に余分",
    [owner("前", font())],
    [owner("前", font()), owner("余", font())],
    { prop: "text[1]", expected: "absent", actual: "present", text: "余" },
  ],
])("文字の持ち主の件数が違えば、はみ出した行を出す（%s）", (_name, base, cap, diff) => {
  expect(compareTraits([trait(base)], [trait(cap)])).toEqual([
    { name: "toolbar.settings", kind: "text", ...diff },
  ]);
});

test.each([
  ["ベースラインだけが持つ", [], undefined, "present", "absent"],
  ["採取だけが持つ", undefined, [], "absent", "present"],
])(
  "text_owners を片側だけが持つ（採取ツールの版違い）なら missing で出す（%s）",
  (_n, b, c, e, a) => {
    expect(compareTraits([trait(b)], [trait(c)])).toEqual([
      { name: "toolbar.settings", kind: "missing", prop: "text_owners", expected: e, actual: a },
    ]);
  },
);

test("両側とも text_owners を持たない（旧版どうし）なら文字の照合はしない", () => {
  expect(compareTraits([trait(undefined)], [trait(undefined)])).toEqual([]);
});

// スクロールする器（Issue #495）。値は Chrome 149 の実測: 628×298 の器・中身 628 幅で、スクロールバーが場所を取る撮影では
// 現行（overflow: auto）は縦横とも 15px、新側（overflow-x: hidden）は横のバーが出ない。
const scrollOf = (overrides = {}) => ({
  overflowing_x: true,
  overflowing_y: true,
  vertical_bar_px: 15,
  horizontal_bar_px: 15,
  style: { "scrollbar-width": "auto", "scrollbar-color": "auto", "scrollbar-gutter": "auto" },
  webkit: {
    "::-webkit-scrollbar": { width: "auto", "background-color": "rgba(0, 0, 0, 0)" },
    "::-webkit-scrollbar-thumb": { width: "auto", "border-top-left-radius": "0px" },
  },
  ...overrides,
});
const grid = (scroll) => ({ ...trait([], "dialog.grid"), scroll });

test("横のバーが出るか出ないかの差を kind scroll で出す", () => {
  const diffs = compareTraits([grid(scrollOf())], [grid(scrollOf({ horizontal_bar_px: 0 }))]);
  expect(diffs).toEqual([
    {
      name: "dialog.grid",
      kind: "scroll",
      prop: "scroll/horizontal_bar_px",
      expected: "15",
      actual: "0",
    },
  ]);
});

test.each([
  ["縦のバーの幅", { vertical_bar_px: 0 }, "scroll/vertical_bar_px"],
  ["横のはみ出し", { overflowing_x: false }, "scroll/overflowing_x"],
  ["縦のはみ出し", { overflowing_y: false }, "scroll/overflowing_y"],
])("%s の差を出す", (_label, override, prop) => {
  const diffs = compareTraits([grid(scrollOf())], [grid(scrollOf(override))]);
  expect(diffs.map((d) => [d.kind, d.prop])).toEqual([["scroll", prop]]);
});

test("バーの幅の差は alignTolerance の内側なら出さない", () => {
  expect(compareTraits([grid(scrollOf())], [grid(scrollOf({ vertical_bar_px: 16 }))])).toEqual([]);
  expect(
    compareTraits([grid(scrollOf())], [grid(scrollOf({ vertical_bar_px: 17 }))]).map((d) => d.prop),
  ).toEqual(["scroll/vertical_bar_px"]);
});

test("見た目の宣言と ::-webkit-scrollbar 系の計算値の差を、擬似要素ごとに出す", () => {
  const actual = scrollOf({
    style: { ...scrollOf().style, "scrollbar-width": "thin" },
    webkit: {
      ...scrollOf().webkit,
      "::-webkit-scrollbar-thumb": { width: "auto", "border-top-left-radius": "4px" },
    },
  });
  const diffs = compareTraits([grid(scrollOf())], [grid(actual)]);
  expect(diffs.map((d) => [d.kind, d.prop, d.expected, d.actual])).toEqual([
    ["scroll", "scroll/scrollbar-width", "auto", "thin"],
    ["scroll", "scroll/::-webkit-scrollbar-thumb/border-top-left-radius", "0px", "4px"],
  ]);
});

test("器かどうかの差（片側だけ null）を出す", () => {
  expect(compareTraits([grid(scrollOf())], [grid(null)])).toEqual([
    { name: "dialog.grid", kind: "scroll", prop: "scroll", expected: "present", actual: "absent" },
  ]);
  expect(compareTraits([grid(null)], [grid(null)])).toEqual([]);
});

test.each([
  ["片側だけ unsupported", scrollOf(), scrollOf({ webkit: "unsupported" }), ["scroll/webkit"]],
  [
    "両側 unsupported",
    scrollOf({ webkit: "unsupported" }),
    scrollOf({ webkit: "unsupported" }),
    [],
  ],
])("::-webkit-scrollbar を読めない側がある（%s）", (_label, expected, actual, props) => {
  expect(compareTraits([grid(expected)], [grid(actual)]).map((d) => d.prop)).toEqual(props);
});

test("片側だけが scroll のキーを持つ（採取ツールの版違い）なら missing で出す", () => {
  const legacy = trait([], "dialog.grid");
  expect(compareTraits([grid(null)], [legacy])).toEqual([
    { name: "dialog.grid", kind: "missing", prop: "scroll", expected: "present", actual: "absent" },
  ]);
  expect(compareTraits([legacy], [legacy])).toEqual([]);
});
