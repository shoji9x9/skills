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
    "受け側を解決できない（束ねた変数の由来を追えない）。右辺の関数の戻り値へ Page / Locator の型注釈を付ける",
  opaque:
    "受け側の起点を確定できない（括弧で包んだ式・リテラル等）。Page / Locator に解決する式から引く",
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
function playwrightReceivers(code) {
  const pages = new Set(["page"]);
  const locators = new Set(["locator"]);
  const pageCallables = new Set();
  const locatorCallables = new Set();
  for (const match of code.matchAll(/\b([A-Za-z_$][\w$]*)\s*:\s*(Page|Locator)\b/g)) {
    (match[2] === "Page" ? pages : locators).add(match[1]);
  }
  // 戻り値の型注釈を持つ関数宣言・アロー関数。`Promise<Locator>` も同じ受け側になる。
  // 引数列は括弧を 1 段まで含められる（`pick: (r: Locator) => Locator` のような関数型の引数。
  // 括弧無しに限ると、注釈を付けても解決せず「注釈を付けろ」と言い続ける）。
  const params = String.raw`(?:[^()]|\([^()]*\))*`;
  const returnAnnotation = String.raw`\)\s*:\s*(?:Promise\s*<\s*)?(Page|Locator)\b`;
  for (const match of code.matchAll(
    new RegExp(
      String.raw`\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(${params}${returnAnnotation}`,
      "g",
    ),
  )) {
    (match[2] === "Page" ? pageCallables : locatorCallables).add(match[1]);
  }
  for (const match of code.matchAll(
    new RegExp(
      String.raw`\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?\(${params}${returnAnnotation}`,
      "g",
    ),
  )) {
    (match[2] === "Page" ? pageCallables : locatorCallables).add(match[1]);
  }
  // クラス・オブジェクトのメソッド宣言（`gridRows(view: Page): Locator {`）。
  // 戻り値の型注釈は宣言の位置にしか書けないので、呼び出し側と誤って一致することはない。
  // これを読まないと「注釈を付ける」も「ローカル変数へ束ねる」も解決に至らない。
  for (const match of code.matchAll(
    new RegExp(String.raw`([A-Za-z_$][\w$]*)\s*\(${params}${returnAnnotation}`, "g"),
  )) {
    (match[2] === "Page" ? pageCallables : locatorCallables).add(match[1]);
  }

  /** 代入の右辺の先頭にあるメンバーチェーン（引数より前）を区間に分けて返す。 */
  const leadingChain = (rhs) => {
    const head = rhs.match(/^\s*(?:await\s+)?([A-Za-z_$][\w$]*(?:\s*\??\.\s*[A-Za-z_$][\w$]*)*)/);
    if (head === null) return null;
    return head[1].split(".").map((part) => part.trim());
  };
  const assignments = [...code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*/g)];
  /** 右辺が member / call 式なのに何にも解決しなかった別名。使われたら判定不能にする。 */
  const opaqueAliases = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const match of assignments) {
      const rhsStart = match.index + match[0].length;
      const rhs = code.slice(rhsStart);
      const chain = leadingChain(rhs);
      if (chain === null) continue;
      const target = match[1];
      const rhsStatement = rhs.split(/[;\n]/, 1)[0].trim();
      // 起点だけでなくチェーンの各区間を見る。`const row = this.page.locator('tr')` は
      // 起点が `this` なので、起点だけを見ると別名がどこにも登録されず静かに素通りする。
      const hasLocator = chain.some((name) => locators.has(name) || locatorCallables.has(name));
      const hasPage = chain.some((name) => pages.has(name) || pageCallables.has(name));
      const isLocatorExpression =
        hasLocator || (hasPage && /\.\s*(?:locator|getBy\w+)\s*\(/.test(rhs.split(/[;\n]/, 1)[0]));
      if (isLocatorExpression && !locators.has(target)) {
        locators.add(target);
        opaqueAliases.delete(target);
        changed = true;
      } else if (hasPage && !pages.has(target) && rhsStatement === chain[0]) {
        pages.add(target);
        opaqueAliases.delete(target);
        changed = true;
      } else if (
        !hasLocator &&
        !hasPage &&
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
  return { page: pages, locator: locators, pageCallables, locatorCallables, opaqueAliases };
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
  const receivers = playwrightReceivers(code);
  const captureSpec = isCaptureSpec(file);
  const findings = [];
  const stats = { callSites: 0, resolved: 0, undecidable: 0, exempted: 0 };
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
      if (kind === null) continue;
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
  const total = { callSites: 0, resolved: 0, undecidable: 0, exempted: 0 };
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
    `受け側を解決 ${total.resolved} 件 / 判定不能 ${total.undecidable} 件 / 採取スペックで免除 ${total.exempted} 件`;
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
