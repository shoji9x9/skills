// kaizen-extract-done.sh の回帰テスト。
//
// このスクリプトはコミット前ゲートを解除する唯一の経路なので、「消したつもりで消えていない」
// （センチネルが別の作業ツリーに残る）と「解消するものが無かった」（空振り）はどちらも
// 黙って進む。どちらも終了コードには現れないため、ここで決定論的に押さえる（Issue #344）。

import { describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const scriptsDir = join(repoRoot, "skills", "kaizen", "scripts");
const SESSION = "00000000-1111-2222-3333-444444444444";

/** 本体 ＋ worktree を 1 つ持つリポジトリを作る。`name` に改行を含めてもよい。*/
function makeRepoWithWorktree(name = "wt") {
  const root = mkdtempSync(join(tmpdir(), "kaizen-extract-done-"));
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
  const worktree = join(root, name);
  git(["worktree", "add", "-q", "-b", "wtbranch", worktree]);
  return { main, worktree };
}

function sentinelPath(dir) {
  return join(dir, ".kaizen", `.pending-extract.${SESSION}`);
}

function writeSentinel(dir) {
  mkdirSync(join(dir, ".kaizen"), { recursive: true });
  writeFileSync(sentinelPath(dir), `2026-09-11T12:27:31Z\n\nclaude-code\n${SESSION}\n`);
}

/** CLAUDE_PROJECT_DIR は共有ツリーのまま（セッションの起点）、実行は cwd のツリーで行う。*/
function runExtractDone(cwd, projectDir, extraArgs = []) {
  return spawnSync(
    "bash",
    [
      join(scriptsDir, "kaizen-extract-done.sh"),
      "--sentinel-suffix",
      "",
      "--agent",
      "claude-code",
      "--session-id",
      SESSION,
      ...extraArgs,
    ],
    { cwd, encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir } },
  );
}

const noopWarning = /削除対象のセンチネルがありませんでした/;

describe("センチネルの解消はリポジトリの全作業ツリーに及ぶ", () => {
  test("worktree から実行しても共有ツリーのセンチネルが消える", () => {
    const { main, worktree } = makeRepoWithWorktree();
    writeSentinel(main);
    const run = runExtractDone(worktree, main);
    expect(run.status, run.stderr).toBe(0);
    expect(existsSync(sentinelPath(main))).toBe(false);
    expect(run.stderr).not.toMatch(noopWarning);
  });

  test("共有ツリーから実行しても worktree のセンチネルが消える", () => {
    const { main, worktree } = makeRepoWithWorktree();
    writeSentinel(worktree);
    const run = runExtractDone(main, main);
    expect(run.status, run.stderr).toBe(0);
    expect(existsSync(sentinelPath(worktree))).toBe(false);
    expect(run.stderr).not.toMatch(noopWarning);
  });

  test("両方のツリーに残っていればどちらも消える", () => {
    const { main, worktree } = makeRepoWithWorktree();
    writeSentinel(main);
    writeSentinel(worktree);
    const run = runExtractDone(worktree, main);
    expect(run.status, run.stderr).toBe(0);
    expect(existsSync(sentinelPath(main))).toBe(false);
    expect(existsSync(sentinelPath(worktree))).toBe(false);
  });

  test("別セッションのセンチネルは他ツリーのぶんも消さない", () => {
    const { main, worktree } = makeRepoWithWorktree();
    const other = join(main, ".kaizen", ".pending-extract.99999999-aaaa-bbbb-cccc-dddddddddddd");
    mkdirSync(join(main, ".kaizen"), { recursive: true });
    writeFileSync(other, "2026-09-11T12:27:31Z\n\nclaude-code\nother\n");
    writeSentinel(worktree);
    const run = runExtractDone(worktree, main);
    expect(run.status, run.stderr).toBe(0);
    expect(existsSync(other)).toBe(true);
  });
});

// 制御ファイルの置き場を決めるのに**センチネル**を先に見ると、Stop フックがターンごとに
// そのツリーへ立て直すぶんだけ置き場が動く。checkpoint がそれに引きずられると、共有ツリーと
// worktree に**別々の offset を持つ checkpoint が 1 つずつ**残り、古い方を掴んだゲートが
// 抽出済みの範囲を再検出して止まり続ける。置き場は checkpoint を起点に決める。
describe("checkpoint はツリーをまたいで 1 つに保たれる", () => {
  test("センチネルの置き場がツリー間で移っても checkpoint は増えない", () => {
    const { main, worktree } = makeRepoWithWorktree();
    const transcript = join(main, "t.jsonl");
    const checkpointIn = (dir) => join(dir, ".kaizen", `.extract-checkpoint.${SESSION}`);

    // 1 ターン目: センチネルは共有ツリー、実行は worktree。
    writeFileSync(transcript, "{}\n".repeat(5));
    writeSentinel(main);
    let run = runExtractDone(worktree, main, [transcript]);
    expect(run.status, run.stderr).toBe(0);
    const first = [main, worktree].filter((d) => existsSync(checkpointIn(d)));
    expect(first).toHaveLength(1);

    // 2 ターン目: Stop フックが今度は worktree 側へセンチネルを立て直す。
    writeFileSync(transcript, "{}\n".repeat(20));
    writeSentinel(worktree);
    run = runExtractDone(worktree, main, [transcript]);
    expect(run.status, run.stderr).toBe(0);
    const second = [main, worktree].filter((d) => existsSync(checkpointIn(d)));
    expect(second).toEqual(first);
    // 進んだ位置が記録されているのは、その 1 つだけ。
    expect(readFileSync(checkpointIn(second[0]), "utf8").split("\n")[1]).toBe("60");
  });
});

describe("削除の空振りは成功と区別できる", () => {
  // `rm -f` は対象が無くても正常終了するため、終了コードでは「解消した」と「解消するものが
  // 無かった」が同じ値になる。空振りが成功に見えると、抽出したつもりで進む（Issue #344）。
  test("どのツリーにもセンチネルが無ければ警告を出す（終了コードは 0 のまま）", () => {
    const { main, worktree } = makeRepoWithWorktree();
    const run = runExtractDone(worktree, main);
    expect(run.status).toBe(0);
    expect(run.stderr).toMatch(noopWarning);
  });

  test("2 回目の実行は空振りとして警告になる", () => {
    const { main, worktree } = makeRepoWithWorktree();
    writeSentinel(main);
    const first = runExtractDone(worktree, main);
    expect(first.stderr).not.toMatch(noopWarning);
    const second = runExtractDone(worktree, main);
    expect(second.status).toBe(0);
    expect(second.stderr).toMatch(noopWarning);
  });
});

// POSIX ではパスに改行を含められる。`git worktree list --porcelain` を**行区切り**で読むと
// パスが複数行へ割れて先頭部分しか取れず、その worktree は「存在しないディレクトリ」として
// 落ちる。そこに立ったセンチネルは見えないまま commit が素通りする（実測）。
// `-z`（NUL 区切り）で読み、**返す側も NUL 区切り**にして初めて塞がる——片方だけでは、
// 取れたパスを消費側が 1 件 2 行として読み直してしまう。
describe("改行を含む worktree のパスを取りこぼさない", () => {
  test("改行入り worktree に立ったセンチネルを本体から解消できる", () => {
    const { main, worktree } = makeRepoWithWorktree("a\nb");
    writeSentinel(worktree);
    const run = runExtractDone(main, main);
    expect(run.status, run.stderr).toBe(0);
    expect(existsSync(sentinelPath(worktree))).toBe(false);
    expect(run.stderr).not.toMatch(noopWarning);
  });

  test("改行入り worktree があっても通常の worktree のセンチネルは解消できる", () => {
    const { main, worktree } = makeRepoWithWorktree("a\nb");
    writeSentinel(main);
    const run = runExtractDone(worktree, main);
    expect(run.status, run.stderr).toBe(0);
    expect(existsSync(sentinelPath(main))).toBe(false);
  });
});

// 既存インストールでは同じ session の checkpoint が本体と worktree に散っていることがある
// （この変更が直そうとしている状態そのもの）。1 ツリーぶんだけ消すと、残ったほうをゲートが
// 見つけて `.extract-done` の fail safe を無効化し、commit が止まり続ける（実測）。
describe("散った制御ファイルは全作業ツリーで整理する", () => {
  function writeCheckpoint(dir, transcript) {
    mkdirSync(join(dir, ".kaizen"), { recursive: true });
    writeFileSync(
      join(dir, ".kaizen", `.extract-checkpoint.${SESSION}`),
      `${transcript}\n10\nclaude-code\n1\n`,
    );
  }

  test("checkpoint が両ツリーにあると、fail safe の際に両方落とす", () => {
    const { main, worktree } = makeRepoWithWorktree();
    const transcript = join(main, "t.jsonl");
    writeFileSync(transcript, "{}\n");
    writeCheckpoint(main, transcript);
    writeCheckpoint(worktree, transcript);
    writeSentinel(main);
    writeSentinel(worktree);
    // transcript を渡さない＝checkpoint を記録できない経路。`.extract-done` を書き、
    // 古い checkpoint を落として整合させる。
    const run = runExtractDone(main, main);
    expect(run.status, run.stderr).toBe(0);
    for (const tree of [main, worktree]) {
      expect(existsSync(join(tree, ".kaizen", `.extract-checkpoint.${SESSION}`))).toBe(false);
    }
  });

  test("checkpoint を記録できたときは、両ツリーの古いマーカーを落とす", () => {
    const { main, worktree } = makeRepoWithWorktree();
    const transcript = join(main, "t.jsonl");
    writeFileSync(transcript, "{}\n");
    for (const tree of [main, worktree]) {
      mkdirSync(join(tree, ".kaizen"), { recursive: true });
      writeFileSync(join(tree, ".kaizen", `.extract-done.${SESSION}`), "2026-09-11T00:00:00Z\n");
    }
    writeSentinel(main);
    const run = runExtractDone(main, main, [transcript]);
    expect(run.status, run.stderr).toBe(0);
    for (const tree of [main, worktree]) {
      expect(existsSync(join(tree, ".kaizen", `.extract-done.${SESSION}`))).toBe(false);
    }
  });
});

// --- 忘却の自動掃引（Issue #339） ---
//
// 掃引の発火点をここに置いたのは、**書き込む瞬間を「リポジトリを変更する意思が確定した時点」に
// 揃えるため**。SessionStart に置くと、リポジトリを変更するつもりのない調査だけのセッションでも
// 追跡ファイルが書き換わり、その差分が未ステージで残って clean 確認を持つ工程を止める。
//
// 固定する契約は 3 つ:
//   1. 掃引が走り、閾値を満たす pending だけが forgotten になる
//   2. 掃引はセンチネル解消の**後**に走る（掃引が失敗しても抽出完了の記録は残る。ここで止めると
//      抽出したのにゲートが解除されず commit できない恒久ブロッカーになる）
//   3. 何を忘れたかを stderr に出す（黙って忘れると、注入から消えたことに気づけず戻せない）
//
// 変異による検出能力の実証（実測した結果をそのまま記録する）:
//   1. 掃引の呼び出しを `forgotten_notes=""` へ置き換える → 1 件 fail（「閾値を過ぎた pending だけを忘却し…」）
//   2. 掃引ブロックをセンチネル解消より前へ移すだけ → **green のまま**。`|| true` が失敗を吸うので、
//      位置を変えただけでは観測できない（この変異は検出能力の証拠にならない）
//   3. 掃引ブロックを前へ移し、**かつ** `|| true` を外す → 1 件 fail（「掃引が失敗してもセンチネルは
//      解消される」）。センチネル解消が掃引の成否に左右されない、という契約はこの形でだけ測れる
function staleNote(daysOld, priority = "low") {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysOld);
  const date = d.toISOString().slice(0, 10);
  return `---\ndate: ${date}\ntype: doc\npriority: ${priority}\nstatus: pending\napplied-to: []\n---\n\n# stale\n\n## 事象\n\n本文。\n`;
}

function statusOf(dir, name) {
  return /^status: (.*)$/m.exec(readFileSync(join(dir, ".kaizen", name), "utf8"))?.[1] ?? "";
}

describe("忘却の自動掃引", () => {
  test("閾値を過ぎた pending だけを忘却し、何を忘れたかを出す", () => {
    const { main } = makeRepoWithWorktree();
    writeSentinel(main);
    writeFileSync(join(main, ".kaizen", "stale.md"), staleNote(200));
    // 陰性コントロール: 閾値内・高優先度は触らない（「全部忘れる」への退化を検出する）。
    writeFileSync(join(main, ".kaizen", "fresh.md"), staleNote(1));
    writeFileSync(join(main, ".kaizen", "high.md"), staleNote(200, "high"));

    const result = runExtractDone(main, main);
    expect(result.status).toBe(0);
    expect(statusOf(main, "stale.md")).toBe("forgotten");
    expect(statusOf(main, "fresh.md")).toBe("pending");
    expect(statusOf(main, "high.md")).toBe("pending");
    expect(result.stderr).toContain("忘却しました");
    expect(result.stderr).toContain("stale.md");
    // 戻し方と止め方を案内する（気づいても直せないと意味がない）。
    expect(result.stderr).toContain("forget_auto=off");
  });

  test("忘却する候補が無ければ何も出さない", () => {
    const { main } = makeRepoWithWorktree();
    writeSentinel(main);
    writeFileSync(join(main, ".kaizen", "fresh.md"), staleNote(1));

    const result = runExtractDone(main, main);
    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain("忘却しました");
    expect(statusOf(main, "fresh.md")).toBe("pending");
  });

  test("checkpoint-only（ゲートの候補ゼロ自動通過）では掃引しない", () => {
    // このモードはゲートが `git commit` の PreToolUse で呼ぶ。学びは 1 件も記録されて
    // いないのに追跡ファイルを書き換えると、`git add` 済みのユーザーに未ステージ差分を
    // 残す——発火点を SessionStart から移した理由そのものを壊す。
    const { main } = makeRepoWithWorktree();
    writeSentinel(main);
    writeFileSync(join(main, ".kaizen", "stale.md"), staleNote(200));
    const transcript = join(main, "transcript.jsonl");
    writeFileSync(transcript, '{"type":"user"}\n');

    const result = runExtractDone(main, main, [
      "--checkpoint-only",
      "--scanned-bytes",
      String(readFileSync(transcript).length),
      "--scanned-lines",
      "1",
      transcript,
    ]);
    expect(result.status).toBe(0);
    // 陽性コントロール: 同じノート・同じ経過日数が complete では忘却される（下の complete
    // ケースと同じ入力）。ここで pending のままなのはモード判定が効いているから。
    expect(statusOf(main, "stale.md")).toBe("pending");
    expect(result.stderr).not.toContain("忘却しました");
  });

  test("忘却側の診断を捨てない", () => {
    // 忘却側は「0 件」と「判定不能・書き込み失敗」を区別するために stderr へ理由を出す。
    // 呼び出し側が 2>/dev/null で捨てると、掃引が恒久的に失敗していても 0 件成功と
    // 見分けが付かない（終了コードは意図的に握り潰しているので、そこにも現れない）。
    const { main } = makeRepoWithWorktree();
    writeSentinel(main);
    writeFileSync(join(main, ".kaizen", "stale.md"), staleNote(200));

    const stubDir = mkdtempSync(join(tmpdir(), "kaizen-extract-done-diag-"));
    for (const name of ["kaizen-extract-done.sh", "kaizen-hook-common.sh"]) {
      copyFileSync(join(scriptsDir, name), join(stubDir, name));
    }
    // 実際の失敗（読み取り専用ノート）と同じ形: stdout は空、stderr に理由、exit は非 0。
    writeFileSync(
      join(stubDir, "kaizen-forget.sh"),
      "#!/usr/bin/env bash\necho 'kaizen-forget: skip (could not write the note): .kaizen/stale.md' >&2\nexit 1\n",
      { mode: 0o755 },
    );

    const result = spawnSync(
      "bash",
      [
        join(stubDir, "kaizen-extract-done.sh"),
        "--sentinel-suffix",
        "",
        "--agent",
        "claude-code",
        "--session-id",
        SESSION,
      ],
      { cwd: main, encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: main } },
    );
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("could not write the note");
    // 失敗した掃引を「忘却しました」と報告しない。
    expect(result.stderr).not.toContain("忘却しました");
  });

  test("掃引が失敗してもセンチネルは解消される", () => {
    // 抽出完了の記録は掃引より重い契約。ここで止めると、抽出したのにゲートが解除されず
    // commit できない恒久ブロッカーになる。
    const { main } = makeRepoWithWorktree();
    writeSentinel(main);
    writeFileSync(join(main, ".kaizen", "stale.md"), staleNote(200));

    // スクリプト一式を写し、忘却スクリプトだけを常に失敗するスタブへ差し替える。
    const stubDir = mkdtempSync(join(tmpdir(), "kaizen-extract-done-stub-"));
    for (const name of ["kaizen-extract-done.sh", "kaizen-hook-common.sh"]) {
      copyFileSync(join(scriptsDir, name), join(stubDir, name));
    }
    writeFileSync(join(stubDir, "kaizen-forget.sh"), "#!/usr/bin/env bash\nexit 1\n", {
      mode: 0o755,
    });

    const result = spawnSync(
      "bash",
      [
        join(stubDir, "kaizen-extract-done.sh"),
        "--sentinel-suffix",
        "",
        "--agent",
        "claude-code",
        "--session-id",
        SESSION,
      ],
      { cwd: main, encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: main } },
    );
    expect(result.status).toBe(0);
    // センチネルは消えている（掃引の失敗に巻き込まれない）。
    expect(existsSync(sentinelPath(main))).toBe(false);
    expect(result.stderr).not.toMatch(noopWarning);
    // スタブが効いていることの陽性コントロール（忘却は起きていない）。
    expect(statusOf(main, "stale.md")).toBe("pending");
  });
});
