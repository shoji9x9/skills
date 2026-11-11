// spec-parity の判定のスクリプトを、子プロセスの CLI として起動する回帰テスト（Issue #565）。
//
// 関数の粒度のテスト（*-check.test.ts）は、メモリ上のファイルで main を呼ぶ。ここでは、引数から main までのつなぎと、
// 本物のファイルの読み書き・終了コードの取り決め（0 ＝ 合格、1 ＝ 判定の失敗、2 ＝ 判定できない）を、CLI ごとに確かめる。

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";
import { parseJsonAs } from "../../lib/parse-as.ts";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";
import { NEW_DIR, SLUG_DIR, VERIFY, convergedFs, overflowRecords } from "./verify-fixture.ts";

const SCRIPTS = join(import.meta.dirname, "../../../skills/spec-parity/scripts");

/** メモリ上の成果物一式を、一時ディレクトリへ書き出す。 */
function materialize(files: Map<string, string>): string {
  const root = makeTempDir("spec-parity-cli-");
  for (const [rel, text] of files) {
    const path = join(root, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
  return root;
}

function cli(script: string, args: string[], cwd: string) {
  const r = spawnSync(process.execPath, [join(SCRIPTS, script), ...args], {
    cwd,
    encoding: "utf8",
    timeout: CHILD_TIMEOUT_MS,
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe("overflow-check.mjs の CLI", () => {
  const args = [
    "--metadata",
    `${SLUG_DIR}/metadata.json`,
    "--measurements",
    `${NEW_DIR}/overflow.json`,
    "--target",
    "stg",
  ];

  test("はみ出しが無ければ exit 0 で、--write が verify-metadata.json に書く", () => {
    const root = materialize(convergedFs().files);
    const r = cli("overflow-check.mjs", [...args, "--write", VERIFY], root);
    expect(r.code).toBe(0);
    const doc = parseJsonAs<{ overflow: { ok: boolean } }>(
      readFileSync(join(root, VERIFY), "utf8"),
    );
    expect(doc.overflow.ok).toBe(true);
  });

  test("はみ出しがあれば exit 1", () => {
    const fs = convergedFs();
    const rec = overflowRecords();
    rec.records = rec.records.map((x, i) => (i === 0 ? { ...x, scroll_width: 999 } : x));
    fs.put(`${NEW_DIR}/overflow.json`, rec);
    const r = cli("overflow-check.mjs", args, materialize(fs.files));
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("はみ出し");
  });

  test("測定の記録が無ければ exit 2", () => {
    const fs = convergedFs();
    fs.remove(`${NEW_DIR}/overflow.json`);
    expect(cli("overflow-check.mjs", args, materialize(fs.files)).code).toBe(2);
  });
});

describe("convergence-check.mjs の CLI", () => {
  const args = ["--slug-dir", SLUG_DIR, "--target", "stg"];

  test("収束する一式なら exit 0 で、--write が converged: true を書く", () => {
    const root = materialize(convergedFs().files);
    const r = cli("convergence-check.mjs", [...args, "--write"], root);
    expect(r.code).toBe(0);
    const doc = parseJsonAs<{ converged: boolean }>(readFileSync(join(root, VERIFY), "utf8"));
    expect(doc.converged).toBe(true);
  });

  test("人による確認の承認が無ければ exit 1", () => {
    const fs = convergedFs();
    const doc = parseJsonAs<Record<string, unknown>>(fs.files.get(VERIFY) ?? "{}");
    fs.put(VERIFY, {
      ...doc,
      human_review: { commit: "x", screens: [{ page: "/" }], approval: null },
    });
    expect(cli("convergence-check.mjs", args, materialize(fs.files)).code).toBe(1);
  });

  test("新側の結果が無ければ exit 2", () => {
    const fs = convergedFs();
    fs.remove(`${NEW_DIR}/suite-report.json`);
    expect(cli("convergence-check.mjs", args, materialize(fs.files)).code).toBe(2);
  });
});

describe("strength-check.mjs の CLI", () => {
  const FILE = "tests/orders/strength/faults.e2e.ts";
  const plan = {
    version: "1",
    slug: "orders",
    controls: [`${FILE} › 対照`],
    faults: [{ id: "f", class: "構造", test: `${FILE} › 故障`, observed: "h1 が h2 になった" }],
  };
  const result = (title: string, status: string, code?: string) => ({
    file: FILE,
    titlePath: [title],
    targetId: "current",
    selected: true,
    status,
    attempts: [{ status, ...(code ? { error: { code, message: "" } } : {}) }],
  });
  const files = (faultStatus: string, code?: string) =>
    new Map([
      [`${SLUG_DIR}/strength-plan.json`, JSON.stringify(plan)],
      [
        `${SLUG_DIR}/strength-report.json`,
        JSON.stringify({
          schemaVersion: "report-1",
          run: { results: [result("対照", "passed"), result("故障", faultStatus, code)] },
        }),
      ],
    ]);
  const args = [
    "--plan",
    `${SLUG_DIR}/strength-plan.json`,
    "--report",
    `${SLUG_DIR}/strength-report.json`,
  ];

  test("故障が assertion で赤くなれば exit 0", () => {
    expect(
      cli("strength-check.mjs", args, materialize(files("failed", "ASSERTION_FAILED"))).code,
    ).toBe(0);
  });

  test("故障が緑のままなら exit 1", () => {
    expect(cli("strength-check.mjs", args, materialize(files("passed"))).code).toBe(1);
  });

  test("引数が欠けると exit 2", () => {
    expect(cli("strength-check.mjs", ["--plan", "x.json"], materialize(new Map())).code).toBe(2);
  });
});
