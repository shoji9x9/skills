// 文書の階層の設定（doc-tiers.json）の読み込みと、ファイルの階層の判定のテスト。
//
// 状態空間の軸（判定に使う全入力）と、各セルに置いた入力:
//
// | 軸           | 値                                                                     |
// | ------------ | ---------------------------------------------------------------------- |
// | glob         | `**`（0 段・複数段）/ `*`（`/` を越えない）/ ドットで始まる名前 / 文字の `.` |
// | 当たる項目   | 0 件 / 1 件 / 2 件（項目が重なる）/ 階層の外                            |
// | 設定の形     | 正しい / ファイルが無い / Tier の順が違う / Tier の数が違う / Tier の番号が文字列 / glob も label も無い / 「|」を含む / glob の重複 / outside に glob が無い / docs が空 |
import { expect, test } from "vitest";
import { type DocTiers, loadDocTiers, tierOf } from "./doc-tiers.ts";
import { write } from "../../lib/testing/repo-file.ts";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";

const TIERS_PATH = "scripts/gates/docs/doc-tiers.json";

const CONFIG: DocTiers = {
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
  expect(tierOf(CONFIG, rel)).toBe(want);
});

test("tierOf: 2 つの項目に当たるパスは undefined", () => {
  const overlap = structuredClone(CONFIG);
  overlap.tiers[2]?.docs.push({ glob: "docs/a.md" });
  expect(tierOf(overlap, "docs/a.md")).toBe(undefined);
});

test("loadDocTiers: 正しい設定を読む", () => {
  expect(tierOf(loadDocTiers(makeRepo(CONFIG)), "docs/a.md")).toBe(2);
});

const withTiers = (f: (t: DocTiers["tiers"]) => unknown[]) => ({
  ...CONFIG,
  tiers: f(structuredClone(CONFIG.tiers)),
});

test.each([
  ["ファイルが無い", null, /doc-tiers\.json が無い/],
  ["tiers が配列でない", { ...CONFIG, tiers: {} }, /tiers と outside は配列/],
  ["Tier の順が違う", withTiers((t) => [t[1], t[0], t[2], t[3]]), /tier 1〜4/],
  ["Tier が 3 つしかない", withTiers((t) => t.slice(0, 3)), /tier 1〜4/],
  [
    "Tier の番号が文字列",
    withTiers((t) => t.map((x, i) => ({ ...x, tier: String(i + 1) }))),
    /tier 1〜4/,
  ],
  [
    "Tier の項目に glob も label も無い",
    withTiers((t) => [{ ...t[0], docs: [{ note: "x" }] }, ...t.slice(1)]),
    /glob か label/,
  ],
  [
    "「|」を含む",
    withTiers((t) => [{ ...t[0], docs: [{ glob: "a|b" }] }, ...t.slice(1)]),
    /「\|」/,
  ],
  [
    "glob の重複",
    withTiers((t) => [{ ...t[0], docs: [{ glob: "docs/**" }] }, ...t.slice(1)]),
    /重複/,
  ],
  ["docs が空", withTiers((t) => [{ ...t[0], docs: [] }, ...t.slice(1)]), /docs は空でない配列/],
  ["outside に glob が無い", { ...CONFIG, outside: [{ label: "x" }] }, /outside\[0\]: glob を持つ/],
  [
    "contents に「|」を含む",
    withTiers((t) => [{ ...t[0], contents: "a|b" }, ...t.slice(1)]),
    /contents は「\|」を含まない/,
  ],
  [
    "note が文字列でない",
    withTiers((t) => [{ ...t[0], docs: [{ glob: "AGENTS.md", note: 1 }] }, ...t.slice(1)]),
    /note は空でない文字列/,
  ],
])("loadDocTiers: 設定の形の誤り（%s）は例外にする", (_name, config, reason) => {
  expect(() => loadDocTiers(makeRepo(config))).toThrow(reason);
});
