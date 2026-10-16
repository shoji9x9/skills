// parity-component の lib/baseline.mjs の loadBaseline のテスト。
//
// behavior-compare.mjs と motion-compare.mjs は、loadBaseline が null にしたインスタンスを未採取として数える。
// 採取物が無い・JSON として読めないインスタンスを null にせず例外で止めたり、空の値で埋めたりすると、
// 判定側は未採取を区別できない。読み方の分岐ごとに状態を作って確かめる。

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { loadBaseline } from "../../../skills/parity-component/scripts/lib/baseline.mjs";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";

/** metadata.json と、baseline/<id>/<name> の採取物を書いた成果物ディレクトリを作る。値が文字列ならそのまま書く。 */
function artifactDir(metadata: unknown, files: Record<string, unknown> = {}) {
  const dir = makeTempDir("baseline-lib-");
  writeFileSync(join(dir, "metadata.json"), JSON.stringify(metadata));
  for (const [id, content] of Object.entries(files)) {
    mkdirSync(join(dir, "baseline", id), { recursive: true });
    const text = typeof content === "string" ? content : JSON.stringify(content);
    writeFileSync(join(dir, "baseline", id, "behaviors.json"), text);
  }
  return dir;
}

test("採取物を読めたインスタンスは中身を、無い・JSON として読めないインスタンスは null を返す", () => {
  const dir = artifactDir(
    { slug: "data-grid", instances: [{ id: "orders" }, { id: "stock" }, { id: "users" }] },
    { orders: { instance: "orders", results: [] }, users: "{ not json" },
  );
  const { metadata, byInstance } = loadBaseline(dir, "behaviors.json");
  expect(metadata).toMatchObject({ slug: "data-grid" });
  expect(byInstance).toEqual({
    orders: { instance: "orders", results: [] },
    stock: null,
    users: null,
  });
});

test.each([
  ["instances が無い", { slug: "data-grid" }],
  ["instances が配列でない", { slug: "data-grid", instances: { id: "orders" } }],
])("%s metadata.json は、採取物を 1 件も読まずに metadata だけを返す", (_label, metadata) => {
  // 型の誤りは判定側（behavior-compare など）が metadata を検査して報告する。ここでは読める範囲だけを返す。
  const dir = artifactDir(metadata, { orders: { instance: "orders", results: [] } });
  const { metadata: read, byInstance } = loadBaseline(dir, "behaviors.json");
  expect(read).toEqual(metadata);
  expect(byInstance).toEqual({});
});

test("パスの 1 セグメントとして不正な id は、採取物を読まずに例外で止める", () => {
  const dir = artifactDir({ instances: [{ id: "../outside" }] });
  expect(() => loadBaseline(dir, "behaviors.json")).toThrow(/instances\[\]\.id/);
});

test("metadata.json が JSON として読めなければ例外で止める（未採取として扱わない）", () => {
  const dir = makeTempDir("baseline-lib-");
  writeFileSync(join(dir, "metadata.json"), "{ not json");
  expect(() => loadBaseline(dir, "behaviors.json")).toThrow(SyntaxError);
});
