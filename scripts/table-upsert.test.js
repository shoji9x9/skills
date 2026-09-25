// parity-suite の表の 1 行更新ツール（table-upsert.mjs）の回帰テスト（Issue #468）。
//
// 被覆表を本文ごと書き直さず 1 行ずつ差し替えるための道具なので、壊れ方は「別の行を上書きする」と
// 「照合し直していない表を照合済みに見せる」の 2 つ。鍵の欠落・空・重複・型崩れで書き込まずに止まること、
// 書き換えたら conformance が消えることを固定する。
//
// 陽性コントロール（差し替え・追記・入れ子の配列・複合鍵・標準入力）を置く——これが無いと「常に止める」実装と区別できない。

import { test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repoRoot, "skills/parity-suite/scripts/table-upsert.mjs");

const baseTable = () => ({
  slug: "share",
  operations: [
    { id: "copy", trigger: "clickButton(コピー)" },
    { id: "search", trigger: "clickButton(検索)" },
  ],
  feedback_calls: {
    call_sites: [{ file: "src/share.js", line: 2, column: 3, pattern: "toast", reaction: null }],
  },
  components: [
    { id: "grid", instances: [{ id: "list", page: "一覧" }] },
    { id: "menu", instances: [] },
  ],
  conformance: { tool: "reaction-check", ok: true },
});

/**
 * 一時ディレクトリに表を置いて CLI を実行する。
 * @param {object | string} table - 文字列ならそのまま書く（壊れた JSON 用）
 * @param {string[]} args
 * @param {{ fragment?: object | string, input?: string }} [opts]
 */
function run(table, args, opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), "table-upsert-"));
  writeFileSync(
    join(dir, "t.json"),
    typeof table === "string" ? table : JSON.stringify(table, null, 2),
  );
  if (opts.fragment !== undefined) {
    writeFileSync(
      join(dir, "f.json"),
      typeof opts.fragment === "string" ? opts.fragment : JSON.stringify(opts.fragment),
    );
  }
  const r = spawnSync(process.execPath, [script, ...args], {
    cwd: dir,
    encoding: "utf8",
    input: opts.input,
    stdio: [opts.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
  const after = readFileSync(join(dir, "t.json"), "utf8");
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, after };
}

const upsert = (array, extra = []) => [
  "upsert",
  "--file",
  "t.json",
  "--array",
  array,
  "--from",
  "f.json",
  ...extra,
];

test("陽性コントロール: 鍵が一致する要素を差し替え、他の行と順序は動かさない", () => {
  const r = run(baseTable(), upsert("operations"), {
    fragment: { id: "copy", trigger: "clickButton(複製)" },
  });
  expect(r.stderr).toBe("");
  expect(r.status).toBe(0);
  expect(JSON.parse(r.stdout)).toMatchObject({ action: "replaced", count: 2 });
  const t = JSON.parse(r.after);
  expect(t.operations).toEqual([
    { id: "copy", trigger: "clickButton(複製)" },
    { id: "search", trigger: "clickButton(検索)" },
  ]);
});

test("陽性コントロール: 一致が無ければ末尾に足す", () => {
  const r = run(baseTable(), upsert("operations"), { fragment: { id: "reset", trigger: "x()" } });
  expect(r.status).toBe(0);
  expect(JSON.parse(r.stdout)).toMatchObject({ action: "appended", count: 3 });
  expect(JSON.parse(r.after).operations.map((o) => o.id)).toEqual(["copy", "search", "reset"]);
});

test("書き換えたら conformance を消す（照合し直していない表を照合済みに見せない）", () => {
  const r = run(baseTable(), upsert("operations"), { fragment: { id: "copy", trigger: "y()" } });
  expect(r.status).toBe(0);
  expect(JSON.parse(r.stdout).conformance_removed).toBe(true);
  expect(JSON.parse(r.after)).not.toHaveProperty("conformance");
});

test("conformance が無い表では conformance_removed: false", () => {
  const t = baseTable();
  delete t.conformance;
  const r = run(t, upsert("operations"), { fragment: { id: "copy", trigger: "y()" } });
  expect(r.status).toBe(0);
  expect(JSON.parse(r.stdout).conformance_removed).toBe(false);
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
  expect(JSON.parse(r.after).feedback_calls.call_sites).toEqual([
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
  expect(JSON.parse(r.after).feedback_calls.call_sites).toHaveLength(2);
});

test("入れ子の配列を name[field=value] で選んで足す", () => {
  const r = run(baseTable(), upsert("components[id=grid].instances"), {
    fragment: { id: "detail", page: "詳細" },
  });
  expect(r.status).toBe(0);
  const t = JSON.parse(r.after);
  expect(t.components[0].instances.map((i) => i.id)).toEqual(["list", "detail"]);
  expect(t.components[1].instances).toEqual([]);
});

test("末尾の配列のキーが無ければ upsert は空配列から作る", () => {
  const r = run(baseTable(), upsert("cells", ["--key", "component,item,instance"]), {
    fragment: { component: "grid", item: "sort", instance: "list", value: "present" },
  });
  expect(r.status).toBe(0);
  expect(JSON.parse(r.after).cells).toHaveLength(1);
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
  expect(JSON.parse(r.after).operations[0].trigger).toBe("z()");
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
  const t = JSON.parse(r.after);
  expect(t.operations.map((o) => o.id)).toEqual(["search"]);
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
  ["断片に鍵が無い", { trigger: "x()" }, "operations", [], "鍵（id）が欠けている"],
  ["断片の鍵が空文字", { id: " ", trigger: "x()" }, "operations", [], "鍵（id）が欠けている"],
  ["断片の鍵がオブジェクト", { id: { a: 1 } }, "operations", [], "鍵（id）が欠けている"],
  ["断片の鍵が小数", { id: 1.5 }, "operations", [], "鍵（id）が欠けている"],
  ["断片が配列", [{ id: "copy" }], "operations", [], "1 要素のオブジェクトでない"],
  ["断片が壊れた JSON", "{", "operations", [], "断片を読めない"],
  ["配列でないキーを指す", { id: "x" }, "slug", [], "配列でない"],
  ["途中のキーが無い", { id: "x" }, "nothing.call_sites", [], "オブジェクトでない"],
  ["選択が 0 件", { id: "x" }, "components[id=none].instances", [], "0 件"],
  ["末尾が要素の選択", { id: "x" }, "components[id=grid]", [], "末尾は配列のキー"],
  ["--array の形が崩れている", { id: "x" }, "operations..x", [], "形が読めない"],
  ["--key が空を含む", { id: "x" }, "operations", ["--key", "id,"], "--key が空・重複"],
  ["--key が重複", { id: "x" }, "operations", ["--key", "id,id"], "--key が空・重複"],
])("書き込まずに exit 2: %s", (_name, fragment, array, extra, needle) => {
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
  t.operations.push({ trigger: "no-id()" });
  const r = run(t, upsert("operations"), { fragment: { id: "copy", trigger: "z()" } });
  expect(r.status).toBe(2);
  expect(r.stderr).toContain("operations[2] の鍵");
});

test.each([
  ["壊れた JSON", "{"],
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
])("使い方の誤りは exit 2: %j", (args, needle) => {
  const r = run(baseTable(), args);
  expect(r.status).toBe(2);
  expect(r.stderr).toContain(needle);
});
