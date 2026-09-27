// 文字の持ち主（text_owners）の照合の回帰テスト（Issue #459）。
// 名前を付けた要素の計算値が一致していても、文字を描く子孫の書体・大きさの差を kind "text" で出すこと。

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

test("VERSION は 2（text_owners の照合を足した）", () => {
  expect(VERSION).toBe("2");
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
