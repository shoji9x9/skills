// テストが一時ディレクトリにファイルを置くヘルパー。
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** root の下の path に text を書く（親のディレクトリが無ければ作る）。 */
export function write(root: string, path: string, text: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}
