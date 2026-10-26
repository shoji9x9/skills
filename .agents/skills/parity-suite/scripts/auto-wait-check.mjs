// パリティスイートから Playwright の待たない取得 API を検出する。
// TypeScript の構文変換は行わず、コメント・文字列・正規表現リテラルを除外したソースを決定論的に走査する。

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";
import { isCliEntry } from "./lib/cli.mjs";

const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".jsx", ".ts", ".mts", ".cts", ".tsx"]);

/** 現側専用の採取スペックを置くディレクトリ名（原本は references/locator-mapping.md の配置表）。 */
const CAPTURE_ONLY_SEGMENT = "current-only";
/** 採取スペックで免除する規則。値を記録するための読み取りには置き換える assertion が無い。 */
const CAPTURE_EXEMPT_RULES = new Set(["immediate-read"]);

const RULES = [
  {
    id: "query-handle",
    methods: ["$", "$$"],
    receivers: ["page"],
    message: "page.$ / page.$$ は DOM を即時照会する",
  },
  {
    id: "element-handle",
    methods: ["elementHandle", "elementHandles"],
    receivers: ["locator"],
    message: "ElementHandle への変換は自動待機を失う",
  },
  {
    id: "locator-all",
    methods: ["all"],
    receivers: ["locator"],
    message: "locator.all() は要素一覧を待たない",
  },
  {
    id: "immediate-read",
    methods: [
      "textContent",
      "innerText",
      "innerHTML",
      "inputValue",
      "getAttribute",
      "allTextContents",
      "allInnerTexts",
      "count",
      "isVisible",
      "isHidden",
      "isEnabled",
      "isDisabled",
      "isEditable",
      "isChecked",
    ],
    receivers: ["locator"],
    message: "即時の値読み取りではなく自動リトライ assertion を使う",
  },
  {
    id: "fixed-wait",
    methods: ["waitForTimeout"],
    receivers: ["page"],
    message: "固定時間待機ではなく観測条件を自動待機する",
  },
];

const UNRESOLVED_RULE = "unresolved-receiver";
/** 判定不能の理由ごとの直し方。理由を混ぜると直す側がどちらを試すか分からない。 */
const UNRESOLVED_MESSAGES = {
  call: "受け側を解決できない（受け側の式に関数呼び出しの戻り値が含まれる）。その関数の戻り値へ Page / Locator の型注釈を付ける",
  computed:
    "受け側を解決できない（添字アクセスでプロパティ名が読めない）。プロパティ名で引いた値をローカル変数へ束ねる",
  alias:
    "受け側を解決できない（束ねた変数の由来を追えない）。右辺の関数の戻り値、またはプロパティへ Page / Locator の型注釈を付ける",
  opaque:
    "受け側の起点を確定できない（括弧で包んだ式・リテラル等）。Page / Locator に解決する式から取得する",
  binding:
    "受け側の名前の束縛を解決できない（Page / Locator 以外の注釈を含む引数・分割代入・再代入・for-of・import・未宣言の名前・this のプロパティ等）。" +
    "Locator / Page なら束縛へ型注釈（`loc: Locator`）を付ける。Playwright 以外の値（evaluate の中の DOM 等）は " +
    "`document` / `window` を起点にした式で直接読む",
};

/**
 * `/` の直前の意味のあるトークンから、そこが正規表現リテラルを開始できる位置かを判定する。
 * ECMAScript の字句は前のトークンで分岐する（<https://tc39.es/ecma262/#sec-literals-regular-expression-literals>）。
 * 曖昧なときは除算として扱う。正規表現を除算と誤れば、引用符が残って終端不明の例外になる（判定できないので失敗する）。
 * 一方、除算を正規表現と誤ると、実コードを潰して違反が警告なしに消える。
 */
// `in` / `of` は contextual keyword で、ふつうの識別子にもなれる（`const of = 2; of / d`）。
// 一方この位置で正規表現が来る形（`for (const r of /re/.exec(s))`）は実在しないため、
// 識別子側の誤りだけが残る。誤って除算を潰すと違反が警告なしに消えるので、集合に入れない。
// 予約語（`return` 等）は識別子になれないので同じ問題は起きない。
const REGEX_ALLOWED_AFTER_KEYWORDS = new Set([
  "return",
  "typeof",
  "instanceof",
  "new",
  "delete",
  "void",
  "throw",
  "case",
  "do",
  "else",
  "yield",
  "await",
  // `export default /re/;` も正規表現を開始できる位置。
  "default",
  // 文を終える語。ASI で改行が文末になり、次の行は文の位置から始まる（`break\n/re/.test(x)`）。
  "break",
  "continue",
  "debugger",
]);
/**
 * 文脈依存キーワード。module では常にキーワードだが、script / CommonJS では識別子にもなる。
 * 直後に `!` が来ると前置の否定と後置の非 null が静的に区別できないため、そこで走査を止める。
 */
const CONTEXTUAL_VALUE_KEYWORDS = new Set(["await", "yield"]);
/** 値で終わる句読点。この直後の `/` は除算である（`)` は下で個別に判定する）。 */
const DIVISION_AFTER_PUNCTUATORS = new Set(["]", "++", "--"]);
/** 頭を括弧で囲む制御構文。閉じ括弧は値で終わらないため、その直後の `/` は正規表現である。 */
const CONTROL_HEAD_KEYWORDS = new Set(["if", "while", "for", "switch", "catch", "with"]);
/** この直後の `{` は文としてのブロック。閉じ波括弧は値で終わらない。 */
const BLOCK_BRACE_AFTER_PUNCTUATORS = new Set([";", "{", "}", ")", ">"]);
/** 値を待つキーワード。この直後の `{` はオブジェクトリテラルで、閉じ波括弧は値で終わる。 */
const OBJECT_BRACE_AFTER_KEYWORDS = new Set([
  "return",
  "typeof",
  "instanceof",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "case",
  "yield",
  "await",
]);

/** @param {MaskToken | null} lastToken */
function regexAllowedAfter(lastToken) {
  if (lastToken === null) return true;
  if (lastToken.type === "punct") {
    // `if (x) /re/.test(y)` の `)` は演算子の左辺にならない。制御構文の頭かどうかで分ける。
    if (lastToken.value === ")") return lastToken.controlHead === true;
    // `}` も同様。ブロックの閉じなら文の位置なので正規表現、オブジェクトリテラル・JSX の
    // `{…}` の閉じなら値で終わるので除算（`<A x={1} /><B y={…} />` を正規表現と読むと
    // 2 つの `/` に挟まれた実コードが静かに潰れる）。
    if (lastToken.value === "}") return lastToken.blockClose === true;
    // TypeScript の非 null は後置。`value! / denom` は値で終わるので除算、前置の否定
    // （`!/re/.test(x)`）は値で終わらないので正規表現。
    if (lastToken.value === "!") return lastToken.postfix !== true;
    return !DIVISION_AFTER_PUNCTUATORS.has(lastToken.value);
  }
  // プロパティ名はキーワードにならない。`obj.return / x / y` の `return` をキーワードと読むと
  // 除算を正規表現として潰し、間の実コードごと違反が消える。
  if (lastToken.type === "word") {
    return !lastToken.member && REGEX_ALLOWED_AFTER_KEYWORDS.has(lastToken.value);
  }
  return false;
}

/**
 * `{` がブロックを開くか（＝閉じ波括弧が値で終わらないか）を直前のトークンから判定する。
 * @param {MaskToken | null} lastToken
 */
function braceOpensBlock(lastToken) {
  if (lastToken === null) return true;
  if (lastToken.type === "punct") return BLOCK_BRACE_AFTER_PUNCTUATORS.has(lastToken.value);
  if (lastToken.type === "word") {
    return lastToken.member || !OBJECT_BRACE_AFTER_KEYWORDS.has(lastToken.value);
  }
  return false;
}

/**
 * 直前のトークンが値で終わるか（＝続く `!` が後置の非 null 演算子か）。
 * @param {MaskToken | null} lastToken
 */
function endsWithValue(lastToken) {
  if (lastToken === null) return false;
  // 値を待つキーワード（`return` / `throw` / `typeof` …）は値で終わらない。ここを一律 true にすると
  // `return !/re/.test(x)` の `!` を後置の非 null と読み、続く正規表現をマスクせず素通りさせる
  // （引用符を含む正規表現なら未終端の文字列として走査ごと落ちる）。プロパティ名は識別子なので値で終わる。
  if (lastToken.type === "word") {
    return lastToken.member || !REGEX_ALLOWED_AFTER_KEYWORDS.has(lastToken.value);
  }
  if (lastToken.type === "number" || lastToken.type === "literal") return true;
  if (lastToken.type !== "punct") return false;
  if (lastToken.value === ")" || lastToken.value === "]") return true;
  return lastToken.value === "}" && lastToken.blockClose !== true;
}

/**
 * 直前のトークンが、プロパティ名でない素の制御構文キーワードか。
 * @param {MaskToken | null} lastToken
 */
function isControlHeadKeyword(lastToken) {
  return (
    lastToken !== null &&
    lastToken.type === "word" &&
    !lastToken.member &&
    CONTROL_HEAD_KEYWORDS.has(lastToken.value)
  );
}

/**
 * `start` の `/` から始まる正規表現リテラルの終端（フラグの直後）を返す。
 * 終端を確定できなければ -1 を返し、呼び出し側は除算として扱う。
 * @param {string} source
 * @param {number} start
 */
function regexLiteralEnd(source, start) {
  let i = start + 1;
  let inClass = false;
  while (i < source.length) {
    const c = source[i];
    // 正規表現リテラルは行をまたげない。
    if (c === "\n") return -1;
    if (c === "\\") {
      if (i + 1 >= source.length || source[i + 1] === "\n") return -1;
      i += 2;
      continue;
    }
    if (inClass) {
      if (c === "]") inClass = false;
    } else if (c === "[") {
      inClass = true;
    } else if (c === "/") {
      i += 1;
      while (i < source.length && /[a-z]/i.test(source[i])) i += 1;
      return i;
    }
    i += 1;
  }
  return -1;
}

/**
 * `from` 以降の最初の**意味を持つ**トークンが、正規表現とも除算とも読める `/` か。
 *
 * 文脈依存キーワード（`await` / `yield`）の直後の `!` は、続くトークンの形で前置・後置が決まる
 * （被演算子が続けば前置の否定、演算子が続けば後置の非 null）。唯一決まらないのが `/` で、
 * 前置なら正規表現の開始、後置なら除算になる。
 *
 * **空白だけでなくコメントも読み飛ばす。** コメントは意味を持つトークンではないので、
 * 非 null の後ろにブロックコメントを挟んでから除算する形の曖昧さは、挟まない形と同じである。
 * コメントの `/` で「曖昧でない」と打ち切ると、その先の本物の `/` が正規表現の開始として扱われ、
 * 次の `/` までの違反が警告なしに消える。
 * 終端まで意味を持つトークンが無い場合は曖昧でない（続く式が無い。未終端コメント自体は
 * maskNonCode が別途エラーにする）。
 * @param {string} source
 * @param {number} from
 * @returns {boolean}
 */
function startsAmbiguousSlash(source, from) {
  let k = from;
  for (;;) {
    while (k < source.length && /\s/.test(source[k])) k += 1;
    if (source[k] !== "/") return false;
    const next = source[k + 1];
    if (next === "/") {
      const end = source.indexOf("\n", k + 2);
      if (end === -1) return false;
      k = end + 1;
      continue;
    }
    if (next === "*") {
      const end = source.indexOf("*/", k + 2);
      if (end === -1) return false;
      k = end + 2;
      continue;
    }
    return true;
  }
}

/**
 * maskNonCode が直前のトークンとして持つ形。word の member はプロパティ名（直前が `.`）か。
 * punct の blockClose は `}` がブロックの閉じか、controlHead は `)` が制御構文の頭の閉じか、
 * postfix は `!` が後置の非 null 演算子か。
 * @typedef {{ type: "word", value: string, member: boolean }
 *   | { type: "punct", value: string, blockClose?: boolean, controlHead?: boolean, postfix?: boolean }
 *   | { type: "literal" }
 *   | { type: "number" }} MaskToken
 */

/**
 * maskNonCode が走査の間に持つ状態。
 * stack はテンプレートと補間の入れ子を積む。`${}` の中のテンプレートを閉じるために深さが要る。
 * parenHeads は開き括弧ごとに「制御構文の頭か」を積む。閉じ括弧の後で正規表現を許すかの判定に使う。
 * braceBlocks は開き波括弧ごとに「ブロックか」を積む。閉じ波括弧の後で正規表現を許すかの判定に使う。
 * @typedef {{
 *   source: string,
 *   out: string[],
 *   stack: Array<{ kind: "template" } | { kind: "interpolation", braces: number }>,
 *   parenHeads: boolean[],
 *   braceBlocks: boolean[],
 *   state: "code" | "string" | "template",
 *   quote: string,
 *   lastToken: MaskToken | null,
 *   i: number,
 * }} MaskState
 */

/**
 * @param {MaskState} ctx
 * @param {number} from
 * @param {number} to
 */
function blankRange(ctx, from, to) {
  for (let k = from; k < to; k += 1) if (ctx.source[k] !== "\n") ctx.out[k] = " ";
}

/**
 * @param {MaskState} ctx
 * @returns {MaskToken}
 */
function closeBrace(ctx) {
  const blockClose = ctx.braceBlocks.length > 0 ? ctx.braceBlocks.pop() : false;
  return { type: "punct", value: "}", blockClose };
}

/** @param {MaskState} ctx */
function skipEscape(ctx) {
  ctx.out[ctx.i] = " ";
  if (ctx.i + 1 < ctx.source.length) {
    if (ctx.source[ctx.i + 1] !== "\n") ctx.out[ctx.i + 1] = " ";
    ctx.i += 2;
  } else ctx.i += 1;
}

/**
 * 行コメントとブロックコメントを空白へ置換する。
 * @param {MaskState} ctx
 */
function maskComment(ctx) {
  const { source, i } = ctx;
  if (source[i] !== "/") return false;
  if (source[i + 1] === "/") {
    const eol = source.indexOf("\n", i);
    const end = eol === -1 ? source.length : eol;
    blankRange(ctx, i, end);
    ctx.i = end;
    return true;
  }
  if (source[i + 1] === "*") {
    const close = source.indexOf("*/", i + 2);
    if (close === -1) throw new Error("ソース終端で block-comment が閉じていない");
    blankRange(ctx, i, close + 2);
    ctx.i = close + 2;
    return true;
  }
  return false;
}

/**
 * 正規表現リテラルを空白へ置換する。
 * @param {MaskState} ctx
 */
function maskRegexLiteral(ctx) {
  const { source, i } = ctx;
  // `</` は JSX / TSX の閉じタグ。`<` は値で終わらないので正規表現が許される位置だが、
  // ここを正規表現の開始と読むと次の閉じタグの `/` までを潰し、間の実コードごと違反が消える。
  // 空白を挟む比較（`a < /re/`）は隣接しないので区別できる。空白なしの `a</re/` は
  // 正規表現として読まれずマスクされないが、その場合は終端不明の例外になる（判定できないので失敗する）。
  const jsxClosingTag = source[i] === "/" && i > 0 && source[i - 1] === "<";
  if (source[i] !== "/" || jsxClosingTag || !regexAllowedAfter(ctx.lastToken)) return false;
  const end = regexLiteralEnd(source, i);
  // 終端を確定できない。除算として読み進める。
  if (end === -1) return false;
  blankRange(ctx, i, end);
  ctx.i = end;
  ctx.lastToken = { type: "literal" };
  return true;
}

/**
 * 文字列とテンプレート文字列の開始。
 * @param {MaskState} ctx
 */
function openQuoted(ctx) {
  const c = ctx.source[ctx.i];
  if (c === "'" || c === '"') {
    ctx.out[ctx.i] = " ";
    ctx.quote = c;
    ctx.state = "string";
    ctx.i += 1;
    return true;
  }
  if (c === "`") {
    ctx.out[ctx.i] = " ";
    ctx.stack.push({ kind: "template" });
    ctx.state = "template";
    ctx.i += 1;
    return true;
  }
  return false;
}

/**
 * テンプレートの補間の中の波括弧。深さ 0 の閉じ波括弧は補間を閉じる。
 * @param {MaskState} ctx
 */
function maskInterpolationBrace(ctx) {
  const c = ctx.source[ctx.i];
  const top = ctx.stack.length > 0 ? ctx.stack[ctx.stack.length - 1] : null;
  if (top === null || top.kind !== "interpolation") return false;
  if (c === "{") {
    top.braces += 1;
    ctx.braceBlocks.push(braceOpensBlock(ctx.lastToken));
    ctx.lastToken = { type: "punct", value: "{" };
    ctx.i += 1;
    return true;
  }
  if (c !== "}") return false;
  if (top.braces === 0) {
    ctx.out[ctx.i] = " ";
    ctx.stack.pop();
    ctx.state = "template";
    ctx.i += 1;
    return true;
  }
  top.braces -= 1;
  ctx.lastToken = closeBrace(ctx);
  ctx.i += 1;
  return true;
}

/**
 * 識別子・数値・空白を読み進める。
 * @param {MaskState} ctx
 */
function scanWordOrNumber(ctx) {
  const { source, i, lastToken } = ctx;
  const c = source[i];
  if (/[A-Za-z_$]/.test(c)) {
    let end = i + 1;
    while (end < source.length && /[\w$]/.test(source[end])) end += 1;
    // `.` の直後ならプロパティ名。キーワードとしての意味を持たない。
    /** @type {boolean} */
    const member = lastToken !== null && lastToken.type === "punct" && lastToken.value === ".";
    ctx.lastToken = { type: "word", value: source.slice(i, end), member };
    ctx.i = end;
    return true;
  }
  if (/\d/.test(c)) {
    let end = i + 1;
    while (end < source.length && /[\w.]/.test(source[end])) end += 1;
    ctx.lastToken = { type: "number" };
    ctx.i = end;
    return true;
  }
  if (/\s/.test(c)) {
    ctx.i += 1;
    return true;
  }
  return false;
}

/**
 * `++` / `--` と、括弧・波括弧の開き閉じを読み進める。
 * @param {MaskState} ctx
 */
function scanBracket(ctx) {
  const c = ctx.source[ctx.i];
  if ((c === "+" || c === "-") && ctx.source[ctx.i + 1] === c) {
    ctx.lastToken = { type: "punct", value: c + c };
    ctx.i += 2;
    return true;
  }
  if (c === "(") {
    ctx.parenHeads.push(isControlHeadKeyword(ctx.lastToken));
    ctx.lastToken = { type: "punct", value: "(" };
  } else if (c === ")") {
    const controlHead = ctx.parenHeads.length > 0 ? ctx.parenHeads.pop() : false;
    ctx.lastToken = { type: "punct", value: ")", controlHead };
  } else if (c === "{") {
    ctx.braceBlocks.push(braceOpensBlock(ctx.lastToken));
    ctx.lastToken = { type: "punct", value: "{" };
  } else if (c === "}") {
    ctx.lastToken = closeBrace(ctx);
  } else return false;
  ctx.i += 1;
  return true;
}

/**
 * `!` を前置の否定か後置の非 null かに分けて読み進める。
 * @param {MaskState} ctx
 */
function scanBang(ctx) {
  const { lastToken } = ctx;
  if (ctx.source[ctx.i] !== "!") return false;
  // `await` / `yield` は文脈依存キーワードで、script / CommonJS では識別子にもなる。
  // 直後の `!` が前置の否定（キーワード）か後置の非 null（識別子）かは、**次のトークンの形**で決まる。
  // 被演算子が続けば前置（`await !Promise.resolve(x)`）、演算子が続けば後置（`await! / d`）である。
  // 曖昧なのは次が `/` のときだけである。前置なら正規表現の開始、後置なら除算になる。
  // 前置として扱うと、次の `/` までがマスクされ、その間の違反が警告なしに消える。
  // そこだけ、走査できないファイルとして失敗させる（判定不能を違反 0 件として扱わない）。
  if (
    lastToken !== null &&
    lastToken.type === "word" &&
    !lastToken.member &&
    CONTEXTUAL_VALUE_KEYWORDS.has(lastToken.value) &&
    startsAmbiguousSlash(ctx.source, ctx.i + 1)
  ) {
    throw new Error(
      `${lastToken.value} の直後の \`!\` と \`/\` は「正規表現の開始」とも「非 null の後の除算」とも読める（${lastToken.value} を識別子に使わないか、括弧で区切る）`,
    );
  }
  ctx.lastToken = { type: "punct", value: "!", postfix: endsWithValue(lastToken) };
  ctx.i += 1;
  return true;
}

/** コードの位置で 1 文字目から順に試す読み方。どれにも当たらなければ 1 文字の句読点として読む。 */
const CODE_SCANNERS = [
  maskComment,
  maskRegexLiteral,
  openQuoted,
  maskInterpolationBrace,
  scanWordOrNumber,
  scanBracket,
  scanBang,
];

/** @param {MaskState} ctx */
function maskCodeChar(ctx) {
  if (CODE_SCANNERS.some((scan) => scan(ctx))) return;
  ctx.lastToken = { type: "punct", value: ctx.source[ctx.i] };
  ctx.i += 1;
}

/** @param {MaskState} ctx */
function maskStringChar(ctx) {
  const c = ctx.source[ctx.i];
  if (c === "\\") {
    skipEscape(ctx);
    return;
  }
  if (c === ctx.quote) {
    ctx.out[ctx.i] = " ";
    ctx.state = "code";
    ctx.lastToken = { type: "literal" };
    ctx.i += 1;
    return;
  }
  if (c !== "\n") ctx.out[ctx.i] = " ";
  ctx.i += 1;
}

/** @param {MaskState} ctx */
function maskTemplateChar(ctx) {
  const c = ctx.source[ctx.i];
  if (c === "\\") {
    skipEscape(ctx);
    return;
  }
  if (c === "`") {
    const top = ctx.stack.length > 0 ? ctx.stack[ctx.stack.length - 1] : null;
    if (top === null || top.kind !== "template") {
      throw new Error("テンプレート文字列の入れ子を追えない");
    }
    ctx.out[ctx.i] = " ";
    ctx.stack.pop();
    ctx.state = "code";
    ctx.lastToken = { type: "literal" };
    ctx.i += 1;
    return;
  }
  if (c === "$" && ctx.source[ctx.i + 1] === "{") {
    ctx.out[ctx.i] = ctx.out[ctx.i + 1] = " ";
    ctx.stack.push({ kind: "interpolation", braces: 0 });
    ctx.state = "code";
    // 補間の先頭。ここから始まる `/` は正規表現でありうる。
    ctx.lastToken = null;
    ctx.i += 2;
    return;
  }
  if (c !== "\n") ctx.out[ctx.i] = " ";
  ctx.i += 1;
}

/**
 * コメント・文字列・テンプレート文字列・正規表現リテラルを空白へ置換し、行・桁位置を保つ。
 * 判定不能な終端はエラーにする（走査できなかったファイルを違反 0 件として扱わない）。
 * @param {string} source
 */
export function maskNonCode(source) {
  /** @type {MaskState} */
  const ctx = {
    source,
    // source.length / source[i] と同じ UTF-16 code unit 単位にする。スプレッドは code point 単位なので、
    // 非 BMP 文字の後で添字がずれ、マスク位置・違反位置が誤った値になる。
    out: source.split(""),
    stack: [],
    parenHeads: [],
    braceBlocks: [],
    state: "code",
    quote: "",
    lastToken: null,
    i: 0,
  };
  // 1 回の読み進めで i は 1 以上進むので、回数の上限は source.length で足りる。
  // 上限は、読み進めが i を進めない誤りがあってもループを終わらせるためにある。
  // 上限で抜けたときは、途中までのマスクを返さずに例外にする（判定できないものを違反 0 件として扱わない）。
  for (let step = 0; ctx.i < source.length && step < source.length; step += 1) {
    if (ctx.state === "code") maskCodeChar(ctx);
    else if (ctx.state === "string") maskStringChar(ctx);
    else maskTemplateChar(ctx);
  }
  if (ctx.i < source.length) throw new Error("走査が上限の回数でソースの終端に届かない");

  if (ctx.state !== "code" || ctx.stack.length > 0) {
    const unclosed = ctx.state !== "code" ? ctx.state : ctx.stack[ctx.stack.length - 1].kind;
    throw new Error(`ソース終端で ${unclosed} が閉じていない`);
  }
  return ctx.out.join("");
}

/** 受け側になれないキーワード。これが起点に出たら、直前の括弧の中身を受け側として辿り直す。 */
const NON_RECEIVER_KEYWORDS = new Set([
  "await",
  "return",
  "typeof",
  "new",
  "void",
  "yield",
  "delete",
  "throw",
  "case",
  "in",
  "of",
  "instanceof",
]);

/**
 * Playwright 以外と確定する標準の組み込みオブジェクト。禁止 API と同名のメソッドを持つもの
 * （`Promise.all` / `console.count`）と、DOM を読む `evaluate` の中身の起点（`document` / `window`）に閉じる。
 * 同じファイルで束縛し直した名前（`function f(document)`）には当てない。
 */
const BUILTIN_NON_RECEIVERS = new Set(["Promise", "console", "document", "window"]);
/**
 * Page から取り出して「Playwright 以外」と確定してよいプロパティ（Page API の既知の名前に限る許可リスト）。
 * 任意の名前を認めると、`page.row = page.locator(…)` のように後から Locator を入れたプロパティが、誤って確定と判定される。
 * 同じファイルでこの名前へ代入していれば（`page.clock = …`）、その名前は根拠にしない。
 */
const PAGE_NON_RECEIVER_PROPERTIES = new Set([
  "clock",
  "keyboard",
  "mouse",
  "touchscreen",
  "request",
  "coverage",
  "accessibility",
]);
/** 値の式の中で、受け側の由来にならない語（リテラル・演算子のキーワード）。 */
const VALUE_KEYWORDS = new Set([
  "true",
  "false",
  "null",
  "undefined",
  "NaN",
  "Infinity",
  "typeof",
  "void",
  "instanceof",
  "in",
  "new",
  "await",
]);
/** 直後の括弧が束縛の並び（引数・catch・for の頭）ではない制御構文。 */
const CONDITION_HEADS = new Set(["if", "while", "switch", "with"]);

/**
 * プロパティ名（`.` の直後）とオブジェクトリテラルのキーを除いた、式の起点になる名前を返す。
 * @param {string} text
 */
function rootNames(text) {
  /** @type {Set<string>} */
  const names = new Set();
  for (const match of text.matchAll(/(?<![\w$])(?<!\.\s*)[A-Za-z_$][\w$]*/g)) {
    const before = text.slice(0, match.index);
    const after = text.slice(match.index + match[0].length);
    const objectKey = /[{,]\s*$/.test(before) && /^\s*:(?!:)/.test(after);
    if (!objectKey) names.add(match[0]);
  }
  return names;
}

/**
 * `open` の開き括弧に対応する閉じ括弧の位置。対応が取れなければ -1。
 * @param {string} code
 * @param {number} open
 */
function matchingClose(code, open) {
  /** @type {Record<string, string>} */
  const pairs = { "(": ")", "[": "]", "{": "}" };
  const stack = [];
  for (let k = open; k < code.length; k += 1) {
    const c = code[k];
    if (c in pairs) stack.push(pairs[c]);
    else if (c === ")" || c === "]" || c === "}") {
      if (stack.pop() !== c) return -1;
      if (stack.length === 0) return k;
    }
  }
  return -1;
}

/**
 * `close` の閉じ括弧に対応する開き括弧の位置。対応が取れなければ -1。
 * @param {string} code
 * @param {number} close
 */
function matchingOpen(code, close) {
  /** @type {Record<string, string>} */
  const pairs = { ")": "(", "]": "[", "}": "{" };
  const stack = [];
  for (let k = close; k >= 0; k -= 1) {
    const c = code[k];
    if (c in pairs) stack.push(pairs[c]);
    else if (c === "(" || c === "[" || c === "{") {
      if (stack.pop() !== c) return -1;
      if (stack.length === 0) return k;
    }
  }
  return -1;
}

/**
 * 括弧の外側の `,` で分ける。
 * @param {string} text
 */
function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let from = 0;
  for (let k = 0; k < text.length; k += 1) {
    const c = text[k];
    if (c === "(" || c === "[" || c === "{") depth += 1;
    else if (c === ")" || c === "]" || c === "}") depth -= 1;
    else if (c === "," && depth === 0) {
      parts.push(text.slice(from, k));
      from = k + 1;
    }
  }
  parts.push(text.slice(from));
  return parts;
}

/**
 * `i` から逆向きに空白を読み飛ばした位置。
 * @param {string} code
 * @param {number} i
 */
function skipSpaceBack(code, i) {
  let k = i;
  while (k >= 0 && /\s/.test(code[k])) k -= 1;
  return k;
}

/**
 * `close` の閉じ括弧から逆向きに対応する開き括弧を探し、その手前の空白を読み飛ばした位置を返す。
 * 対応が取れなければ null。
 * @param {string} code
 * @param {number} close
 */
function beforeGroupOpen(code, close) {
  const closer = code[close];
  const opener = closer === ")" ? "(" : "[";
  let depth = 1;
  let i = close - 1;
  while (i >= 0 && depth > 0) {
    if (code[i] === closer) depth += 1;
    else if (code[i] === opener) depth -= 1;
    i -= 1;
  }
  if (depth !== 0) return null;
  return skipSpaceBack(code, i);
}

/**
 * `i` の直前に続く丸括弧・角括弧のグループを逆向きに読み飛ばす。対応が取れなければ null。
 * @param {string} code
 * @param {number} start
 */
function skipGroupsBack(code, start) {
  let i = start;
  let called = false;
  let computed = false;
  // 直前に読んだ丸括弧グループの中身の末尾。`(await f()).x()` のように括弧が受け側になる形で、
  // 中身を辿り直すために保持する（複数グループを飛ばしたときは最も左のグループのもの）。
  /** @type {number | null} */
  let groupInteriorEnd = null;
  while (code[i] === ")" || code[i] === "]") {
    if (code[i] === ")") {
      called = true;
      groupInteriorEnd = i - 1;
    } else computed = true;
    const next = beforeGroupOpen(code, i);
    if (next === null) return null;
    i = next;
  }
  return { i, called, computed, groupInteriorEnd };
}

/**
 * チェーンの区間を 1 つ逆向きに読む。読めなければ null。
 * segment が null なら、括弧の中身の末尾（next）から受け側を辿り直す。
 * next が null なら、その区間がチェーンの起点である。
 * @param {string} code
 * @param {number} start
 * @returns {{ segment: { name: string, called: boolean, computed: boolean } | null, next: number | null } | null}
 */
function chainStep(code, start) {
  const groups = skipGroupsBack(code, start);
  if (groups === null) return null;
  const end = groups.i + 1;
  let i = groups.i;
  while (i >= 0 && /[\w$]/.test(code[i])) i -= 1;
  const name = end === i + 1 ? null : code.slice(i + 1, end);
  // 括弧の前に識別子が無い（`(await f()).x()`）か、受け側になれないキーワードが来る
  // （`await (await f()).x()`）なら、括弧の中身の末尾から受け側を辿り直す。
  // `Promise<Locator>` を返す関数は `(await f()).x()` が型的に正しい呼び方なので、
  // この形を解決できないと戻り値注釈の対応が実質使えない。
  if (groups.groupInteriorEnd !== null && (name === null || NON_RECEIVER_KEYWORDS.has(name))) {
    return { segment: null, next: skipSpaceBack(code, groups.groupInteriorEnd) };
  }
  if (name === null) return null;
  const segment = { name, called: groups.called, computed: groups.computed };
  i = skipSpaceBack(code, i);
  if (code[i] !== ".") return { segment, next: null };
  i -= 1;
  // チェーン途中の `receiver?.method()` も通常の `receiver.method()` と同じ起点へ辿る。
  if (code[i] === "?") i -= 1;
  return { segment, next: skipSpaceBack(code, i) };
}

/**
 * 逆向きに集めた区間を root 側からの並びにして返す。区間が無ければ null。
 * @template T
 * @param {T[]} segments
 * @param {boolean} fromGroupInterior
 */
function chainResult(segments, fromGroupInterior) {
  if (segments.length === 0) return null;
  return { segments: segments.reverse(), fromGroupInterior };
}

/**
 * 呼び出し直前の式を逆向きにたどり、プロパティチェーンの各区間を root 側から並べて返す。
 * 区間ごとに「直後が呼び出しだったか」「添字アクセスだったか」を持つ。どちらも名前で解決できない形なので、
 * 判定不能として扱うために区別が要る（添字アクセスはプロパティ名そのものが読めない）。
 * @param {string} code
 * @param {number} dotIndex
 */
function receiverChain(code, dotIndex) {
  let i = skipSpaceBack(code, dotIndex - 1);
  // optional chaining の `?.method()` では、検出対象の `.` の直前に `?` がある。
  if (code[i] === "?") i = skipSpaceBack(code, i - 1);
  const segments = [];
  let fromGroupInterior = false;
  // 1 回の読み進めで i は 1 以上戻るので、回数の上限は dotIndex で足りる。
  // 上限は、読み進めが i を戻さない誤りがあってもループを終わらせるためにある。
  // 上限で抜けたときは、途中までの区間で判定を続けずに例外にする。
  for (let step = 0; i >= 0 && step < dotIndex; step += 1) {
    const read = chainStep(code, i);
    if (read === null) return null;
    if (read.segment === null) fromGroupInterior = true;
    else segments.push(read.segment);
    if (read.next === null) return chainResult(segments, fromGroupInterior);
    i = read.next;
  }
  if (i >= 0) throw new Error("レシーバの連鎖が上限の回数で読み終わらない");
  return chainResult(segments, fromGroupInterior);
}

/**
 * 型注釈（`loc: Locator` / `view: Page`）で Page / Locator と確認できる名前。
 * @param {string} code
 */
function annotatedReceivers(code) {
  const pages = new Set(["page"]);
  const locators = new Set(["locator"]);
  for (const match of code.matchAll(/\b([A-Za-z_$][\w$]*)\s*:\s*(Page|Locator)\b/g)) {
    (match[2] === "Page" ? pages : locators).add(match[1]);
  }
  return { pages, locators };
}

/**
 * Page / Locator を返すと戻り値の型注釈で確認できる、同一ファイル内の関数名。
 * @param {string} code
 */
function returnAnnotatedCallables(code) {
  /** @type {Set<string>} */
  const pageCallables = new Set();
  /** @type {Set<string>} */
  const locatorCallables = new Set();
  // 戻り値の型注釈を持つ関数宣言・アロー関数。`Promise<Locator>` も同じ受け側になる。
  // 引数列は括弧を 1 段まで含められる（`pick: (r: Locator) => Locator` のような関数型の引数。
  // 括弧無しに限ると、注釈を付けても解決せず「注釈を付けろ」と言い続ける）。
  const params = String.raw`(?:[^()]|\([^()]*\))*`;
  // generic なメソッド・関数（`rows<T>(): Locator`）。型引数を読み飛ばさないと注釈を
  // 付けても解決せず、「注釈を付けろ」と言い続けるチェックになる。入れ子は 1 段まで。
  const typeParams = String.raw`(?:\s*<(?:[^<>()]|<[^<>()]*>)*>)?`;
  const returnAnnotation = String.raw`\)\s*:\s*(?:Promise\s*<\s*)?(Page|Locator)\b`;
  const patterns = [
    String.raw`\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)${typeParams}\s*\(${params}${returnAnnotation}`,
    String.raw`\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?${typeParams}\s*\(${params}${returnAnnotation}`,
    // クラス・オブジェクトのメソッド宣言（`gridRows(view: Page): Locator {`）。
    // 戻り値の型注釈は宣言の位置にしか書けないので、呼び出し側と誤って一致することはない。
    // これを読まないと「注釈を付ける」も「ローカル変数へ束ねる」も解決に至らない。
    String.raw`([A-Za-z_$][\w$]*)${typeParams}\s*\(${params}${returnAnnotation}`,
  ];
  for (const pattern of patterns) {
    for (const match of code.matchAll(new RegExp(pattern, "g"))) {
      (match[2] === "Page" ? pageCallables : locatorCallables).add(match[1]);
    }
  }
  return { pageCallables, locatorCallables };
}

/**
 * 代入の右辺の先頭にあるメンバーチェーン（引数より前）を区間に分けて返す。
 * 末尾の区間が呼ばれているか（直後が `(`）も返す。戻り値注釈で解決した名前は呼ばれている
 * 区間にだけ当てる。`const snapshot = model.rows` の未呼び出しプロパティに当てると、
 * 同名の関数宣言 1 つで無関係な変数が誤って Locator と判定され、誤検出でスイートを止める。
 * @param {string} rhs
 */
function leadingChain(rhs) {
  const head = rhs.match(/^\s*(?:await\s+)?([A-Za-z_$][\w$]*(?:\s*\??\.\s*[A-Za-z_$][\w$]*)*)/);
  if (head === null) return null;
  // `?.` も区切りとして落とす。`split(".")` だと `page?.getByRole` が `["page?", …]` になり、
  // どの区間も名前で照合できず、解決できる式が「由来を追えない別名」と誤って判定され、誤検出になる。
  const names = head[1].split(/\s*\??\.\s*/).map((part) => part.trim());
  const rest = rhs.slice(head[0].length);
  const calledIndex = /^\s*\(/.test(rest) ? names.length - 1 : null;
  // チェーンが呼び出し・添字で途切れたか。途切れた先は名前で追えないので、分類できなければ
  // 「追えなかった」側（判定不能）として扱う材料にする（純粋なプロパティ取り出しと区別する）。
  const truncated = /^\s*[([]/.test(rest);
  return { names, calledIndex, truncated };
}

// TS の型アサーション（`x as Locator` / `<Locator>x`）。**注釈（`loc: Locator`）と同じ宣言**なので
// 同じ強さで受け側を決め（対象が識別子チェーンの形に限る。下の TRAILING_ASSERTION を参照）、
// Page / Locator 以外へアサートした別名は由来を追えないものとして扱う。
// 読まないと `leadingChain` の後段の条件（`ident` の直後が `.` / `(` / `[`）に当たらず、
// locators にも pages にも opaqueAliases にも入らないまま、違反 0 件でも判定不能 0 件でもなく、警告なしに消える。
// **続きが識別子で始まる形だけを角括弧アサーションと読む**。`(` を許すと、`.ts` で
// generic なアロー関数（`const pick = <T>(x: T) => x;`）が `<T>` のアサーションに見え、
// 関数の別名が opaqueAliases へ入る。角括弧アサーションが書けるのは `.ts` 系だけなので、
// 誤読が起きるのはまさにその拡張子に限られる。
const ANGLE_ASSERTION = /^\s*<\s*([A-Za-z_$][\w$.]*)(?:\s*<[^<>]*>)?(?:\[\])?\s*>\s*(?=[A-Za-z_$])/;
// **引数の中のアサーションを別名のものと読まない**。`const n = helper(x as Locator)` の `as` を
// 拾うと、無関係な `n` が誤って Locator と判定される。括弧が開く前に現れる形（`x as Locator`）だけを見る。
// **そのぶん、アサート対象に括弧・添字を含む形（`helper() as Locator` / `rows[0] as Locator`）は
// ここで解決しない。** 深さ 0 の `as` を数えれば拾えるが、それは解決できる別名を増やし、
// 判定できないときに止める範囲を狭める変更なので採らない。これらは従来どおりチェーンが途切れた
// 別名として判定不能になり、書き手には戻り値注釈を付ける直し方が出る。
// **`<` / `>` も跨がない**。`.tsx` では JSX のテキストが右辺に来る。跨ぐと
// `const el = <span>use as reference</span>;` の本文が `as reference` のアサーションに見える
// （`maskNonCode` は JSX テキストを潰さない）。角括弧アサーションと違い `as` はどの拡張子でも
// 書けるので、拡張子で止めるのではなく区切りで止める。
// **`,` / `=` も跨がない**。1 文に複数の宣言子を書くと（`const a = raw, b = other as Locator;`）、
// `assignments` が拾うのは先頭の `a` なのに、後ろの宣言子の `as` を `a` のものとして読む。
const TRAILING_ASSERTION =
  /^[^([{<>,=]*\b(?:as|satisfies)\s+(?:Promise\s*<\s*)?([A-Za-z_$][\w$.]*)/;

/**
 * 右辺の型アサーションがどの受け側へのものかを返す関数を作る。
 * @param {boolean} angleAssertionAllowed 角括弧の型アサーションが書ける拡張子か
 */
function assertionKindFor(angleAssertionAllowed) {
  /**
   * @param {string} statement 右辺の最初の文
   * @param {string} rawRhs 右辺の先頭からソースの終端まで
   * @returns {"page" | "locator" | "other" | null}
   */
  // 角括弧のアサーションは右辺の先頭に付くので、1 行目で切らず右辺全体の先頭で見る。
  // 1 行目だけに当てると、`<Locator>` と対象が別の行にある形（`const row = <Locator>\n  raw;`）で
  // アサーションを読み落とし、別名がどこにも入らないまま消える。
  const assertionKind = (statement, rawRhs) => {
    const angle = angleAssertionAllowed ? rawRhs.match(ANGLE_ASSERTION) : null;
    const name = (angle ?? statement.match(TRAILING_ASSERTION))?.[1] ?? null;
    if (name === null) return null;
    if (name === "Page") return "page";
    if (name === "Locator") return "locator";
    return "other";
  };
  return assertionKind;
}

/**
 * playwrightReceivers が閉包を作る間に持つ集合と、右辺を読むための設定。
 * opaqueAliases は、右辺が member / call 式なのに何にも解決しなかった別名。使われたら判定不能にする。
 * @typedef {{
 *   pages: Set<string>,
 *   locators: Set<string>,
 *   pageCallables: Set<string>,
 *   locatorCallables: Set<string>,
 *   opaqueAliases: Set<string>,
 *   angleAssertionAllowed: boolean,
 *   assertionKind: (statement: string, rawRhs: string) => "page" | "locator" | "other" | null,
 * }} ReceiverState
 */

/**
 * 代入の右辺のチェーンに、`receivers` の名前か、`callables` の名前で呼ばれている区間があるか。
 * @param {NonNullable<ReturnType<typeof leadingChain>>} chain
 * @param {Set<string>} receivers
 * @param {Set<string>} callables
 */
function chainHasReceiver(chain, receivers, callables) {
  return chain.names.some(
    (name, index) => receivers.has(name) || (index === chain.calledIndex && callables.has(name)),
  );
}

/**
 * 代入 1 件について、別名をどの集合へ入れるかの判断に使う材料。右辺が何の形でもなければ null。
 * @param {string} code
 * @param {RegExpExecArray} match
 * @param {ReceiverState} state
 */
function assignmentFacts(code, match, state) {
  const rhsStart = match.index + match[0].length;
  const rawRhs = code.slice(rhsStart);
  const rhsStatement = rawRhs.split(/[;\n]/, 1)[0].trim();
  const asserted = state.assertionKind(rhsStatement, rawRhs);
  // 角括弧の型アサーションは右辺の先頭に付く。落としてからでないとチェーンを 1 区間も読めない。
  const rhs =
    state.angleAssertionAllowed && ANGLE_ASSERTION.test(rawRhs)
      ? rawRhs.replace(ANGLE_ASSERTION, "")
      : rawRhs;
  const chain = leadingChain(rhs);
  if (chain === null && asserted === null) return null;
  // 起点だけでなくチェーンの各区間を見る。`const row = this.page.locator('tr')` は
  // 起点が `this` なので、起点だけを見ると別名がどこにも登録されず静かに素通りする。
  const hasLocator =
    chain !== null && chainHasReceiver(chain, state.locators, state.locatorCallables);
  const hasPage = chain !== null && chainHasReceiver(chain, state.pages, state.pageCallables);
  // 呼ばれている区間の名前で見る処理を先に置く。テキスト照合は最初の物理行しか見ないので、
  // 整形で折られたチェーン（`const cell = page\n  .getByRole(...)`）を取りこぼす。
  // 区間はチェーン走査が改行をまたいで拾っているため、名前で見れば折り返しに依存しない。
  const callsLocatorFactory =
    chain !== null &&
    chain.calledIndex !== null &&
    /^(?:locator|frameLocator|getBy\w+)$/.test(chain.names[chain.calledIndex]);
  const isLocatorExpression =
    hasLocator ||
    (hasPage &&
      (callsLocatorFactory || /\.\s*(?:locator|getBy\w+)\s*\(/.test(rhs.split(/[;\n]/, 1)[0])));
  // 呼び出しも添字も含まない純粋なプロパティの取り出しで、末尾が Page に解決する形（`const p = page;`
  // `const p = this.page;`）を Page として束ねる。末尾で見るのは、`const url = page.url` のように
  // Page から取り出した別の値まで、誤って Page と判定しないためである。
  // 束ねないと、page 専用の規則（`waitForTimeout` / `page.$`）が警告なしに外れる。チェーンに `page` を
  // 含むので opaqueAliases にも入らず、違反 0 件でも判定不能 0 件でもないまま、警告なしに通る。
  const isPagePath =
    hasPage &&
    /^[A-Za-z_$][\w$]*(?:\s*\??\.\s*[A-Za-z_$][\w$]*)*$/.test(rhsStatement) &&
    state.pages.has(chain.names[chain.names.length - 1]);
  const target = match[1];
  return { target, rhs, chain, asserted, hasLocator, hasPage, isLocatorExpression, isPagePath };
}

/**
 * Page / Locator 以外へアサートした別名を、由来を追えない別名として扱うか。
 * 右辺がどちらにも解決しない以上、由来は追えない。
 * 型アサーションを挟めば検査から消える、という抜け道を残さない（判定できないものとして扱う）。
 * @param {NonNullable<ReturnType<typeof assignmentFacts>>} facts
 * @param {ReceiverState} state
 */
function opaqueByAssertion(facts, state) {
  const { target, chain, hasLocator, hasPage } = facts;
  return (
    facts.asserted === "other" &&
    // **純粋なプロパティ取り出しの免除をアサーションで外さない**。`const timers = page.clock;` は、
    // Page でも Locator でもない値として、下の枝が従来から対象外にしている。`as Clock` を足しただけで
    // 判定不能として扱うと、その枝が避けている「注釈を強いる誤検出」がアサーション経由で戻る。
    // ただし**受け側そのもの**（末尾が Page / Locator に解決する形。`page as Foo`）は、
    // アサートした先で受け側でなくなったことを追えないので、従来どおり判定不能として扱う。
    (chain === null ||
      chain.truncated ||
      (!hasLocator && !hasPage) ||
      state.pages.has(chain.names[chain.names.length - 1]) ||
      state.locators.has(chain.names[chain.names.length - 1])) &&
    !state.locators.has(target) &&
    !state.pages.has(target) &&
    !state.opaqueAliases.has(target)
  );
}

/**
 * 呼び出し・添字で途切れたチェーンの別名を、由来を追えない別名として扱うか。
 * ローカル変数へ束ねれば検査から消える、という抜け道を作らない。
 * @param {NonNullable<ReturnType<typeof assignmentFacts>>} facts
 * @param {ReceiverState} state
 */
function opaqueByTruncation(facts, state) {
  const { target, chain, hasLocator, hasPage } = facts;
  return (
    // Page / Locator を含むチェーンでも、**呼び出し・添字で途切れていて**上の 2 つに当たらなければ
    // ここで扱う（`const cell = page.frames()[0].getByRole(...)` など）。除外すると
    // 「違反 0 件・判定不能 0 件」で警告なしに捨てられ、判定できないときに止めるはずのチェックが、その形だけを通してしまう。
    // 途切れていない純粋なプロパティ取り出し（`const timers = page.clock`）は Page でも Locator でも
    // ない値なので、従来どおり対象外にする（判定不能にすると注釈を強いる誤検出になる）。
    chain !== null &&
    (chain.truncated || (!hasLocator && !hasPage)) &&
    !state.locators.has(target) &&
    !state.pages.has(target) &&
    !state.opaqueAliases.has(target) &&
    // member / call / 添字のいずれかを含む右辺だけを対象にする（リテラル・算術は除く）。
    /^\s*(?:await\s+)?[A-Za-z_$][\w$]*\s*(?:\??\.|\(|\[)/.test(facts.rhs)
  );
}

/**
 * 代入 1 件の別名を、Page / Locator / 由来を追えない別名のどれかへ入れる。集合が変わったら true。
 * @param {NonNullable<ReturnType<typeof assignmentFacts>>} facts
 * @param {ReceiverState} state
 */
function applyAssignment(facts, state) {
  const { target } = facts;
  /** @param {Set<string>} receivers */
  const settle = (receivers) => {
    receivers.add(target);
    state.opaqueAliases.delete(target);
    return true;
  };
  // 型注釈と同じ宣言として扱う。解決できる式の判定より先に置くと `as const` 等で
  // 本来解決できる右辺まで奪うので、Page / Locator へのアサーションだけをここで受ける。
  if (facts.asserted === "locator" && !state.locators.has(target)) return settle(state.locators);
  if (facts.asserted === "page" && !state.pages.has(target)) return settle(state.pages);
  if (facts.isLocatorExpression && !state.locators.has(target)) return settle(state.locators);
  if (facts.isPagePath && !state.pages.has(target)) return settle(state.pages);
  if (opaqueByAssertion(facts, state) || opaqueByTruncation(facts, state)) {
    state.opaqueAliases.add(target);
    return true;
  }
  return false;
}

/**
 * Page / Locator と確認できる名前を、型注釈・代入チェーン・戻り値注釈から閉包として導出する。
 * 識別子（`page` / `this.page` の `page`）と、Page / Locator を返す同一ファイル内の関数名を分けて持つ。
 * @param {string} code
 * @param {string} [file]
 */
function playwrightReceivers(code, file = "<source>") {
  // 角括弧の型アサーション（`<Locator>x`）は JSX を持ちうる拡張子では書けない（TypeScript が禁じる）。
  // 区別せずに読むと `const el = <div>…</div>` を型アサーションとして扱い、無関係な別名を判定不能にする。
  const angleAssertionAllowed = /\.(?:ts|mts|cts)$/.test(file);
  /** @type {ReceiverState} */
  const state = {
    ...annotatedReceivers(code),
    ...returnAnnotatedCallables(code),
    opaqueAliases: new Set(),
    angleAssertionAllowed,
    assertionKind: assertionKindFor(angleAssertionAllowed),
  };
  const assignments = [...code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*/g)];
  // 集合が変わるのは、別名ごとに Locator・Page・由来を追えない別名へ入るときの高々 3 回である。
  // 上限は、集合が変わったと誤って返す誤りがあってもループを終わらせるためにある。
  let changed = true;
  for (let round = 0; changed && round <= 3 * assignments.length; round += 1) {
    changed = false;
    for (const match of assignments) {
      const facts = assignmentFacts(code, match, state);
      if (facts !== null && applyAssignment(facts, state)) changed = true;
    }
  }
  if (changed) throw new Error("別名の集合が上限の回数で定まらない");
  const { pages, locators, pageCallables, locatorCallables, opaqueAliases, assertionKind } = state;
  const nonReceivers = nonPlaywrightNames(code, {
    assignments,
    pages,
    locators,
    opaqueAliases,
    angleAssertionAllowed,
    assertionKind,
  });
  return {
    page: pages,
    locator: locators,
    pageCallables,
    locatorCallables,
    opaqueAliases,
    nonReceivers,
  };
}

/**
 * 代入の右辺のうち、その宣言子に属する範囲（括弧の外の `;` / `,`、または文を終える改行まで）。
 * 行を折った右辺の続きを読み落とすと、後ろの行に現れる名前が「確定」の判定から外れ、確かめずに通してしまう。
 * そのため、迷ったら長く取る。前の行が演算子で終わるか、次の行が演算子で始まるなら、続きとして読む。
 * @param {string} rawRhs
 */
function declaratorRhs(rawRhs) {
  let depth = 0;
  for (let k = 0; k < rawRhs.length; k += 1) {
    const c = rawRhs[k];
    if (c === "(" || c === "[" || c === "{") depth += 1;
    else if (c === ")" || c === "]" || c === "}") {
      if (depth === 0) return rawRhs.slice(0, k);
      depth -= 1;
    } else if (depth === 0 && (c === ";" || c === ",")) return rawRhs.slice(0, k);
    else if (depth === 0 && c === "\n") {
      const before = rawRhs.slice(0, k).trimEnd();
      const after = rawRhs.slice(k + 1).trimStart();
      if (
        before !== "" &&
        !/[=+\-*/%&|^!~?:,.<>([{]$/.test(before) &&
        !/^[.?:+\-*/%&|^<>=]/.test(after)
      ) {
        return rawRhs.slice(0, k);
      }
    }
  }
  return rawRhs;
}

/**
 * 文字列の起点の名前を、根拠の無い束縛として `unknown` へ入れる関数を作る。
 * @param {Set<string>} unknown
 */
function unknownMarker(unknown) {
  /** @param {string} text */
  return (text) => {
    for (const name of rootNames(text)) unknown.add(name);
  };
}

/**
 * `open` の括弧が束縛の並び（引数・catch・for の頭）を開くか。
 * 閉じ括弧の後が `=>` / `{` / `:`（戻り値注釈）なら束縛の並びと読む。
 * @param {string} code
 * @param {number} open
 * @param {number} close
 */
function opensBindingList(code, open, close) {
  let headEnd = open;
  while (headEnd > 0 && /\s/.test(code[headEnd - 1])) headEnd -= 1;
  let headStart = headEnd;
  while (headStart > 0 && /[\w$]/.test(code[headStart - 1])) headStart -= 1;
  const head = headStart < headEnd ? code.slice(headStart, headEnd) : null;
  if (head !== null && CONDITION_HEADS.has(head)) return false;
  return head === "catch" || head === "for" || /^\s*(?:=>|\{|:)/.test(code.slice(close + 1));
}

/**
 * 引数・catch・for の頭で束ねた名前を `unknown` へ入れる。
 * @param {string} code
 * @param {Set<string>} unknown
 */
function markBindingLists(code, unknown) {
  const markUnknown = unknownMarker(unknown);
  // 引数・catch・for の頭。閉じ括弧の後が `=>` / `{` / `:`（戻り値注釈）なら束縛の並びと読む。
  // 呼び出しの引数を束縛と誤っても、名前が候補から外れる（判定不能になる）だけなので、確かめずに通すことはない。
  for (let open = code.indexOf("("); open !== -1; open = code.indexOf("(", open + 1)) {
    const close = matchingClose(code, open);
    if (close === -1) continue;
    if (!opensBindingList(code, open, close)) continue;
    // 型注釈の有無に依らず、引数の名前はすべて根拠の無い束縛として数える（Page / Locator の注釈は別の処理で解決する）。
    for (const param of splitTopLevel(code.slice(open + 1, close))) markUnknown(param);
  }
  // 括弧の無い単引数のアロー関数（`row => row.count()`）。
  for (const match of code.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*=>/g)) unknown.add(match[1]);
}

/**
 * 分割代入・import・再代入・型注釈付きの宣言で束ねた名前を `unknown` へ入れる。
 * @param {string} code
 * @param {Set<string>} unknown
 */
function markOtherBindings(code, unknown) {
  const markUnknown = unknownMarker(unknown);
  // 分割代入の宣言（`const { rows } = …` / `const [a] = …`）。
  for (const match of code.matchAll(/\b(?:const|let|var)\s*([{[])/g)) {
    const open = match.index + match[0].length - 1;
    const close = matchingClose(code, open);
    markUnknown(close === -1 ? code.slice(open) : code.slice(open + 1, close));
  }
  // import で束ねた名前（別ファイルの値。マッピング層のロケータがここから来る）。
  for (const match of code.matchAll(/\bimport\s+([\s\S]*?)\s+from\b/g)) markUnknown(match[1]);
  // 再代入（宣言の `=` を除く）。宣言時の右辺だけで確定すると、後から代入した Locator が素通りする。
  for (const match of code.matchAll(
    /(?<![\w$])(?<!\.\s*)([A-Za-z_$][\w$]*)\s*(?:\*\*|<<|>>>?|&&|\|\||\?\?|[-+*/%&|^])?=(?![=>])/g,
  )) {
    if (!/\b(?:const|let|var)\s+$/.test(code.slice(Math.max(0, match.index - 16), match.index))) {
      unknown.add(match[1]);
    }
  }
  // 分割代入による再代入（`[row] = …` / `({ row } = …)`）。名前が `=` に隣接しないので上では拾えない。
  // 添字への代入（`arr[i] = …`）も拾うが、名前が候補から外れる（判定不能になる）だけなので、確かめずに通すことはない。
  for (const match of code.matchAll(/[\]}]\s*=(?![=>])/g)) {
    const open = matchingOpen(code, match.index);
    if (open !== -1) markUnknown(code.slice(open + 1, match.index));
  }
  // 型注釈付きの宣言（`const x: Foo = …`）。`assignments` は `x =` の形しか拾わないので、別の束縛として数える。
  for (const match of code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*:/g)) {
    unknown.add(match[1]);
  }
}

/**
 * 宣言ごとの右辺。2 つ以上ある名前は、全部が確定したときだけ確定にする。
 * @param {string} code
 * @param {RegExpExecArray[]} assignments
 */
function declarationSites(code, assignments) {
  /** @type {Map<string, string[]>} */
  const declarations = new Map();
  for (const match of assignments) {
    const rawRhs = code.slice(match.index + match[0].length);
    const sites = declarations.get(match[1]) ?? [];
    sites.push(rawRhs);
    declarations.set(match[1], sites);
  }
  // 2 つ目の宣言は別スコープの別の束縛でありうる。どれか 1 つでも根拠が無ければ候補から外す（下の every）。
  return declarations;
}

/** @param {string} text */
const pathNames = (text) => text.trim().split(/\s*\??\.\s*/);
const PURE_PATH = /^\s*[A-Za-z_$][\w$]*(?:\s*\??\.\s*[A-Za-z_$][\w$]*)*\s*$/;

/**
 * 同じファイルで代入された Page API の名前（`page.clock = …`）。
 * @param {string} code
 */
function reassignedPagePropertyNames(code) {
  return new Set(
    [...code.matchAll(/\.\s*([A-Za-z_$][\w$]*)\s*=(?![=>])/g)]
      .map((match) => match[1])
      .filter((name) => PAGE_NON_RECEIVER_PROPERTIES.has(name)),
  );
}

/**
 * 組み込みもプロパティへ代入できる（`window.row = page.locator(…)` / `Object.assign(window, …)`）。
 * 同じファイルで書き込んでいる組み込みは根拠にしない（辿った先に Locator が入りうる）。
 * @param {string} code
 */
function mutatedBuiltinNames(code) {
  return new Set(
    [
      ...code.matchAll(
        /(?<![\w$.])([A-Za-z_$][\w$]*)\s*(?:\??\.\s*[A-Za-z_$][\w$]*|\[[^\]]*\])+\s*(?:\*\*|<<|>>>?|&&|\|\||\?\?|[-+*/%&|^])?=(?![=>])/g,
      ),
      ...code.matchAll(
        /\b(?:assign|defineProperty|defineProperties|set)\s*\(\s*([A-Za-z_$][\w$]*)/g,
      ),
    ].map((match) => match[1]),
  );
}

/**
 * 右辺が Page から取り出した、Page / Locator でないプロパティ（`page.clock` / `page.clock as Clock`）か。
 * 末尾が受け側そのもの（`page as Foo`）なら確定にしない。
 * @param {string} statement
 * @param {{ pages: Set<string>, reassignedPageProperties: Set<string> }} context
 */
function isPageNonReceiverProperty(statement, { pages, reassignedPageProperties }) {
  const unasserted = statement.replace(/\s+(?:as|satisfies)\s+[\s\S]*$/, "");
  if (!PURE_PATH.test(unasserted)) return false;
  const names = pathNames(unasserted);
  const last = names[names.length - 1];
  return (
    names.length > 1 &&
    pages.has(names[names.length - 2]) &&
    PAGE_NON_RECEIVER_PROPERTIES.has(last) &&
    !reassignedPageProperties.has(last)
  );
}

/**
 * 宣言の右辺 1 つが、Playwright の値を運ばないと確定できるか。
 * @param {string} rawRhs
 * @param {{
 *   pages: Set<string>,
 *   nonReceivers: Set<string>,
 *   reassignedPageProperties: Set<string>,
 *   angleAssertionAllowed: boolean,
 *   assertionKind: (statement: string, rawRhs: string) => "page" | "locator" | "other" | null,
 * }} context
 */
function isNonValueSite(rawRhs, context) {
  const statement = declaratorRhs(rawRhs);
  const asserted = context.assertionKind(statement.split("\n", 1)[0], rawRhs);
  if (isPageNonReceiverProperty(statement, context)) return true;
  if (asserted !== null) return false;
  // JSX 要素。角括弧のアサーションが書ける拡張子（.ts 系）では `<` 始まりを JSX と読まない。
  // 要素として閉じた形（`<X …>…</X>` / `<X … />`）に限る。`<` 始まりだけで認めると、宣言子の切り出しが
  // 型引数の `,` で切った断片（`.tsx` の `<T,>() => …` から `<T`）まで JSX として確定してしまう。
  if (
    !context.angleAssertionAllowed &&
    /^\s*<([A-Za-z][\w.]*)\b[\s\S]*(?:<\/\1\s*>|\/>)\s*$/.test(statement)
  ) {
    return true;
  }
  // 関数式・アロー関数は、括弧を含むか引数名が根拠の無い束縛なので、下の判定で根拠から外れる
  // （関数値そのものと、呼び出し・タグ付きテンプレートの戻り値を見分けられない）。
  // プロパティ参照・呼び出し・添字・括弧（`(box.row)`）を含む式は根拠にしない。起点の名前が確定していても、
  // 辿った先・戻り値は Locator でありうる（`box.row = page.locator(…)` の後の `box.row`）。
  if (/[.([]/.test(statement)) return false;
  return [...rootNames(statement)].every(
    (name) => VALUE_KEYWORDS.has(name) || context.nonReceivers.has(name),
  );
}

/**
 * 受け側として現れたとき「Playwright 以外」と確定できる名前を返す。
 *
 * どれにも解決しない受け側は、ここに入った名前を起点にするものだけを対象外に数え、残りは判定不能にする。
 * **確定の根拠を閉じた集合で持つ**。「解決しなかったら対象外」にすると、読んでいない束縛の形
 * （分割代入・引数・再代入・for-of・import）が、違反 0 件でも判定不能 0 件でもないまま消える。
 *
 * 根拠は次の 2 つである。
 *   1. 同一ファイルの `const|let|var x = <右辺>` で、右辺が Playwright の値を運ばない
 *      （リテラル・起点が全て確定済みの式・JSX・Page から取り出した Page / Locator でないプロパティ）
 *   2. 標準の組み込み（BUILTIN_NON_RECEIVERS）
 *
 * **型注釈と関数値は根拠にしない**（レビュー後に絞った）。型名の中身はファイルの外にありうり
 * （import した型エイリアス・型引数・構造的な interface）、関数値は呼び出し・タグ付きテンプレートの戻り値と
 * 見分けられない（テンプレートは maskNonCode で空白になる）。どちらも例外を 1 つ塞ぐたびに次の書き方が
 * 見つかったので、根拠の側を閉じた小さな集合に保つ。代わりに DOM を扱う callback の引数は判定不能になる。
 *
 * **名前はファイル全体で 1 つとして扱う**（スコープを見ない）。そのため、同じ名前が根拠の無い形でも
 * 束縛されていれば（引数・分割代入・再代入・import・2 つ目の宣言）、どの根拠があっても確定にしない。
 * 迷ったら判定不能として扱う。
 * @param {string} code
 * @param {{
 *   assignments: RegExpExecArray[],
 *   pages: Set<string>,
 *   locators: Set<string>,
 *   opaqueAliases: Set<string>,
 *   angleAssertionAllowed: boolean,
 *   assertionKind: (statement: string, rawRhs: string) => "page" | "locator" | "other" | null,
 * }} context
 */
function nonPlaywrightNames(
  code,
  { assignments, pages, locators, opaqueAliases, angleAssertionAllowed, assertionKind },
) {
  /**
   * 根拠の無い形で束縛されている名前。確定の候補から外す。
   * @type {Set<string>}
   */
  const unknown = new Set();
  markBindingLists(code, unknown);
  markOtherBindings(code, unknown);
  const declarations = declarationSites(code, assignments);
  /** @param {string} name */
  const settled = (name) => pages.has(name) || locators.has(name) || opaqueAliases.has(name);
  /** @param {string} name */
  const candidate = (name) => !settled(name) && !unknown.has(name);
  /** @type {Set<string>} */
  const nonReceivers = new Set();
  const siteContext = {
    pages,
    nonReceivers,
    reassignedPageProperties: reassignedPagePropertyNames(code),
    angleAssertionAllowed,
    assertionKind,
  };
  /** @param {string} rawRhs */
  const siteIsNonValue = (rawRhs) => isNonValueSite(rawRhs, siteContext);
  const mutatedBuiltins = mutatedBuiltinNames(code);
  for (const name of BUILTIN_NON_RECEIVERS) {
    if (candidate(name) && !declarations.has(name) && !mutatedBuiltins.has(name)) {
      nonReceivers.add(name);
    }
  }
  // 起点が全て確定済みの式（`const total = limit + 1`）は、確定した名前が増えるたびに読み直す。
  // 名前は 1 回ずつしか増えないので、読み直しの回数の上限は宣言の数で足りる。
  // 上限は、名前が増えたと誤って返す誤りがあってもループを終わらせるためにある。
  let grew = true;
  for (let round = 0; grew && round <= declarations.size; round += 1) {
    grew = false;
    for (const [name, sites] of declarations) {
      if (nonReceivers.has(name) || !candidate(name)) continue;
      if (sites.every(siteIsNonValue)) {
        nonReceivers.add(name);
        grew = true;
      }
    }
  }
  if (grew) throw new Error("値でない名前の集合が上限の回数で定まらない");
  return nonReceivers;
}

/**
 * チェーンの区間を root 側から見て受け側の種別を決める。種別は最も呼び出しに近い一致で決まる
 * （`page.locator(…)` の受け側は Locator）。
 * どの区間も解決できず、かつ名前で解決できない形（未知の関数呼び出し・添字アクセス）が
 * 含まれていれば判定不能にする。警告なしに違反 0 件として扱わないための分岐である。
 * 呼び出しは起点に限らずチェーン途中も見る（`helpers.rows(view).count()` / `this.rows().count()` は
 * 起点が識別子でも戻り値が読めない。起点だけを見ると、この形が警告なしに違反 0 件として扱われる）。
 * どれか 1 区間でも解決すれば（`kind !== null`）判定不能にはしない。
 * @param {Array<{ name: string, called: boolean, computed: boolean }>} segments
 * @param {ReturnType<typeof playwrightReceivers>} receivers
 * @returns {{ kind: "locator" | "page" | null, undecidable: boolean, reason: "call" | "alias" | "computed" }}
 */
function resolveReceiver(segments, receivers) {
  /** @type {"locator" | "page" | null} */
  let kind = null;
  let hasUnknownCall = false;
  let hasComputedAccess = false;
  let hasOpaqueAlias = false;
  for (const segment of segments) {
    if (segment.computed) hasComputedAccess = true;
    // 戻り値注釈で解決した名前は「呼ばれている区間」だけに当てる。呼ばれていない同名の
    // プロパティに当てると、`function page(…): Locator` があるファイルで
    // `screen.page.waitForTimeout()` の Page 判定を Locator へ上書きし、page 専用規則が静かに外れる。
    // 同名が両方の集合に入るなら（別宣言が別の型を返す）どちらとも決められない。先に並べた側を
    // 採ると、その名前を持つ無関係な宣言 1 つで判定が反転する。解決に使わず、他の区間・
    // 呼び出しの判定不能に委ねる。
    const isLocatorCallable = receivers.locatorCallables.has(segment.name);
    const isPageCallable = receivers.pageCallables.has(segment.name);
    const ambiguousCallable = isLocatorCallable && isPageCallable;
    const callableKind =
      segment.called && !ambiguousCallable
        ? isLocatorCallable
          ? "locator"
          : isPageCallable
            ? "page"
            : null
        : null;
    if (receivers.locator.has(segment.name) || callableKind === "locator") {
      kind = "locator";
    } else if (receivers.page.has(segment.name) || callableKind === "page") {
      kind = "page";
    } else if (segment.called) {
      hasUnknownCall = true;
    } else if (receivers.opaqueAliases.has(segment.name)) {
      // 由来を追えない別名。ローカル変数へ束ねると警告なしに消える、という形を残さない。
      hasOpaqueAlias = true;
    }
  }
  return {
    kind,
    undecidable: kind === null && (hasUnknownCall || hasComputedAccess || hasOpaqueAlias),
    reason: hasUnknownCall ? "call" : hasOpaqueAlias ? "alias" : "computed",
  };
}

/** @param {string} file */
function isCaptureSpec(file) {
  return file.split(/[/\\]/).includes(CAPTURE_ONLY_SEGMENT);
}

/**
 * 走査の結果 1 件。rule は RULES の id か UNRESOLVED_RULE。
 * @typedef {{ line: number, column: number, file: string, rule: string, message: string }} Finding
 */

/**
 * 呼び出し 1 件の受け側を解決した結果。
 * undecidable は判定不能、excluded は Playwright 以外と確定、resolved は受け側を解決した呼び出し。
 * @typedef {{ outcome: "undecidable", message: string }
 *   | { outcome: "excluded" }
 *   | { outcome: "resolved", kind: "locator" | "page" }} CallSite
 */

/**
 * `index` の `.` から始まる呼び出しの受け側を解決する。
 * @param {string} code
 * @param {number} index
 * @param {ReturnType<typeof playwrightReceivers>} receivers
 * @returns {CallSite}
 */
function classifyCallSite(code, index, receivers) {
  const chain = receiverChain(code, index);
  // 起点を確定できない形（リテラル起点・括弧の対応が取れない等）は判定不能として残す。
  if (chain === null) return { outcome: "undecidable", message: UNRESOLVED_MESSAGES.opaque };
  const { kind, undecidable, reason } = resolveReceiver(chain.segments, receivers);
  // 括弧の中身から辿った区間が何にも解決しなければ、括弧で包んだ式（`(a + b).count()` 等）
  // と区別できないので、判定不能として扱う。中身を見に行ったぶん、確かめずに通す形を増やさない。
  if (undecidable || (kind === null && chain.fromGroupInterior)) {
    return {
      outcome: "undecidable",
      message: UNRESOLVED_MESSAGES[undecidable ? reason : "opaque"],
    };
  }
  if (kind !== null) return { outcome: "resolved", kind };
  // どれにも解決しない受け側は、起点が Playwright 以外と確定した名前のときだけ対象外に数える。
  // 警告なしに読み飛ばすと、束縛を読めなかった名前（引数・分割代入・再代入・for-of・import）の呼び出しが
  // 違反 0 件でも判定不能 0 件でもないまま消える。
  // 同じファイルで確定した名前は、その名前そのもの（チェーン長 1）だけを対象外に数える。
  // プロパティ（`box.row` / `timers.row`）は後から Locator を代入できる（代入・Object.assign 等）ので、
  // 辿った先は確定にしない。組み込み（`document.body`）は実行環境の値なので辿ってよい。
  const root = chain.segments[0].name;
  if (
    receivers.nonReceivers.has(root) &&
    (chain.segments.length === 1 || BUILTIN_NON_RECEIVERS.has(root))
  ) {
    return { outcome: "excluded" };
  }
  return { outcome: "undecidable", message: UNRESOLVED_MESSAGES.binding };
}

/**
 * @param {string} code
 * @param {number} index
 */
function sourcePosition(code, index) {
  const before = code.slice(0, index);
  return { line: before.split("\n").length, column: index - before.lastIndexOf("\n") };
}

/**
 * @param {string} source
 * @param {string} [file]
 */
export function scanSourceWithStats(source, file = "<source>") {
  const code = maskNonCode(source);
  const receivers = playwrightReceivers(code, file);
  const captureSpec = isCaptureSpec(file);
  /** @type {Finding[]} */
  const findings = [];
  // exempted は resolved の内数（解決してから免除する）。内訳は callSites = resolved + undecidable + excluded。
  const stats = { callSites: 0, resolved: 0, undecidable: 0, excluded: 0, exempted: 0 };
  for (const rule of RULES) {
    const methodPattern = rule.methods.map((method) => method.replaceAll("$", "\\$")).join("|");
    const pattern = new RegExp(`\\.\\s*(?:${methodPattern})\\s*\\(`, "g");
    for (const match of code.matchAll(pattern)) {
      stats.callSites += 1;
      const site = classifyCallSite(code, match.index, receivers);
      if (site.outcome === "excluded") {
        stats.excluded += 1;
        continue;
      }
      if (site.outcome === "undecidable") {
        stats.undecidable += 1;
        findings.push({
          ...sourcePosition(code, match.index),
          file,
          rule: UNRESOLVED_RULE,
          message: site.message,
        });
        continue;
      }
      // 解決できた受け側は、規則の要求と合わなくても件数に数える（合致だけを数えると
      // 「解決できた」と「規則が当たった」が区別できず、ok: 行が測れた量を示さなくなる）。
      stats.resolved += 1;
      const matchesReceiver = rule.receivers.some(
        (want) => want === site.kind || (want === "locator" && site.kind === "page"),
      );
      if (!matchesReceiver) continue;
      if (captureSpec && CAPTURE_EXEMPT_RULES.has(rule.id)) {
        stats.exempted += 1;
        continue;
      }
      findings.push({
        ...sourcePosition(code, match.index),
        file,
        rule: rule.id,
        message: rule.message,
      });
    }
  }
  findings.sort((a, b) => a.line - b.line || a.column - b.column || a.rule.localeCompare(b.rule));
  return { findings, stats };
}

/**
 * 走査の内訳が呼び出し数と合わなければ、その説明を返す（合えば null）。
 * 各呼び出しは「解決」「判定不能」「Playwright 以外と確定」のどれか 1 つに必ず数える。
 * 合わないのはスキャナが呼び出しをどこにも数えずに捨てた＝違反 0 件と「見えていない」が同じ見え方になる状態。
 * @param {{ callSites: number, resolved: number, undecidable: number, excluded: number, exempted?: number }} stats
 */
export function breakdownMismatch(stats) {
  const { callSites, resolved, undecidable, excluded } = stats;
  if (callSites === resolved + undecidable + excluded) return null;
  return (
    `禁止 API の呼び出し ${callSites} 件 ≠ 解決 ${resolved} + 判定不能 ${undecidable} + ` +
    `Playwright 以外と確定 ${excluded}（スキャナが呼び出しを数えずに捨てている）`
  );
}

/**
 * @param {string} source
 * @param {string} [file]
 */
export function scanSource(source, file = "<source>") {
  return scanSourceWithStats(source, file).findings.map((finding) => ({
    file: finding.file,
    line: finding.line,
    column: finding.column,
    rule: finding.rule,
    message: finding.message,
  }));
}

/**
 * @param {string} path
 * @param {{ files: string[], problems: string[] }} found 見つけたファイルと、読めなかった理由を積む先
 * @param {boolean} [explicit]
 */
function collectSourceFiles(path, found, explicit = true) {
  let stat;
  try {
    stat = statSync(path);
  } catch (error) {
    found.problems.push(`${path}: 読み込めない: ${String(error)}`);
    return;
  }
  if (stat.isFile()) {
    if (SOURCE_EXTENSIONS.has(extname(path))) found.files.push(path);
    else if (explicit) found.problems.push(`${path}: 対象外の拡張子`);
    return;
  }
  if (!stat.isDirectory()) {
    found.problems.push(`${path}: 通常ファイルまたはディレクトリではない`);
    return;
  }
  for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    collectSourceFiles(resolve(path, entry.name), found, false);
  }
}

const STAT_KEYS = /** @type {const} */ ([
  "callSites",
  "resolved",
  "undecidable",
  "excluded",
  "exempted",
]);

/**
 * 走査の対象を 1 ファイルずつ走査し、違反と判定不能と件数の合計を返す。走査できなければ null。
 * @param {string[]} targets
 */
function scanTargets(targets) {
  /** @type {Finding[]} */
  const violations = [];
  /** @type {Finding[]} */
  const unresolved = [];
  // total の欄を STAT_KEYS から型で決める（欄が足りなくても、STAT_KEYS に無い欄を足しても tsc が失敗する）
  /** @type {Record<(typeof STAT_KEYS)[number], number>} */
  const total = { callSites: 0, resolved: 0, undecidable: 0, excluded: 0, exempted: 0 };
  for (const file of targets) {
    let result;
    try {
      result = scanSourceWithStats(readFileSync(file, "utf8"), file);
    } catch (error) {
      process.stderr.write(`error: ${file}: 走査不能: ${String(error)}\n`);
      return null;
    }
    const mismatch = breakdownMismatch(result.stats);
    if (mismatch !== null) {
      process.stderr.write(`error: ${file}: 走査の内訳が合わない: ${mismatch}\n`);
      return null;
    }
    for (const key of STAT_KEYS) total[key] += result.stats[key];
    for (const finding of result.findings) {
      (finding.rule === UNRESOLVED_RULE ? unresolved : violations).push(finding);
    }
  }
  return { violations, unresolved, total };
}

/**
 * 走査の結果を出力し、終了コードを返す。
 * @param {number} fileCount
 * @param {NonNullable<ReturnType<typeof scanTargets>>} scanned
 */
function report(fileCount, { violations, unresolved, total }) {
  for (const v of [...violations, ...unresolved]) {
    process.stderr.write(`${v.file}:${v.line}:${v.column}: ${v.rule}: ${v.message}\n`);
  }
  // 走査できた量を必ず出す。違反 0 件と「見えていない」を出力で区別できるようにする。
  const measured =
    `走査 ${fileCount} ファイル / 禁止 API の呼び出し ${total.callSites} 件 / ` +
    `受け側を解決 ${total.resolved} 件 / 判定不能 ${total.undecidable} 件 / ` +
    `Playwright 以外と確定 ${total.excluded} 件 / 採取スペックで免除 ${total.exempted} 件`;
  if (violations.length > 0 || unresolved.length > 0) {
    if (violations.length > 0) {
      process.stderr.write(`error: 待たない取得 API を ${violations.length} 件検出\n`);
    }
    if (unresolved.length > 0) {
      process.stderr.write(`error: 受け側を解決できない呼び出しが ${unresolved.length} 件\n`);
    }
    process.stderr.write(`error: ${measured}\n`);
    return 1;
  }
  process.stdout.write(`ok: ${measured} / 待たない取得 API は 0 件\n`);
  return 0;
}

/** @param {string[]} args */
export function main(args) {
  if (args.length === 0) {
    process.stderr.write("usage: auto-wait-check.mjs <suite-file-or-directory> [...]\n");
    return 2;
  }
  /** @type {{ files: string[], problems: string[] }} */
  const found = { files: [], problems: [] };
  for (const arg of args) collectSourceFiles(resolve(arg), found);
  if (found.files.length === 0)
    found.problems.push("走査対象の JavaScript / TypeScript ファイルが 0 件");
  for (const problem of found.problems) process.stderr.write(`error: ${problem}\n`);
  if (found.problems.length > 0) return 2;

  // 走査は重複を除いた集合に対して 1 回ずつ行う。報告する件数も同じ集合から採る
  // （引数が重なった `parity/ parity/a.spec.ts` で件数だけ水増しすると、
  // 「走査ファイル数がスイートの実ファイル数と合っているか」の確認が通ってしまう）。
  const targets = [...new Set(found.files)].sort();
  const scanned = scanTargets(targets);
  if (scanned === null) return 2;
  return report(targets.length, scanned);
}

if (isCliEntry(import.meta.url)) process.exit(main(process.argv.slice(2)));
