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
const {
  VERSION,
  STATE_PSEUDO_CLASSES,
  STRUCTURAL_PSEUDO_CLASSES,
  collectMatchedRules,
  captureMatchedRules,
} = await import(script);

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

function fakeElement(
  sheets,
  {
    selectors = ELEMENT_SELECTORS,
    adopted = [],
    inline = null,
    inlineImportant = [],
    shadowSheets = null,
    shadowAdopted = [],
    hostSheets = null,
    slotSheets = null,
  } = {},
) {
  const ownerDocument = { styleSheets: sheets, adoptedStyleSheets: adopted };
  const shadowRoot = shadowSheets
    ? { styleSheets: shadowSheets, adoptedStyleSheets: shadowAdopted }
    : null;
  const el = {
    ownerDocument,
    getRootNode: () => shadowRoot || ownerDocument,
    matches: (selector) => selectors.has(selector.trim()),
    style: inline ? decl(inline, inlineImportant) : decl({}),
  };
  if (hostSheets) el.shadowRoot = { styleSheets: hostSheets, adoptedStyleSheets: [] };
  if (slotSheets) {
    const slotRoot = { styleSheets: slotSheets, adoptedStyleSheets: [] };
    el.assignedSlot = { getRootNode: () => slotRoot };
  }
  return el;
}

const capture = (overrides) =>
  collectMatchedRules(fakeElement(buildSheets(), overrides), {
    statePseudoClasses: STATE_PSEUDO_CLASSES,
    structuralPseudoClasses: STRUCTURAL_PSEUDO_CLASSES,
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
    structuralPseudoClasses: STRUCTURAL_PSEUDO_CLASSES,
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
  const sheets = [{ href: MAIN_HREF, cssRules: [styleRule(".plain-rule", { color: "red" })] }];
  const el = fakeElement(sheets);
  el.matches = () => {
    const e = new Error("bad selector");
    e.name = "SyntaxError";
    throw e;
  };
  const result = collectMatchedRules(el, {
    statePseudoClasses: STATE_PSEUDO_CLASSES,
    structuralPseudoClasses: STRUCTURAL_PSEUDO_CLASSES,
  });
  expect(result.unresolved).toHaveLength(1);
  expect(result.unresolved[0].reason).toBe("matches-threw:SyntaxError");
});

test("状態だけのセレクタは全称に倒して判定する", () => {
  const sheets = [{ href: MAIN_HREF, cssRules: [styleRule(":hover", { cursor: "pointer" })] }];
  const result = collectMatchedRules(fakeElement(sheets), {
    statePseudoClasses: STATE_PSEUDO_CLASSES,
    structuralPseudoClasses: STRUCTURAL_PSEUDO_CLASSES,
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
    structuralPseudoClasses: STRUCTURAL_PSEUDO_CLASSES,
  });
  expect(result.counts.sheets).toBe(2);
  expect(findMatch(result, (m) => m.selector === ".plain-rule")).toBeDefined();
});

test("adoptedStyleSheets も走査する", () => {
  const adopted = [{ href: null, cssRules: [styleRule(".plain-rule", { padding: "2px" })] }];
  const result = collectMatchedRules(fakeElement([], { adopted }), {
    statePseudoClasses: STATE_PSEUDO_CLASSES,
    structuralPseudoClasses: STRUCTURAL_PSEUDO_CLASSES,
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
    structuralPseudoClasses: STRUCTURAL_PSEUDO_CLASSES,
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
    structuralPseudoClasses: STRUCTURAL_PSEUDO_CLASSES,
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
  const result = collectMatchedRules(el, {
    statePseudoClasses: STATE_PSEUDO_CLASSES,
    structuralPseudoClasses: STRUCTURAL_PSEUDO_CLASSES,
  });
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
    structuralPseudoClasses: STRUCTURAL_PSEUDO_CLASSES,
  });
  expect(result.matched).toHaveLength(0);
  expect(result.unresolved).toHaveLength(1);
  expect(result.unresolved[0].reason).toBe("scope-not-evaluated:(.dialog)");
});

test("エスケープされた区切り文字でセレクタを分割しない", () => {
  // `.foo\,bar` は 1 つのクラスセレクタ。エスケープを飛ばさずに分割すると
  // 断片が無効セレクタになり、当たるはずの規則が静かに落ちる。
  const sheets = [{ href: MAIN_HREF, cssRules: [styleRule(".foo\\,bar", { color: "red" })] }];
  const el = fakeElement(sheets, { selectors: new Set([".foo\\,bar"]) });
  const result = collectMatchedRules(el, {
    statePseudoClasses: STATE_PSEUDO_CLASSES,
    structuralPseudoClasses: STRUCTURAL_PSEUDO_CLASSES,
  });
  expect(result.matched).toHaveLength(1);
  expect(result.matched[0].selector).toBe(".foo\\,bar");
});

test("知らない動的擬似クラスを黙って落とさず unresolved に残す", () => {
  // `:popover-open` / `:user-valid` / `:fullscreen` を知らないまま base に残すと、
  // その状態でない要素に matches() が false を返し、当たるはずの規則が記録も警告も無く消える。
  const sheets = [
    { href: MAIN_HREF, cssRules: [styleRule(".plain-rule:popover-open", { color: "red" })] },
  ];
  const result = collectMatchedRules(fakeElement(sheets), {
    statePseudoClasses: STATE_PSEUDO_CLASSES,
    structuralPseudoClasses: STRUCTURAL_PSEUDO_CLASSES,
  });
  expect(result.matched).toHaveLength(0);
  expect(result.unresolved).toHaveLength(1);
  expect(result.unresolved[0].reason).toBe("unknown-pseudo-class:popover-open");
});

test("@import の supports() 条件を引き継ぐ", () => {
  const imported = {
    href: IMPORTED_HREF,
    cssRules: [styleRule(".plain-rule", { padding: "4px" })],
  };
  const main = {
    href: MAIN_HREF,
    cssRules: [
      { styleSheet: imported, supportsText: "display: grid", media: { mediaText: "screen" } },
    ],
  };
  const result = collectMatchedRules(fakeElement([main]), {
    statePseudoClasses: STATE_PSEUDO_CLASSES,
    structuralPseudoClasses: STRUCTURAL_PSEUDO_CLASSES,
  });
  expect(result.matched).toHaveLength(1);
  expect(result.matched[0].conditions).toEqual(["supports(display: grid)", "screen"]);
});

// --- style 属性（インライン宣言） ---

test("style 属性の宣言を別の出所として採る", () => {
  // インスタンス固有の値が style 属性で来ている部品では、規則走査だけだと出所も
  // !important の優先度も残らず、計算後スタイルの結果値しか手掛かりが無くなる。
  const el = fakeElement(buildSheets(), {
    inline: { width: "240px", color: "rgb(9, 9, 9)" },
    inlineImportant: ["color"],
  });
  const result = collectMatchedRules(el, {
    statePseudoClasses: STATE_PSEUDO_CLASSES,
    structuralPseudoClasses: STRUCTURAL_PSEUDO_CLASSES,
  });
  expect(result.inline_declarations).toEqual([
    { property: "width", value: "240px", important: false },
    { property: "color", value: "rgb(9, 9, 9)", important: true },
  ]);
  expect(result.counts.inline_declarations).toBe(2);
  // 規則ではないので matched へ混ぜない（セレクタの根拠と取り違える）。
  expect(result.matched.every((m) => m.selector !== undefined)).toBe(true);
});

test("style 属性が空でも inline_declarations を空配列で出す", () => {
  // キーごと落とすと「インライン指定が無い」と「採っていない（旧版の採取物）」が
  // 同じ形になり、再採取の要否を判定できない。
  const result = capture();
  expect(result.inline_declarations).toEqual([]);
  expect(result.counts.inline_declarations).toBe(0);
});

// --- 関数擬似クラスの引数の釣り合い ---

// 素朴な括弧勘定（引用符・角括弧を見ない）。修正前の実装と同じ数え方。
function naiveArgEnd(selector, open) {
  let d = 1;
  let j = open + 1;
  while (j < selector.length && d > 0) {
    if (selector[j] === "(") d++;
    else if (selector[j] === ")") d--;
    j++;
  }
  return j;
}

const TRICKY_SELECTOR = '.button:has([data-label="("]):hover';

test("陽性コントロール: 素朴な括弧勘定は引用符内の ( で :hover まで食う", () => {
  const open = TRICKY_SELECTOR.indexOf("(");
  expect(naiveArgEnd(TRICKY_SELECTOR, open)).toBe(TRICKY_SELECTOR.length);
});

test("引用符・角括弧を跨ぐ関数引数でも状態擬似クラスを剥がす", () => {
  const base = '.button:has([data-label="("])';
  const sheets = [{ href: MAIN_HREF, cssRules: [styleRule(TRICKY_SELECTOR, { color: "red" })] }];
  const el = fakeElement(sheets, { selectors: new Set([base]) });
  const result = collectMatchedRules(el, {
    statePseudoClasses: STATE_PSEUDO_CLASSES,
    structuralPseudoClasses: STRUCTURAL_PSEUDO_CLASSES,
  });
  const hit = result.matched.find((m) => m.original_selector === TRICKY_SELECTOR);
  expect(hit).toBeDefined();
  expect(hit.selector).toBe(TRICKY_SELECTOR);
  expect(hit.states).toEqual(["hover"]);
  expect(result.unresolved).toHaveLength(0);
});

// --- シャドウツリーの内と外 ---

const shadowCapture = (overrides) =>
  collectMatchedRules(fakeElement(overrides.sheets, overrides), {
    statePseudoClasses: STATE_PSEUDO_CLASSES,
    structuralPseudoClasses: STRUCTURAL_PSEUDO_CLASSES,
  });

test("シャドウツリー内の要素に外側 document の規則を当てない", () => {
  // document のスタイルシートはカプセル化でシャドウツリーの中へ届かないが、
  // el.matches(".btn") は true を返す。外側まで走ると、効いていない規則が
  // 部品の基準として記録され、実装がそれを写して現行と食い違う。
  const outer = {
    href: MAIN_HREF,
    cssRules: [styleRule(".btn", { color: "rgb(255, 0, 0)" })],
  };
  const inner = {
    href: null,
    cssRules: [styleRule(".btn", { color: "rgb(0, 128, 0)" })],
  };
  const result = shadowCapture({
    sheets: [outer],
    shadowSheets: [inner],
    selectors: new Set([".btn"]),
  });
  expect(result.shadow_root).toBe(true);
  expect(result.matched).toHaveLength(1);
  expect(result.matched[0].href).toBe(null);
  expect(result.matched[0].declarations[0].value).toBe("rgb(0, 128, 0)");
  // 0 件を「外側に規則が無い」と読まないため、飛ばした数は残す。
  expect(result.counts.outer_scope_skipped).toBe(1);
});

test("外側から届く ::part() は当たった側にも倒さず unresolved に残す", () => {
  const outer = {
    href: MAIN_HREF,
    cssRules: [styleRule(".host::part(label)", { color: "rgb(1, 1, 1)" })],
  };
  const result = shadowCapture({
    sheets: [outer],
    shadowSheets: [{ href: null, cssRules: [] }],
    selectors: new Set([".btn"]),
  });
  expect(result.matched).toHaveLength(0);
  expect(result.unresolved).toHaveLength(1);
  expect(result.unresolved[0].reason).toBe("shadow-part-not-evaluated");
  expect(result.counts.outer_scope_skipped).toBe(0);
});

test("シャドウでない要素では document を走査する", () => {
  // 上の絞り込みが通常の要素まで巻き込んでいないことを確かめる（過剰修正の検知）。
  const result = capture();
  expect(result.shadow_root).toBe(false);
  expect(result.counts.outer_scope_skipped).toBe(0);
  expect(result.matched.length).toBeGreaterThan(0);
});

// --- 入れ子になった関数擬似クラスの中の状態 ---

// 直下の引数しか見ない判定（修正前の実装と同じ深さ）。
function naiveStateInside(selector, scan) {
  for (const p of scan(selector)) {
    if (!p.args) continue;
    if (p.name !== "is" && p.name !== "where" && p.name !== "has") continue;
    for (const inner of scan(p.args)) {
      if (STATE_PSEUDO_CLASSES.includes(inner.name)) return true;
    }
  }
  return false;
}

test("陽性コントロール: 直下しか見ない判定は :is(:has(:hover)) を取りこぼす", () => {
  // scanPseudos はモジュール外へ出していないので、同じ規則の最小実装で深さだけを再現する。
  const scan = (sel) => {
    const out = [];
    const m = /:([-\w]+)\((.*)\)$/.exec(sel.replace(/^[^:]*/, ""));
    if (m) out.push({ name: m[1], args: m[2] });
    return out;
  };
  expect(naiveStateInside(".card:is(:has(:hover))", scan)).toBe(false);
});

test("入れ子の関数引数に入った状態を unresolved に落とす", () => {
  const selector = ".card:is(:has(:hover))";
  const sheets = [{ href: MAIN_HREF, cssRules: [styleRule(selector, { color: "red" })] }];
  const result = collectMatchedRules(
    fakeElement(sheets, { selectors: new Set([selector, ".card"]) }),
    {
      statePseudoClasses: STATE_PSEUDO_CLASSES,
      structuralPseudoClasses: STRUCTURAL_PSEUDO_CLASSES,
    },
  );
  expect(result.matched).toHaveLength(0);
  expect(result.unresolved).toHaveLength(1);
  expect(result.unresolved[0].reason).toBe("state-inside-functional-pseudo");
});

test(":not() の中の状態は unresolved にしない", () => {
  // 否定の中の状態は「その状態でないときに当たる」ので、当たっている規則として記録してよい。
  // 再帰を入れた結果ここまで巻き込むと、実装の材料になる規則を毎回失う。
  const selector = ".card:is(:not(:hover))";
  const sheets = [{ href: MAIN_HREF, cssRules: [styleRule(selector, { color: "red" })] }];
  const result = collectMatchedRules(fakeElement(sheets, { selectors: new Set([selector]) }), {
    statePseudoClasses: STATE_PSEUDO_CLASSES,
    structuralPseudoClasses: STRUCTURAL_PSEUDO_CLASSES,
  });
  expect(result.unresolved).toHaveLength(0);
  expect(result.matched).toHaveLength(1);
});

test("シャドウと document が同じシートを共有しても外側の走査を飛ばさない", () => {
  // seenSheets をシート単位にすると、内側を先に走った時点で既読になり、外側スコープの
  // 走査が丸ごと消える。::part() が unresolved に残らず outer_scope_skipped も増えない。
  const shared = {
    href: MAIN_HREF,
    cssRules: [
      styleRule(".host::part(label)", { color: "rgb(1, 1, 1)" }),
      styleRule(".btn", { color: "rgb(255, 0, 0)" }),
    ],
  };
  const result = shadowCapture({
    sheets: [shared],
    shadowSheets: [],
    shadowAdopted: [shared],
    selectors: new Set([".btn"]),
  });
  expect(result.unresolved.map((u) => u.reason)).toContain("shadow-part-not-evaluated");
  expect(result.counts.outer_scope_skipped).toBe(1);
});

test("カスタム要素のホストでは自分のシャドウルートの :host 規則を残す", () => {
  // getRootNode() は document を返すのでシャドウ判定に入らないが、ホストの見た目を
  // 決めているのは自分のシャドウルートの :host 規則。走らないと「規則ゼロ」の誤った基準になる。
  const hostSheet = {
    href: null,
    cssRules: [
      styleRule(":host(.primary)", { color: "rgb(0, 0, 255)" }),
      styleRule(".inner-label", { color: "rgb(9, 9, 9)" }),
    ],
  };
  const result = collectMatchedRules(
    fakeElement([], { hostSheets: [hostSheet], selectors: new Set([".btn"]) }),
    {
      statePseudoClasses: STATE_PSEUDO_CLASSES,
      structuralPseudoClasses: STRUCTURAL_PSEUDO_CLASSES,
    },
  );
  expect(result.shadow_host).toBe(true);
  expect(result.unresolved).toHaveLength(1);
  expect(result.unresolved[0].reason).toBe("host-scope-not-evaluated");
  // シャドウの中の要素に当たる規則はホストの基準ではないので matched に入れず数だけ残す。
  expect(result.counts.host_scope_skipped).toBe(1);
  expect(result.matched).toHaveLength(0);
});

test("ホストでない要素は shadow_host を立てない", () => {
  const result = capture();
  expect(result.shadow_host).toBe(false);
  expect(result.counts.host_scope_skipped).toBe(0);
});

test("selector を取る構造擬似クラスの中の状態も unresolved に落とす", () => {
  // `:is` / `:where` / `:has` で名前を絞ると、`:nth-child(... of S:hover)` の中の状態が
  // base に残り、hover していない要素で matched にも unresolved にも残らない。
  for (const selector of [".list:nth-child(2n of .item:hover)", ".x:host(.foo:hover)"]) {
    const sheets = [{ href: MAIN_HREF, cssRules: [styleRule(selector, { color: "red" })] }];
    const result = collectMatchedRules(fakeElement(sheets, { selectors: new Set([selector]) }), {
      statePseudoClasses: STATE_PSEUDO_CLASSES,
      structuralPseudoClasses: STRUCTURAL_PSEUDO_CLASSES,
    });
    expect(result.matched).toHaveLength(0);
    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0].reason).toBe("state-inside-functional-pseudo");
  }
});

test("状態を含まない構造擬似クラスは unresolved にしない", () => {
  // 一律に見る形にした結果、状態の無い `:nth-child(2n)` まで巻き込んでいないことの確認。
  const selector = ".plain-rule:nth-child(2n)";
  const sheets = [{ href: MAIN_HREF, cssRules: [styleRule(selector, { color: "red" })] }];
  const result = collectMatchedRules(fakeElement(sheets, { selectors: new Set([selector]) }), {
    statePseudoClasses: STATE_PSEUDO_CLASSES,
    structuralPseudoClasses: STRUCTURAL_PSEUDO_CLASSES,
  });
  expect(result.unresolved).toHaveLength(0);
  expect(result.matched).toHaveLength(1);
});

test("読み込めていない @import を黙って捨てない", () => {
  // 失敗・未ロードの @import は styleSheet が null になる。真偽値で分岐すると
  // どの分岐にも掛からず消え、「その @import の先に関係する規則が無い」と区別できなくなる。
  const broken = { styleSheet: null, href: "http://legacy.example/missing.css" };
  const sheets = [
    { href: MAIN_HREF, cssRules: [broken, styleRule(".plain-rule", { padding: "1px" })] },
  ];
  const result = collectMatchedRules(fakeElement(sheets), {
    statePseudoClasses: STATE_PSEUDO_CLASSES,
    structuralPseudoClasses: STRUCTURAL_PSEUDO_CLASSES,
  });
  expect(result.counts.import_rules).toBe(1);
  expect(result.inaccessible).toEqual([
    { href: "http://legacy.example/missing.css", error: "ImportNotLoaded" },
  ]);
  // 同じシートの後続の規則は通常どおり採る（打ち切らない）。
  expect(result.matched.some((m) => m.selector === ".plain-rule")).toBe(true);
});

test("読み込めている @import は従来どおり辿る", () => {
  // 上の分岐を「in 判定」に変えた結果、正常な @import まで落としていないことの確認。
  const result = capture();
  expect(result.inaccessible.every((i) => i.error !== "ImportNotLoaded")).toBe(true);
  expect(result.matched.some((m) => m.selector === ".marker-in-imported")).toBe(true);
});

test("スロットに割り当てられた要素では ::slotted() を残す", () => {
  // ライト DOM の要素に効く ::slotted() 規則はスロット側のシャドウルートにある。
  // getRootNode() は document を返すので、辿らないと 1 件も見えない。
  const slotSheet = {
    href: null,
    cssRules: [
      styleRule("::slotted(.btn)", { color: "rgb(3, 3, 3)" }),
      styleRule(".inner", { color: "rgb(4, 4, 4)" }),
    ],
  };
  const result = collectMatchedRules(
    fakeElement([], { slotSheets: [slotSheet], selectors: new Set([".btn"]) }),
    {
      statePseudoClasses: STATE_PSEUDO_CLASSES,
      structuralPseudoClasses: STRUCTURAL_PSEUDO_CLASSES,
    },
  );
  expect(result.slotted).toBe(true);
  expect(result.unresolved).toHaveLength(1);
  expect(result.unresolved[0].reason).toBe("slotted-not-evaluated");
  expect(result.counts.slotted_scope_skipped).toBe(1);
});

test("スロットに割り当てられていない要素は slotted を立てない", () => {
  const result = capture();
  expect(result.slotted).toBe(false);
  expect(result.counts.slotted_scope_skipped).toBe(0);
});

test("入れ子の中の未知の擬似クラスも unresolved に落とす", () => {
  // 外側が構造擬似クラスとして許容され、内側の未知の動的擬似クラスが素通りすると、
  // その状態でない要素で matches() が false を返し、規則が matched にも unresolved にも残らない。
  const selector = ".card:is(.item:popover-open)";
  const sheets = [{ href: MAIN_HREF, cssRules: [styleRule(selector, { color: "red" })] }];
  const result = collectMatchedRules(fakeElement(sheets, { selectors: new Set([selector]) }), {
    statePseudoClasses: STATE_PSEUDO_CLASSES,
    structuralPseudoClasses: STRUCTURAL_PSEUDO_CLASSES,
  });
  expect(result.matched).toHaveLength(0);
  expect(result.unresolved).toHaveLength(1);
  expect(result.unresolved[0].reason).toBe("unknown-pseudo-class:popover-open");
});

test("入れ子が既知の構造擬似クラスだけなら unresolved にしない", () => {
  // 再帰を入れた結果、既知の擬似クラスまで未知として落としていないことの確認。
  const selector = ".card:is(.item:first-child)";
  const sheets = [{ href: MAIN_HREF, cssRules: [styleRule(selector, { color: "red" })] }];
  const result = collectMatchedRules(fakeElement(sheets, { selectors: new Set([selector]) }), {
    statePseudoClasses: STATE_PSEUDO_CLASSES,
    structuralPseudoClasses: STRUCTURAL_PSEUDO_CLASSES,
  });
  expect(result.unresolved).toHaveLength(0);
  expect(result.matched).toHaveLength(1);
});
