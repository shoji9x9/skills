#!/usr/bin/env node
// AGENTS.md のサイズをチェックする（lefthook pre-commit + CI）。
//
// なぜ要るか: Codex は AGENTS.md を `project_doc_max_bytes`（デフォルトは 32 KiB）までしか読まず、超えた分を切り捨てる
// （openai/codex の codex-rs/core/src/agents_md.rs）。切り捨てられても警告はログに出るだけなので、気づかないまま
// 後半の規約が届かなくなる。上限の手前で止めるため、30 KiB（limit_bytes）を超えたら縮めさせる。
// 超えるたびに少しずつ削ると上限の近くに張り付くので、一度超えたら 24 KiB（target_bytes）以下まで縮めることを求める。
//
// 「一度超えた」は git の履歴で判定する。状態をファイルに記録すると、commit されない限り手元の作業ツリーにしか残らず、
// restore・別の clone・hook の無い環境で消える。履歴なら pre-commit と CI が同じ事実を読める。
//
// 判定規則（範囲は base との分岐点より後の commit。サイズは各 commit の AGENTS.md のバイト数）:
// - pre-commit（`--pre-commit`）: 測るのは index の AGENTS.md。
//   - 範囲に limit 超の commit がなく、index だけが limit を超える: 初めて超えた commit なので、警告して通す
//     （履歴に残して、以降の commit と CI に「一度超えた」ことを伝えるため）。
//   - 範囲に limit 超の commit があり、index が target を超える: 失敗する。
// - CI（`--pre-commit` なし）: 測るのは HEAD の AGENTS.md。
//   - HEAD が limit を超える、または範囲に limit 超の commit があって HEAD が target を超える: 失敗する。
// - 設定が読めない・base を解決できない・AGENTS.md が無いときは exit 2、サイズの違反は exit 1。
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const CONFIG_PATH = "scripts/gates/agents-md-size.json";
export const TARGET_PATH = "AGENTS.md";

/** 設定を読み、形の誤りは例外にする。 */
export function loadConfig(root) {
  const path = join(root, CONFIG_PATH);
  if (!existsSync(path)) throw new Error(`${CONFIG_PATH} が無い`);
  const { limit_bytes: limit, target_bytes: target } = JSON.parse(readFileSync(path, "utf8")) ?? {};
  if (!Number.isInteger(limit) || !Number.isInteger(target) || target <= 0 || target >= limit) {
    throw new Error("limit_bytes と target_bytes は 0 < target_bytes < limit_bytes の整数にする");
  }
  return { limit, target };
}

const git = (root, args) =>
  execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

/** `<rev>:AGENTS.md` のバイト数。rev が空文字なら index。無ければ null。 */
function sizeAt(root, rev) {
  try {
    return Number.parseInt(git(root, ["cat-file", "-s", `${rev}:${TARGET_PATH}`]), 10);
  } catch {
    return null;
  }
}

/** base との分岐点より後の commit（HEAD を含む）。 */
export function rangeCommits(root, base) {
  let mergeBase;
  try {
    mergeBase = git(root, ["merge-base", base, "HEAD"]);
  } catch {
    throw new Error(`base「${base}」と HEAD の分岐点を求められない（base が無いか、履歴が浅い）`);
  }
  const out = git(root, ["rev-list", `${mergeBase}..HEAD`]);
  return out ? out.split("\n") : [];
}

/**
 * @param {string} root リポジトリルート（テストでは一時ディレクトリ）
 * @param {{ base: string, preCommit?: boolean }} options
 * @returns {{ ok: boolean, size: number, exceeded: boolean, warning: string, reason: string }}
 */
export function checkAgentsMdSize(root, { base, preCommit = false }) {
  const { limit, target } = loadConfig(root);
  const size = sizeAt(root, preCommit ? "" : "HEAD");
  if (size === null) throw new Error(`${preCommit ? "index" : "HEAD"} に ${TARGET_PATH} が無い`);
  const exceeded = rangeCommits(root, base).some((c) => (sizeAt(root, c) ?? 0) > limit);

  if (preCommit && !exceeded && size > limit) {
    return {
      ok: true,
      size,
      exceeded: true,
      warning: `${limit} バイトを超えた。次の commit からは ${target} バイト以下まで縮めないと失敗する`,
      reason: "",
    };
  }
  if (size > limit || (exceeded && size > target)) {
    const why = exceeded
      ? `このブランチで ${limit} バイトを超えたので、${target} バイト以下まで縮める`
      : `${limit} バイトを超えた。${target} バイト以下まで縮める`;
    return { ok: false, size, exceeded, warning: "", reason: why };
  }
  return { ok: true, size, exceeded, warning: "", reason: "" };
}

export function main(argv) {
  const args = argv.filter((a) => a !== "--");
  const preCommit = args.includes("--pre-commit");
  const baseIndex = args.indexOf("--base");
  const base = baseIndex >= 0 ? args[baseIndex + 1] : undefined;
  const root =
    args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--base") ?? process.cwd();
  if (!base) {
    console.error(
      "agents-md-size: --base <ref> を指定する（分岐点を求める base。例: origin/main）",
    );
    return 2;
  }
  let result;
  try {
    result = checkAgentsMdSize(root, { base, preCommit });
  } catch (error) {
    console.error(`agents-md-size: 判定できない: ${error.message}`);
    return 2;
  }
  const { ok, size, warning, reason } = result;
  if (!ok) {
    console.error(
      `agents-md-size: ${TARGET_PATH} は ${size} バイト。${reason}。` +
        "詳細は docs/ へ移し、AGENTS.md には常に必要な要点だけを残す（.agents/rules/doc-altitude.md）。",
    );
    return 1;
  }
  if (warning)
    console.error(`agents-md-size: 警告: ${TARGET_PATH} は ${size} バイト。${warning}。`);
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
