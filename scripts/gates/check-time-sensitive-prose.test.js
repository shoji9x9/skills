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
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkMutationCountProse,
  checkTimeWords,
  findMentions,
  findTimeMentions,
  main,
  proseLines,
  TIME_RULES,
} from "./check-time-sensitive-prose.js";
import { KNOWN_RULES, PENDING_PATH } from "../lib/doc-scan.js";
import { makeTempDir } from "../lib/test-tmpdir.js";

// 学びのパスは組み立てて書く（そのまま書くと check-kaizen-refs.js が実在しない学びへの参照として数える）。
const KZ = ".kaizen/";
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const script = join(repoRoot, "scripts/gates/check-time-sensitive-prose.js");

function makeRepo(files) {
  const root = makeTempDir("time-sensitive-prose-");
  for (const [p, t] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), t);
  }
  return root;
}

/** 時間の語と日付のチェックに要るもの（git と階層の原本）を持つ一時リポジトリ。 */
function makeGitRepo(files, { pending } = {}) {
  const root = makeRepo({
    "scripts/gates/doc-tiers.json": readFileSync(
      join(repoRoot, "scripts/gates/doc-tiers.json"),
      "utf8",
    ),
    ...files,
  });
  if (pending) writeFileSync(join(root, PENDING_PATH), JSON.stringify(pending));
  const r = spawnSync("git", ["init", "-q"], { cwd: root, encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
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
    "`scripts/mutation/check-mutation-proof.js` と `mutation-proof.yml` を 2 か所に置く。",
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
  const good = spawnSync(process.execPath, [script, makeGitRepo({ "AGENTS.md": "本文\n" })], {
    encoding: "utf8",
  });
  expect(good.status, good.stderr).toBe(0);
  expect(good.stdout).toMatch(
    /time-sensitive-prose: OK（ミューテーションテストの件数 1 件、時間の語と日付 2 件。保留 0 件）/,
  );
  const bad = spawnSync(process.execPath, [script, makeGitRepo({ "docs/a.md": "376 変異\n" })], {
    encoding: "utf8",
  });
  expect(bad.status).toBe(1);
  expect(bad.stderr).toMatch(/1 件の件数・所要時間の記述/);
});

// ---- 時間の語と日付 ----
//
// | 軸           | 値                                                                                 |
// | ------------ | ---------------------------------------------------------------------------------- |
// | 語           | 現状は / 現状では / 現時点 / 当面 / 前が「の」/ 前が「「」                          |
// | 日付         | 2026-09-28 / 2026 年 9 月 / 後ろに -<名前>.md（学びのファイル名）                    |
// | 行の中       | 本文 / インラインコード / コードフェンス / 例の行                                   |
// | ファイル     | Markdown / JS の行コメント・ブロックコメント・行末コメント / JS のコード / sh・YAML の # / shebang / JSON |
// | 場所         | Tier 1〜3 / Tier 4（.kaizen/）/ 階層の外（eval の fixture）/ スキルのコピー / このチェックのテスト |
// | 保留         | 一致 / 古い（直した）/ 許可（使われる・使われない）/ 他のチェックの規則              |

const texts = (file, text) => findTimeMentions(file, text).map((h) => `${h.rule}:${h.text}`);

test.each([
  ["現状は", "a.md", "現状は可。\n", ["time-word:現状は"]],
  ["現状では", "a.md", "現状では使わない。\n", ["time-word:現状では"]],
  ["現時点", "a.md", "現時点の最新は 1.0。\n", ["time-word:現時点"]],
  ["当面", "a.md", "当面は見送る。\n", ["time-word:当面"]],
  ["ISO の日付", "a.md", "2026-09-19 時点の版。\n", ["date:2026-09-19"]],
  ["年月", "a.md", "2026 年 9 月に変えた。\n", ["date:2026 年 9 月"]],
  ["スラッシュ区切りの日付", "a.md", "2026/09/28 に変えた。\n", ["date:2026/09/28"]],
  ["JS の行の途中のブロックコメント", "a.js", "const x = 1; /* 当面 */\n", ["time-word:当面"]],
  ["JS の行コメント", "a.js", "// 2026-09-19 に確認\nconst x = 1;\n", ["date:2026-09-19"]],
  ["JS のブロックコメント", "a.mjs", "/**\n * 当面は使わない\n */\n", ["time-word:当面"]],
  ["JS の行末コメント", "a.ts", "const x = 1; // 現状は 1\n", ["time-word:現状は"]],
  ["sh の # コメント", "a.sh", "# 2026-09-19 時点\necho\n", ["date:2026-09-19"]],
  ["YAML の行末コメント", "a.yml", "on: push # 当面\n", ["time-word:当面"]],
])("陽性: %s を拾う", (_, file, text, want) => {
  expect(texts(file, text)).toEqual(want);
});

test.each([
  ["前が「の」", "a.md", "実行環境の現状は、確かめてから述べる。\n"],
  ["語として挙げた形", "a.md", "「現状は」「当面」と書かない。\n"],
  ["学びのファイル名", "a.md", `根拠は ${KZ}archive/2026-09-19-foo.md にある。\n`],
  ["インラインコード", "a.md", "`2026-09-19` の形で書く。\n"],
  ["コードフェンス", "a.md", "```text\n2026-09-19 当面\n```\n"],
  ["例の行", "a.md", "例: 2026-09-19 に追加\n"],
  ["JS のコード（コメントでない）", "a.js", 'const d = "2026-09-19";\n'],
  ["shebang", "a.sh", "#!/usr/bin/env bash 2026-09-19\n"],
  ["JSON（行の途中の # も読まない）", "a.json", '{ "at": "x # 2026-09-19" }\n'],
])("陰性: %s は拾わない", (_, file, text) => {
  expect(texts(file, text)).toEqual([]);
});

test("proseLines: Markdown 以外でコメントを持たない種類は 1 行も読まない", () => {
  expect(proseLines("a.txt", "当面\n")).toEqual([null, null]);
});

test("走査対象: Tier 4・階層の外・スキルのコピー・このチェックのテストは読まない", () => {
  const root = makeGitRepo({
    "AGENTS.md": "本文\n",
    [`${KZ}2026-09-01-a.md`]: "当面\n",
    "evals/x/fixtures/.replace/a.md": "当面\n",
    "skills/x/SKILL.md": "本文\n",
    ".agents/skills/x/SKILL.md": "当面\n",
    "scripts/gates/check-time-sensitive-prose.test.js": "// 当面\n",
    "docs/a.md": "当面\n",
  });
  expect(checkTimeWords(root).failures).toEqual(["docs/a.md:1: [time-word] 当面"]);
});

test("保留: 一致する違反は失敗にせず数える。直した後に残った保留は失敗にする", () => {
  const pending = {
    pending: [
      { file: "docs/a.md", rule: "time-word", text: "当面", stage: "3" },
      { file: "docs/b.md", rule: "date", text: "2026-09-19", stage: "3" },
      { file: "docs/c.md", rule: "section", text: "x.md「y」", stage: "3" },
    ],
    allowed: [],
  };
  const root = makeGitRepo(
    { "AGENTS.md": "本文\n", "docs/a.md": "当面\n", "docs/b.md": "本文\n" },
    { pending },
  );
  const r = checkTimeWords(root);
  expect(r.pendingCount).toBe(1);
  // 他のチェックの規則（section）の保留は、このチェックでは古いと判定しない。
  expect(r.failures).toEqual([expect.stringMatching(/^古い保留: docs\/b\.md \[date\] 2026-09-19/)]);
});

test("許可: 一致する記述は通し、使われなくなった許可は失敗にする", () => {
  const allowed = [
    { file: "docs/a.md", rule: "date", text: "2026-09-19", reason: "例" },
    { file: "docs/a.md", rule: "date", text: "2026-01-01", reason: "例" },
  ];
  const root = makeGitRepo(
    { "AGENTS.md": "本文\n", "docs/a.md": "2026-09-19 の版\n" },
    { pending: { pending: [], allowed } },
  );
  expect(checkTimeWords(root).failures).toEqual([
    expect.stringMatching(/^使われていない許可: docs\/a\.md \[date\] 2026-01-01/),
  ]);
});

test("保留の一覧の形の誤り（stage が無い・reason が無い・知らない規則・知らない stage）はチェックできない（exit 2）", () => {
  for (const bad of [
    { pending: [{ file: "a", rule: "date", text: "x" }], allowed: [] },
    { pending: [], allowed: [{ file: "a", rule: "date", text: "x" }] },
    { pending: [{ file: "a", rule: "dates", text: "x", stage: "3" }], allowed: [] },
    { pending: [{ file: "a", rule: "date", text: "x", stage: "6" }], allowed: [] },
  ]) {
    expect(main([makeGitRepo({ "AGENTS.md": "本文\n" }, { pending: bad })])).toBe(2);
  }
});

test("--prune は古い保留だけを消し、一致する保留と許可は残す", () => {
  const keep = { file: "docs/a.md", rule: "time-word", text: "当面", stage: "3" };
  const stale = { file: "docs/b.md", rule: "date", text: "2026-09-19", stage: "3" };
  const other = { file: "docs/c.md", rule: "section", text: "x.md「y」", stage: "3" };
  const root = makeGitRepo(
    { "AGENTS.md": "本文\n", "docs/a.md": "当面\n" },
    { pending: { pending: [keep, stale, other], allowed: [] } },
  );
  expect(main([root, "--prune"])).toBe(0);
  const after = JSON.parse(readFileSync(join(root, PENDING_PATH), "utf8"));
  expect(after.pending).toEqual([keep, other]);
});

test("陰性: 実リポジトリは保留と許可を当てると時間の語と日付の失敗が 0 件", () => {
  const r = checkTimeWords(repoRoot);
  expect(r.failures).toEqual([]);
  expect(r.files).toBeGreaterThan(100);
});

test("このチェックの規則は、保留に書ける規則に含まれる", () => {
  for (const r of TIME_RULES) expect(KNOWN_RULES).toContain(r);
});
