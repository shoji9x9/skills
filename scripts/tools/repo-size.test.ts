import { describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  COMMON,
  classify,
  countLines,
  formatMarkdown,
  main,
  summarize,
  type Entry,
  type Report,
} from "./repo-size.ts";
import { parseJsonAs } from "../lib/parse-as.ts";
import { makeTempDir } from "../lib/testing/test-tmpdir.ts";
import { CHILD_TIMEOUT_MS } from "../lib/testing/child-timeout.ts";

const script = join(dirname(fileURLToPath(import.meta.url)), "repo-size.ts");
const skills = new Set(["alpha", "beta"]);
const privateSkills = new Set(["secret"]);
const cls = (path: string) => classify(path, skills, privateSkills);

describe("ファイルの分類", () => {
  test.each([
    ["skills/alpha/SKILL.md", "alpha", "main"],
    ["skills/alpha/scripts/run.mjs", "alpha", "main"],
    ["skills/alpha/references/fixtures/sample.json", "alpha", "fixture"],
    ["evals/alpha/evals.json", "alpha", "test"],
    ["evals/alpha/README.md", "alpha", "test"],
    ["evals/alpha/fixtures/case/input.md", "alpha", "fixture"],
    ["scripts/skills/beta/run.test.ts", "beta", "test"],
    ["scripts/skills/beta/helper.ts", "beta", "test"],
    ["scripts/skills/beta/sub/run.mutations.json", "beta", "test"],
    ["scripts/skills/beta/data-fixture.ts", "beta", "fixture"],
    [".agents/skills/secret/SKILL.md", "secret", "main"],
    [".agents/skills/secret/.private-skill", "secret", "main"],
    ["scripts/skills/secret/run.test.ts", "secret", "test"],
  ])("%s は %s の %s", (path, owner, kind) => {
    expect(cls(path)).toEqual({ excluded: false, owner, kind });
  });

  test.each([
    ["scripts/skills/_cross/shared.test.ts", "test"],
    ["scripts/skills/loose.ts", "test"],
    ["scripts/gates/docs/check.ts", "main"],
    ["scripts/gates/docs/check.test.ts", "test"],
    ["scripts/gates/docs/check.mutations.json", "test"],
    ["scripts/lib/testing/helper.ts", "test"],
    ["scripts/mutation/runner.ts", "test"],
    ["scripts/coverage/run.ts", "test"],
    ["scripts/eval/run.ts", "test"],
    ["scripts/lib/fixtures/input.txt", "fixture"],
    ["docs/testing.md", "main"],
    ["AGENTS.md", "main"],
    [".github/workflows/ci.yml", "main"],
    ["evals/README.md", "test"],
    ["skills/README.md", "main"],
    ["scripts/tools/a.config.ts", "main"],
    ["skills-extra/alpha/x.md", "main"],
    ["testsuite/x.md", "main"],
    ["scripts/lib/fixtures.ts", "main"],
  ])("%s はリポジトリ共通の %s", (path, kind) => {
    expect(cls(path)).toEqual({ excluded: false, owner: COMMON, kind });
  });

  test.each([
    ["tests/alpha/iteration-1/benchmark.json", "記録"],
    [".kaizen/2026-01-01-a.md", "記録"],
    [".agent-usage/records/a.csv", "記録"],
    [".agents/skills/alpha/SKILL.md", "インストール済みのコピー"],
    [".agents/skills/external/SKILL.md", "インストール済みのコピー"],
    [".claude/settings.json", "インストール済みのコピー"],
    ["pnpm-lock.yaml", "生成物と設定"],
    ["mise.lock", "生成物と設定"],
    ["package.json", "生成物と設定"],
    [".textlint/word-list.md", "生成物と設定"],
    ["tsconfig.json", "生成物と設定"],
    ["tsconfig.repo.json", "生成物と設定"],
    ["vitest.config.ts", "生成物と設定"],
    [".config/skills/shoji9x9/common.jsonc", "生成物と設定"],
    [".codex/config.toml", "生成物と設定"],
    [".github/hooks/kaizen.json", "生成物と設定"],
  ])("%s は数えない（%s）", (path, reason) => {
    expect(cls(path)).toEqual({ excluded: true, reason });
  });

  test.each([
    ["evals/ghost/evals.json"],
    ["skills/ghost/SKILL.md"],
    ["scripts/skills/ghost/run.test.ts"],
  ])("スキルとして知らない名前の置き場所 %s は例外にする", (path) => {
    expect(() => cls(path)).toThrow(/ghost/);
  });
});

describe("行数", () => {
  test.each([
    ["空のファイル", 0, ""],
    ["改行で終わらない 1 行", 1, "a"],
    ["改行で終わる 1 行", 1, "a\n"],
    ["最後の行に改行が無い 2 行", 2, "a\nb"],
    ["空の行だけの 2 行", 2, "\n\n"],
    ["CRLF の 2 行", 2, "a\r\nb\r\n"],
  ])("%s は %i 行と数える", (_name, lines, text) => {
    expect(countLines(Buffer.from(text))).toBe(lines);
  });

  test("NUL を含むファイルはバイナリとして null を返す", () => {
    expect(countLines(Buffer.from([0x61, 0x00, 0x0a]))).toBeNull();
  });
});

const entry = (path: string, text: string, mode = "100644"): Entry => ({
  path,
  mode,
  content: Buffer.from(text),
});

describe("集計", () => {
  test("スキルごとに本体・テスト・fixture のファイル数と行数を足し、数えないファイルを理由ごとに数える", () => {
    const report = summarize("c0ffee", [
      entry("skills/beta/SKILL.md", "a\nb\n"),
      entry("skills/beta/scripts/run.mjs", "x\n"),
      entry("skills/alpha/SKILL.md", "a\n"),
      entry("evals/beta/evals.json", "{}\n"),
      entry("evals/beta/fixtures/in.md", "1\n2\n3\n"),
      entry(".agents/skills/secret/.private-skill", ""),
      entry(".agents/skills/secret/SKILL.md", "s\n"),
      entry(".agents/skills/beta/SKILL.md", "a\nb\n"),
      entry("README.md", "r\n"),
      entry("scripts/lib/a.test.ts", "t\nt\n"),
      entry("tests/beta/benchmark.json", "{}\n"),
      entry(".claude/skills/beta", "../../.agents/skills/beta", "120000"),
    ]);
    expect(report.commit).toBe("c0ffee");
    expect(report.rows.map((r) => r.owner)).toEqual(["alpha", "beta", "secret", COMMON]);
    expect(report.rows[1]).toEqual({
      owner: "beta",
      main: { files: 2, lines: 3 },
      test: { files: 1, lines: 1 },
      fixture: { files: 1, lines: 3 },
    });
    expect(report.rows[2]?.main).toEqual({ files: 2, lines: 1 });
    expect(report.rows[3]).toEqual({
      owner: COMMON,
      main: { files: 1, lines: 1 },
      test: { files: 1, lines: 2 },
      fixture: { files: 0, lines: 0 },
    });
    expect(report.excluded).toEqual({
      インストール済みのコピー: 1,
      記録: 1,
      シンボリックリンク: 1,
    });
  });

  test("バイナリのファイルは、ファイル数に数えて行数に数えない", () => {
    const report = summarize("c0ffee", [
      entry("skills/alpha/SKILL.md", "a\n"),
      { path: "skills/alpha/assets/icon.png", mode: "100644", content: Buffer.from([0, 1, 0x0a]) },
    ]);
    expect(report.rows[0]?.main).toEqual({ files: 2, lines: 1 });
  });

  test("SKILL.md の無いディレクトリはスキルとして数えず、その名前の eval は例外にする", () => {
    expect(() =>
      summarize("c0ffee", [
        entry("skills/alpha/notes.md", "a\n"),
        entry("evals/alpha/evals.json", "{}\n"),
      ]),
    ).toThrow(/alpha/);
  });

  test("Markdown の表に、スキルの小計・リポジトリ共通・合計の行と、数えなかったファイルを書く", () => {
    const report = summarize("c0ffee", [
      entry("skills/alpha/SKILL.md", "a\n".repeat(1200)),
      entry("evals/alpha/evals.json", "{}\n"),
      entry("README.md", "r\n"),
      entry("pnpm-lock.yaml", "x\n"),
    ]);
    const md = formatMarkdown(report);
    expect(md.startsWith("# リポジトリの規模\n")).toBe(true);
    expect(md).toContain("commit: c0ffee");
    expect(md).toContain("| alpha | 1 | 1,200 | 1 | 1 | 0 | 0 |");
    expect(md).toContain("| スキルの小計 | 1 | 1,200 | 1 | 1 | 0 | 0 |");
    expect(md).toContain(`| ${COMMON} | 1 | 1 | 0 | 0 | 0 | 0 |`);
    expect(md).toContain("| 合計 | 2 | 1,201 | 1 | 1 | 0 | 0 |");
    expect(md).toContain("数えなかったファイル: 生成物と設定 1 件");
  });

  test("数えなかったファイルが無ければ「なし」と書く", () => {
    const md = formatMarkdown(summarize("c0ffee", [entry("README.md", "r\n")]));
    expect(md).toContain("数えなかったファイル: なし");
  });
});

describe("CLI", () => {
  function git(root: string, ...args: string[]) {
    const res = spawnSync("git", args, { cwd: root, encoding: "utf8", timeout: CHILD_TIMEOUT_MS });
    if (res.status !== 0) throw new Error(`git ${args.join(" ")}: ${res.stderr}`);
    return res.stdout.trim();
  }

  /** files を commit した git のリポジトリを作る。 */
  function makeRepo(files: Record<string, string>): string {
    const root = makeTempDir("repo-size-");
    git(root, "init", "-q");
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), text);
    }
    git(root, "add", "-A");
    git(root, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", "init");
    return root;
  }

  function run(root: string, ...args: string[]) {
    return spawnSync(process.execPath, [script, ...args], {
      cwd: root,
      encoding: "utf8",
      timeout: CHILD_TIMEOUT_MS,
    });
  }

  test("commit の中身を数え、commit していない変更は数えない", () => {
    const root = makeRepo({ "skills/alpha/SKILL.md": "a\nb\n", "README.md": "r\n" });
    writeFileSync(join(root, "skills/alpha/SKILL.md"), "a\nb\nc\nd\n");
    writeFileSync(join(root, "skills/alpha/new.md"), "n\n");
    const res = run(root);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain(`commit: ${git(root, "rev-parse", "HEAD")}`);
    expect(res.stdout).toContain("| alpha | 1 | 2 | 0 | 0 | 0 | 0 |");
  });

  test("rev を渡すと、その commit を数える", () => {
    const root = makeRepo({ "skills/alpha/SKILL.md": "a\n" });
    const first = git(root, "rev-parse", "HEAD");
    writeFileSync(join(root, "skills/alpha/more.md"), "m\n");
    git(root, "add", "-A");
    git(root, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", "more");
    const res = run(root, first);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain(`commit: ${first}`);
    expect(res.stdout).toContain("| alpha | 1 | 1 |");
  });

  test("シンボリックリンクは数えない", () => {
    const root = makeRepo({ "skills/alpha/SKILL.md": "a\n" });
    symlinkSync("skills/alpha/SKILL.md", join(root, "link.md"));
    git(root, "add", "-A");
    git(root, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", "link");
    const res = run(root, "--json");
    expect(res.status).toBe(0);
    const report = parseJsonAs<Report>(res.stdout);
    expect(report.excluded).toEqual({ シンボリックリンク: 1 });
    expect(report.rows[0]).toEqual({
      owner: "alpha",
      main: { files: 1, lines: 1 },
      test: { files: 0, lines: 0 },
      fixture: { files: 0, lines: 0 },
    });
  });

  test("存在しない rev は集計できないとして 2 で終わる", () => {
    const root = makeRepo({ "README.md": "r\n" });
    const res = run(root, "no-such-rev");
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("集計できない");
  });

  test("ファイルが 0 件の commit は集計できないとして 2 で終わる", () => {
    const root = makeTempDir("repo-size-empty-");
    git(root, "init", "-q");
    git(
      root,
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@example.com",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "e",
    );
    const res = run(root);
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("0 件");
  });

  test("スキルとして知らない名前の置き場所があれば 2 で終わる", () => {
    const root = makeRepo({ "evals/ghost/evals.json": "{}\n" });
    const res = run(root);
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("ghost");
  });

  test.each([[["a", "b"]], [["--unknown"]]])("引数 %j は使い方を示して 2 で終わる", (args) => {
    expect(main(args, makeTempDir("repo-size-args-"))).toBe(2);
  });
});
