// kaizen の Stop フック（kaizen-stop-mark.sh）の回帰テスト。
//
// Claude Code / Codex は Hook payload に transcript_path を必ず持つ。`/compact` 専用の
// 隠しセッションのように transcript を一度も作らないまま Stop が実行されると、記録された
// transcript が永遠に読めないセンチネルが立つ。これはコミット前のチェックの案内どおりに解消できない
// 恒久的なブロッカーになる（Issue #240）。このスクリプトは transcript が無い／読めない場合に
// センチネルを立てないことで発生を防ぐ。「立てない」ことの検証は、「立てる」場合との対比
// （検出されることの確認）がないと、スクリプトが単に失敗して何も書けていないのと区別できない。

import { describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeSharedTempDir, makeTempDir } from "../../lib/testing/test-tmpdir.ts";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";
import { pathWithout } from "./kaizen-config-env.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const script = join(repoRoot, "skills/kaizen/scripts/kaizen-stop-mark.sh");

function makeProject() {
  const dir = makeTempDir("kaizen-stop-mark-");
  mkdirSync(join(dir, ".kaizen"));
  return dir;
}

/** Stop Hook を 1 回実行する。$1 = センチネルのサフィックス（省略時は claude-code）。 */
function runStopMark(
  cwd: string,
  {
    suffix,
    sessionId = "s1",
    transcriptPath,
    includeTranscriptField = true,
    extra = {},
    copilotCli = false,
    withoutJsonTools = false,
  }: {
    suffix?: string;
    sessionId?: string;
    transcriptPath?: string;
    includeTranscriptField?: boolean;
    // 入力の JSON に足す項目（Copilot の入力の `timestamp` など）。
    extra?: Record<string, unknown>;
    // Copilot CLI が Hook に渡す COPILOT_CLI=1 を付けるか。付けないときは空にし、テストを
    // 起動した環境の値を引き継がない。CLAUDE_PROJECT_DIR は Copilot も渡すので、どちらでも付ける。
    copilotCli?: boolean;
    // jq と python3 を外した PATH で実行する（Copilot かを判定できない環境）。
    withoutJsonTools?: boolean;
  } = {},
) {
  const payload = {
    session_id: sessionId,
    cwd,
    ...(includeTranscriptField ? { transcript_path: transcriptPath ?? "" } : {}),
    ...extra,
  };
  const args = suffix ? [suffix] : [];
  return spawnSync("bash", [script, ...args], {
    timeout: CHILD_TIMEOUT_MS,
    cwd,
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: cwd,
      COPILOT_CLI: copilotCli ? "1" : "",
      ...(withoutJsonTools
        ? { PATH: pathWithout(cwd, ["jq", "python3"], process.env.PATH ?? "") }
        : {}),
    },
  });
}

function sentinelFiles(cwd: string) {
  return readdirSync(join(cwd, ".kaizen")).filter((name) => name.startsWith(".pending-extract"));
}

describe("transcript が無い claude-code / codex の Stop はセンチネルを立てない", () => {
  test("陽性: 読める transcript があれば claude-code はセンチネルを立てる", () => {
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

  // 判定は存在確認（-e）に留め、可読性（-r）では判定しない。実在するが権限・FS 状態で
  // 一時的に読めないだけの transcript まで「無い」扱いにすると、そのセッションの未抽出の
  // 学びがコミット前のチェックで検出されなくなる（code review で指摘・修正）。
  test.skipIf(process.getuid?.() === 0)(
    "claude-code: transcript_path が存在するが読めない場合はセンチネルを立てる",
    () => {
      const cwd = makeProject();
      try {
        const transcript = join(cwd, "unreadable.jsonl");
        writeFileSync(transcript, "{}\n");
        chmodSync(transcript, 0o000);
        const result = runStopMark(cwd, { transcriptPath: transcript });
        expect(result.status).toBe(0);
        expect(sentinelFiles(cwd).length).toBe(1);
      } finally {
        chmodSync(join(cwd, "unreadable.jsonl"), 0o644);
        rmSync(cwd, { recursive: true, force: true });
      }
    },
  );

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

describe("共通ライブラリが読めず機能を減らして動くときは transcript の有無で判定しない", () => {
  // ライブラリが読めるときの陽性の側は、先頭の describe の「読める transcript があれば
  // claude-code はセンチネルを立てる」が同じ入力で確かめている。
  test("kaizen-hook-common.sh が同梱されていない場合、有効な transcript を渡してもセンチネルを立てる", () => {
    const cwd = makeProject();
    const degradedDir = makeTempDir("kaizen-stop-mark-degraded-");
    try {
      // 共通ライブラリだけを欠いた配布物（部分展開）を模す。呼び出し側はこれでも
      // 動く必要がある（動かなくなってはいけないのはセンチネル記録そのもの）。
      copyFileSync(script, join(degradedDir, "kaizen-stop-mark.sh"));
      const transcript = join(cwd, "t.jsonl");
      writeFileSync(transcript, "{}\n");
      const payload = { session_id: "d1", cwd, transcript_path: transcript };
      const result = spawnSync("bash", [join(degradedDir, "kaizen-stop-mark.sh")], {
        timeout: CHILD_TIMEOUT_MS,
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

// Copilot CLI は `.claude/settings.json` の Hook も実行する（Issue #853）。Stop は応答が終わるたびに
// 実行されるので（agentStop）、引数なしの登録がそのままセンチネルを作ると、Copilot のセッションに
// claude-code の名前のセンチネルが立つ。入力の最上位の `timestamp` と、環境変数 COPILOT_CLI が空でないことの
// 両方が Copilot を示すときだけ、何もせずに終える。Copilot は CLAUDE_PROJECT_DIR も渡すので、どのケースにも付ける。
// 入力の形は https://docs.github.com/en/copilot/reference/hooks-configuration の PascalCase の Stop に合わせる。
describe("Claude Code 用の登録（引数なし）を Copilot が呼んだとき", () => {
  const copilotStop = {
    hook_event_name: "Stop",
    timestamp: "2026-11-02T00:00:00.000Z",
    stop_reason: "end_turn",
    stop_hook_active: false,
  };

  // どのケースも読める transcript を渡す。判定が無ければセンチネルを立てる入力なので、
  // 「立てない」が判定によるものか、transcript が無いためかを区別できる。
  function withTranscript(cwd: string) {
    const transcript = join(cwd, "events.jsonl");
    writeFileSync(transcript, "{}\n");
    return transcript;
  }

  test("timestamp があり COPILOT_CLI が空でないなら、センチネルを立てずに exit 0", () => {
    const cwd = makeProject();
    try {
      const result = runStopMark(cwd, {
        transcriptPath: withTranscript(cwd),
        extra: copilotStop,
        copilotCli: true,
      });
      expect(result.status).toBe(0);
      expect(sentinelFiles(cwd)).toEqual([]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test.each([
    ["COPILOT_CLI が空（Claude Code が呼んだ）", copilotStop, false],
    ["timestamp が無い（Copilot のシェルから起動した Claude Code）", {}, true],
  ])("%s なら、これまでどおり claude-code のセンチネルを立てる", (_name, extra, copilotCli) => {
    const cwd = makeProject();
    try {
      const result = runStopMark(cwd, {
        transcriptPath: withTranscript(cwd),
        extra,
        copilotCli,
      });
      expect(result.status).toBe(0);
      const files = sentinelFiles(cwd);
      expect(files).toEqual([".pending-extract.s1"]);
      const lines = readFileSync(join(cwd, ".kaizen", files[0]), "utf8").split("\n");
      expect(lines[2]).toBe("claude-code");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("jq も python3 も無ければ Copilot かを判定できないので、これまでどおり claude-code のセンチネルを立てる", () => {
    const cwd = makeProject();
    try {
      const result = runStopMark(cwd, {
        transcriptPath: withTranscript(cwd),
        extra: copilotStop,
        copilotCli: true,
        withoutJsonTools: true,
      });
      expect(result.status).toBe(0);
      expect(sentinelFiles(cwd)).toEqual([".pending-extract.s1"]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("-copilot を渡した呼び出し（.github/hooks の sessionEnd）は、Copilot の入力でもセンチネルを立てる", () => {
    const cwd = makeProject();
    try {
      const result = runStopMark(cwd, {
        suffix: "-copilot",
        includeTranscriptField: false,
        sessionId: "p1",
        extra: { timestamp: 1793588988760, reason: "complete" },
        copilotCli: true,
      });
      expect(result.status).toBe(0);
      expect(sentinelFiles(cwd)).toEqual([".pending-extract-copilot.p1"]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

// 判定の関数（kaizen-hook-common.sh の kaizen_payload_is_copilot）を、JSON を読むツールの 3 つの構成で直接確かめる。
// jq があれば jq で、無ければ python3 で読む。どちらも無ければ判定できないので、常に 1（Copilot と扱わない）を返す。
describe("kaizen_payload_is_copilot", () => {
  const lib = join(repoRoot, "skills/kaizen/scripts/kaizen-hook-common.sh");
  const bash = spawnSync("bash", ["-c", "command -v bash"], {
    timeout: CHILD_TIMEOUT_MS,
    encoding: "utf8",
  }).stdout.trim();
  const python3 = spawnSync(bash, ["-c", "command -v python3"], {
    timeout: CHILD_TIMEOUT_MS,
    encoding: "utf8",
  }).stdout.trim();
  // 判定の関数は bash の組み込みと jq・python3 しか使わないので、PATH を差し替えてツールだけを外せる。
  // python3 だけの PATH は、python3 へのリンクだけを置いたディレクトリにする。
  const noToolPath = makeSharedTempDir("kaizen-no-json-tool-path-");
  const pythonOnlyPath = makeSharedTempDir("kaizen-python-only-path-");
  symlinkSync(python3, join(pythonOnlyPath, "python3"));
  type Tool = "jq" | "python3" | "none";
  const pathFor: Record<Tool, string | undefined> = {
    jq: undefined,
    python3: pythonOnlyPath,
    none: noToolPath,
  };

  function isCopilot(json: string, { tool, copilotCli }: { tool: Tool; copilotCli: string }) {
    const path = pathFor[tool];
    return spawnSync(bash, ["-c", 'source "$1"; kaizen_payload_is_copilot "$2"', "_", lib, json], {
      timeout: CHILD_TIMEOUT_MS,
      encoding: "utf8",
      env: {
        ...process.env,
        CLAUDE_PROJECT_DIR: "/p",
        COPILOT_CLI: copilotCli,
        ...(path ? { PATH: path } : {}),
      },
    }).status;
  }

  function resolves(name: string, path: string | undefined) {
    return spawnSync(bash, ["-c", `command -v ${name}`], {
      timeout: CHILD_TIMEOUT_MS,
      env: path ? { PATH: path } : process.env,
    }).status;
  }

  test("前提: 各構成で、意図したツールだけを解決できる", () => {
    expect(resolves("jq", undefined)).toBe(0);
    expect(resolves("jq", pythonOnlyPath)).toBe(1);
    expect(resolves("python3", pythonOnlyPath)).toBe(0);
    expect(resolves("jq", noToolPath)).toBe(1);
    expect(resolves("python3", noToolPath)).toBe(1);
  });

  const top = JSON.stringify({ session_id: "s", timestamp: "2026-11-02T00:00:00Z", cwd: "/x" });
  const numeric = JSON.stringify({ sessionId: "s", timestamp: 1793588988760, cwd: "/x" });
  const inString = JSON.stringify({ tool_input: { command: 'echo "timestamp": 1' } });
  const nested = JSON.stringify({ tool_input: { timestamp: 1 } });
  const none = JSON.stringify({ session_id: "s", cwd: "/x", tool_input: { command: "ls" } });
  const broken = '{"timestamp": 1, "cwd": ';

  test.each([
    { name: "最上位に timestamp（文字列）・COPILOT_CLI=1", json: top, cli: "1", expected: 0 },
    {
      name: "最上位に timestamp（数値。camelCase のイベント）・COPILOT_CLI=1",
      json: numeric,
      cli: "1",
      expected: 0,
    },
    { name: "最上位に timestamp・COPILOT_CLI が空", json: top, cli: "", expected: 1 },
    { name: "timestamp が無い", json: none, cli: "1", expected: 1 },
    { name: "timestamp がコマンドの文字列の中にだけある", json: inString, cli: "1", expected: 1 },
    { name: "timestamp が入れ子のキーにだけある", json: nested, cli: "1", expected: 1 },
    { name: "JSON として読めない", json: broken, cli: "1", expected: 1 },
    { name: "入力が空", json: "", cli: "1", expected: 1 },
  ])("$name（jq・python3 で同じ結果）", ({ json, cli, expected }) => {
    expect(isCopilot(json, { tool: "jq", copilotCli: cli })).toBe(expected);
    expect(isCopilot(json, { tool: "python3", copilotCli: cli })).toBe(expected);
  });

  test("jq も python3 も無ければ、最上位に timestamp があっても Copilot と扱わない", () => {
    expect(isCopilot(top, { tool: "none", copilotCli: "1" })).toBe(1);
  });
});
