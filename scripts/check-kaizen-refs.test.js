// kaizen の学びへの参照の実在検査の回帰テスト。
//
// 状態空間の軸（判定に使う全入力）と、各セルに置いた入力:
//
// | 軸                 | 値                                                                           |
// | ------------------ | ---------------------------------------------------------------------------- |
// | 参照の形           | 直下の日付付き / archive/ 配下 / 日付の無い archive 名（INDEX.md）/ プレースホルダ |
// | 参照先             | 追跡＋実在 / 不在 / 実在するが未追跡                                          |
// | 行の形             | 1 行 / 折り返し（`//` `#` Markdown 本文）/ 復元できない折り返し               |
// | 折り返しの切れ目   | 名前の途中 / 日付の途中 / `.kaizen/`・`.kaizen/archive/` の直後 / ディレクトリへの言及 |
// | 参照の境界         | 前が単語文字（`foo.kaizen/`）/ 後ろが続く（`.mdx`）                            |
// | 参照元のパス       | 対象 / 除外（配布スキルのインストール済みコピー .claude tests .kaizen node_modules eval の入力）/ eval の文書 |
// | .agents/ の中      | 配布スキルのコピー（skills/<name>/ あり）/ private skill（skills/ に無い）/ 名前が前方一致する別スキル / rule |
// | 参照元の状態       | 追跡＋実在 / 作業ツリーで削除 / 非テキスト拡張子 / シンボリックリンク           |
// | 免除               | 使われる / 使われない / 理由が空                                              |
// | 件数               | ファイル 0 件 / 参照 0 件 / 1 件以上                                          |
//
// 陽性コントロールの実データ: 学びを archive/ へ移したとき実際に切れていた折り返し参照
// （`scripts/kaizen-schedule-report.test.js` の修正前の 2 行）をそのまま入力にする。
import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EXEMPTIONS_PATH, checkKaizenRefs, findRefs, main } from "./check-kaizen-refs.js";
import { makeTempDir } from "./lib/test-tmpdir.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repoRoot, "scripts/check-kaizen-refs.js");

const NOTE = ".kaizen/2026-09-01-live-note.md";
const ARCHIVED = ".kaizen/archive/2026-08-01-old-note.md";
const INDEX = ".kaizen/archive/INDEX.md";

function git(root, ...args) {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
}

function write(root, path, text) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

/** 学び 3 件を追跡済みで持つ一時リポジトリ。`files` は追跡して置く参照元、`untracked` は置くだけ。 */
function makeRepo(files = {}, { untracked = {} } = {}) {
  const root = makeTempDir("kaizen-refs-");
  git(root, "init", "-q");
  for (const p of [NOTE, ARCHIVED, INDEX]) write(root, p, "# note\n");
  for (const [p, t] of Object.entries(files)) write(root, p, t);
  git(root, "add", "-A");
  for (const [p, t] of Object.entries(untracked)) write(root, p, t);
  return root;
}

const run = (root, exemptions = []) => checkKaizenRefs(root, { exemptions });

// ---- 陰性コントロール（通さねばならない入力）----

test("陰性: 直下の実在する学びへの参照は違反 0 件で 1 件と数える", () => {
  const r = run(makeRepo({ "docs/a.md": `根拠は \`${NOTE}\`。\n` }));
  expect(r.violations).toEqual([]);
  expect(r.refs).toBe(1);
});

test("陰性: archive/ 配下の学びと日付の無い INDEX.md への参照は通す", () => {
  const r = run(makeRepo({ "docs/a.md": `[x](../${ARCHIVED}) と \`${INDEX}\`\n` }));
  expect(r.violations).toEqual([]);
  expect(r.refs).toBe(2);
});

test.each([
  ["JS コメント", "scripts/a.js", "// 根拠（`.kaizen/archive/2026-08-01-old-\n// note.md`）。\n"],
  ["シェルのコメント", "scripts/a.sh", "# 根拠 .kaizen/archive/2026-08-01-old-\n#   note.md\n"],
  ["Markdown の本文", "docs/a.md", "根拠は .kaizen/archive/2026-08-01-old-\nnote.md にある。\n"],
])("陰性: 折り返した参照（%s）をつないで実在を確かめ、1 件と数える", (_, path, text) => {
  const r = run(makeRepo({ [path]: text }));
  expect(r.violations).toEqual([]);
  expect(r.refs).toBe(1);
});

test("陰性: プレースホルダは参照として拾わない（数えない）", () => {
  const text = [
    "mv .kaizen/archive/${base} x",
    "ls .kaizen/archive/*.md",
    "書式は `.kaizen/<YYYY-MM-DD>-<slug>.md`",
    `実在する \`${NOTE}\``,
  ].join("\n");
  const r = run(makeRepo({ "docs/a.md": text }));
  expect(r.violations).toEqual([]);
  expect(r.refs).toBe(1);
});

test("陰性: 前が単語文字の `foo.kaizen/…` と、後ろが続く `.mdx` は参照ではない", () => {
  expect(findRefs("foo.kaizen/2026-01-01-x.md と .kaizen/2026-01-01-x.mdx").refs).toEqual([]);
});

test("陰性: 免除の宣言ファイルに書いた参照は、実在しなくても通す", () => {
  const ref = ".kaizen/archive/2026-01-01-fixture.md";
  const exemptions = [{ file: "scripts/a.test.js", ref, reason: "fixture のパス" }];
  const root = makeRepo({
    "scripts/a.test.js": `const p = "${ref}";\n${NOTE}\n`,
    [EXEMPTIONS_PATH]: JSON.stringify({ exemptions }),
  });
  expect(checkKaizenRefs(root).violations).toEqual([]);
});

test("陰性: 作業ツリーで消した追跡ファイルは読まない（ENOENT で赤くしない）", () => {
  const root = makeRepo({ "docs/gone.md": "`.kaizen/2026-01-01-missing.md`\n", "docs/a.md": NOTE });
  rmSync(join(root, "docs/gone.md"));
  const r = run(root);
  expect(r.violations).toEqual([]);
  expect(r.files).not.toContain("docs/gone.md");
});

test("陽性: ignore されていない未追跡の参照元も走査する（add 前の新規ファイルを見落とさない）", () => {
  const root = makeRepo(
    { "docs/a.md": NOTE },
    { untracked: { "docs/new.md": "`.kaizen/2026-01-01-missing.md`\n" } },
  );
  expect(run(root).violations).toHaveLength(1);
});

test("陰性: gitignore された参照元は走査しない（手元の生成物で CI と食い違わない）", () => {
  const root = makeRepo(
    { ".gitignore": "out/\n", "docs/a.md": NOTE },
    { untracked: { "out/log.md": "`.kaizen/2026-01-01-missing.md`\n" } },
  );
  expect(run(root).violations).toEqual([]);
});

test("陰性: テキスト拡張子でないファイルは読まない", () => {
  const root = makeRepo({ "docs/a.bin": ".kaizen/2026-01-01-missing.md\n", "docs/a.md": NOTE });
  expect(run(root).violations).toEqual([]);
});

test("陰性: 実リポジトリの参照が違反 0 件で、参照を 1 件以上数える", () => {
  const r = checkKaizenRefs(repoRoot);
  expect(r.violations).toEqual([]);
  expect(r.refs).toBeGreaterThan(0);
});

// ---- 陽性コントロール（落とす入力）----

test("陽性（実データ）: archive/ へ移した学びを指したままの折り返し参照を落とす", () => {
  // 修正前の scripts/kaizen-schedule-report.test.js の 2 行（学びは archive/ にだけ在る）。
  const before = [
    "  // 予算をコメントで宣言するだけでは守られない（`.kaizen/2026-09-19-length-limit-",
    "  // measured-by-proxy-not-enforcer.md`）。実装で切り、切ったことが分かる形にする。",
  ].join("\n");
  const note = ".kaizen/archive/2026-09-19-length-limit-measured-by-proxy-not-enforcer.md";
  const root = makeRepo({ [note]: "# note\n", "scripts/a.test.js": `${before}\n` });
  expect(run(root).violations).toEqual([
    "scripts/a.test.js:1（折り返し）: .kaizen/2026-09-19-length-limit-measured-by-proxy-not-enforcer.md が存在しない（archive/ へ移動したなら参照を直す）",
  ]);
});

test.each([
  ["日付の途中", "// `.kaizen/archive/2026-09-\n// 19-missing-note.md`\n"],
  ["`.kaizen/archive/` の直後", "// `.kaizen/archive/\n// 2026-09-19-missing-note.md`\n"],
  ["`.kaizen/` の直後", "// `.kaizen/\n// archive/2026-09-19-missing-note.md`\n"],
])("陽性: %sで折り返した参照もつないで実在を確かめ、切れていれば落とす", (_, text) => {
  expect(run(makeRepo({ "scripts/a.js": text })).violations).toEqual([
    "scripts/a.js:1（折り返し）: .kaizen/archive/2026-09-19-missing-note.md が存在しない（archive/ へ移動したなら参照を直す）",
  ]);
});

test("陰性: 行末の `.kaizen/` `.kaizen/archive/` は次行とつないで参照にならなければディレクトリへの言及として通す", () => {
  const text = "学びは .kaizen/\nに置く。移動先は .kaizen/archive/\n（索引も同じ場所）。\n";
  expect(findRefs(text)).toEqual({ refs: [], broken: [] });
});

test("陽性: 直下の学びへの 1 行の参照が実在しなければ落とす", () => {
  const r = run(makeRepo({ "docs/a.md": "`.kaizen/2026-08-01-old-note.md`\n" }));
  expect(r.violations).toEqual([
    "docs/a.md:1: .kaizen/2026-08-01-old-note.md が存在しない（archive/ へ移動したなら参照を直す）",
  ]);
});

test("陽性: archive/ 配下の参照も実在しなければ落とす", () => {
  const r = run(makeRepo({ "docs/a.md": "`.kaizen/archive/2026-09-01-live-note.md`\n" }));
  expect(r.violations).toHaveLength(1);
  expect(r.violations[0]).toMatch(
    /^docs\/a\.md:1: \.kaizen\/archive\/2026-09-01-live-note\.md が存在しない/,
  );
});

test("陽性: 次行とつないでも参照の形にならない折り返しは判定不能として落とす", () => {
  const r = run(
    makeRepo({ "scripts/a.js": "// `.kaizen/2026-09-01-live-\n// （続きを書き忘れた）\n" }),
  );
  expect(r.violations).toEqual([
    "scripts/a.js:1: 行末で切れた参照を次行とつないで復元できない（.kaizen/2026-09-01-live-…）。1 行に収める",
  ]);
});

test("陽性: 作業ツリーにだけ在る未追跡の学びへの参照は落とす（CI には存在しない）", () => {
  const ref = ".kaizen/2026-09-02-untracked.md";
  const r = run(makeRepo({ "docs/a.md": `\`${ref}\`\n` }, { untracked: { [ref]: "# n\n" } }));
  expect(r.violations).toEqual([`docs/a.md:1: ${ref} が追跡されていない（CI には存在しない）`]);
});

test("陽性: eval の文書（README.md）の切れた参照は拾う（除外は eval の入力だけ）", () => {
  const r = run(makeRepo({ "evals/x/README.md": "`.kaizen/2026-01-01-missing.md`\n" }));
  expect(r.violations).toHaveLength(1);
  expect(r.violations[0]).toMatch(/^evals\/x\/README\.md:1: /);
});

test.each([
  ".agents/skills/x/SKILL.md", // skills/x/ に正本がある配布スキルのインストール済みコピー
  ".claude/x.md",
  "tests/x/benchmark.json",
  ".kaizen/2026-09-03-other.md",
  "node_modules/pkg/README.md",
  "evals/x/evals.json",
  "evals/x/fixtures/docs/a.md",
  "scripts/check-kaizen-refs.test.js",
  "scripts/check-kaizen-refs.mutations.json",
])("除外（%s）の切れた参照は見ないが、外に同じものがあれば落とす", (excluded) => {
  const broken = "`.kaizen/2026-01-01-missing.md`\n";
  const base = { [excluded]: broken, "docs/ok.md": NOTE, "skills/x/SKILL.md": "# x\n" };
  const inside = run(makeRepo(base));
  expect(inside.violations).toEqual([]);
  expect(inside.files).not.toContain(excluded);
  const outside = run(makeRepo({ ...base, "docs/b.md": broken }));
  expect(outside.violations).toHaveLength(1);
  expect(outside.violations[0]).toMatch(/^docs\/b\.md:1: /);
});

test.each([
  ["private skill（skills/ に正本が無い）", ".agents/skills/p/SKILL.md", {}],
  ["private skill のスクリプト", ".agents/skills/p/scripts/a.js", {}],
  ["rule の正本", ".agents/rules/r.md", {}],
  [
    "配布スキル xy の名前を前方に含む private skill x",
    ".agents/skills/x/SKILL.md",
    { "skills/xy/SKILL.md": "# xy\n" },
  ],
  [
    "配布スキル x の名前で始まる private skill xy",
    ".agents/skills/xy/SKILL.md",
    { "skills/x/SKILL.md": "# x\n" },
  ],
])("陽性: .agents/ の正本（%s）の切れた参照は落とす", (_, path, extra) => {
  const root = makeRepo({
    ...extra,
    [path]: "`.kaizen/2026-01-01-missing.md`\n",
    ".agents/skills/p/.private-skill": "",
    "docs/ok.md": NOTE,
  });
  expect(run(root).violations).toEqual([
    `${path}:1: .kaizen/2026-01-01-missing.md が存在しない（archive/ へ移動したなら参照を直す）`,
  ]);
});

test("陰性: rule へのシンボリックリンク（.github/instructions）は辿らず、正本の参照を 1 回だけ数える", () => {
  const root = makeRepo({
    ".agents/rules/r.md": `根拠は \`${NOTE}\`、切れた \`.kaizen/2026-01-01-missing.md\`\n`,
  });
  mkdirSync(join(root, ".github/instructions"), { recursive: true });
  symlinkSync("../../.agents/rules/r.md", join(root, ".github/instructions/r.instructions.md"));
  git(root, "add", "-A");
  const r = run(root);
  expect(r.files).toEqual([".agents/rules/r.md"]);
  expect(r.refs).toBe(2);
  expect(r.violations).toEqual([
    ".agents/rules/r.md:1: .kaizen/2026-01-01-missing.md が存在しない（archive/ へ移動したなら参照を直す）",
  ]);
});

test("陽性: 使われていない免除を落とす（残った免除が後の本物の参照を素通りさせる）", () => {
  const root = makeRepo({ "docs/a.md": NOTE });
  const e = { file: "docs/a.md", ref: ".kaizen/2026-01-01-gone.md", reason: "fixture" };
  expect(run(root, [e]).violations).toEqual([
    "使われていない免除: docs/a.md → .kaizen/2026-01-01-gone.md（参照が消えたなら免除も消す）",
  ]);
});

test("陽性: 理由の無い免除を落とす", () => {
  const ref = ".kaizen/2026-01-01-fixture.md";
  const root = makeRepo({ "docs/a.md": `${ref}\n` });
  expect(run(root, [{ file: "docs/a.md", ref, reason: " " }]).violations).toEqual([
    `免除に理由が無い: docs/a.md → ${ref}`,
  ]);
});

// ---- 件数と CLI ----

test("参照 0 件は成功に倒さず exit 1", () => {
  const root = makeRepo({ "docs/a.md": "参照なし\n" });
  expect(main([root])).toBe(1);
});

test.each([
  ["配列でない", { exemptions: {} }],
  ["reason が欠落", { exemptions: [{ file: "docs/a.md", ref: ".kaizen/2026-01-01-x.md" }] }],
])("免除の宣言が読めない（%s）なら exit 2（免除 0 件に倒さない）", (_, data) => {
  const root = makeRepo({ "docs/a.md": NOTE, [EXEMPTIONS_PATH]: JSON.stringify(data) });
  expect(main([root])).toBe(2);
});

test("git リポジトリでなければ exit 2（列挙の失敗を 0 件に倒さない）", () => {
  expect(main([makeTempDir("kaizen-refs-nogit-")])).toBe(2);
});

test("陽性コントロール（CLI）: 子プロセスとして起動しても、切れた参照は exit 1、無ければ exit 0", () => {
  const good = spawnSync(process.execPath, [script, makeRepo({ "docs/a.md": NOTE })], {
    encoding: "utf8",
  });
  expect(good.status, good.stderr).toBe(0);
  expect(good.stdout).toMatch(/kaizen-refs: OK（1 件のファイル・1 件の参照）/);
  const bad = spawnSync(
    process.execPath,
    [script, makeRepo({ "docs/a.md": "`.kaizen/2026-01-01-missing.md`\n" })],
    { encoding: "utf8" },
  );
  expect(bad.status).toBe(1);
  expect(bad.stderr).toMatch(/1 件の不備/);
});
