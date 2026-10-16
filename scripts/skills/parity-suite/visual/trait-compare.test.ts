// 文字の持ち主（text_owners）の照合の回帰テスト（Issue #459）。
// 名前を付けた要素の計算値が一致していても、文字を描く子孫の書体・大きさの差を kind "text" で出すこと。
// スクロールするコンテナの特性（scroll）の照合（Issue #495）。

import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  Diff,
  Scroll,
  TextOwner,
  Trait as ComparedTrait,
} from "../../../../skills/parity-suite/scripts/trait-compare.mjs";
import { invalidInput } from "../../../lib/testing/test-input.ts";
import { makeTempDir } from "../../../lib/testing/test-tmpdir.ts";
import { parseJsonAs } from "../../../lib/parse-as.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const {
  VERSION,
  compareTraits,
}: typeof import("../../../../skills/parity-suite/scripts/trait-compare.mjs") = await import(
  join(repoRoot, "skills/parity-suite/scripts/trait-compare.mjs")
);

// 特性には、採取（trait-capture.mjs）が書き compareTraits は読まない child_inline_styles も持たせる。
type Trait = ComparedTrait & {
  child_inline_styles: { index: number; tag: string; style: string }[];
};

const font = (overrides: Record<string, string> = {}) => ({
  "font-family": "arial, sans-serif",
  "font-size": "13.3333px",
  "font-style": "normal",
  "font-weight": "400",
  "line-height": "normal",
  ...overrides,
});
const owner = (
  text: string,
  style: Record<string, string>,
  dims: Partial<TextOwner> = {},
  path = "",
): TextOwner => ({
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
const trait = (textOwners: TextOwner[] | undefined, name = "toolbar.settings"): Trait => ({
  name,
  computed: { "font-family": "arial, sans-serif", "font-size": "13.3333px" },
  before: null,
  after: null,
  rect: { x: 10, y: 10, width: 40, height: 24 },
  child_inline_styles: [],
  ...(textOwners === undefined ? {} : { text_owners: textOwners }),
});

test("VERSION は 4（CLI が入れ子の欄まで型どおりでない要素を exit 2 にする）", () => {
  expect(VERSION).toBe("4");
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
  expect(
    compareTraits([current], [replacement], { alignTolerance: 1 }).map((d: Diff) => d.prop),
  ).toEqual(props);
});

test("文字の高さの差も出す", () => {
  const current = trait([owner("設定", font(), { glyph_height: 14 })]);
  const replacement = trait([owner("設定", font(), { glyph_height: 17 })]);
  expect(compareTraits([current], [replacement]).map((d: Diff) => d.prop)).toEqual([
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

// スクロールするコンテナ（Issue #495）。値は Chrome 149 の実測: 628×298 のコンテナ・中身 628 幅で、スクロールバーが場所を取る撮影では
// 現行（overflow: auto）は縦横とも 15px、新側（overflow-x: hidden）は横のバーが出ない。
const scrollOf = (overrides: Partial<Scroll> = {}): Scroll => ({
  overflowing_x: true,
  overflowing_y: true,
  vertical_bar_px: 15,
  horizontal_bar_px: 15,
  style: { "scrollbar-width": "auto", "scrollbar-color": "auto", "scrollbar-gutter": "auto" },
  webkit: webkitOf(),
  ...overrides,
});
/** scrollOf の webkit（::-webkit-scrollbar 系を読めたブラウザの計算値）。 */
function webkitOf() {
  return {
    "::-webkit-scrollbar": { width: "auto", "background-color": "rgba(0, 0, 0, 0)" },
    "::-webkit-scrollbar-thumb": { width: "auto", "border-top-left-radius": "0px" },
  };
}
const grid = (scroll: Scroll | null): Trait => ({ ...trait([], "dialog.grid"), scroll });

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
  expect(diffs.map((d: Diff) => [d.kind, d.prop])).toEqual([["scroll", prop]]);
});

test("バーの幅の差は alignTolerance の内側なら出さない", () => {
  expect(compareTraits([grid(scrollOf())], [grid(scrollOf({ vertical_bar_px: 16 }))])).toEqual([]);
  expect(
    compareTraits([grid(scrollOf())], [grid(scrollOf({ vertical_bar_px: 17 }))]).map(
      (d: Diff) => d.prop,
    ),
  ).toEqual(["scroll/vertical_bar_px"]);
});

test("見た目の宣言と ::-webkit-scrollbar 系の計算値の差を、擬似要素ごとに出す", () => {
  const actual = scrollOf({
    style: { ...scrollOf().style, "scrollbar-width": "thin" },
    webkit: {
      ...webkitOf(),
      "::-webkit-scrollbar-thumb": { width: "auto", "border-top-left-radius": "4px" },
    },
  });
  const diffs = compareTraits([grid(scrollOf())], [grid(actual)]);
  expect(diffs.map((d: Diff) => [d.kind, d.prop, d.expected, d.actual])).toEqual([
    ["scroll", "scroll/scrollbar-width", "auto", "thin"],
    ["scroll", "scroll/::-webkit-scrollbar-thumb/border-top-left-radius", "0px", "4px"],
  ]);
});

test("コンテナかどうかの差（片側だけ null）を出す", () => {
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
  expect(compareTraits([grid(expected)], [grid(actual)]).map((d: Diff) => d.prop)).toEqual(props);
});

test("片側だけが scroll のキーを持つ（採取ツールの版違い）なら missing で出す", () => {
  const legacy = trait([], "dialog.grid");
  expect(compareTraits([grid(null)], [legacy])).toEqual([
    { name: "dialog.grid", kind: "missing", prop: "scroll", expected: "present", actual: "absent" },
  ]);
  expect(compareTraits([legacy], [legacy])).toEqual([]);
});

// --- 要素の計算値・擬似要素・論理名の照合 ---

test("要素の計算値の差を、プロパティ名の順に kind property で出す", () => {
  const current = { ...trait([]), computed: { color: "rgb(0, 0, 0)", "font-size": "12px" } };
  const replacement = {
    ...trait([]),
    computed: { "font-size": "13px", color: "rgb(0, 0, 0)", "line-height": "16px" },
  };
  expect(compareTraits([current], [replacement])).toEqual([
    {
      name: "toolbar.settings",
      kind: "property",
      prop: "font-size",
      expected: "12px",
      actual: "13px",
    },
    {
      name: "toolbar.settings",
      kind: "property",
      prop: "line-height",
      expected: "undefined",
      actual: "16px",
    },
  ]);
});

test("擬似要素は、生成コンテンツの有無の差と、両側にあるときの計算値の差を出す", () => {
  const current = {
    ...trait([]),
    before: { content: '"*"' },
    after: { content: '"›"', color: "red" },
  };
  const replacement = { ...trait([]), before: null, after: { content: '"›"', color: "blue" } };
  expect(compareTraits([current], [replacement])).toEqual([
    {
      name: "toolbar.settings",
      kind: "pseudo",
      prop: "::before",
      expected: "present",
      actual: "absent",
    },
    {
      name: "toolbar.settings",
      kind: "pseudo",
      prop: "::after/color",
      expected: "red",
      actual: "blue",
    },
  ]);
  // 両側とも生成コンテンツが無ければ差にしない
  expect(compareTraits([trait([])], [trait([])])).toEqual([]);
});

test("片側にしか無い論理名は、どちら側に無いかを kind missing で出す", () => {
  const diffs = compareTraits(
    [trait([], "toolbar.settings"), trait([], "toolbar.help")],
    [trait([], "toolbar.settings"), trait([], "toolbar.extra")],
  );
  expect(diffs.filter((d: Diff) => d.kind === "missing")).toEqual([
    { name: "toolbar.help", kind: "missing", expected: "present", actual: "absent" },
    { name: "toolbar.extra", kind: "missing", expected: "absent", actual: "present" },
  ]);
});

test("同じ論理名が片側に 2 件以上あれば、どちらの側かと件数を kind duplicate で出す", () => {
  const diffs = compareTraits([trait([]), trait([])], [trait([])]);
  expect(diffs.filter((d: Diff) => d.kind === "duplicate")).toEqual([
    { name: "toolbar.settings", kind: "duplicate", prop: "baseline", expected: "1", actual: "2" },
  ]);
  expect(
    compareTraits([trait([])], [trait([]), trait([]), trait([])]).filter(
      (d: Diff) => d.kind === "duplicate",
    ),
  ).toEqual([
    { name: "toolbar.settings", kind: "duplicate", prop: "capture", expected: "1", actual: "3" },
  ]);
});

// --- 相対幾何（要素対の関係だけを比べる） ---

type Box = { x: number; y: number; width: number; height: number };
const placed = (name: string, rect: Box): Trait => ({ ...trait([], name), rect });
const shift = (r: Box, dx: number, dy: number): Box => ({ ...r, x: r.x + dx, y: r.y + dy });
// 検索欄の右に、同じ高さの送信ボタンが並ぶ
const FIELD = { x: 0, y: 0, width: 100, height: 20 };
const SUBMIT = { x: 120, y: 0, width: 100, height: 20 };

test("ページ全体がずれても、要素同士の関係が同じなら差分にしない", () => {
  const current = [placed("search.field", FIELD), placed("search.submit", SUBMIT)];
  const replacement = [
    placed("search.field", shift(FIELD, 50, 30)),
    placed("search.submit", shift(SUBMIT, 50, 30)),
  ];
  expect(compareTraits(current, replacement)).toEqual([]);
});

test("要素対の左右・上下・端揃えの関係が変われば、変わった関係を kind geometry で出す", () => {
  const current = [placed("search.field", FIELD), placed("search.submit", SUBMIT)];
  // 送信ボタンが検索欄の右から真下へ回り込んだ
  const replacement = [
    placed("search.field", FIELD),
    placed("search.submit", { x: 0, y: 40, width: 100, height: 20 }),
  ];
  const pair = "search.field | search.submit";
  expect(compareTraits(current, replacement)).toEqual([
    { name: pair, kind: "geometry", prop: "horizontal", expected: "lt", actual: "eq" },
    { name: pair, kind: "geometry", prop: "vertical", expected: "eq", actual: "lt" },
    { name: pair, kind: "geometry", prop: "leftAligned", expected: "false", actual: "true" },
    { name: pair, kind: "geometry", prop: "rightAligned", expected: "false", actual: "true" },
    { name: pair, kind: "geometry", prop: "topAligned", expected: "true", actual: "false" },
    { name: pair, kind: "geometry", prop: "bottomAligned", expected: "true", actual: "false" },
  ]);
});

test("端揃えのずれが alignTolerance の内側なら関係は変わらない", () => {
  const current = [placed("search.field", FIELD), placed("search.submit", SUBMIT)];
  // 送信ボタンだけが 2px 下がった
  const replacement = [placed("search.field", FIELD), placed("search.submit", shift(SUBMIT, 0, 2))];
  expect(compareTraits(current, replacement, { alignTolerance: 2 })).toEqual([]);
  expect(
    compareTraits(current, replacement, { alignTolerance: 1 }).map((d: Diff) => d.prop),
  ).toEqual(["vertical", "topAligned", "bottomAligned"]);
});

const script = join(repoRoot, "skills/parity-suite/scripts/trait-compare.mjs");

/** CLI に 2 つの採取結果を渡して起動する。`extra` は 2 つのファイルの後ろに足す引数。 */
function runCli(baseline: unknown, capture: unknown, extra: string[] = []) {
  const dir = makeTempDir("trait-compare-");
  const files = [join(dir, "baseline.json"), join(dir, "capture.json")];
  writeFileSync(files[0], JSON.stringify(baseline));
  writeFileSync(files[1], JSON.stringify(capture));
  return spawnSync(process.execPath, [script, ...files, ...extra], { encoding: "utf8" });
}

test.each([
  ["baseline", [null], [trait([])], "baseline[0]"],
  ["capture", [trait([])], [null], "capture[0]"],
  ["capture の 2 件目", [trait([])], [trait([]), null], "capture[1]"],
])(
  "CLI は %s の要素が採取結果の形でなければ、その位置を出して比較せず exit 2",
  (_side, baseline, capture, at) => {
    const r = runCli(baseline, capture);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(`error: ${at} is not a trait entry`);
  },
);

test("CLI は入力が配列でなければ、配列にするよう求めて exit 2", () => {
  const r = runCli({}, [trait([])]);
  expect(r.status).toBe(2);
  expect(r.stderr).toContain("both inputs must be JSON arrays of trait entries");
});

// 比較が読む入れ子の欄も、型どおりかを確かめる（確かめずに Trait として渡すと、誤った値のまま計算が進む）。
test.each([
  ["computed の値が数", { ...trait([]), computed: { "font-size": 13 } }],
  ["rect の x が文字列", { ...trait([]), rect: { x: "10", y: 10, width: 40, height: 24 } }],
  ["text_owners の要素に text が無い", { ...trait([]), text_owners: [{ style: font() }] }],
  [
    "text_owners の要素の lines が文字列",
    { ...trait([]), text_owners: [{ ...owner("設定", font()), lines: "1" }] },
  ],
  [
    "scroll の webkit が unsupported でない文字列",
    { ...grid(null), scroll: { ...scrollOf(), webkit: "x" } },
  ],
  [
    "scroll の vertical_bar_px が文字列",
    { ...grid(null), scroll: { ...scrollOf(), vertical_bar_px: "15" } },
  ],
  // 採取は text_owners を必ず配列で、style を必ず書く。比較はこれらの欠けを許さない。
  ["text_owners が null", { ...trait([]), text_owners: null }],
  ["text_owners の要素に style が無い", { ...trait([]), text_owners: [{ text: "設定" }] }],
  ["scroll に style が無い", { ...grid(null), scroll: { ...scrollOf(), style: undefined } }],
])("CLI は入れ子の欄が型と違う要素（%s）を、比較せず exit 2", (_name, broken) => {
  const r = runCli([broken], [trait([])]);
  expect(r.status).toBe(2);
  expect(r.stderr).toContain("error: baseline[0] is not a trait entry");
});

test("CLI は入れ子まで型どおりの要素（文字の持ち主・スクロール・webkit が unsupported）を比較する", () => {
  const full = {
    ...grid(scrollOf({ webkit: "unsupported" })),
    text_owners: [owner("設定", font())],
  };
  const r = runCli([full], [full]);
  expect(r.status).toBe(0);
});

test("CLI は文字の寸法が null（採れなかった NaN）の要素を受け、差分に出して exit 1", () => {
  const measured = { ...trait([]), text_owners: [owner("設定", font())] };
  const unmeasured = { ...trait([]), text_owners: [owner("設定", font(), { glyph_height: null })] };
  const r = runCli([measured], [unmeasured]);
  expect(r.status).toBe(1);
  expect(JSON.parse(r.stdout)).toEqual([
    expect.objectContaining({ kind: "text", expected: "15", actual: "null" }),
  ]);
});

test("CLI は文字の高さが両側とも null なら、比べられないとして差分に出して exit 1", () => {
  const unmeasured = { ...trait([]), text_owners: [owner("設定", font(), { glyph_height: null })] };
  const r = runCli([unmeasured], [unmeasured]);
  expect(r.status).toBe(1);
  expect(JSON.parse(r.stdout)).toEqual([
    expect.objectContaining({ kind: "text", expected: "null", actual: "null" }),
  ]);
});

test.each([
  ["advance", { advance: null }],
  ["lines", { lines: null }],
])("CLI は文字の %s の null（採取が出さない形）を、比較せず exit 2", (_key, dims) => {
  const broken = {
    ...trait([]),
    text_owners: [owner("設定", font(), invalidInput<Partial<TextOwner>>(dims))],
  };
  const r = runCli([broken], [trait([])]);
  expect(r.status).toBe(2);
  expect(r.stderr).toContain("error: baseline[0] is not a trait entry");
});

test("CLI は rect の欠けた要素（旧スキーマ・手編集）を受け、欠けを差分に出して exit 1", () => {
  const { rect: _rect, ...legacy } = trait([]);
  const r = runCli([legacy], [trait([])]);
  expect(r.status).toBe(1);
  expect(JSON.parse(r.stdout)).toEqual([
    {
      name: "toolbar.settings",
      kind: "missing",
      prop: "rect",
      expected: "absent",
      actual: "present",
    },
  ]);
});

test("CLI は --align-tolerance の値で端揃えを比べる", () => {
  const field = { ...trait([], "search.field"), rect: { x: 0, y: 0, width: 100, height: 20 } };
  const submit = { ...trait([], "search.submit"), rect: { x: 120, y: 0, width: 100, height: 20 } };
  const lowered = { ...submit, rect: { ...submit.rect, y: 2 } };
  expect(runCli([field, submit], [field, lowered], ["--align-tolerance", "2"]).status).toBe(0);
  const r = runCli([field, submit], [field, lowered]);
  expect(r.status).toBe(1);
  expect(parseJsonAs<Diff[]>(r.stdout).map((d) => d.prop)).toEqual([
    "vertical",
    "topAligned",
    "bottomAligned",
  ]);
});

test.each([
  ["負の数", ["-1"]],
  ["数でない", ["abc"]],
  ["値が無い", []],
])("CLI は --align-tolerance が 0 以上の数でなければ（%s）、比較せず exit 2", (_label, value) => {
  const r = runCli([trait([])], [trait([])], ["--align-tolerance", ...value]);
  expect(r.status).toBe(2);
  expect(r.stderr).toContain("--align-tolerance must be a non-negative number");
});

test.each([
  ["ファイルが 1 つ", ["only.json"]],
  ["ファイルが 3 つ", ["a.json", "b.json", "c.json"]],
])("CLI は入力のファイルが 2 つでなければ（%s）、使い方を出して exit 2", (_label, files) => {
  const r = spawnSync(process.execPath, [script, ...files], { encoding: "utf8" });
  expect(r.status).toBe(2);
  expect(r.stderr).toContain("usage: node trait-compare.mjs");
});

test("CLI は入力を JSON として読めなければ、理由を出して exit 2", () => {
  const dir = makeTempDir("trait-compare-broken-");
  const broken = join(dir, "baseline.json");
  writeFileSync(broken, "{");
  const r = spawnSync(process.execPath, [script, broken, join(dir, "missing.json")], {
    encoding: "utf8",
  });
  expect(r.status).toBe(2);
  expect(r.stderr).toContain("error: cannot read inputs:");
});
