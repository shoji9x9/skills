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
import { caught } from "./errors-helpers.ts";

const enoent = caught(() => readFileSync("/nonexistent/errors-test"));
const withUndefinedCode = Object.assign(new Error("code が空"), { code: undefined });

test.each([
  {
    label: "Error",
    value: new Error("failure"),
    message: "failure",
    codeOrMessage: "failure",
    errno: false,
  },
  {
    label: "Node のシステムエラー",
    value: enoent,
    message: expect.stringMatching(/^ENOENT: no such file/u),
    codeOrMessage: "ENOENT",
    errno: true,
  },
  {
    label: "code が undefined の Error",
    value: withUndefinedCode,
    message: "code が空",
    codeOrMessage: "code が空",
    errno: true,
  },
  {
    label: "文字列",
    value: "plain failure",
    message: "plain failure",
    codeOrMessage: "plain failure",
    errno: false,
  },
  {
    label: "object",
    value: { reason: "x" },
    message: "[object Object]",
    codeOrMessage: "[object Object]",
    errno: false,
  },
])("$label を読む", ({ value, message, codeOrMessage, errno }) => {
  expect(errorMessage(value)).toEqual(message);
  expect(errorCodeOrMessage(value)).toBe(codeOrMessage);
  expect(isErrnoException(value)).toBe(errno);
});
