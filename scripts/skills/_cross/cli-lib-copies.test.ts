// 配布スキルの lib/cli.mjs の isCliEntry のテスト。同じ内容のコピーを持つスキルのうち、
// スキルの側に isCliEntry のテストを持たないもの（COPIES）を、コピーごとに実行する。
// コピーが同じ内容であることは identical-copies のチェックが確かめるが、カバレッジはファイルごとに測るので、どのコピーも実行する。
//
// 同梱スクリプトは isCliEntry が真のときだけ main() を呼ぶ。判定を誤ると、CLI として起動しても何も出力せずに exit 0 で終わる。
// 起動時のパス（process.argv[1]）が無いときと、実パスに解決できないときの分岐も、状態を作って確かめる。

import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { isCliEntry as golden } from "../../../skills/golden-dataset/scripts/lib/cli.mjs";
import { isCliEntry as issueStart } from "../../../skills/issue-start/scripts/lib/cli.mjs";
import { isCliEntry as parityComponent } from "../../../skills/parity-component/scripts/lib/cli.mjs";
import { isCliEntry as parityDiff } from "../../../skills/parity-diff/scripts/lib/cli.mjs";
import { isCliEntry as replaceStrategy } from "../../../skills/replace-strategy/scripts/lib/cli.mjs";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";

const COPIES = [
  { skill: "golden-dataset", isCliEntry: golden },
  { skill: "issue-start", isCliEntry: issueStart },
  { skill: "parity-component", isCliEntry: parityComponent },
  { skill: "parity-diff", isCliEntry: parityDiff },
  { skill: "replace-strategy", isCliEntry: replaceStrategy },
];

let savedArgv: string[];
beforeEach(() => {
  savedArgv = process.argv;
});
afterEach(() => {
  process.argv = savedArgv;
});

/** process.argv[1] を entry にする。undefined なら argv[1] を持たない。 */
function setEntry(entry: string | undefined) {
  process.argv = entry === undefined ? [process.execPath] : [process.execPath, entry];
}

/** 一時ディレクトリに、モジュールの実体とそれを指すシンボリックリンクを作る。 */
function moduleFiles() {
  const dir = makeTempDir("cli-lib-");
  mkdirSync(join(dir, "real"));
  const real = join(dir, "real", "tool.mjs");
  writeFileSync(real, "");
  const link = join(dir, "link.mjs");
  symlinkSync(real, link);
  const other = join(dir, "real", "other.mjs");
  writeFileSync(other, "");
  return { dir, real, link, other };
}

describe.each(COPIES)("$skill の lib/cli.mjs", ({ isCliEntry }) => {
  test("起動時のパスがモジュールの実体と同じなら CLI として起動されたと判定する", () => {
    const { real } = moduleFiles();
    setEntry(real);
    expect(isCliEntry(pathToFileURL(real).href)).toBe(true);
  });

  test("シンボリックリンクから起動しても、実体のモジュールと同じなら CLI として起動されたと判定する", () => {
    const { real, link } = moduleFiles();
    setEntry(link);
    expect(isCliEntry(pathToFileURL(real).href)).toBe(true);
    // --preserve-symlinks-main では呼び出し元の URL もリンクのままになる。両辺を解決するので、この向きも真になる。
    setEntry(real);
    expect(isCliEntry(pathToFileURL(link).href)).toBe(true);
  });

  test("誤検知しないことの確認: 別のファイルから起動されたら CLI として起動されたと判定しない", () => {
    const { real, other } = moduleFiles();
    setEntry(other);
    expect(isCliEntry(pathToFileURL(real).href)).toBe(false);
  });

  test("起動時のパスが無い（node -e や REPL から import した）ときは CLI として起動されたと判定しない", () => {
    const { real } = moduleFiles();
    setEntry(undefined);
    expect(isCliEntry(pathToFileURL(real).href)).toBe(false);
    setEntry("");
    expect(isCliEntry(pathToFileURL(real).href)).toBe(false);
  });

  test("実パスに解決できないときは、起動時のパスのまま突き合わせる", () => {
    const { dir } = moduleFiles();
    const missing = join(dir, "missing.mjs");
    // 解決できなくても同じパスなら、何もせずに終わるより起動する方を選ぶ。
    setEntry(missing);
    expect(isCliEntry(pathToFileURL(missing).href)).toBe(true);
    // 解決できず、パスも違えば起動しない。
    setEntry(join(dir, "another-missing.mjs"));
    expect(isCliEntry(pathToFileURL(missing).href)).toBe(false);
  });
});
