// catch で受けた値を読む helper の回帰テスト。
//
// | 軸           | 値                                                              |
// | ------------ | --------------------------------------------------------------- |
// | 投げられた値 | Error / Node のシステムエラー / code が undefined の Error / 文字列 / object |
//
// 期待値は各関数の doc コメント（Error でなければ String(error)、システムエラーなら code）から決める。
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { errorCodeOrMessage, errorMessage, isErrnoException } from "./errors.ts";

function caught(body: () => unknown): unknown {
  try {
    body();
  } catch (error) {
    return error;
  }
  throw new Error("例外が投げられなかった");
}

const enoent = caught(() => readFileSync("/nonexistent/errors-test"));
const withUndefinedCode = Object.assign(new Error("code が空"), { code: undefined });

test.each([
  ["Error", new Error("failure"), "failure", "failure", false],
  [
    "Node のシステムエラー",
    enoent,
    expect.stringMatching(/^ENOENT: no such file/u),
    "ENOENT",
    true,
  ],
  ["code が undefined の Error", withUndefinedCode, "code が空", "code が空", true],
  ["文字列", "plain failure", "plain failure", "plain failure", false],
  ["object", { reason: "x" }, "[object Object]", "[object Object]", false],
])("%s を読む", (_label, value, message, codeOrMessage, errno) => {
  expect(errorMessage(value)).toEqual(message);
  expect(errorCodeOrMessage(value)).toBe(codeOrMessage);
  expect(isErrnoException(value)).toBe(errno);
});
