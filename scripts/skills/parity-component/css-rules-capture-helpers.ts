// css-rules-capture.test.ts が使うヘルパーと fixture。
import { assert } from "vitest";
import { isArray } from "../../lib/is-array.ts";
import {
  STATE_PSEUDO_CLASSES,
  STRUCTURAL_PSEUDO_CLASSES,
  collectMatchedRules,
  collectMatchedRulesInPage,
} from "../../../skills/parity-component/scripts/css-rules-capture.mjs";

// CSSOM の偽物の形（テストが組む範囲だけ）。
type FakeStyle = {
  length: number;
  getPropertyValue: (p: string) => string;
  getPropertyPriority: (p: string) => string;
  [index: number]: string;
};
type FakeRule = {
  selectorText?: string;
  style?: FakeStyle;
  cssRules?: FakeRule[];
  styleSheet?: FakeSheet | null;
  conditionText?: string;
  name?: string;
  keyText?: string;
  layerName?: string;
  media?: { mediaText: string };
  supportsText?: string;
  start?: string;
  end?: string | null;
  href?: string;
};
export type FakeSheet = { href: string | null; cssRules: FakeRule[] };
type FakeRoot = { styleSheets: FakeSheet[]; adoptedStyleSheets: FakeSheet[] };
type FakeElementOptions = {
  selectors?: Set<string>;
  adopted?: FakeSheet[];
  inline?: Record<string, string> | null;
  inlineImportant?: string[];
  shadowSheets?: FakeSheet[] | null;
  shadowAdopted?: FakeSheet[];
  hostSheets?: FakeSheet[] | null;
  slotSheets?: FakeSheet[] | null;
};
export type FakeElement = {
  ownerDocument: FakeRoot;
  getRootNode: () => FakeRoot;
  matches: (selector: string) => boolean;
  style: FakeStyle;
  shadowRoot?: FakeRoot;
  assignedSlot?: { getRootNode: () => FakeRoot };
};
// collectMatchedRules の結果と、そのうちの当たった規則 1 件。
type CaptureResult = ReturnType<typeof collectMatchedRules>;
export type Match = CaptureResult["matched"][number];
// 状態擬似クラスと構造擬似クラスの集合。ページへ渡す関数は両方を必須にするので、その型に合わせる。
type CaptureOptions = Parameters<typeof collectMatchedRulesInPage>[1];
// 採取を呼ぶ関数。テストは、モジュールの関数と、ページへ渡すソースから作った関数の両方を当てる。
export type Collect = (el: FakeElement, options: CaptureOptions) => CaptureResult;

/** 採取の結果の形か（collectMatchedRulesInPage は unknown を返すので、結果の型に絞る）。 */
function isCaptureResult(value: unknown): value is CaptureResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "matched" in value &&
    isArray(value.matched) &&
    "unresolved" in value &&
    isArray(value.unresolved) &&
    "counts" in value
  );
}

/**
 * ページへ渡すのと同じソースから作った関数で採る。ページ側の関数がヘルパーの一覧を通さずに互いを呼ぶと、
 * モジュールの関数として呼んだときはモジュールのスコープで名前が解決されて通るが、こちらでは名前が解決できずに失敗する。
 */
function collectFromSource(el: FakeElement, options: CaptureOptions): CaptureResult {
  const result = collectMatchedRulesInPage(el, options);
  assert(isCaptureResult(result), "ページへ渡す関数が採取の結果の形を返さない");
  return result;
}

// describe.each に渡す 2 通りの呼び方。モジュールの関数はカバレッジを記録するために、ソースから作った関数は
// ページ側の関数が互いをヘルパーの一覧を通して呼ぶ取り決めを確かめるために当てる。
export const COLLECTORS: [string, Collect][] = [
  ["モジュールの関数", collectMatchedRules],
  ["ページへ渡すソース", collectFromSource],
];

// CSSStyleDeclaration の最小実装（添字アクセス・length・getPropertyValue/Priority）。
export function decl(properties: Record<string, string>, important: string[] = []) {
  const names = Object.keys(properties);
  const style: FakeStyle = {
    length: names.length,
    getPropertyValue: (p) => properties[p] ?? "",
    getPropertyPriority: (p) => (important.includes(p) ? "important" : ""),
  };
  names.forEach((name, i) => {
    style[i] = name;
  });
  return style;
}

// 通常の規則。入れ子が無くても cssRules を持つ（実測）。
export const styleRule = (
  selectorText: string,
  properties: Record<string, string>,
  { important = [], children = [] }: { important?: string[]; children?: FakeRule[] } = {},
): FakeRule => ({
  selectorText,
  style: decl(properties, important),
  cssRules: children,
});
// @import は cssRules を持たない（実測）。styleSheet からしか辿れない。
export const importRule = (styleSheet: FakeSheet): FakeRule => ({ styleSheet });
const groupRule = (conditionText: string, cssRules: FakeRule[]): FakeRule => ({
  conditionText,
  cssRules,
});
const layerRule = (name: string, cssRules: FakeRule[]): FakeRule => ({ name, cssRules });
const keyframesRule = (name: string, keys: string[]): FakeRule => ({
  name,
  cssRules: keys.map((keyText) => ({ keyText })),
});

export const IMPORTED_HREF = "http://legacy.example/base.css";
export const MAIN_HREF = "http://legacy.example/main.css";

export function buildSheets(): FakeSheet[] {
  const imported: FakeSheet = {
    href: IMPORTED_HREF,
    cssRules: [
      styleRule(".marker-in-imported", { color: "rgb(1, 2, 3)" }),
      styleRule(".marker-in-imported:hover", { color: "rgb(4, 5, 6)" }, { important: ["color"] }),
    ],
  };
  const main = {
    href: MAIN_HREF,
    cssRules: [
      importRule(imported),
      styleRule(".plain-rule", { padding: "1px" }),
      styleRule(
        ".card",
        { color: "rgb(1, 1, 1)" },
        {
          children: [
            styleRule("&:hover", { color: "rgb(2, 2, 2)" }),
            styleRule("& .inner", { color: "rgb(3, 3, 3)" }),
          ],
        },
      ),
      groupRule("(min-width: 1px)", [styleRule(".in-media", { "border-width": "0px" })]),
      layerRule("base", [styleRule(".layered", { color: "rgb(6, 6, 6)" })]),
      keyframesRule("spin", ["0%", "100%"]),
      styleRule(".btn::after", { content: '"x"' }),
    ],
  };
  const crossOrigin = {
    href: "https://cdn.example/vendor.css",
    get cssRules(): FakeRule[] {
      const e = new Error("Cannot access rules");
      e.name = "SecurityError";
      throw e;
    },
  };
  return [main, crossOrigin];
}

// 要素は「当たるセレクタ（base 文字列）」の集合で表す。
// 期待する base 文字列をここに書き下ろすことで、剥がし方・`&` の解決結果まで固定される。
const ELEMENT_SELECTORS = new Set([
  ".marker-in-imported",
  ".plain-rule",
  ".card",
  ":is(.card)",
  ".in-media",
  ".layered",
  ".btn",
  "*",
]);

export function fakeElement(
  sheets: FakeSheet[],
  {
    selectors = ELEMENT_SELECTORS,
    adopted = [],
    inline = null,
    inlineImportant = [],
    shadowSheets = null,
    shadowAdopted = [],
    hostSheets = null,
    slotSheets = null,
  }: FakeElementOptions = {},
) {
  const ownerDocument: FakeRoot = { styleSheets: sheets, adoptedStyleSheets: adopted };
  const shadowRoot: FakeRoot | null = shadowSheets
    ? { styleSheets: shadowSheets, adoptedStyleSheets: shadowAdopted }
    : null;
  const el: FakeElement = {
    ownerDocument,
    getRootNode: () => shadowRoot || ownerDocument,
    matches: (selector: string) => selectors.has(selector.trim()),
    style: inline ? decl(inline, inlineImportant) : decl({}),
  };
  if (hostSheets) el.shadowRoot = { styleSheets: hostSheets, adoptedStyleSheets: [] };
  if (slotSheets) {
    const slotRoot: FakeRoot = { styleSheets: slotSheets, adoptedStyleSheets: [] };
    el.assignedSlot = { getRootNode: () => slotRoot };
  }
  return el;
}

export const findMatch = (result: CaptureResult, predicate: (m: Match) => boolean) =>
  result.matched.find(predicate);

/** 採れているはずの規則を取り出す。無ければテストを失敗させる。 */
export function requireMatch(result: CaptureResult, predicate: (m: Match) => boolean): Match {
  const found = findMatch(result, predicate);
  assert.exists(found, "条件に合う規則が採れていない");
  return found;
}

// --- 検出できることの確認: 素朴な走査が同じ入力で取りこぼすことを実証する ---

// Issue #326 が報告した 2 つの取りこぼし方をそのまま実装した走査。
export function naiveCollect(sheets: FakeSheet[]) {
  const selectors: string[] = [];
  const walk = (rules: FakeRule[]) => {
    for (const rule of rules) {
      // (a) @import を辿らない。(b) cssRules を持つものは中身だけを見る。
      if (rule.cssRules) walk(rule.cssRules);
      else if (rule.selectorText !== undefined) selectors.push(rule.selectorText);
    }
  };
  for (const sheet of sheets) {
    try {
      walk(sheet.cssRules);
    } catch {
      // 素朴な走査はクロスオリジンを警告なしに捨てる。
    }
  }
  return selectors;
}

export const OPTIONS = {
  statePseudoClasses: STATE_PSEUDO_CLASSES,
  structuralPseudoClasses: STRUCTURAL_PSEUDO_CLASSES,
};

// セレクタ文字列以外の判定結果を取り出す（selector / original_selector は綴りのまま残るので比べない）。
export const verdict = (result: CaptureResult) => ({
  matched: result.matched.map((m: Match) => [m.states, m.pseudo_element]),
  unresolved: result.unresolved.map((u: { reason: string }) => u.reason),
  counts: result.counts,
});

/** 渡した呼び方で採る、テストの共通の手順を作る。 */
export function bindCollect(collect: Collect) {
  const capture = (overrides?: FakeElementOptions) =>
    collect(fakeElement(buildSheets(), overrides), OPTIONS);

  // --- シャドウツリーの内と外 ---
  const shadowCapture = (overrides: FakeElementOptions & { sheets: FakeSheet[] }) =>
    collect(fakeElement(overrides.sheets, overrides), OPTIONS);

  // --- 自分の根にある ::part() / ::slotted()（Issue #354） ---
  // 1 つの根に 1 規則を置き、指定のスコープで採る。
  const captureOne = (selector: string, scope: string, selectors: string[]) => {
    const sheet: FakeSheet[] = [
      { href: MAIN_HREF, cssRules: [styleRule(selector, { color: "rgb(1, 1, 1)" })] },
    ];
    const empty: FakeSheet[] = [{ href: null, cssRules: [] }];
    const options = { selectors: new Set(selectors) };
    if (scope === "document") return collect(fakeElement(sheet, options), OPTIONS);
    if (scope === "host-target")
      return collect(fakeElement(sheet, { ...options, hostSheets: empty }), OPTIONS);
    if (scope === "outer") return shadowCapture({ ...options, sheets: sheet, shadowSheets: empty });
    if (scope === "host")
      return collect(fakeElement([], { ...options, hostSheets: sheet }), OPTIONS);
    if (scope === "slot")
      return collect(fakeElement([], { ...options, slotSheets: sheet }), OPTIONS);
    throw new Error(`unknown scope: ${scope}`);
  };
  return { capture, shadowCapture, captureOne };
}
