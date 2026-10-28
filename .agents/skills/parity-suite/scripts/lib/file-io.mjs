// CLI がファイルの読み書きに使う関数と、パスを解決する作業ディレクトリ。
// テストは子プロセスを起動せずに main を直接呼ぶので、これらを差し込めるようにする。

import { readFileSync, writeFileSync } from "node:fs";

/**
 * @typedef {{ readFile: (p: string) => string, writeFile: (p: string, s: string) => void, cwd: string }} FileIo
 */

/**
 * 差し込まれた関数を使い、省いたものは node:fs と process.cwd() で補う。
 * @param {{ readFile?: (p: string) => string, writeFile?: (p: string, s: string) => void, cwd?: string }} deps
 * @returns {FileIo}
 */
function fileIo(deps) {
  return {
    readFile: deps.readFile ?? ((p) => readFileSync(p, "utf8")),
    writeFile: deps.writeFile ?? ((p, s) => writeFileSync(p, s)),
    cwd: deps.cwd ?? process.cwd(),
  };
}

export { fileIo };
