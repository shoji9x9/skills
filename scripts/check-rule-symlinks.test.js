// rule の多エージェント配線（.agents/rules → .claude/rules / .github/instructions）検査の回帰テスト。
//
// 状態空間の軸（判定に使う全入力）と、各セルに置いた入力:
//
// | 軸                   | 値                                                              |
// | -------------------- | --------------------------------------------------------------- |
// | 正本ディレクトリ     | 存在（N 件） / 存在（0 件） / 不在                               |
// | 配線ディレクトリ     | 存在 / 不在                                                      |
// | 配線エントリ         | 正しい symlink / 欠落 / 実ファイル / 誤った指し先 / 壊れた symlink |
// | 逆向き（配線→正本）  | 対応あり / 孤児 / 命名規則外                                     |
// | 配線先               | .claude/rules / .github/instructions（両方が独立に評価される）   |
//
// 陰性コントロール（通さねばならない入力）＝ 正しく配線された rule 群が violations 0 件になること。
// 実リポジトリ自身も陰性コントロールとして 1 件置く（合成 fixture だけだと、現実の配線形と
// 検査の期待形がずれていても緑のまま通る）。
import { test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CANON_DIR, WIRINGS, checkRuleSymlinks } from "./check-rule-symlinks.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repoRoot, "scripts/check-rule-symlinks.js");

/** 正しく配線された rule を持つ一時リポジトリを作る。 */
function makeRepo(names = ["alpha", "beta"], { wire = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "rule-symlinks-"));
  mkdirSync(join(root, CANON_DIR), { recursive: true });
  for (const { dir } of WIRINGS) mkdirSync(join(root, dir), { recursive: true });
  for (const name of names) {
    writeFileSync(
      join(root, CANON_DIR, `${name}.md`),
      `---\npaths:\n  - "x/**"\n---\n\n# ${name}\n`,
    );
    if (!wire) continue;
    for (const { dir, suffix } of WIRINGS) {
      symlinkSync(relTarget(dir, name), join(root, dir, `${name}${suffix}`));
    }
  }
  return root;
}

// 配線ディレクトリ（2 階層）から見た正本への相対パス。
const relTarget = (dir, name) => `../../${CANON_DIR}/${name}.md`;

const cleanup = (root) => rmSync(root, { recursive: true, force: true });

test("陰性コントロール: 正しく配線された rule は違反 0 件・走査件数が正本の件数と一致", () => {
  const root = makeRepo(["alpha", "beta", "gamma"]);
  const { rules, violations } = checkRuleSymlinks(root);
  expect(violations).toEqual([]);
  expect(rules).toHaveLength(3);
  cleanup(root);
});

test("陰性コントロール: 実リポジトリの配線が違反 0 件", () => {
  const { rules, violations } = checkRuleSymlinks(repoRoot);
  expect(violations).toEqual([]);
  expect(rules.length).toBeGreaterThan(0);
});

test("欠落: 配線 symlink を作っていない rule を両エージェントぶん検出する", () => {
  const root = makeRepo(["alpha"], { wire: false });
  const { violations } = checkRuleSymlinks(root);
  expect(violations).toHaveLength(2);
  expect(violations.some((v) => v.startsWith(".claude/rules/alpha.md: 欠落"))).toBe(true);
  expect(
    violations.some((v) => v.startsWith(".github/instructions/alpha.instructions.md: 欠落")),
  ).toBe(true);
  cleanup(root);
});

test("実ファイル: symlink ではなく実体のコピーを置いたら検出する", () => {
  const root = makeRepo(["alpha"], { wire: false });
  writeFileSync(join(root, ".claude/rules/alpha.md"), "# コピー\n");
  symlinkSync(
    relTarget(".github/instructions", "alpha"),
    join(root, ".github/instructions/alpha.instructions.md"),
  );
  const { violations } = checkRuleSymlinks(root);
  expect(violations).toEqual([
    ".claude/rules/alpha.md: symlink ではない（実体のコピーは正本と drift する）",
  ]);
  cleanup(root);
});

test("誤った指し先: 別の rule を指す symlink を検出する", () => {
  const root = makeRepo(["alpha", "beta"]);
  rmSync(join(root, ".claude/rules/alpha.md"));
  symlinkSync(relTarget(".claude/rules", "beta"), join(root, ".claude/rules/alpha.md"));
  const { violations } = checkRuleSymlinks(root);
  expect(violations).toHaveLength(1);
  expect(violations[0]).toMatch(/^\.claude\/rules\/alpha\.md: 指し先が違う/);
  cleanup(root);
});

test("壊れた symlink: 指し先の正本が消えていたら検出する（欠落として現れる）", () => {
  const root = makeRepo(["alpha"]);
  // 正本を消すと、配線は「対応する正本が無い孤児」になる（期待集合は宣言＝正本から作るため）。
  rmSync(join(root, CANON_DIR, "alpha.md"));
  const { rules, violations } = checkRuleSymlinks(root);
  expect(rules).toEqual([]);
  expect(violations.some((v) => v.includes("孤児"))).toBe(true);
  cleanup(root);
});

test("孤児: 正本の無い配線 symlink を検出する", () => {
  const root = makeRepo(["alpha"]);
  symlinkSync(relTarget(".claude/rules", "ghost"), join(root, ".claude/rules/ghost.md"));
  const { violations } = checkRuleSymlinks(root);
  expect(violations).toEqual([
    `.claude/rules/ghost.md: 対応する正本 ${CANON_DIR}/ghost.md が無い（孤児）`,
  ]);
  cleanup(root);
});

test("命名規則外: suffix に合わない名前を検出する", () => {
  const root = makeRepo(["alpha"]);
  writeFileSync(join(root, ".github/instructions/README.txt"), "x\n");
  const { violations } = checkRuleSymlinks(root);
  expect(violations).toEqual([
    ".github/instructions/README.txt: 命名規則（<name>.instructions.md）に合わない",
  ]);
  cleanup(root);
});

test("配線ディレクトリが不在なら、走査を飛ばさず違反として報告する", () => {
  const root = makeRepo(["alpha"]);
  rmSync(join(root, ".claude/rules"), { recursive: true });
  const { violations } = checkRuleSymlinks(root);
  expect(violations).toHaveLength(1);
  expect(violations[0]).toMatch(/配線ディレクトリが無い（Claude Code/);
  cleanup(root);
});

test("正本ディレクトリが不在なら違反として報告し、走査件数は 0 件", () => {
  const root = mkdtempSync(join(tmpdir(), "rule-symlinks-"));
  const { rules, violations } = checkRuleSymlinks(root);
  expect(rules).toEqual([]);
  expect(violations).toHaveLength(1);
  expect(violations[0]).toMatch(/正本ディレクトリが無い/);
  cleanup(root);
});

test("CLI: 対象 0 件は成功に倒さず exit 1", () => {
  const root = mkdtempSync(join(tmpdir(), "rule-symlinks-"));
  mkdirSync(join(root, CANON_DIR), { recursive: true });
  for (const { dir } of WIRINGS) mkdirSync(join(root, dir), { recursive: true });
  const r = spawnSync(process.execPath, [script, root], { encoding: "utf8" });
  expect(r.status).toBe(1);
  expect(r.stderr).toMatch(/走査した rule が 0 件/);
  cleanup(root);
});

test("CLI: 違反があれば exit 1、無ければ exit 0 で走査件数を出す", () => {
  const ok = makeRepo(["alpha", "beta"]);
  const good = spawnSync(process.execPath, [script, ok], { encoding: "utf8" });
  expect(good.status).toBe(0);
  expect(good.stdout).toMatch(/rule-symlinks: OK（2 件）/);
  expect(good.stdout).toContain(join(ok, CANON_DIR, "alpha.md"));
  cleanup(ok);

  const bad = makeRepo(["alpha"], { wire: false });
  const r = spawnSync(process.execPath, [script, bad], { encoding: "utf8" });
  expect(r.status).toBe(1);
  expect(r.stderr).toMatch(/2 件の配線不備/);
  cleanup(bad);
});
