// parity-suite の表の 1 行更新ツール（table-upsert.mjs）の回帰テスト（Issue #468）。
//
// 網羅表を本文ごと書き直さず 1 行ずつ差し替えるためのツールなので、起こりうる不具合は「別の行を上書きする」と
// 「照合し直していない表を照合済みに見せる」の 2 つ。鍵の欠落・空・重複・型崩れで書き込まずに止まること、
// 書き換えたら conformance が消えることを固定する。
//
// 通ることの確認（差し替え・追記・入れ子の配列・複合鍵・標準入力）を置く。これが無いと「常に止める」実装と区別できない。

import { test, expect } from "vitest";
import { invalidInput } from "../../../lib/testing/test-input.ts";
import { parseJsonAs } from "../../../lib/parse-as.ts";
import { type Operation, type Table, baseTable, run, upsert } from "./table-upsert-helpers.ts";

type Keyed = { id: string };
/** スクリプトが書き戻した表。テストによっては Table に無いキー（cells など）を持つ。 */
type TableOut = Table & Record<string, unknown>;

test("基本の動作: 鍵が一致する要素を差し替え、他の行と順序は動かさない", () => {
  const r = run(baseTable(), upsert("operations"), {
    fragment: { id: "copy", trigger: "clickButton(複製)" },
  });
  expect(r.stderr).toBe("");
  expect(r.status).toBe(0);
  expect(JSON.parse(r.stdout)).toMatchObject({ action: "replaced", count: 2 });
  const t = parseJsonAs<TableOut>(r.after);
  expect(t.operations).toEqual([
    { id: "copy", trigger: "clickButton(複製)" },
    { id: "search", trigger: "clickButton(検索)" },
  ]);
});

test("基本の動作: 一致が無ければ末尾に足す", () => {
  const r = run(baseTable(), upsert("operations"), { fragment: { id: "reset", trigger: "x()" } });
  expect(r.status).toBe(0);
  expect(JSON.parse(r.stdout)).toMatchObject({ action: "appended", count: 3 });
  expect(parseJsonAs<TableOut>(r.after).operations.map((o: Keyed) => o.id)).toEqual([
    "copy",
    "search",
    "reset",
  ]);
});

test("書き換えたら conformance を消す（照合し直していない表を照合済みに見せない）", () => {
  const r = run(baseTable(), upsert("operations"), { fragment: { id: "copy", trigger: "y()" } });
  expect(r.status).toBe(0);
  expect(parseJsonAs<Record<string, unknown>>(r.stdout).conformance_removed).toBe(true);
  expect(parseJsonAs<TableOut>(r.after)).not.toHaveProperty("conformance");
});

test("conformance が無い表では conformance_removed: false", () => {
  const t = baseTable();
  delete t.conformance;
  const r = run(t, upsert("operations"), { fragment: { id: "copy", trigger: "y()" } });
  expect(r.status).toBe(0);
  expect(parseJsonAs<Record<string, unknown>>(r.stdout).conformance_removed).toBe(false);
});

test("複合鍵（file, line, column, pattern）で call_sites の 1 行を差し替える", () => {
  const r = run(
    baseTable(),
    upsert("feedback_calls.call_sites", ["--key", "file,line,column,pattern"]),
    {
      fragment: {
        file: "src/share.js",
        line: 2,
        column: 3,
        pattern: "toast",
        reaction: "copy/toast",
      },
    },
  );
  expect(r.status).toBe(0);
  expect(parseJsonAs<TableOut>(r.after).feedback_calls.call_sites).toEqual([
    { file: "src/share.js", line: 2, column: 3, pattern: "toast", reaction: "copy/toast" },
  ]);
});

test("複合鍵の 1 つだけが違う要素は別の行として足す（鍵が潰れない）", () => {
  const r = run(
    baseTable(),
    upsert("feedback_calls.call_sites", ["--key", "file,line,column,pattern"]),
    { fragment: { file: "src/share.js", line: 2, column: 4, pattern: "toast", reaction: null } },
  );
  expect(r.status).toBe(0);
  expect(parseJsonAs<TableOut>(r.after).feedback_calls.call_sites).toHaveLength(2);
});

test("入れ子の配列を name[field=value] で選んで足す", () => {
  const r = run(baseTable(), upsert("components[id=grid].instances"), {
    fragment: { id: "detail", page: "詳細" },
  });
  expect(r.status).toBe(0);
  const t = parseJsonAs<TableOut>(r.after);
  expect(t.components[0].instances.map((i: Keyed) => i.id)).toEqual(["list", "detail"]);
  expect(t.components[1].instances).toEqual([]);
});

test("末尾の配列のキーが無ければ upsert は空配列から作る", () => {
  const r = run(baseTable(), upsert("cells", ["--key", "component,item,instance"]), {
    fragment: { component: "grid", item: "sort", instance: "list", value: "present" },
  });
  expect(r.status).toBe(0);
  expect(parseJsonAs<TableOut>(r.after).cells).toHaveLength(1);
});

test("--from - で標準入力から断片を読む", () => {
  const r = run(
    baseTable(),
    ["upsert", "--file", "t.json", "--array", "operations", "--from", "-"],
    {
      input: JSON.stringify({ id: "copy", trigger: "z()" }),
    },
  );
  expect(r.status).toBe(0);
  expect(parseJsonAs<TableOut>(r.after).operations[0].trigger).toBe("z()");
});

test("get は一致する 1 要素だけを出す", () => {
  const r = run(baseTable(), [
    "get",
    "--file",
    "t.json",
    "--array",
    "operations",
    "--match",
    '{"id":"search"}',
  ]);
  expect(r.status).toBe(0);
  expect(JSON.parse(r.stdout)).toEqual({ id: "search", trigger: "clickButton(検索)" });
});

test("keys は全要素の鍵を 1 行 1 件で出す", () => {
  const r = run(baseTable(), ["keys", "--file", "t.json", "--array", "operations"]);
  expect(r.status).toBe(0);
  expect(r.stdout).toBe('["copy"]\n["search"]\n');
});

test("remove は一致する要素だけを消し、conformance も消す", () => {
  const r = run(baseTable(), [
    "remove",
    "--file",
    "t.json",
    "--array",
    "operations",
    "--match",
    '{"id":"copy"}',
  ]);
  expect(r.status).toBe(0);
  const t = parseJsonAs<TableOut>(r.after);
  expect(t.operations.map((o: Keyed) => o.id)).toEqual(["search"]);
  expect(t).not.toHaveProperty("conformance");
});

test.each([
  ["get", '{"id":"nope"}'],
  ["remove", '{"id":"nope"}'],
])("%s で一致が無ければ exit 1 で表を書き換えない", (command, match) => {
  const before = JSON.stringify(baseTable(), null, 2);
  const r = run(baseTable(), [
    command,
    "--file",
    "t.json",
    "--array",
    "operations",
    "--match",
    match,
  ]);
  expect(r.status).toBe(1);
  expect(r.after).toBe(before);
});

test.each([
  {
    name: "断片に鍵が無い",
    fragment: { trigger: "x()" },
    array: "operations",
    extra: [],
    needle: "鍵（id）が欠けている",
  },
  {
    name: "断片の鍵が空文字",
    fragment: { id: " ", trigger: "x()" },
    array: "operations",
    extra: [],
    needle: "鍵（id）が欠けている",
  },
  {
    name: "断片の鍵がオブジェクト",
    fragment: { id: { a: 1 } },
    array: "operations",
    extra: [],
    needle: "鍵（id）が欠けている",
  },
  {
    name: "断片の鍵が小数",
    fragment: { id: 1.5 },
    array: "operations",
    extra: [],
    needle: "鍵（id）が欠けている",
  },
  {
    name: "断片が配列",
    fragment: [{ id: "copy" }],
    array: "operations",
    extra: [],
    needle: "1 要素のオブジェクトでない",
  },
  {
    name: "断片が不正な JSON",
    fragment: "{",
    array: "operations",
    extra: [],
    needle: "断片を読めない",
  },
  {
    name: "配列でないキーを指す",
    fragment: { id: "x" },
    array: "slug",
    extra: [],
    needle: "配列でない",
  },
  {
    name: "途中のキーが無い",
    fragment: { id: "x" },
    array: "nothing.call_sites",
    extra: [],
    needle: "nothing が無い",
  },
  {
    name: "途中のキーがオブジェクトでない",
    fragment: { id: "x" },
    array: "slug.call_sites",
    extra: [],
    needle: "オブジェクトでない",
  },
  {
    name: "選択が 0 件",
    fragment: { id: "x" },
    array: "components[id=none].instances",
    extra: [],
    needle: "0 件",
  },
  {
    name: "末尾が要素の選択",
    fragment: { id: "x" },
    array: "components[id=grid]",
    extra: [],
    needle: "末尾は配列のキー",
  },
  {
    name: "--array の形が崩れている",
    fragment: { id: "x" },
    array: "operations..x",
    extra: [],
    needle: "形が読めない",
  },
  {
    name: "継承プロパティを辿る（__proto__）",
    fragment: { id: "x" },
    array: "__proto__.rows",
    extra: [],
    needle: "使えない名前",
  },
  {
    name: "継承プロパティを辿る（constructor）",
    fragment: { id: "x" },
    array: "constructor.rows",
    extra: [],
    needle: "使えない名前",
  },
  {
    name: "末尾が継承プロパティ",
    fragment: { id: "x" },
    array: "feedback_calls.__proto__",
    extra: [],
    needle: "使えない名前",
  },
  {
    name: "選ぶ鍵が継承プロパティ",
    fragment: { id: "x" },
    array: "components[__proto__=x].instances",
    extra: [],
    needle: "使えない名前",
  },
  {
    name: "--key が空を含む",
    fragment: { id: "x" },
    array: "operations",
    extra: ["--key", "id,"],
    needle: "--key が空・重複",
  },
  {
    name: "--key が重複",
    fragment: { id: "x" },
    array: "operations",
    extra: ["--key", "id,id"],
    needle: "--key が空・重複",
  },
])("書き込まずに exit 2: $name", ({ fragment, array, extra, needle }) => {
  const before = JSON.stringify(baseTable(), null, 2);
  const r = run(baseTable(), upsert(array, extra), { fragment });
  expect(r.status).toBe(2);
  expect(r.stderr).toContain(needle);
  expect(r.after).toBe(before);
});

test("選択が複数件なら先勝ちにせず exit 2", () => {
  const t = baseTable();
  t.components.push({ id: "grid", instances: [] });
  const r = run(t, upsert("components[id=grid].instances"), { fragment: { id: "x" } });
  expect(r.status).toBe(2);
  expect(r.stderr).toContain("2 件");
});

test("既存の要素の鍵が重複していれば差し替え先を選ばず exit 2", () => {
  const t = baseTable();
  t.operations.push({ id: "copy", trigger: "dup()" });
  const before = JSON.stringify(t, null, 2);
  const r = run(t, upsert("operations"), { fragment: { id: "copy", trigger: "z()" } });
  expect(r.status).toBe(2);
  expect(r.stderr).toContain("重複");
  expect(r.after).toBe(before);
});

test("既存の要素に鍵が無ければ exit 2（undefined の鍵に潰して別の行を上書きしない）", () => {
  const t = baseTable();
  t.operations.push(invalidInput<Operation>({ trigger: "no-id()" })); // わざと鍵の無い行を足す
  const r = run(t, upsert("operations"), { fragment: { id: "copy", trigger: "z()" } });
  expect(r.status).toBe(2);
  expect(r.stderr).toContain("operations[2] の鍵");
});

test.each([
  ["不正な JSON", "{"],
  ["配列の表", "[]"],
])("表が読めない（%s）なら exit 2", (_name, text) => {
  const r = run(text, upsert("operations"), { fragment: { id: "x" } });
  expect(r.status).toBe(2);
});

test.each([
  [[], "サブコマンド"],
  [["put"], "サブコマンド"],
  [["upsert", "--file", "t.json", "--array", "operations"], "--from が要る"],
  [["get", "--file", "t.json", "--array", "operations"], "--match が要る"],
  [["keys", "--file", "t.json"], "--file と --array"],
  [["keys", "--file", "t.json", "--array", "operations", "--bogus", "x"], "不明な引数"],
  [["keys", "--file", "--array", "operations"], "値が無い"],
  [["keys", "--file", "t.json", "--file", "t.json", "--array", "operations"], "--file が重複"],
  [
    ["keys", "--file", "t.json", "--array", "operations", "--array", "operations"],
    "--array が重複",
  ],
  [
    ["keys", "--file", "t.json", "--array", "operations", "--key", "id", "--key", "id"],
    "--key が重複",
  ],
])("使い方の誤りは exit 2: %j", (args, needle) => {
  const r = run(baseTable(), args);
  expect(r.status).toBe(2);
  expect(r.stderr).toContain(needle);
});

test('"]" を含む id は JSON 文字列の選択値で選べる（Codex レビュー）', () => {
  const tbl = baseTable();
  tbl.components.push({ id: "grid[mobile]", instances: [] });
  const r = run(tbl, upsert('components[id="grid[mobile]"].instances'), {
    fragment: { id: "list", page: "一覧" },
  });
  expect(r.stderr).toBe("");
  expect(r.status).toBe(0);
  const after = parseJsonAs<TableOut>(r.after);
  expect(after.components[2].instances).toEqual([{ id: "list", page: "一覧" }]);
  expect(after.components[0].instances.map((i: Keyed) => i.id)).toEqual(["list"]);
});

test('JSON 文字列の選択値のエスケープ（\\" を含む id）も読む', () => {
  const tbl = baseTable();
  tbl.components.push({ id: 'a"b', instances: [] });
  const r = run(tbl, upsert('components[id="a\\"b"].instances'), { fragment: { id: "x" } });
  expect(r.status).toBe(0);
  expect(parseJsonAs<TableOut>(r.after).components[2].instances).toEqual([{ id: "x" }]);
});

test.each([
  ["閉じていない JSON 文字列", 'components[id="grid].instances'],
  ['裸の値に "]" を含む', "components[id=grid[mobile]].instances"],
])("選択値が読めなければ exit 2: %s", (_name, array) => {
  const r = run(baseTable(), upsert(array), { fragment: { id: "x" } });
  expect(r.status).toBe(2);
});
