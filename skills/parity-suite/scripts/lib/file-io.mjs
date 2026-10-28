// CLI がファイルの読み書きに使う関数と、パスを解決する作業ディレクトリ。
// テストは子プロセスを起動せずに main を直接呼ぶので、これらを差し込めるようにする。

import { writeFileSync } from "node:fs";
import { cliIo } from "./check-cli.mjs";

/**
 * @typedef {{ readFile: (p: string) => string, writeFile: (p: string, s: string) => void, cwd: string }} FileIo
 */

/**
 * 差し込まれた関数を使い、省いたものは node:fs と process.cwd() で補う。
 * @param {{ readFile?: (p: string) => string, writeFile?: (p: string, s: string) => void, cwd?: string }} deps
 * @returns {FileIo}
 */
function fileIo(deps) {
  // 読み取りと作業ディレクトリの既定値は、検査の CLI（check-cli.mjs の cliIo）と同じものを使う。
  const { readFile, cwd } = cliIo(deps);
  return { readFile, writeFile: deps.writeFile ?? ((p, s) => writeFileSync(p, s)), cwd };
}

export { fileIo };
