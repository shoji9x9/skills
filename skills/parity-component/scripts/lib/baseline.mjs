// 部品の成果物ディレクトリから、metadata.json と、各インスタンスの採取物（behaviors.json・motions.json）を読む。
// behavior-compare.mjs と motion-compare.mjs は、読むファイルの名前だけが違う同じ処理を使う。

import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { field, safeSegment } from "./guards.mjs";
import { isArray } from "./is-array.mjs";

/**
 * 部品の成果物ディレクトリから metadata.json と各インスタンスの `fileName` を読む。
 * `fileName` が無い・読めないインスタンスは null（未採取として判定側が数える）。
 * @param {string} dir
 * @param {string} fileName baseline/<インスタンスの id>/ の下で読むファイルの名前
 * @returns {{ metadata: unknown, byInstance: Record<string, unknown> }} 中身の形は検査しない（呼び出し側の判定が検査する）。
 */
function loadBaseline(dir, fileName) {
  const metadata = JSON.parse(readFileSync(join(dir, "metadata.json"), "utf8"));
  /** @type {Record<string, unknown>} */
  const byInstance = {};
  const declared = field(metadata, "instances");
  const instances = isArray(declared) ? declared : [];
  const baselineRoot = resolve(dir, "baseline");
  /** @type {string | null} baseline の実パス（最初に採取物を解決できたときに 1 回だけ解決する） */
  let realBaselineRoot = null;
  for (const inst of instances) {
    const id = field(inst, "id");
    if (!safeSegment(id)) {
      throw new Error(`instances[].id がパスの 1 セグメントとして不正: ${JSON.stringify(id)}`);
    }
    const path = resolve(baselineRoot, id, fileName);
    let realPath;
    try {
      realPath = realpathSync(path);
    } catch {
      byInstance[id] = null;
      continue;
    }
    // 包含の判定は両辺を実パスに解決してから行う（リンク経由で外のファイルを読ませない）。
    realBaselineRoot ??= realpathSync(baselineRoot);
    const rel = relative(realBaselineRoot, realPath);
    if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new Error(`採取物のパスが baseline の外を指す: ${path} → ${realPath}`);
    }
    try {
      byInstance[id] = JSON.parse(readFileSync(realPath, "utf8"));
    } catch {
      byInstance[id] = null;
    }
  }
  return { metadata, byInstance };
}

export { loadBaseline };
