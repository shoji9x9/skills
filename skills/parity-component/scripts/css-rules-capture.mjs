// 当たっている CSS 規則の採取（正本）。
// 正本はこのスキル側にあり、**プロジェクトへコピーせずスキル配下からそのまま実行する**
// （`gh skill update` の自動更新を効かせるため。SKILL.md「成果物」と references/capture.md が同じ規約）。
// `<parity_suite_dir>/parity/lib/tools/vendor/` へコピーするのは `parity-suite` 同梱の差分器・
// 特性採取ツールの側で、本スクリプトは対象外。
//
// 何を採るか: 論理名を付けた要素に当たりうる CSS 規則を、宣言（プロパティ・値・`!important`）・
// 成立に必要な状態擬似クラス・擬似要素・条件（`@media` / `@supports` / `@container`）・
// カスケードレイヤ・出所（スタイルシートの URL と規則の位置）付きで列挙する。
// 併せて `style` 属性の宣言を `inline_declarations` として採る（どのスタイルシートにも現れず、
// 規則走査だけでは 1 件も残らない。インスタンス固有の値がここで当たっている部品では、
// 出所と `!important` の優先度が計算後スタイルから復元できない）。
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
 * 2: `inline_declarations`（style 属性の宣言）と `counts.outer_scope_skipped` を追加し、
 *    シャドウツリー内の要素では走査を自分の根に限定した（外側 document の規則は
 *    カプセル化で当たらないため matched に入れず、`::part()` だけ unresolved に残す）。
 *    1 で採った css-rules.json は、インライン指定が「無い」のか「採っていない」のか区別できず、
 *    シャドウ部品では外側の規則を当たったものとして含んでいるので再採取する。
 *    ホスト自身のシャドウルートは `:host` 系だけを unresolved に残し、残りを
 *    `counts.host_scope_skipped` に数える（`shadow_host` で対象がホストだったかを出す）。
 *    **2 の定義はこの PR がマージされた状態を指す**——版を上げてから同じ PR 内で 2 の形を
 *    足しているが、2 が main へ出たことは一度も無いので、外に「別の 2」で採った成果物は存在しない。
 * metadata.json の `capture.tools.css_rules_version` に記録する値はこれを使う（手入力にしない）。
 * @type {string}
 */
export const VERSION = "2";

/**
 * 構造・関係を表す擬似クラスで、状態ではないもの（セレクタに残したまま matches() へ渡してよい）。
 * この集合にも STATE_PSEUDO_CLASSES にも無い擬似クラスは**未知**として unresolved に落とす——
 * `:popover-open` / `:user-valid` / `:fullscreen` のような動的状態を知らないまま残すと、
 * その状態でない要素に対して matches() が false を返し、当たるはずの規則が記録も警告も無く消える。
 * 集合を増やすときは「その状態でなくても当たるか（構造）」「状態のときだけ当たるか（状態）」で分ける。
 * @type {readonly string[]}
 */
export const STRUCTURAL_PSEUDO_CLASSES = [
  "any-link",
  "dir",
  "empty",
  "first-child",
  "first-of-type",
  "has",
  "host",
  "host-context",
  "is",
  "lang",
  "last-child",
  "last-of-type",
  "matches",
  "not",
  "nth-child",
  "nth-last-child",
  "nth-last-of-type",
  "nth-of-type",
  "only-child",
  "only-of-type",
  "root",
  "scope",
  "where",
];

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
  const structuralNames = new Set(options.structuralPseudoClasses || []);

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
      // 引用符の外のエスケープ（`.foo\\,bar` の `\\,` 等）は次の 1 文字ごと読み飛ばす。
      // 飛ばさないとエスケープされた区切り文字で分割し、断片が無効セレクタになって静かに落ちる。
      if (c === "\\") {
        i++;
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
    // `&` は文字列リテラルと属性セレクタの中にも現れる（`& [data-label="A&B"]`）。素朴な
    // split("&").join(...) はその `&` まで置換し、属性値の中に `:is(...)` が入った不正な
    // セレクタになる。matches() は throw せず false を返すので、当たるはずの規則が静かに落ちる。
    // 置換するのは引用符・角括弧の外にある `&` だけにする。
    const replaceNestingTokens = (part) => {
      let out = "";
      let depth = 0;
      let quote = null;
      let replaced = false;
      for (let i = 0; i < part.length; i++) {
        const c = part[i];
        if (quote) {
          out += c;
          if (c === "\\") {
            if (i + 1 < part.length) out += part[++i];
          } else if (c === quote) quote = null;
          continue;
        }
        if (c === "\\") {
          out += c;
          if (i + 1 < part.length) out += part[++i]; // エスケープされた `&` は入れ子の印ではない
          continue;
        }
        if (c === '"' || c === "'") {
          quote = c;
          out += c;
          continue;
        }
        if (c === "[") depth++;
        else if (c === "]") depth--;
        else if (c === "&" && depth === 0) {
          out += parent;
          replaced = true;
          continue;
        }
        out += c;
      }
      return { text: out, replaced };
    };
    return splitSelectorList(selectorText)
      .map((part) => {
        const r = replaceNestingTokens(part);
        return r.replaced ? r.text : `${parent} ${part}`;
      })
      .join(", ");
  }

  // `selector[open]` の `(` に対応する `)` の次の位置を返す。引用符・エスケープ・角括弧を
  // 見ない素朴な括弧勘定だと、文字列や属性セレクタに入った括弧で釣り合いが崩れる——
  // `.button:has([data-label="("]):hover` は `:hover` まで引数として食い、状態が剥がれないまま
  // matches() へ渡って（hover していない要素では）規則が黙って落ちる。scanPseudos の
  // トップレベル走査と同じ規則で数える。閉じないまま終端に達したら末尾を返す（呼び出し側の
  // slice が壊れた引数を返し、未知の擬似クラス扱いで unresolved に落ちる）。
  function skipBalanced(selector, open) {
    let depth = 0;
    let quote = null;
    for (let i = open; i < selector.length; i++) {
      const c = selector[i];
      if (quote) {
        if (c === "\\") i++;
        else if (c === quote) quote = null;
        continue;
      }
      if (c === "\\") {
        i++;
        continue;
      }
      if (c === '"' || c === "'") {
        quote = c;
        continue;
      }
      if (c === "(" || c === "[") depth++;
      else if (c === ")" || c === "]") {
        depth--;
        if (depth === 0) return i + 1;
      }
    }
    return selector.length;
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
      if (c === "\\") {
        i++; // 引用符の外のエスケープ（`\\:` 等）。飛ばさないと擬似クラスの開始と誤読する
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
          const argStart = j + 1;
          j = skipBalanced(selector, j);
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
    // 入れ子は 1 段とは限らない。`.card:is(:has(:hover))` は第 1 段に `:has` しか見えないので、
    // 直下だけを見る実装では「状態は無い」と判定され、hover していない要素に対して
    // matches() が false を返して規則が黙って消える。段数を決め打ちせず降りる。
    // `:not()` は状態を否定する側なので降りない（否定の中の状態は、その状態でないときに当たる）。
    const hasStateInsideFunctional = (selector) => {
      for (const p of scanPseudos(selector)) {
        if (!p.args || p.doubled) continue;
        if (p.name === "not") continue;
        // セレクタを引数に取る擬似クラスは `:is()` / `:where()` / `:has()` だけではない——
        // `:nth-child(2n of .item:hover)` / `:host(.foo:hover)` にも状態を置ける。
        // 名前で絞ると、絞り漏れた擬似クラスの中の状態が base に残り、通常状態の matches() が
        // false を返して規則が matched にも unresolved にも残らない。`:not()` 以外は一律に見る。
        for (const inner of scanPseudos(p.args)) {
          if (!inner.doubled && stateNames.has(inner.name)) return true;
        }
        if (hasStateInsideFunctional(p.args)) return true;
      }
      return false;
    };
    const stateInsideFunctional = hasStateInsideFunctional(base);
    // 剥がしも許容もできない擬似クラスが残っていたら、当たる／当たらないを決めずに残す。
    const unknownPseudos = [];
    for (const p of scanPseudos(base)) {
      if (p.doubled) continue;
      if (stateNames.has(p.name) || structuralNames.has(p.name)) continue;
      unknownPseudos.push(p.name);
    }
    return { base, states, pseudoElement, stateInsideFunctional, unknownPseudos };
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
  const counts = {
    sheets: 0,
    style_rules: 0,
    import_rules: 0,
    nested_declaration_rules: 0,
    outer_scope_skipped: 0,
    host_scope_skipped: 0,
    slotted_scope_skipped: 0,
  };
  const seenSheets = new Map();
  let order = 0;

  // 解決済みセレクタリストを 1 件ずつ判定し、当たったものを matched へ、判定できないものを
  // unresolved へ落とす。通常の規則と CSSNestedDeclarations の両方から使う。
  function matchAndRecord(resolved, originalSelector, declarations, ctx) {
    const index = order++;
    for (const part of splitSelectorList(resolved)) {
      // シャドウツリーの外の規則。`::part()` だけが中へ届くが、本ツールは part 名を解決しないので
      // 当たる側にも当たらない側にも倒さず残す。それ以外の外側の規則はカプセル化で届かないので
      // matched には入れず、数だけ残す（0 件を「外側に規則が無い」と読まないため）。
      // ホスト自身のシャドウルートの規則。ホストに効くのは `:host` 系だけで、それ以外は
      // シャドウの中の要素に当たる規則なのでホストの基準ではない。
      // スロット側のシャドウルートの規則。ライト DOM の要素へ届くのは `::slotted()` だけで、
      // 引数の解決は本ツールの射程外なので、当たった側へ倒さず残す。
      if (ctx.slottedScope) {
        if (part.includes("::slotted(")) {
          unresolved.push({
            selector: part,
            original_selector: originalSelector,
            href: ctx.href,
            reason: "slotted-not-evaluated",
          });
        } else counts.slotted_scope_skipped++;
        continue;
      }
      if (ctx.hostScope) {
        if (part.includes(":host")) {
          unresolved.push({
            selector: part,
            original_selector: originalSelector,
            href: ctx.href,
            reason: "host-scope-not-evaluated",
          });
        } else counts.host_scope_skipped++;
        continue;
      }
      if (ctx.outerScope) {
        if (part.includes("::part(")) {
          unresolved.push({
            selector: part,
            original_selector: originalSelector,
            href: ctx.href,
            reason: "shadow-part-not-evaluated",
          });
        } else counts.outer_scope_skipped++;
        continue;
      }
      // @scope の中の規則は、セレクタが当たってもスコープ根・限界の外では適用されない。
      // 本ツールはスコープを評価しないので、当たった側へ倒さず判定不能として残す。
      if (ctx.scope) {
        unresolved.push({
          selector: part,
          original_selector: originalSelector,
          href: ctx.href,
          reason: `scope-not-evaluated:${ctx.scope}`,
        });
        continue;
      }
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
      if (analyzed.unknownPseudos.length > 0) {
        unresolved.push({
          selector: part,
          original_selector: originalSelector,
          href: ctx.href,
          reason: `unknown-pseudo-class:${analyzed.unknownPseudos.join(",")}`,
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
      if ("styleSheet" in rule) {
        counts.import_rules++;
        // 読み込めていない `@import`（未ロード・404・解析失敗）は `styleSheet` が null になる。
        // 真偽値で分岐すると、どの分岐にも掛からないまま静かに消え、「その @import の先に
        // 関係する規則が無い」と区別できなくなる（本ツールが塞ごうとしている fail-open そのもの）。
        // 規則の種別は `styleSheet` の**有無**で判定し、null は採れなかった事実として残す。
        if (!rule.styleSheet) {
          inaccessible.push({
            href: (typeof rule.href === "string" && rule.href) || ctx.href || null,
            error: "ImportNotLoaded",
          });
          continue;
        }
        const mediaText = rule.media && rule.media.mediaText ? rule.media.mediaText : "";
        // `@import url(x) supports(display: grid) screen;` の supports 条件は supportsText にしか無い。
        // 引き継がないと、読み込んだ規則が「無条件」として記録され、なぜ効いているかを説明できなくなる。
        const supportsText = typeof rule.supportsText === "string" ? rule.supportsText : "";
        walkSheet(rule.styleSheet, {
          ...ctx,
          // layerName は無名レイヤで ""、レイヤ無しで null。文字列である限り記録する。
          layers:
            typeof rule.layerName === "string" ? ctx.layers.concat(rule.layerName) : ctx.layers,
          conditions: [
            ...ctx.conditions,
            ...(supportsText ? [`supports(${supportsText})`] : []),
            ...(mediaText ? [mediaText] : []),
          ],
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

      // (5) @scope。子の規則はスコープ根と限界の中でしか当たらないが、本ツールはセレクタしか
      //     見ないので、`@scope (.dialog) { .button {...} }` を .dialog の外の .button にも
      //     当たったと報告してしまう（偽の根拠になる）。スコープを評価せず unresolved に回す。
      if (rule.cssRules && (rule.start !== undefined || rule.end !== undefined)) {
        walkRules(Array.from(rule.cssRules), { ...ctx, scope: rule.start || "(implicit)" });
        continue;
      }

      // (6) それ以外のグループ（conditionText も name も start/end も持たないもの）。
      if (rule.cssRules) walkRules(Array.from(rule.cssRules), ctx);
    }
  }

  function walkSheet(sheet, ctx) {
    if (!sheet) return;
    // 重複排除はスコープ込みで行う。シート単位にすると、同じ CSSStyleSheet を
    // `shadowRoot.adoptedStyleSheets` と document で共有している構成で、内側を先に走った時点で
    // 既読になり、外側スコープの走査が丸ごと飛ぶ。`::part()` が unresolved に残らず
    // `outer_scope_skipped` も増えない——「判定できない規則を黙って落とさない」契約に反する。
    const scope =
      ctx && ctx.outerScope
        ? "outer"
        : ctx && ctx.hostScope
          ? "host"
          : ctx && ctx.slottedScope
            ? "slotted"
            : "own";
    const seen = seenSheets.get(scope) || new Set();
    if (seen.has(sheet)) return;
    seen.add(sheet);
    seenSheets.set(scope, seen);
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
      outerScope: Boolean(ctx && ctx.outerScope),
      hostScope: Boolean(ctx && ctx.hostScope),
      slottedScope: Boolean(ctx && ctx.slottedScope),
    });
  }

  // 走査するのは**その要素の根**だけ。シャドウツリーの中の要素に対して外側の document の
  // スタイルシートまで走ると、`el.matches(".btn")` は true を返すのに実際には
  // カプセル化で当たらない規則を「当たっている」として記録し、部品の基準が偽になる。
  // 外側から中へ届くのは `::part()` だけなので、それを黙って捨てず unresolved に残す。
  const root = el.getRootNode();
  const inShadow = Boolean(root && root !== el.ownerDocument && root.styleSheets);
  const ownRoot = inShadow ? root : el.ownerDocument;
  for (const sheet of Array.from(ownRoot.styleSheets || [])) walkSheet(sheet, null);
  for (const sheet of Array.from(ownRoot.adoptedStyleSheets || [])) walkSheet(sheet, null);
  if (inShadow) {
    const outer = el.ownerDocument;
    for (const sheet of Array.from(outer.styleSheets || [])) walkSheet(sheet, { outerScope: true });
    for (const sheet of Array.from(outer.adoptedStyleSheets || [])) {
      walkSheet(sheet, { outerScope: true });
    }
  }
  // 対象がカスタム要素のホストのとき、`getRootNode()` は document を返すので上の分岐に入らない。
  // だがホストの見た目を決めているのは**そのホスト自身のシャドウルート**の `:host` 規則で、
  // それを走らないと「CSS 規則が 1 件も当たっていない部品」という誤った基準が出る。
  // `:host()` / `:host-context()` の引数解決は本ツールの射程外なので、当たった側へ倒さず残す。
  // ライト DOM の要素がシャドウの `<slot>` に割り当てられているとき、その要素に効く
  // `::slotted()` 規則は**スロット側のシャドウルート**にある。`getRootNode()` は document を
  // 返すのでここまで辿らないと見えず、規則を 1 件も採らないまま基準が出る。
  const slotRoot =
    el.assignedSlot && el.assignedSlot.getRootNode ? el.assignedSlot.getRootNode() : null;
  if (slotRoot && slotRoot !== el.ownerDocument && slotRoot.styleSheets) {
    for (const sheet of Array.from(slotRoot.styleSheets || [])) {
      walkSheet(sheet, { slottedScope: true });
    }
    for (const sheet of Array.from(slotRoot.adoptedStyleSheets || [])) {
      walkSheet(sheet, { slottedScope: true });
    }
  }
  if (el.shadowRoot && el.shadowRoot.styleSheets) {
    for (const sheet of Array.from(el.shadowRoot.styleSheets || [])) {
      walkSheet(sheet, { hostScope: true });
    }
    for (const sheet of Array.from(el.shadowRoot.adoptedStyleSheets || [])) {
      walkSheet(sheet, { hostScope: true });
    }
  }

  // style 属性の宣言はどのスタイルシートにも現れないので、上の走査では 1 件も採れない。
  // 計算後スタイルは結果の値しか持たないため、ここを採らないと「その値がインスタンス固有の
  // インライン指定で来ている」ことも `!important` の優先度も実装時に復元できない
  // （インスタンス固有の幅を style で当てている現行部品が典型）。
  // 規則ではないので matched へ混ぜず、別の出所として並べる。
  const inlineDeclarations = el.style ? readDeclarations(el.style) : [];

  return {
    matched,
    unresolved,
    inaccessible,
    inline_declarations: inlineDeclarations,
    shadow_host: Boolean(el.shadowRoot && el.shadowRoot.styleSheets),
    slotted: Boolean(slotRoot && slotRoot !== el.ownerDocument && slotRoot.styleSheets),
    counts: { ...counts, matched: matched.length, inline_declarations: inlineDeclarations.length },
    shadow_root: inShadow,
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
    structuralPseudoClasses: options.structuralPseudoClasses || STRUCTURAL_PSEUDO_CLASSES,
  };
  const results = [];
  for (const entry of entries) {
    const captured = await entry.locator.evaluate(collectMatchedRules, resolved);
    results.push({ name: entry.name, tool_version: VERSION, ...captured });
  }
  return results;
}
