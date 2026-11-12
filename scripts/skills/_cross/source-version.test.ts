// source-version.mjs（新側のバージョンの取り方）の振る舞いを、使い捨ての git のリポジトリで確かめる。
// 取り方の原本は replace-strategy の references/project-config.md「新側のバージョンの記録」である。
// 期待値は、その節が決める性質から決め、ハッシュの値そのものは書かない。
// 性質は、記録を書いても commit しても new.tree が変わらないこと・ソースを変えると変わること・
// .replace/ の外の追跡していないファイルを dirty にすること・利用者の index を変えないことである。
// 3 つのスキル（parity-replace・spec-parity・parity-diff）が同じ中身のコピーを持ち、一致は check-identical-copies.ts が確かめる。

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";
import {
  parseArgs,
  sourceVersion,
} from "../../../skills/parity-replace/scripts/source-version.mjs";

const SCRIPT = path.resolve(
  import.meta.dirname,
  "../../../skills/parity-replace/scripts/source-version.mjs",
);
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
// 子プロセスの git と node が止まっても、テストの実行全体を止めない
const CHILD_TIMEOUT_MS = 30_000;

// 利用者の git の設定（グローバルの status.showUntrackedFiles など）を読まない環境で起動する
const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.invalid",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.invalid",
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: GIT_ENV,
    timeout: CHILD_TIMEOUT_MS,
  });
}

function write(file: string, text: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

function tmp(): string {
  return makeTempDir("source-version-test-");
}

/** dir の下に .replace/ を作ってパスを返す（--artifacts はディレクトリが在ることを求める）。 */
function art(dir: string): string {
  const p = path.join(dir, ".replace");
  mkdirSync(p, { recursive: true });
  return p;
}

/** 1 回 commit したリポジトリを作る。files はリポジトリの最上位からの相対パス。 */
function repoWith(files: Record<string, string>): string {
  const top = tmp();
  git(top, "init", "-q", "-b", "main");
  for (const [f, text] of Object.entries(files)) write(path.join(top, f), text);
  git(top, "add", "-A");
  git(top, "commit", "-q", "-m", "init");
  return top;
}

function commitAll(top: string, message: string): void {
  git(top, "add", "-A");
  git(top, "commit", "-q", "-m", message);
}

const sha256 = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

// 新側の置き場所（リポジトリのルート／サブディレクトリ）と .replace/ の置き場所（ルート直下／新側のディレクトリの中）の組
const LAYOUTS = [
  { name: "新側がルート・.replace/ がルート直下", newDir: "", artifacts: ".replace" },
  {
    name: "新側がサブディレクトリ・.replace/ がルート直下",
    newDir: "new-app",
    artifacts: ".replace",
  },
  {
    name: "新側がサブディレクトリ・.replace/ が新側の中",
    newDir: "new-app",
    artifacts: "new-app/.replace",
  },
] as const;

describe.each(LAYOUTS)("$name", ({ newDir, artifacts }) => {
  function setup() {
    const top = repoWith({
      [path.posix.join(newDir, "src/app.js")]: "export const a = 1;\n",
      [path.posix.join(artifacts, "parity/order/metadata.json")]: "{}\n",
      "README.md": "root\n",
    });
    const repo = path.join(top, newDir);
    const art = path.join(top, artifacts);
    const take = () => sourceVersion({ repo, artifacts: art });
    return { top, repo, art, take };
  }

  test("記録を書いただけでも、記録を commit した後も、new.tree は変わらず dirty にならない", () => {
    const { top, art, take } = setup();
    const before = take();
    expect(before.dirty).toBe(false);
    write(path.join(art, "parity/order/new/local/replace-metadata.json"), "{}\n");
    const written = take();
    expect(written).toMatchObject({ tree: before.tree, dirty: false, commit: before.commit });
    commitAll(top, "record");
    const committed = take();
    expect(committed.tree).toBe(before.tree);
    expect(committed.dirty).toBe(false);
    // new.commit は HEAD を追う値なので、記録の commit で進む
    expect(committed.commit).not.toBe(before.commit);
  });

  test("ソースを変えただけなら dirty になり、commit すると new.tree が変わる", () => {
    const { top, repo, take } = setup();
    const before = take();
    write(path.join(repo, "src/app.js"), "export const a = 2;\n");
    const edited = take();
    expect(edited.dirty).toBe(true);
    // commit していない変更は new.tree に入らない（HEAD のツリーから取る）
    expect(edited.tree).toBe(before.tree);
    commitAll(top, "src");
    const committed = take();
    expect(committed.dirty).toBe(false);
    expect(committed.tree).not.toBe(before.tree);
  });

  test(".replace/ の外の追跡していないファイルは dirty、.replace/ の中なら dirty にしない", () => {
    const { repo, art, take } = setup();
    write(path.join(art, "untracked.json"), "{}\n");
    expect(take().dirty).toBe(false);
    write(path.join(repo, "src/new-file.js"), "x\n");
    expect(take().dirty).toBe(true);
  });

  test("gitignore されたファイルは dirty にも new.tree にも入らない", () => {
    const { top, repo, take } = setup();
    write(path.join(repo, ".gitignore"), ".e2e/\n");
    commitAll(top, "ignore");
    const before = take();
    write(path.join(repo, ".e2e/results.json"), "{}\n");
    expect(take()).toMatchObject({ tree: before.tree, dirty: false });
  });

  test("利用者の index と作業ツリーを変えない", () => {
    const { top, repo, take } = setup();
    write(path.join(repo, "src/staged.js"), "s\n");
    git(top, "add", "--", path.posix.join(newDir || ".", "src/staged.js"));
    write(path.join(repo, "src/app.js"), "unstaged\n");
    const index = path.join(top, ".git/index");
    const indexBefore = sha256(index);
    const statusBefore = git(top, "status", "--porcelain", "--untracked-files=all");
    take();
    expect(sha256(index)).toBe(indexBefore);
    expect(git(top, "status", "--porcelain", "--untracked-files=all")).toBe(statusBefore);
  });
});

describe("範囲", () => {
  test("新側がサブディレクトリなら、新側の外の変更は new.tree にも dirty にも入らない", () => {
    const top = repoWith({ "new-app/src/a.js": "a\n", "current-app/b.js": "b\n" });
    const repo = path.join(top, "new-app");
    const take = () => sourceVersion({ repo, artifacts: art(top) });
    const before = take();
    write(path.join(top, "current-app/b.js"), "b2\n");
    expect(take().dirty).toBe(false);
    commitAll(top, "current");
    expect(take().tree).toBe(before.tree);
    // .replace/ が新側の外なら、new.tree は HEAD の新側のディレクトリのツリーそのものになる
    expect(take().tree).toBe(git(top, "rev-parse", "HEAD:new-app").trim());
  });

  test("新側のディレクトリの名前をパターンとして読まない（app[1] が app1 に一致しない）", () => {
    const top = repoWith({
      "app[1]/a.js": "a\n",
      "app1/b.js": "b\n",
      "app[1]/.replace/x.json": "{}\n",
    });
    const repo = path.join(top, "app[1]");
    const take = () => sourceVersion({ repo, artifacts: art(repo) });
    const before = take();
    write(path.join(top, "app1/b.js"), "b2\n");
    expect(take().dirty).toBe(false);
    commitAll(top, "sibling");
    expect(take().tree).toBe(before.tree);
    write(path.join(repo, ".replace/y.json"), "{}\n");
    expect(take().dirty).toBe(false);
  });

  test("新側がルートで .replace/ がリポジトリの外なら、何も除かずにリポジトリ全体のツリーになる", () => {
    const top = repoWith({ "src/a.js": "a\n" });
    const outside = tmp();
    const v = sourceVersion({ repo: top, artifacts: art(outside) });
    expect(v.excluded).toBeNull();
    expect(v.tree).toBe(git(top, "rev-parse", "HEAD^{tree}").trim());
  });

  test(".replace/ だけを除き、名前が .replace で始まる別のディレクトリは除かない", () => {
    const top = repoWith({
      "src/a.js": "a\n",
      ".replace/x.json": "{}\n",
      ".replace-notes/n.md": "n\n",
    });
    const take = () => sourceVersion({ repo: top, artifacts: art(top) });
    const before = take();
    write(path.join(top, ".replace-notes/n.md"), "n2\n");
    expect(take().dirty).toBe(true);
    commitAll(top, "notes");
    expect(take().tree).not.toBe(before.tree);
  });

  test("新側のディレクトリに追跡しているファイルが無ければ、空のツリーにする", () => {
    const top = repoWith({ "README.md": "r\n" });
    mkdirSync(path.join(top, "new-app"));
    const v = sourceVersion({
      repo: path.join(top, "new-app"),
      artifacts: art(top),
    });
    expect(v.tree).toBe(EMPTY_TREE);
  });

  test("サブモジュールの commit を変えると dirty になり、commit すると new.tree が変わる", () => {
    const sub = repoWith({ "lib.js": "1\n" });
    const top = repoWith({ "src/a.js": "a\n" });
    git(top, "-c", "protocol.file.allow=always", "submodule", "add", "-q", sub, "vendor/lib");
    commitAll(top, "submodule");
    const take = () => sourceVersion({ repo: top, artifacts: art(top) });
    const before = take();
    expect(before.dirty).toBe(false);
    const inner = path.join(top, "vendor/lib");
    write(path.join(inner, "lib.js"), "2\n");
    git(inner, "commit", "-q", "-am", "2");
    expect(take().dirty).toBe(true);
    commitAll(top, "bump");
    expect(take()).toMatchObject({ dirty: false });
    expect(take().tree).not.toBe(before.tree);
  });

  test("利用者の git の設定で追跡していないファイルを隠していても、dirty として検出する", () => {
    const top = repoWith({ "src/a.js": "a\n" });
    git(top, "config", "status.showUntrackedFiles", "no");
    write(path.join(top, "src/new.js"), "n\n");
    expect(sourceVersion({ repo: top, artifacts: art(top) }).dirty).toBe(true);
  });
});

describe("git で管理されていない・取れない新側", () => {
  test("git で管理されていなければ、commit と tree を none にする", () => {
    const dir = tmp();
    expect(sourceVersion({ repo: dir, artifacts: art(dir) })).toEqual({
      commit: "none",
      tree: "none",
      dirty: false,
      excluded: null,
    });
  });

  test("commit が 1 つも無いリポジトリは、値を出さずに使い方の誤りにする", () => {
    const top = tmp();
    git(top, "init", "-q");
    expect(() => sourceVersion({ repo: top, artifacts: art(top) })).toThrow(/commit が無い/);
  });

  test("--repo のディレクトリが無ければ、使い方の誤りにする", () => {
    expect(() =>
      sourceVersion({ repo: path.join(tmp(), "missing"), artifacts: ".replace" }),
    ).toThrow(/無い/);
  });

  test("--artifacts のディレクトリが無ければ、使い方の誤りにする（.replace/ を含めた値を出さない）", () => {
    const top = repoWith({ "a.js": "a\n", ".replace/x.json": "{}\n" });
    expect(() => sourceVersion({ repo: top, artifacts: path.join(top, "sub/.replace") })).toThrow(
      /--artifacts のディレクトリが無い/,
    );
  });

  test("--artifacts がリポジトリの最上位そのものなら、使い方の誤りにする", () => {
    const top = repoWith({ "a.js": "a\n" });
    expect(() => sourceVersion({ repo: top, artifacts: top })).toThrow(/最上位そのもの/);
  });
});

describe("引数", () => {
  test.each([
    [["--repo", "x"], { repo: "x", artifacts: ".replace" }],
    [["--repo=x", "--artifacts=y"], { repo: "x", artifacts: "y" }],
  ])("%j を読む", (argv, want) => {
    expect(parseArgs(argv)).toEqual(want);
  });

  test.each([
    [[]],
    [["--repo"]],
    [["--repo", "x", "--repo", "y"]],
    [["--repo", "x", "--other"]],
    [["--repo", "--artifacts", "x"]],
    [["--repo="]],
  ])("%j は使い方の誤り", (argv) => {
    expect(() => parseArgs(argv)).toThrow();
  });
});

describe("CLI", () => {
  test("取れたら JSON を出して exit 0、取れなければ exit 2", () => {
    const top = repoWith({ "src/a.js": "a\n", ".replace/x.json": "{}\n" });
    const ok = spawnSync(process.execPath, [SCRIPT, "--repo", top], {
      cwd: top,
      encoding: "utf8",
      env: GIT_ENV,
      timeout: CHILD_TIMEOUT_MS,
    });
    expect(ok.status).toBe(0);
    const out: unknown = JSON.parse(ok.stdout);
    // --artifacts のデフォルトは作業ディレクトリの .replace
    expect(out).toMatchObject({
      dirty: false,
      excluded: ".replace",
      commit: expect.stringMatching(/^[0-9a-f]{40}$/),
    });
    const ng = spawnSync(process.execPath, [SCRIPT], {
      cwd: top,
      encoding: "utf8",
      env: GIT_ENV,
      timeout: CHILD_TIMEOUT_MS,
    });
    expect(ng.status).toBe(2);
    expect(ng.stdout).toBe("");
    expect(ng.stderr).toMatch(/--repo が無い/);
  });
});
