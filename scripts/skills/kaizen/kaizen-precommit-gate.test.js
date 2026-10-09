// kaizen のコミット前のチェック一式（スキャナ・checkpoint 記録・lifecycle 検査）の回帰テスト。
//
// このチェックは、判定できないときは失敗として扱うことが前提である。そのため、「検査していない範囲を処理済みにする」
// 「候補ゼロが常にブロックと判定される」「commit を取りこぼす」は、どれも警告なしに誤った結果になる。LLM eval では
// 実行環境（sed の方言・パーミッション・追記タイミング）を作れないため、ここで決定論的に押さえる。

import { describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeSharedTempDir, makeTempDir } from "../../lib/test-tmpdir.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const scriptsDir = join(repoRoot, "skills", "kaizen", "scripts");
const fixturesDir = join(repoRoot, "evals", "kaizen", "fixtures", "candidate-scan");

/** .kaizen/ を持つ空プロジェクトを作る。CLAUDE_PROJECT_DIR を渡すので git 管理下でなくてよい。 */
function makeProject() {
  const dir = makeTempDir("kaizen-gate-");
  mkdirSync(join(dir, ".kaizen"));
  return dir;
}

function runScript(script, args, { cwd, scripts = scriptsDir, env = {} } = {}) {
  return spawnSync("bash", [join(scripts, script), ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, ...env },
  });
}

/** PreToolUse Hook の入力を模して、チェックに 1 コマンドを判定させる。 */
function runGate(command, { cwd, transcriptPath, sessionId, scripts = scriptsDir, env = {} } = {}) {
  const input = JSON.stringify({
    tool_input: { command },
    ...(transcriptPath ? { transcript_path: transcriptPath } : {}),
    ...(sessionId ? { session_id: sessionId } : {}),
  });
  return spawnSync("bash", [join(scripts, "kaizen-precommit-gate.sh")], {
    cwd,
    input,
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, ...env },
  });
}

/** スクリプト一式を一時ディレクトリへ複製する（1 本だけスタブに差し替えるため）。 */
function cloneScripts() {
  const dir = makeTempDir("kaizen-scripts-");
  for (const name of readdirSync(scriptsDir)) copyFileSync(join(scriptsDir, name), join(dir, name));
  return dir;
}

function scannedPosition(stdout) {
  const bytes = stdout.match(/^kaizen-candidate-scan: scanned-bytes=(\d+)$/m);
  const lines = stdout.match(/^kaizen-candidate-scan: scanned-lines=(\d+)$/m);
  return { bytes: bytes?.[1], lines: lines?.[1] };
}

describe("Claude Code の atis-latch 補助レコード", () => {
  test.each([
    ["atis-latch だけなら候補ゼロ", "claude-atis-latch-no-candidate.jsonl", 1],
    ["atis-latch は候補を隠さない", "claude-atis-latch-candidate.jsonl", 0],
    ["type 欠落は判定不能", "unknown.jsonl", 2],
    ["未知の文字列 type は判定不能", "unknown-string-type.jsonl", 2],
    ["不正な JSON は判定不能", "malformed-json.jsonl", 2],
    ["event_msg の subtype 欠落は判定不能", "malformed-event-msg.jsonl", 2],
    ["response_item の未知 subtype は判定不能", "unknown-response-item-subtype.jsonl", 2],
  ])("%s", (_label, fixture, expectedStatus) => {
    const cwd = makeProject();
    const transcript = join(fixturesDir, fixture);
    const scan = runScript("kaizen-candidate-scan.sh", [transcript, join(cwd, "no-checkpoint")], {
      cwd,
    });

    expect(scan.status).toBe(expectedStatus);
  });

  test("atis-latch だけでは commit をブロックしない", () => {
    const cwd = makeProject();
    const transcript = join(fixturesDir, "claude-atis-latch-no-candidate.jsonl");
    writeFileSync(join(cwd, ".kaizen", ".pending-extract"), "");

    const gate = runGate("git commit -m x", { cwd, transcriptPath: transcript });

    expect(gate.status).toBe(0);
  });

  test("checkpoint 後の差分が atis-latch だけでも検証済みゼロ", () => {
    const cwd = makeProject();
    const transcript = join(cwd, "t.jsonl");
    const checkpoint = join(cwd, ".kaizen", ".extract-checkpoint");
    const initial = readFileSync(join(fixturesDir, "claude-no-candidate.jsonl"), "utf8");
    writeFileSync(transcript, initial);
    writeFileSync(
      checkpoint,
      `${transcript}\n${Buffer.byteLength(initial)}\nclaude-code\n${initial.split("\n").length - 1}\n`,
    );
    appendFileSync(transcript, '{"type":"atis-latch","atis":{},"sessionId":"test-session"}\n');

    const scan = runScript("kaizen-candidate-scan.sh", [transcript, checkpoint], { cwd });

    expect(scan.status).toBe(1);
    expect(scan.stdout).toMatch(/^kaizen-candidate-scan: agent=claude-code$/m);
  });
});

describe("Codex の token usage / review mode 補助レコード", () => {
  test.each([
    ["補助レコードだけなら候補ゼロ", "codex-review-metadata-no-candidate.jsonl", 1],
    ["補助レコードはツール失敗候補を隠さない", "codex-review-metadata-candidate.jsonl", 0],
  ])("%s", (_label, fixture, expectedStatus) => {
    const cwd = makeProject();
    const transcript = join(fixturesDir, fixture);
    const scan = runScript("kaizen-candidate-scan.sh", [transcript, join(cwd, "no-checkpoint")], {
      cwd,
    });

    expect(scan.status).toBe(expectedStatus);
    expect(scan.stdout).toMatch(/^kaizen-candidate-scan: agent=codex$/m);
  });

  test.each([
    ["token_usage_record", '\n\telif $j.type == "token_usage_record" then "D", "R"'],
    ["EnteredReviewMode", '$item.type == "EnteredReviewMode" or\n\t\t       '],
    ["ExitedReviewMode", '$item.type == "ExitedReviewMode" or '],
  ])("%s の認識分岐を除くと fixture は判定不能になる", (_label, branch) => {
    const scripts = cloneScripts();
    const scanner = join(scripts, "kaizen-candidate-scan.sh");
    const original = readFileSync(scanner, "utf8");
    const mutated = original.replace(branch, "");
    expect(mutated).not.toBe(original);
    writeFileSync(scanner, mutated);

    const cwd = makeProject();
    const transcript = join(fixturesDir, "codex-review-metadata-no-candidate.jsonl");
    const scan = runScript("kaizen-candidate-scan.sh", [transcript, join(cwd, "no-checkpoint")], {
      cwd,
      scripts,
    });

    expect(scan.status).toBe(2);
    expect(scan.stderr).toMatch(/unsupported or malformed record/);
  });
});

describe("checkpoint はスキャナが検査した範囲までしか進めない", () => {
  test("走査後に追記されたレコードは処理済みにならず、次の走査で検出される", () => {
    const cwd = makeProject();
    const transcript = join(cwd, "t.jsonl");
    copyFileSync(join(fixturesDir, "claude-no-candidate.jsonl"), transcript);
    writeFileSync(join(cwd, ".kaizen", ".pending-extract"), "");

    const scan = runScript(
      "kaizen-candidate-scan.sh",
      [transcript, ".kaizen/.extract-checkpoint"],
      { cwd },
    );
    expect(scan.status).toBe(1); // 検証済みゼロ
    const { bytes, lines } = scannedPosition(scan.stdout);
    expect(bytes).toBeDefined();
    expect(lines).toBeDefined();

    // 走査と checkpoint 記録の間に候補（user correction）が追記される。
    appendFileSync(transcript, readFileSync(join(fixturesDir, "claude-candidate.jsonl")));

    const done = runScript(
      "kaizen-extract-done.sh",
      [
        "--checkpoint-only",
        "--sentinel-suffix",
        "",
        "--agent",
        "claude-code",
        "--scanned-bytes",
        bytes,
        "--scanned-lines",
        lines,
        transcript,
      ],
      { cwd },
    );
    expect(done.status).toBe(0);

    const rescan = runScript(
      "kaizen-candidate-scan.sh",
      [transcript, ".kaizen/.extract-checkpoint"],
      { cwd },
    );
    expect(rescan.status).toBe(0); // 追記分が候補として検出される
    // 根拠の行番号は追記後の絶対行（8 行 + 3 行目）を指す。
    expect(rescan.stdout).toMatch(/user correction: transcript line 11$/m);
  });

  // 走査時点で transcript が改行で終わっていない（レコードは書けたが改行が未着）ケース。
  // 走査済み行数を「改行の数」以外の定義で数えると、後から改行だけが届いたときにその行を
  // 二重に数え、以降の根拠行番号が恒久的にずれる。
  test("改行未着のレコードがあっても根拠の行番号がずれない", () => {
    const cwd = makeProject();
    const transcript = join(cwd, "t.jsonl");
    const noCandidate = readFileSync(join(fixturesDir, "claude-no-candidate.jsonl"), "utf8");
    writeFileSync(transcript, noCandidate.replace(/\n$/, "")); // 末尾の改行がまだ届いていない

    const scan = runScript(
      "kaizen-candidate-scan.sh",
      [transcript, ".kaizen/.extract-checkpoint"],
      { cwd },
    );
    expect(scan.status).toBe(1);
    const { bytes, lines } = scannedPosition(scan.stdout);

    const done = runScript(
      "kaizen-extract-done.sh",
      [
        "--checkpoint-only",
        "--sentinel-suffix",
        "",
        "--agent",
        "claude-code",
        "--scanned-bytes",
        bytes,
        "--scanned-lines",
        lines,
        transcript,
      ],
      { cwd },
    );
    expect(done.status).toBe(0);

    // 遅れて届いた改行と、その後の候補レコード。
    appendFileSync(transcript, "\n");
    appendFileSync(transcript, readFileSync(join(fixturesDir, "claude-candidate.jsonl")));
    const total = readFileSync(transcript, "utf8").split("\n").filter(Boolean).length;
    expect(total).toBe(11);

    const rescan = runScript(
      "kaizen-candidate-scan.sh",
      [transcript, ".kaizen/.extract-checkpoint"],
      { cwd },
    );
    expect(rescan.status).toBe(0);
    expect(rescan.stdout).toMatch(/user correction: transcript line 11$/m);
  });

  test("--checkpoint-only は走査済み位置なしでは checkpoint を進めない", () => {
    const cwd = makeProject();
    const transcript = join(cwd, "t.jsonl");
    copyFileSync(join(fixturesDir, "claude-no-candidate.jsonl"), transcript);
    writeFileSync(join(cwd, ".kaizen", ".pending-extract"), "");

    const done = runScript(
      "kaizen-extract-done.sh",
      ["--checkpoint-only", "--sentinel-suffix", "", "--agent", "claude-code", transcript],
      { cwd },
    );
    expect(done.status).toBe(2);
    expect(done.stderr).toMatch(/--scanned-bytes and --scanned-lines/);
    // センチネルを消してチェックを解除していないこと。
    expect(readdirSync(join(cwd, ".kaizen"))).toContain(".pending-extract");
  });

  test.each([
    ["--scanned-bytes だけ", ["--scanned-bytes", "10"]],
    ["--scanned-lines だけ", ["--scanned-lines", "1"]],
  ])("走査済み位置は対で渡す: %s は拒否する", (_label, partial) => {
    const cwd = makeProject();
    const transcript = join(cwd, "t.jsonl");
    copyFileSync(join(fixturesDir, "claude-no-candidate.jsonl"), transcript);

    // 片方だけ渡すと checkpoint の 2 行目と 4 行目が別地点を指す。警告なしに、機能を減らした wc での計数にしない。
    const done = runScript("kaizen-extract-done.sh", [...partial, transcript], { cwd });
    expect(done.status).toBe(2);
    expect(done.stderr).toMatch(/must be given together/);
    expect(readdirSync(join(cwd, ".kaizen"))).not.toContain(".extract-checkpoint");
  });

  test("走査済み位置は --checkpoint-only 専用で、抽出完了モードでは受け付けない", () => {
    const cwd = makeProject();
    const transcript = join(cwd, "t.jsonl");
    copyFileSync(join(fixturesDir, "claude-no-candidate.jsonl"), transcript);

    // 抽出完了は transcript 全体を読んだ後の記録。ここで終端を受け付けると checkpoint を
    // 任意の位置へ進められ、未走査範囲を飛ばせてしまう（checkpoint はセッションをまたいで残る）。
    const done = runScript(
      "kaizen-extract-done.sh",
      ["--sentinel-suffix", "", "--scanned-bytes", "999999", "--scanned-lines", "999", transcript],
      { cwd },
    );
    expect(done.status).toBe(2);
    expect(done.stderr).toMatch(/require --checkpoint-only/);
    expect(readdirSync(join(cwd, ".kaizen"))).not.toContain(".extract-checkpoint");
    expect(readdirSync(join(cwd, ".kaizen"))).not.toContain(".extract-done");
  });

  test("スキャナが走査済み位置を報告しないとき、チェックはブロックする", () => {
    const scripts = cloneScripts();
    writeFileSync(
      join(scripts, "kaizen-candidate-scan.sh"),
      '#!/usr/bin/env bash\necho "kaizen-candidate-scan: agent=claude-code"\nexit 1\n',
    );
    const cwd = makeProject();
    const transcript = join(cwd, "t.jsonl");
    copyFileSync(join(fixturesDir, "claude-no-candidate.jsonl"), transcript);
    writeFileSync(join(cwd, ".kaizen", ".pending-extract"), "");

    const gate = runGate("git commit -m x", { cwd, transcriptPath: transcript, scripts });
    expect(gate.status).toBe(2);
    expect(gate.stderr).toMatch(/did not report its scanned position/);
    expect(readdirSync(join(cwd, ".kaizen"))).toContain(".pending-extract");
  });
});

// 1 本の branch で複数 commit する運用では、最初の commit の後に積まれた活動も抽出対象でなければ
// ならない（Issue #244）。抽出完了マーカー `.extract-done.<key>` はセッション全体を抽出済みにする
// 印なので、checkpoint がある限りチェックに尊重させない。ここが緩むと 2 回目以降の commit が
// エラーにならずに素通りし、「チェックが動いている」ように見えたまま学びを取りこぼす。
describe("同一セッションの後続 commit も未処理範囲を再走査する", () => {
  const SESSION = "sess-244";
  const sentinelName = `.pending-extract.${SESSION}`;

  /** Stop フックが毎ターン行うセンチネル再装填を模す。 */
  function armSentinel(cwd, transcript) {
    writeFileSync(
      join(cwd, ".kaizen", sentinelName),
      `2026-01-01T00:00:00Z\n${transcript}\nclaude-code\n${SESSION}\n`,
    );
  }

  function completeExtraction(cwd, args) {
    const done = runScript(
      "kaizen-extract-done.sh",
      ["--sentinel-suffix", "", "--agent", "claude-code", "--session-id", SESSION, ...args],
      { cwd },
    );
    expect(done.status).toBe(0);
    return done;
  }

  test("checkpoint を記録できた抽出完了は .extract-done を書かない", () => {
    const cwd = makeProject();
    const transcript = join(cwd, "t.jsonl");
    copyFileSync(join(fixturesDir, "claude-no-candidate.jsonl"), transcript);
    armSentinel(cwd, transcript);

    completeExtraction(cwd, [transcript]);

    const files = readdirSync(join(cwd, ".kaizen"));
    expect(files).toContain(`.extract-checkpoint.${SESSION}`);
    expect(files).not.toContain(`.extract-done.${SESSION}`);
    expect(files).not.toContain(sentinelName);
  });

  test("抽出後に積まれた候補は次の commit でブロックされる", () => {
    const cwd = makeProject();
    const transcript = join(cwd, "t.jsonl");
    copyFileSync(join(fixturesDir, "claude-no-candidate.jsonl"), transcript);
    armSentinel(cwd, transcript);
    completeExtraction(cwd, [transcript]);

    // 1 回目の commit の後に積まれた活動（ユーザーの訂正を含む）。
    appendFileSync(transcript, readFileSync(join(fixturesDir, "claude-candidate.jsonl"), "utf8"));
    armSentinel(cwd, transcript);

    const gate = runGate("git commit -m second", {
      cwd,
      transcriptPath: transcript,
      sessionId: SESSION,
    });
    expect(gate.status).toBe(2);
    expect(gate.stderr).toMatch(/candidate\(s\) found/);
    expect(readdirSync(join(cwd, ".kaizen"))).toContain(sentinelName);
  });

  test("抽出後に新しい活動が無ければ次の commit は通る", () => {
    const cwd = makeProject();
    const transcript = join(cwd, "t.jsonl");
    copyFileSync(join(fixturesDir, "claude-no-candidate.jsonl"), transcript);
    armSentinel(cwd, transcript);
    completeExtraction(cwd, [transcript]);
    armSentinel(cwd, transcript);

    const gate = runGate("git commit -m second", {
      cwd,
      transcriptPath: transcript,
      sessionId: SESSION,
    });
    expect(gate.status).toBe(0);
    expect(readdirSync(join(cwd, ".kaizen"))).not.toContain(sentinelName);
  });

  test("修正前に書かれた .extract-done が残っていても再走査する", () => {
    const cwd = makeProject();
    const transcript = join(cwd, "t.jsonl");
    copyFileSync(join(fixturesDir, "claude-no-candidate.jsonl"), transcript);
    armSentinel(cwd, transcript);
    completeExtraction(cwd, [transcript]);
    // 旧版が書いたマーカー（アップグレード直後にセッション内で残っている状態）。
    writeFileSync(join(cwd, ".kaizen", `.extract-done.${SESSION}`), "2026-01-01T00:00:00Z\n");

    appendFileSync(transcript, readFileSync(join(fixturesDir, "claude-candidate.jsonl"), "utf8"));
    armSentinel(cwd, transcript);

    const gate = runGate("git commit -m second", {
      cwd,
      transcriptPath: transcript,
      sessionId: SESSION,
    });
    expect(gate.status).toBe(2);
    expect(gate.stderr).toMatch(/candidate\(s\) found/);
  });

  test("checkpoint を記録できない抽出完了は .extract-done でチェックを解除する", () => {
    const cwd = makeProject();
    const transcript = join(cwd, "t.jsonl");
    copyFileSync(join(fixturesDir, "claude-no-candidate.jsonl"), transcript);
    armSentinel(cwd, transcript);

    // transcript を渡さない呼び出しでは差分走査の起点が作れない。ここでマーカーまで
    // 書かないと、以降の commit が全走査で毎回ブロックされる恒久ブロッカーになる。
    completeExtraction(cwd, []);
    const files = readdirSync(join(cwd, ".kaizen"));
    expect(files).toContain(`.extract-done.${SESSION}`);
    expect(files).not.toContain(`.extract-checkpoint.${SESSION}`);

    appendFileSync(transcript, readFileSync(join(fixturesDir, "claude-candidate.jsonl"), "utf8"));
    armSentinel(cwd, transcript);

    const gate = runGate("git commit -m second", {
      cwd,
      transcriptPath: transcript,
      sessionId: SESSION,
    });
    expect(gate.status).toBe(0);
  });

  test("checkpoint を後から記録できたら、先に書かれた .extract-done を失効させる", () => {
    const cwd = makeProject();
    const transcript = join(cwd, "t.jsonl");
    copyFileSync(join(fixturesDir, "claude-no-candidate.jsonl"), transcript);
    armSentinel(cwd, transcript);
    completeExtraction(cwd, []);
    armSentinel(cwd, transcript);
    completeExtraction(cwd, [transcript]);

    const files = readdirSync(join(cwd, ".kaizen"));
    expect(files).toContain(`.extract-checkpoint.${SESSION}`);
    expect(files).not.toContain(`.extract-done.${SESSION}`);
  });

  test("古い .extract-done を削除できなくても checkpoint 後のセンチネル解除を続ける", () => {
    const scripts = cloneScripts();
    const shimDir = makeTempDir("kaizen-rm-shim-");
    const realRm = spawnSync("bash", ["-c", "command -v rm"], { encoding: "utf8" }).stdout.trim();
    writeFileSync(
      join(shimDir, "rm"),
      `#!/usr/bin/env bash
for arg in "$@"; do
  case "$arg" in *.extract-done*) exit 1 ;; esac
done
exec "${realRm}" "$@"
`,
      { mode: 0o755 },
    );

    const cwd = makeProject();
    const transcript = join(cwd, "t.jsonl");
    copyFileSync(join(fixturesDir, "claude-no-candidate.jsonl"), transcript);
    armSentinel(cwd, transcript);
    writeFileSync(join(cwd, ".kaizen", `.extract-done.${SESSION}`), "old\n");

    const done = runScript(
      "kaizen-extract-done.sh",
      ["--sentinel-suffix", "", "--agent", "claude-code", "--session-id", SESSION, transcript],
      { cwd, scripts, env: { PATH: `${shimDir}:${process.env.PATH}` } },
    );

    expect(done.status).toBe(0);
    expect(readdirSync(join(cwd, ".kaizen"))).toContain(`.extract-checkpoint.${SESSION}`);
    expect(readdirSync(join(cwd, ".kaizen"))).toContain(`.extract-done.${SESSION}`);
    expect(readdirSync(join(cwd, ".kaizen"))).not.toContain(sentinelName);
  });

  // チェックは候補ゼロの自動通過のたびに checkpoint を書く。その後の抽出で checkpoint を
  // 記録できなかった場合（transcript を渡し忘れた・読めない・書けない）、古い checkpoint を
  // 残したままマーカーだけ書くと、チェックはマーカーを尊重せず古い起点から再走査し、いま抽出
  // したばかりの候補で再びブロックする。抽出をやり直しても同じ状態に戻るため、安全側の扱いが
  // 機能せず commit が止まり続ける。
  test("先に checkpoint がある状態でも、.extract-done による通過は機能する", () => {
    const cwd = makeProject();
    const transcript = join(cwd, "t.jsonl");
    copyFileSync(join(fixturesDir, "claude-no-candidate.jsonl"), transcript);

    // 1 回目の commit: 候補ゼロでチェックが自動通過し、checkpoint が書かれる。
    armSentinel(cwd, transcript);
    expect(
      runGate("git commit -m first", { cwd, transcriptPath: transcript, sessionId: SESSION })
        .status,
    ).toBe(0);
    expect(readdirSync(join(cwd, ".kaizen"))).toContain(`.extract-checkpoint.${SESSION}`);

    // 候補が積まれ、抽出は済んだが transcript を渡せず checkpoint を記録できなかった。
    appendFileSync(transcript, readFileSync(join(fixturesDir, "claude-candidate.jsonl"), "utf8"));
    armSentinel(cwd, transcript);
    completeExtraction(cwd, []);
    const files = readdirSync(join(cwd, ".kaizen"));
    expect(files).toContain(`.extract-done.${SESSION}`);
    // 起点を残すと、安全側の扱いがチェックに無視される。全走査として扱うため、起点を消す。
    expect(files).not.toContain(`.extract-checkpoint.${SESSION}`);

    armSentinel(cwd, transcript);
    const gate = runGate("git commit -m second", {
      cwd,
      transcriptPath: transcript,
      sessionId: SESSION,
    });
    expect(gate.status).toBe(0);
  });

  test("key を持たない旧形式のセンチネルは従来どおりマーカーが覆う", () => {
    const cwd = makeProject();
    const transcript = join(cwd, "t.jsonl");
    copyFileSync(join(fixturesDir, "claude-no-candidate.jsonl"), transcript);
    // key 無しの checkpoint は単一ファイルで、このセンチネルの transcript を指しているとは
    // 限らない。「新しい活動がある」の根拠にできないので、マーカーの効力を保つ。
    writeFileSync(join(cwd, ".kaizen", ".pending-extract"), "");
    writeFileSync(join(cwd, ".kaizen", ".extract-done"), "2026-01-01T00:00:00Z\n");
    writeFileSync(
      join(cwd, ".kaizen", ".extract-checkpoint"),
      `${join(cwd, "other.jsonl")}\n999\nclaude-code\n99\n`,
    );
    appendFileSync(transcript, readFileSync(join(fixturesDir, "claude-candidate.jsonl"), "utf8"));

    const gate = runGate("git commit -m x", { cwd, transcriptPath: transcript });
    expect(gate.status).toBe(0);
  });
});

describe("スキャナの判定はチェックの外部コマンド方言に依存しない", () => {
  test("チェックは sed の GNU 拡張（BRE の \\|）で agent を取り出さない", () => {
    const gnuAlternation = /sed[^\n]*\\\|/;
    // 検出されることの確認: 修正前の書き方を検出できることを先に示す（「該当なし」を根拠にするため）。
    expect("scan_agent=$(sed -n 's/^x=\\(claude-code\\|codex\\)$/\\1/p' <<<\"$out\")").toMatch(
      gnuAlternation,
    );

    const code = readFileSync(join(scriptsDir, "kaizen-precommit-gate.sh"), "utf8")
      .split("\n")
      .filter((line) => !/^\s*#/.test(line)) // 解説コメントは対象外（実行される sed だけを見る）
      .join("\n");
    expect(code).not.toMatch(gnuAlternation);
  });

  // GNU sed の --posix を BSD sed（POSIX BRE のみ）の代理にする。--posix を持たない sed の
  // 環境では代理を作れないので skip する（誤検出させない）。
  const realSed = spawnSync("bash", ["-c", "command -v sed"], { encoding: "utf8" }).stdout.trim();
  const posixSedAvailable =
    realSed !== "" &&
    spawnSync("bash", ["-c", `"${realSed}" --posix -n p </dev/null`]).status === 0;

  test.skipIf(!posixSedAvailable)("POSIX BRE しか持たない sed でも候補ゼロは自動通過する", () => {
    const shimDir = makeTempDir("kaizen-shim-");
    const callLog = join(shimDir, "calls.log");
    // 実体は絶対パスで呼ぶ（PATH 経由にすると自分自身を呼び戻して無限再帰する）。
    writeFileSync(
      join(shimDir, "sed"),
      `#!/usr/bin/env bash\necho called >>"${callLog}"\nexec "${realSed}" --posix "$@"\n`,
      { mode: 0o755 },
    );

    const cwd = makeProject();
    const transcript = join(cwd, "t.jsonl");
    copyFileSync(join(fixturesDir, "claude-no-candidate.jsonl"), transcript);
    writeFileSync(join(cwd, ".kaizen", ".pending-extract"), "");

    // 1 回目で checkpoint を作る（スキャナはここで初めて sed で checkpoint を読むようになる）。
    expect(runGate("git commit -m x", { cwd, transcriptPath: transcript }).status).toBe(0);
    writeFileSync(join(cwd, ".kaizen", ".pending-extract"), ""); // Stop フックによる再装填

    const gate = runGate("git commit -m x", {
      cwd,
      transcriptPath: transcript,
      env: { PATH: `${shimDir}:${process.env.PATH}` },
    });
    // 代理 sed が実際に処理の流れの中で使われたこと（この確認が無いと「sed を一切呼ばなかった」でも通る）。
    expect(readFileSync(callLog, "utf8")).toMatch(/called/);
    expect(gate.stderr).not.toMatch(/did not identify its agent/);
    expect(gate.status).toBe(0);
  });
});

describe("チェックの commit 検出", () => {
  // 未抽出センチネルがある状態では、commit と判定されれば exit 2（ブロック）になる。
  // `{P}` は実行時にプロジェクトルートへ置換する。`-C` / `--git-dir` / `--work-tree` で
  // コミット先を指定する形は、**プロジェクト内**を指していないとチェックの対象外（exit 0）に
  // なるため（Issue #221）、正規表現の到達性を測るここのケースはコミット先をプロジェクト内に置く。
  // 外部宛てになる条件そのものは「コミット先のスコープ判定」で測る。
  const cases = [
    ["git commit -m x", 2],
    ["git -C {P} commit -m x", 2],
    ["git --no-pager commit -m x", 2],
    ["git -c user.name=x -c user.email=y commit -m x", 2],
    ["git --no-pager -C {P} commit -m x", 2],
    ["cd /tmp && git -C {P} commit -m x", 2],
    // 引用符で囲まれた（空白を含む）オプション引数。
    ['git -C "{P}/a b" commit -m x', 2],
    ["git -C '{P}/a b' commit -m x", 2],
    ['git -c user.name="A B" commit -m x', 2],
    // ダブルクォート内のエスケープ。閉じ引用符を「次の "」とすると \" で早期に閉じ素通りする。
    ['git -c user.name="A \\"B\\"" commit -m x', 2],
    ['git -C "{P}/a \\"b\\"" commit -m x', 2],
    // backslash でエスケープされた空白。引用符だけを見ていると 1 引数として続かず素通りする。
    ["git -C {P}/tmp\\ a commit -m x", 2],
    ["git -c user.name=A\\ B commit -m x", 2],
    // 引用とエスケープの混在も 1 トークンとして続くこと。
    ['git -C {P}/"a b"/c\\ d commit -m x', 2],
    // 引数を取らないグローバルオプションの後ろのサブコマンドを「オプションの引数」として
    // 飲み込まないこと。飲み込むと次の語 `commit` にマッチし、読み取り専用コマンドを誤ブロックする。
    ["git --no-pager grep -n commit -- src/", 0],
    ["git --no-pager grep commit", 0],
    ["git --no-pager log commit", 0],
    ["git --no-pager show commit", 0],
    ["git --no-pager diff --stat commit", 0],
    ["git --paginate log commit", 0],
    // `--exec-path` は SYNOPSIS が `--exec-path[=<path>]` でも、値なし形は exec-path を出力して
    // 即 exit するだけで次の引数を消費しない（実測）。値を取るオプション扱いにすると `log` を
    // 飲んで次の `commit` にマッチし、同じ誤ブロックへ戻る。
    ["git --exec-path log commit", 0],
    // 値を別引数として取るオプションの引数は引き続き飲む（そこで止まると真陽性を落とす）。
    ["git --git-dir {P}/.git --work-tree {P} commit", 2],
    ["git --git-dir={P}/.git commit -m x", 2],
    // `=` 連結形の値も引用・エスケープで空白を含み得る。`-[^[:space:]]+` だけで拾うと引用の
    // 途中で切れ、続く語がオプションでないためオプション列が終わり `commit` へ到達しない
    // （素通り＝判定できないのに合格として扱う。修正前は実測で exit 0）。
    ['git --git-dir="{P}/a b/.git" commit -m x', 2],
    ["git --git-dir={P}/a\\ b/.git commit -m x", 2],
    ["git --git-dir='{P}/a b/.git' commit -m x", 2],
    ['git --work-tree="{P}/a b" commit -m x', 2],
    // `=` 連結形を 1 トークンとして飲んでも、非オプション語では止まる（過剰ブロックの回帰）。
    ['git --foo="a b" log commit', 0],
    ["git -c a=b -C {P} --no-pager commit -m x", 2],
    // エスケープを許しても非オプション語では止まる（過剰ブロックの回帰）。
    ["git log --grep commit", 0],
    ["echo git\\ commit", 0],
    ["git help commit", 0],
    ["man git commit", 0],
    ['echo "run git commit later"', 0],
    ["git log --oneline", 0],
    ['git stash push -m "commit wip"', 0],
    ["git config --get alias.commit", 0],
    // 区切り文字（`;` `&` `|` `(` ・改行）が**引用の内側**にある形。シェルはそこで
    // コマンドを区切らないので commit は実行されない。判定が引用状態を持たないと
    // リテラルの区切りを本物と読んで読み取り専用コマンドを誤ブロックする
    // （.kaizen/archive/2026-09-08-quoted-separator-must-not-trigger-command-gate.md）。
    //
    // どのケースも**引用を外せば BLOCK になる形**にしてある（区切りの直後が
    // マッチしうる `git` + サブコマンド）。引用対応を外すと下の 5 件が赤くなることを
    // 実測して、区別できることを確認した。対になる「引用の外の同じ区切り」を後ろに置き、
    // exit 0 が引用対応によるものか、検出の抜けかを切り分けられるようにする。
    ['echo "Bash(git commit *)"', 0],
    ["echo 'Bash(git commit *)'", 0],
    ['echo "x;git commit -m y"', 0],
    ["echo 'x && git commit -m y'", 0],
    ['echo "a|git commit -m y"', 0],
    // 引用の**外**の同じ区切りは従来どおり止める（引用対応のせいで合格として扱わない）。
    ["(git commit -m x)", 2],
    ["(cd {P} && git commit -m x)", 2],
    ['echo "quoted" ; git commit -m x', 2],
    ["echo 'quoted' && git commit -m x", 2],
    // シェルの引用規則が当たらない領域（コメント本文・heredoc 本文）。中の素の `'` を
    // 引用の開始として数えると、対を跨いだ範囲（本物の `git commit` を含む範囲）まで
    // マスクされて、チェックが素通りする。引用マスクからコメント／heredoc の扱いを外すと
    // 下の 2 件が exit 0 になることを実測して、区別できることを確認した。
    ["# don't\ngit commit -m x\n# won't", 2],
    ["cat <<EOF > f\ndon't\nEOF\ngit commit -m x\n# won't", 2],
    // コメントを潰しても、引用の内側の `#` と語中の `#` はコメントではない（過剰ブロックの回帰）。
    ['echo "Bash(git commit *) # matcher"', 0],
    ['echo "Bash(git commit *)" # matcher', 0],
    // コメント本文の中だけにある `git commit` は実行されない。
    ["# git commit -m x\ngit status", 0],
    // 二重引用符の**内側**でも、コマンド置換（`$( )` / `` ` ` ``）はシェルが展開する領域で、
    // 中身は実行されるコマンドである（Issue #345）。引用の内側を一律にリテラル扱いして潰すと
    // ここの `git commit` が検出から消え、**実際に実行されるコミットが素通りする**。
    // マスクからコマンド置換の扱いを外すと、下の 5 件が exit 0 になることを実測して、区別できることを確認した。
    ['echo "$(git commit -m x)"', 2],
    ['echo "`git commit -m x`"', 2],
    ['echo "$(echo "$(git commit -m x)")"', 2],
    ['echo "prefix $(cd {P} && git commit -m x) suffix"', 2],
    ["X=$(git commit -m x)", 2],
    // 引用の内側のコマンド置換をコピーしても、その中の**引用された**文字列は実行されない
    // （過剰ブロックの回帰。コピーした中身をそのまま区切り扱いしないこと）。
    [`echo "$(printf %s 'git commit')"`, 0],
    [`echo "$(echo ")" )"; echo ok`, 0],
    // 対応する `)` / `` ` `` を数え切れない形は heredoc と同じく判定不能なので、失敗として扱う。
    ['echo "$(git commit -m x"', 2],
    ['echo "`git commit -m x"', 2],
    // コマンド置換の中のコメントは行末まで。**コメント内の `)` は対応にならない**ので、
    // 素通りさせると早く閉じてしまい、その後ろに置かれた本物の `git commit` がマスク側で
    // 潰されて素通りする（合格として扱われる。cmdsub_span の `#` 分岐を外すと exit 0 になることを実測）。
    ['echo "$( # note )\ngit commit -m x\n)"', 2],
    // 対応する `)` がコメントに飲まれて行末が無い形は判定不能で、マスクせず元の文字列で判定する
    // （判定できないときは失敗として扱う）。元の文字列に見える `git commit` は従来どおり捕捉する。
    ['git commit -m "$( # note "', 2],
    // 語中の `#` はコメントではない（コメント扱いにして残りを飲むと逆に取りこぼす）。
    ["echo \"$(printf %s 'a#b')\"; git commit -m x", 2],
    // **コマンドの先頭は `;&|(` の直後だけではない。** `case` のパターンの `)` と複合コマンドの
    // `{` の直後もコマンド位置で、どれも実際にコミットを実行する（実測）。
    // `case` のパターンの `)` は対応する `(` を持たないので cmdsub_span の深さ計算では区別できず、
    // そこで閉じたと読むと、残りがマスクされて素通りする。mask_quoted 側では判定できないものとして扱い、
    // 区切りクラスにも `)` `{` を足す。**片側だけでは塞がらない**（判定できないときに使うのは
    // 元の文字列で、それを判定するのがこの正規表現のため）。
    ['echo "$(case x in x) git commit -m x;; esac)"', 2],
    ['echo "$(case x in a|b) echo hi;; *) git commit -m x;; esac)"', 2],
    ["case x in x) git commit -m x;; esac", 2],
    ['echo "$(f() { git commit -m x; }; f)"', 2],
    ["f() { git commit -m x; }; f", 2],
    ["{ git commit -m x; }", 2],
    // `)` が現れる他の文法は `(` と対になるので深さ計算で扱える（取りこぼしの回帰）。
    ['echo "$(( 1 + 2 ))"; git commit -m x', 2],
    ['echo "$( (git commit -m x) )"', 2],
    ["cat <(git commit -m x)", 2],
    // 過剰ブロックの回帰: `case` を含んでも commit が無ければ通る（判定できないときは元の文字列を
    // 使うだけで、区切りの直後に commit が無ければ一致しない）。
    ['echo "$(case x in x) echo hi;; esac)"', 0],
    // 語境界で見るので、`lowercase` / `testcase` は判定できないものとして扱わない。
    ['echo "$(echo lowercase)"', 0],
    ['echo "$(echo testcase)"', 0],
    ['echo "$(( 1 + 2 ))"', 0],
    ['echo "$(f() { echo hi; }; f)"', 0],
    // 置換の中身は「実行されるコマンド」だが、**その中の引用とコメントは実行されない**。
    // そのままコピーすると、リテラルに書かれた区切り文字を本物の区切りと読んで誤ブロックする
    // （実測: 下の 3 件はいずれも commit を実行しないのに exit 2 になっていた）。
    // 中身へ同じ規則を再帰で当て、実行される部分だけを残す。
    ["echo \"$(printf %s '; git commit -m x')\"", 0],
    ['echo "$(printf %s "; git commit -m x")"', 0],
    ['echo "$(echo hi # ; git commit -m x\n)"', 0],
    // 逆側の回帰: 再帰マスクで**実行される** commit を潰さない。
    ['echo "$(cd /tmp && git commit -m x)"', 2],
    // `echo "$(echo "$(git commit -m x)")"` は上の Issue #345 の組にある（同名のテストは名前で合否を判定できない）。
    // **行継続（`\` + 改行）はシェルが解析の前に取り除く。** 残したまま走査すると、トークンが
    // 継続で割れた形はどの正規表現にも当たらず素通りする（実測）。`git` / `commit` 自体が割れると
    // 生 JSON の prefilter（`*git*commit*`）でも外れるので、**prefilter と走査の両方**を
    // 直さないと塞がらない。
    ["ca\\\nse x in x) git commit -m x;; esac", 2],
    ['echo "$(ca\\\nse x in x) git commit -m x;; esac)"', 2],
    ["gi\\\nt commit -m x", 2],
    ["git com\\\nmit -m x", 2],
    ["gi\\\nt com\\\nmit -m x", 2],
    ["echo hi \\\n&& git commit -m x", 2],
    // `\\` + 改行は継続ではない（エスケープされた `\` の直後の改行）。消すと次のコマンドが
    // 前のコマンドと繋がって区切り判定から外れる（判定できないのに合格として扱われる）。
    ["echo a\\\\\ngit commit -m x", 2],
    // 過剰ブロックの回帰: 継続があっても commit が無ければ通る。
    ["echo a \\\n b", 0],
    ['echo "a\\\nb"', 0],
    ["ec\\\nho hello", 0],
    // **`case` は予約語として現れたときだけ区別できないものとして扱う。** 語として含むかどうかで判定すると、
    // 引数に書かれた `case` でも判定できないものとして扱われ、マスクを丸ごと捨ててしまう。
    // その結果、同じコマンド行の引用された `; git commit -m x` が実行されるものとして読まれ、誤ブロックになる（実測）。
    // `echo "$(printf %s case)" ...` は下の「`in` が続かない `case`」の組にある（同名のテストを作らない）。
    ['echo "$(printf %s \'case\')" "; git commit -m x"', 0],
    ['echo "$(printf %s lowercase)" "; git commit -m x"', 0],
    // 予約語が置ける位置（行頭・`;` `(` `{` ・改行の直後）は、いずれも判定できないものとして扱う。
    ['echo "$(echo hi; case x in x) git commit -m x;; esac)"', 2],
    ['echo "$( (case x in x) git commit -m x;; esac) )"', 2],
    ['echo "$({ case x in x) git commit -m x;; esac; })"', 2],
    ['echo "$(echo hi\ncase x in x) git commit -m x;; esac)"', 2],
    // **コマンド位置は記号の区切りだけではない。** 予約語（`then` / `else` / `elif` / `do` /
    // `while` / `until` / `!` …）の直後もコマンドの先頭で、いずれも実際に実行される（実測）。
    // 予約語は連なれるので、繰り返し可能な前置きとして扱う。
    ['echo "$(if true; then case x in x) git commit -m x;; esac; fi)"', 2],
    ['echo "$(if false; then :; else case x in x) git commit -m x;; esac; fi)"', 2],
    ['echo "$(if false; then :; elif true; then case x in x) git commit -m x;; esac; fi)"', 2],
    ['echo "$(for i in 1; do case x in x) git commit -m x;; esac; done)"', 2],
    ['echo "$(while case x in x) git commit -m x;; esac; do break; done)"', 2],
    ['echo "$(until case x in x) git commit -m x;; esac; do break; done)"', 2],
    ['echo "$(! case x in x) git commit -m x;; esac)"', 2],
    ['echo "$(true && while case x in x) git commit -m x;; esac; do break; done)"', 2],
    // 予約語も、引数として書かれたときは判定できないものとして扱わない（過剰ブロックの回帰）。
    ['echo "$(printf %s then)" "; git commit -m x"', 0],
    ['echo "$(printf %s then case)" "; git commit -m x"', 0],
    // **判定は `case` の「位置」ではなく「構文」で行う。** コマンド位置は記号の区切りにも
    // 予約語の直後にも**関数宣言子の直後**にも現れ、位置の列挙は 4 ラウンドで 10 形破られた。
    // 不均衡な `)` を持ち込むのは `case WORD in` という構文そのものなので、そちらを直接見る。
    ['echo "$(f() case x in x) git commit -m x;; esac; f)"', 2],
    ['echo "$(function f() case x in x) git commit -m x;; esac; f)"', 2],
    // `in` が続かない `case` は構文ではないので、判定できないものとして扱わない（過剰ブロックの回帰）。
    ['echo "$(printf %s case)" "; git commit -m x"', 0],
    ['echo "$(printf %s testcase)" "; git commit -m x"', 0],
    // 引用の内側は別の分岐が消費するのでこの検査に渡らない。
    ['echo "$(printf %s \'case x in\')" "; git commit -m x"', 0],
    // `for .. in` は `case` を持たないので当たらない。
    ['echo "$(for i in 1 2; do echo $i; done)"', 0],
  ];

  test.each(cases)("%s => exit %i", (command, expected) => {
    const cwd = makeProject();
    writeFileSync(join(cwd, ".kaizen", ".pending-extract"), "");
    expect(runGate(command.replaceAll("{P}", cwd), { cwd }).status).toBe(expected);
  });
});

// コミット先がプロジェクト外のリポジトリだとコマンド行から分かる呼び出しは、チェックの対象に
// しない（Issue #221）。テストのフィクスチャとして使い捨ての一時リポジトリへコミットする形まで
// 止めると、抽出を求めている「このプロジェクトの活動」と無関係な commit が実行できなくなる。
// ここが緩むとプロジェクト宛ての commit を素通しし（合格として扱い）、きつくなると元の不具合へ戻る。
// 外部宛てのケースはいずれも「プロジェクト内を指す同形のケース」を下の blocked 側に持つ。
// 同形の対（同じオプション・同じ引用形で、違うのはコミット先だけ）が両方あって初めて、
// exit 0 が「スコープ判定で外した」のか「commit として検出できていない」のかを区別できる。
describe("コミット先のスコープ判定", () => {
  // プロジェクト（`makeProject()` の mkdtemp）の外側にある一意なパス。`/tmp` 直書きだと
  // 既存ディレクトリ・リポジトリと衝突してスコープ判定が変わり得る（`tmpdir()` は環境で異なる）。
  const FIXTURE = join(tmpdir(), `kaizen-gate-external-221-${process.pid}`);
  const SPACE_NAME = `kaizen gate external ${process.pid}`;
  const SPACE_FIXTURE = join(tmpdir(), SPACE_NAME);
  const ESCAPED_SPACE_FIXTURE = SPACE_FIXTURE.replaceAll(" ", "\\ ");
  const ESCAPED_SPACE_NAME = SPACE_NAME.replaceAll(" ", "\\ ");

  const external = [
    `git -C ${FIXTURE} commit -qm base`,
    `git --git-dir=${FIXTURE}/.git --work-tree=${FIXTURE} commit -qm base`,
    `git --git-dir ${FIXTURE}/.git commit -m x`,
    // `=` 連結形で引用・エスケープにより空白を含む値。
    `git --git-dir="${SPACE_FIXTURE}/.git" commit -m x`,
    `git --git-dir=${ESCAPED_SPACE_FIXTURE}/.git commit -m x`,
    `git --git-dir='${SPACE_FIXTURE}/.git' commit -m x`,
    // フィクスチャは 1 行で作られるので、フックが実行される時点では対象がまだ存在しない。
    `git init ${FIXTURE} && git -C ${FIXTURE} add a.txt && git -C ${FIXTURE} commit -m base`,
    // 引用・エスケープを含むコミット先も、外した結果が同じであること。
    `git -C "${SPACE_FIXTURE}" commit -m x`,
    `git -C ${ESCAPED_SPACE_FIXTURE} commit -m x`,
    // `--git-dir` と併記した `--work-tree` は、リポジトリが外部だと確定するので対象外。
    `git --git-dir=${FIXTURE}/.git --work-tree ${FIXTURE} commit -m x`,
    // `cd` があっても、絶対パス指定なら cwd に依存しないので判定できる。
    `cd ${tmpdir()} && git -C ${FIXTURE} commit -m x`,
    // 区切り直後に空白を入れない形。commit_re は捕捉するので、オプション列の解析も
    // 区切り文字から始まる部分文字列を受けられなければならない（さもないと判定不能＝ブロック）。
    `ls;git -C ${FIXTURE} commit -m x`,
    `ls&&git -C ${FIXTURE} commit -m x`,
    // glob メタ文字を含む引数があっても、外部宛ての判定自体は成立する（上の対）。
    `git -c user.name=A*B -C ${FIXTURE} commit -m a`,
    // `-C` の繰り返しは累積して相対解決される（/tmp + 相対 = プロジェクト外）。
    `git -C ${dirname(FIXTURE)} -C ${basename(FIXTURE)} commit -m x`,
    // **区切りの集合は commit_re と git_head_re で揃える。** commit_re 側だけ広げると、
    // 広げた区切りで一致した形をスコープ判定が解析できない。すると、外部宛ての免除が機能しないまま
    // 誤ブロックになる（実測）。`)` と `{` は直後に空白が入るので、従来の `[[:space:]]` で
    // 拾えていた。しかし `` ` `` は空白を挟まないので拾えなかった。
    `echo "\`git -C ${FIXTURE} commit -m x\`"`,
    `case x in x) git -C ${FIXTURE} commit -m x;; esac`,
    `{ git -C ${FIXTURE} commit -m x; }`,
  ];

  test.each(external)("外部宛て: %s => exit 0", (command) => {
    const cwd = makeProject();
    writeFileSync(join(cwd, ".kaizen", ".pending-extract"), "");
    expect(runGate(command, { cwd }).status).toBe(0);
  });

  const blocked = [
    // コミット先を指定しない＝コマンド行からは決まらない（従来どおりブロック）。
    "git commit -m x",
    `cd ${FIXTURE} && git commit -m x`,
    // プロジェクト内を指す形（上の外部宛てケースと同形の対）。
    "git -C . commit -m x",
    "git -C {P} commit -m x",
    "git -C {P}/sub commit -m x",
    "git --git-dir={P}/.git --work-tree={P} commit -qm base",
    "git --git-dir {P}/.git commit -m x",
    'git --git-dir="{P}/{SPACE}/.git" commit -m x',
    "git --git-dir={P}/{ESCAPED_SPACE}/.git commit -m x",
    "git --git-dir='{P}/{SPACE}/.git' commit -m x",
    // `--work-tree` 単独は外部パスでも判定不能（リポジトリは cwd から探索される）。
    `git --work-tree="${SPACE_FIXTURE}" commit -m x`,
    // コミット先 repo は外部でも、作業ツリーがプロジェクトならコミットされる内容はこの
    // プロジェクトの活動そのもの。意図的に安全側（ブロック）として扱う。
    `git --git-dir=${FIXTURE}/.git --work-tree={P} commit -m x`,
    `git -C ${FIXTURE} --work-tree={P} commit -m x`,
    `git init ${FIXTURE} && git -C ${FIXTURE} add a.txt && git commit -m base`,
    'git -C "{P}/{SPACE}" commit -m x',
    "git -C {P}/{ESCAPED_SPACE} commit -m x",
    "git -C {PARENT} -C {BASE} commit -m x",
    // 区切り直後に空白が無くてもプロジェクト宛ては見落とさない（上の対）。
    "ls;git -C {P} commit -m x",
    "ls&&git -C {P} commit -m x",
    // 展開しないと値が決まらないパスは判定不能（失敗として扱う）。外部宛てと同形だが通してはいけない。
    "git -C $FIXTURE commit -m x",
    'git -C "$(mktemp -d)" commit -m x',
    "git -C /tmp/kaizen-gate-*/fixture commit -m x",
    // `--work-tree` は作業ツリーだけを差し替え、リポジトリは cwd からの探索で決まる。
    // 外部を指していてもコミット先はプロジェクトのリポジトリなので通してはいけない。
    `git --work-tree=${FIXTURE} commit -m x`,
    `git --work-tree ${FIXTURE} commit -am x`,
    // `cd` があると git を実行する cwd が確定しないので、相対パス指定は判定不能。
    "cd /tmp && git -C fixture commit -m x",
    // 1 行に複数の commit。先頭が外部宛てでも、後続のプロジェクト宛てを見落とさない。
    `git -C ${FIXTURE} commit -m a && git commit -m b`,
    // 走査位置の算出はマッチ文字列を**リテラル**として扱う必要がある。パターン展開になると
    // パス以外の引数（`-c` の値など）の glob メタ文字がマッチ範囲を広げ、後続の commit を
    // 見落として素通りする（合格として扱われる）。
    `git -c user.name=A*B -C ${FIXTURE} commit -m a && git commit -m b`,
    `git -c user.name=A?B -C ${FIXTURE} commit -m a && git commit -m b`,
    `git -c user.name=A[b]B -C ${FIXTURE} commit -m a && git commit -m b`,
  ];

  test.each(blocked)("プロジェクト宛て・判定不能: %s => exit 2", (command) => {
    const cwd = makeProject();
    writeFileSync(join(cwd, ".kaizen", ".pending-extract"), "");
    const resolved = command
      .replaceAll("{P}", cwd)
      .replaceAll("{PARENT}", dirname(cwd))
      .replaceAll("{BASE}", basename(cwd))
      .replaceAll("{ESCAPED_SPACE}", ESCAPED_SPACE_NAME)
      .replaceAll("{SPACE}", SPACE_NAME);
    expect(runGate(resolved, { cwd }).status).toBe(2);
  });

  // 同じリポジトリの別 worktree はプロジェクトルートの外に置かれる。パスの包含だけで判定すると
  // 外部宛てに見えるが、コミット先はこのプロジェクトそのものなのでブロックしなければならない。
  test("同一リポジトリの別 worktree 宛ては外部扱いにしない", () => {
    const root = makeTempDir("kaizen-wt-");
    const main = join(root, "main");
    const linked = join(root, "linked");
    mkdirSync(main);
    mkdirSync(join(main, ".kaizen"));
    writeFileSync(join(main, ".kaizen", ".pending-extract"), "");
    const git = (args, cwd) =>
      spawnSync("git", args, {
        cwd,
        encoding: "utf8",
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "t",
          GIT_AUTHOR_EMAIL: "t@e",
          GIT_COMMITTER_NAME: "t",
          GIT_COMMITTER_EMAIL: "t@e",
        },
      });
    expect(git(["init", "-q", "."], main).status).toBe(0);
    expect(git(["commit", "-q", "--allow-empty", "-m", "init"], main).status).toBe(0);
    expect(git(["worktree", "add", "-q", linked, "-b", "wt"], main).status).toBe(0);

    expect(runGate(`git -C ${linked} commit -m x`, { cwd: main }).status).toBe(2);
    // linked worktree の `.git` は**ファイル**（`gitdir: <path>`）。`-d` 前提で共有 git ディレクトリを
    // 探すと解決できず、同一リポジトリ判定が抜けて外部宛て扱いで素通りする（合格として扱われる。実測）。
    expect(statSync(join(linked, ".git")).isFile()).toBe(true);
    expect(runGate(`git --git-dir=${linked}/.git commit -m x`, { cwd: main }).status).toBe(2);
    expect(
      runGate(`git --git-dir=${linked}/.git --work-tree=${linked} commit -m x`, { cwd: main })
        .status,
    ).toBe(2);
    // 別リポジトリなら同じ形でも素通りする（この対がないと「常にブロック」でも pass してしまう）。
    const other = join(root, "other");
    mkdirSync(other);
    expect(git(["init", "-q", "."], other).status).toBe(0);
    expect(runGate(`git -C ${other} commit -m x`, { cwd: main }).status).toBe(0);
    expect(runGate(`git --git-dir=${other}/.git commit -m x`, { cwd: main }).status).toBe(0);
  });
});

// jq も python3 も無い環境では、チェックは Hook 入力を構造として読めない。そのため、生 JSON を直接照合する
// 機能を減らした処理で判定する。この処理は普段の開発機では絶対に通らないため、誤っていても気づけない。
// commit 判定は jq を使う処理と同じ結論でなければならない（ここが緩むと合格として扱われ、きつくなると誤ブロックになる）。
// ただしコミット先のスコープ判定（Issue #221）だけは**意図的に差がある**。この処理はコマンド行を
// 構造として取り出せていないため外部宛てを確定できず、`git -C <外部> commit` も従来どおりブロックする。
describe("生 JSON だけで判定するときの commit 検出", () => {
  /** jq / python3 だけを解決できない PATH を作る（他のコマンドは実体へ通す）。 */
  function makeJqlessPathDir() {
    const dir = makeSharedTempDir("kaizen-nojq-");
    // チェック本体と kaizen-status-check.sh が使う外部コマンドは通す。ここが欠けると
    // 「機能を減らした処理で正しく判定した」ではなく「別の理由で失敗した」を測ってしまう。
    // `dirname` は両スクリプトが script_dir の解決に使う。外すと script_dir を解決できず、
    // commit 判定より手前の「bundled kaizen-status-check.sh is unavailable」で exit 2 になり、
    // 期待値 2 のケースが全部その理由で通ってしまう（lifecycle 検査以降を一切検証しない）。
    for (const tool of [
      "bash",
      "sed",
      "awk",
      "basename",
      "dirname",
      "tr",
      "cat",
      "timeout",
      "git",
    ]) {
      const path = spawnSync("bash", ["-c", `command -v ${tool}`], {
        encoding: "utf8",
      }).stdout.trim();
      if (path) symlinkSync(path, join(dir, tool));
    }
    return dir;
  }

  const jqlessPath = makeJqlessPathDir();

  // この処理を本当に通したことの確認。jq か python3 が解決できてしまうと、
  // チェックは構造化した入力を読む処理を通り、以下のケースは機能を減らした処理を一切検証しないまま全て pass する。
  test("PATH から jq / python3 が解決できないこと", () => {
    for (const tool of ["jq", "python3", "python"]) {
      const probe = spawnSync("bash", ["-c", `command -v ${tool}`], {
        env: { ...process.env, PATH: jqlessPath },
        encoding: "utf8",
      });
      expect(probe.status).not.toBe(0);
    }
  });

  const cases = [
    // 区切りの後ろの commit。値の先頭だけに錨を打っていた頃は取りこぼしていた（合格として扱われた）。
    ["cd /tmp && git commit -m x", 2],
    ["make build; git commit -m x", 2],
    ["ls | xargs git commit", 2],
    ["(git commit -m x)", 2],
    ["git add -A && git -C /tmp commit -m x", 2],
    // 外部宛てのスコープ判定は、この処理では行わない（構造化した入力を読む処理なら 0 になる形も 2 のまま）。
    ["git -C /tmp/kaizen-gate-external-221 commit -qm base", 2],
    ["git --git-dir=/tmp/kaizen-gate-external-221/.git commit -m x", 2],
    ["cd /tmp; git --no-pager commit -m x", 2],
    // JSON では改行が `\n` の 2 文字として現れる。リテラルの区切りだけを見ていると取りこぼす。
    ["cd /tmp\ngit commit -m x", 2],
    // 行継続（`\` ＋ 改行）で割れたトークン（Issue #409）。シェルは継続を取り除いてから実行するのに、
    // 生 JSON には `git` も `commit` も揃って現れず、この処理だけ素通りしていた（実測）。
    ["gi\\\nt commit -m x", 2],
    ["git com\\\nmit -m x", 2],
    ["cd /tmp && gi\\\nt commit -m x", 2],
    // 継続でない `\\` ＋ 改行（エスケープされた `\` の直後の改行）。改行は本物の区切りなので、
    // 詰めたコピーだけを見ていると区切りが消えて素通りする。元の入力側で捕まえる。
    ["echo a\\\\\ngit commit -m x", 2],
    // 継続で `git` と繋がって別の語になる形は commit ではない（過剰ブロックにしない）。
    ["echo a\\\ngit log", 0],
    // 先頭の commit（従来から捕捉できていた形）。
    ["git commit -m x", 2],
    ["git -C /tmp commit -m x", 2],
    // 区切りを許しても、過剰ブロックにならないこと。
    ["echo hi; echo git commit", 0],
    ['echo "run git commit later"', 0],
    ["git log; git status", 0],
    ["grep -rn commit src/ | head", 0],
    ["cd /tmp && git --no-pager grep commit", 0],
    ["git --no-pager log commit", 0],
    ["git help commit", 0],
  ];

  test.each(cases)("生 JSON: %s => exit %i", (command, expected) => {
    const cwd = makeProject();
    writeFileSync(join(cwd, ".kaizen", ".pending-extract"), "");
    const result = runGate(command, { cwd, env: { PATH: jqlessPath } });
    expect(result.status).toBe(expected);
    if (expected === 2) {
      // 機能を減らす PATH に必要なコマンドが欠けると、commit 判定より手前の環境エラーでも exit 2 に
      // なる。それでは「機能を減らした処理が commit を検出した」を測ったことにならないので、
      // ブロック理由が未抽出センチネル由来であることまで固定する。
      expect(result.stderr).not.toMatch(/unavailable|command not found/);
      expect(result.stderr).toContain("kaizen --current");
    }
  });
});

describe("lifecycle 検査", () => {
  function writeNote(cwd, name, body) {
    writeFileSync(join(cwd, ".kaizen", name), body);
  }

  const note = (status, appliedTo) =>
    `---\ndate: 2026-08-10\ntype: rule\nstatus: ${status}\npriority: high\napplied-to:${appliedTo}\n---\n\n# note\n`;

  test.skipIf(process.getuid?.() === 0)(
    "読めないノートがあっても残りのノートを検査し、原因を名指しする",
    () => {
      const cwd = makeProject();
      writeNote(cwd, "2026-08-10-a-unreadable.md", note("applied", ' ["AGENTS.md"]'));
      chmodSync(join(cwd, ".kaizen", "2026-08-10-a-unreadable.md"), 0o000);
      writeNote(cwd, "2026-08-10-b-broken.md", note("applied", " []"));

      const check = runScript("kaizen-status-check.sh", [], { cwd });
      expect(check.status).toBe(2);
      expect(check.stderr).toMatch(/2026-08-10-a-unreadable\.md: could not read the frontmatter/);
      // 失敗理由は権限とは限らないので、awk の診断を捨てずに添える（原因の切り分けに要る）。
      expect(check.stderr).toMatch(/could not read the frontmatter: .*Permission denied/);
      expect(check.stderr).toMatch(
        /2026-08-10-b-broken\.md: status is applied but applied-to is empty/,
      );
      chmodSync(join(cwd, ".kaizen", "2026-08-10-a-unreadable.md"), 0o644);
    },
  );

  // Markdown フォーマッタが applied-to の flow 配列を折り返しても判定が変わらないこと。
  const appliedToCases = [
    ["1 行の flow 配列", "applied", ' ["AGENTS.md", "docs/a.md"]', 0, null],
    ["折り返された flow 配列", "applied", '\n  ["AGENTS.md", "docs/a.md"]', 0, null],
    [
      "複数行に割れた flow 配列",
      "applied",
      '\n  [\n    "AGENTS.md",\n    "docs/a.md",\n  ]',
      0,
      null,
    ],
    ["折り返された空配列", "applied", "\n  [\n  ]", 2, /applied-to is empty/],
    ["ブロックリスト", "applied", "\n  - AGENTS.md", 0, null],
    [
      "pending × 折り返し非空",
      "pending",
      '\n  ["AGENTS.md"]',
      2,
      /applied-to is set but status is pending/,
    ],
    ["pending × 空配列", "pending", " []", 0, null],
  ];

  test.each(appliedToCases)(
    "applied-to: %s",
    (_label, status, appliedTo, expected, stderrPattern) => {
      const cwd = makeProject();
      writeNote(cwd, "2026-08-10-note.md", note(status, appliedTo));
      const check = runScript("kaizen-status-check.sh", [], { cwd });
      expect(check.status).toBe(expected);
      if (stderrPattern) expect(check.stderr).toMatch(stderrPattern);
    },
  );

  // 警告（rc 0）は、チェックの出力から外れやすい。チェックは検査の出力を変数へ取り込む。
  // さらに、**PreToolUse フックの stderr は非 0 で終えたときしか表示されない**。そのため、素通りの
  // exit 0 のまま stderr へ書いても誰にも届かない（`references/setup.md` に出典付きで
  // 書いてある仕様。他セッションの警告が warn_exit_code を使っているのと同じ理由）。
  // 状態空間は、検査の rc × 出力の有無 × チェックの出口である。
  //   - rc 2 × 出力あり            → 出す・exit 2（既存の appliedToCases が押さえている）
  //   - rc 0 × 出力あり × 素通り   → 出す・exit 1（表示される非 0）  ← ここ
  //   - rc 0 × 出力なし × 素通り   → 何も足さない・exit 0            ← ここ
  //   - rc 0 × 出力あり × -copilot → 出す・exit 0（非 0 は誤って deny として扱われるため）← ここ
  test("lifecycle 検査の警告は commit を止めずに出る", () => {
    const cwd = makeProject();
    // type は機構（hook）なのに applied-to がドキュメントだけ = Issue #341 の警告。
    writeNote(
      cwd,
      "2026-08-10-docs-only.md",
      '---\ndate: 2026-08-10\ntype: hook\nstatus: applied\npriority: high\napplied-to: ["AGENTS.md"]\n---\n\n# note\n',
    );

    const check = runScript("kaizen-status-check.sh", [], { cwd });
    expect(check.status).toBe(0);
    expect(check.stderr).toMatch(/warning: type is hook/);

    // exit 1 = 「ブロックしない失敗」。これでフックランナーが stderr を表示する。
    // 0 のままだと、この assertion が見ている stderr は子プロセスから直接読めても
    // 利用者には届かない。
    const gate = runGate("git commit -m x", { cwd });
    expect(gate.status).toBe(1);
    expect(gate.stderr).toMatch(/warning: type is hook/);
  });

  test("検査と無関係な stderr は警告として扱わない", () => {
    // status_output は 2>&1 なので子プロセスの無関係な stderr も入る。非空で判定すると
    // 警告 0 件でも非 0 になり、ロケールが不正な環境では毎コミットが恒久的に非 0 になる。
    const cwd = makeProject();
    writeNote(cwd, "2026-08-10-note.md", note("applied", ' ["AGENTS.md"]'));

    // 検出されることの確認: この環境変数で bash が実際に stderr へ警告を出すことを確かめる。
    // 出ていなければ、この後の exit 0 は「雑音を無視できた」の証拠にならない。
    const noise = spawnSync("bash", ["-c", "true"], {
      encoding: "utf8",
      env: { ...process.env, LC_ALL: "xx_YY.UTF-8" },
    });
    expect(noise.stderr).toMatch(/setlocale/);

    const gate = runGate("git commit -m x", { cwd, env: { LC_ALL: "xx_YY.UTF-8" } });
    expect(gate.status).toBe(0);
    expect(gate.stderr).not.toMatch(/kaizen-status-check:/);
  });

  test("雑音に紛れていても警告は拾う", () => {
    // 上の裏返し。雑音を落とす実装が、警告まで落としていないことを確かめる。
    const cwd = makeProject();
    writeNote(
      cwd,
      "2026-08-10-docs-only.md",
      '---\ndate: 2026-08-10\ntype: hook\nstatus: applied\npriority: high\napplied-to: ["AGENTS.md"]\n---\n\n# note\n',
    );

    const gate = runGate("git commit -m x", { cwd, env: { LC_ALL: "xx_YY.UTF-8" } });
    expect(gate.status).toBe(1);
    expect(gate.stderr).toMatch(/warning: type is hook/);
  });

  test("Copilot では警告でも exit 0 にする", () => {
    // Copilot の preToolUse は exit 2 以外の非 0 をすべて deny にするため、警告の
    // 終了コードを 1 にすると commit そのものが拒否される（しかも理由が hook errored）。
    const cwd = makeProject();
    writeNote(
      cwd,
      "2026-08-10-docs-only.md",
      '---\ndate: 2026-08-10\ntype: hook\nstatus: applied\npriority: high\napplied-to: ["AGENTS.md"]\n---\n\n# note\n',
    );

    const input = JSON.stringify({ tool_input: { command: "git commit -m x" } });
    const gate = spawnSync("bash", [join(scriptsDir, "kaizen-precommit-gate.sh"), "-copilot"], {
      cwd,
      input,
      encoding: "utf8",
      env: { ...process.env, CLAUDE_PROJECT_DIR: cwd },
    });
    expect(gate.status).toBe(0);
    expect(gate.stderr).toMatch(/warning: type is hook/);
  });

  test("警告が無ければチェックは検査の出力を足さない", () => {
    const cwd = makeProject();
    writeNote(cwd, "2026-08-10-note.md", note("applied", ' ["AGENTS.md"]'));

    const check = runScript("kaizen-status-check.sh", [], { cwd });
    expect(check.status).toBe(0);
    expect(check.stderr).toBe("");

    const gate = runGate("git commit -m x", { cwd });
    expect(gate.status).toBe(0);
    expect(gate.stderr).toBe("");
  });
});

// transcript を「一度も記録していない」センチネル（`/compact` 専用の隠しセッションのように
// transcript を一度も作らないまま Stop が実行された場合。Issue #240）は、案内どおりに探しても
// 見つからない。「記録はあるが今は読めない」（移動・削除済み）とは対処が違うので、案内が
// 両者を混同していないことを固定する。
describe("未抽出センチネルの復旧案内は「記録なし」と「記録はあるが読めない」を区別する", () => {
  function writeSentinel(cwd, key, transcriptLine) {
    writeFileSync(
      join(cwd, ".kaizen", `.pending-extract.${key}`),
      `2026-08-27T21:54:39Z\n${transcriptLine}\nclaude-code\n${key}\n`,
    );
  }

  test("transcript の記録が無い場合は、transcript 無しで解消するコマンドも提示する", () => {
    const cwd = makeProject();
    writeSentinel(cwd, "other-session-1", "");
    const gate = runGate("git commit -m x", { cwd });
    expect(gate.status).toBe(2);
    expect(gate.stderr).toMatch(/transcript の記録がありません/);
    expect(gate.stderr).not.toMatch(/センチネルが記録した transcript を読めません/);
    // 「見つからない場合」の解消コマンドは transcript 引数を伴わない。
    expect(gate.stderr).toMatch(
      /探しても見つからない場合は、transcript を指定せず次のコマンドで解消してください:\n\s*bash "[^"]+\/kaizen-extract-done\.sh" --sentinel-suffix "" --agent "claude-code" --session-id "other-session-1"\n/,
    );
    // 「記録なし」の場合はプレースホルダ無しのコマンドで解消が完結するため、"<transcript> を
    // 置き換えてください" という書き換え必須の注意書きは出ない（出ると、常に書き換えが要ると誤解される）。
    expect(gate.stderr).not.toMatch(/<transcript> だけを.*置き換えてください/);
  });

  test("transcript が実在するのに読めない場合は、探して抽出する案内だけを出す", () => {
    const cwd = makeProject();
    const unreadable = join(cwd, "unreadable.jsonl");
    writeFileSync(unreadable, "{}\n");
    chmodSync(unreadable, 0o000);
    writeSentinel(cwd, "other-session-2", unreadable);
    try {
      const gate = runGate("git commit -m x", { cwd });
      expect(gate.status).toBe(2);
      expect(gate.stderr).toMatch(/センチネルが記録した transcript を読めません/);
      expect(gate.stderr).not.toMatch(/transcript の記録がありません/);
      expect(gate.stderr).not.toMatch(/transcript を指定せず次のコマンドで解消してください/);
      // このケースは <transcript> の書き換えが必須の唯一の解消コマンドなので、注意書きが出る。
      expect(gate.stderr).toMatch(/<transcript> だけを.*置き換えてください/);
    } finally {
      chmodSync(unreadable, 0o644);
    }
  });

  // 記録された transcript が**実在しない**（剪定・削除・移動）ケース。探しても見つからないので、
  // 「実在するが読めない」と同じ案内として扱うと、解消手段が無い恒久的なブロッカーになる。
  // Issue #244 で抽出済みセッションのセンチネルもマーカーに覆われなくなったため、
  // transcript が剪定された旧セッションの残骸としてこの状態に到達しやすくなった。
  test("transcript の記録が実在しない場合は、transcript 無しで解消するコマンドも提示する", () => {
    const cwd = makeProject();
    const pruned = join(cwd, "pruned.jsonl"); // 作らない
    writeSentinel(cwd, "other-session-3", pruned);
    const gate = runGate("git commit -m x", { cwd });
    expect(gate.status).toBe(2);
    expect(gate.stderr).toMatch(/センチネルが記録した transcript が実在しません/);
    expect(gate.stderr).not.toMatch(/センチネルが記録した transcript を読めません/);
    expect(gate.stderr).toMatch(
      /探しても見つからない場合は、transcript を指定せず次のコマンドで解消してください:\n\s*bash "[^"]+\/kaizen-extract-done\.sh" --sentinel-suffix "" --agent "claude-code" --session-id "other-session-3"\n/,
    );
    // 書き換え必須の注意書きは出ない（transcript 無しの解消コマンドで完結するため）。
    expect(gate.stderr).not.toMatch(/<transcript> だけを.*置き換えてください/);
  });

  test("unsafe な transcript 値と同名のパスが実在しても権限・FS 問題に誤分類しない", () => {
    const cwd = makeProject();
    const unsafe = join(cwd, "unsafe$path.jsonl");
    writeFileSync(unsafe, "{}\n");
    writeSentinel(cwd, "other-session-4", unsafe);

    const gate = runGate("git commit -m x", { cwd });
    expect(gate.status).toBe(2);
    expect(gate.stderr).toMatch(/値が不正/);
    expect(gate.stderr).not.toMatch(/センチネルが記録した transcript を読めません/);
    expect(gate.stderr).toMatch(/transcript を指定せず次のコマンドで解消してください/);
    expect(gate.stderr).not.toMatch(/<transcript> だけを.*置き換えてください/);
  });
});

// 制御ファイル（センチネル・checkpoint・抽出完了マーカー）の置き場は作業ディレクトリから決まる。
// セッションが共有ツリーで始まって git worktree で続くと、センチネルを立てたツリーと `git commit`
// を実行するツリーが分かれ、自分のツリーの `.kaizen/` しか見ない形では **worktree の commit が
// 素通りする**（Issue #344）。素通りは出力にも終了コードにも現れないので、決定論的に押さえる。
describe("チェックはリポジトリの全作業ツリーの .kaizen/ を見る", () => {
  const SESSION = "00000000-1111-2222-3333-444444444444";

  /** 本体 ＋ worktree を 1 つ持つリポジトリを作る。*/
  function makeRepoWithWorktree() {
    const root = makeTempDir("kaizen-wt-");
    const main = join(root, "main");
    mkdirSync(main);
    const git = (args, cwd = main) => {
      const r = spawnSync("git", args, { cwd, encoding: "utf8" });
      expect(r.status, r.stderr).toBe(0);
      return r;
    };
    git(["init", "-q", "."]);
    git(["config", "user.email", "r@example.com"]);
    git(["config", "user.name", "repro"]);
    writeFileSync(join(main, "seed"), "");
    git(["add", "seed"]);
    git(["-c", "commit.gpgsign=false", "commit", "-q", "-m", "seed"]);
    mkdirSync(join(main, ".kaizen"));
    const worktree = join(root, "wt");
    git(["worktree", "add", "-q", "-b", "wtbranch", worktree]);
    return { main, worktree };
  }

  function writeSentinel(dir) {
    mkdirSync(join(dir, ".kaizen"), { recursive: true });
    writeFileSync(
      join(dir, ".kaizen", `.pending-extract.${SESSION}`),
      `2026-09-11T12:27:31Z\n\nclaude-code\n${SESSION}\n`,
    );
  }

  // CLAUDE_PROJECT_DIR は共有ツリーのまま（セッションの起点）にし、payload の cwd だけを
  // worktree にする＝Issue #344 が報告した実際の並びを作る。
  function runGateAt(cwd, projectDir) {
    const input = JSON.stringify({
      session_id: SESSION,
      cwd,
      tool_input: { command: "git commit -m x" },
    });
    return spawnSync("bash", [join(scriptsDir, "kaizen-precommit-gate.sh")], {
      cwd,
      input,
      encoding: "utf8",
      env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
    });
  }

  test("共有ツリーに立ったセンチネルは worktree からの commit も止める", () => {
    const { main, worktree } = makeRepoWithWorktree();
    writeSentinel(main);
    expect(runGateAt(main, main).status).toBe(2);
    expect(runGateAt(worktree, main).status).toBe(2);
  });

  test("worktree に立ったセンチネルは共有ツリーからの commit も止める", () => {
    const { main, worktree } = makeRepoWithWorktree();
    writeSentinel(worktree);
    expect(runGateAt(worktree, main).status).toBe(2);
    expect(runGateAt(main, main).status).toBe(2);
  });

  test("センチネルがどのツリーにも無ければ従来どおり通す（全ツリー走査で常にブロックするようにならない）", () => {
    const { main, worktree } = makeRepoWithWorktree();
    expect(runGateAt(worktree, main).status).toBe(0);
    expect(runGateAt(main, main).status).toBe(0);
  });

  test("別ツリーの抽出完了マーカーはセンチネルを覆う（探索だけ広げてマーカーを取り残さない）", () => {
    const { main, worktree } = makeRepoWithWorktree();
    writeSentinel(main);
    mkdirSync(join(worktree, ".kaizen"), { recursive: true });
    writeFileSync(join(worktree, ".kaizen", `.extract-done.${SESSION}`), "2026-09-11T12:30:00Z\n");
    expect(runGateAt(worktree, main).status).toBe(0);
    expect(runGateAt(main, main).status).toBe(0);
  });

  // マーカーを全ツリーから探して覆わせる以上、**失効も全ツリーで**行わないと、別ツリーに
  // 残ったマーカーがセッション境界を越えて生き残り、このセッションの commit が素通りする。
  // 素通りは出力にも終了コードにも現れないので、SessionStart を挟んだ形で押さえる。
  test("SessionStart は別ツリーの抽出完了マーカーも失効させる", () => {
    const { main, worktree } = makeRepoWithWorktree();
    writeSentinel(worktree);
    mkdirSync(join(main, ".kaizen"), { recursive: true });
    const stale = join(main, ".kaizen", `.extract-done.${SESSION}`);
    writeFileSync(stale, "2026-09-11T12:30:00Z\n");
    // 覆っていることを先に確かめる（この後の 0 → 2 の変化が SessionStart によるものだと区別する）。
    expect(runGateAt(worktree, main).status).toBe(0);
    const inject = spawnSync("bash", [join(scriptsDir, "kaizen-context-inject.sh")], {
      cwd: worktree,
      input: JSON.stringify({ session_id: SESSION, cwd: worktree, source: "resume" }),
      encoding: "utf8",
      env: { ...process.env, CLAUDE_PROJECT_DIR: main },
    });
    expect(inject.status, inject.stderr).toBe(0);
    expect(existsSync(stale)).toBe(false);
    expect(runGateAt(worktree, main).status).toBe(2);
  });

  // `git worktree list` は解決済み（物理）のパスを返す。base をシンボリックリンク越しに受け取ると
  // 文字列比較では一致せず、**同じ `.kaizen/` を 2 回**返す——同一のセンチネルが二重に数えられ、
  // 案内も他セッションの走査予算も二重に消費される。件数で押さえる。
  test("シンボリックリンク越しの project root でも .kaizen/ を重複して数えない", () => {
    const { main } = makeRepoWithWorktree();
    writeSentinel(main);
    const link = join(dirname(main), "link-main");
    symlinkSync(main, link);
    const gate = runGateAt(link, link);
    expect(gate.status).toBe(2);
    const listed = gate.stderr.split("\n").filter((l) => l.includes(".pending-extract"));
    expect(listed).toHaveLength(1);
  });

  // `source: compact` は同一セッションの継続なので、そのときだけマーカーを残す（広げた範囲でも同じ）。
  test("source: compact では別ツリーのマーカーも残す", () => {
    const { main, worktree } = makeRepoWithWorktree();
    writeSentinel(worktree);
    mkdirSync(join(main, ".kaizen"), { recursive: true });
    const marker = join(main, ".kaizen", `.extract-done.${SESSION}`);
    writeFileSync(marker, "2026-09-11T12:30:00Z\n");
    const inject = spawnSync("bash", [join(scriptsDir, "kaizen-context-inject.sh")], {
      cwd: worktree,
      input: JSON.stringify({ session_id: SESSION, cwd: worktree, source: "compact" }),
      encoding: "utf8",
      env: { ...process.env, CLAUDE_PROJECT_DIR: main },
    });
    expect(inject.status, inject.stderr).toBe(0);
    expect(existsSync(marker)).toBe(true);
  });
});

// エージェントは timeout に達したフックをブロックとして扱わない（Claude Code / Copilot とも、合格として扱う）。
// チェック全体の所要時間に上限が無いと、exit 2 で止めるはずの commit が遅いときほど素通りする（Issue #492）。
// チェックは 1 つの締め切りの内側で最後まで実行し、自セッション分までは締め切りに当たったら失敗として扱う。
describe("チェック全体の締め切り", () => {
  const OWN = "own-session-1";

  function stubScripts(files) {
    const scripts = cloneScripts();
    for (const [name, body] of Object.entries(files)) {
      writeFileSync(join(scripts, name), `#!/usr/bin/env bash\n${body}\n`);
    }
    return scripts;
  }

  function writeSentinel(cwd, key, transcript, stamp = "2026-09-27T06:00:00Z") {
    writeFileSync(
      join(cwd, ".kaizen", `.pending-extract.${key}`),
      `${stamp}\n${transcript}\nclaude-code\n${key}\n`,
    );
  }

  function timedGate(options) {
    const started = Date.now();
    const gate = runGate("git commit -m x", options);
    return { gate, elapsed: Date.now() - started };
  }

  test("自セッション分の走査が締め切りに当たったら、締め切りの内側で exit 2 にする", () => {
    const scripts = stubScripts({ "kaizen-candidate-scan.sh": "exec sleep 30" });
    const cwd = makeProject();
    const transcript = join(cwd, "t.jsonl");
    writeFileSync(transcript, "{}\n");
    writeSentinel(cwd, OWN, transcript);

    const { gate, elapsed } = timedGate({
      cwd,
      transcriptPath: transcript,
      sessionId: OWN,
      scripts,
      env: { KAIZEN_PRECOMMIT_DEADLINE_SECONDS: "3" },
    });
    expect(gate.status, gate.stderr).toBe(2);
    expect(gate.stderr).toMatch(/the transcript scan hit the gate deadline \(3s/);
    expect(elapsed).toBeLessThan(3000 + 1500);
    expect(existsSync(join(cwd, ".kaizen", `.pending-extract.${OWN}`))).toBe(true);
  }, 15000);

  // bash の SECONDS は秒の境界をまたぐと 1 ms でも 1 になる（実測）。締め切り 2 秒では残りが 0 秒になる回があり、
  // 検査を起動せずに同じメッセージで exit 2 になるので、timeout を外す変異（GATE-STATUS-UNBOUNDED）を
  // CI で検出できなかった。締め切りを 3 秒にし、検査が起動されたことも確かめる。
  test("lifecycle 検査が締め切りに当たったら、締め切りの内側で exit 2 にする", () => {
    const cwd = makeProject();
    const started = join(cwd, "status-check-started");
    const scripts = stubScripts({
      "kaizen-status-check.sh": `: > '${started}'\nexec sleep 30`,
    });

    const { gate, elapsed } = timedGate({
      cwd,
      sessionId: OWN,
      scripts,
      env: { KAIZEN_PRECOMMIT_DEADLINE_SECONDS: "3" },
    });
    expect(gate.status, gate.stderr).toBe(2);
    expect(gate.stderr).toMatch(
      /lifecycle 検査がチェックの締め切り（3 秒）までに終わりませんでした/,
    );
    expect(existsSync(started)).toBe(true);
    expect(elapsed).toBeLessThan(3000 + 1500);
  }, 15000);

  // bash は環境変数 SECONDS を起動時の初期値として引き継ぐ。フックの親環境に export されていると、
  // 経過時間が最初から大きくなり、毎回失敗として扱われる（PR #545 のレビュー指摘・実測）。
  test("環境変数 SECONDS を引き継いでも経過時間は 0 から数える", () => {
    const cwd = makeProject();
    const gate = runGate("git commit -m x", { cwd, sessionId: OWN, env: { SECONDS: "100" } });
    expect(gate.stderr).not.toMatch(/締め切り/);
    expect(gate.status, gate.stderr).toBe(0);
  });

  test.each([["abc"], ["0"], ["1"], ["3601"], ["-5"], ["8.5"]])(
    "不正な締め切り %s はデフォルト値に戻して知らせる",
    (raw) => {
      const cwd = makeProject();
      const gate = runGate("git commit -m x", {
        cwd,
        sessionId: OWN,
        env: { KAIZEN_PRECOMMIT_DEADLINE_SECONDS: raw },
      });
      expect(gate.status, gate.stderr).toBe(0);
      expect(gate.stderr).toMatch(
        /KAIZEN_PRECOMMIT_DEADLINE_SECONDS が不正です.*既定の 8 秒を使います/,
      );
    },
  );

  test.each([["2"], ["20"], ["3600"], ["08"]])(
    "正しい締め切り %s は警告なしに受け付ける",
    (raw) => {
      const cwd = makeProject();
      const gate = runGate("git commit -m x", {
        cwd,
        sessionId: OWN,
        env: { KAIZEN_PRECOMMIT_DEADLINE_SECONDS: raw },
      });
      // 受け付けたかだけを見る。最小の 2 秒では lifecycle 検査の持ち時間が 1 秒しかなく、負荷の高い
      // 並列実行では、締め切りで失敗として扱われうる（それ自体は仕様どおり）。
      expect(gate.stderr).not.toMatch(/不正です/);
      expect([0, 2]).toContain(gate.status);
    },
  );
});

// 候補が残っている他セッションのセンチネルは解消されないので、そのままだと commit のたびに同じ範囲を
// 走査し直し、締め切りの残りを同じ結論に使い切る（Issue #492 の提案 2）。
describe("他セッション分の走査結果の再利用", () => {
  const OWN = "own-session-1";
  const FOREIGN = "foreign-session-1";

  function setup(scannerBody) {
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
      join(cwd, ".kaizen", `.pending-extract.${FOREIGN}`),
      `2099-01-01T00:00:00Z\n${transcript}\nclaude-code\n${FOREIGN}\n`,
    );
    const cache = join(cwd, ".kaizen", `.extract-checkpoint.${FOREIGN}.foreign-scan`);
    const gate = (env = {}) =>
      runGate("git commit -m x", {
        cwd,
        sessionId: OWN,
        scripts,
        env: { SCAN_COUNTER: counter, ...env },
      });
    const scans = () =>
      existsSync(counter) ? readFileSync(counter, "utf8").split("\n").filter(Boolean).length : 0;
    return { scripts, cwd, transcript, cache, gate, scans };
  }

  test.each([["候補あり", "exit 0"]])("%s は入力が変わらなければ走査し直さない", (_label, body) => {
    const { gate, scans, cache } = setup(body);
    const first = gate();
    expect(first.status, first.stderr).toBe(1);
    expect(scans()).toBe(1);
    expect(existsSync(cache)).toBe(true);

    const second = gate();
    expect(second.status, second.stderr).toBe(1);
    expect(scans()).toBe(1);
    expect(second.stderr).toMatch(/skipped re-scanning .*unchanged since the last scan/);
    // 省いても他セッションの警告は従来どおり出る。
    expect(second.stderr).toMatch(/他セッションの未抽出センチネルが残っています/);
  });

  // スキャナは一時ファイルの作成・読み取りの失敗といった一過性の理由でも 2 を返す。残すと、持ち主が
  // 戻らないセンチネルを保持期間まで再試行しなくなる（PR #545 のレビュー指摘）。
  test("判定不能はキャッシュに残さず、毎回走査し直す", () => {
    const { gate, scans, cache } = setup("exit 2");
    gate();
    expect(existsSync(cache)).toBe(false);
    gate();
    expect(scans()).toBe(2);
  });

  test("残っていた判定不能のキャッシュも使わない", () => {
    const { gate, scans, cache } = setup("exit 0");
    gate();
    const content = readFileSync(cache, "utf8");
    const inconclusive = content.replace(/\n0\n(\d+)\n$/, "\n2\n$1\n");
    expect(inconclusive).not.toBe(content);
    writeFileSync(cache, inconclusive);
    gate();
    expect(scans()).toBe(2);
  });

  test("transcript が伸びたら走査し直す", () => {
    const { gate, scans, transcript } = setup("exit 0");
    gate();
    appendFileSync(transcript, "{}\n");
    gate();
    expect(scans()).toBe(2);
  });

  test("checkpoint が変わったら走査し直す", () => {
    const { gate, scans, cwd, transcript } = setup("exit 0");
    gate();
    writeFileSync(
      join(cwd, ".kaizen", `.extract-checkpoint.${FOREIGN}`),
      `${transcript}\n3\nclaude-code\n1\n`,
    );
    gate();
    expect(scans()).toBe(2);
  });

  test("スキャナが変わったら走査し直す", () => {
    const { gate, scans, scripts } = setup("exit 0");
    gate();
    appendFileSync(join(scripts, "kaizen-candidate-scan.sh"), "# updated\n");
    gate();
    expect(scans()).toBe(2);
  });

  test.each([
    [
      "見出しが違う",
      (c) => c.replace("kaizen-foreign-scan-cache v1", "kaizen-foreign-scan-cache v0"),
    ],
    ["結論が未知の値", (c) => c.replace(/\n0\n(\d+)\n$/, "\n7\n$1\n")],
    ["秒数が欠けている", (c) => c.replace(/\n(\d+)\n$/, "\n")],
  ])("キャッシュの形が違えば（%s）走査し直す", (_label, mutate) => {
    const { gate, scans, cache } = setup("exit 0");
    gate();
    const mutated = mutate(readFileSync(cache, "utf8"));
    expect(mutated).not.toBe(readFileSync(cache, "utf8"));
    writeFileSync(cache, mutated);
    gate();
    expect(scans()).toBe(2);
  });

  test("打ち切りは、前回より長く使えるときだけ走査し直す", () => {
    const { gate, scans } = setup("exec sleep 30");
    // 使える秒数は SECONDS の境界で 1 秒揺れる。同じ締め切りの 2 回目は許容内（+1 秒）に、
    // 3 回目は確実に許容の外に収まる値を選ぶ。
    gate({ KAIZEN_PRECOMMIT_DEADLINE_SECONDS: "3" });
    expect(scans()).toBe(1);
    const same = gate({ KAIZEN_PRECOMMIT_DEADLINE_SECONDS: "3" });
    expect(scans()).toBe(1);
    expect(same.stderr).toMatch(/skipped re-scanning .*\(exit 124 after up to [12]s\)/);
    gate({ KAIZEN_PRECOMMIT_DEADLINE_SECONDS: "7" });
    expect(scans()).toBe(2);
  }, 30000);

  test("保持期間で回収したセンチネルのキャッシュも消す", () => {
    const { cwd, cache, gate, transcript } = setup("exit 0");
    writeFileSync(
      join(cwd, ".kaizen", `.pending-extract.${FOREIGN}`),
      `2000-01-01T00:00:00Z\n${transcript}\nclaude-code\n${FOREIGN}\n`,
    );
    writeFileSync(cache, "kaizen-foreign-scan-cache v1\n");
    const result = gate();
    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(cache)).toBe(false);
  });
});
