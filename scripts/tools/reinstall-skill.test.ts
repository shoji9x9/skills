// reinstall-skill.sh が操作対象のリポジトリを cwd ではなくスクリプト自身の位置から決めること（Issue #547）。
//
// fixture は本物のリポジトリを模した最小のツリーで、`gh` と frontmatter 検査はスタブにする
// （検査対象は起点の決め方と止まり方で、インストール手順そのものではない）。
// スタブの `gh` は起動された cwd を記録するので、「どのツリーを操作したか」が出力に残る。
import { expect, test } from "vitest";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
  type Ctx,
  createRepo,
  expectUntouched,
  ghCalls,
  isLink,
  preinstall,
  run,
  runWith,
  script,
  setup,
  snapshot,
  withReadOnly,
  writeFile,
} from "./reinstall-skill-helpers.ts";

const EXPECTED_INSTALL = {
  ".agents/skills/demo/SKILL.md": "---\nname: demo\n---\n\ndemo body\n",
  ".agents/skills/demo/references/a.md": "demo body ref\n",
  ".claude/skills/demo": "-> ../../.agents/skills/demo",
};

test("ルートから実行するとスクリプトのあるツリーへインストールする", () => {
  const ctx = setup();
  const root = createRepo(ctx.base, "repo");
  const result = run(ctx, root, ["scripts/tools/reinstall-skill.sh", "demo"]);
  expect(result.status, result.stderr).toBe(0);
  expect(snapshot(root)).toEqual(EXPECTED_INSTALL);
  expect(ghCalls(ctx)).toEqual([realpathSync(root)]);
});

// 相対の dirname（scripts/tools/../..）は export された CDPATH で別ツリーへ解決されうる。
test("CDPATH が別ツリーの scripts/tools を指していても、スクリプトのあるツリーを操作する", () => {
  const ctx = setup();
  const root = createRepo(ctx.base, "repo");
  const decoy = createRepo(ctx.base, "decoy");
  const result = runWith(ctx, root, {
    args: ["scripts/tools/reinstall-skill.sh", "demo"],
    env: { CDPATH: decoy },
  });
  expect(result.status, result.stderr).toBe(0);
  expect(snapshot(root)).toEqual(EXPECTED_INSTALL);
  expect(snapshot(decoy)).toEqual({});
  expect(ghCalls(ctx)).toEqual([realpathSync(root)]);
});

// ルートからの実行と同じ結果になることを、同じ形の 2 ツリーで突き合わせる（受け入れ条件 1）。
test.each([
  [
    "サブディレクトリから相対パスで",
    (root: string) => [join(root, "sub", "dir"), "../../scripts/tools/reinstall-skill.sh"],
  ],
  [
    "サブディレクトリから絶対パスで",
    (root: string) => [join(root, "sub", "dir"), join(root, "scripts/tools/reinstall-skill.sh")],
  ],
  [
    "リポジトリの外から絶対パスで",
    (root: string) => [dirname(root), join(root, "scripts/tools/reinstall-skill.sh")],
  ],
])("%s実行してもルートから実行したときと同じ結果になる", (_label, locate) => {
  const ctx = setup();
  const fromRoot = createRepo(ctx.base, "from-root");
  const atRoot = run(ctx, fromRoot, ["scripts/tools/reinstall-skill.sh", "demo"]);
  expect(atRoot.status, atRoot.stderr).toBe(0);

  const other = createRepo(ctx.base, "other");
  const [cwd, path] = locate(other);
  rmSync(ctx.ghLog, { force: true });
  const elsewhere = run(ctx, cwd, [path, "demo"]);
  expect(elsewhere.status, elsewhere.stderr).toBe(0);
  expect(snapshot(other)).toEqual(snapshot(fromRoot));
  expect(elsewhere.stdout).toBe(atRoot.stdout);
  expect(ghCalls(ctx)).toEqual([realpathSync(other)]);
});

test("--all もサブディレクトリから実行できる", () => {
  const ctx = setup();
  const root = createRepo(ctx.base, "repo");
  const result = run(ctx, join(root, "sub", "dir"), [
    "../../scripts/tools/reinstall-skill.sh",
    "--all",
  ]);
  expect(result.status, result.stderr).toBe(0);
  expect(snapshot(root)).toEqual(EXPECTED_INSTALL);
});

// 旧実装は cwd 側の skills/demo を読んだ。スクリプトのツリーだけが操作され、cwd 側は触られない。
test("cwd が同名スキルを持つ別リポジトリでも、スクリプトのあるツリーを操作する", () => {
  const ctx = setup();
  const target = createRepo(ctx.base, "target");
  const cwdRepo = createRepo(ctx.base, "cwd-repo", { body: "other body" });
  preinstall(cwdRepo);
  const before = snapshot(cwdRepo);
  const result = run(ctx, cwdRepo, [join(target, "scripts/tools/reinstall-skill.sh"), "demo"]);
  expect(result.status, result.stderr).toBe(0);
  expect(snapshot(target)).toEqual(EXPECTED_INSTALL);
  expect(snapshot(cwdRepo)).toEqual(before);
  expect(ghCalls(ctx)).toEqual([realpathSync(target)]);
});

// ファイル自体への symlink 経由でも、リンク先のツリーを操作する（リンクの置き場所のツリーではない）。
test("スクリプトへの symlink から実行しても、リンク先のツリーを操作する", () => {
  const ctx = setup();
  const root = createRepo(ctx.base, "repo");
  mkdirSync(join(ctx.base, "elsewhere", "a", "b"), { recursive: true });
  const link = join(ctx.base, "elsewhere", "a", "b", "reinstall");
  symlinkSync(join(root, "scripts/tools/reinstall-skill.sh"), link);
  const result = run(ctx, join(ctx.base, "elsewhere"), [link, "demo"]);
  expect(result.status, result.stderr).toBe(0);
  expect(snapshot(root)).toEqual(EXPECTED_INSTALL);
  expect(ghCalls(ctx)).toEqual([realpathSync(root)]);
});

// ルートを特定できない形。どれも cwd には完全な（インストール済みの）リポジトリを置き、
// 警告なしに cwd をルートとして扱わないこと・削除より前で止まることを確かめる（受け入れ条件 2・3）。
test.each([
  [
    "スクリプトの位置のツリーに frontmatter 検査が無い",
    (ctx: Ctx) => createRepo(ctx.base, "stray", { omit: ["gates"] }),
  ],
  [
    "スクリプトの位置のツリーに skills/ が無い",
    (ctx: Ctx) => createRepo(ctx.base, "stray", { omit: ["skills"] }),
  ],
  ["スクリプトを stdin から読ませた", () => null],
  [
    "スクリプトだけをリポジトリの外へコピーした",
    (ctx: Ctx) => {
      const dir = join(ctx.base, "copied", "scripts", "tools");
      mkdirSync(dir, { recursive: true });
      copyFileSync(script, join(dir, "reinstall-skill.sh"));
      return join(ctx.base, "copied");
    },
  ],
])(
  "%s ときは exit 2 で止まり、インストール済みのコピーと symlink を消さない",
  (_label, makeStray) => {
    const ctx = setup();
    const cwdRepo = createRepo(ctx.base, "cwd-repo");
    preinstall(cwdRepo);
    const before = snapshot(cwdRepo);
    const stray = makeStray(ctx);
    const result =
      stray === null
        ? runWith(ctx, cwdRepo, { args: ["demo"], input: readFileSync(script, "utf8") })
        : run(ctx, cwdRepo, [join(stray, "scripts/tools/reinstall-skill.sh"), "demo"]);

    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toMatch(/^Repository root not found from the script location: /);
    // frontmatter の失敗（Preflight failed: ... frontmatter が不正）と取り違えない
    expect(result.stderr).not.toMatch(/frontmatter が不正|Preflight failed|Skill source not found/);
    expect(snapshot(cwdRepo)).toEqual(before);
    expect(isLink(join(cwdRepo, ".claude/skills/demo"))).toBe(true);
    expect(ghCalls(ctx)).toEqual([]);
    if (stray !== null && existsSync(join(stray, ".agents"))) {
      throw new Error(`stray tree was modified: ${stray}`);
    }
  },
);

// --- 削除より前で止める preflight と、引数の検査 ---
//
// | 止める理由                         | 入力の状態                                         |
// | ---------------------------------- | -------------------------------------------------- |
// | 引数の数                           | 0 個 / 2 個                                        |
// | スキル名                           | 大文字を含む / - で始まる / パスの区切りを含む     |
// | スキルの原本                       | skills/<name>/SKILL.md が無い                      |
// | frontmatter                        | 検査が失敗する                                     |
// | 更新先の書き込み                   | リンク先の無い symlink / 書き込めないディレクトリ  |
// | インストール済みのコピーの書き込み | 書き込めないサブディレクトリ                       |
// | local-path の除去                  | gh が別の形で local-path を書く                    |
//
// 削除より前で止める理由では、インストール済みのコピーと symlink が残り、gh を呼ばないことを確かめる。

test.each([
  ["引数が無い", []],
  ["引数が 2 個", ["demo", "extra"]],
])("%s なら使い方を出して exit 2 で止まる", (_label, args) => {
  const ctx = setup();
  const root = createRepo(ctx.base, "repo");
  preinstall(root);
  const before = snapshot(root);
  const result = run(ctx, root, ["scripts/tools/reinstall-skill.sh", ...args]);
  expect(result.status).toBe(2);
  expect(result.stderr).toMatch(/^Usage: scripts\/tools\/reinstall-skill\.sh <skill-name>\|--all/);
  expectUntouched(ctx, root, before);
});

test.each([["Demo"], ["-demo"], ["../demo"], ["a/b"]])(
  "kebab-case でないスキル名 %s は exit 2 で止まり、何も消さない",
  (name) => {
    const ctx = setup();
    const root = createRepo(ctx.base, "repo");
    preinstall(root);
    const before = snapshot(root);
    const result = run(ctx, root, ["scripts/tools/reinstall-skill.sh", name]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(
      `invalid skill name (expected kebab-case: a-z, 0-9, -): ${name}`,
    );
    expectUntouched(ctx, root, before);
  },
);

test("スキルの原本が無ければ exit 1 で止まり、何も消さない", () => {
  const ctx = setup();
  const root = createRepo(ctx.base, "repo");
  preinstall(root);
  const before = snapshot(root);
  const result = run(ctx, root, ["scripts/tools/reinstall-skill.sh", "absent"]);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Skill source not found: skills/absent/SKILL.md");
  expectUntouched(ctx, root, before);
});

test("frontmatter の検査が失敗すれば exit 1 で止まり、インストール済みのコピーを消さない", () => {
  const ctx = setup();
  const root = createRepo(ctx.base, "repo");
  writeFile(join(root, "scripts/gates/packaging/check-skill-frontmatter.ts"), "process.exit(1);\n");
  preinstall(root);
  const before = snapshot(root);
  const result = run(ctx, root, ["scripts/tools/reinstall-skill.sh", "demo"]);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Preflight failed: skills/demo/SKILL.md の frontmatter が不正");
  expectUntouched(ctx, root, before);
});

test("更新先の祖先がリンク先の無い symlink なら exit 1 で止まり、gh を呼ばない", () => {
  const ctx = setup();
  const root = createRepo(ctx.base, "repo");
  symlinkSync(join(root, "absent"), join(root, ".agents"));
  const result = run(ctx, root, ["scripts/tools/reinstall-skill.sh", "demo"]);
  expect(result.status).toBe(1);
  // 文言はスクリプトの表示のまま照合せず、止めた対象（.agents）と symlink であることを確かめる。
  expect(result.stderr).toMatch(
    /^Preflight failed: \.agents が\S+ symlink（既存のインストールは触っていない）$/mu,
  );
  expect(isLink(join(root, ".agents"))).toBe(true);
  expect(ghCalls(ctx)).toEqual([]);
});

test("更新先のディレクトリへ書き込めなければ exit 1 で止まり、インストール済みのコピーを消さない", () => {
  const ctx = setup();
  const root = createRepo(ctx.base, "repo");
  preinstall(root);
  const before = snapshot(root);
  withReadOnly(join(root, ".claude", "skills"), () => {
    const result = run(ctx, root, ["scripts/tools/reinstall-skill.sh", "demo"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Preflight failed: .claude/skills へ書き込めない");
    expectUntouched(ctx, root, before);
  });
});

test("インストール済みのコピーの中に書き込めないディレクトリがあれば exit 1 で止まり、コピーを消さない", () => {
  const ctx = setup();
  const root = createRepo(ctx.base, "repo");
  preinstall(root);
  const locked = join(root, ".agents", "skills", "demo", "locked");
  writeFile(join(locked, "a.md"), "kept\n");
  const before = snapshot(root);
  withReadOnly(locked, () => {
    const result = run(ctx, root, ["scripts/tools/reinstall-skill.sh", "demo"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Preflight failed: .agents/skills/demo/locked へ書き込めない");
    expectUntouched(ctx, root, before);
  });
});

test("gh が書いた local-path を外せなければ exit 1 で失敗を示す（機械の絶対パスを残したまま成功にしない）", () => {
  const ctx = setup();
  const root = createRepo(ctx.base, "repo");
  // metadata: の下ではない位置に local-path を書く gh。除去の正規表現に当たらない。
  writeFile(
    join(ctx.base, "bin", "gh"),
    `#!/bin/sh
set -eu
pwd -P >>"$GH_LOG"
mkdir -p .agents/skills
cp -R "$3" ".agents/skills/$4"
printf 'local-path: %s\\n' "$PWD/$3" >>".agents/skills/$4/SKILL.md"
`,
  );
  const result = run(ctx, root, ["scripts/tools/reinstall-skill.sh", "demo"]);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(
    "Failed to remove local-path metadata from .agents/skills/demo/SKILL.md",
  );
  expect(result.stdout).not.toContain("Reinstalled demo");
});
