// 採取した CSS 規則のカスケードの解決（解決の仕方はこのスクリプトで定義する）。
// **プロジェクトへコピーせずスキルの中からそのまま実行する**（css-rules-capture.mjs と同じ取り決め）。
//
// 何をするか: `css-rules.json`（css-rules-capture.mjs の出力）を読み、プロパティ × 擬似要素ごとに
// **実際に勝っている宣言を 1 つに確定**する。優先順位は CSS のカスケード順で、
//   1. インラインの `!important`
//   2. 規則の `!important`（レイヤ間の順序は**逆転**する）
//   3. インラインの非 `!important`
//   4. 規則の非 `!important`（後のレイヤが勝つ。レイヤ無しが最も強い）
// 同じ段の中では 詳細度 → 出現順（`order` の大きい方が後勝ち）で決める。
//
// なぜ要るか: `matched` を読むだけでは足りない。同じプロパティに複数のスタイルシートが
// 競合する宣言を持つ構成（基礎スタイルシート → テーマ層 → 個別テーマの順に読み込み、後段が
// 同一セレクタ・同一プロパティを再宣言して上書きする）では、**最初に見つかった宣言を採ると
// 実際の描画と逆の実装になる**。`feedback-message` の閉じるボタン（`top` が 0 → 2px → 5px、
// グリフの不透明度が不透明 → alpha≈0.5）と `radio-button` の外側の輪（inset の影 → `none`）が
// この形で実装に残っていた。インライン値が `!important` 付き規則に負ける形（`width: 10px` の
// インラインが `.SearchBoxButton { width: 25px !important }` に負ける）も同じ。
//
// 判定できないときは失敗として扱う。「勝つ宣言を 1 つに決められない」ときに、警告なしに最初の宣言を勝者として扱わない。
// 次のものは `undecidable` として理由付きで残し、exit 1 にする（利用者は現行の CSS を直接読んで確定する）。
//   - セレクタの詳細度を機械的に決められない（トップレベルのカンマ＝どの枝が当たったか不明、
//     未解決の `&`、読めないトークン）
//   - 競合する候補が**別のカスケードレイヤ**にある（レイヤの宣言順は `css-rules.json` に無く、
//     `layers` の名前だけからは前後を決められない）
//   - 条件付き（`@media` / `@supports` / `@container`）の候補が勝ちうる。css-rules-capture.mjs は
//     条件を**評価せず記録するだけ**なので、当たっているかどうかはこの入力から決まらない
//   - 最も強い詳細度で競う別々の規則のどれかに、出現順（`order`）が無い。どちらが後に書かれたかを
//     決められない（勝者を選ぶときも、条件付き等の候補が追い越すかを判定するときも同じ）
//   - 恒常状態（`:enabled` / `:valid` / `:read-only` 等）を条件とする候補が勝ちうる。これらは
//     要素の性質であって採取ディレクトリ名からは決まらない（下記 TRANSIENT_STATES）
//   - 競合が**無名レイヤ**にある。無名 `@layer` の名前は空文字で記録されるため、別々のレイヤが
//     同じパスに見える
//   - 採取が**不完全**（`inaccessible` / `unresolved` が非ゼロ）。見えていないスタイルシートや
//     判定していないセレクタに、`matched` の全候補より強い宣言がありうる。見えている部分集合の
//     勝者を確定しても、それは全体の勝者ではない（`--allow-incomplete` で明示的に免除できる）
//
// 状態は入力から決まらない: `css-rules.json` は状態ごとに別ファイルだが、ファイル自身は
// どの状態で採ったかを持たない（`baseline/<instance>/<state>/` のディレクトリ名が持つ）。
// `matched` には他の状態でだけ当たる規則（`states: ["hover"]` 等）も並ぶため、**`--state` は必須**にする。
// `--state default` は「追加の状態擬似クラス無しで当たる規則だけ」を意味する。
//
// 何を決めないか: これは**合否の判定ではない**。勝つ宣言を決めるのは、実装時に何を反映するかを
// 確定するためで、現新の差分は画素の比較と特性の照合で出す（css-rules-capture.mjs と同じ分担）。
//
// 決定論的: 乱数・現在時刻・ネットワークに依存しない。TypeScript 構文は使わない（型は JSDoc）。

import { readFileSync } from "node:fs";
import { isArray } from "./lib/is-array.mjs";
import { isCliEntry } from "./lib/cli.mjs";
import { parseFlags } from "./lib/flags.mjs";
import { isObjectLike, isPlainObject } from "./lib/guards.mjs";

/**
 * ツールのバージョン（このスクリプトで定義する）。優先順位の規則・出力の形・判定できないとする条件を変えたら上げる。
 * @type {string}
 */
export const VERSION = "3";

/** 入力として受け付ける css-rules-capture.mjs の `tool_version`（採取スキーマが違う入力は読まない）。 */
export const SUPPORTED_CSS_RULES_VERSIONS = ["4"];

/** 単一コロンで書ける歴史的な擬似要素（詳細度は擬似要素として数える）。 */
const LEGACY_PSEUDO_ELEMENTS = new Set(["before", "after", "first-line", "first-letter"]);

/** 引数の中で最も詳細度の高い枝をそのまま採る擬似クラス。 */
const MAX_OF_ARGUMENT = new Set(["is", "not", "has", "matches", "-moz-any", "-webkit-any", "any"]);

/** 詳細度に寄与しない擬似クラス。 */
const ZERO_SPECIFICITY = new Set(["where"]);

/**
 * ポインタ・キーボード・遷移で作る**一時的な**状態擬似クラス（このスクリプトで定義する）。
 * これらは「いま作っていなければ当たっていない」と言い切れるので、`--state` に無ければ確実に不成立。
 *
 * `:link` / `:visited` / `:target` はここに入れない。これらは採取で作るものではなく、
 * 要素と履歴・URL の性質（`<a href>` はデフォルトで `:link` に当たる）なので、下の恒常状態と同じに扱う。
 *
 * 逆に、ここに無い状態擬似クラス（`:enabled` / `:valid` / `:read-only` / `:link` 等）は**要素の性質**であって、
 * 採取ディレクトリ名からは成否が決まらない。`css-rules-capture.mjs` の `STATE_PSEUDO_CLASSES` は
 * 両者を区別せず `states` に記録する。そのため、ディレクトリ名だけで不成立と判定すると、
 * **採取時に実際に当たっていた宣言を捨てて、負けるはずの宣言を勝者として exit 0 で返す**。
 * そこで、`--state` に無い恒常状態は「不成立」ではなく**不明**として扱い、勝ちうるなら undecidable にする。
 * 成否が分かっているなら `--state <name>` で明示的に渡す。
 * @type {ReadonlySet<string>}
 */
const TRANSIENT_STATES = new Set(["active", "focus", "focus-visible", "focus-within", "hover"]);

/**
 * 同時に成立しうる一時的な状態（このスクリプトで定義する）。キーの状態を `--state` で渡したとき、値の側は
 * **不成立と言い切れない**ので不明として扱う。
 *
 * ポインタで `:active` を作れば同じポインタが要素の上にあるので `:hover` も当たっている。
 * `:focus-visible` は `:focus` の部分集合で、`:focus` の要素は祖先の `:focus-within` も立てる。
 * 採取ディレクトリ名は 1 つしか持てないため、この共起を無視すると、**採取時に当たっていた宣言を
 * 捨てて、負けるはずの宣言を勝者として exit 0 で返す**。
 * @type {Readonly<Record<string, readonly string[]>>}
 */
const CO_OCCURRING_STATES = {
  active: ["hover"],
  focus: ["focus-within"],
  "focus-visible": ["focus", "focus-within"],
  "focus-within": [],
  hover: [],
};

class UsageError extends Error {}

/** 詳細度を機械的に決められないときに投げる。 */
export class UndecidableSelector extends Error {}

/**
 * 勝者を決める候補の 1 件（規則の宣言かインラインの宣言）。
 * `selector`・`origin`・`value`・`layers`・`conditions` は css-rules.json の値をそのまま持つ（形を検査しない）。
 * @typedef {{
 *   source: "rule" | "inline",
 *   selector: unknown,
 *   origin: unknown,
 *   value: unknown,
 *   important: boolean,
 *   specificity: [number, number, number] | null,
 *   specificity_error: string | null,
 *   order: number | null,
 *   rule_index: number | null,
 *   declaration_index: number,
 *   layers: unknown[],
 *   conditions: unknown[],
 *   unknown_states?: unknown[],
 * }} CascadeCandidate
 */

/**
 * プロパティ × 擬似要素ごとの候補の集まり。
 * @typedef {{
 *   property: string,
 *   pseudo_element: unknown,
 *   applying: CascadeCandidate[],
 *   conditional: CascadeCandidate[],
 *   state_unknown: CascadeCandidate[],
 *   state_gated: number,
 *   reasons: string[],
 * }} CascadeBucket
 */

/**
 * 1 プロパティ × 擬似要素の解決の結果。`winner` は `status` が `resolved` のときだけ値を持ち、それ以外は null。
 * 要求したプロパティに宣言が 1 件も無い結果は、`state_unknown` を持たない（`all` も無ければ `wildcard` も持たない）。
 * @typedef {{
 *   property: string,
 *   pseudo_element: unknown,
 *   status: "resolved" | "undecidable" | "absent",
 *   winner: (CascadeCandidate & { tier: string }) | null,
 *   losers: CascadeCandidate[],
 *   conditional: CascadeCandidate[],
 *   state_unknown?: CascadeCandidate[],
 *   wildcard?: CascadeCandidate[],
 *   state_gated: number,
 *   reasons: string[],
 * }} CascadeResult
 */

/** 識別子を構成する 1 文字（エスケープは別に扱う）。 */
const IDENT_CHAR = /[-\w -￿]/;

/**
 * 前後の CSS の空白（空白・タブ・改行・CR・FF）を除く。String#trim は NBSP なども除くので、識別子の文字を消してしまう。
 * @param {string} s
 * @returns {string}
 */
function cssTrim(s) {
  return s.replace(/^[ \t\n\r\f]+|[ \t\n\r\f]+$/g, "");
}

/**
 * エスケープを飛ばした次の位置。
 * CSS のエスケープは `\` ＋ 1 文字とは限らない。16 進エスケープは `\` ＋ 16 進数 1〜6 桁で、
 * 直後の空白 1 つが終端記号として消費される（`.\31 23` は「123」というクラス 1 つ）。
 * 2 文字固定で進めると残りの桁を型セレクタとして数え、詳細度が狂う（`.\31 23` が [0,1,1] になる）。
 * @param {string} s
 * @param {number} start `\` の位置
 * @returns {number}
 */
function skipEscape(s, start) {
  let j = start + 1;
  if (j >= s.length) throw new UndecidableSelector(`dangling escape at ${start}`);
  let hex = 0;
  while (j < s.length && hex < 6 && /[0-9a-fA-F]/.test(s[j])) {
    j += 1;
    hex += 1;
  }
  if (hex === 0) return j + 1; // `\.` のような 1 文字エスケープ
  // 終端の空白 1 つを消費する。CSS は CRLF を改行 1 個として読むので、`\r\n` は 2 文字とも消費する
  // 終わりの空白は CSS の空白（空白・タブ・改行・CR・FF）だけで、NBSP などは識別子の一部である
  if (s.startsWith("\r\n", j)) return j + 2;
  if (j < s.length && /[ \t\n\r\f]/.test(s[j])) j += 1;
  return j;
}

/**
 * 識別子を飛ばした次の位置（識別子が無ければ投げる）。
 * @param {string} s
 * @param {number} start
 * @returns {number}
 */
function skipIdent(s, start) {
  let j = start;
  if (j >= s.length) throw new UndecidableSelector(`identifier expected at ${start}`);
  while (j < s.length) {
    const ch = s[j];
    if (ch === "\\") {
      j = skipEscape(s, j);
      continue;
    }
    if (IDENT_CHAR.test(ch)) {
      j += 1;
      continue;
    }
    break;
  }
  if (j === start) throw new UndecidableSelector(`identifier expected at ${start}`);
  return j;
}

/**
 * 文字列を飛ばした次の位置。閉じていなければ投げる。lenient なら投げずに、末尾まで読んだ位置の次を返す。
 * @param {string} s
 * @param {number} start 開きの引用符の位置
 * @param {{ lenient?: boolean }} [options]
 * @returns {number}
 */
function skipString(s, start, { lenient = false } = {}) {
  const quote = s[start];
  let j = start + 1;
  while (j < s.length) {
    if (s[j] === "\\") {
      j += 2;
      continue;
    }
    if (s[j] === quote) return j + 1;
    j += 1;
  }
  if (lenient) return j + 1;
  throw new UndecidableSelector("unterminated string in selector");
}

/**
 * 対応する閉じ括弧の位置（開き括弧を含む入れ子・文字列を飛ばす）。
 * @param {string} s
 * @param {number} start 開き括弧の位置
 * @param {string} brackets 開き括弧と閉じ括弧の 2 文字（`"[]"`・`"()"`）
 * @returns {number}
 */
function matchClose(s, start, brackets) {
  const [open, close] = brackets;
  let depth = 0;
  let j = start;
  while (j < s.length) {
    const ch = s[j];
    if (ch === "\\") {
      j += 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      j = skipString(s, j);
      continue;
    }
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return j;
    }
    j += 1;
  }
  throw new UndecidableSelector(`unbalanced ${open} in selector`);
}

/**
 * 括弧の深さの増減（開き括弧なら 1、閉じ括弧なら -1、それ以外は 0）。
 * @param {string} ch
 * @returns {number}
 */
function bracketDelta(ch) {
  if (ch === "(" || ch === "[") return 1;
  if (ch === ")" || ch === "]") return -1;
  return 0;
}

/**
 * トップレベルのカンマで分割する（入れ子の括弧・文字列の中は分割しない）。
 * @param {string} text
 * @returns {string[]}
 */
function splitTopLevel(text) {
  /** @type {string[]} */
  const parts = [];
  let depth = 0;
  let start = 0;
  let j = 0;
  while (j < text.length) {
    const ch = text[j];
    if (ch === "\\") {
      j += 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      j = skipString(text, j, { lenient: true });
      continue;
    }
    depth += bracketDelta(ch);
    if (ch === "," && depth === 0) {
      parts.push(text.slice(start, j));
      start = j + 1;
    }
    j += 1;
  }
  parts.push(text.slice(start));
  return parts;
}

/**
 * 引数の中で最も詳細度の高い枝の詳細度（`:is()` などの MAX_OF_ARGUMENT の擬似クラス）。
 * @param {string} name 擬似クラスの名前
 * @param {string | null} argument 括弧の中身（括弧が無ければ null）
 * @returns {[number, number, number]}
 */
function maxOfArgument(name, argument) {
  if (argument === null || cssTrim(argument) === "") {
    throw new UndecidableSelector(`:${name}() has no argument`);
  }
  /** @type {[number, number, number] | null} */
  let best = null;
  for (const branch of splitTopLevel(argument)) {
    if (cssTrim(branch) === "") throw new UndecidableSelector(`:${name}() has an empty branch`);
    const value = specificity(cssTrim(branch));
    if (best === null || compareSpecificity(value, best) > 0) best = value;
  }
  // splitTopLevel は 1 件以上を返し、各枝は値を決めるか投げるので、ここで null にはならない（型の絞り込みのため）。
  if (best === null) throw new UndecidableSelector(`:${name}() has no branch`);
  return best;
}

/**
 * `:` で始まる擬似クラス・擬似要素 1 つの詳細度と、その次の位置。
 * @param {string} s
 * @param {number} i `:` の位置
 * @returns {{ value: [number, number, number], next: number }}
 */
function pseudoSpecificity(s, i) {
  const doubled = s[i + 1] === ":";
  const nameStart = i + (doubled ? 2 : 1);
  const nameEnd = skipIdent(s, nameStart);
  const name = s.slice(nameStart, nameEnd).toLowerCase();
  let argument = null;
  let next = nameEnd;
  if (s[nameEnd] === "(") {
    const close = matchClose(s, nameEnd, "()");
    argument = s.slice(nameEnd + 1, close);
    next = close + 1;
  }
  if (doubled || LEGACY_PSEUDO_ELEMENTS.has(name)) return { value: [0, 0, 1], next };
  if (ZERO_SPECIFICITY.has(name)) return { value: [0, 0, 0], next };
  if (MAX_OF_ARGUMENT.has(name)) return { value: maxOfArgument(name, argument), next };
  if (argument !== null && /\bof\b/i.test(argument)) {
    // `:nth-child(2n of .a)` は引数側の詳細度を足すが、`of` の中身をここでは数えない。
    throw new UndecidableSelector(`:${name}() uses the \`of\` form; resolve it by hand`);
  }
  return { value: [0, 1, 0], next };
}

/**
 * セレクタの i の位置から始まるトークン 1 つの詳細度と、その次の位置。
 * @param {string} s
 * @param {number} i
 * @returns {{ value: [number, number, number], next: number }}
 */
function tokenSpecificity(s, i) {
  const ch = s[i];
  // エスケープされた先頭文字は型セレクタの一部として数える。
  if (ch === "\\") return { value: [0, 0, 1], next: skipIdent(s, i) };
  // 以降のトークン判定は skipIdent がエスケープ全体を消費する前提で進む。
  if (ch === '"' || ch === "'") return { value: [0, 0, 0], next: skipString(s, i) };
  // 結合子の空白は CSS の空白だけで、NBSP などは識別子の文字として型セレクタに数える
  if (/[ \t\n\r\f]/.test(ch) || ch === ">" || ch === "+" || ch === "~" || ch === "|") {
    return { value: [0, 0, 0], next: i + 1 };
  }
  if (ch === ",") {
    // どの枝が当たったかは css-rules.json に無い（matched は規則単位で、枝は記録されない）。
    throw new UndecidableSelector(
      "selector is a selector list; which branch matched is not recorded",
    );
  }
  if (ch === "&") {
    throw new UndecidableSelector("selector still contains an unresolved nesting `&`");
  }
  if (ch === "*") return { value: [0, 0, 0], next: i + 1 };
  if (ch === "#") return { value: [1, 0, 0], next: skipIdent(s, i + 1) };
  if (ch === ".") return { value: [0, 1, 0], next: skipIdent(s, i + 1) };
  if (ch === "[") return { value: [0, 1, 0], next: matchClose(s, i, "[]") + 1 };
  if (ch === ":") return pseudoSpecificity(s, i);
  if (IDENT_CHAR.test(ch)) return { value: [0, 0, 1], next: skipIdent(s, i) };
  throw new UndecidableSelector(`unreadable token ${JSON.stringify(ch)} at ${i}`);
}

/**
 * セレクタ文字列の詳細度 [id, class, type] を数える。
 * 決められない形は `UndecidableSelector` を投げる（推測で数えない）。
 * @param {string} selector
 * @returns {[number, number, number]}
 */
export function specificity(selector) {
  if (typeof selector !== "string" || cssTrim(selector) === "") {
    throw new UndecidableSelector("selector is empty");
  }
  /** @type {[number, number, number]} */
  const counts = [0, 0, 0];
  let i = 0;
  while (i < selector.length) {
    const { value, next } = tokenSpecificity(selector, i);
    counts[0] += value[0];
    counts[1] += value[1];
    counts[2] += value[2];
    i = next;
  }
  return counts;
}

/**
 * CSS のエスケープ（start の `\`）の次の位置。読み方は skipEscape と同じで、末尾の `\` だけは投げずに文字列の終わりを返す。
 * @param {string} s
 * @param {number} start
 * @returns {number}
 */
function escapeEnd(s, start) {
  return start + 1 >= s.length ? s.length : skipEscape(s, start);
}

/**
 * トップレベル（括弧の外）にある最後の結合子（空白・`>`・`+`・`~`）の位置。無ければ -1。
 * @param {string} selector
 * @returns {number}
 */
function lastTopLevelCombinator(selector) {
  let depth = 0;
  let lastBreak = -1;
  for (let i = 0; i < selector.length; i += 1) {
    const ch = selector[i];
    if (ch === "\\") {
      i = escapeEnd(selector, i) - 1;
      continue;
    }
    // 引用符の中（`[title="]"]`）の括弧と空白は、深さにも結合子にも数えない。
    if (ch === '"' || ch === "'") {
      i = skipString(selector, i, { lenient: true }) - 1;
      continue;
    }
    depth += bracketDelta(ch);
    // 子孫結合子は CSS の空白（空白・タブ・改行・CR・FF）だけで、NBSP などは識別子の一部である
    if (depth === 0 && (/[ \t\n\r\f]/.test(ch) || ch === ">" || ch === "+" || ch === "~"))
      lastBreak = i;
  }
  return lastBreak;
}

/**
 * 引用符で囲んだ文字列の中身と、エスケープ（`\:`）を空白に置き換える（位置は変えない）。
 * エスケープした `:` は識別子の一部（`.a\:hover`）で、擬似クラスの始まりではない。
 * @param {string} text
 * @returns {string}
 */
function blankStrings(text) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\") {
      const end = escapeEnd(text, i);
      out += " ".repeat(end - i);
      i = end;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const end = Math.min(skipString(text, i, { lenient: true }), text.length);
      out += ch + " ".repeat(Math.max(end - i - 2, 0)) + (end - i >= 2 ? text[end - 1] : "");
      i = end;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * 状態擬似クラスが**主語（最後の複合セレクタ）以外**に付いているかを見る。
 *
 * `css-rules-capture.mjs` は状態擬似クラスをセレクタから剥がして `states` に名前だけ記録するため、
 * `.trigger:hover + .target` は `states: ["hover"]` になる。名前だけで「いまその状態か」を判定すると、
 * `.target` を hover した採取に対してこの規則を成立と扱ってしまう。**隣の要素が hover されているか**は
 * 採取ディレクトリ名からは分からない。主語の外に状態が付いていたら成否を決めず undecidable に回す。
 *
 * @param {unknown} selector - 規則のセレクタ（状態擬似クラスを含む形）。文字列でなければ空の配列を返す。
 * @param {readonly string[]} states - その規則が要求する状態擬似クラスの名前。
 * @returns {string[]} 主語の外に現れた状態の名前（空なら主語だけに付いている）。
 */
export function statesOutsideSubject(selector, states) {
  if (typeof selector !== "string" || states.length === 0) return [];
  // トップレベルの結合子で分割し、最後の断片を主語とする（括弧・文字列の中では分割しない）。
  const lastBreak = lastTopLevelCombinator(selector);
  if (lastBreak < 0) return []; // 結合子が無い＝主語だけのセレクタ
  // 引用符の中とエスケープした `\:` の後ろの `hover` などは状態擬似クラスではないので、照合の前に空白に置き換える。
  const outside = blankStrings(selector.slice(0, lastBreak + 1));
  const found = [];
  for (const state of states) {
    // 名前は小文字で記録されるが、セレクタ側の綴りは大小どちらもありうる。
    const re = new RegExp(`:${state.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(outside)) found.push(state);
  }
  return found;
}

/**
 * 詳細度を比較する（a が強ければ正）。
 * @param {[number,number,number]} a
 * @param {[number,number,number]} b
 * @returns {number}
 */
export function compareSpecificity(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/**
 * 候補 c が、それまでの勝者 best に代わって勝つか。詳細度 → order の後勝ち → 宣言の後勝ちの順に比べる。
 * @param {CascadeCandidate} c
 * @param {CascadeCandidate} best
 * @returns {boolean}
 */
function supersedes(c, best) {
  // インラインの候補は詳細度を持たない（`specificity: null`）。同じ段に並ぶのはインライン同士か
  // 規則同士のどちらかなので、null が混じる比較は引き分けにして出現順（後勝ち）で決める。
  // ここで compareSpecificity へ null を渡すと TypeError になり、UsageError の exit 2 ではなく
  // 素のクラッシュになる（同じプロパティのインライン宣言が 2 件並ぶ入力で起きる）。
  const bySpec =
    c.specificity === null || best.specificity === null
      ? 0
      : compareSpecificity(c.specificity, best.specificity);
  if (bySpec !== 0) return bySpec > 0;
  // 規則の候補で、最も強い詳細度に order を読めない（null の）規則が並ぶ入力は、呼び出し側が
  // unorderedTie で判定できないとして先に返すので、別の規則どうしの同点では order は数値である。
  // インラインの候補は規則ではないので order を持たず（null）、どれも同じ null として次の判定に進む。
  if (c.order !== null && best.order !== null && c.order > best.order) return true;
  // 同じ規則（同じ order）か、インラインどうしなら、後に書いた宣言が勝つ。
  return c.order === best.order && (c.declaration_index ?? 0) >= (best.declaration_index ?? 0);
}

/**
 * 候補を 1 件に畳む（同じ段・同じレイヤの中での勝者）。詳細度 → order の後勝ち。
 * @param {CascadeCandidate[]} candidates
 * @returns {CascadeCandidate}
 */
function strongest(candidates) {
  let best = candidates[0];
  for (const c of candidates.slice(1)) {
    if (supersedes(c, best)) best = c;
  }
  return best;
}

/**
 * 規則の候補のうち、最も強い詳細度に別々の規則の宣言が並び、その中に order を読めない（null の）規則がある場合の、
 * order の無い宣言の一覧。無ければ null。同じ規則の宣言だけが並ぶなら declaration_index で決まるので null を返す。
 * インラインの候補（規則でなく order を持たない）は数えない。
 * @param {CascadeCandidate[]} candidates
 * @returns {CascadeCandidate[] | null}
 */
function unorderedTie(candidates) {
  /** @type {{ c: CascadeCandidate, spec: [number, number, number] }[]} */
  const rules = [];
  for (const c of candidates) {
    if (c.source === "rule" && c.specificity !== null) rules.push({ c, spec: c.specificity });
  }
  if (rules.length < 2) return null;
  const top = rules.reduce((a, r) => (compareSpecificity(r.spec, a.spec) > 0 ? r : a)).spec;
  const tied = rules.filter((r) => compareSpecificity(r.spec, top) === 0).map((r) => r.c);
  if (new Set(tied.map((c) => c.rule_index)).size < 2) return null;
  const unknown = tied.filter((c) => c.order === null);
  return unknown.length > 0 ? unknown : null;
}

/**
 * 同じ詳細度で競う規則の order が無いときの理由。order の無い規則のセレクタを挙げる。
 * @param {string} tierName
 * @param {CascadeCandidate[]} candidates - 競う宣言（order の無いものを含む）
 * @returns {string}
 */
function unknownOrderReason(tierName, candidates) {
  const missing = [
    ...new Set(candidates.filter((c) => c.order === null).map((c) => JSON.stringify(c.selector))),
  ];
  return (
    `competing ${tierName} declarations share the highest specificity, but the rule order of ` +
    `${missing.join(", ")} is missing from css-rules.json; which one was written later cannot be decided`
  );
}

/**
 * 候補を集める入れ物（resolveCascade の各段が読み書きする）。
 * buckets のキーは `${pseudo}\u0000${property}`。
 * wildcards は `all` の宣言（擬似要素ごと）。**ブラウザは `all` を longhand へ展開しない**
 * （Chrome 149 で実測: `margin` / `background` / `font` は展開されるが `all: unset` は `all` のまま）。
 * そのためプロパティ名で振り分けるだけでは、`all` が勝つ場面でも個別プロパティの宣言を勝者にしてしまう。
 * どのプロパティにも当たりうる候補として別に持ち、勝ちうるなら undecidable にする。
 * wildcards のキーは擬似要素の値（css-rules.json の値のまま。要素自身は ""）。
 * @typedef {{ buckets: Map<string, CascadeBucket>, wildcards: Map<unknown, CascadeCandidate[]> }} CandidateStore
 */

/**
 * 採っている状態の集合（resolveCascade が規則の状態の成否を決めるのに使う）。
 * active は渡された状態、coOccurring は渡された状態と共起しうる一時的な状態（渡されていなくても不成立とは言えない側）。
 * @typedef {{ active: Set<string>, coOccurring: Set<string> }} StateContext
 */

/**
 * css-rules.json のバージョンを確かめ、tool_version を返す。
 * @param {Record<string, unknown>} document
 * @returns {string}
 */
function readToolVersion(document) {
  const toolVersion = typeof document.tool_version === "string" ? document.tool_version : null;
  if (toolVersion === null || !SUPPORTED_CSS_RULES_VERSIONS.includes(toolVersion)) {
    throw new UsageError(
      `css-rules.json tool_version ${JSON.stringify(toolVersion)} is not supported` +
        `(supported: ${SUPPORTED_CSS_RULES_VERSIONS.join(", ")}); re-capture with the bundled css-rules-capture.mjs`,
    );
  }
  return toolVersion;
}

/**
 * 採取の完全さを確かめる。
 * 採取が不完全なら、見えている部分集合から勝者を確定しない。
 * `inaccessible` は「そのスタイルシートの規則が 1 件も見えていない」、
 * `unresolved` は「そのセレクタが当たるかを判定していない」の実測で、
 * どちらも matched の全候補より強い宣言を隠しうる（0 件を「関係する規則が無い」と読まない規律と同じ）。
 * @param {Record<string, unknown>} document
 * @param {boolean | undefined} allowIncomplete
 * @returns {{ inaccessible: number, unresolved: number, incomplete: boolean }}
 */
function readCompleteness(document, allowIncomplete) {
  const inaccessible = isArray(document.inaccessible) ? document.inaccessible.length : null;
  const unresolved = isArray(document.unresolved) ? document.unresolved.length : null;
  if (inaccessible === null || unresolved === null) {
    throw new UsageError(
      "css-rules.json must carry `inaccessible` and `unresolved` arrays; re-capture with the bundled css-rules-capture.mjs",
    );
  }
  const incomplete = inaccessible > 0 || unresolved > 0;
  if (incomplete && allowIncomplete !== true) {
    throw new UsageError(
      `css-rules.json records an incomplete capture (inaccessible: ${inaccessible}, unresolved: ${unresolved}); ` +
        "a declaration stronger than every matched candidate can hide there, so the visible subset does not " +
        "settle the winner. resolve them (re-capture, read the current CSS directly) or pass --allow-incomplete " +
        "to waive it explicitly and record the waiver in component-api.md",
    );
  }
  return { inaccessible, unresolved, incomplete };
}

/**
 * 渡された状態から、状態の成否を決める集合を作る。
 * @param {string[]} states
 * @returns {StateContext}
 */
function stateContext(states) {
  const active = new Set(states.filter((s) => s !== "default"));
  // 渡された状態から共起しうる一時的な状態を導く（渡されていなくても不成立とは言えない側）。
  /** @type {Set<string>} */
  const coOccurring = new Set();
  for (const state of active) {
    for (const other of CO_OCCURRING_STATES[state] ?? []) {
      if (!active.has(other)) coOccurring.add(other);
    }
  }
  return { active, coOccurring };
}

/**
 * プロパティ × 擬似要素のバケット（無ければ作る）。
 * @param {CandidateStore} store
 * @param {unknown} pseudo
 * @param {string} property
 * @returns {CascadeBucket}
 */
function bucketFor(store, pseudo, property) {
  const pseudoKey =
    typeof pseudo === "string" ? pseudo : pseudo === null ? "" : JSON.stringify(pseudo);
  const key = `${pseudoKey}\u0000${property}`;
  let entry = store.buckets.get(key);
  if (entry === undefined) {
    entry = {
      property,
      pseudo_element: pseudo,
      applying: [],
      conditional: [],
      state_unknown: [],
      state_gated: 0,
      reasons: [],
    };
    store.buckets.set(key, entry);
  }
  return entry;
}

/**
 * `all` の候補を擬似要素ごとの一覧に足す。
 * @param {CandidateStore} store
 * @param {unknown} key 擬似要素の値（要素自身は ""）
 * @param {CascadeCandidate} candidate
 */
function addWildcard(store, key, candidate) {
  let list = store.wildcards.get(key);
  if (list === undefined) {
    list = [];
    store.wildcards.set(key, list);
  }
  list.push(candidate);
}

/**
 * matched の要素がすべてオブジェクトであることを確かめる。
 * 規則は css-rules-capture.mjs がオブジェクトで記録する。オブジェクトでない要素は、より強い宣言を隠しうるのに
 * 中身を読めないので、読み飛ばさずに判定できないとして止める（inaccessible・unresolved と同じ規律）。
 * @param {unknown[]} matched
 * @returns {Record<string, unknown>[]}
 */
function readRules(matched) {
  /** @type {Record<string, unknown>[]} */
  const rules = [];
  for (const [i, rule] of matched.entries()) {
    if (!isPlainObject(rule)) {
      throw new UsageError(
        `css-rules.json \`matched[${i}]\` is not an object; re-capture with the bundled css-rules-capture.mjs`,
      );
    }
    rules.push(rule);
  }
  return rules;
}

/**
 * 規則が要求する状態の成否を決める。
 * gated は「作っていない一時的な状態を要求するので不成立」、unknownStates は成否を決められない状態の名前。
 * @param {Record<string, unknown>} rule
 * @param {StateContext} stateCtx
 * @returns {{ gated: boolean, unknownStates: unknown[] }}
 */
function ruleStates(rule, { active, coOccurring }) {
  // 状態の名前は css-rules-capture.mjs が文字列で記録する（形はここでは検査しない）。
  // 文字列でない要素は成否を決められないので、名前の判定には入れず「不明」として持つ。
  const declaredStates = isArray(rule.states) ? rule.states : [];
  const states = declaredStates.filter((state) => typeof state === "string");
  const malformedStates = declaredStates.filter((state) => typeof state !== "string");
  // 一時的な状態は「作っていないなら不成立」と言い切れる。恒常状態（`:enabled` 等）は
  // ディレクトリ名から成否が決まらないので、不成立と判定せず「不明」として持つ。
  const inactive = states.filter((state) => !active.has(state));
  // 主語の外に付いた状態は、名前が一致しても「いまその状態か」を採取ディレクトリ名が決めない
  // （`.trigger:hover + .target` の `hover` は隣の要素の話）。不成立とも成立とも判定せず、不明にする。
  const foreign = statesOutsideSubject(rule.selector, states);
  // 渡された状態と共起しうる一時的な状態は、「不成立」と判定しない（下記 CO_OCCURRING_STATES）。
  const gated = inactive.some(
    (state) => TRANSIENT_STATES.has(state) && !coOccurring.has(state) && !foreign.includes(state),
  );
  const unknownStates = [
    ...new Set([
      ...inactive.filter((state) => !TRANSIENT_STATES.has(state) || coOccurring.has(state)),
      ...foreign,
      ...malformedStates,
    ]),
  ];
  return { gated, unknownStates };
}

/**
 * 規則のセレクタの詳細度（決められなければ理由）。
 * @param {unknown} selector
 * @returns {{ spec: [number, number, number] | null, specError: string | null }}
 */
function ruleSpecificity(selector) {
  try {
    return { spec: specificity(String(selector)), specError: null };
  } catch (err) {
    if (!(err instanceof UndecidableSelector)) throw err;
    return { spec: null, specError: err.message };
  }
}

/**
 * 規則の宣言 1 件の候補を、バケットか `all` の一覧に振り分ける。
 * @param {CandidateStore} store
 * @param {{ rule: Record<string, unknown>, candidate: CascadeCandidate, property: string }} declared
 * @param {{ gated: boolean, unknownStates: unknown[] }} ruleState
 */
function placeRuleCandidate(store, { rule, candidate, property }, { gated, unknownStates }) {
  // `all` はプロパティ名の振り分けに入れない（どのプロパティにも当たりうるので別に持つ）。
  if (property === "all") {
    if (!gated)
      addWildcard(store, rule.pseudo_element ?? "", {
        ...candidate,
        unknown_states: unknownStates,
      });
    return;
  }
  const entry = bucketFor(store, rule.pseudo_element ?? null, property);
  if (gated) {
    entry.state_gated += 1;
    return;
  }
  const conditions = candidate.conditions;
  if (conditions.length > 0) entry.conditional.push(candidate);
  else if (unknownStates.length > 0) {
    entry.state_unknown.push({ ...candidate, unknown_states: unknownStates });
  } else entry.applying.push(candidate);
}

/**
 * 規則 1 件の宣言を候補にして集める。
 * @param {CandidateStore} store
 * @param {{ rule: Record<string, unknown>, ruleIndex: number }} matchedRule
 * @param {StateContext} stateCtx
 */
function collectRule(store, { rule, ruleIndex }, stateCtx) {
  const conditions = isArray(rule.conditions) ? rule.conditions : [];
  const layers = isArray(rule.layers) ? rule.layers : [];
  const declarations = isArray(rule.declarations) ? rule.declarations : [];
  const ruleState = ruleStates(rule, stateCtx);
  const { spec, specError } = ruleSpecificity(rule.selector);
  for (let declIndex = 0; declIndex < declarations.length; declIndex += 1) {
    const decl = declarations[declIndex];
    if (!isObjectLike(decl) || typeof decl.property !== "string") continue;
    /** @type {CascadeCandidate} */
    const candidate = {
      source: "rule",
      selector: rule.selector,
      origin: rule.href ?? null,
      value: decl.value,
      important: Boolean(decl.important),
      specificity: spec,
      specificity_error: specError,
      // 有限の数でない order（NaN など）は、比較がすべて偽になり順を決められないので、読めないもの（null）にする。
      order: typeof rule.order === "number" && Number.isFinite(rule.order) ? rule.order : null,
      // どの規則の宣言か（matched の位置）。order が無くても、同じ規則の宣言どうしは declaration_index で比べられる。
      rule_index: ruleIndex,
      // 同じ規則の中では後に書いた宣言が勝つ。`order` は規則単位なので、規則内の順序を別に持たないと
      // `.x { color: red; all: unset }` のように同一規則で競合する形が同点になる。
      declaration_index: declIndex,
      layers,
      conditions,
    };
    placeRuleCandidate(store, { rule, candidate, property: decl.property }, ruleState);
  }
}

/**
 * インラインの宣言を候補にして集める。
 * @param {CandidateStore} store
 * @param {unknown[]} inline
 */
function collectInline(store, inline) {
  for (let i = 0; i < inline.length; i += 1) {
    const decl = inline[i];
    if (!isObjectLike(decl) || typeof decl.property !== "string") continue;
    /** @type {CascadeCandidate} */
    const candidate = {
      source: "inline",
      selector: null,
      origin: "style attribute",
      value: decl.value,
      important: Boolean(decl.important),
      specificity: null,
      specificity_error: null,
      order: null,
      rule_index: null,
      // `style` 属性の中も後に書いた宣言が勝つ。規則側と同じく並び順を持たせる
      // （持たせないと `style="color: red; all: unset"` が同点になる）。
      declaration_index: i,
      layers: [],
      conditions: [],
    };
    // インラインの `all` も規則側と同じくワイルドカードとして扱う
    // （プロパティ名で振り分けると、後続の `all` が個別宣言を reset するのを見落とす）。
    if (decl.property === "all") {
      addWildcard(store, "", { ...candidate, unknown_states: [] });
      continue;
    }
    // インラインは擬似要素に当たらないので、要素自身のバケットにだけ入れる。
    bucketFor(store, null, decl.property).applying.push(candidate);
  }
}

/**
 * 要求したのに宣言の無いプロパティの結果（`all` があれば undecidable、無ければ absent）。
 * @param {string} property
 * @param {CascadeCandidate[]} wildcardsForOwn 要素自身の `all` の候補
 * @returns {CascadeResult}
 */
function missingPropertyResult(property, wildcardsForOwn) {
  // `all` があるなら「宣言が無い」とは言えない（all が値を与える）。
  if (wildcardsForOwn.length > 0) {
    return {
      property,
      pseudo_element: null,
      status: "undecidable",
      winner: null,
      losers: [],
      conditional: [],
      state_unknown: [],
      wildcard: wildcardsForOwn,
      state_gated: 0,
      reasons: [
        "no declaration names this property, but an `all` declaration applies to every property " +
          "and browsers do not expand `all` into longhands (measured in Chrome 149), so the value is not settled here",
      ],
    };
  }
  return {
    property,
    pseudo_element: null,
    status: "absent",
    winner: null,
    losers: [],
    conditional: [],
    state_gated: 0,
    reasons: ["no declaration for this property in matched or inline_declarations"],
  };
}

/**
 * `all` の宣言しか持たない擬似要素に、その `all` を受ける番兵のバケットを作る。
 * `all` しか宣言が無い採取物では buckets が空になる。keys を buckets だけから作ると
 * `--all` が「候補 0 件」で exit 0 になり、ほぼ全プロパティを reset する宣言を見落とす。
 * @param {CandidateStore} store
 * @returns {void}
 */
function addWildcardSentinels(store) {
  const { buckets, wildcards } = store;
  for (const pseudoKey of wildcards.keys()) {
    const pseudo = pseudoKey === "" ? null : pseudoKey;
    const hasBucket = [...buckets.values()].some((e) => (e.pseudo_element ?? "") === pseudoKey);
    if (!hasBucket) bucketFor(store, pseudo, "all");
  }
}

/**
 * 集めた候補から、プロパティ × 擬似要素ごとの結果を作る。
 * @param {CandidateStore} store
 * @param {string[] | null} requested 解決するプロパティ名（null ならすべて）
 * @returns {CascadeResult[]}
 */
function collectResults(store, requested) {
  const { buckets, wildcards } = store;
  /** @type {CascadeResult[]} */
  const results = [];
  addWildcardSentinels(store);
  const keys = [...buckets.keys()].sort();
  for (const key of keys) {
    const entry = buckets.get(key);
    if (entry === undefined) continue; // keys は buckets から作るので起きない（型の絞り込みのため）
    if (requested !== null && !requested.includes(entry.property)) continue;
    results.push(decide(entry, wildcards.get(entry.pseudo_element ?? "") ?? []));
  }
  if (requested === null) return results;
  const seen = new Set(results.map((r) => r.property));
  for (const property of requested) {
    if (seen.has(property)) continue;
    results.push(missingPropertyResult(property, wildcards.get("") ?? []));
  }
  results.sort((a, b) => (a.property < b.property ? -1 : a.property > b.property ? 1 : 0));
  return results;
}

/**
 * `css-rules.json` の内容を読み、プロパティ × 擬似要素ごとに勝者を確定する。
 *
 * @param {unknown} document - css-rules.json をパースしたもの（形はここで検査する）。
 * @param {{ states: string[], properties?: string[]|null, source?: string, allowIncomplete?: boolean }} options 次のオプション。
 * states: いま採っている状態で成立している状態擬似クラスの集合（`default` は空集合と同じ意味）。
 * properties: 解決するプロパティ名（省略時は候補に現れるすべてのプロパティ）。
 * allowIncomplete: `inaccessible` / `unresolved` が 0 でなくても解決する（デフォルトは止まる）。
 * @returns {{ source:(string|null), tool_version:(string|null), cascade_resolve_version:string,
 *             capture_completeness:{inaccessible:number, unresolved:number, waived:boolean},
 *             active_states:string[],
 *             results:CascadeResult[], counts:{resolved:number, undecidable:number, absent:number} }}
 */
export function resolveCascade(document, options) {
  if (!isPlainObject(document)) {
    throw new UsageError("css-rules.json must be a JSON object");
  }
  if (!isArray(document.matched)) {
    throw new UsageError("css-rules.json has no `matched` array (is it css-rules-capture output?)");
  }
  const toolVersion = readToolVersion(document);
  const { inaccessible, unresolved, incomplete } = readCompleteness(
    document,
    options.allowIncomplete,
  );
  const inline = isArray(document.inline_declarations) ? document.inline_declarations : null;
  if (inline === null) {
    throw new UsageError(
      "css-rules.json has no `inline_declarations` (captured with tool_version 1); re-capture",
    );
  }
  const stateCtx = stateContext(options.states);
  /** @type {CandidateStore} */
  const store = { buckets: new Map(), wildcards: new Map() };
  const rules = readRules(document.matched);
  for (let ruleIndex = 0; ruleIndex < rules.length; ruleIndex += 1) {
    collectRule(store, { rule: rules[ruleIndex], ruleIndex }, stateCtx);
  }
  collectInline(store, inline);
  const results = collectResults(store, options.properties ?? null);

  const counts = { resolved: 0, undecidable: 0, absent: 0 };
  for (const r of results) counts[r.status] += 1;
  return {
    source: options.source ?? null,
    tool_version: toolVersion,
    cascade_resolve_version: VERSION,
    capture_completeness: { inaccessible, unresolved, waived: incomplete ? true : false },
    active_states: [...stateCtx.active].sort(),
    results,
    counts,
  };
}

/**
 * 段（tiers）の名前と、その段で競う候補。並びは強い順。
 * @typedef {{ name: string, candidates: CascadeCandidate[] }} CascadeTier
 */

/**
 * 適用される宣言が 1 件も無いバケットの結果を out に書く。
 * @param {CascadeBucket} entry
 * @param {CascadeCandidate[]} wildcard
 * @param {CascadeResult} out
 * @returns {CascadeResult}
 */
function decideWithoutApplying(entry, wildcard, out) {
  const { reasons } = out;
  if (wildcard.length > 0) {
    reasons.push(
      "an `all` declaration applies to every property and browsers do not expand it into longhands " +
        "(measured in Chrome 149), so no individual declaration settles this property",
    );
    return out;
  }
  if (entry.conditional.length > 0) {
    reasons.push(
      "only conditional (@media / @supports / @container) declarations remain; " +
        "css-rules-capture records conditions without evaluating them, so applicability is unknown",
    );
    return out;
  }
  if (entry.state_unknown.length > 0) {
    reasons.push(
      "only declarations gated by persistent state pseudo-classes remain " +
        `(${[...new Set(entry.state_unknown.flatMap((c) => c.unknown_states))].map(String).sort().join(", ")}); ` +
        "these describe the element itself, not the capture directory, so applicability is unknown. " +
        "pass --state <name> for the ones you know were active",
    );
    return out;
  }
  out.status = "absent";
  reasons.push(
    entry.state_gated > 0
      ? `all ${entry.state_gated} declaration(s) need a state that is not active`
      : "no declaration for this property",
  );
  return out;
}

/**
 * 適用される候補を段に分ける。段（強い順）: インラインの `!important` → 規則の `!important` → インライン → 規則
 * @param {CascadeCandidate[]} applying
 * @returns {CascadeTier[]}
 */
function buildTiers(applying) {
  return [
    {
      name: "inline !important",
      candidates: applying.filter((c) => c.source === "inline" && c.important),
    },
    {
      name: "rule !important",
      candidates: applying.filter((c) => c.source === "rule" && c.important),
    },
    { name: "inline", candidates: applying.filter((c) => c.source === "inline" && !c.important) },
    { name: "rule", candidates: applying.filter((c) => c.source === "rule" && !c.important) },
  ];
}

/**
 * レイヤをまたぐ競合はここでは決められない（レイヤの宣言順が入力に無い）。
 * @param {CascadeCandidate[]} candidates
 * @returns {boolean}
 */
function layerSpread(candidates) {
  const paths = new Set(candidates.map((c) => JSON.stringify(c.layers)));
  return paths.size > 1;
}

/**
 * 無名レイヤ（`@layer { … }`）の名前は `css-rules-capture.mjs` で空文字になる。
 * 別々の無名レイヤが同じ `[""]` として記録されるため、**同じパスに見えても同一レイヤとは限らない**。
 * レイヤの順序は詳細度より強く `!important` で逆転するので、同一視すると、警告なしに誤った勝者になる。
 * @param {CascadeCandidate} c
 * @returns {boolean}
 */
function isAnonymous(c) {
  return c.layers.some((name) => name === "");
}

/**
 * 段を強い順に見て、勝者を決める。決められなければ理由を reasons に足して null を返す。
 * @param {CascadeTier[]} tiers
 * @param {boolean} anonymousAmbiguity
 * @param {string[]} reasons
 * @returns {{ won: CascadeCandidate, tier: string } | null}
 */
function pickWinner(tiers, anonymousAmbiguity, reasons) {
  for (const tier of tiers) {
    if (tier.candidates.length === 0) continue;
    if (anonymousAmbiguity) {
      reasons.push(
        `a candidate for this property sits in an anonymous cascade layer (tier: ${tier.name}); ` +
          "css-rules-capture records every anonymous layer as an empty name, so two different layers " +
          "are indistinguishable here and layer order outranks specificity",
      );
      return null;
    }
    if (layerSpread(tier.candidates)) {
      reasons.push(
        `competing ${tier.name} declarations sit in different cascade layers` +
          `(${[...new Set(tier.candidates.map((c) => JSON.stringify(c.layers)))].join(" vs ")});` +
          "the order in which the layers were declared is not recorded in css-rules.json",
      );
      return null;
    }
    // 規則の order は、書かれた順を表す。order を読めない規則（null）が、最も強い詳細度に別の宣言と並ぶと、
    // どちらが後に書かれたかを決められない。null を 0 として比べると規則をまたいで宣言の位置を比べることになり、
    // 勝者が正しく決まる保証が無いので、判定できないとして扱う（追い越しの判定の couldOutrank も同じ規則にする）。
    const unordered = unorderedTie(tier.candidates);
    if (unordered !== null) {
      reasons.push(unknownOrderReason(tier.name, unordered));
      return null;
    }
    return { won: strongest(tier.candidates), tier: tier.name };
  }
  // applying が空でないので、どれかの段で勝者が決まるか、上で返している（型の絞り込みのため）。
  throw new Error(
    "cascade-resolve: 適用される宣言があるのに勝者が決まらない（このツールの不具合）",
  );
}

/**
 * 同じ段の規則どうしで、候補が勝者を追い越しうるか。決められないときは "unknown-order"。
 * @param {CascadeCandidate} c
 * @param {CascadeCandidate} won
 * @returns {boolean | "unknown-order"}
 */
function ruleOutranks(c, won) {
  if (JSON.stringify(c.layers) !== JSON.stringify(won.layers)) return true;
  if (c.specificity === null) return true;
  // 勝者は規則で、詳細度を読めない規則は上で返しているので、ここで null にはならない
  // （元は compareSpecificity が null を読んで TypeError になる）。
  if (won.specificity === null) throw new TypeError("winner has no specificity");
  const bySpec = compareSpecificity(c.specificity, won.specificity);
  if (bySpec !== 0) return bySpec > 0;
  if (c.rule_index !== won.rule_index) {
    // 同じ詳細度で、別々の規則のどちらかの order を読めなければ、どちらが後に書かれたかを決められない。
    // 勝者を選ぶときと同じく、判定できないとして呼び出し側に返す（理由も order が無いことを書く）。
    if (c.order === null || won.order === null) return "unknown-order";
    const byOrder = c.order - won.order;
    if (byOrder !== 0) return byOrder > 0;
  }
  // 同じ規則の中では後に書いた宣言が勝つ（`.x { color: red; all: unset }` の形）。
  return (c.declaration_index ?? 0) > (won.declaration_index ?? 0);
}

/**
 * 候補が勝者を追い越しうるか。同じ詳細度で別々の規則のどちらかに order が無く、決められないときは "unknown-order"。
 * @param {CascadeCandidate} c
 * @param {{ won: CascadeCandidate, tierRank: number }} winner
 * @returns {boolean | "unknown-order"}
 */
function outranks(c, { won, tierRank }) {
  // 段（tiers）の並びに合わせて候補の段を決める。候補が規則である前提で書くと、
  // インラインの候補（インラインの `all` 等）が常に下の段と判定されて追い越しを見落とす。
  const rank = c.source === "inline" ? (c.important ? 0 : 2) : c.important ? 1 : 3;
  if (rank < tierRank) return true;
  if (rank > tierRank) return false;
  // 同じ段でインライン同士なら、`style` 属性の中の並び順で決まる（詳細度もレイヤも無い）。
  if (c.source === "inline" && won.source === "inline") {
    return (c.declaration_index ?? 0) > (won.declaration_index ?? 0);
  }
  if (won.source === "inline" || c.source === "inline") return true;
  return ruleOutranks(c, won);
}

/**
 * 勝者を追い越しうる候補（条件付き・`all`・状態不明）があれば、決められない理由を返す（無ければ null）。
 * @param {CascadeBucket} entry
 * @param {CascadeCandidate[]} wildcard
 * @param {{ won: CascadeCandidate, tier: string, tierRank: number }} winner
 * @returns {string | null}
 */
function rivalReason(entry, wildcard, winner) {
  const unknownOrderRivals = [...entry.conditional, ...wildcard, ...entry.state_unknown].filter(
    (c) => outranks(c, winner) === "unknown-order",
  );
  if (unknownOrderRivals.length > 0) {
    return unknownOrderReason(winner.tier, [winner.won, ...unknownOrderRivals]);
  }
  /** @param {CascadeCandidate} c */
  const couldOutrank = (c) => outranks(c, winner) === true;
  if (entry.conditional.some(couldOutrank)) {
    return (
      "a conditional (@media / @supports / @container) declaration would outrank the winner if its " +
      "condition holds; css-rules-capture does not evaluate conditions, so this cannot be decided here"
    );
  }
  if (wildcard.some(couldOutrank)) {
    return (
      "an `all` declaration would outrank the winner; browsers do not expand `all` into longhands " +
      "(measured in Chrome 149), so which value this property ends up with is not settled here"
    );
  }
  if (entry.state_unknown.some(couldOutrank)) {
    return (
      "a declaration gated by a persistent state pseudo-class " +
      `(${[...new Set(entry.state_unknown.filter(couldOutrank).flatMap((c) => c.unknown_states))].map(String).sort().join(", ")}) ` +
      "would outrank the winner if that state was active during capture; the capture directory name " +
      "does not settle it. pass --state <name> if you know it was active"
    );
  }
  return null;
}

/**
 * 詳細度を読めない規則の候補ごとの理由（無ければ空）。
 * @param {CascadeCandidate[]} applying
 * @returns {string[]}
 */
function unreadableReasons(applying) {
  return applying
    .filter((c) => c.source === "rule" && c.specificity_error !== null)
    .map((c) => `cannot read specificity of ${JSON.stringify(c.selector)}: ${c.specificity_error}`);
}

/**
 * 無名レイヤのために、同じパスに見えるレイヤを同一と見なせないか。
 * 判定は `applying` に閉じない。条件付き・状態不明・`all` の候補も同じレイヤ順の曖昧さを持ち、
 * 無名レイヤに入っていれば「同じ `[""]` に見えるが別レイヤ」の可能性が残る
 * （`@media` 配下の無名レイヤの `!important` は、後段の無名レイヤの `!important` に逆順で勝ちうる）。
 * @param {CascadeBucket} entry
 * @param {CascadeCandidate[]} wildcard
 * @returns {boolean}
 */
function hasAnonymousAmbiguity(entry, wildcard) {
  const anonymousPool = [
    ...entry.applying,
    ...entry.conditional,
    ...entry.state_unknown,
    ...wildcard,
  ];
  return anonymousPool.length > 1 && anonymousPool.some(isAnonymous);
}

/**
 * 1 バケット（プロパティ × 擬似要素）の勝者を決める。
 * @param {CascadeBucket} entry
 * @param {CascadeCandidate[]} [wildcard] 同じ擬似要素の `all` の候補。
 * @returns {CascadeResult}
 */
function decide(entry, wildcard = []) {
  const reasons = [...entry.reasons];
  /** @type {CascadeResult} */
  const out = {
    property: entry.property,
    pseudo_element: entry.pseudo_element,
    status: "undecidable",
    winner: null,
    losers: [],
    conditional: entry.conditional,
    state_unknown: entry.state_unknown,
    wildcard,
    state_gated: entry.state_gated,
    reasons,
  };
  if (entry.applying.length === 0) return decideWithoutApplying(entry, wildcard, out);

  const unreadable = unreadableReasons(entry.applying);
  if (unreadable.length > 0) {
    reasons.push(...unreadable);
    return out;
  }
  const anonymousAmbiguity = hasAnonymousAmbiguity(entry, wildcard);
  const tiers = buildTiers(entry.applying);
  const picked = pickWinner(tiers, anonymousAmbiguity, reasons);
  if (picked === null) return out;
  const { won, tier } = picked;

  // 条件付きの候補が、決まった勝者より強い段にいるなら結論を出せない。
  const tierRank = tiers.findIndex((t) => t.name === tier);
  const rival = rivalReason(entry, wildcard, { won, tier, tierRank });
  if (rival !== null) {
    reasons.push(rival);
    return out;
  }

  out.status = "resolved";
  out.winner = { ...won, tier };
  out.losers = entry.applying.filter((c) => c !== won);
  return out;
}

const USAGE = [
  "usage: cascade-resolve.mjs --css-rules <css-rules.json> --state <name> [--state <name>...]",
  "                          [--property <name>]... [--all]",
  "",
  "  --state      この採取物を採ったときに成立していた状態（繰り返し可）。`default` は「状態擬似クラス無し」。",
  "               baseline/<instance>/<state>/ の <state> をそのまま渡す（必須。推測しない）。",
  "               :hover / :focus 等の一時的な状態は渡さなければ不成立として扱うが、",
  "               :enabled / :valid / :read-only のような恒常状態は不明として undecidable と判定する。",
  "               成否が分かっているものは --state で明示的に足す",
  "  --property   解決するプロパティ（繰り返し可）。省略時は --all が要る。",
  "               CSS カスタムプロパティ（--brand-color 等）もそのまま渡せる",
  "  --all        候補に現れる全プロパティを解決する",
  "  --allow-incomplete",
  "               inaccessible / unresolved が0 でなくても解決する。デフォルトは止まる（見えていない規則に",
  "               より強い宣言がありうるため）。免除したことは component-api.md に残す",
  "",
  "exit 0=全て resolved / absent、1=undecidable が 1 件以上、2=入力エラー",
].join("\n");

/**
 * 受け付ける引数。`--state` と `--property` は繰り返してよい。
 * CSS カスタムプロパティ（`--brand-color`）は `--property` の値として正当なので、`--property` は `--` で始まる値を受け付ける。
 * 取り違えを拾うため、このスクリプトが受け付ける名前（`--allow-incomplete` など）は値として受け取らない。
 * @type {import("./lib/flags.mjs").FlagSpec}
 */
const FLAG_SPEC = {
  values: ["--css-rules", "--state", "--property"],
  repeat: ["--state", "--property"],
  bools: ["--all", "--allow-incomplete"],
  dashValues: ["--property"],
};

/**
 * 空白だけの値を、値の書き忘れとして扱う（誤りは UsageError を投げる）。parseFlags は空の値だけを誤りにする。
 * @param {Record<string, string | string[] | true>} flags
 * @returns {void}
 */
function rejectBlankValues(flags) {
  for (const name of FLAG_SPEC.values ?? []) {
    const value = flags[name];
    const list = isArray(value) ? value : typeof value === "string" ? [value] : [];
    if (list.some((v) => v.trim() === "")) throw new UsageError(`${name} に値が無い`);
  }
}

/**
 * 必須の `--state` と、`--property` と `--all` の組み合わせを確かめる（誤りは UsageError を投げる）。
 * @param {{ states: string[], properties: string[], all: boolean }} args
 * @returns {void}
 */
function checkArgCombination({ states, properties, all }) {
  if (states.length === 0) {
    throw new UsageError(
      "--state is required; css-rules.json does not record which state it was captured in, " +
        "and matched[] contains rules that only apply in other states",
    );
  }
  if (properties.length === 0 && !all) {
    throw new UsageError("pass --property <name> at least once, or --all");
  }
  if (properties.length > 0 && all) {
    throw new UsageError("--all and --property are mutually exclusive");
  }
}

/**
 * 引数を読む（誤りは UsageError を投げる）。
 * @param {string[]} argv
 * @returns {{ cssRules: string, states: string[], properties: string[], all: boolean, allowIncomplete: boolean }}
 */
function parseArgs(argv) {
  const parsed = parseFlags(argv, FLAG_SPEC);
  if (parsed.error !== undefined) throw new UsageError(parsed.error);
  const { flags, strings, lists, bools } = parsed;
  const cssRules = strings["--css-rules"] ?? null;
  const states = lists["--state"] ?? [];
  const properties = lists["--property"] ?? [];
  const all = bools["--all"] === true;
  const allowIncomplete = bools["--allow-incomplete"] === true;
  rejectBlankValues(flags);
  if (cssRules === null) throw new UsageError("--css-rules is required");
  checkArgCombination({ states, properties, all });
  return { cssRules, states, properties, all, allowIncomplete };
}

/**
 * css-rules.json を読む（読めなければ UsageError を投げる）。
 * @param {string} cssRules
 * @returns {unknown}
 */
function readCssRules(cssRules) {
  try {
    return JSON.parse(readFileSync(cssRules, "utf8"));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new UsageError(`cannot read ${cssRules}: ${message}`);
  }
}

/**
 * CLI エントリ。
 * @param {string[]} argv - process.argv.slice(2)
 * @returns {number} exit code
 */
export function main(argv) {
  try {
    const { cssRules, states, properties, all, allowIncomplete } = parseArgs(argv);
    const report = resolveCascade(readCssRules(cssRules), {
      states,
      properties: all ? null : properties,
      source: cssRules,
      allowIncomplete,
    });
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    return report.counts.undecidable > 0 ? 1 : 0;
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(`error: ${err.message}\n${USAGE}\n`);
      return 2;
    }
    throw err;
  }
}

if (isCliEntry(import.meta.url)) process.exitCode = main(process.argv.slice(2));
