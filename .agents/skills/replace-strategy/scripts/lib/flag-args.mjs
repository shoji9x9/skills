// `--名前 値` の形の引数だけを受け付ける CLI が共有する、stdout・stderr への出力。引数は lib/flags.mjs の parseFlags で読む。
// このファイルは、同じ内容を複数の配布スキルが持つ。スキルの中で完結させるため、共有せずにコピーする。

/**
 * @typedef {{ out: (value: unknown) => void, fail: (message: string) => number }} Io
 */

/**
 * 結果の JSON を stdout に出す out と、理由と使い方を stderr に出して終了コード 2 を返す fail を作る。
 * @param {{ stdout?: (s: string) => void, stderr?: (s: string) => void }} deps 出力先（省略すると process の stdout・stderr）
 * @param {string} usage 使い方の文
 * @returns {Io}
 */
function makeIo(deps, usage) {
  const out = (/** @type {unknown} */ value) =>
    (deps.stdout ?? ((s) => process.stdout.write(s)))(`${JSON.stringify(value, null, 2)}\n`);
  const fail = (/** @type {string} */ message) => {
    (deps.stderr ?? ((s) => process.stderr.write(s)))(`${message}\n${usage}\n`);
    return 2;
  };
  return { out, fail };
}

export { makeIo };
