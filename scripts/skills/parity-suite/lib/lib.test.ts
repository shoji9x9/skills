// parity-suite の同梱スクリプトが共有する helper（scripts/lib/ の cli・errors・paths）のテスト。
//
// どれも他のスクリプトが戻り値をそのまま判定に使う。読めない入力（起動時のパスが無い・解決できないパス・
// message を持たない例外）で、合格として扱う値を返さないことを確かめる。

import { afterEach, expect, test } from "vitest";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { makeTempDir } from "../../../lib/testing/test-tmpdir.ts";
import { isCliEntry } from "../../../../skills/parity-suite/scripts/lib/cli.mjs";
import { errorMessage } from "../../../../skills/parity-suite/scripts/lib/errors.mjs";
import { realPathOf } from "../../../../skills/parity-suite/scripts/lib/paths.mjs";

const originalArgv = [...process.argv];
afterEach(() => {
  process.argv.splice(0, process.argv.length, ...originalArgv);
});

test("isCliEntry: 起動時のパスが無ければ CLI として扱わない", () => {
  // わざと起動時のパスを消す（node -e などで起動したとき）
  process.argv.length = 1;
  expect(isCliEntry(import.meta.url)).toBe(false);
});

test("isCliEntry: 実パスに解決できないときは、起動時のパスのまま突き合わせる", () => {
  const dir = makeTempDir("parity-suite-cli-");
  const missing = join(dir, "missing.mjs");
  process.argv[1] = missing;
  // 同じパスなら CLI として扱う（何もせずに終わるより、誤って起動する方を選ぶ）。
  expect(isCliEntry(pathToFileURL(missing).href)).toBe(true);
  // 別のパスなら CLI として扱わない。
  expect(isCliEntry(pathToFileURL(join(dir, "other.mjs")).href)).toBe(false);
});

test("isCliEntry: シンボリックリンクから起動しても、実パスが同じなら CLI として扱う", () => {
  const dir = makeTempDir("parity-suite-cli-");
  const real = join(dir, "script.mjs");
  writeFileSync(real, "");
  const link = join(dir, "link.mjs");
  symlinkSync(real, link);
  process.argv[1] = link;
  expect(isCliEntry(pathToFileURL(real).href)).toBe(true);
  writeFileSync(join(dir, "other.mjs"), "");
  expect(isCliEntry(pathToFileURL(join(dir, "other.mjs")).href)).toBe(false);
});

test("errorMessage: 例外の message を返し、偽の値はそのまま、プリミティブは undefined を返す", () => {
  expect(errorMessage(new Error("読めない"))).toBe("読めない");
  expect(errorMessage({ message: "オブジェクトの message" })).toBe("オブジェクトの message");
  const fn = Object.assign(() => undefined, { message: "関数の message" });
  expect(errorMessage(fn)).toBe("関数の message");
  expect(errorMessage({})).toBeUndefined();
  for (const falsy of [null, undefined, 0, "", false]) expect(errorMessage(falsy)).toBe(falsy);
  for (const primitive of ["文字列の例外", 42, true])
    expect(errorMessage(primitive)).toBeUndefined();
});

test("realPathOf: 存在しないパスも、実在する祖先の実パスに残りを継ぎ足して返す", () => {
  const dir = makeTempDir("parity-suite-paths-");
  const realDir = join(dir, "real");
  mkdirSync(realDir);
  const link = join(dir, "link");
  symlinkSync(realDir, link);
  const realRoot = realPathOf(realDir);
  expect(realRoot).not.toBeNull();
  // 実在するパスは実パスを返す。
  expect(realPathOf(link)).toBe(realRoot);
  // 途中がシンボリックリンクで、末尾がまだ存在しないパス。
  expect(realPathOf(join(link, "new", "file.json"))).toBe(
    join(String(realRoot), "new", "file.json"),
  );
});

test("realPathOf: ENOENT 以外で解決できないパスは null を返す（外でないとは扱わない）", () => {
  const dir = makeTempDir("parity-suite-paths-");
  // ファイルの下のパス（ENOTDIR）。
  const file = join(dir, "file.txt");
  writeFileSync(file, "");
  expect(realPathOf(join(file, "child"))).toBeNull();
  // 循環するシンボリックリンク（ELOOP）。
  symlinkSync(join(dir, "b"), join(dir, "a"));
  symlinkSync(join(dir, "a"), join(dir, "b"));
  expect(realPathOf(join(dir, "a", "child"))).toBeNull();
});
