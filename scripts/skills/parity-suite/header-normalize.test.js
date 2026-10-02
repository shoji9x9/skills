// 応答ヘッダーの正規化（parity-suite の録画と parity-diff の比較前で共有）の回帰テスト（Issue #531）。

import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir } from "../../lib/test-tmpdir.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const script = join(repoRoot, "skills/parity-suite/scripts/header-normalize.mjs");
const diffScript = join(repoRoot, "skills/parity-diff/scripts/json-normalize-diff.mjs");
const { NONCE_MASK, NoHeaderListError, loadHeaderList, main, normalizeHeaders, parseHeaderList } =
  await import(script);

/** 採った応答（全種類）。行の responses はここに載る種類だけを書ける。 */
const ALL_CAPTURED = [
  { kind: "page", url: "/login" },
  { kind: "login", url: "/login" },
  { kind: "redirect", url: "/orders" },
  { kind: "api-success", url: "/api/orders" },
  { kind: "api-error", url: "/api/orders?page=-1" },
  { kind: "static", url: "/css/site.css" },
  { kind: "not-found", url: "/__none__" },
];
const ALL_KINDS = ALL_CAPTURED.map((c) => c.kind);

/** 一覧の 1 行（replace-strategy の assets/response-headers-template.json と同じキー）。 */
function row(name, overrides = {}) {
  return {
    name,
    class: "defense",
    value: "x",
    responses: ALL_KINDS,
    setter: "server-config",
    setter_source: "web.config",
    owner_slug: null,
    ...overrides,
  };
}

/** 測定済みの一覧（正本のテンプレートと同じトップレベルのキー）。 */
function doc(headers, overrides = {}) {
  return {
    _note: "test",
    schema_version: 1,
    status: "measured",
    captured_at: "2026-10-01T10:00:00+09:00",
    target: "current",
    captured_responses: ALL_CAPTURED,
    notes: "",
    headers,
    server_config_slug: null,
    ...overrides,
  };
}

/** @param {unknown} value */
function list(value) {
  return parseHeaderList(JSON.stringify(value));
}

/** 入力の誤り（Error だが NoHeaderListError ではない）として落ちることを確かめ、メッセージを返す。 */
function inputError(fn) {
  let caught;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(Error);
  expect(caught).not.toBeInstanceOf(NoHeaderListError);
  return /** @type {Error} */ (caught).message;
}

const LIST = list(
  doc([
    row("X-Frame-Options", { value: "DENY" }),
    row("Set-Cookie", {
      value: "HttpOnly; Secure; SameSite=Lax",
      responses: ["login"],
      setter: "app-code",
    }),
    row("Content-Security-Policy", {
      value: "script-src 'nonce-…'",
      responses: ["page"],
      setter: "app-code",
    }),
    row("X-Powered-By", { class: "exposure", value: null }),
  ]),
);

const COOKIE_SECRET = "s3cr3t-session-value";
const COOKIE_SECRET_2 = "another-secret-value";
const NONCE_SECRET = "Zm9vYmFyYmF6cXV4";
const NONCE_SECRET_2 = "other-nonce-value";

// --- 一覧の読み取り ---

test("一覧: 行のヘッダー名を小文字で読む", () => {
  expect([...LIST].sort()).toEqual([
    "content-security-policy",
    "set-cookie",
    "x-frame-options",
    "x-powered-by",
  ]);
});

test("一覧: 付け手が unknown の行だけのヘッダーは比べる対象に入れない", () => {
  const out = list(
    doc([
      row("Strict-Transport-Security", { responses: ["page"], setter: "unknown" }),
      row("X-Frame-Options"),
    ]),
  );
  expect([...out]).toEqual(["x-frame-options"]);
});

test("一覧: 同じヘッダーの行に付け手が unknown の行が混ざれば比べる対象に入れない", () => {
  const out = list(
    doc([
      row("Cache-Control", { responses: ["api-success"], setter: "unknown" }),
      row("Cache-Control", { responses: ["page"], setter: "app-code" }),
      row("X-Frame-Options", { responses: ["page"], setter: "app-code" }),
    ]),
  );
  expect([...out]).toEqual(["x-frame-options"]);
});

test("一覧: 同じヘッダーの行がすべて付け手の決まった行なら比べる対象に入れる（名前の大文字小文字は問わない）", () => {
  const out = list(
    doc([
      row("Cache-Control", { responses: ["api-success"] }),
      row("cache-control", { responses: ["page"], setter: "app-code" }),
    ]),
  );
  expect([...out]).toEqual(["cache-control"]);
});

// 通さねばならない入力（正本のテンプレートが正規と定める書き方）。
test.each([
  ["setter_source を省いた行", [row("X-Frame-Options", { setter_source: undefined })]],
  ["setter_source が null の行", [row("X-Frame-Options", { setter_source: null })]],
  ["静的・404 を含む行の owner_slug", [row("X-Frame-Options", { owner_slug: "orders" })]],
  [
    "静的だけの行の owner_slug",
    [row("X-Frame-Options", { responses: ["static"], owner_slug: "orders" })],
  ],
  ["露出の抑止（value: null）", [row("X-Frame-Options", { class: "exposure", value: null })]],
  ["行の注記キー（_ で始まる）", [{ ...row("X-Frame-Options"), _why: "web.config の 12 行目" }]],
])("一覧: %s は通す", (_name, headers) => {
  expect([...list(doc(headers))]).toEqual(["x-frame-options"]);
});

test.each([["X_Custom_Header"], ["X.Custom"], ["x-frame-options"]])(
  "一覧: 英数字と - _ . だけの名前 %s は通す",
  (name) => {
    expect([...list(doc([row(name)]))]).toEqual([name.toLowerCase()]);
  },
);

test("一覧: server_config_slug が確定していても通す", () => {
  expect([...list(doc([row("X-Frame-Options")], { server_config_slug: "orders" }))]).toEqual([
    "x-frame-options",
  ]);
});

test("一覧: status: measured の空の headers は比べるヘッダーが無い一覧として通す", () => {
  expect([...list(doc([]))]).toEqual([]);
});

test("一覧: 未測定（status: unmeasured と理由だけ）なら NoHeaderListError（推測で一覧を作らない）", () => {
  expect(() =>
    list({ schema_version: 1, status: "unmeasured", unmeasured_reason: "現行へ到達できなかった" }),
  ).toThrow(NoHeaderListError);
});

// 落とす入力（形の誤り）。一覧が無い扱いにも、比べる・比べないのどちらにも黙って倒さない。
test.each([
  ["JSON として読めない", "{"],
  ["配列", "[]"],
  [
    "schema_version が無い",
    JSON.stringify({ ...doc([row("X-Frame-Options")]), schema_version: undefined }),
  ],
  ["schema_version が 2", JSON.stringify(doc([row("X-Frame-Options")], { schema_version: 2 }))],
  ["status が語彙外", JSON.stringify(doc([row("X-Frame-Options")], { status: "partial" }))],
  ["status が無い", JSON.stringify(doc([row("X-Frame-Options")], { status: undefined }))],
  [
    "未測定と行の併存",
    JSON.stringify({
      schema_version: 1,
      status: "unmeasured",
      unmeasured_reason: "x",
      headers: [row("X-Frame-Options")],
    }),
  ],
  [
    "未測定の理由が空",
    JSON.stringify({ schema_version: 1, status: "unmeasured", unmeasured_reason: " " }),
  ],
  ["未測定の理由が無い", JSON.stringify({ schema_version: 1, status: "unmeasured" })],
  ["トップレベルの語彙外のキー", JSON.stringify(doc([row("X-Frame-Options")], { header: [] }))],
  ["captured_at が無い", JSON.stringify(doc([row("X-Frame-Options")], { captured_at: undefined }))],
  ["target が空", JSON.stringify(doc([row("X-Frame-Options")], { target: "" }))],
  ["captured_responses が空", JSON.stringify(doc([], { captured_responses: [] }))],
  [
    "captured_responses の kind が語彙外",
    JSON.stringify(doc([], { captured_responses: [{ kind: "画面", url: "/" }] })),
  ],
  [
    "captured_responses の url が無い",
    JSON.stringify(doc([], { captured_responses: [{ kind: "page" }] })),
  ],
  ["headers が無い", JSON.stringify(doc(undefined))],
  ["headers がオブジェクト", JSON.stringify(doc({}))],
  [
    "server_config_slug が無い",
    JSON.stringify(doc([row("X-Frame-Options")], { server_config_slug: undefined })),
  ],
  [
    "server_config_slug が空文字",
    JSON.stringify(doc([row("X-Frame-Options")], { server_config_slug: "" })),
  ],
  ["notes が文字列でない", JSON.stringify(doc([row("X-Frame-Options")], { notes: null }))],
])("一覧: %s は入力の誤りにする", (_name, text) => {
  inputError(() => parseHeaderList(text));
});

test.each([
  ["行がオブジェクトでない", "X-Frame-Options"],
  ["名前が無い", row(undefined)],
  ["名前が token でない", row("X Frame Options")],
  ["名前を強調記号で囲んだ", row("**X-Frame-Options**")],
  ["名前をバッククォートで囲んだ", row("`X-Frame-Options`")],
  ["名前に補足を付けた", row("Content-Security-Policy（frame-ancestors を含む）")],
  ["テンプレートのプレースホルダの名前", row("<ヘッダー名（例: X-Content-Type-Options）>")],
  ["class が語彙外", row("X-Frame-Options", { class: "防御" })],
  ["defense の value が null", row("X-Frame-Options", { value: null })],
  ["defense の value が空", row("X-Frame-Options", { value: "" })],
  ["exposure の value が文字列", row("X-Powered-By", { class: "exposure", value: "（付かない）" })],
  ["value のキーが無い", { ...row("X-Frame-Options"), value: undefined }],
  ["responses が空", row("X-Frame-Options", { responses: [] })],
  ["responses が文字列", row("X-Frame-Options", { responses: "全種類" })],
  ["responses の種類が語彙外", row("X-Frame-Options", { responses: ["全種類"] })],
  ["responses の種類が重複", row("X-Frame-Options", { responses: ["page", "page"] })],
  ["付け手が無い", row("X-Frame-Options", { setter: undefined })],
  ["付け手が空", row("X-Frame-Options", { setter: "" })],
  ["付け手が語彙外の「不明」", row("X-Frame-Options", { setter: "不明" })],
  ["付け手が語彙外の「unknown?」", row("X-Frame-Options", { setter: "unknown?" })],
  ["setter_source が空文字", row("X-Frame-Options", { setter_source: "" })],
  ["owner_slug のキーが無い", { ...row("X-Frame-Options"), owner_slug: undefined }],
  ["owner_slug が空文字", row("X-Frame-Options", { owner_slug: "" })],
  [
    "機能の応答だけの行の owner_slug",
    row("X-Frame-Options", { responses: ["page"], owner_slug: "orders" }),
  ],
  ["行の語彙外のキー（打ち間違い）", { ...row("X-Frame-Options"), setter_sorce: "web.config" }],
])("一覧: 行が「%s」なら入力の誤りにする", (_name, bad) => {
  inputError(() => list(doc([row("X-Content-Type-Options"), bad])));
});

test("一覧: 採っていない種類の応答に付くとは書けない（測っていない値を仕様にしない）", () => {
  const message = inputError(() =>
    list(
      doc([row("X-Frame-Options", { responses: ["static"] })], {
        captured_responses: [{ kind: "page", url: "/login" }],
      }),
    ),
  );
  expect(message).toContain("static");
});

test("一覧: 同じヘッダーの行どうしで付く応答が重なれば入力の誤りにする（どちらの値か読めない）", () => {
  inputError(() =>
    list(
      doc([
        row("Cache-Control", { responses: ["page", "api-success"] }),
        row("cache-control", { responses: ["api-success"], setter: "unknown" }),
      ]),
    ),
  );
});

test("一覧: 同梱テンプレートはそのままでは入力の誤りにする（プレースホルダを一覧として読まない）", () => {
  const template = readFileSync(
    join(repoRoot, "skills/replace-strategy/assets/response-headers-template.json"),
    "utf8",
  );
  inputError(() => parseHeaderList(template));
});

// 形の検査では落ちない自由記述の欄に、同梱テンプレートのプレースホルダを 1 つだけ残した一覧。
test.each([
  ["captured_at", (t) => (t.captured_at = TEMPLATE.captured_at)],
  ["target", (t) => (t.target = TEMPLATE.target)],
  [
    "captured_responses[].url",
    (t) => (t.captured_responses[0].url = TEMPLATE.captured_responses[0].url),
  ],
  ["notes", (t) => (t.notes = TEMPLATE.notes)],
  ["headers[].value", (t) => (t.headers[0].value = TEMPLATE.headers[0].value)],
  [
    "headers[].setter_source",
    (t) => (t.headers[0].setter_source = TEMPLATE.headers[0].setter_source),
  ],
])("一覧: テンプレートのプレースホルダを %s に残したら入力の誤りにする", (field, edit) => {
  const t = filledTemplate();
  edit(t);
  const message = inputError(() => parseHeaderList(JSON.stringify(t)));
  expect(message).toContain("プレースホルダ");
  expect(message).toContain(field.replaceAll("[]", "[0]"));
});

test("一覧: <…> を含むだけの値（注記キーの中も）はプレースホルダにしない", () => {
  const t = filledTemplate();
  t.headers[0].value = "default-src 'self' <x>; script-src 'self'";
  t._extra = "<注記>";
  expect([...parseHeaderList(JSON.stringify(t))]).toEqual(["x-content-type-options"]);
});

test("一覧: 同梱テンプレートのキーを埋めた一覧は読める（正本の形から作る）", () => {
  expect([...parseHeaderList(JSON.stringify(filledTemplate()))]).toEqual([
    "x-content-type-options",
  ]);
});

test("一覧: 同梱テンプレートの未測定の形（注記が説明する 3 キー）は一覧が無い扱いにする", () => {
  expect(() =>
    list({ schema_version: 1, status: "unmeasured", unmeasured_reason: "現行へ到達できなかった" }),
  ).toThrow(NoHeaderListError);
  // 注記が「3 キーだけにする」と書いていることを固定する（注記と検査が食い違うと、書き手が従っても落ちる）。
  const template = JSON.parse(
    readFileSync(
      join(repoRoot, "skills/replace-strategy/assets/response-headers-template.json"),
      "utf8",
    ),
  );
  expect(template._note).toContain('"status": "unmeasured", "unmeasured_reason"');
});

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

function writeInputs(listDoc, headers) {
  const dir = makeTempDir("header-normalize-cli-");
  const listPath = join(dir, "response-headers.json");
  const headersPath = join(dir, "headers.json");
  writeFileSync(listPath, typeof listDoc === "string" ? listDoc : JSON.stringify(listDoc));
  writeFileSync(headersPath, typeof headers === "string" ? headers : JSON.stringify(headers));
  return { listPath, headersPath };
}

/** 同梱テンプレートそのもの（プレースホルダの値の出所）。 */
const TEMPLATE = JSON.parse(
  readFileSync(
    join(repoRoot, "skills/replace-strategy/assets/response-headers-template.json"),
    "utf8",
  ),
);

/** 同梱テンプレートのプレースホルダを埋めたもの（正本の形から作る。キーは足さず値だけを書き換える）。 */
function filledTemplate() {
  const t = JSON.parse(
    readFileSync(
      join(repoRoot, "skills/replace-strategy/assets/response-headers-template.json"),
      "utf8",
    ),
  );
  t.status = "measured";
  t.captured_at = "2026-10-01T10:00:00+09:00";
  t.target = "current";
  t.captured_responses = [
    { kind: "page", url: "/login" },
    { kind: "static", url: "/css/site.css" },
  ];
  t.notes = "";
  t.headers = [
    {
      ...t.headers[0],
      name: "X-Content-Type-Options",
      class: "defense",
      value: "nosniff",
      responses: ["page", "static"],
      setter: "server-config",
      setter_source: "web.config",
      owner_slug: "orders",
    },
  ];
  return t;
}

test("CLI: 正規化した JSON を出して exit 0（node で起動しても main が走る）", () => {
  const { listPath, headersPath } = writeInputs(filledTemplate(), {
    "X-Content-Type-Options": "nosniff",
    Date: "now",
  });
  const r = spawnSync(process.execPath, [script, "--header-list", listPath, headersPath], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  expect(r.status).toBe(0);
  expect(JSON.parse(r.stdout)).toEqual({ "x-content-type-options": "nosniff" });
});

test("CLI: 一覧が未測定なら exit 3（入力の誤りの 2 と分ける）", () => {
  const { listPath, headersPath } = writeInputs(
    { schema_version: 1, status: "unmeasured", unmeasured_reason: "到達できない" },
    {},
  );
  const { chunks, io } = capture();
  expect(main(["--header-list", listPath, headersPath], io)).toBe(3);
  expect(chunks.stderr).toMatch(/^no-list: /);
  expect(chunks.stdout).toBe("");
});

test("CLI: 一覧の形の誤りは exit 2", () => {
  const { listPath, headersPath } = writeInputs(
    doc([row("X-Frame-Options", { setter: "不明" })]),
    {},
  );
  const { chunks, io } = capture();
  expect(main(["--header-list", listPath, headersPath], io)).toBe(2);
  expect(chunks.stderr).toMatch(/^error: /);
});

test("CLI: --list は比べるヘッダー名を名前順の配列で出す（録画時の一覧の記録用）", () => {
  const { listPath } = writeInputs(
    doc([
      row("X-Frame-Options"),
      row("Content-Security-Policy", { responses: ["page"], setter: "app-code" }),
      row("Strict-Transport-Security", { responses: ["page"], setter: "unknown" }),
    ]),
    {},
  );
  const { chunks, io } = capture();
  expect(main(["--header-list", listPath, "--list"], io)).toBe(0);
  expect(JSON.parse(chunks.stdout)).toEqual(["content-security-policy", "x-frame-options"]);
});

test("一覧: loadHeaderList は一覧のファイルが無ければ NoHeaderListError、あれば一覧を返す", () => {
  const { listPath } = writeInputs(doc([row("X-Frame-Options")]), {});
  expect(() => loadHeaderList(join(dirname(listPath), "missing.json"))).toThrow(NoHeaderListError);
  expect([...loadHeaderList(listPath)]).toEqual(["x-frame-options"]);
});

test("一覧: 一覧の置き場ごと無いパスは「一覧が無い」にせず入力の誤りにする", () => {
  const { listPath } = writeInputs(doc([row("X-Frame-Options")]), {});
  inputError(() => loadHeaderList(join(dirname(listPath), "no-such-dir", "response-headers.json")));
});

test("一覧: 表で書いた survey.md を渡しても一覧として読まない（Markdown を解析しない）", () => {
  const dir = makeTempDir("header-normalize-md-");
  const surveyPath = join(dir, "survey.md");
  writeFileSync(
    surveyPath,
    [
      "## 7. 横断の応答ヘッダー",
      "",
      "| ヘッダー | 分類 | 値 | 付く応答 | 付け手 | 所有者 slug |",
      "|---|---|---|---|---|---|",
      "| `X-Frame-Options` | 防御 | `DENY` | 全種類 | サーバーの設定 | |",
      "",
    ].join("\n"),
  );
  inputError(() => loadHeaderList(surveyPath));
});

test("CLI: 一覧のファイル自体が無ければ exit 3（一覧が無い）で、表の survey.md からの移行を案内する", () => {
  const { headersPath } = writeInputs(doc([]), {});
  const { chunks, io } = capture();
  expect(main(["--header-list", join(dirname(headersPath), "missing.json"), headersPath], io)).toBe(
    3,
  );
  expect(chunks.stderr).toMatch(/^no-list: /);
  expect(chunks.stderr).toContain("response-headers.json へ採り直す");
});

test("CLI: 旧版の --survey は受け付けない（exit 2）", () => {
  const { listPath, headersPath } = writeInputs(doc([row("X-Frame-Options")]), {});
  const { io } = capture();
  expect(main(["--survey", listPath, headersPath], io)).toBe(2);
});

test("CLI: 読めない headers.json は exit 2 で、入力の中身を stderr に出さない", () => {
  const { listPath, headersPath } = writeInputs(
    doc([row("Set-Cookie", { responses: ["login"], setter: "app-code" })]),
    `{"set-cookie": "sid=${COOKIE_SECRET}"`,
  );
  const { chunks, io } = capture();
  expect(main(["--header-list", listPath, headersPath], io)).toBe(2);
  expect(chunks.stderr).not.toContain(COOKIE_SECRET);
});

test("CLI: 文字列でない値は exit 2 で、値を stderr に出さない", () => {
  const { listPath, headersPath } = writeInputs(
    doc([row("Set-Cookie", { responses: ["login"], setter: "app-code" })]),
    [{ name: "Set-Cookie", value: { raw: COOKIE_SECRET } }],
  );
  const { chunks, io } = capture();
  expect(main(["--header-list", listPath, headersPath], io)).toBe(2);
  expect(chunks.stderr).not.toContain(COOKIE_SECRET);
});

test("CLI: 引数が足りなければ exit 2", () => {
  const { io } = capture();
  expect(main([], io)).toBe(2);
});
