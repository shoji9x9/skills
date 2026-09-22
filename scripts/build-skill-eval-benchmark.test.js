import { describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// `build-skill-eval-benchmark.js` は **assertion テキストをキーにした入力だけを受理する**
// 集計器（Issue #421）。位置で対応づけると、assertion の追加・削除・並べ替えで判定がずれ、
// 件数を誤る（`parity-diff` #27 の without_skill を 1/6 と 2/6 の両方で数えた実例がある）。
// ここでは「受理しない入力」と「数値の境界」を固定する。
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = "scripts/build-skill-eval-benchmark.js";

const ASSERTIONS = ["最初の assertion", "2 番目の assertion", "3 番目の assertion"];

const dirs = [];

function makeIteration() {
  const root = mkdtempSync(join(tmpdir(), "benchmark-build-"));
  dirs.push(root);
  return root;
}

/** run 1 件ぶんの成果物を書く（既定は eval_metadata と整合する採点）。 */
function writeRun(
  root,
  {
    evalDir,
    evalId,
    configuration,
    runNumber = 1,
    assertions = ASSERTIONS,
    passed = assertions.map(() => true),
    grading, // 明示すると grading.json をそのまま置く（不正な形の検査用）
    timing = {},
    metrics = { total_tool_calls: 0, errors_encountered: 0 },
    omitGrading = false,
    omitTiming = false,
    executor = { name: "claude-code", model: "opus", reasoning_effort: null },
  },
) {
  const dir = join(root, evalDir, configuration, `run-${runNumber}`);
  mkdirSync(join(dir, "outputs"), { recursive: true });
  writeFileSync(
    join(dir, "eval_metadata.json"),
    JSON.stringify({ eval_id: evalId, eval_name: evalDir, prompt: "p", assertions }),
  );
  if (!omitTiming) {
    writeFileSync(
      join(dir, "timing.json"),
      JSON.stringify({
        schema_version: 1,
        executor,
        total_tokens: timing.total_tokens ?? 1000,
        total_duration_seconds: timing.total_duration_seconds ?? 10.5,
      }),
    );
  }
  if (metrics) writeFileSync(join(dir, "outputs", "metrics.json"), JSON.stringify(metrics));
  if (omitGrading) return dir;
  const body =
    grading ??
    (() => {
      const expectations = assertions.map((text, i) => ({
        text,
        passed: passed[i],
        evidence: `根拠 ${i + 1}`,
      }));
      const ok = expectations.filter((e) => e.passed).length;
      return {
        summary: {
          pass_rate: Number((ok / expectations.length).toFixed(4)),
          passed: ok,
          failed: expectations.length - ok,
          total: expectations.length,
        },
        expectations,
      };
    })();
  writeFileSync(join(dir, "grading.json"), JSON.stringify(body));
  return dir;
}

function run(root, extra = []) {
  const res = spawnSync(
    "node",
    [
      SCRIPT,
      root,
      "--skill-name",
      "demo",
      "--skill-path",
      "<repo>/skills/demo",
      "--executor-model",
      "claude-opus-5",
      "--analyzer-model",
      "manual",
      "--stdout",
      ...extra,
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );
  return { ...res, out: `${res.stdout}${res.stderr}` };
}

/** 2 eval × 2 configuration の揃った iteration（数値の境界を踏む値で作る）。 */
function completeIteration() {
  const root = makeIteration();
  writeRun(root, {
    evalDir: "eval-2",
    evalId: 2,
    configuration: "with_skill",
    passed: [true, true, false],
    timing: { total_duration_seconds: 10.5, total_tokens: 1000 },
  });
  writeRun(root, {
    evalDir: "eval-10",
    evalId: 10,
    configuration: "with_skill",
    passed: [true, true, true],
    timing: { total_duration_seconds: 21.25, total_tokens: 2001 },
  });
  writeRun(root, {
    evalDir: "eval-2",
    evalId: 2,
    configuration: "without_skill",
    passed: [true, false, false],
    timing: { total_duration_seconds: 5.125, total_tokens: 400 },
  });
  writeRun(root, {
    evalDir: "eval-10",
    evalId: 10,
    configuration: "without_skill",
    passed: [false, false, false],
    timing: { total_duration_seconds: 7.875, total_tokens: 610 },
  });
  return root;
}

describe("集計（揃った iteration）", () => {
  test("run の並び・evals_run・統計・Delta を固定する", () => {
    const res = run(completeIteration(), ["--timestamp", "2026-09-22T00:00:00Z"]);
    expect(res.status, res.out).toBe(0);
    const b = JSON.parse(res.stdout);

    expect(b.metadata).toStrictEqual({
      skill_name: "demo",
      skill_path: "<repo>/skills/demo",
      executor_model: "claude-opus-5",
      analyzer_model: "manual",
      timestamp: "2026-09-22T00:00:00Z",
      // 数値順（ディレクトリ名の辞書順ではない）。
      evals_run: [2, 10],
      // 成果物から数える（ハードコードした 3 を人が直す運用に戻さない）。
      runs_per_configuration: 1,
    });

    // 並びは configuration ごと（with_skill → without_skill）、中は eval ディレクトリ名の辞書順。
    expect(b.runs.map((r) => [r.eval_id, r.configuration])).toStrictEqual([
      [10, "with_skill"],
      [2, "with_skill"],
      [10, "without_skill"],
      [2, "without_skill"],
    ]);

    // 標本標準偏差（n-1）・Python 互換の 4 桁丸め・min/max も 4 桁。
    expect(b.run_summary.with_skill).toStrictEqual({
      pass_rate: { mean: 0.8334, stddev: 0.2357, min: 0.6667, max: 1 },
      time_seconds: { mean: 15.875, stddev: 7.6014, min: 10.5, max: 21.25 },
      tokens: { mean: 1500.5, stddev: 707.8139, min: 1000, max: 2001 },
    });
    expect(b.run_summary.without_skill).toStrictEqual({
      pass_rate: { mean: 0.1666, stddev: 0.2357, min: 0, max: 0.3333 },
      time_seconds: { mean: 6.5, stddev: 1.9445, min: 5.125, max: 7.875 },
      tokens: { mean: 505, stddev: 148.4924, min: 400, max: 610 },
    });
    // Delta は桁を変えて符号つきの文字列（pass_rate 2 桁 / 秒 1 桁 / トークン 0 桁）。
    expect(b.run_summary.delta).toStrictEqual({
      pass_rate: "+0.67",
      time_seconds: "+9.4",
      tokens: "+996",
    });

    const first = b.runs[0];
    expect(first.result).toStrictEqual({
      pass_rate: 1,
      passed: 3,
      failed: 0,
      total: 3,
      time_seconds: 21.25,
      tokens: 2001,
      tool_calls: 0,
      errors: 0,
    });
    expect(first.expectations.map((e) => e.text)).toStrictEqual(ASSERTIONS);
    expect(first.notes).toStrictEqual([]);
    expect(b.notes).toStrictEqual([]);
  });

  // **位置ではなくテキストで対応づける**ことの直接の検査。判定を並べ替えても、
  // 出力は eval_metadata（run 時点の正本）の順に並び、テキストごとの判定が保たれる。
  test("判定が並べ替わっていてもテキストで対応づける", () => {
    const root = makeIteration();
    const shuffled = [
      { text: ASSERTIONS[2], passed: false, evidence: "3 番目の根拠" },
      { text: ASSERTIONS[0], passed: true, evidence: "1 番目の根拠" },
      { text: ASSERTIONS[1], passed: false, evidence: "2 番目の根拠" },
    ];
    writeRun(root, {
      evalDir: "eval-1",
      evalId: 1,
      configuration: "with_skill",
      grading: {
        summary: { pass_rate: 0.3333, passed: 1, failed: 2, total: 3 },
        expectations: shuffled,
      },
    });
    const res = run(root);
    expect(res.status, res.out).toBe(0);
    const b = JSON.parse(res.stdout);
    expect(b.runs[0].expectations).toStrictEqual([
      { text: ASSERTIONS[0], passed: true, evidence: "1 番目の根拠" },
      { text: ASSERTIONS[1], passed: false, evidence: "2 番目の根拠" },
      { text: ASSERTIONS[2], passed: false, evidence: "3 番目の根拠" },
    ]);
    // 片方の configuration しか無い iteration では Delta を出さない（比較対象が無い）。
    expect(b.run_summary.delta).toBeUndefined();
  });

  test("テキストをキーにした verdicts オブジェクトも受理する", () => {
    const root = makeIteration();
    writeRun(root, {
      evalDir: "eval-1",
      evalId: 1,
      configuration: "with_skill",
      grading: {
        summary: { pass_rate: 0.6667, passed: 2, failed: 1, total: 3 },
        verdicts: {
          [ASSERTIONS[0]]: { passed: true, evidence: "a" },
          [ASSERTIONS[1]]: { passed: true, evidence: "b" },
          [ASSERTIONS[2]]: { passed: false, evidence: "c" },
        },
      },
    });
    const res = run(root);
    expect(res.status, res.out).toBe(0);
    const b = JSON.parse(res.stdout);
    expect(b.runs[0].result.passed).toBe(2);
    expect(b.runs[0].expectations.map((e) => e.text)).toStrictEqual(ASSERTIONS);
  });

  test("tool_calls / errors は metrics.json の実測を読む", () => {
    const root = makeIteration();
    writeRun(root, {
      evalDir: "eval-1",
      evalId: 1,
      configuration: "with_skill",
      metrics: { total_tool_calls: 7, errors_encountered: 2 },
    });
    const b = JSON.parse(run(root).stdout);
    expect(b.runs[0].result.tool_calls).toBe(7);
    expect(b.runs[0].result.errors).toBe(2);
  });

  test("notes はファイルから受け取る（集計器は文章を作らない）", () => {
    const root = completeIteration();
    const notes = join(root, "notes.txt");
    writeFileSync(notes, "1 行目の備考\n\n2 行目の備考\n");
    const b = JSON.parse(run(root, ["--notes-file", notes]).stdout);
    expect(b.notes).toStrictEqual(["1 行目の備考", "2 行目の備考"]);
  });

  // notes は**文字列配列**。成果物の JSON（plain object を要求する）と同じ読み方をすると、
  // 配列が「JSON オブジェクトでない」で落ちる（実際に一度そう壊した）。
  test("notes は JSON の文字列配列でも受け取れる", () => {
    const root = completeIteration();
    const notes = join(root, "notes.json");
    writeFileSync(notes, JSON.stringify(["1 件目の備考", "2 件目の備考"]));
    const res = run(root, ["--notes-file", notes]);
    expect(res.status, res.out).toBe(0);
    expect(JSON.parse(res.stdout).notes).toStrictEqual(["1 件目の備考", "2 件目の備考"]);
  });

  test("既定の出力先は iteration 直下で、既存ファイルは --force なしに上書きしない", () => {
    const root = completeIteration();
    const out = join(root, "benchmark.json");
    const first = spawnSync(
      "node",
      [
        SCRIPT,
        root,
        "--skill-name",
        "demo",
        "--skill-path",
        "p",
        "--executor-model",
        "m",
        "--analyzer-model",
        "manual",
      ],
      { cwd: repoRoot, encoding: "utf8" },
    );
    expect(first.status, first.stderr).toBe(0);
    expect(existsSync(out)).toBe(true);
    const again = run(root, []); // --stdout 付きなので書かない
    expect(again.status, again.out).toBe(0);
    const overwrite = spawnSync(
      "node",
      [
        SCRIPT,
        root,
        "--skill-name",
        "demo",
        "--skill-path",
        "p",
        "--executor-model",
        "m",
        "--analyzer-model",
        "manual",
      ],
      { cwd: repoRoot, encoding: "utf8" },
    );
    expect(overwrite.status, overwrite.stderr).toBe(2);
    expect(overwrite.stderr).toContain("--force");
    // 既定の timestamp は秒までの UTC。
    const written = JSON.parse(readFileSync(out, "utf8"));
    expect(written.metadata.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });
});

describe("受理しない入力（exit 2）", () => {
  function reject(grading, message, extra = {}) {
    const root = makeIteration();
    writeRun(root, {
      evalDir: "eval-1",
      evalId: 1,
      configuration: "with_skill",
      grading,
      ...extra,
    });
    const res = run(root);
    expect(res.status, res.out).toBe(2);
    expect(res.out).toContain(message);
  }

  const summary = { pass_rate: 1, passed: 3, failed: 0, total: 3 };

  // **どのガードが落としたかまで見る。** 受理しない入力はどのガードでも exit 2 になるので、
  // 終了コードと総称メッセージだけを見ると、ガードを 1 つ外す変異が生き残る（実測）。

  test("判定の位置配列（真偽値の並び）を受理しない", () => {
    reject(
      { summary, expectations: [true, true, false] },
      "expectations[0] が {text, passed, evidence} のオブジェクトでない（位置配列は受理しない）",
    );
  });

  test("判定の位置配列（[passed, evidence] の組）を受理しない", () => {
    reject(
      {
        summary,
        expectations: [
          [true, "a"],
          [true, "b"],
          [false, "c"],
        ],
      },
      "expectations[0] が {text, passed, evidence} のオブジェクトでない（位置配列は受理しない）",
    );
  });

  test("text を持たない判定を受理しない", () => {
    reject(
      { summary, expectations: ASSERTIONS.map(() => ({ passed: true, evidence: "e" })) },
      "の assertion テキストが非空の文字列でない（位置配列は受理しない）",
    );
  });

  test("verdicts が配列なら受理しない", () => {
    reject({ summary, verdicts: [{ passed: true, evidence: "e" }] }, "配列は受理しない");
  });

  test("キー集合が eval_metadata と違えば落とす（判定の無い assertion）", () => {
    reject(
      {
        summary: { pass_rate: 1, passed: 2, failed: 0, total: 2 },
        expectations: ASSERTIONS.slice(0, 2).map((text) => ({ text, passed: true, evidence: "e" })),
      },
      "判定の無い assertion 1 件",
    );
  });

  test("キー集合が eval_metadata と違えば落とす（宣言に無い判定）", () => {
    reject(
      {
        summary: { pass_rate: 1, passed: 4, failed: 0, total: 4 },
        expectations: [...ASSERTIONS, "宣言に無い assertion"].map((text) => ({
          text,
          passed: true,
          evidence: "e",
        })),
      },
      "宣言に無い判定 1 件",
    );
  });

  test("同じテキストの判定が 2 件あれば落とす（テキストでキーにできない）", () => {
    reject(
      {
        summary: { pass_rate: 1, passed: 3, failed: 0, total: 3 },
        expectations: [ASSERTIONS[0], ASSERTIONS[0], ASSERTIONS[1]].map((text) => ({
          text,
          passed: true,
          evidence: "e",
        })),
      },
      "assertion テキストが重複している",
    );
  });

  test("summary の件数が採点内訳と食い違えば落とす", () => {
    reject(
      {
        summary: { pass_rate: 1, passed: 3, failed: 0, total: 3 },
        expectations: ASSERTIONS.map((text, i) => ({ text, passed: i !== 0, evidence: "e" })),
      },
      "summary.passed=3 が採点内訳（2）と違う",
    );
  });

  test("summary の pass_rate が採点内訳と食い違えば落とす", () => {
    reject(
      {
        summary: { pass_rate: 0.5, passed: 3, failed: 0, total: 3 },
        expectations: ASSERTIONS.map((text) => ({ text, passed: true, evidence: "e" })),
      },
      "summary.pass_rate=0.5 が採点内訳（1）と違う",
    );
  });

  test("evidence が空なら落とす（根拠の無い判定を集計しない）", () => {
    reject(
      {
        summary: { pass_rate: 1, passed: 3, failed: 0, total: 3 },
        expectations: ASSERTIONS.map((text) => ({ text, passed: true, evidence: "" })),
      },
      "evidence が非空の文字列でない",
    );
  });

  // `pass_rate` の小数桁は規約が定めていない。採点者が 0.56（= 5/9）のように丸めて保存した
  // grading は内訳が正しいので受理する（本リポの既存成果物に 10 件ある）。
  test("保存された pass_rate の桁が粗くても内訳が合っていれば受理する", () => {
    const root = makeIteration();
    const nine = Array.from({ length: 9 }, (_, i) => `assertion ${i + 1}`);
    writeRun(root, {
      evalDir: "eval-1",
      evalId: 1,
      configuration: "with_skill",
      assertions: nine,
      grading: {
        // 5/9 = 0.5556 を 2 桁で保存した形。
        summary: { pass_rate: 0.56, passed: 5, failed: 4, total: 9 },
        expectations: nine.map((text, i) => ({ text, passed: i < 5, evidence: "e" })),
      },
    });
    const res = run(root);
    expect(res.status, res.out).toBe(0);
    // **出力は採点内訳から導いた値**（保存値を載せると benchmark が採点と違う数字を報告する）。
    expect(JSON.parse(res.stdout).runs[0].result.pass_rate).toBe(0.5556);
  });

  // 桁の下限クランプ（1 桁）の範囲では保存値と内訳がずれたまま受理されるので、
  // **そのずれを出力・統計へ持ち込まない**ことを固定する（0.7 と保存された 2/3）。
  test("保存値と内訳がずれていても統計は内訳から作る", () => {
    const root = makeIteration();
    const three = ["a1", "a2", "a3"];
    for (const configuration of ["with_skill", "without_skill"]) {
      writeRun(root, {
        evalDir: "eval-1",
        evalId: 1,
        configuration,
        assertions: three,
        grading: {
          summary: { pass_rate: 0.7, passed: 2, failed: 1, total: 3 },
          expectations: three.map((text, i) => ({ text, passed: i < 2, evidence: "e" })),
        },
      });
    }
    const res = run(root);
    expect(res.status, res.out).toBe(0);
    const b = JSON.parse(res.stdout);
    expect(b.runs[0].result.pass_rate).toBe(0.6667);
    expect(b.run_summary.with_skill.pass_rate.mean).toBe(0.6667);
  });

  test.each(["null", "[]", '"文字列"'])(
    "成果物の JSON が %s なら exit 2（stack trace にしない）",
    (json) => {
      const root = makeIteration();
      const dir = writeRun(root, { evalDir: "eval-1", evalId: 1, configuration: "with_skill" });
      writeFileSync(join(dir, "timing.json"), json);
      const res = run(root);
      expect(res.status, res.out).toBe(2);
      expect(res.out).toContain("JSON オブジェクトでない");
      expect(res.out).not.toContain("TypeError");
    },
  );

  test("桁を丸めても説明できない pass_rate は落とす", () => {
    reject(
      {
        summary: { pass_rate: 0.5, passed: 3, failed: 0, total: 3 },
        expectations: ASSERTIONS.map((text) => ({ text, passed: true, evidence: "e" })),
      },
      "summary.pass_rate=0.5 が採点内訳（1）と違う",
    );
  });

  // 「記録が無い」を「揃っている」に倒さない（全 run で executor が欠けると混在検査が空振りする）。
  test("timing.json に executor.name が無ければ落とす", () => {
    const root = makeIteration();
    writeRun(root, {
      evalDir: "eval-1",
      evalId: 1,
      configuration: "with_skill",
      executor: { name: null, model: null, reasoning_effort: null },
    });
    writeRun(root, {
      evalDir: "eval-1",
      evalId: 1,
      configuration: "without_skill",
      executor: { name: null, model: null, reasoning_effort: null },
    });
    const res = run(root);
    expect(res.status, res.out).toBe(2);
    expect(res.out).toContain("executor.name が無い run がある");
  });

  test("timing.json が無ければ落とす（時間・トークンを 0 で埋めない）", () => {
    const root = makeIteration();
    writeRun(root, {
      evalDir: "eval-1",
      evalId: 1,
      configuration: "with_skill",
      omitTiming: true,
    });
    const res = run(root);
    expect(res.status, res.out).toBe(2);
    expect(res.out).toContain("timing.json が無い");
  });

  // 採点の無い run（汚染・invalid_run）は黙って落とさない。既定は落として、
  // 除外を承知したときだけ --ungraded skip で進む。
  test("採点の無い run は既定で落とし、--ungraded skip で除外する", () => {
    const root = completeIteration();
    writeRun(root, {
      evalDir: "eval-2",
      evalId: 2,
      configuration: "with_skill",
      runNumber: 2,
      omitGrading: true,
    });
    const failed = run(root);
    expect(failed.status, failed.out).toBe(2);
    expect(failed.out).toContain("採点の無い run が 1 件ある");
    expect(failed.out).toContain("--ungraded skip");

    const skipped = run(root, ["--ungraded", "skip"]);
    expect(skipped.status, skipped.out).toBe(0);
    const b = JSON.parse(skipped.stdout);
    expect(b.runs).toHaveLength(4);
    expect(b.metadata.runs_per_configuration).toBe(1);
  });

  // **`--ungraded skip` の穴**: ある eval × configuration の run が**全部**未採点だと採点済み 0 件に
  // なり、0 を突き合わせから外すと「揃っている」に倒れて Delta が別母集団の比較になる（実測）。
  test("採点済み 0 件の eval × configuration は --ungraded skip でも落とす", () => {
    const root = makeIteration();
    writeRun(root, { evalDir: "eval-1", evalId: 1, configuration: "with_skill" });
    writeRun(root, { evalDir: "eval-1", evalId: 1, configuration: "without_skill" });
    writeRun(root, { evalDir: "eval-2", evalId: 2, configuration: "with_skill" });
    writeRun(root, {
      evalDir: "eval-2",
      evalId: 2,
      configuration: "without_skill",
      omitGrading: true,
    });
    const res = run(root, ["--ungraded", "skip"]);
    expect(res.status, res.out).toBe(2);
    expect(res.out).toContain("採点済みの run が 1 件も無い eval × configuration がある");
    expect(res.out).toContain("eval-2/without_skill");

    // 陽性コントロール: 余分な run だけが未採点なら（採点済みが残るので）skip で通る。
    const ok = makeIteration();
    writeRun(ok, { evalDir: "eval-1", evalId: 1, configuration: "with_skill" });
    writeRun(ok, { evalDir: "eval-1", evalId: 1, configuration: "without_skill" });
    writeRun(ok, {
      evalDir: "eval-1",
      evalId: 1,
      configuration: "with_skill",
      runNumber: 2,
      omitGrading: true,
    });
    const passed = run(ok, ["--ungraded", "skip"]);
    expect(passed.status, passed.out).toBe(0);
    expect(JSON.parse(passed.stdout).runs).toHaveLength(2);
  });

  // run の合間に assertion を変えると、各 run は自分の宣言と整合したまま分母が変わり、
  // mean / stddev / delta が別の採点基準の混合平均になる。
  test("同じ eval の run が違う assertion 集合を採点していれば落とす", () => {
    const root = makeIteration();
    writeRun(root, { evalDir: "eval-1", evalId: 1, configuration: "with_skill" });
    writeRun(root, {
      evalDir: "eval-1",
      evalId: 1,
      configuration: "with_skill",
      runNumber: 2,
      assertions: [...ASSERTIONS, "run 2 で足した assertion"],
      passed: [true, true, true, true],
    });
    writeRun(root, { evalDir: "eval-1", evalId: 1, configuration: "without_skill" });
    writeRun(root, {
      evalDir: "eval-1",
      evalId: 1,
      configuration: "without_skill",
      runNumber: 2,
    });
    const res = run(root);
    expect(res.status, res.out).toBe(2);
    expect(res.out).toContain("違う assertion 集合を採点している");
    expect(res.out).toContain("with_skill/run-2");

    // 陰性コントロール: 全 run が同じ集合なら通る（テキストの並び順は問わない）。
    const ok = makeIteration();
    writeRun(ok, { evalDir: "eval-1", evalId: 1, configuration: "with_skill" });
    writeRun(ok, {
      evalDir: "eval-1",
      evalId: 1,
      configuration: "with_skill",
      runNumber: 2,
      assertions: [...ASSERTIONS].reverse(),
      passed: [true, true, true],
    });
    const passed = run(ok);
    expect(passed.status, passed.out).toBe(0);
    expect(JSON.parse(passed.stdout).runs).toHaveLength(2);
  });

  test("executor / model が混ざっていれば落とす（母集団を分ける）", () => {
    const root = completeIteration();
    writeRun(root, {
      evalDir: "eval-3",
      evalId: 3,
      configuration: "with_skill",
      executor: { name: "codex", model: "gpt-5", reasoning_effort: "high" },
    });
    writeRun(root, { evalDir: "eval-3", evalId: 3, configuration: "without_skill" });
    const res = run(root);
    expect(res.status, res.out).toBe(2);
    expect(res.out).toContain("executor / model / effort が混ざっている");
  });

  test("eval × configuration の run 数が揃っていなければ落とす", () => {
    const root = completeIteration();
    writeRun(root, {
      evalDir: "eval-2",
      evalId: 2,
      configuration: "with_skill",
      runNumber: 2,
    });
    const res = run(root);
    expect(res.status, res.out).toBe(2);
    expect(res.out).toContain("run 数が揃っていない");
  });

  // 片側の configuration しか無い eval を黙って混ぜると、Delta は **eval 集合の違う母集団**
  // 同士の比較になる（with は 2 eval・without は 1 eval でも runs_per_configuration は 1）。
  test("configuration が eval ごとに違えば落とす（Delta の母集団がずれる）", () => {
    const root = completeIteration();
    writeRun(root, { evalDir: "eval-3", evalId: 3, configuration: "with_skill" });
    const res = run(root);
    expect(res.status, res.out).toBe(2);
    expect(res.out).toContain("eval ごとに揃っている configuration が違う");

    // 陰性コントロール: iteration 全体が片側だけなら通す（Delta を出さないだけ）。
    const single = makeIteration();
    writeRun(single, { evalDir: "eval-1", evalId: 1, configuration: "with_skill" });
    writeRun(single, { evalDir: "eval-2", evalId: 2, configuration: "with_skill" });
    const ok = run(single);
    expect(ok.status, ok.out).toBe(0);
    expect(JSON.parse(ok.stdout).run_summary.delta).toBeUndefined();
  });

  // run 数の突き合わせはディレクトリ単位、集計のキーは eval_id。食い違うと
  // 「eval-1 の run が 2 として数えられる」取り違えが黙って通る。
  test("eval_id がディレクトリ名と食い違えば落とす", () => {
    const root = makeIteration();
    writeRun(root, { evalDir: "eval-1", evalId: 2, configuration: "with_skill" });
    const res = run(root);
    expect(res.status, res.out).toBe(2);
    expect(res.out).toContain("eval_id=2 がディレクトリ名（eval-1）と違う");
  });

  test("eval ディレクトリが無ければ落とす（対象 0 件を成功に倒さない）", () => {
    const res = run(makeIteration());
    expect(res.status, res.out).toBe(2);
    expect(res.out).toContain("eval-* ディレクトリが無い");
  });

  test.each([
    [["--skill-name"], "--skill-name は必須"],
    [["--ungraded", "maybe"], "--ungraded は fail | skip"],
    [["--nope"], "不明な引数: --nope"],
  ])("使い方の誤りは走らせる前に exit 2: %o", (args, message) => {
    const root = completeIteration();
    const base = [
      SCRIPT,
      root,
      "--skill-path",
      "p",
      "--executor-model",
      "m",
      "--analyzer-model",
      "manual",
      "--stdout",
    ];
    // `--skill-name` を落とすケースは base に入れない（他は base に足す）。
    const argv = args[0] === "--skill-name" ? base : [...base, "--skill-name", "demo", ...args];
    const res = spawnSync("node", argv, { cwd: repoRoot, encoding: "utf8" });
    expect(res.status, res.stderr).toBe(2);
    expect(res.stderr).toContain(message);
  });
});

// 使い捨てディレクトリの後始末（残すと次の run の入力になりうる）。
test.sequential("片付け", () => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  expect(dirs.every((d) => !existsSync(d))).toBe(true);
});
