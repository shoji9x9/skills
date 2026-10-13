// replace-strategy の lib/markdown.mjs の parseTables の回帰テスト（Issue #598）。
//
// 3 つのスクリプトの表のパーサを 1 つにまとめたとき、表の行の途中のフェンス行の扱いが呼び出し元で違っていた。
// asset-delivery-check はフェンス行で表を終え、evidence-gap-check と procedure-staleness-check は
// `|` を含まない行でだけ終える。まとめた後もそれぞれの読み方を保つことを、`|` を含むフェンス行で確かめる。

import { expect, test } from "vitest";
import { parseTables } from "../../../skills/replace-strategy/scripts/lib/markdown.mjs";

const TEXT = ["| a | b |", "|---|---|", "| 1 | 2 |", "```| x", "| 3 | 4 |", ""].join("\n");

test("fenceEndsTable が偽（デフォルト）なら、`|` を含むフェンス行も表の行として読む", () => {
  const { tables } = parseTables(TEXT);
  expect(tables).toHaveLength(1);
  expect(tables[0].rows).toEqual([
    [" 1 ", " 2 "],
    ["```", " x"],
    [" 3 ", " 4 "],
  ]);
});

test("fenceEndsTable が真なら、表の行の途中のフェンス行で表を終える", () => {
  const { tables } = parseTables(TEXT, { fenceEndsTable: true });
  expect(tables).toHaveLength(1);
  expect(tables[0].rows).toEqual([[" 1 ", " 2 "]]);
});
