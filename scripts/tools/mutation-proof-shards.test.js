// mutation-proof-shards.sh が、worktree を作る前に使い方と前提の誤りで止まること（Issue #588）。
//
// fixture は使い捨ての git リポジトリで、スクリプトはそこを cwd にして起動する。
// worktree を作ってシャードを起動するところは、偽の mise・pnpm・ランナーで確かめる。本物のランナーでの実行は数分かかるので、PR で実測を記録する。
import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
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
  expect(res.status, res.out).toBe(2);
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

/** worktree を作ってシャードを起動するまでを、偽の mise・pnpm・ランナーで通す fixture。 */
function makeLaunchRepo() {
  const fx = makeRepo();
  const runner = join(fx.repo, "scripts", "mutation", "check-mutation-proof.js");
  mkdirSync(dirname(runner), { recursive: true });
  // 受け取った引数と、ランナー用の環境変数を出し、集計の行で終わる偽のランナー。
  writeFileSync(
    runner,
    `console.log("args=" + JSON.stringify(process.argv.slice(2)));
console.log("lock=" + (process.env.MUTATION_PROOF_LOCK ?? "(unset)"));
console.log("command=" + (process.env.MUTATION_PROOF_TEST_COMMAND ?? "(unset)"));
console.log("changed=" + (process.env.MUTATION_PROOF_CHANGED_FILES ?? "(unset)"));
// FAKE_EXITS（シャードごとの終了コードをカンマ区切り）と FAKE_DIRTY_SHARD（その番号のシャードが tracked のファイルを書き換えて残す）。
const shard = Number(process.argv[process.argv.indexOf("--shard") + 1].split("/")[0]);
if (process.env.FAKE_DIRTY_SHARD === String(shard)) require("node:fs").writeFileSync("a.txt", "変異が残った\\n");
const code = Number((process.env.FAKE_EXITS ?? "").split(",")[shard - 1] ?? 0) || 0;
console.log(code === 0 ? "mutation-proof: 1 proven / 0 failed" : "mutation-proof: 0 proven / 1 failed");
process.exit(code);
`,
  );
  // 引数に渡す宣言ファイル（中身は偽のランナーが読まない）。commit していないと、スクリプトが起動の前に止める。
  writeFileSync(join(fx.repo, "x.mutations.json"), "{}\n");
  git(fx.repo, "add", "scripts", "x.mutations.json");
  git(
    fx.repo,
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@example.com",
    "commit",
    "--quiet",
    "-m",
    "runner",
  );
  const bin = join(dirname(fx.repo), "bin");
  mkdirSync(bin);
  for (const tool of ["mise", "pnpm"]) {
    writeFileSync(join(bin, tool), "#!/bin/sh\nexit 0\n");
    chmodSync(join(bin, tool), 0o755);
  }
  return { ...fx, bin };
}

// 呼び出し元のシェルに残ったランナー用の環境変数を引き継ぐと、全シャードが同じロックを取り合う。
// シンボリックリンク越しの絶対パスは、元の作業ツリー（commit していない内容を含む）を読ませるので、相対パスに直す。
test("シャードには、ランナー用の環境変数を渡さず、リポジトリの中の絶対パスを相対パスに直して渡す", () => {
  const fx = makeLaunchRepo();
  const link = join(dirname(fx.repo), "link");
  symlinkSync(fx.repo, link);
  const res = run(fx, "2", join(link, "x.mutations.json"), {
    PATH: `${fx.bin}:${process.env.PATH}`,
    MUTATION_PROOF_LOCK: join(dirname(fx.repo), "shared.lock"),
    MUTATION_PROOF_TEST_COMMAND: "/bin/false",
    MUTATION_PROOF_CHANGED_FILES: "a.txt",
  });
  expect(res.status, res.out).toBe(0);
  for (const i of [1, 2]) {
    const log = readFileSync(join(fx.shards, `shard-${i}.log`), "utf8");
    expect(log).toContain(`args=${JSON.stringify(["x.mutations.json", "--shard", `${i}/2`])}`);
    expect(log).toContain("lock=(unset)");
    expect(log).toContain("command=(unset)");
    expect(log).toContain("changed=(unset)");
  }
  expect(res.out).toContain("shard 1/2: exit 0 mutation-proof: 1 proven / 0 failed");
  expect(worktrees(fx.repo), "worktree を消していない").toBe(1);
});

// 宣言ファイルの引数が commit されていなければ worktree に無いので、依存を入れる前に止める。
test("commit していない宣言ファイルを渡したら、worktree を作らずに exit 2", () => {
  const fx = makeRepo();
  writeFileSync(join(fx.repo, "new.mutations.json"), "{}\n");
  const res = run(fx, "2", "new.mutations.json");
  expect(res.status, res.out).toBe(2);
  expect(res.out).toContain("new.mutations.json は commit されていない");
  expect(existsSync(fx.shards), "worktree の置き場所を作った").toBe(false);
});

const launchEnv = (fx, env = {}) => ({ PATH: `${fx.bin}:${process.env.PATH}`, ...env });

// 全体の終了コードは、シャードの中で最も重いもの（2 > 1 > 0）にする。1 は「実証できない変異がある」、2 は前提の誤りである。
test.each([
  ["1,0", 1],
  ["0,1", 1],
  ["2,1", 2],
  ["1,2", 2],
])("シャードの終了コードが %s なら、全体は exit %i", (exits, expected) => {
  const fx = makeLaunchRepo();
  const res = run(fx, "2", launchEnv(fx, { FAKE_EXITS: exits }));
  expect(res.status, res.out).toBe(expected);
  expect(worktrees(fx.repo), "worktree を消していない").toBe(1);
});

// 対象が戻っていない worktree は、--force を付けずに消そうとして失敗するので残し、exit 2 にする。
test("tracked のファイルが変わったまま終わった worktree は消さずに残し、exit 2", () => {
  const fx = makeLaunchRepo();
  const res = run(fx, "2", launchEnv(fx, { FAKE_DIRTY_SHARD: "1" }));
  try {
    expect(res.status, res.out).toBe(2);
    expect(res.out).toContain("shard-1 を消さずに残す");
    expect(existsSync(join(fx.shards, "shard-1", "a.txt")), "変更の残った worktree を消した").toBe(
      true,
    );
    expect(existsSync(join(fx.shards, "shard-2")), "clean な worktree を消していない").toBe(false);
  } finally {
    git(fx.repo, "worktree", "remove", "--force", join(fx.shards, "shard-1"));
  }
});

// 相対パスは呼び出し元の cwd から解決する。リポジトリの中の worktree は、untracked としてテストやリントの走査に入る。
test("worktree の置き場所がリポジトリの中なら、何も作らずに exit 2", () => {
  const fx = makeLaunchRepo();
  const res = run({ ...fx, shards: "tmp/shards" }, "2", launchEnv(fx));
  expect(res.status, res.out).toBe(2);
  expect(res.out).toContain("がリポジトリの中にある");
  expect(existsSync(join(fx.repo, "tmp")), "リポジトリの中に置き場所を作った").toBe(false);
  expect(worktrees(fx.repo)).toBe(1);
});

// リポジトリの外の宣言ファイルは、どの worktree からも同じファイルを読めるので、commit を求めずにそのまま渡す。
test("リポジトリの外を指す絶対パスの宣言ファイルは、そのままシャードに渡す", () => {
  const fx = makeLaunchRepo();
  const outside = join(dirname(fx.repo), "outside.mutations.json");
  writeFileSync(outside, "{}\n");
  const res = run(fx, "2", outside, launchEnv(fx));
  expect(res.status, res.out).toBe(0);
  expect(readFileSync(join(fx.shards, "shard-1.log"), "utf8")).toContain(
    `args=${JSON.stringify([outside, "--shard", "1/2"])}`,
  );
});

// 宣言ファイルを渡さないとランナーは scripts/ の下を探すが、untracked の宣言は worktree に無いので警告なしに測られない。
test("宣言ファイルを渡さずに実行するとき、untracked の宣言があれば、worktree を作らずに exit 2", () => {
  const fx = makeLaunchRepo();
  mkdirSync(join(fx.repo, "scripts", "new"), { recursive: true });
  writeFileSync(join(fx.repo, "scripts", "new", "foo.mutations.json"), "{}\n");
  const res = run(fx, "2", launchEnv(fx));
  expect(res.status, res.out).toBe(2);
  expect(res.out).toContain("commit していない宣言ファイルがある");
  expect(res.out).toContain("scripts/new/foo.mutations.json");
  expect(existsSync(fx.shards)).toBe(false);
});

// ランナーは名前を問わず位置引数を宣言ファイルとして読む。値を取るオプションの値は宣言ファイルとして確かめない。
test("名前に関わらず commit していない位置引数は止め、--only の値は宣言ファイルとして扱わない", () => {
  const fx = makeLaunchRepo();
  writeFileSync(join(fx.repo, "spec.json"), "{}\n");
  const stopped = run(fx, "2", "spec.json", launchEnv(fx));
  expect(stopped.status, stopped.out).toBe(2);
  expect(stopped.out).toContain("spec.json は commit されていない");
  const passed = run(fx, "2", "--only", "NOT-A-FILE", launchEnv(fx));
  expect(passed.status, passed.out).toBe(0);
  expect(readFileSync(join(fx.shards, "shard-1.log"), "utf8")).toContain(
    `args=${JSON.stringify(["--only", "NOT-A-FILE", "--shard", "1/2"])}`,
  );
});

// 前回のシャードの数は今回と違いうる。番号が今回の N を超える worktree も確かめる。
test("前回の N が今回より大きく、その番号の worktree が残っていても、確かめずに進まない", () => {
  const fx = makeRepo();
  mkdirSync(join(fx.shards, "shard-5"), { recursive: true });
  const res = run(fx, "2");
  expect(res.status, res.out).toBe(2);
  expect(res.out).toContain("shard-5 が既にある");
  expect(existsSync(join(fx.shards, "shard-1")), "確かめる前に worktree を作った").toBe(false);
});

// リンクされた worktree から起動すると、デフォルトの置き場所はその worktree の隣になる。元の作業ツリーの中なら止める。
test("リンクされた worktree から起動して、置き場所が元の作業ツリーの中になるなら exit 2", () => {
  const fx = makeLaunchRepo();
  const linked = join(fx.repo, "wt", "x");
  git(fx.repo, "worktree", "add", "--quiet", "--detach", linked);
  try {
    // デフォルトの置き場所を使わせる（キーを消す。undefined を渡すと、文字列の "undefined" になりうる）。
    const env = { ...process.env, ...launchEnv(fx) };
    delete env.MUTATION_PROOF_SHARDS_DIR;
    const res = spawnSync("bash", [script, "2"], { cwd: linked, encoding: "utf8", env });
    const out = `${res.stdout}${res.stderr}`;
    expect(res.status, out).toBe(2);
    expect(out).toContain("がリポジトリの中にある");
    expect(existsSync(join(fx.repo, "wt", "x-mutation-shards")), "置き場所を作った").toBe(false);
  } finally {
    git(fx.repo, "worktree", "remove", "--force", linked);
  }
});
