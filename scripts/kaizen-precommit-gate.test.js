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
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
function runGate(command, { cwd, transcriptPath, scripts = scriptsDir, env = {} } = {}) {
  const input = JSON.stringify({
    tool_input: { command },
    ...(transcriptPath ? { transcript_path: transcriptPath } : {}),
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
  const cases = [
    ["git commit -m x", 2],
    ["git -C /tmp commit -m x", 2],
    ["git --no-pager commit -m x", 2],
    ["git -c user.name=x -c user.email=y commit -m x", 2],
    ["git --no-pager -C /tmp commit -m x", 2],
    ["cd /tmp && git -C /tmp commit -m x", 2],
    // 引用符で囲まれた（空白を含む）オプション引数。
    ['git -C "/tmp/a b" commit -m x', 2],
    ["git -C '/tmp/a b' commit -m x", 2],
    ['git -c user.name="A B" commit -m x', 2],
    ["git help commit", 0],
    ["man git commit", 0],
    ['echo "run git commit later"', 0],
    ["git log --oneline", 0],
  ];

  test.each(cases)("%s => exit %i", (command, expected) => {
    const cwd = makeProject();
    writeFileSync(join(cwd, ".kaizen", ".pending-extract"), "");
    expect(runGate(command, { cwd }).status).toBe(expected);
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
