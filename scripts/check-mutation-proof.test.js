import { afterEach, describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

// `check-mutation-proof.js` は「変異が当たったこと」と「狙ったテストが落ちたこと」の両方で
// 判定する。**当たらなかった変異を成功に倒さない**のがこの検査の主目的なので、
// わざと当たらない変異・生き残る変異・宣言外まで落とす変異を入れて、
// それぞれが FAIL として報告されることを実測する（Issue #420 の受け入れ条件）。
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const RUNNER = "scripts/check-mutation-proof.js";

// fixture は `scripts/` 配下に置く。vitest の include（`scripts/**/*.test.js`）に
// 入っていないと、runner が起動した vitest が「テストが 1 件も走らなかった」になり、
// 検査対象（変異の判定）ではなく置き場所を測ってしまう。
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

let dirs = [];

const lockDir = mkdtempSync(join(tmpdir(), "mutation-proof-lock-"));

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

/** fixture 一式を `scripts/` 配下の使い捨てディレクトリに作る。 */
function makeFixture({ testBody = FIXTURE_TEST } = {}) {
  const dir = mkdtempSync(join(repoRoot, "scripts", "mutation-proof-fixture-"));
  dirs.push(dir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "target.sh"), FIXTURE_TARGET);
  writeFileSync(join(dir, "fixture.test.js"), testBody);
  return {
    dir,
    target: join(dir, "target.sh"),
    spec(mutations, overrides = {}) {
      const path = join(dir, "case.mutations.json");
      writeFileSync(
        path,
        JSON.stringify({
          test_file: relative(repoRoot, join(dir, "fixture.test.js")),
          mutations,
          ...overrides,
        }),
      );
      return path;
    },
  };
}

function runRunner(...args) {
  let env = {};
  if (args.length && typeof args.at(-1) === "object") env = args.pop();
  const merged = {
    ...process.env,
    // ロックは使い捨てパスへ寄せる（既定パスを使うと、手元で走っている実走と取り合う）。
    MUTATION_PROOF_LOCK: join(lockDir, "default.lock"),
    ...env,
  };
  // `undefined` を渡したキーは「継承しない」の意味にする（ambient な値を測定に混ぜない）。
  for (const [key, value] of Object.entries(merged)) {
    if (value === undefined) delete merged[key];
  }
  const res = spawnSync("node", [RUNNER, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: merged,
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
  test("当たって狙ったテストだけが落ちる変異は PASS（陽性コントロール）", () => {
    const fx = makeFixture();
    const spec = fx.spec([mutation({ file: relative(repoRoot, fx.target) })]);
    const res = runRunner(spec);
    expect(res.out).toContain("PASS G");
    expect(res.status, res.out).toBe(0);
    // 変異は必ず戻す（戻せないと以降の run が別の版を測る）。
    expect(readFileSync(fx.target, "utf8")).toBe(FIXTURE_TARGET);
  });

  // **当たらない変異は「偽の生存」を作る。** 置換がスキップされたのに全テストが緑になり、
  // 「変異しても落ちなかった」ではなく「そもそも変異していない」状態を実証と読みかける。
  test("置換が 1 件も当たらない変異は FAIL（成功に倒さない）", () => {
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

describe("宣言と前提の検証（走らせる前に落とす）", () => {
  // テストをリネームすると `expect_failing` は永遠に落ちない名前を指す。
  // 変異が効かなくなったのではなく**検査が空振りしている**ので、走らせる前に落とす。
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
      testBody: FIXTURE_TEST.replace(
        'expect(target()).toContain("limit=100");',
        "expect(1).toBe(2);",
      ),
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
  ])("形の違う宣言は走らせる前に exit 2: %o", (over, message) => {
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
      testBody: `${FIXTURE_TEST}
test("guard", () => {
  expect(1).toBe(1);
});
`,
    });
    const spec = fx.spec([mutation({ file: relative(repoRoot, fx.target) })]);
    const res = runRunner(spec);
    expect(res.status, res.out).toBe(2);
    expect(res.out).toContain("テスト名が重複している");
    expect(res.out).toContain("guard");
  });

  test("mutations が空なら exit 2（0 件を成功に倒さない）", () => {
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
    // 実在しない pid（残骸）。奪えないと、以降この検査は永久に走らない。
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
  test("vitest を起動できなければ exit 2（理由を捨てない）", () => {
    const fx = makeFixture();
    const spec = fx.spec([mutation({ file: relative(repoRoot, fx.target) })]);
    // **`node` は解決できるまま `pnpm` だけ解決できない PATH にする。** PATH を空にすると
    // runner 自体（`node`）が起動できず、測る層がずれる（status が null になった）。
    const bin = mkdtempSync(join(tmpdir(), "no-pnpm-bin-"));
    dirs.push(bin);
    symlinkSync(process.execPath, join(bin, "node"));
    const res = runRunner(spec, { PATH: bin });
    expect(res.status, res.out).toBe(2);
    expect(res.out).toContain("vitest を起動できない");
    // 変異を当てたファイルは戻っていること（起動できなくても復元する）。
    expect(readFileSync(fx.target, "utf8")).toBe(FIXTURE_TARGET);
  });

  // **使用中の fixture を掃かせない。** `scripts/vitest-global-setup.js` は収集前に
  // `scripts/mutation-proof-fixture-*` を消すので、runner が起動する子 vitest には
  // `MUTATION_PROOF_CHILD` を渡して掃引を止めている（渡さないと fixture ごと消えて 10 テストが落ちた）。
  // ここでは**ambient な marker を明示的に外して**測る（ハーネス自身が渡す値で緑にならないように）。
  test("子 vitest の掃引を止めるので、使用中の fixture が消えない", () => {
    const fx = makeFixture();
    const spec = fx.spec([mutation({ file: relative(repoRoot, fx.target) })]);
    const res = runRunner(spec, { MUTATION_PROOF_CHILD: undefined });
    expect(res.status, res.out).toBe(0);
    expect(res.out).toContain("PASS G");
    // fixture が run の途中で消えていないこと（消えると上の run 自体が成立しない）。
    expect(existsSync(fx.target), "fixture が掃かれた").toBe(true);
  });

  // signal handler は同期の `main()` では dispatch されない（登録すると `kill` も効かなくなる）。
  // 中断で変異が残る可能性は**次回起動の復元**で受ける、という契約を固定する。
  test("前回の中断で残った変異を次回起動で戻す", () => {
    const fx = makeFixture();
    const spec = fx.spec([mutation({ file: relative(repoRoot, fx.target) })]);
    const lock = join(lockDir, "recover.lock");
    // 中断された run の状態を作る: 復元情報が残っていて、対象は変異したまま。
    writeFileSync(
      `${lock}.recovery.json`,
      JSON.stringify({ file: fx.target, content: FIXTURE_TARGET }),
    );
    writeFileSync(fx.target, FIXTURE_TARGET.replace(GUARD, ""));

    const res = runRunner(spec, { MUTATION_PROOF_LOCK: lock });
    expect(res.status, res.out).toBe(0);
    expect(res.out).toContain("前回の中断で残っていた変異を戻した");
    // 戻したうえで、その run の基準・変異の判定まで通っていること。
    expect(res.out).toContain("PASS G");
    expect(readFileSync(fx.target, "utf8")).toBe(FIXTURE_TARGET);
    expect(existsSync(`${lock}.recovery.json`), "復元情報を消していない").toBe(false);
  });

  test("復元情報が壊れていれば exit 2（黙って続けない）", () => {
    const fx = makeFixture();
    const spec = fx.spec([mutation({ file: relative(repoRoot, fx.target) })]);
    const lock = join(lockDir, "broken-recovery.lock");
    writeFileSync(`${lock}.recovery.json`, JSON.stringify({ file: 42 }));
    const res = runRunner(spec, { MUTATION_PROOF_LOCK: lock });
    expect(res.status, res.out).toBe(2);
    expect(res.out).toContain("復元情報が壊れている");
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
  test("--only は選ばれなかった宣言を飛ばす（宣言が複数あっても走る）", () => {
    const a = makeFixture();
    const b = makeFixture();
    const specA = a.spec([mutation({ id: "A", file: relative(repoRoot, a.target) })]);
    const specB = b.spec([mutation({ id: "B", file: relative(repoRoot, b.target) })]);
    const res = runRunner(specA, specB, "--only", "B");
    expect(res.status, res.out).toBe(0);
    expect(res.out).toContain("PASS B");
    // 選ばれなかった宣言は走らせず、件数として出す（黙って消さない）。
    expect(res.out, "選ばれていない宣言まで走らせた").not.toContain("PASS A");
    expect(res.out).toContain("1 skipped");
  });
});

// ロック用の使い捨てディレクトリ（`tmpdir()` 配下）を外す。
test("片付け", () => {
  rmSync(lockDir, { recursive: true, force: true });
  expect(existsSync(lockDir)).toBe(false);
});
