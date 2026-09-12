// 当たっている CSS 規則の採取（正本）。
// 正本はこのスキル側にあり、**プロジェクトへコピーせずスキル配下からそのまま実行する**
// （`gh skill update` の自動更新を効かせるため。SKILL.md「成果物」と references/capture.md が同じ規約）。
// `<parity_suite_dir>/parity/lib/tools/vendor/` へコピーするのは `parity-suite` 同梱の差分器・
// 特性採取ツールの側で、本スクリプトは対象外。
//
// 何を採るか: 論理名を付けた要素に当たりうる CSS 規則を、宣言（プロパティ・値・`!important`）・
// 成立に必要な状態擬似クラス・擬似要素・条件（`@media` / `@supports` / `@container`）・
// カスケードレイヤ・出所（スタイルシートの URL と規則の位置）付きで列挙する。
//
// 何を採らないか: **どの宣言が勝つか（カスケードの解決結果）は採らない。** 勝者は計算後スタイルが
// 持っており、それは `parity-suite` の trait-capture.mjs が採る。本ツールが埋めるのはその裏側——
// 計算値は「いまの状態の結果」なので、`:hover` の宣言も `!important` の競合も見えない。
// 実装者が「何を写すのか」を決めるための一次資料であって、合否判定の入力ではない
// （合否は画素比較と特性照合が出す）。
//
// 実測（Chrome 149.0.7827.155。CDP の Page.setDocumentContent ＋ Runtime.evaluate で確認）:
//   1. `CSSImportRule` は `cssRules` を持たない（`"cssRules" in rule === false`）。
//      持つのは `styleSheet` で、`@import` の先の規則はそこからしか辿れない。
//   2. `CSSStyleRule` は（CSS 入れ子のため）`cssRules` を持つ。入れ子が無くても length 0 の
//      空 CSSRuleList になる。このため `if (rule.cssRules) 再帰する; else 数える;` の走査は
//      通常の規則を 1 件も数えない（同じ入力で 6 件が 1 件になることを確認した）。
//   3. 入れ子の規則の `selectorText` は `&` を保った形で返る（`.inner` と書いても `& .inner`）。
//      `el.matches("&:hover")` は throw せず false を返すため、`&` を解決しないと静かに取りこぼす。
//   4. `el.matches(".btn::after")` も throw せず false を返す。擬似要素も剥がさないと同じ取りこぼしになる。
// 1 と 2 は Issue #326 の報告（辿らないと 883 件、辿ると 3,206 件／883 件のはずが 4 件）と同じ現象で、
// どちらも「取りこぼしても例外が出ない」ため、走査が壊れていることが出力から分からない。
// だから本ツールは**数えられなかったものを必ず出力に残す**（`inaccessible` / `unresolved`）。
//
// 陽性コントロール: 同じ Chrome 149 上で本関数をそのまま実行し、@import の先の `!important` 付き
// `:hover` 宣言・入れ子の `&:hover` の解決（`:is(.card):hover`）・`@layer` と `@media` の条件付与・
// `::after` の擬似要素判定・`@keyframes` をレイヤとして数えないこと、および当たらない入れ子
// （`& .inner`）を採らないことを確認した。偽 CSSOM に対するユニットテストは
// scripts/css-rules-capture.test.js（素朴な走査が同じ入力で取りこぼすことを併せて実証している）。
//
// Playwright はピア前提であり import しない。Locator は引数で受け取り、
// locator.evaluate() 経由でブラウザ内 DOM を操作する（型は JSDoc のみ。TypeScript 構文は使わない）。
// collectMatchedRules は locator.evaluate に文字列化して渡るため、モジュール側のヘルパを参照できない。
// 補助関数はすべて関数内に閉じてある（分割して見通しを良くするとブラウザ側で ReferenceError になる）。

/**
 * ツールのバージョン（正本）。採取スキーマ（出力の形・状態擬似クラスの集合）を変えたら上げる。
 * metadata.json の `capture.tools.css_rules_version` に記録する値はこれを使う（手入力にしない）。
 * @type {string}
 */
export const VERSION = "1";

/**
 * 状態を表す擬似クラスの集合（正本）。
 * これらは「その状態のときだけ当たる」ことを意味するので、セレクタから剥がして
 * 残りで要素に当たるかを判定し、剥がした名前を `states` として記録する。
 * 剥がさずに matches() へ渡すと、hover 中でない要素に対して常に false になり、
 * `:hover` の宣言が 1 件も採れない（Issue #326 が計算値だけでは足りないと書いた箇所）。
 * @type {readonly string[]}
 */
export const STATE_PSEUDO_CLASSES = [
  "active",
  "checked",
  "default",
  "disabled",
  "enabled",
  "focus",
  "focus-visible",
  "focus-within",
  "hover",
  "indeterminate",
  "invalid",
  "link",
  "optional",
  "placeholder-shown",
  "read-only",
  "read-write",
  "required",
  "target",
  "valid",
  "visited",
];

/**
 * 要素に当たりうる CSS 規則を採る（ブラウザ内で実行される）。
 *
 * @param {Element} el 対象要素
 * @param {{ statePseudoClasses: readonly string[] }} options 状態擬似クラスの集合
 * @returns {object} 採取結果（matched / unresolved / inaccessible / counts）
 */
export function collectMatchedRules(el, options) {
  const stateNames = new Set(options.statePseudoClasses);

  // セレクタリストをトップレベルのカンマで割る（括弧・文字列の中のカンマは区切りにしない）。
  function splitSelectorList(text) {
    const parts = [];
    let depth = 0;
    let quote = null;
    let start = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quote) {
        if (c === "\\") i++;
        else if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'") quote = c;
      else if (c === "(" || c === "[") depth++;
      else if (c === ")" || c === "]") depth--;
      else if (c === "," && depth === 0) {
        parts.push(text.slice(start, i).trim());
        start = i + 1;
      }
    }
    parts.push(text.slice(start).trim());
    return parts.filter((p) => p.length > 0);
  }

  // 入れ子の `&` を親セレクタで解決する。
  // 実測どおり Chrome は入れ子の selectorText に `&` を残すが、`&` が無い形で返る実装に備えて
  // その場合は子孫結合（CSS 入れ子の既定）として親を前置する。
  function resolveSelector(selectorText, parentSelector) {
    if (!parentSelector) return selectorText;
    const parent = `:is(${parentSelector})`;
    return splitSelectorList(selectorText)
      .map((part) => (part.includes("&") ? part.split("&").join(parent) : `${parent} ${part}`))
      .join(", ");
  }

  // トップレベル（括弧の外）の擬似クラス・擬似要素を切り出す。
  function scanPseudos(selector) {
    const found = [];
    let depth = 0;
    let quote = null;
    for (let i = 0; i < selector.length; i++) {
      const c = selector[i];
      if (quote) {
        if (c === "\\") i++;
        else if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'") {
        quote = c;
        continue;
      }
      if (c === "(" || c === "[") depth++;
      else if (c === ")" || c === "]") depth--;
      else if (c === ":" && depth === 0) {
        const doubled = selector[i + 1] === ":";
        let j = i + (doubled ? 2 : 1);
        let name = "";
        while (j < selector.length && /[-\w]/.test(selector[j])) name += selector[j++];
        let args = null;
        if (selector[j] === "(") {
          let d = 1;
          const argStart = ++j;
          while (j < selector.length && d > 0) {
            if (selector[j] === "(") d++;
            else if (selector[j] === ")") d--;
            j++;
          }
          args = selector.slice(argStart, j - 1);
        }
        found.push({ start: i, end: j, name, doubled, args });
        i = j - 1;
      }
    }
    return found;
  }

  // 状態擬似クラスと擬似要素を剥がし、残り（base）と剥がしたものを返す。
  function analyzeSelector(selector) {
    const pseudos = scanPseudos(selector);
    const states = [];
    let pseudoElement = null;
    let base = "";
    let cursor = 0;
    // 単一コロンでも擬似要素として扱われる歴史的な 4 つ。
    const legacyElements = new Set(["before", "after", "first-line", "first-letter"]);
    for (const p of pseudos) {
      const isElement = p.doubled || (!p.doubled && legacyElements.has(p.name));
      const isState = !isElement && stateNames.has(p.name);
      if (!isElement && !isState) continue;
      base += selector.slice(cursor, p.start);
      cursor = p.end;
      if (isElement) pseudoElement = (p.doubled ? "::" : ":") + p.name;
      else states.push(p.name);
    }
    base += selector.slice(cursor);
    base = base.trim();
    // 状態・擬似要素だけのセレクタ（`:hover` 単体等）は、残りが空になるので全称に倒す。
    if (base === "" || /[\s>+~]$/.test(base)) base += "*";

    // `:is()` / `:where()` / `:has()` の引数に状態が入っていると、剥がさない限り matches() が
    // その状態でだけ true になる。ここで拾わないと「当たらない規則」として静かに落ちるので、
    // 判定せず unresolved に回す（`:not()` は状態を否定する側なので対象にしない）。
    let stateInsideFunctional = false;
    for (const p of scanPseudos(base)) {
      if (!p.args) continue;
      if (p.name !== "is" && p.name !== "where" && p.name !== "has") continue;
      for (const inner of scanPseudos(p.args)) {
        if (!inner.doubled && stateNames.has(inner.name)) stateInsideFunctional = true;
      }
    }
    return { base, states, pseudoElement, stateInsideFunctional };
  }

  function readDeclarations(style) {
    const declarations = [];
    for (let i = 0; i < style.length; i++) {
      const property = style[i];
      declarations.push({
        property,
        value: style.getPropertyValue(property),
        important: style.getPropertyPriority(property) === "important",
      });
    }
    return declarations;
  }

  const matched = [];
  const unresolved = [];
  const inaccessible = [];
  const counts = { sheets: 0, style_rules: 0, import_rules: 0, nested_declaration_rules: 0 };
  const seenSheets = new Set();
  let order = 0;

  // 解決済みセレクタリストを 1 件ずつ判定し、当たったものを matched へ、判定できないものを
  // unresolved へ落とす。通常の規則と CSSNestedDeclarations の両方から使う。
  function matchAndRecord(resolved, originalSelector, declarations, ctx) {
    const index = order++;
    for (const part of splitSelectorList(resolved)) {
      const analyzed = analyzeSelector(part);
      if (analyzed.stateInsideFunctional) {
        unresolved.push({
          selector: part,
          original_selector: originalSelector,
          href: ctx.href,
          reason: "state-inside-functional-pseudo",
        });
        continue;
      }
      let hit;
      try {
        hit = el.matches(analyzed.base);
      } catch (e) {
        unresolved.push({
          selector: part,
          original_selector: originalSelector,
          href: ctx.href,
          reason: `matches-threw:${e && e.name ? e.name : "Error"}`,
        });
        continue;
      }
      if (!hit) continue;
      matched.push({
        order: index,
        selector: part,
        original_selector: originalSelector,
        states: analyzed.states,
        pseudo_element: analyzed.pseudoElement,
        conditions: ctx.conditions,
        layers: ctx.layers,
        href: ctx.href,
        declarations,
      });
    }
  }

  function walkRules(rules, ctx) {
    for (const rule of rules) {
      // (1) @import。cssRules を持たないので styleSheet から辿る。ここを飛ばすと
      //     読み込まれた規則が丸ごと視界から消える（例外は出ない）。
      //     `@import url(x) layer(vendor) screen;` の layer / メディア条件は CSSImportRule 側
      //     （layerName / media）にしか無いので、ここで引き継がないと読み込んだ規則が
      //     「レイヤ無し・無条件」として記録される（落ちるのではなく誤った条件が付く）。
      if (rule.styleSheet) {
        counts.import_rules++;
        const mediaText = rule.media && rule.media.mediaText ? rule.media.mediaText : "";
        walkSheet(rule.styleSheet, {
          ...ctx,
          // layerName は無名レイヤで ""、レイヤ無しで null。文字列である限り記録する。
          layers:
            typeof rule.layerName === "string" ? ctx.layers.concat(rule.layerName) : ctx.layers,
          conditions: mediaText ? ctx.conditions.concat(mediaText) : ctx.conditions,
        });
        continue;
      }

      // (2) 通常の規則。CSS 入れ子のため cssRules も持つので、数えたうえで子へも降りる。
      if (rule.selectorText !== undefined) {
        counts.style_rules++;
        const resolved = resolveSelector(rule.selectorText, ctx.parentSelector);
        matchAndRecord(resolved, rule.selectorText, readDeclarations(rule.style), ctx);
        if (rule.cssRules && rule.cssRules.length > 0) {
          walkRules(Array.from(rule.cssRules), { ...ctx, parentSelector: resolved });
        }
        continue;
      }

      // (2.5) 入れ子の途中に現れた裸の宣言（CSSNestedDeclarations。Chrome 130+）。
      //       `.btn { color: red; & .icon { … } background: blue; }` の `background` がこれで、
      //       selectorText も cssRules も持たないため下のどの分岐にも掛からず、
      //       matched / unresolved / counts のどこにも残らずに消える。適用先は囲っている規則の
      //       セレクタなので parentSelector に対して判定する。
      //       parentSelector が無い（トップレベル）ものは @font-face / @page 等なので対象にしない。
      if (ctx.parentSelector && rule.style && !rule.cssRules) {
        counts.nested_declaration_rules++;
        matchAndRecord(ctx.parentSelector, ctx.parentSelector, readDeclarations(rule.style), ctx);
        continue;
      }

      // (3) 条件付きグループ（@media / @supports / @container）。
      if (typeof rule.conditionText === "string" && rule.cssRules) {
        walkRules(Array.from(rule.cssRules), {
          ...ctx,
          conditions: ctx.conditions.concat(rule.conditionText),
        });
        continue;
      }

      // (4) 名前付きグループ。@layer は降りる。@keyframes は子が keyText を持つので識別して飛ばす
      //     （子は selectorText を持たないため降りても無害だが、レイヤ名として数えない）。
      if (typeof rule.name === "string" && rule.cssRules) {
        const children = Array.from(rule.cssRules);
        if (children.some((child) => child && child.keyText !== undefined)) continue;
        walkRules(children, { ...ctx, layers: ctx.layers.concat(rule.name) });
        continue;
      }

      // (5) それ以外のグループ（@scope 等、conditionText も name も持たないもの）。
      if (rule.cssRules) walkRules(Array.from(rule.cssRules), ctx);
    }
  }

  function walkSheet(sheet, ctx) {
    if (!sheet || seenSheets.has(sheet)) return;
    seenSheets.add(sheet);
    counts.sheets++;
    const href = sheet.href || (ctx && ctx.href) || null;
    let rules;
    try {
      rules = sheet.cssRules;
    } catch (e) {
      // クロスオリジンのスタイルシートは cssRules の参照で SecurityError を投げる。
      // 握り潰すと「規則が無い」と区別できないので、必ず出力に残す。
      inaccessible.push({ href, error: e && e.name ? e.name : "Error" });
      return;
    }
    // @import から来た場合は呼び出し元の条件・レイヤを引き継ぐ（ここで [] に戻すと
    // `@import url(x) layer(vendor);` の layer が読み込んだ規則に付かない）。
    walkRules(Array.from(rules), {
      conditions: (ctx && ctx.conditions) || [],
      layers: (ctx && ctx.layers) || [],
      parentSelector: null,
      href,
    });
  }

  const roots = [];
  const root = el.getRootNode();
  if (root && root !== el.ownerDocument && root.styleSheets) roots.push(root);
  roots.push(el.ownerDocument);
  for (const node of roots) {
    for (const sheet of Array.from(node.styleSheets || [])) walkSheet(sheet, null);
    for (const sheet of Array.from(node.adoptedStyleSheets || [])) walkSheet(sheet, null);
  }

  return {
    matched,
    unresolved,
    inaccessible,
    counts: { ...counts, matched: matched.length },
    shadow_root: root !== el.ownerDocument,
  };
}

/**
 * 論理名を付けた要素ごとに、当たっている CSS 規則を採る。
 *
 * @param {{ name: string, locator: { evaluate: Function } }[]} entries 論理名と Playwright Locator の組
 * @param {{ statePseudoClasses?: readonly string[] }} [options]
 * @returns {Promise<object[]>} 論理名ごとの採取結果
 */
export async function captureMatchedRules(entries, options = {}) {
  const resolved = {
    statePseudoClasses: options.statePseudoClasses || STATE_PSEUDO_CLASSES,
  };
  const results = [];
  for (const entry of entries) {
    const captured = await entry.locator.evaluate(collectMatchedRules, resolved);
    results.push({ name: entry.name, tool_version: VERSION, ...captured });
  }
  return results;
}
