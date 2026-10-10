// 文章チェック（lint-prose）の回帰テスト。
//
// textlint の設定と単語帳は実リポジトリのものを使い（configRoot の既定値）、対象のファイルと保留の一覧は
// 一時ディレクトリの git リポジトリに置く。実リポジトリの文章の中身には前提を置かない（書き換えの途中で変わる）。
//
// 状態空間の軸（判定に使う全入力）と、各セルに置いた入力:
//
// | 軸                 | 値                                                                          |
// | ------------------ | --------------------------------------------------------------------------- |
// | 単語帳のエントリ   | 全エントリの example（検出される）/ 残すと決めた語・技術用語（検出されない）    |
// | 文章の位置         | 本文 / インラインコード / コードブロック / frontmatter / コメント / 文字列       |
// | コメントの言語     | JavaScript / シェル / YAML（取り出し方の状態は scripts/lib/code-comments.test.js） |
// | ファイルの場所     | 対象 / .agents/rules / private skill / スキルのコピー / .claude/ / .kaizen/ と archive / tests/ / シンボリックリンク / .md 以外 |
// | 保留の一覧         | 在る / 無い / JSON でない / reason が空 / files が配列でない / 重複            |
// | 保留したファイル   | 指摘あり / 指摘 0 件 / ファイルが無い                                         |
// | 実行のしかた       | 全体（引数なし）/ ファイル指定（lefthook）/ 対象 0 件                          |
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { PENDING_PATH, lintProse, loadPending, main } from "./lint-prose.js";
import { COMMENT_EXTENSIONS } from "../lib/code-comments.js";
import { makeSharedTempDir, makeTempDir } from "../lib/test-tmpdir.js";
import { spawnAsync } from "../lib/spawn-async.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const script = join(repoRoot, "scripts/gates/lint-prose.js");
const words = JSON.parse(readFileSync(join(repoRoot, ".textlint/words.json"), "utf8"));

const CLEAN = "# 手順\n\nこの手順でファイルを確認する。\n";
// textlint-disable
const DIRTY = "# 手順\n\n一覧はこのファイルが正本である。\n";
// textlint-enable

function write(root, path, text) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

/** `files` を置いて git に登録し、`pending` を保留の一覧として書いた一時リポジトリ。 */
function makeRepo(files, pending = []) {
  const root = makeTempDir("lint-prose-");
  fillRepo(root, files, pending);
  return root;
}

/** `makeRepo` の中身を、作ったディレクトリ `root` に置く。 */
function fillRepo(root, files, pending = []) {
  spawnSync("git", ["init", "-q"], { cwd: root });
  for (const [p, t] of Object.entries(files)) write(root, p, t);
  if (pending !== null) {
    write(root, PENDING_PATH, JSON.stringify({ reason: "書き換え前", files: pending }));
  }
  spawnSync("git", ["add", "-A"], { cwd: root });
}

// **CLI の子プロセスは、収集のときに起動しておき、最後のテストで終了を待つ**（Issue #590）。
// 子は textlint の読み込みで約 3 秒かかり、ミューテーションテストは変異 1 件ごとにこのファイルを丸ごと実行する。
// 起動しておけば、その間に他のテストが進むので、1 回の実行が縮み、変異の数だけ反映される。
// 他のテストは並べない。`process.chdir` と `process.env.PATH` を書き換えるテストがあるためである。
// 子は起動した時点の cwd と env を受け取るので、後のテストの書き換えは子に及ばない。
// リポジトリはファイルの終わりまで残すので、テストの終わりに消す `makeTempDir` ではなく `makeSharedTempDir` に作る。
const cliRuns = (() => {
  const run = (files) => {
    const root = makeSharedTempDir("lint-prose-cli-");
    fillRepo(root, files);
    return spawnAsync(process.execPath, [script], { cwd: root });
  };
  const dirty = run({ "a.md": DIRTY });
  const clean = run({ "a.md": CLEAN });
  return Promise.all([dirty, clean]).then(([d, c]) => ({ dirty: d, clean: c }));
})();
// CLI のテストを選ばない実行（`-t` など）でも、子の終了を待ってからリポジトリを消す。
// after 系のフックは登録の逆順に実行される（vitest の sequence.hooks のデフォルト `stack`）ので、
// `makeSharedTempDir` の後片付けより後に登録したこのフックが先に実行される。
afterAll(() => cliRuns);

// ---- 単語帳（検出されることの確認）----

describe("単語帳: 各エントリの example が、そのエントリの message で検出される", () => {
  // textlint の起動は重いので、全エントリの example を 1 つのリポジトリに別ファイルで置き、1 回だけ実行する。
  const root = makeSharedTempDir("lint-prose-words-");
  const fileOf = (i) => `entry-${String(i).padStart(3, "0")}.md`;
  let violations;
  beforeAll(async () => {
    spawnSync("git", ["init", "-q"], { cwd: root });
    words.entries.forEach((e, i) => write(root, fileOf(i), `# 例\n\n${e.example}\n`));
    write(root, PENDING_PATH, JSON.stringify({ reason: "書き換え前", files: [] }));
    spawnSync("git", ["add", "-A"], { cwd: root });
    ({ violations } = await lintProse({ root }));
  }, 120_000);
  test.each(words.entries.map((e, i) => [e.example, e.message, i]))("%s", (_, message, i) => {
    const own = violations.filter((v) => v.startsWith(`${fileOf(i)}:`));
    expect(own.some((v) => v.includes(message))).toBe(true);
  });
});

// ---- 単語帳（誤検知しないことの確認）----

test.each([
  ["残すと決めた語", "部品を照合し、検査の結果を突き合わせて実測する。"],
  ["DB の照合順序", "文字コードと照合順序を確かめる。"],
  ["文字化け", "どの文字が文字化けしたかを残す。"],
  ["テストが落ちる", "この入力ではテストが落ちる。"],
  ["引数", "軸から引数を設計する。"],
  ["CSS の背景色", "前景色と背景色を指定する。"],
  ["図の背景", "角をラベルの背景で隠さない。"],
  ["経緯の意味の背景", "この変更の背景を書く。"],
])("陰性: %s は検出しない", async (_, sentence) => {
  const root = makeRepo({ "doc.md": `# 例\n\n${sentence}\n` });
  expect((await lintProse({ root })).violations).toEqual([]);
});

test("陰性: インラインコード・コードブロック・frontmatter の中の語は検出しない", async () => {
  // textlint-disable
  const text =
    "---\ndescription: 一覧は正本である\n---\n\n# 例\n\n`正本` という語を使う。\n\n```text\n正本\n```\n";
  // textlint-enable
  const root = makeRepo({ "doc.md": text });
  expect((await lintProse({ root })).violations).toEqual([]);
});

test("textlint-disable で囲んだ箇所だけを除外し、囲みの外は検出する", async () => {
  // textlint-disable
  const text =
    "# 例\n\n<!-- textlint-disable -->\n\n一覧は正本である。\n\n<!-- textlint-enable -->\n\n仕様は正本にある。\n";
  // textlint-enable
  const root = makeRepo({ "doc.md": text });
  const { violations } = await lintProse({ root });
  expect(violations).toHaveLength(1);
  expect(violations[0]).toMatch(/^doc\.md:9:/);
});

// ---- 対象の範囲 ----

test("陽性: 対象の Markdown の指摘をファイル・行・列付きで報告する", async () => {
  const root = makeRepo({ "docs/a.md": DIRTY });
  const { checked, violations } = await lintProse({ root });
  expect(checked).toBe(1);
  expect(violations).toHaveLength(1);
  expect(violations[0]).toMatch(/^docs\/a\.md:3:\d+ 「正本」は使わない/);
});

test("陰性: スキルのコピー・エージェント用のリンク・過去の記録・テスト結果・シンボリックリンク・.md 以外は見ない", async () => {
  const root = makeRepo({
    "a.md": CLEAN,
    "skills/pub/SKILL.md": CLEAN,
    ".agents/skills/pub/SKILL.md": DIRTY,
    ".claude/rules/x.md": DIRTY,
    ".kaizen/archive/x.md": DIRTY,
    "tests/x/result.md": DIRTY,
    "notes.txt": DIRTY,
  });
  symlinkSync(join(root, "tests/x/result.md"), join(root, "link.md"));
  spawnSync("git", ["add", "-A"], { cwd: root });
  const result = await lintProse({ root });
  expect(result).toEqual({ checked: 2, pending: 0, violations: [], stale: [] });
});

test("陽性: rule の実体・private skill の実体・有効な学びは見る", async () => {
  const root = makeRepo({
    ".agents/rules/x.md": DIRTY,
    ".agents/skills/priv/.private-skill": "",
    ".agents/skills/priv/SKILL.md": DIRTY,
    ".agents/skills/priv/references/r.md": DIRTY,
    ".agents/skills/nomark/SKILL.md": DIRTY,
    ".kaizen/learning.md": DIRTY,
  });
  const files = (await lintProse({ root })).violations.map((v) => v.split(":")[0]).sort();
  expect(files).toEqual([
    ".agents/rules/x.md",
    ".agents/skills/nomark/SKILL.md",
    ".agents/skills/priv/SKILL.md",
    ".agents/skills/priv/references/r.md",
    ".kaizen/learning.md",
  ]);
});

test("陽性: ignore されていない未追跡のファイルも見る", async () => {
  const root = makeRepo({ "a.md": CLEAN });
  write(root, "new.md", DIRTY);
  expect((await lintProse({ root })).violations).toHaveLength(1);
});

test("ファイル指定: 渡したもののうち対象だけを見る（保留していないファイルの指摘は報告する）", async () => {
  const root = makeRepo({ "a.md": DIRTY, "b.md": DIRTY, "tests/x/c.md": DIRTY });
  const result = await lintProse({ root, files: ["a.md", "tests/x/c.md"] });
  expect(result.checked).toBe(1);
  expect(result.violations).toHaveLength(1);
  expect(result.violations[0]).toMatch(/^a\.md:/);
});

test("ファイル指定: 対象が 0 件でも失敗にしない（lefthook は .md 以外の staged も渡しうる）", async () => {
  const root = makeRepo({ "a.md": DIRTY });
  expect(await lintProse({ root, files: ["notes.txt"] })).toEqual({
    checked: 0,
    pending: 0,
    violations: [],
    stale: [],
  });
});

test("全体: 対象が 0 件なら例外にする（何も見ていない実行を合格として扱わない）", async () => {
  const root = makeRepo({ "notes.txt": "x" });
  await expect(lintProse({ root })).rejects.toThrow("0 件");
});

// ---- コメント ----

test("陽性: コメントの指摘を、元のファイルの行と桁で報告する", async () => {
  const root = makeRepo({
    // textlint-disable
    "a.js": "const a = 1;\n// 一覧は正本である。\n",
    "b.sh": "echo x\necho y # 一覧は正本である。\n",
    "c.yml": "a: 1\n# 一覧は正本である。\n",
    // textlint-enable
  });
  const { checked, violations } = await lintProse({ root });
  expect(checked).toBe(3);
  expect(violations.map((v) => v.split(" ")[0]).sort()).toEqual([
    "a.js:2:7",
    "b.sh:2:13",
    "c.yml:2:6",
  ]);
});

test("陰性: 日本語を含まないコメントは検出しない", async () => {
  const root = makeRepo({ "a.js": "// a, b, c, d, e, f: see https://example.com?x=1!\n" });
  expect((await lintProse({ root })).violations).toEqual([]);
});

// ---- 文字列 ----

test("陽性: JS の文字列とテンプレートの語を、元のファイルの行と桁で報告する", async () => {
  const root = makeRepo({
    // textlint-disable
    "a.js":
      'const a = 1;\nconsole.log("一覧は正本である。");\ntest(`x ${a} 経路を見る`, () => {});\n',
    "b.mjs": 'throw new Error("設定が黙って無視される");\n',
    "c.ts": 'const m: string = "正本";\n',
    // textlint-enable
  });
  const { violations } = await lintProse({ root });
  expect(violations.map((v) => v.split(" ")[0]).sort()).toEqual([
    "a.js:2:17",
    "a.js:3:14",
    "b.mjs:1:21",
    "c.ts:1:20",
  ]);
  expect(violations.every((v) => v.includes("（文字列）"))).toBe(true);
});

test("陽性: evals.json の prompt・expected_output・assertions の語を報告し、他のキーは見ない", async () => {
  const evals = {
    skill_name: "x",
    evals: [
      {
        id: 1,
        // textlint-disable
        prompt: "一覧の正本を読む",
        expected_output: "経路を示す",
        fixture: "evals/x/fixtures/正本",
        assertions: ["ok を返す", "黙って無視しない"],
        // textlint-enable
      },
    ],
  };
  const root = makeRepo({
    "evals/x/evals.json": JSON.stringify(evals, null, 2),
    "other/evals.json": JSON.stringify(evals),
    // textlint-disable
    "evals/x/meta.json": JSON.stringify({ prompt: "正本" }),
    // textlint-enable
  });
  const { violations } = await lintProse({ root });
  expect(violations.map((v) => v.split(":").slice(0, 2).join(":")).sort()).toEqual([
    "evals/x/evals.json:11",
    "evals/x/evals.json:6",
    "evals/x/evals.json:7",
  ]);
});

test("陰性: 文字列には語の規則だけを当て、バッククォートの中と import の指定子は見ない", async () => {
  const long = "ファイルを読んで中身を確かめてから結果を返す".repeat(8);
  const root = makeRepo({
    // textlint-disable
    "a.js": `import x from "./正本.js";\nconsole.log("${long}！");\nconsole.log("\`正本\` を検出する");\n`,
    // textlint-enable
  });
  expect((await lintProse({ root })).violations).toEqual([]);
});

test("文字列の中の HTML のコメントとコードフェンスは、後の文字列を隠さない", async () => {
  const root = makeRepo({
    // textlint-disable
    "a.js":
      'const a = "<!-- textlint-disable -->";\nconst b = "```text";\nconst c = "一覧は正本である";\n',
    // textlint-enable
  });
  const { violations } = await lintProse({ root });
  expect(violations.map((v) => v.split(" ")[0])).toEqual(["a.js:3:15"]);
});

test("先頭の --- と行頭の [ラベル]: を Markdown の構文として読ませず、文字列の語を検出する", async () => {
  // textlint-disable
  const src =
    'const a = "---\\nname: x\\n---\\n一覧は正本である";\nconst b = "[x]: 仕様は正本にある";\n';
  // textlint-enable
  const { violations } = await lintProse({ root: makeRepo({ "a.js": src }) });
  expect(violations.map((v) => v.split(" ")[0].split(":").slice(0, 2).join(":"))).toEqual([
    "a.js:1",
    "a.js:2",
  ]);
});

test("入れ物（リスト・引用）の中の字下げとリンク参照の定義も、文字列の語を検出する", async () => {
  // textlint-disable
  const src =
    'const a = "* [x]: 正本";\nconst b = "> [x]: 正本";\nconst c = "-     正本である";\nconst d = ">     正本である";\n';
  // textlint-enable
  const { violations } = await lintProse({ root: makeRepo({ "a.js": src }) });
  expect(violations.map((v) => v.split(":").slice(0, 2).join(":"))).toEqual([
    "a.js:1",
    "a.js:2",
    "a.js:3",
    "a.js:4",
  ]);
});

test("値に \\r を含む文字列の後ろの指摘も、元の行で報告する", async () => {
  // textlint-disable
  const src = 'const a = "前の行\\r次の行";\nconst b = "仕様は正本にある";\n';
  // textlint-enable
  const { violations } = await lintProse({ root: makeRepo({ "a.js": src }) });
  expect(violations.map((v) => v.split(" ")[0])).toEqual(["a.js:2:15"]);
});

test("コメントの textlint-disable で囲んだ文字列だけを除外する", async () => {
  // textlint-disable
  const src =
    '// textlint-disable\nconst a = "一覧は正本である";\n// textlint-enable\nconst b = "仕様は正本にある";\n';
  // textlint-enable
  const { violations } = await lintProse({ root: makeRepo({ "a.js": src }) });
  expect(violations).toHaveLength(1);
  expect(violations[0]).toMatch(/^a\.js:4:/);
});

test("陽性: JSON として読めない evals.json は、指摘として報告する", async () => {
  const { violations } = await lintProse({
    root: makeRepo({ "evals/x/evals.json": '{ "evals": [' }),
  });
  expect(violations).toHaveLength(1);
  expect(violations[0]).toMatch(/^evals\/x\/evals\.json:1:1 .*JSON として読めない/);
});

test("コメントの textlint-disable で囲んだ箇所だけを除外する", async () => {
  // textlint-disable
  const src =
    "// textlint-disable\n// 一覧は正本である。\n// textlint-enable\nconst a = 1;\n// 仕様は正本にある。\n";
  // textlint-enable
  const { violations } = await lintProse({ root: makeRepo({ "a.js": src }) });
  expect(violations).toHaveLength(1);
  expect(violations[0]).toMatch(/^a\.js:5:/);
});

test("JSDoc のタグの行の指摘も、元の行の文章より前の桁を指さない", async () => {
  // 文の長さの指摘は文の先頭（囲んだタグの中）を指す。囲んだ分を戻しても、行の文章の先頭より前にしない。
  const long = "ファイルを読んで中身を確かめてから結果を返す".repeat(8);
  const root = makeRepo({ "a.js": `/**\n * @returns ${long}\n */\n` });
  const lengths = (await lintProse({ root })).violations.filter((v) =>
    v.includes("sentence-length"),
  );
  expect(lengths.map((v) => v.split(" ")[0])).toEqual(["a.js:2:4"]);
});

test("文の長さの指摘に、Markdown の行番号を残さない", async () => {
  // 1 行目を空けて、Markdown の行番号（1）と元の行番号（3）をずらす。
  const long = "ファイルを読んで中身を確かめてから結果を返す".repeat(8);
  const root = makeRepo({ "a.js": `const a = 1;\n\n// ${long}。\n` });
  const lengths = (await lintProse({ root })).violations.filter((v) =>
    v.includes("sentence-length"),
  );
  expect(lengths).toHaveLength(1);
  expect(lengths[0]).toMatch(/^a\.js:3:\d+ sentence length\(\d+\) exceeds/);
});

test("陰性: コメントの指摘も、保留したファイルなら数えず、0 件になったら外すよう求める", async () => {
  const dirty = await lintProse({
    // textlint-disable
    root: makeRepo({ "a.js": "// 一覧は正本である。\n" }, ["a.js"]),
    // textlint-enable
  });
  expect(dirty).toEqual({ checked: 1, pending: 1, violations: [], stale: [] });
  const clean = await lintProse({ root: makeRepo({ "a.js": "// 一覧を確かめる。\n" }, ["a.js"]) });
  expect(clean.stale).toEqual([`a.js: 指摘が 0 件になった。${PENDING_PATH} から外す`]);
});

test("陽性: コメントを取り出せないシェルは、指摘として報告する", async () => {
  const { violations } = await lintProse({ root: makeRepo({ "a.sh": 'x="abc\n# 説明。\n' }) });
  expect(violations).toHaveLength(1);
  expect(violations[0]).toMatch(/^a\.sh:1:1 .*判定できない.*\(code-comments\)$/);
});

test("陽性: 保留したファイルでも、コメントを取り出せなければ報告する", async () => {
  const { violations } = await lintProse({ root: makeRepo({ "a.sh": 'x="abc\n' }, ["a.sh"]) });
  expect(violations).toHaveLength(1);
  expect(violations[0]).toMatch(/^a\.sh:1:1 .*判定できない.*\(code-comments\)$/);
});

test("shfmt が無ければ、ファイルの指摘にせず例外にし、main は保留の一覧を名指ししない exit 2", async () => {
  const root = makeRepo({ "a.sh": "# 説明。\n" });
  // git は要るので、git へのリンクだけを置いたディレクトリを PATH にする（shfmt の置き場所に依らない）。
  const bin = makeTempDir("git-only-");
  const git = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
  symlinkSync(git, join(bin, "git"));
  const path = process.env.PATH;
  const cwd = process.cwd();
  const errors = [];
  const spy = vi.spyOn(console, "error").mockImplementation((m) => errors.push(String(m)));
  process.env.PATH = bin;
  try {
    await expect(lintProse({ root })).rejects.toThrow("shfmt を起動できない");
    process.chdir(root);
    expect(await main([])).toBe(2);
  } finally {
    process.env.PATH = path;
    process.chdir(cwd);
    spy.mockRestore();
  }
  expect(errors.join("\n")).toMatch(/^lint-prose: 実行できない: shfmt を起動できない/m);
  expect(errors.join("\n")).not.toContain(PENDING_PATH);
});

test("lefthook の prose の glob は、Markdown とコメントを持つ拡張子と evals.json に一致する", () => {
  const jobs = yaml
    .load(readFileSync(join(repoRoot, "lefthook.yml"), "utf8"))
    ["pre-commit"].jobs.flatMap((j) => j.group?.jobs ?? [j]);
  const glob = jobs.find((j) => j.name === "prose").glob;
  const exts = glob
    .match(/^\*\.\{(.+)\}$/)[1]
    .split(",")
    .map((e) => `.${e}`);
  expect(exts.sort()).toEqual([".md", ".json", ...COMMENT_EXTENSIONS].sort());
});

// ---- 保留の一覧 ----

test("陰性: 保留したファイルの指摘は数えない", async () => {
  const root = makeRepo({ "a.md": DIRTY, "b.md": CLEAN }, ["a.md"]);
  expect(await lintProse({ root })).toEqual({ checked: 2, pending: 1, violations: [], stale: [] });
});

test("陽性: 保留したファイルの指摘が 0 件になったら、一覧から外すよう求める", async () => {
  const root = makeRepo({ "a.md": CLEAN }, ["a.md"]);
  const { stale } = await lintProse({ root });
  expect(stale).toEqual([`a.md: 指摘が 0 件になった。${PENDING_PATH} から外す`]);
});

test("陽性: 保留したファイルが無ければ、一覧から外すよう求める（全体を見るときだけ）", async () => {
  const root = makeRepo({ "a.md": CLEAN }, ["gone.md"]);
  expect((await lintProse({ root })).stale).toEqual([
    `gone.md: ファイルが無い。${PENDING_PATH} から外す`,
  ]);
  expect((await lintProse({ root, files: ["a.md"] })).stale).toEqual([]);
});

test.each([
  ["無い", null, "が無い"],
  ["JSON でない", "{", "JSON"],
  ["reason が空", JSON.stringify({ reason: " ", files: [] }), "reason"],
  ["files が配列でない", JSON.stringify({ reason: "r", files: "a.md" }), "files"],
  ["files に空文字", JSON.stringify({ reason: "r", files: [""] }), "files"],
  ["files が重複", JSON.stringify({ reason: "r", files: ["a.md", "a.md"] }), "重複"],
])("保留の一覧が%sなら例外にする", (_, text, message) => {
  const root = makeRepo({ "a.md": CLEAN }, null);
  if (text !== null) write(root, PENDING_PATH, text);
  expect(() => loadPending(root)).toThrow(message);
});

// ---- CLI ----

test("main: 指摘があれば 1、無ければ 0、一覧が読めなければ 2 を返す", async () => {
  const cwd = process.cwd();
  try {
    process.chdir(makeRepo({ "a.md": DIRTY }));
    expect(await main([])).toBe(1);
    process.chdir(makeRepo({ "a.md": CLEAN }));
    expect(await main([])).toBe(0);
    process.chdir(makeRepo({ "a.md": CLEAN }, null));
    expect(await main([])).toBe(2);
  } finally {
    process.chdir(cwd);
  }
});

test("検出の確認（CLI）: 子プロセスとして起動しても、指摘は exit 1、無ければ exit 0", async () => {
  const { dirty, clean } = await cliRuns;
  expect(dirty.status, dirty.stderr).toBe(1);
  // textlint-disable
  expect(dirty.stderr).toContain("「正本」は使わない");
  // textlint-enable
  expect(clean.status, clean.stderr).toBe(0);
}, 60_000);
