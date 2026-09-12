// 当たっている CSS 規則の採取が「取りこぼしても例外が出ない」経路で壊れないことの回帰テスト（Issue #326）。
//
// 検査するのは走査の検出能力そのものなので、素朴な走査（`if (rule.cssRules) 再帰; else 数える;`・
// @import を辿らない）を同じ入力に当てる**陽性コントロール**を同居させる。
// 素朴な走査が取りこぼすことまで確かめないと、この fixture が弁別できているのか
// （＝テストが赤くなりうるのか）が分からない。
//
// fixture の形は Chrome 149.0.7827.155 での実測に合わせてある:
//   - CSSImportRule は cssRules を持たず styleSheet を持つ
//   - CSSStyleRule は入れ子が無くても空の cssRules を持つ
//   - 入れ子の selectorText は `&` を保った形で返る
//   - クロスオリジンのスタイルシートは cssRules の参照で SecurityError を投げる

import { expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repoRoot, "skills/parity-component/scripts/css-rules-capture.mjs");
const { VERSION, STATE_PSEUDO_CLASSES, collectMatchedRules, captureMatchedRules } = await import(
  script
);

// CSSStyleDeclaration の最小実装（添字アクセス・length・getPropertyValue/Priority）。
function decl(properties, important = []) {
  const names = Object.keys(properties);
  const style = {
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
const styleRule = (selectorText, properties, { important = [], children = [] } = {}) => ({
  selectorText,
  style: decl(properties, important),
  cssRules: children,
});
// @import は cssRules を持たない（実測）。styleSheet からしか辿れない。
const importRule = (styleSheet) => ({ styleSheet });
const groupRule = (conditionText, cssRules) => ({ conditionText, cssRules });
const layerRule = (name, cssRules) => ({ name, cssRules });
const keyframesRule = (name, keys) => ({ name, cssRules: keys.map((keyText) => ({ keyText })) });

const IMPORTED_HREF = "http://legacy.example/base.css";
const MAIN_HREF = "http://legacy.example/main.css";

function buildSheets() {
  const imported = {
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
    get cssRules() {
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

function fakeElement(sheets, { selectors = ELEMENT_SELECTORS, adopted = [] } = {}) {
  const ownerDocument = { styleSheets: sheets, adoptedStyleSheets: adopted };
  const el = {
    ownerDocument,
    getRootNode: () => ownerDocument,
    matches: (selector) => selectors.has(selector.trim()),
  };
  return el;
}

const capture = (overrides) =>
  collectMatchedRules(fakeElement(buildSheets(), overrides), {
    statePseudoClasses: STATE_PSEUDO_CLASSES,
  });

const findMatch = (result, predicate) => result.matched.find(predicate);

// --- 陽性コントロール: 素朴な走査が同じ入力で取りこぼすことを実証する ---

// Issue #326 が報告した 2 つの壊れ方をそのまま実装した走査。
function naiveCollect(sheets) {
  const selectors = [];
  const walk = (rules) => {
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
      // 素朴な走査はクロスオリジンを黙って捨てる。
    }
  }
  return selectors;
}

test("陽性コントロール: 素朴な走査は @import の先を 1 件も見ない", () => {
  const seen = naiveCollect(buildSheets());
  expect(seen).not.toContain(".marker-in-imported");
  expect(seen).not.toContain(".marker-in-imported:hover");
});

test("陽性コントロール: 素朴な走査は空の cssRules を持つ通常の規則を数えない", () => {
  // `.plain-rule` は入れ子を持たないが cssRules（空）を持つため、素朴な走査では
  // 「グループ規則」と誤認されて中身（0 件）だけが見られる。
  const seen = naiveCollect(buildSheets());
  expect(seen).not.toContain(".plain-rule");
  // 素朴な走査が拾えるのは、cssRules を持たない形の規則だけになる。
  expect(seen.length).toBeLessThan(capture().counts.style_rules);
});

// --- 本体 ---

test("@import の先の規則を採る", () => {
  const result = capture();
  const hit = findMatch(
    result,
    (m) => m.selector === ".marker-in-imported" && m.states.length === 0,
  );
  expect(hit).toBeDefined();
  expect(hit.href).toBe(IMPORTED_HREF);
  expect(hit.declarations).toEqual([
    { property: "color", value: "rgb(1, 2, 3)", important: false },
  ]);
  expect(result.counts.import_rules).toBe(1);
});

test(":hover の宣言と !important を状態付きで採る（計算値では見えない側）", () => {
  const hit = findMatch(capture(), (m) => m.states.includes("hover") && m.href === IMPORTED_HREF);
  expect(hit).toBeDefined();
  expect(hit.selector).toBe(".marker-in-imported:hover");
  expect(hit.states).toEqual(["hover"]);
  expect(hit.declarations).toEqual([{ property: "color", value: "rgb(4, 5, 6)", important: true }]);
});

test("空の cssRules を持つ通常の規則を採る", () => {
  expect(findMatch(capture(), (m) => m.selector === ".plain-rule")).toBeDefined();
});

test("入れ子の & を親セレクタで解決して採る", () => {
  const hit = findMatch(capture(), (m) => m.original_selector === "&:hover");
  expect(hit).toBeDefined();
  expect(hit.selector).toBe(":is(.card):hover");
  expect(hit.states).toEqual(["hover"]);
});

test("入れ子でも当たらない規則は採らない（& の解決が素通しになっていない）", () => {
  // `& .inner` は `:is(.card) .inner` に解決され、対象要素には当たらない。
  // ここが素通りすると、`&` を無視して親の規則として数えていることになる。
  expect(findMatch(capture(), (m) => m.original_selector === "& .inner")).toBeUndefined();
});

test("条件・レイヤを規則に付けて採る", () => {
  const result = capture();
  expect(findMatch(result, (m) => m.selector === ".in-media").conditions).toEqual([
    "(min-width: 1px)",
  ]);
  expect(findMatch(result, (m) => m.selector === ".layered").layers).toEqual(["base"]);
});

test("@keyframes をレイヤとして数えない", () => {
  for (const m of capture().matched) expect(m.layers).not.toContain("spin");
});

test("擬似要素の規則を擬似要素として採る", () => {
  const hit = findMatch(capture(), (m) => m.pseudo_element !== null);
  expect(hit.selector).toBe(".btn::after");
  expect(hit.pseudo_element).toBe("::after");
});

test("読めないスタイルシートを黙って捨てず inaccessible に残す", () => {
  const result = capture();
  expect(result.inaccessible).toEqual([
    { href: "https://cdn.example/vendor.css", error: "SecurityError" },
  ]);
});

test(":is() の中の状態は判定せず unresolved に回す", () => {
  const sheets = [
    { href: MAIN_HREF, cssRules: [styleRule(".card:is(:hover, .forced)", { color: "red" })] },
  ];
  const result = collectMatchedRules(fakeElement(sheets), {
    statePseudoClasses: STATE_PSEUDO_CLASSES,
  });
  expect(result.matched).toHaveLength(0);
  expect(result.unresolved).toEqual([
    {
      selector: ".card:is(:hover, .forced)",
      original_selector: ".card:is(:hover, .forced)",
      href: MAIN_HREF,
      reason: "state-inside-functional-pseudo",
    },
  ]);
});

test("matches() が throw するセレクタを unresolved に残す", () => {
  const sheets = [{ href: MAIN_HREF, cssRules: [styleRule(":bogus-pseudo", { color: "red" })] }];
  const el = fakeElement(sheets);
  el.matches = () => {
    const e = new Error("bad selector");
    e.name = "SyntaxError";
    throw e;
  };
  const result = collectMatchedRules(el, { statePseudoClasses: STATE_PSEUDO_CLASSES });
  expect(result.unresolved).toHaveLength(1);
  expect(result.unresolved[0].reason).toBe("matches-threw:SyntaxError");
});

test("状態だけのセレクタは全称に倒して判定する", () => {
  const sheets = [{ href: MAIN_HREF, cssRules: [styleRule(":hover", { cursor: "pointer" })] }];
  const result = collectMatchedRules(fakeElement(sheets), {
    statePseudoClasses: STATE_PSEUDO_CLASSES,
  });
  expect(result.matched).toHaveLength(1);
  expect(result.matched[0].states).toEqual(["hover"]);
});

test("同じスタイルシートを 2 度辿らない（@import の循環で止まらない）", () => {
  const a = { href: "http://legacy.example/a.css", cssRules: [] };
  const b = { href: "http://legacy.example/b.css", cssRules: [importRule(a)] };
  a.cssRules = [importRule(b), styleRule(".plain-rule", { padding: "1px" })];
  const result = collectMatchedRules(fakeElement([a]), {
    statePseudoClasses: STATE_PSEUDO_CLASSES,
  });
  expect(result.counts.sheets).toBe(2);
  expect(findMatch(result, (m) => m.selector === ".plain-rule")).toBeDefined();
});

test("adoptedStyleSheets も走査する", () => {
  const adopted = [{ href: null, cssRules: [styleRule(".plain-rule", { padding: "2px" })] }];
  const result = collectMatchedRules(fakeElement([], { adopted }), {
    statePseudoClasses: STATE_PSEUDO_CLASSES,
  });
  expect(findMatch(result, (m) => m.selector === ".plain-rule")).toBeDefined();
});

test("入れ子の途中に現れた裸の宣言（CSSNestedDeclarations）を黙って落とさない", () => {
  // `.card { color: red; & .inner { … } background: blue; }` の `background` は Chrome 130+ で
  // CSSNestedDeclarations として返る。selectorText も cssRules も持たないため、
  // 分岐を足さないと matched / unresolved / counts のどこにも残らず静かに消える。
  const nestedDeclarations = { style: decl({ background: "rgb(7, 7, 7)" }) };
  const sheets = [
    {
      href: MAIN_HREF,
      cssRules: [
        styleRule(
          ".card",
          { color: "rgb(1, 1, 1)" },
          { children: [styleRule("& .inner", { color: "rgb(3, 3, 3)" }), nestedDeclarations] },
        ),
      ],
    },
  ];
  const result = collectMatchedRules(fakeElement(sheets), {
    statePseudoClasses: STATE_PSEUDO_CLASSES,
  });
  const hit = findMatch(result, (m) =>
    m.declarations.some((d) => d.property === "background" && d.value === "rgb(7, 7, 7)"),
  );
  expect(hit).toBeDefined();
  expect(hit.selector).toBe(".card"); // 適用先は囲っている規則のセレクタ
  expect(result.counts.nested_declaration_rules).toBe(1);
});

test("@import の layer() とメディア条件を読み込んだ規則へ引き継ぐ", () => {
  // layerName / media は CSSImportRule 側にしか無い。引き継がないと、読み込んだ規則が
  // 「レイヤ無し・無条件」として記録される（落ちるのではなく誤った条件が付く）。
  const imported = {
    href: IMPORTED_HREF,
    cssRules: [styleRule(".plain-rule", { padding: "1px" })],
  };
  const sheets = [
    {
      href: MAIN_HREF,
      cssRules: [{ styleSheet: imported, layerName: "vendor", media: { mediaText: "screen" } }],
    },
  ];
  const result = collectMatchedRules(fakeElement(sheets), {
    statePseudoClasses: STATE_PSEUDO_CLASSES,
  });
  const hit = findMatch(result, (m) => m.selector === ".plain-rule");
  expect(hit).toBeDefined();
  expect(hit.layers).toEqual(["vendor"]);
  expect(hit.conditions).toEqual(["screen"]);
});

test("layer()・media の無い @import には条件を足さない", () => {
  const hit = findMatch(capture(), (m) => m.selector === ".marker-in-imported");
  expect(hit.layers).toEqual([]);
  expect(hit.conditions).toEqual([]);
});

test("captureMatchedRules は論理名とツール版を付けて返す", async () => {
  const el = fakeElement(buildSheets());
  const locator = { evaluate: (fn, options) => Promise.resolve(fn(el, options)) };
  const [captured] = await captureMatchedRules([{ name: "button.primary", locator }]);
  expect(captured.name).toBe("button.primary");
  expect(captured.tool_version).toBe(VERSION);
  expect(captured.matched.length).toBeGreaterThan(0);
});

test("属性セレクタの中の & を入れ子セレクタとして置換しない", () => {
  // `& [data-label="A&B"]` の引用符内の & まで置換すると、属性値に :is(...) が入った
  // 不正なセレクタになる。matches() は throw せず false を返すので静かに落ちる。
  const child = styleRule('& [data-label="A&B"]', { color: "red" });
  const parent = styleRule(".card", { color: "blue" }, { children: [child] });
  const sheets = [{ href: MAIN_HREF, cssRules: [parent] }];
  const el = fakeElement(sheets, {
    selectors: new Set([".card", ':is(.card) [data-label="A&B"]']),
  });
  const result = collectMatchedRules(el, { statePseudoClasses: STATE_PSEUDO_CLASSES });
  const hit = result.matched.find((m) => m.original_selector === '& [data-label="A&B"]');
  expect(hit).toBeDefined();
  expect(hit.selector).toBe(':is(.card) [data-label="A&B"]');
});

test("@scope の中の規則はスコープを評価せず unresolved に残す", () => {
  // セレクタだけを見ると当たるが、スコープ根の外では適用されない。
  // 当たった側へ倒すと、その部品には効いていない規則を根拠として出すことになる。
  const scopeRule = {
    start: "(.dialog)",
    end: null,
    cssRules: [styleRule(".plain-rule", { padding: "9px" })],
  };
  const sheets = [{ href: MAIN_HREF, cssRules: [scopeRule] }];
  const result = collectMatchedRules(fakeElement(sheets), {
    statePseudoClasses: STATE_PSEUDO_CLASSES,
  });
  expect(result.matched).toHaveLength(0);
  expect(result.unresolved).toHaveLength(1);
  expect(result.unresolved[0].reason).toBe("scope-not-evaluated:(.dialog)");
});
