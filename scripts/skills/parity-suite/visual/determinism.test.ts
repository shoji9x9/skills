// 撮影の前に時刻と乱数を固定する処理（parity-suite 同梱の determinism.mjs）のテスト（Issue #1106）。
// 期待値は parity-suite の references/baseline.md「時刻と乱数を固定する」の記録の形と、食い違えば撮らずに止まる取り決めから決める。

import { afterEach, describe, expect, test } from "vitest";
import { createContext, runInContext } from "node:vm";
import {
  applyDeterminism,
  readDeterminism,
  verifyDeterminism,
} from "../../../../skills/parity-suite/scripts/determinism.mjs";
import {
  installSeededRandom,
  readPageDeterminism,
} from "../../../../skills/parity-suite/scripts/page/determinism.page.mjs";
import { runFromSource } from "./page-source.ts";

const FIXED = "2026-01-02T03:04:05Z";
const FIXED_MS = Date.parse(FIXED);

describe("readDeterminism", () => {
  test("固定した時刻と seed を読む", () => {
    expect(readDeterminism({ determinism: { fixed_time: FIXED, random_seed: 42 } })).toEqual({
      fixedTimeMs: FIXED_MS,
      randomSeed: 42,
    });
  });

  test("固定しない時刻は理由があれば null で読み、seed の null も読む", () => {
    expect(
      readDeterminism({
        determinism: {
          fixed_time: null,
          fixed_time_reason: "時刻を表示しない画面",
          random_seed: null,
        },
      }),
    ).toEqual({ fixedTimeMs: null, randomSeed: null });
  });

  test("seed の境界（0 と 4294967295）を受け付ける", () => {
    expect(readDeterminism({ determinism: { fixed_time: FIXED, random_seed: 0 } }).randomSeed).toBe(
      0,
    );
    expect(
      readDeterminism({ determinism: { fixed_time: FIXED, random_seed: 4294967295 } }).randomSeed,
    ).toBe(4294967295);
  });

  test("0〜99 年の時刻も、1900 年を足さずにそのまま読む", () => {
    expect(
      readDeterminism({ determinism: { fixed_time: "0099-01-02T03:04:05Z", random_seed: null } })
        .fixedTimeMs,
    ).toBe(Date.parse("0099-01-02T03:04:05Z"));
  });

  test("タイムゾーンのオフセットとミリ秒を付けた時刻を読む", () => {
    const value = "2026-01-02T12:04:05.250+09:00";
    expect(
      readDeterminism({ determinism: { fixed_time: value, random_seed: null } }).fixedTimeMs,
    ).toBe(Date.parse("2026-01-02T03:04:05.250Z"));
  });

  test.each([
    ["capture_conditions が無い", null, /capture_conditions is missing/],
    ["determinism のキーが無い（既存の metadata.json）", {}, /determinism is missing/],
    ["determinism が null", { determinism: null }, /must be an object/],
    ["determinism が配列", { determinism: [] }, /must be an object/],
    ["fixed_time のキーが無い", { determinism: { random_seed: null } }, /fixed_time is missing/],
    ["random_seed のキーが無い", { determinism: { fixed_time: FIXED } }, /random_seed is missing/],
    [
      "固定しないのに理由が無い",
      { determinism: { fixed_time: null, random_seed: null } },
      /fixed_time_reason/,
    ],
    [
      "固定しない理由が空白だけ",
      { determinism: { fixed_time: null, fixed_time_reason: "  ", random_seed: null } },
      /fixed_time_reason/,
    ],
    [
      "固定しない理由がテンプレートのまま",
      {
        determinism: {
          fixed_time: null,
          fixed_time_reason: "<fixed_time が null のときだけ、固定しない理由>",
          random_seed: null,
        },
      },
      /fixed_time_reason/,
    ],
    [
      "固定しない理由が TODO",
      { determinism: { fixed_time: null, fixed_time_reason: "TODO 後で", random_seed: null } },
      /fixed_time_reason/,
    ],
    [
      "固定しない理由が 未確認",
      { determinism: { fixed_time: null, fixed_time_reason: "未確認", random_seed: null } },
      /fixed_time_reason/,
    ],
    [
      "時刻にタイムゾーンが無い",
      { determinism: { fixed_time: "2026-01-02T03:04:05", random_seed: null } },
      /ISO 8601 with a timezone/,
    ],
    [
      "時刻が日付だけ",
      { determinism: { fixed_time: "2026-01-02", random_seed: null } },
      /ISO 8601 with a timezone/,
    ],
    [
      "時刻が数値",
      { determinism: { fixed_time: FIXED_MS, random_seed: null } },
      /ISO 8601 with a timezone/,
    ],
    ...[
      "2026-02-31T03:04:05Z",
      "2026-04-31T00:00:00Z",
      "2026-01-02T24:00:00Z",
      "2026-01-02T03:04:05+24:00",
    ].map((value): [string, unknown, RegExp] => [
      `暦に無い日時（${value}）`,
      { determinism: { fixed_time: value, random_seed: null } },
      /not a valid date/,
    ]),
    [
      "時刻が存在しない日付",
      { determinism: { fixed_time: "2026-13-40T03:04:05Z", random_seed: null } },
      /not a valid date/,
    ],
    ["seed が負", { determinism: { fixed_time: FIXED, random_seed: -1 } }, /random_seed must be/],
    [
      "seed が小数",
      { determinism: { fixed_time: FIXED, random_seed: 1.5 } },
      /random_seed must be/,
    ],
    [
      "seed が 32 ビットを超える",
      { determinism: { fixed_time: FIXED, random_seed: 4294967296 } },
      /random_seed must be/,
    ],
    [
      "seed が文字列",
      { determinism: { fixed_time: FIXED, random_seed: "42" } },
      /random_seed must be/,
    ],
  ])("%s なら例外で止まる", (_label, conditions, message) => {
    expect(() => readDeterminism(conditions)).toThrow(message);
  });
});

/** 素の Math と、数を返すだけの crypto を持つ別の大域で、ページへ渡す関数を実行する。 */
function seededSandbox(seed: number) {
  const calls: number[] = [];
  const crypto = {
    getRandomValues(array: Uint8Array) {
      calls.push(array.byteLength);
      if (array.byteLength > 65536) throw new Error("QuotaExceededError");
      return array;
    },
    randomUUID: () => "00000000-0000-4000-8000-000000000000",
  };
  const context = createContext({ crypto });
  runInContext(`(${installSeededRandom.toString()})(${seed});`, context);
  const run = (code: string): unknown => runInContext(code, context);
  return { run, calls };
}

describe("installSeededRandom", () => {
  test("同じ seed なら Math.random・getRandomValues・randomUUID が同じ列を返す", () => {
    const code =
      "[Math.random(), Math.random(), Array.from(crypto.getRandomValues(new Uint8Array(6))), crypto.randomUUID()]";
    const first = seededSandbox(7).run(code);
    const second = seededSandbox(7).run(code);
    expect(first).toEqual(second);
  });

  test("違う seed なら違う列を返す", () => {
    const code = "[Math.random(), crypto.randomUUID()]";
    expect(seededSandbox(1).run(code)).not.toEqual(seededSandbox(2).run(code));
  });

  test("Math.random は 0 以上 1 未満を返す", () => {
    // 範囲に入るかと、異なる値の数をページの側で数える
    const [inRange, distinct] = [
      "Array.from({ length: 1000 }, () => Math.random()).every((v) => v >= 0 && v < 1)",
      "new Set(Array.from({ length: 1000 }, () => Math.random())).size",
    ].map((code) => seededSandbox(3).run(code));
    expect(inRange).toBe(true);
    expect(distinct).toBeGreaterThan(990);
  });

  test("randomUUID は version 4 の形を返す", () => {
    const uuid = seededSandbox(5).run("crypto.randomUUID()");
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(uuid).not.toBe("00000000-0000-4000-8000-000000000000");
  });

  test("getRandomValues は元の関数で引数を確かめ、元と同じ例外を出す", () => {
    const sandbox = seededSandbox(9);
    expect(() => sandbox.run("crypto.getRandomValues(new Uint8Array(65537))")).toThrow(
      "QuotaExceededError",
    );
    // 長さが 4 の倍数でない配列も、最後の要素まで seed の列で埋める
    expect(sandbox.run("Array.from(crypto.getRandomValues(new Uint8Array(7)))")).toHaveLength(7);
    expect(sandbox.calls).toEqual([65537, 7]);
  });

  test("差し替えた印に seed を残す", () => {
    expect(seededSandbox(11).run("globalThis.__parityRandomSeed")).toBe(11);
  });

  test("差し替えた関数を残し、今の Math.random と crypto の関数と同じものを指す", () => {
    const sandbox = seededSandbox(13);
    expect(
      sandbox.run(
        "const a = globalThis.__parityRandomApis; [a.random === Math.random, a.getRandomValues === crypto.getRandomValues, a.randomUUID === crypto.randomUUID]",
      ),
    ).toEqual([true, true, true]);
  });
});

describe("applyDeterminism", () => {
  function fakePage() {
    const calls: string[] = [];
    return {
      calls,
      clock: {
        setFixedTime: async (time: Date) => {
          calls.push(`setFixedTime:${time.getTime()}`);
        },
      },
      addInitScript: async (script: (arg: number) => void, arg: number) => {
        calls.push(`addInitScript:${script === installSeededRandom}:${arg}`);
      },
    };
  }

  test("固定した時刻と seed を当てる", async () => {
    const page = fakePage();
    await applyDeterminism(page, { fixedTimeMs: FIXED_MS, randomSeed: 42 });
    expect(page.calls).toEqual([`setFixedTime:${FIXED_MS}`, "addInitScript:true:42"]);
  });

  test("固定しない条件では何も当てない", async () => {
    const page = fakePage();
    await applyDeterminism(page, { fixedTimeMs: null, randomSeed: null });
    expect(page.calls).toEqual([]);
  });

  test("seed 0 も当てる", async () => {
    const page = fakePage();
    await applyDeterminism(page, { fixedTimeMs: null, randomSeed: 0 });
    expect(page.calls).toEqual(["addInitScript:true:0"]);
  });
});

describe("verifyDeterminism", () => {
  /** ページで読んだ値を返すだけの偽物。 */
  const pageReading = (seen: { now: number; later: number; seed: unknown; intact?: boolean }) => ({
    // 差し替えた乱数の関数のままか（intact）は、書かなければ「そのまま」とする
    evaluate: async () => ({ intact: true, ...seen }),
  });
  const fixedSeeded = { fixedTimeMs: FIXED_MS, randomSeed: 42 };
  const unfixed = { fixedTimeMs: null, randomSeed: null };

  test("時刻と seed が記録と同じなら通す", async () => {
    await expect(
      verifyDeterminism(pageReading({ now: FIXED_MS, later: FIXED_MS, seed: 42 }), fixedSeeded),
    ).resolves.toBeUndefined();
  });

  test("固定しない条件で、時刻が進み印が無ければ通す", async () => {
    await expect(
      verifyDeterminism(pageReading({ now: 1000, later: 1021, seed: null }), unfixed),
    ).resolves.toBeUndefined();
  });

  test.each([
    {
      label: "時刻が固定されていない",
      seen: { now: FIXED_MS + 5, later: FIXED_MS + 30, seed: 42 },
      determinism: fixedSeeded,
      message: /page clock reads/,
    },
    {
      label: "時刻は合うが進む",
      seen: { now: FIXED_MS, later: FIXED_MS + 20, seed: 42 },
      determinism: fixedSeeded,
      message: /page clock reads/,
    },
    {
      label: "別の時刻に固定されている",
      seen: { now: FIXED_MS - 1000, later: FIXED_MS - 1000, seed: 42 },
      determinism: fixedSeeded,
      message: /page clock reads/,
    },
    {
      label: "seed が当たっていない",
      seen: { now: FIXED_MS, later: FIXED_MS, seed: null },
      determinism: fixedSeeded,
      message: /random seed/,
    },
    {
      label: "別の seed が当たっている",
      seen: { now: FIXED_MS, later: FIXED_MS, seed: 41 },
      determinism: fixedSeeded,
      message: /random seed/,
    },
    {
      label: "固定しない記録なのに時刻が固定されている",
      seen: { now: 1000, later: 1000, seed: null },
      determinism: unfixed,
      message: /page clock is fixed/,
    },
    {
      label: "seed 付きにしない記録なのに seed が当たっている",
      seen: { now: 1000, later: 1020, seed: 42 },
      determinism: unfixed,
      message: /random seed/,
    },
    {
      label: "seed は合うが、ページが Math.random を置き換えた",
      seen: { now: FIXED_MS, later: FIXED_MS, seed: 42, intact: false },
      determinism: fixedSeeded,
      message: /replaced Math.random or crypto/,
    },
  ])("$label なら例外で止まる", async ({ seen, determinism, message }) => {
    await expect(verifyDeterminism(pageReading(seen), determinism)).rejects.toThrow(message);
  });
});

describe("readPageDeterminism", () => {
  const MARKERS = ["__parityRandomSeed", "__parityRandomApis"];
  afterEach(() => {
    for (const name of MARKERS) Reflect.deleteProperty(globalThis, name);
  });

  /** ページへ渡すのと同じく、ソースだけを評価し直して呼ぶ（本体の外の名前を参照すると失敗する）。 */
  const readFromSource = async () => {
    const result: unknown = await runFromSource(readPageDeterminism, []);
    return result;
  };

  test("差し替えていないページでは、seed の印が無く、差し替えた関数のままでもない", async () => {
    const seen = await readFromSource();
    expect(seen).toMatchObject({ seed: null, intact: false });
  });

  test("印と、今の Math.random と crypto の関数を指す記録があれば、seed を返し intact にする", async () => {
    Object.assign(globalThis, {
      __parityRandomSeed: 5,
      __parityRandomApis: {
        random: Math.random,
        getRandomValues: Reflect.get(crypto, "getRandomValues"),
        randomUUID: Reflect.get(crypto, "randomUUID"),
      },
    });
    expect(await readPageDeterminism()).toMatchObject({ seed: 5, intact: true });
  });

  test("記録した関数と今の Math.random が違えば intact にしない", async () => {
    Object.assign(globalThis, {
      __parityRandomSeed: 5,
      __parityRandomApis: {
        random: () => 0.5,
        getRandomValues: Reflect.get(crypto, "getRandomValues"),
        randomUUID: Reflect.get(crypto, "randomUUID"),
      },
    });
    expect(await readPageDeterminism()).toMatchObject({ seed: 5, intact: false });
  });

  test("待つ間に乱数の関数が変わっても見つける（待った後に比べる）", async () => {
    const apis = {
      random: Math.random,
      getRandomValues: Reflect.get(crypto, "getRandomValues"),
      randomUUID: Reflect.get(crypto, "randomUUID"),
    };
    Object.assign(globalThis, { __parityRandomSeed: 5, __parityRandomApis: apis });
    // 大域の Math.random を置き換える代わりに、記録の側を待つ間に変える（比べた結果は同じになる）
    setTimeout(() => {
      apis.random = () => 0;
    }, 5);
    expect(await readPageDeterminism()).toMatchObject({ seed: 5, intact: false });
  });

  test("20ms 待つ前と後の時刻を返す（固定していない時計では進む）", async () => {
    const seen = await readPageDeterminism();
    expect(seen.later).toBeGreaterThan(seen.now);
  });

  test("verifyDeterminism は readPageDeterminism を page.evaluate へ渡す", async () => {
    const passed: unknown[] = [];
    await verifyDeterminism(
      {
        evaluate: async (fn: unknown) => {
          passed.push(fn);
          return { now: 1000, later: 1020, seed: null, intact: false };
        },
      },
      { fixedTimeMs: null, randomSeed: null },
    );
    expect(passed).toEqual([readPageDeterminism]);
  });
});
