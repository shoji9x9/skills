// 文書の参照のチェックの回帰テスト。
//
// 状態空間の軸（判定に使う全入力）と、各セルに置いた入力:
//
// | 軸                 | 値                                                                              |
// | ------------------ | ------------------------------------------------------------------------------- |
// | リンク先           | 在る / 無い / URL・#・mailto / アンカー付き / ルートからの絶対パス / % で符号化 |
// | リンクの位置       | 本文 / インラインコード / コードフェンス / Markdown 以外                          |
// | 節名の参照の形     | バッククォート / リンク / スキル名付き                                           |
// | パスと節名の間     | なし / 「の」 / 「の、」 / 空白 / 名詞を挟む（引用。照合しない）/ 1 行に複数       |
// | 参照先の探し方     | 書いたファイルのディレクトリ / ルート / スキル / スキルの references/ / 無い      |
// | 生成ファイル       | 宣言あり（スキルが一致・不一致）/ スキル名付きの参照の宣言 / /名前 で終わるパス / 名前の一部だけ一致 |
// | 節名の一致         | 見出し / 末尾の括弧書き / 番号付き（英字付きの番号を含む）/ 太字（末尾の句点）/ 表のセル / 『』/ 入れ子の「」/ バッククォート / 無い |
// | 参照元の階層       | Tier 1 / Tier 2（docs・private skill）/ Tier 3（eval の文書・コメント）/ 配布スキル |
// | Tier 4 への参照    | 学び（日付付き・archive・INDEX.md）/ eval の結果 / #番号 / Issue の URL /       |
// |                    | 他のリポジトリ（owner/repo#1・他の URL）/ ${#1} / &#123; / インラインコード / 例の行 |
// | スキルの外のパス   | ルートにだけ在る / スキルにも在る / どこにも無い                                 |
// | 保留               | 一致 / 古い / 許可 / 他のチェックの規則                                          |
// | 設定               | 正しい / 無い / repo の形の誤り / テンプレートが無い                             |
import { expect, test } from "vitest";
import { parseJsonAs } from "../../lib/parse-as.ts";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_PATH, RULES, checkDocRefs, hasAnchor, main } from "./check-doc-refs.ts";
import { KNOWN_RULES, PENDING_PATH } from "../../lib/doc-scan.ts";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";
import { CONFIG, found, makeRepo, repoRoot, script } from "./check-doc-refs-helpers.ts";

// 学びのパスは組み立てて書く（そのまま書くと check-kaizen-refs.ts が実在しない学びへの参照として数える）。
const KZ = ".kaizen/";

// ---- 節名の一致 ----

// hasAnchor の戻り値は、節名の参照を違反として報告しないか（true）・報告するか（false）の判定と同じ意味を持つ。
test.each([
  { label: "完全一致", names: ["手順"], name: "手順", want: true },
  { label: "末尾の括弧書き", names: ["手順（補足）"], name: "手順", want: true },
  { label: "半角の括弧書き", names: ["手順 (補足)"], name: "手順", want: true },
  { label: "括弧の前に空白の無い半角の括弧書き", names: ["手順(補足)"], name: "手順", want: true },
  {
    label: "バッククォートの有無（集めた名前は正規化済み）",
    names: ["x の形"],
    name: "`x` の形",
    want: true,
  },
  { label: "『』と「」", names: ["a は「b」"], name: "a は『b』", want: true },
  { label: "前方一致だが括弧でない", names: ["手順書"], name: "手順", want: false },
  { label: "一部だけ", names: ["記述先（適用先）の選び方"], name: "記述先の選び方", want: false },
])("hasAnchor: $label", ({ names, name, want }) => {
  expect(hasAnchor(new Set(names), name)).toBe(want);
});

// 参照先の文書（docs/target.md）の書き方と、参照に書いた節名の組。節名を集める規則を、checkDocRefs の結果で確かめる。
test.each([
  {
    label: "番号付きの見出しを番号ごと書いた形",
    target: "## 7. 定期実行\n",
    name: "7. 定期実行",
    ok: true,
  },
  {
    label: "英字の付いた番号を除いた見出し",
    target: "## 6a. 判断待ち\n",
    name: "判断待ち",
    ok: true,
  },
  {
    label: "バッククォートで囲んだ表のセル",
    target: "| 列 | `値` |\n| --- | --- |\n",
    name: "値",
    ok: true,
  },
  { label: "フェンスの中の見出し", target: "```\n## フェンス\n```\n", name: "フェンス", ok: false },
])("節名の照合: $label", ({ target, name, ok }) => {
  const root = makeRepo({
    "docs/target.md": `# T\n\n${target}`,
    "docs/a.md": `\`target.md\`「${name}」\n`,
  });
  expect(found(root)).toEqual(ok ? [] : [`docs/a.md:1 section target.md「${name}」`]);
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
  ["「の」を挟む形", "docs/a.md", "`guide.md` の「手順」"],
  ["「の」を挟み、節名をバッククォートで囲む形", "docs/a.md", "`guide.md` の「`手順`」"],
  [
    "/名前 で終わる生成ファイル",
    "skills/s/SKILL.md",
    "`.replace/x/gaps.md`「特性化できなかった箇所」",
  ],
])("陰性: 節名が在る（%s）", (_, file, line) => {
  expect(found(makeRepo({ [file]: `${line}\n` }))).toEqual([]);
});

test.each([
  {
    label: "見出しに無い",
    file: "docs/a.md",
    line: "`guide.md`「無い節」",
    text: "guide.md「無い節」",
  },
  {
    label: "一部だけ一致",
    file: "docs/a.md",
    line: "`guide.md`「手順の補足」",
    text: "guide.md「手順の補足」",
  },
  {
    label: "参照先が無い",
    file: "docs/a.md",
    line: "`nothing.md`「節」",
    text: "nothing.md「節」",
  },
  {
    label: "生成ファイルの宣言がスキルに当たらない",
    file: "skills/s/SKILL.md",
    line: "`other.md`「特性化できなかった箇所」",
    text: "other.md「特性化できなかった箇所」",
  },
  {
    label: "生成ファイルのテンプレートに節が無い",
    file: "skills/s/SKILL.md",
    line: "`gaps.md`「無い節」",
    text: "gaps.md「無い節」",
  },
  {
    label: "スキル名付きで節が無い",
    file: "docs/a.md",
    line: "`s` の `references/ref.md`「無い」",
    text: "s/references/ref.md「無い」",
  },
  {
    label: "フェンスの外のコメント",
    file: "scripts/a.js",
    line: "// `docs/guide.md`「無い」",
    text: "docs/guide.md「無い」",
  },
  {
    label: "ルートからのリンク",
    file: "docs/sub/a.md",
    line: "[g](/docs/guide.md)「無い節」",
    text: "/docs/guide.md「無い節」",
  },
  {
    label: "符号化したリンク",
    file: "docs/a.md",
    line: "[g](gui%64e.md)「無い節」",
    text: "gui%64e.md「無い節」",
  },
])("陽性: $label", ({ file, line, text }) => {
  expect(found(makeRepo({ [file]: `${line}\n` }))).toEqual([`${file}:1 section ${text}`]);
});

test.each([
  {
    label: "「の」を挟む形",
    file: "docs/a.md",
    line: "`guide.md` の「無い節」",
    text: "guide.md「無い節」",
  },
  {
    label: "「の、」を挟む形",
    file: "docs/a.md",
    line: "`guide.md` の、「無い節」",
    text: "guide.md「無い節」",
  },
  {
    label: "空白を挟む形",
    file: "docs/a.md",
    line: "`guide.md` 「無い節」",
    text: "guide.md「無い節」",
  },
  {
    label: "リンクの後に「の」を挟む形",
    file: "docs/a.md",
    line: "[g](guide.md) の「無い節」",
    text: "guide.md「無い節」",
  },
  {
    label: "スキル名付きで「の」を挟む形",
    file: "docs/a.md",
    line: "`s` の `references/ref.md` の「無い」",
    text: "s/references/ref.md「無い」",
  },
  {
    label: "節名をバッククォートで囲む形",
    file: "docs/a.md",
    line: "`guide.md` の「`無い節`」",
    text: "guide.md「`無い節`」",
  },
  {
    label: "1 行に複数（後ろだけ無い）",
    file: "docs/a.md",
    line: "`guide.md`「手順」と `guide.md` の「無い節」",
    text: "guide.md「無い節」",
  },
  {
    label: "/名前 で終わる生成ファイルに節が無い",
    file: "skills/s/SKILL.md",
    line: "`.replace/x/gaps.md`「無い節」",
    text: ".replace/x/gaps.md「無い節」",
  },
  {
    label: "名前の一部だけ一致するパスは生成ファイルとして当てない",
    file: "skills/s/SKILL.md",
    line: "`xgaps.md`「特性化できなかった箇所」",
    text: "xgaps.md「特性化できなかった箇所」",
  },
])("陽性: 間に語を挟む形と生成ファイル（$label）", ({ file, line, text }) => {
  expect(found(makeRepo({ [file]: `${line}\n` }))).toEqual([`${file}:1 section ${text}`]);
});

test("陰性: 名詞を挟んだ引用は節名として読まない", () => {
  expect(found(makeRepo({ "docs/a.md": "`guide.md` の分類「無い」\n" }))).toEqual([]);
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
  {
    label: "学び",
    file: "skills/s/SKILL.md",
    line: `${KZ}2026-09-01-a.md の学び`,
    want: `dist-kaizen ${KZ}2026-09-01-a.md`,
  },
  {
    label: "Issue 番号（Markdown）",
    file: "skills/s/SKILL.md",
    line: "Issue #485 で直した",
    want: "dist-issue #485",
  },
  {
    label: "Issue 番号（コメント）",
    file: "skills/s/scripts/a.mjs",
    line: "// Issue #485",
    want: "dist-issue #485",
  },
  {
    label: "スキルの外のファイル",
    file: "skills/s/scripts/a.mjs",
    line: "// docs/guide.md を見る",
    want: "dist-repo-path docs/guide.md",
  },
])("陽性: 配布スキルから $label を参照すると落とす", ({ file, line, want }) => {
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
  expect(
    parseJsonAs<{ pending: unknown[] }>(readFileSync(join(root, PENDING_PATH), "utf8")).pending,
  ).toEqual([]);
});

// ---- 設定と件数 ----

test.each([
  ["設定が無い", (root: string) => writeFileSync(join(root, CONFIG_PATH), "")],
  [
    "repo の形の誤り",
    (root: string) =>
      writeFileSync(join(root, CONFIG_PATH), JSON.stringify({ ...CONFIG, repo: "x" })),
  ],
  [
    "テンプレートが無い",
    (root: string) =>
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
  const root = makeRepo({ "scripts/gates/docs/check-doc-refs.test.ts": "// `none.md`「節」\n" });
  expect(found(root)).toEqual([]);
});

test("陰性: 実リポジトリは保留と許可を当てると失敗 0 件", () => {
  const r = checkDocRefs(repoRoot);
  expect(r.failures).toEqual([]);
  expect(r.files).toBeGreaterThan(100);
});

test("検出の確認（CLI）: 子プロセスとして起動しても、違反は exit 1、無ければ exit 0", () => {
  const good = spawnSync(process.execPath, [script, makeRepo()], {
    timeout: CHILD_TIMEOUT_MS,
    encoding: "utf8",
  });
  expect(good.status, good.stderr).toBe(0);
  expect(good.stdout).toMatch(/doc-refs: OK（\d+ 件。保留 0 件）/);
  const bad = spawnSync(process.execPath, [script, makeRepo({ "docs/a.md": "[x](none.md)\n" })], {
    timeout: CHILD_TIMEOUT_MS,
    encoding: "utf8",
  });
  expect(bad.status).toBe(1);
  expect(bad.stderr).toMatch(/docs\/a\.md:1: \[link\] リンク先 none\.md が無い/);
});
