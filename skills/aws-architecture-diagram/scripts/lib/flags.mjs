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
 * - stdin: false なら、`-` だけの引数を位置引数にせず、受け付けない引数にする（標準入力を読まない CLI）。名前の値としての `-` は受け付ける
 * @typedef {{ values?: readonly string[], repeat?: readonly string[], bools?: readonly string[], dashValues?: readonly string[], positionals?: number, equals?: boolean, stdin?: boolean }} FlagSpec
 */

/**
 * `--名前 値` の引数を読む。誤りがあれば、error に理由を入れて返す。
 * 誤りの文は、未知の名前と多すぎる位置引数が「不明な引数: <引数>」、値の無い名前が「<名前> に値が無い」、
 * 同じ名前の 2 回目が「<名前> が重複している」、値を取らない名前に `=値` を付けたものが「<名前> は値を取らない」である。値が無いとは、名前が末尾にあって値が続かない・値が空白だけ・その CLI が受け付ける名前と同じ・
 * `--` で始まる（dashValues の名前を除く）のどれかである。`--` だけの引数はオプションの終わりで、その後はすべて位置引数にする。名前は値より先に確かめる。値を先に確かめると、値の無い未知の引数を
 * 「値が無い」と報告し、受け付ける引数のように読める。必須の引数と値の中身は、各 CLI が受け取った後に確かめる。
 * 結果は、名前の種類ごとの表（strings は値を 1 つ取る名前、lists は繰り返してよい名前、bools は値を取らない名前）と
 * 位置引数である。表のキーは `--` を含む名前である。
 * @param {readonly string[]} argv
 * @param {FlagSpec} spec
 * @returns {ParsedFlags | { error: string }}
 */
function parseFlags(argv, spec) {
  /** @type {FlagState} */
  const state = { spec, seen: new Set(), strings: {}, lists: {}, bools: {}, positionals: [] };
  for (let i = 0; i < argv.length; i += 1) {
    // 位置引数を取らない CLI では、`--` も受け付けない引数として扱う。
    if (argv[i] === "--" && (spec.positionals ?? 0) > 0) {
      const error = pushRest(argv.slice(i + 1), state);
      if (error) return { error };
      break;
    }
    const step = readFlagArg(argv, i, state);
    if ("error" in step) return { error: step.error };
    i = step.next;
  }
  const { strings, lists, bools, positionals } = state;
  return { strings, lists, bools, positionals };
}

/**
 * parseFlags の結果。
 * @typedef {{ strings: Record<string, string>, lists: Record<string, string[]>, bools: Record<string, true>, positionals: string[], error?: undefined }} ParsedFlags
 */

/**
 * parseFlags が読み進める途中の状態。seen は、読んだ名前（同じ名前の 2 回目を見つけるため）である。
 * @typedef {Omit<ParsedFlags, "error"> & { spec: FlagSpec, seen: Set<string> }} FlagState
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
  // `-` だけの引数は、標準入力を指す位置引数として扱う（stdin: false の CLI を除く）。
  if (!arg.startsWith("-") || (arg === "-" && state.spec.stdin !== false)) {
    const error = pushPositional(arg, state);
    return error ? { error } : { next: i };
  }
  const eq = state.spec.equals && arg.startsWith("--") ? arg.indexOf("=") : -1;
  if (eq <= 0 && state.spec.bools?.includes(arg)) return setBoolFlag(arg, i, state);
  const inline = eq > 0 ? { name: arg.slice(0, eq), value: arg.slice(eq + 1) } : null;
  return readValueFlag({ argv, i, inline }, state);
}

/**
 * 値を取る名前を読む。inline は `--名前=値` の形の名前と値で、無ければ次の要素を値にする。
 * @param {{ argv: readonly string[], i: number, inline: { name: string, value: string } | null }} at
 * @param {FlagState} state
 * @returns {{ next: number } | { error: string }}
 */
function readValueFlag({ argv, i, inline }, state) {
  const name = inline?.name ?? argv[i];
  if (inline && state.spec.bools?.includes(name)) return { error: `${name} は値を取らない` };
  if (!(state.spec.values?.includes(name) ?? false)) return { error: `不明な引数: ${argv[i]}` };
  const value = inline ? inline.value : argv[i + 1];
  if (value === undefined || missingValue(name, value, state.spec))
    return { error: `${name} に値が無い` };
  const error = storeFlagValue(name, value, state);
  return error ? { error } : { next: inline ? i : i + 1 };
}

/**
 * `--` より後の引数をすべて位置引数として足す。上限を超えたら、最初に超えた引数の誤りの文を返す。
 * @param {readonly string[]} rest
 * @param {FlagState} state
 * @returns {string | undefined}
 */
function pushRest(rest, state) {
  for (const arg of rest) {
    const error = pushPositional(arg, state);
    if (error) return error;
  }
  return undefined;
}

/**
 * 位置引数を足す。上限を超えたら誤りの文を返す。
 * @param {string} arg
 * @param {FlagState} state
 * @returns {string | undefined}
 */
function pushPositional(arg, state) {
  if (state.positionals.length >= (state.spec.positionals ?? 0)) return `不明な引数: ${arg}`;
  state.positionals.push(arg);
  return undefined;
}

/**
 * 値を取らない名前を bools に入れる。2 回目なら誤りの文を返す。
 * @param {string} name
 * @param {number} i
 * @param {FlagState} state
 * @returns {{ next: number } | { error: string }}
 */
function setBoolFlag(name, i, state) {
  if (state.seen.has(name)) return { error: `${name} が重複している` };
  state.seen.add(name);
  state.bools[name] = true;
  return { next: i };
}

/**
 * 値を取る名前の値を strings か lists に入れる。繰り返してよい名前は配列に足し、それ以外の 2 回目は誤りの文を返す。
 * @param {string} name
 * @param {string} value
 * @param {FlagState} state
 * @returns {string | undefined}
 */
function storeFlagValue(name, value, state) {
  if (state.spec.repeat?.includes(name)) {
    state.lists[name] = [...(state.lists[name] ?? []), value];
    return undefined;
  }
  if (state.seen.has(name)) return `${name} が重複している`;
  state.seen.add(name);
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
  // `--`（オプションの終わり）は、dashValues の名前でも値として受け付けない。
  if (value.trim() === "" || value === "--") return true;
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
