// json-normalize-diff.mjs のテスト。
// 取り決め（references/api-batch.md）は次のとおりである。
// - `--ignore` で揮発項目を除く。`*` のセグメントは、配列の要素とオブジェクトの値をすべてたどる
// - `--sort-arrays` で指定した配列だけ順序を正規化する。指定しない配列の順序の差は差分にする
// - 出力は差分のパスと両側の値の JSON 配列で、終了コードは 0 が差分なし、1 が差分あり、2 が入力の誤り
//
// `__proto__` のキーの回帰（Issue #598）は、正規化の純関数（removePath・sortArrayAtPath・canonicalize）を
// 直接呼んで確かめる。戻り値は、CLI が比べる前に作る正規化した値で、出力の current・new の値と同じ意味を持つ。
// JSON.parse は `__proto__` を自分の欄として作るが、オブジェクトを `out[key] = ...` で組み直すと、
// そのキーはプロトタイプの設定として扱われて消える。すると、除去（--ignore）や並べ替え（--sort-arrays）の後に
// そのキーの差分を見ないまま exit 0 になる。
// 入力は JSON.parse か JSON の文字列で作る（オブジェクトリテラルの `__proto__` はプロトタイプの設定になり、欄にならない）。

import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import {
  removePath,
  sortArrayAtPath,
} from "../../../skills/parity-diff/scripts/json-normalize-diff.mjs";
import { canonicalize } from "../../../skills/parity-diff/scripts/lib/json.mjs";
import { parseJsonAs } from "../../lib/parse-as.ts";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const script = join(repoRoot, "skills/parity-diff/scripts/json-normalize-diff.mjs");

type DiffEntry = { path: string; current: unknown; new: unknown };

/** 2 つの JSON の文字列をファイルに書き、CLI を 1 回実行する。 */
function runCli(currentJson: string, newJson: string, args: string[] = []) {
  const dir = makeTempDir("json-normalize-diff-");
  const current = join(dir, "current.json");
  const next = join(dir, "new.json");
  writeFileSync(current, currentJson);
  writeFileSync(next, newJson);
  const r = spawnSync(process.execPath, [script, current, next, ...args], {
    encoding: "utf8",
    timeout: 30_000,
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** 差分の配列を読む（stdout が JSON の配列でなければ例外にする）。 */
function diffsOf(stdout: string): DiffEntry[] {
  return parseJsonAs<DiffEntry[]>(stdout);
}

test("canonicalize は __proto__ のキーも残し、キーを再帰的に昇順にする", () => {
  const value: unknown = JSON.parse('{"b":1,"__proto__":{"y":2,"x":1}}');
  expect(JSON.stringify(canonicalize(value))).toBe('{"__proto__":{"x":1,"y":2},"b":1}');
});

test("__proto__ の値だけが違う要素も、その値の順に並べる", () => {
  const items: unknown = JSON.parse('[{"__proto__":"b","x":1},{"__proto__":"a","x":1}]');
  expect(JSON.stringify(sortArrayAtPath(items, []))).toBe(
    '[{"__proto__":"a","x":1},{"__proto__":"b","x":1}]',
  );
});

// 除去（removePath）と、並べ替える配列までのオブジェクトの複製（sortArrayAtPath）も、オブジェクトを組み直す。
// そこで `__proto__` のキーが消えると、そのキーの差分を見ないまま exit 0 になる。
test("removePath は除去しないキーとして __proto__ を残す", () => {
  const value: unknown = JSON.parse('{"__proto__":1,"a":1,"t":5}');
  expect(JSON.stringify(removePath(value, ["t"]))).toBe('{"__proto__":1,"a":1}');
});

test("removePath のワイルドカードの下でも __proto__ を残す", () => {
  const value: unknown = JSON.parse('{"k":{"__proto__":1,"t":5}}');
  expect(JSON.stringify(removePath(value, ["*", "t"]))).toBe('{"k":{"__proto__":1}}');
});

test("sortArrayAtPath は配列までの途中のオブジェクトにある __proto__ を残す", () => {
  const value: unknown = JSON.parse('{"__proto__":1,"x":[2,1]}');
  expect(JSON.stringify(sortArrayAtPath(value, ["x"]))).toBe('{"__proto__":1,"x":[1,2]}');
});

test("--ignore を付けても __proto__ の値の差分を見逃さない", () => {
  const r = runCli('{"__proto__":1,"a":1,"t":5}', '{"__proto__":2,"a":1,"t":6}', ["--ignore", "t"]);
  expect(diffsOf(r.stdout)).toEqual([{ path: "__proto__", current: 1, new: 2 }]);
  expect(r.status).toBe(1);
});

test("キーの順だけが違うオブジェクトは差分にしない（exit 0）", () => {
  const r = runCli('{"a":1,"b":{"c":2,"d":3}}', '{"b":{"d":3,"c":2},"a":1}');
  expect(diffsOf(r.stdout)).toEqual([]);
  expect(r.status).toBe(0);
});

test("値の違い・片側に無いキー・長さの違う配列を、パスと両側の値で列挙する（exit 1）", () => {
  const r = runCli('{"a":1,"gone":true,"list":[1,2]}', '{"a":2,"added":"x","list":[1,2,3]}');
  expect(diffsOf(r.stdout)).toEqual([
    { path: "a", current: 1, new: 2 },
    { path: "added", current: "(absent)", new: "x" },
    { path: "gone", current: true, new: "(absent)" },
    { path: "list.2", current: "(absent)", new: 3 },
  ]);
  expect(r.status).toBe(1);
});

test("配列とオブジェクトのように型が違う値は、その位置を 1 件の差分にする", () => {
  const r = runCli('{"v":[1]}', '{"v":{"0":1}}');
  expect(diffsOf(r.stdout)).toEqual([{ path: "v", current: [1], new: { 0: 1 } }]);
  expect(r.status).toBe(1);
});

test("最上位が配列でも、index のパスで差分を出す", () => {
  const r = runCli("[1,2]", "[1,3]");
  expect(diffsOf(r.stdout)).toEqual([{ path: "1", current: 2, new: 3 }]);
  expect(r.status).toBe(1);
});

test("--sort-arrays を指定しない配列の順序の差は差分にする（宣言なしに順序を消さない）", () => {
  const r = runCli('{"items":[1,2]}', '{"items":[2,1]}');
  expect(diffsOf(r.stdout)).toEqual([
    { path: "items.0", current: 1, new: 2 },
    { path: "items.1", current: 2, new: 1 },
  ]);
  expect(r.status).toBe(1);
});

test("--sort-arrays は要素のキーの順に依らず同じ集合を同じ順に並べる", () => {
  const r = runCli('{"items":[{"b":1,"a":2},{"a":1}]}', '{"items":[{"a":1},{"a":2,"b":1}]}', [
    "--sort-arrays",
    "items",
  ]);
  expect(diffsOf(r.stdout)).toEqual([]);
  expect(r.status).toBe(0);
});

test("--sort-arrays の * と index は、配列の要素の中の配列をたどる", () => {
  const current = '{"rows":[{"tags":["b","a"]},{"tags":["d","c"]}]}';
  const next = '{"rows":[{"tags":["a","b"]},{"tags":["c","d"]}]}';
  const all = runCli(current, next, ["--sort-arrays", "rows.*.tags"]);
  expect(diffsOf(all.stdout)).toEqual([]);
  expect(all.status).toBe(0);
  // index を指定したら、その要素の配列だけを並べ替える。
  const first = runCli(current, next, ["--sort-arrays", "rows.0.tags"]);
  expect(diffsOf(first.stdout)).toEqual([
    { path: "rows.1.tags.0", current: "d", new: "c" },
    { path: "rows.1.tags.1", current: "c", new: "d" },
  ]);
  expect(first.status).toBe(1);
});

test("--sort-arrays のパスの先が配列でない・値が無いときは、入力をそのまま比べる", () => {
  const r = runCli('{"o":{"k":1},"n":5}', '{"o":{"k":1},"n":5}', [
    "--sort-arrays",
    "o",
    "--sort-arrays",
    "n.deeper",
    "--sort-arrays",
    "missing.path",
  ]);
  expect(diffsOf(r.stdout)).toEqual([]);
  expect(r.status).toBe(0);
});

test("--ignore の * は、配列の要素のキーを除く（data.*.updated_at）", () => {
  const r = runCli(
    '{"data":[{"id":1,"updated_at":"t1"},{"id":2,"updated_at":"t2"}]}',
    '{"data":[{"id":1,"updated_at":"t3"},{"id":3,"updated_at":"t4"}]}',
    ["--ignore", "data.*.updated_at"],
  );
  expect(diffsOf(r.stdout)).toEqual([{ path: "data.1.id", current: 2, new: 3 }]);
  expect(r.status).toBe(1);
});

test("--ignore の末尾の * は、配列の要素とオブジェクトの値をすべて除く", () => {
  const r = runCli('{"arr":[1,2],"obj":{"a":1}}', '{"arr":[3],"obj":{"b":2}}', [
    "--ignore",
    "arr.*",
    "--ignore",
    "obj.*",
  ]);
  expect(diffsOf(r.stdout)).toEqual([]);
  expect(r.status).toBe(0);
});

test("--ignore の index は、その要素だけを null にして除き、範囲外や数でないセグメントは何も除かない", () => {
  const byIndex = runCli('{"arr":[1,{"t":5,"k":1}]}', '{"arr":[2,{"t":6,"k":1}]}', [
    "--ignore",
    "arr.0",
    "--ignore",
    "arr.1.t",
  ]);
  expect(diffsOf(byIndex.stdout)).toEqual([]);
  expect(byIndex.status).toBe(0);
  const untouched = runCli('{"arr":[1]}', '{"arr":[2]}', [
    "--ignore",
    "arr.5",
    "--ignore",
    "arr.x",
    "--ignore",
    "arr.0.deeper",
  ]);
  expect(diffsOf(untouched.stdout)).toEqual([{ path: "arr.0", current: 1, new: 2 }]);
  expect(untouched.status).toBe(1);
});

test("値の無い --ignore / --sort-arrays は読み飛ばし、比較は続ける", () => {
  const r = runCli('{"a":1}', '{"a":2}', ["--ignore", "", "--sort-arrays"]);
  expect(diffsOf(r.stdout)).toEqual([{ path: "a", current: 1, new: 2 }]);
  expect(r.status).toBe(1);
});

test("入力のファイルが 2 つでなければ、使い方を出して exit 2 にする", () => {
  const dir = makeTempDir("json-normalize-diff-");
  const only = join(dir, "current.json");
  writeFileSync(only, "{}");
  const r = spawnSync(process.execPath, [script, only], { encoding: "utf8", timeout: 30_000 });
  expect(r.stderr).toContain("usage: node json-normalize-diff.mjs");
  expect(r.stdout).toBe("");
  expect(r.status).toBe(2);
});

test.each([
  ["JSON でない", "{not json"],
  ["空", ""],
])("入力が読めない（%s）なら、差分を出さずに exit 2 にする", (_name, broken) => {
  const r = runCli("{}", broken);
  expect(r.stderr).toContain("error: cannot read inputs:");
  expect(r.stdout).toBe("");
  expect(r.status).toBe(2);
});

test("入力のファイルが無ければ exit 2 にする", () => {
  const dir = makeTempDir("json-normalize-diff-");
  const r = spawnSync(process.execPath, [script, join(dir, "a.json"), join(dir, "b.json")], {
    encoding: "utf8",
    timeout: 30_000,
  });
  expect(r.stderr).toContain("error: cannot read inputs:");
  expect(r.status).toBe(2);
});

// lib/cli.mjs の isCliEntry: モジュールとして読み込んだときは CLI を起動しない。
// 起動時のパス（process.argv[1]）が無いときと、実パスに解決できないときの両方を確かめる。
test.each([
  ["起動時のパスが無い", []],
  ["起動時のパスを実パスに解決できない", ["/nonexistent/json-normalize-diff.mjs"]],
])("モジュールとして読み込んだときは CLI を起動しない（%s）", (_name, extra) => {
  const code = `await import(${JSON.stringify(script)}); console.log("imported");`;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", code, ...extra], {
    encoding: "utf8",
    timeout: 30_000,
  });
  expect(r.stdout).toBe("imported\n");
  expect(r.stderr).not.toContain("usage:");
  expect(r.status).toBe(0);
});
