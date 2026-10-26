// 使わない語の一覧（`.textlint/word-list.md`）を `.textlint/words.json` から生成するスクリプトの回帰テスト。
//
// 状態空間の軸（判定に使う全入力）と、各セルに置いた入力:
//
// | 軸              | 値                                                                       |
// | --------------- | ------------------------------------------------------------------------ |
// | words.json      | 在る / 無い / entries が配列でない                                          |
// | エントリ        | term と instead を持つ / 両方持たない / 片方だけ / term が重複 / 「|」を含む  |
// | 一覧に出す件数  | 1 件以上 / 0 件                                                            |
// | 一覧のファイル  | 生成した内容と同じ / 違う / 無い                                           |
// | 読む元          | 作業ツリー / index（作業ツリーと違う内容）/ index に無い                    |
import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WORDS_PATH } from "../lib/text/textlint-word-rule.ts";
import { LIST_PATH, main, renderWordList, writeWordList } from "./generate-word-list.ts";
import { write } from "../lib/testing/repo-file.ts";
import { makeTempDir } from "../lib/testing/test-tmpdir.ts";
import { CHILD_TIMEOUT_MS } from "../lib/testing/child-timeout.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const script = join(repoRoot, "scripts/tools/generate-word-list.ts");

const ENTRIES = [
  { term: "旧語", instead: "新語", message: "m", tokens: [] },
  { message: "同じ語の別の形", tokens: [] },
  { term: "古い名前", instead: "新しい名前", message: "m", tokens: [] },
];

/** words.json と一覧のファイルを置いた一時リポジトリ。list が null なら一覧を置かない。 */
type RepoOptions = { entries?: unknown[]; words?: string | null; list?: string | null };

function makeRepo({ entries = ENTRIES, words = undefined, list = null }: RepoOptions = {}) {
  const root = makeTempDir("word-list-");
  write(root, WORDS_PATH, words ?? JSON.stringify({ entries }));
  if (list !== null) write(root, LIST_PATH, list);
  return root;
}

const list = (root: string) => readFileSync(join(root, LIST_PATH), "utf8");

test("生成: term を持つエントリだけを表の行にし、textlint の除外で囲む", () => {
  const text = renderWordList(makeRepo());
  expect(text).toContain(
    [
      "<!-- textlint-disable -->",
      "",
      "| 使わない語 | 言い換え |",
      "| --- | --- |",
      "| 旧語 | 新語 |",
      "| 古い名前 | 新しい名前 |",
      "",
      "<!-- textlint-enable -->",
    ].join("\n"),
  );
  expect(text).not.toContain("同じ語の別の形");
});

test("一覧が無いか内容が違えば、生成した内容で書き換えて true を返す", () => {
  for (const root of [makeRepo({ list: "古い一覧\n" }), makeRepo()]) {
    expect(writeWordList(root)).toBe(true);
    expect(list(root)).toBe(renderWordList(root));
  }
});

test("一覧が生成した内容と同じなら書かずに false を返す", () => {
  const root = makeRepo();
  writeWordList(root);
  expect(writeWordList(root)).toBe(false);
});

test.each<[string, RepoOptions, string]>([
  ["words.json が無い", { words: null }, "が無い"],
  ["entries が配列でない", { words: JSON.stringify({ entries: {} }) }, "配列でない"],
  ["term だけを持つ", { entries: [{ term: "旧語" }] }, "両方持つ"],
  ["instead だけを持つ", { entries: [{ instead: "新語" }] }, "両方持つ"],
  ["term が重複", { entries: [ENTRIES[0], ENTRIES[0]] }, "重複"],
  // 他のエントリが 1 件以上あっても、object でない要素を読み飛ばさない（語が一覧に載らないまま通さない）。
  ["要素が null", { entries: [ENTRIES[0], null] }, "entries[1] が object でない"],
  ["要素が文字列", { entries: [ENTRIES[0], "旧語"] }, "entries[1] が object でない"],
  ["「|」を含む", { entries: [{ term: "a|b", instead: "c" }] }, "「|」"],
  ["一覧に出す行が 0 件", { entries: [ENTRIES[1]] }, "0 件"],
])("%s なら例外にし、一覧を書き換えない", (_, options, message) => {
  const root = makeRepo({ ...(options.words === null ? {} : options), list: "元の一覧\n" });
  if (options.words === null) rmSync(join(root, WORDS_PATH));
  expect(() => writeWordList(root)).toThrow(message);
  expect(list(root)).toBe("元の一覧\n");
});

/** 一時リポジトリを git の管理下にし、words.json を entries の内容で stage する。 */
function stageWords(root: string, entries: unknown[]) {
  const git = (...args: string[]) => {
    const r = spawnSync("git", args, { cwd: root, encoding: "utf8", timeout: CHILD_TIMEOUT_MS });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  };
  git("init", "-q");
  write(root, WORDS_PATH, JSON.stringify({ entries }));
  git("add", WORDS_PATH);
}

test("index から読むと、stage していない作業ツリーの変更は一覧に入れない", () => {
  const root = makeRepo();
  stageWords(root, [ENTRIES[0]]);
  // 作業ツリーだけに語を足す（stage しない）。
  write(root, WORDS_PATH, JSON.stringify({ entries: ENTRIES }));
  expect(writeWordList(root, { fromIndex: true })).toBe(true);
  expect(list(root)).toContain("| 旧語 | 新語 |");
  expect(list(root)).not.toContain("古い名前");
  // 作業ツリーから読むと、stage していない語も入る。
  writeWordList(root);
  expect(list(root)).toContain("| 古い名前 | 新しい名前 |");
});

test("index に words.json が無ければ、例外にして一覧を書き換えない", () => {
  const root = makeRepo({ list: "元の一覧\n" });
  stageWords(root, [ENTRIES[0]]);
  spawnSync("git", ["rm", "-q", "--cached", WORDS_PATH], {
    cwd: root,
    timeout: CHILD_TIMEOUT_MS,
  });
  expect(() => writeWordList(root, { fromIndex: true })).toThrow(
    `index の ${WORDS_PATH} を読めない`,
  );
  expect(list(root)).toBe("元の一覧\n");
});

test("CLI: --index を付けると、index の words.json から生成する", () => {
  const root = makeRepo();
  stageWords(root, [ENTRIES[0]]);
  write(root, WORDS_PATH, JSON.stringify({ entries: ENTRIES }));
  const r = spawnSync(process.execPath, [script, "--index", root], {
    timeout: CHILD_TIMEOUT_MS,
    encoding: "utf8",
  });
  expect(r.status).toBe(0);
  expect(list(root)).not.toContain("古い名前");
});

test("main: 生成できれば 0、作れなければ 2 を返す", () => {
  expect(main([makeRepo()])).toBe(0);
  expect(main([makeRepo({ entries: [ENTRIES[1]] })])).toBe(2);
});

test("CLI: 子プロセスとして起動すると、一覧を生成し直して exit 0", () => {
  const root = makeRepo({ list: "x\n" });
  const r = spawnSync(process.execPath, [script, root], {
    timeout: CHILD_TIMEOUT_MS,
    encoding: "utf8",
  });
  expect(r.status).toBe(0);
  expect(r.stdout).toContain("を生成し直した");
  expect(list(root)).toBe(renderWordList(root));
});

test("実リポジトリ: AGENTS.md が一覧を @ で取り込んでいる", () => {
  // Claude Code はコードスパンの中の @path を取り込まないので、行頭に裸で書いてあることを確かめる。
  expect(readFileSync(join(repoRoot, "AGENTS.md"), "utf8")).toMatch(
    /^@\.textlint\/word-list\.md$/m,
  );
});
