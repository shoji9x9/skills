// 文書の階層の設定（doc-tiers.json）の読み込みと、ファイルの階層の判定のテスト。
//
// 状態空間の軸（判定に使う全入力）と、各セルに置いた入力:
//
// | 軸           | 値                                                                     |
// | ------------ | ---------------------------------------------------------------------- |
// | glob         | `**`（0 段・複数段）/ `*`（`/` を越えない）/ ドットで始まる名前 / 文字の `.` |
// | 当たる項目   | 0 件 / 1 件 / 2 件（項目が重なる）/ 階層の外 / glob を持たない説明だけの項目 |
// | 設定の形     | 正しい / ファイルが無い / tiers が配列でない / Tier の順が違う / Tier の数が違う / Tier の番号が文字列 / docs が配列でない / glob が空・文字列でない / glob の重複 / outside に glob が無い |
import { expect, test } from "vitest";
import { TIERS_PATH, type DocTiers, loadDocTiers, tierOf } from "./doc-tiers.ts";
import { write } from "../../lib/testing/repo-file.ts";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";

/** doc-tiers.json に書く形。label・note・contents は読まれない説明の欄だが、実物と同じ形にするため置く。 */
const RAW = {
  tiers: [
    { tier: 1, contents: "原則", docs: [{ glob: "AGENTS.md" }] },
    { tier: 2, contents: "規約", docs: [{ glob: "docs/**" }, { glob: "skills/**" }] },
    { tier: 3, contents: "説明", docs: [{ glob: "evals/*/README.md" }, { label: "コメント" }] },
    { tier: 4, contents: "記録", docs: [{ glob: ".kaizen/**" }, { label: "Issue" }] },
  ],
  outside: [{ glob: "evals/*/fixtures/**", note: "eval の入力" }],
};

/** 設定だけを置いた一時リポジトリ。config が null なら設定を置かない。 */
function makeRepo(config: unknown) {
  const root = makeTempDir("doc-tiers-");
  if (config !== null) write(root, TIERS_PATH, JSON.stringify(config));
  return root;
}

/** RAW を読んだ設定。一時ディレクトリはテストごとに作る。 */
const config = (): DocTiers => loadDocTiers(makeRepo(RAW));

test.each([
  ["docs/a.md", 2],
  ["docs/x/y/a.md", 2],
  ["skills/a/references/b.md", 2],
  [".kaizen/notes/a.md", 4],
  ["evals/a/README.md", 3],
  ["evals/a/fixtures/.replace/b.md", null],
  ["AGENTSxmd", undefined],
  ["evals/a/b/README.md", undefined],
  ["docsx/a.md", undefined],
  ["README.md", undefined],
])("tierOf(%s) は %s", (rel, want) => {
  expect(tierOf(config(), rel)).toBe(want);
});

test("tierOf: 2 つの項目に当たるパスは undefined", () => {
  const overlap = config();
  overlap.tiers[2]?.globs.push("docs/a.md");
  expect(tierOf(overlap, "docs/a.md")).toBe(undefined);
});

test("loadDocTiers: glob を持つ項目だけを、その tier の glob として読む", () => {
  expect(config()).toEqual({
    tiers: [
      { tier: 1, globs: ["AGENTS.md"] },
      { tier: 2, globs: ["docs/**", "skills/**"] },
      { tier: 3, globs: ["evals/*/README.md"] },
      { tier: 4, globs: [".kaizen/**"] },
    ],
    outside: ["evals/*/fixtures/**"],
  });
});

const withTiers = (f: (t: typeof RAW.tiers) => unknown[]) => ({
  ...RAW,
  tiers: f(structuredClone(RAW.tiers)),
});

test.each([
  ["ファイルが無い", null, /doc-tiers\.json が無い/],
  ["tiers が配列でない", { ...RAW, tiers: {} }, /tiers と outside は配列/],
  ["Tier の順が違う", withTiers((t) => [t[1], t[0], t[2], t[3]]), /tier 1〜4/],
  ["Tier が 3 つしかない", withTiers((t) => t.slice(0, 3)), /tier 1〜4/],
  [
    "Tier の番号が文字列",
    withTiers((t) => t.map((x, i) => ({ ...x, tier: String(i + 1) }))),
    /tier 1〜4/,
  ],
  [
    "docs が配列でない",
    withTiers((t) => [{ ...t[0], docs: {} }, ...t.slice(1)]),
    /docs は配列にする/,
  ],
  [
    "glob が空",
    withTiers((t) => [{ ...t[0], docs: [{ glob: " " }] }, ...t.slice(1)]),
    /glob は空でない文字列/,
  ],
  [
    "glob が文字列でない",
    withTiers((t) => [{ ...t[0], docs: [{ glob: 1 }] }, ...t.slice(1)]),
    /glob は空でない文字列/,
  ],
  [
    "glob の重複",
    withTiers((t) => [{ ...t[0], docs: [{ glob: "docs/**" }] }, ...t.slice(1)]),
    /重複/,
  ],
  ["outside に glob が無い", { ...RAW, outside: [{ label: "x" }] }, /outside\[0\]: glob を持つ/],
])("loadDocTiers: 設定の形の誤り（%s）は例外にする", (_name, bad, reason) => {
  expect(() => loadDocTiers(makeRepo(bad))).toThrow(reason);
});
