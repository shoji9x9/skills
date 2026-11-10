// check-cost-metrics.ts（チェックと CI の費用の指標）のテスト。
//
// | 軸 | 値 |
// | --- | --- |
// | 設定 | 正しい / lists が空 / file が無い / kind が知らない値 / readers が空 / 閾値が 0・負・数でない / 節が無い |
// | 一覧の数え方 | json-array / json-object / json-arrays（除くキー・配列が無い）/ ts-export（配列・オブジェクト）/ 型が違う |
// | 一覧の件数 | 0 件（候補）/ 1 件以上 |
// | 読む処理（readers） | 一覧の名前を含まない・ファイルが無い（確かめずに案内として出す） |
// | PR のタイトル | squash（件名）/ マージの commit（本文の 1 行目）/ 本文が空 / `fix`・`fix(scope)`・`fix!`・fix 以外 |
// | 変えたファイル | 追加・変更・削除・名前の変更（後の PR で今の名前に寄せる）/ テスト・変異の定義（本体に寄せる）/ 同じ PR で 2 回 |
// | 修正の PR の件数 | 閾値の未満・以上 / 今は無いファイル |
// | git | 履歴が浅い / 失敗 |
// | ジョブ | 成功 / 成功以外 / 日時が無い / 期間の境界 / 片方の期間だけ |
// | 遅くなったか | 回数が足りない / 割合だけ / 秒数だけ / 両方 |
// | API | 成功 / 失敗 / 1000 件を超える / total_count が無い / ページの形が違う / 期間の外の run |
// | 前回の本文 | 目印なし / 識別子あり / 形が違う |
// | CLI の引数 | 正しい / 足りない / 未知 / --previous が空 |
import { describe, expect, test } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  mapLimit,
  defaultRunner,
  checkFileOf,
  collect,
  compareJobs,
  countEntries,
  countFixPrs,
  diffFindings,
  emptyLists,
  fixHeavyChecks,
  formatBody,
  formatComment,
  isSlower,
  jobRows,
  jobSamples,
  main,
  parseConfig,
  previousKeys,
  prTitle,
  slowJobs,
  stats,
  type Config,
  type CountRule,
  type Finding,
  type JobRow,
  type Runner,
} from "./check-cost-metrics.ts";
import { makeTempDir } from "../lib/testing/test-tmpdir.ts";

const NOW = new Date("2026-11-11T03:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const iso = (daysAgo: number): string => new Date(NOW.getTime() - daysAgo * DAY).toISOString();

const durations: Config["durations"] = {
  days: 7,
  workflows: ["ci.yml"],
  minRuns: 3,
  minRatio: 0.2,
  minSeconds: 30,
};

const configJson = (override: Record<string, unknown> = {}) =>
  JSON.stringify({
    lists: [{ file: "a.json", count: { kind: "json-array", key: "exempt" }, readers: ["r.ts"] }],
    fix_prs: { days: 28, min: 3, paths: ["scripts/gates"] },
    durations: {
      days: 7,
      workflows: ["ci.yml"],
      min_runs: 3,
      min_ratio: 0.2,
      min_seconds: 30,
    },
    ...override,
  });

function writeFiles(root: string, files: Record<string, string>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

describe("設定", () => {
  test("keep_empty を理由として読む", () => {
    const list = {
      file: "a.json",
      count: { kind: "json-array", key: "exempt" },
      readers: ["r.ts"],
    };
    expect(parseConfig(configJson({ lists: [{ ...list, keep_empty: "理由" }] })).lists).toEqual([
      { ...list, keepEmpty: "理由" },
    ]);
  });

  test("fix_prs.exclude を、数えないファイルと理由として読む", () => {
    const exclude = [{ file: "ci.yml", reason: "起動の設定" }];
    expect(
      parseConfig(configJson({ fix_prs: { days: 28, min: 3, paths: ["x"], exclude } })).fixPrs,
    ).toEqual({ days: 28, min: 3, paths: ["x"], exclude });
  });

  test("正しい設定を読む", () => {
    expect(parseConfig(configJson())).toEqual({
      lists: [{ file: "a.json", count: { kind: "json-array", key: "exempt" }, readers: ["r.ts"] }],
      fixPrs: { days: 28, min: 3, paths: ["scripts/gates"] },
      durations: { ...durations },
    });
  });

  test("実リポジトリの設定は読める", () => {
    const text = readFileSync(join(import.meta.dirname, "check-cost-metrics.json"), "utf8");
    expect(parseConfig(text).lists.length).toBeGreaterThan(0);
  });

  test.each([
    ["lists が空", { lists: [] }, "lists"],
    [
      "file が無い",
      { lists: [{ count: { kind: "json-array", key: "x" }, readers: ["r"] }] },
      "file",
    ],
    [
      "kind が知らない値",
      { lists: [{ file: "a", count: { kind: "yaml" }, readers: ["r"] }] },
      "知らない値",
    ],
    [
      "json-array に key が無い",
      { lists: [{ file: "a", count: { kind: "json-array" }, readers: ["r"] }] },
      ".key",
    ],
    [
      "json-arrays の exclude が配列でない",
      { lists: [{ file: "a", count: { kind: "json-arrays", exclude: "x" }, readers: ["r"] }] },
      ".exclude",
    ],
    [
      "ts-export に export が無い",
      { lists: [{ file: "a", count: { kind: "ts-export" }, readers: ["r"] }] },
      ".export",
    ],
    ["count が無い", { lists: [{ file: "a", readers: ["r"] }] }, "オブジェクトでない"],
    [
      "readers が空",
      { lists: [{ file: "a", count: { kind: "json-array", key: "x" }, readers: [] }] },
      "readers",
    ],
    [
      "keep_empty が空",
      {
        lists: [
          { file: "a", count: { kind: "json-array", key: "x" }, readers: ["r"], keep_empty: " " },
        ],
      },
      "keep_empty",
    ],
    [
      "lists の file が重複",
      {
        lists: [
          { file: "a", count: { kind: "json-array", key: "x" }, readers: ["r"] },
          { file: "a", count: { kind: "json-array", key: "y" }, readers: ["r"] },
        ],
      },
      "重複",
    ],
    ["fix_prs が無い", { fix_prs: null }, "fix_prs"],
    [
      "fix_prs.exclude が配列でない",
      { fix_prs: { days: 28, min: 3, paths: ["x"], exclude: { file: "a", reason: "r" } } },
      "fix_prs.exclude が配列でない",
    ],
    [
      "fix_prs.exclude の file が無い",
      { fix_prs: { days: 28, min: 3, paths: ["x"], exclude: [{ reason: "r" }] } },
      "fix_prs.exclude[0].file",
    ],
    [
      "fix_prs.exclude の reason が空白だけ",
      { fix_prs: { days: 28, min: 3, paths: ["x"], exclude: [{ file: "a", reason: " " }] } },
      "fix_prs.exclude[0].reason",
    ],
    [
      "fix_prs.exclude の reason が無い",
      { fix_prs: { days: 28, min: 3, paths: ["x"], exclude: [{ file: "a" }] } },
      "fix_prs.exclude[0].reason",
    ],
    [
      "fix_prs.exclude の file が重複",
      {
        fix_prs: {
          days: 28,
          min: 3,
          paths: ["x"],
          exclude: [
            { file: "a", reason: "r" },
            { file: "a", reason: "s" },
          ],
        },
      },
      "fix_prs.exclude の file が重複",
    ],
    ["min が 0", { fix_prs: { days: 28, min: 0, paths: ["x"] } }, "fix_prs.min"],
    [
      "min_ratio が負",
      {
        durations: {
          days: 7,
          workflows: ["ci.yml"],
          min_runs: 3,
          min_ratio: -1,
          min_seconds: 30,
        },
      },
      "min_ratio",
    ],
    [
      "workflows が文字列でない",
      {
        durations: { days: 7, workflows: [1], min_runs: 3, min_ratio: 0.2, min_seconds: 30 },
      },
      "workflows",
    ],
  ])("%s は例外にする", (_name, override, message) => {
    expect(() => parseConfig(configJson(override))).toThrow(message);
  });
});

describe("一覧の件数", () => {
  test.each([
    { name: "json-array", rule: { kind: "json-array", key: "e" }, value: { e: [1, 2] }, n: 2 },
    { name: "json-array の空", rule: { kind: "json-array", key: "e" }, value: { e: [] }, n: 0 },
    { name: "json-object", rule: { kind: "json-object", key: "f" }, value: { f: { a: 1 } }, n: 1 },
    {
      name: "json-arrays は除くキーの外の配列を足す",
      rule: { kind: "json-arrays", exclude: ["meta"] },
      value: { meta: [1, 2], a: [1], b: [], c: "x" },
      n: 1,
    },
    { name: "ts-export の配列", rule: { kind: "ts-export", export: "X" }, value: { X: [1] }, n: 1 },
    {
      name: "ts-export のオブジェクト",
      rule: { kind: "ts-export", export: "X" },
      value: { X: {} },
      n: 0,
    },
  ] satisfies { name: string; rule: CountRule; value: unknown; n: number }[])(
    "$name",
    ({ rule, value, n }) => {
      expect(countEntries(rule, value, "f")).toBe(n);
    },
  );

  test.each([
    {
      name: "値がオブジェクトでない",
      rule: { kind: "json-array", key: "e" },
      value: [],
      message: "オブジェクトでない",
    },
    {
      name: "配列でない",
      rule: { kind: "json-array", key: "e" },
      value: { e: {} },
      message: "配列でない",
    },
    {
      name: "オブジェクトでない",
      rule: { kind: "json-object", key: "e" },
      value: { e: [] },
      message: "オブジェクトでない",
    },
    {
      name: "数える配列が無い",
      rule: { kind: "json-arrays", exclude: ["a"] },
      value: { a: [] },
      message: "配列が無い",
    },
    { name: "export が無い", rule: { kind: "ts-export", export: "X" }, value: {}, message: "X" },
    {
      name: "export が Map",
      rule: { kind: "ts-export", export: "X" },
      value: { X: new Map([["a", 1]]) },
      message: "素のオブジェクトでない",
    },
  ] satisfies { name: string; rule: CountRule; value: unknown; message: string }[])(
    "$name は例外にする",
    ({ rule, value, message }) => {
      expect(() => countEntries(rule, value, "f")).toThrow(message);
    },
  );
});

describe("空の一覧", () => {
  const target = (file: string, readers = ["r.ts"]) => ({
    file,
    count: { kind: "json-array", key: "exempt" } as const,
    readers,
  });

  test("keep_empty に理由を書いた一覧は、空でも挙げない", async () => {
    const root = makeTempDir("check-cost-metrics-");
    writeFiles(root, { "empty.json": '{"exempt": []}' });
    expect(await emptyLists([{ ...target("empty.json"), keepEmpty: "理由" }], root)).toEqual([]);
  });

  test("空の一覧だけを挙げ、readers を案内として添える（JSON と TypeScript の export）", async () => {
    const root = makeTempDir("check-cost-metrics-");
    writeFiles(root, {
      "empty.json": '{"exempt": []}',
      "full.json": '{"exempt": ["x"]}',
      "pending.ts": "export const PENDING = {};\n",
    });
    const lists = [
      target("empty.json", ["r.ts", "w.yml"]),
      target("full.json"),
      {
        file: "pending.ts",
        count: { kind: "ts-export", export: "PENDING" } as const,
        readers: ["r.ts"],
      },
    ];
    expect(await emptyLists(lists, root)).toEqual([
      {
        kind: "empty-list",
        target: "empty.json",
        detail: "r.ts、w.yml",
      },
      { kind: "empty-list", target: "pending.ts", detail: "r.ts" },
    ]);
  });

  test("readers のファイルが無い・一覧の名前を含まないときも、失敗せずに数える", async () => {
    const root = makeTempDir("check-cost-metrics-");
    writeFiles(root, { "a.json": '{"exempt": []}', "r.ts": 'load("other.json");' });
    expect(await emptyLists([target("a.json", ["r.ts", "none.ts"])], root)).toEqual([
      {
        kind: "empty-list",
        target: "a.json",
        detail: "r.ts、none.ts",
      },
    ]);
  });

  test("一覧のファイルが無ければ例外にする", async () => {
    const root = makeTempDir("check-cost-metrics-");
    await expect(emptyLists([target("a.json")], root)).rejects.toThrow("a.json");
  });
});

/** `git log` の 1 件（fixHeavyChecks が読む形）。 */
const rec = (subject: string, body: string, status: string) =>
  `\u001esha\u001f${subject}\u001f${body}\u001f\n\n${status}\n`;

describe("修正の PR", () => {
  test.each([
    { name: "squash した PR は件名", subject: "fix: a (#1)", body: "", title: "fix: a (#1)" },
    {
      name: "マージの commit は本文の 1 行目",
      subject: "Merge pull request #2 from x/y",
      body: "\nfix(x): b\n\nRefs",
      title: "fix(x): b",
    },
    { name: "本文が空のマージ", subject: "Merge pull request #3 from x/y", body: "", title: "" },
  ])("$name", ({ subject, body, title }) => {
    expect(prTitle(subject, body)).toBe(title);
  });

  test("テストと変異の定義は本体に寄せる", () => {
    expect(checkFileOf("a/b.test.ts")).toBe("a/b.ts");
    expect(checkFileOf("a/b.mutations.json")).toBe("a/b.ts");
    expect(checkFileOf("lefthook.yml")).toBe("lefthook.yml");
  });

  test("同じ名前の本体が無いテストと変異の定義は、テストをチェックとして数える", () => {
    const exists = (path: string) => path === "a/b.ts";
    expect(checkFileOf("a/b.test.ts", exists)).toBe("a/b.ts");
    expect(checkFileOf("a/scope.test.ts", exists)).toBe("a/scope.test.ts");
    expect(checkFileOf("a/scope.mutations.json", exists)).toBe("a/scope.test.ts");
    const log = [
      rec("fix: a (#2)", "", "M\tscope.test.ts"),
      rec("fix: b (#1)", "", "M\tscope.mutations.json"),
    ].join("");
    expect(Object.fromEntries(countFixPrs(log, () => false))).toEqual({ "scope.test.ts": 2 });
  });

  test("fix の PR だけを、PR ごとに 1 回、今の名前で数える", () => {
    // ログは新しい順。古い PR は前の名前（old.ts）を変えている。
    const log = [
      rec("feat: c (#5)", "", "M\tnew.ts"),
      rec("Merge pull request #4 from x/y", "fix!: d", "R100\told.ts\tnew.ts\nM\tnew.test.ts"),
      rec("fix(gate): e (#3)", "", "M\told.ts\nM\told.mutations.json"),
      rec("fix: f (#2)", "", "A\tother.ts\nD\tgone.ts"),
      rec("chore: g (#1)", "", "M\tother.ts"),
    ].join("");
    expect(Object.fromEntries(countFixPrs(log))).toEqual({
      "new.ts": 2,
      "other.ts": 1,
      "gone.ts": 1,
    });
  });

  const gitRun =
    (log: string, shallow = "false", files = "new.ts\nother.ts\n"): Runner =>
    async (command, args) => {
      if (command !== "git") throw new Error(`想定していない呼び出し: ${command}`);
      // git は root で実行する（-C <root>）。
      if (args[0] !== "-C" || args[1] !== "/repo")
        throw new Error(`root で実行していない: ${args.join(" ")}`);
      if (args[2] === "rev-parse") return `${shallow}\n`;
      if (args[2] === "ls-files") return files;
      if (args[2] === "log") return log;
      throw new Error(`想定していない git: ${args.join(" ")}`);
    };

  test("閾値以上で、今あるファイルだけを多い順に挙げる", async () => {
    const log = [
      rec("fix: a (#1)", "", "M\tnew.ts\nM\tother.ts\nM\tgone.ts"),
      rec("fix: b (#2)", "", "M\tnew.ts\nM\tgone.ts"),
      rec("fix: c (#3)", "", "M\tnew.ts\nM\tgone.ts"),
    ].join("");
    expect(
      await fixHeavyChecks(
        gitRun(log),
        { days: 28, min: 2, paths: ["x"] },
        { root: "/repo", now: NOW, lists: [] },
      ),
    ).toEqual([{ kind: "fix-heavy", target: "new.ts", detail: "直近 28 日の fix の PR: 3 件" }]);
  });

  test("exclude に載せたファイルは閾値以上でも挙げず、載せていないファイルは今までどおり挙げる", async () => {
    const log = [
      rec("fix: a (#1)", "", "M\tnew.ts\nM\tother.ts"),
      rec("fix: b (#2)", "", "M\tnew.ts\nM\tother.ts"),
    ].join("");
    expect(
      await fixHeavyChecks(
        gitRun(log),
        { days: 28, min: 2, paths: ["x"], exclude: [{ file: "new.ts", reason: "起動の設定" }] },
        { root: "/repo", now: NOW, lists: [] },
      ),
    ).toEqual([{ kind: "fix-heavy", target: "other.ts", detail: "直近 28 日の fix の PR: 2 件" }]);
  });

  test("lists に載せた免除・保留の一覧は、閾値以上でも挙げない", async () => {
    const log = [
      rec("fix: a (#1)", "", "M\tnew.ts\nM\tother.ts"),
      rec("fix: b (#2)", "", "M\tnew.ts\nM\tother.ts"),
    ].join("");
    expect(
      await fixHeavyChecks(
        gitRun(log),
        { days: 28, min: 2, paths: ["x"] },
        { root: "/repo", now: NOW, lists: ["new.ts"] },
      ),
    ).toEqual([{ kind: "fix-heavy", target: "other.ts", detail: "直近 28 日の fix の PR: 2 件" }]);
  });

  test("本体の無いテストは、今あるファイルの一覧で判定し、テストをチェックとして挙げる", async () => {
    const log = [
      rec("fix: a (#1)", "", "M\tscope.test.ts"),
      rec("fix: b (#2)", "", "M\tscope.test.ts"),
    ].join("");
    const run = gitRun(log, "false", "scope.test.ts\n");
    expect(
      await fixHeavyChecks(
        run,
        { days: 28, min: 2, paths: ["x"] },
        { root: "/repo", now: NOW, lists: [] },
      ),
    ).toEqual([
      { kind: "fix-heavy", target: "scope.test.ts", detail: "直近 28 日の fix の PR: 2 件" },
    ]);
  });

  test("履歴が浅ければ例外にする", async () => {
    await expect(
      fixHeavyChecks(
        gitRun("", "true"),
        { days: 28, min: 2, paths: ["x"] },
        { root: "/repo", now: NOW, lists: [] },
      ),
    ).rejects.toThrow("履歴が浅い");
  });
});

describe("ジョブの所要時間", () => {
  const run = (id: number, daysAgo: number, head = "o/r") => ({
    id,
    name: "CI",
    event: "pull_request",
    created_at: iso(daysAgo),
    head_repository: { full_name: head },
    repository: { full_name: "o/r" },
  });
  const job = (name: string, secondsTaken: number, conclusion = "success") => ({
    name,
    conclusion,
    started_at: "2026-11-01T00:00:00Z",
    completed_at: new Date(Date.parse("2026-11-01T00:00:00Z") + secondsTaken * 1000).toISOString(),
  });

  test("成功したジョブだけを、ワークフロー・ジョブ・イベントの組で取る", () => {
    expect(jobSamples(run(1, 1), [job("Lint", 60), job("Unit", 90, "failure")])).toEqual([
      { key: "CI / Lint（pull_request）", seconds: 60, at: Date.parse(iso(1)) },
    ]);
  });

  test.each([
    ["run の name", { ...run(1, 1), name: undefined }, job("Lint", 60)],
    ["run の event", { ...run(1, 1), event: "" }, job("Lint", 60)],
    ["job の name", run(1, 1), { ...job("Lint", 60), name: null }],
  ])("%s が無ければ、別のジョブとまとめずに例外にする", (where, r, j) => {
    expect(() => jobSamples(r, [j])).toThrow(`${where} が空でない文字列でない`);
  });

  test("日時が無いジョブは例外にする", () => {
    expect(() => jobSamples(run(1, 1), [{ name: "x", conclusion: "success" }])).toThrow(
      "日時でない",
    );
  });

  test("中央値と最大値", () => {
    expect(stats([3, 1, 2])).toEqual({ runs: 3, median: 2, max: 3 });
    expect(stats([4, 1, 2, 3])).toEqual({ runs: 4, median: 2.5, max: 4 });
    expect(stats([])).toEqual({ runs: 0, median: 0, max: 0 });
  });

  test("境界より前は前の期間、境界以後は直近の期間", () => {
    const split = Date.parse(iso(7));
    const rows = compareJobs(
      [
        { key: "a", seconds: 10, at: split - 1 },
        { key: "a", seconds: 20, at: split },
        { key: "b", seconds: 5, at: split },
      ],
      split,
    );
    expect(rows).toEqual([
      {
        key: "a",
        current: { runs: 1, median: 20, max: 20 },
        previous: { runs: 1, median: 10, max: 10 },
      },
      {
        key: "b",
        current: { runs: 1, median: 5, max: 5 },
        previous: { runs: 0, median: 0, max: 0 },
      },
    ]);
  });

  const row = (prevMedian: number, curMedian: number, runs = 3): JobRow => ({
    key: "CI / Lint（pull_request）",
    current: { runs, median: curMedian, max: curMedian },
    previous: { runs, median: prevMedian, max: prevMedian },
  });

  test.each([
    ["割合と秒数の両方で増えた", row(100, 130), true],
    ["秒数だけ増えた（割合が足りない）", row(1000, 1100), false],
    ["割合だけ増えた（秒数が足りない）", row(10, 30), false],
    ["回数が足りない", row(100, 200, 2), false],
    ["速くなった", row(200, 100), false],
  ])("%s", (_name, r, expected) => {
    expect(isSlower(r, durations)).toBe(expected);
  });

  test("遅くなったジョブを候補にする", () => {
    expect(slowJobs([row(100, 130), row(100, 101)], durations)).toEqual([
      {
        kind: "slow-job",
        target: "CI / Lint（pull_request）",
        detail: "中央値 100 秒 → 130 秒",
      },
    ]);
  });

  const apiRun =
    (runsPage: Record<string, unknown>, jobs: Record<string, unknown[]>): Runner =>
    async (command, args) => {
      const path = args.at(-1) ?? "";
      if (command !== "gh") throw new Error(`想定していない呼び出し: ${command}`);
      if (path.includes("/workflows/")) return JSON.stringify([runsPage]);
      const id = /runs\/(\d+)\/jobs/u.exec(path)?.[1] ?? "";
      const list = jobs[id];
      if (list === undefined) throw new Error(`想定していない run: ${id}`);
      return JSON.stringify([{ total_count: list.length, jobs: list }]);
    };

  test("run とジョブを取得して、期間ごとに比べる（期間の外の run は読まない）", async () => {
    const runs = [run(1, 1), run(2, 2), run(3, 3), run(4, 8), run(5, 9), run(6, 10), run(7, 20)];
    const jobs = {
      "1": [job("Lint", 200)],
      "2": [job("Lint", 200)],
      "3": [job("Lint", 200)],
      "4": [job("Lint", 100)],
      "5": [job("Lint", 100)],
      "6": [job("Lint", 100)],
    };
    const rows = await jobRows(
      apiRun({ total_count: runs.length, workflow_runs: runs }, jobs),
      durations,
      NOW,
    );
    expect(rows).toEqual([
      {
        key: "CI / Lint（pull_request）",
        current: { runs: 3, median: 200, max: 200 },
        previous: { runs: 3, median: 100, max: 100 },
      },
    ]);
  });

  test("fork の PR の run は、ジョブを取得せずに数えない", async () => {
    // fork の run（id 9）のジョブは apiRun に用意していないので、取得すると例外になる。
    // fork が削除された PR の run（id 8）は head_repository が null になる。これも数えない
    const runs = [
      run(1, 1),
      run(9, 1, "someone/r"),
      { ...run(8, 1), head_repository: null },
      run(4, 8),
    ];
    const rows = await jobRows(
      apiRun(
        { total_count: runs.length, workflow_runs: runs },
        {
          "1": [job("Lint", 200)],
          "4": [job("Lint", 100)],
        },
      ),
      durations,
      NOW,
    );
    expect(rows.map((r) => r.key)).toEqual(["CI / Lint（pull_request）"]);
    expect(rows[0]?.current.runs).toBe(1);
  });

  test.each([
    ["head_repository が無い", { head_repository: undefined }, "head_repository.full_name"],
    ["repository の full_name が空", { repository: { full_name: "" } }, "repository.full_name"],
  ])("run の %s ときは、fork かを決められないので例外にする", async (_name, patch, message) => {
    const runs = [{ ...run(1, 1), ...patch }];
    await expect(
      jobRows(apiRun({ total_count: 1, workflow_runs: runs }, { "1": [] }), durations, NOW),
    ).rejects.toThrow(message);
  });

  test.each([
    ["1000 件を超える", { total_count: 1001, workflow_runs: [] }, "取りこぼす"],
    ["total_count が無い", { workflow_runs: [] }, "total_count"],
    ["workflow_runs が配列でない", { total_count: 0, workflow_runs: {} }, "配列でない"],
  ])("一覧の %s ときは例外にする", async (_name, page, message) => {
    await expect(jobRows(apiRun(page, {}), durations, NOW)).rejects.toThrow(message);
  });

  test("API の失敗は該当なしとして扱わない", async () => {
    const failing: Runner = async () => {
      throw new Error("HTTP 502");
    };
    await expect(jobRows(failing, durations, NOW)).rejects.toThrow("HTTP 502");
  });

  test("ページの配列でない応答は例外にする", async () => {
    const bad: Runner = async () => "{}";
    await expect(jobRows(bad, durations, NOW)).rejects.toThrow("ページの配列でない");
  });
});

test("本番の呼び出しは stdout を返し、0 以外の終了と起動の失敗を stderr を添えて例外にする", async () => {
  expect(await defaultRunner(process.execPath, ["-e", "process.stdout.write('ok')"])).toBe("ok");
  await expect(
    defaultRunner(process.execPath, ["-e", "process.stderr.write('理由'); process.exit(3)"]),
  ).rejects.toThrow(/終了コード 3.*理由/su);
  await expect(defaultRunner("check-cost-metrics-no-such-command", [])).rejects.toThrow(
    /^check-cost-metrics-no-such-command {2}が失敗した（.*ENOENT.*）/u,
  );
});

test("並べて処理しても、入力の順で返し、失敗を reject する", async () => {
  const order: number[] = [];
  const result = await mapLimit([60, 10, 20], 2, async (ms) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    order.push(ms);
    return ms * 2;
  });
  expect(result).toEqual([120, 20, 40]);
  expect(order).toEqual([10, 20, 60]);
  await expect(
    mapLimit([1, 2], 2, async (n) => {
      if (n === 2) throw new Error("失敗");
      return n;
    }),
  ).rejects.toThrow("失敗");
  expect(await mapLimit([], 2, async (n: number) => n)).toEqual([]);
});

describe("追跡 Issue の本文", () => {
  const findings: Finding[] = [
    { kind: "empty-list", target: "a.json", detail: "r.ts、w.yml" },
    { kind: "slow-job", target: "CI / Lint | x（pull_request）", detail: "中央値 1 秒 → 2 秒" },
  ];
  const config = parseConfig(configJson());
  const rows: JobRow[] = [
    {
      key: "CI / Lint（pull_request）",
      current: { runs: 3, median: 12.4, max: 20 },
      previous: { runs: 2, median: 10, max: 11 },
    },
  ];

  test("候補の表・所要時間の表・識別子を書き、表の | をエスケープする", () => {
    const body = formatBody({ findings, rows, config });
    expect(body).toContain("直す候補: 2 件");
    expect(body).toContain("readers に書いた案内で、一覧を読む処理を示す。");
    expect(body).toContain("| 空の免除・保留の一覧 | a.json | r.ts、w.yml | 新規 |");
    expect(body).toContain("| 遅くなったジョブ | CI / Lint \\| x（pull_request） |");
    expect(body).toContain("| CI / Lint（pull_request） | 3 | 12 秒 | 20 秒 | 2 | 10 秒 | 11 秒 |");
    expect(previousKeys(body)).toEqual([
      "empty-list a.json",
      "slow-job CI / Lint | x（pull_request）",
    ]);
  });

  test("空の一覧の候補が無ければ、readers の注記を書かない", () => {
    const body = formatBody({ findings: findings.slice(1), rows, config });
    expect(body).toContain("| 遅くなったジョブ |");
    expect(body).not.toContain("readers に書いた");
  });

  test("0 件は候補の表を書かない", () => {
    const body = formatBody({ findings: [], rows: [], config });
    expect(body).toContain("直す候補: 0 件");
    expect(body).not.toContain("| 指標 |");
    expect(body).not.toContain("readers に書いた");
    expect(previousKeys(body)).toEqual([]);
  });

  test("前回と比べ、継続と解消を書く（件数が変わっても同じ識別子）", () => {
    const previous = ["empty-list a.json", "fix-heavy lefthook.yml"];
    const body = formatBody({ findings, rows, config }, previous);
    expect(body).toContain("| a.json | r.ts、w.yml | 継続 |");
    expect(body).toContain("前回から解消したもの: fix-heavy lefthook.yml");
    expect(diffFindings(findings, previous).kept).toEqual(["empty-list a.json"]);
    expect(formatComment(findings, previous)).toContain(
      "直す候補: 2 件（新規 1 件・継続 1 件・前回から解消 1 件）",
    );
  });

  test.each([
    ["種別が知らない値", `["other a"]`],
    ["対象が空", `["empty-list "]`],
  ])("前回の識別子が %s ときは例外にする", (_name, json) => {
    expect(() => previousKeys(`<!-- check-cost-metrics:keys ${json} -->\n`)).toThrow(
      "識別子の形でない",
    );
  });
});

describe("まとめて集める", () => {
  test("3 つの指標を集める", async () => {
    const root = makeTempDir("check-cost-metrics-");
    writeFiles(root, { "a.json": '{"exempt": []}' });
    const run: Runner = async (command, args) => {
      if (command === "git") return args[2] === "rev-parse" ? "false\n" : "";
      return JSON.stringify([{ total_count: 0, workflow_runs: [] }]);
    };
    const result = await collect(run, { config: parseConfig(configJson()), root, now: NOW });
    expect(result.findings).toEqual([{ kind: "empty-list", target: "a.json", detail: "r.ts" }]);
    expect(result.rows).toEqual([]);
  });

  test("修正の PR の数え方から、lists に載せた一覧を外す", async () => {
    const root = makeTempDir("check-cost-metrics-");
    writeFiles(root, { "a.json": '{"exempt": [1]}' });
    const log = ["#1", "#2", "#3"]
      .map((n) => rec(`fix: x (${n})`, "", "M\ta.json\nM\tb.ts"))
      .join("");
    const run: Runner = async (command, args) => {
      if (command !== "git") return JSON.stringify([{ total_count: 0, workflow_runs: [] }]);
      if (args[2] === "rev-parse") return "false\n";
      if (args[2] === "ls-files") return "a.json\nb.ts\n";
      return log;
    };
    const result = await collect(run, { config: parseConfig(configJson()), root, now: NOW });
    expect(result.findings).toEqual([
      { kind: "fix-heavy", target: "b.ts", detail: "直近 28 日の fix の PR: 3 件" },
    ]);
  });
});

describe("CLI", () => {
  const okRun: Runner = async (command, args) => {
    if (command === "git") return args[2] === "rev-parse" ? "false\n" : "";
    return JSON.stringify([{ total_count: 0, workflow_runs: [] }]);
  };

  test.each([
    ["引数なし", []],
    ["--comment-out が無い", ["--out", "a"]],
    ["未知のオプション", ["--out", "a", "--comment-out", "b", "--x", "c"]],
    ["--previous が空", ["--out", "a", "--comment-out", "b", "--previous", ""]],
  ])("%s は 2", async (_name, args) => {
    expect(await main(args, okRun)).toBe(2);
  });

  const setup = () => {
    const root = makeTempDir("check-cost-metrics-");
    writeFiles(root, {
      "a.json": '{"exempt": []}',
      "config.json": configJson(),
    });
    return { root, config: join(root, "config.json") };
  };

  test("本文とコメントを書き、due を出す", async () => {
    const { root, config } = setup();
    const previous = join(root, "previous.md");
    writeFileSync(previous, `<!-- check-cost-metrics:keys ["fix-heavy x.ts"] -->\n`);
    const args = [
      "--out",
      join(root, "b.md"),
      "--comment-out",
      join(root, "c.md"),
      "--previous",
      previous,
    ];
    expect(await main(args, okRun, { config, root, now: NOW })).toBe(0);
    expect(readFileSync(join(root, "b.md"), "utf8")).toContain("直す候補: 1 件");
    expect(readFileSync(join(root, "c.md"), "utf8")).toContain("解消: fix-heavy x.ts");
  });

  test("確かめられなければ 1", async () => {
    const { root, config } = setup();
    const failing: Runner = async () => {
      throw new Error("HTTP 502");
    };
    const args = ["--out", join(root, "b.md"), "--comment-out", join(root, "c.md")];
    expect(await main(args, failing, { config, root, now: NOW })).toBe(1);
    expect(await main(args, okRun, { config, root: join(root, "none"), now: NOW })).toBe(1);
  });
});
