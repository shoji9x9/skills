// markdownlint-cli2 が見る範囲（.markdownlint-cli2.yaml の globs）が、文書の実体と一致しているかの回帰テスト。
//
// .agents/skills/ はインストール済みのコピーなので除くが、private skill（.private-skill を持つもの）は実体なので
// 名前を挙げて含め直している。private skill を足したのに挙げ忘れると、その文書は markdownlint に一度も見られない。
// rule の実体（.agents/rules/）を見て、そのリンク（.github/instructions/）を除くことも確かめる。
import { expect, test } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const globs = yaml.load(readFileSync(join(repoRoot, ".markdownlint-cli2.yaml"), "utf8")).globs;

const privateSkills = readdirSync(join(repoRoot, ".agents/skills")).filter((name) =>
  existsSync(join(repoRoot, ".agents/skills", name, ".private-skill")),
);
const reincluded = globs
  .map((g) => /^\.agents\/skills\/([^/!*]+)\/\*\*\/\*\.md$/.exec(g)?.[1])
  .filter(Boolean);

test("private skill が 1 件以上あり、すべてを名前で含め直している", () => {
  expect(privateSkills.length).toBeGreaterThan(0);
  expect(reincluded.sort()).toEqual([...privateSkills].sort());
});

test("スキルのコピーと rule のリンクを除き、rule の実体は除かない", () => {
  expect(globs).toContain("!.agents/skills/**");
  expect(globs).toContain("!.github/instructions/**");
  expect(globs).not.toContain("!.agents/**");
  expect(globs.filter((g) => g.startsWith("!.agents/rules"))).toEqual([]);
});

test("含め直しは除外より後に書く（前に書くと除外に打ち消される）", () => {
  const exclude = globs.indexOf("!.agents/skills/**");
  expect(exclude).toBeGreaterThanOrEqual(0);
  for (const name of reincluded) {
    expect(globs.indexOf(`.agents/skills/${name}/**/*.md`)).toBeGreaterThan(exclude);
  }
});
