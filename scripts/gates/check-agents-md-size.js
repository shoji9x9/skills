#!/usr/bin/env node
// AGENTS.md のサイズをチェックする（lefthook pre-commit + CI）。
//
// なぜ要るか: Codex は AGENTS.md を `project_doc_max_bytes`（デフォルトは 32 KiB）までしか読まず、超えた分を切り捨てる
// （openai/codex の codex-rs/core/src/agents_md.rs）。切り捨てられても警告はログに出るだけなので、気づかないまま
// 後半の規約が届かなくなる。上限の手前で止めるため、30 KiB を超えたら失敗させる。
// 超えるたびに少しずつ削ると上限の近くに張り付くので、一度超えたら 24 KiB 以下まで縮めることを求める。
//
// 判定規則:
// - サイズは index にある AGENTS.md のバイト数（`git cat-file -s :AGENTS.md`）。commit される内容を測る。
// - 状態は `scripts/gates/agents-md-size.json` の `shrinking` に記録する。
//   - `shrinking` が false のとき、`limit_bytes` を超えたら失敗する。
//   - `shrinking` が true のとき、`target_bytes` を超えたら失敗する。
// - `--record`（pre-commit）を付けると、状態を書き換えて stage する。
//   `limit_bytes` を超えたら true にし、true のまま `target_bytes` 以下になったら false に戻す。
//   付けないとき（CI）は書き換えず、true のまま `target_bytes` 以下なら、戻した記録を commit するよう求めて失敗する。
// - 状態のファイルが読めない・値が不正・AGENTS.md が index に無いときは exit 2、サイズや記録の違反は exit 1。
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const STATE_PATH = "scripts/gates/agents-md-size.json";
export const TARGET_PATH = "AGENTS.md";

/** 状態を読み、形の誤りは例外にする（読めない状態を「縮小中でない」として扱わない）。 */
export function loadState(root) {
  const path = join(root, STATE_PATH);
  if (!existsSync(path)) throw new Error(`${STATE_PATH} が無い`);
  const data = JSON.parse(readFileSync(path, "utf8"));
  const { limit_bytes: limit, target_bytes: target, shrinking } = data ?? {};
  if (!Number.isInteger(limit) || !Number.isInteger(target) || target <= 0 || target >= limit) {
    throw new Error("limit_bytes と target_bytes は 0 < target_bytes < limit_bytes の整数にする");
  }
  if (typeof shrinking !== "boolean") throw new Error("shrinking は true か false にする");
  return data;
}

/** index にある AGENTS.md のバイト数。 */
export function stagedSize(root) {
  try {
    const out = execFileSync("git", ["cat-file", "-s", `:${TARGET_PATH}`], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return Number.parseInt(out.trim(), 10);
  } catch {
    throw new Error(`index に ${TARGET_PATH} が無い`);
  }
}

function saveState(root, state) {
  writeFileSync(join(root, STATE_PATH), `${JSON.stringify(state, null, 2)}\n`);
  execFileSync("git", ["add", "--", STATE_PATH], { cwd: root });
}

/**
 * @param {string} root リポジトリルート（テストでは一時ディレクトリ）
 * @param {{ record?: boolean }} options record が true なら状態を書き換えて stage する（pre-commit）
 * @returns {{ ok: boolean, size: number, shrinking: boolean, reason: string }}
 */
export function checkAgentsMdSize(root, { record = false } = {}) {
  const state = loadState(root);
  const size = stagedSize(root);
  const { limit_bytes: limit, target_bytes: target } = state;
  let { shrinking } = state;

  if (!shrinking && size > limit) {
    if (record) saveState(root, { ...state, shrinking: true });
    return {
      ok: false,
      size,
      shrinking: true,
      reason: `${limit} バイトを超えた。${target} バイト以下まで縮める`,
    };
  }
  if (shrinking && size > target) {
    return {
      ok: false,
      size,
      shrinking,
      reason: `縮小中。${target} バイト以下まで縮める`,
    };
  }
  if (shrinking) {
    if (!record) {
      return {
        ok: false,
        size,
        shrinking,
        reason: `${target} バイト以下になったが、${STATE_PATH} の shrinking が true のまま commit されている。手元で node scripts/gates/check-agents-md-size.js --record を実行して commit する`,
      };
    }
    saveState(root, { ...state, shrinking: false });
    shrinking = false;
  }
  return { ok: true, size, shrinking, reason: "" };
}

export function main(argv) {
  const args = argv.filter((a) => a !== "--");
  const record = args.includes("--record");
  const root = args.find((a) => a !== "--record") ?? process.cwd();
  let result;
  try {
    result = checkAgentsMdSize(root, { record });
  } catch (error) {
    console.error(`agents-md-size: 判定できない: ${error.message}`);
    return 2;
  }
  const { ok, size, reason } = result;
  if (!ok) {
    console.error(
      `agents-md-size: ${TARGET_PATH} は ${size} バイト。${reason}。` +
        "詳細は docs/ へ移し、AGENTS.md には常に必要な要点だけを残す（.agents/rules/doc-altitude.md）。",
    );
    return 1;
  }
  console.log(`agents-md-size: OK（${TARGET_PATH} は ${size} バイト）`);
  return 0;
}

// CLI エントリ判定は両辺を実パスへ揃える（片側だけの解決は symlink 経由の起動で何もせずに終わる）。
function isCliEntry() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch (error) {
    console.error(`agents-md-size: 起動パスを正規化できない: ${error.message}`);
    process.exit(1);
  }
}

if (isCliEntry()) process.exit(main(process.argv.slice(2)));
