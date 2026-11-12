// parity-suite の操作中のエラーの記録の fixture の雛形（assets/runtime-errors.fixture.template.ts）の回帰テスト（Issue #1003）。
//
// 雛形は、記録のファイル名を Playwright のテストの id（testInfo.testId）から決める。テストの id は、project（同じ名前の project も別のもの）と
// 繰り返しの回（--repeat-each）ごとに違い、リトライの試行では同じである。
// これは、@playwright/test 1.64 で、同じ名前の 2 つの project と --repeat-each=2 と --retries=1 の実行で確かめた。
// 期待値は、雛形の冒頭のコメントと parity-suite の references/baseline.md
// 「操作中のエラーのベースライン」から決める。
//   - 同じテストを繰り返した記録は別のファイルになり、runtime-errors.mjs summarize が「同じテストの記録が 1 つの実行に 2 つある」で exit 2 にする
//   - リトライの試行は同じファイルに書き、前の試行のイベントを残す
//   - 1 回ずつ記録した 2 回の実行は、summarize が基準にする
// ブラウザは起動せず、fixture が受け取る context・page・testInfo を、使うメソッドとフィールドだけの偽物にする。
// 雛形は @playwright/test を型としてだけ import するので、Node が型を消してそのまま読み込める。
// 雛形は tsconfig.repo.json の対象の外にあるので、型は使う部分をここに書き、読み込みは URL で行う（import の型にしない）。

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { main as runtimeErrors } from "../../../../skills/parity-suite/scripts/runtime-errors.mjs";
import { parseJsonAs } from "../../../lib/parse-as.ts";
import { makeTempDir } from "../../../lib/testing/test-tmpdir.ts";

/** 雛形が export する fixture のうち、このテストが呼ぶ部分。偽物は fixture が使うメンバーだけを持つので、引数は unknown で受ける。 */
type FixtureModule = {
  runtimeErrorFixtures: {
    runtimeErrors: [
      (deps: unknown, use: () => Promise<void>, info: unknown) => Promise<void>,
      unknown,
    ];
  };
};

const TEMPLATE = new URL(
  "../../../../skills/parity-suite/assets/runtime-errors.fixture.template.ts",
  import.meta.url,
);
const loaded: FixtureModule = await import(TEMPLATE.href);
const [fixture] = loaded.runtimeErrorFixtures.runtimeErrors;

const FILE = "tests/parity/orders.spec.ts";

type Attempt = { testId: string; retry: number; error: string };

type Handler = (arg: unknown) => void;

/** console の error を 1 件出す page の偽物。fixture が使う on と url だけを持つ。 */
function fakePage() {
  const handlers = new Map<string, Handler>();
  return {
    page: {
      on: (event: string, h: Handler) => handlers.set(event, h),
      url: () => "http://127.0.0.1:4100/orders",
    },
    emitConsoleError: (text: string) =>
      handlers.get("console")?.({ type: () => "error", text: () => text }),
  };
}

/** fixture の関数を 1 回の試行として呼ぶ。試行の中で console の error を 1 件出す。 */
async function attempt(root: string, run: number, a: Attempt): Promise<void> {
  vi.stubEnv("PARITY_RUNTIME_CAPTURE", "1");
  vi.stubEnv("PARITY_RUNTIME_RUN", String(run));
  vi.stubEnv("PARITY_SLUG", "orders");
  vi.stubEnv("PARITY_REPO_ROOT", root);
  const { page, emitConsoleError } = fakePage();
  const context = { pages: () => [page], on: () => undefined };
  const testInfo = {
    project: { name: "current" },
    config: { rootDir: root },
    file: join(root, FILE),
    titlePath: [FILE, "一覧を開く"],
    testId: a.testId,
    retry: a.retry,
    status: "passed",
  };
  await fixture({ context }, async () => emitConsoleError(a.error), testInfo);
}

const runDir = (n: number) => `.replace/parity/orders/runtime-errors/run-${n}`;

function summarize(root: string) {
  mkdirSync(join(root, ".replace/parity/orders"), { recursive: true });
  writeFileSync(join(root, ".replace/parity/orders/metadata.json"), '{"slug":"orders"}\n');
  let stderr = "";
  const code = runtimeErrors(
    [
      "summarize",
      "--metadata",
      ".replace/parity/orders/metadata.json",
      "--run",
      runDir(1),
      "--run",
      runDir(2),
    ],
    { cwd: root, stdout: () => undefined, stderr: (s: string) => (stderr += s) },
  );
  return { code, stderr };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("parity-suite の記録の fixture の雛形", () => {
  // テストの id は、Playwright の実行で同じテストに付いた値の形（16 進のハッシュと project・繰り返しの別）をまねた値にする
  test.each([
    [
      "--repeat-each の 2 回目",
      "a1b2c3d4e5f6a7b8c9d0-current",
      "a1b2c3d4e5f6a7b8c9d0-current-repeat1",
    ],
    ["同じ名前の別の project", "a1b2c3d4e5f6a7b8c9d0-current", "a1b2c3d4e5f6a7b8c9d0-current1"],
  ])(
    "1 つの実行に %s の記録があれば、上書きせずに別のファイルに書き、summarize が exit 2 にする",
    async (_name, first, second) => {
      const root = makeTempDir("runtime-errors-fixture-");
      await attempt(root, 1, { testId: first, retry: 0, error: "1 回目のエラー" });
      await attempt(root, 1, { testId: second, retry: 0, error: "2 回目のエラー" });
      await attempt(root, 2, { testId: first, retry: 0, error: "1 回目のエラー" });
      expect(readdirSync(join(root, runDir(1)))).toHaveLength(2);
      const r = summarize(root);
      expect(r.code).toBe(2);
      expect(r.stderr).toContain("同じテストの記録が 1 つの実行に 2 つある");
    },
  );

  test("リトライの試行は同じファイルに書き、前の試行のイベントを残す", async () => {
    const root = makeTempDir("runtime-errors-fixture-");
    await attempt(root, 1, { testId: "t-current", retry: 0, error: "失敗した試行のエラー" });
    await attempt(root, 1, { testId: "t-current", retry: 1, error: "通った試行のエラー" });
    const files = readdirSync(join(root, runDir(1)));
    expect(files).toHaveLength(1);
    const doc = parseJsonAs<{ retry: number; events: { text: string }[] }>(
      readFileSync(join(root, runDir(1), String(files[0])), "utf8"),
    );
    expect(doc.retry).toBe(1);
    expect(doc.events.map((e) => e.text)).toEqual(["失敗した試行のエラー", "通った試行のエラー"]);
  });

  test("各回に 1 つずつ記録した 2 回の実行は、summarize が基準にする", async () => {
    const root = makeTempDir("runtime-errors-fixture-");
    await attempt(root, 1, { testId: "t-current", retry: 0, error: "現行のエラー" });
    await attempt(root, 2, { testId: "t-current", retry: 0, error: "現行のエラー" });
    expect(summarize(root)).toEqual({ code: 0, stderr: "" });
  });
});
