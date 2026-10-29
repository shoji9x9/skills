// CLI として起動されたかの判定。
// `import.meta.main` は Node 24.2・22.18 より古いバージョンに無く、`.ts` を実行できる 23.6〜24.1 では undefined になる。
// そのバージョンで起動すると、Hook とチェックが main を呼ばずに exit 0 で終わるので、バージョンに依らない判定にする。
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { errorMessage, isErrnoException } from "../errors.ts";

/**
 * 実パス。ファイルが無い（ENOENT）ときは、絶対パスにしただけの値。
 * それ以外の理由（権限など）で解決できないときは、起動されたかを判定できないので例外にする。
 * 例外にしないと、チェックや Hook が main を呼ばずに exit 0 で終わり、合格として扱われる。
 */
function realOrResolved(path: string): string {
  try {
    return realpathSync(path);
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") return resolve(path);
    throw new Error(`起動パスを正規化できない（${path}）: ${errorMessage(error)}`, {
      cause: error,
    });
  }
}

/**
 * `moduleUrl`（呼び出し元の `import.meta.url`）のファイルが、node に渡されたスクリプトか。
 * 両辺を実パスにそろえて比べる。片側だけを解決すると、シンボリックリンクから起動したときに何もせずに終わる。
 * node に渡されたスクリプトは読み込めた実在のファイルなので、無い `argv[1]` は、
 * `node -e` の後ろの引数のようなスクリプトでない値である。そのときは、起動されていないと判定する。
 */
export function isCliEntry(moduleUrl: string): boolean {
  const script = process.argv[1];
  if (!script) return false;
  return realOrResolved(script) === realOrResolved(fileURLToPath(moduleUrl));
}
