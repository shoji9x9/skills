// 採取した CSS 規則のカスケード解決（正本）。
// **プロジェクトへコピーせずスキル配下からそのまま実行する**（css-rules-capture.mjs と同じ規約）。
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
// インラインが `.SearchBoxButton { width: 25px !important }` に負ける）も同じ（Issue #433）。
//
// fail-closed: 「勝者を 1 つに決められない」ことを黙って最初の宣言に倒さない。次は `undecidable`
// として理由付きで残し、exit 1 にする（利用者は現行の CSS を直接読んで確定する）:
//   - セレクタの詳細度を機械的に決められない（トップレベルのカンマ＝どの枝が当たったか不明、
//     未解決の `&`、読めないトークン）
//   - 競合する候補が**別のカスケードレイヤ**にある（レイヤの宣言順は `css-rules.json` に無く、
//     `layers` の名前だけからは前後を決められない）
//   - 条件付き（`@media` / `@supports` / `@container`）の候補が勝ちうる。css-rules-capture.mjs は
//     条件を**評価せず記録するだけ**なので、当たっているかどうかはこの入力から決まらない
//   - 恒常状態（`:enabled` / `:valid` / `:read-only` 等）で門番された候補が勝ちうる。これらは
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
// 何を決めないか: これは**合否判定ではない**。勝者を決めるのは実装時に「何を写すのか」を
// 確定するためで、現新の差分は画素比較と特性照合が出す（css-rules-capture.mjs と同じ分担）。
//
// 決定論的: 乱数・現在時刻・ネットワークに依存しない。TypeScript 構文は使わない（型は JSDoc）。

import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * ツールのバージョン（正本）。優先順位の規則・出力形状・fail-closed の条件を変えたら上げる。
 * @type {string}
 */
export const VERSION = "1";

/** 入力として受け付ける css-rules-capture.mjs の `tool_version`（採取スキーマが違う入力は読まない）。 */
export const SUPPORTED_CSS_RULES_VERSIONS = ["4"];

/** 単一コロンで書ける歴史的な擬似要素（詳細度は擬似要素として数える）。 */
const LEGACY_PSEUDO_ELEMENTS = new Set(["before", "after", "first-line", "first-letter"]);

/** 引数の中で最も詳細度の高い枝をそのまま採る擬似クラス。 */
const MAX_OF_ARGUMENT = new Set(["is", "not", "has", "matches", "-moz-any", "-webkit-any", "any"]);

/** 詳細度に寄与しない擬似クラス。 */
const ZERO_SPECIFICITY = new Set(["where"]);

/**
 * ポインタ・キーボード・遷移で作る**一時的な**状態擬似クラス（正本）。
 * これらは「いま作っていなければ当たっていない」と言い切れるので、`--state` に無ければ確実に不成立。
 *
 * `:link` / `:visited` / `:target` はここに入れない——採取で作るものではなく、
 * 要素と履歴・URL の性質（`<a href>` は既定で `:link` に当たる）なので、下の恒常状態と同じ扱いにする。
 *
 * 逆に、ここに無い状態擬似クラス（`:enabled` / `:valid` / `:read-only` / `:link` 等）は**要素の性質**であって、
 * 採取ディレクトリ名からは成否が決まらない。`css-rules-capture.mjs` の `STATE_PSEUDO_CLASSES` は
 * 両者を区別せず `states` に記録するため、ディレクトリ名だけで不成立に倒すと
 * **採取時に実際に効いていた宣言を落として、負けるはずの宣言を勝者として exit 0 で返す**。
 * そこで、`--state` に無い恒常状態は「不成立」ではなく**不明**として扱い、勝ちうるなら undecidable にする。
 * 成否が分かっているなら `--state <name>` で明示的に渡す。
 * @type {ReadonlySet<string>}
 */
const TRANSIENT_STATES = new Set(["active", "focus", "focus-visible", "focus-within", "hover"]);

/**
 * 同時に成立しうる一時的な状態（正本）。鍵の状態を `--state` で渡したとき、値の側は
 * **不成立と言い切れない**ので不明として扱う。
 *
 * ポインタで `:active` を作れば同じポインタが要素の上にあるので `:hover` も当たっている。
 * `:focus-visible` は `:focus` の部分集合で、`:focus` の要素は祖先の `:focus-within` も立てる。
 * 採取ディレクトリ名は 1 つしか持てないため、この共起を無視すると**採取時に効いていた宣言を
 * 落として、負けるはずの宣言を勝者として exit 0 で返す**。
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
 * セレクタ文字列の詳細度 [id, class, type] を数える。
 * 決められない形は `UndecidableSelector` を投げる（推測で数えない）。
 * @param {string} selector
 * @returns {[number, number, number]}
 */
export function specificity(selector) {
  if (typeof selector !== "string" || selector.trim() === "") {
    throw new UndecidableSelector("selector is empty");
  }
  const counts = [0, 0, 0];
  let i = 0;
  const s = selector;

  // CSS のエスケープは `\` ＋ 1 文字とは限らない。16 進エスケープは `\` ＋ 16 進数 1〜6 桁で、
  // 直後の空白 1 つが終端記号として消費される（`.\31 23` は「123」というクラス 1 つ）。
  // 2 文字固定で進めると残りの桁を型セレクタとして数え、詳細度が狂う（`.\31 23` が [0,1,1] になる）。
  const skipEscape = (start) => {
    let j = start + 1;
    if (j >= s.length) throw new UndecidableSelector(`dangling escape at ${start}`);
    let hex = 0;
    while (j < s.length && hex < 6 && /[0-9a-fA-F]/.test(s[j])) {
      j += 1;
      hex += 1;
    }
    if (hex === 0) return j + 1; // `\.` のような 1 文字エスケープ
    if (j < s.length && /\s/.test(s[j])) j += 1; // 終端の空白 1 つを消費する
    return j;
  };

  const skipIdent = (start) => {
    let j = start;
    if (j >= s.length) throw new UndecidableSelector(`identifier expected at ${start}`);
    while (j < s.length) {
      const ch = s[j];
      if (ch === "\\") {
        j = skipEscape(j);
        continue;
      }
      if (/[-\w -￿]/.test(ch)) {
        j += 1;
        continue;
      }
      break;
    }
    if (j === start) throw new UndecidableSelector(`identifier expected at ${start}`);
    return j;
  };

  /** 対応する閉じ括弧の位置（開き括弧を含む入れ子・文字列を飛ばす）。 */
  const matchClose = (start, open, close) => {
    let depth = 0;
    let j = start;
    while (j < s.length) {
      const ch = s[j];
      if (ch === "\\") {
        j += 2;
        continue;
      }
      if (ch === '"' || ch === "'") {
        j = skipString(j);
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
  };

  const skipString = (start) => {
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
    throw new UndecidableSelector("unterminated string in selector");
  };

  /** トップレベルのカンマで分割する（入れ子の括弧・文字列の中は分割しない）。 */
  const splitTopLevel = (text) => {
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
        const quote = ch;
        j += 1;
        while (j < text.length && text[j] !== quote) j += text[j] === "\\" ? 2 : 1;
        j += 1;
        continue;
      }
      if (ch === "(" || ch === "[") depth += 1;
      else if (ch === ")" || ch === "]") depth -= 1;
      else if (ch === "," && depth === 0) {
        parts.push(text.slice(start, j));
        start = j + 1;
      }
      j += 1;
    }
    parts.push(text.slice(start));
    return parts;
  };

  const add = (other) => {
    counts[0] += other[0];
    counts[1] += other[1];
    counts[2] += other[2];
  };

  while (i < s.length) {
    const ch = s[i];
    if (ch === "\\") {
      // エスケープされた先頭文字は型セレクタの一部として数える。
      counts[2] += 1;
      i = skipIdent(i);
      continue;
    }
    // 以降のトークン判定は skipIdent がエスケープ全体を消費する前提で進む。
    if (ch === '"' || ch === "'") {
      i = skipString(i);
      continue;
    }
    if (/\s/.test(ch) || ch === ">" || ch === "+" || ch === "~" || ch === "|") {
      i += 1;
      continue;
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
    if (ch === "*") {
      i += 1;
      continue;
    }
    if (ch === "#") {
      counts[0] += 1;
      i = skipIdent(i + 1);
      continue;
    }
    if (ch === ".") {
      counts[1] += 1;
      i = skipIdent(i + 1);
      continue;
    }
    if (ch === "[") {
      counts[1] += 1;
      i = matchClose(i, "[", "]") + 1;
      continue;
    }
    if (ch === ":") {
      const doubled = s[i + 1] === ":";
      const nameStart = i + (doubled ? 2 : 1);
      const nameEnd = skipIdent(nameStart);
      const name = s.slice(nameStart, nameEnd).toLowerCase();
      let argument = null;
      let next = nameEnd;
      if (s[nameEnd] === "(") {
        const close = matchClose(nameEnd, "(", ")");
        argument = s.slice(nameEnd + 1, close);
        next = close + 1;
      }
      if (doubled || LEGACY_PSEUDO_ELEMENTS.has(name)) {
        counts[2] += 1;
        i = next;
        continue;
      }
      if (ZERO_SPECIFICITY.has(name)) {
        i = next;
        continue;
      }
      if (MAX_OF_ARGUMENT.has(name)) {
        if (argument === null || argument.trim() === "") {
          throw new UndecidableSelector(`:${name}() has no argument`);
        }
        let best = null;
        for (const branch of splitTopLevel(argument)) {
          if (branch.trim() === "") throw new UndecidableSelector(`:${name}() has an empty branch`);
          const value = specificity(branch.trim());
          if (best === null || compareSpecificity(value, best) > 0) best = value;
        }
        add(best);
        i = next;
        continue;
      }
      if (argument !== null && /\bof\b/i.test(argument)) {
        // `:nth-child(2n of .a)` は引数側の詳細度を足すが、`of` の中身をここでは数えない。
        throw new UndecidableSelector(`:${name}() uses the \`of\` form; resolve it by hand`);
      }
      counts[1] += 1;
      i = next;
      continue;
    }
    if (/[-\w -￿]/.test(ch)) {
      counts[2] += 1;
      i = skipIdent(i);
      continue;
    }
    throw new UndecidableSelector(`unreadable token ${JSON.stringify(ch)} at ${i}`);
  }
  return /** @type {[number, number, number]}*/ (counts);
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
 * 候補を 1 件に畳む（同じ段・同じレイヤの中での勝者）。詳細度 → order の後勝ち。
 * @param {any[]} candidates
 * @returns {any}
 */
function strongest(candidates) {
  let best = candidates[0];
  for (const c of candidates.slice(1)) {
    // インラインの候補は詳細度を持たない（`specificity: null`）。同じ段に並ぶのはインライン同士か
    // 規則同士のどちらかなので、null が混じる比較は引き分けにして出現順（後勝ち）で決める。
    // ここで compareSpecificity へ null を渡すと TypeError になり、UsageError の exit 2 ではなく
    // 素のクラッシュになる（同じプロパティのインライン宣言が 2 件並ぶ入力で起きる）。
    const bySpec =
      c.specificity === null || best.specificity === null
        ? 0
        : compareSpecificity(c.specificity, best.specificity);
    if (bySpec > 0) {
      best = c;
      continue;
    }
    if (bySpec < 0) continue;
    if (c.order > best.order) {
      best = c;
      continue;
    }
    // 同じ規則（同じ order）なら、後に書いた宣言が勝つ。
    if (c.order === best.order && (c.declaration_index ?? 0) >= (best.declaration_index ?? 0)) {
      best = c;
    }
  }
  return best;
}

/**
 * `css-rules.json` の内容を読み、プロパティ × 擬似要素ごとに勝者を確定する。
 *
 * @param {any} document - css-rules.json をパースしたもの
 * @param {{ states: string[], properties?: string[]|null, source?: string, allowIncomplete?: boolean }} options
 * states: いま採っている状態で成立している状態擬似クラスの集合（`default` は空集合と同義）
 * properties: 解決するプロパティ名（省略時は候補に現れる全プロパティ）
 * allowIncomplete: `inaccessible` / `unresolved` が非ゼロでも解決する（既定は停止）
 * @returns {{ source:(string|null), tool_version:(string|null), active_states:string[],
 *             results:any[], counts:{resolved:number, undecidable:number, absent:number} }}

 */
export function resolveCascade(document, options) {
  if (document === null || typeof document !== "object" || Array.isArray(document)) {
    throw new UsageError("css-rules.json must be a JSON object");
  }
  if (!Array.isArray(document.matched)) {
    throw new UsageError("css-rules.json has no `matched` array (is it css-rules-capture output?)");
  }
  const toolVersion = typeof document.tool_version === "string" ? document.tool_version : null;
  if (toolVersion === null || !SUPPORTED_CSS_RULES_VERSIONS.includes(toolVersion)) {
    throw new UsageError(
      `css-rules.json tool_version ${JSON.stringify(toolVersion)} is not supported` +
        `(supported: ${SUPPORTED_CSS_RULES_VERSIONS.join(", ")}); re-capture with the bundled css-rules-capture.mjs`,
    );
  }
  // 採取が不完全なら、見えている部分集合から勝者を確定しない。
  // `inaccessible` は「そのスタイルシートの規則が 1 件も見えていない」、
  // `unresolved` は「そのセレクタが当たるかを判定していない」の実測で、
  // どちらも matched の全候補より強い宣言を隠しうる（0 件を「関係する規則が無い」と読まない規律と同じ）。
  const inaccessible = Array.isArray(document.inaccessible) ? document.inaccessible.length : null;
  const unresolved = Array.isArray(document.unresolved) ? document.unresolved.length : null;
  if (inaccessible === null || unresolved === null) {
    throw new UsageError(
      "css-rules.json must carry `inaccessible` and `unresolved` arrays; re-capture with the bundled css-rules-capture.mjs",
    );
  }
  const incomplete = inaccessible > 0 || unresolved > 0;
  if (incomplete && options.allowIncomplete !== true) {
    throw new UsageError(
      `css-rules.json records an incomplete capture (inaccessible: ${inaccessible}, unresolved: ${unresolved}); ` +
        "a declaration stronger than every matched candidate can hide there, so the visible subset does not " +
        "settle the winner. resolve them (re-capture, read the current CSS directly) or pass --allow-incomplete " +
        "to waive it explicitly and record the waiver in component-api.md",
    );
  }

  const inline = Array.isArray(document.inline_declarations) ? document.inline_declarations : null;
  if (inline === null) {
    throw new UsageError(
      "css-rules.json has no `inline_declarations` (captured with tool_version 1); re-capture",
    );
  }

  const active = new Set(options.states.filter((s) => s !== "default"));
  // 渡された状態から共起しうる一時的な状態を導く（渡されていなくても不成立とは言えない側）。
  const coOccurring = new Set();
  for (const state of active) {
    for (const other of CO_OCCURRING_STATES[state] ?? []) {
      if (!active.has(other)) coOccurring.add(other);
    }
  }
  /** @type {Map<string, any>} key = `${pseudo}\u0000${property}` */
  const buckets = new Map();
  /**
   * `all` の宣言（擬似要素ごと）。**ブラウザは `all` を longhand へ展開しない**
   * （Chrome 149 で実測: `margin` / `background` / `font` は展開されるが `all: unset` は `all` のまま）。
   * そのためプロパティ名で振り分けるだけでは、`all` が勝つ場面でも個別プロパティの宣言を勝者にしてしまう。
   * どのプロパティにも効きうる候補として別に持ち、勝ちうるなら undecidable にする。
   * @type {Map<string, any[]>}
   */
  const wildcards = new Map();
  const bucket = (pseudo, property) => {
    const key = `${pseudo === null ? "" : pseudo}\u0000${property}`;
    let entry = buckets.get(key);
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
      buckets.set(key, entry);
    }
    return entry;
  };

  for (const rule of document.matched) {
    const states = Array.isArray(rule.states) ? rule.states : [];
    const conditions = Array.isArray(rule.conditions) ? rule.conditions : [];
    const layers = Array.isArray(rule.layers) ? rule.layers : [];
    const declarations = Array.isArray(rule.declarations) ? rule.declarations : [];
    // 一時的な状態は「作っていないなら不成立」と言い切れる。恒常状態（`:enabled` 等）は
    // ディレクトリ名から成否が決まらないので、不成立に倒さず「不明」として持つ。
    const inactive = states.filter((state) => !active.has(state));
    // 渡された状態と共起しうる一時的な状態は「不成立」に倒さない（下記 CO_OCCURRING_STATES）。
    const gated = inactive.some((state) => TRANSIENT_STATES.has(state) && !coOccurring.has(state));
    const unknownStates = inactive.filter(
      (state) => !TRANSIENT_STATES.has(state) || coOccurring.has(state),
    );
    let spec = null;
    let specError = null;
    try {
      spec = specificity(String(rule.selector));
    } catch (err) {
      if (!(err instanceof UndecidableSelector)) throw err;
      specError = err.message;
    }
    for (let declIndex = 0; declIndex < declarations.length; declIndex += 1) {
      const decl = declarations[declIndex];
      if (decl === null || typeof decl !== "object" || typeof decl.property !== "string") continue;
      // `all` はプロパティ名の振り分けに載せない（どのプロパティにも効きうるので別に持つ）。
      const wildcard = decl.property === "all";
      const entry = wildcard ? null : bucket(rule.pseudo_element ?? null, decl.property);
      if (gated) {
        if (entry !== null) entry.state_gated += 1;
        continue;
      }
      const candidate = {
        source: "rule",
        selector: rule.selector,
        origin: rule.href ?? null,
        value: decl.value,
        important: Boolean(decl.important),
        specificity: spec,
        specificity_error: specError,
        order: typeof rule.order === "number" ? rule.order : null,
        // 同じ規則の中では後に書いた宣言が勝つ。`order` は規則単位なので、規則内の順序を別に持たないと
        // `.x { color: red; all: unset }` のように同一規則で競合する形が同点になる。
        declaration_index: declIndex,
        layers,
        conditions,
      };
      if (wildcard) {
        const key = rule.pseudo_element ?? "";
        if (!wildcards.has(key)) wildcards.set(key, []);
        wildcards.get(key).push({ ...candidate, unknown_states: unknownStates });
        continue;
      }
      if (conditions.length > 0) entry.conditional.push(candidate);
      else if (unknownStates.length > 0) {
        entry.state_unknown.push({ ...candidate, unknown_states: unknownStates });
      } else entry.applying.push(candidate);
    }
  }

  for (const decl of inline) {
    if (decl === null || typeof decl !== "object" || typeof decl.property !== "string") continue;
    // インラインは擬似要素に効かないので、要素自身のバケットにだけ入れる。
    const entry = bucket(null, decl.property);
    entry.applying.push({
      source: "inline",
      selector: null,
      origin: "style attribute",
      value: decl.value,
      important: Boolean(decl.important),
      specificity: null,
      specificity_error: null,
      order: null,
      layers: [],
      conditions: [],
    });
  }

  const requested = options.properties ?? null;
  const results = [];
  // `all` しか宣言が無い採取物では buckets が空になる。keys を buckets だけから作ると
  // `--all` が「候補 0 件」で exit 0 になり、ほぼ全プロパティを reset する宣言を見落とす。
  // 擬似要素ごとに、その `all` を受ける番兵のバケットを先に作っておく。
  for (const pseudoKey of wildcards.keys()) {
    const pseudo = pseudoKey === "" ? null : pseudoKey;
    const hasBucket = [...buckets.values()].some((e) => (e.pseudo_element ?? "") === pseudoKey);
    if (!hasBucket) bucket(pseudo, "all");
  }
  const keys = [...buckets.keys()].sort();
  for (const key of keys) {
    const entry = buckets.get(key);
    if (requested !== null && !requested.includes(entry.property)) continue;
    results.push(decide(entry, wildcards.get(entry.pseudo_element ?? "") ?? []));
  }
  if (requested !== null) {
    const seen = new Set(results.map((r) => r.property));
    for (const property of requested) {
      if (seen.has(property)) continue;
      // `all` があるなら「宣言が無い」とは言えない（all が値を与える）。
      const wildcardsForOwn = wildcards.get("") ?? [];
      if (wildcardsForOwn.length > 0) {
        results.push({
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
        });
        continue;
      }
      results.push({
        property,
        pseudo_element: null,
        status: "absent",
        winner: null,
        losers: [],
        conditional: [],
        state_gated: 0,
        reasons: ["no declaration for this property in matched or inline_declarations"],
      });
    }
    results.sort((a, b) => (a.property < b.property ? -1 : a.property > b.property ? 1 : 0));
  }

  const counts = { resolved: 0, undecidable: 0, absent: 0 };
  for (const r of results) counts[r.status] += 1;
  return {
    source: options.source ?? null,
    tool_version: toolVersion,
    cascade_resolve_version: VERSION,
    capture_completeness: { inaccessible, unresolved, waived: incomplete ? true : false },
    active_states: [...active].sort(),
    results,
    counts,
  };
}

/**
 * 1 バケット（プロパティ × 擬似要素）の勝者を決める。
 * @param {any} entry
 */
function decide(entry, wildcard = []) {
  const reasons = [...entry.reasons];
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
  if (entry.applying.length === 0) {
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
          `(${[...new Set(entry.state_unknown.flatMap((c) => c.unknown_states))].sort().join(", ")}); ` +
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

  const unreadable = entry.applying.filter(
    (c) => c.source === "rule" && c.specificity_error !== null,
  );
  if (unreadable.length > 0) {
    for (const c of unreadable) {
      reasons.push(
        `cannot read specificity of ${JSON.stringify(c.selector)}: ${c.specificity_error}`,
      );
    }
    return out;
  }

  // 段（強い順）: インライン !important → 規則 !important → インライン → 規則
  const inlineImportant = entry.applying.filter((c) => c.source === "inline" && c.important);
  const ruleImportant = entry.applying.filter((c) => c.source === "rule" && c.important);
  const inlineNormal = entry.applying.filter((c) => c.source === "inline" && !c.important);
  const ruleNormal = entry.applying.filter((c) => c.source === "rule" && !c.important);

  /** レイヤをまたぐ競合はここでは決められない（レイヤの宣言順が入力に無い）。 */
  const layerSpread = (candidates) => {
    const paths = new Set(candidates.map((c) => JSON.stringify(c.layers)));
    return paths.size > 1;
  };
  /**
   * 無名レイヤ（`@layer { … }`）の名前は `css-rules-capture.mjs` で空文字になる。
   * 別々の無名レイヤが同じ `[""]` として記録されるため、**同じパスに見えても同一レイヤとは限らない**。
   * レイヤ順は詳細度より強く `!important` で逆転するので、同一視すると黙って誤った勝者になる。
   */
  const isAnonymous = (c) => c.layers.some((name) => name === "");
  // 判定は `applying` に閉じない。条件付き・状態不明・`all` の候補も同じレイヤ順の曖昧さを持ち、
  // 無名レイヤに入っていれば「同じ `[""]` に見えるが別レイヤ」の可能性が残る
  // （`@media` 配下の無名レイヤの `!important` は、後段の無名レイヤの `!important` に逆順で勝ちうる）。
  const anonymousPool = [
    ...entry.applying,
    ...entry.conditional,
    ...entry.state_unknown,
    ...wildcard,
  ];
  const anonymousAmbiguity = anonymousPool.length > 1 && anonymousPool.some(isAnonymous);

  const tiers = [
    { name: "inline !important", candidates: inlineImportant },
    { name: "rule !important", candidates: ruleImportant },
    { name: "inline", candidates: inlineNormal },
    { name: "rule", candidates: ruleNormal },
  ];

  let winner = null;
  let winningTier = null;
  for (const tier of tiers) {
    if (tier.candidates.length === 0) continue;
    if (anonymousAmbiguity) {
      reasons.push(
        `a candidate for this property sits in an anonymous cascade layer (tier: ${tier.name}); ` +
          "css-rules-capture records every anonymous layer as an empty name, so two different layers " +
          "are indistinguishable here and layer order outranks specificity",
      );
      return out;
    }
    if (layerSpread(tier.candidates)) {
      reasons.push(
        `competing ${tier.name} declarations sit in different cascade layers` +
          `(${[...new Set(tier.candidates.map((c) => JSON.stringify(c.layers)))].join(" vs ")});` +
          "the order in which the layers were declared is not recorded in css-rules.json",
      );
      return out;
    }
    winner = strongest(tier.candidates);
    winningTier = tier.name;
    break;
  }

  // 条件付きの候補が、決まった勝者より強い段にいるなら結論を出せない。
  const tierRank = tiers.findIndex((t) => t.name === winningTier);
  const couldOutrank = (c) => {
    const rank = c.important ? 1 : 3;
    if (rank < tierRank) return true;
    if (rank > tierRank) return false;
    if (winner.source === "inline") return true;
    if (JSON.stringify(c.layers) !== JSON.stringify(winner.layers)) return true;
    if (c.specificity === null) return true;
    const bySpec = compareSpecificity(c.specificity, winner.specificity);
    if (bySpec !== 0) return bySpec > 0;
    const byOrder = (c.order ?? 0) - (winner.order ?? 0);
    if (byOrder !== 0) return byOrder > 0;
    // 同じ規則の中では後に書いた宣言が勝つ（`.x { color: red; all: unset }` の形）。
    return (c.declaration_index ?? 0) > (winner.declaration_index ?? 0);
  };
  if (entry.conditional.some(couldOutrank)) {
    reasons.push(
      "a conditional (@media / @supports / @container) declaration would outrank the winner if its " +
        "condition holds; css-rules-capture does not evaluate conditions, so this cannot be decided here",
    );
    return out;
  }
  if (wildcard.some(couldOutrank)) {
    reasons.push(
      "an `all` declaration would outrank the winner; browsers do not expand `all` into longhands " +
        "(measured in Chrome 149), so which value this property ends up with is not settled here",
    );
    return out;
  }
  if (entry.state_unknown.some(couldOutrank)) {
    reasons.push(
      "a declaration gated by a persistent state pseudo-class " +
        `(${[...new Set(entry.state_unknown.filter(couldOutrank).flatMap((c) => c.unknown_states))].sort().join(", ")}) ` +
        "would outrank the winner if that state was active during capture; the capture directory name " +
        "does not settle it. pass --state <name> if you know it was active",
    );
    return out;
  }

  out.status = "resolved";
  out.winner = { ...winner, tier: winningTier };
  out.losers = entry.applying.filter((c) => c !== winner);
  return out;
}

const USAGE = [
  "usage: cascade-resolve.mjs --css-rules <css-rules.json> --state <name> [--state <name>...]",
  "                          [--property <name>]... [--all]",
  "",
  "  --state      この採取物を採ったときに成立していた状態（繰り返し可）。`default` は「状態擬似クラス無し」。",
  "               baseline/<instance>/<state>/ の <state> をそのまま渡す（必須。推測しない）。",
  "               :hover / :focus 等の一時的な状態は渡さなければ不成立として扱うが、",
  "               :enabled / :valid / :read-only のような恒常状態は不明として undecidable に倒す。",
  "               成否が分かっているものは --state で明示的に足す",
  "  --property   解決するプロパティ（繰り返し可）。省略時は --all が要る。",
  "               CSS カスタムプロパティ（--brand-color 等）もそのまま渡せる",
  "  --all        候補に現れる全プロパティを解決する",
  "  --allow-incomplete",
  "               inaccessible / unresolved が非ゼロでも解決する。既定は停止（見えていない規則に",
  "               より強い宣言がありうるため）。免除したことは component-api.md に残す",
  "",
  "exit 0=全て resolved / absent、1=undecidable が 1 件以上、2=入力エラー",
].join("\n");

/**
 * CLI エントリ。
 * @param {string[]} argv - process.argv.slice(2)
 * @returns {number} exit code
 */
export function main(argv) {
  try {
    const FLAGS = new Set(["--css-rules", "--state", "--property", "--all"]);
    let cssRules = null;
    const states = [];
    const properties = [];
    let all = false;
    let allowIncomplete = false;
    for (let i = 0; i < argv.length; i += 1) {
      const arg = argv[i];
      const need = (name) => {
        const value = argv[i + 1];
        // CSS カスタムプロパティ（`--brand-color`）は `--property` の値として正当なので、
        // 「`--` で始まる」だけでは弾かない（弾くと custom property の勝者を確定できない）。
        // 取り違えを拾うため、既知のフラグ名そのものは値として受け取らない。
        const looksLikeFlag =
          value !== undefined &&
          value.startsWith("--") &&
          (name !== "--property" || FLAGS.has(value));
        if (value === undefined || value.trim() === "" || looksLikeFlag) {
          throw new UsageError(`${name} requires a value`);
        }
        i += 1;
        return value;
      };
      if (arg === "--css-rules") cssRules = need(arg);
      else if (arg === "--state") states.push(need(arg));
      else if (arg === "--property") properties.push(need(arg));
      else if (arg === "--all") all = true;
      else if (arg === "--allow-incomplete") allowIncomplete = true;
      else throw new UsageError(`unknown argument ${JSON.stringify(arg)}`);
    }
    if (cssRules === null) throw new UsageError("--css-rules is required");
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

    let parsed;
    try {
      parsed = JSON.parse(readFileSync(cssRules, "utf8"));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new UsageError(`cannot read ${cssRules}: ${message}`);
    }
    const report = resolveCascade(parsed, {
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

// CLI エントリ判定は両辺を実パスに解決してから突き合わせる（シンボリックリンク経由の起動で
// 条件が偽になり、何も出力せず exit 0 になるのを避ける）。
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

if (invokedAsCli) process.exitCode = main(process.argv.slice(2));
