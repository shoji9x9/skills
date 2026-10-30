// parity-diff の lib/check-args.mjs（検査の CLI の引数の読み取り）のテスト。
// 使い方の誤りは理由と使い方を、必須の引数が無いときは使い方だけを stderr に書き、null を返す。

import { afterEach, expect, test, vi } from "vitest";
import { parseCheckArgs } from "../../../skills/parity-diff/scripts/lib/check-args.mjs";

const SPEC = { values: ["--metadata", "--features"], required: ["metadata"], usage: "usage: x\n" };

afterEach(() => {
  vi.restoreAllMocks();
});

/** stderr に書かれた文字列を集める。 */
function captureStderr() {
  const chunks: string[] = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    chunks.push(String(chunk));
    return true;
  });
  return chunks;
}

test("parseCheckArgs: 名前から `--` を外した表を返す", () => {
  const err = captureStderr();
  expect(parseCheckArgs(["--metadata", "m.json", "--features", "f.md"], SPEC)).toEqual({
    metadata: "m.json",
    features: "f.md",
  });
  expect(err).toEqual([]);
});

test("parseCheckArgs: 使い方の誤りは理由と使い方を書いて null を返す", () => {
  const err = captureStderr();
  expect(parseCheckArgs(["--metadata"], SPEC)).toBeNull();
  expect(err.join("")).toBe("error: --metadata に値が無い\nusage: x\n");
});

test("parseCheckArgs: 必須の引数が無ければ使い方だけを書いて null を返す", () => {
  const err = captureStderr();
  expect(parseCheckArgs(["--features", "f.md"], SPEC)).toBeNull();
  expect(err.join("")).toBe("usage: x\n");
});
