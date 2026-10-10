import { afterAll, describe, expect, test } from "vitest";
import { spawn } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { makeSharedTempDir } from "../lib/test-tmpdir.js";

// `check-mutation-proof.js` は「変異が当たったこと」と「狙ったテストが落ちたこと」の両方で
// 判定する。**当たらなかった変異を成功として扱わない**のがこのチェックの主目的なので、
// わざと当たらない変異・生き残る変異・宣言外まで落とす変異を入れて、
// それぞれが FAIL として報告されることを実測する（Issue #420 の受け入れ条件）。
//
// **本物の vitest を通すのは end-to-end の 2 本だけにする**（Issue #442・#588）。
// このファイルは、ランナー自身のミューテーションテストで、変異 1 件ごとに丸ごと実行される。
// テストごとに runner → vitest を起動すると、1 変異に 40 秒かかった。
// ロック・復元・宣言の検証・判定の分岐は、決まった JSON レポートを返すスタブ（`STUB_COMMAND`）で足りる。
// 本物を通す 2 本は、「fixture への変異 → vitest の結果の読み取り」と「選択 → 測定」のつながりを、実行して確かめる。対象は次の 2 本である。
//   - 本物の vitest でも … PASS（子の掃引で使用中の fixture が消えない）
//   - 対象ファイルが変わった宣言だけを選ぶ
//
// **テストは `describe.concurrent` で並べて実行する**（Issue #588）。どのテストも子プロセスの終了を待つだけなので、
// 並べた分だけ 1 回の実行が縮み、変異の数だけ反映される。そのため、テストの間で状態を共有しない。
// ランナーのロックと復元情報は起動ごとに別のパスにし（`runnerEnv`）、fixture はテストごとに別のディレクトリに作る。
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RUNNER = "scripts/mutation/check-mutation-proof.js";

// fixture は `scripts/` 配下に置く。vitest の include（`scripts/**/*.test.js`）に
// 入っていないと、runner が起動した vitest が「テストが 1 件も実行されなかった」になり、
// チェックの対象（変異の判定）ではなく置き場所を測ってしまう。
const FIXTURE_TARGET = `# fixture
check_prefix() {
  if [ -z "$X" ]; then
    return 1
  fi
}
limit=100
`;

const FIXTURE_TEST = `import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const target = () => readFileSync(join(here, "target.sh"), "utf8");

test("guard", () => {
  expect(target()).toContain('if [ -z "$X" ]; then');
});

test("limit", () => {
  expect(target()).toContain("limit=100");
});
`;

const GUARD = `  if [ -z "$X" ]; then
    return 1
  fi
`;

// スタブが読む「テストファイル」。各テストは target に `contains` が含まれていれば passed
// （`FIXTURE_TEST` の 2 本と同じ判定）。
const STUB_TESTS = [
  { name: "guard", contains: 'if [ -z "$X" ]; then' },
  { name: "limit", contains: "limit=100" },
];

// テストを並べて実行する（`describe.concurrent`）ので、fixture は各テストの終わりではなくファイルの終わりに消す。
// 共有の `afterEach` は、並んで実行中の他のテストの fixture まで消す。
const dirs = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const lockDir = makeSharedTempDir("mutation-proof-lock-");

// vitest の代わりに起動されるスタブ（`MUTATION_PROOF_TEST_COMMAND`）。
// 引数は vitest と同じ `run <testFile> --reporter=json --outputFile=<path>` を受ける。
// 結果は**実物の JSON reporter と同じ単位**で書く。
// 単位は `testResults[].assertionResults[]` の `fullName` / `status` / `title` / `ancestorTitles` / `failureMessages` である。
// 形は、fixture を本物の vitest 4 で実行した出力から作った。
const STUB_COMMAND = join(lockDir, "stub-vitest.js");

// 存在しえない pid（Linux の pid_max の上限より大きい）。中断で残った一時ファイルの名前に使う。
const DEAD_PID = 2147483646;
writeFileSync(
  STUB_COMMAND,
  `#!${process.execPath}
const { readFileSync, unlinkSync, writeFileSync } = require("node:fs");
const { dirname, join, resolve } = require("node:path");
const args = process.argv.slice(2);
const testFile = resolve(args[1]);
const out = args.find((a) => a.startsWith("--outputFile=")).slice("--outputFile=".length);
const def = JSON.parse(readFileSync(testFile, "utf8"));
const content = readFileSync(join(dirname(testFile), def.target), "utf8");
// 所要時間の差を作る（\`sleepMs\` を持つ fixture だけ。宣言ごとの時間の並びを確かめるため）。
if (def.sleepMs) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, def.sleepMs);
// 実行中に対象を外から編集する状態を作る（\`editDuringRun\` を持つ fixture だけ）。
const editing = Boolean(def.editDuringRun && content !== def.editDuringRun.unless);
if (editing) {
  const targetPath = join(dirname(testFile), def.target);
  // restore: 元の内容（unless）に戻す / remove: 消す / それ以外: 末尾に追記する。
  if (def.editDuringRun.restore) writeFileSync(targetPath, def.editDuringRun.unless);
  else if (def.editDuringRun.remove) unlinkSync(targetPath);
  else if (def.editDuringRun.append) writeFileSync(targetPath, content + def.editDuringRun.append);
}
const assertionResults = def.tests.map((t) => {
  const ok = content.includes(t.contains);
  return {
    ancestorTitles: [],
    fullName: t.name,
    status: ok ? "passed" : "failed",
    title: t.name,
    failureMessages: ok ? [] : ["expected target to contain " + JSON.stringify(t.contains)],
  };
});
// 編集した run でだけテスト名を重複させ、ランナーを die（finally を通らない終わり方）させる。
if (editing && def.editDuringRun.duplicate) assertionResults.push({ ...assertionResults[0] });
const failed = assertionResults.filter((a) => a.status === "failed").length;
writeFileSync(
  out,
  JSON.stringify({
    numTotalTests: assertionResults.length,
    numFailedTests: failed,
    success: failed === 0,
    // 編集した run でだけ反復できない testResults を返し、ランナーの読み取りに例外を投げさせる。
    testResults:
      editing && def.editDuringRun.badReport
        ? 5
        : [{ name: testFile, status: failed ? "failed" : "passed", assertionResults }],
  }),
);
process.exit(failed ? 1 : 0);
`,
);
chmodSync(STUB_COMMAND, 0o755);

// 本物の vitest を通す run に渡す env（スタブの注入を外す）。
const REAL = { MUTATION_PROOF_TEST_COMMAND: undefined };

/**
 * fixture 一式を `scripts/` 配下の使い捨てディレクトリに作る。
 * デフォルトはスタブ用（`fixture.stub.json`）。`real: true` なら、本物の vitest が実行する `fixture.test.js` を置く。
 */
function makeFixture({ real = false, stubTests = STUB_TESTS, sleepMs } = {}) {
  const dir = mkdtempSync(join(repoRoot, "scripts", "mutation-proof-fixture-")); // tmpdir-ok: scripts/ 配下・afterEach で消す
  dirs.push(dir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "target.sh"), FIXTURE_TARGET);
  const testName = real ? "fixture.test.js" : "fixture.stub.json";
  writeFileSync(
    join(dir, testName),
    real ? FIXTURE_TEST : JSON.stringify({ target: "target.sh", tests: stubTests, sleepMs }),
  );
  return {
    dir,
    target: join(dir, "target.sh"),
    spec(mutations, overrides = {}) {
      const path = join(dir, "case.mutations.json");
      writeFileSync(
        path,
        JSON.stringify({
          test_file: relative(repoRoot, join(dir, testName)),
          mutations,
          ...overrides,
        }),
      );
      return path;
    },
  };
}

// 起動ごとに別のロックにする番号。
let runSeq = 0;

function runnerEnv(env) {
  const merged = {
    ...process.env,
    // ロックは使い捨てのパスにする（デフォルトのパスを使うと、手元で実行中の本番の実行と取り合う）。
    // 起動ごとに分ける。並んで実行中のテストとロックを取り合わず、復元情報（`<ロック>.recovery.json`）も共有しない。
    // 共有すると、変異させたランナーが残した復元情報を別のテストが読み、変異と関係のないテストが実行の順序しだいで落ちる。
    MUTATION_PROOF_LOCK: join(lockDir, `run-${++runSeq}.lock`),
    // デフォルトはスタブ。本物の vitest を通すテストは `REAL` で外す。
    MUTATION_PROOF_TEST_COMMAND: STUB_COMMAND,
    ...env,
  };
  // `undefined` を渡したキーは「継承しない」の意味にする（ambient な値を測定に混ぜない）。
  for (const [key, value] of Object.entries(merged)) {
    if (value === undefined) delete merged[key];
  }
  return merged;
}

/**
 * node を起動して終了を待つ。テストを並べて実行するので、`spawnSync` でイベントループを止めない。
 * 返す形は `spawnSync` の結果の使う部分（`pid`・`status`・`stdout`・`stderr`）と、出力をつないだ `out` である。
 */
function runNode(args, options) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (status) =>
      resolvePromise({ pid: child.pid, status, stdout, stderr, out: `${stdout}${stderr}` }),
    );
  });
}

function runRunner(...args) {
  let env = {};
  if (args.length && typeof args.at(-1) === "object") env = args.pop();
  return runNode([RUNNER, ...args], { cwd: repoRoot, env: runnerEnv(env) });
}

function mutation(over = {}) {
  return {
    id: "G",
    why: "ガードを外す",
    file: "<set by caller>",
    find: GUARD,
    replace: "",
    expect_failing: ["guard"],
    ...over,
  };
}

describe.concurrent("変異の判定", () => {
  test("当たって狙ったテストだけが落ちる変異は PASS（検出されることの確認）", async () => {
    const fx = makeFixture();
    const spec = fx.spec([mutation({ file: relative(repoRoot, fx.target) })]);
    const res = await runRunner(spec);
    expect(res.out).toContain("PASS G");
    expect(res.status, res.out).toBe(0);
    // スタブを使ったことを必ず出力する（注入に気づかないまま測るのを防ぐ）。
    expect(res.out).toContain("テスト用の注入");
    // 変異は必ず戻す（戻せないと以降の run が別の版を測る）。
    expect(readFileSync(fx.target, "utf8")).toBe(FIXTURE_TARGET);
  });

  // **当たらない変異は「偽の生存」を作る。** 置換がスキップされたのに全テストが緑になり、
  // 「変異しても落ちなかった」ではなく「そもそも変異していない」状態を実証と読みかける。
  test("置換が 1 件も当たらない変異は FAIL（成功として扱わない）", async () => {
    const fx = makeFixture();
    const spec = fx.spec([
      mutation({ file: relative(repoRoot, fx.target), find: "この文字列はファイルに無い" }),
    ]);
    const res = await runRunner(spec);
    expect(res.status, res.out).toBe(1);
    expect(res.out).toContain("FAIL G");
    expect(res.out).toContain("置換が当たらない");
    expect(res.out).toContain("出現数が 0 件");
  });

  test("宣言した出現数と食い違う変異は FAIL", async () => {
    const fx = makeFixture();
    const spec = fx.spec([mutation({ file: relative(repoRoot, fx.target), occurrences: 2 })]);
    const res = await runRunner(spec);
    expect(res.status, res.out).toBe(1);
    expect(res.out).toContain("出現数が 1 件（宣言は 2 件）");
  });

  test("当たったのに狙ったテストが落ちない変異は FAIL（生存）", async () => {
    const fx = makeFixture();
    const spec = fx.spec([
      mutation({
        file: relative(repoRoot, fx.target),
        why: "コメントだけ変える（どのテストも見ていない）",
        find: "# fixture",
        replace: "# FIXTURE",
      }),
    ]);
    const res = await runRunner(spec);
    expect(res.status, res.out).toBe(1);
    expect(res.out).toContain("落ちなかった: guard");
    expect(readFileSync(fx.target, "utf8")).toBe(FIXTURE_TARGET);
  });

  test("宣言外のテストまで落ちる変異は FAIL（帰属のずれ）", async () => {
    const fx = makeFixture();
    const spec = fx.spec([
      mutation({ file: relative(repoRoot, fx.target), expect_failing: ["limit"] }),
    ]);
    const res = await runRunner(spec);
    expect(res.status, res.out).toBe(1);
    expect(res.out).toContain("落ちなかった: limit");
    expect(res.out).toContain("宣言外で落ちた: guard");
  });
});

// 実リポジトリを読むテスト（名前に「実リポジトリ」を含む）が検出するかは、その時点の文書の中身で決まる。
// 合成した入力のテスト（guard）と同じ変異で落ちても、通っても、判定に数えない。
// このブロックのテスト名には、その語を入れない。入れると、ランナー自身のミューテーションテストでこのテストが数えられない。
describe.concurrent("文書の中身で結果が変わるテストの扱い", () => {
  const REAL_REPO = "合成と同じ: 実リポジトリの文書にガードがある";

  test.each([
    ["落ちる", GUARD],
    ["落ちない", "limit=100"],
  ])("そのテストが変異で%s場合も、宣言外として数えず PASS", async (_label, contains) => {
    const fx = makeFixture({ stubTests: [...STUB_TESTS, { name: REAL_REPO, contains }] });
    const spec = fx.spec([mutation({ file: relative(repoRoot, fx.target) })]);
    const res = await runRunner(spec);
    expect(res.out).not.toContain("宣言外で落ちた");
    expect(res.out).toContain("PASS G");
    expect(res.status, res.out).toBe(0);
    // 数えなかった失敗は、名前を出力して見えるようにする。
    const reported = res.out.includes(`数えなかった（実リポジトリを読む）: ${REAL_REPO}`);
    expect(reported).toBe(contains === GUARD);
  });

  test("expect_failing にそのテストを書いたら exit 2", async () => {
    const fx = makeFixture({ stubTests: [...STUB_TESTS, { name: REAL_REPO, contains: GUARD }] });
    const spec = fx.spec([
      mutation({ file: relative(repoRoot, fx.target), expect_failing: ["guard", REAL_REPO] }),
    ]);
    const res = await runRunner(spec);
    expect(res.status, res.out).toBe(2);
    expect(res.out).toContain("実リポジトリを読むテストがある");
    expect(res.out).toContain(REAL_REPO);
  });
});

describe.concurrent("宣言と前提の検証（実行する前に落とす）", () => {
  // テストをリネームすると、`expect_failing` は決して失敗しない名前を指す。
  // 変異が機能しなくなったのではなく、**チェックが何も見ていない**ので、実行する前に落とす。
  test("実在しないテスト名を宣言したら exit 2", async () => {
    const fx = makeFixture();
    const spec = fx.spec([
      mutation({ file: relative(repoRoot, fx.target), expect_failing: ["存在しないテスト"] }),
    ]);
    const res = await runRunner(spec);
    expect(res.status, res.out).toBe(2);
    expect(res.out).toContain("実在しないテスト名");
  });

  // 基準が赤いまま変異を当てると、落ちた原因を変異に帰属できない。
  test("基準 run が緑でなければ exit 2", async () => {
    const fx = makeFixture({
      stubTests: [STUB_TESTS[0], { name: "limit", contains: "このファイルに無い文字列" }],
    });
    const spec = fx.spec([mutation({ file: relative(repoRoot, fx.target) })]);
    const res = await runRunner(spec);
    expect(res.status, res.out).toBe(2);
    expect(res.out).toContain("基準 run が緑でない");
  });

  test.each([
    [{ find: GUARD, replace: GUARD }, "find と replace が同じ"],
    [{ expect_failing: [] }, "expect_failing が空"],
    [{ occurrences: 0 }, "occurrences が 1 以上の整数でない"],
    [{ file: "scripts/この-ファイルは-無い.sh" }, "file が実在しない"],
  ])("形の違う宣言は実行する前に exit 2: %o", async (over, message) => {
    const fx = makeFixture();
    const spec = fx.spec([mutation({ file: relative(repoRoot, fx.target), ...over })]);
    const res = await runRunner(spec);
    expect(res.status, res.out).toBe(2);
    expect(res.out).toContain(message);
  });

  test.each(["null", "[]", '"文字列"'])(
    "宣言が %s なら exit 2（stack trace にしない）",
    async (json) => {
      const fx = makeFixture();
      const spec = join(fx.dir, "broken.mutations.json");
      writeFileSync(spec, json);
      const res = await runRunner(spec);
      expect(res.status, res.out).toBe(2);
      expect(res.out).toContain("JSON オブジェクトでない");
      expect(res.out).not.toContain("TypeError");
    },
  );

  // 名前で合否を判定する設計なので、名前の一意性が前提。重複したら前提が破れたことを出す。
  test("テスト名が重複していたら exit 2", async () => {
    const fx = makeFixture({
      stubTests: [...STUB_TESTS, { name: "guard", contains: "# fixture" }],
    });
    const spec = fx.spec([mutation({ file: relative(repoRoot, fx.target) })]);
    const res = await runRunner(spec);
    expect(res.status, res.out).toBe(2);
    expect(res.out).toContain("テスト名が重複している");
    expect(res.out).toContain("guard");
  });

  test("mutations が空なら exit 2（0 件を成功として扱わない）", async () => {
    const fx = makeFixture();
    const spec = fx.spec([]);
    const res = await runRunner(spec);
    expect(res.status, res.out).toBe(2);
    expect(res.out).toContain("mutations が空");
  });

  // **この検査は作業ツリーを書き換えて戻す。** 並行実行は互いに変異中のファイルを読ませ、
  // 無関係なテストを赤くする（実測で踏んだ）。単一実行をロックで担保する。
  test("別の実行が変異を当てている間は落ちる", async () => {
    const fx = makeFixture();
    const spec = fx.spec([mutation({ file: relative(repoRoot, fx.target) })]);
    const lock = join(lockDir, "live.lock");
    // 生きている pid（このテストプロセス自身）を書く。
    writeFileSync(lock, `${process.pid}\n`);
    const res = await runRunner(spec, { MUTATION_PROOF_LOCK: lock });
    expect(res.status, res.out).toBe(2);
    expect(res.out).toContain("変異を当てている最中");
    // 生きているロックは奪わない。
    expect(readFileSync(lock, "utf8").trim()).toBe(String(process.pid));
  });

  test("死んだプロセスのロックは奪って続け、終了時に外す", async () => {
    const fx = makeFixture();
    const spec = fx.spec([mutation({ file: relative(repoRoot, fx.target) })]);
    const lock = join(lockDir, "stale.lock");
    // 実在しない pid（残骸）。奪えないと、以降このチェックは二度と実行されない。
    writeFileSync(lock, "2147483646\n");
    const res = await runRunner(spec, { MUTATION_PROOF_LOCK: lock });
    expect(res.status, res.out).toBe(0);
    expect(res.out).toContain("PASS G");
    expect(existsSync(lock), "終了時にロックを外していない").toBe(false);
  });

  // ロックの読み取りも失敗しうる（EEXIST を受けた直後に持ち主が unlink する窓）。
  // 読めないロックを残骸として扱わないと、一過性の競合が未処理例外で exit 1 になり、
  // 「実証できない変異がある」（この検査の exit 1 の意味）と区別できなくなる。
  test("pid を読めないロックは残骸として奪う", async () => {
    const fx = makeFixture();
    const spec = fx.spec([mutation({ file: relative(repoRoot, fx.target) })]);
    const lock = join(lockDir, "empty.lock");
    writeFileSync(lock, "");
    const res = await runRunner(spec, { MUTATION_PROOF_LOCK: lock });
    expect(res.status, res.out).toBe(0);
    expect(res.out).toContain("PASS G");
    expect(existsSync(lock), "終了時にロックを外していない").toBe(false);
  });

  test("ロックの読み取りが ENOENT 以外で失敗したら exit 2（stack trace にしない）", async () => {
    const fx = makeFixture();
    const spec = fx.spec([mutation({ file: relative(repoRoot, fx.target) })]);
    // ディレクトリをロックのパスに置くと open は EEXIST、read は EISDIR になる。
    const lock = join(lockDir, "dir.lock");
    mkdirSync(lock, { recursive: true });
    const res = await runRunner(spec, { MUTATION_PROOF_LOCK: lock });
    expect(res.status, res.out).toBe(2);
    expect(res.out).toContain("を読めない");
    expect(res.out).not.toContain("Error: EISDIR");
  });

  // 起動できなかったのは「実証できない変異がある」（exit 1）ではなく前提の誤り（exit 2）。
  test("テストを起動できなければ exit 2（理由を捨てない）", async () => {
    const fx = makeFixture();
    const spec = fx.spec([mutation({ file: relative(repoRoot, fx.target) })]);
    const res = await runRunner(spec, {
      MUTATION_PROOF_TEST_COMMAND: join(lockDir, "no-such-command"),
    });
    expect(res.status, res.out).toBe(2);
    expect(res.out).toContain("テストを起動できない");
    expect(res.out).toContain("ENOENT");
    // 変異を当てたファイルは戻っていること（起動できなくても復元する）。
    expect(readFileSync(fx.target, "utf8")).toBe(FIXTURE_TARGET);
  });

  // 空の注入を「未指定」として扱うと、スタブのつもりで本物の vitest を測る。
  test("MUTATION_PROOF_TEST_COMMAND が空なら exit 2", async () => {
    const fx = makeFixture();
    const spec = fx.spec([mutation({ file: relative(repoRoot, fx.target) })]);
    const res = await runRunner(spec, { MUTATION_PROOF_TEST_COMMAND: "" });
    expect(res.status, res.out).toBe(2);
    expect(res.out).toContain("MUTATION_PROOF_TEST_COMMAND が空");
  });

  // vitest は `node_modules` からモジュール解決で求める。解決できない（`pnpm install` 前・リポジトリ外）
  // のは前提の誤り。**ランナーを 1 ファイルだけリポジトリ外へコピーして**解決を失敗させる
  // （ランナーは自分の位置から repoRoot を決めるので、コピー先には `node_modules` が無い）。
  test("vitest を解決できなければ exit 2", async () => {
    // `makeTempDir` は後片付けを共有の `onTestFinished` に登録するが、並べて実行するテストではそれを使えない。
    // リポジトリの外にある共有の一時ディレクトリの下に作り、ファイルの終わりに消す。
    const root = mkdtempSync(join(lockDir, "noroot-")); // tmpdir-ok: lockDir（makeSharedTempDir）の下・afterAll で消す
    mkdirSync(join(root, "scripts", "mutation"), { recursive: true });
    copyFileSync(join(repoRoot, RUNNER), join(root, RUNNER));
    writeFileSync(join(root, "scripts", "target.sh"), FIXTURE_TARGET);
    writeFileSync(
      join(root, "scripts", "fixture.stub.json"),
      JSON.stringify({ target: "target.sh", tests: STUB_TESTS }),
    );
    const spec = join(root, "scripts", "case.mutations.json");
    writeFileSync(
      spec,
      JSON.stringify({
        test_file: "scripts/fixture.stub.json",
        mutations: [mutation({ file: "scripts/target.sh" })],
      }),
    );
    const { status, out } = await runNode([join(root, RUNNER), spec], {
      cwd: root,
      env: runnerEnv({ ...REAL, NODE_PATH: undefined, MUTATION_PROOF_LOCK: join(root, "lock") }),
    });
    expect(status, out).toBe(2);
    expect(out).toContain("vitest を解決できない");
  });

  // signal handler は同期の `main()` では dispatch されない（登録すると `kill` も機能しなくなる）。
  // 中断で変異が残る可能性は**次回起動の復元**で受ける、という取り決めを固定する。
  test("前回の中断で残った変異を次回起動で戻す", async () => {
    const fx = makeFixture();
    const spec = fx.spec([mutation({ file: relative(repoRoot, fx.target) })]);
    const lock = join(lockDir, "recover.lock");
    // 中断された run の状態を作る: 復元情報が残っていて、対象は変異したまま。
    const mutated = FIXTURE_TARGET.replace(GUARD, "");
    writeFileSync(
      `${lock}.recovery.json`,
      JSON.stringify({ file: fx.target, before: FIXTURE_TARGET, after: mutated }),
    );
    writeFileSync(fx.target, mutated);

    const res = await runRunner(spec, { MUTATION_PROOF_LOCK: lock });
    expect(res.status, res.out).toBe(0);
    expect(res.out).toContain("前回の中断で残っていた変異を戻した");
    // 戻したうえで、その run の基準・変異の判定まで通っていること。
    expect(res.out).toContain("PASS G");
    expect(readFileSync(fx.target, "utf8")).toBe(FIXTURE_TARGET);
    expect(existsSync(`${lock}.recovery.json`), "復元情報を消していない").toBe(false);
  });

  // 変異後の内容と一致したときだけ戻す。人が直してさらに編集した状態を上書きしない。
  test("復元情報と作業ツリーが食い違えば自動で戻さず exit 2", async () => {
    const fx = makeFixture();
    const spec = fx.spec([mutation({ file: relative(repoRoot, fx.target) })]);
    const lock = join(lockDir, "conflict.lock");
    writeFileSync(
      `${lock}.recovery.json`,
      JSON.stringify({
        file: fx.target,
        before: FIXTURE_TARGET,
        after: FIXTURE_TARGET.replace(GUARD, ""),
      }),
    );
    // 中断後に人が直してさらに編集した状態（before でも after でもない）。
    const edited = `${FIXTURE_TARGET}# 人が足した行\n`;
    writeFileSync(fx.target, edited);
    const res = await runRunner(spec, { MUTATION_PROOF_LOCK: lock });
    expect(res.status, res.out).toBe(2);
    expect(res.out).toContain("復元情報と作業ツリーが食い違う");
    // **編集を消していないこと**（この検査の主目的）。
    expect(readFileSync(fx.target, "utf8")).toBe(edited);
    expect(existsSync(`${lock}.recovery.json`), "記録を消してしまった").toBe(true);
  });

  // 実行中に同じファイルを編集されたら、変異前の内容で上書きしてその編集を消さない。
  test("実行中に対象が変異の外から書き換えられたら上書きせず exit 2", async () => {
    const fx = makeFixture();
    // 基準 run（変異前の内容）では編集せず、変異を当てた run でだけ追記する。
    writeFileSync(
      join(fx.dir, "fixture.stub.json"),
      JSON.stringify({
        target: "target.sh",
        tests: STUB_TESTS,
        editDuringRun: { unless: FIXTURE_TARGET, append: "# 実行中に足した行\n" },
      }),
    );
    const spec = fx.spec([mutation({ file: relative(repoRoot, fx.target) })]);
    const lock = join(lockDir, "edited-during-run.lock");
    const res = await runRunner(spec, { MUTATION_PROOF_LOCK: lock });
    expect(res.status, res.out).toBe(2);
    expect(res.out).toContain("変異の外から書き換えられた");
    // **編集を消していないこと**（この検査の主目的）。
    expect(readFileSync(fx.target, "utf8")).toBe(
      `${FIXTURE_TARGET.replace(GUARD, "")}# 実行中に足した行\n`,
    );
    expect(existsSync(`${lock}.recovery.json`), "記録を消してしまった").toBe(true);
    rmSync(`${lock}.recovery.json`, { force: true });
  });

  // finally を通らない終わり方（die → exit ハンドラ）でも、照合せずに上書きしない。
  test("実行中の編集の後に die しても、exit ハンドラが編集を上書きしない", async () => {
    const fx = makeFixture();
    writeFileSync(
      join(fx.dir, "fixture.stub.json"),
      JSON.stringify({
        target: "target.sh",
        tests: STUB_TESTS,
        editDuringRun: { unless: FIXTURE_TARGET, append: "# 実行中に足した行\n", duplicate: true },
      }),
    );
    const spec = fx.spec([mutation({ file: relative(repoRoot, fx.target) })]);
    const lock = join(lockDir, "edited-then-die.lock");
    const res = await runRunner(spec, { MUTATION_PROOF_LOCK: lock });
    expect(res.status, res.out).toBe(2);
    expect(res.out).toContain("テスト名が重複している");
    expect(res.out).toContain("変異の外から書き換えられた");
    expect(readFileSync(fx.target, "utf8")).toBe(
      `${FIXTURE_TARGET.replace(GUARD, "")}# 実行中に足した行\n`,
    );
    expect(existsSync(`${lock}.recovery.json`), "記録を消してしまった").toBe(true);
    rmSync(`${lock}.recovery.json`, { force: true });
  });

  // 外からの編集で止めるときも、テストの実行中に投げられた元の例外を隠さない。
  test("実行中の編集の後に例外が投げられても、元の例外を出力に残す", async () => {
    const fx = makeFixture();
    writeFileSync(
      join(fx.dir, "fixture.stub.json"),
      JSON.stringify({
        target: "target.sh",
        tests: STUB_TESTS,
        editDuringRun: { unless: FIXTURE_TARGET, append: "# 実行中に足した行\n", badReport: true },
      }),
    );
    const spec = fx.spec([mutation({ file: relative(repoRoot, fx.target) })]);
    const lock = join(lockDir, "edited-then-throw.lock");
    const res = await runRunner(spec, { MUTATION_PROOF_LOCK: lock });
    expect(res.status, res.out).toBe(2);
    expect(res.out).toContain("変異の外から書き換えられた");
    expect(res.out).toContain("元の例外: TypeError");
    expect(readFileSync(fx.target, "utf8")).toBe(
      `${FIXTURE_TARGET.replace(GUARD, "")}# 実行中に足した行\n`,
    );
    rmSync(`${lock}.recovery.json`, { force: true });
  });

  /** 変異を当てた run でだけ対象を触るスタブの fixture（editDuringRun に渡す内容を追加で指定する）。 */
  function editingFixture(edit) {
    const fx = makeFixture();
    writeFileSync(
      join(fx.dir, "fixture.stub.json"),
      JSON.stringify({
        target: "target.sh",
        tests: STUB_TESTS,
        editDuringRun: { unless: FIXTURE_TARGET, ...edit },
      }),
    );
    return fx;
  }

  // 元の内容に戻されていても、テストは変異を最後まで測れていないので結果を出さずに止める。
  test("実行中に対象が元の内容へ戻されたら、結果を出さずに exit 2", async () => {
    const fx = editingFixture({ restore: true });
    const spec = fx.spec([mutation({ file: relative(repoRoot, fx.target) })]);
    const lock = join(lockDir, "restored-during-run.lock");
    const res = await runRunner(spec, { MUTATION_PROOF_LOCK: lock });
    expect(res.status, res.out).toBe(2);
    expect(res.out).toContain("元の内容へ戻された");
    expect(res.out).not.toContain("PASS G");
    expect(readFileSync(fx.target, "utf8")).toBe(FIXTURE_TARGET);
    rmSync(`${lock}.recovery.json`, { force: true });
  });

  // die で終わる途中では結果を出さないので、元の内容に戻っていれば exit ハンドラは何もしない（警告も出さない）。
  test("元の内容へ戻された後に die しても、exit ハンドラは警告せず内容を変えない", async () => {
    const fx = editingFixture({ restore: true, duplicate: true });
    const spec = fx.spec([mutation({ file: relative(repoRoot, fx.target) })]);
    const lock = join(lockDir, "restored-then-die.lock");
    const res = await runRunner(spec, { MUTATION_PROOF_LOCK: lock });
    expect(res.status, res.out).toBe(2);
    expect(res.out).toContain("テスト名が重複している");
    expect(res.out).not.toContain("変異の外から書き換えられた");
    expect(readFileSync(fx.target, "utf8")).toBe(FIXTURE_TARGET);
    rmSync(`${lock}.recovery.json`, { force: true });
  });

  // 消されたファイルは作り直さない（意図した削除を戻さない。作り直すとモードや親ディレクトリも戻らない）。
  test("実行中に対象が消されたら、作り直さずに exit 2 で止め、復元情報を残す", async () => {
    const fx = editingFixture({ remove: true });
    const spec = fx.spec([mutation({ file: relative(repoRoot, fx.target) })]);
    const lock = join(lockDir, "removed-during-run.lock");
    const res = await runRunner(spec, { MUTATION_PROOF_LOCK: lock });
    expect(res.status, res.out).toBe(2);
    expect(res.out).toContain("が消された。作り直さずに止める");
    expect(res.out).not.toContain("PASS G");
    expect(existsSync(fx.target), "消された対象を作り直した").toBe(false);
    expect(existsSync(`${lock}.recovery.json`), "復元情報を消してしまった").toBe(true);
    rmSync(`${lock}.recovery.json`, { force: true });
  });

  test("中断の後に対象が消えていたら、次回の起動は作り直さずに exit 2", async () => {
    const fx = makeFixture();
    const spec = fx.spec([mutation({ file: relative(repoRoot, fx.target) })]);
    const lock = join(lockDir, "removed-after-interrupt.lock");
    writeFileSync(
      `${lock}.recovery.json`,
      JSON.stringify({
        file: fx.target,
        before: FIXTURE_TARGET,
        after: FIXTURE_TARGET.replace(GUARD, ""),
      }),
    );
    rmSync(fx.target);
    const res = await runRunner(spec, { MUTATION_PROOF_LOCK: lock });
    expect(res.status, res.out).toBe(2);
    expect(res.out).toContain("が消された。作り直さずに止める");
    expect(existsSync(fx.target), "消された対象を作り直した").toBe(false);
    expect(existsSync(`${lock}.recovery.json`), "記録を消してしまった").toBe(true);
    rmSync(`${lock}.recovery.json`, { force: true });
  });

  /**
   * 対象への書き込みを途中で失敗させる preload を置き、ランナーに渡す env を返す。
   * ランナーは対象の隣の一時ファイルに書いてから rename するので、その一時ファイルへの書き込みを数える。
   * writeAt 回目（1 回目は変異、2 回目は後始末の書き戻し）の書き込みを、途中まで書いて ENOSPC で失敗させる。
   */
  function faultEnv(fx, lock, { writeAt }) {
    const preload = join(fx.dir, "fault.cjs");
    writeFileSync(
      preload,
      `const fs = require("node:fs");
const realWrite = fs.writeFileSync;
const prefix = process.env.FAULT_TARGET + ".mutation-proof-";
const at = Number(process.env.FAULT_WRITE_AT);
let writes = 0;
fs.writeFileSync = function (path, data, ...rest) {
  if (typeof path === "string" && path.startsWith(prefix)) {
    writes += 1;
    if (writes === at) {
      realWrite.call(fs, path, String(data).slice(0, 5));
      const err = new Error("ENOSPC: no space left on device, write");
      err.code = "ENOSPC";
      throw err;
    }
  }
  return realWrite.call(fs, path, data, ...rest);
};
require("node:module").syncBuiltinESMExports();
`,
    );
    return {
      MUTATION_PROOF_LOCK: lock,
      NODE_OPTIONS: `--require ${preload}`,
      FAULT_TARGET: fx.target,
      FAULT_WRITE_AT: String(writeAt),
    };
  }

  /** ランナーが対象の隣に残した一時ファイル。 */
  const leftovers = (fx) => readdirSync(fx.dir).filter((n) => n.includes(".mutation-proof-"));

  // 書き込みが途中で失敗しても、対象は書く前の内容のままになる（一時ファイルに書いてから rename する）。
  // 途中の内容が対象に残ると、自分の書き込みの失敗を「変異の外から書き換えられた」と案内してしまう。
  // 変異の書き込みが失敗したら後始末の書き戻しは起きない（対象は元の内容のまま）ので、書き戻しの失敗は別のテストで作る。
  test("変異の書き込みが途中で失敗しても、対象を変えずに元の例外を返し、外からの編集として案内しない", async () => {
    const fx = makeFixture();
    const spec = fx.spec([mutation({ file: relative(repoRoot, fx.target) })]);
    const lock = join(lockDir, "partial-write.lock");
    const res = await runRunner(spec, faultEnv(fx, lock, { writeAt: 1 }));
    // 環境の誤りなので exit 2（exit 1 は「実証できない変異がある」の意味）。
    expect(res.status, res.out).toBe(2);
    expect(res.out).toContain("G の変異を当てられない: ENOSPC");
    expect(res.out).not.toContain("変異の外から書き換えられた");
    expect(res.out).not.toContain("mutation-proof: 実行中に");
    expect(readFileSync(fx.target, "utf8")).toBe(FIXTURE_TARGET);
    expect(leftovers(fx), "書きかけの一時ファイルを残した").toEqual([]);
    expect(existsSync(`${lock}.recovery.json`), "元の内容のままなのに復元情報を残した").toBe(false);
  });

  // die（finally を通らない終わり方）の後の exit ハンドラで書き戻しが失敗した場合も、手で戻すようには案内しない。
  test("die の後の書き戻しが途中で失敗したら、次回の起動に任せると案内し、次回の起動が戻す", async () => {
    // 対象を編集せずに、テスト名を重複させて die させる。
    const fx = editingFixture({ duplicate: true });
    const spec = fx.spec([mutation({ file: relative(repoRoot, fx.target) })]);
    const lock = join(lockDir, "exit-restore-fails.lock");
    const res = await runRunner(spec, faultEnv(fx, lock, { writeAt: 2 }));
    expect(res.status, res.out).toBe(2);
    expect(res.out).toContain("テスト名が重複している");
    expect(res.out).toContain("を後始末できない: ENOSPC");
    expect(res.out).toContain("次回の起動が復元情報");
    expect(res.out).not.toContain("手で戻す");
    expect(readFileSync(fx.target, "utf8")).toBe(FIXTURE_TARGET.replace(GUARD, ""));
    expect(existsSync(`${lock}.recovery.json`), "復元情報を消してしまった").toBe(true);

    const next = await runRunner(spec, { MUTATION_PROOF_LOCK: lock });
    expect(next.out).toContain("前回の中断で残っていた変異を戻した");
    expect(readFileSync(fx.target, "utf8")).toBe(FIXTURE_TARGET);
  });

  // 書き戻しが失敗したら、対象は自分の書いた変異のまま残る。次回の起動は、それを自分の変異として戻す。
  // 止めるときは、exit ハンドラで同じ後始末を繰り返さない。
  test("後始末の書き戻しが途中で失敗したら、変異のまま止め、次回の起動が自分の変異として戻す", async () => {
    const fx = makeFixture();
    const spec = fx.spec([mutation({ file: relative(repoRoot, fx.target) })]);
    const lock = join(lockDir, "restore-fails.lock");
    const res = await runRunner(spec, faultEnv(fx, lock, { writeAt: 2 }));
    expect(res.status, res.out).toBe(2);
    expect(res.out.split("を後始末できない: ENOSPC").length - 1, res.out).toBe(1);
    expect(res.out).not.toContain("変異の外から書き換えられた");
    expect(readFileSync(fx.target, "utf8")).toBe(FIXTURE_TARGET.replace(GUARD, ""));
    expect(leftovers(fx), "書きかけの一時ファイルを残した").toEqual([]);
    expect(existsSync(`${lock}.recovery.json`), "復元情報を消してしまった").toBe(true);

    const next = await runRunner(spec, { MUTATION_PROOF_LOCK: lock });
    expect(next.status, next.out).toBe(0);
    expect(next.out).toContain("前回の中断で残っていた変異を戻した");
    expect(next.out).not.toContain("復元情報と作業ツリーが食い違う");
    expect(readFileSync(fx.target, "utf8")).toBe(FIXTURE_TARGET);
  });

  // 変異を書く前に失敗したら照合しない（照合すると、元の失敗を「外からの編集」として報告する）。
  // 一時ファイルを作れないように、対象のディレクトリを読み取り専用にする。
  // root は読み取り専用のディレクトリにも書けるので、書き込みの失敗を作れない。
  test.skipIf(process.getuid?.() === 0)(
    "変異を書く前に失敗したら、外からの編集として報告しない",
    async () => {
      const fx = makeFixture();
      const spec = fx.spec([mutation({ file: relative(repoRoot, fx.target) })]);
      const lock = join(lockDir, "write-fails.lock");
      let res;
      chmodSync(fx.dir, 0o555);
      try {
        res = await runRunner(spec, { MUTATION_PROOF_LOCK: lock });
      } finally {
        chmodSync(fx.dir, 0o755);
      }
      expect(res.status, res.out).toBe(2);
      expect(res.out).toContain("G の変異を当てられない: EACCES");
      expect(res.out).not.toContain("変異の外から書き換えられた");
      expect(res.out).not.toContain("mutation-proof: 実行中に");
      expect(readFileSync(fx.target, "utf8")).toBe(FIXTURE_TARGET);
      rmSync(`${lock}.recovery.json`, { force: true });
    },
  );

  // rename は対象を新しいファイルに差し替えるので、直接書いていたときに保たれていたものを確かめる。
  test("対象がハードリンクを持つなら、変異させずに exit 2 で止める", async () => {
    const fx = makeFixture();
    const other = join(fx.dir, "hard.sh");
    linkSync(fx.target, other);
    const spec = fx.spec([mutation({ file: relative(repoRoot, fx.target) })]);
    const res = await runRunner(spec, { MUTATION_PROOF_LOCK: join(lockDir, "hardlink.lock") });
    expect(res.status, res.out).toBe(2);
    expect(res.out).toContain("ハードリンクを持つ");
    expect(readFileSync(fx.target, "utf8")).toBe(FIXTURE_TARGET);
    expect(statSync(fx.target).ino, "リンクが切れた").toBe(statSync(other).ino);
  });

  // 一時ファイルへの書き込みから rename までの間に SIGKILL されると、一時ファイルが作業ツリーに残る。
  // 次回の起動の書き戻しの失敗も、環境の誤りとして exit 2 にする（捕捉しないと exit 1 になる）。
  test.skipIf(process.getuid?.() === 0)(
    "前回の中断で残った変異を戻せなければ、exit 2 で止めて復元情報を残す",
    async () => {
      const fx = makeFixture();
      const spec = fx.spec([mutation({ file: relative(repoRoot, fx.target) })]);
      const lock = join(lockDir, "recover-fails.lock");
      const mutated = FIXTURE_TARGET.replace(GUARD, "");
      writeFileSync(
        `${lock}.recovery.json`,
        JSON.stringify({ file: fx.target, before: FIXTURE_TARGET, after: mutated }),
      );
      writeFileSync(fx.target, mutated);
      // 一時ファイルを消せなくても、書き戻しへ進む（掃除の失敗で書き戻しの失敗と案内しない）。
      writeFileSync(`${fx.target}.mutation-proof-${DEAD_PID}.tmp`, "x");
      let res;
      chmodSync(fx.dir, 0o555);
      try {
        res = await runRunner(spec, { MUTATION_PROOF_LOCK: lock });
      } finally {
        chmodSync(fx.dir, 0o755);
      }
      expect(res.status, res.out).toBe(2);
      expect(res.out).toContain("一時ファイルを消せない");
      expect(res.out).toContain("前回の中断で残った変異を戻せない");
      expect(res.out).toContain("EACCES");
      expect(readFileSync(fx.target, "utf8")).toBe(mutated);
      expect(existsSync(`${lock}.recovery.json`), "復元情報を消してしまった").toBe(true);
      rmSync(`${lock}.recovery.json`, { force: true });
    },
  );

  // 変異を書けなかった失敗だけを「変異を当てられない」として exit 2 にし、他の例外はスタックごと返す。
  test("変異を書いた後の例外は、変異を当てられない失敗として報告せず、スタックを残して exit 2", async () => {
    // 対象を編集せずに、反復できない testResults を返してランナーの読み取りに例外を投げさせる。
    const fx = editingFixture({ badReport: true });
    const spec = fx.spec([mutation({ file: relative(repoRoot, fx.target) })]);
    const res = await runRunner(spec, {
      MUTATION_PROOF_LOCK: join(lockDir, "after-write-throw.lock"),
    });
    // exit 1 は「実証できない変異がある」の意味なので、判定でない例外には使わない。
    expect(res.status, res.out).toBe(2);
    expect(res.out).toContain("G の測定中に予期しない例外が起きた");
    expect(res.out).not.toContain("変異を当てられない");
    expect(res.out).toContain("TypeError");
    expect(res.out).toContain("at ");
    expect(readFileSync(fx.target, "utf8")).toBe(FIXTURE_TARGET);
  });

  // 一時ファイルを探せなくても、書き戻しへ進む。探せなかったことは出力に残す。
  test.skipIf(process.getuid?.() === 0)(
    "一時ファイルを探せなくても、前回の中断で残った変異を戻し、探せなかったことを出す",
    async () => {
      const fx = makeFixture();
      const spec = fx.spec([mutation({ file: relative(repoRoot, fx.target) })]);
      const lock = join(lockDir, "stray-unreadable.lock");
      const mutated = FIXTURE_TARGET.replace(GUARD, "");
      writeFileSync(
        `${lock}.recovery.json`,
        JSON.stringify({ file: fx.target, before: FIXTURE_TARGET, after: mutated }),
      );
      writeFileSync(fx.target, mutated);
      let res;
      // 一覧だけを読めなくする（書き込みと名前での参照はできる）。
      chmodSync(fx.dir, 0o333);
      try {
        res = await runRunner(spec, { MUTATION_PROOF_LOCK: lock });
      } finally {
        chmodSync(fx.dir, 0o755);
      }
      expect(res.out).toContain("一時ファイルを探せない");
      expect(res.out).toContain("前回の中断で残っていた変異を戻した");
      expect(readFileSync(fx.target, "utf8")).toBe(FIXTURE_TARGET);
      rmSync(`${lock}.recovery.json`, { force: true });
    },
  );

  // 植え付けた復元情報が、リポジトリ外を指すリポジトリ内のシンボリックリンクを指していても、外の実体を書き換えない。
  test("復元情報の対象がリポジトリ外を指すシンボリックリンクなら、外の実体を書き換えずに exit 2", async () => {
    const fx = makeFixture();
    const spec = fx.spec([mutation({ file: relative(repoRoot, fx.target) })]);
    const lock = join(lockDir, "symlink-outside.lock");
    const outside = join(lockDir, "outside-target.txt");
    writeFileSync(outside, "変異後\n");
    const link = join(fx.dir, "outside-link.sh");
    symlinkSync(outside, link);
    // リンク先の隣の一時ファイルの形のファイルも消さない。
    const outsideStray = `${outside}.mutation-proof-${DEAD_PID}.tmp`;
    writeFileSync(outsideStray, "x");
    writeFileSync(
      `${lock}.recovery.json`,
      JSON.stringify({ file: link, before: "植え付けた内容\n", after: "変異後\n" }),
    );
    const res = await runRunner(spec, { MUTATION_PROOF_LOCK: lock });
    expect(res.status, res.out).toBe(2);
    expect(res.out).toContain("一時ファイルを探す先がリポジトリ外なので探さない");
    expect(res.out).toContain("がリポジトリ外（シンボリックリンクの先を疑う）");
    expect(readFileSync(outside, "utf8")).toBe("変異後\n");
    expect(existsSync(outsideStray), "リポジトリ外のファイルを消した").toBe(true);
    rmSync(`${lock}.recovery.json`, { force: true });
  });

  // 対象が消されていても、親のディレクトリを解決してから境界を判定する（解決しないと、外を指すディレクトリの
  // リンクの下で、リポジトリ外のファイルを消しうる）。
  test("消された対象の親がリポジトリ外を指すリンクなら、外の一時ファイルを消さない", async () => {
    const fx = makeFixture();
    const spec = fx.spec([mutation({ file: relative(repoRoot, fx.target) })]);
    const lock = join(lockDir, "symlink-dir-outside.lock");
    const outsideDir = join(lockDir, "outside-dir");
    mkdirSync(outsideDir, { recursive: true });
    const outsideStray = join(outsideDir, `gone.sh.mutation-proof-${DEAD_PID}.tmp`);
    writeFileSync(outsideStray, "x");
    const linkDir = join(fx.dir, "outside-dir-link");
    symlinkSync(outsideDir, linkDir);
    writeFileSync(
      `${lock}.recovery.json`,
      JSON.stringify({ file: join(linkDir, "gone.sh"), before: "a\n", after: "b\n" }),
    );
    const res = await runRunner(spec, { MUTATION_PROOF_LOCK: lock });
    expect(res.status, res.out).toBe(2);
    expect(res.out).toContain("一時ファイルを探す先がリポジトリ外なので探さない");
    expect(existsSync(outsideStray), "リポジトリ外のファイルを消した").toBe(true);
    rmSync(`${lock}.recovery.json`, { force: true });
  });

  // 書きかけの一時ファイルを消せなくても、元の書き込みの失敗を報告する（後始末の例外で置き換えない）。
  test("一時ファイルへの書き込みも、その後始末も失敗したら、書き込みの失敗を報告する", async () => {
    const fx = makeFixture();
    const spec = fx.spec([mutation({ file: relative(repoRoot, fx.target) })]);
    const preload = join(fx.dir, "fault-rm.cjs");
    writeFileSync(
      preload,
      `const fs = require("node:fs");
const realWrite = fs.writeFileSync;
const realRm = fs.rmSync;
const prefix = process.env.FAULT_TARGET + ".mutation-proof-";
// 書き込みが失敗した後の後始末の rmSync だけを失敗させる（書く前の残骸の削除は通す）。
let writeFailed = false;
fs.writeFileSync = function (path, ...rest) {
  if (typeof path === "string" && path.startsWith(prefix)) {
    writeFailed = true;
    const err = new Error("ENOSPC: no space left on device, write");
    err.code = "ENOSPC";
    throw err;
  }
  return realWrite.call(fs, path, ...rest);
};
fs.rmSync = function (path, ...rest) {
  if (writeFailed && typeof path === "string" && path.startsWith(prefix)) {
    const err = new Error("EBUSY: resource busy, unlink");
    err.code = "EBUSY";
    throw err;
  }
  return realRm.call(fs, path, ...rest);
};
require("node:module").syncBuiltinESMExports();
`,
    );
    const res = await runRunner(spec, {
      MUTATION_PROOF_LOCK: join(lockDir, "tmp-rm-fails.lock"),
      NODE_OPTIONS: `--require ${preload}`,
      FAULT_TARGET: fx.target,
    });
    expect(res.status, res.out).toBe(2);
    expect(res.out).toContain("G の変異を当てられない: ENOSPC");
    // 消せなかった一時ファイルは、次回の起動も消さない（照合が復元情報を消す）ので、手で消すよう出す。
    expect(res.out).toContain("一時ファイルを消せない");
    expect(readFileSync(fx.target, "utf8")).toBe(FIXTURE_TARGET);
  });

  // 一時ファイルの名前にシンボリックリンクや前の実行の残骸があっても、リンク先（リポジトリ外を含む）へ書かずに測る。
  test("一時ファイルの名前にリポジトリ外を指すシンボリックリンクがあっても、リンク先へ書かずに測る", async () => {
    const fx = makeFixture();
    const spec = fx.spec([mutation({ file: relative(repoRoot, fx.target) })]);
    const outside = join(lockDir, "tmp-link-outside.txt");
    writeFileSync(outside, "外のファイル\n");
    // ランナーのプロセスの中で、そのランナーの pid の一時ファイルの名前にリンクを置く（pid は起動するまで分からない）。
    const preload = join(fx.dir, "plant-tmp-link.cjs");
    writeFileSync(
      preload,
      `const fs = require("node:fs");
if (process.argv[1]?.endsWith("check-mutation-proof.js")) {
  fs.symlinkSync(process.env.PLANT_OUTSIDE, process.env.FAULT_TARGET + ".mutation-proof-" + process.pid + ".tmp");
}
`,
    );
    const res = await runRunner(spec, {
      MUTATION_PROOF_LOCK: join(lockDir, "tmp-link.lock"),
      NODE_OPTIONS: `--require ${preload}`,
      FAULT_TARGET: fx.target,
      PLANT_OUTSIDE: outside,
    });
    expect(res.status, res.out).toBe(0);
    expect(readFileSync(outside, "utf8")).toBe("外のファイル\n");
    // リンクそのものは消えている（同じ pid の残骸を残したまま EEXIST で止まらない）。
    const link = `${fx.target}.mutation-proof-${res.pid}.tmp`;
    expect(() => lstatSync(link), "一時ファイルの名前のリンクが残った").toThrow();
    expect(readFileSync(fx.target, "utf8")).toBe(FIXTURE_TARGET);
  });

  // 復元情報を書けないのも、変異を当てられない環境の誤りとして exit 2 にする（捕捉しないと exit 1）。
  test("復元情報を書けなければ、変異を当てずに exit 2", async () => {
    const fx = makeFixture();
    const spec = fx.spec([mutation({ file: relative(repoRoot, fx.target) })]);
    const lock = join(lockDir, "recovery-write-fails.lock");
    const preload = join(fx.dir, "fault-recovery.cjs");
    writeFileSync(
      preload,
      `const fs = require("node:fs");
const realWrite = fs.writeFileSync;
fs.writeFileSync = function (path, ...rest) {
  if (typeof path === "string" && path.endsWith(".recovery.json")) {
    const err = new Error("ENOSPC: no space left on device, write");
    err.code = "ENOSPC";
    throw err;
  }
  return realWrite.call(fs, path, ...rest);
};
require("node:module").syncBuiltinESMExports();
`,
    );
    const res = await runRunner(spec, {
      MUTATION_PROOF_LOCK: lock,
      NODE_OPTIONS: `--require ${preload}`,
    });
    expect(res.status, res.out).toBe(2);
    expect(res.out).toContain("G の変異を当てられない: ENOSPC");
    expect(readFileSync(fx.target, "utf8")).toBe(FIXTURE_TARGET);
  });

  test("前回の中断で残った一時ファイルを、次回の起動が消す", async () => {
    const fx = makeFixture();
    const spec = fx.spec([mutation({ file: relative(repoRoot, fx.target) })]);
    const lock = join(lockDir, "stray-tmp.lock");
    const mutated = FIXTURE_TARGET.replace(GUARD, "");
    writeFileSync(
      `${lock}.recovery.json`,
      JSON.stringify({ file: fx.target, before: FIXTURE_TARGET, after: mutated }),
    );
    // 書き戻しの途中で殺された状態: 対象は変異のまま、隣に書きかけの一時ファイルがある。
    writeFileSync(fx.target, mutated);
    const stray = `${fx.target}.mutation-proof-${DEAD_PID}.tmp`;
    writeFileSync(stray, FIXTURE_TARGET.slice(0, 5));
    // 名前が似ていても、形の違うファイルは消さない。
    const unrelated = `${fx.target}.mutation-proof-notes.tmp`;
    writeFileSync(unrelated, "x");
    // 名前の pid が生きているもの（別の実行が書き込み中）も消さない。
    const live = `${fx.target}.mutation-proof-${process.pid}.tmp`;
    writeFileSync(live, "x");
    const res = await runRunner(spec, { MUTATION_PROOF_LOCK: lock });
    expect(res.status, res.out).toBe(0);
    expect(res.out).toContain("前回の中断で残った一時ファイルを消した");
    expect(existsSync(stray), "一時ファイルを残した").toBe(false);
    expect(existsSync(unrelated), "形の違うファイルまで消した").toBe(true);
    expect(existsSync(live), "生きている実行の一時ファイルを消した").toBe(true);
    expect(readFileSync(fx.target, "utf8")).toBe(FIXTURE_TARGET);
  });

  test("実行ビットを持つ対象は、変異を戻した後もモードを保つ", async () => {
    const fx = makeFixture();
    chmodSync(fx.target, 0o755);
    const spec = fx.spec([mutation({ file: relative(repoRoot, fx.target) })]);
    const res = await runRunner(spec, { MUTATION_PROOF_LOCK: join(lockDir, "mode.lock") });
    expect(res.status, res.out).toBe(0);
    expect(res.out).toContain("PASS G");
    expect(statSync(fx.target).mode & 0o777).toBe(0o755);
  });

  test("対象がシンボリックリンクなら、リンクを差し替えずにリンク先を変異させて戻す", async () => {
    const fx = makeFixture();
    const link = join(fx.dir, "link.sh");
    symlinkSync("target.sh", link);
    const spec = fx.spec([mutation({ file: relative(repoRoot, link) })]);
    const res = await runRunner(spec, { MUTATION_PROOF_LOCK: join(lockDir, "symlink.lock") });
    expect(res.status, res.out).toBe(0);
    // スタブは target.sh を読むので、リンク先が変異していなければ PASS にならない。
    expect(res.out).toContain("PASS G");
    expect(lstatSync(link).isSymbolicLink(), "リンクを通常のファイルに差し替えた").toBe(true);
    expect(readFileSync(fx.target, "utf8")).toBe(FIXTURE_TARGET);
  });

  // 復元情報は他ユーザーが置けるパスに在りうる（`/tmp` を避けたが env で上書きもできる）。
  // 書き戻し先がリポジトリ外なら植え付けを疑って落とす。
  test("復元情報の書き戻し先がリポジトリ外なら exit 2", async () => {
    const fx = makeFixture();
    const spec = fx.spec([mutation({ file: relative(repoRoot, fx.target) })]);
    const lock = join(lockDir, "outside.lock");
    const outside = join(lockDir, "planted.txt");
    writeFileSync(outside, "元の内容\n");
    writeFileSync(
      `${lock}.recovery.json`,
      JSON.stringify({ file: outside, before: "植え付けた内容\n", after: "何か\n" }),
    );
    const res = await runRunner(spec, { MUTATION_PROOF_LOCK: lock });
    expect(res.status, res.out).toBe(2);
    expect(res.out).toContain("復元情報の書き戻し先がリポジトリ外");
    // 書き換えていないこと。
    expect(readFileSync(outside, "utf8")).toBe("元の内容\n");
  });

  test("復元情報が不正なら exit 2（警告なしに続けない）", async () => {
    const fx = makeFixture();
    const spec = fx.spec([mutation({ file: relative(repoRoot, fx.target) })]);
    const lock = join(lockDir, "broken-recovery.lock");
    writeFileSync(`${lock}.recovery.json`, JSON.stringify({ file: 42 }));
    const res = await runRunner(spec, { MUTATION_PROOF_LOCK: lock });
    expect(res.status, res.out).toBe(2);
    expect(res.out).toContain("復元情報が不正である");
  });

  // 差分に当たる宣言だけを測る選択。**0 件は「測るものが無い」**（全件は定期実行が測る）。
  // `MUTATION_PROOF_CHANGED_FILES` は差分の注入（git を使わずに選択だけを測るため）。
  //
  // **`--changed-since` を測るテストは、必ず `--only` で範囲を限る。**
  // 選択の判定を常に真にする変異（`CHANGED-HITS`）が入ると、`--only` が無ければ、選ばれた全宣言を測りに行く。
  // すると入れ子の runner が指数的に増える。
  // 実測では 30 分以上・21 プロセス以上に膨らみ、止めた後の作業ツリーに変異が残った。
  test("差分に当たらない宣言は飛ばし、理由を印字する", async () => {
    // スタブで起動する。選択を常に真にする変異で D が選ばれても、スタブは本物のテストファイルを読めずに基準 run で止まり、
    // 実リポジトリのファイルに変異を当てない。
    const res = await runRunner("--changed-since", "origin/main", "--only", "D", {
      MUTATION_PROOF_CHANGED_FILES: "docs/skill-development.md",
    });
    expect(res.status, res.out).toBe(0);
    expect(res.out).toContain("この差分に当たる宣言は無い");
    // 警告なしに成功にしない。注入を使ったことと、飛ばした宣言が出ていることを確かめる。
    expect(res.out).toContain("テスト用の注入");
    expect(res.out).toContain("飛ばす: scripts/skills/kaizen/tracking-issue-title.mutations.json");
  });

  test("ランナーが変わったら全宣言を測る", async () => {
    // `--only D`（tracking の宣言にだけ在る id）で 1 変異に絞り、`--shard 2/2` でその 1 件をこのシャードから外す。
    // 選択の結果を見るのに、変異を測る必要はない（測定までのつながりは、end-to-end のテストが本物の vitest で確かめる）。
    // 全宣言へ広がったことは、「飛ばす:」が出ないことと、選んだ変異の件数で判定する。
    // 測らないので、実リポジトリのファイルも変異させない。
    const res = await runRunner("--changed-since", "origin/main", "--only", "D", "--shard", "2/2", {
      MUTATION_PROOF_CHANGED_FILES: "scripts/mutation/check-mutation-proof.js",
    });
    expect(res.status, res.out).toBe(0);
    expect(res.out).toContain(
      "ランナー（scripts/mutation/check-mutation-proof.js）が変わったので全宣言を測る",
    );
    expect(res.out).not.toContain("飛ばす:");
    expect(res.out).toContain("シャード 2/2: 選んだ変異 1 件のうち 0 件を測る");
  });

  // 差分を取れないときは「変更なし」として扱わない（0 件と失敗が同じ空配列になる）。
  test("差分を取れなければ exit 2", async () => {
    const res = await runRunner("--changed-since", "no-such-ref-for-test");
    expect(res.status, res.out).toBe(2);
    expect(res.out).toContain("からの差分を取れない");
  });

  test("--changed-since と宣言ファイルの指定は併用できない", async () => {
    const fx = makeFixture();
    const spec = fx.spec([mutation({ file: relative(repoRoot, fx.target) })]);
    const res = await runRunner(spec, "--changed-since", "origin/main");
    expect(res.status, res.out).toBe(2);
    expect(res.out).toContain("併用しない");
  });

  test("--only でどの変異も選ばれなければ exit 2", async () => {
    const fx = makeFixture();
    const spec = fx.spec([mutation({ file: relative(repoRoot, fx.target) })]);
    const res = await runRunner(spec, "--only", "存在しない id");
    expect(res.status, res.out).toBe(2);
    expect(res.out).toContain("--only で 1 件も選ばれなかった");
  });

  // **`--only` は宣言をまたいで絞る。** 宣言ごとに「1 件も選ばれなかった」で落とすと、
  // 宣言が 2 件以上ある時点で `--only <id>` が常に exit 2 になる（実測で踏んだ）。
  test("--only は選ばれなかった宣言を飛ばす（宣言が複数あっても実行する）", async () => {
    const a = makeFixture();
    const b = makeFixture();
    const specA = a.spec([mutation({ id: "A", file: relative(repoRoot, a.target) })]);
    const specB = b.spec([mutation({ id: "B", file: relative(repoRoot, b.target) })]);
    const res = await runRunner(specA, specB, "--only", "B");
    expect(res.status, res.out).toBe(0);
    expect(res.out).toContain("PASS B");
    // 選ばれなかった宣言は実行せず、件数として出す（警告なしに消さない）。
    expect(res.out, "選ばれていない宣言まで実行した").not.toContain("PASS A");
    expect(res.out).toContain("1 skipped");
  });
});

// `--shard i/N` は CI の並列実行用（Issue #507）。**N 本を合わせてちょうど全件**でなければならない
// ——取りこぼしは「どのジョブも測らない変異」になり、全ジョブが緑のまま実証が抜ける。
// 全件の実行で次に縮める宣言を選べるよう、宣言ごとの所要時間を出す（Issue #588）。
// 集計の行は最後の行に保つ（バックグラウンドで実行したときの完了は、ログの最終行で判断する。`docs/tooling.md`）。
describe.concurrent("宣言ごとの時間", () => {
  const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  test("宣言ごとに時間を出し、最後に長い順の一覧を出してから集計の行で終わる", async () => {
    const a = makeFixture();
    // 後に渡す B を遅くする。並べ替えなければ、渡した順（A が先）のままになって区別できる。
    const b = makeFixture({ sleepMs: 500 });
    const specA = a.spec([
      mutation({ id: "A1", file: relative(repoRoot, a.target) }),
      mutation({
        id: "A2",
        why: "上限を変える",
        file: relative(repoRoot, a.target),
        find: "limit=100",
        replace: "limit=1",
        expect_failing: ["limit"],
      }),
    ]);
    const specB = b.spec([mutation({ id: "B1", file: relative(repoRoot, b.target) })]);
    const res = await runRunner(specA, specB);
    expect(res.status, res.out).toBe(0);
    expect(res.stdout).toMatch(/時間: \d+\.\d 秒（2 変異、基準 run を含む）/);
    expect(res.stdout).toMatch(/時間: \d+\.\d 秒（1 変異、基準 run を含む）/);
    const summary = res.stdout.split("宣言ごとの時間（長い順）:")[1] ?? "";
    const at = (spec) => summary.indexOf(relative(repoRoot, spec));
    expect(at(specB), res.stdout).toBeGreaterThanOrEqual(0);
    expect(at(specB), "長い順に並んでいない").toBeLessThan(at(specA));
    expect(summary, res.stdout).toMatch(
      new RegExp(`\\d+\\.\\d 秒  ${escapeRe(relative(repoRoot, specA))}（2 変異）`),
    );
    expect(summary, res.stdout).toMatch(
      new RegExp(`\\d+\\.\\d 秒  ${escapeRe(relative(repoRoot, specB))}（1 変異）`),
    );
    expect(res.stdout.trimEnd().split("\n").at(-1)).toBe("mutation-proof: 3 proven / 0 failed");
  });
});

describe.concurrent("--shard", () => {
  /** 宣言 2 件・変異 3 件（A1, A2 / B1）。通し番号は A1=0, A2=1, B1=2。 */
  function twoSpecs() {
    const a = makeFixture();
    const b = makeFixture();
    const specA = a.spec([
      mutation({ id: "A1", file: relative(repoRoot, a.target) }),
      mutation({
        id: "A2",
        why: "上限を変える",
        file: relative(repoRoot, a.target),
        find: "limit=100",
        replace: "limit=1",
        expect_failing: ["limit"],
      }),
    ]);
    const specB = b.spec([mutation({ id: "B1", file: relative(repoRoot, b.target) })]);
    return [specA, specB];
  }

  test("宣言をまたいだ通し番号で分け、N 本を合わせるとちょうど全件になる", async () => {
    const specs = twoSpecs();
    const first = await runRunner(...specs, "--shard", "1/2");
    expect(first.status, first.out).toBe(0);
    expect(first.out).toContain("シャード 1/2: 選んだ変異 3 件のうち 2 件を測る");
    expect(first.out).toContain("PASS A1");
    expect(first.out).toContain("PASS B1");
    expect(first.out, "他のシャードの変異まで測った").not.toContain("PASS A2");
    expect(first.out).toContain("mutation-proof: 2 proven / 0 failed");

    const second = await runRunner(...specs, "--shard", "2/2");
    expect(second.status, second.out).toBe(0);
    expect(second.out).toContain("シャード 2/2: 選んだ変異 3 件のうち 1 件を測る");
    expect(second.out).toContain("PASS A2");
    expect(second.out, "他のシャードの変異まで測った").not.toMatch(/PASS (A1|B1)/);
    expect(second.out).toContain("mutation-proof: 1 proven / 0 failed");
    // 変異を受け持たない宣言は基準 run も測らない（B はこのシャードに変異が無い）。
    expect(second.out).not.toContain(relative(repoRoot, specs[1]));
  });

  test("変異がシャード数より少なく割り当てが 0 件なら、理由を出して exit 0", async () => {
    const fx = makeFixture();
    const spec = fx.spec([mutation({ file: relative(repoRoot, fx.target) })]);
    const res = await runRunner(spec, "--shard", "2/2");
    expect(res.status, res.out).toBe(0);
    expect(res.out).toContain("このシャードに割り当てられた変異は無い（選んだ 1 件を 2 分割）");
    expect(res.out).not.toContain("PASS G");
  });

  test.each([
    ["0/2"],
    ["3/2"],
    ["1/0"],
    ["x"],
    ["1/2/3"],
    [""],
    ["9007199254740993/9007199254740992"],
  ])("--shard %s は exit 2（警告なしに 0 件のシャードにしない）", async (value) => {
    const fx = makeFixture();
    const spec = fx.spec([mutation({ file: relative(repoRoot, fx.target) })]);
    const res = await runRunner(spec, "--shard", value);
    expect(res.status, res.out).toBe(2);
    expect(res.out).toMatch(/--shard (は <i>\/<N>|の i が N を超えている|の値が大きすぎる)/);
    expect(res.out).not.toContain("PASS G");
  });
});

// **本物の vitest を通す end-to-end は、fixture を使う他のテストが終わってから実行する。**
// 子の vitest の globalSetup は、`MUTATION_PROOF_CHILD` を受け取らないと `scripts/mutation-proof-fixture-*` を消す。
// それを止める行を外す変異（`CHILD-GUARD`）で、並んで実行中の他のテストの fixture まで消え、どのテストが落ちるかが実行の順序で変わった（Issue #588）。
// `describe.concurrent` の suite は、隣の concurrent な suite とも並べて実行される（最後に置いても並んだ）。
// この suite は concurrent にせず、前の suite が終わってから始める。中の 2 本だけを `test.concurrent` で互いに並べる。
describe("本物の vitest を通す end-to-end", () => {
  // **使用中の fixture を消させない。** `scripts/lib/vitest-global-setup.ts` は、収集の前に
  // `scripts/mutation-proof-fixture-*` を消す。そこで runner が起動する子の vitest には
  // `MUTATION_PROOF_CHILD` を渡して、消す処理を止めている（渡さないと fixture ごと消えて、10 テストが落ちた）。
  // ここでは**ambient な marker を明示的に外して**測る（ハーネス自身が渡す値で成功しないように）。
  // 本物の vitest を通す end-to-end を兼ねる（fixture への変異 → vitest の JSON 結果 → 判定）。
  test.concurrent("本物の vitest でも PASS し、子の掃引で使用中の fixture が消えない", async () => {
    const fx = makeFixture({ real: true });
    const spec = fx.spec([mutation({ file: relative(repoRoot, fx.target) })]);
    const res = await runRunner(spec, { ...REAL, MUTATION_PROOF_CHILD: undefined });
    expect(res.status, res.out).toBe(0);
    expect(res.out).toContain("PASS G");
    expect(res.out, "スタブで測っている").not.toContain("テスト用の注入");
    // fixture が run の途中で消えていないこと（消えると上の run 自体が成立しない）。
    expect(existsSync(fx.target), "fixture が掃かれた").toBe(true);
    expect(readFileSync(fx.target, "utf8")).toBe(FIXTURE_TARGET);
  }, 60_000);

  // 選択から測定までを、本物の vitest で通す。測る変異は、対象をそのテストだけが読み、テストファイルが軽い宣言から選ぶ。
  // 集計スクリプトの宣言（STDEV）で測っていたときは、子の vitest の 2 回の実行で 5 秒かかった（Issue #588）。
  test.concurrent("対象ファイルが変わった宣言だけを選ぶ", async () => {
    const res = await runRunner("--changed-since", "origin/main", "--only", "WL-DUP", {
      ...REAL,
      MUTATION_PROOF_CHANGED_FILES: "scripts/gates/check-word-list.js",
      // 語の一覧のチェックの宣言だけが選ばれる差分。`--only` で 1 変異に抑える（有界化の理由は `--changed-since` のテストの前のコメント）。
    });
    expect(res.status, res.out).toBe(0);
    expect(res.out).toContain("測る: scripts/gates/check-word-list.mutations.json");
    expect(res.out).toContain("飛ばす: scripts/mutation/check-mutation-proof.mutations.json");
    expect(res.out).toContain("PASS WL-DUP");
  }, 60_000);
});
