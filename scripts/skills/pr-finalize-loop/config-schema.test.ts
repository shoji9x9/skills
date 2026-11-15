// pr-finalize-loop の設定（config-schemas/pr-finalize-loop.schema.json）の回帰テスト。
//
// 同梱の読み取り（scripts/skill-config/skill-config.mjs）を CLI として起動し、SKILL.md の
// 「返信だけの反復で再レビューを依頼するか」が書く値の決め方を確かめる。
//
// | 軸                   | 値                                                                  |
// | -------------------- | ------------------------------------------------------------------- |
// | 引数（--cli-value）  | 無い / true / false / 真偽値でない JSON / JSON でない                |
// | ファイルの層         | 無い / リポジトリ / 人ごと・リポジトリ限定 / 人ごと / 複数の層        |
// | ファイルの値         | true / false / 真偽値でない                                          |
// | 置き場所             | pr-finalize-loop.jsonc / common.jsonc（置けない）                    |
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

test("人ごと・リポジトリ限定の層が、リポジトリの層より優先する", () => {
  const s = setup();
  s.repo('{ "rereview_after_reply": true }');
  s.local('{ "rereview_after_reply": false }');
  const r = get(s);
  expect(r.status).toBe(0);
  expect(r.stdout).toContain("value=false");
  expect(r.stdout).toContain("source=local");
});

test("人ごとの層が、リポジトリの層より優先する", () => {
  const s = setup();
  s.repo('{ "rereview_after_reply": true }');
  s.user('{ "rereview_after_reply": false }');
  const r = get(s);
  expect(r.status).toBe(0);
  expect(r.stdout).toContain("value=false");
  expect(r.stdout).toContain("source=user");
});

test.each([
  ["false", "true", "true"],
  ["true", "false", "false"],
])("引数は設定より優先する（設定 %s・引数 %s）", (file, cli, want) => {
  const s = setup();
  s.repo(`{ "rereview_after_reply": ${file} }`);
  const r = get(s, cli);
  expect(r.status).toBe(0);
  expect(r.stdout).toContain(`value=${want}`);
  expect(r.stdout).toContain("source=cli");
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

test("JSON でない引数（yes）は、exit 2 で止まる（SKILL.md は 0 以外をすべて止まる扱いにする）", () => {
  const r = get(setup(), "yes");
  expect(r.status).toBe(2);
  expect(r.stdout).not.toContain("value=");
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
