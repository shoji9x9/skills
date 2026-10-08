import { afterEach, describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { makeSharedTempDir, makeTempDir } from "../lib/test-tmpdir.js";

// `check-mutation-proof.js` は「変異が当たったこと」と「狙ったテストが落ちたこと」の両方で
// 判定する。**当たらなかった変異を成功として扱わない**のがこのチェックの主目的なので、
// わざと当たらない変異・生き残る変異・宣言外まで落とす変異を入れて、
// それぞれが FAIL として報告されることを実測する（Issue #420 の受け入れ条件）。
//
// **本物の vitest を通すのは end-to-end の 3 本だけにする**（Issue #442）。
// このファイルは、ランナー自身のミューテーションテストで、変異 1 件ごとに丸ごと実行される。
// テストごとに runner → vitest を起動すると、1 変異に 40 秒かかった。
// ロック・復元・宣言の検証・判定の分岐は、決まった JSON レポートを返すスタブ（`STUB_COMMAND`）で足りる。
// 本物を通す 3 本は、「fixture への変異 → vitest の結果の読み取り」と「選択 → 測定」のつながりを、実行して確かめる。対象は次の 3 本である。
//   - 本物の vitest でも … PASS（子の掃引で使用中の fixture が消えない）
//   - 対象ファイルが変わった宣言だけを選ぶ / ランナーが変わったら全宣言を測る
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

let dirs = [];

const lockDir = makeSharedTempDir("mutation-proof-lock-");

// vitest の代わりに起動されるスタブ（`MUTATION_PROOF_TEST_COMMAND`）。
// 引数は vitest と同じ `run <testFile> --reporter=json --outputFile=<path>` を受ける。
// 結果は**実物の JSON reporter と同じ単位**で書く。
// 単位は `testResults[].assertionResults[]` の `fullName` / `status` / `title` / `ancestorTitles` / `failureMessages` である。
// 形は、fixture を本物の vitest 4 で実行した出力から作った。
const STUB_COMMAND = join(lockDir, "stub-vitest.js");
writeFileSync(
  STUB_COMMAND,
  `#!${process.execPath}
const { readFileSync, writeFileSync } = require("node:fs");
const { dirname, join, resolve } = require("node:path");
const args = process.argv.slice(2);
const testFile = resolve(args[1]);
const out = args.find((a) => a.startsWith("--outputFile=")).slice("--outputFile=".length);
const def = JSON.parse(readFileSync(testFile, "utf8"));
const content = readFileSync(join(dirname(testFile), def.target), "utf8");
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
const failed = assertionResults.filter((a) => a.status === "failed").length;
writeFileSync(
  out,
  JSON.stringify({
    numTotalTests: assertionResults.length,
    numFailedTests: failed,
    success: failed === 0,
    testResults: [{ name: testFile, status: failed ? "failed" : "passed", assertionResults }],
  }),
);
process.exit(failed ? 1 : 0);
`,
);
chmodSync(STUB_COMMAND, 0o755);

// 本物の vitest を通す run に渡す env（スタブの注入を外す）。
const REAL = { MUTATION_PROOF_TEST_COMMAND: undefined };

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

/**
 * fixture 一式を `scripts/` 配下の使い捨てディレクトリに作る。
 * デフォルトはスタブ用（`fixture.stub.json`）。`real: true` なら、本物の vitest が実行する `fixture.test.js` を置く。
 */
function makeFixture({ real = false, stubTests = STUB_TESTS } = {}) {
  const dir = mkdtempSync(join(repoRoot, "scripts", "mutation-proof-fixture-")); // tmpdir-ok: scripts/ 配下・afterEach で消す
  dirs.push(dir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "target.sh"), FIXTURE_TARGET);
  const testName = real ? "fixture.test.js" : "fixture.stub.json";
  writeFileSync(
    join(dir, testName),
    real ? FIXTURE_TEST : JSON.stringify({ target: "target.sh", tests: stubTests }),
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

function runnerEnv(env) {
  const merged = {
    ...process.env,
    // ロックは使い捨てのパスにする（デフォルトのパスを使うと、手元で実行中の本番の実行と取り合う）。
    MUTATION_PROOF_LOCK: join(lockDir, "default.lock"),
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

function runRunner(...args) {
  let env = {};
  if (args.length && typeof args.at(-1) === "object") env = args.pop();
  const res = spawnSync(process.execPath, [RUNNER, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: runnerEnv(env),
  });
  return { ...res, out: `${res.stdout}${res.stderr}` };
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

describe("変異の判定", () => {
  test("当たって狙ったテストだけが落ちる変異は PASS（検出されることの確認）", () => {
    const fx = makeFixture();
    const spec = fx.spec([mutation({ file: relative(repoRoot, fx.target) })]);
    const res = runRunner(spec);
    expect(res.out).toContain("PASS G");
    expect(res.status, res.out).toBe(0);
    // スタブを使ったことを必ず出力する（注入に気づかないまま測るのを防ぐ）。
    expect(res.out).toContain("テスト用の注入");
    // 変異は必ず戻す（戻せないと以降の run が別の版を測る）。
    expect(readFileSync(fx.target, "utf8")).toBe(FIXTURE_TARGET);
  });

  // **使用中の fixture を消させない。** `scripts/lib/vitest-global-setup.ts` は、収集の前に
  // `scripts/mutation-proof-fixture-*` を消す。そこで runner が起動する子の vitest には
  // `MUTATION_PROOF_CHILD` を渡して、消す処理を止めている（渡さないと fixture ごと消えて、10 テストが落ちた）。
  // ここでは**ambient な marker を明示的に外して**測る（ハーネス自身が渡す値で成功しないように）。
  // 本物の vitest を通す end-to-end を兼ねる（fixture への変異 → vitest の JSON 結果 → 判定）。
  test("本物の vitest でも PASS し、子の掃引で使用中の fixture が消えない", () => {
    const fx = makeFixture({ real: true });
    const spec = fx.spec([mutation({ file: relative(repoRoot, fx.target) })]);
    const res = runRunner(spec, { ...REAL, MUTATION_PROOF_CHILD: undefined });
    expect(res.status, res.out).toBe(0);
    expect(res.out).toContain("PASS G");
    expect(res.out, "スタブで測っている").not.toContain("テスト用の注入");
    // fixture が run の途中で消えていないこと（消えると上の run 自体が成立しない）。
    expect(existsSync(fx.target), "fixture が掃かれた").toBe(true);
    expect(readFileSync(fx.target, "utf8")).toBe(FIXTURE_TARGET);
  });

  // **当たらない変異は「偽の生存」を作る。** 置換がスキップされたのに全テストが緑になり、
  // 「変異しても落ちなかった」ではなく「そもそも変異していない」状態を実証と読みかける。
  test("置換が 1 件も当たらない変異は FAIL（成功として扱わない）", () => {
    const fx = makeFixture();
    const spec = fx.spec([
      mutation({ file: relative(repoRoot, fx.target), find: "この文字列はファイルに無い" }),
    ]);
    const res = runRunner(spec);
    expect(res.status, res.out).toBe(1);
    expect(res.out).toContain("FAIL G");
    expect(res.out).toContain("置換が当たらない");
    expect(res.out).toContain("出現数が 0 件");
  });

  test("宣言した出現数と食い違う変異は FAIL", () => {
    const fx = makeFixture();
    const spec = fx.spec([mutation({ file: relative(repoRoot, fx.target), occurrences: 2 })]);
    const res = runRunner(spec);
    expect(res.status, res.out).toBe(1);
    expect(res.out).toContain("出現数が 1 件（宣言は 2 件）");
  });

  test("当たったのに狙ったテストが落ちない変異は FAIL（生存）", () => {
    const fx = makeFixture();
    const spec = fx.spec([
      mutation({
        file: relative(repoRoot, fx.target),
        why: "コメントだけ変える（どのテストも見ていない）",
        find: "# fixture",
        replace: "# FIXTURE",
      }),
    ]);
    const res = runRunner(spec);
    expect(res.status, res.out).toBe(1);
    expect(res.out).toContain("落ちなかった: guard");
    expect(readFileSync(fx.target, "utf8")).toBe(FIXTURE_TARGET);
  });

  test("宣言外のテストまで落ちる変異は FAIL（帰属のずれ）", () => {
    const fx = makeFixture();
    const spec = fx.spec([
      mutation({ file: relative(repoRoot, fx.target), expect_failing: ["limit"] }),
    ]);
    const res = runRunner(spec);
    expect(res.status, res.out).toBe(1);
    expect(res.out).toContain("落ちなかった: limit");
    expect(res.out).toContain("宣言外で落ちた: guard");
  });
});

// 実リポジトリを読むテスト（名前に「実リポジトリ」を含む）が検出するかは、その時点の文書の中身で決まる。
// 合成した入力のテスト（guard）と同じ変異で落ちても、通っても、判定に数えない。
// このブロックのテスト名には、その語を入れない。入れると、ランナー自身のミューテーションテストでこのテストが数えられない。
describe("文書の中身で結果が変わるテストの扱い", () => {
  const REAL_REPO = "合成と同じ: 実リポジトリの文書にガードがある";

  test.each([
    ["落ちる", GUARD],
    ["落ちない", "limit=100"],
  ])("そのテストが変異で%s場合も、宣言外として数えず PASS", (_label, contains) => {
    const fx = makeFixture({ stubTests: [...STUB_TESTS, { name: REAL_REPO, contains }] });
    const spec = fx.spec([mutation({ file: relative(repoRoot, fx.target) })]);
    const res = runRunner(spec);
    expect(res.out).not.toContain("宣言外で落ちた");
    expect(res.out).toContain("PASS G");
    expect(res.status, res.out).toBe(0);
    // 数えなかった失敗は、名前を出力して見えるようにする。
    const reported = res.out.includes(`数えなかった（実リポジトリを読む）: ${REAL_REPO}`);
    expect(reported).toBe(contains === GUARD);
  });

  test("expect_failing にそのテストを書いたら exit 2", () => {
    const fx = makeFixture({ stubTests: [...STUB_TESTS, { name: REAL_REPO, contains: GUARD }] });
    const spec = fx.spec([
      mutation({ file: relative(repoRoot, fx.target), expect_failing: ["guard", REAL_REPO] }),
    ]);
    const res = runRunner(spec);
    expect(res.status, res.out).toBe(2);
    expect(res.out).toContain("実リポジトリを読むテストがある");
    expect(res.out).toContain(REAL_REPO);
  });
});

describe("宣言と前提の検証（実行する前に落とす）", () => {
  // テストをリネームすると、`expect_failing` は決して失敗しない名前を指す。
  // 変異が機能しなくなったのではなく、**チェックが何も見ていない**ので、実行する前に落とす。
  test("実在しないテスト名を宣言したら exit 2", () => {
    const fx = makeFixture();
    const spec = fx.spec([
      mutation({ file: relative(repoRoot, fx.target), expect_failing: ["存在しないテスト"] }),
    ]);
    const res = runRunner(spec);
    expect(res.status, res.out).toBe(2);
    expect(res.out).toContain("実在しないテスト名");
  });

  // 基準が赤いまま変異を当てると、落ちた原因を変異に帰属できない。
  test("基準 run が緑でなければ exit 2", () => {
    const fx = makeFixture({
      stubTests: [STUB_TESTS[0], { name: "limit", contains: "このファイルに無い文字列" }],
    });
    const spec = fx.spec([mutation({ file: relative(repoRoot, fx.target) })]);
    const res = runRunner(spec);
    expect(res.status, res.out).toBe(2);
    expect(res.out).toContain("基準 run が緑でない");
  });

  test.each([
    [{ find: GUARD, replace: GUARD }, "find と replace が同じ"],
    [{ expect_failing: [] }, "expect_failing が空"],
    [{ occurrences: 0 }, "occurrences が 1 以上の整数でない"],
    [{ file: "scripts/この-ファイルは-無い.sh" }, "file が実在しない"],
  ])("形の違う宣言は実行する前に exit 2: %o", (over, message) => {
    const fx = makeFixture();
    const spec = fx.spec([mutation({ file: relative(repoRoot, fx.target), ...over })]);
    const res = runRunner(spec);
    expect(res.status, res.out).toBe(2);
    expect(res.out).toContain(message);
  });

  test.each(["null", "[]", '"文字列"'])("宣言が %s なら exit 2（stack trace にしない）", (json) => {
    const fx = makeFixture();
    const spec = join(fx.dir, "broken.mutations.json");
    writeFileSync(spec, json);
    const res = runRunner(spec);
    expect(res.status, res.out).toBe(2);
    expect(res.out).toContain("JSON オブジェクトでない");
    expect(res.out).not.toContain("TypeError");
  });

  // 名前で合否を判定する設計なので、名前の一意性が前提。重複したら前提が破れたことを出す。
  test("テスト名が重複していたら exit 2", () => {
    const fx = makeFixture({
      stubTests: [...STUB_TESTS, { name: "guard", contains: "# fixture" }],
    });
    const spec = fx.spec([mutation({ file: relative(repoRoot, fx.target) })]);
    const res = runRunner(spec);
    expect(res.status, res.out).toBe(2);
    expect(res.out).toContain("テスト名が重複している");
    expect(res.out).toContain("guard");
  });

  test("mutations が空なら exit 2（0 件を成功として扱わない）", () => {
    const fx = makeFixture();
    const spec = fx.spec([]);
    const res = runRunner(spec);
    expect(res.status, res.out).toBe(2);
    expect(res.out).toContain("mutations が空");
  });

  // **この検査は作業ツリーを書き換えて戻す。** 並行実行は互いに変異中のファイルを読ませ、
  // 無関係なテストを赤くする（実測で踏んだ）。単一実行をロックで担保する。
  test("別の実行が変異を当てている間は落ちる", () => {
    const fx = makeFixture();
    const spec = fx.spec([mutation({ file: relative(repoRoot, fx.target) })]);
    const lock = join(lockDir, "live.lock");
    // 生きている pid（このテストプロセス自身）を書く。
    writeFileSync(lock, `${process.pid}\n`);
    const res = runRunner(spec, { MUTATION_PROOF_LOCK: lock });
    expect(res.status, res.out).toBe(2);
    expect(res.out).toContain("変異を当てている最中");
    // 生きているロックは奪わない。
    expect(readFileSync(lock, "utf8").trim()).toBe(String(process.pid));
  });

  test("死んだプロセスのロックは奪って続け、終了時に外す", () => {
    const fx = makeFixture();
    const spec = fx.spec([mutation({ file: relative(repoRoot, fx.target) })]);
    const lock = join(lockDir, "stale.lock");
    // 実在しない pid（残骸）。奪えないと、以降このチェックは二度と実行されない。
    writeFileSync(lock, "2147483646\n");
    const res = runRunner(spec, { MUTATION_PROOF_LOCK: lock });
    expect(res.status, res.out).toBe(0);
    expect(res.out).toContain("PASS G");
    expect(existsSync(lock), "終了時にロックを外していない").toBe(false);
  });

  // ロックの読み取りも失敗しうる（EEXIST を受けた直後に持ち主が unlink する窓）。
  // 読めないロックを残骸として扱わないと、一過性の競合が未処理例外で exit 1 になり、
  // 「実証できない変異がある」（この検査の exit 1 の意味）と区別できなくなる。
  test("pid を読めないロックは残骸として奪う", () => {
    const fx = makeFixture();
    const spec = fx.spec([mutation({ file: relative(repoRoot, fx.target) })]);
    const lock = join(lockDir, "empty.lock");
    writeFileSync(lock, "");
    const res = runRunner(spec, { MUTATION_PROOF_LOCK: lock });
    expect(res.status, res.out).toBe(0);
    expect(res.out).toContain("PASS G");
    expect(existsSync(lock), "終了時にロックを外していない").toBe(false);
  });

  test("ロックの読み取りが ENOENT 以外で失敗したら exit 2（stack trace にしない）", () => {
    const fx = makeFixture();
    const spec = fx.spec([mutation({ file: relative(repoRoot, fx.target) })]);
    // ディレクトリをロックのパスに置くと open は EEXIST、read は EISDIR になる。
    const lock = join(lockDir, "dir.lock");
    mkdirSync(lock, { recursive: true });
    const res = runRunner(spec, { MUTATION_PROOF_LOCK: lock });
    expect(res.status, res.out).toBe(2);
    expect(res.out).toContain("を読めない");
    expect(res.out).not.toContain("Error: EISDIR");
  });

  // 起動できなかったのは「実証できない変異がある」（exit 1）ではなく前提の誤り（exit 2）。
  test("テストを起動できなければ exit 2（理由を捨てない）", () => {
    const fx = makeFixture();
    const spec = fx.spec([mutation({ file: relative(repoRoot, fx.target) })]);
    const res = runRunner(spec, { MUTATION_PROOF_TEST_COMMAND: join(lockDir, "no-such-command") });
    expect(res.status, res.out).toBe(2);
    expect(res.out).toContain("テストを起動できない");
    expect(res.out).toContain("ENOENT");
    // 変異を当てたファイルは戻っていること（起動できなくても復元する）。
    expect(readFileSync(fx.target, "utf8")).toBe(FIXTURE_TARGET);
  });

  // 空の注入を「未指定」として扱うと、スタブのつもりで本物の vitest を測る。
  test("MUTATION_PROOF_TEST_COMMAND が空なら exit 2", () => {
    const fx = makeFixture();
    const spec = fx.spec([mutation({ file: relative(repoRoot, fx.target) })]);
    const res = runRunner(spec, { MUTATION_PROOF_TEST_COMMAND: "" });
    expect(res.status, res.out).toBe(2);
    expect(res.out).toContain("MUTATION_PROOF_TEST_COMMAND が空");
  });

  // vitest は `node_modules` からモジュール解決で求める。解決できない（`pnpm install` 前・リポジトリ外）
  // のは前提の誤り。**ランナーを 1 ファイルだけリポジトリ外へコピーして**解決を失敗させる
  // （ランナーは自分の位置から repoRoot を決めるので、コピー先には `node_modules` が無い）。
  test("vitest を解決できなければ exit 2", () => {
    const root = makeTempDir("mutation-proof-noroot-");
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
    const res = spawnSync(process.execPath, [join(root, RUNNER), spec], {
      cwd: root,
      encoding: "utf8",
      env: runnerEnv({ ...REAL, NODE_PATH: undefined, MUTATION_PROOF_LOCK: join(root, "lock") }),
    });
    const out = `${res.stdout}${res.stderr}`;
    expect(res.status, out).toBe(2);
    expect(out).toContain("vitest を解決できない");
  });

  // signal handler は同期の `main()` では dispatch されない（登録すると `kill` も機能しなくなる）。
  // 中断で変異が残る可能性は**次回起動の復元**で受ける、という取り決めを固定する。
  test("前回の中断で残った変異を次回起動で戻す", () => {
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

    const res = runRunner(spec, { MUTATION_PROOF_LOCK: lock });
    expect(res.status, res.out).toBe(0);
    expect(res.out).toContain("前回の中断で残っていた変異を戻した");
    // 戻したうえで、その run の基準・変異の判定まで通っていること。
    expect(res.out).toContain("PASS G");
    expect(readFileSync(fx.target, "utf8")).toBe(FIXTURE_TARGET);
    expect(existsSync(`${lock}.recovery.json`), "復元情報を消していない").toBe(false);
  });

  // 変異後の内容と一致したときだけ戻す。人が直してさらに編集した状態を上書きしない。
  test("復元情報と作業ツリーが食い違えば自動で戻さず exit 2", () => {
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
    const res = runRunner(spec, { MUTATION_PROOF_LOCK: lock });
    expect(res.status, res.out).toBe(2);
    expect(res.out).toContain("復元情報と作業ツリーが食い違う");
    // **編集を消していないこと**（この検査の主目的）。
    expect(readFileSync(fx.target, "utf8")).toBe(edited);
    expect(existsSync(`${lock}.recovery.json`), "記録を消してしまった").toBe(true);
  });

  // 復元情報は他ユーザーが置けるパスに在りうる（`/tmp` を避けたが env で上書きもできる）。
  // 書き戻し先がリポジトリ外なら植え付けを疑って落とす。
  test("復元情報の書き戻し先がリポジトリ外なら exit 2", () => {
    const fx = makeFixture();
    const spec = fx.spec([mutation({ file: relative(repoRoot, fx.target) })]);
    const lock = join(lockDir, "outside.lock");
    const outside = join(lockDir, "planted.txt");
    writeFileSync(outside, "元の内容\n");
    writeFileSync(
      `${lock}.recovery.json`,
      JSON.stringify({ file: outside, before: "植え付けた内容\n", after: "何か\n" }),
    );
    const res = runRunner(spec, { MUTATION_PROOF_LOCK: lock });
    expect(res.status, res.out).toBe(2);
    expect(res.out).toContain("リポジトリ外");
    // 書き換えていないこと。
    expect(readFileSync(outside, "utf8")).toBe("元の内容\n");
  });

  test("復元情報が不正なら exit 2（警告なしに続けない）", () => {
    const fx = makeFixture();
    const spec = fx.spec([mutation({ file: relative(repoRoot, fx.target) })]);
    const lock = join(lockDir, "broken-recovery.lock");
    writeFileSync(`${lock}.recovery.json`, JSON.stringify({ file: 42 }));
    const res = runRunner(spec, { MUTATION_PROOF_LOCK: lock });
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
  test("差分に当たらない宣言は飛ばし、理由を印字する", () => {
    const res = runRunner("--changed-since", "origin/main", "--only", "D", {
      ...REAL,
      MUTATION_PROOF_CHANGED_FILES: "docs/skill-development.md",
    });
    expect(res.status, res.out).toBe(0);
    expect(res.out).toContain("この差分に当たる宣言は無い");
    // 警告なしに成功にしない。注入を使ったことと、飛ばした宣言が出ていることを確かめる。
    expect(res.out).toContain("テスト用の注入");
    expect(res.out).toContain("飛ばす: scripts/skills/kaizen/tracking-issue-title.mutations.json");
  });

  test("対象ファイルが変わった宣言だけを選ぶ", () => {
    const res = runRunner("--changed-since", "origin/main", "--only", "STDEV", {
      ...REAL,
      MUTATION_PROOF_CHANGED_FILES: "scripts/eval/build-skill-eval-benchmark.js",
      // 集計スクリプトの宣言だけが選ばれる差分。`--only` で 1 変異に抑える（有界化の理由は上のコメント）。
    });
    expect(res.status, res.out).toBe(0);
    expect(res.out).toContain("測る: scripts/eval/build-skill-eval-benchmark.mutations.json");
    expect(res.out).toContain("飛ばす: scripts/mutation/check-mutation-proof.mutations.json");
    expect(res.out).toContain("PASS STDEV");
  }, 60_000);

  test("ランナーが変わったら全宣言を測る", () => {
    // `--only D`（tracking の宣言にだけ在る id）で測る量を 1 変異に抑える。全宣言へ広がったことは
    // 「飛ばす:」が出ないことで判定する（選択の結果を見るのに、全件を実行する必要はない）。
    const res = runRunner("--changed-since", "origin/main", "--only", "D", {
      ...REAL,
      MUTATION_PROOF_CHANGED_FILES: "scripts/mutation/check-mutation-proof.js",
    });
    expect(res.status, res.out).toBe(0);
    expect(res.out).toContain(
      "ランナー（scripts/mutation/check-mutation-proof.js）が変わったので全宣言を測る",
    );
    expect(res.out).not.toContain("飛ばす:");
  }, 60_000);

  // 差分を取れないときは「変更なし」として扱わない（0 件と失敗が同じ空配列になる）。
  test("差分を取れなければ exit 2", () => {
    const res = runRunner("--changed-since", "no-such-ref-for-test");
    expect(res.status, res.out).toBe(2);
    expect(res.out).toContain("からの差分を取れない");
  });

  test("--changed-since と宣言ファイルの指定は併用できない", () => {
    const fx = makeFixture();
    const spec = fx.spec([mutation({ file: relative(repoRoot, fx.target) })]);
    const res = runRunner(spec, "--changed-since", "origin/main");
    expect(res.status, res.out).toBe(2);
    expect(res.out).toContain("併用しない");
  });

  test("--only でどの変異も選ばれなければ exit 2", () => {
    const fx = makeFixture();
    const spec = fx.spec([mutation({ file: relative(repoRoot, fx.target) })]);
    const res = runRunner(spec, "--only", "存在しない id");
    expect(res.status, res.out).toBe(2);
    expect(res.out).toContain("--only で 1 件も選ばれなかった");
  });

  // **`--only` は宣言をまたいで絞る。** 宣言ごとに「1 件も選ばれなかった」で落とすと、
  // 宣言が 2 件以上ある時点で `--only <id>` が常に exit 2 になる（実測で踏んだ）。
  test("--only は選ばれなかった宣言を飛ばす（宣言が複数あっても実行する）", () => {
    const a = makeFixture();
    const b = makeFixture();
    const specA = a.spec([mutation({ id: "A", file: relative(repoRoot, a.target) })]);
    const specB = b.spec([mutation({ id: "B", file: relative(repoRoot, b.target) })]);
    const res = runRunner(specA, specB, "--only", "B");
    expect(res.status, res.out).toBe(0);
    expect(res.out).toContain("PASS B");
    // 選ばれなかった宣言は実行せず、件数として出す（警告なしに消さない）。
    expect(res.out, "選ばれていない宣言まで実行した").not.toContain("PASS A");
    expect(res.out).toContain("1 skipped");
  });
});

// `--shard i/N` は CI の並列実行用（Issue #507）。**N 本を合わせてちょうど全件**でなければならない
// ——取りこぼしは「どのジョブも測らない変異」になり、全ジョブが緑のまま実証が抜ける。
describe("--shard", () => {
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

  test("宣言をまたいだ通し番号で分け、N 本を合わせるとちょうど全件になる", () => {
    const specs = twoSpecs();
    const first = runRunner(...specs, "--shard", "1/2");
    expect(first.status, first.out).toBe(0);
    expect(first.out).toContain("シャード 1/2: 選んだ変異 3 件のうち 2 件を測る");
    expect(first.out).toContain("PASS A1");
    expect(first.out).toContain("PASS B1");
    expect(first.out, "他のシャードの変異まで測った").not.toContain("PASS A2");
    expect(first.out).toContain("mutation-proof: 2 proven / 0 failed");

    const second = runRunner(...specs, "--shard", "2/2");
    expect(second.status, second.out).toBe(0);
    expect(second.out).toContain("シャード 2/2: 選んだ変異 3 件のうち 1 件を測る");
    expect(second.out).toContain("PASS A2");
    expect(second.out, "他のシャードの変異まで測った").not.toMatch(/PASS (A1|B1)/);
    expect(second.out).toContain("mutation-proof: 1 proven / 0 failed");
    // 変異を受け持たない宣言は基準 run も測らない（B はこのシャードに変異が無い）。
    expect(second.out).not.toContain(relative(repoRoot, specs[1]));
  });

  test("変異がシャード数より少なく割り当てが 0 件なら、理由を出して exit 0", () => {
    const fx = makeFixture();
    const spec = fx.spec([mutation({ file: relative(repoRoot, fx.target) })]);
    const res = runRunner(spec, "--shard", "2/2");
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
  ])("--shard %s は exit 2（警告なしに 0 件のシャードにしない）", (value) => {
    const fx = makeFixture();
    const spec = fx.spec([mutation({ file: relative(repoRoot, fx.target) })]);
    const res = runRunner(spec, "--shard", value);
    expect(res.status, res.out).toBe(2);
    expect(res.out).toMatch(/--shard (は <i>\/<N>|の i が N を超えている|の値が大きすぎる)/);
    expect(res.out).not.toContain("PASS G");
  });
});
