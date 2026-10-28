// parity-diff の lib/flag-opts.mjs（coverage-check.mjs と pending-triage-check.mjs の引数の読み取り）のテスト。
// 使い方の誤りは stderr に書いて null を返すので、stderr を差し替えて確かめる。

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { parseFlagOpts } from "../../../skills/parity-diff/scripts/lib/flag-opts.mjs";

const KNOWN = ["--metadata", "--coverage"];
const USAGE = "usage: tool\n";
let stderr: string[] = [];

beforeEach(() => {
  stderr = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

test("受け付ける名前と値の組を、-- を外した名前で読む", () => {
  expect(parseFlagOpts(["--metadata", "m.json", "--coverage", "c.json"], KNOWN, USAGE)).toEqual({
    metadata: "m.json",
    coverage: "c.json",
  });
  expect(parseFlagOpts([], KNOWN, USAGE)).toEqual({});
  expect(stderr).toEqual([]);
});

test.each([
  { label: "知らない引数", argv: ["--foo", "x"], message: `unknown argument: --foo\n${USAGE}` },
  { label: "値が無い", argv: ["--metadata"], message: `error: --metadata に値が無い\n${USAGE}` },
  {
    label: "値の代わりに次の名前",
    argv: ["--metadata", "--coverage", "c.json"],
    message: `error: --metadata に値が無い\n${USAGE}`,
  },
  {
    label: "同じ名前を 2 回",
    argv: ["--metadata", "a", "--metadata", "b"],
    message: `error: --metadata が複数回指定されている\n${USAGE}`,
  },
])("$label なら、理由と使い方を stderr に書いて null を返す", ({ argv, message }) => {
  expect(parseFlagOpts(argv, KNOWN, USAGE)).toBeNull();
  expect(stderr.join("")).toBe(message);
});
