// reinstall-skill.test.ts のヘルパー（fixture のツリーとスタブの gh を作り、スクリプトを実行して結果を記録する）。
import { expect } from "vitest";
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
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir } from "../lib/testing/test-tmpdir.ts";
import { CHILD_TIMEOUT_MS } from "../lib/testing/child-timeout.ts";

export const script = join(dirname(fileURLToPath(import.meta.url)), "reinstall-skill.sh");

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

export function writeFile(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

// 本物のリポジトリと同じ位置にスクリプトを置いたツリーを作る。marker を落とした形は omit で作る。
export function createRepo(
  base: string,
  name: string,
  { body = "demo body", omit = [] }: { body?: string; omit?: string[] } = {},
) {
  const root = join(base, name);
  mkdirSync(join(root, "sub", "dir"), { recursive: true });
  mkdirSync(join(root, "scripts", "tools"), { recursive: true });
  copyFileSync(script, join(root, "scripts", "tools", "reinstall-skill.sh"));
  if (!omit.includes("gates")) {
    writeFile(
      join(root, "scripts", "gates", "packaging", "check-skill-frontmatter.ts"),
      "process.exit(0);\n",
    );
  }
  if (!omit.includes("skills")) {
    writeFile(join(root, "skills", "demo", "SKILL.md"), `---\nname: demo\n---\n\n${body}\n`);
    writeFile(join(root, "skills", "demo", "references", "a.md"), `${body} ref\n`);
  }
  return root;
}

// 既にインストール済みのコピーと symlink を置く（止まったときに消えていないことを確かめる対象）。
export function preinstall(root: string) {
  writeFile(join(root, ".agents", "skills", "demo", "SKILL.md"), "previously installed\n");
  mkdirSync(join(root, ".claude", "skills"), { recursive: true });
  symlinkSync("../../.agents/skills/demo", join(root, ".claude", "skills", "demo"));
}

export function setup() {
  const base = makeTempDir("reinstall-skill-");
  const bin = join(base, "bin");
  writeFile(join(bin, "gh"), FAKE_GH);
  chmodSync(join(bin, "gh"), 0o755);
  return { base, ghLog: join(base, "gh.log"), env: { PATH: `${bin}:${process.env.PATH}` } };
}

export type Ctx = ReturnType<typeof setup>;

/** cwd で args を実行する。input を渡すと、スクリプトを stdin から bash に読ませる。 */
export function runWith(
  ctx: Ctx,
  cwd: string,
  { args, input, env }: { args: string[]; input?: string; env?: NodeJS.ProcessEnv },
) {
  const [cmd, ...rest] = input === undefined ? args : ["bash", "-s", ...args];
  return spawnSync(cmd, rest, {
    cwd,
    encoding: "utf8",
    input: input ?? "",
    env: { ...process.env, ...ctx.env, GH_LOG: ctx.ghLog, ...env },
    timeout: CHILD_TIMEOUT_MS,
  });
}

export function run(ctx: Ctx, cwd: string, args: string[]) {
  return runWith(ctx, cwd, { args });
}

// .agents / .claude の中身を、ファイルは内容、symlink はリンク先で記録する（root 自身の絶対パスは伏せる）。
export function snapshot(root: string) {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
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

export function isLink(path: string) {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

export function ghCalls(ctx: Ctx) {
  return existsSync(ctx.ghLog) ? readFileSync(ctx.ghLog, "utf8").trim().split("\n") : [];
}

/** 書き込めなくしたディレクトリを、後片付けの前に戻す。 */
export function withReadOnly(dir: string, body: () => void) {
  chmodSync(dir, 0o555);
  try {
    body();
  } finally {
    chmodSync(dir, 0o755);
  }
}

export function expectUntouched(ctx: Ctx, root: string, before: Record<string, string>) {
  expect(snapshot(root)).toEqual(before);
  expect(ghCalls(ctx)).toEqual([]);
}
