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
import * as parityDiff from "../../../skills/parity-diff/scripts/source-version.mjs";
import * as parityReplace from "../../../skills/parity-replace/scripts/source-version.mjs";
import * as specParity from "../../../skills/spec-parity/scripts/source-version.mjs";

// 3 つのコピーをそれぞれ測る（カバレッジはファイルごとに測るので、1 つだけを測ると残りが 0% になる）
const COPIES = [
  { skill: "parity-replace", lib: parityReplace },
  { skill: "spec-parity", lib: specParity },
  { skill: "parity-diff", lib: parityDiff },
].map((c) => ({
  ...c,
  script: path.resolve(
    import.meta.dirname,
    `../../../skills/${c.skill}/scripts/source-version.mjs`,
  ),
}));
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

describe.each(COPIES)("$skill の source-version.mjs", ({ lib, script: SCRIPT }) => {
  const { parseArgs, sourceVersion } = lib;

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
      expect(() => sourceVersion({ repo: top, artifacts: top })).toThrow(/そのものか、その祖先/);
    });

    test("--artifacts が新側のディレクトリの祖先なら、使い方の誤りにする（新側が何も残らない値を出さない）", () => {
      const top = repoWith({ "apps/new/a.js": "a\n", "apps/.replace/x.json": "{}\n" });
      expect(() =>
        sourceVersion({ repo: path.join(top, "apps/new"), artifacts: path.join(top, "apps") }),
      ).toThrow(/そのものか、その祖先/);
    });
  });

  describe("--rev", () => {
    test("--rev の commit の tree を取り、作業ツリーを見ないので dirty は null にする", () => {
      const top = repoWith({ "src/a.js": "a\n", ".replace/x.json": "{}\n" });
      const first = git(top, "rev-parse", "HEAD").trim();
      const before = sourceVersion({ repo: top, artifacts: art(top) });
      write(path.join(top, "src/a.js"), "b\n");
      commitAll(top, "src");
      write(path.join(top, "src/a.js"), "dirty\n");
      const v = sourceVersion({ repo: top, artifacts: art(top), rev: first });
      expect(v).toEqual({ commit: first, tree: before.tree, dirty: null, excluded: ".replace" });
    });

    test("--rev でも .replace/ を除く（記録の commit は tree を変えない）", () => {
      const top = repoWith({ "src/a.js": "a\n", ".replace/x.json": "{}\n" });
      const before = sourceVersion({ repo: top, artifacts: art(top) });
      write(path.join(top, ".replace/y.json"), "{}\n");
      commitAll(top, "record");
      const head = git(top, "rev-parse", "HEAD").trim();
      expect(sourceVersion({ repo: top, artifacts: art(top), rev: head }).tree).toBe(before.tree);
    });

    test("git で管理されていない新側に --rev を渡すと、none を返さずに使い方の誤りにする", () => {
      const dir = tmp();
      expect(() =>
        sourceVersion({
          repo: dir,
          artifacts: art(dir),
          rev: "0123456789abcdef0123456789abcdef01234567",
        }),
      ).toThrow(/git で管理されていない新側では、--rev/);
    });

    test("--rev の commit が手元に無ければ、使い方の誤りにする", () => {
      const top = repoWith({ "src/a.js": "a\n" });
      expect(() =>
        sourceVersion({
          repo: top,
          artifacts: art(top),
          rev: "0123456789abcdef0123456789abcdef01234567",
        }),
      ).toThrow(/--rev の commit が手元のリポジトリに無い/);
    });
  });

  describe("呼び出し元の環境", () => {
    // git rev-parse --local-env-vars に挙がる変数のうち、リポジトリの場所を変えるもの。別のリポジトリを指していても --repo を読む
    test.each([
      ["GIT_DIR", (other: string) => path.join(other, ".git")],
      ["GIT_WORK_TREE", (other: string) => other],
      ["GIT_INDEX_FILE", (other: string) => path.join(other, ".git/index")],
      ["GIT_COMMON_DIR", (other: string) => path.join(other, ".git")],
      ["GIT_OBJECT_DIRECTORY", (other: string) => path.join(other, ".git/objects")],
    ] as const)("呼び出し元の %s を受け継がず、--repo のリポジトリを読む", (name, value) => {
      const other = repoWith({ "o.js": "o\n" });
      const top = repoWith({ "src/a.js": "a\n" });
      const want = sourceVersion({ repo: top, artifacts: art(top) });
      const saved = process.env[name];
      process.env[name] = value(other);
      try {
        expect(sourceVersion({ repo: top, artifacts: art(top) })).toEqual(want);
      } finally {
        if (saved === undefined) delete process.env[name];
        else process.env[name] = saved;
      }
    });

    test(".replace/ が新側の中で gitignore されていても、記録を書いて dirty にならず tree も変わらない", () => {
      const top = repoWith({ "src/a.js": "a\n", ".gitignore": ".replace/\n" });
      const before = sourceVersion({ repo: top, artifacts: art(top) });
      expect(before.tree).toBe(git(top, "rev-parse", "HEAD^{tree}").trim());
      write(path.join(top, ".replace/x.json"), "{}\n");
      expect(sourceVersion({ repo: top, artifacts: art(top) })).toMatchObject({
        tree: before.tree,
        dirty: false,
      });
    });

    /** 環境変数を一時的に設定して fn を実行し、元に戻す。 */
    function withEnv(vars: Record<string, string>, fn: () => void): void {
      const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
      Object.assign(process.env, vars);
      try {
        fn();
      } finally {
        for (const [k, v] of Object.entries(saved)) {
          if (v === undefined) delete process.env[k];
          else process.env[k] = v;
        }
      }
    }

    test("呼び出し元の GIT_NO_REPLACE_OBJECTS を受け継がず、git replace の置き換えを --repo の設定どおりに読む", () => {
      // 手で持った一覧に無く、git rev-parse --local-env-vars にだけある変数。受け継ぐと同じ HEAD から別の tree を出す
      const top = repoWith({ "src/a.js": "a\n" });
      const original = git(top, "rev-parse", "HEAD").trim();
      write(path.join(top, "src/a.js"), "replaced\n");
      commitAll(top, "replacement");
      const replacement = git(top, "rev-parse", "HEAD").trim();
      git(top, "reset", "-q", "--hard", original);
      git(top, "replace", original, replacement);
      const want = sourceVersion({ repo: top, artifacts: art(top) });
      expect(want.tree).toBe(git(top, "rev-parse", `${replacement}^{tree}`).trim());
      withEnv({ GIT_NO_REPLACE_OBJECTS: "1" }, () => {
        expect(sourceVersion({ repo: top, artifacts: art(top) })).toEqual(want);
      });
    });

    // 実行する人のグローバルとシステムの設定（~/.config/git/ignore の *.log など）を読まない状態で比べる
    const NO_USER_CONFIG = { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };

    test.each([
      [
        "GIT_CONFIG_COUNT",
        (f: string) => ({
          GIT_CONFIG_COUNT: "1",
          GIT_CONFIG_KEY_0: "core.excludesFile",
          GIT_CONFIG_VALUE_0: f,
        }),
      ],
      [
        "GIT_CONFIG_PARAMETERS",
        (f: string) => ({ GIT_CONFIG_PARAMETERS: `'core.excludesfile'='${f}'` }),
      ],
    ] as const)("環境で渡した git の設定（%s）は受け継ぐ", (_name, vars) => {
      const top = repoWith({ "src/a.js": "a\n" });
      const excludes = path.join(tmp(), "excludes");
      write(excludes, "*.log\n");
      write(path.join(top, "src/debug.log"), "x\n");
      withEnv(NO_USER_CONFIG, () => {
        expect(sourceVersion({ repo: top, artifacts: art(top) }).dirty).toBe(true);
        withEnv(vars(excludes), () => {
          expect(sourceVersion({ repo: top, artifacts: art(top) }).dirty).toBe(false);
        });
      });
    });
    test("git を起動できなければ、使い方の誤りにする（値を推測して出さない）", () => {
      const top = repoWith({ "src/a.js": "a\n" });
      const saved = process.env.PATH;
      process.env.PATH = "";
      try {
        // 外側の処理名で包み直さず、起動できないことだけを示す
        expect(() => sourceVersion({ repo: top, artifacts: art(top) })).toThrow(
          /^git を起動できない/,
        );
      } finally {
        process.env.PATH = saved;
      }
    });

    test("--repo がディレクトリでなければ、git の失敗を使い方の誤りにする", () => {
      const top = repoWith({ "src/a.js": "a\n" });
      expect(() =>
        sourceVersion({ repo: path.join(top, "src/a.js"), artifacts: art(top) }),
      ).toThrow(/新側のリポジトリの特定に失敗した/);
    });

    test("名前が .. で始まるリポジトリの中のディレクトリの .replace/ も除く", () => {
      const top = repoWith({ "..data/src/a.js": "a\n", "..data/.replace/x.json": "{}\n" });
      const repo = path.join(top, "..data");
      const v = sourceVersion({ repo, artifacts: path.join(repo, ".replace") });
      expect(v.excluded).toBe("..data/.replace");
      write(path.join(repo, ".replace/y.json"), "{}\n");
      expect(sourceVersion({ repo, artifacts: path.join(repo, ".replace") }).dirty).toBe(false);
    });
  });

  describe("引数", () => {
    test.each([
      [["--repo", "x"], { repo: "x", artifacts: ".replace", rev: null }],
      [["--repo=x", "--artifacts=y"], { repo: "x", artifacts: "y", rev: null }],
      [["--repo", "x", "--rev", "abc"], { repo: "x", artifacts: ".replace", rev: "abc" }],
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
});
