// kaizen のスクリプトのテストが使う環境の部品（kaizen-config-env.ts）のテスト。
import { existsSync, lstatSync, mkdirSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { expect, test } from "vitest";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";
import { kaizenEnv, pathWithout } from "./kaizen-config-env.ts";

test("KAIZEN_* を消し、XDG_CONFIG_HOME を一時ディレクトリに向け、extra の undefined は消して値は足す", () => {
  const prev = process.env.KAIZEN_TEST_LEFTOVER;
  process.env.KAIZEN_TEST_LEFTOVER = "x";
  try {
    const env = kaizenEnv("/d", { HOME: undefined, ADDED: "1" });
    expect(env.KAIZEN_TEST_LEFTOVER).toBeUndefined();
    expect(env.XDG_CONFIG_HOME).toBe("/d/.test-xdg");
    expect(env.HOME).toBeUndefined();
    expect(env.ADDED).toBe("1");
    expect(env.PATH?.split(":")[0]).toBe(process.execPath.replace(/\/[^/]+$/, ""));
  } finally {
    if (prev === undefined) delete process.env.KAIZEN_TEST_LEFTOVER;
    else process.env.KAIZEN_TEST_LEFTOVER = prev;
  }
});

test("pathWithout は names だけを除き、読めないディレクトリを飛ばし、同じ名前は先のディレクトリを使う", () => {
  const dir = makeTempDir("kaizen-path-");
  const a = join(dir, "a");
  const b = join(dir, "b");
  mkdirSync(a);
  mkdirSync(b);
  for (const [d, n] of [
    [a, "node"],
    [a, "git"],
    [b, "git"],
    [b, "jq"],
  ] as const)
    writeFileSync(join(d, n), "");
  const bin = pathWithout(dir, ["node"], [join(dir, "missing"), a, b].join(delimiter));
  expect(existsSync(join(bin, "node"))).toBe(false);
  expect(lstatSync(join(bin, "git")).isSymbolicLink()).toBe(true);
  expect(existsSync(join(bin, "jq"))).toBe(true);
});
