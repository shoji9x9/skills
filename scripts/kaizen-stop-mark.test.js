// kaizen の Stop フック（kaizen-stop-mark.sh）の回帰テスト。
//
// Claude Code / Codex は Hook payload に transcript_path を必ず持つ。`/compact` 専用の
// 隠しセッションのように transcript を一度も作らないまま Stop が走ると、記録された
// transcript が永遠に読めないセンチネルが立ち、コミット前ゲートの案内どおりに解消できない
// 恒久ブロッカーになる（Issue #240）。このスクリプトは transcript が無い／読めない場合に
// センチネルを立てないことで発生を防ぐ。「立てない」ことの検証は「立てる」場合との対比
// （陽性コントロール）がないと、スクリプトが単に壊れて何も書けていないのと区別できない。

import { describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repoRoot, "skills/kaizen/scripts/kaizen-stop-mark.sh");

function makeProject() {
  const dir = mkdtempSync(join(tmpdir(), "kaizen-stop-mark-"));
  mkdirSync(join(dir, ".kaizen"));
  return dir;
}

/** Stop Hook を 1 回走らせる。$1 = センチネルのサフィックス（省略時は claude-code）。 */
function runStopMark(
  cwd,
  { suffix, sessionId = "s1", transcriptPath, includeTranscriptField = true } = {},
) {
  const payload = {
    session_id: sessionId,
    cwd,
    ...(includeTranscriptField ? { transcript_path: transcriptPath ?? "" } : {}),
  };
  const args = suffix ? [suffix] : [];
  return spawnSync("bash", [script, ...args], {
    cwd,
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd },
  });
}

function sentinelFiles(cwd) {
  return readdirSync(join(cwd, ".kaizen")).filter((name) => name.startsWith(".pending-extract"));
}

describe("transcript が無い claude-code / codex の Stop はセンチネルを立てない", () => {
  test("陽性コントロール: 読める transcript があれば claude-code はセンチネルを立てる", () => {
    const cwd = makeProject();
    try {
      const transcript = join(cwd, "t.jsonl");
      writeFileSync(transcript, "{}\n");
      const result = runStopMark(cwd, { transcriptPath: transcript });
      expect(result.status).toBe(0);
      const files = sentinelFiles(cwd);
      expect(files.length).toBe(1);
      const lines = readFileSync(join(cwd, ".kaizen", files[0]), "utf8").split("\n");
      expect(lines[1]).toBe(transcript);
      expect(lines[2]).toBe("claude-code");
      expect(lines[3]).toBe("s1");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("claude-code: transcript_path が存在しないファイルを指す場合はセンチネルを立てない", () => {
    const cwd = makeProject();
    try {
      const transcript = join(cwd, "does-not-exist.jsonl");
      const result = runStopMark(cwd, { transcriptPath: transcript });
      expect(result.status).toBe(0);
      expect(sentinelFiles(cwd)).toEqual([]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("claude-code: transcript_path フィールド自体が無い場合もセンチネルを立てない", () => {
    const cwd = makeProject();
    try {
      const result = runStopMark(cwd, { includeTranscriptField: false });
      expect(result.status).toBe(0);
      expect(sentinelFiles(cwd)).toEqual([]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("codex: 読める transcript があればセンチネルを立て、無ければ立てない", () => {
    const cwd = makeProject();
    try {
      const transcript = join(cwd, "t.jsonl");
      writeFileSync(transcript, "{}\n");
      const withTranscript = runStopMark(cwd, {
        suffix: "-codex",
        transcriptPath: transcript,
        sessionId: "c1",
      });
      expect(withTranscript.status).toBe(0);
      const files = sentinelFiles(cwd);
      expect(files.length).toBe(1);
      expect(files[0]).toContain("-codex");
      rmSync(join(cwd, ".kaizen", files[0]));

      const missing = runStopMark(cwd, {
        suffix: "-codex",
        transcriptPath: join(cwd, "missing.jsonl"),
        sessionId: "c2",
      });
      expect(missing.status).toBe(0);
      expect(sentinelFiles(cwd)).toEqual([]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe("共通ライブラリが読めない縮退時は transcript の有無で判定しない", () => {
  test("陽性コントロール: ライブラリが読めれば有効な transcript でセンチネルを立てる", () => {
    const cwd = makeProject();
    try {
      const transcript = join(cwd, "t.jsonl");
      writeFileSync(transcript, "{}\n");
      const result = runStopMark(cwd, { transcriptPath: transcript, sessionId: "d0" });
      expect(result.status).toBe(0);
      expect(sentinelFiles(cwd).length).toBe(1);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("kaizen-hook-common.sh が同梱されていない場合、有効な transcript を渡してもセンチネルを立てる", () => {
    const cwd = makeProject();
    const degradedDir = mkdtempSync(join(tmpdir(), "kaizen-stop-mark-degraded-"));
    try {
      // 共通ライブラリだけを欠いた配布物（部分展開）を模す。呼び出し側はこれでも
      // 動く必要がある（動かなくなってはいけないのはセンチネル記録そのもの）。
      copyFileSync(script, join(degradedDir, "kaizen-stop-mark.sh"));
      const transcript = join(cwd, "t.jsonl");
      writeFileSync(transcript, "{}\n");
      const payload = { session_id: "d1", cwd, transcript_path: transcript };
      const result = spawnSync("bash", [join(degradedDir, "kaizen-stop-mark.sh")], {
        cwd,
        input: JSON.stringify(payload),
        encoding: "utf8",
        env: { ...process.env, CLAUDE_PROJECT_DIR: cwd },
      });
      expect(result.status).toBe(0);
      expect(sentinelFiles(cwd).length).toBe(1);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(degradedDir, { recursive: true, force: true });
    }
  });
});

describe("copilot は transcript が無くても従来どおりセンチネルを立てる", () => {
  test("copilot は Hook payload に transcript を持たないのが正常系なので対象外", () => {
    const cwd = makeProject();
    try {
      const result = runStopMark(cwd, {
        suffix: "-copilot",
        includeTranscriptField: false,
        sessionId: "p1",
      });
      expect(result.status).toBe(0);
      const files = sentinelFiles(cwd);
      expect(files.length).toBe(1);
      expect(files[0]).toContain("-copilot");
      const lines = readFileSync(join(cwd, ".kaizen", files[0]), "utf8").split("\n");
      expect(lines[1]).toBe("");
      expect(lines[2]).toBe("copilot");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
