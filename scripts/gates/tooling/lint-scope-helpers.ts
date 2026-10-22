// lint-scope.test.ts のヘルパー（リポジトリのファイルを読み、glob の拡張子と import をたどる）。
import { assert, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { errorMessage } from "../../lib/errors.ts";

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

/** `*.{a,b}` / `*.a` / `!**\/*.{a,b}` から拡張子の一覧を取り出す。 */
export function extsOf(glob: string) {
  const m = /\*\.(?:\{([a-z0-9,]+)\}|([a-z0-9]+))$/.exec(glob);
  expect(m, glob).not.toBeNull();
  assert.exists(m, glob);
  return (m[1] ?? m[2]).split(",");
}

/**
 * rel が相対パスで import するリポジトリ内のファイルを、import 先がさらに import するものまでたどって集める。
 * `from "./x"`・副作用だけの `import "./x"`・`import("./x")`・`require("./x")`・単引用符を拾う。
 * パッケージ名や `node:` の import はたどらない。コメントの中の一致もたどるが、無いファイルなら、どこから来たかを示す
 * 例外になる。テンプレートリテラルや、計算したパス（`import.meta.dirname` を基にした読み込みなど）はたどらないので、
 * oxfmt.config.ts でその形を使うときは、glob と inputs に手で足す。
 * `found` は集めたパス、`from` は rel を import したファイル（たどり始めのファイルなら null）。
 */
export function repoImports(
  rel: string,
  readFile: (rel: string) => string = read,
  { found = new Set<string>(), from = null }: { found?: Set<string>; from?: string | null } = {},
): Set<string> {
  let source;
  try {
    source = readFile(rel);
  } catch (err) {
    if (from === null) throw err;
    throw new Error(
      `${from} の import 先 ${rel} を読めない（コメントの中の一致か、拡張子を省いた import を疑う）: ${errorMessage(err)}`,
    );
  }
  for (const m of source.matchAll(/\b(?:from|import|require)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g)) {
    const dep = posix.normalize(posix.join(posix.dirname(rel), m[1]));
    if (found.has(dep)) continue;
    found.add(dep);
    repoImports(dep, readFile, { found, from: rel });
  }
  return found;
}
