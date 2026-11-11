// CLI として起動されたか（`process.argv[1]` が呼び出し元のモジュールか）を判定する。
// 起動時のパス（`process.argv[1]`）はシンボリックリンクを解決しない。`--preserve-symlinks-main` を付けると
// （NODE_OPTIONS で付けた場合も）呼び出し元のモジュールの URL も解決しない。片側だけを解決すると、
// シンボリックリンク（.claude/skills/<name> → .agents/skills/<name>）から起動したときに条件が偽になり、
// main() が呼ばれず、何も出力せずに exit 0 で終わる。そのため、両辺を実パスに解決してから比べる。
// このファイルは、同じ内容を複数の配布スキルが持つ。スキルの中で完結させるため、共有せずにコピーする。
// 利用者のプロジェクトへ 1 ファイルだけコピーして使うスクリプト（parity-suite の `trait-compare.mjs` など）は import できない。
// そのため、印（`// cli-entry-js:begin`〜`// cli-entry-js:end`）の間と同じ関数をファイルの中に持つ。

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

// cli-entry-js:begin
/**
 * CLI として起動されたか。
 * @param {string} moduleUrl 呼び出し元のモジュールの URL
 * @returns {boolean}
 */
function isCliEntry(moduleUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  const self = fileURLToPath(moduleUrl);
  try {
    return realpathSync(entry) === realpathSync(self);
  } catch {
    // 実パスへの解決に失敗したら、起動時のパスのまま突き合わせる（何もせずに終わるより、誤って起動する方を選ぶ）。
    return entry === self;
  }
}
// cli-entry-js:end

export { isCliEntry };
