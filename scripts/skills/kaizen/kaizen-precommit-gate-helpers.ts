// kaizen-precommit-gate.test.ts のヘルパー。
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDirFactory } from "../../lib/testing/test-tmpdir.ts";
import { spawnAsync } from "../../lib/spawn-async.ts";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";
import { kaizenEnv, writeKaizenConfig } from "./kaizen-config-env.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const scriptsDir = join(repoRoot, "skills", "kaizen", "scripts");
export const fixturesDir = join(repoRoot, "evals", "kaizen", "fixtures", "candidate-scan");

// **テストは `describe.concurrent` で並べて実行する**（Issue #590）。どのテストもチェックの子プロセスの終了を待つだけなので、
// 並べた分だけ 1 回の実行が縮み、ミューテーションテストでは変異の数だけ反映される。
// そのため、テストの間で状態を共有しない。プロジェクトとスクリプトの複製は、テストごとに別の一時ディレクトリに作る（`tempDir`）。
export const tempDir = makeTempDirFactory("kaizen-gate-");

/** .kaizen/ を持つ空プロジェクトを作る。CLAUDE_PROJECT_DIR を渡すので git 管理下でなくてよい。 */
export function makeProject() {
  const dir = tempDir("kaizen-gate-");
  mkdirSync(join(dir, ".kaizen"));
  return dir;
}

export type RunOptions = {
  cwd?: string;
  transcriptPath?: string;
  sessionId?: string;
  scripts?: string;
  env?: Record<string, string>;
  // 子プロセスの timeout。testTimeout より短いテストから呼ぶときは、テストの timeout より短い値を渡す。
  timeout?: number;
};

export async function runScript(
  script: string,
  args: readonly string[],
  { cwd, scripts = scriptsDir, env = {} }: RunOptions = {},
) {
  return await spawnAsync("bash", [join(scripts, script), ...args], {
    timeout: CHILD_TIMEOUT_MS,
    cwd,
    env: kaizenEnv(cwd ?? tmpdir(), { CLAUDE_PROJECT_DIR: cwd, ...env }),
  });
}

/** PreToolUse Hook の入力を模して、チェックに 1 コマンドを判定させる。 */
export async function runGate(
  command: string,
  {
    cwd,
    transcriptPath,
    sessionId,
    scripts = scriptsDir,
    env = {},
    timeout = CHILD_TIMEOUT_MS,
  }: RunOptions = {},
) {
  const input = JSON.stringify({
    tool_input: { command },
    ...(transcriptPath ? { transcript_path: transcriptPath } : {}),
    ...(sessionId ? { session_id: sessionId } : {}),
  });
  return await spawnAsync("bash", [join(scripts, "kaizen-precommit-gate.sh")], {
    timeout,
    cwd,
    input,
    env: kaizenEnv(cwd ?? tmpdir(), { CLAUDE_PROJECT_DIR: cwd, ...env }),
  });
}

/** スクリプト一式を一時ディレクトリへ複製する（1 本だけスタブに差し替えるため）。 */
export function cloneScripts() {
  // 設定の読み取り（scripts/skill-config/）と、それが読むスキーマ（../config-schemas/）も、スキルと同じ配置で複製する。
  const base = tempDir("kaizen-scripts-");
  const dir = join(base, "scripts");
  cpSync(scriptsDir, dir, { recursive: true });
  cpSync(join(scriptsDir, "..", "config-schemas"), join(base, "config-schemas"), {
    recursive: true,
  });
  return dir;
}

export function scannedPosition(stdout: string) {
  const bytes = stdout.match(/^kaizen-candidate-scan: scanned-bytes=(\d+)$/m);
  const lines = stdout.match(/^kaizen-candidate-scan: scanned-lines=(\d+)$/m);
  return { bytes: bytes?.[1], lines: lines?.[1] };
}

// 候補が残っている他セッションのセンチネルは解消されないので、そのままだと commit のたびに同じ範囲を
// 走査し直し、締め切りの残りを同じ結論に使い切る（Issue #492 の提案 2）。
// 「他セッション分の走査結果の再利用」の 2 つの describe（並べるものと、ファイルの最後で並べないもの）が使う。
export const FOREIGN_SCAN_OWN = "own-session-1";
export const FOREIGN_SCAN_FOREIGN = "foreign-session-1";

export function setupForeignScan(scannerBody: string) {
  const scripts = cloneScripts();
  const cwd = makeProject();
  const counter = join(cwd, "scan-count");
  writeFileSync(
    join(scripts, "kaizen-candidate-scan.sh"),
    `#!/usr/bin/env bash\necho x >>"$SCAN_COUNTER"\n${scannerBody}\n`,
  );
  const transcript = join(cwd, "foreign.jsonl");
  writeFileSync(transcript, "{}\n");
  writeFileSync(
    join(cwd, ".kaizen", `.pending-extract.${FOREIGN_SCAN_FOREIGN}`),
    `2099-01-01T00:00:00Z\n${transcript}\nclaude-code\n${FOREIGN_SCAN_FOREIGN}\n`,
  );
  const cache = join(cwd, ".kaizen", `.extract-checkpoint.${FOREIGN_SCAN_FOREIGN}.foreign-scan`);
  // timeout は、1 つのテストで gate を何度も起動するときに、合計がテストの timeout を超えないように渡す。
  // deadline は kaizen.jsonc の precommit_deadline_seconds に書く。
  const gate = async (env: Record<string, string> = {}, timeout?: number, deadline?: number) => {
    if (deadline !== undefined) {
      writeKaizenConfig(cwd, `{ "precommit_deadline_seconds": ${deadline} }\n`);
    }
    return await runGate("git commit -m x", {
      cwd,
      sessionId: FOREIGN_SCAN_OWN,
      scripts,
      env: { SCAN_COUNTER: counter, ...env },
      timeout,
    });
  };
  const scans = () =>
    existsSync(counter) ? readFileSync(counter, "utf8").split("\n").filter(Boolean).length : 0;
  return { scripts, cwd, transcript, cache, gate, scans };
}
