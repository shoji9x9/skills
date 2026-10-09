// 各 lint と整形の対象範囲が、エージェント用のコピーとリンクだけを除いているかの回帰テスト。
//
// `.agents/` にはコピー（インストール済みの配布スキル）と実体（rule と private skill）が一緒に置かれている。
// 除外を `.agents/**` と書くと実体も外れるが、除外で外れたファイルは出力に現れないので何も失敗しない
// （実際に private skill のスクリプトが lint も整形もされていなかった）。
// 除外するものの原本は scripts/lib/source-scope.js で、ここでは各ツールの設定がそれと一致するかを確かめる。
//
// | ツール                         | 除外の書き方                                       |
// | ------------------------------ | -------------------------------------------------- |
// | markdownlint-cli2              | .agents/skills/** を除き、private skill を名前で含め直す |
// | oxlint・oxfmt                  | 設定ファイルが source-scope.js から計算する          |
// | lefthook（ファイルを渡すジョブ） | exclude にコピーを名前で挙げる（否定パターンが無い）  |
// | CI の Shell lint・JSON lint    | run-on-sources.js が source-scope.js で選ぶ          |
import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { agentCopyGlobs, copySkillNames, sourceSkillNames } from "../lib/source-scope.js";
import oxlintConfig from "../../oxlint.config.ts";
import oxfmtConfig from "../../oxfmt.config.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(repoRoot, rel), "utf8");
const expected = agentCopyGlobs(repoRoot);

test("実リポジトリにコピーと private skill がそれぞれ 1 件以上ある（以下の比較が空集合どうしにならない）", () => {
  expect(copySkillNames(repoRoot).length).toBeGreaterThan(0);
  expect(sourceSkillNames(repoRoot).length).toBeGreaterThan(0);
});

// ---- markdownlint-cli2 ----

const globs = yaml.load(read(".markdownlint-cli2.yaml")).globs;
const reincluded = globs
  .map((g) => /^\.agents\/skills\/([^/!*]+)\/\*\*\/\*\.md$/.exec(g)?.[1])
  .filter(Boolean);

test("private skill が 1 件以上あり、すべてを名前で含め直している", () => {
  expect(reincluded.sort()).toEqual(sourceSkillNames(repoRoot));
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

// ---- oxlint・oxfmt ----

test("oxlint の ignorePatterns は、エージェント用のコピーとリンクだけを除く", () => {
  expect(oxlintConfig.ignorePatterns).toEqual(expected);
});

// oxfmt は、割り当てた種類の許可リスト（先頭の 3 行）の後に、エージェント用のコピーとリンクを除く。
// 許可リストの種類は、lefthook の oxfmt-* のジョブが渡す種類と一致させる（どちらかだけ広げると、
// pre-commit が渡したファイルを oxfmt が対象外として扱うか、割り当て外の種類を整形する）。
const oxfmtHead = oxfmtConfig.ignorePatterns.slice(0, 3);

test("oxfmt の ignorePatterns は、許可リストの後にエージェント用のコピーとリンクだけを除く", () => {
  expect(oxfmtHead[0]).toBe("**/*.*");
  expect(oxfmtHead[1]).toBe("!**/*/");
  expect(oxfmtHead[2]).toMatch(/^!\*\*\/\*\.\{[a-z,]+\}$/);
  expect(oxfmtConfig.ignorePatterns.slice(3)).toEqual(expected);
});

// ---- lefthook ----

const jobs = yaml
  .load(read("lefthook.yml"))
  ["pre-commit"].jobs.flatMap((j) => j.group?.jobs ?? [j]);
const byName = Object.fromEntries(jobs.map((j) => [j.name, j]));

// ファイルを渡して実行するジョブのうち、ツール側に除外の設定が無い（または対象 0 件で失敗する）もの。
// markdownlint と prose は、見る範囲を設定ファイルとスクリプトが決めるので exclude を持たない。
const EXCLUDING_JOBS = [
  "shfmt",
  "oxfmt-js",
  "oxfmt-json",
  "oxfmt-yaml",
  "shellcheck",
  "oxlint",
  "jsonlint",
  "js-yaml",
  "pagination",
];

test.each(EXCLUDING_JOBS)(
  "lefthook の %s は、エージェント用のコピーとリンクをすべて除く",
  (name) => {
    const exclude = byName[name]?.exclude ?? [];
    for (const glob of expected) expect(exclude).toContain(glob);
  },
);

test("lefthook の exclude は、コピーとリンク以外の .agents/ と .claude/ を除かない", () => {
  for (const job of jobs) {
    const extra = (job.exclude ?? []).filter(
      (g) => /^\.(agents|claude)\b|^\.github\/instructions/.test(g) && !expected.includes(g),
    );
    expect(extra, job.name).toEqual([]);
  }
});

// ---- CI ----

test("CI の Shell lint と JSON lint は、run-on-sources.js で対象を選ぶ（find で .agents を丸ごと除かない）", () => {
  const ci = read(".github/workflows/ci.yml");
  expect(ci).toMatch(/run: node scripts\/gates\/run-on-sources\.js --ext sh -- shellcheck\n/);
  expect(ci).toMatch(
    /run: node scripts\/gates\/run-on-sources\.js --ext json -- pnpm exec jsonlint/,
  );
  expect(ci).not.toContain('-path "./.agents"');
});

// ---- oxfmt の割り当てと lefthook ----

/** `*.{a,b}` / `*.a` / `!**\/*.{a,b}` から拡張子の一覧を取り出す。 */
function extsOf(glob) {
  const m = /\*\.(?:\{([a-z,]+)\}|([a-z]+))$/.exec(glob);
  expect(m, glob).not.toBeNull();
  return (m[1] ?? m[2]).split(",");
}

test("oxfmt の許可リストの種類は、lefthook の oxfmt-* のジョブが渡す種類と一致する", () => {
  // ジョブ名を固定せず oxfmt-* をすべて集める（ジョブを足して許可リストを変え忘れたら検出する）。
  const oxfmtJobs = Object.keys(byName).filter((name) => name.startsWith("oxfmt-"));
  expect(oxfmtJobs).toEqual(expect.arrayContaining(["oxfmt-js", "oxfmt-json", "oxfmt-yaml"]));
  const lefthookExts = oxfmtJobs.flatMap((name) => extsOf(byName[name].glob));
  expect(extsOf(oxfmtHead[2]).sort()).toEqual(lefthookExts.sort());
});
