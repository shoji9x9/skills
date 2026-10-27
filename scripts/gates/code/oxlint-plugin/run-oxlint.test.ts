// テストから oxlint を起動する補助（run-oxlint.ts）のテスト（Issue #658）。
// oxlint の出力を読めないときに、違反 0 件として扱わず例外にすることを確かめる。
import { expect, test } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ruleOf, runOxlint, toDiagnostic, UNUSED_DIRECTIVE } from "./run-oxlint.ts";
import { CHILD_TIMEOUT_MS } from "../../../lib/testing/child-timeout.ts";
import { makeTempDir } from "../../../lib/testing/test-tmpdir.ts";

test("ruleOf: 組み込みのルールは名前だけ、プラグインのルールは <プラグイン>/<名前> にし、読めない code は例外にする", () => {
  expect(ruleOf("eslint(max-params)")).toBe("max-params");
  expect(ruleOf("skills-repo(max-lines-per-function-except-describe)")).toBe(
    "skills-repo/max-lines-per-function-except-describe",
  );
  expect(ruleOf("import(no-cycle)")).toBe("import/no-cycle");
  expect(() => ruleOf("max-params")).toThrow(/code を読めない/);
});

const SPAN = { offset: 0, length: 1, line: 3, column: 1 };

test("toDiagnostic: 診断を読み、使われていない disable コメントは専用の rule にし、欄の欠けた診断と JS プラグインの例外は例外にする", () => {
  const base = {
    code: "eslint(max-params)",
    filename: "a.ts",
    message: "m",
    labels: [{ span: SPAN }],
  };
  expect(toDiagnostic(base)).toEqual({
    file: "a.ts",
    rule: "max-params",
    line: 3,
    message: "m",
  });
  const unused = {
    filename: "a.ts",
    message: "Unused oxlint-disable directive (no problems were reported).",
    labels: [{ span: SPAN }],
  };
  expect(toDiagnostic(unused).rule).toBe(UNUSED_DIRECTIVE);
  expect(() => toDiagnostic({ ...base, labels: [] })).toThrow(/形を読めない/);
  expect(() => toDiagnostic({ ...base, filename: 1 })).toThrow(/形を読めない/);
  expect(() => toDiagnostic(null)).toThrow(/形を読めない/);
  expect(() => toDiagnostic({ message: "Error running JS plugin.", labels: [] })).toThrow(
    /JS プラグインの例外/,
  );
});

test("runOxlint: 構文の誤りのファイルは、違反 0 件として扱わず、プラグインの例外と区別して例外にする", () => {
  const dir = makeTempDir("run-oxlint-");
  writeFileSync(join(dir, "a.ts"), "const z = 1;\nconst z = 2;\n");
  expect(() => runOxlint([join(dir, "a.ts")], { timeout: CHILD_TIMEOUT_MS })).toThrow(
    /構文の誤りなど/,
  );
});

test("runOxlint: 設定を読めずに exit 1・0 以外で終わったときは、違反 0 件として扱わず例外にする", () => {
  const dir = makeTempDir("run-oxlint-");
  writeFileSync(join(dir, "a.ts"), "export {};\n");
  expect(() =>
    runOxlint(["-c", join(dir, "missing.json"), join(dir, "a.ts")], { timeout: CHILD_TIMEOUT_MS }),
  ).toThrow(/oxlint を実行できない/);
});
