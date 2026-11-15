// pr-finalize-loop の設定（config-schemas/pr-finalize-loop.schema.json）の回帰テスト。
//
// 同梱の読み取り（scripts/skill-config/skill-config.mjs）を CLI として起動し、このスキーマに固有の事実
// （真偽値・デフォルトの true・置ける 3 つの層・common.jsonc には置けない）を確かめる。
// 層の優先順位・引数の優先・JSON でない引数など、読み取りに共通の振る舞いは
// scripts/skills/_cross/skill-config.test.ts が確かめるので、ここでは繰り返さない。
//
// | 軸                   | 値                                                     |
// | -------------------- | ------------------------------------------------------ |
// | 引数（--cli-value）  | 無い / 真偽値でない JSON                                |
// | ファイルの層         | 無い / リポジトリ / 人ごと・リポジトリ限定 / 人ごと      |
// | ファイルの値         | false / 真偽値でない                                    |
// | 置き場所             | pr-finalize-loop.jsonc / common.jsonc（置けない）       |
import { test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const READER = join(repoRoot, "skills/pr-finalize-loop/scripts/skill-config/skill-config.mjs");

function setup() {
  const base = makeTempDir("pfl-config-");
  const root = join(base, "repo");
  mkdirSync(root);
  // --root で渡すので、リポジトリのルートを git で探さない
  const xdg = join(base, "xdg");
  const env = { PATH: process.env.PATH ?? "", HOME: join(base, "home"), XDG_CONFIG_HOME: xdg };
  const repoDir = join(root, ".config/skills/shoji9x9");
  const userDir = join(xdg, "skills/shoji9x9");
  const write = (dir: string, file: string, body: string) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, file), body);
  };
  return {
    root,
    env,
    repo: (body: string) => write(repoDir, "pr-finalize-loop.jsonc", body),
    local: (body: string) => write(repoDir, "pr-finalize-loop.local.jsonc", body),
    user: (body: string) => write(userDir, "pr-finalize-loop.jsonc", body),
    common: (body: string) => write(repoDir, "common.jsonc", body),
  };
}

function get(s: ReturnType<typeof setup>, cli?: string) {
  const args = [READER, "get", "pr-finalize-loop", "rereview_after_reply", "--root", s.root];
  if (cli !== undefined) args.push("--cli-value", cli);
  const r = spawnSync(process.execPath, args, {
    env: s.env,
    encoding: "utf8",
    timeout: CHILD_TIMEOUT_MS,
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

test("設定も引数も無ければ、デフォルトの true（依頼する）を使う", () => {
  const r = get(setup());
  expect(r.status).toBe(0);
  expect(r.stdout).toContain("value=true");
  expect(r.stdout).toContain("source=default");
});

test.each([
  ["リポジトリ", "repo", "repo"],
  ["人ごと・リポジトリ限定", "local", "local"],
  ["人ごと", "user", "user"],
] as const)("%s の層の false を読む", (_label, layer, source) => {
  const s = setup();
  s[layer]('{ "rereview_after_reply": false }');
  const r = get(s);
  expect(r.status).toBe(0);
  expect(r.stdout).toContain("value=false");
  expect(r.stdout).toContain(`source=${source}`);
});

test("真偽値でない設定は、デフォルトで続けずに exit 1 で止まる", () => {
  const s = setup();
  s.repo('{ "rereview_after_reply": "no" }');
  const r = get(s);
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("rereview_after_reply");
});

test("真偽値でない JSON の引数は、exit 1 で止まる", () => {
  const r = get(setup(), '"false"');
  expect(r.status).toBe(1);
});

test("common.jsonc に置いたキーは、知らないキーとして止まる（common のスキーマは変えない）", () => {
  const s = setup();
  s.common('{ "rereview_after_reply": false }');
  const r = spawnSync(
    process.execPath,
    [READER, "get", "common", "review_tool", "--root", s.root],
    { env: s.env, encoding: "utf8", timeout: CHILD_TIMEOUT_MS },
  );
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("rereview_after_reply");
});
