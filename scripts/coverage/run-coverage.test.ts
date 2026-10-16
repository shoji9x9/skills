// カバレッジのランナー（run-coverage.ts）のテスト。
// 引数の誤りは CLI を子プロセスで起動して確かめる。
// 測定から比べるまでの通しの実行は、最小のリポジトリ（ソース 1 つ・テスト 1 つ・シェル 1 つ）を作り、main を同じプロセスで呼んで確かめる。
// 最小のリポジトリは node_modules/.cache/ の下に作り、package.json と node_modules を置かない。
// リポジトリの外では mise が pnpm の版を決められない。package.json を置くと、pnpm exec がそこを別のプロジェクトとして依存を入れ直す。
// 置かなければ、pnpm と Node はリポジトリの直下の package.json と node_modules を使う。
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test, vi } from "vitest";
import { makeTempDir, makeTempDirFactory } from "../lib/testing/test-tmpdir.ts";
import { main, readC8Summary, targetFiles } from "./run-coverage.ts";

const SCRIPT = fileURLToPath(new URL("run-coverage.ts", import.meta.url));
const ROOT = fileURLToPath(new URL("../../", import.meta.url));

const run = (args: string[]) =>
  spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", cwd: ROOT });

test.each([
  ["知らない引数", ["--bogus"], /知らない引数/],
  ["値の無い --focus", ["--focus"], /値の無い --focus/],
  ["空の --focus", ["--focus", ""], /値の無い --focus/],
  ["--focus の無い絞り込み", ["--", "scripts/coverage/"], /--focus も指定する/],
  ["--reuse と --focus", ["--reuse", "--focus", "scripts/"], /一緒に使えない/],
  ["当たるファイルの無い --focus", ["--focus", "no-such-dir/"], /当たる対象のファイルが無い/],
])("CLI: %s は測らずに exit 2 で止める", (_name, args, message) => {
  const res = run(args);
  expect(res.status).toBe(2);
  expect(res.stderr).toMatch(message);
});

test("readC8Summary: 絶対パスをリポジトリからの相対パスにし、total を除いて 3 つの指標を読む", () => {
  const pct = (n: number) => ({ total: 10, covered: n / 10, skipped: 0, pct: n });
  const measures = readC8Summary("/r", {
    total: { lines: pct(1), branches: pct(1), functions: pct(1) },
    "/r/scripts/a.ts": {
      lines: pct(90),
      branches: pct(80),
      functions: pct(70),
      statements: pct(1),
    },
  });
  expect([...measures]).toEqual([["scripts/a.ts", { lines: 90, branches: 80, functions: 70 }]]);
});

test.each([
  ["object でない", []],
  ["項目が object でない", { "/r/a.ts": 1 }],
  ["指標が欠けている", { "/r/a.ts": { lines: { pct: 1 }, branches: { pct: 1 } } }],
  [
    "pct が数でない",
    { "/r/a.ts": { lines: { pct: "1" }, branches: { pct: 1 }, functions: { pct: 1 } } },
  ],
])("readC8Summary: %s 結果は判定できないとして例外にする", (_name, value) => {
  expect(() => readC8Summary("/r", value)).toThrow();
});

test("targetFiles: scripts/ と skills/ の下のソースを、add していない新しいファイルも含め、テストと型の宣言と無視するファイルを除いて返す", () => {
  const root = makeTempDir("run-coverage-targets-");
  const tracked = [
    "scripts/a.ts",
    "scripts/a.test.ts",
    "scripts/b.d.ts",
    "scripts/c.sh",
    "skills/x/scripts/d.mjs",
    "skills/x/SKILL.md",
    ".agents/skills/x/scripts/d.mjs",
    "other/e.ts",
  ];
  for (const rel of [...tracked, "scripts/untracked.ts", "scripts/ignored.ts", ".gitignore"]) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), "");
  }
  const git = (...args: string[]) => expect(spawnSync("git", args, { cwd: root }).status).toBe(0);
  git("init", "-q");
  writeFileSync(join(root, ".gitignore"), "scripts/ignored.ts\n");
  git("add", "--", ...tracked);
  expect(targetFiles(root)).toEqual([
    "scripts/a.ts",
    "scripts/c.sh",
    "scripts/untracked.ts",
    "skills/x/scripts/d.mjs",
  ]);
});

test("targetFiles: 対象が 0 件のときは、判定できないとして例外にする", () => {
  const root = makeTempDir("run-coverage-empty-");
  expect(spawnSync("git", ["init", "-q"], { cwd: root }).status).toBe(0);
  expect(() => targetFiles(root)).toThrow(/0 件/);
});

test("coverageEnv: シェルの計測は SHELL_COVERAGE_DIR と BASH_ENV が両方あるときだけ渡す", () => {
  const read = (env: Record<string, string>) =>
    spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { coverageEnv } from ${JSON.stringify(new URL("../lib/testing/coverage-env.ts", import.meta.url).href)}; console.log(JSON.stringify(coverageEnv()));`,
      ],
      { encoding: "utf8", env: { PATH: process.env.PATH ?? "", ...env } },
    ).stdout.trim();
  // Node は、環境を明示した子プロセスにも親の NODE_V8_COVERAGE を引き継ぐ。測る実行では、親の値が入る。
  const inherited = process.env.NODE_V8_COVERAGE
    ? { NODE_V8_COVERAGE: process.env.NODE_V8_COVERAGE }
    : {};
  expect(JSON.parse(read({}))).toEqual(inherited);
  expect(JSON.parse(read({ BASH_ENV: "/b" }))).toEqual(inherited);
  expect(
    JSON.parse(read({ NODE_V8_COVERAGE: "/v", SHELL_COVERAGE_DIR: "/d", BASH_ENV: "/b" })),
  ).toEqual({
    NODE_V8_COVERAGE: "/v",
    SHELL_COVERAGE_DIR: "/d",
    BASH_ENV: "/b",
  });
});

const CACHE_DIR = join(ROOT, "node_modules", ".cache");
mkdirSync(CACHE_DIR, { recursive: true });
const newRepoDir = makeTempDirFactory("run-coverage-test-", CACHE_DIR);
afterEach(() => {
  vi.restoreAllMocks();
});

/** 閾値の設定・ソース・テストを持つ最小のリポジトリ。`body` は tests/a.test.mjs の中身。 */
function miniRepo(body: string): string {
  const root = newRepoDir("repo-");
  const write = (rel: string, text: string) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  };
  write(
    "scripts/coverage/coverage-thresholds.json",
    JSON.stringify({
      rules: [
        { path: "skills/", kind: "js", lines: 90, branches: 80, functions: 90 },
        { path: "skills/", kind: "sh", lines: 80 },
      ],
      exclude: [{ path: "scripts/coverage/bash-trace-env.sh", reason: "計測の仕組みそのもの" }],
    }),
  );
  copyFileSync(
    join(ROOT, "scripts/coverage/bash-trace-env.sh"),
    join(root, "scripts/coverage/bash-trace-env.sh"),
  );
  // Node は node_modules の下の .ts の型を外さないので、ソースとテストと設定は .mjs で書く。
  // 測り方の前提（vite の変換を外す・ワーカーの分を書き出す）は、本物のリポジトリの vitest.config.ts と同じにする。
  // vitest のデフォルトの exclude は node_modules を含むパスをすべて外すので、置き場所に合わせて書き直す。
  write(
    "vitest.config.mjs",
    `export default { test: { include: ["tests/**/*.test.mjs"], exclude: [], experimental: { viteModuleRunner: false }, setupFiles: ["tests/setup.mjs"] } };\n`,
  );
  write(
    "tests/setup.mjs",
    readFileSync(join(ROOT, "scripts/lib/testing/vitest-coverage-setup.ts"), "utf8"),
  );
  write(
    "skills/x/a.mjs",
    "export const twice = (n) => n * 2;\nexport const half = (n) => n / 2;\n",
  );
  write("skills/x/s.sh", "echo one\necho two\n");
  write("tests/a.test.mjs", body);
  expect(spawnSync("git", ["init", "-q"], { cwd: root }).status).toBe(0);
  return root;
}

const FULL = `import { spawnSync } from "node:child_process";
import { expect, test } from "vitest";
import { half, twice } from "../skills/x/a.mjs";
test("a", () => {
  expect(twice(2)).toBe(4);
  expect(half(4)).toBe(2);
  expect(spawnSync("bash", ["skills/x/s.sh"]).status).toBe(0);
});
`;

/** main を呼び、終了コードと出力を返す。 */
function runMain(argv: string[], root: string) {
  const out: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
  const status = main(argv, root);
  vi.restoreAllMocks();
  return { status, out: out.join("\n") };
}

test(
  "main: すべて閾値以上なら exit 0 で、--reuse は測り直さずに同じ結果を比べる",
  { timeout: 120_000 },
  () => {
    const root = miniRepo(FULL);
    const first = runMain([], root);
    expect(first.status, first.out).toBe(0);
    expect(first.out).toMatch(/対象 3 ファイルのうち 2 ファイルが閾値以上（除外 1）/);
    const again = runMain(["--reuse"], root);
    expect(again.status, again.out).toBe(0);
  },
);

test(
  "main: 閾値を下回るファイルがあれば exit 1 で、ファイル・指標・閾値を示す",
  { timeout: 120_000 },
  () => {
    // half を呼ばず、シェルも実行しない。
    const root = miniRepo(`import { expect, test } from "vitest";
import { twice } from "../skills/x/a.mjs";
test("a", () => expect(twice(2)).toBe(4));
`);
    const res = runMain([], root);
    expect(res.status, res.out).toBe(1);
    expect(res.out).toMatch(/skills\/x\/a\.mjs: functions 50% が閾値 90%/);
    expect(res.out).toMatch(/skills\/x\/s\.sh: lines 0% が閾値 80%/);
  },
);

test("main: --focus は当たるファイルだけを比べ、値を出す", { timeout: 120_000 }, () => {
  const root = miniRepo(FULL);
  const res = runMain(["--focus", "skills/x/a.mjs", "--", "tests/a.test.mjs"], root);
  expect(res.status, res.out).toBe(0);
  expect(res.out).toMatch(/skills\/x\/a\.mjs: lines 100%, branches 100%, functions 100%/);
  expect(res.out).not.toMatch(/s\.sh/);
});

test("main: テストが失敗したら、カバレッジを比べずに exit 1 で止める", { timeout: 120_000 }, () => {
  const root = miniRepo(`import { expect, test } from "vitest";
test("a", () => expect(1).toBe(2));
`);
  const res = runMain([], root);
  expect(res.status, res.out).toBe(1);
  expect(res.out).toMatch(/テストが失敗した/);
});

test("main: 前回の結果が無いのに --reuse なら、判定できないとして exit 2", () => {
  const res = runMain(["--reuse"], miniRepo(FULL));
  expect(res.status).toBe(2);
  expect(res.out).toMatch(/測定の結果が無い/);
});

test("main: 設定が読めなければ、測らずに exit 2", () => {
  const root = miniRepo(FULL);
  writeFileSync(join(root, "scripts/coverage/coverage-thresholds.json"), "{");
  const res = runMain([], root);
  expect(res.status).toBe(2);
  expect(res.out).toMatch(/判定できない/);
});
