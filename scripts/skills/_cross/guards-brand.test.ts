// 配布スキルの lib/guards.mjs（parity-suite・parity-component）のうち、一部の値にだけ true を返す型ガードの、
// false の側の型のテスト。これらの型ガードは、絞る型をブランド型（`string & { readonly __<名前>: true }`）にしている。
// `v is string` と書くと、false の側から string が取り除かれ、実際には来る "" や NaN が型の上で消える。
// 型の期待は `expectTypeOf` で書き、`pnpm run typecheck`（tsc）が確かめる。vitest の実行では値の判定だけを確かめる。
// 2 つ以上のスキルの guards.mjs をまとめて扱うので、_cross に置く。
//
// 状態空間の軸と、各セルに置いた入力は次のとおりである。
//
// | 軸       | 値                                                                  |
// | -------- | ------------------------------------------------------------------- |
// | 入力の型 | string \| undefined、string、string \| number、number \| undefined、number |
// | 判定の側 | true の側 / false の側                                              |
// | 実装     | parity-suite の lib/guards.mjs / parity-component の lib/guards.mjs |
import { expect, test } from "vitest";
import {
  isFiniteNumber,
  nonEmptyString,
  positiveNumber,
} from "../../../skills/parity-suite/scripts/lib/guards.mjs";
import { filled, safeSegment } from "../../../skills/parity-component/scripts/lib/guards.mjs";
import { narrow } from "./guards-brand-helpers.ts";

test("値の判定: 空白だけの文字列・プレースホルダ・.. と、NaN・Infinity・0 に false を返す", () => {
  expect(nonEmptyString("  ")).toBe(false);
  expect(nonEmptyString("a")).toBe(true);
  expect(filled("a")).toBe(true);
  expect(safeSegment("..")).toBe(false);
  expect(isFiniteNumber(Number.NaN)).toBe(false);
  expect(isFiniteNumber(Number.POSITIVE_INFINITY)).toBe(false);
  expect(positiveNumber(0)).toBe(false);
});

test("true の側で、絞った型になる", () => {
  narrow({ s: "a", f: "a", seg: "a", n: 1, p: 1 });
});

test("false の側に、絞る型の値が残る", () => {
  narrow({ s: "", f: "TODO", seg: "..", n: Number.NaN, p: 0 });
});
