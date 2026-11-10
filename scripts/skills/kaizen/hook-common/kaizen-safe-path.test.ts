// kaizen の共通ライブラリ（kaizen-hook-common.sh）の、`.kaizen` の下に書く・消すときの判定のテスト。
//
// `.kaizen` とその下の名前はリポジトリの中身で決まるので、commit された symlink でありうる。
// 各スクリプトは kaizen_path_is_safe と kaizen_safe_* を通して書き込み・削除をするので、判定をここで押さえる。
//
// 状態空間の軸:
//
// | 軸                       | 値                                                                   |
// | ------------------------ | -------------------------------------------------------------------- |
// | symlink の位置           | 無い / パス自身 / 親 / `.kaizen` / `.kaizen` の中の途中 / `.kaizen` より上 |
// | パスが `.kaizen` を含むか | 含む / 含まない                                                      |
// | 書き方                   | 末尾のスラッシュの有無 / 空                                          |
import { describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir } from "../../../lib/testing/test-tmpdir.ts";
import { CHILD_TIMEOUT_MS } from "../../../lib/testing/child-timeout.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const lib = join(repoRoot, "skills/kaizen/scripts/kaizen-hook-common.sh");

/** 共通ライブラリを読んで、cwd でスクリプトを実行する。 */
function sh(
  cwd: string,
  script: string,
  { args = [], input = "" }: { args?: string[]; input?: string } = {},
) {
  return spawnSync("bash", ["-c", `. "$0"; ${script}`, lib, ...args], {
    timeout: CHILD_TIMEOUT_MS,
    cwd,
    input,
    encoding: "utf8",
  });
}

function isSafe(cwd: string, path: string) {
  return sh(cwd, 'kaizen_path_is_safe "$1"', { args: [path] }).status;
}

/** 外のディレクトリと、その中の目印のファイルを作る。 */
function outsideDir() {
  const outside = makeTempDir("kaizen-safe-path-outside-");
  writeFileSync(join(outside, "x.md"), "ORIGINAL");
  return outside;
}

describe("kaizen_path_is_safe", () => {
  test(".. を含むパスは、symlink を通らなくても安全としない", () => {
    // `.kaizen/../.kaizen/x.md` は、文字の上では最後の `.kaizen` で判定を終えるが、実際には先頭の `.kaizen` を通る。
    const dir = makeTempDir("kaizen-safe-path-");
    mkdirSync(join(dir, ".kaizen"), { recursive: true });
    expect(isSafe(dir, ".kaizen/../.kaizen/x.md")).toBe(1);
    expect(isSafe(dir, "../x.md")).toBe(1);
    expect(isSafe(dir, ".kaizen/..")).toBe(1);
    // `..` を名前の一部に含むだけのパスは対象にしない。
    expect(isSafe(dir, ".kaizen/a..b.md")).toBe(0);
  });

  test("symlink を通らない .kaizen の下のパスは安全とする", () => {
    const dir = makeTempDir("kaizen-safe-path-");
    mkdirSync(join(dir, ".kaizen", "archive"), { recursive: true });
    expect(isSafe(dir, ".kaizen/x.md")).toBe(0);
    expect(isSafe(dir, ".kaizen/archive/x.md")).toBe(0);
    expect(isSafe(dir, ".kaizen")).toBe(0);
    expect(isSafe(dir, join(dir, ".kaizen", "archive", "x.md"))).toBe(0);
  });

  test.each([
    [
      "パス自身",
      (dir: string, outside: string) => {
        mkdirSync(join(dir, ".kaizen"));
        symlinkSync(join(outside, "x.md"), join(dir, ".kaizen", "x.md"));
      },
      ".kaizen/x.md",
    ],
    [
      "親の .kaizen",
      (dir: string, outside: string) => symlinkSync(outside, join(dir, ".kaizen")),
      ".kaizen/x.md",
    ],
    [
      "パス自身が symlink の .kaizen",
      (dir: string, outside: string) => symlinkSync(outside, join(dir, ".kaizen")),
      ".kaizen",
    ],
    [
      "末尾にスラッシュを付けた symlink の .kaizen",
      (dir: string, outside: string) => symlinkSync(outside, join(dir, ".kaizen")),
      ".kaizen/",
    ],
    [
      ".kaizen の中の途中のディレクトリ",
      (dir: string, outside: string) => {
        mkdirSync(join(dir, ".kaizen"));
        symlinkSync(outside, join(dir, ".kaizen", "archive"));
      },
      ".kaizen/archive/x.md",
    ],
    [
      "2 段上の .kaizen",
      (dir: string, outside: string) => {
        mkdirSync(join(outside, "archive"));
        symlinkSync(outside, join(dir, ".kaizen"));
      },
      ".kaizen/archive/x.md",
    ],
  ])("%s が symlink なら安全としない", (_name, arrange, path) => {
    const dir = makeTempDir("kaizen-safe-path-");
    const outside = outsideDir();
    arrange(dir, outside);
    expect(isSafe(dir, path)).toBe(1);
  });

  test(".kaizen より上の symlink は見ない（/tmp が symlink の環境もある）", () => {
    const dir = makeTempDir("kaizen-safe-path-");
    const real = join(dir, "real");
    mkdirSync(join(real, ".kaizen"), { recursive: true });
    symlinkSync(real, join(dir, "link"));
    expect(isSafe(dir, "link/.kaizen/x.md")).toBe(0);
  });

  test(".kaizen を含まないパスは、パス自身と親だけを見る", () => {
    const dir = makeTempDir("kaizen-safe-path-");
    const outside = outsideDir();
    mkdirSync(join(outside, "sub"));
    symlinkSync(outside, join(dir, "linked"));
    expect(isSafe(dir, "linked/x.md")).toBe(1);
    expect(isSafe(dir, "linked/sub/x.md")).toBe(0);
  });

  test("空のパスは安全としない", () => {
    const dir = makeTempDir("kaizen-safe-path-");
    expect(isSafe(dir, "")).toBe(1);
  });
});

describe("kaizen_safe_*", () => {
  test("kaizen_safe_rm は、symlink のファイルはリンクだけを消し、親が symlink なら消さない", () => {
    const dir = makeTempDir("kaizen-safe-path-");
    const outside = outsideDir();
    mkdirSync(join(dir, ".kaizen"));
    symlinkSync(join(outside, "x.md"), join(dir, ".kaizen", "link.md"));
    const leaf = sh(dir, 'kaizen_safe_rm "$1"', { args: [".kaizen/link.md"] });
    expect(leaf.status, leaf.stderr).toBe(0);
    expect(existsSync(join(dir, ".kaizen", "link.md"))).toBe(false);
    expect(readFileSync(join(outside, "x.md"), "utf8")).toBe("ORIGINAL");

    const other = makeTempDir("kaizen-safe-path-");
    symlinkSync(outside, join(other, ".kaizen"));
    const parent = sh(other, 'kaizen_safe_rm "$1"', { args: [".kaizen/x.md"] });
    expect(parent.status).toBe(1);
    expect(parent.stderr).toContain("symlink");
    expect(readFileSync(join(outside, "x.md"), "utf8")).toBe("ORIGINAL");
  });

  test("kaizen_safe_write は、symlink を通るなら書かずに 1 を返し、通らなければ書く", () => {
    const dir = makeTempDir("kaizen-safe-path-");
    const outside = outsideDir();
    mkdirSync(join(dir, ".kaizen"));
    symlinkSync(join(outside, "x.md"), join(dir, ".kaizen", "link.md"));
    const refused = sh(dir, 'kaizen_safe_write "$1"', { args: [".kaizen/link.md"], input: "NEW" });
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain("symlink");
    expect(readFileSync(join(outside, "x.md"), "utf8")).toBe("ORIGINAL");

    const written = sh(dir, 'kaizen_safe_write "$1"', { args: [".kaizen/plain.md"], input: "NEW" });
    expect(written.status, written.stderr).toBe(0);
    expect(readFileSync(join(dir, ".kaizen", "plain.md"), "utf8")).toBe("NEW");
  });

  test("kaizen_safe_mv は、移動先がディレクトリへの symlink なら移さない", () => {
    const dir = makeTempDir("kaizen-safe-path-");
    const outside = makeTempDir("kaizen-safe-path-outside-");
    mkdirSync(join(dir, ".kaizen"));
    writeFileSync(join(dir, "src"), "DATA");
    symlinkSync(outside, join(dir, ".kaizen", "dest"));
    const result = sh(dir, 'kaizen_safe_mv "$1" "$2"', { args: ["src", ".kaizen/dest"] });
    expect(result.status).toBe(1);
    expect(existsSync(join(dir, "src"))).toBe(true);
    expect(existsSync(join(outside, "src"))).toBe(false);
  });

  test("kaizen_safe_mkdir は、symlink の .kaizen の下に作らない", () => {
    const dir = makeTempDir("kaizen-safe-path-");
    const outside = makeTempDir("kaizen-safe-path-outside-");
    symlinkSync(outside, join(dir, ".kaizen"));
    const result = sh(dir, 'kaizen_safe_mkdir "$1"', { args: [".kaizen/archive"] });
    expect(result.status).toBe(1);
    expect(existsSync(join(outside, "archive"))).toBe(false);
  });
});
