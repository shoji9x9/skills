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
