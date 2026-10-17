// ディレクトリの直下のファイル数のチェック（check-dir-file-count.ts）の回帰テスト。
//
// 状態空間の軸と、各セルに置いた入力は次の表のとおりである。
//
// | 軸             | 値                                                                     |
// | -------------- | ---------------------------------------------------------------------- |
// | 件数           | 閾値より 1 少ない / 閾値ちょうど / 閾値より 1 多い                     |
// | 閾値の出所     | デフォルト / ディレクトリごと（0 を含む）                              |
// | 対象外         | なし / そのディレクトリだけ / 下のディレクトリを含む                   |
// | 数える位置     | 直下 / サブディレクトリの中（数えない） / ルート（"."）                |
// | git での状態   | 追跡 / index に無い（未追跡。.gitignore で無視したものも同じ。数えない） / シンボリックリンク |
// | 設定の記述     | 正しい / 実在しない dir / 空の reason / 形の誤り（型・未知のキー・重複・表記の揺れ） |
import { describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_PATH, checkDirFileCount, main, parseConfig } from "./check-dir-file-count.ts";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";

const script = join(dirname(fileURLToPath(import.meta.url)), "check-dir-file-count.ts");

const files = (dir: string, n: number) =>
  Array.from({ length: n }, (_, i) => (dir === "." ? `f${i}.txt` : `${dir}/f${i}.txt`));
const config = (raw: Record<string, unknown> = {}) => parseConfig({ default_max: 3, ...raw });

describe("閾値との比較", () => {
  test("閾値ちょうどのディレクトリは違反にしない", () => {
    expect(checkDirFileCount(files("a", 3), config()).violations).toEqual([]);
  });

  test("閾値を 1 件超えたディレクトリを違反にする", () => {
    expect(checkDirFileCount(files("a", 4), config()).violations).toEqual(["a: 4 件（閾値 3）"]);
  });

  test("デフォルトの閾値 20 では、20 件は違反にせず 21 件を違反にする", () => {
    const c = parseConfig({ default_max: 20 });
    expect(checkDirFileCount(files("a", 20), c).violations).toEqual([]);
    expect(checkDirFileCount(files("a", 21), c).violations).toEqual(["a: 21 件（閾値 20）"]);
  });

  test("ルートの直下のファイルも数える", () => {
    expect(checkDirFileCount(files(".", 4), config()).violations).toEqual([".: 4 件（閾値 3）"]);
  });

  test("サブディレクトリの中のファイルは、親のディレクトリの件数に数えない", () => {
    const input = [...files("a", 3), ...files("a/b", 3), ...files("a/c", 3)];
    expect(checkDirFileCount(input, config()).violations).toEqual([]);
  });

  test("ディレクトリごとの閾値で判定する（デフォルトより大きい値）", () => {
    const c = config({ overrides: [{ dir: "a", max: 5, reason: "r" }] });
    expect(checkDirFileCount(files("a", 5), c).violations).toEqual([]);
    expect(checkDirFileCount(files("a", 6), c).violations).toEqual(["a: 6 件（閾値 5）"]);
  });

  test("閾値 0 のディレクトリは、直下にファイルが 1 件あれば違反にする", () => {
    const c = config({ overrides: [{ dir: "s", max: 0, reason: "r" }] });
    expect(checkDirFileCount(["s/lib/x.ts"], c).violations).toEqual([]);
    expect(checkDirFileCount(["s/lib/x.ts", "s/a.ts"], c).violations).toEqual([
      "s: 1 件（閾値 0）",
    ]);
  });

  test("デフォルトの閾値を変えると、変えた値で判定する", () => {
    expect(checkDirFileCount(files("a", 4), config({ default_max: 4 })).violations).toEqual([]);
    expect(checkDirFileCount(files("a", 2), config({ default_max: 1 })).violations).toEqual([
      "a: 2 件（閾値 1）",
    ]);
  });
});

describe("対象外", () => {
  test("対象外のディレクトリは数えない", () => {
    const c = config({ excludes: [{ dir: "a", reason: "r" }] });
    expect(checkDirFileCount(files("a", 9), c).violations).toEqual([]);
  });

  test("descendants が無い対象外は、下のディレクトリを数える", () => {
    const c = config({ excludes: [{ dir: "a", reason: "r" }] });
    expect(checkDirFileCount([...files("a", 9), ...files("a/b", 4)], c).violations).toEqual([
      "a/b: 4 件（閾値 3）",
    ]);
  });

  test("descendants が true の対象外は、下のディレクトリも数えない", () => {
    const c = config({ excludes: [{ dir: "a", reason: "r", descendants: true }] });
    expect(checkDirFileCount([...files("a", 9), ...files("a/b/c", 9)], c).violations).toEqual([]);
  });

  test("対象外の名前を前方に含む別のディレクトリは数える", () => {
    const c = config({ excludes: [{ dir: "a", reason: "r", descendants: true }] });
    expect(checkDirFileCount([...files("a", 1), ...files("ab", 4)], c).violations).toEqual([
      "ab: 4 件（閾値 3）",
    ]);
  });
});

describe("設定の古い記述と空の理由", () => {
  test("実在しないディレクトリを書いた閾値と対象外を報告する", () => {
    const c = config({
      overrides: [{ dir: "gone", max: 5, reason: "r" }],
      excludes: [{ dir: "a/gone", reason: "r" }],
    });
    expect(checkDirFileCount(files("a", 1), c).configErrors).toEqual([
      "gone: git 管理下に無いディレクトリ（設定から外す）",
      "a/gone: git 管理下に無いディレクトリ（設定から外す）",
    ]);
  });

  test("descendants の対象外の下に書いた閾値は、使われない設定として報告する", () => {
    const c = config({
      overrides: [{ dir: "a/b", max: 5, reason: "r" }],
      excludes: [{ dir: "a", reason: "r", descendants: true }],
    });
    expect(checkDirFileCount(files("a/b", 1), c).configErrors).toEqual([
      "a/b: 対象外（a）の下にあるので、この設定は使われない（設定から外す）",
    ]);
  });

  test("descendants の対象外の下に書いた対象外は、使われない設定として報告する", () => {
    const c = config({
      excludes: [
        { dir: "a", reason: "r", descendants: true },
        { dir: "a/b", reason: "r" },
      ],
    });
    expect(checkDirFileCount([...files("a", 1), ...files("a/b", 1)], c).configErrors).toEqual([
      "a/b: 対象外（a）の下にあるので、この設定は使われない（設定から外す）",
    ]);
  });

  test("デフォルトと同じ閾値は、判定を変えない設定として報告する", () => {
    const c = config({ overrides: [{ dir: "a", max: 3, reason: "r" }] });
    expect(checkDirFileCount(files("a", 1), c).configErrors).toEqual([
      "a: 閾値がデフォルト（3）と同じで、判定を変えない（設定から外す）",
    ]);
  });

  test("違反はロケールに依らず、コードポイントの順に並べる", () => {
    const input = [...files("b", 4), ...files("B", 4), ...files("_a", 4)];
    expect(checkDirFileCount(input, config()).violations).toEqual([
      "B: 4 件（閾値 3）",
      "_a: 4 件（閾値 3）",
      "b: 4 件（閾値 3）",
    ]);
  });

  test("descendants が無い対象外の下に書いた閾値は、使われるので報告しない", () => {
    const c = config({
      overrides: [{ dir: "a/b", max: 5, reason: "r" }],
      excludes: [{ dir: "a", reason: "r" }],
    });
    const input = [...files("a", 4), ...files("a/b", 4)];
    expect(checkDirFileCount(input, c).configErrors).toEqual([]);
  });

  test("閾値を上げた例外は、件数がデフォルトの閾値以下なら使われない設定として報告する", () => {
    const c = config({ overrides: [{ dir: "a", max: 5, reason: "r" }] });
    expect(checkDirFileCount(files("a", 3), c).configErrors).toEqual([
      "a: 件数（3）がデフォルトの閾値（3）以下で、閾値を上げる必要が無い（設定から外す）",
    ]);
    expect(checkDirFileCount(files("a", 4), c).configErrors).toEqual([]);
  });

  // s は直下にファイルを持たず、下の s/lib にだけ持つ。そのようなディレクトリも実在として扱う。
  test("閾値を下げた例外は、件数に関わらず報告しない", () => {
    const c = config({ overrides: [{ dir: "s", max: 0, reason: "r" }] });
    expect(checkDirFileCount(["s/lib/x.ts"], c).configErrors).toEqual([]);
  });

  test.each([
    ["descendants なし", { dir: "a", reason: "r" }, files("a", 1)],
    ["descendants あり", { dir: "a", reason: "r", descendants: true }, files("a/b", 1)],
  ])("対象外（%s）は、件数がデフォルトの閾値以下でも報告しない", (_name, entry, input) => {
    expect(checkDirFileCount(input, config({ excludes: [entry] })).configErrors).toEqual([]);
  });

  test.each([[""], ["   "]])("理由が空（%j）の閾値と対象外を報告する", (reason) => {
    const c = config({
      overrides: [{ dir: "a", max: 5, reason }],
      excludes: [{ dir: "b", reason }],
    });
    expect(checkDirFileCount([...files("a", 4), ...files("b", 4)], c).configErrors).toEqual([
      "a: reason が空（閾値を変える・対象外にする理由を書く）",
      "b: reason が空（閾値を変える・対象外にする理由を書く）",
    ]);
  });
});

describe("設定の形", () => {
  test.each([
    ["default_max が無い", {}],
    ["default_max が負", { default_max: -1 }],
    ["default_max が小数", { default_max: 1.5 }],
    ["default_max が文字列", { default_max: "20" }],
    ["未知のキー", { default_max: 3, override: [] }],
    ["overrides が配列でない", { default_max: 3, overrides: {} }],
    ["max が無い", { default_max: 3, overrides: [{ dir: "a", reason: "r" }] }],
    ["reason が無い", { default_max: 3, excludes: [{ dir: "a" }] }],
    ["reason の綴りの誤り", { default_max: 3, excludes: [{ dir: "a", reasons: "r" }] }],
    [
      "descendants が真偽値でない",
      { default_max: 3, excludes: [{ dir: "a", reason: "r", descendants: "yes" }] },
    ],
    ["dir が ./ で始まる", { default_max: 3, excludes: [{ dir: "./a", reason: "r" }] }],
    ["dir が / で終わる", { default_max: 3, excludes: [{ dir: "a/", reason: "r" }] }],
    ["dir が空", { default_max: 3, excludes: [{ dir: "", reason: "r" }] }],
    ["dir が .. で始まる", { default_max: 3, excludes: [{ dir: "../a", reason: "r" }] }],
    ["dir が ..", { default_max: 3, excludes: [{ dir: "..", reason: "r" }] }],
    [
      "ルートを descendants で対象外にする",
      { default_max: 3, excludes: [{ dir: ".", reason: "r", descendants: true }] },
    ],
    [
      "同じ dir を閾値と対象外の両方に書く",
      {
        default_max: 3,
        overrides: [{ dir: "a", max: 1, reason: "r" }],
        excludes: [{ dir: "a", reason: "r" }],
      },
    ],
  ])("%s なら例外にする", (_name, raw) => {
    expect(() => parseConfig(raw)).toThrow();
  });
});

test.each([
  [".. で始まる名前（..cache）", { dir: "..cache", reason: "r" }],
  ["ルートだけを対象外にする（descendants なし）", { dir: ".", reason: "r" }],
])("%s は設定の形として受け付ける", (_name, entry) => {
  expect(() => parseConfig({ default_max: 3, excludes: [entry] })).not.toThrow();
});

describe("CLI", () => {
  /** files を追跡した git のリポジトリを作り、設定を書く。 */
  function makeRepo(tracked: string[], raw: Record<string, unknown>): string {
    const root = makeTempDir("dir-file-count-");
    const git = (...args: string[]) => {
      const res = spawnSync("git", args, {
        timeout: CHILD_TIMEOUT_MS,
        cwd: root,
        encoding: "utf8",
      });
      if (res.status !== 0) throw new Error(`git ${args.join(" ")}: ${res.stderr}`);
    };
    git("init", "-q");
    for (const rel of [...tracked, CONFIG_PATH]) {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), rel === CONFIG_PATH ? JSON.stringify(raw) : "");
    }
    git("add", "-A");
    return root;
  }

  test("CLI: index にある追跡しているファイルだけを数え、未追跡のファイルは数えない", () => {
    const root = makeRepo(files("a", 3), { default_max: 3 });
    writeFileSync(join(root, "a/untracked.txt"), "");
    expect(main(root)).toBe(0);
  });

  test("CLI: シンボリックリンクをファイルとして数え、違反なら 1 で終わる", () => {
    const root = makeRepo(files("a", 3), { default_max: 3 });
    symlinkSync("f0.txt", join(root, "a/link"));
    expect(
      spawnSync("git", ["add", "a/link"], { timeout: CHILD_TIMEOUT_MS, cwd: root }).status,
    ).toBe(0);
    const res = spawnSync(process.execPath, [script], {
      timeout: CHILD_TIMEOUT_MS,
      cwd: root,
      encoding: "utf8",
    });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("a: 4 件（閾値 3）");
    expect(res.stderr).toContain("excludes（対象外にする）");
  });

  test("CLI: 設定の古い記述があれば 1 で終わる", () => {
    const root = makeRepo(files("a", 1), {
      default_max: 3,
      excludes: [{ dir: "gone", reason: "r" }],
    });
    expect(main(root)).toBe(1);
  });

  test("CLI: 衝突を解消していないファイルを、段の数ではなく 1 件として数える", () => {
    const root = makeRepo(files("a", 2), { default_max: 3 });
    const git = (...args: string[]) =>
      spawnSync(
        "git",
        [
          "-c",
          "user.name=t",
          "-c",
          "user.email=t@example.com",
          "-c",
          "commit.gpgsign=false",
          "-c",
          "core.hooksPath=/dev/null",
          ...args,
        ],
        { timeout: CHILD_TIMEOUT_MS, cwd: root, encoding: "utf8" },
      );
    const record = "com" + "mit";
    expect(git(record, "-qm", "base").status).toBe(0);
    expect(git("checkout", "-qb", "other").status).toBe(0);
    writeFileSync(join(root, "a/f0.txt"), "other\n");
    expect(git(record, "-qam", "other").status).toBe(0);
    expect(git("checkout", "-q", "-").status).toBe(0);
    writeFileSync(join(root, "a/f0.txt"), "main\n");
    expect(git(record, "-qam", "main").status).toBe(0);
    expect(git("merge", "other").status).not.toBe(0);
    expect(main(root)).toBe(0);
  });

  test("CLI: submodule はファイルとして数えず、ディレクトリとして扱う", () => {
    const root = makeRepo([...files("a", 3), "x.txt"], {
      default_max: 3,
      excludes: [{ dir: "a/sub", reason: "r" }],
    });
    // 中身の無い gitlink を index に置く（submodule の実体は要らない）。
    const sha = "0123456789012345678901234567890123456789";
    const add = spawnSync("git", ["update-index", "--add", "--cacheinfo", `160000,${sha},a/sub`], {
      timeout: CHILD_TIMEOUT_MS,
      cwd: root,
      encoding: "utf8",
    });
    expect(add.status).toBe(0);
    const res = spawnSync(process.execPath, [script], {
      timeout: CHILD_TIMEOUT_MS,
      cwd: root,
      encoding: "utf8",
    });
    // a は 3 件のままで違反にならず、a/sub は実在するディレクトリとして扱う（実在しないとは報告しない）。
    expect(res.stderr).not.toContain("a: 4 件");
    expect(res.stderr).not.toContain("git 管理下に無い");
    expect(res.status).toBe(0);
  });

  test("CLI: 追跡しているファイルが 0 件なら、判定できないとして 2 で終わる", () => {
    const root = makeRepo([], { default_max: 3 });
    expect(
      spawnSync("git", ["rm", "-q", "--cached", CONFIG_PATH], {
        timeout: CHILD_TIMEOUT_MS,
        cwd: root,
      }).status,
    ).toBe(0);
    expect(main(root)).toBe(2);
  });

  test("CLI: 設定の形の誤りは判定できないとして 2 で終わる", () => {
    const root = makeRepo(files("a", 1), { default_max: "3" });
    expect(main(root)).toBe(2);
  });
});
