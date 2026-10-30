import { describe, expect, test } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  main,
  parseTimings,
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
    // 1 つの「=== 」の行に、2 つの「時間:」の行を対応づけない
    expect(() => parseTimings([gh("shard 1", `=== ${A} → t`), orphan, orphan].join("\n"))).toThrow(
      /3 行目/,
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

  test.each([
    ["引数が無い", () => []],
    ["ログを読めない", ({ root }: { root: string }) => [join(root, "missing.log")]],
    ["「時間:」の行が無い", ({ log }: { log: (t: string) => string }) => [log("何も無い\n")]],
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
