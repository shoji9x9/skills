// 配布スキルの lib/check-cli.mjs（検査の CLI の誤りの出力・結果の JSON）のテスト。
// 同じ内容のコピーを parity-suite・parity-component・golden-dataset が持つ。
// コピーが同じ内容であることは identical-copies のチェックが確かめるが、カバレッジはファイルごとに測るので、どのコピーも実行する。

import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { isRecord } from "../../lib/guards.ts";
import * as golden from "../../../skills/golden-dataset/scripts/lib/check-cli.mjs";
import * as parityComponent from "../../../skills/parity-component/scripts/lib/check-cli.mjs";
import * as paritySuite from "../../../skills/parity-suite/scripts/lib/check-cli.mjs";

const COPIES = [
  { skill: "golden-dataset", lib: golden },
  { skill: "parity-component", lib: parityComponent },
  { skill: "parity-suite", lib: paritySuite },
];

/** write に渡された文字列を集める。 */
function sink() {
  const chunks: string[] = [];
  return { chunks, write: (s: string) => void chunks.push(s) };
}

describe.each(COPIES)("$skill の lib/check-cli.mjs", ({ lib }) => {
  test("usageFailer は理由と使い方を stderr に書いて 2 を返す", () => {
    const err = sink();
    expect(lib.usageFailer(err.write, "usage: x")("理由")).toBe(2);
    expect(err.chunks.join("")).toBe("error: 理由\nusage: x\n");
  });

  const shape = { tool: "t", version: "1" };

  test.each([
    {
      label: "指摘が無ければ 0 を返し、counts に指摘の件数 0 を足す",
      result: { structural: false, findings: [], counts: { cells: 2 } },
      code: 0,
      json: {
        tool: "t",
        version: "1",
        ok: true,
        judged: true,
        findings: [],
        counts: { cells: 2, findings: 0 },
      },
    },
    {
      label: "指摘があれば 1 を返す",
      result: { structural: false, findings: ["x"], counts: { cells: 2 } },
      code: 1,
      json: {
        tool: "t",
        version: "1",
        ok: false,
        judged: true,
        findings: ["x"],
        counts: { cells: 2, findings: 1 },
      },
    },
    {
      label: "構造の誤りなら 2 を返し、fields を書かず counts をそのまま書く",
      result: { structural: true, findings: ["x"], counts: { cells: 0 } },
      code: 2,
      json: {
        tool: "t",
        version: "1",
        ok: false,
        structural: true,
        findings: ["x"],
        counts: { cells: 0 },
      },
    },
    {
      label: "counts を持たない結果には counts を書かない",
      result: { structural: false, findings: [] },
      code: 0,
      json: { tool: "t", version: "1", ok: true, judged: true, findings: [] },
    },
    {
      label: "counts を持たない構造の誤りにも counts を書かない",
      result: { structural: true, findings: ["x"] },
      code: 2,
      json: { tool: "t", version: "1", ok: false, structural: true, findings: ["x"] },
    },
  ])("writeCheckResult: $label", ({ result, code, json }) => {
    const out = sink();
    const fields = { judged: true, findings: result.findings };
    expect(lib.writeCheckResult(out.write, result, { ...shape, fields })).toBe(code);
    const parsed: unknown = JSON.parse(out.chunks.join(""));
    expect(parsed).toEqual(json);
    // 出力は tool・version・ok の順で始まる（呼び出し元が fields で決めた位置を保つ）。
    expect(Object.keys(isRecord(parsed) ? parsed : {}).slice(0, 3)).toEqual([
      "tool",
      "version",
      "ok",
    ]);
  });

  test("writeCheckResult は fields に findings が無くても、fields の後に findings を書く", () => {
    const out = sink();
    const result = { structural: false, findings: ["x"], counts: { cells: 1 } };
    expect(lib.writeCheckResult(out.write, result, { ...shape, fields: { judged: true } })).toBe(1);
    const parsed: unknown = JSON.parse(out.chunks.join(""));
    expect(Object.keys(isRecord(parsed) ? parsed : {})).toEqual([
      "tool",
      "version",
      "ok",
      "judged",
      "findings",
      "counts",
    ]);
    expect(parsed).toMatchObject({ findings: ["x"], counts: { cells: 1, findings: 1 } });
  });

  test("cliIo は差し込まれた関数と cwd をそのまま返す", () => {
    const deps = {
      readFile: () => "x",
      cwd: "/tmp/x",
      write: () => {},
      writeErr: () => {},
    };
    expect(lib.cliIo(deps)).toEqual(deps);
  });

  test("cliIo は省いたものを node:fs・process.cwd()・process の stdout と stderr で補う", () => {
    const io = lib.cliIo({});
    expect(io.cwd).toBe(process.cwd());
    expect(io.readFile(fileURLToPath(import.meta.url))).toContain("cliIo は省いたもの");
    expect(typeof io.write).toBe("function");
    expect(typeof io.writeErr).toBe("function");
  });
});
