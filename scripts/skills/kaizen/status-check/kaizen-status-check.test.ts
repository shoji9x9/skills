import { test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeTempDir } from "../../../lib/testing/test-tmpdir.ts";
import { CHILD_TIMEOUT_MS } from "../../../lib/testing/child-timeout.ts";

// kaizen-status-check.sh は awk で frontmatter の applied-to を読む。値が
// 折り返された flow 配列（.kaizen/*.md にフォーマッタを掛けると applied-to が
// 長いだけで起きる）を「空」と誤判定すると、コミット前のチェックが commit を
// 恒久的に止める（--no-verify を使わない方針のため回避できない）。
// awk の行単位パースは折り返し・ブロックシーケンス・コメント行のどれでも
// エラーにならずに誤った結果を返しうるので、受理側と拒否側の両方を決定論的に固定する。
// 検査対象は配布する原本だけである。.agents/ 配下のインストール済みコピーは
// skill-reinstall ルールで同期される。
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const script = join(repoRoot, "skills/kaizen/scripts/kaizen-status-check.sh");

function note(status: string, appliedTo: string) {
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

function runCheck(content: string) {
  const dir = makeTempDir("kaizen-status-check-");
  try {
    mkdirSync(join(dir, ".kaizen"));
    writeFileSync(join(dir, ".kaizen", "2026-08-10-note.md"), content);
    // CLAUDE_PROJECT_DIR を渡さないとスクリプトは git rev-parse にフォールバックし、
    // 検体ではなくこのリポジトリ自身の .kaizen を検査してしまう。
    const result = spawnSync("bash", [script], {
      timeout: CHILD_TIMEOUT_MS,
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
    name: "次の行に置いた 1 行の flow 配列",
    status: "applied",
    appliedTo: `
  ["AGENTS.md", "docs/a.md"]`,
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
    name: "引用符の無いブロックシーケンス",
    status: "applied",
    appliedTo: `
  - AGENTS.md`,
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

// 空の適用先・status との矛盾を検出できなければならない検体（検出されることの確認）。
// これが無いと「常に exit 0 を返すだけの不正な検査」も ACCEPTED を全て通してしまう。
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
    // 桁 0 のブロックシーケンスを読み落とすと、誤って「空」と判定されて pending が素通りする（判定できないのに合格として扱う）。
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
// そのブロックスカラー本文まで applied-to の値へ連結された。空配列が誤って非空と判定され、pending が
// 誤ってブロックされた（偽陽性）。逆に applied の空配列は「非空」と見なされて素通りした（合格として扱われた）。
// キー名の字種だけが違う対照検体を並べ、字種で結果が変わらないことを固定する。
const KEY_CHARSET_CASES = [
  { name: "非 alnum のキー（kedb.ref）", key: "kedb.ref" },
  { name: "対照: alnum のみのキー（kedbref）", key: "kedbref" },
  { name: "引用符付きキー", key: '"kedb ref"' },
];

const noteWithBlockKey = (status: string, appliedTo: string, key: string) =>
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

    // 同じ本文でも applied × 空配列は不整合として検出できること（緩めすぎを検出できることの確認。
    // 継続行を吸い込んでいた頃は、ここが誤って「非空」と判定され、exit 0 で素通りしていた）。
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
// 書いた時点で気づける方法はこの形式検査だけである。そこで、折り返し（検出する側）と、折り返しでない
// 形（検出しない側）の両方を固定して、「常に報告する／常に何も出さない」への退化を防ぐ。
const FRONTMATTER = (status: string, appliedTo: string) => `---
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

function runCheckOnBody(
  body: string,
  { status = "pending", appliedTo = "[]", archived = false } = {},
) {
  const dir = makeTempDir("kaizen-lead-");
  try {
    const noteDir = archived ? join(dir, ".kaizen", "archive") : join(dir, ".kaizen");
    mkdirSync(noteDir, { recursive: true });
    writeFileSync(join(noteDir, "2026-01-01-note.md"), FRONTMATTER(status, appliedTo) + body);
    if (archived) {
      // archive の索引不整合は別の検査で exit 2 になる。折り返し検査だけを見たいので
      // INDEX.md を整合させ、この検体で出る stderr が折り返し由来かを区別できるようにする。
      writeFileSync(join(dir, ".kaizen", "archive", "INDEX.md"), "- `2026-01-01-note.md` — 学び\n");
    }
    const result = spawnSync("bash", [script], {
      timeout: CHILD_TIMEOUT_MS,
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
  {
    // 見出しを節の境界として扱わないと、`## 根本原因` を提案の先頭行と読んで
    // 事象へのフォールバックが起きず、折り返した事象を見逃す（実測）。
    name: "提案が空で次の見出しが続く（事象へフォールバック）",
    body: "\n## 事象\n\nなにかが起きて、その説明が\n次の行へ続く。\n\n## 提案\n\n## 根本原因\n\n原因。\n",
    section: "## 事象",
  },
  {
    // 境界の導入で陽性を取りこぼさないことの対照（次行が見出しでも、折り返しは折り返し）。
    name: "折り返した先頭段落の直後に見出し",
    body: "\n## 提案\n\n折り返された提案の\n続き。\n## 次の見出し\n\n本文。\n",
    section: "## 提案",
  },
];

// 注入される要約が完結するため、通さなければならない検体（誤検知しないことの確認）。
// コミット前のチェックが実行する検査なので、偽陽性は commit を止める実害になる。
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
  {
    // 見出しの前に空行が無い Markdown（MD022 を適用していない下流リポでは起こる）。
    // 見出しを段落の続きと読むと、1 行で完結した先頭段落を wrapped と誤報する（実測）。
    // コミット前のチェックで実行する検査なので、この偽陽性は commit を止める実害になる。
    name: "1 行の先頭段落の直後に見出し",
    body: "\n## 提案\n\n一行で完結した提案。\n## 次の見出し\n\n本文。\n",
  },
  {
    name: "提案が空で次の見出しが続き、事象は 1 行",
    body: "\n## 事象\n\n一行の事象。\n\n## 提案\n\n## 根本原因\n\n原因。\n",
  },
];

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
// 不整合として数える（ループ先頭の frontmatter 読み取りと同じく、判定できないときは失敗として扱う）。
// 素通りさせると、「検査して問題なし」と「検査できていない」が同じ exit 0 に潰れる。
// 検出されることの確認: `awk -v h=...`（＝折り返し検査の呼び出しだけ）を失敗させる stub を PATH の
// 先頭に置く。frontmatter 読み取りは `-v` を使わないので通り、折り返し検査だけが失敗する。
const AWK_STUB = (realAwk: string) => `#!/bin/sh
if [ "$1" = "-v" ]; then
  case "$2" in
  h=*) echo "stubbed awk failure" >&2; exit 3 ;;
  esac
fi
exec "${realAwk}" "$@"
`;

function realAwkPath() {
  const found = spawnSync("sh", ["-c", "command -v awk"], {
    timeout: CHILD_TIMEOUT_MS,
    encoding: "utf8",
  });
  return (found.stdout ?? "").trim();
}

test("折り返し検査が実行できなかったら素通りさせない", () => {
  const realAwk = realAwkPath();
  expect(realAwk).not.toBe("");
  const dir = makeTempDir("kaizen-lead-awk-");
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

    // 誤検知しないことの確認: stub 無しなら同じ検体は通る（=stub が原因だと区別できる）。
    const intact = spawnSync("bash", [script], {
      timeout: CHILD_TIMEOUT_MS,
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
      encoding: "utf8",
    });
    expect(intact.stderr ?? "").toBe("");
    expect(intact.status).toBe(0);

    const broken = spawnSync("bash", [script], {
      timeout: CHILD_TIMEOUT_MS,
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir, PATH: `${binDir}:${process.env.PATH}` },
      encoding: "utf8",
    });
    expect(broken.stderr ?? "").toContain("could not inspect the lead paragraph");
    // 理由まで添える（frontmatter 読み取りと同じ）。捨てると「検査できなかった」とだけ言われ、
    // 何を直せばいいか分からないまま commit できない状態になる。
    expect(broken.stderr ?? "").toContain("stubbed awk failure");
    expect(broken.status).toBe(2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
// --- 機構と宣言したのに doc だけで閉じたノートの警告（Issue #341） ---
//
// `status: applied` は「対策が済んだ」宣言だが、`applied-to` にパスが 1 つでもあれば通るため、
// 機構（lint / hook / script / CI）で解決すべきノートでもドキュメントへ 1 行足すだけで閉じられた。
// 症状は同じ学びの再発としてしか現れない。
//
// **判定材料は提案の文面ではなく frontmatter の `type`。** 文面から採る案（lint / hook / 検査 等の
// 語を「## 提案」に照合する）は、実装して実データで測った。applied 131 件のうち一致 16 件はすべて
// `検査` / `ゲート` / `スクリプト` の 3 語で、どれも「提案が何について述べているか」を指すだけだった。
// 適用先に機構が入ったノートへの一致 38%、doc だけのノートへの一致 33% で、2 クラスを分離しない。
//
// これは **exit 0 のままの警告**にする。意図してドキュメントへ寄せる判断は実在するので、
// 遮断すると通せなくなる。したがってテストは「終了コードが 0 のまま」と「警告の有無」を
// 別々に固定する。どちらか片方だけだと、遮断する実装も何も出さない実装も通ってしまう。
//
// 状態空間（type × applied-to の種類 × status × 置き場）。各セルに 1 検体:
//
// | type \ applied-to | `.md` だけ | 機構を含む | `#<Issue>` | 空              |
// |-------------------|------------|------------|------------|-----------------|
// | hook              | 警告       | 出さない   | 出さない   | exit 2（別検査）|
// | doc / rule / 無し | 出さない   | 出さない   | 出さない   | exit 2（別検査）|
//
// | status \ 判定 | applied | pending | rejected | forgotten | archive 配下 |
// |---------------|---------|---------|----------|-----------|--------------|
// | 警告するか    | する    | しない（applied-to は空が正） | しない | しない | しない（履歴） |
//
// ミューテーションテストで検出できることを、次のように確かめた（このファイルを書いた時点で 3 通り実施し、いずれも赤くなることを実測した）。
//   1. `mechanism_types="hook"` を `mechanism_types="hook doc rule"` に広げる → 6 件 fail
//      （doc / rule / skill の検体と、type を問わず鳴ることで巻き込まれる検体）
//   2. `applied_to_is_docs_only` の `*.md) found=1 ;;` を `*) found=1 ;;` に広げる → 2 件 fail
//      （「機構を含む」「Issue へ委譲」。`.md` かどうかで区別できている）
//   3. 警告分岐の `[ "${status}" = "applied" ]` を消す → 2 件 fail（pending / forgotten）
const WARNING_MESSAGE = "applied-to lists documents only";

const FRONTMATTER_TYPED = (type: string, status: string, appliedTo: string) => `---
date: 2026-01-01
type: ${type}
priority: high
status: ${status}
applied-to: ${appliedTo}
session: claude-code
---

# 学びのタイトル

## 事象

何かが起きた。

## 提案

対策を書く。
`;

function runCheckTyped({
  type = "hook",
  status = "applied",
  appliedTo = '["docs/a.md"]',
  archived = false,
}) {
  const dir = makeTempDir("kaizen-docs-only-");
  try {
    const noteDir = archived ? join(dir, ".kaizen", "archive") : join(dir, ".kaizen");
    mkdirSync(noteDir, { recursive: true });
    writeFileSync(join(noteDir, "2026-01-01-note.md"), FRONTMATTER_TYPED(type, status, appliedTo));
    if (archived) {
      writeFileSync(join(dir, ".kaizen", "archive", "INDEX.md"), "- `2026-01-01-note.md` — 学び\n");
    }
    const result = spawnSync("bash", [script], {
      timeout: CHILD_TIMEOUT_MS,
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
      encoding: "utf8",
    });
    return { status: result.status, stderr: result.stderr ?? "" };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// 警告しなければならない検体（検出されることの確認）。
const WARNED = [
  { name: "type: hook × .md だけ", note: {} },
  {
    name: "ディレクトリの無い .md（AGENTS.md 形式・引用符なし）",
    note: { appliedTo: "[AGENTS.md]" },
  },
  {
    name: "ブロックシーケンスで .md だけ",
    note: { appliedTo: '\n  - "docs/a.md"\n  - "docs/b.md"' },
  },
];

// 警告を出してはならない検体（誤検知しないことの確認）。片側だけだと「常に警告する」実装も通る。
const NOT_WARNED = [
  { name: "機構を含む（.sh）", note: { appliedTo: '["scripts/a.sh", "docs/a.md"]' } },
  { name: "Issue へ委譲（#123）", note: { appliedTo: '["#123"]' } },
  { name: "type: doc は対象外", note: { type: "doc" } },
  { name: "type: rule は対象外", note: { type: "rule" } },
  {
    name: "type: skill は対象外（SKILL.md は .md なので一律に鳴らさない）",
    note: { type: "skill" },
  },
  {
    name: "rejected は対象外",
    note: { status: "rejected", appliedTo: '["rejected: 見送る"]' },
  },
  { name: "archive 配下は履歴なので対象外", note: { archived: true } },
];

test.each(WARNED)("機構と宣言して doc だけで閉じたら警告する: $name", ({ note }) => {
  const { status: exitCode, stderr } = runCheckTyped(note);
  expect(stderr).toContain(WARNING_MESSAGE);
  expect(stderr).toContain("type is hook");
  // 警告は遮断しない。ここが 2 になると、意図してドキュメントへ寄せる判断を通せなくなる。
  expect(exitCode).toBe(0);
});

test.each(NOT_WARNED)("警告しない: $name", ({ note }) => {
  const { status: exitCode, stderr } = runCheckTyped(note);
  expect(stderr).not.toContain(WARNING_MESSAGE);
  expect(exitCode).toBe(0);
});

test.each(["pending", "forgotten"])("applied 以外の status では警告しない: %s", (status) => {
  // applied-to に値を入れて doc 判定へ到達させる（空だと判定の手前で外れ、status の条件が
  // 機能しているかを測れない）。この形は lifecycle の不整合なので、別の検査が exit 2 で失敗させる。
  // そこへ警告を重ねても直す先が増えるだけなので、警告は出さないことを固定する。
  const { status: exitCode, stderr } = runCheckTyped({ status, appliedTo: '["docs/a.md"]' });
  expect(stderr).toContain(`applied-to is set but status is ${status}`);
  expect(stderr).not.toContain(WARNING_MESSAGE);
  expect(exitCode).toBe(2);
});

// --- status: forgotten（Issue #339） ---
//
// 忘却は「適用しないまま一旦終わりにする」決着なので、pending と同じく適用先を持たない。
// 未知の status として弾くと自動忘却が commit を止め、逆に何でも受理すると
// `applied-to` を持ったまま forgotten にした取り違えを見逃す。両側を固定する。
test("forgotten は applied-to が空なら通す", () => {
  const { status: exitCode, stderr } = runCheck(note("forgotten", " []"));
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test("forgotten なのに applied-to があれば止める", () => {
  const { status: exitCode, stderr } = runCheck(note("forgotten", ' ["a.md"]'));
  expect(stderr).toContain("applied-to is set but status is forgotten");
  expect(exitCode).toBe(2);
});

test("未知の status は依然として止める（受理集合を広げすぎていない）", () => {
  const { status: exitCode, stderr } = runCheck(note("forgoten", " []"));
  expect(stderr).toContain("unknown status: forgoten");
  expect(exitCode).toBe(2);
});

// --- confidence（Issue #701） ---
//
// confidence は後から足した任意の欄で、足す前に書いたノートは書き換えない。欠けていても通し、
// 在るときだけ high / medium / low のどれであるかを確かめる。値の取り違え（綴りの誤り・空・大文字）を
// 通すと、確信度で提案の広さを決める取り決めが読めない値で動くので、受理側と拒否側の両方を固定する。
function noteWithConfidence(confidenceLine: string) {
  return `---
date: 2026-10-19
type: doc
priority: medium
${confidenceLine}
status: pending
applied-to: []
session: claude-code
---

学びの本文。
`;
}

test.each([
  ["high", "confidence: high"],
  ["medium", "confidence: medium"],
  ["low", "confidence: low"],
  ["二重引用符で囲んだ値", 'confidence: "high"'],
  ["単引用符で囲んだ値", "confidence: 'low'"],
  ["行末のコメント", "confidence: medium # 1 回の観測"],
  ["キーとコロンの間の空白", "confidence : high"],
  ["引用符で囲んだキー", '"confidence": high'],
  ["単引用符で囲んだキー", "'confidence': low"],
  ["欄が無い（欄を足す前のノート）", "kedb: none"],
])("confidence を受け付ける: %s", (_name, line) => {
  const { status: exitCode, stderr } = runCheck(noteWithConfidence(line));
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test.each([
  ["未知の値", "confidence: certain", "unknown confidence: certain"],
  ["大文字", "confidence: High", "unknown confidence: High"],
  ["空の値", "confidence:", "unknown confidence: <empty>"],
  ["空白だけの値", "confidence:   ", "unknown confidence: <empty>"],
  ["片側だけの引用符", 'confidence: "high', 'unknown confidence: "high'],
  ["区切りの | を含む値", "confidence: low|high", "unknown confidence: low｜high"],
  ["コメントだけの値", "confidence: # 後で決める", "unknown confidence: <empty>"],
  ["キーとコロンの間に空白がある不正な値", "confidence : bogus", "unknown confidence: bogus"],
  ["コロンの後に空白が無い値", "confidence:high", "confidence needs a space after the colon"],
  ["引用符で囲んだキーの不正な値", '"confidence": bogus', "unknown confidence: bogus"],
  ["単引用符で囲んだキーの不正な値", "'confidence': bogus", "unknown confidence: bogus"],
  [
    "重なったキー（前の値が不正）",
    "confidence: bogus\nconfidence: high",
    "confidence is declared 2 times",
  ],
])("confidence の値を拒否する: %s", (_name, line, message) => {
  const { status: exitCode, stderr } = runCheck(noteWithConfidence(line));
  expect(stderr).toContain(message);
  expect(exitCode).toBe(2);
});

// status と type の値の `|` は、read のフィールドをずらすので全角の `｜` に置き換える（confidence と同じ）。
test("status の値の | で後ろのフィールドがずれない", () => {
  const { status: exitCode, stderr } = runCheck(note("pending|x", " []"));
  expect(stderr).toContain("unknown status: pending｜x");
  expect(exitCode).toBe(2);
});

test("type の値の | で後ろのフィールドがずれない", () => {
  const content = note("applied", ' ["docs/a.md"]').replace("type: doc", "type: hook|x");
  const { status: exitCode, stderr } = runCheck(content);
  // type は語でないので止めるが、フィールドがずれていなければ、報告はその 1 件だけになる
  expect(stderr).toContain("type is not a plain word");
  expect(stderr).toContain("1 problem(s)");
  expect(exitCode).toBe(2);
});

test("本文に書いた confidence: は frontmatter として読まない", () => {
  const content = noteWithConfidence("confidence: low").replace(
    "学びの本文。",
    "学びの本文。\nconfidence: unknown-in-body",
  );
  const { status: exitCode, stderr } = runCheck(content);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test("コロンの後に空白が無い形と重なったキーを、1 回の実行でまとめて報告する", () => {
  const { status: exitCode, stderr } = runCheck(
    noteWithConfidence("confidence:high\nconfidence: bogus"),
  );
  expect(stderr).toContain("confidence needs a space after the colon");
  expect(stderr).toContain("confidence is declared 2 times");
  expect(stderr).toContain("unknown confidence: bogus");
  expect(exitCode).toBe(2);
});

test("重なったキーの前の不正な値も報告する", () => {
  const { status: exitCode, stderr } = runCheck(
    noteWithConfidence("confidence: bogus\nconfidence: high"),
  );
  expect(stderr).toContain("confidence is declared 2 times");
  expect(stderr).toContain("unknown confidence: bogus");
  expect(exitCode).toBe(2);
});

test("重なったキーの不正な値は、すべてを 1 回の実行で報告する", () => {
  const { status: exitCode, stderr } = runCheck(
    noteWithConfidence("confidence: bogus\nconfidence: other"),
  );
  expect(stderr).toContain("confidence is declared 2 times");
  expect(stderr).toContain("unknown confidence: bogus, other");
  expect(exitCode).toBe(2);
});

test("重なったキーの前の空の値も報告する", () => {
  const { status: exitCode, stderr } = runCheck(
    noteWithConfidence("confidence:\nconfidence: high"),
  );
  expect(stderr).toContain("confidence is declared 2 times");
  expect(stderr).toContain("unknown confidence: <empty>");
  expect(exitCode).toBe(2);
});

test("コロンの後に空白が無い不正な値は、空白と値の両方を報告する", () => {
  const { status: exitCode, stderr } = runCheck(noteWithConfidence("confidence:bogus"));
  expect(stderr).toContain("confidence needs a space after the colon");
  expect(stderr).toContain("unknown confidence: bogus");
  expect(exitCode).toBe(2);
});

// status・type・applied-to も、confidence と同じく、キーの重なりとブロックスカラー・タグの値を止める（Issue #727）。
// 重なると、このチェックは最後の値を読むが、YAML の実装によってはエラーになるか、別の値を採る。
// ブロックスカラーとタグは、1 行の値として読めない。applied-to の無い旧形式のノートも対象にする。
function noteWithKeys(lines: { status?: string; type?: string; appliedTo?: string }) {
  return `---
date: 2026-10-21
${lines.type ?? "type: doc"}
priority: medium
${lines.status ?? "status: pending"}
${lines.appliedTo ?? "applied-to: []"}
session: claude-code
---

学びの本文。
`;
}

test.each([
  ["status の重なり", { status: "status: pending\nstatus: applied" }, "status is declared 2 times"],
  [
    "引用符で囲んだキーと重なった status",
    { status: 'status: pending\n"status": pending' },
    "status is declared 2 times",
  ],
  [
    "applied-to の無いノートの status の重なり",
    { status: "status: pending\nstatus: pending", appliedTo: "kedb: none" },
    "status is declared 2 times",
  ],
  ["type の重なり", { type: "type: doc\ntype: hook" }, "type is declared 2 times"],
  [
    "単引用符で囲んだキーと重なった type",
    { type: "type: doc\n'type': doc" },
    "type is declared 2 times",
  ],
  [
    "applied-to の重なり",
    { appliedTo: "applied-to: []\napplied-to: []" },
    "applied-to is declared 2 times",
  ],
  [
    "status のブロックスカラー（>-）",
    { status: "status: >-\n  pending" },
    "status uses a block scalar",
  ],
  [
    "status のブロックスカラー（|）",
    { status: "status: |\n  pending" },
    "status uses a block scalar",
  ],
  [
    "status のブロックスカラー（行末のコメント）",
    { status: "status: >- # 折り返す\n  pending" },
    "status uses a block scalar",
  ],
  ["type のブロックスカラー（|2+）", { type: "type: |2+\n  doc" }, "type uses a block scalar"],
  [
    "applied-to のブロックスカラー",
    { appliedTo: "applied-to: |\n  docs/a.md" },
    "applied-to uses a block scalar",
  ],
  ["status のタグ", { status: "status: !!str pending" }, "status has a YAML tag"],
  ["type のタグ", { type: "type: !custom doc" }, "type has a YAML tag"],
  ["applied-to のタグ", { appliedTo: "applied-to: !!seq []" }, "applied-to has a YAML tag"],
  ["status のアンカー", { status: "status: &s pending" }, "status uses a YAML anchor or alias"],
  ["type のエイリアス", { type: "type: *t" }, "type uses a YAML anchor or alias"],
  [
    "applied-to のアンカー",
    { appliedTo: "applied-to: &a []" },
    "applied-to uses a YAML anchor or alias",
  ],
  ["引用符で囲んだ status のキー", { status: '"status": pending' }, "status key is quoted"],
  ["コロンの前に空白がある type のキー", { type: "type : doc" }, "type key is quoted"],
  [
    "単引用符で囲んだ applied-to のキー",
    { appliedTo: "'applied-to': []" },
    "applied-to key is quoted",
  ],
  // キーにアンカーやタグを付けた行も、同じキーとして数え、形の誤りとして止める
  [
    "アンカーを付けた status のキーの重なり",
    { status: "status: pending\n&k status: applied" },
    "status is declared 2 times",
  ],
  ["タグを付けた type のキー", { type: "!!str type: doc" }, "type key is quoted"],
  // コロンの後に空白が無い形は YAML の mapping にならない（confidence と同じ）
  [
    "コロンの後に空白が無い status",
    { status: "status:pending" },
    "status needs a space after the colon",
  ],
  ["コロンの後に空白が無い type", { type: "type:doc" }, "type needs a space after the colon"],
  [
    "コロンの後に空白が無い applied-to",
    { appliedTo: "applied-to:[]" },
    "applied-to needs a space after the colon",
  ],
])("status・type・applied-to の形を拒否する: %s", (_name, lines, message) => {
  const { status: exitCode, stderr } = runCheck(noteWithKeys(lines));
  expect(stderr).toContain(message);
  expect(exitCode).toBe(2);
});

test.each([
  ["1 回ずつのキー", {}],
  ["_ と - を含む語", { type: "type: rule_doc-1" }],
  ["値の後のコメントに書いた記号", { status: "status: pending # !! と | は値ではない" }],
  ["flow 配列の applied-to", { status: "status: applied", appliedTo: 'applied-to: ["docs/a.md"]' }],
])("status・type・applied-to の形を受け付ける: %s", (_name, lines) => {
  const { status: exitCode, stderr } = runCheck(noteWithKeys(lines));
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

// applied-to の要素も、ブロックシーケンスと flow 配列の両方の形で、アンカー・エイリアス・タグを止める。
test.each([
  ["ブロックシーケンスのエイリアス", "applied-to:\n  - *ref"],
  ["ブロックシーケンスのアンカー", "applied-to:\n  - &a docs/a.md"],
  ["ブロックシーケンスのタグ", "applied-to:\n  - !!str docs/a.md"],
  ["桁 0 のブロックシーケンスのエイリアス", "applied-to:\n- *ref"],
  ["flow 配列のエイリアス", "applied-to: [*ref]"],
  ["flow 配列の 2 つ目の要素のアンカー", 'applied-to: ["docs/a.md", &a docs/b.md]'],
  ["flow 配列のタグ", "applied-to: [!!str docs/a.md]"],
])("applied-to の要素の形を拒否する: %s", (_name, appliedTo) => {
  const { status: exitCode, stderr } = runCheck(
    noteWithKeys({ status: "status: applied", appliedTo }),
  );
  expect(stderr).toContain("applied-to has an element with a YAML anchor, alias, tag");
  expect(exitCode).toBe(2);
});

test.each([
  ["引用符で囲んだ要素", 'applied-to: ["*x.md", "&y.md", "!z.md"]'],
  ["引用符で囲んだブロックシーケンスの要素", "applied-to:\n  - '*x.md'"],
  ["引用符の中の , の後に記号がある要素", 'applied-to: ["docs/a, *b.md"]'],
  ["エスケープした引用符の後に , と記号がある要素", 'applied-to: ["docs/a\\", &b.md"]'],
])("applied-to の要素の形を受け付ける: %s", (_name, appliedTo) => {
  const { status: exitCode, stderr } = runCheck(
    noteWithKeys({ status: "status: applied", appliedTo }),
  );
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test.each([
  ["エイリアス", "applied-to: *ref", "uses a YAML anchor or alias"],
  ["タグ", "applied-to: !!seq [docs/a.md]", "has a YAML tag"],
])(
  "値そのものに付けた applied-to の%sは、要素の問題として重ねて数えない",
  (_name, appliedTo, message) => {
    const { status: exitCode, stderr } = runCheck(
      noteWithKeys({ status: "status: applied", appliedTo }),
    );
    expect(stderr).toContain(message);
    expect(stderr).not.toContain("has an element with");
    expect(stderr).toContain("1 problem(s)");
    expect(exitCode).toBe(2);
  },
);

test("本文に書いた status: は、キーの重なりとして数えない", () => {
  const content = noteWithKeys({}).replace(
    "学びの本文。",
    "学びの本文。\nstatus: applied\ntype: hook",
  );
  const { status: exitCode, stderr } = runCheck(content);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test("キーの重なりと値の形を、1 回の実行でまとめて報告する", () => {
  const { status: exitCode, stderr } = runCheck(
    noteWithKeys({ status: "status: pending\nstatus: !!str pending", type: "type: >-\n  doc" }),
  );
  expect(stderr).toContain("status is declared 2 times");
  expect(stderr).toContain("status has a YAML tag");
  expect(stderr).toContain("type uses a block scalar");
  expect(exitCode).toBe(2);
});

// キーに属性（アンカー・タグ）を 2 つ付けた行も、同じキーとして数える。confidence のキーも同じに数える。
test.each([
  [
    "属性を 2 つ付けた status",
    { status: "status: applied\n&a !!str status: pending" },
    "status is declared 2 times",
  ],
])("属性を付けたキーの重なりを報告する: %s", (_name, lines, message) => {
  const { status: exitCode, stderr } = runCheck(noteWithKeys(lines));
  expect(stderr).toContain(message);
  expect(exitCode).toBe(2);
});

test("アンカーを付けた confidence のキーも、重なりとキーの属性として報告する", () => {
  const { status: exitCode, stderr } = runCheck(
    noteWithConfidence("confidence: high\n&k confidence: low"),
  );
  expect(stderr).toContain("confidence is declared 2 times");
  expect(stderr).toContain("confidence key has a YAML anchor or tag");
  expect(exitCode).toBe(2);
});

test("applied-to が重なったとき、前のキーの値の形に関わらず、後のキーの要素も確かめる", () => {
  const { status: exitCode, stderr } = runCheck(
    noteWithKeys({ status: "status: applied", appliedTo: "applied-to: *x\napplied-to: [*y]" }),
  );
  expect(stderr).toContain("applied-to uses a YAML anchor or alias");
  expect(stderr).toContain("applied-to has an element with");
  expect(exitCode).toBe(2);
});

// archive のノートは注入されず書き換えもしないので、キーの重なりと形のチェックを当てない。
function runCheckArchived(content: string) {
  const dir = makeTempDir("kaizen-status-check-");
  try {
    mkdirSync(join(dir, ".kaizen", "archive"), { recursive: true });
    writeFileSync(join(dir, ".kaizen", "archive", "2026-08-10-note.md"), content);
    writeFileSync(join(dir, ".kaizen", "archive", "INDEX.md"), "- `2026-08-10-note.md` — 学び\n");
    const result = spawnSync("bash", [script], {
      timeout: CHILD_TIMEOUT_MS,
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
      encoding: "utf8",
    });
    return { status: result.status, stderr: result.stderr ?? "" };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("archive のノートには、キーの重なりと形のチェックを当てない", () => {
  const content = noteWithKeys({
    status: "status: applied\nstatus:applied",
    type: "type: >-\n  doc",
    appliedTo: 'applied-to: ["docs/a.md"]',
  });
  const archived = runCheckArchived(content);
  expect(archived.stderr).toBe("");
  expect(archived.status).toBe(0);
  // 同じノートを archive の外に置くと止める（対照）
  const current = runCheck(content);
  expect(current.stderr).toContain("status is declared 2 times");
  expect(current.status).toBe(2);
});

// confidence のキーの属性は、confidence の他のチェックと同じく archive のノートにも当てる。
test("archive のノートには、confidence のキーの属性のチェックも当てない", () => {
  const archived = runCheckArchived(noteWithConfidence("&a confidence: high"));
  expect(archived.stderr).toBe("");
  expect(archived.status).toBe(0);
  // 同じノートを archive の外に置くと止める（対照）
  const current = runCheck(noteWithConfidence("&a confidence: high"));
  expect(current.stderr).toContain("confidence key has a YAML anchor or tag");
  expect(current.status).toBe(2);
});

// ブロックシーケンスの要素は 1 つの文字列なので、要素の中の , の後の記号は要素の先頭ではない
test("ブロックシーケンスの要素の中にある , の後の記号では止めない", () => {
  const { status: exitCode, stderr } = runCheck(
    noteWithKeys({
      status: "status: applied",
      appliedTo: "applied-to:\n  - docs/a.md (rule, !important)",
    }),
  );
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

// status と type は 1 つの語なので、英数字・_・- だけの語のほかは、記号の種類に関わらず止める
test.each([
  ["flow の配列の type", { type: "type: [hook]" }],
  ["flow の mapping の status", { status: "status: {a: b}" }],
  ["@ で始まる type", { type: "type: @doc" }],
  ["` で始まる status", { status: "status: `pending`" }],
  ["% で始まる type", { type: "type: %rule" }],
  ["引用符で囲んだ type", { type: 'type: "hook"' }],
  ["片側だけの引用符の status", { status: "status: 'applied" }],
  ["空白を含む type", { type: "type: rule doc" }],
])("status と type の語でない値を拒否する: %s", (_name, lines) => {
  const { status: exitCode, stderr } = runCheck(noteWithKeys(lines));
  expect(stderr).toMatch(/(status|type) is not a plain word/);
  expect(exitCode).toBe(2);
});

// ブロックシーケンスの要素の入れ子の集合とブロックスカラーも止める
test.each([
  ["入れ子の flow 配列", "applied-to:\n  - [*ref]"],
  ["ブロックスカラー", "applied-to:\n  - |\n    docs/a.md"],
])("ブロックシーケンスの要素の集合を拒否する: %s", (_name, appliedTo) => {
  const { status: exitCode, stderr } = runCheck(
    noteWithKeys({ status: "status: applied", appliedTo }),
  );
  expect(stderr).toContain("applied-to has an element with");
  expect(exitCode).toBe(2);
});
