// json-normalize-diff.mjs がオブジェクトを組み直す処理（ソートキーの canonicalize・removePath・sortArrayAtPath）の回帰テスト（Issue #598）。
//
// JSON.parse は `__proto__` というキーを自分の欄として作る。ソートキーを `out[key] = ...` で組むと、
// そのキーはプロトタイプの設定として扱われて消え、`__proto__` の値だけが違う要素が同じキーになる。
// すると並び順が揃わず、同じ集合の配列に偽の差分が出る。
// 入力は JSON.parse で作る（オブジェクトリテラルの `__proto__` はプロトタイプの設定になり、欄にならない）。

import { expect, test } from "vitest";
import {
  deepDiff,
  removePath,
  sortArrayAtPath,
} from "../../../skills/parity-diff/scripts/json-normalize-diff.mjs";
import { canonicalize } from "../../../skills/parity-diff/scripts/lib/json.mjs";

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
// そこで `__proto__` のキーが消えると、そのキーの差分を deepDiff が見ないまま exit 0 になる。
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
  const out: Array<{ path: string; current: unknown; new: unknown }> = [];
  const current: unknown = removePath(JSON.parse('{"__proto__":1,"t":5}'), ["t"]);
  const next: unknown = removePath(JSON.parse('{"__proto__":2,"t":6}'), ["t"]);
  deepDiff(current, next, "", out);
  expect(out).toEqual([{ path: "__proto__", current: 1, new: 2 }]);
});
