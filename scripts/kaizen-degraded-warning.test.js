// kaizen 同梱スクリプトが共通ライブラリを読めないとき、縮退を stderr に残すことの回帰テスト。
//
// なぜ要るか: 修正の裏取りでスクリプトを 1 本だけ scratchpad へコピーして実行すると、
// 相対パスで読む `kaizen-hook-common.sh` が見つからず**無言で縮退**する。
// 終了コードも出力も本番構成と同じに見えるため、**検証対象が別物へすり替わったまま**
// 「直った」と判断してしまう。縮退した run と本番構成の run を出力で区別できるようにする。
//
// 状態空間の軸:
//
// | 軸           | 値                                                       |
// | ------------ | -------------------------------------------------------- |
// | ライブラリ   | 同じディレクトリにある（本番構成） / 無い（縮退）        |
// | 対象スクリプト | 共通ライブラリを読む同梱スクリプト全部（列挙は実測から） |
//
// 陰性コントロール: 本番構成（正本の場所）で実行したとき、この警告が出ないこと。
import { test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { copyFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir } from "./lib/test-tmpdir.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const scriptsDir = join(repoRoot, "skills/kaizen/scripts");

// 対象は「共通ライブラリを読むスクリプト」。一覧は宣言（ソースの実体）から機械的に作る——
// 手で並べると、後から追加されたスクリプトが黙って対象外になる。
const LIB = "kaizen-hook-common.sh";
const targets = readdirSync(scriptsDir)
  .filter((f) => f.endsWith(".sh") && f !== LIB)
  .filter((f) => readFileSync(join(scriptsDir, f), "utf8").includes("kaizen_lib="))
  .sort();

// ライブラリ読み込みより手前に早期 exit を持つスクリプトは、そこを越える起動条件を宣言する
// （引数不足の usage・commit を含まない入力の prefilter）。既定は「引数なし・空 stdin」。
const INVOCATION = {
  "kaizen-kedb-match.sh": { args: ["alpha", "beta"] },
  "kaizen-precommit-gate.sh": {
    input: JSON.stringify({ tool_input: { command: "git commit -m x" } }),
  },
};

test("対象スクリプトを検出できている（0 件を成功に倒さない）", () => {
  expect(targets.length).toBeGreaterThan(5);
});

test("起動条件の宣言は実在するスクリプトだけを指す（孤児の宣言を残さない）", () => {
  for (const name of Object.keys(INVOCATION)) expect(targets).toContain(name);
});

test.each(targets)("%s: ライブラリが無い場所で実行すると縮退を stderr に残す", (name) => {
  const dir = makeTempDir("kaizen-degraded-");
  copyFileSync(join(scriptsDir, name), join(dir, name));
  // 入力待ちで止まらないよう stdin を閉じ、引数なしで起動する。
  const { args = [], input = "" } = INVOCATION[name] ?? {};
  const r = spawnSync("bash", [name, ...args], { cwd: dir, encoding: "utf8", input });
  expect(r.stderr).toMatch(new RegExp(`${name}: 共通ライブラリを読めないため縮退します`));
  rmSync(dir, { recursive: true, force: true });
});

test.each(targets)("%s: 本番構成では縮退の警告を出さない（陰性コントロール）", (name) => {
  const { args = [], input = "" } = INVOCATION[name] ?? {};
  const r = spawnSync("bash", [join(scriptsDir, name), ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    input,
  });
  expect(r.stderr).not.toMatch(/共通ライブラリを読めないため縮退します/);
});
