// next-release-version.ts のテスト。semantic-release の戻り値から version を取り、ログの文言では決めないことを確かめる。

import { afterEach, expect, test, vi } from "vitest";
import { main, type Release, versionOf } from "./next-release-version.ts";

afterEach(() => vi.restoreAllMocks());

test.each([
  ["X.Y.Z", { nextRelease: { version: "1.170.1" } }, "1.170.1"],
  ["リリースが無い（false）", false, null],
])("versionOf: %s", (_name, result, expected) => {
  expect(versionOf(result)).toBe(expected);
});

test.each([
  ["nextRelease が無い", {}],
  ["version が無い", { nextRelease: {} }],
  ["version が数でない", { nextRelease: { version: 1 } }],
  ["プレリリースの付いた version", { nextRelease: { version: "1.0.0-beta.1" } }],
  ["前後に文字がある version", { nextRelease: { version: " 1.0.0" } }],
  ["null", null],
  ["undefined", undefined],
])("versionOf: %s ときは例外にする", (_name, result) => {
  expect(() => versionOf(result)).toThrow("X.Y.Z の形でない");
});

/** semantic-release の偽物。ログに version らしい文言を書いてから、戻り値を返す。 */
const fakeRelease = (result: unknown) =>
  vi.fn<Release>(async (_options, ctx) => {
    ctx.stdout.write("Analyzing commit: chore: The next release version is 9.9.9\n");
    return result;
  });

test("main: version は戻り値から取り、commit の message が書いたログの文言を使わない", async () => {
  const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  const run = fakeRelease({ nextRelease: { version: "1.2.3" } });
  expect(await main(run)).toBe(0);
  expect(run).toHaveBeenCalledWith(
    { dryRun: true },
    { stdout: process.stderr, stderr: process.stderr },
  );
  expect(out.mock.calls.map((c) => String(c[0]))).toEqual(["1.2.3\n"]);
  expect(err.mock.calls.map((c) => String(c[0])).join("")).toContain("9.9.9");
});

test("main: リリースが無ければ exit 1 で、何も出さない", async () => {
  const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  vi.spyOn(process.stderr, "write").mockReturnValue(true);
  expect(await main(fakeRelease(false))).toBe(1);
  expect(out).not.toHaveBeenCalled();
});

test("main: semantic-release の失敗と不正な version は exit 2", async () => {
  const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  vi.spyOn(process.stderr, "write").mockReturnValue(true);
  const err = vi.spyOn(console, "error").mockReturnValue();
  const failing = vi.fn<Release>(async () => {
    throw new Error("ENOGITREPO");
  });
  expect(await main(failing)).toBe(2);
  expect(await main(fakeRelease({ nextRelease: { version: "x" } }))).toBe(2);
  expect(out).not.toHaveBeenCalled();
  expect(err.mock.calls.map((c) => String(c[0])).join("\n")).toContain("ENOGITREPO");
});
