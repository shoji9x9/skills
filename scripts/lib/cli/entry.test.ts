// isCliEntry のテスト。判定を誤ると、CLI として起動しても main を呼ばずに exit 0 で終わる。
import { spawnSync } from "node:child_process";
import { symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, expect, test } from "vitest";
import { CHILD_TIMEOUT_MS } from "../testing/child-timeout.ts";
import { makeSharedTempDir } from "../testing/test-tmpdir.ts";

const ENTRY = pathToFileURL(join(import.meta.dirname, "entry.ts")).href;
let dir = "";

beforeAll(() => {
  dir = makeSharedTempDir("cli-entry-");
  // 起動されたかを出力するスクリプトと、それを import するだけのスクリプト。
  writeFileSync(
    join(dir, "cli.ts"),
    `import { isCliEntry } from ${JSON.stringify(ENTRY)};\nconsole.log(isCliEntry(import.meta.url));\n`,
  );
  writeFileSync(join(dir, "importer.ts"), 'await import("./cli.ts");\n');
  symlinkSync(join(dir, "cli.ts"), join(dir, "link.ts"));
});

const run = (...args: string[]) =>
  spawnSync(process.execPath, args, { encoding: "utf8", timeout: CHILD_TIMEOUT_MS });

test.each([
  { label: "スクリプトを直接起動した", args: ["cli.ts"], expected: "true" },
  { label: "シンボリックリンクから起動した", args: ["link.ts"], expected: "true" },
  {
    label: "--preserve-symlinks-main を付けてリンクから起動した",
    args: ["--preserve-symlinks-main", "link.ts"],
    expected: "true",
  },
  { label: "別のスクリプトから import された", args: ["importer.ts"], expected: "false" },
])("$label ときは $expected を返す", ({ args, expected }) => {
  const r = spawnSync(process.execPath, args, {
    cwd: dir,
    encoding: "utf8",
    timeout: CHILD_TIMEOUT_MS,
  });
  expect(r.status, r.stderr).toBe(0);
  expect(r.stdout.trim()).toBe(expected);
});

test("node に渡したスクリプトが無いときは false を返す（node -e など）", () => {
  const r = run(
    "--input-type=module",
    "-e",
    `import { isCliEntry } from ${JSON.stringify(ENTRY)}; console.log(isCliEntry(${JSON.stringify(pathToFileURL(join(dir, "cli.ts")).href)}));`,
  );
  expect(r.status, r.stderr).toBe(0);
  expect(r.stdout.trim()).toBe("false");
});
