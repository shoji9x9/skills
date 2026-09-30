// 応答ヘッダーの正規化（正本）。parity-suite の録画と parity-diff の比較前の両方がこれを通す。
// 規則を文書の 2 か所に書くと片方だけ直って食い違うため、規則はここだけに置く。
//
// 何をするか: .replace/survey.md「7. 横断の応答ヘッダー」の一覧を読み、応答ヘッダーを
//   1. 一覧に載るヘッダーだけに絞る（付け手が `不明` の行だけのヘッダーは落とす）
//   2. ヘッダー名を小文字に揃える（allHeaders() は小文字、headersArray() や HAR は元の表記で返す）
//   3. Set-Cookie を cookie ごとの { name, attributes: { HttpOnly, Secure, SameSite } } にして並べ替える
//      （値と Expires / Max-Age / Domain / Path は捨てる。値は秘密、期限は実行ごとに変わる）
//   4. CSP の nonce- の値を固定の文字列に置き換える
// の順で変換した JSON を返す。出力には cookie の値も nonce の値も残らない。
//
// 何をしないか: 付く応答の種類（画面・API・静的）で絞らない（どの応答かを知るのは呼び出し側）。
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
export const VERSION = "1";

/** 伏せた nonce の置き換え先。 */
export const NONCE_MASK = "nonce-<masked>";

/** 付け手が決まっていない行の語彙（正本は replace-strategy の assets/survey-template.md 7 節）。 */
const UNKNOWN_SETTER = "不明";

/** CSP の nonce を持ちうるヘッダー（小文字）。 */
const CSP_HEADERS = new Set(["content-security-policy", "content-security-policy-report-only"]);

/** RFC 9110 の token（ヘッダー名に使える文字）。 */
const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

/** 一覧を読めないときの例外。CLI は終了コード 3 に写す（入力の誤りの 2 と分ける）。 */
export class NoHeaderListError extends Error {}

/**
 * Markdown の表の 1 行をセルへ分ける（先頭・末尾の `|` を除く）。
 * GFM ではセル内の `|` はコードスパンの中でも `\|` と書くので、エスケープされた `|` では分けない
 * （分けると列がずれ、付け手を別のセルから読む）。
 * @param {string} line
 * @returns {string[]}
 */
function cells(line) {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.replaceAll("\\|", "|").trim());
}

/**
 * セルからヘッダー名を取り出す。強調の囲みを外した後、セルの**先頭**がバッククォートならその中、無ければセル全体。
 * 先頭以外のバッククォート（`Content-Security-Policy（`frame-ancestors` を含む）` の補足）を名前にしない——
 * 補足の語も token として通り、本来のヘッダーが黙って比較から外れる。セル全体が token でなければ呼び出し側が入力の誤りにする。
 * @param {string} cell
 * @returns {string}
 */
function headerNameOf(cell) {
  // 強調（`**…**` / `__…__` / `*…*` / `_…_`）の囲みを外す。token は `*` と `_` を許すので、
  // 外さないと `**x-frame-options**` が名前として通り、黙って比較から外れる。名前の中の `_`（`X_Custom` 等）は残す。
  let name = cell.trim();
  for (let m; (m = /^(\*\*|__|\*|_)(.+)\1$/.exec(name));) name = m[2].trim();
  const quoted = /^`([^`]*)`/.exec(name);
  return (quoted ? quoted[1] : name).trim();
}

/**
 * survey.md から「7. 横断の応答ヘッダー」の一覧を読み、比べるヘッダー名（小文字）の集合を返す。
 * 節が無い・表が無い・行が 0 件なら NoHeaderListError を投げる（一覧の代わりを推測で作らない）。
 * @param {string} markdown
 * @returns {Set<string>}
 */
export function parseHeaderList(markdown) {
  // HTML コメントは最初に全体から外す。節の境界・表の探索・行の読み取り・「未測定」の判定のすべてが
  // 同じコメント抜きの本文を読む（一部だけ外すと、退避した旧一覧やテンプレートの例示表を一覧として読む）。
  const lines = String(markdown)
    .replace(/<!--[\s\S]*?-->/g, "")
    .split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s+7\.\s*横断の応答ヘッダー/.test(l));
  if (start < 0) throw new NoHeaderListError("survey.md に「7. 横断の応答ヘッダー」の節が無い");
  let end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
  if (end < 0) end = lines.length;
  const section = lines.slice(start + 1, end);
  // 節全体が未測定の印（`未測定` か `未測定（理由）` だけの 1 行。書式の正本は replace-strategy の
  // assets/survey-template.md 7 節）があれば、表が残っていても一覧ではない。
  // 本文中の「（404 は未測定）」のような部分的な言及では一覧を捨てない（埋まった表まで比べなくなる）。
  if (section.some((l) => /^未測定(（[^）]*）)?$/.test(l.trim())))
    throw new NoHeaderListError("7 節が「未測定」");

  const headIndex = section.findIndex(
    (l) => l.trim().startsWith("|") && cells(l)[0] === "ヘッダー",
  );
  if (headIndex < 0) throw new NoHeaderListError("7 節に「ヘッダー」列で始まる表が無い");
  const head = cells(section[headIndex]);
  const setterColumn = head.indexOf("付け手");
  if (setterColumn < 0) throw new NoHeaderListError("7 節の表に「付け手」列が無い");

  /** @type {Map<string, boolean>} 名前 → その名前の行がすべて付け手の決まった行か */
  const known = new Map();
  for (const line of section.slice(headIndex + 2)) {
    if (!line.trim().startsWith("|")) break;
    const row = cells(line);
    // テンプレートの例示行（`（例）` 付き）が残っているのは、一覧を書いていない印。例示の値を現行の仕様にしない。
    if ((row[0] ?? "").includes("（例）"))
      throw new NoHeaderListError("7 節の表にテンプレートの例示行（（例））が残っている");
    const name = headerNameOf(row[0] ?? "");
    if (!TOKEN.test(name)) {
      throw new Error(`7 節の表のヘッダー名を読めない: ${JSON.stringify(row[0] ?? "")}`);
    }
    // 強調・コードの記号は語の判定に効かないので外してから読む（`**不明**` を「不明」と読む）。
    const setter = (row[setterColumn] ?? "").replace(/[`*_]/g, "").trim();
    // 付け手が読めない行を「決まっている」にも「不明」にも倒さない。空欄は比べるかどうかを決められず、
    // 「不明（要確認）」「（不明）」「サーバーの設定（不明）」のように「不明」を含む語彙外の書き方は、
    // 比べる（再構築の既定値を仕様として固定する）か比べない（決まった行の後退を見落とす）かの
    // どちらかへ黙って倒れるので、入力の誤りにする。
    if (setter === "" || (setter.includes(UNKNOWN_SETTER) && setter !== UNKNOWN_SETTER)) {
      throw new Error(
        `7 節の表の ${name} の付け手を読めない（語彙は「${UNKNOWN_SETTER}」かそれ以外の付け手）: ${JSON.stringify(setter)}`,
      );
    }
    const key = name.toLowerCase();
    // 同じヘッダーが応答の種類ごとに複数行あり、1 行でも付け手が `不明` なら、そのヘッダーは録画にも比較にも入れない。
    // 出力はヘッダー名で絞るだけで応答の種類を知らないので、比べる側へ倒すと `不明` の行が指す応答の値
    // （再構築の既定値かもしれない）まで現行の仕様として固定する。決まった行の後退は、スイートがその応答の
    // assertion で両側に確かめる（parity-suite の references/api-batch.md「応答ヘッダー」）。
    known.set(key, (known.get(key) ?? true) && setter !== UNKNOWN_SETTER);
  }
  if (known.size === 0) throw new NoHeaderListError("7 節の表に行が無い");
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
 * survey.md のパスから一覧を読む。スイートも CLI もこれを使う（ファイルの読み方を 2 か所に書かない）。
 * survey.md 自体が無いのも「一覧が無い」（NoHeaderListError。測定をやり直す経路へ送る）。
 * 読めない理由が他（権限等）なら、その例外をそのまま投げる（入力の誤り）。
 * @param {string} path
 * @returns {Set<string>}
 */
export function loadHeaderList(path) {
  let markdown;
  try {
    markdown = readFileSync(path, "utf8");
  } catch (err) {
    // survey.md の置き場（.replace/）はあるのにファイルが無いときだけ「一覧が無い」。置き場ごと無いのは
    // パスの誤りか作業ディレクトリの取り違えで、「一覧が無い」にするとヘッダーの比較が黙って外れる。
    if (/** @type {NodeJS.ErrnoException} */ (err).code === "ENOENT" && existsSync(dirname(path)))
      throw new NoHeaderListError(`${path} が無い`);
    throw err;
  }
  return parseHeaderList(markdown);
}

/**
 * 応答ヘッダーを一覧に基づいて正規化する。
 * @param {unknown} headers allHeaders() / headersArray() / HAR の headers
 * @param {Set<string>} list parseHeaderList の戻り値
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
    "usage: node header-normalize.mjs --survey <.replace/survey.md> <headers.json>\n" +
    "       node header-normalize.mjs --survey <.replace/survey.md> --list\n";
  let survey;
  let listOnly = false;
  const positionals = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--survey") {
      survey = argv[i + 1];
      i += 1;
    } else if (argv[i] === "--list") {
      listOnly = true;
    } else {
      positionals.push(argv[i]);
    }
  }
  if (!survey || positionals.length !== (listOnly ? 0 : 1)) {
    io.stderr.write(usage);
    return 2;
  }
  let list;
  try {
    list = loadHeaderList(survey);
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
