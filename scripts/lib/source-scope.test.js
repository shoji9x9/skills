// エージェント用のコピーとリンクの判定（source-scope.js）の回帰テスト。
//
// 状態空間の軸と、各セルに置いた入力:
//
// | 軸                         | 値                                                                      |
// | -------------------------- | ----------------------------------------------------------------------- |
// | .agents/skills/<name>/     | skills/<name>/ が在る（コピー）/ 無い（private skill。印の有無は問わない） |
// | .agents/ のそれ以外        | .agents/rules/                                                          |
// | リンクのディレクトリ       | .claude/rules/ / .claude/skills/ / .github/instructions/ / .claude/ のその他の実体 / 名前が前方一致するだけの別ディレクトリ |
// | .agents/skills/ の有無     | 在る / 無い                                                              |
import { expect, test } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { agentCopyGlobs, copySkillNames, isAgentCopy, sourceSkillNames } from "./source-scope.js";
import { makeTempDir } from "./test-tmpdir.js";

function makeRoot(files) {
  const root = makeTempDir("source-scope-");
  for (const f of files) {
    mkdirSync(dirname(join(root, f)), { recursive: true });
    writeFileSync(join(root, f), "");
  }
  return root;
}

const ROOT_FILES = [
  "skills/pub/SKILL.md",
  ".agents/skills/pub/SKILL.md",
  ".agents/skills/priv/SKILL.md",
  ".agents/skills/priv/.private-skill",
  ".agents/skills/nomark/SKILL.md",
  ".agents/rules/r.md",
];

test("skills/ に同名の実体があるものだけをコピーとし、それ以外（印の無いものを含む）は実体とする", () => {
  const root = makeRoot(ROOT_FILES);
  expect(copySkillNames(root)).toEqual(["pub"]);
  expect(sourceSkillNames(root)).toEqual(["nomark", "priv"]);
});

test.each([
  [".agents/skills/pub/SKILL.md", true],
  [".agents/skills/pub/scripts/a.sh", true],
  [".claude/skills/pub", true],
  [".claude/rules/r.md", true],
  [".claude/settings.json", false],
  [".github/instructions/r.instructions.md", true],
  [".agents/skills/priv/SKILL.md", false],
  [".agents/skills/nomark/SKILL.md", false],
  [".agents/rules/r.md", false],
  ["skills/pub/SKILL.md", false],
  [".claude/rules-old/x.md", false],
  [".github/workflows/ci.yml", false],
])("isAgentCopy(%s) は %s", (rel, expected) => {
  expect(isAgentCopy(makeRoot(ROOT_FILES), rel)).toBe(expected);
});

test("除外のパターンは、リンクのディレクトリとコピーのディレクトリだけを挙げる", () => {
  expect(agentCopyGlobs(makeRoot(ROOT_FILES))).toEqual([
    ".claude/rules/**",
    ".claude/skills/**",
    ".github/instructions/**",
    ".agents/skills/pub/**",
  ]);
});

test(".agents/skills/ が無ければ、コピーも private skill も 0 件", () => {
  const root = makeRoot(["skills/pub/SKILL.md"]);
  expect(copySkillNames(root)).toEqual([]);
  expect(sourceSkillNames(root)).toEqual([]);
});
