// PR の文章チェックで見るファイルの決め方（prose-scope.ts と、lint-prose.ts の --changed-since）のテスト。
//
// 差分は一時ディレクトリの git リポジトリで作る。検査の側のコード（import をたどる起点）と typescript は、
// 実リポジトリのものを使う（toolRoot のデフォルト）。typescript は静的に import するので、解決できない状態は作らない
// （lint-prose.ts も code-comments.ts から import していて、無ければどちらも起動しない）。
//
// 状態空間の軸と、各セルに置いた入力:
//
// | 軸                       | 値                                                                                  |
// | ------------------------ | ----------------------------------------------------------------------------------- |
// | ref                      | 解決できる / 解決できない（全体）/ git を起動できない（全体）                          |
// | 変わったパス             | 0 件 / 対象 / 対象外 / 対象外だけ（main は 0 件を見て exit 0）/ 消したファイル / 名前を変えたファイル |
// | 検査の側の一式           | INPUT_FILES / 起点 / 起点の直接の import / 間接の import / 一式の外の scripts/lib     |
// | skills/<name>/ の消し方  | ディレクトリごと消す（コピーを見る）/ 一部だけ消す（コピーを見ない）/ コピーを一覧にできない（全体） |
// | import をたどれるか      | import 先を読めない（全体）                                                           |
// | CLI の引数               | --changed-since <ref> / --changed-since=<ref> / ref なし / 2 回 / ファイルの指定と併用 |
import { spawnSync } from "node:child_process";
import { rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { assert, describe, expect, test, vi } from "vitest";
import { ENTRY, INPUT_FILES, proseScope } from "./prose-scope.ts";
import { main } from "./lint-prose.ts";
import { REPO_ROOT, gitInit, write } from "../../lib/testing/repo-file.ts";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";

const CLEAN = "# 手順\n\nこの手順でファイルを確認する。\n";
// textlint-disable
const DIRTY = "# 手順\n\n一覧はこのファイルが正本である。\n";
// textlint-enable

function git(root: string, args: string[]) {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8", timeout: CHILD_TIMEOUT_MS });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
}

/** base の内容で commit して `base` の印を付け、change を当てて commit した一時リポジトリ。 */
function makeRepo(base: Record<string, string>, change: (root: string) => void) {
  const root = makeTempDir("prose-scope-");
  gitInit(root);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "test"]);
  for (const [p, t] of Object.entries(base)) write(root, p, t);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "base"]);
  git(root, ["branch", "base"]);
  change(root);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "--allow-empty", "-m", "change"]);
  return root;
}

describe("変わったパスだけを見る", () => {
  test("0 件なら、見るファイルも 0 件", () => {
    const root = makeRepo({ "a.md": CLEAN }, () => {});
    expect(proseScope(root, "base")).toMatchObject({ kind: "changed", files: [] });
  });

  test("対象と対象外のファイルを、どちらも一覧に入れる（対象かどうかは lint-prose が決める）", () => {
    const root = makeRepo({ "a.md": CLEAN, "b.md": CLEAN, "c.txt": "x" }, (r) => {
      write(r, "a.md", `${CLEAN}追記。\n`);
      write(r, "c.txt", "y");
    });
    expect(proseScope(root, "base")).toMatchObject({ kind: "changed", files: ["a.md", "c.txt"] });
  });

  test("名前を変えたファイルは、新しいパスも入る", () => {
    const root = makeRepo({ "old.md": CLEAN }, (r) => git(r, ["mv", "old.md", "new.md"]));
    const scope = proseScope(root, "base");
    expect(scope.kind).toBe("changed");
    assert(scope.kind === "changed");
    expect(scope.files).toContain("new.md");
  });

  test("git を起動できなければ、全体を見る", () => {
    const root = makeRepo({ "a.md": CLEAN }, (r) => write(r, "a.md", DIRTY));
    const path = process.env.PATH;
    process.env.PATH = makeTempDir("prose-scope-empty-path-");
    try {
      const scope = proseScope(root, "base");
      expect(scope.kind).toBe("full");
      expect(scope.reason).toContain("git を起動できない");
    } finally {
      process.env.PATH = path;
    }
  });

  test("ref を解決できなければ、全体を見る", () => {
    const root = makeRepo({ "a.md": CLEAN }, () => {});
    const scope = proseScope(root, "no-such-ref");
    expect(scope.kind).toBe("full");
    expect(scope.reason).toContain("no-such-ref からの差分を取れない");
  });
});

describe("検査の側の一式が変わったら、全体を見る", () => {
  test.each([
    ...INPUT_FILES.map((p) => [p, "INPUT_FILES"]),
    [ENTRY, "起点"],
    ["scripts/lib/text/code-comments.ts", "起点の直接の import"],
    ["scripts/lib/guards.ts", "間接の import（textlint-word-rule.ts から）"],
    ["scripts/gates/prose/prose-scope.ts", "起点の直接の import（このモジュール）"],
  ])("%s（%s）", (path) => {
    const root = makeRepo({ [path]: "a\n" }, (r) => write(r, path, "b\n"));
    expect(proseScope(root, "base")).toEqual({
      kind: "full",
      reason: `検査の側の一式（${path}）が変わった`,
    });
  });

  test("一式を消したときも全体を見る", () => {
    const root = makeRepo({ ".textlint/words.json": "{}\n" }, (r) =>
      rmSync(join(r, ".textlint/words.json")),
    );
    expect(proseScope(root, "base").kind).toBe("full");
  });

  test("一式の外の scripts/lib のファイルだけなら、絞る", () => {
    const path = "scripts/lib/spawn-async.ts";
    const root = makeRepo({ [path]: "a\n" }, (r) => write(r, path, "b\n"));
    expect(proseScope(root, "base")).toMatchObject({ kind: "changed", files: [path] });
  });

  test("import 先を読めなければ、全体を見る", () => {
    const root = makeRepo({ "a.md": CLEAN }, (r) => write(r, "a.md", DIRTY));
    const toolRoot = makeTempDir("prose-scope-tool-");
    symlinkSync(join(REPO_ROOT, "node_modules"), join(toolRoot, "node_modules"));
    write(toolRoot, ENTRY, 'import "./missing.ts";\n');
    const scope = proseScope(root, "base", toolRoot);
    expect(scope.kind).toBe("full");
    expect(scope.reason).toContain("scripts/gates/prose/missing.ts を読めない");
  });
});

describe("skills/<name>/ を消すと、そのコピーだった .agents/skills/<name>/ も見る", () => {
  const base = {
    "skills/foo/SKILL.md": CLEAN,
    "skills/foo/references/a.md": CLEAN,
    ".agents/skills/foo/SKILL.md": CLEAN,
  };

  test("ディレクトリごと消したら、コピーのファイルが入る", () => {
    const root = makeRepo(base, (r) => rmSync(join(r, "skills/foo"), { recursive: true }));
    const scope = proseScope(root, "base");
    assert(scope.kind === "changed");
    expect(scope.files).toContain(".agents/skills/foo/SKILL.md");
  });

  // 差分（commit どうしの比較）は index を読まず、ls-files は読むので、index をディレクトリにすると ls-files だけが失敗する。
  test("コピーを一覧にできなければ（git ls-files の失敗）、全体を見る", () => {
    const root = makeRepo(base, (r) => rmSync(join(r, "skills/foo"), { recursive: true }));
    const index = process.env.GIT_INDEX_FILE;
    process.env.GIT_INDEX_FILE = makeTempDir("prose-scope-index-");
    try {
      const scope = proseScope(root, "base");
      expect(scope.kind).toBe("full");
      expect(scope.reason).toContain("消したスキルのコピーを一覧にできない");
    } finally {
      if (index === undefined) delete process.env.GIT_INDEX_FILE;
      else process.env.GIT_INDEX_FILE = index;
    }
  });

  test("一部だけ消したなら、コピーのファイルは入らない", () => {
    const root = makeRepo(base, (r) => rmSync(join(r, "skills/foo/references/a.md")));
    const scope = proseScope(root, "base");
    assert(scope.kind === "changed");
    expect(scope.files).not.toContain(".agents/skills/foo/SKILL.md");
  });
});

describe("main の --changed-since", () => {
  /** cwd を root にして main を実行し、終了コードと stderr を返す。 */
  async function run(root: string, argv: string[]) {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const cwd = process.cwd();
    process.chdir(root);
    try {
      const code = await main(argv);
      return { code, stderr: err.mock.calls.map((c) => String(c[0])).join("\n") };
    } finally {
      process.chdir(cwd);
      err.mockRestore();
      log.mockRestore();
    }
  }

  // 変えていない dirty.md の指摘は、絞ったときには出ない（main で通った前提なので見ない）。
  const repo = () =>
    makeRepo({ "dirty.md": DIRTY, "a.md": CLEAN }, (r) => write(r, "a.md", `${CLEAN}追記する。\n`));

  // 見るファイルが 0 件になる PR（画像だけを変えた・空の commit だけ）。全体を見るときの「対象が 0 件なら exit 2」と取り違えず、
  // 全体にも切り替えない。変わったパスが 0 件の組は、空の一覧を「全体」として扱う回帰を検出する。
  test.each([
    ["対象外のファイルだけを変えた", (r: string) => write(r, "c.txt", "y"), 1],
    ["何も変えていない（空の commit）", () => {}, 0],
  ] as const)(
    "%s PR は、0 件を見て exit 0 で終わり、変えていないファイルの指摘は出さない",
    async (_, change, paths) => {
      const root = makeRepo({ "dirty.md": DIRTY, "c.txt": "x" }, change);
      const r = await run(root, ["--changed-since", "base"]);
      expect(r.code).toBe(0);
      expect(r.stderr).toContain(
        `base...HEAD で変わった ${paths} 件のパスのうち、対象に当たるものだけを見る`,
      );
      expect(r.stderr).not.toContain("dirty.md");
    },
  );

  test("変えたファイルだけを見て、変えていないファイルの指摘は出さない", async () => {
    const r = await run(repo(), ["--changed-since", "base"]);
    expect(r).toMatchObject({ code: 0 });
    expect(r.stderr).toContain(
      "base...HEAD で変わった 1 件のパスのうち、対象に当たるものだけを見る",
    );
  });

  test("変えたファイルの指摘は exit 1 で報告する", async () => {
    const root = makeRepo({ "a.md": CLEAN }, (r) => write(r, "a.md", DIRTY));
    const r = await run(root, ["--changed-since=base"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("a.md:3:");
  });

  test("全体を見るときは、変えていないファイルの指摘も出す", async () => {
    const r = await run(repo(), ["--changed-since", "no-such-ref"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("lint-prose: 全体を見る（no-such-ref からの差分を取れない");
    expect(r.stderr).toContain("dirty.md:3:");
  });

  test.each([
    [["--changed-since"], "--changed-since に ref がない"],
    [["--changed-since="], "--changed-since に ref がない"],
    [["--changed-since", "--other"], "--changed-since に ref がない"],
    [["--changed-since", "base", "--changed-since=base"], "--changed-since を 2 回書いている"],
    [["--changed-since", "base", "a.md"], "--changed-since とファイルの指定は併用しない: a.md"],
  ])("%j は exit 2", async (argv, message) => {
    const r = await run(repo(), argv);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain(message);
  });
});
