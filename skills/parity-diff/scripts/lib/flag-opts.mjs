// `--名前 値` の引数を読む処理。coverage-check.mjs と pending-triage-check.mjs が共有する。
// 使い方の誤りは stderr に書く。必須の引数は、各 CLI が受け取った後に確かめる。

/**
 * `--名前 値` の組を、`--` を外した名前から値への対応にする。
 * `known` に無い引数・値の無い引数（値が無いか、`--` で始まる）・同じ名前の 2 回目があれば、stderr に書いて null を返す。
 * `--` で始まる値を受け取ると、値を書き忘れた引数が次の名前を値として取り込み、使い方の誤りではなく読めないファイルとして報告する。
 * @param {string[]} argv
 * @param {readonly string[]} known 受け付ける引数（`--` を含む）
 * @param {string} usage 使い方の文（末尾に改行を含む）
 * @returns {Record<string, string> | null}
 */
function parseFlagOpts(argv, known, usage) {
  /** @type {Record<string, string>} */
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!known.includes(a)) {
      process.stderr.write(`unknown argument: ${a}\n${usage}`);
      return null;
    }
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) {
      process.stderr.write(usage);
      return null;
    }
    if (opts[a.slice(2)] !== undefined) {
      // 同じフラグを重ねて指定したときに、警告なしに後のものを採らない（どちらを読んだかが出力から分からなくなる）。
      process.stderr.write(`error: ${a} が複数回指定されている\n${usage}`);
      return null;
    }
    opts[a.slice(2)] = v;
    i += 1;
  }
  return opts;
}

export { parseFlagOpts };
