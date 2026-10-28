// isCliEntry のテスト。判定を誤ると、CLI として起動しても main を呼ばずに exit 0 で終わる。
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
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

/** dir で node を起動し、終了コードと stdout の 1 行目を返す。 */
const run = (...args: string[]) => {
  const r = spawnSync(process.execPath, args, {
    cwd: dir,
    encoding: "utf8",
    timeout: CHILD_TIMEOUT_MS,
  });
  return { status: r.status, stderr: r.stderr, out: r.stdout.trim() };
};

test.each([
  { label: "スクリプトを直接起動した", args: ["cli.ts"], expected: "true" },
  { label: "シンボリックリンクから起動した", args: ["link.ts"], expected: "true" },
  {
    label: "--preserve-symlinks-main を付けてリンクから起動した",
    args: ["--preserve-symlinks-main", "link.ts"],
    expected: "true",
  },
  { label: "別のスクリプトから import された", args: ["importer.ts"], expected: "false" },
  // node -e の後ろの引数は argv[1] になる。実在しないパスなので解決できない。
  {
    label: "node -e で import され、argv[1] が実在しないパスである",
    args: ["--input-type=module", "-e", 'await import("./cli.ts")', "missing"],
    expected: "false",
  },
  {
    label: "node -e で import され、argv[1] が無い",
    args: ["--input-type=module", "-e", 'await import("./cli.ts")'],
    expected: "false",
  },
])("$label ときは $expected を返す", ({ args, expected }) => {
  const r = run(...args);
  expect(r.status, r.stderr).toBe(0);
  expect(r.out).toBe(expected);
});

// 権限が無く実パスにできない argv[1] は、起動されたかを判定できないので、合格（exit 0）にしない。
test.skipIf(process.getuid?.() === 0)(
  "argv[1] を権限の理由で実パスにできないときは、例外で 0 以外の終了にする",
  () => {
    const locked = join(dir, "locked");
    mkdirSync(locked, { recursive: true });
    chmodSync(locked, 0o000);
    try {
      const r = run("--input-type=module", "-e", 'await import("./cli.ts")', join(locked, "x.ts"));
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain("起動パスを正規化できない");
    } finally {
      chmodSync(locked, 0o700);
    }
  },
);
