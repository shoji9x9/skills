import { expect, test } from "vitest";
import { loadYaml, loadYamlAs, loadYamlDocuments } from "./yaml-as.ts";

// js-yaml 4 のデフォルトと同じ読み方を保つことを確かめる（js-yaml 5 で変わった点を 1 件ずつ置く）。

test.each([
  ["空文字", ""],
  ["空行だけ", "\n\n"],
  ["コメントだけ", "# comment\n"],
])("空の入力（%s）は例外にせず undefined を返す", (_label, text) => {
  expect(loadYaml(text)).toBeUndefined();
  expect(loadYamlDocuments(text)).toEqual([]);
});

test("複数の文書は loadYaml では例外にし、loadYamlDocuments では全部を返す", () => {
  const text = "a: 1\n---\nb: 2\n";
  expect(() => loadYaml(text)).toThrow(/single document/);
  expect(loadYamlDocuments(text)).toEqual([{ a: 1 }, { b: 2 }]);
});

test("merge key を展開する", () => {
  expect(loadYaml("x: &x {a: 1}\nb:\n  <<: *x\n  c: 2\n")).toEqual({
    x: { a: 1 },
    b: { a: 1, c: 2 },
  });
});

test("merge key の値がマッピングでなければ例外にする", () => {
  // 文言は js-yaml の版で変わるので、例外になることだけを確かめる（merge key を持たないスキーマでは例外にならない）。
  expect(() => loadYaml("b:\n  <<: 1\n")).toThrow();
});

test.each([
  ["binary", "a: !!binary aGVsbG8=\n"],
  ["set", "a: !!set {x}\n"],
  ["omap", "a: !!omap [x: 1]\n"],
  ["pairs", "a: !!pairs [x: 1]\n"],
  ["timestamp", "a: !!timestamp 2026-10-15\n"],
])("YAML 1.1 のタグ（%s）を読める", (_label, text) => {
  expect(() => loadYaml(text)).not.toThrow();
});

test("タグの無い日付は js-yaml 4 と同じく Date として読む", () => {
  expect(loadYamlAs<{ a: unknown }>("a: 2026-10-15\n").a).toEqual(new Date("2026-10-15T00:00:00Z"));
});

test("複合キー（`? [1, 2]`）は js-yaml 4 と同じく文字列のキーとして読む", () => {
  expect(loadYaml("? [1, 2]\n: x\n")).toEqual({ "1,2": "x" });
});

test("`!!set` は js-yaml 4 と違い Set として読む（yaml-as.ts の冒頭に書いた差）", () => {
  const value = loadYamlAs<{ a: unknown }>("a: !!set {x}\n");
  expect(value.a).toEqual(new Set(["x"]));
});

test("`on`・`yes` は真偽値ではなく文字列のキーとして読む（GitHub Actions の `on:`）", () => {
  expect(loadYamlAs<Record<string, unknown>>("on: push\nyes: 1\n")).toEqual({ on: "push", yes: 1 });
});

// yaml-as.ts の冒頭に書いた「4 と違う形」を固定する。js-yaml の版で変わったら、冒頭のコメントと lint-yaml の説明も直す。
test("`0b11` は js-yaml 4 と違い文字列として読む", () => {
  expect(loadYamlAs<{ a: unknown }>("a: 0b11\n").a).toBe("0b11");
});

test("キーの無い暗黙のマッピング（`: value`）は js-yaml 4 と違い例外にせず `null` のキーとして読む", () => {
  expect(loadYaml(": x\n")).toEqual({ null: "x" });
});

test("フロー形式の続きの行の字下げが足りない形は js-yaml 4 と違い例外にする", () => {
  expect(() => loadYaml("a: [1,\n2]\n")).toThrow();
});

test("暦に無い日付は js-yaml 4 と違い Date にせず文字列として読む", () => {
  expect(loadYamlAs<{ a: unknown }>("a: 2026-02-30\n").a).toBe("2026-02-30");
});

test("暦に無い日付に !!timestamp を付けると js-yaml 4 と違い例外にする", () => {
  expect(() => loadYaml("a: !!timestamp 2026-02-30\n")).toThrow();
});
