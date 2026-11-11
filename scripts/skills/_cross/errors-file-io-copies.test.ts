// parity-suite と spec-parity の lib/errors.mjs・lib/file-io.mjs のテスト。
// spec-parity は parity-suite の runtime-errors.mjs を同じ中身で同梱し、それが import する 2 つの部品も同じ中身でコピーする。
// 一致は scripts/gates/packaging/copies/identical-copies.json の組が確かめる。同じテストをコピーごとに実行する。

import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";
import * as paritySuiteErrors from "../../../skills/parity-suite/scripts/lib/errors.mjs";
import * as paritySuiteFileIo from "../../../skills/parity-suite/scripts/lib/file-io.mjs";
import * as specParityErrors from "../../../skills/spec-parity/scripts/lib/errors.mjs";
import * as specParityFileIo from "../../../skills/spec-parity/scripts/lib/file-io.mjs";

const COPIES = [
  { skill: "parity-suite", errors: paritySuiteErrors, io: paritySuiteFileIo },
  { skill: "spec-parity", errors: specParityErrors, io: specParityFileIo },
];

describe.each(COPIES)("$skill の lib/errors.mjs と lib/file-io.mjs", ({ errors, io: lib }) => {
  const { errorMessage } = errors;
  const { fileIo, writeFileAtomic } = lib;

  test("errorMessage: Error なら message を返し、Error でない値は String() で文字列にする", () => {
    expect(errorMessage(new Error("読めない"))).toBe("読めない");
    expect(errorMessage(new TypeError("型が違う"))).toBe("型が違う");
    // Error でないオブジェクトは、message を持っていても String() で文字列にする。
    expect(errorMessage({ message: "オブジェクトの message" })).toBe("[object Object]");
    expect(errorMessage({})).toBe("[object Object]");
    const fn = Object.assign(() => undefined, { message: "関数の message" });
    expect(errorMessage(fn)).toBe(String(fn));
    // 偽の値と真のプリミティブも、常に文字列を返す。
    const values = [null, undefined, 0, "", false, "文字列の例外", 42, true];
    expect(values.map(errorMessage)).toEqual([
      "null",
      "undefined",
      "0",
      "",
      "false",
      "文字列の例外",
      "42",
      "true",
    ]);
  });

  test("writeFileAtomic: 中身を書き、一時ファイルを残さない。既にあるファイルは置き換える", () => {
    const dir = makeTempDir("file-io-copies-");
    const file = join(dir, "out.json");
    writeFileSync(file, "old");
    writeFileAtomic(file, "new\n");
    expect(readFileSync(file, "utf8")).toBe("new\n");
    expect(readdirSync(dir)).toEqual(["out.json"]);
  });

  test("fileIo: 差し込まない関数は node:fs で補い、差し込んだ関数はそのまま使う", () => {
    const dir = makeTempDir("file-io-copies-");
    const file = join(dir, "a.txt");
    const io = fileIo({ cwd: dir });
    io.writeFile(file, "x");
    expect(io.readFile(file)).toBe("x");
    expect(io.cwd).toBe(dir);
    const written: string[] = [];
    const injected = fileIo({ writeFile: (p, text) => written.push(`${p}=${text}`) });
    injected.writeFile("p", "y");
    expect(written).toEqual(["p=y"]);
  });
});
