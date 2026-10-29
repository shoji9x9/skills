// 配布スキルの CLI が `--名前 値` の引数を読む部品。
// このファイルは、同じ内容を複数の配布スキルが持つ。スキルの中で完結させるため、共有せずにコピーする。
// 1 ファイルだけを利用者のプロジェクトへコピーするスクリプトは、印の間の範囲を同じ内容で持つ（identical-copies の組で確かめる）。

// parse-flags-js:begin
/**
 * CLI が受け付ける引数。
 * - values: 値を 1 つ取る名前。同じ名前の 2 回目は誤りにする
 * - repeat: values のうち、繰り返してよい名前。値は配列で返す
 * - bools: 値を取らない名前。同じ名前の 2 回目は誤りにする
 * - dashValues: values のうち、`--` で始まる値を受け付ける名前（CSS のカスタムプロパティなど）。受け付ける名前と同じ値だけを、値の書き忘れとして誤りにする
 * - positionals: 位置引数（`-` で始まらない引数と、`-` だけの引数）の最大の数（省略すると 0）
 * - equals: true なら `--名前=値` の形も受け付ける
 * @typedef {{ values?: readonly string[], repeat?: readonly string[], bools?: readonly string[], dashValues?: readonly string[], positionals?: number, equals?: boolean }} FlagSpec
 */

/**
 * `--名前 値` の引数を読む。誤りがあれば、error に理由を入れて返す。
 * 誤りの文は、未知の名前と多すぎる位置引数が「不明な引数: <引数>」、値が無い・空・`--` で始まる値が「<名前> に値が無い」、
 * 同じ名前の 2 回目が「<名前> が重複している」である。名前は値より先に確かめる。値を先に確かめると、値の無い未知の引数を
 * 「値が無い」と報告し、受け付ける引数のように読める。必須の引数と値の中身は、各 CLI が受け取った後に確かめる。
 * @param {readonly string[]} argv
 * @param {FlagSpec} spec
 * 結果は、名前の種類ごとの表（strings は値を 1 つ取る名前、lists は繰り返してよい名前、bools は値を取らない名前）と、
 * それらをまとめた flags である。キーは `--` を含む名前である。
 * @returns {ParsedFlags | { error: string }}
 */
function parseFlags(argv, spec) {
  /** @type {FlagState} */
  const state = { spec, flags: {}, strings: {}, lists: {}, bools: {}, positionals: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const step = readFlagArg(argv, i, state);
    if ("error" in step) return { error: step.error };
    i = step.next;
  }
  const { flags, strings, lists, bools, positionals } = state;
  return { flags, strings, lists, bools, positionals };
}

/**
 * parseFlags の結果。
 * @typedef {{ flags: Record<string, string | string[] | true>, strings: Record<string, string>, lists: Record<string, string[]>, bools: Record<string, true>, positionals: string[], error?: undefined }} ParsedFlags
 */

/**
 * parseFlags が読み進める途中の状態。
 * @typedef {Omit<ParsedFlags, "error"> & { spec: FlagSpec }} FlagState
 */

/**
 * argv[i] を 1 つ読み、値を読んだなら次の位置を、誤りなら理由を返す。
 * @param {readonly string[]} argv
 * @param {number} i
 * @param {FlagState} state
 * @returns {{ next: number } | { error: string }}
 */
function readFlagArg(argv, i, state) {
  const arg = argv[i];
  // `-` だけの引数は、標準入力を指す位置引数として扱う。
  if (!arg.startsWith("-") || arg === "-") return pushPositional(arg, i, state);
  const eq = state.spec.equals && arg.startsWith("--") ? arg.indexOf("=") : -1;
  if (eq <= 0 && state.spec.bools?.includes(arg)) return setBoolFlag(arg, i, state);
  const name = eq > 0 ? arg.slice(0, eq) : arg;
  if (!(state.spec.values?.includes(name) ?? false)) return { error: `不明な引数: ${arg}` };
  const value = eq > 0 ? arg.slice(eq + 1) : argv[i + 1];
  if (value === undefined || value === "" || dashValueRejected(name, value, state.spec))
    return { error: `${name} に値が無い` };
  const error = storeFlagValue(name, value, state);
  return error ? { error } : { next: eq > 0 ? i : i + 1 };
}

/**
 * 位置引数を足す。上限を超えたら誤りの文を返す。
 * @param {string} arg
 * @param {number} i
 * @param {FlagState} state
 * @returns {{ next: number } | { error: string }}
 */
function pushPositional(arg, i, state) {
  if (state.positionals.length >= (state.spec.positionals ?? 0))
    return { error: `不明な引数: ${arg}` };
  state.positionals.push(arg);
  return { next: i };
}

/**
 * 値を取らない名前を flags に入れる。2 回目なら誤りの文を返す。
 * @param {string} name
 * @param {number} i
 * @param {FlagState} state
 * @returns {{ next: number } | { error: string }}
 */
function setBoolFlag(name, i, state) {
  if (state.flags[name] !== undefined) return { error: `${name} が重複している` };
  state.flags[name] = true;
  state.bools[name] = true;
  return { next: i };
}

/**
 * 値を取る名前の値を flags に入れる。繰り返してよい名前は配列に足し、それ以外の 2 回目は誤りの文を返す。
 * @param {string} name
 * @param {string} value
 * @param {FlagState} state
 * @returns {string | undefined}
 */
function storeFlagValue(name, value, state) {
  if (state.spec.repeat?.includes(name)) {
    state.lists[name] = [...(state.lists[name] ?? []), value];
    state.flags[name] = state.lists[name];
    return undefined;
  }
  if (state.flags[name] !== undefined) return `${name} が重複している`;
  state.flags[name] = value;
  state.strings[name] = value;
  return undefined;
}

/**
 * `--` で始まる値を、値の書き忘れとして扱うか。
 * dashValues の名前は `--` で始まる値を受け付け、受け付ける名前と同じ値だけを値の書き忘れとして扱う。
 * @param {string} name
 * @param {string} value
 * @param {FlagSpec} spec
 * @returns {boolean}
 */
function dashValueRejected(name, value, spec) {
  if (!value.startsWith("--")) return false;
  if (!(spec.dashValues?.includes(name) ?? false)) return true;
  return (spec.values?.includes(value) ?? false) || (spec.bools?.includes(value) ?? false);
}
// parse-flags-js:end

export { parseFlags };
