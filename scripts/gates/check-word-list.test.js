// 使わない語の一覧（`.textlint/word-list.md`）と `.textlint/words.json` の一致チェックの回帰テスト。
//
// 状態空間の軸（判定に使う全入力）と、各セルに置いた入力:
//
// | 軸              | 値                                                                       |
// | --------------- | ------------------------------------------------------------------------ |
// | words.json      | 在る / 無い / entries が配列でない                                          |
// | エントリ        | term と instead を持つ / 両方持たない / 片方だけ / term が重複 / 「|」を含む  |
// | 一覧に出す件数  | 1 件以上 / 0 件                                                            |
// | 一覧のファイル  | 生成した内容と一致 / 1 行だけ違う / 無い                                     |
// | --fix           | なし / あり                                                               |
import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LIST_PATH, WORDS_PATH, checkWordList, main, renderWordList } from "./check-word-list.js";
import { makeTempDir } from "../lib/test-tmpdir.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const script = join(repoRoot, "scripts/gates/check-word-list.js");

const ENTRIES = [
  { term: "旧語", instead: "新語", message: "m", tokens: [] },
  { message: "同じ語の別の形", tokens: [] },
  { term: "古い名前", instead: "新しい名前", message: "m", tokens: [] },
];

function write(root, path, text) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

/** words.json と一覧のファイルを置いた一時リポジトリ。list が null なら一覧を置かない。 */
function makeRepo({ entries = ENTRIES, words = undefined, list = null } = {}) {
  const root = makeTempDir("word-list-");
  write(root, WORDS_PATH, words ?? JSON.stringify({ entries }));
  if (list !== null) write(root, LIST_PATH, list);
  return root;
}

/** 生成した内容と一致する一覧を置いた一時リポジトリ。 */
function makeSyncedRepo() {
  const root = makeRepo();
  write(root, LIST_PATH, renderWordList(root));
  return root;
}

const list = (root) => readFileSync(join(root, LIST_PATH), "utf8");

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

test("陰性: 一覧が生成した内容と一致すれば通す", () => {
  expect(checkWordList(makeSyncedRepo())).toEqual({ ok: true, fixed: false });
});

test("陽性: 1 行だけ違えば一致しないと報告し、ファイルは書き換えない", () => {
  const root = makeSyncedRepo();
  write(
    root,
    LIST_PATH,
    list(root).replace("| 古い名前 | 新しい名前 |", "| 古い名前 | 別の名前 |"),
  );
  const before = list(root);
  expect(checkWordList(root)).toEqual({ ok: false, fixed: false });
  expect(list(root)).toBe(before);
});

test("陽性: 一覧のファイルが無ければ一致しないと報告する", () => {
  expect(checkWordList(makeRepo())).toEqual({ ok: false, fixed: false });
});

test("--fix: 生成した内容で書き換え（無ければ作り）、その後は一致する", () => {
  for (const root of [makeRepo({ list: "古い一覧\n" }), makeRepo()]) {
    expect(checkWordList(root, { fix: true })).toEqual({ ok: true, fixed: true });
    expect(list(root)).not.toContain("古い一覧");
    expect(checkWordList(root)).toEqual({ ok: true, fixed: false });
  }
});

test.each([
  ["words.json が無い", { words: null }, "が無い"],
  ["entries が配列でない", { words: JSON.stringify({ entries: {} }) }, "配列でない"],
  ["term だけを持つ", { entries: [{ term: "旧語" }] }, "両方持つ"],
  ["instead だけを持つ", { entries: [{ instead: "新語" }] }, "両方持つ"],
  ["term が重複", { entries: [ENTRIES[0], ENTRIES[0]] }, "重複"],
  ["「|」を含む", { entries: [{ term: "a|b", instead: "c" }] }, "「|」"],
  ["一覧に出す行が 0 件", { entries: [ENTRIES[1]] }, "0 件"],
])("%s なら例外にする", (_, options, message) => {
  const root = makeRepo(options.words === null ? {} : options);
  if (options.words === null) rmSync(join(root, WORDS_PATH));
  expect(() => checkWordList(root)).toThrow(message);
});

test("main: 一致なら 0、食い違いは 1、作れなければ 2 を返す", () => {
  expect(main([makeSyncedRepo()])).toBe(0);
  expect(main([makeRepo({ list: "x\n" })])).toBe(1);
  expect(main([makeRepo({ entries: [ENTRIES[1]] })])).toBe(2);
});

test("検出の確認（CLI）: 子プロセスとして起動しても、食い違いは exit 1、--fix の後は exit 0", () => {
  const root = makeRepo({ list: "x\n" });
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
  expect(run(root).status).toBe(1);
  expect(run("--fix", root).status).toBe(0);
  expect(run(root).status).toBe(0);
});

test("実リポジトリ: 一覧は words.json と一致し、AGENTS.md が @ で取り込んでいる", () => {
  expect(checkWordList(repoRoot)).toEqual({ ok: true, fixed: false });
  expect(existsSync(join(repoRoot, LIST_PATH))).toBe(true);
  // Claude Code はコードスパンの中の @path を取り込まないので、行頭に裸で書いてあることを確かめる。
  expect(readFileSync(join(repoRoot, "AGENTS.md"), "utf8")).toMatch(
    /^@\.textlint\/word-list\.md$/m,
  );
});
