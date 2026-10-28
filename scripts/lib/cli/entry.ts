// CLI として起動されたかの判定。
// `import.meta.main` は Node 24.2・22.18 より古い版に無く、`.ts` を実行できる 23.6〜24.1 では undefined になる。
// その版で起動すると、Hook とチェックが main を呼ばずに exit 0 で終わるので、版に依らない判定にする。
import { realpathSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { errorMessage } from "../errors.ts";

/**
 * `moduleUrl`（呼び出し元の `import.meta.url`）のファイルが、node に渡されたスクリプトか。
 * 両辺を実パスにそろえて比べる。片側だけを解決すると、シンボリックリンクから起動したときに何もせずに終わる。
 * 正規化に失敗したら「起動されていない」とは扱わず、理由を出して exit 1 で終える。
 */
export function isCliEntry(moduleUrl: string): boolean {
  const script = process.argv[1];
  if (!script) return false;
  const self = fileURLToPath(moduleUrl);
  try {
    return realpathSync(script) === realpathSync(self);
  } catch (error) {
    console.error(`${basename(self)}: 起動パスを正規化できない: ${errorMessage(error)}`);
    process.exit(1);
  }
}
