// review_tool 解決スクリプト（pr-finalize-loop / pr-review-handle に同梱）の回帰テスト。
//
// 状態空間の軸と、各セルに置いた入力:
//
// | 軸 | 値 |
// | --- | --- |
// | 層 | CLI / common.local.jsonc / 人ごとの common.jsonc / common.jsonc / デフォルト（優先順位どおりに上書きされるか） |
// | 値 | 受理する 5 値 / 未知の値 / キーが無い |
// | 設定ファイル | 3 つとも無い / どれかがある / 知らないキー / 構文の誤り |
// | 人ごとの層の場所 | XDG_CONFIG_HOME が絶対パス / 相対パス（HOME/.config を使う） |
// | Node.js | ある / 無い（ファイルが無ければ要らない、あれば止まる） |
// | 旧い場所 | SKILLS_REVIEW_TOOL（値あり・空）/ skills.yml |
// | 引数 | 正常 / 値の無い・空の --review-tool と --root / 不明な引数 / --help |
// | 起動する場所 | リポジトリのルート / サブディレクトリ / git の外 |
//
// 誤検知しないことの確認として、リポジトリの実設定も 1 件読む（合成の設定だけだと、
// 実ファイルの書き方と読み取りがずれていても緑のまま通る）。
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";
import { coverageEnv } from "../../lib/testing/coverage-env.ts";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SCRIPTS = [
  "skills/pr-finalize-loop/scripts/resolve-review-tool.sh",
  "skills/pr-review-handle/scripts/resolve-review-tool.sh",
];
const NODE_DIR = dirname(process.execPath);

/** node を含まない PATH（bash・git・dirname だけ）。 */
function pathWithoutNode(base: string): string {
  const bin = join(base, "bin-no-node");
  mkdirSync(bin);
  for (const tool of ["bash", "git", "dirname"]) {
    const real = execFileSync("bash", ["-c", `command -v ${tool}`], {
      encoding: "utf8",
      timeout: CHILD_TIMEOUT_MS,
    }).trim();
    symlinkSync(real, join(bin, tool));
  }
  return bin;
}

type Env = Record<string, string>;

/** git のリポジトリと、人ごとの設定の置き場所を作る。 */
function setup() {
  const base = makeTempDir("review-tool-");
  const root = join(base, "repo");
  mkdirSync(root);
  execFileSync("git", ["init", "-q"], { cwd: root, timeout: CHILD_TIMEOUT_MS });
  const xdg = join(base, "xdg");
  const files = {
    repo: join(root, ".config/skills/shoji9x9/common.jsonc"),
    local: join(root, ".config/skills/shoji9x9/common.local.jsonc"),
    user: join(xdg, "skills/shoji9x9/common.jsonc"),
  };
  const write = (layer: keyof typeof files, text: string) => {
    mkdirSync(dirname(files[layer]), { recursive: true });
    writeFileSync(files[layer], text);
  };
  const env: Env = {
    PATH: `${NODE_DIR}:${process.env.PATH ?? ""}`,
    HOME: join(base, "home"),
    XDG_CONFIG_HOME: xdg,
  };
  return { base, root, files, write, env };
}

type RunOptions = { args?: string[]; env: Env; cwd: string };

function run(scriptRel: string, { args = [], env, cwd }: RunOptions) {
  // 呼び出し側の SKILLS_REVIEW_TOOL や XDG_CONFIG_HOME に左右されないよう、毎回明示的に組み立てる。
  return spawnSync("bash", [join(repoRoot, scriptRel), ...args], {
    timeout: CHILD_TIMEOUT_MS,
    encoding: "utf8",
    cwd,
    env: { ...coverageEnv(), ...env },
  });
}

const parse = (stdout: string) =>
  Object.fromEntries(
    stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l: string) => l.split("=")),
  );

for (const script of SCRIPTS) {
  const name = script.split("/")[1];

  test(`${name}: 設定ファイルが無ければ Node.js なしでデフォルト copilot を返し、参照先を stderr に残す`, () => {
    const s = setup();
    const r = run(script, { cwd: s.root, env: { ...s.env, PATH: pathWithoutNode(s.base) } });
    expect(r.status, r.stderr).toBe(0);
    expect(parse(r.stdout)).toEqual({ value: "copilot", source: "default" });
    expect(r.stderr).toMatch(
      /common の設定ファイルが無いため既定を使う（参照: .*common\.jsonc ほか）/,
    );
  });

  test(`${name}: 設定ファイルが無ければ、CLI の値を Node.js なしで返す`, () => {
    const s = setup();
    const r = run(script, {
      cwd: s.root,
      env: { ...s.env, PATH: pathWithoutNode(s.base) },
      args: ["--review-tool", "codex"],
    });
    expect(r.status, r.stderr).toBe(0);
    expect(parse(r.stdout)).toEqual({ value: "codex", source: "cli" });
  });

  test(`${name}: common.jsonc から読み、出所を repo と報告する（コメントと末尾のカンマを読む）`, () => {
    const s = setup();
    s.write("repo", '{\n  "conventions_doc": "AGENTS.md",\n  "review_tool": "codex", // 共有\n}\n');
    const r = run(script, { cwd: s.root, env: s.env });
    expect(r.status, r.stderr).toBe(0);
    expect(parse(r.stdout)).toEqual({ value: "codex", source: "repo" });
  });

  test(`${name}: 人ごとの設定は common.jsonc より、common.local.jsonc は人ごとの設定より優先する`, () => {
    const s = setup();
    s.write("repo", '{ "review_tool": "codex" }');
    s.write("user", '{ "review_tool": "none" }');
    expect(parse(run(script, { cwd: s.root, env: s.env }).stdout)).toEqual({
      value: "none",
      source: "user",
    });
    s.write("local", '{ "review_tool": "local" }');
    expect(parse(run(script, { cwd: s.root, env: s.env }).stdout)).toEqual({
      value: "local",
      source: "local",
    });
  });

  test(`${name}: CLI はすべてのファイルの層より優先する`, () => {
    const s = setup();
    s.write("local", '{ "review_tool": "local" }');
    const r = run(script, { cwd: s.root, env: s.env, args: ["--review-tool", "claude-code"] });
    expect(r.status, r.stderr).toBe(0);
    expect(parse(r.stdout)).toEqual({ value: "claude-code", source: "cli" });
  });

  test(`${name}: XDG_CONFIG_HOME が相対パスなら HOME/.config の下の人ごとの設定を読む`, () => {
    const s = setup();
    const userHome = join(s.env.HOME, ".config/skills/shoji9x9");
    mkdirSync(userHome, { recursive: true });
    writeFileSync(join(userHome, "common.jsonc"), '{ "review_tool": "none" }');
    const r = run(script, { cwd: s.root, env: { ...s.env, XDG_CONFIG_HOME: "relative" } });
    expect(r.status, r.stderr).toBe(0);
    expect(parse(r.stdout)).toEqual({ value: "none", source: "user" });
  });

  test(`${name}: ファイルはあるがキーが無い場合は、無い場合と区別して参照したファイルを残す`, () => {
    const s = setup();
    s.write("repo", '{ "conventions_doc": "AGENTS.md" }');
    const r = run(script, { cwd: s.root, env: s.env });
    expect(r.status, r.stderr).toBe(0);
    expect(parse(r.stdout)).toEqual({ value: "copilot", source: "default" });
    expect(r.stderr).toMatch(
      /common の設定ファイルに review_tool が無いため既定を使う（参照: .*common\.jsonc）/,
    );
    expect(r.stderr).not.toMatch(/設定ファイルが無い/);
  });

  test.each([
    [
      "未知の値",
      '{ "review_tool": "gemini" }',
      /"gemini" は "copilot"・"claude-code"・"codex"・"local"・"none" のどれでもない/,
    ],
    ["知らないキー", '{ "review_tol": "codex" }', /知らないキー "review_tol"/],
    ["構文の誤り", '{ "review_tool": "codex" "x": 1 }', /JSONC として読めない/],
  ])(
    `${name}: 設定ファイルの%sは警告なしにデフォルトとして扱わず exit 2 で止まる`,
    (_label, text, want) => {
      const s = setup();
      s.write("repo", text);
      const r = run(script, { cwd: s.root, env: s.env });
      expect(r.status).toBe(2);
      expect(r.stdout).toBe("");
      expect(r.stderr).toMatch(want);
      expect(r.stderr).toMatch(/review_tool を決められない（skill-config\.mjs の終了コード 1）/);
    },
  );

  test(`${name}: 使わない層のファイルの誤りも止める（CLI の値があっても）`, () => {
    const s = setup();
    s.write("user", '{ "review_tool": "bogus" }');
    const r = run(script, { cwd: s.root, env: s.env, args: ["--review-tool", "codex"] });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/"bogus"/);
  });

  test(`${name}: 設定ファイルがあって Node.js が無ければ、デフォルトとして扱わず exit 2 で止まる`, () => {
    const s = setup();
    s.write("repo", '{ "review_tool": "codex" }');
    const r = run(script, { cwd: s.root, env: { ...s.env, PATH: pathWithoutNode(s.base) } });
    expect(r.status).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(
      /設定ファイル（.*common\.jsonc）があるのに Node\.js が無いので読めない/,
    );
  });

  test.each([
    ["値のある", "codex"],
    ["空の", ""],
  ])(
    `${name}: %s SKILLS_REVIEW_TOOL は、Node.js が無くても移行の手順を示して止まる`,
    (_label, value) => {
      const s = setup();
      for (const env of [s.env, { ...s.env, PATH: pathWithoutNode(s.base) }]) {
        const r = run(script, { cwd: s.root, env: { ...env, SKILLS_REVIEW_TOOL: value } });
        expect(r.status).toBe(2);
        expect(r.stdout).toBe("");
        expect(r.stderr).toMatch(
          /旧い場所の設定が残っているので止める[\s\S]*環境変数 SKILLS_REVIEW_TOOL は使わなくなった。値を common\.local\.jsonc/,
        );
      }
    },
  );

  test(`${name}: どの名前空間の skills.yml も、移行の手順を示して止まる`, () => {
    const s = setup();
    mkdirSync(join(s.root, ".config/skills/shoji9x9"), { recursive: true });
    writeFileSync(
      join(s.root, ".config/skills/shoji9x9/skills.yml"),
      "version: 1\nskills:\n  common:\n    review_tool: codex\n",
    );
    const r = run(script, { cwd: s.root, env: s.env });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/skills\.yml が残っている。skills\.common の節を common\.jsonc に/);
  });

  test(`${name}: CLI の未知の値は、設定を読まずに exit 2 で止まり、出所を添える`, () => {
    const s = setup();
    const r = run(script, { cwd: s.root, env: s.env, args: ["--review-tool", "gemini"] });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/受理しない review_tool: 'gemini'（出所: cli）/);
  });

  test.each(["copilot", "claude-code", "codex", "local", "none"])(
    `${name}: 受理する値 %s を CLI からも設定ファイルからも受け取る`,
    (value) => {
      const s = setup();
      const cli = run(script, { cwd: s.root, env: s.env, args: ["--review-tool", value] });
      expect(cli.status, cli.stderr).toBe(0);
      expect(parse(cli.stdout)).toEqual({ value, source: "cli" });
      s.write("repo", JSON.stringify({ review_tool: value }));
      const file = run(script, { cwd: s.root, env: s.env });
      expect(file.status, file.stderr).toBe(0);
      expect(parse(file.stdout)).toEqual({ value, source: "repo" });
    },
  );

  test.each([
    ["値の無い --review-tool", ["--review-tool"], /--review-tool に値がない/],
    ["空の --review-tool", ["--review-tool", ""], /--review-tool の値が空/],
    ["値の無い --root", ["--root"], /--root に値がない/],
    ["空の --root", ["--root", ""], /--root の値が空/],
    ["不明な引数", ["--config", "x"], /不明な引数: --config/],
  ])(`${name}: %s は下の層へ進まず exit 64`, (_label, args, want) => {
    const s = setup();
    const r = run(script, { cwd: s.root, env: s.env, args });
    expect(r.status).toBe(64);
    expect(r.stderr).toMatch(want);
  });

  test(`${name}: --help は usage を出して exit 0`, () => {
    const s = setup();
    const r = run(script, { cwd: s.root, env: s.env, args: ["--help"] });
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/usage: resolve-review-tool\.sh/);
  });

  test(`${name}: --root で渡したリポジトリの設定を読む`, () => {
    const s = setup();
    s.write("repo", '{ "review_tool": "none" }');
    const r = run(script, { cwd: s.base, env: s.env, args: ["--root", s.root] });
    expect(r.status, r.stderr).toBe(0);
    expect(parse(r.stdout)).toEqual({ value: "none", source: "repo" });
  });

  // cwd からの相対で探すと、サブディレクトリから起動しただけでファイルの層が警告なしに飛ばされ、
  // `source=default` を正しい結果として報告する。リポジトリのルートを基準にしていることを測る。
  test(`${name}: サブディレクトリから起動しても、リポジトリのルートの設定を読む`, () => {
    const s = setup();
    s.write("repo", '{ "review_tool": "codex" }');
    const sub = join(s.root, "a/b");
    mkdirSync(sub, { recursive: true });
    const r = run(script, { cwd: sub, env: s.env });
    expect(r.status, r.stderr).toBe(0);
    expect(parse(r.stdout)).toEqual({ value: "codex", source: "repo" });
  });

  test(`${name}: git の外ではデフォルトとして扱うが、参照したパスを stderr に残す`, () => {
    const s = setup();
    const outside = join(s.base, "outside");
    mkdirSync(outside);
    const r = run(script, { cwd: outside, env: s.env });
    expect(r.status, r.stderr).toBe(0);
    expect(parse(r.stdout)).toEqual({ value: "copilot", source: "default" });
    expect(r.stderr).toMatch(/参照: .*outside\/\.config\/skills\/shoji9x9\/common\.jsonc/);
  });

  test(`${name}: 誤検知しないことの確認（実リポジトリ）: リポジトリの実設定を解決できる`, () => {
    // 実リポジトリの common.jsonc を一時リポジトリへコピーして読む。リポジトリのルートで実行すると、
    // 開発者の手元の common.local.jsonc（gitignore される人ごと・リポジトリ限定の層）が先に読まれ、結果が人によって変わる。
    const s = setup();
    s.write("repo", readFileSync(join(repoRoot, ".config/skills/shoji9x9/common.jsonc"), "utf8"));
    const r = run(script, { cwd: s.root, env: s.env });
    expect(r.status, r.stderr).toBe(0);
    const out = parse(r.stdout);
    expect(out.source).toBe("repo");
    expect(["copilot", "claude-code", "codex", "local", "none"]).toContain(out.value);
  });
}

test("2 スキルの同梱コピーは同一内容（配布境界をまたいで drift させない）", () => {
  const [a, b] = SCRIPTS.map((s) => readFileSync(join(repoRoot, s), "utf8"));
  expect(a).toBe(b);
  expect(a.length).toBeGreaterThan(0);
});
