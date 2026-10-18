// box-folder.sh（操作の対象のフォルダの ID を設定から決める）のテスト。
//
// 状態空間の軸と、各セルに置いた入力:
//
// | 軸 | 値 |
// | --- | --- |
// | 旧い環境変数 BOX_ROOT_FOLDER_ID | 無い / 値あり / 空 |
// | 設定ファイル | どれも無い / リポジトリ / .local.jsonc（リポジトリより優先） / 人ごと（置けない層） / 旧い skills.yml |
// | Node.js | ある / 無い |
// | 値 | 数字の文字列 / 数字でない |
// | 起動する場所 | リポジトリの中 / git の外 |
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";
import { coverageEnv } from "../../lib/testing/coverage-env.ts";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SCRIPT = join(repoRoot, "skills/box/scripts/box-folder.sh");
const which = (cmd: string) =>
  execFileSync("bash", ["-c", `command -v ${cmd}`], {
    encoding: "utf8",
    timeout: CHILD_TIMEOUT_MS,
  }).trim();
const BASH = which("bash");

/** git と dirname だけを置いた PATH（node を含めないとき）か、node も置いた PATH を作る。 */
function setup({ node }: { node: boolean }) {
  const dir = makeTempDir("box-folder-");
  const bin = join(dir, "bin");
  mkdirSync(bin);
  for (const cmd of ["git", "dirname"]) symlinkSync(which(cmd), join(bin, cmd));
  if (node) symlinkSync(process.execPath, join(bin, "node"));
  const repo = join(dir, "repo");
  mkdirSync(repo);
  execFileSync("git", ["init", "-q"], { cwd: repo, timeout: CHILD_TIMEOUT_MS });
  writeFileSync(join(repo, ".gitignore"), "/.config/skills/shoji9x9/*.local.jsonc\n");
  const configDir = join(repo, ".config", "skills", "shoji9x9");
  const xdg = join(dir, "xdg");
  const env: Record<string, string> = {
    ...coverageEnv(),
    PATH: bin,
    HOME: join(dir, "home"),
    XDG_CONFIG_HOME: xdg,
  };
  const write = (rel: string, text: string) => {
    const p = rel.startsWith("xdg:") ? join(xdg, rel.slice(4)) : join(configDir, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
  };
  const run = (extra: Record<string, string> = {}, cwd = repo) =>
    spawnSync(BASH, [SCRIPT], {
      cwd,
      env: { ...env, ...extra },
      encoding: "utf8",
      timeout: CHILD_TIMEOUT_MS,
    });
  return { dir, repo, configDir, write, run };
}

describe("box-folder.sh", () => {
  test("設定ファイルが 1 つも無ければ、Node.js なしで 0 を出す", () => {
    const s = setup({ node: false });
    const r = s.run();
    expect({ status: r.status, stdout: r.stdout, stderr: r.stderr }).toEqual({
      status: 0,
      stdout: "0",
      stderr: "",
    });
  });

  test.each(["", "0", "true"])(
    "SHOJI9X9_SKILLS_IGNORE_USER_CONFIG が 1 以外（%j）なら、設定ファイルが無くても読み取りと同じく止める",
    (value) => {
      const s = setup({ node: false });
      const r = s.run({ SHOJI9X9_SKILLS_IGNORE_USER_CONFIG: value });
      expect(r.status).toBe(1);
      expect(r.stdout).toBe("");
      expect(r.stderr).toContain("SHOJI9X9_SKILLS_IGNORE_USER_CONFIG は 1 だけを受け付ける");
    },
  );

  test("SHOJI9X9_SKILLS_IGNORE_USER_CONFIG=1 なら、人ごとの層の box.jsonc を数えず、Node.js なしで 0 を出す", () => {
    const s = setup({ node: false });
    s.write("xdg:skills/shoji9x9/box.jsonc", '{ "root_folder_id": "9" }\n');
    expect(s.run().status).toBe(1);
    const r = s.run({ SHOJI9X9_SKILLS_IGNORE_USER_CONFIG: "1" });
    expect({ status: r.status, stdout: r.stdout }).toEqual({ status: 0, stdout: "0" });
  });

  test("HOME が空ならユーザーのデータベースのホームを使い、絶対パスにならない HOME なら止める", () => {
    const s = setup({ node: false });
    expect(s.run({ HOME: "", XDG_CONFIG_HOME: "" }).status).toBe(0);
    const r = s.run({ HOME: "rel", XDG_CONFIG_HOME: "" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("人ごとの設定の置き場所を決められない");
  });

  test("git の外でも、cwd の下に設定が無ければ 0 を出す", () => {
    const s = setup({ node: false });
    const outside = join(s.dir, "outside");
    mkdirSync(outside);
    expect(s.run({}, outside).stdout).toBe("0");
  });

  test("リポジトリの設定の root_folder_id を出し、.local.jsonc があればそちらを使う", () => {
    const s = setup({ node: true });
    s.write("box.jsonc", '{\n  // 共有フォルダ\n  "root_folder_id": "123",\n}\n');
    expect(s.run()).toMatchObject({ status: 0, stdout: "123" });
    s.write("box.local.jsonc", '{ "root_folder_id": "456" }');
    expect(s.run()).toMatchObject({ status: 0, stdout: "456" });
  });

  test("設定ファイルにキーが無ければ、デフォルトの 0 を出す", () => {
    const s = setup({ node: true });
    s.write("box.jsonc", "{}");
    expect(s.run()).toMatchObject({ status: 0, stdout: "0" });
  });

  test("他の配布元の skills.yml では止めず、Node.js なしでデフォルトの 0 を出す", () => {
    const s = setup({ node: false });
    s.write("../other/skills.yml", "skills: {}\n");
    expect(s.run()).toMatchObject({ status: 0, stdout: "0" });
  });

  test.each([
    ["リポジトリの設定", "box.jsonc"],
    ["旧い skills.yml", "skills.yml"],
    ["人ごとの層（置けない層）", "xdg:skills/shoji9x9/box.jsonc"],
  ])("%s があって Node.js が無ければ、0 で続けずに止める", (_name, rel) => {
    const s = setup({ node: false });
    s.write(rel, '{ "root_folder_id": "123" }');
    const r = s.run();
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/があるが、読むための Node\.js が無い/);
  });

  test.each([
    ["数字でない ID", "box.jsonc", '{ "root_folder_id": "abc" }', /root_folder_id: "abc" が/],
    ["数値で書いた ID", "box.jsonc", '{ "root_folder_id": 123 }', /型が "string" でない/],
    [
      "人ごとの層の ID",
      "xdg:skills/shoji9x9/box.jsonc",
      '{ "root_folder_id": "123" }',
      /人ごと の層に置けない/,
    ],
    ["旧い skills.yml", "skills.yml", "skills: {}\n", /skills\.yml が残っている/],
  ])("%s は、設定の誤りとして止める", (_name, rel, text, message) => {
    const s = setup({ node: true });
    s.write(rel, text);
    const r = s.run();
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(message);
  });

  test.each([["123"], [""]])(
    "環境変数 BOX_ROOT_FOLDER_ID（%j）が残っていれば、移行の手順を示して止める",
    (value) => {
      const s = setup({ node: false });
      const r = s.run({ BOX_ROOT_FOLDER_ID: value });
      expect(r.status).toBe(1);
      expect(r.stdout).toBe("");
      expect(r.stderr).toMatch(/BOX_ROOT_FOLDER_ID は使わなくなった。.*box\.jsonc.*root_folder_id/);
    },
  );
});
