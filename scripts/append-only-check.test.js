// replace-strategy の追記専用チェッカ（append-only-check.mjs）の回帰テスト（Issue #310）。
//
// スキル群は決定を積み上げる成果物への書き込みを「非破壊追記」と定めているが、追記であることを
// 確かめる道具が無いと、積み上げた文書を丸ごと書き直しても現在の内容が整合していれば全部通る。
// 失われるのは過去の決定（なぜ許容したか・いつ誰が承認したか）で、収束の判定は現在の状態しか見ない。
//
// 陽性コントロール（追記だけなら exit 0、整形だけでは落ちない）を置く——これが無いと「常に落とす」実装と区別できない。

import { test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repoRoot, "skills/replace-strategy/scripts/append-only-check.mjs");

const FEATURES = [
  "# 機能一覧",
  "",
  "| slug | 名前 | 状態 |",
  "|---|---|---|",
  "| order-list | 注文一覧 | 済 |",
  "| order-edit | 注文編集 | 未 |",
  "",
].join("\n");

const GAPS = [
  "# 未検証領域",
  "",
  "| 箇所 | 種別 | 理由 |",
  "|---|---|---|",
  "| 一覧の空状態 | データ不足 | シードが無い |",
  "",
].join("\n");

/** git が使えるコミット済みのプロジェクトを作る。 */
function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), "append-only-"));
  mkdirSync(join(root, ".replace/parity/order-list"), { recursive: true });
  writeFileSync(join(root, ".replace/features.md"), FEATURES);
  writeFileSync(join(root, ".replace/parity/order-list/gaps.md"), GAPS);
  for (const args of [
    ["init", "-q", "."],
    ["config", "user.email", "test@example.com"],
    ["config", "user.name", "test"],
    ["add", "-A"],
    ["commit", "-qm", "seed"],
  ]) {
    const r = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  }
  return root;
}

/** @param {string} root */
function run(root) {
  const r = spawnSync(process.execPath, [script, "--root", root], { encoding: "utf8" });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

test("陽性コントロール: 追記だけなら exit 0", () => {
  const root = makeRepo();
  appendFileSync(join(root, ".replace/features.md"), "| order-detail | 注文詳細 | 未 |\n");
  const r = run(root);
  expect(r.stdout).toMatch(/^ok: /m);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test("行を消して書き直すと落ちる", () => {
  const root = makeRepo();
  writeFileSync(
    join(root, ".replace/features.md"),
    FEATURES.replace("| order-edit | 注文編集 | 未 |\n", ""),
  );
  const r = run(root);
  expect(r.stdout).toMatch(/1 行が失われている/);
  expect(r.stdout).toMatch(/order-edit/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("台帳ごと消すと落ちる", () => {
  const root = makeRepo();
  rmSync(join(root, ".replace/parity/order-list/gaps.md"));
  const r = run(root);
  expect(r.stdout).toMatch(/追記専用の成果物が消えている.*gaps\.md/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("表の桁を詰め直しただけでは落ちない（空白を畳んで突き合わせる）", () => {
  const root = makeRepo();
  writeFileSync(
    join(root, ".replace/features.md"),
    FEATURES.replace("| order-list | 注文一覧 | 済 |", "|   order-list |  注文一覧  |  済   |"),
  );
  const r = run(root);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test("同じ行が 2 回在ったのが 1 回に減っても落ちる（多重度を見る）", () => {
  const root = makeRepo();
  const path = join(root, ".replace/features.md");
  appendFileSync(path, "| order-list | 注文一覧 | 済 |\n");
  spawnSync("git", ["-C", root, "commit", "-qam", "dup"], { encoding: "utf8" });
  writeFileSync(path, FEATURES);
  const r = run(root);
  expect(r.stdout).toMatch(/1 行が失われている/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});

test("追記専用の成果物が 1 件も無ければ合格に倒さない（exit 2）", () => {
  const root = mkdtempSync(join(tmpdir(), "append-only-empty-"));
  writeFileSync(join(root, "README.md"), "x\n");
  for (const args of [
    ["init", "-q", "."],
    ["config", "user.email", "test@example.com"],
    ["config", "user.name", "test"],
    ["add", "-A"],
    ["commit", "-qm", "init"],
  ]) {
    spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  }
  const r = run(root);
  expect(r.stderr).toMatch(/対象 0 件を合格に倒さない/);
  expect(r.status).toBe(2);
  rmSync(root, { recursive: true, force: true });
});

test("git リポジトリでなければ合格に倒さない（exit 2）", () => {
  const root = mkdtempSync(join(tmpdir(), "append-only-nogit-"));
  const r = run(root);
  expect(r.stderr).toMatch(/git リポジトリではない/);
  expect(r.status).toBe(2);
  rmSync(root, { recursive: true, force: true });
});

test("比較元に無い新規ファイルは縮んでいないものとして扱う", () => {
  const root = makeRepo();
  writeFileSync(join(root, ".replace/components.md"), "# 共通部品\n\n| slug | 部品 |\n|---|---|\n");
  const r = run(root);
  expect(r.stdout).toMatch(/新規（比較元 HEAD に無い）: \.replace\/components\.md/);
  expect(r.status).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test("リポジトリの一階層下を --root に渡しても突き合わせが成立する", () => {
  // ls-tree の既定は cwd 相対、`git show <rev>:<path>` はトップレベル起点。揃えないと全件が
  // 「比較元に無い＝新規」に化け、行を消しても「比較元に在る成果物が 0 件」で落ちる（原因が別物に見える）。
  const repo = mkdtempSync(join(tmpdir(), "append-only-subdir-"));
  mkdirSync(join(repo, "app/.replace/parity/order-list"), { recursive: true });
  writeFileSync(join(repo, "README.md"), "x\n");
  writeFileSync(join(repo, "app/.replace/features.md"), FEATURES);
  writeFileSync(join(repo, "app/.replace/parity/order-list/gaps.md"), GAPS);
  for (const args of [
    ["init", "-q", "."],
    ["config", "user.email", "test@example.com"],
    ["config", "user.name", "test"],
    ["add", "-A"],
    ["commit", "-qm", "seed"],
  ]) {
    const r = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  }
  const root = join(repo, "app");

  // 陽性コントロール: 追記だけなら通る（「常に落とす」実装と区別する）。
  appendFileSync(join(root, ".replace/features.md"), "| order-detail | 注文詳細 | 未 |\n");
  const ok = run(root);
  expect(ok.stdout).toMatch(/比較元にも在る 2 件を突き合わせた/);
  expect(ok.status).toBe(0);

  // 行を消せば落ちる（突き合わせが実際に成立している）。
  writeFileSync(
    join(root, ".replace/features.md"),
    FEATURES.replace("| order-edit | 注文編集 | 未 |\n", ""),
  );
  const ng = run(root);
  expect(ng.stdout).toMatch(/1 行が失われている/);
  expect(ng.stdout).toMatch(/order-edit/);
  expect(ng.status).toBe(1);
  rmSync(repo, { recursive: true, force: true });
});

test("比較元に在る追記専用の成果物が 0 件なら合格に倒さない（突き合わせが成立していない）", () => {
  const root = mkdtempSync(join(tmpdir(), "append-only-uncommitted-"));
  writeFileSync(join(root, "README.md"), "x\n");
  for (const args of [
    ["init", "-q", "."],
    ["config", "user.email", "test@example.com"],
    ["config", "user.name", "test"],
    ["add", "README.md"],
    ["commit", "-qm", "init"],
  ]) {
    spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  }
  // 成果物は作業ツリーにあるが 1 度もコミットされていない（比較元 HEAD に無い）。
  mkdirSync(join(root, ".replace"), { recursive: true });
  writeFileSync(join(root, ".replace/features.md"), FEATURES);
  const r = run(root);
  expect(r.stdout).toMatch(/比較元 HEAD に在る追記専用の成果物が 0 件/);
  expect(r.status).toBe(1);
  rmSync(root, { recursive: true, force: true });
});
