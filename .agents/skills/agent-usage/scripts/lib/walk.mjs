// ディレクトリの下のファイルを、サブディレクトリまでたどって探す。

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * `dir` の下（サブディレクトリを含む）の、名前が `suffix` で終わるファイルのパス（昇順）。`dir` が無ければ空。
 * @param {string} dir
 * @param {string} suffix
 * @returns {string[]}
 */
export function filesUnder(dir, suffix) {
  if (!existsSync(dir)) return [];
  /** @type {string[]} */
  const out = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...filesUnder(p, suffix));
    else if (ent.isFile() && ent.name.endsWith(suffix)) out.push(p);
  }
  return out.sort();
}
