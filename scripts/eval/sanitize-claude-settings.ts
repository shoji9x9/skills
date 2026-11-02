// eval のサンドボックスに渡す ~/.claude/settings.json のコピーを作る。
// 元のファイルには、利用者の hooks・権限・autoMode の環境の説明（リポジトリの場所や .kaizen/ のノート名）が入る。
// そのまま読ませると、without_skill の run がそれを読んで答えに使う。
// API に接続するのに要るキー（モデル・認証・接続先の環境変数）だけを許可リストで残し、他は捨てる。
// 許可リストにしているので、元のファイルに新しいキーが増えても、コピーには入らない。
import { readFileSync, writeFileSync } from "node:fs";
import { isRecord } from "../lib/guards.ts";
import { errorMessage } from "../lib/errors.ts";
import { isCliEntry } from "../lib/cli/entry.ts";

const KEPT_KEYS = ["model", "apiKeyHelper", "awsAuthRefresh", "awsCredentialExport"];
const KEPT_ENV_PREFIXES = ["ANTHROPIC_", "CLAUDE_CODE_", "AWS_", "VERTEX_", "CLOUD_ML_"];

/** 許可リストのキーだけを残した設定を返す。元が JSON のオブジェクトでなければ例外にする。 */
export function sanitizeClaudeSettings(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text);
  if (!isRecord(value)) throw new Error("settings.json がオブジェクトでない");
  const kept: Record<string, unknown> = {};
  for (const key of KEPT_KEYS) {
    if (key in value) kept[key] = value[key];
  }
  const env = value.env;
  if (env !== undefined) {
    if (!isRecord(env)) throw new Error("settings.json の env がオブジェクトでない");
    const keptEnv = Object.fromEntries(
      Object.entries(env).filter(([name]) => KEPT_ENV_PREFIXES.some((p) => name.startsWith(p))),
    );
    if (Object.keys(keptEnv).length > 0) kept.env = keptEnv;
  }
  return kept;
}

function main() {
  const [source, target] = process.argv.slice(2);
  if (!source || !target) throw new Error("usage: sanitize-claude-settings.ts <source> <target>");
  const kept = sanitizeClaudeSettings(readFileSync(source, "utf8"));
  writeFileSync(target, `${JSON.stringify(kept, null, 2)}\n`);
}

if (isCliEntry(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`sanitize-claude-settings: ${errorMessage(error)}`);
    process.exitCode = 1;
  }
}
