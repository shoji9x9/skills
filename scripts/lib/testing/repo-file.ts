// テストが一時ディレクトリにファイルを置き、git のリポジトリにするヘルパー。
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CHILD_TIMEOUT_MS } from "./child-timeout.ts";
import { spawnEnd } from "../errors.ts";

/** このリポジトリのルート。 */
export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** root の下の path に text を書く（親のディレクトリが無ければ作る）。 */
export function write(root: string, path: string, text: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

/** root で git init を実行する。失敗したら例外にする。 */
export function gitInit(root: string) {
  const r = spawnSync("git", ["init", "-q"], {
    timeout: CHILD_TIMEOUT_MS,
    cwd: root,
    encoding: "utf8",
  });
  if (r.status !== 0) {
    throw new Error(`git init に失敗した（${spawnEnd(r)}）: ${r.stderr ?? ""}`);
  }
}
