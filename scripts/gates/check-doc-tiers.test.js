// 文書の階層（Tier）の表と、Markdown の分類のチェックの回帰テスト。
//
// 状態空間の軸（判定に使う全入力）と、各セルに置いた入力:
//
// | 軸               | 値                                                                     |
// | ---------------- | ---------------------------------------------------------------------- |
// | 表               | 生成した内容と一致 / 食い違う（--fix の有無）/ 印が無い / 印の順が逆     |
// | Markdown の当たり | 0 件 / 1 件 / 2 件（項目が重なる）                                     |
// | 場所             | ドットで始まるディレクトリの中 / スキルのコピー / エージェント用のリンク |
// | glob             | 当たる Markdown がある / 無い（ファイルを移した後に残った項目）          |
// | 原本の形         | 正しい / Tier の順が違う / glob も label も無い / 「|」を含む / glob の重複 / outside に glob が無い / ファイルが無い |
// | 件数             | Markdown 0 件 / 1 件以上                                               |
import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BEGIN,
  END,
  TABLE_PATH,
  TIERS_PATH,
  checkDocTiers,
  globToRegExp,
  main,
  renderTable,
  tierOf,
} from "./check-doc-tiers.js";
import { makeTempDir } from "../lib/test-tmpdir.js";

// 学びのパスは組み立てて書く（そのまま書くと check-kaizen-refs.js が実在しない学びへの参照として数える）。
const KZ = ".kaizen/";
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const script = join(repoRoot, "scripts/gates/check-doc-tiers.js");

const CONFIG = {
  tiers: [
    { tier: 1, contents: "原則", docs: [{ glob: "AGENTS.md" }] },
    {
      tier: 2,
      contents: "規約",
      docs: [{ glob: ".agents/rules/**" }, { glob: "docs/**" }, { glob: "skills/**" }],
    },
    { tier: 3, contents: "説明", docs: [{ glob: "evals/*/README.md" }, { label: "コメント" }] },
    { tier: 4, contents: "記録", docs: [{ glob: ".kaizen/**" }, { label: "Issue" }] },
  ],
  outside: [{ glob: "evals/*/fixtures/**", note: "eval の入力" }],
};

function write(root, path, text) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

/** 原本と表を持つ一時リポジトリ。table を省くと生成した表を置く。 */
function makeRepo(files = {}, { config = CONFIG, table } = {}) {
  const root = makeTempDir("doc-tiers-");
  write(root, TIERS_PATH, JSON.stringify(config));
  write(root, TABLE_PATH, table ?? `# 階層\n\n${renderTable(config)}\n\n本文\n`);
  const all = {
    "AGENTS.md": "x\n",
    "docs/a.md": "x\n",
    "skills/s/SKILL.md": "x\n",
    "evals/s/README.md": "x\n",
    "evals/s/fixtures/a.md": "x\n",
    [`${KZ}2026-09-01-a.md`]: "x\n",
    ...files,
  };
  for (const [p, t] of Object.entries(all)) if (t !== null) write(root, p, t);
  const r = spawnSync("git", ["init", "-q"], { cwd: root, encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return root;
}

// ---- glob ----

test.each([
  ["evals/*/fixtures/**", "evals/a/fixtures/.replace/b.md", true],
  [".kaizen/**", ".kaizen/notes/a.md", true],
  ["skills/**", "skills/a/references/b.md", true],
  ["AGENTS.md", "AGENTSxmd", false],
  ["evals/*/README.md", "evals/a/b/README.md", false],
  ["docs/**", "docsx/a.md", false],
])("globToRegExp: %s と %s → %s", (glob, path, want) => {
  expect(globToRegExp(glob).test(path)).toBe(want);
});

test("tierOf: 1 件ならその tier、階層の外は null、0 件と 2 件以上は undefined", () => {
  expect(tierOf(CONFIG, "docs/a.md")).toBe(2);
  expect(tierOf(CONFIG, "evals/s/fixtures/a.md")).toBe(null);
  expect(tierOf(CONFIG, "README.md")).toBe(undefined);
  const overlap = structuredClone(CONFIG);
  overlap.tiers[2].docs.push({ glob: "docs/a.md" });
  expect(tierOf(overlap, "docs/a.md")).toBe(undefined);
});

// ---- 陰性コントロール ----

test("陰性: 表が一致し、Markdown がちょうど 1 つの項目に当たれば違反 0 件", () => {
  const r = checkDocTiers(makeRepo());
  expect(r.tableOk).toBe(true);
  expect(r.violations).toEqual([]);
  expect(r.files).toContain("evals/s/fixtures/a.md");
});

test("陰性: スキルのコピーとエージェント用のリンクは数えない", () => {
  const root = makeRepo({ ".agents/skills/s/SKILL.md": "x\n", ".claude/rules/x.md": "x\n" });
  mkdirSync(join(root, ".github"), { recursive: true });
  symlinkSync("../docs", join(root, ".github/instructions"));
  expect(checkDocTiers(root).violations).toEqual([]);
});

test("陰性: 実リポジトリは表が原本と一致し、違反 0 件", () => {
  const r = checkDocTiers(repoRoot);
  expect(r.tableOk).toBe(true);
  expect(r.violations).toEqual([]);
  expect(r.files.length).toBeGreaterThan(100);
});

// ---- 陽性コントロール ----

test("陽性: どの階層にも属さない Markdown を落とす", () => {
  expect(checkDocTiers(makeRepo({ "README.md": "x\n" })).violations).toEqual([
    "README.md: どの階層にも属さない",
  ]);
});

test("陽性: ドットで始まるディレクトリの中の Markdown も分類する（属さなければ落とす）", () => {
  expect(checkDocTiers(makeRepo({ ".replace/a.md": "x\n" })).violations).toEqual([
    ".replace/a.md: どの階層にも属さない",
  ]);
});

test("陽性: 複数の項目に当たる Markdown を落とす", () => {
  const config = structuredClone(CONFIG);
  config.tiers[0].docs.push({ glob: "docs/a.md" });
  const root = makeRepo({}, { config });
  expect(checkDocTiers(root).violations).toEqual([
    "docs/a.md: 複数の項目に当たる（docs/a.md、docs/**）",
  ]);
});

test("陽性: 当たる Markdown が無い glob を落とす", () => {
  const root = makeRepo({ "evals/s/fixtures/a.md": null });
  expect(checkDocTiers(root).violations).toEqual([
    `${TIERS_PATH}: glob「evals/*/fixtures/**」に当たる Markdown が無い`,
  ]);
});

test("陽性: 表が原本と食い違えば失敗し、--fix で生成し直すと一致する", () => {
  const root = makeRepo({}, { table: `# 階層\n\n${BEGIN}\n手で書いた表\n${END}\n\n本文\n` });
  expect(checkDocTiers(root).tableOk).toBe(false);
  expect(main([root])).toBe(1);
  expect(main([root, "--fix"])).toBe(0);
  const text = readFileSync(join(root, TABLE_PATH), "utf8");
  expect(text).toBe(`# 階層\n\n${renderTable(CONFIG)}\n\n本文\n`);
  expect(text).toContain("| 2 | `.agents/rules/**`、`docs/**`、`skills/**` | 規約 |");
  expect(text).toContain("階層の外に置く文書: `evals/*/fixtures/**`（eval の入力）。");
});

test.each([
  ["印が無い", { table: "# 階層\n" }],
  ["印の順が逆", { table: `${END}\n${BEGIN}\n` }],
  ["Tier の順が違う", { config: { ...CONFIG, tiers: [...CONFIG.tiers].reverse() } }],
  [
    "Tier の項目に glob も label も無い",
    {
      config: {
        ...CONFIG,
        tiers: CONFIG.tiers.map((t) =>
          t.tier === 4 ? { ...t, docs: [...t.docs, { note: "x" }] } : t,
        ),
      },
    },
  ],
  [
    "「|」を含む",
    { config: { ...CONFIG, outside: [{ glob: "evals/*/fixtures/**", note: "a|b" }] } },
  ],
  ["glob の重複", { config: { ...CONFIG, outside: [...CONFIG.outside, { glob: "docs/**" }] } }],
  ["outside に glob が無い", { config: { ...CONFIG, outside: [{ label: "x" }] } }],
])("原本の形の誤り（%s）はチェックできない（exit 2、理由を出す）", (name, opts) => {
  const root = makeRepo({}, opts);
  expect(main([root])).toBe(2);
  const reasons = {
    印が無い: /印/,
    印の順が逆: /印/,
    "Tier の順が違う": /tier 1〜4/,
    "Tier の項目に glob も label も無い": /glob か label/,
    "「|」を含む": /「\|」/,
    "glob の重複": /重複/,
    "outside に glob が無い": /outside\[0\]: glob を持つ/,
  };
  expect(() => checkDocTiers(root)).toThrow(reasons[name]);
});

test("原本が無いとチェックできない（exit 2）", () => {
  const root = makeRepo();
  writeFileSync(join(root, TIERS_PATH), "");
  expect(main([root])).toBe(2);
});

test("Markdown が 0 件なら成功として扱わない（exit 2）", () => {
  const root = makeTempDir("doc-tiers-empty-");
  write(root, TIERS_PATH, JSON.stringify(CONFIG));
  write(root, TABLE_PATH, `${renderTable(CONFIG)}\n`);
  // 表も含めて Markdown を ignore し、列挙が 0 件になる状態を作る。
  write(root, ".gitignore", "*.md\n");
  spawnSync("git", ["init", "-q"], { cwd: root });
  expect(() => checkDocTiers(root)).toThrow(/Markdown が 0 件/);
  expect(main([root])).toBe(2);
});

test("陽性コントロール（CLI）: 子プロセスとして起動しても、違反は exit 1、無ければ exit 0", () => {
  const good = spawnSync(process.execPath, [script, makeRepo()], { encoding: "utf8" });
  expect(good.status, good.stderr).toBe(0);
  expect(good.stdout).toMatch(/doc-tiers: OK（7 件の Markdown）/);
  const bad = spawnSync(process.execPath, [script, makeRepo({ "README.md": "x\n" })], {
    encoding: "utf8",
  });
  expect(bad.status).toBe(1);
  expect(bad.stderr).toMatch(/README\.md: どの階層にも属さない/);
});
