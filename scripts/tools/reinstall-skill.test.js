// reinstall-skill.sh が操作対象のリポジトリを cwd ではなくスクリプト自身の位置から決めること（Issue #547）。
//
// fixture は本物のリポジトリを模した最小のツリーで、`gh` と frontmatter 検査はスタブにする
// （検査対象は起点の決め方と止まり方で、インストール手順そのものではない）。
// スタブの `gh` は起動された cwd を記録するので、「どのツリーを操作したか」が出力に残る。
import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir } from "../lib/test-tmpdir.js";

const script = join(dirname(fileURLToPath(import.meta.url)), "reinstall-skill.sh");

// `gh skill install ./skills/<name> <name> --from-local --agent codex --force` の副作用だけを再現する
// （.agents/skills/<name> へコピーし、--from-local が注入する local-path を付ける）。
const FAKE_GH = `#!/bin/sh
set -eu
[ "$1 $2" = "skill install" ] || { echo "unexpected gh call: $*" >&2; exit 99; }
pwd -P >>"$GH_LOG"
mkdir -p .agents/skills
cp -R "$3" ".agents/skills/$4"
printf 'metadata:\\n  local-path: %s\\n' "$PWD/$3" >>".agents/skills/$4/SKILL.md"
`;

function writeFile(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

// 本物のリポジトリと同じ位置にスクリプトを置いたツリーを作る。marker を落とした形は omit で作る。
function createRepo(base, name, { body = "demo body", omit = [] } = {}) {
  const root = join(base, name);
  mkdirSync(join(root, "sub", "dir"), { recursive: true });
  mkdirSync(join(root, "scripts", "tools"), { recursive: true });
  copyFileSync(script, join(root, "scripts", "tools", "reinstall-skill.sh"));
  if (!omit.includes("gates")) {
    writeFile(join(root, "scripts", "gates", "check-skill-frontmatter.js"), "process.exit(0);\n");
  }
  if (!omit.includes("skills")) {
    writeFile(join(root, "skills", "demo", "SKILL.md"), `---\nname: demo\n---\n\n${body}\n`);
    writeFile(join(root, "skills", "demo", "references", "a.md"), `${body} ref\n`);
  }
  return root;
}

// 既にインストール済みのコピーと symlink を置く（止まったときに消えていないことを確かめる対象）。
function preinstall(root) {
  writeFile(join(root, ".agents", "skills", "demo", "SKILL.md"), "previously installed\n");
  mkdirSync(join(root, ".claude", "skills"), { recursive: true });
  symlinkSync("../../.agents/skills/demo", join(root, ".claude", "skills", "demo"));
}

function setup() {
  const base = makeTempDir("reinstall-skill-");
  const bin = join(base, "bin");
  writeFile(join(bin, "gh"), FAKE_GH);
  chmodSync(join(bin, "gh"), 0o755);
  return { base, ghLog: join(base, "gh.log"), env: { PATH: `${bin}:${process.env.PATH}` } };
}

function run(ctx, cwd, args, { input, env } = {}) {
  const [cmd, ...rest] = input === undefined ? args : ["bash", "-s", ...args];
  return spawnSync(cmd, rest, {
    cwd,
    encoding: "utf8",
    input: input ?? "",
    env: { ...process.env, ...ctx.env, GH_LOG: ctx.ghLog, ...env },
    timeout: 30_000,
  });
}

// .agents / .claude の中身を、ファイルは内容、symlink はリンク先で記録する（root 自身の絶対パスは伏せる）。
function snapshot(root) {
  const out = {};
  const walk = (dir) => {
    if (!existsSync(dir) && !isLink(dir)) return;
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      const key = relative(root, path);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) out[key] = `-> ${readlinkSync(path)}`;
      else if (stat.isDirectory()) walk(path);
      else out[key] = readFileSync(path, "utf8").replaceAll(root, "<root>");
    }
  };
  walk(join(root, ".agents"));
  walk(join(root, ".claude"));
  return out;
}

function isLink(path) {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

function ghCalls(ctx) {
  return existsSync(ctx.ghLog) ? readFileSync(ctx.ghLog, "utf8").trim().split("\n") : [];
}

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
  const result = run(ctx, root, ["scripts/tools/reinstall-skill.sh", "demo"], {
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
    (root) => [join(root, "sub", "dir"), "../../scripts/tools/reinstall-skill.sh"],
  ],
  [
    "サブディレクトリから絶対パスで",
    (root) => [join(root, "sub", "dir"), join(root, "scripts/tools/reinstall-skill.sh")],
  ],
  [
    "リポジトリの外から絶対パスで",
    (root) => [dirname(root), join(root, "scripts/tools/reinstall-skill.sh")],
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
    (ctx) => createRepo(ctx.base, "stray", { omit: ["gates"] }),
  ],
  [
    "スクリプトの位置のツリーに skills/ が無い",
    (ctx) => createRepo(ctx.base, "stray", { omit: ["skills"] }),
  ],
  ["スクリプトを stdin から読ませた", () => null],
  [
    "スクリプトだけをリポジトリの外へコピーした",
    (ctx) => {
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
        ? run(ctx, cwdRepo, ["demo"], { input: readFileSync(script, "utf8") })
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
