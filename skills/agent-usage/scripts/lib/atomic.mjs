// ファイルを一時ファイルに書いてから rename で置き換える（書きかけのファイルを他の処理に読ませない）。

import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * @param {string} path
 * @param {string} text
 */
export function writeFileAtomic(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}
