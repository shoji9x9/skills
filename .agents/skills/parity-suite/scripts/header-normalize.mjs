// 応答ヘッダーの正規化（原本）。parity-suite の録画と parity-diff の比較前の両方がこれを通す。
// 規則を文書の 2 か所に書くと片方だけ直って食い違うため、規則はここだけに置く。
//
// 何をするか: .replace/response-headers.json（横断の応答ヘッダーの一覧。形式の原本は replace-strategy の
//   assets/response-headers-template.json）を読み、応答ヘッダーを次の順で変換した JSON を返す。
//   1. 一覧に載るヘッダーだけに絞る（付け手が unknown の行を含むヘッダーは落とす）。
//   2. ヘッダー名を小文字に揃える（allHeaders() は小文字、headersArray() や HAR は元の表記で返す）。
//   3. Set-Cookie を cookie ごとに `{ name, attributes: { HttpOnly, Secure, SameSite } }` の形にして並べ替える。
//      値と Expires / Max-Age / Domain / Path は捨てる。値は秘密で、期限は実行ごとに変わる。
//   4. CSP の nonce- の値を固定の文字列に置き換える。
//
// 出力には cookie の値も nonce の値も残らない。
//
// 何をしないか: 付く応答の種類（画面・API・静的）で絞らない（どの応答かを知るのは呼び出し側）。
// Markdown の表（以前の survey.md 7 節）は読まない。人が書く表は、区切り・強調・注記の書き方によって読み取れない行が出続けた。
// 値の空白や大文字小文字を揃えない（SameSite の値だけは大文字小文字を区別しない属性なので正準形に揃える）。
//
// 決定論的: 乱数・現在時刻に依存しない。出力のキーは名前順、Set-Cookie は cookie 名順。
// TypeScript 構文は使わない（型は JSDoc）。スイートからはコピー（suite.tools）を import して使う。

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

// 利用者のプロジェクトへ 1 ファイルだけコピーして使うので、隣のファイルを import しない。
// `scripts/lib/` の helper（配列・オブジェクト・空でない文字列の型ガード、引数の読み取り、CLI の起動の判定）を同じ内容でここに持つ（一致は identical-copies の組で確かめる）。
// is-array-js:begin
/**
 * `T` のうち配列の部分。`unknown` と `any` は `unknown[]`、配列を含みうる型は `unknown[]` との交差にする。
 * @template T
 * @typedef {0 extends 1 & T ? unknown[] : unknown extends T ? unknown[] : T extends readonly unknown[] ? T : never[] extends T ? T & unknown[] : never} ArrayPart
 */

/**
 * 型ガードの述語に使う形。述語の型は引数の型に代入できる必要があるので、代入できる場合だけ `ArrayPart<T>` にする。
 * @template T
 * @typedef {ArrayPart<T> extends T ? ArrayPart<T> : never} ArrayNarrowed
 */

/**
 * 配列か。配列なら、入力の型の配列の部分に絞る。
 * @template T
 * @param {T} value
 * @returns {value is ArrayNarrowed<T>}
 */
function isArray(value) {
  return Array.isArray(value);
}
// is-array-js:end

// parse-flags-js:begin
/**
 * CLI が受け付ける引数。
 * - values: 値を 1 つ取る名前。同じ名前の 2 回目は誤りにする
 * - repeat: values のうち、繰り返してよい名前。値は配列で返す
 * - bools: 値を取らない名前。同じ名前の 2 回目は誤りにする
 * - dashValues: values のうち、`--` で始まる値を受け付ける名前（CSS のカスタムプロパティなど）
 * - positionals: 位置引数（`-` で始まらない引数・`-` だけの引数・`--` より後の引数）の最大の数（省略すると 0）
 * - equals: true なら `--名前=値` の形も受け付ける
 * @typedef {{ values?: readonly string[], repeat?: readonly string[], bools?: readonly string[], dashValues?: readonly string[], positionals?: number, equals?: boolean }} FlagSpec
 */

/**
 * `--名前 値` の引数を読む。誤りがあれば、error に理由を入れて返す。
 * 誤りの文は、未知の名前と多すぎる位置引数が「不明な引数: <引数>」、値の無い名前が「<名前> に値が無い」、
 * 同じ名前の 2 回目が「<名前> が重複している」、値を取らない名前に `=値` を付けたものが「<名前> は値を取らない」である。値が無いとは、名前が末尾にあって値が続かない・値が空白だけ・その CLI が受け付ける名前と同じ・
 * `--` で始まる（dashValues の名前を除く）のどれかである。`--` だけの引数はオプションの終わりで、その後はすべて位置引数にする。名前は値より先に確かめる。値を先に確かめると、値の無い未知の引数を
 * 「値が無い」と報告し、受け付ける引数のように読める。必須の引数と値の中身は、各 CLI が受け取った後に確かめる。
 * @param {readonly string[]} argv
 * @param {FlagSpec} spec
 * 結果は、名前の種類ごとの表（strings は値を 1 つ取る名前、lists は繰り返してよい名前、bools は値を取らない名前）と
 * 位置引数である。表のキーは `--` を含む名前である。
 * @returns {ParsedFlags | { error: string }}
 */
function parseFlags(argv, spec) {
  /** @type {FlagState} */
  const state = { spec, seen: new Set(), strings: {}, lists: {}, bools: {}, positionals: [] };
  for (let i = 0; i < argv.length; i += 1) {
    // 位置引数を取らない CLI では、`--` も受け付けない引数として扱う。
    if (argv[i] === "--" && (spec.positionals ?? 0) > 0) {
      const error = pushRest(argv.slice(i + 1), state);
      if (error) return { error };
      break;
    }
    const step = readFlagArg(argv, i, state);
    if ("error" in step) return { error: step.error };
    i = step.next;
  }
  const { strings, lists, bools, positionals } = state;
  return { strings, lists, bools, positionals };
}

/**
 * parseFlags の結果。
 * @typedef {{ strings: Record<string, string>, lists: Record<string, string[]>, bools: Record<string, true>, positionals: string[], error?: undefined }} ParsedFlags
 */

/**
 * parseFlags が読み進める途中の状態。seen は、読んだ名前（同じ名前の 2 回目を見つけるため）である。
 * @typedef {Omit<ParsedFlags, "error"> & { spec: FlagSpec, seen: Set<string> }} FlagState
 */

/**
 * argv[i] を 1 つ読み、値を読んだなら次の位置を、誤りなら理由を返す。
 * @param {readonly string[]} argv
 * @param {number} i
 * @param {FlagState} state
 * @returns {{ next: number } | { error: string }}
 */
function readFlagArg(argv, i, state) {
  const arg = argv[i];
  // `-` だけの引数は、標準入力を指す位置引数として扱う。
  if (!arg.startsWith("-") || arg === "-") {
    const error = pushPositional(arg, state);
    return error ? { error } : { next: i };
  }
  const eq = state.spec.equals && arg.startsWith("--") ? arg.indexOf("=") : -1;
  if (eq <= 0 && state.spec.bools?.includes(arg)) return setBoolFlag(arg, i, state);
  const inline = eq > 0 ? { name: arg.slice(0, eq), value: arg.slice(eq + 1) } : null;
  return readValueFlag({ argv, i, inline }, state);
}

/**
 * 値を取る名前を読む。inline は `--名前=値` の形の名前と値で、無ければ次の要素を値にする。
 * @param {{ argv: readonly string[], i: number, inline: { name: string, value: string } | null }} at
 * @param {FlagState} state
 * @returns {{ next: number } | { error: string }}
 */
function readValueFlag({ argv, i, inline }, state) {
  const name = inline?.name ?? argv[i];
  if (inline && state.spec.bools?.includes(name)) return { error: `${name} は値を取らない` };
  if (!(state.spec.values?.includes(name) ?? false)) return { error: `不明な引数: ${argv[i]}` };
  const value = inline ? inline.value : argv[i + 1];
  if (value === undefined || missingValue(name, value, state.spec))
    return { error: `${name} に値が無い` };
  const error = storeFlagValue(name, value, state);
  return error ? { error } : { next: inline ? i : i + 1 };
}

/**
 * `--` より後の引数をすべて位置引数として足す。上限を超えたら、最初に超えた引数の誤りの文を返す。
 * @param {readonly string[]} rest
 * @param {FlagState} state
 * @returns {string | undefined}
 */
function pushRest(rest, state) {
  for (const arg of rest) {
    const error = pushPositional(arg, state);
    if (error) return error;
  }
  return undefined;
}

/**
 * 位置引数を足す。上限を超えたら誤りの文を返す。
 * @param {string} arg
 * @param {FlagState} state
 * @returns {string | undefined}
 */
function pushPositional(arg, state) {
  if (state.positionals.length >= (state.spec.positionals ?? 0)) return `不明な引数: ${arg}`;
  state.positionals.push(arg);
  return undefined;
}

/**
 * 値を取らない名前を bools に入れる。2 回目なら誤りの文を返す。
 * @param {string} name
 * @param {number} i
 * @param {FlagState} state
 * @returns {{ next: number } | { error: string }}
 */
function setBoolFlag(name, i, state) {
  if (state.seen.has(name)) return { error: `${name} が重複している` };
  state.seen.add(name);
  state.bools[name] = true;
  return { next: i };
}

/**
 * 値を取る名前の値を strings か lists に入れる。繰り返してよい名前は配列に足し、それ以外の 2 回目は誤りの文を返す。
 * @param {string} name
 * @param {string} value
 * @param {FlagState} state
 * @returns {string | undefined}
 */
function storeFlagValue(name, value, state) {
  if (state.spec.repeat?.includes(name)) {
    state.lists[name] = [...(state.lists[name] ?? []), value];
    return undefined;
  }
  if (state.seen.has(name)) return `${name} が重複している`;
  state.seen.add(name);
  state.strings[name] = value;
  return undefined;
}

/**
 * 値を、値の書き忘れとして扱うか。空白だけの値と、その CLI が受け付ける名前と同じ値（`-h` を含む）は、書き忘れとして扱う。
 * `--` で始まる値も書き忘れとして扱うが、dashValues の名前は受け付ける（CSS のカスタムプロパティなど）。
 * @param {string} name
 * @param {string} value
 * @param {FlagSpec} spec
 * @returns {boolean}
 */
function missingValue(name, value, spec) {
  // `--`（オプションの終わり）は、dashValues の名前でも値として受け付けない。
  if (value.trim() === "" || value === "--") return true;
  if ((spec.values?.includes(value) ?? false) || (spec.bools?.includes(value) ?? false))
    return true;
  return value.startsWith("--") && !(spec.dashValues?.includes(name) ?? false);
}
// parse-flags-js:end

/**
 * ツールのバージョン（原本）。正規化の規則・出力形状を変えたら上げる。
 * 録画と比較で違うバージョンを使うと、規則の差が現新の差分として誤って検出される。
 * @type {string}
 */
export const VERSION = "2";

/** 伏せた nonce の置き換え先。 */
export const NONCE_MASK = "nonce-<masked>";

/** 応答の種類の語彙（原本は replace-strategy の assets/response-headers-template.json）。 */
const RESPONSE_KINDS = new Set([
  "page",
  "login",
  "redirect",
  "api-success",
  "api-error",
  "static",
  "not-found",
]);

/** どの機能にも属さない応答の種類。所有者 slug はこれを含む行にだけ書く。 */
const UNOWNED_KINDS = new Set(["static", "not-found"]);

/** 付け手の語彙。`unknown` の行は比べない（再構築で入ったデフォルトの値である可能性がある）。 */
const SETTERS = new Set(["app-code", "server-config", "unknown"]);

/** 分類の語彙。defense は値を、exposure は付かないこと（value: null）を持つ。 */
const CLASSES = new Set(["defense", "exposure"]);

/** 行のキー（`_` で始まるキーは注記として読まない）。 */
const ROW_KEYS = new Set([
  "name",
  "class",
  "value",
  "responses",
  "setter",
  "setter_source",
  "owner_slug",
]);

/** 測定済みの一覧のトップレベルのキー。 */
const MEASURED_KEYS = new Set([
  "schema_version",
  "status",
  "captured_at",
  "target",
  "captured_responses",
  "notes",
  "headers",
  "server_config_slug",
]);

/** 未測定の一覧のトップレベルのキー。 */
const UNMEASURED_KEYS = new Set(["schema_version", "status", "unmeasured_reason"]);

/** CSP の nonce を持ちうるヘッダー（小文字）。 */
const CSP_HEADERS = new Set(["content-security-policy", "content-security-policy-report-only"]);

/**
 * 一覧に書けるヘッダー名。RFC 9110 の token のうち英数字と `-` `_` `.` だけに絞る。token は `*` `_` とバッククォートも許すので、
 * Markdown の強調・コードの記号を残した名前（`**X-Frame-Options**`）が別名として通り、本来のヘッダーが警告なしに比較から外れる。
 */
const HEADER_NAME = /^[0-9A-Za-z][0-9A-Za-z._-]*$/;

/** 一覧を読めないときの例外。CLI は終了コード 3 にする（入力の誤りの 2 と分ける）。 */
export class NoHeaderListError extends Error {}

// is-plain-object-js:begin
/**
 * JSON オブジェクト（null と配列を除く）か。配列は typeof で "object" を通るため明示的に弾く。
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
function isPlainObject(v) {
  return typeof v === "object" && v !== null && !isArray(v);
}
// is-plain-object-js:end

// non-empty-string-js:begin
/**
 * 空でない文字列か（空白だけの文字列は空として扱う）。
 * @param {unknown} v
 * @returns {v is string & { readonly __nonEmptyString: true }}
 */
function nonEmptyString(v) {
  return typeof v === "string" && v.trim() !== "";
}
// non-empty-string-js:end

/**
 * 語彙に無いキー（`_` で始まる注記を除く）があれば投げる。打ち間違えたキーは読まれず、デフォルトの値として扱われてしまうためである。
 * @param {Record<string, unknown>} obj
 * @param {Set<string>} allowed
 * @param {string} where
 */
function rejectUnknownKeys(obj, allowed, where) {
  const unknown = Object.keys(obj).filter((k) => !k.startsWith("_") && !allowed.has(k));
  if (unknown.length > 0) throw new Error(`${where} に語彙外のキーがある: ${unknown.join(", ")}`);
}

/**
 * 同梱テンプレートのプレースホルダ（`<…>` だけの文字列）が残っていれば投げる。`_` で始まる注記キーは見ない。
 * 名前・語彙の欄は形の検査で落ちるが、自由記述の欄（value・target・captured_at・url・setter_source・notes 等）は
 * 空でない文字列として通るので、書き換え忘れの値が測定結果として読まれる。
 * @param {unknown} v
 * @param {string} where
 */
function rejectPlaceholders(v, where) {
  if (typeof v === "string") {
    if (/^<[\s\S]*>$/.test(v.trim()))
      throw new Error(`${where} にテンプレートのプレースホルダが残っている: ${JSON.stringify(v)}`);
  } else if (isArray(v)) {
    v.forEach((x, i) => rejectPlaceholders(x, `${where}[${i}]`));
  } else if (isPlainObject(v)) {
    for (const [k, x] of Object.entries(v)) {
      if (!k.startsWith("_")) rejectPlaceholders(x, where === "" ? k : `${where}.${k}`);
    }
  }
}

/**
 * 行の class と value の組を検査する。
 * @param {Record<string, unknown>} row
 * @param {string} at エラーに出す行の位置
 */
function checkClassAndValue(row, at) {
  const { value } = row;
  if (typeof row.class !== "string" || !CLASSES.has(row.class))
    throw new Error(
      `${at}.class は ${[...CLASSES].join(" / ")} のどれか: ${JSON.stringify(row.class)}`,
    );
  // 防御は値を、露出の抑止は付かないこと（null）を assertion にする。逆の組み合わせは分類か値のどちらかの誤り。
  if (row.class === "defense" && !nonEmptyString(value))
    throw new Error(`${at}.value は defense なら空でない文字列`);
  if (row.class === "exposure" && value !== null)
    throw new Error(`${at}.value は exposure なら null（付かない）`);
}

/**
 * 行の responses を検査し、文字列と確かめた応答の種類を返す。
 * @param {unknown} responses
 * @param {string} at エラーに出す行の位置
 * @param {Set<string>} captured 採った応答の種類
 * @returns {string[]} 文字列と確かめた responses（並びも中身も responses と同じ）
 */
function checkResponses(responses, at, captured) {
  if (!isArray(responses) || responses.length === 0)
    throw new Error(`${at}.responses は応答の種類の空でない配列`);
  /** @type {string[]} */
  const kinds = [];
  for (const r of responses) {
    // 採っていない種類の応答に付くとは書けない（測っていない値を仕様にする）。captured_responses の kind は
    // 語彙で検査済みなので、語彙外の種類もここで落ちる。
    if (typeof r !== "string" || !captured.has(r))
      throw new Error(
        `${at}.responses の ${JSON.stringify(r)} は captured_responses で採った種類ではない（語彙: ${[...RESPONSE_KINDS].join(" / ")}）`,
      );
    kinds.push(r);
  }
  if (new Set(responses).size !== responses.length)
    throw new Error(`${at}.responses に同じ種類が重複している`);
  return kinds;
}

/**
 * 行の setter_source と owner_slug を検査する。
 * @param {Record<string, unknown>} row
 * @param {string} at エラーに出す行の位置
 * @param {string[]} kinds 行の responses
 */
function checkSourceAndOwner(row, at, kinds) {
  const { owner_slug: owner } = row;
  if (
    Object.hasOwn(row, "setter_source") &&
    row.setter_source !== null &&
    !nonEmptyString(row.setter_source)
  )
    throw new Error(`${at}.setter_source は空でない文字列か null`);
  if (owner !== null) {
    if (!nonEmptyString(owner)) throw new Error(`${at}.owner_slug は空でない文字列か null`);
    // 所有者は機能に属さない応答（静的・404）の引き受け手。機能の応答にだけ付く行に書くと、
    // 所有者の確定（setup 手順 9）がどの応答を指したのか読めない。
    if (!kinds.some((r) => UNOWNED_KINDS.has(r)))
      throw new Error(`${at}.owner_slug は responses に static か not-found を含む行にだけ書く`);
  }
}

/**
 * 一覧の 1 行を検査する。書き手（replace-strategy の測定）の不変条件をここで全部確かめる。
 * 読み手が使う欄（name・setter）だけを見ると、他の欄の誤りが残ったまま一覧として通る。
 * @param {unknown} row
 * @param {number} i
 * @param {Set<string>} captured 採った応答の種類
 * @returns {{ key: string, setter: string, responses: string[] }}
 */
function checkRow(row, i, captured) {
  const where = `headers[${i}]`;
  if (!isPlainObject(row)) throw new Error(`${where} はオブジェクトで書く`);
  rejectUnknownKeys(row, ROW_KEYS, where);
  const { name, setter } = row;
  if (typeof name !== "string" || !HEADER_NAME.test(name))
    throw new Error(`${where}.name をヘッダー名として読めない: ${JSON.stringify(name)}`);
  const at = `${where}（${name}）`;
  checkClassAndValue(row, at);
  const kinds = checkResponses(row.responses, at, captured);
  if (typeof setter !== "string" || !SETTERS.has(setter))
    throw new Error(
      `${at}.setter は ${[...SETTERS].join(" / ")} のどれか: ${JSON.stringify(setter)}`,
    );
  checkSourceAndOwner(row, at, kinds);
  return { key: name.toLowerCase(), setter, responses: kinds };
}

/**
 * captured_responses を検査し、採った応答の種類の集合を返す。
 * @param {Record<string, unknown>} doc 測定済みの一覧
 * @returns {Set<string>}
 */
function readCapturedResponses(doc) {
  if (!isArray(doc.captured_responses) || doc.captured_responses.length === 0)
    throw new Error("captured_responses（採った応答）は空でない配列");
  /** @type {Set<string>} */
  const captured = new Set();
  doc.captured_responses.forEach((c, i) => {
    if (!isPlainObject(c)) throw new Error(`captured_responses[${i}] はオブジェクトで書く`);
    rejectUnknownKeys(c, new Set(["kind", "url"]), `captured_responses[${i}]`);
    if (typeof c.kind !== "string" || !RESPONSE_KINDS.has(c.kind))
      throw new Error(`captured_responses[${i}].kind は語彙外: ${JSON.stringify(c.kind)}`);
    if (!nonEmptyString(c.url)) throw new Error(`captured_responses[${i}].url が無い`);
    captured.add(c.kind);
  });
  return captured;
}

/**
 * headers の各行を検査し、比べるヘッダー名（小文字）の集合を返す。
 * @param {unknown[]} headers
 * @param {Set<string>} captured 採った応答の種類
 * @returns {Set<string>}
 */
function comparedHeaderNames(headers, captured) {
  /** @type {Map<string, boolean>} 名前 → その名前の行がすべて付け手の決まった行か */
  const known = new Map();
  /** @type {Map<string, Set<string>>} 名前 → その名前の行が覆う応答の種類 */
  const covered = new Map();
  headers.forEach((row, i) => {
    const { key, setter, responses } = checkRow(row, i, captured);
    // 同じヘッダーの行が同じ種類の応答を 2 度覆うと、その応答の値・付け手がどちらか読めない。
    const seen = covered.get(key) ?? new Set();
    const dup = responses.find((r) => seen.has(r));
    if (dup) throw new Error(`headers[${i}]（${key}）の responses の ${dup} は別の行と重なる`);
    for (const r of responses) seen.add(r);
    covered.set(key, seen);
    // 同じヘッダーが応答の種類ごとに複数行あり、1 行でも付け手が unknown なら、そのヘッダーは録画にも比較にも入れない。
    // 出力はヘッダー名で絞るだけで、応答の種類を知らない。比べる側として扱うと、unknown の行が指す応答の値
    // （再構築で入ったデフォルトの値である可能性がある）まで現行の仕様として固定してしまう。決まった行の後退は、スイートがその応答の
    // assertion で両側に確かめる（parity-suite の references/api-batch.md「応答ヘッダー」）。
    known.set(key, (known.get(key) ?? true) && setter !== "unknown");
  });
  return new Set([...known].filter(([, ok]) => ok).map(([name]) => name));
}

/**
 * .replace/response-headers.json の中身（JSON の文字列）から、比べるヘッダー名（小文字）の集合を返す。
 * 未測定（status: unmeasured）なら NoHeaderListError、形の誤りは Error（入力の誤り）を投げる。
 * 一覧の代わりを推測で作らない。
 * @param {string} text
 * @returns {Set<string>}
 */
export function parseHeaderList(text) {
  let doc;
  try {
    doc = JSON.parse(String(text));
  } catch {
    throw new Error("一覧を JSON として読めない");
  }
  if (!isPlainObject(doc)) throw new Error("一覧はオブジェクトで書く");
  rejectPlaceholders(doc, "");
  if (doc.schema_version !== 1)
    throw new Error(`schema_version は 1: ${JSON.stringify(doc.schema_version)}`);
  if (doc.status === "unmeasured") {
    // 未測定と行の併存は、どちらが正しいかを決められない（退避した旧一覧か、status の書き忘れか）。
    rejectUnknownKeys(doc, UNMEASURED_KEYS, "未測定の一覧");
    if (!nonEmptyString(doc.unmeasured_reason))
      throw new Error("status: unmeasured には unmeasured_reason（理由）を書く");
    throw new NoHeaderListError(`一覧が未測定（${doc.unmeasured_reason}）`);
  }
  if (doc.status !== "measured")
    throw new Error(`status は measured / unmeasured のどれか: ${JSON.stringify(doc.status)}`);
  rejectUnknownKeys(doc, MEASURED_KEYS, "測定済みの一覧");
  if (!nonEmptyString(doc.captured_at)) throw new Error("captured_at（採った日時）が無い");
  if (!nonEmptyString(doc.target)) throw new Error("target（採った target 名）が無い");
  const captured = readCapturedResponses(doc);
  if (Object.hasOwn(doc, "notes") && typeof doc.notes !== "string")
    throw new Error("notes は文字列");
  // 欠落（undefined）も落とす。未確定は null と明示させ、欄の書き忘れと区別する。
  if (doc.server_config_slug !== null && !nonEmptyString(doc.server_config_slug))
    throw new Error("server_config_slug は空でない文字列か null（未確定なら null）");
  // 防御ヘッダーも露出の抑止の候補も 1 つも無い応答はありうるので、空の配列は「比べるヘッダーが無い」として通す
  // （status: measured と明示した一覧なので、書き忘れの表と違い空であることが測定結果）。
  if (!isArray(doc.headers)) throw new Error("headers は配列");
  return comparedHeaderNames(doc.headers, captured);
}

/**
 * 入力のヘッダーを [小文字の名前, 値の配列] の Map に揃える。
 * 受け付ける形: allHeaders() の { name: value }（値は文字列か文字列の配列）、
 * headersArray() / HAR の [{ name, value }]。
 * @param {unknown} headers
 * @returns {Map<string, string[]>}
 */
function collectHeaders(headers) {
  /** @type {Map<string, string[]>} */
  const out = new Map();
  if (isArray(headers)) {
    addHeaderArray(out, headers);
  } else if (headers !== null && typeof headers === "object") {
    addHeaderObject(out, headers);
  } else {
    throw new Error("ヘッダーはオブジェクトか { name, value } の配列で渡す");
  }
  return out;
}

/**
 * headersArray() / HAR の [{ name, value }] を Map に足す。
 * @param {Map<string, string[]>} out 足す先
 * @param {unknown[]} headers
 */
function addHeaderArray(out, headers) {
  for (const h of headers) {
    if (h === null || typeof h !== "object")
      throw new Error("headersArray の要素は { name, value } で渡す");
    addHeader(out, "name" in h ? h.name : undefined, "value" in h ? h.value : undefined);
  }
}

/**
 * allHeaders() の { name: value }（値は文字列か文字列の配列）を Map に足す。
 * @param {Map<string, string[]>} out 足す先
 * @param {object} headers
 */
function addHeaderObject(out, headers) {
  for (const [name, value] of Object.entries(headers)) {
    for (const v of isArray(value) ? value : [value]) addHeader(out, name, v);
  }
}

/**
 * ヘッダーを 1 つ、小文字の名前で Map に足す。Set-Cookie は 1 cookie 1 要素に分ける。
 * @param {Map<string, string[]>} out 足す先
 * @param {unknown} name
 * @param {unknown} value
 */
function addHeader(out, name, value) {
  if (typeof name !== "string" || typeof value !== "string") {
    // 値は cookie の値を含みうるので、エラーには型だけを出す。
    throw new Error(
      `ヘッダーの名前と値は文字列で渡す（name: ${typeof name}, value: ${typeof value}）`,
    );
  }
  const key = name.toLowerCase();
  // allHeaders() は複数の Set-Cookie を改行でつないで返す。1 cookie 1 要素に揃える。
  const parts = key === "set-cookie" ? value.split("\n") : [value];
  out.set(key, [...(out.get(key) ?? []), ...parts]);
}

/**
 * SameSite の値を正準形にする（属性値は大文字小文字を区別しない）。知らない値はそのまま残す。
 * @param {string} value
 * @returns {string}
 */
function canonicalSameSite(value) {
  const v = value.trim();
  const known = ["Strict", "Lax", "None"].find((k) => k.toLowerCase() === v.toLowerCase());
  return known ?? v;
}

/**
 * Set-Cookie の 1 行を名前と属性に変換する。cookie の値は返さない。
 * `=` の無い行（名前の無い cookie。RFC 6265 では行全体が値）は名前を空にする。
 * @param {string} line
 * @returns {{ name: string, attributes: { HttpOnly: boolean, Secure: boolean, SameSite: string | null } }}
 */
export function parseSetCookie(line) {
  const [pair, ...attrs] = line.split(";");
  const eq = pair.indexOf("=");
  const name = eq < 0 ? "" : pair.slice(0, eq).trim();
  /** @type {{ HttpOnly: boolean, Secure: boolean, SameSite: string | null }} */
  const attributes = {
    HttpOnly: false,
    Secure: false,
    SameSite: null,
  };
  for (const attr of attrs) {
    const i = attr.indexOf("=");
    const key = (i < 0 ? attr : attr.slice(0, i)).trim().toLowerCase();
    if (key === "httponly") attributes.HttpOnly = true;
    else if (key === "secure") attributes.Secure = true;
    else if (key === "samesite")
      attributes.SameSite = canonicalSameSite(i < 0 ? "" : attr.slice(i + 1));
  }
  return { name, attributes };
}

/**
 * CSP の nonce- の値を固定の文字列に置き換える。
 * @param {string} value
 * @returns {string}
 */
export function maskNonce(value) {
  return value.replace(/nonce-[^'"\s;,]+/gi, NONCE_MASK);
}

/**
 * response-headers.json のパスから一覧を読む。スイートも CLI もこれを使う（ファイルの読み方を 2 か所に書かない）。
 * ファイル自体が無いのも「一覧が無い」（NoHeaderListError。測定をやり直す処理へ回す）。
 * 読めない理由が他（権限等）なら、その例外をそのまま投げる（入力の誤り）。
 * @param {string} path
 * @returns {Set<string>}
 */
export function loadHeaderList(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    // 一覧の置き場（.replace/）はあるのにファイルが無いときだけ「一覧が無い」。置き場ごと無いのは
    // パスの誤りか作業ディレクトリの取り違えで、「一覧が無い」にするとヘッダーの比較が警告なしに外れる。
    if (err instanceof Error && "code" in err && err.code === "ENOENT" && existsSync(dirname(path)))
      throw new NoHeaderListError(
        `${path} が無い（survey.md の 7 節に表で書いた一覧は読まない。replace-strategy の測定の 7 で response-headers.json へ採り直す）`,
      );
    throw err;
  }
  return parseHeaderList(text);
}

/**
 * 応答ヘッダーを一覧に基づいて正規化する。
 * @param {unknown} headers allHeaders() / headersArray() / HAR の headers
 * @param {Set<string>} list parseHeaderList / loadHeaderList の戻り値
 * @returns {Record<string, unknown>}
 */
export function normalizeHeaders(headers, list) {
  const collected = collectHeaders(headers);
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const name of [...collected.keys()].sort()) {
    if (!list.has(name)) continue;
    const values = collected.get(name) ?? [];
    if (name === "set-cookie") {
      const cookies = values.filter((v) => v.trim() !== "");
      // 中身の無い Set-Cookie だけなら、付いていないのと同じにする（[] と欠落を別の値にしない）。
      if (cookies.length === 0) continue;
      out[name] = cookies.map(parseSetCookie).sort((a, b) => {
        if (a.name !== b.name) return a.name < b.name ? -1 : 1;
        const x = JSON.stringify(a.attributes);
        const y = JSON.stringify(b.attributes);
        return x < y ? -1 : x > y ? 1 : 0;
      });
    } else {
      // 同名の複数行は HTTP の結合規則どおり ", " でつなぐ（allHeaders() と同じ形）。
      const joined = values.join(", ");
      out[name] = CSP_HEADERS.has(name) ? maskNonce(joined) : joined;
    }
  }
  return out;
}

/**
 * CLI の本体。終了コード（0: 成功、2: 使い方か入力の誤り、3: 一覧が無い）を返す。
 * @param {string[]} argv
 * @param {{ stdout: { write(s: string): unknown }, stderr: { write(s: string): unknown } }} [io] 出力先（write だけを使う）
 * @returns {number}
 */
export function main(argv, io = { stdout: process.stdout, stderr: process.stderr }) {
  const usage =
    "usage: node header-normalize.mjs --header-list <.replace/response-headers.json> <headers.json>\n" +
    "       node header-normalize.mjs --header-list <.replace/response-headers.json> --list\n";
  const parsed = parseMainArgs(argv);
  if (parsed.error !== undefined) {
    io.stderr.write(`error: ${parsed.error}\n${usage}`);
    return 2;
  }
  const { listPath, listOnly, positionals } = parsed;
  if (!listPath || positionals.length !== (listOnly ? 0 : 1)) {
    io.stderr.write(usage);
    return 2;
  }
  let list;
  try {
    list = loadHeaderList(listPath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    io.stderr.write(`${err instanceof NoHeaderListError ? "no-list" : "error"}: ${message}\n`);
    return err instanceof NoHeaderListError ? 3 : 2;
  }
  // --list: 比べるヘッダー名（小文字・名前順）だけを出す。録画時の一覧を記録し、比較時の一覧と突き合わせるため。
  if (listOnly) {
    io.stdout.write(JSON.stringify([...list].sort()) + "\n");
    return 0;
  }
  return writeNormalized(positionals[0], list, io);
}

/**
 * main の引数を、一覧のパス・--list の有無・位置引数に分ける。誤りがあれば、error に理由を入れて返す。
 * @param {string[]} argv
 * @returns {{ listPath: string | undefined, listOnly: boolean, positionals: string[], error?: undefined } | { error: string }}
 */
function parseMainArgs(argv) {
  const parsed = parseFlags(argv, { values: ["--header-list"], bools: ["--list"], positionals: 1 });
  if (parsed.error !== undefined) return { error: parsed.error };
  return {
    listPath: parsed.strings["--header-list"],
    listOnly: parsed.bools["--list"] === true,
    positionals: parsed.positionals,
  };
}

/**
 * headers.json を読んで正規化し、stdout へ出す。終了コード（0: 成功、2: 入力の誤り）を返す。
 * @param {string} path headers.json のパス
 * @param {Set<string>} list 比べるヘッダー名
 * @param {{ stdout: { write(s: string): unknown }, stderr: { write(s: string): unknown } }} io 出力先
 * @returns {number}
 */
function writeNormalized(path, list, io) {
  let normalized;
  try {
    normalized = normalizeHeaders(JSON.parse(readFileSync(path, "utf8")), list);
  } catch (err) {
    // 入力の中身（cookie の値を含みうる）を stderr へ出さないよう、JSON の構文エラーは位置だけにする。
    const message =
      err instanceof SyntaxError
        ? "headers.json を JSON として読めない"
        : String(err instanceof Error ? err.message : err);
    io.stderr.write(`error: ${message}\n`);
    return 2;
  }
  io.stdout.write(JSON.stringify(normalized, null, 2) + "\n");
  return 0;
}

// CLI として起動されたかは、両辺を実パスに解決してから突き合わせて判定する。起動時のパス（process.argv[1]）は
// シンボリックリンクを解決せず、--preserve-symlinks-main では import.meta.url も解決しない。片側だけを解決すると、
// シンボリックリンクから起動したときに main() が呼ばれず、何も出力せずに exit 0 で終わる。
// 1 ファイルだけコピーして使うので import せず、parity-suite スキルの `scripts/lib/cli.mjs` の印の間と同じ関数をここに持つ。
// cli-entry-js:begin
/**
 * CLI として起動されたか。
 * @param {string} moduleUrl 呼び出し元のモジュールの URL
 * @returns {boolean}
 */
function isCliEntry(moduleUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  const self = fileURLToPath(moduleUrl);
  try {
    return realpathSync(entry) === realpathSync(self);
  } catch {
    // 実パスへの解決に失敗したら、起動時のパスのまま突き合わせる（何もせずに終わるより、誤って起動する方を選ぶ）。
    return entry === self;
  }
}
// cli-entry-js:end

if (isCliEntry(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
