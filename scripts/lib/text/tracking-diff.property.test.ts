// tracking-diff.ts の性質を、fast-check が作る入力で確かめる（Issue #1071）。例を使うテストは tracking-diff.test.ts にある。
//
// | 関数 | 性質 |
// | --- | --- |
// | markerLine・readKeys | 書いた識別子を読むと、同じ並びに戻る |
// | tableCell | 表の行のセルの数が変わらず、セルの文字（バックスラッシュを除く）が 1 行にした入力と同じ |
// | naturalOrder | 比較の関数として成り立つ（反対称・同じ文字列だけが 0・推移的） |
// | diffKeys | 新規と継続を合わせると今回、継続と解消を合わせると前回になり、3 つが重ならない |
//
// 入力の文字には、各関数が特別に扱う文字（改行の類・`|`・`\`・引用符・コメントの区切り）を混ぜる。
// 任意の文字だけでは、これらが出る確率が低く、100 件では当たらないからである。
import fc from "fast-check";
import { expect, test } from "vitest";
import { renderedTables } from "../testing/gfm-table-cases.ts";
import { diffKeys, markerLine, naturalOrder, readKeys, tableCell } from "./tracking-diff.ts";

const SPECIAL = ["\n", "\r", "\t", " ", "\u2028", "\u2029", "|", "\\", '"', "-->", "<!--"];
const anyChar = fc.string({ unit: "binary", minLength: 1, maxLength: 1 });
const text = fc
  .array(fc.oneof(fc.constantFrom(...SPECIAL), anyChar), { maxLength: 12 })
  .map((chars) => chars.join(""));

test("markerLine で書いた識別子を readKeys で読むと、同じ並びに戻る", () => {
  fc.assert(
    fc.property(fc.uniqueArray(text, { maxLength: 5 }), (keys) => {
      const body = `本文\n\n${markerLine("weekly-check", keys)}\n`;
      expect(readKeys(body, "weekly-check", /^[\s\S]*$/u)).toEqual(keys);
    }),
  );
});

// 記号のうち、Markdown の描画で意味を持つのは `|` と `\` だけにする。ほかの記号（`*` など）は描画で消えるので、文字を比べられない。
const cellText = fc
  .array(fc.constantFrom("a", "b", " ", "\n", "\t", "|", "\\"), { maxLength: 10 })
  .map((chars) => chars.join(""));
// 両辺から `\` を除いてから空白を畳む。除いた位置に空白が並ぶので、畳むのは除いた後にする。
const visibleChars = (s: string) => s.replaceAll("\\", "").replace(/\s+/gu, " ").trim();

test("tableCell を通したセルは、表の行のセルの数を変えず、セルの文字も変えない", () => {
  fc.assert(
    fc.property(cellText, cellText, (left, right) => {
      const table = `| h1 | h2 |\n| --- | --- |\n| ${tableCell(left)} | ${tableCell(right)} |\n`;
      const [rows = []] = renderedTables(table);
      expect(rows[1]?.map(visibleChars)).toEqual([visibleChars(left), visibleChars(right)]);
    }),
  );
});

const orderText = fc
  .array(
    fc.oneof(
      fc.integer({ min: 0, max: 200 }).map(String),
      fc.constantFrom("0", "00", "01", " ", "a", "A", "\u00e9", "e\u0301"),
      anyChar,
    ),
    { maxLength: 4 },
  )
  .map((pieces) => pieces.join(""));

test("naturalOrder は比較の関数として成り立つ", () => {
  fc.assert(
    fc.property(orderText, orderText, orderText, (a, b, c) => {
      expect(Math.sign(naturalOrder(a, b)) + Math.sign(naturalOrder(b, a))).toBe(0);
      expect(naturalOrder(a, b) === 0).toBe(a === b);
      if (naturalOrder(a, b) < 0 && naturalOrder(b, c) < 0) {
        expect(naturalOrder(a, c)).toBeLessThan(0);
      }
    }),
  );
});

test("diffKeys の新規・継続・解消は、今回と前回を重ならずに分ける", () => {
  const keys = fc.uniqueArray(fc.constantFrom("k a", "k b", "k c", "k d", "k e"));
  fc.assert(
    fc.property(keys, keys, (now, previous) => {
      const { added, kept, resolved } = diffKeys(now, previous);
      expect(new Set([...added, ...kept])).toEqual(new Set(now));
      expect(new Set([...kept, ...resolved])).toEqual(new Set(previous));
      expect(added.length + kept.length + resolved.length).toBe(
        new Set([...now, ...previous]).size,
      );
    }),
  );
});
