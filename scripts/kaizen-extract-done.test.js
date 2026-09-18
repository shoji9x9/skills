// kaizen-extract-done.sh の回帰テスト。
//
// このスクリプトはコミット前ゲートを解除する唯一の経路なので、「消したつもりで消えていない」
// （センチネルが別の作業ツリーに残る）と「解消するものが無かった」（空振り）はどちらも
// 黙って進む。どちらも終了コードには現れないため、ここで決定論的に押さえる（Issue #344）。

import { describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
