// 応答ヘッダーの正規化（正本）。parity-suite の録画と parity-diff の比較前の両方がこれを通す。
// 規則を文書の 2 か所に書くと片方だけ直って食い違うため、規則はここだけに置く。
//
// 何をするか: .replace/response-headers.json（横断の応答ヘッダーの一覧。形式の正本は replace-strategy の
//   assets/response-headers-template.json）を読み、応答ヘッダーを
//   1. 一覧に載るヘッダーだけに絞る（付け手が unknown の行を含むヘッダーは落とす）
//   2. ヘッダー名を小文字に揃える（allHeaders() は小文字、headersArray() や HAR は元の表記で返す）
//   3. Set-Cookie を cookie ごとの { name, attributes: { HttpOnly, Secure, SameSite } } にして並べ替える
//      （値と Expires / Max-Age / Domain / Path は捨てる。値は秘密、期限は実行ごとに変わる）
//   4. CSP の nonce- の値を固定の文字列に置き換える
// の順で変換した JSON を返す。出力には cookie の値も nonce の値も残らない。
//
// 何をしないか: 付く応答の種類（画面・API・静的）で絞らない（どの応答かを知るのは呼び出し側）。
// Markdown の表（以前の survey.md 7 節）は読まない——人が書く表の区切り・強調・注記の書き方で穴が出続けたため。
// 値の空白や大文字小文字を揃えない（SameSite の値だけは大文字小文字を区別しない属性なので正準形に揃える）。
//
// 決定論的: 乱数・現在時刻に依存しない。出力のキーは名前順、Set-Cookie は cookie 名順。
// TypeScript 構文は使わない（型は JSDoc）。スイートからはコピー（suite.tools）を import して使う。

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * ツールのバージョン（正本）。正規化の規則・出力形状を変えたら上げる。
 * 録画と比較で違う版を使うと、規則の差が現新の差分に化ける。
 * @type {string}
 */
export const VERSION = "2";

/** 伏せた nonce の置き換え先。 */
export const NONCE_MASK = "nonce-<masked>";

/** 応答の種類の語彙（正本は replace-strategy の assets/response-headers-template.json）。 */
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

/** 付け手の語彙。`unknown` の行は比べない（再構築の既定値かもしれない）。 */
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
 * 一覧に書けるヘッダー名。RFC 9110 の token のうち英数字と `-` `_` `.` だけに絞る——token は `*` `_` とバッククォートも許すので、
 * Markdown の強調・コードの記号を残した名前（`**X-Frame-Options**`）が別名として通り、本来のヘッダーが黙って比較から外れる。
 */
const HEADER_NAME = /^[0-9A-Za-z][0-9A-Za-z._-]*$/;

/** 一覧を読めないときの例外。CLI は終了コード 3 に写す（入力の誤りの 2 と分ける）。 */
export class NoHeaderListError extends Error {}

/**
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * @param {unknown} v
 * @returns {v is string}
 */
function isNonEmptyString(v) {
  return typeof v === "string" && v.trim() !== "";
}

/**
 * 語彙に無いキー（`_` で始まる注記を除く）があれば投げる。打ち間違えたキーは読まれないまま既定値に倒れるため。
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
  } else if (Array.isArray(v)) {
    v.forEach((x, i) => rejectPlaceholders(x, `${where}[${i}]`));
  } else if (isObject(v)) {
    for (const [k, x] of Object.entries(v)) {
      if (!k.startsWith("_")) rejectPlaceholders(x, where === "" ? k : `${where}.${k}`);
    }
  }
}

/**
 * 一覧の 1 行を検査する。書き手（replace-strategy の測定）の不変条件をここで全部確かめる——
 * 読み手が使う欄（name・setter）だけを見ると、他の欄の誤りが残ったまま一覧として通る。
 * @param {unknown} row
 * @param {number} i
 * @param {Set<string>} captured 採った応答の種類
 * @returns {{ key: string, setter: string, responses: string[] }}
 */
function checkRow(row, i, captured) {
  const where = `headers[${i}]`;
  if (!isObject(row)) throw new Error(`${where} はオブジェクトで書く`);
  rejectUnknownKeys(row, ROW_KEYS, where);
  const { name, value, responses, setter, owner_slug: owner } = row;
  if (typeof name !== "string" || !HEADER_NAME.test(name))
    throw new Error(`${where}.name をヘッダー名として読めない: ${JSON.stringify(name)}`);
  const at = `${where}（${name}）`;
  if (typeof row.class !== "string" || !CLASSES.has(row.class))
    throw new Error(
      `${at}.class は ${[...CLASSES].join(" / ")} のどれか: ${JSON.stringify(row.class)}`,
    );
  // 防御は値を、露出の抑止は付かないこと（null）を assertion にする。逆の組み合わせは分類か値のどちらかの誤り。
  if (row.class === "defense" && !isNonEmptyString(value))
    throw new Error(`${at}.value は defense なら空でない文字列`);
  if (row.class === "exposure" && value !== null)
    throw new Error(`${at}.value は exposure なら null（付かない）`);
  if (!Array.isArray(responses) || responses.length === 0)
    throw new Error(`${at}.responses は応答の種類の空でない配列`);
  for (const r of responses) {
    // 採っていない種類の応答に付くとは書けない（測っていない値を仕様にする）。captured_responses の kind は
    // 語彙で検査済みなので、語彙外の種類もここで落ちる。
    if (typeof r !== "string" || !captured.has(r))
      throw new Error(
        `${at}.responses の ${JSON.stringify(r)} は captured_responses で採った種類ではない（語彙: ${[...RESPONSE_KINDS].join(" / ")}）`,
      );
  }
  if (new Set(responses).size !== responses.length)
    throw new Error(`${at}.responses に同じ種類が重複している`);
  if (typeof setter !== "string" || !SETTERS.has(setter))
    throw new Error(
      `${at}.setter は ${[...SETTERS].join(" / ")} のどれか: ${JSON.stringify(setter)}`,
    );
  if (
    Object.hasOwn(row, "setter_source") &&
    row.setter_source !== null &&
    !isNonEmptyString(row.setter_source)
  )
    throw new Error(`${at}.setter_source は空でない文字列か null`);
  if (owner !== null) {
    if (!isNonEmptyString(owner)) throw new Error(`${at}.owner_slug は空でない文字列か null`);
    // 所有者は機能に属さない応答（静的・404）の引き受け手。機能の応答にだけ付く行に書くと、
    // 所有者の確定（setup 手順 9）がどの応答を指したのか読めない。
    if (!responses.some((r) => UNOWNED_KINDS.has(/** @type {string} */ (r))))
      throw new Error(`${at}.owner_slug は responses に static か not-found を含む行にだけ書く`);
  }
  return { key: name.toLowerCase(), setter, responses: /** @type {string[]} */ (responses) };
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
  if (!isObject(doc)) throw new Error("一覧はオブジェクトで書く");
  rejectPlaceholders(doc, "");
  if (doc.schema_version !== 1)
    throw new Error(`schema_version は 1: ${JSON.stringify(doc.schema_version)}`);
  if (doc.status === "unmeasured") {
    // 未測定と行の併存は、どちらが正しいかを決められない（退避した旧一覧か、status の書き忘れか）。
    rejectUnknownKeys(doc, UNMEASURED_KEYS, "未測定の一覧");
    if (!isNonEmptyString(doc.unmeasured_reason))
      throw new Error("status: unmeasured には unmeasured_reason（理由）を書く");
    throw new NoHeaderListError(`一覧が未測定（${doc.unmeasured_reason}）`);
  }
  if (doc.status !== "measured")
    throw new Error(`status は measured / unmeasured のどれか: ${JSON.stringify(doc.status)}`);
  rejectUnknownKeys(doc, MEASURED_KEYS, "測定済みの一覧");
  if (!isNonEmptyString(doc.captured_at)) throw new Error("captured_at（採った日時）が無い");
  if (!isNonEmptyString(doc.target)) throw new Error("target（採った target 名）が無い");
  if (!Array.isArray(doc.captured_responses) || doc.captured_responses.length === 0)
    throw new Error("captured_responses（採った応答）は空でない配列");
  /** @type {Set<string>} */
  const captured = new Set();
  doc.captured_responses.forEach((c, i) => {
    if (!isObject(c)) throw new Error(`captured_responses[${i}] はオブジェクトで書く`);
    rejectUnknownKeys(c, new Set(["kind", "url"]), `captured_responses[${i}]`);
    if (typeof c.kind !== "string" || !RESPONSE_KINDS.has(c.kind))
      throw new Error(`captured_responses[${i}].kind は語彙外: ${JSON.stringify(c.kind)}`);
    if (!isNonEmptyString(c.url)) throw new Error(`captured_responses[${i}].url が無い`);
    captured.add(c.kind);
  });
  if (Object.hasOwn(doc, "notes") && typeof doc.notes !== "string")
    throw new Error("notes は文字列");
  // 欠落（undefined）も落とす。未確定は null と明示させ、欄の書き忘れと区別する。
  if (doc.server_config_slug !== null && !isNonEmptyString(doc.server_config_slug))
    throw new Error("server_config_slug は空でない文字列か null（未確定なら null）");
  // 防御ヘッダーも露出の抑止の候補も 1 つも無い応答はありうるので、空の配列は「比べるヘッダーが無い」として通す
  // （status: measured と明示した一覧なので、書き忘れの表と違い空であることが測定結果）。
  if (!Array.isArray(doc.headers)) throw new Error("headers は配列");

  /** @type {Map<string, boolean>} 名前 → その名前の行がすべて付け手の決まった行か */
  const known = new Map();
  /** @type {Map<string, Set<string>>} 名前 → その名前の行が覆う応答の種類 */
  const covered = new Map();
  doc.headers.forEach((row, i) => {
    const { key, setter, responses } = checkRow(row, i, captured);
    // 同じヘッダーの行が同じ種類の応答を 2 度覆うと、その応答の値・付け手がどちらか読めない。
    const seen = covered.get(key) ?? new Set();
    const dup = responses.find((r) => seen.has(r));
    if (dup) throw new Error(`headers[${i}]（${key}）の responses の ${dup} は別の行と重なる`);
    for (const r of responses) seen.add(r);
    covered.set(key, seen);
    // 同じヘッダーが応答の種類ごとに複数行あり、1 行でも付け手が unknown なら、そのヘッダーは録画にも比較にも入れない。
    // 出力はヘッダー名で絞るだけで応答の種類を知らないので、比べる側へ倒すと unknown の行が指す応答の値
    // （再構築の既定値かもしれない）まで現行の仕様として固定する。決まった行の後退は、スイートがその応答の
    // assertion で両側に確かめる（parity-suite の references/api-batch.md「応答ヘッダー」）。
    known.set(key, (known.get(key) ?? true) && setter !== "unknown");
  });
  return new Set([...known].filter(([, ok]) => ok).map(([name]) => name));
}

/**
 * 入力のヘッダーを [小文字の名前, 値の配列] の Map に揃える。
 * 受け付ける形: allHeaders() の { name: value }（値は文字列か文字列の配列）、
 * headersArray() / HAR の [{ name, value }]。
 * @param {unknown} headers
 * @returns {Map<string, string[]>}
 */
function collect(headers) {
  /** @type {Map<string, string[]>} */
  const out = new Map();
  const add = (/** @type {unknown} */ name, /** @type {unknown} */ value) => {
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
  };
  if (Array.isArray(headers)) {
    for (const h of headers) {
      if (h === null || typeof h !== "object")
        throw new Error("headersArray の要素は { name, value } で渡す");
      add(/** @type {any} */ (h).name, /** @type {any} */ (h).value);
    }
  } else if (headers !== null && typeof headers === "object") {
    for (const [name, value] of Object.entries(headers)) {
      for (const v of Array.isArray(value) ? value : [value]) add(name, v);
    }
  } else {
    throw new Error("ヘッダーはオブジェクトか { name, value } の配列で渡す");
  }
  return out;
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
  const attributes = {
    HttpOnly: false,
    Secure: false,
    SameSite: /** @type {string | null} */ (null),
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
 * ファイル自体が無いのも「一覧が無い」（NoHeaderListError。測定をやり直す経路へ送る）。
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
    // パスの誤りか作業ディレクトリの取り違えで、「一覧が無い」にするとヘッダーの比較が黙って外れる。
    if (/** @type {NodeJS.ErrnoException} */ (err).code === "ENOENT" && existsSync(dirname(path)))
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
  const collected = collect(headers);
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const name of [...collected.keys()].sort()) {
    if (!list.has(name)) continue;
    const values = /** @type {string[]} */ (collected.get(name));
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

export function main(argv, io = { stdout: process.stdout, stderr: process.stderr }) {
  const usage =
    "usage: node header-normalize.mjs --header-list <.replace/response-headers.json> <headers.json>\n" +
    "       node header-normalize.mjs --header-list <.replace/response-headers.json> --list\n";
  let listPath;
  let listOnly = false;
  const positionals = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--header-list") {
      listPath = argv[i + 1];
      i += 1;
    } else if (argv[i] === "--list") {
      listOnly = true;
    } else {
      positionals.push(argv[i]);
    }
  }
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
  let normalized;
  try {
    normalized = normalizeHeaders(JSON.parse(readFileSync(positionals[0], "utf8")), list);
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

// CLI エントリ判定は両辺を実パスに解決してから突き合わせる（json-normalize-diff.mjs と同じ理由。
// シンボリックリンク経由の起動で main() が呼ばれず何も出力せず exit 0 になるのを防ぐ）。
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

if (invokedAsCli) {
  process.exit(main(process.argv.slice(2)));
}
