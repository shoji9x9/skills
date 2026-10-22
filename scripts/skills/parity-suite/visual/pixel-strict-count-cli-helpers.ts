// pixel-strict-count-cli.test.ts が使うヘルパーと fixture。
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { encodePng } from "../../../lib/testing/fake-pngjs.ts";
import { CHILD_TIMEOUT_MS } from "../../../lib/testing/child-timeout.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const script = join(repoRoot, "skills/parity-suite/scripts/pixel-strict-count.mjs");
const HOOKS = fileURLToPath(new URL("../../../lib/testing/fake-pngjs-hooks.ts", import.meta.url));

/** RGBA の画素の列を PNG で書き、そのパスを返す。 */
export function writeImage(
  dir: string,
  name: string,
  { width, pixels }: { width: number; pixels: number[][] },
) {
  const path = join(dir, name);
  writeFileSync(path, encodePng(width, pixels.length / width, Uint8Array.from(pixels.flat())));
  return path;
}

/** 偽の pngjs で CLI を子プロセスとして実行する（計測の環境変数は親から引き継ぐ）。 */
export function run(argv: string[]) {
  const r = spawnSync(process.execPath, ["--import", pathToFileURL(HOOKS).href, script, ...argv], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: CHILD_TIMEOUT_MS,
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}
