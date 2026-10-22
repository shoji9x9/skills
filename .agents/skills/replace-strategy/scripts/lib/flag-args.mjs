// `--名前 値` の形の引数だけを受け付ける CLI（pending-decisions-check.mjs・procedure-staleness-check.mjs）が共有する、
// 引数の読み取りと、stdout・stderr への出力。
// 2 つの CLI で引数の扱いとエラー文を揃えるため、1 か所に置く。必須の引数と値の検査は、各 CLI が受け取った後に行う。

/**
 * `--名前 値` の組を読む。未知の名前・値の無い名前・2 回目の名前があれば、error に理由を入れて返す。
 * @param {string[]} argv
 * @param {ReadonlySet<string>} known 受け付ける名前
 * @returns {{ args: Record<string, string>, error?: undefined } | { args?: undefined, error: string }}
 */
function parseFlagArgs(argv, known) {
  /** @type {Record<string, string>} */
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!known.has(key)) return { error: `未知の引数: ${key}` };
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) return { error: `${key} に値が無い` };
    if (Object.hasOwn(args, key)) return { error: `${key} が重複している` };
    args[key] = value;
    i += 1;
  }
  return { args };
}

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

export { makeIo, parseFlagArgs };
