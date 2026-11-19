// browser-test の feature-check.mjs（機能マップの機能を実ブラウザで操作して結果を返す CLI）のテスト。
//
// 前半は、引数・機能の選び方・URL の組み立て・check を実行するかの判定・終了コードを、関数で確かめる。
// 後半は、手元の HTTP サーバーが返すページを、CLI の子プロセスに実際の Chrome（headless）で操作させる。
// Chrome は CI の ubuntu-latest のランナーにあるものを使う。見つからなければ、確かめられないので失敗にする。
//
// | 軸 | 値 |
// | --- | --- |
// | check の steps | 無い / 読むだけ / side_effect: false の操作 / side_effect が無い操作 / side_effect: true の操作 |
// | step の結果 | 通る / 要素が現れない / 文字が現れない |
// | console | 無い / error / warning |
// | ページ | 開ける / 開けない |
// | ブラウザ | 起動する / 起動中の Chrome につなぐ / 実行ファイルが無い / つなげない |
// | 設定 | 機能が 1 件 / 0 件 / 2 件、環境が無い、url_command の環境 |
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  exitCodeOf,
  featureUrl,
  findChrome,
  parseArgs,
  planCheck,
  selectFeature,
} from "../../../skills/browser-test/scripts/feature-check.mjs";
import { parseJsonAs } from "../../lib/parse-as.ts";
import { spawnAsync } from "../../lib/spawn-async.ts";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";

const repoRoot = join(import.meta.dirname, "..", "..", "..");
const CLI = join(repoRoot, "skills", "browser-test", "scripts", "feature-check.mjs");

describe("引数", () => {
  test("--feature と --env を読み、--timeout-ms のデフォルトは 10000", () => {
    expect(parseArgs(["--feature", "検索", "--env", "local"])).toMatchObject({
      feature: "検索",
      env: "local",
      timeoutMs: 10000,
    });
  });

  test.each([
    ["--feature が無い", ["--env", "local"], "--feature が無い"],
    ["--env が無い", ["--feature", "a"], "--env が無い"],
    ["値が無い", ["--feature"], "--feature に値が無い"],
    ["値の位置に別のオプション", ["--feature", "--env", "x"], "--feature に値が無い"],
    ["同じオプションが 2 回", ["--feature", "a", "--feature", "b", "--env", "x"], "2 回ある"],
    [
      "知らないオプション",
      ["--feature", "a", "--env", "x", "--ignore-forbidden-actions"],
      "知らない引数",
    ],
    ["--timeout-ms が 0", ["--feature", "a", "--env", "x", "--timeout-ms", "0"], "正の整数"],
    ["--timeout-ms が数でない", ["--feature", "a", "--env", "x", "--timeout-ms", "1s"], "正の整数"],
  ])("%s ときは誤りにする", (_case, argv, message) => {
    expect(() => parseArgs(argv)).toThrow(message);
  });
});

describe("機能の選び方と URL", () => {
  const f = (name: string) => ({ name, path: "/", checks: [{ action: "a", expect: "b" }] });

  test("呼び名が完全に一致する 1 件を選ぶ（前方一致では選ばない）", () => {
    expect(selectFeature([f("検索"), f("検索の候補")], "検索").name).toBe("検索");
  });

  test.each([
    {
      case: "一致する機能が無い",
      features: [f("検索")],
      name: "設定",
      message: "機能マップに無い",
    },
    {
      case: "一致する機能が 2 件ある",
      features: [f("検索"), f("検索")],
      name: "検索",
      message: "2 件ある",
    },
  ])("$case ときは推測で選ばずに誤りにする", ({ features, name, message }) => {
    expect(() => selectFeature(features, name)).toThrow(message);
  });

  test.each([
    ["http://localhost:5173", "/settings", "http://localhost:5173/settings"],
    ["http://localhost:5173/", "/settings", "http://localhost:5173/settings"],
    ["https://dev.example.com/app", "/a?x=1", "https://dev.example.com/app/a?x=1"],
    // path を環境の url の後ろにつなぐので、ホストに見える path でも環境のホストのまま開く
    ["http://localhost:5173", "/@evil.example", "http://localhost:5173/@evil.example"],
    ["http://localhost:5173", "//evil.example/x", "http://localhost:5173//evil.example/x"],
    // 環境の url のクエリとフラグメントは外す（残すと path がその一部になる）
    ["https://h.example/app/?a=1", "/p", "https://h.example/app/p"],
    ["https://h.example/app#top", "/p?q=1", "https://h.example/app/p?q=1"],
  ])("%s と %s から %s を開く（path は環境の url からの相対）", (base, path, url) => {
    expect(featureUrl(base, path)).toBe(url);
  });

  test.each([
    { case: "環境の URL を読めない", base: "not a url", path: "/", message: "読めない" },
    {
      case: "環境の URL が http でも https でもない",
      base: "file:///tmp",
      path: "/",
      message: "http か https",
    },
    {
      case: "path が / で始まらない",
      base: "http://localhost:5173",
      path: "settings",
      message: "/ で始める",
    },
  ])("$case ときは誤りにする", ({ base, path, message }) => {
    expect(() => featureUrl(base, path)).toThrow(message);
  });

  test("環境の URL を読めないときの誤りに、その URL を書かない（url_command で解決した URL でありうる）", () => {
    expect(() => featureUrl("ftp://secret.example/token", "/")).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining("secret") }),
    );
    expect(() => featureUrl("secret-token", "/")).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining("secret") }),
    );
  });
});

describe("check を CLI で実行するか", () => {
  const check = (steps?: Record<string, unknown>[]) => ({
    action: "a",
    expect: "b",
    ...(steps ? { steps } : {}),
  });

  test.each([
    ["読むだけの step", [{ wait_for: "#a" }, { expect_visible: "#b" }, { expect_text: "x" }]],
    [
      "side_effect: false の操作",
      [
        { click: "#a", side_effect: false },
        { fill: "#q", value: "x", side_effect: false },
        { press: "Enter", side_effect: false },
      ],
    ],
  ])("%s だけなら実行する", (_case, steps) => {
    expect(planCheck(check(steps))).toEqual({ run: true });
  });

  test.each([
    ["steps が無い", check(), "not_automated"],
    ["steps が空", check([]), "not_automated"],
  ])("%s check は実行せず、エージェントに任せる", (_case, c, status) => {
    expect(planCheck(c)).toMatchObject({ run: false, status });
  });

  test.each([
    ["click に side_effect が無い", [{ click: "#save" }], "side_effect: false が無い"],
    [
      "fill が side_effect: true",
      [{ fill: "#q", value: "x", side_effect: true }],
      "side_effect: true",
    ],
    ["press に side_effect が無い", [{ press: "Enter" }], "side_effect: false が無い"],
    [
      "読むだけの step の後に side_effect の無い操作がある",
      [{ wait_for: "#a" }, { click: "#save" }],
      "2 番目の step（click）",
    ],
  ])("%s check は 1 つの step も実行せずに skipped にする", (_case, steps, reason) => {
    const plan = planCheck(check(steps));
    expect(plan).toMatchObject({ run: false, status: "skipped" });
    expect(plan.run ? "" : plan.reason).toContain(reason);
  });

  test.each([
    ["種類が 2 つある", [{ click: "#a", fill: "#b", value: "x", side_effect: false }]],
    ["種類が無い", [{ side_effect: false }]],
  ])("step の%sときは誤りにする", (_case, steps) => {
    expect(() => planCheck(check(steps))).toThrow("step の種類を決められない");
  });
});

describe("終了コード", () => {
  const ok = { navigation: { ok: true }, console: [], checks: [{ status: "passed" }] };

  test.each([
    { case: "すべて通った", result: ok, code: 0 },
    {
      case: "skipped と not_automated だけが残った",
      result: { ...ok, checks: [{ status: "skipped" }, { status: "not_automated" }] },
      code: 0,
    },
    {
      case: "check が失敗した",
      result: { ...ok, checks: [{ status: "passed" }, { status: "failed" }] },
      code: 1,
    },
    {
      case: "console にメッセージがある",
      result: { ...ok, console: [{ level: "warning" }] },
      code: 1,
    },
    { case: "ページを開けなかった", result: { ...ok, navigation: { ok: false } }, code: 1 },
  ])("$case ときは $code", ({ result, code }) => {
    expect(exitCodeOf(result)).toBe(code);
  });
});

describe("Chrome の探し方", () => {
  test("--chrome、CHROME_PATH、PATH の順に探す", () => {
    const dir = makeTempDir("feature-check-chrome-");
    const [a, b, onPath] = ["a", "b", "google-chrome"].map((n) => {
      const p = join(dir, n);
      writeFileSync(p, "");
      return p;
    });
    expect(findChrome(a, { CHROME_PATH: b, PATH: dir })).toBe(a);
    expect(findChrome(undefined, { CHROME_PATH: b, PATH: dir })).toBe(b);
    expect(findChrome(undefined, { PATH: `/nonexistent:${dir}` })).toBe(onPath);
  });

  test.each([
    {
      case: "--chrome のファイルが無い",
      explicit: "/nonexistent/chrome",
      env: {},
      message: "--chrome のファイルが無い",
    },
    {
      case: "CHROME_PATH のファイルが無い",
      explicit: undefined,
      env: { CHROME_PATH: "/nonexistent/chrome" },
      message: "CHROME_PATH のファイルが無い",
    },
    {
      case: "どこにも無い",
      explicit: undefined,
      env: { PATH: "/nonexistent" },
      message: "Chrome が見つからない",
    },
  ])("$case ときは誤りにする", ({ explicit, env, message }) => {
    expect(() => findChrome(explicit, env)).toThrow(message);
  });
});

// ---- 実際の Chrome で操作する ----

/** 手元のサーバーが返すページ。検索欄・結果・保存のボタン（押すと POST を送る）を持つ。 */
const PAGE = (extra: string) => `<!doctype html><meta charset="utf-8">
<input id="q"><div id="r"></div><button id="save" onclick="fetch('/save', { method: 'POST' })">保存</button>
<button id="toggle" onclick="document.getElementById('r').textContent = 'toggled'">切り替え</button>
<script>
  document.getElementById("q").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("r").textContent = "hit: " + e.target.value;
  });
  ${extra}
</script>`;

/** listen した後のサーバーのポート。 */
function portOf(s: Server): number {
  const address = s.address();
  if (address === null || typeof address === "string") throw new Error("ポートを取得できない");
  return address.port;
}

/** CLI が出す結果のうち、テストが読む部分。 */
type Result = {
  screenshot: string;
  complete: boolean;
  navigation: { ok: boolean; message?: string };
  console: { level: string; text: string; during: string }[];
  checks: {
    status: string;
    reason?: string;
    screenshot: string;
    steps?: { kind: string; ok: boolean; message?: string }[];
  }[];
};

let server: Server;
let base = "";
let posts = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.method === "POST") {
      posts += 1;
      res.end("ok");
      return;
    }
    res.setHeader("content-type", "text/html; charset=utf-8");
    if (req.url === "/error") res.end(PAGE('console.error("boom")'));
    else if (req.url === "/warn") res.end(PAGE('console.warn("careful")'));
    else if (req.url === "/throw") res.end(PAGE('throw new Error("uncaught")'));
    else if (req.url === "/favicon.ico") res.end("");
    else res.end(PAGE(""));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${portOf(server)}`;
});

afterAll(() => {
  server.close();
});

/** 設定ファイルを持つ使い捨てのリポジトリを作る。 */
function repo(features: unknown[], environments?: unknown[]) {
  const root = makeTempDir("feature-check-repo-");
  mkdirSync(join(root, ".git"));
  mkdirSync(join(root, ".config", "skills", "shoji9x9"), { recursive: true });
  writeFileSync(
    join(root, ".config", "skills", "shoji9x9", "browser-test.jsonc"),
    JSON.stringify({
      environments: environments ?? [
        { name: "local", url: base, auth: "none", forbidden_actions: [] },
      ],
      features,
    }),
  );
  return root;
}

const search = {
  action: "abc で検索する",
  expect: "結果に abc が出る",
  steps: [
    { fill: "#q", value: "abc", side_effect: false },
    { press: "Enter", side_effect: false },
    { expect_text: "hit: abc", in: "#r" },
  ],
};

/** CLI を実行する。extra に --timeout-ms が無ければ 3000 を渡す。 */
async function run(root: string, feature: string, extra: string[] = []) {
  const timeout = extra.includes("--timeout-ms") ? [] : ["--timeout-ms", "3000"];
  const res = await spawnAsync(
    process.execPath,
    [CLI, "--feature", feature, "--env", "local", "--root", root, ...timeout, ...extra],
    { timeout: CHILD_TIMEOUT_MS },
  );
  return {
    ...res,
    /** 結果の JSON。0 と 1 以外で終わったときは JSON を出さないので、読むとテストを失敗にする。 */
    get json(): Result {
      if (res.status !== 0 && res.status !== 1)
        throw new Error(`exit ${res.status}: ${res.stderr}`);
      return parseJsonAs<Result>(res.stdout);
    },
  };
}

describe("実際の Chrome で機能を確かめる", () => {
  test("Chrome が見つかる（見つからなければ、この節のテストは確かめられない）", () => {
    expect(() => findChrome(undefined, process.env)).not.toThrow();
  });

  test("操作が通り、console にメッセージが無ければ exit 0 で、check ごとの結果とスクリーンショットのパスを返す", async () => {
    const r = await run(repo([{ name: "検索", path: "/", checks: [search] }]), "検索");
    expect(r.status, r.stderr).toBe(0);
    expect(r.json).toMatchObject({
      feature: "検索",
      env: "local",
      path: "/",
      browser: "launched",
      navigation: { ok: true },
      console: [],
      complete: true,
      checks: [
        {
          status: "passed",
          steps: [
            { kind: "fill", ok: true },
            { kind: "press", ok: true },
            { kind: "expect_text", ok: true },
          ],
        },
      ],
    });
    expect(existsSync(r.json.screenshot)).toBe(true);
    expect(existsSync(r.json.checks[0].screenshot)).toBe(true);
    // 開いた URL は、url_command で解決したものでありうるので書き出さない
    expect(r.stdout).not.toContain(base);
  }, 60000);

  test.each([
    ["要素が現れない", { expect_visible: "#none" }, "表示されない: #none"],
    ["文字が現れない", { expect_text: "hit: xyz", in: "#r" }, "「hit: xyz」が #r に現れない"],
    ["待つ要素が現れない", { wait_for: "#none" }, "現れない: #none"],
  ])(
    "%s ときは check を failed にし、exit 1 で終わる",
    async (_case, step, message) => {
      const check = {
        action: "a",
        expect: "b",
        steps: [{ fill: "#q", value: "abc", side_effect: false }, step],
      };
      const r = await run(repo([{ name: "f", path: "/", checks: [check] }]), "f");
      expect(r.status, r.stderr).toBe(1);
      expect(r.json.checks[0]).toMatchObject({
        status: "failed",
        reason: "2 番目の step が失敗した",
      });
      expect(r.json.checks[0]?.steps?.[1]?.message).toContain(message);
    },
    60000,
  );

  test("セレクタの書き方が誤っているときは、ページの中で出た例外の理由を step の message に添える", async () => {
    const check = { action: "a", expect: "b", steps: [{ expect_visible: "#[" }] };
    const r = await run(repo([{ name: "f", path: "/", checks: [check] }]), "f");
    expect(r.status, r.stderr).toBe(1);
    expect(r.json.checks[0]?.steps?.[0]?.message).toMatch(/表示されない: #\[（.*#\[.*）$/);
  }, 60000);

  test("path が # を含む機能でも、check ごとにページを読み込み直し、前の check の状態を持ち越さない", async () => {
    const carried = { action: "a", expect: "b", steps: [{ expect_text: "hit: abc", in: "#r" }] };
    const r = await run(repo([{ name: "f", path: "/app#/home", checks: [search, carried] }]), "f");
    expect(r.status, r.stderr).toBe(1);
    expect(r.json.checks.map((c) => [c.status, c.reason])).toEqual([
      ["passed", undefined],
      ["failed", "1 番目の step が失敗した"],
    ]);
  }, 60000);

  test("操作する要素が無いときは check を failed にし、exit 1 で終わる", async () => {
    const check = { action: "a", expect: "b", steps: [{ click: "#none", side_effect: false }] };
    const r = await run(repo([{ name: "f", path: "/", checks: [check] }]), "f");
    expect(r.status, r.stderr).toBe(1);
    expect(r.json.checks[0]?.steps?.[0]).toMatchObject({
      ok: false,
      message: expect.stringContaining("#none"),
    });
  }, 60000);

  test.each([
    ["/error", "error", "boom"],
    ["/warn", "warning", "careful"],
    ["/throw", "error", "uncaught"],
  ])(
    "%s を開いて console に %s が出たら、exit 1 で終わり、メッセージを返す",
    async (path, level, text) => {
      const r = await run(repo([{ name: "f", path, checks: [search] }]), "f");
      expect(r.status, r.stderr).toBe(1);
      expect(r.json.checks[0].status).toBe("passed");
      expect(r.json.complete).toBe(false);
      expect(r.json.console).toContainEqual(
        expect.objectContaining({ level, during: "load", text: expect.stringContaining(text) }),
      );
    },
    60000,
  );

  test("副作用が無いと書いていない操作は実行せず（POST を送らず）、skipped と not_automated を返して exit 0 で終わる", async () => {
    const before = posts;
    const checks = [
      { action: "保存する", expect: "保存される", steps: [{ click: "#save" }] },
      { action: "保存する", expect: "保存される", steps: [{ click: "#save", side_effect: true }] },
      { action: "見た目", expect: "崩れない" },
    ];
    const r = await run(repo([{ name: "f", path: "/", checks }]), "f");
    expect(r.status, r.stderr).toBe(0);
    expect(r.json.checks.map((c: { status: string }) => c.status)).toEqual([
      "skipped",
      "skipped",
      "not_automated",
    ]);
    expect(r.json.complete).toBe(false);
    expect(posts).toBe(before);
  }, 60000);

  test("side_effect: false と書いた click は実行する（書き方を区別していることの確認）", async () => {
    const check = {
      action: "a",
      expect: "b",
      steps: [
        { click: "#toggle", side_effect: false },
        { expect_text: "toggled", in: "#r" },
      ],
    };
    const r = await run(repo([{ name: "f", path: "/", checks: [check] }]), "f");
    expect(r.status, r.stderr).toBe(0);
    expect(r.json.checks[0]).toMatchObject({ status: "passed" });
  }, 60000);

  test("ページを開けないときは exit 1 で終わり、操作する check を failed にする", async () => {
    const closed = createServer();
    await new Promise<void>((res) => closed.listen(0, "127.0.0.1", res));
    const url = `http://127.0.0.1:${portOf(closed)}`;
    closed.close();
    const env = [{ name: "local", url, auth: "none" }];
    // 読み込みの待ちの上限より十分に早く終わる（開けなかったときに待ちを残さない）
    const started = Date.now();
    const r = await run(repo([{ name: "f", path: "/", checks: [search] }], env), "f", [
      "--timeout-ms",
      "20000",
    ]);
    expect(Date.now() - started).toBeLessThan(15000);
    expect(r.status, r.stderr).toBe(1);
    expect(r.json.navigation).toMatchObject({
      ok: false,
      message: expect.stringContaining("ページを開けない"),
    });
    expect(r.json.checks[0]).toMatchObject({ status: "failed", reason: "ページを開けなかった" });
  }, 60000);

  test("--browser-url では起動中の Chrome に新しいタブを作って操作し、終わったらそのタブだけを閉じる", async () => {
    const profile = makeTempDir("feature-check-profile-");
    const chrome: ChildProcess = spawn(
      findChrome(undefined, process.env),
      ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"],
      { stdio: ["ignore", "ignore", "pipe"], timeout: CHILD_TIMEOUT_MS },
    );
    try {
      const port = await new Promise<string>((resolve) => {
        let err = "";
        chrome.stderr?.on("data", (c) => {
          err += String(c);
          const m = /DevTools listening on ws:\/\/[^:]+:(\d+)\//.exec(err);
          if (m?.[1]) resolve(m[1]);
        });
      });
      const browserUrl = `http://127.0.0.1:${port}`;
      const pages = async () =>
        parseJsonAs<{ type: string }[]>(
          await (await fetch(`${browserUrl}/json/list`)).text(),
        ).filter((t) => t.type === "page").length;
      const before = await pages();
      const r = await run(repo([{ name: "検索", path: "/", checks: [search] }]), "検索", [
        "--browser-url",
        browserUrl,
      ]);
      expect(r.status, r.stderr).toBe(0);
      expect(r.json).toMatchObject({ browser: "connected", complete: true });
      expect(await pages()).toBe(before);
    } finally {
      chrome.kill();
    }
  }, 60000);
});

describe("設定とブラウザの誤り", () => {
  const f = { name: "検索", path: "/", checks: [search] };

  test.each([
    {
      case: "機能が機能マップに無い",
      make: () => repo([f]),
      feature: "設定",
      extra: [],
      code: 2,
      message: "機能マップに無い",
    },
    {
      case: "呼び名が 2 件ある",
      make: () => repo([f, f]),
      feature: "検索",
      extra: [],
      code: 2,
      message: "2 件ある",
    },
    {
      case: "環境が無い",
      make: () => repo([f], [{ name: "dev", url: base, auth: "none" }]),
      feature: "検索",
      extra: [],
      code: 2,
      message: "環境「local」が設定に無い",
    },
    {
      case: "auth: user の環境で --browser-url が無い",
      make: () => repo([f], [{ name: "local", url: base, auth: "user" }]),
      feature: "検索",
      extra: [],
      code: 2,
      message: "auth: user なので、ログインした Chrome を --browser-url で渡す",
    },
    {
      case: "url_command の環境で --base-url が無い",
      make: () => repo([f], [{ name: "local", url_command: "echo x", auth: "none" }]),
      feature: "検索",
      extra: [],
      code: 2,
      message: "--base-url",
    },
    {
      case: "--chrome のファイルが無い",
      make: () => repo([f]),
      feature: "検索",
      extra: ["--chrome", "/nonexistent/chrome"],
      code: 3,
      message: "--chrome のファイルが無い",
    },
    {
      case: "--browser-url につなげない",
      make: () => repo([f]),
      feature: "検索",
      extra: ["--browser-url", "http://127.0.0.1:9"],
      code: 3,
      message: "つなげない",
    },
  ])(
    "$case ときは exit $code で終わり、理由を出す",
    async ({ make, feature, extra, code, message }) => {
      const r = await run(make(), feature, extra);
      expect(r.status).toBe(code);
      expect(r.stderr).toContain(message);
      expect(r.stdout).toBe("");
    },
    60000,
  );

  test("機能マップの無い設定では exit 2 で終わる", async () => {
    const root = repo([f]);
    writeFileSync(
      join(root, ".config", "skills", "shoji9x9", "browser-test.jsonc"),
      JSON.stringify({ environments: [{ name: "local", url: base, auth: "none" }] }),
    );
    const r = await run(root, "検索");
    expect(r.status, r.stderr).toBe(2);
    expect(r.stderr).toContain("機能マップ（features）が無い");
  }, 60000);

  test("設定がスキーマに合わないときは exit 2 で終わる", async () => {
    const r = await run(
      repo([{ ...f, checks: [{ ...search, steps: [{ press: "F5" }] }] }]),
      "検索",
    );
    expect(r.status, r.stderr).toBe(2);
    expect(r.stderr).toContain("設定を読めない");
  }, 60000);
});
