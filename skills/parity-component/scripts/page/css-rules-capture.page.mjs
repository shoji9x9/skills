// css-rules-capture.mjs が Playwright の locator.evaluate へ渡す、ページで実行する本体（collectInPage）。
// evaluate は渡した関数のソースだけをページへ送るので、本体はこのファイルの外の名前を参照できない。
// そのため、このファイルは import を持たず、本体が呼ぶ関数はすべて本体の中に入れ子で書く。
// 本体が使う集合（状態擬似クラス・構造擬似クラス）は、css-rules-capture.mjs が引数で渡す。
// Node から呼ぶテストも、このファイルの collectInPage をそのまま呼ぶ。
// 出力の形（採る値・キー・正規化）を変えたら、css-rules-capture.mjs の VERSION を上げる（このファイルはコピーせずに使うので、版は持たない）。

/**
 * 宣言 1 件（規則の中の宣言と、style 属性の宣言の両方）。
 * @typedef {{ property: string, value: string, important: boolean }} CssDeclaration
 */

/**
 * 要素に当たった規則 1 件（セレクタリストは 1 件ずつに分けて記録する）。
 * @typedef {{
 *   order: number,
 *   selector: string,
 *   original_selector: string,
 *   states: string[],
 *   pseudo_element: string | null,
 *   conditions: string[],
 *   layers: string[],
 *   href: string | null,
 *   declarations: CssDeclaration[],
 * }} MatchedRule
 */

/**
 * 当たるかを判定しなかった規則 1 件。reason に判定しなかった理由を書く。
 * @typedef {{ selector: string, original_selector: string, href: string | null, reason: string }} UnresolvedRule
 */

/**
 * 規則を読めなかったスタイルシート 1 件。
 * @typedef {{ href: string | null, error: string }} InaccessibleSheet
 */

/**
 * 1 つの要素の採取の結果。
 * @typedef {{
 *   matched: MatchedRule[],
 *   unresolved: UnresolvedRule[],
 *   inaccessible: InaccessibleSheet[],
 *   inline_declarations: CssDeclaration[],
 *   shadow_host: boolean,
 *   slotted: boolean,
 *   counts: {
 *     sheets: number,
 *     style_rules: number,
 *     import_rules: number,
 *     nested_declaration_rules: number,
 *     outer_scope_skipped: number,
 *     host_scope_skipped: number,
 *     slotted_scope_skipped: number,
 *     matched: number,
 *     inline_declarations: number,
 *   },
 *   shadow_root: boolean,
 * }} MatchedRulesCapture
 */

/**
 * 宣言を読む相手（CSSStyleDeclaration と同じ読み方ができるもの）。
 * @typedef {{
 *   length: number,
 *   [index: number]: string,
 *   getPropertyValue(property: string): string,
 *   getPropertyPriority(property: string): string,
 * }} CssStyleLike
 */

/**
 * 走査する規則 1 件。CSSRule の種類ごとに持つ欄が違うので、欄の有無で種類を見分ける（どの欄も無いことがある）。
 * cssText は CSSRule と共通の欄で、CSSRule をこの形として受け取るために置く（判定には使わない）。
 * @typedef {{
 *   cssText?: string,
 *   styleSheet?: CssSheetLike | null,
 *   href?: unknown,
 *   media?: { mediaText?: string } | null,
 *   supportsText?: unknown,
 *   layerName?: unknown,
 *   selectorText?: string,
 *   style?: CssStyleLike,
 *   cssRules?: ArrayLike<CssRuleLike> | null,
 *   conditionText?: unknown,
 *   name?: unknown,
 *   keyText?: unknown,
 *   start?: unknown,
 *   end?: unknown,
 * }} CssRuleLike
 */

/**
 * 走査するスタイルシート 1 件（CSSStyleSheet と同じ読み方ができるもの）。
 * @typedef {{ href?: string | null, cssRules: ArrayLike<CssRuleLike> }} CssSheetLike
 */

/**
 * スタイルシートを持つ根（document かシャドウルート）。
 * @typedef {{ styleSheets?: ArrayLike<CssSheetLike> | null, adoptedStyleSheets?: ArrayLike<CssSheetLike> | null }} SheetRoot
 */

/**
 * 規則を走査するときの文脈（どの条件・レイヤ・スコープの中か）。
 * @typedef {{
 *   conditions: string[],
 *   layers: string[],
 *   parentSelector: string | null,
 *   href: string | null,
 *   outerScope: boolean,
 *   hostScope: boolean,
 *   slottedScope: boolean,
 *   scope?: string,
 * }} WalkContext
 */

/**
 * セレクタのトップレベルで見つけた擬似クラス・擬似要素 1 件。
 * @typedef {{ start: number, end: number, name: string, doubled: boolean, args: string | null }} PseudoToken
 */

/**
 * 1 回の採取の状態（本体の中の関数が読み書きする）。
 * @typedef {{
 *   el: Element,
 *   stateNames: Set<string>,
 *   structuralNames: Set<string>,
 *   matched: MatchedRule[],
 *   unresolved: UnresolvedRule[],
 *   inaccessible: InaccessibleSheet[],
 *   counts: {
 *     sheets: number,
 *     style_rules: number,
 *     import_rules: number,
 *     nested_declaration_rules: number,
 *     outer_scope_skipped: number,
 *     host_scope_skipped: number,
 *     slotted_scope_skipped: number,
 *   },
 *   seenSheets: Map<string, Set<CssSheetLike>>,
 *   order: number,
 * }} CaptureRun
 */

/**
 * 判定する規則 1 件（解決済みのセレクタリスト・元のセレクタ・宣言）。
 * @typedef {{ resolved: string, originalSelector: string, declarations: CssDeclaration[] }} RuleToMatch
 */

/**
 * 要素に当たりうる CSS 規則を採る（ページ側で実行される本体）。
 * evaluate は関数のソースだけを送るので、本体が呼ぶ関数はすべてこの中に入れ子で書き、本体の外の名前を参照しない。
 * @param {Element} el 対象の要素。
 * @param {{ statePseudoClasses: readonly string[], structuralPseudoClasses?: readonly string[] }} options
 *   状態擬似クラスと構造擬似クラスの集合。
 * @returns {MatchedRulesCapture}
 */
export function collectInPage(el, options) {
  /**
   * 例外の名前。name が空でない文字列でなければ "Error" を返す。
   * @param {unknown} e
   * @returns {string}
   */
  function errorName(e) {
    const name = typeof e === "object" && e !== null && "name" in e ? e.name : undefined;
    return typeof name === "string" && name ? name : "Error";
  }

  /**
   * スタイルシートを持つ根か（`node.styleSheets` が真の値か）。
   * @param {unknown} node
   * @returns {node is SheetRoot}
   */
  function hasStyleSheets(node) {
    return (
      typeof node === "object" &&
      node !== null &&
      "styleSheets" in node &&
      Boolean(node.styleSheets)
    );
  }

  /**
   * style 属性の宣言を持つ要素か（`node.style` が真の値か）。
   * @param {Element} node
   * @returns {node is Element & { style: CssStyleLike }}
   */
  function hasStyle(node) {
    return "style" in node && Boolean(node.style);
  }

  /**
   * 引用符の中の文字・エスケープ・引用符の開始を 1 件読み進める。
   * 読み進めたら、読んだ最後の位置と引用符の状態を返す。引用符の外の通常の文字なら null を返す。
   * 引用符の外のエスケープ（`.foo\\,bar` の `\\,`、`\\:` 等）も次の 1 文字ごと読み飛ばす。
   * 飛ばさないと、エスケープされた区切り文字や `:` を、区切りや擬似クラスの開始と誤読する。
   * @param {string} text
   * @param {number} i いま見ている位置
   * @param {string | null} quote いま中にいる引用符（外なら null）
   * @returns {{ i: number, quote: string | null } | null}
   */
  function stepQuoted(text, i, quote) {
    const c = text[i];
    if (c === "\\") return { i: i + 1, quote };
    if (quote) return { i, quote: c === quote ? null : quote };
    if (c === '"' || c === "'") return { i, quote: c };
    return null;
  }

  /**
   * 引用符の外にある文字を先頭から 1 件ずつ visit に渡す。括弧（`(`・`[`）の深さを数え、その文字を読んだ後の深さも渡す。
   * visit が数値を返したら、その位置まで読んだものとして続きから走査する。null を返したら走査を止め、その位置を返す。
   * @param {string} text
   * @param {number} start 走査を始める位置
   * @param {(c: string, i: number, depth: number) => number | null | undefined} visit
   * @returns {number} 止めた位置（最後まで走査したら -1）
   */
  function scanUnquoted(text, start, visit) {
    let depth = 0;
    let quote = null;
    for (let i = start; i < text.length; i++) {
      const step = stepQuoted(text, i, quote);
      if (step) {
        ({ i, quote } = step);
        continue;
      }
      const c = text[i];
      if (c === "(" || c === "[") depth++;
      else if (c === ")" || c === "]") depth--;
      const next = visit(c, i, depth);
      if (next === null) return i;
      if (next !== undefined) i = next;
    }
    return -1;
  }

  /**
   * セレクタリストをトップレベルのカンマで割る（括弧・文字列の中のカンマは区切りにしない）。
   * @param {string} text
   * @returns {string[]}
   */
  function splitSelectorList(text) {
    /** @type {string[]} */
    const parts = [];
    let start = 0;
    // エスケープされた区切り文字で分割すると、断片が無効なセレクタになって警告なしに捨てられる（stepQuoted）。
    scanUnquoted(text, 0, (c, i, depth) => {
      if (c === "," && depth === 0) {
        parts.push(text.slice(start, i).trim());
        start = i + 1;
      }
      return undefined;
    });
    parts.push(text.slice(start).trim());
    return parts.filter((p) => p.length > 0);
  }

  /**
   * セレクタ 1 件の、引用符・角括弧の外にある `&` を parent に置き換える。
   * `&` は文字列リテラルと属性セレクタの中にも現れる（`& [data-label="A&B"]`）。素朴な
   * split("&").join(...) はその `&` まで置換し、属性値の中に `:is(...)` が入った不正な
   * セレクタになる。matches() は throw せず false を返すので、当たるはずの規則が警告なしに消える。
   * @param {string} part
   * @param {string} parent
   * @returns {{ text: string, replaced: boolean }}
   */
  function replaceNestingTokens(part, parent) {
    let out = "";
    let depth = 0;
    let quote = null;
    let replaced = false;
    for (let i = 0; i < part.length; i++) {
      // 引用符の中と、エスケープされた `&` は入れ子の印ではないので、読んだ文字をそのまま出す。
      const step = stepQuoted(part, i, quote);
      if (step) {
        out += part.slice(i, step.i + 1);
        ({ i, quote } = step);
        continue;
      }
      const c = part[i];
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
  }

  /**
   * 入れ子の `&` を親セレクタで解決する。
   * 実測どおり Chrome は入れ子の selectorText に `&` を残すが、`&` が無い形で返る実装に備えて
   * その場合は子孫結合（CSS 入れ子の既定）として親を前置する。
   * @param {string} selectorText
   * @param {string | null} parentSelector
   * @returns {string}
   */
  function resolveSelector(selectorText, parentSelector) {
    if (!parentSelector) return selectorText;
    const parent = `:is(${parentSelector})`;
    // 置換するのは引用符・角括弧の外にある `&` だけにする（replaceNestingTokens）。
    return splitSelectorList(selectorText)
      .map((part) => {
        const r = replaceNestingTokens(part, parent);
        return r.replaced ? r.text : `${parent} ${part}`;
      })
      .join(", ");
  }

  /**
   * `selector[open]` の `(` に対応する `)` の次の位置を返す。
   * 引用符・エスケープ・角括弧を見ない素朴な括弧の勘定では、文字列や属性セレクタに入った括弧で釣り合いが合わなくなる。
   * `.button:has([data-label="("]):hover` は `:hover` まで引数として読み、状態が剥がれないまま
   * matches() へ渡る。すると、hover していない要素では規則が警告なしに消える。scanPseudos の
   * トップレベルの走査と同じ規則で数える。閉じないまま終端に達したら末尾を返す（呼び出し側の
   * slice が不正な引数を返し、未知の擬似クラスとして unresolved に入る）。
   * @param {string} selector
   * @param {number} open
   * @returns {number}
   */
  function skipBalanced(selector, open) {
    const close = scanUnquoted(selector, open, (c, _i, depth) =>
      (c === ")" || c === "]") && depth === 0 ? null : undefined,
    );
    return close < 0 ? selector.length : close + 1;
  }

  /**
   * `selector[i]` の `:` から始まる擬似クラス・擬似要素 1 件を読む。
   * @param {string} selector
   * @param {number} i `:` の位置
   * @returns {PseudoToken}
   */
  function readPseudo(selector, i) {
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
    // 擬似クラス・擬似要素の名前は ASCII の大文字小文字を区別しない（`:HOVER` は `:hover`、
    // `::PART(label)` は `::part(label)`）。ここで正規化しないと、名前で引く判定がすべて
    // 小文字の綴りだけを認識し、`.host::PART(label)` は擬似要素として剥がされて `.host` に当たり、
    // `:HOVER` は未知の擬似クラスとして unresolved に入る。`[-\w]` は ASCII なので toLowerCase で足りる。
    return { start: i, end: j, name: name.toLowerCase(), doubled, args };
  }

  /**
   * トップレベル（括弧の外）の擬似クラス・擬似要素を切り出す。
   * @param {string} selector
   * @returns {PseudoToken[]}
   */
  function scanPseudos(selector) {
    /** @type {PseudoToken[]} */
    const found = [];
    scanUnquoted(selector, 0, (c, i, depth) => {
      if (c !== ":" || depth !== 0) return undefined;
      const token = readPseudo(selector, i);
      found.push(token);
      return token.end - 1;
    });
    return found;
  }

  /**
   * セレクタ（関数型擬似クラスの引数の中も含む）に条件を満たす擬似クラス・擬似要素があるか。
   * 文字列の部分一致（`includes(":host")`）で判定すると、名前の大文字小文字を区別してしまい、
   * 属性値の中の `"::part(x)"` にも当たる。名前は scanPseudos が正規化したものを見る。
   * @param {string} selector
   * @param {(p: PseudoToken) => boolean} predicate
   * @returns {boolean}
   */
  function hasPseudo(selector, predicate) {
    for (const p of scanPseudos(selector)) {
      if (predicate(p)) return true;
      if (p.args && hasPseudo(p.args, predicate)) return true;
    }
    return false;
  }

  /**
   * `::slotted()` か。
   * @param {PseudoToken} p
   * @returns {boolean}
   */
  function isSlotted(p) {
    return p.doubled && p.name === "slotted" && p.args !== null;
  }

  /**
   * `::part()` か。
   * @param {PseudoToken} p
   * @returns {boolean}
   */
  function isPart(p) {
    return p.doubled && p.name === "part" && p.args !== null;
  }

  /**
   * `:host` / `:host-context` か。
   * @param {PseudoToken} p
   * @returns {boolean}
   */
  function isHost(p) {
    return !p.doubled && (p.name === "host" || p.name === "host-context");
  }

  /**
   * 関数型擬似クラスの引数の中に状態擬似クラスがあるか。
   * `:is()` / `:where()` / `:has()` の引数に状態が入っていると、剥がさない限り matches() が
   * その状態でだけ true になる。ここで拾わないと「当たらない規則」として警告なしに消えるので、
   * 判定せず unresolved に回す（`:not()` は状態を否定する側なので対象にしない）。
   * 入れ子は 1 段とは限らない。`.card:is(:has(:hover))` は第 1 段に `:has` しか見えないので、
   * 直下だけを見る実装では「状態は無い」と判定され、hover していない要素に対して
   * matches() が false を返して、規則が警告なしに消える。段数を決め打ちせずに降りる。
   * `:not()` は状態を否定する側なので降りない（否定の中の状態は、その状態でないときに当たる）。
   * @param {string} selector
   * @param {Set<string>} stateNames
   * @returns {boolean}
   */
  function hasStateInsideFunctional(selector, stateNames) {
    for (const p of scanPseudos(selector)) {
      if (!p.args || p.doubled) continue;
      if (p.name === "not") continue;
      // セレクタを引数に取る擬似クラスは `:is()` / `:where()` / `:has()` だけではない。
      // `:nth-child(2n of .item:hover)` / `:host(.foo:hover)` にも状態を置ける。
      // 名前で絞ると、絞りきれなかった擬似クラスの中の状態が base に残り、通常状態の matches() が
      // false を返して規則が matched にも unresolved にも残らない。`:not()` 以外は一律に見る。
      for (const inner of scanPseudos(p.args)) {
        if (!inner.doubled && stateNames.has(inner.name)) return true;
      }
      if (hasStateInsideFunctional(p.args, stateNames)) return true;
    }
    return false;
  }

  /**
   * 剥がしも許容もできない擬似クラスの名前（入れ子の中も含む。並びは出現順）。
   * **入れ子の中も見る**。`:is()` / `:not()` 等の引数に未知の動的擬似クラスが入っていると
   * （`.card:is(.item:popover-open)`）、外側は構造擬似クラスとして許容され、内側は
   * 状態集合にも構造集合にも無いまま matches() へ渡る。その状態でない要素では false が
   * 返り、規則が matched にも unresolved にも残らずに消える。
   * @param {string} selector
   * @param {{ stateNames: Set<string>, structuralNames: Set<string> }} names
   * @returns {string[]}
   */
  function unknownPseudos(selector, names) {
    /** @type {string[]} */
    const found = [];
    for (const p of scanPseudos(selector)) {
      if (!p.doubled && !names.stateNames.has(p.name) && !names.structuralNames.has(p.name)) {
        found.push(p.name);
      }
      if (p.args) found.push(...unknownPseudos(p.args, names));
    }
    return found;
  }

  /**
   * 状態擬似クラスと擬似要素を剥がし、残り（base）と剥がしたものを返す。
   * @param {string} selector
   * @param {Set<string>} stateNames
   * @returns {{ base: string, states: string[], pseudoElement: string | null }}
   */
  function stripPseudos(selector, stateNames) {
    const states = [];
    let pseudoElement = null;
    let base = "";
    let cursor = 0;
    // 単一コロンでも擬似要素として扱われる歴史的な 4 つ。
    const legacyElements = new Set(["before", "after", "first-line", "first-letter"]);
    for (const p of scanPseudos(selector)) {
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
    // 状態・擬似要素だけのセレクタ（`:hover` 単体など）は、残りが空になるので全称セレクタとして扱う。
    if (base === "" || /[\s>+~]$/.test(base)) base += "*";
    return { base, states, pseudoElement };
  }

  /**
   * 状態擬似クラスと擬似要素を剥がし、残りに判定できない擬似クラスが無いかを調べる。
   * @param {string} selector
   * @param {{ stateNames: Set<string>, structuralNames: Set<string> }} names
   * @returns {{ base: string, states: string[], pseudoElement: string | null, stateInsideFunctional: boolean, unknownPseudos: string[] }}
   */
  function analyzeSelector(selector, names) {
    const { base, states, pseudoElement } = stripPseudos(selector, names.stateNames);
    const stateInsideFunctional = hasStateInsideFunctional(base, names.stateNames);
    // 剥がしも許容もできない擬似クラスが残っていたら、当たる／当たらないを決めずに残す。
    const unknown = unknownPseudos(base, names);
    return { base, states, pseudoElement, stateInsideFunctional, unknownPseudos: unknown };
  }

  /**
   * @param {CssStyleLike | undefined} style
   * @returns {CssDeclaration[]}
   */
  function readDeclarations(style) {
    // style の無い規則を渡したときは、元と同じく style.length の読み取りで TypeError になる。
    if (style === undefined)
      throw new TypeError("Cannot read properties of undefined (reading 'length')");
    /** @type {CssDeclaration[]} */
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

  /**
   * スコープ（シャドウの外側・ホスト・スロット・@scope）のために、当たる側にも当たらない側にも分類しない規則の扱い。
   * unresolved に残すなら reason を、数だけ残すなら counts の欄の名前を返す（どちらでもなければ null）。
   * @param {string} part
   * @param {WalkContext} ctx
   * @returns {{ reason: string } | { skipped: "slotted_scope_skipped" | "host_scope_skipped" | "outer_scope_skipped" } | null}
   */
  function scopeDisposition(part, ctx) {
    // シャドウツリーの外の規則。`::part()` だけが中へ届くが、本ツールは part 名を解決しないので
    // 当たる側にも当たらない側にも分類せずに残す。それ以外の外側の規則はカプセル化で届かないので
    // matched には入れず、数だけ残す（0 件を「外側に規則が無い」と読まないため）。
    // ホスト自身のシャドウルートの規則。ホストに当たるのは `:host` 系だけで、それ以外は
    // シャドウの中の要素に当たる規則なのでホストの基準ではない。
    // スロット側のシャドウルートの規則。ライト DOM の要素へ届くのは `::slotted()` だけで、
    // 引数の解決はこのツールの範囲の外なので、当たった側に分類せずに残す。
    if (ctx.slottedScope) {
      if (hasPseudo(part, isSlotted)) return { reason: "slotted-not-evaluated" };
      return { skipped: "slotted_scope_skipped" };
    }
    if (ctx.hostScope) {
      if (hasPseudo(part, isHost)) return { reason: "host-scope-not-evaluated" };
      return { skipped: "host_scope_skipped" };
    }
    if (ctx.outerScope) {
      if (hasPseudo(part, isPart)) return { reason: "shadow-part-not-evaluated" };
      return { skipped: "outer_scope_skipped" };
    }
    // 自分の根（document か、自分が居るシャドウルート）の `::part()` / `::slotted()`。
    // `::part()` が飾るのはホストのシャドウツリー内の部品、`::slotted()` が飾るのはスロットへ
    // 割り当てられたライト DOM の要素で、**どちらもこの根にある要素そのものではない**。
    // 下の analyzeSelector は両者を擬似要素として剥がすので、`.host::part(label)` は `.host` に、
    // `::slotted(*)` は `*` になって matches() が真を返し、ホストや任意の要素の偽の根拠として
    // matched に入る。当たった側に分類せず、判定できないものとして残す（外側・スロット側の分岐と同じ理由）。
    const treeCrossing = scanPseudos(part).find((p) => isPart(p) || isSlotted(p));
    if (treeCrossing) {
      return {
        reason:
          treeCrossing.name === "part" ? "shadow-part-not-evaluated" : "slotted-not-evaluated",
      };
    }
    // @scope の中の規則は、セレクタが当たってもスコープ根・限界の外では適用されない。
    // このツールはスコープを評価しないので、当たった側に分類せず、判定できないものとして残す。
    if (ctx.scope) return { reason: `scope-not-evaluated:${ctx.scope}` };
    return null;
  }

  /**
   * セレクタ 1 件を要素に当て、当たるかを返す（判定できなければ unresolved に残す理由）。
   * @param {CaptureRun} run
   * @param {string} part
   * @returns {{ reason: string } | { hit: false } | { hit: true, states: string[], pseudoElement: string | null }}
   */
  function matchPart(run, part) {
    const analyzed = analyzeSelector(part, run);
    if (analyzed.stateInsideFunctional) return { reason: "state-inside-functional-pseudo" };
    if (analyzed.unknownPseudos.length > 0) {
      return { reason: `unknown-pseudo-class:${analyzed.unknownPseudos.join(",")}` };
    }
    let hit;
    try {
      hit = run.el.matches(analyzed.base);
    } catch (e) {
      return { reason: `matches-threw:${errorName(e)}` };
    }
    if (!hit) return { hit: false };
    return { hit: true, states: analyzed.states, pseudoElement: analyzed.pseudoElement };
  }

  /**
   * 解決済みセレクタリストを 1 件ずつ判定し、当たったものを matched へ、判定できないものを
   * unresolved へ入れる。通常の規則と CSSNestedDeclarations の両方から使う。
   * @param {CaptureRun} run
   * @param {RuleToMatch} rule
   * @param {WalkContext} ctx
   */
  function matchAndRecord(run, { resolved, originalSelector, declarations }, ctx) {
    const index = run.order++;
    for (const part of splitSelectorList(resolved)) {
      const scoped = scopeDisposition(part, ctx);
      const result = scoped ?? matchPart(run, part);
      if ("skipped" in result) {
        run.counts[result.skipped]++;
        continue;
      }
      if ("reason" in result) {
        run.unresolved.push({
          selector: part,
          original_selector: originalSelector,
          href: ctx.href,
          reason: result.reason,
        });
        continue;
      }
      if (!result.hit) continue;
      run.matched.push({
        order: index,
        selector: part,
        original_selector: originalSelector,
        states: result.states,
        pseudo_element: result.pseudoElement,
        conditions: ctx.conditions,
        layers: ctx.layers,
        href: ctx.href,
        declarations,
      });
    }
  }

  /**
   * (1) `@import` の規則（CSSImportRule）。cssRules を持たないので styleSheet から辿る。ここを飛ばすと
   *     読み込まれた規則が丸ごと視界から消える（例外は出ない）。
   *     `@import url(x) layer(vendor) screen;` の layer / メディア条件は CSSImportRule 側
   *     （layerName / media）にしか無いので、ここで引き継がないと読み込んだ規則が
   *     「レイヤ無し・無条件」として記録される（落ちるのではなく誤った条件が付く）。
   * @param {CaptureRun} run
   * @param {CssRuleLike} rule
   * @param {WalkContext} ctx
   */
  function walkImport(run, rule, ctx) {
    run.counts.import_rules++;
    // 読み込めていない `@import`（未ロード・404・解析失敗）は `styleSheet` が null になる。
    // 真偽値で分岐すると、どの分岐にも掛からないまま警告なしに消え、「その @import の先に
    // 関係する規則が無い」と区別できなくなる（このツールが防ごうとしている、判定できないものを合格とする振る舞いそのもの）。
    // 規則の種別は `styleSheet` の**有無**で判定し、null は採れなかった事実として残す。
    if (!rule.styleSheet) {
      run.inaccessible.push({
        href: (typeof rule.href === "string" && rule.href) || ctx.href || null,
        error: "ImportNotLoaded",
      });
      return;
    }
    const mediaText = rule.media && rule.media.mediaText ? rule.media.mediaText : "";
    // `@import url(x) supports(display: grid) screen;` の supports 条件は supportsText にしか無い。
    // 引き継がないと、読み込んだ規則が「無条件」として記録され、なぜ当たっているかを説明できなくなる。
    const supportsText = typeof rule.supportsText === "string" ? rule.supportsText : "";
    walkSheet(run, rule.styleSheet, {
      ...ctx,
      // layerName は無名レイヤで ""、レイヤ無しで null。文字列である限り記録する。
      layers: typeof rule.layerName === "string" ? ctx.layers.concat(rule.layerName) : ctx.layers,
      conditions: [
        ...ctx.conditions,
        ...(supportsText ? [`supports(${supportsText})`] : []),
        ...(mediaText ? [mediaText] : []),
      ],
    });
  }

  /**
   * 子を持つグループ規則（条件付き・名前付き・@scope・その他）の子へ降りる。
   * @param {CaptureRun} run
   * @param {CssRuleLike} rule cssRules を持つ規則
   * @param {WalkContext} ctx
   */
  function walkGroup(run, rule, ctx) {
    // 規則は CSSOM のオブジェクトで、欄はプロトタイプの getter にあるので、展開して作り直さずにそのまま読む。
    const children = Array.from(rule.cssRules || []);
    // (3) 条件付きグループ（@media / @supports / @container）。
    if (typeof rule.conditionText === "string") {
      walkRules(run, children, {
        ...ctx,
        conditions: ctx.conditions.concat(rule.conditionText),
      });
      return;
    }
    // (4) 名前付きグループ。@layer は降りる。@keyframes は子が keyText を持つので識別して飛ばす
    //     （子は selectorText を持たないため降りても無害だが、レイヤ名として数えない）。
    if (typeof rule.name === "string") {
      if (children.some((child) => child && child.keyText !== undefined)) return;
      walkRules(run, children, { ...ctx, layers: ctx.layers.concat(rule.name) });
      return;
    }
    // (5) @scope。子の規則はスコープ根と限界の中でしか当たらないが、本ツールはセレクタしか
    //     見ないので、`@scope (.dialog) { .button {...} }` を .dialog の外の .button にも
    //     当たったと報告してしまう（偽の根拠になる）。スコープを評価せず unresolved に回す。
    if (rule.start !== undefined || rule.end !== undefined) {
      walkRules(run, children, {
        ...ctx,
        scope: typeof rule.start === "string" && rule.start ? rule.start : "(implicit)",
      });
      return;
    }
    // (6) それ以外のグループ（conditionText も name も start/end も持たないもの）。
    walkRules(run, children, ctx);
  }

  /**
   * 規則 1 件を、種類ごとに走査する。
   * @param {CaptureRun} run
   * @param {CssRuleLike} rule
   * @param {WalkContext} ctx
   */
  function walkRule(run, rule, ctx) {
    if ("styleSheet" in rule) {
      walkImport(run, rule, ctx);
      return;
    }
    // (2) 通常の規則。CSS 入れ子のため cssRules も持つので、数えたうえで子へも降りる。
    if (rule.selectorText !== undefined) {
      run.counts.style_rules++;
      const resolved = resolveSelector(rule.selectorText, ctx.parentSelector);
      const declarations = readDeclarations(rule.style);
      matchAndRecord(run, { resolved, originalSelector: rule.selectorText, declarations }, ctx);
      if (rule.cssRules && rule.cssRules.length > 0) {
        walkRules(run, Array.from(rule.cssRules), { ...ctx, parentSelector: resolved });
      }
      return;
    }
    // (2.5) 入れ子の途中に現れた裸の宣言（CSSNestedDeclarations。Chrome 130+）。
    //       `.btn { color: red; & .icon { … } background: blue; }` の `background` がこれで、
    //       selectorText も cssRules も持たないため下のどの分岐にも掛からず、
    //       matched / unresolved / counts のどこにも残らずに消える。適用先は囲っている規則の
    //       セレクタなので parentSelector に対して判定する。
    //       parentSelector が無い（トップレベル）ものは @font-face / @page 等なので対象にしない。
    if (ctx.parentSelector && rule.style && !rule.cssRules) {
      run.counts.nested_declaration_rules++;
      const declarations = readDeclarations(rule.style);
      const parent = ctx.parentSelector;
      matchAndRecord(run, { resolved: parent, originalSelector: parent, declarations }, ctx);
      return;
    }
    if (rule.cssRules) walkGroup(run, rule, ctx);
  }

  /**
   * @param {CaptureRun} run
   * @param {CssRuleLike[]} rules
   * @param {WalkContext} ctx
   */
  function walkRules(run, rules, ctx) {
    for (const rule of rules) walkRule(run, rule, ctx);
  }

  /**
   * 重複の排除に使うスコープの名前。
   * @param {Partial<WalkContext> | null} ctx
   * @returns {string}
   */
  function sheetScope(ctx) {
    if (ctx && ctx.outerScope) return "outer";
    if (ctx && ctx.hostScope) return "host";
    if (ctx && ctx.slottedScope) return "slotted";
    return "own";
  }

  /**
   * @param {CaptureRun} run
   * @param {CssSheetLike | null | undefined} sheet
   * @param {Partial<WalkContext> | null} ctx
   */
  function walkSheet(run, sheet, ctx) {
    if (!sheet) return;
    // 重複の排除は、スコープを含めて行う。シート単位にすると、同じ CSSStyleSheet を
    // `shadowRoot.adoptedStyleSheets` と document で共有している構成で、内側を先に走査した時点で
    // 既読になり、外側のスコープの走査がまるごと飛ぶ。すると、`::part()` が unresolved に残らず、
    // `outer_scope_skipped` も増えない。「判定できない規則を警告なしに捨てない」という取り決めに反する。
    const scope = sheetScope(ctx);
    const seen = run.seenSheets.get(scope) || new Set();
    if (seen.has(sheet)) return;
    seen.add(sheet);
    run.seenSheets.set(scope, seen);
    run.counts.sheets++;
    const href = sheet.href || (ctx && ctx.href) || null;
    let rules;
    try {
      rules = sheet.cssRules;
    } catch (e) {
      // クロスオリジンのスタイルシートは cssRules の参照で SecurityError を投げる。
      // 握り潰すと「規則が無い」と区別できないので、必ず出力に残す。
      run.inaccessible.push({ href, error: errorName(e) });
      return;
    }
    // @import から来た場合は呼び出し元の条件・レイヤを引き継ぐ（ここで [] に戻すと
    // `@import url(x) layer(vendor);` の layer が読み込んだ規則に付かない）。
    walkRules(run, Array.from(rules), {
      conditions: (ctx && ctx.conditions) || [],
      layers: (ctx && ctx.layers) || [],
      parentSelector: null,
      href,
      outerScope: Boolean(ctx && ctx.outerScope),
      hostScope: Boolean(ctx && ctx.hostScope),
      slottedScope: Boolean(ctx && ctx.slottedScope),
    });
  }

  /**
   * 根のスタイルシート（styleSheets と adoptedStyleSheets）を順に走査する。
   * @param {CaptureRun} run
   * @param {SheetRoot} root
   * @param {Partial<WalkContext> | null} ctx
   */
  function walkRootSheets(run, root, ctx) {
    for (const sheet of Array.from(root.styleSheets || [])) walkSheet(run, sheet, ctx);
    for (const sheet of Array.from(root.adoptedStyleSheets || [])) walkSheet(run, sheet, ctx);
  }

  /**
   * 要素の根・外側の document・スロット側とホスト自身のシャドウルートを走査する。
   * @param {CaptureRun} run
   * @returns {{ inShadow: boolean, slotted: boolean, shadowHost: boolean }}
   */
  function walkScopes(run) {
    const { el } = run;
    // 走査するのは**その要素の根**だけである。シャドウツリーの中の要素に対して外側の document の
    // スタイルシートまで走査すると、`el.matches(".btn")` は true を返す。しかし実際には
    // カプセル化で当たらない規則を「当たっている」として記録し、部品の基準が偽になる。
    // 外側から中へ届くのは `::part()` だけなので、それを警告なしに捨てず unresolved に残す。
    const root = el.getRootNode();
    // `Boolean(root && root !== el.ownerDocument && root.styleSheets)` と同じ判定（根を型で絞るため分けて書く）。
    const shadowRoot = root && root !== el.ownerDocument && hasStyleSheets(root) ? root : null;
    const inShadow = shadowRoot !== null;
    walkRootSheets(run, shadowRoot !== null ? shadowRoot : el.ownerDocument, null);
    if (inShadow) walkRootSheets(run, el.ownerDocument, { outerScope: true });
    // 対象がカスタム要素のホストのとき、`getRootNode()` は document を返すので上の分岐に入らない。
    // だがホストの見た目を決めているのは**そのホスト自身のシャドウルート**の `:host` 規則で、
    // それを走査しないと、「CSS 規則が 1 件も当たっていない部品」という誤った基準が出る。
    // `:host()` / `:host-context()` の引数の解決はこのツールの範囲の外なので、当たった側に分類せずに残す。
    // ライト DOM の要素がシャドウの `<slot>` に割り当てられているとき、その要素に当たる
    // `::slotted()` 規則は**スロット側のシャドウルート**にある。`getRootNode()` は document を
    // 返すのでここまで辿らないと見えず、規則を 1 件も採らないまま基準が出る。
    const slotRoot =
      el.assignedSlot && el.assignedSlot.getRootNode ? el.assignedSlot.getRootNode() : null;
    const slotted = Boolean(slotRoot && slotRoot !== el.ownerDocument && hasStyleSheets(slotRoot));
    // slotted が真なら slotRoot は根なので、hasStyleSheets は型を絞るためだけにある（判定は変わらない）。
    if (slotted && hasStyleSheets(slotRoot)) {
      walkRootSheets(run, slotRoot, { slottedScope: true });
    }
    const shadowHost = Boolean(el.shadowRoot && el.shadowRoot.styleSheets);
    // shadowHost が真なら el.shadowRoot はあるので、el.shadowRoot の判定は型を絞るためだけにある。
    if (el.shadowRoot && shadowHost) walkRootSheets(run, el.shadowRoot, { hostScope: true });
    return { inShadow, slotted, shadowHost };
  }

  /** @type {CaptureRun} */
  const run = {
    el,
    stateNames: new Set(options.statePseudoClasses),
    structuralNames: new Set(options.structuralPseudoClasses || []),
    matched: [],
    unresolved: [],
    inaccessible: [],
    counts: {
      sheets: 0,
      style_rules: 0,
      import_rules: 0,
      nested_declaration_rules: 0,
      outer_scope_skipped: 0,
      host_scope_skipped: 0,
      slotted_scope_skipped: 0,
    },
    seenSheets: new Map(),
    order: 0,
  };
  const { inShadow, slotted, shadowHost } = walkScopes(run);
  // style 属性の宣言はどのスタイルシートにも現れないので、上の走査では 1 件も採れない。
  // 計算後スタイルは結果の値しか持たないため、ここを採らないと「その値がインスタンス固有の
  // インライン指定で来ている」ことも `!important` の優先度も実装時に復元できない
  // （インスタンス固有の幅を style で当てている現行部品が典型）。
  // 規則ではないので matched へ混ぜず、別の出所として並べる。
  const inlineDeclarations = hasStyle(el) ? readDeclarations(el.style) : [];
  const { matched, unresolved, inaccessible, counts } = run;
  return {
    matched,
    unresolved,
    inaccessible,
    inline_declarations: inlineDeclarations,
    shadow_host: shadowHost,
    slotted,
    counts: { ...counts, matched: matched.length, inline_declarations: inlineDeclarations.length },
    shadow_root: inShadow,
  };
}
