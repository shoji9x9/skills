// box-folder.test.ts のヘルパー。
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";
import { coverageEnv } from "../../lib/testing/coverage-env.ts";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const SCRIPT = join(repoRoot, "skills/box/scripts/box-folder.sh");
const which = (cmd: string) =>
  execFileSync("bash", ["-c", `command -v ${cmd}`], {
    encoding: "utf8",
    timeout: CHILD_TIMEOUT_MS,
  }).trim();
export const BASH = which("bash");

/** git と dirname だけを置いた PATH（node を含めないとき）か、node も置いた PATH を作る。 */
export function setup({ node }: { node: boolean }) {
  const dir = makeTempDir("box-folder-");
  const bin = join(dir, "bin");
  mkdirSync(bin);
  for (const cmd of ["git", "dirname"]) symlinkSync(which(cmd), join(bin, cmd));
  if (node) symlinkSync(process.execPath, join(bin, "node"));
  const repo = join(dir, "repo");
  mkdirSync(repo);
  execFileSync("git", ["init", "-q"], { cwd: repo, timeout: CHILD_TIMEOUT_MS });
  writeFileSync(join(repo, ".gitignore"), "/.config/skills/shoji9x9/*.local.jsonc\n");
  const configDir = join(repo, ".config", "skills", "shoji9x9");
  const xdg = join(dir, "xdg");
  const env: Record<string, string> = {
    ...coverageEnv(),
    PATH: bin,
    HOME: join(dir, "home"),
    XDG_CONFIG_HOME: xdg,
  };
  const write = (rel: string, text: string) => {
    const p = rel.startsWith("xdg:") ? join(xdg, rel.slice(4)) : join(configDir, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
  };
  const run = (extra: Record<string, string> = {}, cwd = repo) =>
    spawnSync(BASH, [SCRIPT], {
      cwd,
      env: { ...env, ...extra },
      encoding: "utf8",
      timeout: CHILD_TIMEOUT_MS,
    });
  return { dir, repo, configDir, write, run };
}

/** lib/home.sh を source して box_resolve_home を呼び、決まったホームと理由を返す。 */
export function resolveHome(env: Record<string, string>, idScript: string | null) {
  const dir = makeTempDir("box-home-");
  const bin = join(dir, "bin");
  mkdirSync(bin);
  if (idScript !== null) {
    writeFileSync(join(bin, "id"), idScript);
    chmodSync(join(bin, "id"), 0o755);
  }
  const lib = join(repoRoot, "skills/box/scripts/lib/home.sh");
  const r = spawnSync(
    BASH,
    [
      "-c",
      `. ${JSON.stringify(lib)}; box_resolve_home; printf '%s\\n%s\\n' "$box_home_dir" "$box_home_reason"`,
    ],
    { env: { ...coverageEnv(), PATH: bin, ...env }, encoding: "utf8", timeout: CHILD_TIMEOUT_MS },
  );
  const [home, reason] = r.stdout.split("\n");
  return { status: r.status, home, reason };
}
