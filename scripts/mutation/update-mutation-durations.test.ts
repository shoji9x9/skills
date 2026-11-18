import { describe, expect, test } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  checkShards,
  main,
  parseDrifts,
  parseTimings,
  summaryMarkdown,
  updateDurations,
  type Durations,
} from "./update-mutation-durations.ts";
import { parseJsonAs } from "../lib/parse-as.ts";
import { makeTempDir } from "../lib/testing/test-tmpdir.ts";

const A = "scripts/a.mutations.json";
const B = "scripts/b.mutations.json";

/** `gh run view --log` の 1 行（ジョブの名前・ステップ・時刻の後に、ランナーの出力が続く）。 */
const gh = (job: string, text: string) =>
  `${job}\tUNKNOWN STEP\t2026-10-26T02:29:02.0618701Z ${text}`;

describe("ランナーのログの読み取り", () => {
  test("ジョブごとに「=== 」の行と「時間:」の行を対応づけ、分けた宣言は回数で合計する", () => {
    // A は 2 つのジョブに分かれ（2 変異 + 基準 run と 1 変異 + 基準 run）、ジョブの行が交互に並んでも取り違えない
    const log = [
      gh("shard 1", `=== ${A} → scripts/a.test.ts`),
      gh("shard 2", `=== ${A} → scripts/a.test.ts`),
      gh("shard 1", "時間: 30.0 秒（2 変異、基準 run を含む）"),
      gh("shard 1", `=== ${B} → scripts/b.test.ts`),
      gh("shard 2", "時間: 20.0 秒（1 変異、基準 run を含む）"),
      gh("shard 1", "時間: 1.5 秒（2 変異、基準 run を含む）"),
    ].join("\n");
    expect(parseTimings(log)).toEqual(
      new Map([
        [A, { seconds: 50, runs: 5 }],
        [B, { seconds: 1.5, runs: 3 }],
      ]),
    );
  });

  test("手元のランナーの出力（ジョブの名前が無い）も読む", () => {
    const log = [`=== ${A} → scripts/a.test.ts`, "時間: 4.0 秒（3 変異、基準 run を含む）"].join(
      "\n",
    );
    expect(parseTimings(log)).toEqual(new Map([[A, { seconds: 4, runs: 4 }]]));
  });

  test("同じジョブの「=== 」の行と対応しない「時間:」の行は、どの宣言の時間か分からないので例外にする", () => {
    const orphan = gh("shard 1", "時間: 4.0 秒（3 変異、基準 run を含む）");
    expect(() => parseTimings(orphan)).toThrow(/1 行目/);
    // 別のジョブの「=== 」の行には対応づけない
    expect(() => parseTimings([gh("shard 2", `=== ${A} → t`), orphan].join("\n"))).toThrow(
      /2 行目/,
    );
    // 途中で止まった run: 「時間:」の行が無いまま、次の「=== 」の行が来るか、ログが終わる
    expect(() =>
      parseTimings([gh("shard 1", `=== ${A} → t`), gh("shard 1", `=== ${B} → t`)].join("\n")),
    ).toThrow(new RegExp(`2 行目の前に、${A}`));
    expect(() =>
      parseTimings(
        [gh("shard 1", `=== ${A} → t`), orphan, gh("shard 2", `=== ${B} → t`)].join("\n"),
      ),
    ).toThrow(new RegExp(`shard 2: ${B}`));
    // 1 つの「=== 」の行に、2 つの「時間:」の行を対応づけない
    expect(() => parseTimings([gh("shard 1", `=== ${A} → t`), orphan, orphan].join("\n"))).toThrow(
      /3 行目/,
    );
  });
});

describe("「見積もりとのずれ」の行の読み取り", () => {
  test("ジョブの名前の有無に関わらず読み、分けた宣言は一部ごとに 1 件にし、ほかの行は読まない", () => {
    const log = [
      gh("shard 1", `見積もりとのずれ: ${A} 1 回 22.9 秒（見積もり 9.1 秒）。更新する`),
      gh("shard 2", `見積もりとのずれ: ${A} 1 回 41 秒（見積もり 9.1 秒）。更新する`),
      `見積もりとのずれ: ${B} 1 回 0.5 秒（見積もり 3 秒）。更新する`,
      gh("shard 1", "見積もりからずれた宣言: 2 件（「見積もりとのずれ」の行）"),
      // 宣言のパスを持たない行（宣言のパスを入れる前のランナーの形）は、どの宣言か分からないので読まない
      "見積もりとのずれ: 1 回 22.9 秒（見積もり 9.1 秒）。更新する",
    ].join("\n");
    expect(parseDrifts(log)).toEqual([
      { spec: A, perRun: 22.9, estimate: 9.1 },
      { spec: A, perRun: 41, estimate: 9.1 },
      { spec: B, perRun: 0.5, estimate: 3 },
    ]);
  });
});

describe("シャードのログがそろっているかの確認", () => {
  const shard = (i: number, n: number) =>
    gh(`shard ${i}`, `シャード ${i}/${n}: 選んだ変異 10 件のうち 3 件を測る`);

  test.each([
    ["シャードの行が無い（--shard を付けない手元の実行）", `=== ${A} → t`],
    ["1〜N がそろう", [shard(2, 3), shard(1, 3), shard(3, 3)].join("\n")],
    ["同じシャードが重なっても、1〜N がそろう", [shard(1, 2), shard(2, 2), shard(2, 2)].join("\n")],
  ])("%s ときは通す", (_case, log) => {
    expect(() => checkShards(log)).not.toThrow();
  });

  test.each([
    ["真ん中のシャードが無い", [shard(1, 3), shard(3, 3)].join("\n"), "シャード 2/3 のログが無い"],
    [
      "最後のシャードが無い",
      [shard(1, 4), shard(2, 4), shard(3, 4)].join("\n"),
      "シャード 4/4 のログが無い",
    ],
    ["複数が無い", shard(2, 4), "シャード 1/4, 3/4, 4/4 のログが無い"],
    [
      "シャードの数が違う run のログが混在する",
      [shard(1, 2), shard(2, 3)].join("\n"),
      "シャードの数が違う",
    ],
  ])("%s ときは例外にする", (_case, log, message) => {
    expect(() => checkShards(log)).toThrow(message);
  });
});

describe("ジョブの結果に出す Markdown", () => {
  test("ずれた宣言があれば、表と、見積もりを置き換える手順を出す", () => {
    const md = summaryMarkdown(
      [{ spec: A, perRun: 22.9, estimate: 9.1 }],
      [{ spec: A, before: 9.1, after: 22.9 }],
    );
    expect(md).toContain("見積もりから大きくずれた宣言: 1 件。");
    expect(md).toContain(`| \`${A}\` | 22.9 秒 | 9.1 秒 |`);
    expect(md).toContain("artifact の `mutation-durations.json`");
    expect(md).toContain(`| \`${A}\` | 9.1 秒 | 22.9 秒 |`);
  });

  test("分けた宣言の一部ごとのずれの行は、件数では 1 件に数え、表には行ごとに出す", () => {
    const md = summaryMarkdown(
      [
        { spec: A, perRun: 22.9, estimate: 9.1 },
        { spec: A, perRun: 41, estimate: 9.1 },
      ],
      [],
    );
    expect(md).toContain("見積もりから大きくずれた宣言: 1 件。");
    expect(md).toContain(`| \`${A}\` | 41 秒 | 9.1 秒 |`);
  });

  test("ずれた宣言も変わった宣言も無ければ、0 件であることを出し、表は出さない", () => {
    const md = summaryMarkdown([], []);
    expect(md).toContain("見積もりから大きくずれた宣言は無い");
    expect(md).toContain("実測で値が変わった宣言: 0 件。");
    expect(md).not.toContain("| --- |");
  });

  test("前に見積もりの無かった宣言は、前の値を「（無し）」と出す", () => {
    expect(summaryMarkdown([], [{ spec: B, before: undefined, after: 2 }])).toContain(
      `| \`${B}\` | （無し） | 2 秒 |`,
    );
  });
});

describe("見積もりの更新", () => {
  const durations: Durations = { default_seconds: 1, seconds_per_run: { [A]: 10, [B]: 2 } };

  test("ログにある宣言だけを 0.1 秒の単位で更新し、値が変わったものだけを返す", () => {
    const measured = new Map([
      [A, { seconds: 100, runs: 4 }], // 25 秒
      [B, { seconds: 6.1, runs: 3 }], // 2.03 秒 → 2 秒: 変わらない
    ]);
    const { next, changes, missing } = updateDurations(durations, measured, () => true);
    expect(next).toEqual({ default_seconds: 1, seconds_per_run: { [A]: 25, [B]: 2 } });
    expect(changes).toEqual([{ spec: A, before: 10, after: 25 }]);
    expect(missing).toEqual([]);
  });

  test("新しい宣言は末尾に足し、実在しない宣言は入れずに返す。0 秒にしない", () => {
    const C = "scripts/c.mutations.json";
    const gone = "scripts/gone.mutations.json";
    const measured = new Map([
      [gone, { seconds: 9, runs: 1 }],
      [C, { seconds: 0.01, runs: 2 }],
    ]);
    const { next, changes, missing } = updateDurations(durations, measured, (s) => s !== gone);
    expect(Object.entries(next.seconds_per_run)).toEqual([
      [A, 10],
      [B, 2],
      [C, 0.1],
    ]);
    expect(changes).toEqual([{ spec: C, before: undefined, after: 0.1 }]);
    expect(missing).toEqual([gone]);
  });
});

describe("main", () => {
  function repo() {
    const root = makeTempDir("update-durations-");
    mkdirSync(join(root, "scripts", "mutation"), { recursive: true });
    const file = join(root, "scripts", "mutation", "mutation-durations.json");
    writeFileSync(file, JSON.stringify({ default_seconds: 1, seconds_per_run: { [A]: 10 } }));
    writeFileSync(join(root, A), "{}");
    const log = (text: string) => {
      const path = join(root, `run-${text.length}.log`);
      writeFileSync(path, text);
      return path;
    };
    return { root, file, log };
  }

  test("ログの実測で見積もりのファイルを書き換える", () => {
    const { root, file, log } = repo();
    const path = log([`=== ${A} → t`, "時間: 12.0 秒（1 変異、基準 run を含む）"].join("\n"));
    expect(main([path], root)).toBe(0);
    expect(parseJsonAs<Durations>(readFileSync(file, "utf8")).seconds_per_run).toEqual({ [A]: 6 });
  });

  test("複数の run のログを渡すと、実行の回数で重みを付けた平均で書き換える", () => {
    const { root, file, log } = repo();
    // 1 つ目: 2 回で 12 秒。2 つ目: 4 回で 36 秒。合計 48 秒 ÷ 6 回 = 8 秒（1 回あたりの単純な平均の 7.5 秒にはしない）
    const first = log([`=== ${A} → t`, "時間: 12.0 秒（1 変異、基準 run を含む）"].join("\n"));
    const second = log(`=== ${A} → t\n時間: 36.0 秒（3 変異、基準 run を含む）\n`);
    expect(main([first, second], root)).toBe(0);
    expect(parseJsonAs<Durations>(readFileSync(file, "utf8")).seconds_per_run).toEqual({ [A]: 8 });
  });

  test("--summary を渡すと、ずれた宣言と変わった宣言をそのファイルに追記する", () => {
    const { root, log } = repo();
    const summary = join(root, "summary.md");
    writeFileSync(summary, "前のステップの結果\n");
    const path = log(
      [
        `=== ${A} → t`,
        "時間: 60.0 秒（1 変異、基準 run を含む）",
        `見積もりとのずれ: ${A} 1 回 30.0 秒（見積もり 10 秒）。更新する`,
      ].join("\n"),
    );
    expect(main(["--summary", summary, path], root)).toBe(0);
    const text = readFileSync(summary, "utf8");
    expect(text.startsWith("前のステップの結果\n")).toBe(true);
    expect(text).toContain(`| \`${A}\` | 30 秒 | 10 秒 |`);
    expect(text).toContain(`| \`${A}\` | 10 秒 | 30 秒 |`);
  });

  test.each([
    ["--summary の値が無い", ["--summary"]],
    ["--summary の後がオプション", ["--summary", "--x", "LOG"]],
    ["--summary が 2 回", ["--summary", "a.md", "--summary", "b.md", "LOG"]],
    ["ログを渡さない", ["--summary", "a.md"]],
    ["知らないオプション", ["--dry-run", "LOG"]],
  ])("%s ときは書き換えずに 2 を返し、--summary のファイルを作らない", (_case, args) => {
    const r = repo();
    const before = readFileSync(r.file, "utf8");
    const path = r.log([`=== ${A} → t`, "時間: 12.0 秒（1 変異、基準 run を含む）"].join("\n"));
    const resolved = args.map((a) =>
      a === "LOG" ? path : a.endsWith(".md") ? join(r.root, a) : a,
    );
    expect(main(resolved, r.root)).toBe(2);
    expect(readFileSync(r.file, "utf8")).toBe(before);
    expect(existsSync(join(r.root, "a.md"))).toBe(false);
  });

  test("シャードのログが欠けているときは書き換えずに 2 を返し、--summary のファイルを作らない", () => {
    const { root, file, log } = repo();
    const before = readFileSync(file, "utf8");
    const summary = join(root, "summary.md");
    const path = log(
      [
        "シャード 1/2: 選んだ変異 2 件のうち 1 件を測る",
        `=== ${A} → t`,
        "時間: 12.0 秒（1 変異、基準 run を含む）",
      ].join("\n"),
    );
    expect(main(["--summary", summary, path], root)).toBe(2);
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(existsSync(summary)).toBe(false);
  });

  test.each([
    ["JSON オブジェクトでない", "[]"],
    ["default_seconds が無い", JSON.stringify({ seconds_per_run: {} })],
    ["default_seconds が 0", JSON.stringify({ default_seconds: 0, seconds_per_run: {} })],
    ["seconds_per_run が配列", JSON.stringify({ default_seconds: 1, seconds_per_run: [] })],
    [
      "seconds_per_run の値が文字列",
      JSON.stringify({ default_seconds: 1, seconds_per_run: { [A]: "10" } }),
    ],
  ])("見積もりのファイルの%sときは書き換えずに 2 を返す", (_case, content) => {
    const { root, file, log } = repo();
    writeFileSync(file, content);
    const path = log([`=== ${A} → t`, "時間: 12.0 秒（1 変異、基準 run を含む）"].join("\n"));
    expect(main([path], root)).toBe(2);
    expect(readFileSync(file, "utf8")).toBe(content);
  });

  test.each([
    ["引数が無い", () => []],
    ["ログを読めない", ({ root }: { root: string }) => [join(root, "missing.log")]],
    ["「時間:」の行が無い", ({ log }: { log: (t: string) => string }) => [log("何も無い\n")]],
    [
      "「時間:」の行が無い宣言がある（途中で止まった run）",
      ({ log }: { log: (t: string) => string }) => [
        log(
          [`=== ${A} → t`, "時間: 12.0 秒（1 変異、基準 run を含む）", `=== ${A} → t`].join("\n"),
        ),
      ],
    ],
    [
      "対応しない「時間:」の行がある",
      ({ log }: { log: (t: string) => string }) => [log("時間: 1.0 秒（1 変異、基準 run を含む）")],
    ],
  ])("%s ときは書き換えずに 2 を返す", (_case, args) => {
    const r = repo();
    const before = readFileSync(r.file, "utf8");
    expect(main(args(r), r.root)).toBe(2);
    expect(readFileSync(r.file, "utf8")).toBe(before);
  });
});
