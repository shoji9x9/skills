// カバレッジのランナー（run-coverage.ts）のテスト。
// 引数の誤りは CLI を子プロセスで起動して確かめる。
// 測定から比べるまでの通しの実行は、最小のリポジトリ（ソース 1 つ・テスト 1 つ・シェル 1 つ）を作り、main を同じプロセスで呼んで確かめる。
// 最小のリポジトリは node_modules/.cache/ の下に作り、package.json と node_modules を置かない。
// リポジトリの外では mise が pnpm の版を決められない。package.json を置くと、pnpm exec がそこを別のプロジェクトとして依存を入れ直す。
// 置かなければ、pnpm と Node はリポジトリの直下の package.json と node_modules を使う。
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, expect, test, vi } from "vitest";
import { makeTempDir, makeTempDirFactory } from "../lib/testing/test-tmpdir.ts";
import {
  FOCUS_STALE_MS,
  keepProjectCoverage,
  main,
  readC8Summary,
  sweepFocusDirs,
  targetFiles,
} from "./run-coverage.ts";
import { CHILD_TIMEOUT_MS } from "../lib/testing/child-timeout.ts";
import { parseJsonAs } from "../lib/parse-as.ts";

const SCRIPT = fileURLToPath(new URL("run-coverage.ts", import.meta.url));
const ROOT = fileURLToPath(new URL("../../", import.meta.url));

const run = (args: string[]) =>
  spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf8",
    cwd: ROOT,
    timeout: CHILD_TIMEOUT_MS,
  });

/**
 * ランナーを一時ディレクトリに置いたリポジトリにコピーし、前回の測定の結果（要約）を置いて、--reuse の CLI を起動する。
 * ランナーはリポジトリの直下を自分の位置から決めるので、コピーしたリポジトリの結果と設定を読む。
 * --reuse は測り直さない（pnpm を起動しない）ので、リポジトリの外に置ける。
 */
function runCopiedCli(pct: number) {
  const root = makeTempDir("run-coverage-cli-");
  const RUNNER = ["coverage/run-coverage.ts", "coverage/check-coverage.ts"];
  const LIB = ["lib/errors.ts", "lib/guards.ts", "lib/is-array.ts", "lib/source-scope.ts"];
  for (const rel of [...RUNNER, ...LIB]) {
    mkdirSync(dirname(join(root, "scripts", rel)), { recursive: true });
    copyFileSync(join(ROOT, "scripts", rel), join(root, "scripts", rel));
  }
  const write = (rel: string, text: string) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  };
  write(
    "scripts/coverage/coverage-thresholds.json",
    JSON.stringify({
      rules: [{ path: "skills/", lines: 90 }],
      exclude: [...RUNNER, ...LIB].map((rel) => ({
        path: `scripts/${rel}`,
        reason: "ランナーのコピー",
      })),
    }),
  );
  write("skills/x/a.mjs", "export const a = 1;\n");
  const m = { total: 1, covered: 1, skipped: 0, pct };
  write(
    "node_modules/.cache/coverage/report/coverage-summary.json",
    JSON.stringify({
      total: { lines: m, branches: m, functions: m },
      [join(root, "skills/x/a.mjs")]: { lines: m, branches: m, functions: m },
    }),
  );
  expect(spawnSync("git", ["init", "-q"], { cwd: root, timeout: CHILD_TIMEOUT_MS }).status).toBe(0);
  return spawnSync(process.execPath, [join(root, "scripts/coverage/run-coverage.ts"), "--reuse"], {
    encoding: "utf8",
    cwd: root,
    timeout: CHILD_TIMEOUT_MS,
  });
}

test("CLI: 前回の結果がすべて閾値以上なら exit 0", () => {
  const res = runCopiedCli(95);
  expect(res.status, res.stderr).toBe(0);
  expect(res.stdout).toMatch(/閾値以上/);
});

test("CLI: 閾値を下回るファイルがあれば exit 1", () => {
  const res = runCopiedCli(50);
  expect(res.status, res.stdout).toBe(1);
  expect(res.stderr).toMatch(/skills\/x\/a\.mjs: lines 50% が閾値 90%/);
});

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

test("targetFiles: scripts/・skills/・private skill の下のソースを、add していない新しいファイルも含め、テストと型の宣言と無視するファイルとインストール済みのコピーを除いて返す", () => {
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
  const git = (...args: string[]) =>
    expect(spawnSync("git", args, { cwd: root, timeout: CHILD_TIMEOUT_MS }).status).toBe(0);
  git("init", "-q");
  writeFileSync(join(root, ".gitignore"), "scripts/ignored.ts\n");
  // private skill（.private-skill を持つもの）のスクリプトは測り、インストール済みのコピーは測らない。
  for (const rel of [".agents/skills/p/.private-skill", ".agents/skills/p/scripts/p.ts"]) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), "");
  }
  git("add", "--", ...tracked);
  expect(targetFiles(root)).toEqual([
    ".agents/skills/p/scripts/p.ts",
    "scripts/a.ts",
    "scripts/untracked.ts",
    "skills/x/scripts/d.mjs",
  ]);
});

test("targetFiles: 対象が 0 件のときは、判定できないとして例外にする", () => {
  const root = makeTempDir("run-coverage-empty-");
  expect(spawnSync("git", ["init", "-q"], { cwd: root, timeout: CHILD_TIMEOUT_MS }).status).toBe(0);
  expect(() => targetFiles(root)).toThrow(/0 件/);
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
      rules: [{ path: "skills/", lines: 90, branches: 80, functions: 90 }],
      exclude: [],
    }),
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
  // シェルスクリプトは測らないので、テストが実行しなくても閾値と比べない。
  write("skills/x/s.sh", "echo one\necho two\n");
  write("tests/a.test.mjs", body);
  expect(spawnSync("git", ["init", "-q"], { cwd: root, timeout: CHILD_TIMEOUT_MS }).status).toBe(0);
  return root;
}

const FULL = `import { expect, test } from "vitest";
import { half, twice } from "../skills/x/a.mjs";
test("a", () => {
  expect(twice(2)).toBe(4);
  expect(half(4)).toBe(2);
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
    // 前回の結果の残り（測り直しで消えるはずのファイル）を置いておく。
    const stale = join(root, "node_modules", ".cache", "coverage", "stale.json");
    mkdirSync(dirname(stale), { recursive: true });
    writeFileSync(stale, "{}");
    const first = runMain([], root);
    expect(existsSync(stale), "通常の実行が前回の結果を消していない").toBe(false);
    expect(first.status, first.out).toBe(0);
    // CRAP が読む V8 の記録を、測る対象のファイルの分だけ残す。リポジトリは node_modules の下にあるが、それでも残す。
    expect(v8Urls(join(root, "node_modules", ".cache", "coverage", "v8"))).toEqual([
      pathToFileURL(join(root, "skills/x/a.mjs")).href,
    ]);
    expect(first.out).toMatch(/対象 1 ファイルのうち 1 ファイルが閾値以上（除外 0）/);
    const again = runMain(["--reuse"], root);
    expect(again.status, again.out).toBe(0);
  },
);

test(
  "main: 閾値を下回るファイルがあれば exit 1 で、ファイル・指標・閾値を示す",
  { timeout: 120_000 },
  () => {
    // half を呼ばない。
    const root = miniRepo(`import { expect, test } from "vitest";
import { twice } from "../skills/x/a.mjs";
test("a", () => expect(twice(2)).toBe(4));
`);
    const res = runMain([], root);
    expect(res.status, res.out).toBe(1);
    expect(res.out).toMatch(/skills\/x\/a\.mjs: functions 50% が閾値 90%/);
    expect(res.out).not.toMatch(/s\.sh/);
  },
);

test("main: --focus は当たるファイルだけを比べ、値を出す", { timeout: 120_000 }, () => {
  const root = miniRepo(FULL);
  const res = runMain(["--focus", "skills/x/a.mjs", "--", "tests/a.test.mjs"], root);
  expect(res.status, res.out).toBe(0);
  expect(res.out).toMatch(/skills\/x\/a\.mjs: lines 100%, branches 100%, functions 100%/);
  expect(res.out).not.toMatch(/s\.sh/);
  // 結果のディレクトリの名前を作る側（main）と、名前から pid を読む側（sweepFocusDirs）を通しで確かめる。
  // 名前は自分の pid で始まり、pid のプロセスが在る（実行中とみなす）間は、時間がたっても消さない。
  const cache = join(root, "node_modules", ".cache");
  const [dir] = readdirSync(cache).filter((name) => name.startsWith("coverage-focus-"));
  expect(dir).toMatch(new RegExp(`^coverage-focus-${process.pid}-`));
  expect(existsSync(join(cache, dir ?? "", "v8")), "--focus の実行が V8 の記録を残している").toBe(
    false,
  );
  sweepFocusDirs(root, Date.now() + 2 * FOCUS_STALE_MS);
  expect(readdirSync(cache)).toContain(dir);
});

test("main: --focus に当たる対象が無ければ、結果のディレクトリを作らずに exit 2 で止める", () => {
  const root = miniRepo(FULL);
  const res = runMain(["--focus", "no-such-dir/"], root);
  expect(res.status).toBe(2);
  expect(res.out).toMatch(/当たる対象のファイルが無い/);
  expect(readdirSync(root)).not.toContain("node_modules");
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

// 時刻は固定する。結果のディレクトリの更新時刻を T0 にし、sweepFocusDirs に渡す「今」を T0 からの差で決める。
const T0 = Date.UTC(2026, 0, 1);

/** node_modules/.cache の下に、更新時刻を T0 にしたディレクトリを作る。 */
function focusDirs(names: string[]): { root: string; cache: string } {
  const root = makeTempDir("run-coverage-sweep-");
  const cache = join(root, "node_modules", ".cache");
  for (const name of names) {
    mkdirSync(join(cache, name), { recursive: true });
    utimesSync(join(cache, name), T0 / 1000, T0 / 1000);
  }
  return { root, cache };
}

test("sweepFocusDirs: pid のプロセスが無く、更新から FOCUS_STALE_MS たった --focus の結果だけを消す", () => {
  // pid 1 は常に在る（別の利用者のプロセスなら EPERM になり、在るとみなす）。2 の 22 乗より大きい pid は Linux では作られない。
  const { root, cache } = focusDirs([
    "coverage",
    "coverage-focus-1-aaaaaa",
    "coverage-focus-9999999-bbbbbb",
    "coverage-focus-x",
    "other",
  ]);
  sweepFocusDirs(root, T0 + FOCUS_STALE_MS);
  expect(readdirSync(cache).sort()).toEqual(["coverage", "coverage-focus-1-aaaaaa", "other"]);
});

test("sweepFocusDirs: pid のプロセスが無くても、更新から FOCUS_STALE_MS たっていなければ残す（別の pid の名前空間で実行中のもの）", () => {
  const { root, cache } = focusDirs(["coverage-focus-9999999-bbbbbb"]);
  sweepFocusDirs(root, T0 + FOCUS_STALE_MS - 1);
  expect(readdirSync(cache)).toEqual(["coverage-focus-9999999-bbbbbb"]);
});

test("sweepFocusDirs: 結果の置き場所がまだ無ければ何もしない", () => {
  expect(() => sweepFocusDirs(makeTempDir("run-coverage-sweep-empty-"))).not.toThrow();
});

test("main: 結果の置き場所を用意できなければ、判定できないとして exit 2", () => {
  const root = miniRepo(FULL);
  // node_modules/.cache をファイルにしておくと、--focus の結果のディレクトリを作れない。
  mkdirSync(join(root, "node_modules"), { recursive: true });
  writeFileSync(join(root, "node_modules", ".cache"), "");
  const res = runMain(["--focus", "skills/x/a.mjs"], root);
  expect(res.status, res.out).toBe(2);
  expect(res.out).toMatch(/結果の置き場所を用意できない/);
});

/** V8 の記録（NODE_V8_COVERAGE の 1 ファイル）を、url の並びとソースマップから作る。 */
const v8Record = (urls: unknown[], sourceMaps: Record<string, unknown> = {}) =>
  JSON.stringify({
    result: urls.map((url) => ({ scriptId: "1", url, functions: [] })),
    timestamp: 1,
    "source-map-cache": sourceMaps,
  });

/** V8 の記録のディレクトリに残っているスクリプトの URL を、重複を除いて並べる。 */
function v8Urls(dir: string): string[] {
  const urls = readdirSync(dir).flatMap((name) =>
    parseJsonAs<{ result: { url: string }[] }>(readFileSync(join(dir, name), "utf8")).result.map(
      (r) => r.url,
    ),
  );
  return [...new Set(urls)].sort();
}

test("keepProjectCoverage: 対象のディレクトリの下のスクリプトの分だけを、ソースマップと一緒に残し、何も残らないファイルを消す", () => {
  // リポジトリ自身を node_modules の下に置き、対象のディレクトリより下の node_modules だけを外すことを確かめる。
  const root = join(makeTempDir("run-coverage-v8-"), "node_modules", "repo");
  const dir = join(root, "v8");
  mkdirSync(dir, { recursive: true });
  const url = (rel: string) => pathToFileURL(join(root, rel)).href;
  const map = { lineLengths: [1], data: { version: 3 } };
  writeFileSync(
    join(dir, "a.json"),
    v8Record(
      [
        url("skills/x/a.mjs"),
        url("scripts/y.ts"),
        url("skillsX/b.mjs"),
        url("skills/node_modules/c.mjs"),
        url("other/d.mjs"),
        "node:internal/main",
        "",
        42,
      ],
      { [url("scripts/y.ts")]: map, [url("other/d.mjs")]: map },
    ),
  );
  writeFileSync(join(dir, "b.json"), v8Record([url("other/e.mjs"), "node:fs"]));
  keepProjectCoverage(dir, root, ["scripts/", "skills/"]);
  expect(readdirSync(dir)).toEqual(["a.json"]);
  const kept = parseJsonAs<{ result: { url: string }[]; "source-map-cache": unknown }>(
    readFileSync(join(dir, "a.json"), "utf8"),
  );
  expect(kept.result.map((r) => r.url)).toEqual([url("skills/x/a.mjs"), url("scripts/y.ts")]);
  expect(kept["source-map-cache"]).toEqual({ [url("scripts/y.ts")]: map });
});

test.each([
  ["JSON でない", "{"],
  ["result が配列でない", JSON.stringify({ result: {} })],
  ["result が無い", JSON.stringify({})],
])(
  "keepProjectCoverage: 読めないファイル（%s）は、c8 と同じく飛ばして消し、件数を出す",
  (_, text) => {
    const root = makeTempDir("run-coverage-v8-bad-");
    const dir = join(root, "v8");
    mkdirSync(dir);
    writeFileSync(join(dir, "a.json"), v8Record([pathToFileURL(join(root, "skills/a.mjs")).href]));
    writeFileSync(join(dir, "b.json"), text);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    keepProjectCoverage(dir, root, ["skills/"]);
    expect(readdirSync(dir)).toEqual(["a.json"]);
    expect(error.mock.calls).toEqual([
      ["run-coverage: 読めない V8 の記録 1 件を飛ばした（c8 のレポートも使わない）"],
    ]);
  },
);

test("keepProjectCoverage: 記録を読めなければ（ディレクトリが置かれている）、ディレクトリごと消す", () => {
  const root = makeTempDir("run-coverage-v8-io-");
  const dir = join(root, "v8");
  mkdirSync(join(dir, "sub"), { recursive: true });
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  keepProjectCoverage(dir, root, ["skills/"]);
  expect(existsSync(dir)).toBe(false);
  expect(error.mock.calls[0]?.[0]).toMatch(/V8 の記録を絞れないので消す/);
});

test("keepProjectCoverage: 記録のディレクトリが無ければ何もしない", () => {
  const root = makeTempDir("run-coverage-v8-none-");
  expect(() => keepProjectCoverage(join(root, "v8"), root, ["skills/"])).not.toThrow();
});
