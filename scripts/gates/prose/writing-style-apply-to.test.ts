// docs/writing-style.md の applyTo（GitHub Copilot のレビューがこの規約を読み込むファイル）が、
// lint-prose が文章を見るファイルと一致することの回帰テスト。
//
// lint-prose に拡張子を足しても applyTo は変わらず、そのファイルだけを変える PR では Copilot がこの規約を読み込まない。
// エラーは出ないので、ここで両方向の一致を確かめる。
// - lint-prose の対象の見本（拡張子ごとに、ドットで始まるディレクトリ・途中のドットのディレクトリ・ドットで始まるファイルを含む 4 件と、evals.json）が、applyTo のどれかの glob に当たる
// - 実リポジトリの lint-prose の対象が、どれも applyTo のどれかの glob に当たる
// - applyTo の各 glob が、lint-prose の対象の見本のどれかに当たる（対象でない種類を足していない）
// 見本の拡張子は lint-prose が使う一覧から作る。拡張子で決まらない対象（evals.json）は、見本を手で書いて hasStrings で対象であることを確かめる。
import { readFileSync } from "node:fs";
import { dirname, join, matchesGlob } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { COMMENT_EXTENSIONS, hasComments } from "../../lib/text/code-comments.ts";
import { JS_EXTENSIONS, hasStrings } from "../../lib/text/code-strings.ts";
import { splitFrontmatter } from "../../lib/text/frontmatter.ts";
import { loadYamlAs } from "../../lib/text/yaml-as.ts";
import { listTargets } from "./lint-prose.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** applyTo を glob の一覧にする。読めなければ空にし、下のテストで失敗させる。 */
function applyToGlobs(markdown: string): string[] {
  const split = splitFrontmatter(markdown);
  if (!split) return [];
  const fm = loadYamlAs<{ applyTo?: unknown }>(split.fm);
  return typeof fm?.applyTo === "string" ? fm.applyTo.split(",").map((g) => g.trim()) : [];
}

// ドットで始まるディレクトリ（`.kaizen/`・`.agents/rules/`・`.github/workflows/`）・途中のドットのディレクトリ（fixture の `.replace/`）・ドットで始まるファイル（`.markdownlint.yaml`）の見本も置く。
// `**` がドットで始まるディレクトリに当たらない glob の実装（node の matchesGlob など）でも、applyTo が当たることを確かめる。
const samples = [
  ...new Set(
    [".md", ...COMMENT_EXTENSIONS, ...JS_EXTENSIONS].flatMap((ext) => [
      `dir/sub/file${ext}`,
      `.dir/sub/file${ext}`,
      `dir/.sub/x/file${ext}`,
      `.file${ext}`,
    ]),
  ),
  "evals/name/evals.json",
];

const globs = applyToGlobs(readFileSync(join(repoRoot, "docs/writing-style.md"), "utf8"));

test("見本はどれも lint-prose の対象である", () => {
  for (const s of samples) {
    expect(s.endsWith(".md") || hasComments(s) || hasStrings(s), s).toBe(true);
  }
});

test("実リポジトリ: docs/writing-style.md の applyTo を読める", () => {
  expect(globs.length).toBeGreaterThan(0);
});

test("実リポジトリ: lint-prose の対象は、どれも applyTo の glob に当たる", () => {
  const missing = samples.filter((s) => !globs.some((g) => matchesGlob(s, g)));
  expect(missing).toEqual([]);
});

test("実リポジトリ: lint-prose が実際に見るファイルは、どれも applyTo の glob に当たる", () => {
  const targets = listTargets(repoRoot);
  expect(targets.length).toBeGreaterThan(100);
  const missing = targets.filter((s) => !globs.some((g) => matchesGlob(s, g)));
  expect(missing).toEqual([]);
});

test("実リポジトリ: applyTo の glob は、どれも lint-prose の対象に当たる", () => {
  const extra = globs.filter((g) => !samples.some((s) => matchesGlob(s, g)));
  expect(extra).toEqual([]);
});
