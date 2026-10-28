// CLI として起動されたかの判定。
// `import.meta.main` は Node 24.2・22.18 より古い版に無く、`.ts` を実行できる 23.6〜24.1 では undefined になる。
// その版で起動すると、Hook とチェックが main を呼ばずに exit 0 で終わるので、版に依らない判定にする。
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** 実パス。解決できない（ファイルが無いなど）ときは、絶対パスにしただけの値。 */
function realOrResolved(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/**
 * `moduleUrl`（呼び出し元の `import.meta.url`）のファイルが、node に渡されたスクリプトか。
 * 両辺を実パスにそろえて比べる。片側だけを解決すると、シンボリックリンクから起動したときに何もせずに終わる。
 * node に渡されたスクリプトは読み込めた実在のファイルなので、解決できない `argv[1]` は、
 * `node -e` の後ろの引数のようなスクリプトでない値である。そのときは、起動されていないと判定する。
 */
export function isCliEntry(moduleUrl: string): boolean {
  const script = process.argv[1];
  if (!script) return false;
  return realOrResolved(script) === realOrResolved(fileURLToPath(moduleUrl));
}
