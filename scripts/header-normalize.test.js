// 応答ヘッダーの正規化（parity-suite の録画と parity-diff の比較前で共有）の回帰テスト（Issue #531）。

import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir } from "./lib/test-tmpdir.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repoRoot, "skills/parity-suite/scripts/header-normalize.mjs");
const diffScript = join(repoRoot, "skills/parity-diff/scripts/json-normalize-diff.mjs");
const { NONCE_MASK, NoHeaderListError, main, normalizeHeaders, parseHeaderList } = await import(
  script
);

/** survey.md の 7 節（replace-strategy の assets/survey-template.md と同じ列）。 */
function survey(rows) {
  return [
    "## 6. 前の節",
    "",
    "## 7. 横断の応答ヘッダー",
    "",
    "- 採った応答: 画面 /login",
    "",
    "| ヘッダー | 分類 | 値 | 付く応答 | 付け手 | 所有者 slug（機能に属さない応答のとき） |",
    "|---|---|---|---|---|---|",
    ...rows,
    "",
    "## 未測定の項目",
    "",
    "| ヘッダー | 付け手 |",
    "|---|---|",
    "| `X-Not-In-Section-7` | サーバーの設定 |",
    "",
  ].join("\n");
}

const LIST = parseHeaderList(
  survey([
    "| `X-Frame-Options` | 防御 | `DENY` | 全種類 | サーバーの設定（`web.config`） | |",
    "| `Set-Cookie` | 防御 | `HttpOnly; Secure; SameSite=Lax` | ログインの成功 | アプリのコード | |",
    "| `Content-Security-Policy` | 防御 | `script-src 'nonce-…'` | 画面 | アプリのコード | |",
    "| `X-Powered-By` | 露出の抑止 | （付かない） | 全種類 | サーバーの設定で除去 | |",
  ]),
);

const COOKIE_SECRET = "s3cr3t-session-value";
const COOKIE_SECRET_2 = "another-secret-value";
const NONCE_SECRET = "Zm9vYmFyYmF6cXV4";
const NONCE_SECRET_2 = "other-nonce-value";

// --- 一覧の読み取り ---

test("一覧: 7 節の表のヘッダー名を小文字で読み、他の節の表は読まない", () => {
  expect([...LIST].sort()).toEqual([
    "content-security-policy",
    "set-cookie",
    "x-frame-options",
    "x-powered-by",
  ]);
});

test("一覧: 付け手が `不明` の行だけのヘッダーは比べる対象に入れない", () => {
  const list = parseHeaderList(
    survey([
      "| `Strict-Transport-Security` | 防御 | `max-age=1` | 画面 | 不明 | |",
      "| `X-Frame-Options` | 防御 | `DENY` | 全種類 | サーバーの設定 | |",
    ]),
  );
  expect([...list]).toEqual(["x-frame-options"]);
});

test("一覧: 同じヘッダーの行のどれかで付け手が決まっていれば比べる対象に入れる", () => {
  const list = parseHeaderList(
    survey([
      "| `Cache-Control` | 防御 | `no-store` | 静的 | 不明 | |",
      "| `Cache-Control` | 防御 | `no-store` | 画面 | アプリのコード | |",
    ]),
  );
  expect([...list]).toEqual(["cache-control"]);
});

test.each([
  ["7 節が無い", "## 6. 前の節\n\nなし\n"],
  ["7 節に表が無い（未測定）", "## 7. 横断の応答ヘッダー\n\n未測定\n\n## 未測定の項目\n"],
  ["表に行が無い", survey([])],
])("一覧: %s なら NoHeaderListError（推測で一覧を作らない）", (_name, markdown) => {
  expect(() => parseHeaderList(markdown)).toThrow(NoHeaderListError);
});

test("一覧: ヘッダー名として読めないセルは入力の誤りにする（一覧が無い扱いにしない）", () => {
  let caught;
  try {
    parseHeaderList(survey(["| ヘッダー名 未記入 | 防御 | x | 全種類 | サーバーの設定 | |"]));
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(Error);
  expect(caught).not.toBeInstanceOf(NoHeaderListError);
});

test("一覧: セル内のエスケープされた `\\|` では列を分けず、付け手を正しい列から読む", () => {
  const list = parseHeaderList(
    survey([
      "| `Strict-Transport-Security` | 防御 | `a \\| b` | 画面 | 不明 | |",
      "| `X-Frame-Options` | 防御 | `x \\| y` | 全種類 | サーバーの設定 | |",
    ]),
  );
  expect([...list]).toEqual(["x-frame-options"]);
});

test.each([
  ["空欄", "| `X-Frame-Options` | 防御 | `DENY` | 全種類 |  | |"],
  [
    "語彙外の「不明（要確認）」",
    "| `X-Frame-Options` | 防御 | `DENY` | 全種類 | 不明（要確認） | |",
  ],
])(
  "一覧: 付け手が %s の行は入力の誤りにする（比べる・比べないのどちらにも黙って倒さない）",
  (_name, row) => {
    let caught;
    try {
      parseHeaderList(survey([row]));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(NoHeaderListError);
  },
);

// --- 規則 1: 一覧に載るヘッダーだけに絞る ---

test("絞り込み: 一覧に載るヘッダーは残す", () => {
  expect(normalizeHeaders({ "x-frame-options": "DENY" }, LIST)).toEqual({
    "x-frame-options": "DENY",
  });
});

test("絞り込み: 一覧に載らないヘッダー（揮発・秘密の値）は落とす", () => {
  const out = normalizeHeaders(
    {
      date: "Wed, 30 Sep 2026 10:00:00 GMT",
      "x-csrf-token": "csrf-secret",
      "x-frame-options": "DENY",
    },
    LIST,
  );
  expect(out).toEqual({ "x-frame-options": "DENY" });
  expect(JSON.stringify(out)).not.toContain("csrf-secret");
});

test("絞り込み: 付いていない一覧のヘッダーは出力に作らない（無いことは無いまま比べる）", () => {
  expect(normalizeHeaders({ "x-frame-options": "DENY" }, LIST)).not.toHaveProperty("x-powered-by");
  expect(normalizeHeaders({ "X-Powered-By": "ASP.NET" }, LIST)).toEqual({
    "x-powered-by": "ASP.NET",
  });
});

// --- 規則 2: ヘッダー名を小文字に揃える ---

test("小文字化: headersArray() / HAR の元の表記の名前を小文字に揃える", () => {
  expect(normalizeHeaders([{ name: "X-Frame-Options", value: "DENY" }], LIST)).toEqual({
    "x-frame-options": "DENY",
  });
});

test("小文字化: 値の大文字小文字は変えない", () => {
  expect(normalizeHeaders({ "X-FRAME-OPTIONS": "SameOrigin" }, LIST)).toEqual({
    "x-frame-options": "SameOrigin",
  });
});

test("小文字化: allHeaders() と headersArray() の同じ応答は同じ出力になる", () => {
  const all = {
    "x-frame-options": "DENY",
    "set-cookie": `sid=${COOKIE_SECRET}; Path=/; HttpOnly\nlang=ja; SameSite=Lax`,
  };
  const arr = [
    { name: "X-Frame-Options", value: "DENY" },
    { name: "Set-Cookie", value: `sid=${COOKIE_SECRET}; Path=/; HttpOnly` },
    { name: "Set-Cookie", value: "lang=ja; SameSite=Lax" },
  ];
  expect(normalizeHeaders(arr, LIST)).toEqual(normalizeHeaders(all, LIST));
});

// --- 規則 3: Set-Cookie を名前と属性へ変換し並べ替える ---

test("Set-Cookie: cookie ごとの名前と属性（HttpOnly・Secure の有無と SameSite の値）にする", () => {
  const out = normalizeHeaders(
    [
      {
        name: "Set-Cookie",
        value: `sid=${COOKIE_SECRET}; Expires=Thu, 01 Oct 2026 00:00:00 GMT; Max-Age=3600; Domain=example.test; Path=/; Secure; HttpOnly; SameSite=lax`,
      },
    ],
    LIST,
  );
  expect(out).toEqual({
    "set-cookie": [{ name: "sid", attributes: { HttpOnly: true, Secure: true, SameSite: "Lax" } }],
  });
});

test("Set-Cookie: 属性が無ければ HttpOnly・Secure は false、SameSite は null にする", () => {
  expect(normalizeHeaders({ "set-cookie": `sid=${COOKIE_SECRET}` }, LIST)).toEqual({
    "set-cookie": [{ name: "sid", attributes: { HttpOnly: false, Secure: false, SameSite: null } }],
  });
});

test("Set-Cookie: SameSite は値ごと比べる（Lax と None を同じにしない）", () => {
  const lax = normalizeHeaders({ "set-cookie": "sid=a; SameSite=Lax" }, LIST);
  const none = normalizeHeaders({ "set-cookie": "sid=a; SameSite=None" }, LIST);
  expect(lax).not.toEqual(none);
});

test("Set-Cookie: 名前の無い cookie（`=` が無い行）は値を名前にしない", () => {
  const out = normalizeHeaders({ "set-cookie": `${COOKIE_SECRET}; HttpOnly` }, LIST);
  expect(out).toEqual({
    "set-cookie": [{ name: "", attributes: { HttpOnly: true, Secure: false, SameSite: null } }],
  });
});

test("Set-Cookie: cookie 名で並べ替え、受け取った順に依らない", () => {
  const a = normalizeHeaders({ "set-cookie": "zeta=1\nalpha=2; Secure" }, LIST);
  const b = normalizeHeaders({ "set-cookie": "alpha=3; Secure\nzeta=4" }, LIST);
  expect(a["set-cookie"].map((c) => c.name)).toEqual(["alpha", "zeta"]);
  expect(a).toEqual(b);
});

test("Set-Cookie: 属性の違いは並べ替えで消さない（同じ名前の cookie が 2 つでも両方残る）", () => {
  const out = normalizeHeaders({ "set-cookie": "sid=1; Secure\nsid=2" }, LIST);
  expect(out["set-cookie"]).toHaveLength(2);
});

test("Set-Cookie: 中身の無い Set-Cookie だけなら付いていないのと同じにする", () => {
  expect(normalizeHeaders({ "set-cookie": "" }, LIST)).toEqual({});
});

test("Set-Cookie: 一覧に載らなければ cookie の値ごと落とす", () => {
  const out = normalizeHeaders(
    { "set-cookie": `sid=${COOKIE_SECRET}` },
    new Set(["x-frame-options"]),
  );
  expect(out).toEqual({});
});

// --- 規則 4: CSP の nonce- の値を伏せる ---

test("nonce: CSP の nonce- の値を固定の文字列に置き換える", () => {
  const out = normalizeHeaders(
    {
      "content-security-policy": `default-src 'self'; script-src 'nonce-${NONCE_SECRET}' 'strict-dynamic'`,
    },
    LIST,
  );
  expect(out["content-security-policy"]).toBe(
    `default-src 'self'; script-src '${NONCE_MASK}' 'strict-dynamic'`,
  );
});

test("nonce: 要求ごとに違う nonce でも同じ出力になる", () => {
  const a = normalizeHeaders({ "content-security-policy": "script-src 'nonce-AAAA'" }, LIST);
  const b = normalizeHeaders({ "content-security-policy": "script-src 'nonce-BBBB'" }, LIST);
  expect(a).toEqual(b);
});

test("nonce: nonce を持たない CSP はそのまま残す（伏せる対象を広げない）", () => {
  const csp = "default-src 'self'; frame-ancestors 'none'";
  expect(normalizeHeaders({ "content-security-policy": csp }, LIST)).toEqual({
    "content-security-policy": csp,
  });
});

test("nonce: CSP の中身の違い（nonce 以外）は伏せずに差として残す", () => {
  const a = normalizeHeaders({ "content-security-policy": "script-src 'nonce-AAAA'" }, LIST);
  const b = normalizeHeaders(
    { "content-security-policy": "script-src 'nonce-AAAA' 'unsafe-inline'" },
    LIST,
  );
  expect(a).not.toEqual(b);
});

test.each([
  ["Report-Only", "content-security-policy-report-only", "script-src 'nonce-AAAA'"],
  ["大文字の NONCE-", "content-security-policy", "script-src 'NONCE-AAAA'"],
  ["パディング付き", "content-security-policy", "script-src 'nonce-QUFBQQ=='"],
])("nonce: %s でも値を伏せる", (_name, header, value) => {
  const list = new Set([header]);
  const out = JSON.stringify(normalizeHeaders({ [header]: value }, list));
  expect(out).toContain(NONCE_MASK);
  expect(out).not.toMatch(/AAAA|QUFBQQ/);
});

test("nonce: 複数行の CSP を結合しても各行の nonce を伏せる", () => {
  const out = normalizeHeaders(
    [
      { name: "Content-Security-Policy", value: `script-src 'nonce-${NONCE_SECRET}'` },
      { name: "Content-Security-Policy", value: "style-src 'nonce-OTHERNONCE'" },
    ],
    LIST,
  );
  expect(out["content-security-policy"]).toBe(
    `script-src '${NONCE_MASK}', style-src '${NONCE_MASK}'`,
  );
});

// --- 秘密の値が出力にも差分の出力にも出ない ---

function rawResponse(cookieValue, nonce, sameSite) {
  return [
    { name: "Content-Security-Policy", value: `script-src 'nonce-${nonce}'` },
    { name: "Set-Cookie", value: `sid=${cookieValue}; HttpOnly; Secure; SameSite=${sameSite}` },
    { name: "X-Frame-Options", value: "DENY" },
  ];
}

function runDiff(current, next) {
  const dir = makeTempDir("header-normalize-diff-");
  const a = join(dir, "current.json");
  const b = join(dir, "new.json");
  writeFileSync(a, JSON.stringify(current));
  writeFileSync(b, JSON.stringify(next));
  const r = spawnSync(process.execPath, [diffScript, a, b], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { status: r.status, stdout: r.stdout };
}

test("秘密の値: 正規化の出力に cookie の値も nonce の値も現れない", () => {
  const out = JSON.stringify(
    normalizeHeaders(rawResponse(COOKIE_SECRET, NONCE_SECRET, "Lax"), LIST),
  );
  expect(out).not.toContain(COOKIE_SECRET);
  expect(out).not.toContain(NONCE_SECRET);
});

test("秘密の値: 陽性コントロール——正規化しないと差分の出力に cookie の値と nonce の値が出る", () => {
  const { status, stdout } = runDiff(
    rawResponse(COOKIE_SECRET, NONCE_SECRET, "Lax"),
    rawResponse(COOKIE_SECRET_2, NONCE_SECRET_2, "Lax"),
  );
  expect(status).toBe(1);
  expect(stdout).toContain(COOKIE_SECRET);
  expect(stdout).toContain(NONCE_SECRET);
});

test("秘密の値: 正規化した両側の差分は、属性の差を出しつつ cookie の値も nonce の値も出さない", () => {
  const { status, stdout } = runDiff(
    normalizeHeaders(rawResponse(COOKIE_SECRET, NONCE_SECRET, "Lax"), LIST),
    normalizeHeaders(rawResponse(COOKIE_SECRET_2, NONCE_SECRET_2, "None"), LIST),
  );
  expect(status).toBe(1);
  expect(stdout).toContain("SameSite");
  expect(stdout).not.toContain(COOKIE_SECRET);
  expect(stdout).not.toContain(COOKIE_SECRET_2);
  expect(stdout).not.toContain(NONCE_SECRET);
});

test("秘密の値: 値と nonce だけが違う両側は差分なしになる", () => {
  const { status } = runDiff(
    normalizeHeaders(rawResponse(COOKIE_SECRET, NONCE_SECRET, "Lax"), LIST),
    normalizeHeaders(rawResponse(COOKIE_SECRET_2, NONCE_SECRET_2, "Lax"), LIST),
  );
  expect(status).toBe(0);
});

// --- CLI ---

function capture() {
  const chunks = { stdout: "", stderr: "" };
  return {
    chunks,
    io: {
      stdout: { write: (s) => (chunks.stdout += s) },
      stderr: { write: (s) => (chunks.stderr += s) },
    },
  };
}

function writeInputs(markdown, headers) {
  const dir = makeTempDir("header-normalize-cli-");
  const surveyPath = join(dir, "survey.md");
  const headersPath = join(dir, "headers.json");
  writeFileSync(surveyPath, markdown);
  writeFileSync(headersPath, typeof headers === "string" ? headers : JSON.stringify(headers));
  return { surveyPath, headersPath };
}

test("CLI: 正規化した JSON を出して exit 0（node で起動しても main が走る）", () => {
  const { surveyPath, headersPath } = writeInputs(
    readFileSync(join(repoRoot, "skills/replace-strategy/assets/survey-template.md"), "utf8"),
    { "X-Content-Type-Options": "nosniff", Date: "now" },
  );
  const r = spawnSync(process.execPath, [script, "--survey", surveyPath, headersPath], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  expect(r.status).toBe(0);
  expect(JSON.parse(r.stdout)).toEqual({ "x-content-type-options": "nosniff" });
});

test("CLI: 一覧が無ければ exit 3（入力の誤りの 2 と分ける）", () => {
  const { surveyPath, headersPath } = writeInputs("## 1. 概要\n", {});
  const { chunks, io } = capture();
  expect(main(["--survey", surveyPath, headersPath], io)).toBe(3);
  expect(chunks.stderr).toMatch(/^no-list: /);
  expect(chunks.stdout).toBe("");
});

test("CLI: 読めない headers.json は exit 2 で、入力の中身を stderr に出さない", () => {
  const { surveyPath, headersPath } = writeInputs(
    survey(["| `Set-Cookie` | 防御 | x | 画面 | アプリのコード | |"]),
    `{"set-cookie": "sid=${COOKIE_SECRET}"`,
  );
  const { chunks, io } = capture();
  expect(main(["--survey", surveyPath, headersPath], io)).toBe(2);
  expect(chunks.stderr).not.toContain(COOKIE_SECRET);
});

test("CLI: 文字列でない値は exit 2 で、値を stderr に出さない", () => {
  const { surveyPath, headersPath } = writeInputs(
    survey(["| `Set-Cookie` | 防御 | x | 画面 | アプリのコード | |"]),
    [{ name: "Set-Cookie", value: { raw: COOKIE_SECRET } }],
  );
  const { chunks, io } = capture();
  expect(main(["--survey", surveyPath, headersPath], io)).toBe(2);
  expect(chunks.stderr).not.toContain(COOKIE_SECRET);
});

test("CLI: 引数が足りなければ exit 2", () => {
  const { io } = capture();
  expect(main([], io)).toBe(2);
});
