// テストが起動する子プロセスにタイムアウトが付いていることの検査（Issue #663）。
//
// 規約（docs/testing.md「実行環境を固定する」）を書いただけでは、付け忘れが再発する。
// test-tmpdir.test.ts と同じ形で、テストと、テストから使う補助のファイルを走査して落とす。
import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CHILD_TIMEOUT_MS,
  HOOK_TIMEOUT_MS,
  TEST_TIMEOUT_MS,
  findUntimedChildCalls,
} from "./child-timeout.ts";

// 走査の起点は `scripts/` 全体（このファイルは `scripts/lib/testing/` にあるので 2 段上がる）。
const scriptsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const IMPORT = 'import { execFileSync, spawn, spawnSync, execSync } from "node:child_process";\n';

describe("findUntimedChildCalls", () => {
  test.each([
    ["オプションが無い", `${IMPORT}spawnSync("node", ["a.js"]);`, ["2: spawnSync"]],
    [
      "オプションに timeout が無い",
      `${IMPORT}execFileSync("git", ["status"], { encoding: "utf8" });`,
      ["2: execFileSync"],
    ],
    ["オプションを変数だけで渡す", `${IMPORT}spawnSync("node", args, options);`, ["2: spawnSync"]],
    [
      "スプレッドだけのオプション",
      `${IMPORT}spawnSync("node", args, { ...options });`,
      ["2: spawnSync"],
    ],
    ["非同期の spawn", `${IMPORT}spawn("node", ["a.js"], { stdio: "pipe" });`, ["2: spawn"]],
    ["execSync", `${IMPORT}execSync("ls");`, ["2: execSync"]],
    [
      "別名で import した関数",
      'import { spawnSync as run } from "node:child_process";\nrun("node", []);',
      ["2: spawnSync"],
    ],
    [
      "名前空間で import した関数",
      'import * as cp from "node:child_process";\ncp.execFileSync("git", []);',
      ["2: execFileSync"],
    ],
    [
      "node: の付かない import",
      'import { spawnSync } from "child_process";\nspawnSync("node", []);',
      ["2: spawnSync"],
    ],
    ["理由の無い免除", `${IMPORT}spawnSync("node", []); // child-timeout-ok:`, ["2: spawnSync"]],
    [
      "入れ子の関数の中の呼び出し",
      `${IMPORT}function run() {\n  return () => spawnSync("node", []);\n}`,
      ["3: spawnSync"],
    ],
    [
      "前の行の呼び出しの末尾の免除は次の呼び出しに及ばない",
      `${IMPORT}spawnSync("a", []); // child-timeout-ok: 止まることを確かめる\nspawnSync("b", []);`,
      ["3: spawnSync"],
    ],
    [
      "文字列の中の免除の印",
      `${IMPORT}spawnSync("node", ["// child-timeout-ok: 文字列"]);`,
      ["2: spawnSync"],
    ],
    [
      "動的 import",
      'const { spawn } = await import("node:child_process");\nspawn("x", [], { timeout: 1 });',
      ["1: import"],
    ],
    ["require", 'const cp = require("child_process");', ["1: import"]],
    [
      "spawnAsync",
      'import { spawnAsync } from "../../lib/spawn-async.ts";\nawait spawnAsync("node", []);',
      ["2: spawnAsync"],
    ],
    [
      "別名で import した spawnAsync",
      'import { spawnAsync as run } from "./spawn-async.ts";\nawait run("node", [], { cwd: "." });',
      ["2: spawnAsync"],
    ],
    [
      "testTimeout と同じ timeout",
      `${IMPORT}spawnSync("node", [], { timeout: 30_000 });`,
      ["2: spawnSync（timeout 30000 がテストの timeout 30000 以上）"],
    ],
    [
      "テストの後ろの引数の timeout 以上",
      `${IMPORT}test("t", () => {\n  spawnSync("node", [], { timeout: CHILD_TIMEOUT_MS });\n}, 15000);`,
      ["3: spawnSync（timeout 25000 がテストの timeout 15000 以上）"],
    ],
    [
      "テストのオプションの timeout 以上",
      `${IMPORT}test.concurrent("t", { timeout: 20_000 }, async () => {\n  spawnSync("node", [], { timeout: 20_000 });\n});`,
      ["3: spawnSync（timeout 20000 がテストの timeout 20000 以上）"],
    ],
    [
      "each のテストの timeout 以上",
      `${IMPORT}test.each([1])("t %s", () => {\n  spawnSync("node", [], { timeout: CHILD_TIMEOUT_MS });\n}, 10_000);`,
      ["3: spawnSync（timeout 25000 がテストの timeout 10000 以上）"],
    ],
    ["timeout: 0", `${IMPORT}spawnSync("node", [], { timeout: 0 });`, ["2: spawnSync"]],
    [
      "?? の後ろの値が testTimeout 以上",
      `${IMPORT}spawnSync("node", [], { timeout: options.timeout ?? 30_000 });`,
      ["2: spawnSync（timeout 30000 がテストの timeout 30000 以上）"],
    ],
    [
      "timeout の後ろのスプレッド",
      `${IMPORT}spawnSync("node", [], { timeout: CHILD_TIMEOUT_MS, ...options });`,
      ["2: spawnSync"],
    ],
    [
      "beforeAll の hookTimeout 以上",
      `${IMPORT}beforeAll(() => {\n  spawnSync("node", [], { timeout: CHILD_TIMEOUT_MS });\n});`,
      ["3: spawnSync（timeout 25000 がテストの timeout 10000 以上）"],
    ],
    [
      "型引数を付けた each のテストの timeout 以上",
      `${IMPORT}test.each<[number]>([[1]])("t %s", () => {\n  spawnSync("node", [], { timeout: CHILD_TIMEOUT_MS });\n}, 10_000);`,
      ["3: spawnSync（timeout 25000 がテストの timeout 10000 以上）"],
    ],
    ["変数への代入", `${IMPORT}const run = spawnSync;`, ["2: spawnSync（呼び出し以外で参照）"]],
    ["promisify", `${IMPORT}const run = promisify(spawn);`, ["2: spawn（呼び出し以外で参照）"]],
    ["省略記法で渡す", `${IMPORT}use({ spawnSync });`, ["2: spawnSync（呼び出し以外で参照）"]],
    [
      "名前空間からの分割代入",
      'import * as cp from "node:child_process";\nconst { spawnSync: run } = cp;',
      ["2: cp（呼び出し以外で参照）"],
    ],
    [
      "名前空間の要素アクセス",
      'import * as cp from "node:child_process";\ncp["spawnSync"]("node", []);',
      ["2: cp（呼び出し以外で参照）"],
    ],
    [
      "名前空間のメンバーの代入",
      'import * as cp from "node:child_process";\nconst run = cp.spawnSync;',
      ["2: spawnSync（呼び出し以外で参照）"],
    ],
    [
      "spawn-async の名前空間",
      'import * as sa from "./spawn-async.ts";\nawait sa.spawnAsync("node", []);',
      ["2: spawnAsync"],
    ],
    [
      "timeout: undefined",
      `${IMPORT}spawnSync("node", [], { timeout: undefined });`,
      ["2: spawnSync"],
    ],
    [
      "import = require",
      'import cp = require("node:child_process");\ncp.spawnSync("node", []);',
      ["2: spawnSync"],
    ],
    [
      "spawn-async の名前空間の参照",
      'import * as sa from "./spawn-async.ts";\nconst run = sa;',
      ["2: sa（呼び出し以外で参照）"],
    ],
    [
      "インスタンス化式",
      `${IMPORT}const run = spawnSync<never>;`,
      ["2: spawnSync（呼び出し以外で参照）"],
    ],
    [
      "再エクスポート",
      'export { spawnSync } from "node:child_process";',
      ["1: export（再エクスポート）"],
    ],
    [
      "describe の timeout 以上",
      `${IMPORT}describe("d", { timeout: 5_000 }, () => {\n  test("t", () => {\n    spawnSync("node", [], { timeout: CHILD_TIMEOUT_MS });\n  });\n});`,
      ["4: spawnSync（timeout 25000 がテストの timeout 5000 以上）"],
    ],
    [
      "名前空間のメンバーの import =",
      'import * as cp from "node:child_process";\nimport run = cp.spawnSync;\nrun("node", []);',
      ["3: spawnSync"],
    ],
    [
      "spawn-async の require",
      'const { spawnAsync } = require("./spawn-async.ts");',
      ["1: import"],
    ],
    [
      "aroundEach の hookTimeout 以上",
      `${IMPORT}aroundEach(async (run) => {\n  spawnSync("node", [], { timeout: CHILD_TIMEOUT_MS });\n  await run();\n});`,
      ["3: spawnSync（timeout 25000 がテストの timeout 10000 以上）"],
    ],
    [
      "onTestFinished の hookTimeout 以上",
      `${IMPORT}onTestFinished(() => {\n  spawnSync("node", [], { timeout: CHILD_TIMEOUT_MS });\n});`,
      ["3: spawnSync（timeout 25000 がテストの timeout 10000 以上）"],
    ],
    [
      "suite の timeout 以上",
      `${IMPORT}suite("d", { timeout: 5_000 }, () => {\n  test("t", () => {\n    spawnSync("node", [], { timeout: CHILD_TIMEOUT_MS });\n  });\n});`,
      ["4: spawnSync（timeout 25000 がテストの timeout 5000 以上）"],
    ],
    [
      "?? undefined",
      `${IMPORT}spawnSync("node", [], { timeout: options.timeout ?? undefined });`,
      ["2: spawnSync"],
    ],
    ["void 0", `${IMPORT}spawnSync("node", [], { timeout: void 0 });`, ["2: spawnSync"]],
    [
      "export import",
      'export import cp = require("node:child_process");',
      ["1: export（再エクスポート）"],
    ],
    ["export *", 'export * from "node:child_process";', ["1: export（再エクスポート）"]],
  ])("タイムアウトの無い起動（%s）を拾う", (_, source, expected) => {
    expect(findUntimedChildCalls(source)).toEqual(expected);
  });

  test.each([
    ["timeout を付けた", `${IMPORT}spawnSync("node", [], { timeout: CHILD_TIMEOUT_MS });`],
    [
      "timeout を省略記法で付けた",
      `${IMPORT}const timeout = 1000;\nspawnSync("node", [], { timeout });`,
    ],
    ["timeout を文字列のキーで付けた", `${IMPORT}spawnSync("node", [], { "timeout": 1000 });`],
    [
      "スプレッドの後ろに timeout",
      `${IMPORT}spawnSync("node", [], { ...options, timeout: 1000 });`,
    ],
    [
      "テンプレートの文字列の中のコード",
      `${IMPORT}const body = \`spawnSync("node", ["a.js"]);\`;\nwriteFileSync("t.test.ts", body);`,
    ],
    ["文字列の中のコード", `${IMPORT}const body = 'execSync("ls")';`],
    ["コメントの中のコード", `${IMPORT}// spawnSync("node", []) は使わない`],
    ["正規表現の exec", `${IMPORT}/a/.exec("a");`],
    ["child_process 以外の動的 import", `${IMPORT}const m = await import("./fake.ts");`],
    [
      "child_process 以外から import した同じ名前",
      'import { spawn } from "./fake.ts";\nspawn("x");',
    ],
    [
      "理由付きの免除（同じ行）",
      `${IMPORT}spawnSync("node", []); // child-timeout-ok: 止まることを確かめる`,
    ],
    [
      "理由付きの免除（直前の行）",
      `${IMPORT}// child-timeout-ok: 子プロセスの止まり方を測る\nspawnSync("node", []);`,
    ],
    [
      "timeout を付けた spawnAsync",
      'import { spawnAsync } from "./spawn-async.ts";\nawait spawnAsync("node", [], { timeout: CHILD_TIMEOUT_MS });',
    ],
    [
      "spawn-async 以外から import した spawnAsync",
      'import { spawnAsync } from "./other.ts";\nawait spawnAsync("node", []);',
    ],
    [
      "長いテストの中の、テストより短い timeout",
      `${IMPORT}test("t", { timeout: 120_000 }, () => {\n  spawnSync("node", [], { timeout: 60_000 });\n});`,
    ],
    [
      "テストの後ろの引数より短い timeout",
      `${IMPORT}test("t", () => {\n  spawnSync("node", [], { timeout: 5_000 });\n}, 15000);`,
    ],
    [
      "値を読めないテストの timeout",
      `${IMPORT}test("t", () => {\n  spawnSync("node", [], { timeout: 30_000 });\n}, LONG);`,
    ],
    ["値を読めない timeout", `${IMPORT}spawnSync("node", [], { timeout: limit * 2 });`],
    [
      "テストの名前の中の起動は、そのテストの timeout と比べない",
      `${IMPORT}test(String(spawnSync("node", [], { timeout: CHILD_TIMEOUT_MS }).status), () => {}, 1000);`,
    ],
    [
      "?? の後ろの CHILD_TIMEOUT_MS",
      `${IMPORT}spawnSync("node", [], { ...options, timeout: options.timeout ?? CHILD_TIMEOUT_MS });`,
    ],
    ["型の中の参照", `${IMPORT}type Result = ReturnType<typeof spawnSync>;`],
    ["同じ名前のオブジェクトのキー", `${IMPORT}const counts = { spawnSync: 1 };`],
    ["同じ名前の他のオブジェクトのメンバー", `${IMPORT}fake.spawnSync("node", []);`],
    [
      "起動の関数ではない名前空間のメンバー",
      'import * as cp from "node:child_process";\nconst Child = cp.ChildProcess;',
    ],
    [
      "長い beforeAll の中の、Hook より短い timeout",
      `${IMPORT}beforeAll(() => {\n  spawnSync("node", [], { timeout: CHILD_TIMEOUT_MS });\n}, 60_000);`,
    ],
    [
      "テストの timeout が 0（比べない）",
      `${IMPORT}test("t", () => {\n  spawnSync("node", [], { timeout: CHILD_TIMEOUT_MS });\n}, 0);`,
    ],
    [
      "テストに書いた timeout は describe の timeout より優先する",
      `${IMPORT}describe("d", { timeout: 5_000 }, () => {\n  test("t", () => {\n    spawnSync("node", [], { timeout: CHILD_TIMEOUT_MS });\n  }, 60_000);\n});`,
    ],
    ["child_process 以外からの再エクスポート", `${IMPORT}export { helper } from "./other.ts";`],
    ["型だけの再エクスポート", 'export type { spawnSync } from "node:child_process";'],
    [
      "起動の関数ではない名前の再エクスポート",
      'export { SpawnAsyncResult } from "./spawn-async.ts";',
    ],
    ["type を付けた名前の再エクスポート", 'export { type spawnSync } from "node:child_process";'],
  ])("拾わない（%s）", (_, source) => {
    expect(findUntimedChildCalls(source)).toEqual([]);
  });
});

// 検査の対象は vitest が収集するテスト（`*.test.ts`）、テストが import する fixture（`*-fixture.ts`）、
// テストから使う補助のファイル（`scripts/lib/testing/`）。
function targets(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : targets(path);
    if (!entry.name.endsWith(".ts")) return [];
    // `lib/testing-foo/` のような別のディレクトリを含めないよう、区切り文字まで比べる。
    return /(\.test|-fixture)\.ts$/.test(entry.name) ||
      relative(scriptsDir, path).startsWith(join("lib", "testing") + sep)
      ? [path]
      : [];
  });
}

test("CHILD_TIMEOUT_MS は vitest の testTimeout より短く、TEST_TIMEOUT_MS と HOOK_TIMEOUT_MS は設定と一致する", () => {
  const config = readFileSync(join(scriptsDir, "..", "vitest.config.ts"), "utf8");
  const timeouts = [...config.matchAll(/testTimeout:\s*([\d_]+)/gu)].map((m) =>
    Number(m[1].replaceAll("_", "")),
  );
  expect(timeouts.length).toBeGreaterThan(0);
  for (const timeout of timeouts) {
    expect(CHILD_TIMEOUT_MS).toBeLessThan(timeout);
    // 囲むテストが timeout を書いていない呼び出しは、TEST_TIMEOUT_MS で打ち切られるとみなして比べる。
    expect(TEST_TIMEOUT_MS).toBe(timeout);
  }
  // Hook の中の呼び出しは HOOK_TIMEOUT_MS と比べる。設定が hookTimeout を書かなければ、vitest のデフォルトの 10 秒になる。
  const hooks = [...config.matchAll(/hookTimeout:\s*([\d_]+)/gu)].map((m) =>
    Number(m[1].replaceAll("_", "")),
  );
  // 数値で書いていない hookTimeout（変数など）は読めないので、書いた数だけ数値で読めることも確かめる。
  expect(hooks.length).toBe(config.match(/hookTimeout/gu)?.length ?? 0);
  for (const hook of hooks.length > 0 ? hooks : [10_000]) expect(HOOK_TIMEOUT_MS).toBe(hook);
});

test("テストの子プロセスの起動にタイムアウトが付いている（実リポジトリ）", () => {
  const files = targets(scriptsDir);
  // 走査が空振りしていないこと（対象 0 件を合格として扱わない）。
  expect(files.map((f) => relative(scriptsDir, f))).toContain(
    join("lib", "testing", "child-timeout.test.ts"),
  );
  expect(files.length).toBeGreaterThan(40);
  const found = files.flatMap((file) =>
    findUntimedChildCalls(readFileSync(file, "utf8"), file).map(
      (hit) => `${relative(scriptsDir, file)}:${hit}`,
    ),
  );
  expect(
    found,
    "起動のオプションに timeout: CHILD_TIMEOUT_MS（scripts/lib/testing/child-timeout.ts）を付ける。付けない理由がある呼び出しは // child-timeout-ok: <理由> を書く",
  ).toEqual([]);
});
