// catch で受けた値を読む helper の回帰テスト。
//
// | 軸           | 値                                                              |
// | ------------ | --------------------------------------------------------------- |
// | 投げられた値 | Error / Node のシステムエラー / code が undefined の Error / 文字列 / object |
//
// 期待値は各関数の doc コメント（Error でなければ String(error)、システムエラーなら code）から決める。
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { errorCodeOrMessage, errorMessage, isErrnoException, spawnEnd } from "./errors.ts";
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

// caught は、body が例外を投げなければその場で失敗する（読む関数を、例外でない値で確かめてしまわないため）。
test("caught は、例外が出なければ失敗する", () => {
  expect(() => caught(() => undefined)).toThrow("例外が投げられなかった");
});

// spawnEnd の期待値は doc コメント（終了コード・シグナル・起動できなかった理由）から決める。
test.each([
  { label: "終了コードで終わった", res: { status: 3, signal: null }, end: "exit 3" },
  {
    label: "シグナルで止まった",
    res: { status: null, signal: "SIGTERM" as const },
    end: "signal SIGTERM",
  },
  {
    label: "起動できなかった",
    res: { status: null, signal: null, error: new Error("spawnSync git ENOENT") },
    end: "起動できない: spawnSync git ENOENT",
  },
])("spawnEnd は、$label ときの終わり方を書く", ({ res, end }) => {
  expect(spawnEnd(res)).toBe(end);
});
