// カバレッジの閾値のチェック（check-coverage.ts）のテスト。
//
// 状態空間の軸と、各セルに置いた入力:
//
// | 軸             | 値                                                                                 |
// | -------------- | ---------------------------------------------------------------------------------- |
// | 規則の当たり方 | ディレクトリの規則 1 つ / 入れ子のディレクトリの規則（長い方） / 1 ファイルの規則 / 当たらない |
// | 対象のファイル | .ts・.mjs / テスト・型の宣言・.sh・その他（対象にしない）                          |
// | 測定値         | 閾値と等しい / 下回る / 測定の結果に無い / 指標が欠けている                         |
// | 除外           | 除外したファイル / 対象に無いファイルの除外（古い） / 除外と 1 ファイルの規則の両方 |
// | 設定の形       | 正しい / 配列でない / path・reason の欠落 / 範囲外の閾値 / 使えない指標 / 重複 |
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, test } from "vitest";
import { makeTempDir } from "../lib/testing/test-tmpdir.ts";
import {
  CONFIG_PATH,
  type Config,
  type FileMeasure,
  describe,
  evaluate,
  isMeasured,
  loadConfig,
  parseConfig,
  ruleFor,
} from "./check-coverage.ts";

const config = (raw: unknown): Config => parseConfig(raw);

const base = {
  rules: [
    { path: "scripts/", lines: 90, branches: 80, functions: 90 },
    { path: "scripts/lib/", lines: 95, branches: 85, functions: 95 },
  ],
  exclude: [],
};

const full = (lines: number, branches = 100, functions = 100): FileMeasure => ({
  lines,
  branches,
  functions,
});

test("isMeasured: テストと型の宣言とシェルスクリプトを対象にせず、.ts・.mjs を対象にする", () => {
  expect(isMeasured("scripts/a.ts")).toBe(true);
  expect(isMeasured("skills/x/scripts/a.mjs")).toBe(true);
  expect(isMeasured("scripts/a.sh")).toBe(false);
  expect(isMeasured("scripts/a.test.ts")).toBe(false);
  expect(isMeasured("scripts/a.d.ts")).toBe(false);
  expect(isMeasured("scripts/a.json")).toBe(false);
});

test("ruleFor: 入れ子のディレクトリの規則が当たるときは、長い path の規則を使う", () => {
  const c = config(base);
  expect(ruleFor(c.rules, "scripts/lib/x.ts")?.path).toBe("scripts/lib/");
  expect(ruleFor(c.rules, "scripts/gates/x.ts")?.path).toBe("scripts/");
});

test("ruleFor: 1 ファイルの規則はディレクトリの規則より優先する", () => {
  const c = config({
    ...base,
    rules: [...base.rules, { path: "scripts/lib/x.ts", lines: 50, reason: "理由" }],
  });
  expect(ruleFor(c.rules, "scripts/lib/x.ts")?.thresholds).toEqual({ lines: 50 });
});

test("ruleFor: path の前方一致はディレクトリの境界で区切る（scripts/lib/ は scripts/library/ に当たらない）", () => {
  const c = config(base);
  expect(ruleFor(c.rules, "scripts/library/x.ts")?.path).toBe("scripts/");
});

test("evaluate: 閾値と等しい値は合格にし、下回る値は指標ごとに finding にする", () => {
  const c = config(base);
  const files = ["scripts/lib/a.ts", "scripts/lib/b.ts"];
  const measures = new Map([
    ["scripts/lib/a.ts", full(95, 85, 95)],
    ["scripts/lib/b.ts", full(94.99, 84, 95)],
  ]);
  expect(evaluate(c, files, measures)).toEqual([
    {
      type: "below",
      file: "scripts/lib/b.ts",
      metric: "lines",
      actual: 94.99,
      threshold: 95,
      rule: "scripts/lib/",
    },
    {
      type: "below",
      file: "scripts/lib/b.ts",
      metric: "branches",
      actual: 84,
      threshold: 85,
      rule: "scripts/lib/",
    },
  ]);
});

test("evaluate: 当たる規則が無いファイルは合格にせず no-rule にする", () => {
  const c = config(base);
  expect(evaluate(c, ["skills/x/a.mjs"], new Map([["skills/x/a.mjs", full(100)]]))).toEqual([
    { type: "no-rule", file: "skills/x/a.mjs" },
  ]);
});

test("evaluate: 測定の結果に無いファイルと、指標が欠けたファイルは not-measured にする", () => {
  const c = config(base);
  expect(evaluate(c, ["scripts/a.ts"], new Map())).toEqual([
    { type: "not-measured", file: "scripts/a.ts" },
  ]);
  expect(evaluate(c, ["scripts/a.ts"], new Map([["scripts/a.ts", { lines: 100 }]]))).toEqual([
    { type: "not-measured", file: "scripts/a.ts" },
  ]);
});

test("evaluate: 除外したファイルは比べない", () => {
  const c = config({ ...base, exclude: [{ path: "scripts/a.ts", reason: "理由" }] });
  expect(evaluate(c, ["scripts/a.ts"], new Map([["scripts/a.ts", full(0, 0, 0)]]))).toEqual([]);
});

test("evaluate: 対象に無いファイルの除外と 1 ファイルの規則は stale-config にする", () => {
  const c = config({
    rules: [...base.rules, { path: "scripts/gone.ts", lines: 10, reason: "理由" }],
    exclude: [{ path: "scripts/removed.ts", reason: "理由" }],
  });
  expect(evaluate(c, [], new Map())).toEqual([
    { type: "stale-config", path: "scripts/removed.ts", section: "exclude" },
    { type: "stale-config", path: "scripts/gone.ts", section: "rules" },
  ]);
});

test("evaluate: 除外と 1 ファイルの規則の両方に書いたファイルは excluded-and-ruled にする", () => {
  const c = config({
    rules: [...base.rules, { path: "scripts/a.ts", lines: 10, reason: "理由" }],
    exclude: [{ path: "scripts/a.ts", reason: "理由" }],
  });
  expect(evaluate(c, ["scripts/a.ts"], new Map([["scripts/a.ts", full(100)]]))).toEqual([
    { type: "excluded-and-ruled", path: "scripts/a.ts" },
  ]);
});

test("parseConfig: 正しい設定を読み、閾値を指標ごとに持つ", () => {
  expect(config(base).rules[0]).toEqual({
    path: "scripts/",

    thresholds: { lines: 90, branches: 80, functions: 90 },
  });
});

test("loadConfig: リポジトリの設定ファイルを読み、形の誤りは例外にする", () => {
  const root = makeTempDir("check-coverage-load-");
  const path = join(root, CONFIG_PATH);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(base));
  expect(loadConfig(root)).toEqual(config(base));
  writeFileSync(path, JSON.stringify({ rules: [] }));
  expect(() => loadConfig(root)).toThrow(/rules と exclude/);
});

test.each([
  ["rules が配列でない", { rules: {}, exclude: [] }, /rules と exclude/],
  ["exclude が無い", { rules: [] }, /rules と exclude/],
  ["path が無い", { rules: [{ lines: 1 }], exclude: [] }, /path が無い/],
  [
    "廃止した kind のキー",
    { rules: [{ path: "a/", kind: "js", lines: 1 }], exclude: [] },
    /使えないキー kind/,
  ],
  ["知らないキー", { rules: [{ path: "a/", line: 1 }], exclude: [] }, /使えないキー line/],
  ["閾値が 100 を超える", { rules: [{ path: "a/", lines: 101 }], exclude: [] }, /0 から 100/],
  ["閾値が文字列", { rules: [{ path: "a/", lines: "90" }], exclude: [] }, /0 から 100/],
  ["閾値が無い", { rules: [{ path: "a/" }], exclude: [] }, /閾値が 1 つも無い/],
  [
    "1 ファイルの規則に reason が無い",
    { rules: [{ path: "a.ts", lines: 1 }], exclude: [] },
    /reason が要る/,
  ],
  [
    "1 ファイルの規則が測る対象のファイルでない",
    { rules: [{ path: "a.sh", lines: 1, reason: "r" }], exclude: [] },
    /測る対象のファイルでない/,
  ],
  [
    "規則が重複",
    {
      rules: [
        { path: "a/", lines: 1 },
        { path: "a/", lines: 2 },
      ],
      exclude: [],
    },
    /同じ path の規則/,
  ],
  ["除外に reason が無い", { rules: [], exclude: [{ path: "a.ts" }] }, /reason が無い/],
  [
    "除外の reason が空白",
    { rules: [], exclude: [{ path: "a.ts", reason: " " }] },
    /reason が無い/,
  ],
  [
    "除外がディレクトリ",
    { rules: [], exclude: [{ path: "a/", reason: "r" }] },
    /ファイルごとに書く/,
  ],
  [
    "除外が重複",
    {
      rules: [],
      exclude: [
        { path: "a.ts", reason: "r" },
        { path: "a.ts", reason: "r" },
      ],
    },
    /同じファイルの除外/,
  ],
])("parseConfig: %s は判定できないとして例外にする", (_name, raw, message) => {
  expect(() => parseConfig(raw)).toThrow(message);
});

test("describe: finding ごとに、ファイルと直し方が分かる文にする", () => {
  expect(
    describe({
      type: "below",
      file: "a.ts",
      metric: "lines",
      actual: 1,
      threshold: 2,
      rule: "scripts/",
    }),
  ).toBe("a.ts: lines 1% が閾値 2%（規則 scripts/）を下回る");
  expect(describe({ type: "no-rule", file: "a.ts" })).toContain("rules に");
  expect(describe({ type: "not-measured", file: "a.ts" })).toContain("測定の結果に無い");
  expect(describe({ type: "stale-config", path: "a.ts", section: "exclude" })).toContain(
    "exclude: a.ts は対象のファイルに無い",
  );
  expect(describe({ type: "excluded-and-ruled", path: "a.ts" })).toContain(
    "exclude と rules の両方",
  );
});
