// test-lines.ts（テストと実装の行数）のテスト。
//
// | 軸 | 値 |
// | --- | --- |
// | git grep の出力 | 正しい / 空 / commit の接頭辞が違う / 行数が数でない / NUL が 2 つ / NUL が無い / パスが : を含む / パスが改行を含む（合成と本物の git） |
// | glob | 素の glob / 空 / : で始まる / / で始まる |
// | 数えるファイル | テスト / 実装（テストの glob に当たるものは外す）/ 0 行のファイル / どちらかの glob に当たるファイルが無い |
// | 比べる commit | 期間の始まりより前の最後の first-parent の commit / 期間の始まりより前の commit が無い |
// | 比の上昇率 | 上限の未満・ちょうど・超える / テストと実装が同じ割合で大きく増える / 実装が速い / 両方減る |
// | 増えたファイル | 新しいファイル / 増えた / 同じ・減った（載せない）/ 増分が同じ（名前の順）/ 件数の上限なし / 名前を変えた |
// | CLI | 表を書く（exit 0）/ 数えられない（exit 1）/ 設定に test_lines が無い（exit 1）/ --out が無い・知らない引数（exit 2） |
// | 名前の変更の出力 | 0 件 / 1 件・複数 / 3 つ組でない / R で始まらない / 名前が空 |
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";
import { gitAt, initRepo } from "../../lib/testing/git-at.ts";
import { writeFiles } from "../../lib/testing/repo-file.ts";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";
import { defaultRunner } from "./check-cost-metrics.ts";
import {
  collectTestLines,
  grownTestFiles,
  isPlainGlob,
  main,
  parseCounts,
  parseRenames,
  type TestLinesConfig,
  testLinesFindings,
  type TestLinesMetrics,
  testLinesTable,
} from "./test-lines.ts";

const NOW = new Date("2026-11-11T03:00:00Z");

const config: TestLinesConfig = {
  days: 7,
  tests: ["scripts/**/*.test.ts"],
  implementation: ["scripts/**/*.ts", "skills/**/*.mjs"],
  maxRatioIncreasePercent: 5,
};

const C = "c".repeat(40);

describe("git grep の出力", () => {
  test("パスごとの行数にし、: を含むパスも commit の接頭辞だけを外す", () => {
    const out = `${C}:scripts/a.test.ts\u00003\n${C}:scripts/b:c.ts\u000012\n`;
    expect(parseCounts(out, C)).toEqual(
      new Map([
        ["scripts/a.test.ts", 3],
        ["scripts/b:c.ts", 12],
      ]),
    );
  });

  test("改行を含むパスを、改行で区切らずに 1 件として読む", () => {
    const out = `${C}:a\nb.test.ts\u00002\n${C}:c.test.ts\u00001\n`;
    expect(parseCounts(out, C)).toEqual(
      new Map([
        ["a\nb.test.ts", 2],
        ["c.test.ts", 1],
      ]),
    );
  });

  test("空の出力は 0 件", () => {
    expect(parseCounts("", C).size).toBe(0);
  });

  test.each([
    ["commit の接頭辞が違う", `${"d".repeat(40)}:a.ts\u00001\n`],
    ["行数が数でない", `${C}:a.ts\u0000x\n`],
    ["NUL が 2 つ", `${C}:a.ts\u00001\u00002\n`],
    ["NUL が無い", `${C}:a.ts:1\n`],
    ["最後の件が行数で終わらない", `${C}:a.ts\u00001\n${C}:b.ts`],
  ])("%s は例外にする", (_name, out) => {
    expect(() => parseCounts(out, C)).toThrow("パスと行数の形でない");
  });
});

describe("git diff の名前の変更の出力", () => {
  test("今の名前から前の名前への対応にする", () => {
    const out = "R100\0a/old.test.ts\0a/new.test.ts\0R087\0b.test.ts\0c/b.test.ts\0";
    expect(parseRenames(out)).toEqual(
      new Map([
        ["a/new.test.ts", "a/old.test.ts"],
        ["c/b.test.ts", "b.test.ts"],
      ]),
    );
    expect(parseRenames("").size).toBe(0);
  });

  test.each([
    ["3 つ組でない", "R100\0a.test.ts\0"],
    ["R で始まらない", "M\0a.test.ts\0b.test.ts\0"],
    ["名前が空", "R100\0\0b.test.ts\0"],
  ])("%s は例外にする", (_name, out) => {
    expect(() => parseRenames(out)).toThrow("git diff の名前の変更の出力");
  });
});

describe("glob", () => {
  test.each([
    ["scripts/**/*.test.ts", true],
    ["", false],
    [":(exclude)x", false],
    ["/scripts/*.ts", false],
  ])("%j は %s", (glob, expected) => {
    expect(isPlainGlob(glob)).toBe(expected);
  });
});

const lines = (n: number): string => "x\n".repeat(n);

/** commits は古い順。各要素は、何日前に、どのファイルを書くか。 */
function buildRepo(commits: { daysAgo: number; files: Record<string, string> }[]): string {
  const root = makeTempDir("test-lines-");
  const git = gitAt(root, NOW);
  initRepo(git);
  for (const c of commits) {
    writeFiles(root, c.files);
    git(["add", "-A"], c.daysAgo);
    git(["commit", "-qm", `d${c.daysAgo}`], c.daysAgo);
  }
  return root;
}

describe("行数を数える（本物の git）", () => {
  test("HEAD と、期間の始まりより前の最後の commit で数え、テストを実装から外す", async () => {
    const root = buildRepo([
      { daysAgo: 20, files: { "scripts/a.test.ts": lines(1), "scripts/a.ts": lines(5) } },
      // 期間の始まり（7 日前）より前の最後の commit。比べる相手はこれになる。
      { daysAgo: 8, files: { "scripts/a.test.ts": lines(2), "skills/x/s.mjs": lines(3) } },
      {
        daysAgo: 1,
        files: {
          "scripts/a.test.ts": lines(4),
          "scripts/b.test.ts": lines(1),
          "scripts/empty.ts": "",
          "docs/a.md": lines(100),
        },
      },
    ]);
    // 前の commit の後に名前を変えたテストは、前の名前の行数と比べる。
    mkdirSync(join(root, "scripts/sub"));
    gitAt(root, NOW)(["mv", "scripts/a.test.ts", "scripts/sub/a.test.ts"], 1);
    gitAt(root, NOW)(["commit", "-qm", "mv"], 1);
    const m = await collectTestLines(defaultRunner, { root, now: NOW, config });
    expect(m.current.tests).toEqual(
      new Map([
        ["scripts/b.test.ts", 1],
        ["scripts/sub/a.test.ts", 4],
      ]),
    );
    expect(m.renames).toEqual(new Map([["scripts/sub/a.test.ts", "scripts/a.test.ts"]]));
    expect(grownTestFiles(m)).toEqual([
      { path: "scripts/sub/a.test.ts", lines: 4, delta: 2 },
      { path: "scripts/b.test.ts", lines: 1, delta: 1 },
    ]);
    expect(m.current.implementation).toEqual(
      new Map([
        ["scripts/a.ts", 5],
        ["skills/x/s.mjs", 3],
      ]),
    );
    expect(m.previous.tests).toEqual(new Map([["scripts/a.test.ts", 2]]));
    expect(m.previous.implementation).toEqual(
      new Map([
        ["scripts/a.ts", 5],
        ["skills/x/s.mjs", 3],
      ]),
    );
    expect(m.current.commit).toMatch(/^[0-9a-f]{40}$/u);
    expect(m.previous.commit).not.toBe(m.current.commit);
  });

  test("改行を含むテストのファイルも、ほかのファイルと同じに数える", async () => {
    const root = buildRepo([
      {
        daysAgo: 10,
        files: { "scripts/a\nb.test.ts": lines(2), "scripts/a.ts": lines(1) },
      },
    ]);
    const m = await collectTestLines(defaultRunner, { root, now: NOW, config });
    expect(m.current.tests).toEqual(new Map([["scripts/a\nb.test.ts", 2]]));
  });

  test("期間の始まりより前の commit が無ければ例外にする", async () => {
    const root = buildRepo([
      { daysAgo: 1, files: { "scripts/a.test.ts": lines(1), "scripts/a.ts": lines(1) } },
    ]);
    await expect(collectTestLines(defaultRunner, { root, now: NOW, config })).rejects.toThrow(
      "より前の commit が無い",
    );
  });

  test("前の時点にテストの glob に当たるファイルが無ければ、0 行として扱わず例外にする", async () => {
    const root = buildRepo([
      { daysAgo: 10, files: { "scripts/a.ts": lines(1) } },
      { daysAgo: 1, files: { "scripts/a.test.ts": lines(1) } },
    ]);
    await expect(collectTestLines(defaultRunner, { root, now: NOW, config })).rejects.toThrow(
      /git -C \S+ grep /u,
    );
  });

  test("当たるファイルが 0 行のファイルだけなら例外にする", async () => {
    const root = buildRepo([
      { daysAgo: 10, files: { "scripts/a.test.ts": lines(1), "scripts/a.ts": "" } },
    ]);
    await expect(collectTestLines(defaultRunner, { root, now: NOW, config })).rejects.toThrow(
      /git -C \S+ grep /u,
    );
  });

  test("当たる出力が空なら、実装の glob に当たるファイルが無いと書いて例外にする", async () => {
    const run = async (_command: string, args: readonly string[]): Promise<string> => {
      if (args[2] === "rev-parse") return `${C}\n`;
      if (args[2] === "rev-list") return `${C}\n`;
      if (args[2] === "diff") return "";
      return args.some((a) => a.startsWith(":(exclude,glob)")) ? "" : `${C}:a.test.ts\u00001\n`;
    };
    await expect(collectTestLines(run, { root: "/r", now: NOW, config })).rejects.toThrow(
      `${C} に、実装の glob に当たるファイルが無い`,
    );
  });
});

const metrics = (
  tests: [number, number],
  impl: [number, number],
  extra: {
    current?: Map<string, number>;
    previous?: Map<string, number>;
    renames?: Map<string, string>;
  } = {},
): TestLinesMetrics => ({
  renames: extra.renames ?? new Map(),
  current: {
    commit: "a".repeat(40),
    tests: extra.current ?? new Map([["t.test.ts", tests[0]]]),
    implementation: new Map([["i.ts", impl[0]]]),
  },
  previous: {
    commit: "b".repeat(40),
    tests: extra.previous ?? new Map([["t.test.ts", tests[1]]]),
    implementation: new Map([["i.ts", impl[1]]]),
  },
});

describe("候補に挙げるか", () => {
  test.each([
    // 比の上昇率は (テスト ÷ 前のテスト) ÷ (実装 ÷ 前の実装) - 1。
    {
      name: "比の上昇率が上限の未満（実装より少し多く増えた）",
      tests: [108, 100],
      impl: [104, 100],
      due: false,
    },
    { name: "比の上昇率が上限とちょうど同じ", tests: [105, 100], impl: [100, 100], due: false },
    { name: "比の上昇率が上限を超える", tests: [106, 100], impl: [100, 100], due: true },
    {
      name: "テストと実装が同じ割合で大きく増えた",
      tests: [150, 100],
      impl: [150, 100],
      due: false,
    },
    { name: "実装のほうが速く増えた", tests: [120, 100], impl: [130, 100], due: false },
    { name: "テストの減り方が実装より小さい", tests: [80, 100], impl: [50, 100], due: true },
  ] as const)("$name", ({ tests, impl, due }) => {
    const found = testLinesFindings(metrics([...tests], [...impl]), config);
    expect(found.length > 0).toBe(due);
  });

  test("候補の内容に、テストと実装の増分と増加率、比の上昇率と上限を書く", () => {
    expect(testLinesFindings(metrics([120, 100], [100, 100]), config)).toEqual([
      {
        kind: "test-growth",
        target: "scripts/**/*.test.ts",
        detail:
          "直近 7 日でテスト +20 行（+20.0%）、実装 +0 行（+0.0%）、テスト ÷ 実装の比 +20.0%（上限 +5%）",
      },
    ]);
  });
});

describe("行数の増えたテストのファイル", () => {
  test("増分の大きい順（同じなら名前の順）にすべて載せ、増えないファイルは載せない", () => {
    const m = metrics([0, 0], [1, 1], {
      current: new Map([
        ["b.test.ts", 5],
        ["a.test.ts", 5],
        ["new.test.ts", 9],
        ["same.test.ts", 3],
        ["less.test.ts", 1],
      ]),
      previous: new Map([
        ["b.test.ts", 1],
        ["a.test.ts", 1],
        ["same.test.ts", 3],
        ["less.test.ts", 4],
      ]),
    });
    expect(grownTestFiles(m)).toEqual([
      { path: "new.test.ts", lines: 9, delta: 9 },
      { path: "a.test.ts", lines: 5, delta: 4 },
      { path: "b.test.ts", lines: 5, delta: 4 },
    ]);
  });

  test("名前を変えたファイルは前の名前の行数と比べ、増えていなければ載せない", () => {
    const m = metrics([0, 0], [1, 1], {
      current: new Map([["sub/a.test.ts", 5]]),
      previous: new Map([["a.test.ts", 5]]),
      renames: new Map([["sub/a.test.ts", "a.test.ts"]]),
    });
    expect(grownTestFiles(m)).toEqual([]);
  });
});

describe("本文の表", () => {
  test("行数・増分・増加率・比と、増えたファイルを書き、表の | をエスケープする", () => {
    const m = metrics([120, 100], [200, 160], {
      current: new Map([["a|b.test.ts", 120]]),
      previous: new Map([["a|b.test.ts", 100]]),
    });
    const body = testLinesTable(m, config).join("\n");
    expect(body).toContain("| テスト | 120 | 100 | +20 | +20.0% |");
    expect(body).toContain("| 実装 | 200 | 160 | +40 | +25.0% |");
    expect(body).toContain("| テスト ÷ 実装 | 0.600 | 0.625 | | -4.0% |");
    expect(body).toContain("行数の増えたテストのファイル（1 件。増分の大きい順）");
    expect(body).toContain("| a\\|b.test.ts | 120 | +20 |");
    expect(body).toContain("HEAD（aaaaaaa）と 7 日前の first-parent の commit（bbbbbbb）");
  });

  test("増えたファイルが無ければ、そう書く", () => {
    const body = testLinesTable(metrics([100, 100], [1, 1]), config).join("\n");
    expect(body).toContain("行数の増えたテストのファイルは無い。");
  });
});

describe("CLI", () => {
  const repo = () =>
    buildRepo([
      { daysAgo: 10, files: { "scripts/a.test.ts": lines(1), "scripts/a.ts": lines(2) } },
      { daysAgo: 1, files: { "scripts/a.test.ts": lines(3) } },
    ]);
  const configFile = (root: string, testLines: unknown): string => {
    const path = join(root, "config.json");
    writeFileSync(path, JSON.stringify({ test_lines: testLines }));
    return path;
  };
  const TEST_LINES = {
    days: 7,
    tests: ["scripts/**/*.test.ts"],
    implementation: ["scripts/**/*.ts"],
    max_ratio_increase_percent: 5,
  };

  test("設定の test_lines で数え、表を --out に書いて 0 を返す", async () => {
    const root = repo();
    const out = join(root, "table.md");
    const args = ["--out", out, "--config", configFile(root, TEST_LINES)];
    expect(await main(args, { root, now: NOW })).toBe(0);
    const body = readFileSync(out, "utf8");
    expect(body).toContain("| テスト | 3 | 1 | +2 | +200.0% |");
    expect(body).toContain("| scripts/a.test.ts | 3 | +2 |");
  });

  test.each([
    [
      "数えられない（期間より前の commit が無い）",
      { ...TEST_LINES, days: 30 },
      "より前の commit が無い",
    ],
    ["設定に test_lines が無い", undefined, "test_lines がオブジェクトでない"],
  ])("%s ときは 1 を返す", async (_name, testLines, message) => {
    const root = repo();
    const errors: string[] = [];
    const original = console.error;
    console.error = (text: string) => errors.push(text);
    try {
      const args = ["--out", join(root, "t.md"), "--config", configFile(root, testLines)];
      expect(await main(args, { root, now: NOW })).toBe(1);
    } finally {
      console.error = original;
    }
    expect(errors.join("\n")).toContain(message);
  });

  test.each([
    ["--out が無い", []],
    ["知らない引数", ["--out", "t.md", "--x", "y"]],
    ["値の無い引数", ["--out"]],
  ])("%s ときは子プロセスで起動しても 2 を返し、使い方を出す", (_name, args) => {
    const r = spawnSync(process.execPath, [join(import.meta.dirname, "test-lines.ts"), ...args], {
      encoding: "utf8",
      timeout: CHILD_TIMEOUT_MS,
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("使い方: node scripts/weekly/cost-metrics/test-lines.ts --out");
  });
});
