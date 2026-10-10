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
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { agentCopyGlobs, copySkillNames, sourceSkillNames } from "../lib/source-scope.js";
import oxlintConfig from "../../oxlint.config.ts";
import oxfmtConfig, { assigned as oxfmtAssigned } from "../../oxfmt.config.ts";

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

// oxfmt は、割り当てた種類の許可リストの後に、エージェント用のコピーとリンクを除く。
// 許可リストの種類は、lefthook の oxfmt-* のジョブが渡す種類と一致させる（どちらかだけ広げると、
// pre-commit が渡したファイルを oxfmt が対象外として扱うか、割り当て外の種類を整形する）。
// 許可リストは位置ではなく形で探す（行を足しても、無関係な assertion が落ちないように）。
// 許可リストの行で前後に分ける（除外の数で分けると、除外が変わったときに許可リストの側の確認まで成り立たなくなる）。
const oxfmtPatterns = oxfmtConfig.ignorePatterns;
// 行の形を正規表現で探さず、設定が書き出す値と同じ文字列で探す（数字を含む拡張子でも同じに扱う）。
const oxfmtAllowLine = `!**/*.{${oxfmtAssigned}}`;
const oxfmtAllowed = oxfmtPatterns.filter((p) => p === oxfmtAllowLine);
const oxfmtAllowIndex = oxfmtPatterns.indexOf(oxfmtAllowLine);
// 行が無ければ前後に分けられない（下のテストが行の数で失敗する）。
const oxfmtHead = oxfmtAllowIndex < 0 ? [] : oxfmtPatterns.slice(0, oxfmtAllowIndex);
const oxfmtCopies = oxfmtAllowIndex < 0 ? [] : oxfmtPatterns.slice(oxfmtAllowIndex + 1);

test("oxfmt の ignorePatterns は、許可リストの後にエージェント用のコピーとリンクだけを除く", () => {
  // 後の行が優先されるので、コピーの除外を最後に置く（割り当てた種類でもコピーの中は除いたままにする）。
  expect(oxfmtAllowed).toHaveLength(1);
  expect(oxfmtCopies).toEqual(expected);
  // すべてを除いてから、ディレクトリと割り当てた種類を戻す。
  const deny = oxfmtHead.indexOf("**/*.*");
  expect(deny).toBeGreaterThanOrEqual(0);
  expect(oxfmtHead.indexOf("!**/*/")).toBeGreaterThan(deny);
  // 種類を戻すのは許可リストの行だけにする。前に行を足すこと自体は許すが、ファイルを戻す行（`!` で始まり
  // ディレクトリでないもの）は許さない（fixture に無い種類を戻しても、formatter-scope の実測では検出できない）。
  expect(oxfmtHead.filter((p) => p.startsWith("!") && !p.endsWith("/"))).toEqual([]);
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
  const m = /\*\.(?:\{([a-z0-9,]+)\}|([a-z0-9]+))$/.exec(glob);
  expect(m, glob).not.toBeNull();
  return (m[1] ?? m[2]).split(",");
}

test("oxfmt の許可リストの種類は、lefthook の oxfmt-* のジョブが渡す種類と一致する", () => {
  // ジョブ名を固定せず oxfmt-* をすべて集める（ジョブを足して許可リストを変え忘れたら検出する）。
  const oxfmtJobs = Object.keys(byName).filter((name) => name.startsWith("oxfmt-"));
  expect(oxfmtJobs).toEqual(expect.arrayContaining(["oxfmt-js", "oxfmt-json", "oxfmt-yaml"]));
  const lefthookExts = oxfmtJobs.flatMap((name) => extsOf(byName[name].glob));
  expect(oxfmtAllowed).toHaveLength(1);
  expect(oxfmtAssigned.split(",").sort()).toEqual(lefthookExts.sort());
});

// ---- formatter-scope のジョブ ----

/**
 * rel が相対パスで import するリポジトリ内のファイルを、import 先がさらに import するものまでたどって集める。
 * `from "./x"`・副作用だけの `import "./x"`・`import("./x")`・`require("./x")`・単引用符を拾う。
 * パッケージ名や `node:` の import はたどらない。コメントの中の一致もたどるが、無いファイルなら、どこから来たかを示す
 * 例外になる。テンプレートリテラルや、計算したパス（`import.meta.dirname` を基にした読み込みなど）はたどらないので、
 * oxfmt.config.ts でその形を使うときは、glob と inputs に手で足す。
 */
function repoImports(rel, readFile = read, found = new Set(), from = null) {
  let source;
  try {
    source = readFile(rel);
  } catch (err) {
    if (from === null) throw err;
    throw new Error(
      `${from} の import 先 ${rel} を読めない（コメントの中の一致か、拡張子を省いた import を疑う）: ${err.message}`,
    );
  }
  for (const m of source.matchAll(/\b(?:from|import|require)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g)) {
    const dep = posix.normalize(posix.join(posix.dirname(rel), m[1]));
    if (found.has(dep)) continue;
    found.add(dep);
    repoImports(dep, readFile, found, rel);
  }
  return found;
}

test("repoImports は、import の書き方の違いと、import 先の import を拾う", () => {
  const fixture = {
    "a.ts": `import x from "./lib/b.js";\nimport './c.js';\nimport fs from "node:fs";\nimport y from "pkg";\n`,
    "lib/b.js": `export { z } from "../d.js";\n`,
    "c.js": `const e = await import("./e.js");\nconst f = require('./f.cjs');\n`,
    "e.js": "",
    "f.cjs": "",
    "d.js": `import "./lib/b.js";\n`,
  };
  const readFixture = (rel) => {
    if (!(rel in fixture)) throw new Error(`fixture に無い: ${rel}`);
    return fixture[rel];
  };
  expect([...repoImports("a.ts", readFixture)].sort()).toEqual([
    "c.js",
    "d.js",
    "e.js",
    "f.cjs",
    "lib/b.js",
  ]);
  // 無いファイルを指す import は、どこから来たかを示す例外にする（readFile の例外のまま失敗しない）。
  const withMissing = { ...fixture, "g.ts": `// from "./old.js"\n` };
  expect(() =>
    repoImports("g.ts", (rel) => {
      if (!(rel in withMissing)) throw new Error(`ENOENT: ${rel}`);
      return withMissing[rel];
    }),
  ).toThrow("g.ts の import 先 old.js を読めない");
});

test("lefthook の formatter-scope は、整形の範囲を変えるファイルの変更で実行する", () => {
  const glob = byName["formatter-scope"]?.glob;
  expect(glob, "formatter-scope のジョブが無い").toMatch(/^\{[^{}]+\}$/);
  const listed = glob.slice(1, -1).split(",");
  // oxfmt の設定が import するリポジトリ内のファイルは、名前を挙げずに設定から集める（import を足したら検出する）。
  const imported = [...repoImports("oxfmt.config.ts")];
  expect(imported).toContain("scripts/lib/source-scope.js");
  const inputs = [
    ".markdownlint-cli2.yaml",
    ".markdownlint.yaml",
    "oxfmt.config.ts",
    ...imported,
    // ツールの版を決めるファイル（版が変わると整形する種類も変わりうる）。
    "package.json",
    "pnpm-lock.yaml",
    // pnpm の overrides・catalog も版を変える。
    "pnpm-workspace.yaml",
    "scripts/gates/formatter-scope.test.js",
  ];
  // 両方向で比べる（glob の側にだけ足したファイルも、ここに挙げ忘れとして検出する）。
  expect([...listed].sort()).toEqual([...inputs].sort());
});
