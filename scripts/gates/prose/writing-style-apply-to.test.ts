// Copilot のレビューに読ませる 2 つの文書の applyTo が、lint-prose が文章を見るファイルをすべて含むことの回帰テスト。
// 2 つの文書は、文章の規則（skills/writing-style/references/rules.md）と、このリポジトリでの対象（docs/writing-style.md）である。
// applyTo は、GitHub Copilot のレビューがその文書を読み込むファイルを決める。
//
// applyTo を狭めると、外れたファイルだけを変える PR では Copilot が規則を読み込まない。エラーは出ないので、ここで確かめる。
// 規則は人が読む文章すべてに当てるので、applyTo が lint-prose の対象より広いことは許す。
// - lint-prose の対象の見本（拡張子ごとに、ドットで始まるディレクトリ・途中のドットのディレクトリ・ドットで始まるファイルを含む 4 件と、evals.json）が、applyTo のどれかの glob に当たる
// - 実リポジトリの lint-prose の対象が、どれも applyTo のどれかの glob に当たる
// - applyTo が、すべてのファイルに当てる 3 つの glob（`**`・`**/.*/**`・`**/.*`）を持つ。上の 2 つは狭めたことしか検出しないので、
//   すべてのファイルに当てるという意図からの変更（別の glob への置き換え）はこれで検出する
// 見本の拡張子は lint-prose が使う一覧から作る。拡張子で決まらない対象（evals.json）は、見本を手で書いて hasStrings で対象であることを確かめる。
import { readFileSync } from "node:fs";
import { dirname, join, matchesGlob } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
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

// Copilot に読ませる 2 つの文書。規則（配布スキル）と、このリポジトリでの対象と対象外。
const DOCS = ["skills/writing-style/references/rules.md", "docs/writing-style.md"];
const ALL_FILES = ["**", "**/.*/**", "**/.*"];
// lint-prose の対象はリポジトリ全体を列挙して決めるので、文書ごとに繰り返さず 1 回だけ求める。
const targets = listTargets(repoRoot);

test("見本はどれも lint-prose の対象である", () => {
  for (const s of samples) {
    expect(s.endsWith(".md") || hasComments(s) || hasStrings(s), s).toBe(true);
  }
});

describe.each(DOCS)("%s", (doc) => {
  const globs = applyToGlobs(readFileSync(join(repoRoot, doc), "utf8"));

  test("実リポジトリ: applyTo を読める", () => {
    expect(globs.length).toBeGreaterThan(0);
  });

  test("実リポジトリ: applyTo は、すべてのファイルに当てる glob をすべて持つ", () => {
    expect(globs).toEqual(expect.arrayContaining(ALL_FILES));
  });

  test("実リポジトリ: lint-prose の対象は、どれも applyTo の glob に当たる", () => {
    const missing = samples.filter((s) => !globs.some((g) => matchesGlob(s, g)));
    expect(missing).toEqual([]);
  });

  test("実リポジトリ: lint-prose が実際に見るファイルは、どれも applyTo の glob に当たる", () => {
    expect(targets.length).toBeGreaterThan(100);
    const missing = targets.filter((s) => !globs.some((g) => matchesGlob(s, g)));
    expect(missing).toEqual([]);
  });
});
