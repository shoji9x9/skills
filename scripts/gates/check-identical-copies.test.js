// 同一であるべきコピーの一致検査の回帰テスト。
//
// **実リポジトリのコピーの中身には前提を置かない。** 宣言した組は姉妹スキルの編集中に一時的に
// 食い違いうるので、一致・不一致の判定は一時ディレクトリの fixture で測り、実リポジトリには
// 「宣言が形を満たし、宣言したファイルが実在する」ことだけを当てる。
//
// 状態空間の軸（判定に使う全入力）と、各セルに置いた入力:
//
// | 軸               | 値                                                                     |
// | ---------------- | ---------------------------------------------------------------------- |
// | 宣言ファイル     | 在る / 無い / JSON でない                                               |
// | groups           | 1 件 / 複数件 / 0 件 / 配列でない                                       |
// | files            | 2 件 / 3 件以上 / 1 件 / 空文字を含む / 組をまたいで重複                |
// | reason           | 在る / 空白だけ                                                         |
// | 宣言したファイル | 在る / 無い                                                             |
// | 内容             | 完全一致 / 途中の行の追加 / 末尾改行だけの差 / 3 件中 1 件だけ違う        |
import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DECLARATION_PATH,
  checkIdenticalCopies,
  loadGroups,
  main,
} from "./check-identical-copies.js";
import { makeTempDir } from "../lib/test-tmpdir.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const script = join(repoRoot, "scripts/gates/check-identical-copies.js");

const BODY = "# 手順\n\n1 行目\n2 行目\n3 行目\n";

function write(root, path, text) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

/** `files` を置き、`groups` を宣言した一時リポジトリ。 */
function makeRepo(files, groups) {
  const root = makeTempDir("identical-copies-");
  for (const [p, t] of Object.entries(files)) write(root, p, t);
  if (groups !== undefined) write(root, DECLARATION_PATH, JSON.stringify({ groups }));
  return root;
}

const group = (...files) => ({ files, reason: "姉妹スキルが同じ規則で動く" });

// ---- 誤検知しないことの確認（通さねばならない入力）----

test("陰性: 2 件の組が完全一致なら違反 0 件で、組と件数を数える", () => {
  const root = makeRepo({ "a/x.md": BODY, "b/x.md": BODY }, [group("a/x.md", "b/x.md")]);
  expect(checkIdenticalCopies(root)).toEqual({ groups: 1, files: 2, violations: [] });
});

test("陰性: 3 件以上の組も全件が一致すれば通す", () => {
  const files = { "a/x.md": BODY, "b/x.md": BODY, "c/x.md": BODY, "d/x.md": BODY };
  const root = makeRepo(files, [group(...Object.keys(files))]);
  expect(checkIdenticalCopies(root).violations).toEqual([]);
});

test("陰性: 複数の組は組ごとに比べる（組をまたいで同じ内容を要求しない）", () => {
  const root = makeRepo(
    { "a/x.md": BODY, "b/x.md": BODY, "a/y.sh": "echo y\n", "b/y.sh": "echo y\n" },
    [group("a/x.md", "b/x.md"), group("a/y.sh", "b/y.sh")],
  );
  expect(checkIdenticalCopies(root)).toEqual({ groups: 2, files: 4, violations: [] });
});

test.each([
  ["両方に同じ追記を当てた", `${BODY}追記した手順\n`],
  ["CRLF 改行同士", BODY.replace(/\n/g, "\r\n")],
  ["空ファイル同士", ""],
  ["BOM 付き同士", `\uFEFF${BODY}`],
  ["末尾改行の無い 1 行同士", "1 行だけ"],
  ["大きなファイル（1 MiB）同士", "x".repeat(1 << 20)],
])("陰性: 組の全ファイルが同じ内容（%s）なら通す", (_, text) => {
  const root = makeRepo({ "a/x.md": text, "b/x.md": text }, [group("a/x.md", "b/x.md")]);
  expect(checkIdenticalCopies(root).violations).toEqual([]);
});

test("陰性: 組の中の並びを入れ替えても結果は変わらない（基準は先頭だが一致判定は対称）", () => {
  const root = makeRepo({ "a/x.md": BODY, "b/x.md": BODY }, [group("b/x.md", "a/x.md")]);
  expect(checkIdenticalCopies(root).violations).toEqual([]);
});

test("陰性: 宣言の $comment や組の追加キーは読み飛ばす", () => {
  const root = makeRepo({ "a/x.md": BODY, "b/x.md": BODY });
  write(
    root,
    DECLARATION_PATH,
    JSON.stringify({
      $comment: ["説明"],
      groups: [{ ...group("a/x.md", "b/x.md"), note: "補足" }],
    }),
  );
  expect(checkIdenticalCopies(root).violations).toEqual([]);
});

test("陰性: 実リポジトリの宣言が形を満たし、宣言したファイルがすべて実在する", () => {
  const groups = loadGroups(repoRoot);
  expect(groups.length).toBeGreaterThan(0);
  for (const g of groups)
    for (const f of g.files) expect(existsSync(join(repoRoot, f)), f).toBe(true);
});

// ---- 検出されることの確認（落とす入力）----

test("陽性: 片方の途中にだけ行を足したら、最初に食い違う行番号を付けて落とす", () => {
  const edited = BODY.replace("2 行目\n", "2 行目\n片方にだけ足した実測の追記\n");
  const root = makeRepo({ "a/x.md": BODY, "b/x.md": edited }, [group("a/x.md", "b/x.md")]);
  expect(checkIdenticalCopies(root).violations).toEqual([
    "b/x.md: a/x.md と一致しない（最初の差分は 5 行目）",
  ]);
});

test("陽性: 末尾改行だけの差もバイト単位で落とす", () => {
  const root = makeRepo({ "a/x.md": BODY, "b/x.md": BODY.trimEnd() }, [group("a/x.md", "b/x.md")]);
  expect(checkIdenticalCopies(root).violations).toHaveLength(1);
});

test("陽性: 3 件の組で 1 件だけ違えば、その 1 件だけを報告する", () => {
  const root = makeRepo({ "a/x.md": BODY, "b/x.md": BODY, "c/x.md": `${BODY}x\n` }, [
    group("a/x.md", "b/x.md", "c/x.md"),
  ]);
  const { violations } = checkIdenticalCopies(root);
  expect(violations).toHaveLength(1);
  expect(violations[0]).toMatch(/^c\/x\.md: a\/x\.md と一致しない/);
});

test("陽性: 宣言したファイルが無ければ落とす（移動・改名で組が空振りしない）", () => {
  const root = makeRepo({ "a/x.md": BODY }, [group("a/x.md", "b/x.md")]);
  expect(checkIdenticalCopies(root).violations).toEqual(["b/x.md: 宣言したファイルが無い"]);
});

test.each([
  ["宣言ファイルが無い", undefined],
  ["groups が 0 件", []],
  ["groups が配列でない", { a: 1 }],
  ["files が 1 件", [group("a/x.md")]],
  ["files に空文字", [group("a/x.md", "")]],
  ["reason が空白だけ", [{ files: ["a/x.md", "b/x.md"], reason: " " }]],
  ["組をまたいだ重複", [group("a/x.md", "b/x.md"), group("a/x.md", "c/x.md")]],
])("陽性: 宣言が読めない（%s）なら exit 2（組 0 件＝違反なしとして扱わない）", (_, groups) => {
  const root = makeRepo({ "a/x.md": BODY, "b/x.md": BODY, "c/x.md": BODY }, groups);
  // 宣言の段で弾くこと（比較の段の読み取り失敗で偶然 exit 2 になる形と区別する）。
  expect(() => loadGroups(root)).toThrow();
  expect(main([root])).toBe(2);
});

test("陽性: 宣言が JSON でなければ exit 2", () => {
  const root = makeRepo({ [DECLARATION_PATH]: "{ groups: " });
  expect(main([root])).toBe(2);
});

test("検出の確認（CLI）: 子プロセスとして起動しても、不一致は exit 1、一致なら exit 0", () => {
  const ok = makeRepo({ "a/x.md": BODY, "b/x.md": BODY }, [group("a/x.md", "b/x.md")]);
  const good = spawnSync(process.execPath, [script, ok], { encoding: "utf8" });
  expect(good.status, good.stderr).toBe(0);
  expect(good.stdout).toMatch(/identical-copies: OK（1 組・2 件）/);
  const ng = makeRepo({ "a/x.md": BODY, "b/x.md": "x\n" }, [group("a/x.md", "b/x.md")]);
  const bad = spawnSync(process.execPath, [script, ng], { encoding: "utf8" });
  expect(bad.status).toBe(1);
  expect(bad.stderr).toMatch(/1 件の不一致/);
});
