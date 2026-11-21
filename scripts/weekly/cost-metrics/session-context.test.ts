// session-context.ts（セッションの開始時に読み込む文書）のテスト。
// 取り込みの規則の期待値は、Claude Code のドキュメント（https://code.claude.com/docs/en/memory「Import additional files」）から決める。
//
// | 軸 | 値 |
// | --- | --- |
// | `@` の位置 | 行頭 / 文の途中 / 直前が空白でない（メールアドレス・引用符） |
// | 囲み | コードスパン / フェンスのコードブロック / 字下げのコードブロック / リンクの文字 |
// | パス | 相対（取り込む側の場所が基準）/ 親のディレクトリ / 絶対 / `~/` / `\ ` を含む / シンボリックリンク |
// | 取り込みの段 | 1 段 / 4 段（数える）/ 5 段（数えない）/ 同じファイルを 2 回 / 深い段の後に浅い段 / 循環 |
// | ファイル | ある / 起点が無い / 取り込み先が無い / ディレクトリ |
// | バイト数 | ASCII / 日本語（UTF-8 のバイト数） |
import { describe, expect, test } from "vitest";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";
import { importPaths, sessionContextFiles } from "./session-context.ts";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";

function repo(files: Record<string, string>): string {
  const root = makeTempDir("session-context-");
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

describe("取り込むパス", () => {
  test.each([
    ["行頭", "@AGENTS.md\n", ["AGENTS.md"]],
    ["文の途中", "概要は @README.md を読む。\n", ["README.md"]],
    ["1 行に 2 つ", "@a.md と @b.md\n", ["a.md", "b.md"]],
    ["パスの中の空白", "@docs/my\\ notes.md\n", ["docs/my notes.md"]],
    ["リンクの文字", "[@a.md](https://example.com)\n", ["a.md"]],
    ["メールアドレス", "連絡先は me@example.com\n", []],
    ["引用符で囲む", '"@a.md" は取り込まない\n', []],
    ["コードスパン", "`@AGENTS.md` と書く\n", []],
    ["フェンスのコードブロック", "```text\n@AGENTS.md\n```\n", []],
    ["字下げのコードブロック", "段落\n\n    @AGENTS.md\n", []],
    ["@ だけ", "@ のあとに空白\n", []],
  ])("%s", (_name, markdown, expected) => {
    expect(importPaths(markdown)).toEqual(expected);
  });
});

describe("読み込む文書", () => {
  test("取り込みを辿り、最初に現れた順にバイト数と段を返す", () => {
    const root = repo({
      "CLAUDE.md": "@AGENTS.md\n",
      "AGENTS.md": "規約\n@docs/a.md\n@docs/a.md\n",
      "docs/a.md": "@../b.md\n",
      "b.md": "abc",
    });
    expect(sessionContextFiles(root, ["CLAUDE.md"])).toEqual([
      { path: "CLAUDE.md", bytes: 11, hops: 0 },
      { path: "AGENTS.md", bytes: 29, hops: 1 },
      { path: "docs/a.md", bytes: 9, hops: 2 },
      { path: "b.md", bytes: 3, hops: 3 },
    ]);
  });

  test("4 段までを数え、5 段目は数えない", () => {
    const root = repo({
      "f0.md": "@f1.md",
      "f1.md": "@f2.md",
      "f2.md": "@f3.md",
      "f3.md": "@f4.md",
      "f4.md": "@f5.md",
    });
    expect(sessionContextFiles(root, ["f0.md"]).map((f) => f.path)).toEqual([
      "f0.md",
      "f1.md",
      "f2.md",
      "f3.md",
      "f4.md",
    ]);
  });

  test("深い段で先に見つけたファイルを浅い段で見つけたら、浅い段から取り込み先を辿り直す", () => {
    const root = repo({
      "f0.md": "@f1.md\n@x.md\n",
      "f1.md": "@f2.md",
      "f2.md": "@f3.md",
      "f3.md": "@x.md",
      "x.md": "@y.md",
      "y.md": "y",
    });
    expect(sessionContextFiles(root, ["f0.md"]).map((f) => [f.path, f.hops])).toEqual([
      ["f0.md", 0],
      ["f1.md", 1],
      ["f2.md", 2],
      ["f3.md", 3],
      ["x.md", 1],
      ["y.md", 2],
    ]);
  });

  test("シンボリックリンクで同じファイルを 2 回取り込んでも 1 回だけ数える", () => {
    const root = repo({ "a.md": "@b.md\n@link.md\n", "b.md": "x" });
    symlinkSync(join(root, "b.md"), join(root, "link.md"));
    expect(sessionContextFiles(root, ["a.md"]).map((f) => f.path)).toEqual(["a.md", "b.md"]);
  });

  test("~/ で始まる取り込みは、ホームディレクトリを基準に辿る", () => {
    const name = "no-such-session-context-file.md";
    const root = repo({ "a.md": `@~/${name}\n` });
    expect(() => sessionContextFiles(root, ["a.md"])).toThrow(
      `a.md が読み込むファイルが無い: ${relative(root, join(homedir(), name))}`,
    );
  });

  test("循環する取り込みは 1 回ずつ数える", () => {
    const root = repo({ "a.md": "@b.md", "b.md": "@a.md" });
    expect(sessionContextFiles(root, ["a.md"]).map((f) => f.path)).toEqual(["a.md", "b.md"]);
  });

  test("絶対パスの取り込みを辿る", () => {
    const root = repo({ "b.md": "x" });
    writeFileSync(join(root, "a.md"), `@${join(root, "b.md")}\n`);
    expect(sessionContextFiles(root, ["a.md"]).map((f) => f.path)).toEqual(["a.md", "b.md"]);
  });

  test("日本語は UTF-8 のバイト数で数える", () => {
    const root = repo({ "a.md": "日本語" });
    expect(sessionContextFiles(root, ["a.md"])).toEqual([{ path: "a.md", bytes: 9, hops: 0 }]);
  });

  test.each([
    ["起点が無い", {}, "session_context.entries が読み込むファイルが無い: CLAUDE.md"],
    [
      "取り込み先が無い",
      { "CLAUDE.md": "@AGENTS.md" },
      "CLAUDE.md が読み込むファイルが無い: AGENTS.md",
    ],
    [
      "取り込み先がディレクトリ",
      { "CLAUDE.md": "@docs", "docs/a.md": "" },
      "CLAUDE.md が読み込むファイルが無い: docs",
    ],
  ])("%s は 0 バイトとして扱わずに例外にする", (_name, files, message) => {
    expect(() => sessionContextFiles(repo(files), ["CLAUDE.md"])).toThrow(message);
  });
});
