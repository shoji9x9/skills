// kaizen のコミット前ゲート一式（走査器・checkpoint 記録・lifecycle 検査）の回帰テスト。
//
// このゲートは fail closed が前提なので、「検査していない範囲を処理済みにする」「候補ゼロが
// 常にブロックへ倒れる」「commit を取りこぼす」はどれも黙って壊れる。LLM eval では
// 実行環境（sed の方言・パーミッション・追記タイミング）を作れないため、ここで決定論的に押さえる。

import { describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const scriptsDir = join(repoRoot, "skills", "kaizen", "scripts");
const fixturesDir = join(repoRoot, "skills", "kaizen", "evals", "fixtures", "candidate-scan");

/** .kaizen/ を持つ空プロジェクトを作る。CLAUDE_PROJECT_DIR を渡すので git 管理下でなくてよい。 */
function makeProject() {
  const dir = mkdtempSync(join(tmpdir(), "kaizen-gate-"));
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

/** PreToolUse Hook の入力を模して、ゲートに 1 コマンドを判定させる。 */
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
  const dir = mkdtempSync(join(tmpdir(), "kaizen-scripts-"));
  for (const name of readdirSync(scriptsDir)) copyFileSync(join(scriptsDir, name), join(dir, name));
  return dir;
}

function scannedPosition(stdout) {
  const bytes = stdout.match(/^kaizen-candidate-scan: scanned-bytes=(\d+)$/m);
  const lines = stdout.match(/^kaizen-candidate-scan: scanned-lines=(\d+)$/m);
  return { bytes: bytes?.[1], lines: lines?.[1] };
}

describe("checkpoint は走査器が検査した範囲までしか進めない", () => {
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
    // センチネルを消してゲートを解除していないこと。
    expect(readdirSync(join(cwd, ".kaizen"))).toContain(".pending-extract");
  });

  test.each([
    ["--scanned-bytes だけ", ["--scanned-bytes", "10"]],
    ["--scanned-lines だけ", ["--scanned-lines", "1"]],
  ])("走査済み位置は対で渡す: %s は拒否する", (_label, partial) => {
    const cwd = makeProject();
    const transcript = join(cwd, "t.jsonl");
    copyFileSync(join(fixturesDir, "claude-no-candidate.jsonl"), transcript);

    // 片方だけ渡すと checkpoint の 2 行目と 4 行目が別地点を指す。黙って wc へ縮退させない。
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

  test("走査器が走査済み位置を報告しないときゲートはブロックする", () => {
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
// 印なので、checkpoint がある限りゲートに尊重させない。ここが緩むと 2 回目以降の commit が静かに
// 素通りし、「ゲートが動いている」ように見えたまま学びを取りこぼす。
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

  test("checkpoint を記録できない抽出完了は .extract-done でゲートを解除する", () => {
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
    const shimDir = mkdtempSync(join(tmpdir(), "kaizen-rm-shim-"));
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

  // ゲートは候補ゼロの自動通過のたびに checkpoint を書く。その後の抽出で checkpoint を
  // 記録できなかった場合（transcript を渡し忘れた・読めない・書けない）、古い checkpoint を
  // 残したままマーカーだけ書くと、ゲートはマーカーを尊重せず古い起点から再走査し、いま抽出
  // したばかりの候補で再びブロックする。抽出をやり直しても同じ状態に戻るため fail safe が
  // 効かず commit が止まり続ける。
  test("先に checkpoint がある状態でも .extract-done の fail safe は効く", () => {
    const cwd = makeProject();
    const transcript = join(cwd, "t.jsonl");
    copyFileSync(join(fixturesDir, "claude-no-candidate.jsonl"), transcript);

    // 1 回目の commit: 候補ゼロでゲートが自動通過し、checkpoint が書かれる。
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
    // 起点を残すと fail safe がゲートに無視される。全走査へ倒すため落とす。
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

describe("走査器の判定はゲートの外部コマンド方言に依存しない", () => {
  test("ゲートは sed の GNU 拡張（BRE の \\|）で agent を取り出さない", () => {
    const gnuAlternation = /sed[^\n]*\\\|/;
    // 陽性コントロール: 修正前の書き方を検出できることを先に示す（「該当なし」を根拠にするため）。
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
    const shimDir = mkdtempSync(join(tmpdir(), "kaizen-shim-"));
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

    // 1 回目で checkpoint を作る（走査器はここで初めて sed で checkpoint を読むようになる）。
    expect(runGate("git commit -m x", { cwd, transcriptPath: transcript }).status).toBe(0);
    writeFileSync(join(cwd, ".kaizen", ".pending-extract"), ""); // Stop フックによる再装填

    const gate = runGate("git commit -m x", {
      cwd,
      transcriptPath: transcript,
      env: { PATH: `${shimDir}:${process.env.PATH}` },
    });
    // 代理 sed が実際に経路上で使われたこと（この確認が無いと「sed を一切呼ばなかった」でも通る）。
    expect(readFileSync(callLog, "utf8")).toMatch(/called/);
    expect(gate.stderr).not.toMatch(/did not identify its agent/);
    expect(gate.status).toBe(0);
  });
});

describe("ゲートの commit 検出", () => {
  // 未抽出センチネルがある状態では、commit と判定されれば exit 2（ブロック）になる。
  // `{P}` は実行時にプロジェクトルートへ置換する。`-C` / `--git-dir` / `--work-tree` で
  // コミット先を指定する形は、**プロジェクト内**を指していないとゲートの対象外（exit 0）に
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
    // （素通り＝fail open。修正前は実測で exit 0）。
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
  ];

  test.each(cases)("%s => exit %i", (command, expected) => {
    const cwd = makeProject();
    writeFileSync(join(cwd, ".kaizen", ".pending-extract"), "");
    expect(runGate(command.replaceAll("{P}", cwd), { cwd }).status).toBe(expected);
  });
});

// コミット先がプロジェクト外のリポジトリだとコマンド行から分かる呼び出しは、ゲートの対象に
// しない（Issue #221）。テストのフィクスチャとして使い捨ての一時リポジトリへコミットする形まで
// 止めると、抽出を求めている「このプロジェクトの活動」と無関係な commit が実行できなくなる。
// ここが緩むとプロジェクト宛ての commit を素通しし（fail open）、きつくなると元の不具合へ戻る。
// 外部宛てのケースはいずれも「プロジェクト内を指す同形のケース」を下の blocked 側に持つ。
// 同形の対（同じオプション・同じ引用形で、違うのはコミット先だけ）が両方あって初めて、
// exit 0 が「スコープ判定で外した」のか「commit として検出できていない」のかを弁別できる。
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
    // フィクスチャは 1 行で作られるので、フックが走る時点では対象がまだ存在しない。
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
    // プロジェクトの活動そのもの。意図的に安全側（ブロック）へ倒す。
    `git --git-dir=${FIXTURE}/.git --work-tree={P} commit -m x`,
    `git -C ${FIXTURE} --work-tree={P} commit -m x`,
    `git init ${FIXTURE} && git -C ${FIXTURE} add a.txt && git commit -m base`,
    'git -C "{P}/{SPACE}" commit -m x',
    "git -C {P}/{ESCAPED_SPACE} commit -m x",
    "git -C {PARENT} -C {BASE} commit -m x",
    // 区切り直後に空白が無くてもプロジェクト宛ては見落とさない（上の対）。
    "ls;git -C {P} commit -m x",
    "ls&&git -C {P} commit -m x",
    // 展開しないと値が決まらないパスは判定不能（fail closed）。外部宛てと同形だが通してはいけない。
    "git -C $FIXTURE commit -m x",
    'git -C "$(mktemp -d)" commit -m x',
    "git -C /tmp/kaizen-gate-*/fixture commit -m x",
    // `--work-tree` は作業ツリーだけを差し替え、リポジトリは cwd からの探索で決まる。
    // 外部を指していてもコミット先はプロジェクトのリポジトリなので通してはいけない。
    `git --work-tree=${FIXTURE} commit -m x`,
    `git --work-tree ${FIXTURE} commit -am x`,
    // `cd` があると git が走る cwd が確定しないので、相対パス指定は判定不能。
    "cd /tmp && git -C fixture commit -m x",
    // 1 行に複数の commit。先頭が外部宛てでも、後続のプロジェクト宛てを見落とさない。
    `git -C ${FIXTURE} commit -m a && git commit -m b`,
    // 走査位置の算出はマッチ文字列を**リテラル**として扱う必要がある。パターン展開になると
    // パス以外の引数（`-c` の値など）の glob メタ文字がマッチ範囲を広げ、後続の commit を
    // 見落として素通りする（fail open）。
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
    const root = mkdtempSync(join(tmpdir(), "kaizen-wt-"));
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
    // 引くと解決できず、同一リポジトリ判定が抜けて外部宛て扱いで素通りする（fail open。実測）。
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

// jq も python3 も無い環境では、ゲートは Hook 入力を構造として読めず生 JSON を直接照合する
// 縮退経路へ落ちる。この経路は普段の開発機では絶対に通らないため、壊れても気づけない。
// commit 判定は jq 経路と同じ結論でなければならない（ここが緩むと fail open、きつくなると誤ブロック）。
// ただしコミット先のスコープ判定（Issue #221）だけは**意図的に差がある**。この経路はコマンド行を
// 構造として取り出せていないため外部宛てを確定できず、`git -C <外部> commit` も従来どおりブロックする。
describe("生 JSON へ縮退した経路の commit 検出", () => {
  /** jq / python3 だけを解決できない PATH を作る（他のコマンドは実体へ通す）。 */
  function makeJqlessPathDir() {
    const dir = mkdtempSync(join(tmpdir(), "kaizen-nojq-"));
    // ゲート本体と kaizen-status-check.sh が使う外部コマンドは通す。ここが欠けると
    // 「縮退経路で正しく判定した」ではなく「別の理由で落ちた」を測ってしまう。
    // `dirname` は両スクリプトが script_dir の解決に使う。落とすと script_dir が壊れ、
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

  // この経路を本当に通したことの陽性コントロール。jq か python3 が解決できてしまうと
  // ゲートは構造化経路を通り、以下のケースは縮退経路を一切検証しないまま全て pass する。
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
    // 区切りの後ろの commit。値の先頭だけに錨を打っていた頃は取りこぼしていた（fail open）。
    ["cd /tmp && git commit -m x", 2],
    ["make build; git commit -m x", 2],
    ["ls | xargs git commit", 2],
    ["(git commit -m x)", 2],
    ["git add -A && git -C /tmp commit -m x", 2],
    // 外部宛てのスコープ判定はこの経路では行わない（構造化経路なら 0 になる形も 2 のまま）。
    ["git -C /tmp/kaizen-gate-external-221 commit -qm base", 2],
    ["git --git-dir=/tmp/kaizen-gate-external-221/.git commit -m x", 2],
    ["cd /tmp; git --no-pager commit -m x", 2],
    // JSON では改行が `\n` の 2 文字として現れる。リテラルの区切りだけを見ていると取りこぼす。
    ["cd /tmp\ngit commit -m x", 2],
    // 先頭の commit（従来から捕捉できていた形）。
    ["git commit -m x", 2],
    ["git -C /tmp commit -m x", 2],
    // 区切りを許しても過剰ブロックへ倒れないこと。
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
      // 縮退 PATH に必要なコマンドが欠けると、commit 判定より手前の環境エラーでも exit 2 に
      // なる。それでは「縮退経路が commit を検出した」を測ったことにならないので、
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
});

// transcript を「一度も記録していない」センチネル（`/compact` 専用の隠しセッションのように
// transcript を一度も作らないまま Stop が走った場合。Issue #240）は、案内どおりに探しても
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
    // 置き換えてください" という穴埋め必須の注意書きは出ない（出ると、常に穴埋めが要ると誤解される）。
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
      // このケースは <transcript> の穴埋めが必須の唯一の解消コマンドなので、注意書きが出る。
      expect(gate.stderr).toMatch(/<transcript> だけを.*置き換えてください/);
    } finally {
      chmodSync(unreadable, 0o644);
    }
  });

  // 記録された transcript が**実在しない**（剪定・削除・移動）ケース。探しても見つからないので、
  // 「実在するが読めない」と同じ案内に倒すと解消手段が無い恒久ブロッカーになる。
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
    // 穴埋め必須の注意書きは出ない（transcript 無しの解消コマンドで完結するため）。
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
