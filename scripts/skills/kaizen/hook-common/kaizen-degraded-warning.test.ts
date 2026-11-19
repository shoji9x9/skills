// kaizen 同梱スクリプトが共通ライブラリを読めないとき、機能を減らして動くことを stderr に残すかの回帰テスト。
//
// なぜ要るか: 修正の裏取りでスクリプトを 1 本だけ scratchpad へコピーして実行すると、
// 相対パスで読む `kaizen-hook-common.sh` が見つからず、**警告なしに機能を減らして動く**。
// 終了コードも出力も本番構成と同じに見えるため、**検証対象が別物へすり替わったまま**
// 「直った」と判断してしまう。機能を減らした run と本番構成の run を、出力で区別できるようにする。
//
// 状態空間の軸:
//
// | 軸           | 値                                                       |
// | ------------ | -------------------------------------------------------- |
// | ライブラリ   | 同じディレクトリにある（本番構成） / 無い（機能を減らす）|
// | 対象スクリプト | 共通ライブラリを読む同梱スクリプト全部（列挙は実測から） |
//
// 誤検知しないことの確認: 本番構成（原本の場所）で実行したとき、この警告が出ないこと。
//
// スクリプトは、cwd の git のルートか CLAUDE_PROJECT_DIR を作業の対象にする。引数なしの kaizen-extract-done.sh は
// kaizen-forget.sh --auto を呼び、古い学びを forgotten に書き換える（Issue #1075）。
// そのため、どちらのテストも使い捨ての git のリポジトリを cwd にし、CLAUDE_PROJECT_DIR もそのリポジトリにして起動する。
// エージェントの Hook から起動すると、このプロセスの CLAUDE_PROJECT_DIR は実リポジトリを指す。
// run の環境の組み立てを変異させた実行でも実リポジトリに届かないよう、このファイルの間は CLAUDE_PROJECT_DIR を外しておく。
import { afterAll, beforeAll, test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir } from "../../../lib/testing/test-tmpdir.ts";
import { CHILD_TIMEOUT_MS } from "../../../lib/testing/child-timeout.ts";
import { gitInit } from "../../../lib/testing/repo-file.ts";
import { kaizenEnv } from "../kaizen-config-env.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const scriptsDir = join(repoRoot, "skills/kaizen/scripts");

// 対象は「共通ライブラリを読むスクリプト」。一覧は宣言（ソースの実体）から機械的に作る。
// 手で並べると、後から追加されたスクリプトが警告なしに対象外になる。
const LIB = "kaizen-hook-common.sh";
const targets = readdirSync(scriptsDir)
  .filter((f) => f.endsWith(".sh") && f !== LIB)
  .filter((f) => readFileSync(join(scriptsDir, f), "utf8").includes("kaizen_lib="))
  .sort();

// ライブラリ読み込みより手前に早期 exit を持つスクリプトは、そこを越える起動条件を宣言する
// （引数不足の usage・commit を含まない入力の prefilter）。既定は「引数なし・空 stdin」。
const INVOCATION: Record<string, { args?: string[]; input?: string }> = {
  "kaizen-kedb-match.sh": { args: ["alpha", "beta"] },
  "kaizen-precommit-gate.sh": {
    input: JSON.stringify({ tool_input: { command: "git commit -m x" } }),
  },
};

/**
 * 実リポジトリの .kaizen/ の直下の学び（*.md）の名前と中身から作る指紋。
 * 目印のファイル（.pending-extract など）は、テストの間にエージェントの Hook が書き換えるので含めない。
 */
function kaizenDigest(): string {
  const dir = join(repoRoot, ".kaizen");
  if (!existsSync(dir)) return "";
  const h = createHash("sha256");
  for (const f of readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => e.name)
    .sort()) {
    h.update(f)
      .update("\0")
      .update(readFileSync(join(dir, f)))
      .update("\0");
  }
  return h.digest("hex");
}
const kaizenBefore = kaizenDigest();

const inheritedProjectDir = process.env.CLAUDE_PROJECT_DIR;
beforeAll(() => {
  delete process.env.CLAUDE_PROJECT_DIR;
});
afterAll(() => {
  if (inheritedProjectDir !== undefined) process.env.CLAUDE_PROJECT_DIR = inheritedProjectDir;
});

/** 使い捨ての git のリポジトリを作り、スクリプトがその外を作業の対象にしない環境で起動する。 */
function run(script: string, cwd: string) {
  gitInit(cwd);
  const { args = [], input = "" } = INVOCATION[basename(script)] ?? {};
  // 手元の kaizen の設定（~/.config の kaizen.jsonc・KAIZEN_*）も外す。forget_auto などが結果を変えるため。
  const env = kaizenEnv(cwd, { CLAUDE_PROJECT_DIR: cwd });
  return spawnSync("bash", [script, ...args], {
    timeout: CHILD_TIMEOUT_MS,
    cwd,
    env,
    encoding: "utf8",
    // 入力待ちで止まらないよう stdin を閉じる。
    input,
  });
}

test("対象スクリプトを検出できている（0 件を成功として扱わない）", () => {
  expect(targets.length).toBeGreaterThan(5);
});

test("起動条件の宣言は実在するスクリプトだけを指す（孤児の宣言を残さない）", () => {
  for (const name of Object.keys(INVOCATION)) expect(targets).toContain(name);
});

test.each(targets)(
  "%s: ライブラリが無い場所で実行すると、機能を減らして動いたことを stderr に残す",
  (name) => {
    const dir = makeTempDir("kaizen-degraded-");
    copyFileSync(join(scriptsDir, name), join(dir, name));
    const r = run(name, dir);
    expect(r.stderr).toMatch(
      new RegExp(`${name}: 共通ライブラリを読めないため、機能を減らして動きます`),
    );
  },
);

test.each(targets)(
  "%s: 本番構成では機能を減らした旨の警告を出さない（誤検知しないことの確認）",
  (name) => {
    const r = run(join(scriptsDir, name), makeTempDir("kaizen-production-"));
    expect(r.stderr).not.toMatch(/共通ライブラリを読めないため、機能を減らして動きます/);
  },
);

// 古い pending の学び（30 日を過ぎた priority: low）。kaizen-forget.sh --auto が forgotten に書き換える。
const STALE_NOTE =
  "---\ndate: 2026-01-01\ntype: doc\npriority: low\nstatus: pending\n---\n\n# 古い学び\n";

function writeStaleNote(root: string): string {
  const path = join(root, ".kaizen", "2026-01-01-stale.md");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, STALE_NOTE);
  return path;
}

test("起動したスクリプトは cwd の使い捨てのリポジトリだけを書き換え、CLAUDE_PROJECT_DIR のプロジェクトを書き換えない", () => {
  // エージェントの Hook から起動したテストでは、このプロセスの CLAUDE_PROJECT_DIR が実リポジトリを指す。
  // その状態を別のプロジェクトで作り、run が子に渡す値を cwd に置き換えることを確かめる。
  const outer = makeTempDir("kaizen-outer-");
  gitInit(outer);
  const outerNote = writeStaleNote(outer);
  const cwd = makeTempDir("kaizen-cwd-");
  const cwdNote = writeStaleNote(cwd);
  process.env.CLAUDE_PROJECT_DIR = outer;
  try {
    run(join(scriptsDir, "kaizen-extract-done.sh"), cwd);
  } finally {
    delete process.env.CLAUDE_PROJECT_DIR;
  }
  // cwd の学びが書き換わることで、スクリプトが忘却まで進んだことを確かめる（進まなければ外側の確認は何も示さない）。
  expect(readFileSync(cwdNote, "utf8")).toMatch(/^status: forgotten$/m);
  expect(readFileSync(outerNote, "utf8")).toBe(STALE_NOTE);
});

test("実リポジトリの .kaizen/ を書き換えない（Issue #1075）", () => {
  expect(kaizenDigest()).toBe(kaizenBefore);
});
