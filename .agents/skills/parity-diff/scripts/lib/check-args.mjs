// parity-diff の検査の CLI（coverage-check・pending-triage-check）が引数を読む部品。

import { parseFlags } from "./flags.mjs";

/**
 * 値を 1 つ取る引数を読み、名前から `--` を外したものをキーにして返す。
 * 使い方の誤りと、必須の引数が無いときは、stderr に書いて null を返す。
 * @param {string[]} argv
 * @param {{ values: readonly string[], required: readonly string[], usage: string }} spec
 * required は `--` を外した名前で書く。
 * @returns {Record<string, string> | null}
 */
export function parseCheckArgs(argv, { values, required, usage }) {
  const parsed = parseFlags(argv, { values });
  if (parsed.error !== undefined) {
    process.stderr.write(`error: ${parsed.error}\n${usage}`);
    return null;
  }
  const opts = Object.fromEntries(
    Object.entries(parsed.strings).map(([name, value]) => [name.slice(2), value]),
  );
  if (required.some((name) => !opts[name])) {
    process.stderr.write(usage);
    return null;
  }
  return opts;
}
