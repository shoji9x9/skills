#!/usr/bin/env node
// AGENTS.md のサイズをチェックする（lefthook pre-commit + CI）。
//
// なぜ要るか: Codex は AGENTS.md を `project_doc_max_bytes`（デフォルトは 32 KiB）までしか読まず、超えた分を切り捨てる
// （openai/codex の codex-rs/core/src/agents_md.rs）。切り捨てられても警告はログに出るだけなので、気づかないまま
// 後半の規約が届かなくなる。そこで、32 KiB を超えたら失敗にする。
// AGENTS.md が無い・読めないときは判定できないので exit 2、サイズの違反は exit 1。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { errorMessage } from "../../../lib/errors.ts";

const TARGET_PATH = "AGENTS.md";
/** Codex の `project_doc_max_bytes` のデフォルト。 */
export const LIMIT_BYTES = 32 * 1024;

export function main(argv: string[]) {
  const root = argv.find((a) => a !== "--") ?? process.cwd();
  let size: number;
  try {
    size = readFileSync(join(root, TARGET_PATH)).length;
  } catch (error) {
    console.error(
      `agents-md-size: 判定できない: ${TARGET_PATH} を読めない: ${errorMessage(error)}`,
    );
    return 2;
  }
  if (size > LIMIT_BYTES) {
    console.error(
      `agents-md-size: ${TARGET_PATH} は ${size} バイトで、Codex が読む上限の ${LIMIT_BYTES} バイトを超えている。` +
        "詳細は docs/ へ移し、AGENTS.md には常に必要な要点だけを残す（.agents/rules/doc-altitude.md）。",
    );
    return 1;
  }
  console.log(
    `agents-md-size: OK（${TARGET_PATH} は ${size} バイト、上限は ${LIMIT_BYTES} バイト）`,
  );
  return 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
