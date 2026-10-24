// 当たっている CSS 規則の採取が、「取りこぼしても例外が出ない」入力で規則を取りこぼさないことの回帰テスト（Issue #326）。
//
// 検査するのは走査の検出能力そのものなので、修正前の素朴な走査に戻す変異を css-rules-capture.mutations.json に置く。
// 戻す走査は、@import を辿らない走査・引用符を見ない括弧勘定・直下の引数しか見ない状態の判定の 3 つである。
// 変異で本体のテストが落ちることで、この fixture が区別できていることを示す。空の cssRules を持つ通常の規則は、素朴な走査を同じ入力に当てて確かめる。
//
// fixture の形は、Chrome 149.0.7827.155 で実測した次の形に合わせてある。
//   - CSSImportRule は cssRules を持たず styleSheet を持つ
//   - CSSStyleRule は入れ子が無くても空の cssRules を持つ
//   - 入れ子の selectorText は `&` を保った形で返る
//   - クロスオリジンのスタイルシートは cssRules の参照で SecurityError を投げる

import { assert, describe, expect, test } from "vitest";
import {
  VERSION,
  STATE_PSEUDO_CLASSES,
  STRUCTURAL_PSEUDO_CLASSES,
  captureMatchedRules,
} from "../../../skills/parity-component/scripts/css-rules-capture.mjs";
import {
  type FakeSheet,
  type FakeElement,
  type Match,
  decl,
  styleRule,
  importRule,
  IMPORTED_HREF,
  MAIN_HREF,
  buildSheets,
  fakeElement,
  findMatch,
  requireMatch,
  naiveCollect,
  OPTIONS,
  verdict,
  COLLECTORS,
  bindCollect,
} from "./css-rules-capture-helpers.ts";

// どのテストも、モジュールの関数と、ページへ渡すソースから作り直した関数の 2 通りで実行する。
// ソースから作り直した関数は、captureMatchedRules に偽の locator を渡して呼ぶ（node:vm の新しいコンテキストで評価する）。
// 本体が本体の外の名前を参照しても、モジュールの関数の側はモジュールのスコープで名前が解決されて通る。
// 作り直した関数の側は名前を解決できずに失敗するので、取り決めが守られていることはこちらの側で確かめる。
describe.each(COLLECTORS)("%s", (_label, collect) => {
  const { capture, shadowCapture, captureOne } = bindCollect(collect);

  // --- 検出できることの確認: 素朴な走査が同じ入力で取りこぼすことを実証する ---

  test("検出されることの確認: 素朴な走査は空の cssRules を持つ通常の規則を数えない", async () => {
    // `.plain-rule` は入れ子を持たないが cssRules（空）を持つため、素朴な走査では
    // 「グループ規則」と誤認されて中身（0 件）だけが見られる。
    const seen = naiveCollect(buildSheets());
    expect(seen).not.toContain(".plain-rule");
    // 素朴な走査が拾えるのは、cssRules を持たない形の規則だけになる。
    expect(seen.length).toBeLessThan((await capture()).counts.style_rules);
  });

  // --- 本体 ---

  test("@import の先の規則を採る", async () => {
    const result = await capture();
    const hit = requireMatch(
      result,
      (m: Match) => m.selector === ".marker-in-imported" && m.states.length === 0,
    );
    expect(hit.href).toBe(IMPORTED_HREF);
    expect(hit.declarations).toEqual([
      { property: "color", value: "rgb(1, 2, 3)", important: false },
    ]);
    expect(result.counts.import_rules).toBe(1);
  });

  test(":hover の宣言と !important を状態付きで採る（計算値では見えない側）", async () => {
    const hit = requireMatch(
      await capture(),
      (m: Match) => m.states.includes("hover") && m.href === IMPORTED_HREF,
    );
    expect(hit.selector).toBe(".marker-in-imported:hover");
    expect(hit.states).toEqual(["hover"]);
    expect(hit.declarations).toEqual([
      { property: "color", value: "rgb(4, 5, 6)", important: true },
    ]);
  });

  test("空の cssRules を持つ通常の規則を採る", async () => {
    expect(findMatch(await capture(), (m: Match) => m.selector === ".plain-rule")).toBeDefined();
  });

  test("入れ子の & を親セレクタで解決して採る", async () => {
    const hit = requireMatch(await capture(), (m: Match) => m.original_selector === "&:hover");
    expect(hit.selector).toBe(":is(.card):hover");
    expect(hit.states).toEqual(["hover"]);
  });

  test("入れ子でも当たらない規則は採らない（& の解決が素通しになっていない）", async () => {
    // `& .inner` は `:is(.card) .inner` に解決され、対象要素には当たらない。
    // ここが素通りすると、`&` を無視して親の規則として数えていることになる。
    expect(
      findMatch(await capture(), (m: Match) => m.original_selector === "& .inner"),
    ).toBeUndefined();
  });

  test("条件・レイヤを規則に付けて採る", async () => {
    const result = await capture();
    expect(requireMatch(result, (m: Match) => m.selector === ".in-media").conditions).toEqual([
      "(min-width: 1px)",
    ]);
    expect(requireMatch(result, (m: Match) => m.selector === ".layered").layers).toEqual(["base"]);
  });

  test("@keyframes をレイヤとして数えない", async () => {
    for (const m of (await capture()).matched) expect(m.layers).not.toContain("spin");
  });

  test("擬似要素の規則を擬似要素として採る", async () => {
    const hit = requireMatch(await capture(), (m: Match) => m.pseudo_element !== null);
    expect(hit.selector).toBe(".btn::after");
    expect(hit.pseudo_element).toBe("::after");
  });

  test("読めないスタイルシートを警告なしに捨てず inaccessible に残す", async () => {
    const result = await capture();
    expect(result.inaccessible).toEqual([
      { href: "https://cdn.example/vendor.css", error: "SecurityError" },
    ]);
  });

  test(":is() の中の状態は判定せず unresolved に回す", async () => {
    const sheets = [
      { href: MAIN_HREF, cssRules: [styleRule(".card:is(:hover, .forced)", { color: "red" })] },
    ];
    const result = await collect(fakeElement(sheets), {
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

  test("matches() が throw するセレクタを unresolved に残す", async () => {
    const sheets = [{ href: MAIN_HREF, cssRules: [styleRule(".plain-rule", { color: "red" })] }];
    const el = fakeElement(sheets);
    el.matches = () => {
      const e = new Error("bad selector");
      e.name = "SyntaxError";
      throw e;
    };
    const result = await collect(el, {
      statePseudoClasses: STATE_PSEUDO_CLASSES,
      structuralPseudoClasses: STRUCTURAL_PSEUDO_CLASSES,
    });
    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0].reason).toBe("matches-threw:SyntaxError");
  });

  test("状態だけのセレクタは全称として扱って判定する", async () => {
    const sheets = [{ href: MAIN_HREF, cssRules: [styleRule(":hover", { cursor: "pointer" })] }];
    const result = await collect(fakeElement(sheets), {
      statePseudoClasses: STATE_PSEUDO_CLASSES,
      structuralPseudoClasses: STRUCTURAL_PSEUDO_CLASSES,
    });
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].states).toEqual(["hover"]);
  });

  test("同じスタイルシートを 2 度辿らない（@import の循環で止まらない）", async () => {
    const a: FakeSheet = { href: "http://legacy.example/a.css", cssRules: [] };
    const b = { href: "http://legacy.example/b.css", cssRules: [importRule(a)] };
    a.cssRules = [importRule(b), styleRule(".plain-rule", { padding: "1px" })];
    const result = await collect(fakeElement([a]), {
      statePseudoClasses: STATE_PSEUDO_CLASSES,
      structuralPseudoClasses: STRUCTURAL_PSEUDO_CLASSES,
    });
    expect(result.counts.sheets).toBe(2);
    expect(findMatch(result, (m: Match) => m.selector === ".plain-rule")).toBeDefined();
  });

  test("adoptedStyleSheets も走査する", async () => {
    const adopted = [{ href: null, cssRules: [styleRule(".plain-rule", { padding: "2px" })] }];
    const result = await collect(fakeElement([], { adopted }), {
      statePseudoClasses: STATE_PSEUDO_CLASSES,
      structuralPseudoClasses: STRUCTURAL_PSEUDO_CLASSES,
    });
    expect(findMatch(result, (m: Match) => m.selector === ".plain-rule")).toBeDefined();
  });

  test("入れ子の途中に現れた裸の宣言（CSSNestedDeclarations）を警告なしに捨てない", async () => {
    // `.card { color: red; & .inner { … } background: blue; }` の `background` は Chrome 130+ で
    // CSSNestedDeclarations として返る。selectorText も cssRules も持たないため、
    // 分岐を足さないと matched / unresolved / counts のどこにも残らず、警告なしに消える。
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
    const result = await collect(fakeElement(sheets), {
      statePseudoClasses: STATE_PSEUDO_CLASSES,
      structuralPseudoClasses: STRUCTURAL_PSEUDO_CLASSES,
    });
    const hit = requireMatch(result, (m: Match) =>
      m.declarations.some((d) => d.property === "background" && d.value === "rgb(7, 7, 7)"),
    );
    expect(hit.selector).toBe(".card"); // 適用先は囲っている規則のセレクタ
    expect(result.counts.nested_declaration_rules).toBe(1);
  });

  test("@import の layer() とメディア条件を読み込んだ規則へ引き継ぐ", async () => {
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
    const result = await collect(fakeElement(sheets), {
      statePseudoClasses: STATE_PSEUDO_CLASSES,
      structuralPseudoClasses: STRUCTURAL_PSEUDO_CLASSES,
    });
    const hit = requireMatch(result, (m: Match) => m.selector === ".plain-rule");
    expect(hit.layers).toEqual(["vendor"]);
    expect(hit.conditions).toEqual(["screen"]);
  });

  test("layer()・media の無い @import には条件を足さない", async () => {
    const hit = requireMatch(await capture(), (m: Match) => m.selector === ".marker-in-imported");
    expect(hit.layers).toEqual([]);
    expect(hit.conditions).toEqual([]);
  });

  test("属性セレクタの中の & を入れ子セレクタとして置換しない", async () => {
    // `& [data-label="A&B"]` の引用符内の & まで置換すると、属性値に :is(...) が入った
    // 不正なセレクタになる。matches() は throw せず false を返すので、エラーにならずに規則が外れる。
    const child = styleRule('& [data-label="A&B"]', { color: "red" });
    const parent = styleRule(".card", { color: "blue" }, { children: [child] });
    const sheets = [{ href: MAIN_HREF, cssRules: [parent] }];
    const el = fakeElement(sheets, {
      selectors: new Set([".card", ':is(.card) [data-label="A&B"]']),
    });
    const result = await collect(el, {
      statePseudoClasses: STATE_PSEUDO_CLASSES,
      structuralPseudoClasses: STRUCTURAL_PSEUDO_CLASSES,
    });
    const hit = result.matched.find((m: Match) => m.original_selector === '& [data-label="A&B"]');
    assert.exists(hit, "元のセレクタの規則が採れていない");
    expect(hit.selector).toBe(':is(.card) [data-label="A&B"]');
  });

  test("@scope の中の規則はスコープを評価せず unresolved に残す", async () => {
    // セレクタだけを見ると当たるが、スコープ根の外では適用されない。
    // 当たった側として扱うと、その部品には適用されていない規則を根拠として出すことになる。
    const scopeRule = {
      start: "(.dialog)",
      end: null,
      cssRules: [styleRule(".plain-rule", { padding: "9px" })],
    };
    const sheets = [{ href: MAIN_HREF, cssRules: [scopeRule] }];
    const result = await collect(fakeElement(sheets), {
      statePseudoClasses: STATE_PSEUDO_CLASSES,
      structuralPseudoClasses: STRUCTURAL_PSEUDO_CLASSES,
    });
    expect(result.matched).toHaveLength(0);
    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0].reason).toBe("scope-not-evaluated:(.dialog)");
  });

  test("エスケープされた区切り文字でセレクタを分割しない", async () => {
    // `.foo\,bar` は 1 つのクラスセレクタ。エスケープを飛ばさずに分割すると
    // 断片が無効セレクタになり、当たるはずの規則がエラーにならずに外れる。
    const sheets = [{ href: MAIN_HREF, cssRules: [styleRule(".foo\\,bar", { color: "red" })] }];
    const el = fakeElement(sheets, { selectors: new Set([".foo\\,bar"]) });
    const result = await collect(el, {
      statePseudoClasses: STATE_PSEUDO_CLASSES,
      structuralPseudoClasses: STRUCTURAL_PSEUDO_CLASSES,
    });
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].selector).toBe(".foo\\,bar");
  });

  test("知らない動的擬似クラスを警告なしに捨てず unresolved に残す", async () => {
    // `:popover-open` / `:user-valid` / `:fullscreen` を知らないまま base に残すと、
    // その状態でない要素に matches() が false を返し、当たるはずの規則が記録も警告も無く消える。
    const sheets = [
      { href: MAIN_HREF, cssRules: [styleRule(".plain-rule:popover-open", { color: "red" })] },
    ];
    const result = await collect(fakeElement(sheets), {
      statePseudoClasses: STATE_PSEUDO_CLASSES,
      structuralPseudoClasses: STRUCTURAL_PSEUDO_CLASSES,
    });
    expect(result.matched).toHaveLength(0);
    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0].reason).toBe("unknown-pseudo-class:popover-open");
  });

  test("@import の supports() 条件を引き継ぐ", async () => {
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
    const result = await collect(fakeElement([main]), {
      statePseudoClasses: STATE_PSEUDO_CLASSES,
      structuralPseudoClasses: STRUCTURAL_PSEUDO_CLASSES,
    });
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].conditions).toEqual(["supports(display: grid)", "screen"]);
  });

  // --- style 属性（インライン宣言） ---

  test("style 属性の宣言を別の出所として採る", async () => {
    // インスタンス固有の値が style 属性で来ている部品では、規則走査だけだと出所も
    // `!important` の優先度も残らず、計算後スタイルの結果値しか手掛かりが無くなる。
    const el = fakeElement(buildSheets(), {
      inline: { width: "240px", color: "rgb(9, 9, 9)" },
      inlineImportant: ["color"],
    });
    const result = await collect(el, {
      statePseudoClasses: STATE_PSEUDO_CLASSES,
      structuralPseudoClasses: STRUCTURAL_PSEUDO_CLASSES,
    });
    expect(result.inline_declarations).toEqual([
      { property: "width", value: "240px", important: false },
      { property: "color", value: "rgb(9, 9, 9)", important: true },
    ]);
    expect(result.counts.inline_declarations).toBe(2);
    // 規則ではないので matched へ混ぜない（セレクタの根拠と取り違える）。
    expect(result.matched.every((m: Match) => m.selector !== undefined)).toBe(true);
  });

  test("style 属性が空でも inline_declarations を空配列で出す", async () => {
    // キーごと落とすと「インライン指定が無い」と「採っていない（旧版の採取物）」が
    // 同じ形になり、再採取の要否を判定できない。
    const result = await capture();
    expect(result.inline_declarations).toEqual([]);
    expect(result.counts.inline_declarations).toBe(0);
  });

  // --- 関数擬似クラスの引数の釣り合い ---

  const TRICKY_SELECTOR = '.button:has([data-label="("]):hover';

  // --- 関数擬似クラスの引数の釣り合い ---

  test("引用符・角括弧を跨ぐ関数引数でも状態擬似クラスを剥がす", async () => {
    const base = '.button:has([data-label="("])';
    const sheets = [{ href: MAIN_HREF, cssRules: [styleRule(TRICKY_SELECTOR, { color: "red" })] }];
    const el = fakeElement(sheets, { selectors: new Set([base]) });
    const result = await collect(el, {
      statePseudoClasses: STATE_PSEUDO_CLASSES,
      structuralPseudoClasses: STRUCTURAL_PSEUDO_CLASSES,
    });
    const hit = result.matched.find((m: Match) => m.original_selector === TRICKY_SELECTOR);
    assert.exists(hit, "元のセレクタの規則が採れていない");
    expect(hit.selector).toBe(TRICKY_SELECTOR);
    expect(hit.states).toEqual(["hover"]);
    expect(result.unresolved).toHaveLength(0);
  });

  // --- シャドウツリーの内と外 ---

  test("シャドウツリー内の要素に外側 document の規則を当てない", async () => {
    // document のスタイルシートはカプセル化でシャドウツリーの中へ届かないが、
    // el.matches(".btn") は true を返す。外側まで走査すると、適用されていない規則が
    // 部品の基準として記録され、実装がそれを反映して現行と食い違う。
    const outer = {
      href: MAIN_HREF,
      cssRules: [styleRule(".btn", { color: "rgb(255, 0, 0)" })],
    };
    const inner = {
      href: null,
      cssRules: [styleRule(".btn", { color: "rgb(0, 128, 0)" })],
    };
    const result = await shadowCapture({
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

  test("外側から届く ::part() は当たった側としても扱わず unresolved に残す", async () => {
    const outer = {
      href: MAIN_HREF,
      cssRules: [styleRule(".host::part(label)", { color: "rgb(1, 1, 1)" })],
    };
    const result = await shadowCapture({
      sheets: [outer],
      shadowSheets: [{ href: null, cssRules: [] }],
      selectors: new Set([".btn"]),
    });
    expect(result.matched).toHaveLength(0);
    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0].reason).toBe("shadow-part-not-evaluated");
    expect(result.counts.outer_scope_skipped).toBe(0);
  });

  test("シャドウでない要素では document を走査する", async () => {
    // 上の絞り込みが通常の要素まで巻き込んでいないことを確かめる（過剰修正の検知）。
    const result = await capture();
    expect(result.shadow_root).toBe(false);
    expect(result.counts.outer_scope_skipped).toBe(0);
    expect(result.matched.length).toBeGreaterThan(0);
  });

  // --- 入れ子になった関数擬似クラスの中の状態 ---

  test("入れ子の関数引数に入った状態を unresolved に落とす", async () => {
    const selector = ".card:is(:has(:hover))";
    const sheets = [{ href: MAIN_HREF, cssRules: [styleRule(selector, { color: "red" })] }];
    const result = await collect(fakeElement(sheets, { selectors: new Set([selector, ".card"]) }), {
      statePseudoClasses: STATE_PSEUDO_CLASSES,
      structuralPseudoClasses: STRUCTURAL_PSEUDO_CLASSES,
    });
    expect(result.matched).toHaveLength(0);
    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0].reason).toBe("state-inside-functional-pseudo");
  });

  test(":not() の中の状態は unresolved にしない", async () => {
    // 否定の中の状態は「その状態でないときに当たる」ので、当たっている規則として記録してよい。
    // 再帰を入れた結果ここまで巻き込むと、実装の材料になる規則を毎回失う。
    const selector = ".card:is(:not(:hover))";
    const sheets = [{ href: MAIN_HREF, cssRules: [styleRule(selector, { color: "red" })] }];
    const result = await collect(fakeElement(sheets, { selectors: new Set([selector]) }), {
      statePseudoClasses: STATE_PSEUDO_CLASSES,
      structuralPseudoClasses: STRUCTURAL_PSEUDO_CLASSES,
    });
    expect(result.unresolved).toHaveLength(0);
    expect(result.matched).toHaveLength(1);
  });

  test("シャドウと document が同じシートを共有しても外側の走査を飛ばさない", async () => {
    // seenSheets をシート単位にすると、内側を先に走査した時点で既読になり、外側スコープの
    // 走査が丸ごと消える。::part() が unresolved に残らず outer_scope_skipped も増えない。
    const shared = {
      href: MAIN_HREF,
      cssRules: [
        styleRule(".host::part(label)", { color: "rgb(1, 1, 1)" }),
        styleRule(".btn", { color: "rgb(255, 0, 0)" }),
      ],
    };
    const result = await shadowCapture({
      sheets: [shared],
      shadowSheets: [],
      shadowAdopted: [shared],
      selectors: new Set([".btn"]),
    });
    expect(result.unresolved.map((u: { reason: string }) => u.reason)).toContain(
      "shadow-part-not-evaluated",
    );
    expect(result.counts.outer_scope_skipped).toBe(1);
  });

  test("カスタム要素のホストでは自分のシャドウルートの :host 規則を残す", async () => {
    // getRootNode() は document を返すのでシャドウ判定に入らないが、ホストの見た目を
    // 決めているのは自分のシャドウルートの :host 規則。走査しないと「規則ゼロ」の誤った基準になる。
    const hostSheet = {
      href: null,
      cssRules: [
        styleRule(":host(.primary)", { color: "rgb(0, 0, 255)" }),
        styleRule(".inner-label", { color: "rgb(9, 9, 9)" }),
      ],
    };
    const result = await collect(
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

  test("ホストでない要素は shadow_host を立てない", async () => {
    const result = await capture();
    expect(result.shadow_host).toBe(false);
    expect(result.counts.host_scope_skipped).toBe(0);
  });

  test("selector を取る構造擬似クラスの中の状態も unresolved に落とす", async () => {
    // `:is` / `:where` / `:has` で名前を絞ると、`:nth-child(... of S:hover)` の中の状態が
    // base に残り、hover していない要素で matched にも unresolved にも残らない。
    for (const selector of [".list:nth-child(2n of .item:hover)", ".x:host(.foo:hover)"]) {
      const sheets = [{ href: MAIN_HREF, cssRules: [styleRule(selector, { color: "red" })] }];
      const result = await collect(fakeElement(sheets, { selectors: new Set([selector]) }), {
        statePseudoClasses: STATE_PSEUDO_CLASSES,
        structuralPseudoClasses: STRUCTURAL_PSEUDO_CLASSES,
      });
      expect(result.matched).toHaveLength(0);
      expect(result.unresolved).toHaveLength(1);
      expect(result.unresolved[0].reason).toBe("state-inside-functional-pseudo");
    }
  });

  test("状態を含まない構造擬似クラスは unresolved にしない", async () => {
    // 一律に見る形にした結果、状態の無い `:nth-child(2n)` まで巻き込んでいないことの確認。
    const selector = ".plain-rule:nth-child(2n)";
    const sheets = [{ href: MAIN_HREF, cssRules: [styleRule(selector, { color: "red" })] }];
    const result = await collect(fakeElement(sheets, { selectors: new Set([selector]) }), {
      statePseudoClasses: STATE_PSEUDO_CLASSES,
      structuralPseudoClasses: STRUCTURAL_PSEUDO_CLASSES,
    });
    expect(result.unresolved).toHaveLength(0);
    expect(result.matched).toHaveLength(1);
  });

  test("読み込めていない @import を警告なしに捨てない", async () => {
    // 失敗・未ロードの @import は styleSheet が null になる。真偽値で分岐すると
    // どの分岐にも掛からず消え、「その @import の先に関係する規則が無い」と区別できなくなる。
    const broken = { styleSheet: null, href: "http://legacy.example/missing.css" };
    const sheets = [
      { href: MAIN_HREF, cssRules: [broken, styleRule(".plain-rule", { padding: "1px" })] },
    ];
    const result = await collect(fakeElement(sheets), {
      statePseudoClasses: STATE_PSEUDO_CLASSES,
      structuralPseudoClasses: STRUCTURAL_PSEUDO_CLASSES,
    });
    expect(result.counts.import_rules).toBe(1);
    expect(result.inaccessible).toEqual([
      { href: "http://legacy.example/missing.css", error: "ImportNotLoaded" },
    ]);
    // 同じシートの後続の規則は通常どおり採る（打ち切らない）。
    expect(result.matched.some((m: Match) => m.selector === ".plain-rule")).toBe(true);
  });

  test("スロットに割り当てられた要素では ::slotted() を残す", async () => {
    // ライト DOM の要素に適用される ::slotted() 規則はスロット側のシャドウルートにある。
    // getRootNode() は document を返すので、辿らないと 1 件も見えない。
    const slotSheet = {
      href: null,
      cssRules: [
        styleRule("::slotted(.btn)", { color: "rgb(3, 3, 3)" }),
        styleRule(".inner", { color: "rgb(4, 4, 4)" }),
      ],
    };
    const result = await collect(
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

  test("スロットに割り当てられていない要素は slotted を立てない", async () => {
    const result = await capture();
    expect(result.slotted).toBe(false);
    expect(result.counts.slotted_scope_skipped).toBe(0);
  });

  test("入れ子の中の未知の擬似クラスも unresolved に落とす", async () => {
    // 外側が構造擬似クラスとして許容され、内側の未知の動的擬似クラスが素通りすると、
    // その状態でない要素で matches() が false を返し、規則が matched にも unresolved にも残らない。
    const selector = ".card:is(.item:popover-open)";
    const sheets = [{ href: MAIN_HREF, cssRules: [styleRule(selector, { color: "red" })] }];
    const result = await collect(fakeElement(sheets, { selectors: new Set([selector]) }), {
      statePseudoClasses: STATE_PSEUDO_CLASSES,
      structuralPseudoClasses: STRUCTURAL_PSEUDO_CLASSES,
    });
    expect(result.matched).toHaveLength(0);
    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0].reason).toBe("unknown-pseudo-class:popover-open");
  });

  test("入れ子が既知の構造擬似クラスだけなら unresolved にしない", async () => {
    // 再帰を入れた結果、既知の擬似クラスまで未知として落としていないことの確認。
    const selector = ".card:is(.item:first-child)";
    const sheets = [{ href: MAIN_HREF, cssRules: [styleRule(selector, { color: "red" })] }];
    const result = await collect(fakeElement(sheets, { selectors: new Set([selector]) }), {
      statePseudoClasses: STATE_PSEUDO_CLASSES,
      structuralPseudoClasses: STRUCTURAL_PSEUDO_CLASSES,
    });
    expect(result.unresolved).toHaveLength(0);
    expect(result.matched).toHaveLength(1);
  });

  // --- 自分の根にある ::part() / ::slotted()（Issue #354） ---

  test("ホストを対象にしたとき document の ::part() をホストの根拠にしない", async () => {
    // `.host::part(label)` は擬似要素を剥がすと `.host` になり、ホストに対して matches() が真を返す。
    // 飾っているのはシャドウツリー内の部品なので、matched に入るとホストの偽の根拠になる。
    // selectors に `.host` を入れてあるので、分岐を外すと matched へ入る（検出できることの確認を兼ねる）。
    const sheets = [
      {
        href: MAIN_HREF,
        cssRules: [
          styleRule(".host::part(label)", { color: "rgb(1, 1, 1)" }),
          styleRule(".host::part(label):hover", { color: "rgb(2, 2, 2)" }),
        ],
      },
    ];
    const result = await collect(
      fakeElement(sheets, {
        hostSheets: [{ href: null, cssRules: [] }],
        selectors: new Set([".host"]),
      }),
      OPTIONS,
    );
    expect(result.shadow_host).toBe(true);
    expect(result.matched).toHaveLength(0);
    expect(result.unresolved.map((u: { reason: string }) => u.reason)).toEqual([
      "shadow-part-not-evaluated",
      "shadow-part-not-evaluated",
    ]);
  });

  test("ホストに当たる通常の規則と擬似要素の規則は ::part() の除外に巻き込まない", async () => {
    // 過剰修正の検知: `::part(` を含まない規則は従来どおり判定する。
    const sheets = [
      {
        href: MAIN_HREF,
        cssRules: [
          styleRule(".host", { color: "rgb(3, 3, 3)" }),
          styleRule(".host::before", { content: '"*"' }),
          styleRule('.host[data-label="::part(x)"]', { color: "rgb(4, 4, 4)" }),
        ],
      },
    ];
    const result = await collect(
      fakeElement(sheets, {
        hostSheets: [{ href: null, cssRules: [] }],
        selectors: new Set([".host", '.host[data-label="::part(x)"]']),
      }),
      OPTIONS,
    );
    expect(result.unresolved).toHaveLength(0);
    expect(result.matched.map((m: Match) => [m.selector, m.pseudo_element])).toEqual([
      [".host", null],
      [".host::before", "::before"],
      ['.host[data-label="::part(x)"]', null],
    ]);
  });

  test("シャドウツリー内の要素に自分の根の ::slotted() を当てない", async () => {
    // `::slotted(*)` は剥がすと `*` になり、どの要素にも当たる。飾るのはスロットへ割り当てられた
    // ライト DOM の要素で、同じシャドウツリーの要素ではない。
    const result = await shadowCapture({
      sheets: [],
      shadowSheets: [
        {
          href: null,
          cssRules: [
            styleRule("::slotted(*)", { margin: "0px" }),
            styleRule(".btn", { color: "red" }),
          ],
        },
      ],
      selectors: new Set(["*", ".btn"]),
    });
    expect(result.matched.map((m: Match) => m.selector)).toEqual([".btn"]);
    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0].reason).toBe("slotted-not-evaluated");
  });

  // --- 擬似クラス・擬似要素の名前の大文字小文字（Issue #357） ---
  //
  // CSS の擬似クラス・擬似要素の名前は ASCII の大文字小文字を区別しない。小文字の綴りしか
  // 認識しない判定は、例外を出さずに別の分岐で扱われる（`::PART` は擬似要素として剥がされて
  // ホストに当たり、`:HOVER` は未知の擬似クラスとして unresolved として扱われる）。
  // 各ケースは小文字版と同じ結果になることを確かめる（小文字側が正しいことは上の各テストが固定している）。

  test.each([
    // 各行の要素: ラベル・小文字・大文字混じり・スコープ・当たる base・期待する判定
    {
      label: "自分の根の ::part()",
      lower: ".host::part(label)",
      mixed: ".host::PART(label)",
      scope: "host-target",
      selectors: [".host"],
      expected: { unresolved: ["shadow-part-not-evaluated"] },
    },
    {
      label: "自分の根の ::slotted()",
      lower: "::slotted(*)",
      mixed: "::Slotted(*)",
      scope: "outer-shadow-self",
      selectors: ["*"],
      expected: { unresolved: ["slotted-not-evaluated"] },
    },
    {
      label: "状態擬似クラス",
      lower: ".btn:hover",
      mixed: ".btn:HOVER",
      scope: "document",
      selectors: [".btn"],
      expected: { matched: [[["hover"], null]] },
    },
    {
      label: "歴史的な単一コロンの擬似要素",
      lower: ".btn:before",
      mixed: ".btn:BEFORE",
      scope: "document",
      selectors: [".btn"],
      expected: { matched: [[[], ":before"]] },
    },
    {
      label: "構造擬似クラス",
      lower: ".btn:first-child",
      mixed: ".btn:First-Child",
      scope: "document",
      selectors: [".btn:first-child", ".btn:First-Child"],
      expected: { matched: [[[], null]] },
    },
    {
      label: ":not() の中の状態を状態として扱わない",
      lower: ".btn:not(:hover)",
      mixed: ".btn:NOT(:HOVER)",
      scope: "document",
      selectors: [".btn:not(:hover)", ".btn:NOT(:HOVER)"],
      expected: { matched: [[[], null]] },
    },
    {
      label: ":is() の中の状態",
      lower: ".btn:is(:hover)",
      mixed: ".btn:IS(:Hover)",
      scope: "document",
      selectors: [".btn:is(:hover)", ".btn:IS(:Hover)"],
      expected: { unresolved: ["state-inside-functional-pseudo"] },
    },
    {
      label: "外側から届く ::part()",
      lower: ".host::part(label)",
      mixed: ".host::Part(label)",
      scope: "outer",
      selectors: [".btn"],
      expected: { unresolved: ["shadow-part-not-evaluated"] },
    },
    {
      label: "ホスト自身のシャドウルートの :host()",
      lower: ":host(.primary)",
      mixed: ":HOST(.primary)",
      scope: "host",
      selectors: [".btn"],
      expected: { unresolved: ["host-scope-not-evaluated"] },
    },
    {
      label: "ホスト自身のシャドウルートの :host-context()",
      lower: ":host-context(.dark)",
      mixed: ":Host-Context(.dark)",
      scope: "host",
      selectors: [".btn"],
      expected: { unresolved: ["host-scope-not-evaluated"] },
    },
    {
      label: "スロット側の ::slotted()",
      lower: "::slotted(.btn)",
      mixed: "::SLOTTED(.btn)",
      scope: "slot",
      selectors: [".btn"],
      expected: { unresolved: ["slotted-not-evaluated"] },
    },
  ])(
    "$label を大文字小文字を区別せずに判定する",
    async ({ lower, mixed, scope, selectors, expected }) => {
      const run = (selector: string) =>
        scope === "outer-shadow-self"
          ? shadowCapture({
              sheets: [],
              shadowSheets: [{ href: null, cssRules: [styleRule(selector, { margin: "0px" })] }],
              selectors: new Set(selectors),
            })
          : captureOne(selector, scope, selectors);
      const lowerResult = verdict(await run(lower));
      expect(lowerResult).toMatchObject({ matched: [], unresolved: [], ...expected });
      expect(verdict(await run(mixed))).toEqual(lowerResult);
    },
  );

  test("属性値の中の擬似クラス風の文字列はスコープの判定に使わない", async () => {
    // 文字列の部分一致で判定していた頃は、属性値の中の `:host` / `::part(` / `::slotted(` を
    // 擬似クラスとして数え、飛ばすべき規則を unresolved に残していた。
    const host = await captureOne('.x[data-note=":host"]', "host", [".btn"]);
    expect(host.unresolved).toHaveLength(0);
    expect(host.counts.host_scope_skipped).toBe(1);
    const outer = await captureOne('.btn[data-note="::part(x)"]', "outer", [".btn"]);
    expect(outer.unresolved).toHaveLength(0);
    expect(outer.counts.outer_scope_skipped).toBe(1);
    const slot = await captureOne('.btn[data-note="::slotted(x)"]', "slot", [".btn"]);
    expect(slot.unresolved).toHaveLength(0);
    expect(slot.counts.slotted_scope_skipped).toBe(1);
  });
});

test("captureMatchedRules は論理名とツール版を付けて返す", async () => {
  const el = fakeElement(buildSheets());
  const locator = {
    evaluate: <Arg>(fn: (el: FakeElement, options: Arg) => unknown, options: Arg) =>
      Promise.resolve(fn(el, options)),
  };
  const [captured] = await captureMatchedRules([{ name: "button.primary", locator }]);
  expect(captured.name).toBe("button.primary");
  expect(captured.tool_version).toBe(VERSION);
  expect(captured.matched.length).toBeGreaterThan(0);
});
