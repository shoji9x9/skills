// 文書の参照のチェックの回帰テスト。
//
// 状態空間の軸（判定に使う全入力）と、各セルに置いた入力:
//
// | 軸                 | 値                                                                              |
// | ------------------ | ------------------------------------------------------------------------------- |
// | リンク先           | 在る / 無い / URL・#・mailto / アンカー付き / ルートからの絶対パス / % で符号化 |
// | リンクの位置       | 本文 / インラインコード / コードフェンス / Markdown 以外                          |
// | 節名の参照の形     | バッククォート / リンク / スキル名付き                                           |
// | 参照先の探し方     | 書いたファイルのディレクトリ / ルート / スキル / スキルの references/ / 無い      |
// | 生成ファイル       | 宣言あり（スキルが一致・不一致）/ スキル名付きの参照の宣言                       |
// | 節名の一致         | 見出し / 末尾の括弧書き / 番号付き / 太字（末尾の句点）/ 表のセル / 『』/ 入れ子の「」/ バッククォート / 無い |
// | 参照元の階層       | Tier 1 / Tier 2（docs・private skill）/ Tier 3（eval の文書・コメント）/ 配布スキル |
// | Tier 4 への参照    | 学び（日付付き・archive・INDEX.md）/ eval の結果 / #番号 / Issue の URL /       |
// |                    | 他のリポジトリ（owner/repo#1・他の URL）/ ${#1} / &#123; / インラインコード / 例の行 |
// | スキルの外のパス   | ルートにだけ在る / スキルにも在る / どこにも無い                                 |
// | 保留               | 一致 / 古い / 許可 / 他のチェックの規則                                          |
// | 設定               | 正しい / 無い / repo の形の誤り / テンプレートが無い                             |
import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_PATH, RULES, anchorsOf, checkDocRefs, hasAnchor, main } from "./check-doc-refs.js";
import { KNOWN_RULES, PENDING_PATH } from "../lib/doc-scan.js";
import { makeTempDir } from "../lib/test-tmpdir.js";

// 学びのパスは組み立てて書く（そのまま書くと check-kaizen-refs.js が実在しない学びへの参照として数える）。
const KZ = ".kaizen/";
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const script = join(repoRoot, "scripts/gates/check-doc-refs.js");

const TIERS = readFileSync(join(repoRoot, "scripts/gates/doc-tiers.json"), "utf8");
const CONFIG = {
  repo: "o/r",
  generated: [
    { ref: "gaps.md", skills: ["s"], template: "skills/s/assets/gaps-template.md" },
    { ref: "other.md", skills: ["t"], template: "skills/s/assets/gaps-template.md" },
  ],
};

function write(root, path, text) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

/** 階層の原本・設定・参照先を持つ一時リポジトリ。 */
function makeRepo(files = {}, { config = CONFIG, pending } = {}) {
  const root = makeTempDir("doc-refs-");
  const all = {
    "scripts/gates/doc-tiers.json": TIERS,
    [CONFIG_PATH]: JSON.stringify(config),
    "AGENTS.md": "# Agents\n",
    "docs/guide.md":
      "# ガイド\n\n## 手順（補足）\n\n## 7. 定期実行\n\n- **規則は「要素」に付ける。** 本文\n\n| 列 | 値 |\n| --- | --- |\n| データ不足 | x |\n",
    "skills/s/SKILL.md": "# S\n",
    "skills/s/references/ref.md": "# Ref\n\n## 参照の節\n",
    "skills/s/assets/gaps-template.md": "# Gaps\n\n## 特性化できなかった箇所\n",
    ...files,
  };
  for (const [p, t] of Object.entries(all)) write(root, p, t);
  if (pending) write(root, PENDING_PATH, JSON.stringify(pending));
  const r = spawnSync("git", ["init", "-q"], { cwd: root, encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return root;
}

/** 見つけた違反（ファイル・行番号・規則・文字列）。 */
const found = (root) =>
  checkDocRefs(root).found.map((v) => `${v.file}:${v.line} ${v.rule} ${v.text}`);

// ---- 節名の一致 ----

test("anchorsOf: 見出し・番号を除いた見出し・太字・表のセルを集め、フェンスの中は集めない", () => {
  const names = anchorsOf(
    "## 7. 定期実行\n- **a は「b」に付ける。** c\n| 列 | `値` |\n```\n## フェンス\n```\n",
  );
  expect([...names].sort()).toEqual(
    ["7. 定期実行", "a は「b」に付ける", "値", "列", "定期実行"].sort(),
  );
});

test.each([
  ["完全一致", ["手順"], "手順", true],
  ["末尾の括弧書き", ["手順（補足）"], "手順", true],
  ["半角の括弧書き", ["手順 (補足)"], "手順", true],
  ["バッククォートの有無（集めた名前は正規化済み）", ["x の形"], "`x` の形", true],
  ["『』と「」", ["a は「b」"], "a は『b』", true],
  ["前方一致だが括弧でない", ["手順書"], "手順", false],
  ["一部だけ", ["記述先（適用先）の選び方"], "記述先の選び方", false],
])("hasAnchor: %s", (_, names, name, want) => {
  expect(hasAnchor(new Set(names), name)).toBe(want);
});

// ---- リンク ----

test("陰性: 在るリンク先・URL・アンカー・絶対パス・符号化・コードの中は通す", () => {
  const root = makeRepo({
    "docs/a.md": [
      "[g](guide.md) [g](./guide.md#x) [u](https://example.com/x.md) [m](mailto:a@b) [h](#top)",
      "[r](/AGENTS.md) [e](gui%64e.md)",
      "`[x](missing.md)`",
      "```",
      "[x](missing.md)",
      "```",
    ].join("\n"),
    "scripts/a.js": "// [x](missing.md)\n",
  });
  expect(found(root)).toEqual([]);
});

test("陽性: 無いリンク先を落とす", () => {
  const root = makeRepo({ "docs/a.md": "[x](missing.md#y)\n" });
  expect(found(root)).toEqual(["docs/a.md:1 link missing.md#y"]);
});

// ---- 節名 ----

test.each([
  ["ディレクトリからの相対（バッククォート）", "docs/a.md", "`guide.md`「手順」"],
  ["ルートから", "evals/s/README.md", "`docs/guide.md`「定期実行」"],
  ["リンク", "docs/a.md", "[g](guide.md)「規則は『要素』に付ける」"],
  ["スキルのディレクトリから", "skills/s/SKILL.md", "`references/ref.md`「参照の節」"],
  ["スキルの references/ から", "skills/s/SKILL.md", "`ref.md`「参照の節」"],
  ["スキル名付き", "docs/a.md", "`s` の `references/ref.md`「参照の節」"],
  ["表のセル", "docs/a.md", "`guide.md`「データ不足」"],
  ["生成ファイル（宣言したスキル）", "skills/s/SKILL.md", "`gaps.md`「特性化できなかった箇所」"],
  ["生成ファイル（スキル名付き）", "docs/a.md", "`s` の `gaps.md`「特性化できなかった箇所」"],
  ["入れ子の「」", "docs/a.md", "`guide.md`「規則は「要素」に付ける」"],
  ["JS のコメント", "scripts/a.js", "// `docs/guide.md`「手順」"],
])("陰性: 節名が在る（%s）", (_, file, line) => {
  expect(found(makeRepo({ [file]: `${line}\n` }))).toEqual([]);
});

test.each([
  ["見出しに無い", "docs/a.md", "`guide.md`「無い節」", "guide.md「無い節」"],
  ["一部だけ一致", "docs/a.md", "`guide.md`「手順の補足」", "guide.md「手順の補足」"],
  ["参照先が無い", "docs/a.md", "`nothing.md`「節」", "nothing.md「節」"],
  [
    "生成ファイルの宣言がスキルに当たらない",
    "skills/s/SKILL.md",
    "`other.md`「特性化できなかった箇所」",
    "other.md「特性化できなかった箇所」",
  ],
  [
    "生成ファイルのテンプレートに節が無い",
    "skills/s/SKILL.md",
    "`gaps.md`「無い節」",
    "gaps.md「無い節」",
  ],
  [
    "スキル名付きで節が無い",
    "docs/a.md",
    "`s` の `references/ref.md`「無い」",
    "s/references/ref.md「無い」",
  ],
  ["フェンスの外のコメント", "scripts/a.js", "// `docs/guide.md`「無い」", "docs/guide.md「無い」"],
  [
    "ルートからのリンク",
    "docs/sub/a.md",
    "[g](/docs/guide.md)「無い節」",
    "/docs/guide.md「無い節」",
  ],
  ["符号化したリンク", "docs/a.md", "[g](gui%64e.md)「無い節」", "gui%64e.md「無い節」"],
])("陽性: %s", (_, file, line, text) => {
  expect(found(makeRepo({ [file]: `${line}\n` }))).toEqual([`${file}:1 section ${text}`]);
});

test("陽性: 閉じたフェンスの後の行は読む", () => {
  const root = makeRepo({ "docs/a.md": "```\n[x](a.md)\n```\n[x](none.md)\n" });
  expect(found(root)).toEqual(["docs/a.md:4 link none.md"]);
});

test("陰性: リンク切れの節名は link だけで報告する（二重に数えない）。フェンスの中は読まない", () => {
  const root = makeRepo({ "docs/a.md": "[x](none.md)「節」\n```\n`guide.md`「無い」\n```\n" });
  expect(found(root)).toEqual(["docs/a.md:1 link none.md"]);
});

// ---- Tier 4 への参照（Tier 1・2）----

test.each([
  ["学び（日付付き）", `${KZ}2026-09-01-a.md を見る`, `${KZ}2026-09-01-a.md`],
  ["学び（archive）", `${KZ}archive/old-note.md を見る`, `${KZ}archive/old-note.md`],
  ["eval の結果", "tests/s/iteration-3/benchmark.json を見る", "tests/s/iteration-3"],
  ["Issue 番号", "#463 のレビューで", "#463"],
  ["Issue の URL", "https://github.com/o/r/issues/12 を見る", "github.com/o/r/issues/12"],
])("陽性: Tier 2 の文書から %s を参照すると落とす", (_, line, text) => {
  expect(found(makeRepo({ "docs/a.md": `${line}\n` }))).toEqual([`docs/a.md:1 tier-down ${text}`]);
});

test("陽性: Tier 1 と private skill（Tier 2）も対象にする", () => {
  const root = makeRepo({ "AGENTS.md": "#12\n", ".agents/skills/p/SKILL.md": "#13\n" });
  expect(found(root).sort()).toEqual([
    ".agents/skills/p/SKILL.md:1 tier-down #13",
    "AGENTS.md:1 tier-down #12",
  ]);
});

test.each([
  ["他のリポジトリの番号", "dependabot/dependabot-core#15904 を追う"],
  ["他のリポジトリの URL", "https://github.com/x/y/issues/1"],
  ["シェルの ${#1}", 'echo "${#1}"'],
  ["文字参照", "&#123;"],
  ["インラインコード", "`#1` のように書かない"],
  ["例の行", "例: Issue 列に #12 と書く"],
  ["kaizen の索引", `${KZ}archive/INDEX.md を読む`],
  ["学びのディレクトリ", ".kaizen/ に保存する"],
])("陰性: %s は Tier 4 への参照として数えない", (_, line) => {
  expect(found(makeRepo({ "docs/a.md": `${line}\n` }))).toEqual([]);
});

test("陰性: Tier 3（eval の文書・コメント）は Tier 4 を出所として参照してよい", () => {
  const root = makeRepo({
    "evals/s/README.md": `Issue #388 で足した。${KZ}2026-09-01-a.md\n`,
    "scripts/a.js": `// Issue #507。${KZ}archive/x.md\n`,
  });
  expect(found(root)).toEqual([]);
});

test("陰性: Tier 4 と階層の外とスキルのコピーは読まない", () => {
  const root = makeRepo({
    [`${KZ}2026-09-01-a.md`]: "#1 [x](none.md)\n",
    "evals/s/fixtures/a.md": "#1 [x](none.md)\n",
    ".agents/skills/s/SKILL.md": "#1 [x](none.md)\n",
    "evals/s/evals.json": '{"prompt": "`none.md`「節」"}\n',
  });
  expect(found(root)).toEqual([]);
});

// ---- 配布スキル ----

test.each([
  ["学び", "skills/s/SKILL.md", `${KZ}2026-09-01-a.md の学び`, `dist-kaizen ${KZ}2026-09-01-a.md`],
  ["Issue 番号（Markdown）", "skills/s/SKILL.md", "Issue #485 で直した", "dist-issue #485"],
  ["Issue 番号（コメント）", "skills/s/scripts/a.mjs", "// Issue #485", "dist-issue #485"],
  [
    "スキルの外のファイル",
    "skills/s/scripts/a.mjs",
    "// docs/guide.md を見る",
    "dist-repo-path docs/guide.md",
  ],
])("陽性: 配布スキルから %s を参照すると落とす", (_, file, line, want) => {
  expect(found(makeRepo({ [file]: `${line}\n` }))).toEqual([`${file}:1 ${want}`]);
});

test("陽性: 配布スキルのリンクがスキルのディレクトリの外（リポジトリ・他のスキル）を指すと落とす", () => {
  const root = makeRepo({
    "skills/t/SKILL.md": "# T\n",
    "skills/s/references/b.md": "[d](../../../docs/guide.md) [t](../../t/SKILL.md) [r](ref.md)\n",
  });
  expect(found(root)).toEqual([
    "skills/s/references/b.md:1 dist-repo-path ../../../docs/guide.md",
    "skills/s/references/b.md:1 dist-repo-path ../../t/SKILL.md",
  ]);
});

test("陰性: 符号化として読めない % を含むリンク先は、書いた文字のままのパスとして確かめる", () => {
  const root = makeRepo({ "docs/100%.md": "x\n", "docs/a.md": "[x](100%.md) [y](50%.md)\n" });
  expect(found(root)).toEqual(["docs/a.md:1 link 50%.md"]);
});

test("このチェックの規則は、保留に書ける規則に含まれる", () => {
  for (const r of RULES) expect(KNOWN_RULES).toContain(r);
});

test("陰性: 配布スキルの中に在るパスと、どこにも無いパスは数えない", () => {
  const root = makeRepo({
    "skills/s/scripts/run.mjs": "// x\n",
    "scripts/run.mjs": "// x\n",
    "skills/s/SKILL.md": "`scripts/run.mjs` を実行する。`docs/arch.md` を導入先に置く。\n",
  });
  expect(found(root)).toEqual([]);
});

// ---- 保留と許可 ----

test("保留: 一致は失敗にしない。古い保留・使われない許可は失敗にし、他のチェックの規則は見ない", () => {
  const pending = {
    pending: [
      { file: "docs/a.md", rule: "tier-down", text: "#1", stage: "3" },
      { file: "docs/b.md", rule: "link", text: "x.md", stage: "3" },
      { file: "docs/c.md", rule: "date", text: "2026-09-01", stage: "3" },
    ],
    allowed: [
      { file: "docs/a.md", rule: "tier-down", text: "#2", reason: "導入先の例" },
      { file: "docs/a.md", rule: "tier-down", text: "#3", reason: "導入先の例" },
    ],
  };
  const r = checkDocRefs(
    makeRepo({ "docs/a.md": "#1 #2 #1\n", "docs/b.md": "本文\n" }, { pending }),
  );
  expect(r.pendingCount).toBe(2);
  expect(r.failures).toEqual([
    expect.stringMatching(/^古い保留: docs\/b\.md \[link\] x\.md/),
    expect.stringMatching(/^使われていない許可: docs\/a\.md \[tier-down\] #3/),
  ]);
});

test("--prune は古い保留を消して exit 0 にする", () => {
  const stale = { file: "docs/b.md", rule: "link", text: "x.md", stage: "3" };
  const root = makeRepo({}, { pending: { pending: [stale], allowed: [] } });
  expect(main([root])).toBe(1);
  expect(main([root, "--prune"])).toBe(0);
  expect(JSON.parse(readFileSync(join(root, PENDING_PATH), "utf8")).pending).toEqual([]);
});

// ---- 設定と件数 ----

test.each([
  ["設定が無い", (root) => writeFileSync(join(root, CONFIG_PATH), "")],
  [
    "repo の形の誤り",
    (root) => writeFileSync(join(root, CONFIG_PATH), JSON.stringify({ ...CONFIG, repo: "x" })),
  ],
  [
    "テンプレートが無い",
    (root) =>
      writeFileSync(
        join(root, CONFIG_PATH),
        JSON.stringify({ ...CONFIG, generated: [{ ref: "a.md", template: "none.md" }] }),
      ),
  ],
])("%s はチェックできない（exit 2）", (_, breakIt) => {
  const root = makeRepo();
  breakIt(root);
  expect(main([root])).toBe(2);
});

test("このチェック自身のテストは読まない", () => {
  const root = makeRepo({ "scripts/gates/check-doc-refs.test.js": "// `none.md`「節」\n" });
  expect(found(root)).toEqual([]);
});

test("陰性: 実リポジトリは保留と許可を当てると失敗 0 件", () => {
  const r = checkDocRefs(repoRoot);
  expect(r.failures).toEqual([]);
  expect(r.files).toBeGreaterThan(100);
});

test("陽性コントロール（CLI）: 子プロセスとして起動しても、違反は exit 1、無ければ exit 0", () => {
  const good = spawnSync(process.execPath, [script, makeRepo()], { encoding: "utf8" });
  expect(good.status, good.stderr).toBe(0);
  expect(good.stdout).toMatch(/doc-refs: OK（\d+ 件。保留 0 件）/);
  const bad = spawnSync(process.execPath, [script, makeRepo({ "docs/a.md": "[x](none.md)\n" })], {
    encoding: "utf8",
  });
  expect(bad.status).toBe(1);
  expect(bad.stderr).toMatch(/docs\/a\.md:1: \[link\] リンク先 none\.md が無い/);
});
