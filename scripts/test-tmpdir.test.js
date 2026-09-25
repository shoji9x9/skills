// `scripts/lib/test-tmpdir.js` の後片付けの挙動と、テストが一時ディレクトリを直に作っていないことの検査（Issue #479）。
//
// 後片付けを各テストに書かせると書き忘れが再発する（Issue #479 の時点で 40 ファイル超が `/tmp` に残骸を残していた）。
// 作成をヘルパーへ寄せ、直呼びをここで落とす。
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { makeSharedTempDir, makeTempDir } from "./lib/test-tmpdir.js";

const scriptsDir = dirname(fileURLToPath(import.meta.url));

// --- 挙動 -------------------------------------------------------------------

// テストをまたいで観測するため、作ったパスをファイル内の変数へ残す（このファイルは直列に走る）。
let madeInPassingTest;
let madeInFailingTest;

test("makeTempDir はテストの中で作れる", () => {
  madeInPassingTest = makeTempDir("test-tmpdir-pass-");
  expect(existsSync(madeInPassingTest)).toBe(true);
});

test("makeTempDir で作ったものはテストの終わりに消える", () => {
  expect(madeInPassingTest).toBeTruthy();
  expect(existsSync(madeInPassingTest)).toBe(false);
});

test.fails("assertion が落ちたテスト（後片付けの陽性コントロール）", () => {
  madeInFailingTest = makeTempDir("test-tmpdir-fail-");
  expect(existsSync(madeInFailingTest)).toBe(false);
});

test("assertion が落ちても消える", () => {
  expect(madeInFailingTest).toBeTruthy();
  expect(existsSync(madeInFailingTest)).toBe(false);
});

// 収集時の makeTempDir は例外にする（どのテストの終わりに消すかが決まらない）。作りかけも残さない。
let collectionError;
try {
  makeTempDir("test-tmpdir-collect-");
} catch (error) {
  collectionError = error;
}

test("収集時に makeTempDir を呼ぶと例外になる", () => {
  expect(collectionError).toBeInstanceOf(Error);
});

let shared;
describe("makeSharedTempDir", () => {
  shared = makeSharedTempDir("test-tmpdir-shared-");

  test("同じ describe の複数のテストで使える（1 本目）", () => {
    expect(existsSync(shared)).toBe(true);
  });

  test("同じ describe の複数のテストで使える（2 本目）", () => {
    expect(existsSync(shared)).toBe(true);
  });
});

test("makeSharedTempDir で作ったものは describe を抜けると消える", () => {
  expect(shared).toBeTruthy();
  expect(existsSync(shared)).toBe(false);
});

// --- 直呼びの検査 -------------------------------------------------------------

// 標的の語をそのまま書くと、このファイル自身が検査に引っかかる（検査対象から外さずに済むよう分けて組む）。
const MK = "mkdtemp";
// 一時ディレクトリを直に作る呼び出し。`fs.` 付き・promises 版も含む。
const DIRECT = new RegExp(`\\b${MK}(?:Sync)?\\s*\\(`);
// `/tmp` 以外（リポジトリ内等）へ作り、後片付けを自前で持つ呼び出しは、同じ行に理由を書いて免除する。
const EXEMPT = /\/\/ tmpdir-ok: \S/;

/** 直呼びしている行を `行番号: 行` で返す。 */
function findDirectMkdtemp(source) {
  return source
    .split("\n")
    .map((line, i) => [i + 1, line])
    .filter(([, line]) => DIRECT.test(line) && !EXEMPT.test(line))
    .map(([n, line]) => `${n}: ${line.trim()}`);
}

// 検査の対象は vitest が収集するテスト（`scripts/**/*.test.js`）と、テストが import する fixture（`*-fixture.js`）。
function targets(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : targets(path);
    return /(\.test|-fixture)\.js$/.test(entry.name) ? [path] : [];
  });
}

describe("findDirectMkdtemp", () => {
  test.each([
    ["Sync", `const d = ${MK}Sync(join(tmpdir(), "x-"));`],
    ["名前空間付き", `const d = fs.${MK}Sync(join(os.tmpdir(), "x-"));`],
    ["promises", `const d = await ${MK}(join(tmpdir(), "x-"));`],
    ["引数を変数で渡す", `const d = ${MK}Sync(prefix);`],
    ["理由の無い免除", `const d = ${MK}Sync(join(tmpdir(), "x-")); // tmpdir-ok:`],
  ])("直呼び（%s）を拾う", (_, line) => {
    expect(findDirectMkdtemp(`a\n${line}\nb`)).toEqual([`2: ${line}`]);
  });

  test.each([
    ["ヘルパー経由", 'const d = makeTempDir("x-");'],
    ["コメント中の語", `// \`makeProject()\` の ${MK} の外側`],
    ["理由付きの免除", `const d = ${MK}Sync(join(repoRoot, "x-")); // tmpdir-ok: afterEach で消す`],
  ])("直呼びでない行（%s）は拾わない", (_, line) => {
    expect(findDirectMkdtemp(line)).toEqual([]);
  });
});

test("テストは一時ディレクトリを makeTempDir / makeSharedTempDir で作る", () => {
  const files = targets(scriptsDir);
  // 走査が空振りしていないこと（対象 0 件を合格に倒さない）。
  expect(files.map((f) => relative(scriptsDir, f))).toContain("test-tmpdir.test.js");
  expect(files.length).toBeGreaterThan(40);
  const found = files.flatMap((file) =>
    findDirectMkdtemp(readFileSync(file, "utf8")).map(
      (hit) => `${relative(scriptsDir, file)}:${hit}`,
    ),
  );
  expect(found, "scripts/lib/test-tmpdir.js の makeTempDir / makeSharedTempDir を使う").toEqual([]);
});
