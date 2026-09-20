// review_tool 解決スクリプト（pr-finalize-loop / pr-review-handle に同梱）の回帰テスト。
//
// 状態空間の軸と、各セルに置いた入力:
//
// | 軸       | 値                                                                       |
// | -------- | ------------------------------------------------------------------------ |
// | 層       | CLI / 環境変数 / 設定ファイル / 既定（優先順位どおりに上書きされるか）    |
// | 値       | 受理する 4 値 / 未知値 / 空文字                                           |
// | 設定内容 | 正常 / 行末コメント付き / 引用符付き / 別セクションの同名キー / キー欠落 / ファイル不在 |
// | 引数     | 正常 / 値の無い --review-tool / 不明な引数                                |
//
// 陰性コントロールとして**リポジトリの実設定**も 1 件読む（合成 YAML だけだと、
// 実ファイルの書き方〈行末コメント〉と解析がずれていても緑のまま通る）。
import { test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPTS = [
  "skills/pr-finalize-loop/scripts/resolve-review-tool.sh",
  "skills/pr-review-handle/scripts/resolve-review-tool.sh",
];

function run(scriptRel, { args = [], env = {}, config, cwd = repoRoot } = {}) {
  const argv = [join(repoRoot, scriptRel), ...args];
  if (config !== undefined) argv.push("--config", config);
  return spawnSync("bash", argv, {
    encoding: "utf8",
    cwd,
    // 呼び出し側の SKILLS_REVIEW_TOOL に左右されないよう、毎回明示的に組み立てる。
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
  });
}

const parse = (stdout) =>
  Object.fromEntries(
    stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => l.split("=")),
  );

function withConfig(body, fn) {
  const dir = mkdtempSync(join(tmpdir(), "review-tool-"));
  const path = join(dir, "skills.yml");
  writeFileSync(path, body);
  try {
    fn(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const CONFIG = `version: 1
skills:
  common:
    conventions_doc: AGENTS.md # 規約ドキュメント
    review_tool: codex # copilot | claude-code | codex | none
  git-worktree:
    review_tool: copilot # 別セクションの同名キー（拾ってはいけない）
`;

for (const script of SCRIPTS) {
  const name = script.split("/")[1];

  test(`${name}: 設定ファイルから読み、出所を config と報告する（行末コメントを落とす）`, () => {
    withConfig(CONFIG, (path) => {
      const r = run(script, { config: path });
      expect(r.status).toBe(0);
      expect(parse(r.stdout)).toEqual({ value: "codex", source: "config" });
    });
  });

  test(`${name}: 環境変数は設定ファイルより優先する`, () => {
    withConfig(CONFIG, (path) => {
      const r = run(script, { config: path, env: { SKILLS_REVIEW_TOOL: "none" } });
      expect(parse(r.stdout)).toEqual({ value: "none", source: "env" });
    });
  });

  test(`${name}: CLI は環境変数より優先する`, () => {
    withConfig(CONFIG, (path) => {
      const r = run(script, {
        config: path,
        env: { SKILLS_REVIEW_TOOL: "none" },
        args: ["--review-tool", "claude-code"],
      });
      expect(parse(r.stdout)).toEqual({ value: "claude-code", source: "cli" });
    });
  });

  test(`${name}: どの層にも無ければ既定 copilot（出所 default）`, () => {
    const r = run(script, { config: join(tmpdir(), "does-not-exist.yml") });
    expect(r.status).toBe(0);
    expect(parse(r.stdout)).toEqual({ value: "copilot", source: "default" });
    // 設定ファイルが無いのは正常系なので、解析器のエラーを stderr へ漏らさない。
    expect(r.stderr).toBe("");
  });

  test(`${name}: common に review_tool が無ければ別セクションを拾わず既定へ`, () => {
    withConfig(
      "version: 1\nskills:\n  common:\n    conventions_doc: AGENTS.md\n  git-worktree:\n    review_tool: codex\n",
      (path) => {
        expect(parse(run(script, { config: path }).stdout)).toEqual({
          value: "copilot",
          source: "default",
        });
      },
    );
  });

  test(`${name}: 引用符付きの値も読む`, () => {
    withConfig('version: 1\nskills:\n  common:\n    review_tool: "none"\n', (path) => {
      expect(parse(run(script, { config: path }).stdout)).toEqual({
        value: "none",
        source: "config",
      });
    });
  });

  test(`${name}: 未知値は黙って既定へ倒さず exit 2 で停止し、出所を添える`, () => {
    withConfig("version: 1\nskills:\n  common:\n    review_tool: gemini\n", (path) => {
      const r = run(script, { config: path });
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/受理しない review_tool: 'gemini'（出所: config）/);
    });
  });

  test(`${name}: 環境変数の未知値も停止する（出所は env）`, () => {
    const r = run(script, { env: { SKILLS_REVIEW_TOOL: "bogus" } });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/出所: env/);
  });

  test(`${name}: 空の環境変数は未設定として扱う`, () => {
    withConfig(CONFIG, (path) => {
      const r = run(script, { config: path, env: { SKILLS_REVIEW_TOOL: "" } });
      expect(parse(r.stdout)).toEqual({ value: "codex", source: "config" });
    });
  });

  test(`${name}: 引数不正は exit 64`, () => {
    expect(run(script, { args: ["--review-tool"] }).status).toBe(64);
    expect(run(script, { args: ["--nope"] }).status).toBe(64);
  });

  // 既定の共有設定パスは cwd 相対だと、サブディレクトリから起動しただけで config 層が
  // 黙って飛ばされ `source=default` を正しい解決結果として報告する（誤報そのもの）。
  // リポジトリルート基準で解決していることを、ルートとサブディレクトリの両方で測る。
  test.each([
    ["リポジトリルート", repoRoot],
    ["サブディレクトリ", join(repoRoot, "docs")],
    ["深いサブディレクトリ", join(repoRoot, "skills/pr-finalize-loop/scripts")],
  ])(`${name}: --config 無しでも %s から同じ層を読む`, (_where, cwd) => {
    const r = run(script, { cwd });
    expect(r.status, r.stderr).toBe(0);
    expect(parse(r.stdout).source).toBe("config");
  });

  test(`${name}: git の外では既定へ倒すが、参照したパスを stderr に残す`, () => {
    const dir = mkdtempSync(join(tmpdir(), "review-tool-nogit-"));
    try {
      const r = run(script, { cwd: dir });
      expect(r.status, r.stderr).toBe(0);
      expect(parse(r.stdout)).toEqual({ value: "copilot", source: "default" });
      expect(r.stderr).toMatch(/参照: .*skills\.yml/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test(`${name}: 陰性コントロール（実データ）: リポジトリの実設定を解決できる`, () => {
    const r = run(script, { config: join(repoRoot, ".config/skills/shoji9x9/skills.yml") });
    expect(r.status).toBe(0);
    const out = parse(r.stdout);
    expect(out.source).toBe("config");
    expect(["copilot", "claude-code", "codex", "none"]).toContain(out.value);
  });
}

test("2 スキルの同梱コピーは同一内容（配布境界をまたいで drift させない）", () => {
  const [a, b] = SCRIPTS.map(
    (s) => spawnSync("cat", [join(repoRoot, s)], { encoding: "utf8" }).stdout,
  );
  expect(a).toBe(b);
  expect(a.length).toBeGreaterThan(0);
});
