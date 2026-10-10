// mutation-proof-shards.sh が、worktree を作る前に使い方と前提の誤りで止まること（Issue #588）。
//
// fixture は使い捨ての git リポジトリで、スクリプトはそこを cwd にして起動する。
// worktree を作って依存を入れ、ランナーを実行するところは、実行に数分かかるのでここでは測らない（PR で実測を記録する）。
import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir } from "../lib/test-tmpdir.js";

const script = join(dirname(fileURLToPath(import.meta.url)), "mutation-proof-shards.sh");

function git(cwd, ...args) {
  const res = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (res.status !== 0) throw new Error(`git ${args.join(" ")}: ${res.stderr}`);
  return res.stdout;
}

/** commit が 1 つある使い捨てのリポジトリと、worktree の置き場所（まだ作らない）。 */
function makeRepo() {
  const root = makeTempDir("mutation-proof-shards-");
  const repo = join(root, "repo");
  mkdirSync(repo);
  git(repo, "init", "--quiet");
  writeFileSync(join(repo, "a.txt"), "a\n");
  git(repo, "add", "a.txt");
  git(
    repo,
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@example.com",
    "commit",
    "--quiet",
    "-m",
    "init",
  );
  return { repo, shards: join(root, "shards") };
}

function run({ repo, shards }, ...args) {
  let env = {};
  if (args.length && typeof args.at(-1) === "object") env = args.pop();
  const res = spawnSync("bash", [script, ...args], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, MUTATION_PROOF_SHARDS_DIR: shards, ...env },
  });
  return { ...res, out: `${res.stdout}${res.stderr}` };
}

const worktrees = (repo) =>
  git(repo, "worktree", "list", "--porcelain").match(/^worktree /gm).length;

test.each([[[]], [["0"]], [["01"]], [["x"]], [[""]], [["-1"]]])(
  "N が 1 以上の整数でなければ、何も作らずに exit 2: %j",
  (args) => {
    const fx = makeRepo();
    const res = run(fx, ...args);
    expect(res.status, res.out).toBe(2);
    expect(existsSync(fx.shards), "worktree の置き場所を作った").toBe(false);
  },
);

test("ランナーの引数に --shard があれば exit 2（このスクリプトが付ける）", () => {
  const fx = makeRepo();
  const res = run(fx, "2", "--shard", "1/2");
  expect(res.status, res.out).toBe(2);
  expect(res.out).toContain("--shard はこのスクリプトが付ける");
  expect(existsSync(fx.shards)).toBe(false);
});

// worktree は HEAD から作るので、commit していない変更は測られない。測ったつもりにさせない。
test("tracked のファイルに commit していない変更があれば、worktree を作らずに exit 2", () => {
  const fx = makeRepo();
  writeFileSync(join(fx.repo, "a.txt"), "changed\n");
  const res = run(fx, "2");
  expect(res.status, res.out).toBe(2);
  expect(res.out).toContain("commit していない変更がある");
  expect(res.out).toContain("a.txt");
  expect(worktrees(fx.repo)).toBe(1);
});

test("untracked のファイルだけなら、変更があるとして止めない", () => {
  const fx = makeRepo();
  writeFileSync(join(fx.repo, "new.txt"), "x\n");
  // 置き場所に前回の worktree があるとして止め、worktree を作る前で終わらせる。
  mkdirSync(join(fx.shards, "shard-1"), { recursive: true });
  const res = run(fx, "2");
  expect(res.out).not.toContain("commit していない変更がある");
  expect(res.out).toContain("shard-1 が既にある");
});

// 前回の worktree には、対象が戻っていない変異が残っていることがあるので、確かめずに消さない。
test("前回の worktree が残っていれば、消さずに作らずに exit 2", () => {
  const fx = makeRepo();
  const leftover = join(fx.shards, "shard-2");
  mkdirSync(leftover, { recursive: true });
  writeFileSync(join(leftover, "keep.txt"), "x\n");
  const res = run(fx, "2");
  expect(res.status, res.out).toBe(2);
  expect(res.out).toContain("shard-2 が既にある");
  expect(existsSync(join(leftover, "keep.txt")), "残っていた worktree を消した").toBe(true);
  expect(existsSync(join(fx.shards, "shard-1")), "確かめる前に worktree を作った").toBe(false);
  expect(worktrees(fx.repo)).toBe(1);
});

// 依存を入れられずに途中で止まっても、作った worktree を残さない（残すと次の実行が「既にある」で止まる）。
test("依存の導入が失敗したら、作った worktree を消して exit 2", () => {
  const fx = makeRepo();
  const bin = join(dirname(fx.shards), "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "mise"), "#!/bin/sh\necho 'mise: 失敗させる' >&2\nexit 1\n");
  chmodSync(join(bin, "mise"), 0o755);
  const res = run(fx, "2", { PATH: `${bin}:${process.env.PATH}` });
  expect(res.status, res.out).toBe(2);
  expect(res.out).toContain("mise: 失敗させる");
  expect(worktrees(fx.repo), res.out).toBe(1);
  expect(existsSync(join(fx.shards, "shard-1")), "worktree を残した").toBe(false);
});
