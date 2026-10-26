// ミューテーションテストの件数・所要時間を、散文に書き戻していないかのチェックの回帰テスト。
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
// 検出されることの確認に使う実データ: この方針で削除する前の AGENTS.md の行を、そのまま入力にする。
// 誤検知しないことの確認に使う実データ: 削除後の AGENTS.md に残した行（単位の定義・暴走時の記述）。
// ワークフローで検出されることの確認に使う実データ: 実測値を mutation-proof.yml へ移す前の ci.yml のコメント。
import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import {
  checkMutationCountProse,
  checkTimeWords,
  findMentions,
  main,
  TIME_RULES,
} from "./check-time-sensitive-prose.ts";
import { KNOWN_RULES } from "../../lib/doc-scan.ts";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";
import {
  makeGitRepo,
  makeRepo,
  repoRoot,
  script,
  texts,
} from "./check-time-sensitive-prose-helpers.ts";

const KZ = ".kaizen/";

// ---- 誤検知しないことの確認（通さねばならない入力）----

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
    "CI では選んだ変異を matrix で 6 分割して並べて実行する。当たり方は 3 通り（Issue #507）。",
  ],
  [
    "exit コード",
    "（当たらない変異・宣言外まで落ちる変異は FAIL、基準 run が赤いときは exit 2）。",
  ],
  ["1 件の変異 / 1 mutation", "1 件の変異を足すたびに 1 mutation ぶん実行が増える。"],
  ["文をまたぐ全件と時間", "全件は定期実行で測る。PR の実行は 5 分で終わる。"],
  ["後置の 1 件（変異 1 件ごと）", "変異 1 件ごとに対象テストファイルを丸ごと実行する。"],
  ["全角の 1", "１ 変異 = 対象テストファイル 1 回の実行"],
  ["全件の分割数（6 分割）", "全件を 6 分割して並べて実行する。"],
  ["全件の中の割合（3 分の 2）", "全件のうち 3 分の 2 がランナー自身の宣言。"],
  ["Issue 番号の後の変異", "Issue #420 の変異をもう一度実行する。"],
  ["番号の直後の変異（の を挟まない）", "PR #509 変異テストの高速化を取り込む。"],
  ["数の無い変異数", "変異数は宣言ごとに mutation-proof.yml 側で数える。"],
  [
    "数の無い全件の実測値",
    "全件の実測値は `.github/workflows/mutation-proof.yml` のコメントに置く。",
  ],
  [
    "ファイル名の mutation",
    "`scripts/mutation/check-mutation-proof.ts` と `mutation-proof.yml` を 2 か所に置く。",
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

// ---- 検出されることの確認（落とす入力）----

test("陽性（実データ）: 方針で削除する前の AGENTS.md の行を、件数と所要時間の両方で落とす", () => {
  const before =
    "    「宣言ファイル自身」「その宣言の `test_file` か変異の対象ファイル」の 3 通り）。全件は手元実測 1036 秒（376 変異）かかる。";
  expect(findMentions(before)).toEqual([
    { line: 1, kind: "件数", text: "376 変異" },
    { line: 1, kind: "所要時間", text: "全件は手元実測 1036 秒" },
  ]);
});

test.each([
  ["<数> 変異", "一覧には 98 変異ある", "98 変異"],
  ["<数> 件の変異", "98 件の変異を実行する", "98 件の変異"],
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
    `${path}:2: ミューテーションテストの件数「376 変異」`,
  ]);
});

test("陽性（実データ）: 実測値を寄せる前の ci.yml のコメントを、件数と所要時間で落とす", () => {
  const before = [
    "        # 4 分割では全件（568 変異）が 5 分 21 秒かかった（PR #509 の実測。各シャードの実証ステップ 4 分 2 秒〜5 分 0 秒）",
    "        shard: [1, 2, 3, 4, 5, 6]",
    "    # 上限は**最悪ケース**（ランナーを触った PR は全宣言へ広がる）で決める。全件は手元実測 1036 秒",
    "    # （376 変異。Issue #478 の時点）、CI の 6 分割で 1 シャード最長 3 分 47 秒（569 変異。PR #509）。変異が増える前提で余裕を取る。",
  ].join("\n");
  const root = makeRepo({ "AGENTS.md": "本文\n", ".github/workflows/ci.yml": `${before}\n` });
  expect(checkMutationCountProse(root).violations).toEqual([
    ".github/workflows/ci.yml:1: ミューテーションテストの件数「568 変異」",
    ".github/workflows/ci.yml:1: ミューテーションテストの所要時間「全件(568 変異)が 5 分」",
    ".github/workflows/ci.yml:3: ミューテーションテストの所要時間「全件は手元実測 1036 秒」",
    ".github/workflows/ci.yml:4: ミューテーションテストの件数「376 変異」",
    ".github/workflows/ci.yml:4: ミューテーションテストの件数「569 変異」",
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

test("対象ファイル 0 件は成功として扱わず exit 1", () => {
  expect(main([makeRepo({ "README.md": "x\n" })])).toBe(1);
});

test("検出の確認（CLI）: 子プロセスとして起動しても、件数の記述は exit 1、無ければ exit 0", () => {
  const good = spawnSync(process.execPath, [script, makeGitRepo({ "AGENTS.md": "本文\n" })], {
    timeout: CHILD_TIMEOUT_MS,
    encoding: "utf8",
  });
  expect(good.status, good.stderr).toBe(0);
  expect(good.stdout).toMatch(
    /time-sensitive-prose: OK（ミューテーションテストの件数 1 件、時間の語と日付 2 件）/,
  );
  const bad = spawnSync(process.execPath, [script, makeGitRepo({ "docs/a.md": "376 変異\n" })], {
    timeout: CHILD_TIMEOUT_MS,
    encoding: "utf8",
  });
  expect(bad.status).toBe(1);
  expect(bad.stderr).toMatch(/1 件の件数・所要時間の記述/);
});

// ---- 時間の語と日付 ----
//
// | 軸           | 値                                                                                 |
// | ------------ | ---------------------------------------------------------------------------------- |
// | 語           | 現状は / 現状では / 現時点 / 当面 / 今のところ / いまのところ / 目下 / 目下（前が助詞・接続の語）/ 目下（前が漢字・見た目）/ しばらく・しばらくは・しばらくの間（挙動）/ 今は / 前が「の」/ 前が `「` |
// | 日付         | 2026-09-28 / 2026 年 9 月 / 後ろに -<名前>.md（学びのファイル名）                    |
// | 行の中       | 本文 / インラインコード / コードフェンス / 例の行                                   |
// | ファイル     | Markdown / JS の行コメント・ブロックコメント・行末コメント / JS のコード / sh・YAML の # / shebang / JSON |
// | 場所         | Tier 1〜3 / Tier 4（.kaizen/）/ 階層の外（eval の fixture）/ スキルのコピー / このチェックのテスト |
// | 許可         | 使われる / 使われない / 他のチェックの規則                                          |

test.each([
  { label: "現状は", file: "a.md", text: "現状は可。\n", want: ["time-word:現状は"] },
  { label: "現状では", file: "a.md", text: "現状では使わない。\n", want: ["time-word:現状では"] },
  { label: "現時点", file: "a.md", text: "現時点の最新は 1.0。\n", want: ["time-word:現時点"] },
  { label: "当面", file: "a.md", text: "当面は見送る。\n", want: ["time-word:当面"] },
  {
    label: "今のところ",
    file: "a.md",
    text: "今のところ 1.0 を使う。\n",
    want: ["time-word:今のところ"],
  },
  {
    label: "いまのところ",
    file: "a.md",
    text: "いまのところ使わない。\n",
    want: ["time-word:いまのところ"],
  },
  { label: "目下", file: "a.md", text: "目下は検討中である。\n", want: ["time-word:目下"] },
  {
    label: "助詞の後の目下",
    file: "a.md",
    text: "作業は目下検討中である。\n",
    want: ["time-word:目下"],
  },
  {
    label: "接続の語の後の目下（また）",
    file: "a.md",
    text: "また目下検討中である。\n",
    want: ["time-word:目下"],
  },
  {
    label: "接続の語の後の目下（なお）",
    file: "a.md",
    text: "なお目下は見送る。\n",
    want: ["time-word:目下"],
  },
  { label: "ISO の日付", file: "a.md", text: "2026-09-19 時点の版。\n", want: ["date:2026-09-19"] },
  { label: "年月", file: "a.md", text: "2026 年 9 月に変えた。\n", want: ["date:2026 年 9 月"] },
  {
    label: "スラッシュ区切りの日付",
    file: "a.md",
    text: "2026/09/28 に変えた。\n",
    want: ["date:2026/09/28"],
  },
  {
    label: "JS の行の途中のブロックコメント",
    file: "a.js",
    text: "const x = 1; /* 当面 */\n",
    want: ["time-word:当面"],
  },
  {
    label: "JS の行コメント",
    file: "a.js",
    text: "// 2026-09-19 に確認\nconst x = 1;\n",
    want: ["date:2026-09-19"],
  },
  {
    label: "JS のブロックコメント",
    file: "a.mjs",
    text: "/**\n * 当面は使わない\n */\n",
    want: ["time-word:当面"],
  },
  {
    label: "JS の行末コメント",
    file: "a.ts",
    text: "const x = 1; // 現状は 1\n",
    want: ["time-word:現状は"],
  },
  {
    label: "sh の # コメント",
    file: "a.sh",
    text: "# 2026-09-19 時点\necho\n",
    want: ["date:2026-09-19"],
  },
  {
    label: "YAML の行末コメント",
    file: "a.yml",
    text: "on: push # 当面\n",
    want: ["time-word:当面"],
  },
])("陽性: $label を拾う", ({ file, text, want }) => {
  expect(texts(file, text)).toEqual(want);
});

test.each([
  ["前が「の」", "a.md", "実行環境の現状は、確かめてから述べる。\n"],
  ["語として挙げた形", "a.md", "「現状は」「当面」と書かない。\n"],
  ["手順のしばらく", "a.md", "起動してからしばらく待つ。\n"],
  ["挙動のしばらくの間", "a.md", "起動してしばらくの間は 503 を返す。\n"],
  ["挙動のしばらくは", "a.md", "SIGTERM の後もしばらくはファイルに書く。\n"],
  ["漢字の複合語の目下（項目下）", "a.md", "各項目下の値を読む。\n"],
  ["漢字の複合語の目下（注目下）", "a.md", "注目下にある値を読む。\n"],
  ["仮名で終わる語の目下（見た目下部）", "a.md", "見た目下部の余白を測る。\n"],
  ["変更の前後を対比する今は", "a.md", "以前は 1 列だったが、今は 2 列に分ける。\n"],
  ["学びのファイル名", "a.md", `根拠は ${KZ}archive/2026-09-19-foo.md にある。\n`],
  ["インラインコード", "a.md", "`2026-09-19` の形で書く。\n"],
  ["コードフェンス", "a.md", "```text\n2026-09-19 当面\n```\n"],
  ["例の行", "a.md", "例: 2026-09-19 に追加\n"],
  ["JS のコード（コメントでない）", "a.js", 'const d = "2026-09-19";\n'],
  ["shebang", "a.sh", "#!/usr/bin/env bash 2026-09-19\n"],
  ["JSON（行の途中の # も読まない）", "a.json", '{ "at": "x # 2026-09-19" }\n'],
  ["Markdown 以外でコメントを持たない種類", "a.txt", "当面\n"],
])("陰性: %s は拾わない", (_, file, text) => {
  expect(texts(file, text)).toEqual([]);
});

test("走査対象: Tier 4・階層の外・スキルのコピー・このチェックのテストは読まない", () => {
  const root = makeGitRepo({
    "AGENTS.md": "本文\n",
    [`${KZ}2026-09-01-a.md`]: "当面\n",
    "evals/x/fixtures/.replace/a.md": "当面\n",
    "skills/x/SKILL.md": "本文\n",
    ".agents/skills/x/SKILL.md": "当面\n",
    "scripts/gates/prose/check-time-sensitive-prose.test.ts": "// 当面\n",
    "docs/a.md": "当面\n",
  });
  expect(checkTimeWords(root).failures).toEqual(["docs/a.md:1: [time-word] 当面"]);
});

test("許可: 一致する記述は通し、使われなくなった許可は失敗にし、他のチェックの規則の許可は見ない", () => {
  const allowed = [
    { file: "docs/a.md", rule: "date", text: "2026-09-19", reason: "例" },
    { file: "docs/a.md", rule: "date", text: "2026-01-01", reason: "例" },
    { file: "docs/c.md", rule: "section", text: "x.md「y」", reason: "例" },
  ];
  const root = makeGitRepo(
    { "AGENTS.md": "本文\n", "docs/a.md": "2026-09-19 の版\n" },
    { allowed: { allowed } },
  );
  // 他のチェックの規則（section）の許可は、このチェックでは使われていないと判定しない。
  expect(checkTimeWords(root).failures).toEqual([
    expect.stringMatching(/^使われていない許可: docs\/a\.md \[date\] 2026-01-01/),
  ]);
});

test("許可の一覧の形の誤り（reason が無い・知らない規則・allowed が配列でない）はチェックできない（exit 2）", () => {
  for (const bad of [
    { allowed: [{ file: "a", rule: "date", text: "x" }] },
    { allowed: [{ file: "a", rule: "dates", text: "x", reason: "例" }] },
    { allowed: {} },
  ]) {
    expect(main([makeGitRepo({ "AGENTS.md": "本文\n" }, { allowed: bad })])).toBe(2);
  }
});

test("陰性: 実リポジトリは許可を当てると時間の語と日付の失敗が 0 件", () => {
  const r = checkTimeWords(repoRoot);
  expect(r.failures).toEqual([]);
  expect(r.files).toBeGreaterThan(100);
});

test("このチェックの規則は、許可に書ける規則に含まれる", () => {
  for (const r of TIME_RULES) expect(KNOWN_RULES).toContain(r);
});
