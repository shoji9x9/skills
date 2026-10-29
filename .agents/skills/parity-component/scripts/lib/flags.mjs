// 配布スキルの CLI が `--名前 値` の引数を読む部品。
// このファイルは、同じ内容を複数の配布スキルが持つ。スキルの中で完結させるため、共有せずにコピーする。
// 1 ファイルだけを利用者のプロジェクトへコピーするスクリプトは、印の間の範囲を同じ内容で持つ（identical-copies の組で確かめる）。

// parse-flags-js:begin
/**
 * CLI が受け付ける引数。
 * - values: 値を 1 つ取る名前。同じ名前の 2 回目は誤りにする
 * - repeat: values のうち、繰り返してよい名前。値は配列で返す
 * - bools: 値を取らない名前。同じ名前の 2 回目は誤りにする
 * - dashValues: values のうち、`--` で始まる値を受け付ける名前（CSS のカスタムプロパティなど）
 * - positionals: 位置引数（`-` で始まらない引数・`-` だけの引数・`--` より後の引数）の最大の数（省略すると 0）
 * - equals: true なら `--名前=値` の形も受け付ける
 * @typedef {{ values?: readonly string[], repeat?: readonly string[], bools?: readonly string[], dashValues?: readonly string[], positionals?: number, equals?: boolean }} FlagSpec
 */

/**
 * `--名前 値` の引数を読む。誤りがあれば、error に理由を入れて返す。
 * 誤りの文は、未知の名前と多すぎる位置引数が「不明な引数: <引数>」、値の無い名前が「<名前> に値が無い」、
 * 同じ名前の 2 回目が「<名前> が重複している」である。値が無いとは、値が末尾で無い・空白だけ・その CLI が受け付ける名前と同じ・
 * `--` で始まる（dashValues の名前を除く）のどれかである。`--` だけの引数はオプションの終わりで、その後はすべて位置引数にする。名前は値より先に確かめる。値を先に確かめると、値の無い未知の引数を
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
    if (argv[i] === "--") {
      const rest = argv.slice(i + 1).map((arg) => pushPositional(arg, i, state));
      const failed = rest.find((step) => "error" in step);
      if (failed && "error" in failed) return { error: failed.error };
      break;
    }
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
  if (value === undefined || missingValue(name, value, state.spec))
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
 * 値を、値の書き忘れとして扱うか。空白だけの値と、その CLI が受け付ける名前と同じ値（`-h` を含む）は、書き忘れとして扱う。
 * `--` で始まる値も書き忘れとして扱うが、dashValues の名前は受け付ける（CSS のカスタムプロパティなど）。
 * @param {string} name
 * @param {string} value
 * @param {FlagSpec} spec
 * @returns {boolean}
 */
function missingValue(name, value, spec) {
  if (value.trim() === "") return true;
  if ((spec.values?.includes(value) ?? false) || (spec.bools?.includes(value) ?? false))
    return true;
  return value.startsWith("--") && !(spec.dashValues?.includes(name) ?? false);
}
// parse-flags-js:end

/**
 * 名前の表のキーから `--` を外す（`{ "--out": "a" }` を `{ out: "a" }` にする）。
 * @template T
 * @param {Record<string, T>} table
 * @returns {Record<string, T>}
 */
function stripDashes(table) {
  return Object.fromEntries(
    Object.entries(table).map(([name, value]) => [name.replace(/^--/, ""), value]),
  );
}

export { parseFlags, stripDashes };
