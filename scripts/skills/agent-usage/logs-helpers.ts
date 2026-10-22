// logs.test.ts のヘルパー。
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseClaudeSession } from "../../../skills/agent-usage/scripts/lib/sources/claude-log.mjs";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";

export const T = (min: number) => `2026-10-01T00:${String(min).padStart(2, "0")}:00.000Z`;
// 60 分以上は T の書式に収まらないので、0 分からの経過で求める
export const ms = (min: number) => Date.parse(T(0)) + min * 60000;
export const jsonl = (rows: object[]) => rows.map((r) => JSON.stringify(r)).join("\n");

export const human = (min: number, text = "やって") => ({
  type: "user",
  timestamp: T(min),
  origin: { kind: "human" },
  message: { role: "user", content: text },
});
export const assistant = (
  min: number,
  id: string,
  { usage, content = [] }: { usage: object; content?: object[] },
) => ({
  type: "assistant",
  timestamp: T(min),
  message: { id, model: "claude-opus-5-5", usage, content },
});
export const turnEnd = (min: number) => ({
  type: "system",
  subtype: "turn_duration",
  timestamp: T(min),
});

/** ログをファイルに書き、他のモジュールが使う parseClaudeSession で読む。sub はサブエージェントのファイル。 */
export function parseClaude(main: string | object[] | null, sub: object[][] = []) {
  const dir = makeTempDir("agent-usage-claude-log-");
  let mainPath: string | null = null;
  if (main !== null) {
    mainPath = join(dir, "s1.jsonl");
    writeFileSync(mainPath, typeof main === "string" ? main : jsonl(main));
  }
  const subPaths = sub.map((rows, i) => {
    const path = join(dir, `agent-${i}.jsonl`);
    writeFileSync(path, jsonl(rows));
    return path;
  });
  return parseClaudeSession("s1", mainPath, subPaths);
}
