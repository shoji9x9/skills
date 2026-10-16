// box のトークンを取得するスクリプト（box-token.sh・box-oauth-init.sh）のテスト。
//
// curl は PATH の前に置いた偽物に差し替え、Box の API には接続しない。偽物は受け取った引数と、
// カレントディレクトリにある秘密のファイル（secret・refresh・code）の中身を記録し、決めた応答を返す。
//
// 状態空間の軸と、各セルに置いた入力:
//
// | 軸             | 値                                                                 |
// | -------------- | ------------------------------------------------------------------ |
// | トークンの出所 | BOX_ACCESS_TOKEN / 環境変数の refresh token / ファイル / どれも無い |
// | 必須の環境変数 | そろう / BOX_CLIENT_ID が無い / BOX_CLIENT_SECRET が無い            |
// | 保存先の書き方 | 絶対パス / 先頭が ~/                                                |
// | API の応答     | 成功（新しい refresh token あり・なし） / invalid_client / その他の error / token が無い |
// | TMPDIR         | 通常 / `=` を含む                                                   |
// | 認可コード     | stdin で渡す / 空 / 引数で渡す                                      |
import { describe, test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { coverageEnv } from "../../lib/testing/coverage-env.ts";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const TOKEN_SCRIPT = join(repoRoot, "skills/box/scripts/box-token.sh");
const INIT_SCRIPT = join(repoRoot, "skills/box/scripts/box-oauth-init.sh");

// jq はユーザーのグローバル設定の mise から入ることがある。HOME を差し替えると mise の shim が
// 解決できないので、実体のパスを先に取得し、偽物と同じディレクトリにリンクを置く。
const JQ = spawnSync("bash", ["-c", "mise which jq 2>/dev/null || command -v jq"], {
  cwd: repoRoot,
  encoding: "utf8",
  timeout: 30_000,
}).stdout.trim();

const CURL_STUB = `#!/usr/bin/env bash
log="$STUB_LOG"
for a in "$@"; do printf 'arg:%s\\n' "$a" >>"$log"; done
for f in secret refresh code; do
  if [ -f "$f" ]; then printf 'file:%s=%s\\n' "$f" "$(cat "$f")" >>"$log"; fi
done
printf '%s' "$STUB_RESPONSE"
`;

type Setup = { dir: string; bin: string; log: string; home: string };

function setup(prefix: string): Setup {
  const dir = makeTempDir(prefix);
  const bin = join(dir, "bin");
  const home = join(dir, "home");
  mkdirSync(bin);
  mkdirSync(home);
  writeFileSync(join(bin, "curl"), CURL_STUB);
  chmodSync(join(bin, "curl"), 0o755);
  if (JQ) symlinkSync(JQ, join(bin, "jq"));
  return { dir, bin, log: join(dir, "curl.log"), home };
}

function run(
  script: string,
  s: Setup,
  {
    env = {},
    args = [],
    input = "",
  }: { env?: Record<string, string>; args?: string[]; input?: string } = {},
) {
  const r = spawnSync("bash", [script, ...args], {
    encoding: "utf8",
    input,
    env: {
      PATH: `${s.bin}:${process.env.PATH}`,
      HOME: s.home,
      TMPDIR: s.dir,
      STUB_LOG: s.log,
      ...coverageEnv(),
      ...env,
    },
    timeout: 30_000,
  });
  const log = existsSync(s.log) ? readFileSync(s.log, "utf8") : "";
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, log };
}

const CLIENT = { BOX_CLIENT_ID: "cid-1", BOX_CLIENT_SECRET: "sec-1" };

test("jq の実体を解決できる（解決できないと、以下のテストは応答を読めずに失敗する）", () => {
  expect(JQ).not.toBe("");
});

describe("box-token.sh", () => {
  test("BOX_ACCESS_TOKEN があれば、それを出して API を呼ばない", () => {
    const s = setup("box-token-");
    const r = run(TOKEN_SCRIPT, s, { env: { BOX_ACCESS_TOKEN: "dev-token" } });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("dev-token");
    expect(r.log).toBe("");
  });

  test.each([
    ["BOX_CLIENT_ID", { BOX_CLIENT_SECRET: "sec-1" }, /BOX_CLIENT_ID/],
    ["BOX_CLIENT_SECRET", { BOX_CLIENT_ID: "cid-1" }, /BOX_CLIENT_SECRET が未設定/],
  ])("%s が無ければ失敗し、API を呼ばない", (_name, env, message) => {
    const s = setup("box-token-");
    const r = run(TOKEN_SCRIPT, s, { env });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(message);
    expect(r.log).toBe("");
  });

  test("refresh token がどこにも無ければ失敗し、参照したファイルを示す", () => {
    const s = setup("box-token-");
    const r = run(TOKEN_SCRIPT, s, { env: CLIENT });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/refresh token が無い/);
    expect(r.stderr).toContain(join(s.home, ".config/box/refresh_token"));
    expect(r.log).toBe("");
  });

  test("環境変数の refresh token の空白を除き、秘密の値を引数に載せずに送る。新しい refresh token を 0600 で保存する", () => {
    const s = setup("box-token-");
    const tokenFile = join(s.dir, "saved", "refresh_token");
    const r = run(TOKEN_SCRIPT, s, {
      env: {
        ...CLIENT,
        BOX_REFRESH_TOKEN: " rt-old\r\n",
        BOX_REFRESH_TOKEN_FILE: tokenFile,
        STUB_RESPONSE: JSON.stringify({ access_token: "at-1", refresh_token: "rt-new" }),
      },
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe("at-1");
    expect(r.log).toContain("arg:grant_type=refresh_token");
    expect(r.log).toContain("arg:client_id=cid-1");
    expect(r.log).toContain("arg:client_secret@secret");
    expect(r.log).toContain("arg:refresh_token@refresh");
    expect(r.log).toContain("file:refresh=rt-old");
    expect(r.log).toContain("file:secret=sec-1");
    expect(r.log).not.toMatch(/^arg:.*(sec-1|rt-old)/m);
    expect(readFileSync(tokenFile, "utf8")).toBe("rt-new");
    expect(statSync(tokenFile).mode & 0o777).toBe(0o600);
  });

  test("先頭が ~/ の保存先は HOME の下として読み書きする", () => {
    const s = setup("box-token-");
    const tokenFile = join(s.home, "box", "rt");
    mkdirSync(dirname(tokenFile));
    writeFileSync(tokenFile, "rt-file\n");
    const r = run(TOKEN_SCRIPT, s, {
      env: {
        ...CLIENT,
        BOX_REFRESH_TOKEN_FILE: "~/box/rt",
        STUB_RESPONSE: JSON.stringify({ access_token: "at-2", refresh_token: "rt-rotated" }),
      },
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe("at-2");
    expect(r.log).toContain("file:refresh=rt-file");
    expect(readFileSync(tokenFile, "utf8")).toBe("rt-rotated");
  });

  test("応答に新しい refresh token が無ければ、保存してあるものを書き換えない", () => {
    const s = setup("box-token-");
    const tokenFile = join(s.dir, "rt");
    writeFileSync(tokenFile, "rt-keep");
    const r = run(TOKEN_SCRIPT, s, {
      env: {
        ...CLIENT,
        BOX_REFRESH_TOKEN_FILE: tokenFile,
        STUB_RESPONSE: JSON.stringify({ access_token: "at-3" }),
      },
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe("at-3");
    expect(readFileSync(tokenFile, "utf8")).toBe("rt-keep");
  });

  test("TMPDIR が = を含んでも、秘密のファイルの中身を送る", () => {
    const s = setup("box-token-");
    const tmp = join(s.dir, "a=b");
    mkdirSync(tmp);
    const r = run(TOKEN_SCRIPT, s, {
      env: {
        ...CLIENT,
        TMPDIR: tmp,
        BOX_REFRESH_TOKEN: "rt-eq",
        BOX_REFRESH_TOKEN_FILE: join(s.dir, "rt"),
        STUB_RESPONSE: JSON.stringify({ access_token: "at-4" }),
      },
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.log).toContain("file:refresh=rt-eq");
    expect(r.log).toContain("arg:refresh_token@refresh");
  });

  test.each([
    ["invalid_client", /client 認証に失敗しました/, /失効/],
    ["invalid_grant", /refresh token が失効している可能性があります/, /client 認証/],
  ])("API が %s を返したら失敗し、原因に合う案内を出す", (error, shown, notShown) => {
    const s = setup("box-token-");
    const tokenFile = join(s.dir, "rt");
    writeFileSync(tokenFile, "rt-keep");
    const r = run(TOKEN_SCRIPT, s, {
      env: {
        ...CLIENT,
        BOX_REFRESH_TOKEN_FILE: tokenFile,
        STUB_RESPONSE: JSON.stringify({ error, error_description: "desc-x" }),
      },
    });
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain(`トークン更新失敗: ${error} - desc-x`);
    expect(r.stderr).toMatch(shown);
    expect(r.stderr).not.toMatch(notShown);
    expect(readFileSync(tokenFile, "utf8")).toBe("rt-keep");
  });

  test("応答に access_token が無ければ失敗する", () => {
    const s = setup("box-token-");
    const r = run(TOKEN_SCRIPT, s, {
      env: {
        ...CLIENT,
        BOX_REFRESH_TOKEN: "rt",
        BOX_REFRESH_TOKEN_FILE: join(s.dir, "rt"),
        STUB_RESPONSE: "{}",
      },
    });
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/access_token を取得できませんでした/);
  });
});

describe("box-oauth-init.sh", () => {
  test("引数で認可コードを渡すとエラーにし、API を呼ばない", () => {
    const s = setup("box-init-");
    const r = run(INIT_SCRIPT, s, { env: CLIENT, args: ["code-x"], input: "code-x\n" });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/引数で渡しません/);
    expect(r.log).toBe("");
  });

  test("stdin の認可コードが空白だけなら失敗し、API を呼ばない", () => {
    const s = setup("box-init-");
    const r = run(INIT_SCRIPT, s, { env: CLIENT, input: " \r\n" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/認可コードが空です/);
    expect(r.log).toBe("");
  });

  test.each([
    ["BOX_CLIENT_ID", { BOX_CLIENT_SECRET: "sec-1" }],
    ["BOX_CLIENT_SECRET", { BOX_CLIENT_ID: "cid-1" }],
  ])("%s が無ければ失敗し、API を呼ばない", (name, env) => {
    const s = setup("box-init-");
    const r = run(INIT_SCRIPT, s, { env, input: "code-x\n" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain(`${name} が未設定`);
    expect(r.log).toBe("");
  });

  test("認可コードを引数に載せずに交換し、refresh token を ~/ の保存先へ 0600 で保存する", () => {
    const s = setup("box-init-");
    const r = run(INIT_SCRIPT, s, {
      env: {
        ...CLIENT,
        BOX_REFRESH_TOKEN_FILE: "~/cfg/rt",
        STUB_RESPONSE: JSON.stringify({ access_token: "abcde", refresh_token: "rt-init" }),
      },
      input: " code-x\r\n",
    });
    expect(r.status, r.stderr).toBe(0);
    const tokenFile = join(s.home, "cfg", "rt");
    expect(readFileSync(tokenFile, "utf8")).toBe("rt-init");
    expect(statSync(tokenFile).mode & 0o777).toBe(0o600);
    expect(r.stdout).toContain(`refresh_token を ${tokenFile} に保存しました（access_token 長=5）`);
    expect(r.log).toContain("arg:grant_type=authorization_code");
    expect(r.log).toContain("arg:code@code");
    expect(r.log).toContain("arg:redirect_uri=https://app.box.com");
    expect(r.log).toContain("file:code=code-x");
    expect(r.log).toContain("file:secret=sec-1");
    expect(r.log).not.toMatch(/^arg:.*(sec-1|code-x)/m);
  });

  test("BOX_REDIRECT_URI を指定すれば、その値を送る", () => {
    const s = setup("box-init-");
    const r = run(INIT_SCRIPT, s, {
      env: {
        ...CLIENT,
        BOX_REDIRECT_URI: "http://localhost:8080",
        BOX_REFRESH_TOKEN_FILE: join(s.dir, "rt"),
        STUB_RESPONSE: JSON.stringify({ access_token: "a", refresh_token: "r" }),
      },
      input: "code-x\n",
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.log).toContain("arg:redirect_uri=http://localhost:8080");
  });

  test.each([
    ["invalid_client", /client 認証に失敗しました/, /約30秒で失効/],
    ["invalid_grant", /約30秒で失効/, /client 認証/],
  ])("API が %s を返したら失敗し、原因に合う案内を出す。保存はしない", (error, shown, notShown) => {
    const s = setup("box-init-");
    const tokenFile = join(s.dir, "rt");
    const r = run(INIT_SCRIPT, s, {
      env: {
        ...CLIENT,
        BOX_REFRESH_TOKEN_FILE: tokenFile,
        STUB_RESPONSE: JSON.stringify({ error, error_description: "desc-y" }),
      },
      input: "code-x\n",
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`トークン交換失敗: ${error} - desc-y`);
    expect(r.stderr).toMatch(shown);
    expect(r.stderr).not.toMatch(notShown);
    expect(existsSync(tokenFile)).toBe(false);
  });

  test("応答に refresh_token が無ければ失敗し、保存しない", () => {
    const s = setup("box-init-");
    const tokenFile = join(s.dir, "rt");
    const r = run(INIT_SCRIPT, s, {
      env: {
        ...CLIENT,
        BOX_REFRESH_TOKEN_FILE: tokenFile,
        STUB_RESPONSE: JSON.stringify({ access_token: "a" }),
      },
      input: "code-x\n",
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/refresh_token を取得できませんでした/);
    expect(existsSync(tokenFile)).toBe(false);
  });
});
