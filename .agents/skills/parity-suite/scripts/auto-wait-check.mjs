// パリティスイートから Playwright の待たない取得 API を検出する。
// TypeScript の構文変換は行わず、コメント・文字列・正規表現リテラルを除外したソースを決定論的に走査する。

import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".jsx", ".ts", ".mts", ".cts", ".tsx"]);

/** 現側専用の採取スペックを置くディレクトリ名（正本は references/locator-mapping.md の配置表）。 */
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
  call: "受け側を解決できない（関数呼び出しの戻り値が経路に混じる）。その関数の戻り値へ Page / Locator の型注釈を付ける",
  computed:
    "受け側を解決できない（添字アクセスでプロパティ名が読めない）。プロパティ名で引いた値をローカル変数へ束ねる",
  alias:
    "受け側を解決できない（束ねた変数の由来を追えない）。右辺の関数の戻り値、またはプロパティへ Page / Locator の型注釈を付ける",
  opaque:
    "受け側の起点を確定できない（括弧で包んだ式・リテラル等）。Page / Locator に解決する式から引く",
  binding:
    "受け側の名前の束縛を解決できない（Page / Locator 以外の注釈を含む引数・分割代入・再代入・for-of・import・未宣言の名前・this のプロパティ等）。" +
    "Locator / Page なら束縛へ型注釈（`loc: Locator`）を付ける。Playwright 以外の値（evaluate の中の DOM 等）は " +
    "`document` / `window` を起点にした式で直接読む",
};

/**
 * `/` の直前の意味のあるトークンから、そこが正規表現リテラルを開始できる位置かを判定する。
 * ECMAScript の字句は前のトークンで分岐する（<https://tc39.es/ecma262/#sec-literals-regular-expression-literals>）。
 * 曖昧なときは除算に倒す——正規表現を除算と誤れば引用符が残って終端不明の例外（fail-closed）になるが、
 * 除算を正規表現と誤ると実コードを潰して違反が静かに消える。
 */
// `in` / `of` は contextual keyword で、ふつうの識別子にもなれる（`const of = 2; of / d`）。
// 一方この位置で正規表現が来る形（`for (const r of /re/.exec(s))`）は実在しないため、
// 識別子側の誤りだけが残る。誤って除算を潰すと違反が静かに消えるので、集合に入れない。
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

/** `{` がブロックを開くか（＝閉じ波括弧が値で終わらないか）を直前のトークンから判定する。 */
function braceOpensBlock(lastToken) {
  if (lastToken === null) return true;
  if (lastToken.type === "punct") return BLOCK_BRACE_AFTER_PUNCTUATORS.has(lastToken.value);
  if (lastToken.type === "word") {
    return lastToken.member || !OBJECT_BRACE_AFTER_KEYWORDS.has(lastToken.value);
  }
  return false;
}

/** 直前のトークンが値で終わるか（＝続く `!` が後置の非 null 演算子か）。 */
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

/** 直前のトークンが、プロパティ名でない素の制御構文キーワードか。 */
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
 * 次の `/` までの違反が黙って消える。
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
 * コメント・文字列・テンプレート文字列・正規表現リテラルを空白へ置換し、行・桁位置を保つ。
 * 判定不能な終端はエラーにする（走査できなかったファイルを違反 0 件へ倒さない）。
 */
export function maskNonCode(source) {
  // source.length / source[i] と同じ UTF-16 code unit 単位にする。スプレッドは code point 単位なので、
  // 非 BMP 文字の後で添字がずれ、マスク位置・違反位置が壊れる。
  const out = source.split("");
  /** テンプレートと補間の入れ子を積む。`${}` の中のテンプレートを閉じるために深さが要る。 */
  const stack = [];
  /** 開き括弧ごとに「制御構文の頭か」を積む。閉じ括弧の後で正規表現を許すかの判定に使う。 */
  const parenHeads = [];
  /** 開き波括弧ごとに「ブロックか」を積む。閉じ波括弧の後で正規表現を許すかの判定に使う。 */
  const braceBlocks = [];
  let state = "code";
  let quote = "";
  let lastToken = null;
  let i = 0;
  const blankRange = (from, to) => {
    for (let k = from; k < to; k += 1) if (source[k] !== "\n") out[k] = " ";
  };
  const closeBrace = () => {
    const blockClose = braceBlocks.length > 0 ? braceBlocks.pop() : false;
    return { type: "punct", value: "}", blockClose };
  };
  const skipEscape = () => {
    out[i] = " ";
    if (i + 1 < source.length) {
      if (source[i + 1] !== "\n") out[i + 1] = " ";
      i += 2;
    } else i += 1;
  };

  while (i < source.length) {
    const c = source[i];
    const n = source[i + 1];

    if (state === "code") {
      if (c === "/" && n === "/") {
        const eol = source.indexOf("\n", i);
        const end = eol === -1 ? source.length : eol;
        blankRange(i, end);
        i = end;
        continue;
      }
      if (c === "/" && n === "*") {
        const close = source.indexOf("*/", i + 2);
        if (close === -1) throw new Error("ソース終端で block-comment が閉じていない");
        blankRange(i, close + 2);
        i = close + 2;
        continue;
      }
      // `</` は JSX / TSX の閉じタグ。`<` は値で終わらないので正規表現が許される位置だが、
      // ここを正規表現の開始と読むと次の閉じタグの `/` までを潰し、間の実コードごと違反が消える。
      // 空白を挟む比較（`a < /re/`）は隣接しないので区別できる。空白なしの `a</re/` は
      // 正規表現として読まれずマスクされないが、その場合は終端不明の例外（fail-closed）に倒れる。
      const jsxClosingTag = c === "/" && i > 0 && source[i - 1] === "<";
      if (c === "/" && !jsxClosingTag && regexAllowedAfter(lastToken)) {
        const end = regexLiteralEnd(source, i);
        if (end !== -1) {
          blankRange(i, end);
          i = end;
          lastToken = { type: "literal" };
          continue;
        }
        // 終端を確定できない。除算として読み進める。
      }
      if (c === "'" || c === '"') {
        out[i] = " ";
        quote = c;
        state = "string";
        i += 1;
        continue;
      }
      if (c === "`") {
        out[i] = " ";
        stack.push({ kind: "template" });
        state = "template";
        i += 1;
        continue;
      }
      const top = stack.length > 0 ? stack[stack.length - 1] : null;
      if (c === "{" && top !== null && top.kind === "interpolation") {
        top.braces += 1;
        braceBlocks.push(braceOpensBlock(lastToken));
        lastToken = { type: "punct", value: "{" };
        i += 1;
        continue;
      }
      if (c === "}" && top !== null && top.kind === "interpolation") {
        if (top.braces === 0) {
          out[i] = " ";
          stack.pop();
          state = "template";
          i += 1;
          continue;
        }
        top.braces -= 1;
        lastToken = closeBrace();
        i += 1;
        continue;
      }
      if (/[A-Za-z_$]/.test(c)) {
        let end = i + 1;
        while (end < source.length && /[\w$]/.test(source[end])) end += 1;
        // `.` の直後ならプロパティ名。キーワードとしての意味を持たない。
        const member = lastToken !== null && lastToken.type === "punct" && lastToken.value === ".";
        lastToken = { type: "word", value: source.slice(i, end), member };
        i = end;
        continue;
      }
      if (/\d/.test(c)) {
        let end = i + 1;
        while (end < source.length && /[\w.]/.test(source[end])) end += 1;
        lastToken = { type: "number" };
        i = end;
        continue;
      }
      if (/\s/.test(c)) {
        i += 1;
        continue;
      }
      if ((c === "+" || c === "-") && n === c) {
        lastToken = { type: "punct", value: c + c };
        i += 2;
        continue;
      }
      if (c === "(") {
        parenHeads.push(isControlHeadKeyword(lastToken));
        lastToken = { type: "punct", value: "(" };
        i += 1;
        continue;
      }
      if (c === ")") {
        const controlHead = parenHeads.length > 0 ? parenHeads.pop() : false;
        lastToken = { type: "punct", value: ")", controlHead };
        i += 1;
        continue;
      }
      if (c === "{") {
        braceBlocks.push(braceOpensBlock(lastToken));
        lastToken = { type: "punct", value: "{" };
        i += 1;
        continue;
      }
      if (c === "}") {
        lastToken = closeBrace();
        i += 1;
        continue;
      }
      if (c === "!") {
        // `await` / `yield` は文脈依存キーワードで、script / CommonJS では識別子にもなる。
        // 直後の `!` が前置の否定（キーワード）か後置の非 null（識別子）かは、**次のトークンの形**で決まる:
        // 被演算子が続けば前置（`await !Promise.resolve(x)`）、演算子が続けば後置（`await! / d`）。
        // 曖昧なのは次が `/` のときだけ——前置なら正規表現の開始、後置なら除算で、
        // 前置に倒すと次の `/` までがマスクされてその間の違反が黙って消える。
        // そこだけ走査できないファイルとして落とす（判定不能を違反 0 件へ倒さない）。
        if (
          lastToken !== null &&
          lastToken.type === "word" &&
          !lastToken.member &&
          CONTEXTUAL_VALUE_KEYWORDS.has(lastToken.value) &&
          startsAmbiguousSlash(source, i + 1)
        ) {
          throw new Error(
            `${lastToken.value} の直後の \`!\` と \`/\` は「正規表現の開始」とも「非 null の後の除算」とも読める（${lastToken.value} を識別子に使わないか、括弧で区切る）`,
          );
        }
        lastToken = { type: "punct", value: "!", postfix: endsWithValue(lastToken) };
        i += 1;
        continue;
      }
      lastToken = { type: "punct", value: c };
      i += 1;
      continue;
    }

    if (state === "string") {
      if (c === "\\") {
        skipEscape();
        continue;
      }
      if (c === quote) {
        out[i] = " ";
        state = "code";
        lastToken = { type: "literal" };
        i += 1;
        continue;
      }
      if (c !== "\n") out[i] = " ";
      i += 1;
      continue;
    }

    // state === "template"
    if (c === "\\") {
      skipEscape();
      continue;
    }
    if (c === "`") {
      const top = stack.length > 0 ? stack[stack.length - 1] : null;
      if (top === null || top.kind !== "template") {
        throw new Error("テンプレート文字列の入れ子を追えない");
      }
      out[i] = " ";
      stack.pop();
      state = "code";
      lastToken = { type: "literal" };
      i += 1;
      continue;
    }
    if (c === "$" && n === "{") {
      out[i] = out[i + 1] = " ";
      stack.push({ kind: "interpolation", braces: 0 });
      state = "code";
      // 補間の先頭。ここから始まる `/` は正規表現でありうる。
      lastToken = null;
      i += 2;
      continue;
    }
    if (c !== "\n") out[i] = " ";
    i += 1;
  }

  if (state !== "code" || stack.length > 0) {
    const unclosed = state !== "code" ? state : stack[stack.length - 1].kind;
    throw new Error(`ソース終端で ${unclosed} が閉じていない`);
  }
  return out.join("");
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
 * 任意の名前を認めると、`page.row = page.locator(…)` のように後から Locator を入れたプロパティが確定に化ける。
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

/** プロパティ名（`.` の直後）とオブジェクトリテラルのキーを除いた、式の起点になる名前を返す。 */
function rootNames(text) {
  const names = new Set();
  for (const match of text.matchAll(/(?<![\w$])(?<!\.\s*)[A-Za-z_$][\w$]*/g)) {
    const before = text.slice(0, match.index);
    const after = text.slice(match.index + match[0].length);
    const objectKey = /[{,]\s*$/.test(before) && /^\s*:(?!:)/.test(after);
    if (!objectKey) names.add(match[0]);
  }
  return names;
}

/** `open` の開き括弧に対応する閉じ括弧の位置。対応が取れなければ -1。 */
function matchingClose(code, open) {
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

/** `close` の閉じ括弧に対応する開き括弧の位置。対応が取れなければ -1。 */
function matchingOpen(code, close) {
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

/** 括弧の外側の `,` で分ける。 */
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
 * 呼び出し直前の式を逆向きにたどり、プロパティチェーンの各区間を root 側から並べて返す。
 * 区間ごとに「直後が呼び出しだったか」「添字アクセスだったか」を持つ——どちらも名前で解決できない形なので、
 * 判定不能として扱うために区別が要る（添字アクセスはプロパティ名そのものが読めない）。
 */
function receiverChain(code, dotIndex) {
  let i = dotIndex - 1;
  const skipSpace = () => {
    while (i >= 0 && /\s/.test(code[i])) i -= 1;
  };
  const segments = [];
  skipSpace();
  // optional chaining の `?.method()` では、検出対象の `.` の直前に `?` がある。
  if (code[i] === "?") {
    i -= 1;
    skipSpace();
  }
  let fromGroupInterior = false;
  while (i >= 0) {
    let called = false;
    let computed = false;
    // 直前に読んだ丸括弧グループの中身の末尾。`(await f()).x()` のように括弧が受け側になる形で、
    // 中身を辿り直すために保持する（複数グループを飛ばしたときは最も左のグループのもの）。
    let groupInteriorEnd = null;
    while (code[i] === ")" || code[i] === "]") {
      const close = code[i];
      if (close === ")") {
        called = true;
        groupInteriorEnd = i - 1;
      } else computed = true;
      const open = close === ")" ? "(" : "[";
      let depth = 1;
      i -= 1;
      while (i >= 0 && depth > 0) {
        if (code[i] === close) depth += 1;
        else if (code[i] === open) depth -= 1;
        i -= 1;
      }
      if (depth !== 0) return null;
      skipSpace();
    }
    const end = i + 1;
    while (i >= 0 && /[\w$]/.test(code[i])) i -= 1;
    const name = end === i + 1 ? null : code.slice(i + 1, end);
    // 括弧の前に識別子が無い（`(await f()).x()`）か、受け側になれないキーワードが来る
    // （`await (await f()).x()`）なら、括弧の中身の末尾から受け側を辿り直す。
    // `Promise<Locator>` を返す関数は `(await f()).x()` が型的に正しい呼び方なので、
    // この形を解決できないと戻り値注釈の対応が実質使えない。
    if (groupInteriorEnd !== null && (name === null || NON_RECEIVER_KEYWORDS.has(name))) {
      i = groupInteriorEnd;
      fromGroupInterior = true;
      skipSpace();
      continue;
    }
    if (name === null) return null;
    segments.push({ name, called, computed });
    skipSpace();
    if (code[i] !== ".") break;
    i -= 1;
    // チェーン途中の `receiver?.method()` も通常の `receiver.method()` と同じ起点へ辿る。
    if (code[i] === "?") i -= 1;
    skipSpace();
  }
  if (segments.length === 0) return null;
  return { segments: segments.reverse(), fromGroupInterior };
}

/**
 * Page / Locator と確認できる名前を、型注釈・代入チェーン・戻り値注釈から閉包として導出する。
 * 識別子（`page` / `this.page` の `page`）と、Page / Locator を返す同一ファイル内の関数名を分けて持つ。
 */
function playwrightReceivers(code, file = "<source>") {
  const pages = new Set(["page"]);
  const locators = new Set(["locator"]);
  // 角括弧の型アサーション（`<Locator>x`）は JSX を持ちうる拡張子では書けない（TypeScript が禁じる）。
  // 区別せずに読むと `const el = <div>…</div>` を型アサーションとして扱い、無関係な別名を判定不能にする。
  const angleAssertionAllowed = /\.(?:ts|mts|cts)$/.test(file);
  const pageCallables = new Set();
  const locatorCallables = new Set();
  for (const match of code.matchAll(/\b([A-Za-z_$][\w$]*)\s*:\s*(Page|Locator)\b/g)) {
    (match[2] === "Page" ? pages : locators).add(match[1]);
  }
  // 戻り値の型注釈を持つ関数宣言・アロー関数。`Promise<Locator>` も同じ受け側になる。
  // 引数列は括弧を 1 段まで含められる（`pick: (r: Locator) => Locator` のような関数型の引数。
  // 括弧無しに限ると、注釈を付けても解決せず「注釈を付けろ」と言い続ける）。
  const params = String.raw`(?:[^()]|\([^()]*\))*`;
  // generic なメソッド・関数（`rows<T>(): Locator`）。型引数を読み飛ばさないと注釈を
  // 付けても解決せず、「注釈を付けろ」と言い続けるゲートになる。入れ子は 1 段まで。
  const typeParams = String.raw`(?:\s*<(?:[^<>()]|<[^<>()]*>)*>)?`;
  const returnAnnotation = String.raw`\)\s*:\s*(?:Promise\s*<\s*)?(Page|Locator)\b`;
  for (const match of code.matchAll(
    new RegExp(
      String.raw`\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)${typeParams}\s*\(${params}${returnAnnotation}`,
      "g",
    ),
  )) {
    (match[2] === "Page" ? pageCallables : locatorCallables).add(match[1]);
  }
  for (const match of code.matchAll(
    new RegExp(
      String.raw`\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?${typeParams}\s*\(${params}${returnAnnotation}`,
      "g",
    ),
  )) {
    (match[2] === "Page" ? pageCallables : locatorCallables).add(match[1]);
  }
  // クラス・オブジェクトのメソッド宣言（`gridRows(view: Page): Locator {`）。
  // 戻り値の型注釈は宣言の位置にしか書けないので、呼び出し側と誤って一致することはない。
  // これを読まないと「注釈を付ける」も「ローカル変数へ束ねる」も解決に至らない。
  for (const match of code.matchAll(
    new RegExp(String.raw`([A-Za-z_$][\w$]*)${typeParams}\s*\(${params}${returnAnnotation}`, "g"),
  )) {
    (match[2] === "Page" ? pageCallables : locatorCallables).add(match[1]);
  }

  /** 代入の右辺の先頭にあるメンバーチェーン（引数より前）を区間に分けて返す。 */
  // 末尾の区間が呼ばれているか（直後が `(`）も返す。戻り値注釈で解決した名前は呼ばれている
  // 区間にだけ当てる——`const snapshot = model.rows` の未呼び出しプロパティに当てると、
  // 同名の関数宣言 1 つで無関係な変数が Locator に化け、誤検出でスイートを止める。
  const leadingChain = (rhs) => {
    const head = rhs.match(/^\s*(?:await\s+)?([A-Za-z_$][\w$]*(?:\s*\??\.\s*[A-Za-z_$][\w$]*)*)/);
    if (head === null) return null;
    // `?.` も区切りとして落とす。`split(".")` だと `page?.getByRole` が `["page?", …]` になり、
    // どの区間も名前で照合できず、解決できる式が「由来を追えない別名」に化けて誤検出になる。
    const names = head[1].split(/\s*\??\.\s*/).map((part) => part.trim());
    const rest = rhs.slice(head[0].length);
    const calledIndex = /^\s*\(/.test(rest) ? names.length - 1 : null;
    // チェーンが呼び出し・添字で途切れたか。途切れた先は名前で追えないので、分類できなければ
    // 「追えなかった」側（判定不能）へ倒す材料にする（純粋なプロパティ取り出しと区別する）。
    const truncated = /^\s*[([]/.test(rest);
    return { names, calledIndex, truncated };
  };
  // TS の型アサーション（`x as Locator` / `<Locator>x`）。**注釈（`loc: Locator`）と同じ宣言**なので
  // 同じ強さで受け側を決め（対象が識別子チェーンの形に限る。下の TRAILING_ASSERTION を参照）、
  // Page / Locator 以外へアサートした別名は由来を追えないものとして扱う。
  // 読まないと `leadingChain` の後段の条件（`ident` の直後が `.` / `(` / `[`）に当たらず、
  // locators にも pages にも opaqueAliases にも入らないまま——違反 0 件でも判定不能 0 件でもなく——静かに消える。
  // **続きが識別子で始まる形だけを角括弧アサーションと読む**——`(` を許すと、`.ts` で
  // generic なアロー関数（`const pick = <T>(x: T) => x;`）が `<T>` のアサーションに見え、
  // 関数の別名が opaqueAliases へ入る。角括弧アサーションが書けるのは `.ts` 系だけなので、
  // 誤読が起きるのはまさにその拡張子に限られる。
  const ANGLE_ASSERTION =
    /^\s*<\s*([A-Za-z_$][\w$.]*)(?:\s*<[^<>]*>)?(?:\[\])?\s*>\s*(?=[A-Za-z_$])/;
  // **引数の中のアサーションを別名のものと読まない**——`const n = helper(x as Locator)` の `as` を
  // 拾うと、無関係な `n` が Locator に化ける。括弧が開く前に現れる形（`x as Locator`）だけを見る。
  // **そのぶん、アサート対象に括弧・添字を含む形（`helper() as Locator` / `rows[0] as Locator`）は
  // ここで解決しない。** 深さ 0 の `as` を数えれば拾えるが、それは解決できる別名を増やす＝
  // fail-closed の網を緩める向きの変更なので採らない。これらは従来どおりチェーンが途切れた
  // 別名として判定不能に落ち、書き手には戻り値注釈を付ける直し方が出る（挙動は本修正の前後で同じ）。
  // **`<` / `>` も跨がない**——`.tsx` では JSX のテキストが右辺に来る。跨ぐと
  // `const el = <span>use as reference</span>;` の本文が `as reference` のアサーションに見える
  // （`maskNonCode` は JSX テキストを潰さない）。角括弧アサーションと違い `as` はどの拡張子でも
  // 書けるので、拡張子で止めるのではなく区切りで止める。
  // **`,` / `=` も跨がない**——1 文に複数の宣言子を書くと（`const a = raw, b = other as Locator;`）、
  // `assignments` が拾うのは先頭の `a` なのに、後ろの宣言子の `as` を `a` のものとして読む。
  const TRAILING_ASSERTION =
    /^[^([{<>,=]*\b(?:as|satisfies)\s+(?:Promise\s*<\s*)?([A-Za-z_$][\w$.]*)/;
  /**
   * @param {string} statement 右辺の最初の文
   * @returns {"page" | "locator" | "other" | null}
   */
  // 角括弧のアサーションは右辺の先頭に付くので、1 行目で切らず右辺全体の先頭で見る。
  // 1 行目だけに当てると、`<Locator>` と対象が別の行にある形（`const row = <Locator>\n  raw;`）で
  // アサーションを読み落とし、別名がどこにも入らないまま消える（Issue #412）。
  const assertionKind = (statement, rawRhs) => {
    const angle = angleAssertionAllowed ? rawRhs.match(ANGLE_ASSERTION) : null;
    const name = (angle ?? statement.match(TRAILING_ASSERTION))?.[1] ?? null;
    if (name === null) return null;
    if (name === "Page") return "page";
    if (name === "Locator") return "locator";
    return "other";
  };
  const assignments = [...code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*/g)];
  /** 右辺が member / call 式なのに何にも解決しなかった別名。使われたら判定不能にする。 */
  const opaqueAliases = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const match of assignments) {
      const rhsStart = match.index + match[0].length;
      const rawRhs = code.slice(rhsStart);
      const rhsStatement = rawRhs.split(/[;\n]/, 1)[0].trim();
      const asserted = assertionKind(rhsStatement, rawRhs);
      // 角括弧の型アサーションは右辺の先頭に付く。落としてからでないとチェーンを 1 区間も読めない。
      const rhs =
        angleAssertionAllowed && ANGLE_ASSERTION.test(rawRhs)
          ? rawRhs.replace(ANGLE_ASSERTION, "")
          : rawRhs;
      const chain = leadingChain(rhs);
      if (chain === null && asserted === null) continue;
      const target = match[1];
      // 起点だけでなくチェーンの各区間を見る。`const row = this.page.locator('tr')` は
      // 起点が `this` なので、起点だけを見ると別名がどこにも登録されず静かに素通りする。
      const hasLocator =
        chain !== null &&
        chain.names.some(
          (name, index) =>
            locators.has(name) || (index === chain.calledIndex && locatorCallables.has(name)),
        );
      const hasPage =
        chain !== null &&
        chain.names.some(
          (name, index) =>
            pages.has(name) || (index === chain.calledIndex && pageCallables.has(name)),
        );
      // 呼ばれている区間の名前で見る経路を先に置く。テキスト照合は最初の物理行しか見ないので、
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
      // 呼び出しも添字も含まない純粋なプロパティ経路で、末尾が Page に解決する形（`const p = page;`
      // `const p = this.page;`）を Page として束ねる。末尾で見るのは、`const url = page.url` のように
      // Page から取り出した別の値まで Page に化けさせないため。
      // 束ねないと page 専用規則（`waitForTimeout` / `page.$`）が静かに外れる——チェーンに `page` を
      // 含むので opaqueAliases にも入らず、違反 0 件でも判定不能 0 件でもない黙った素通りになる。
      const isPagePath =
        hasPage &&
        /^[A-Za-z_$][\w$]*(?:\s*\??\.\s*[A-Za-z_$][\w$]*)*$/.test(rhsStatement) &&
        pages.has(chain.names[chain.names.length - 1]);
      if (asserted === "locator" && !locators.has(target)) {
        // 型注釈と同じ宣言として扱う。解決できる式の判定より先に置くと `as const` 等で
        // 本来解決できる右辺まで奪うので、Page / Locator へのアサーションだけをここで受ける。
        locators.add(target);
        opaqueAliases.delete(target);
        changed = true;
      } else if (asserted === "page" && !pages.has(target)) {
        pages.add(target);
        opaqueAliases.delete(target);
        changed = true;
      } else if (isLocatorExpression && !locators.has(target)) {
        locators.add(target);
        opaqueAliases.delete(target);
        changed = true;
      } else if (isPagePath && !pages.has(target)) {
        pages.add(target);
        opaqueAliases.delete(target);
        changed = true;
      } else if (
        // Page / Locator 以外へアサートした別名。右辺がどちらにも解決しない以上、由来は追えない。
        // 型アサーションを挟めば検査から消える、という抜け道を残さない（fail-closed）。
        asserted === "other" &&
        // **純粋なプロパティ取り出しの免除をアサーションで外さない**——`const timers = page.clock;` は
        // Page でも Locator でもない値として下の枝が従来から対象外にしている。`as Clock` を足しただけで
        // 判定不能へ倒すと、その枝が避けている「注釈を強いる誤検出」がアサーション経由で復活する。
        // ただし**受け側そのもの**（末尾が Page / Locator に解決する形。`page as Foo`）は、
        // アサートした先で受け側でなくなったことを追えないので従来どおり倒す。
        (chain === null ||
          chain.truncated ||
          (!hasLocator && !hasPage) ||
          pages.has(chain.names[chain.names.length - 1]) ||
          locators.has(chain.names[chain.names.length - 1])) &&
        !locators.has(target) &&
        !pages.has(target) &&
        !opaqueAliases.has(target)
      ) {
        opaqueAliases.add(target);
        changed = true;
      } else if (
        // Page / Locator を含むチェーンでも、**呼び出し・添字で途切れていて**上の 2 つに当たらなければ
        // ここへ落とす（`const cell = page.frames()[0].getByRole(...)` 等）。除外すると
        // 「違反 0 件・判定不能 0 件」で黙って捨てられ、fail-closed のはずのゲートがその形だけ素通りする。
        // 途切れていない純粋なプロパティ取り出し（`const timers = page.clock`）は Page でも Locator でも
        // ない値なので、従来どおり対象外にする（判定不能にすると注釈を強いる誤検出になる）。
        chain !== null &&
        (chain.truncated || (!hasLocator && !hasPage)) &&
        !locators.has(target) &&
        !pages.has(target) &&
        !opaqueAliases.has(target) &&
        // member / call / 添字のいずれかを含む右辺だけを対象にする（リテラル・算術は除く）。
        /^\s*(?:await\s+)?[A-Za-z_$][\w$]*\s*(?:\??\.|\(|\[)/.test(rhs)
      ) {
        // 由来を追えない別名。ローカル変数へ束ねれば検査から消える、という抜け道を作らない。
        opaqueAliases.add(target);
        changed = true;
      }
    }
  }
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
 * 行を折った右辺の続きを読み落とすと、後ろの行に現れる名前が「確定」の判定から漏れる（fail-open）ので、
 * 迷ったら長く取る側へ倒す——前の行が演算子で終わるか、次の行が演算子で始まるなら続きとして読む。
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
 * 受け側として現れたとき「Playwright 以外」と確定できる名前を返す（Issue #412）。
 *
 * どれにも解決しない受け側は、ここに入った名前を起点にするものだけを対象外に数え、残りは判定不能にする。
 * **確定の根拠を閉じた集合で持つ**——「解決しなかったら対象外」にすると、読んでいない束縛の形
 * （分割代入・引数・再代入・for-of・import）が、違反 0 件でも判定不能 0 件でもないまま消える。
 *
 * 根拠は 2 つ:
 *   1. 同一ファイルの `const|let|var x = <右辺>` で、右辺が Playwright の値を運ばない
 *      （リテラル・起点が全て確定済みの式・JSX・Page から取り出した Page / Locator でないプロパティ）
 *   2. 標準の組み込み（BUILTIN_NON_RECEIVERS）
 *
 * **型注釈と関数値は根拠にしない**（PR #448 のレビュー後に絞った）。型名の中身はファイルの外にありうり
 * （import した型エイリアス・型引数・構造的な interface）、関数値は呼び出し・タグ付きテンプレートの戻り値と
 * 見分けられない（テンプレートは maskNonCode で空白になる）。どちらも例外を 1 つ塞ぐたびに次の書き方が
 * 見つかったので、根拠の側を閉じた小さな集合に保つ。代わりに DOM を扱う callback の引数は判定不能になる。
 *
 * **名前はファイル全体で 1 つとして扱う**（スコープを見ない）。そのため、同じ名前が根拠の無い形でも
 * 束縛されていれば（引数・分割代入・再代入・import・2 つ目の宣言）、どの根拠があっても確定にしない。
 * 迷ったら判定不能側（fail-closed）へ倒す。
 */
function nonPlaywrightNames(
  code,
  { assignments, pages, locators, opaqueAliases, angleAssertionAllowed, assertionKind },
) {
  /** 根拠の無い形で束縛されている名前。確定の候補から外す。 */
  const unknown = new Set();
  const markUnknown = (text) => {
    for (const name of rootNames(text)) unknown.add(name);
  };
  // 引数・catch・for の頭。閉じ括弧の後が `=>` / `{` / `:`（戻り値注釈）なら束縛の並びと読む。
  // 呼び出しの引数を束縛と誤っても、名前が候補から外れるだけ（判定不能側）なので安全側に倒れる。
  for (let open = code.indexOf("("); open !== -1; open = code.indexOf("(", open + 1)) {
    const close = matchingClose(code, open);
    if (close === -1) continue;
    let headEnd = open;
    while (headEnd > 0 && /\s/.test(code[headEnd - 1])) headEnd -= 1;
    let headStart = headEnd;
    while (headStart > 0 && /[\w$]/.test(code[headStart - 1])) headStart -= 1;
    const head = headStart < headEnd ? code.slice(headStart, headEnd) : null;
    if (head !== null && CONDITION_HEADS.has(head)) continue;
    const bindingList =
      head === "catch" || head === "for" || /^\s*(?:=>|\{|:)/.test(code.slice(close + 1));
    if (!bindingList) continue;
    // 型注釈の有無に依らず、引数の名前はすべて根拠の無い束縛として数える（Page / Locator の注釈は別経路で解決する）。
    for (const param of splitTopLevel(code.slice(open + 1, close))) markUnknown(param);
  }
  // 括弧の無い単引数のアロー関数（`row => row.count()`）。
  for (const match of code.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*=>/g)) unknown.add(match[1]);
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
  // 添字への代入（`arr[i] = …`）も拾うが、名前が候補から外れるだけ（判定不能側）なので安全側に倒れる。
  for (const match of code.matchAll(/[\]}]\s*=(?![=>])/g)) {
    const open = matchingOpen(code, match.index);
    if (open !== -1) markUnknown(code.slice(open + 1, match.index));
  }
  // 型注釈付きの宣言（`const x: Foo = …`）。`assignments` は `x =` の形しか拾わないので、別の束縛として数える。
  for (const match of code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*:/g)) {
    unknown.add(match[1]);
  }

  /** 宣言ごとの右辺。2 つ以上ある名前は、全部が確定したときだけ確定にする。 */
  const declarations = new Map();
  for (const match of assignments) {
    const rawRhs = code.slice(match.index + match[0].length);
    const sites = declarations.get(match[1]) ?? [];
    sites.push(rawRhs);
    declarations.set(match[1], sites);
  }
  // 2 つ目の宣言は別スコープの別の束縛でありうる。どれか 1 つでも根拠が無ければ候補から外す（下の every）。

  const settled = (name) => pages.has(name) || locators.has(name) || opaqueAliases.has(name);
  const candidate = (name) => !settled(name) && !unknown.has(name);
  const nonReceivers = new Set();
  const pathNames = (text) => text.trim().split(/\s*\??\.\s*/);
  const PURE_PATH = /^\s*[A-Za-z_$][\w$]*(?:\s*\??\.\s*[A-Za-z_$][\w$]*)*\s*$/;
  /** 同じファイルで代入された Page API の名前（`page.clock = …`）。 */
  const reassignedPageProperties = new Set(
    [...code.matchAll(/\.\s*([A-Za-z_$][\w$]*)\s*=(?![=>])/g)]
      .map((match) => match[1])
      .filter((name) => PAGE_NON_RECEIVER_PROPERTIES.has(name)),
  );
  const siteIsNonValue = (rawRhs) => {
    const statement = declaratorRhs(rawRhs);
    const asserted = assertionKind(statement.split("\n", 1)[0], rawRhs);
    // Page から取り出した、Page / Locator でないプロパティ（`page.clock` / `page.clock as Clock`）。
    // 末尾が受け側そのもの（`page as Foo`）なら確定にしない。
    const unasserted = statement.replace(/\s+(?:as|satisfies)\s+[\s\S]*$/, "");
    if (PURE_PATH.test(unasserted)) {
      const names = pathNames(unasserted);
      const last = names[names.length - 1];
      if (
        names.length > 1 &&
        pages.has(names[names.length - 2]) &&
        PAGE_NON_RECEIVER_PROPERTIES.has(last) &&
        !reassignedPageProperties.has(last)
      ) {
        return true;
      }
    }
    if (asserted !== null) return false;
    // JSX 要素。角括弧のアサーションが書ける拡張子（.ts 系）では `<` 始まりを JSX と読まない。
    // 要素として閉じた形（`<X …>…</X>` / `<X … />`）に限る。`<` 始まりだけで認めると、宣言子の切り出しが
    // 型引数の `,` で切った断片（`.tsx` の `<T,>() => …` から `<T`）まで JSX として確定してしまう。
    if (
      !angleAssertionAllowed &&
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
      (name) => VALUE_KEYWORDS.has(name) || nonReceivers.has(name),
    );
  };

  // 組み込みもプロパティへ代入できる（`window.row = page.locator(…)` / `Object.assign(window, …)`）。
  // 同じファイルで書き込んでいる組み込みは根拠にしない（辿った先に Locator が入りうる）。
  const mutatedBuiltins = new Set(
    [
      ...code.matchAll(
        /(?<![\w$.])([A-Za-z_$][\w$]*)\s*(?:\??\.\s*[A-Za-z_$][\w$]*|\[[^\]]*\])+\s*(?:\*\*|<<|>>>?|&&|\|\||\?\?|[-+*/%&|^])?=(?![=>])/g,
      ),
      ...code.matchAll(
        /\b(?:assign|defineProperty|defineProperties|set)\s*\(\s*([A-Za-z_$][\w$]*)/g,
      ),
    ].map((match) => match[1]),
  );
  for (const name of BUILTIN_NON_RECEIVERS) {
    if (candidate(name) && !declarations.has(name) && !mutatedBuiltins.has(name)) {
      nonReceivers.add(name);
    }
  }
  // 起点が全て確定済みの式（`const total = limit + 1`）は、確定した名前が増えるたびに読み直す。
  let grew = true;
  while (grew) {
    grew = false;
    for (const [name, sites] of declarations) {
      if (nonReceivers.has(name) || !candidate(name)) continue;
      if (sites.every(siteIsNonValue)) {
        nonReceivers.add(name);
        grew = true;
      }
    }
  }
  return nonReceivers;
}

/**
 * チェーンの区間を root 側から見て受け側の種別を決める。種別は最も呼び出しに近い一致で決まる
 * （`page.locator(…)` の受け側は Locator）。
 * どの区間も解決できず、かつ名前で解決できない形（未知の関数呼び出し・添字アクセス）が
 * 混じっていれば判定不能にする——黙って違反 0 件へ倒さないための分岐。
 * 呼び出しは起点に限らずチェーン途中も見る（`helpers.rows(view).count()` / `this.rows().count()` は
 * 起点が識別子でも戻り値が読めない。起点だけを見ると、この形が静かに違反 0 件へ落ちる）。
 * どれか 1 区間でも解決すれば（`kind !== null`）判定不能にはしない。
 */
function resolveReceiver(segments, receivers) {
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
      // 由来を追えない別名。ローカル変数へ束ねると静かに消える、という形を残さない。
      hasOpaqueAlias = true;
    }
  }
  return {
    kind,
    undecidable: kind === null && (hasUnknownCall || hasComputedAccess || hasOpaqueAlias),
    reason: hasUnknownCall ? "call" : hasOpaqueAlias ? "alias" : "computed",
  };
}

function isCaptureSpec(file) {
  return file.split(/[/\\]/).includes(CAPTURE_ONLY_SEGMENT);
}

export function scanSourceWithStats(source, file = "<source>") {
  const code = maskNonCode(source);
  const receivers = playwrightReceivers(code, file);
  const captureSpec = isCaptureSpec(file);
  const findings = [];
  // exempted は resolved の内数（解決してから免除する）。内訳は callSites = resolved + undecidable + excluded。
  const stats = { callSites: 0, resolved: 0, undecidable: 0, excluded: 0, exempted: 0 };
  const position = (index) => {
    const before = code.slice(0, index);
    return { line: before.split("\n").length, column: index - before.lastIndexOf("\n") };
  };
  for (const rule of RULES) {
    const methodPattern = rule.methods.map((method) => method.replaceAll("$", "\\$")).join("|");
    const pattern = new RegExp(`\\.\\s*(?:${methodPattern})\\s*\\(`, "g");
    for (const match of code.matchAll(pattern)) {
      stats.callSites += 1;
      const chain = receiverChain(code, match.index);
      // 起点を確定できない形（リテラル起点・括弧の対応が取れない等）は判定不能として残す。
      if (chain === null) {
        stats.undecidable += 1;
        findings.push({
          ...position(match.index),
          file,
          rule: UNRESOLVED_RULE,
          message: UNRESOLVED_MESSAGES.opaque,
        });
        continue;
      }
      const { kind, undecidable, reason } = resolveReceiver(chain.segments, receivers);
      // 括弧の中身から辿った区間が何にも解決しなければ、括弧で包んだ式（`(a + b).count()` 等）
      // と区別できないので判定不能に倒す。中身を見に行ったぶんを fail-open にしない。
      if (undecidable || (kind === null && chain.fromGroupInterior)) {
        stats.undecidable += 1;
        findings.push({
          ...position(match.index),
          file,
          rule: UNRESOLVED_RULE,
          message: UNRESOLVED_MESSAGES[undecidable ? reason : "opaque"],
        });
        continue;
      }
      if (kind === null) {
        // どれにも解決しない受け側は、起点が Playwright 以外と確定した名前のときだけ対象外に数える。
        // 黙って読み飛ばすと、束縛を読めなかった名前（引数・分割代入・再代入・for-of・import）の呼び出しが
        // 違反 0 件でも判定不能 0 件でもないまま消える（Issue #412）。
        // 同じファイルで確定した名前は、その名前そのもの（チェーン長 1）だけを対象外に数える。
        // プロパティ（`box.row` / `timers.row`）は後から Locator を代入できる（代入・Object.assign 等）ので、
        // 辿った先は確定にしない。組み込み（`document.body`）は実行環境の値なので辿ってよい。
        const root = chain.segments[0].name;
        if (
          receivers.nonReceivers.has(root) &&
          (chain.segments.length === 1 || BUILTIN_NON_RECEIVERS.has(root))
        ) {
          stats.excluded += 1;
          continue;
        }
        stats.undecidable += 1;
        findings.push({
          ...position(match.index),
          file,
          rule: UNRESOLVED_RULE,
          message: UNRESOLVED_MESSAGES.binding,
        });
        continue;
      }
      // 解決できた受け側は、規則の要求と合わなくても件数に数える（合致だけを数えると
      // 「解決できた」と「規則が当たった」が区別できず、ok: 行が測れた量を示さなくなる）。
      stats.resolved += 1;
      const matchesReceiver = rule.receivers.some(
        (want) => want === kind || (want === "locator" && kind === "page"),
      );
      if (!matchesReceiver) continue;
      if (captureSpec && CAPTURE_EXEMPT_RULES.has(rule.id)) {
        stats.exempted += 1;
        continue;
      }
      findings.push({ ...position(match.index), file, rule: rule.id, message: rule.message });
    }
  }
  findings.sort((a, b) => a.line - b.line || a.column - b.column || a.rule.localeCompare(b.rule));
  return { findings, stats };
}

/**
 * 走査の内訳が呼び出し数と合わなければ、その説明を返す（合えば null）。
 * 各呼び出しは「解決」「判定不能」「Playwright 以外と確定」のどれか 1 つに必ず数える。
 * 合わないのは走査器が呼び出しをどこにも数えずに捨てた＝違反 0 件と「見えていない」が同じ見え方になる状態。
 */
export function breakdownMismatch(stats) {
  const { callSites, resolved, undecidable, excluded } = stats;
  if (callSites === resolved + undecidable + excluded) return null;
  return (
    `禁止 API の呼び出し ${callSites} 件 ≠ 解決 ${resolved} + 判定不能 ${undecidable} + ` +
    `Playwright 以外と確定 ${excluded}（走査器が呼び出しを数えずに捨てている）`
  );
}

export function scanSource(source, file = "<source>") {
  return scanSourceWithStats(source, file).findings.map((finding) => ({
    file: finding.file,
    line: finding.line,
    column: finding.column,
    rule: finding.rule,
    message: finding.message,
  }));
}

function collect(path, files, problems, explicit = true) {
  let stat;
  try {
    stat = statSync(path);
  } catch (error) {
    problems.push(`${path}: 読み込めない: ${String(error)}`);
    return;
  }
  if (stat.isFile()) {
    if (SOURCE_EXTENSIONS.has(extname(path))) files.push(path);
    else if (explicit) problems.push(`${path}: 対象外の拡張子`);
    return;
  }
  if (!stat.isDirectory()) {
    problems.push(`${path}: 通常ファイルまたはディレクトリではない`);
    return;
  }
  for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    collect(resolve(path, entry.name), files, problems, false);
  }
}

export function main(args) {
  if (args.length === 0) {
    process.stderr.write("usage: auto-wait-check.mjs <suite-file-or-directory> [...]\n");
    return 2;
  }
  const files = [];
  const problems = [];
  for (const arg of args) collect(resolve(arg), files, problems);
  if (files.length === 0) problems.push("走査対象の JavaScript / TypeScript ファイルが 0 件");
  for (const problem of problems) process.stderr.write(`error: ${problem}\n`);
  if (problems.length > 0) return 2;

  const violations = [];
  const unresolved = [];
  const total = { callSites: 0, resolved: 0, undecidable: 0, excluded: 0, exempted: 0 };
  // 走査は重複を除いた集合に対して 1 回ずつ行う。報告する件数も同じ集合から採る
  // （引数が重なった `parity/ parity/a.spec.ts` で件数だけ水増しすると、
  // 「走査ファイル数がスイートの実ファイル数と合っているか」の確認が通ってしまう）。
  const targets = [...new Set(files)].sort();
  for (const file of targets) {
    let result;
    try {
      result = scanSourceWithStats(readFileSync(file, "utf8"), file);
    } catch (error) {
      process.stderr.write(`error: ${file}: 走査不能: ${String(error)}\n`);
      return 2;
    }
    const mismatch = breakdownMismatch(result.stats);
    if (mismatch !== null) {
      process.stderr.write(`error: ${file}: 走査の内訳が合わない: ${mismatch}\n`);
      return 2;
    }
    for (const key of Object.keys(total)) total[key] += result.stats[key];
    for (const finding of result.findings) {
      (finding.rule === UNRESOLVED_RULE ? unresolved : violations).push(finding);
    }
  }
  for (const v of [...violations, ...unresolved]) {
    process.stderr.write(`${v.file}:${v.line}:${v.column}: ${v.rule}: ${v.message}\n`);
  }
  // 走査できた量を必ず出す。違反 0 件と「見えていない」を出力で区別できるようにする。
  const measured =
    `走査 ${targets.length} ファイル / 禁止 API の呼び出し ${total.callSites} 件 / ` +
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

const invokedAsCli = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  const self = fileURLToPath(import.meta.url);
  try {
    return realpathSync(entry) === realpathSync(self);
  } catch {
    return entry === self;
  }
})();

if (invokedAsCli) process.exit(main(process.argv.slice(2)));
