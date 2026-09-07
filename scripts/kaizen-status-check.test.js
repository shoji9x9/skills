import { test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// kaizen-status-check.sh は awk で frontmatter の applied-to を読む。値が
// 折り返された flow 配列（.kaizen/*.md にフォーマッタを掛けると applied-to が
// 長いだけで起きる）を「空」と誤判定すると、コミット前ゲートが commit を
// 恒久的に止める（--no-verify を使わない方針のため回避できない）。
// awk の行単位パースは折り返し・ブロックシーケンス・コメント行のどれでも
// 静かに壊れうるので、受理側と拒否側の両方を決定論的に固定する。
// 検査対象は配布正本のみ。.agents/ 配下のインストール済みコピーは
// skill-reinstall ルールで同期される。
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repoRoot, "skills/kaizen/scripts/kaizen-status-check.sh");

function note(status, appliedTo) {
  return `---
date: 2026-08-10
type: doc
priority: high
status: ${status}
applied-to:${appliedTo}
session: claude-code
---

学びの本文。
`;
}

function runCheck(content) {
  const dir = mkdtempSync(join(tmpdir(), "kaizen-status-check-"));
  try {
    mkdirSync(join(dir, ".kaizen"));
    writeFileSync(join(dir, ".kaizen", "2026-08-10-note.md"), content);
    // CLAUDE_PROJECT_DIR を渡さないとスクリプトは git rev-parse にフォールバックし、
    // 検体ではなくこのリポジトリ自身の .kaizen を検査してしまう。
    const result = spawnSync("bash", [script], {
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
      encoding: "utf8",
    });
    return { status: result.status, stderr: result.stderr ?? "" };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// 適用先が宣言されており、検査を通らなければならない検体。
const ACCEPTED = [
  {
    name: "1 行の flow 配列",
    status: "applied",
    appliedTo: ` [".devcontainer/devcontainer.json"]`,
  },
  {
    name: "折り返された flow 配列（フォーマッタが 4 件で折り返す形）",
    status: "applied",
    appliedTo: `
  [
    ".devcontainer/docker-compose.yml",
    ".devcontainer/devcontainer.json",
    ".devcontainer/init-playwright.sh",
    "documents/troubleshooting.md",
  ]`,
  },
  {
    name: "開き括弧が applied-to 行に残る折り返し",
    status: "applied",
    appliedTo: ` [
    "a.md",
    "b.md",
  ]`,
  },
  {
    name: "ブロックシーケンス",
    status: "applied",
    appliedTo: `
  - "a.md"
  - "b.md"`,
  },
  {
    // ブロックシーケンスは親キーと同じ桁 0 に置いても正しい YAML。桁 0 を一律で値の終わりと
    // 見なすと、この非空の適用先が空と読まれて applied が誤ブロックされる。
    name: "桁 0 のブロックシーケンス",
    status: "applied",
    appliedTo: `
- "a.md"
- "b.md"`,
  },
  {
    name: "折り返し配列の途中にコメント行",
    status: "applied",
    appliedTo: `
  [
    # 直近の適用先
    "a.md",
  ]`,
  },
];

// 空の適用先・status との矛盾を検出できなければならない検体（陽性コントロール）。
// これが無いと「常に exit 0 を返すだけの壊れた検査」も ACCEPTED を全て通してしまう。
const REJECTED = [
  {
    name: "applied なのに空配列",
    status: "applied",
    appliedTo: ` []`,
    message: "status is applied but applied-to is empty",
  },
  {
    name: "applied なのに折り返された空配列",
    status: "applied",
    appliedTo: `
  [
  ]`,
    message: "status is applied but applied-to is empty",
  },
  {
    name: "rejected なのに空配列",
    status: "rejected",
    appliedTo: ` []`,
    message: "status is rejected but applied-to is empty",
  },
  {
    // 桁 0 のブロックシーケンスを読み落とすと「空」に化けて pending が素通りする（fail open）。
    name: "pending なのに桁 0 のブロックシーケンスに適用先がある",
    status: "pending",
    appliedTo: `
- "a.md"`,
    message: "applied-to is set but status is pending",
  },
  {
    name: "pending なのに折り返された配列に適用先がある",
    status: "pending",
    appliedTo: `
  [
    "a.md",
    "b.md",
  ]`,
    message: "applied-to is set but status is pending",
  },
];

test("受理側と拒否側の両方の検体を持つ", () => {
  // 片側だけになると、検査が常に成功／常に失敗へ退化しても気づけない。
  expect(ACCEPTED.length).toBeGreaterThan(0);
  expect(REJECTED.length).toBeGreaterThan(0);
});

test.each(ACCEPTED)("適用先を読める形式は通す: $name", ({ status, appliedTo }) => {
  const { status: exitCode, stderr } = runCheck(note(status, appliedTo));
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test.each(REJECTED)("不整合は exit 2 で止める: $name", ({ status, appliedTo, message }) => {
  const { status: exitCode, stderr } = runCheck(note(status, appliedTo));
  expect(stderr).toContain(message);
  expect(exitCode).toBe(2);
});

// applied-to の継続行の終わりを「キー名が [[:alnum:]_-]+ のキー行」で判定していた頃は、
// それ以外の文字を含むキー（`kedb.ref:` や引用符付きキー）の後ろで継続状態が残り、
// そのブロックスカラー本文まで applied-to の値へ連結された。空配列が非空に化けて pending が
// 誤ブロックされ（偽陽性）、逆に applied の空配列は「非空」と見なされて素通りした（fail open）。
// キー名の字種だけが違う対照検体を並べ、字種で結果が変わらないことを固定する。
const KEY_CHARSET_CASES = [
  { name: "非 alnum のキー（kedb.ref）", key: "kedb.ref" },
  { name: "対照: alnum のみのキー（kedbref）", key: "kedbref" },
  { name: "引用符付きキー", key: '"kedb ref"' },
];

const noteWithBlockKey = (status, appliedTo, key) =>
  `---
date: 2026-08-10
type: doc
priority: high
status: ${status}
applied-to:${appliedTo}
${key}: |
  indented body line
---

学びの本文。
`;

test.each(KEY_CHARSET_CASES)(
  "後続キーのブロックスカラー本文を applied-to へ吸い込まない: $name",
  ({ key }) => {
    // 空配列 × pending は整合しているので通らなければならない。
    const empty = runCheck(noteWithBlockKey("pending", " []", key));
    expect(empty.stderr).toBe("");
    expect(empty.status).toBe(0);

    // 同じ本文でも applied × 空配列は不整合として検出できること（緩めすぎの陽性コントロール。
    // 継続行を吸い込んでいた頃はここが「非空」に化けて exit 0 で素通りしていた）。
    const appliedEmpty = runCheck(noteWithBlockKey("applied", " []", key));
    expect(appliedEmpty.stderr).toContain("status is applied but applied-to is empty");
    expect(appliedEmpty.status).toBe(2);

    // 折り返された非空配列は、後続キーが何であれ非空のまま検出できること。
    const wrapped = runCheck(noteWithBlockKey("pending", '\n  ["a.md"]', key));
    expect(wrapped.stderr).toContain("applied-to is set but status is pending");
    expect(wrapped.status).toBe(2);
  },
);

// 参照注入（kaizen-context-inject.sh）は要約として `## 提案`（無ければ `## 事象`）の
// **最初の非空行だけ**を供給する。先頭段落を折り返すと、注入される要約は文の途中で
// 切れた断片になるのに、注入も検査も成功して終了コード 0 のまま通っていた（Issue #301）。
// 書いた時点で気づける経路はこの形式検査だけなので、折り返し（陽性）と、折り返しでない
// 形（陰性）の両方を固定して「常に報告する／常に黙る」への退化を防ぐ。
const FRONTMATTER = (status, appliedTo) => `---
date: 2026-01-01
type: doc
priority: high
status: ${status}
applied-to: ${appliedTo}
session: claude-code
---

# 学びのタイトル
`;

const WRAPPED_MESSAGE = "is wrapped onto the next line";

function runCheckOnBody(body, { status = "pending", appliedTo = "[]", archived = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "kaizen-lead-"));
  try {
    const noteDir = archived ? join(dir, ".kaizen", "archive") : join(dir, ".kaizen");
    mkdirSync(noteDir, { recursive: true });
    writeFileSync(join(noteDir, "2026-01-01-note.md"), FRONTMATTER(status, appliedTo) + body);
    if (archived) {
      // archive の索引不整合は別の検査で exit 2 になる。折り返し検査だけを見たいので
      // INDEX.md を整合させ、この検体で出る stderr が折り返し由来かを弁別できるようにする。
      writeFileSync(join(dir, ".kaizen", "archive", "INDEX.md"), "- `2026-01-01-note.md` — 学び\n");
    }
    const result = spawnSync("bash", [script], {
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
      encoding: "utf8",
    });
    return { status: result.status, stderr: result.stderr ?? "" };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// 注入される要約が文の途中で切れるため、報告しなければならない検体。
const WRAPPED_LEADS = [
  {
    name: "折り返された段落",
    body: "\n## 提案\n\n**先頭の文がここで折り返されると、続きは\n次の物理行に置かれる。**\n",
    section: "## 提案",
  },
  {
    // 継続行はインデントされるので、次行が箇条書き記号で始まらない＝兄弟項目ではない。
    name: "折り返された箇条書きの先頭項目",
    body: "\n## 提案\n\n- 先頭項目がここで折り返され、\n  続きが次の行にある。\n",
    section: "## 提案",
  },
  {
    // 注入は `## 提案` に非空行が無いと `## 事象` へフォールバックする。検査も同じ節を見る。
    name: "提案が無く事象の先頭段落が折り返し",
    body: "\n## 事象\n\nなにかが起きて、その説明が\n次の行へ続く。\n",
    section: "## 事象",
  },
  {
    name: "提案の見出しだけがあり中身が空（事象へフォールバック）",
    body: "\n## 事象\n\nなにかが起きて、その説明が\n次の行へ続く。\n\n## 提案\n",
    section: "## 事象",
  },
];

// 注入される要約が完結するため、通さなければならない検体（偽陽性の陽性コントロール）。
// コミット前ゲートが実行する検査なので、偽陽性は commit を止める実害になる。
const INTACT_LEADS = [
  {
    name: "1 行に収まった段落",
    body: "\n## 提案\n\n先頭の文は 1 行に収まっている。\n",
  },
  {
    name: "1 行の先頭段落のあとに空行を挟んで別段落",
    body: "\n## 提案\n\n先頭の文は 1 行に収まっている。\n\n続きの段落はここから。\n",
  },
  {
    // 注入は先頭項目だけを要約に使う設計なので、兄弟項目の存在は欠落ではない。
    name: "折り返していない箇条書きの兄弟項目",
    body: "\n## 提案\n\n- 項目 1 は完結している。\n- 項目 2 も完結している。\n",
  },
  {
    name: "折り返していない番号付き箇条書き",
    body: "\n## 提案\n\n1. 項目 1 は完結している。\n2. 項目 2 も完結している。\n",
  },
  {
    name: "先頭項目に入れ子の子項目が続く",
    body: "\n## 提案\n\n- 項目 1 は完結している。\n  - 子項目。\n",
  },
  {
    name: "先頭段落がファイル末尾で終わる",
    body: "\n## 提案\n\n先頭の文だけで終わる。",
  },
  {
    // 事象が折り返していても、注入が使うのは提案の先頭行なので実害が無い。
    name: "事象は折り返しているが提案は 1 行",
    body: "\n## 事象\n\n折り返された事象の\n続き。\n\n## 提案\n\n提案は 1 行で完結している。\n",
  },
];

test("折り返し検査は陽性・陰性の両方の検体を持つ", () => {
  expect(WRAPPED_LEADS.length).toBeGreaterThan(0);
  expect(INTACT_LEADS.length).toBeGreaterThan(0);
});

test.each(WRAPPED_LEADS)("先頭段落の折り返しを報告する: $name", ({ body, section }) => {
  const { status: exitCode, stderr } = runCheckOnBody(body);
  expect(stderr).toContain(WRAPPED_MESSAGE);
  // どの節を見て報告したかまで固定する。節の選択が注入側とズレると、
  // 「報告はされるが直す場所が違う」状態になる。
  expect(stderr).toContain(section);
  expect(exitCode).toBe(2);
});

test.each(INTACT_LEADS)("要約が完結する形は通す: $name", ({ body }) => {
  const { status: exitCode, stderr } = runCheckOnBody(body);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

// 検査対象は参照注入が実際に読む集合（archive を除く `.kaizen/*.md` のうち status: pending）に
// 揃える。過去の書き方を理由に commit を止めないための境界なので、同じ本文で status と
// 置き場所だけを変えた対照検体で固定する。
const WRAPPED_BODY = "\n## 提案\n\n折り返された提案の\n続き。\n";

test.each([
  { name: "applied", options: { status: "applied", appliedTo: '["a.md"]' } },
  { name: "rejected", options: { status: "rejected", appliedTo: '["a.md"]' } },
  { name: "archive 配下", options: { archived: true } },
])("注入対象外の学びは折り返しを報告しない: $name", ({ options }) => {
  const { status: exitCode, stderr } = runCheckOnBody(WRAPPED_BODY, options);
  expect(stderr).not.toContain(WRAPPED_MESSAGE);
  expect(exitCode).toBe(0);
});

test("同じ本文でも pending なら報告する（対照）", () => {
  const { status: exitCode, stderr } = runCheckOnBody(WRAPPED_BODY);
  expect(stderr).toContain(WRAPPED_MESSAGE);
  expect(exitCode).toBe(2);
});

// 折り返し検査が awk の失敗で「判定できなかった」ときは、素通り（exit 0）ではなく
// 不整合として数える（ループ先頭の frontmatter 読み取りと同じ fail closed）。素通りさせると
// 「検査して問題なし」と「検査できていない」が同じ exit 0 に潰れる。
// 陽性コントロール: `awk -v h=...`（＝折り返し検査の呼び出しだけ）を失敗させる stub を PATH の
// 先頭に置く。frontmatter 読み取りは `-v` を使わないので通り、折り返し検査だけが落ちる。
const AWK_STUB = (realAwk) => `#!/bin/sh
if [ "$1" = "-v" ]; then
  case "$2" in
  h=*) echo "stubbed awk failure" >&2; exit 3 ;;
  esac
fi
exec ${realAwk} "$@"
`;

function realAwkPath() {
  const found = spawnSync("sh", ["-c", "command -v awk"], { encoding: "utf8" });
  return (found.stdout ?? "").trim();
}

test("折り返し検査が実行できなかったら素通りさせない", () => {
  const realAwk = realAwkPath();
  expect(realAwk).not.toBe("");
  const dir = mkdtempSync(join(tmpdir(), "kaizen-lead-awk-"));
  try {
    mkdirSync(join(dir, ".kaizen"), { recursive: true });
    writeFileSync(
      join(dir, ".kaizen", "2026-01-01-note.md"),
      FRONTMATTER("pending", "[]") + "\n## 提案\n\n先頭の文は 1 行に収まっている。\n",
    );
    const binDir = join(dir, "bin");
    mkdirSync(binDir, { recursive: true });
    const stub = join(binDir, "awk");
    writeFileSync(stub, AWK_STUB(realAwk), { mode: 0o755 });

    // 陰性コントロール: stub 無しなら同じ検体は通る（=stub が原因だと弁別できる）。
    const intact = spawnSync("bash", [script], {
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
      encoding: "utf8",
    });
    expect(intact.stderr ?? "").toBe("");
    expect(intact.status).toBe(0);

    const broken = spawnSync("bash", [script], {
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir, PATH: `${binDir}:${process.env.PATH}` },
      encoding: "utf8",
    });
    expect(broken.stderr ?? "").toContain("could not inspect the lead paragraph");
    expect(broken.status).toBe(2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
