// 変異実証の件数・所要時間を散文へ書き戻していないかの検査の回帰テスト。
//
// 状態空間の軸（判定に使う全入力）と、各セルに置いた入力:
//
// | 軸           | 値                                                                                   |
// | ------------ | ------------------------------------------------------------------------------------ |
// | 件数の表記   | <数> 変異 / <数> 件の変異 / 変異 <数> 件 / 変異数 <数> / <数> mutations / 全角・桁区切り |
// | 後置の間     | 空白 / 助詞（は が も）/ 読点（、）× 単位が件 / 件以外（通り・回）× 数が 1 / 2 以上    |
// | 数           | 1（単位の定義）/ 2 以上                                                               |
// | 所要時間     | 全件 … <数> 秒・分（同じ文）/ 全件を伴わない時間 / 時間を伴わない全件 / 文をまたぐ      |
// | 似た数の表記 | <数> 分割 / <数> 通り / Issue 番号 / exit コード                                     |
// | 場所         | AGENTS.md / .agents/rules / docs（入れ子）/ 対象外（README.md・skills・.md 以外）    |
// | ワークフロー | .yml / .yaml / 実測値の置き場（mutation-proof.yml）/ YAML 以外 / サブディレクトリ     |
// | 行の中       | 本文 / コードフェンスの中                                                             |
// | 件数         | 対象ファイル 0 件 / 1 件以上                                                          |
//
// 陽性コントロールの実データ: この方針で削除する前の AGENTS.md の行をそのまま入力にする。
// 陰性コントロールの実データ: 削除後の AGENTS.md に残した行（単位の定義・暴走時の記述）。
// ワークフローの陽性コントロールの実データ: 実測値を mutation-proof.yml へ寄せる前の ci.yml のコメント。
import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkMutationCountProse, findMentions, main } from "./check-mutation-count-prose.js";
import { makeTempDir } from "./lib/test-tmpdir.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repoRoot, "scripts/check-mutation-count-prose.js");

function makeRepo(files) {
  const root = makeTempDir("mutation-count-prose-");
  for (const [p, t] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), t);
  }
  return root;
}

// ---- 陰性コントロール（通さねばならない入力）----

test.each([
  [
    "単位の定義（実データ）",
    "    1 変異 = 対象テストファイル 1 回の実行なので、対象テストは子プロセスを起動せず `main` を直接呼び、",
  ],
  [
    "暴走時の記述（実データ。「全件」を伴わない時間）",
    "    選択の判定を常に真にする変異が入ると、入れ子の runner が指数的に増える（実測で 30 分以上・21 プロセス以上、",
  ],
  [
    "時間を伴わない全件（実データ）",
    "全件は毎 PR では払えない重さになる（実測値は `.github/workflows/mutation-proof.yml` のコメント）。",
  ],
  [
    "分割数・通り数・Issue 番号",
    "CI では選んだ変異を matrix で 6 分割して並べて走らせる。当たり方は 3 通り（Issue #507）。",
  ],
  [
    "exit コード",
    "（当たらない変異・宣言外まで落ちる変異は FAIL、基準 run が赤いときは exit 2）。",
  ],
  ["1 件の変異 / 1 mutation", "1 件の変異を足すたびに 1 mutation ぶん走る。"],
  ["文をまたぐ全件と時間", "全件は定期実行で測る。PR の実行は 5 分で終わる。"],
  ["後置の 1 件（変異 1 件ごと）", "変異 1 件ごとに対象テストファイルを丸ごと実行する。"],
  ["全角の 1", "１ 変異 = 対象テストファイル 1 回の実行"],
  ["全件の分割数（6 分割）", "全件を 6 分割して並べて走らせる。"],
  ["全件の中の割合（3 分の 2）", "全件のうち 3 分の 2 が実行器自身の宣言。"],
  ["Issue 番号の後の変異", "Issue #420 の変異実証を取り直す。"],
  ["番号の直後の変異（の を挟まない）", "PR #509 変異実証の高速化を取り込む。"],
  ["数の無い変異数", "変異数は宣言ごとに mutation-proof.yml 側で数える。"],
  [
    "数の無い全件の実測値",
    "全件の実測値は `.github/workflows/mutation-proof.yml` のコメントに置く。",
  ],
  [
    "ファイル名の mutation",
    "`scripts/check-mutation-proof.js` と `mutation-proof.yml` を 2 か所に置く。",
  ],
  ["PR 番号と全件", "全件は PR #509 で速くなった（週次で測り直す）。"],
])("陰性: %s は落とさない", (_, text) => {
  expect(findMentions(text)).toEqual([]);
});

// 後置の「変異 <数> 件」の間に助詞・読点を挟む形。落とす入力と通す入力を同じ数（4 件ずつ）置く。
test.each([
  ["助詞が・数が 1", "変異が 1 件でも落ちたら FAIL にする。"],
  ["読点・数が 1", "変異、1 件ずつ当たったことを確かめる。"],
  ["助詞は・単位が通り", "変異は 3 通りの当たり方で選ぶ。"],
  ["助詞を・単位が回", "変異を 2 回当てても結果は同じ。"],
])("陰性: 後置の助詞・読点を挟む形（%s）は件数として落とさない", (_, text) => {
  expect(findMentions(text)).toEqual([]);
});

test("陰性: 対象外（README.md・skills/・.md 以外）の件数は見ない", () => {
  const root = makeRepo({
    "AGENTS.md": "本文\n",
    "README.md": "全件は 376 変異\n",
    "skills/x/SKILL.md": "376 変異\n",
    "docs/x.txt": "376 変異\n",
  });
  expect(checkMutationCountProse(root)).toEqual({ files: ["AGENTS.md"], violations: [] });
});

test("陰性: 実リポジトリの対象文書に件数・所要時間の記述が 0 件", () => {
  const { files, violations } = checkMutationCountProse(repoRoot);
  expect(violations).toEqual([]);
  expect(files).toContain("AGENTS.md");
});

// ---- 陽性コントロール（落とす入力）----

test("陽性（実データ）: 方針で削除する前の AGENTS.md の行を、件数と所要時間の両方で落とす", () => {
  const before =
    "    「宣言ファイル自身」「その宣言の `test_file` か変異の対象ファイル」の 3 通り）。全件は手元実測 1036 秒（376 変異）かかる。";
  expect(findMentions(before)).toEqual([
    { line: 1, kind: "件数", text: "376 変異" },
    { line: 1, kind: "所要時間", text: "全件は手元実測 1036 秒" },
  ]);
});

test.each([
  ["<数> 変異", "宣言は 98 変異ある", "98 変異"],
  ["<数> 件の変異", "98 件の変異を走らせる", "98 件の変異"],
  ["変異 <数> 件", "変異 569 件を 6 分割する", "変異 569 件"],
  ["変異数 <数>", "変異数は 660 まで増えた", "変異数は 660"],
  ["<数> mutations", "runs 504 mutations weekly", "504 mutations"],
  ["全角数字", "（３７６ 変異）", "376 変異"],
  ["桁区切り", "全部で 1,036 変異", "1,036 変異"],
  ["2（1 でない最小）", "この宣言は 2 変異を持つ", "2 変異"],
])("陽性: 件数の表記（%s）を落とす", (_, text, hit) => {
  expect(findMentions(text).map((h) => h.text)).toEqual([hit]);
});

test.each([
  ["助詞は", "変異は 42 件ある", "変異は 42 件"],
  ["助詞が", "変異が 42 件に増えた", "変異が 42 件"],
  ["助詞も", "変異も 42 件ある", "変異も 42 件"],
  ["読点", "変異、42 件を 6 分割する", "変異、42 件"],
])("陽性: 後置の助詞・読点を挟む形（%s）を件数として落とす", (_, text, hit) => {
  expect(findMentions(text).map((h) => h.text)).toEqual([hit]);
});

test.each([
  ["秒", "全件は手元実測 1036 秒かかる", "全件は手元実測 1036 秒"],
  ["小数の分", "全件は手元実測で約 6.5 分", "全件は手元実測で約 6.5 分"],
  ["CI の実測", "全件は CI 実測 891 秒", "全件は CI 実測 891 秒"],
  ["英語の単位", "全件 takes 17 min", "全件 takes 17 min"],
])("陽性: 全件の所要時間（%s）を落とす", (_, text, hit) => {
  expect(findMentions(text).map((h) => h.text)).toEqual([hit]);
});

test("陽性: コードフェンスの中の件数も落とす（出力例に書いた件数も同じく腐る）", () => {
  expect(findMentions("```text\nmutation-proof: 376 変異を実証した\n```\n")).toEqual([
    { line: 2, kind: "件数", text: "376 変異" },
  ]);
});

test.each([
  "AGENTS.md",
  ".agents/rules/x.md",
  "docs/x.md",
  "docs/sub/y.md",
  ".github/workflows/ci.yml",
  ".github/workflows/x.yaml",
])("陽性: 対象の場所（%s）の件数を、ファイルと行を付けて落とす", (path) => {
  const root = makeRepo({ "AGENTS.md": "本文\n", [path]: "本文\n全件は 376 変異\n" });
  expect(checkMutationCountProse(root).violations).toEqual([
    `${path}:2: 変異実証の件数「376 変異」`,
  ]);
});

test("陽性（実データ）: 実測値を寄せる前の ci.yml のコメントを、件数と所要時間で落とす", () => {
  const before = [
    "        # 4 分割では全件（568 変異）が 5 分 21 秒かかった（PR #509 の実測。各シャードの実証ステップ 4 分 2 秒〜5 分 0 秒）",
    "        shard: [1, 2, 3, 4, 5, 6]",
    "    # 上限は**最悪ケース**（実行器を触った PR は全宣言へ広がる）で決める——全件は手元実測 1036 秒",
    "    # （376 変異。Issue #478 の時点）、CI の 6 分割で 1 シャード最長 3 分 47 秒（569 変異。PR #509）。変異が増える前提で余裕を取る。",
  ].join("\n");
  const root = makeRepo({ "AGENTS.md": "本文\n", ".github/workflows/ci.yml": `${before}\n` });
  expect(checkMutationCountProse(root).violations).toEqual([
    ".github/workflows/ci.yml:1: 変異実証の件数「568 変異」",
    ".github/workflows/ci.yml:1: 変異実証の所要時間「全件(568 変異)が 5 分」",
    ".github/workflows/ci.yml:3: 変異実証の所要時間「全件は手元実測 1036 秒」",
    ".github/workflows/ci.yml:4: 変異実証の件数「376 変異」",
    ".github/workflows/ci.yml:4: 変異実証の件数「569 変異」",
  ]);
});

test("陰性: 実測値の置き場（mutation-proof.yml）・YAML 以外・サブディレクトリ（名前が .yml のディレクトリを含む）のワークフローは見ない", () => {
  const measured = "# 全件は CI で 1690 秒（504 変異）\n";
  const root = makeRepo({
    "AGENTS.md": "本文\n",
    ".github/workflows/mutation-proof.yml": measured,
    ".github/workflows/notes.md": measured,
    ".github/workflows/sub/x.yml": measured,
    ".github/workflows/dir.yml/x.md": measured,
    ".github/workflows/ci.yml": "# 実測値は mutation-proof.yml のコメント\n",
  });
  expect(checkMutationCountProse(root)).toEqual({
    files: [".github/workflows/ci.yml", "AGENTS.md"],
    violations: [],
  });
});

// ---- 件数と CLI ----

test("対象ファイル 0 件は成功に倒さず exit 1", () => {
  expect(main([makeRepo({ "README.md": "x\n" })])).toBe(1);
});

test("陽性コントロール（CLI）: 子プロセスとして起動しても、件数の記述は exit 1、無ければ exit 0", () => {
  const good = spawnSync(process.execPath, [script, makeRepo({ "AGENTS.md": "本文\n" })], {
    encoding: "utf8",
  });
  expect(good.status, good.stderr).toBe(0);
  expect(good.stdout).toMatch(/mutation-count-prose: OK（1 件）/);
  const bad = spawnSync(process.execPath, [script, makeRepo({ "docs/a.md": "376 変異\n" })], {
    encoding: "utf8",
  });
  expect(bad.status).toBe(1);
  expect(bad.stderr).toMatch(/1 件の件数・所要時間の記述/);
});
