// `--名前 値` の組を並べた CLI の引数を読む処理。

// 名前は英小文字・数字・ハイフンに限る。空の名前と `__proto__` のような名前を、値の対応に入れないため。
const FLAG = /^--([a-z][a-z0-9-]*)$/u;

/**
 * `--名前 値` の組を並べた引数を読む。
 * 名前の形が誤っている引数・値の無いフラグ・2 回目に出たフラグは、例外にする。
 * 例外のメッセージには誤っている引数を出し、名前の形の誤りは引数を JSON の文字列の形で出す（空の引数も見分けられる）。
 * 値は検査しない。`--` で始まる値（プロンプトの文など）も、そのまま値として読む。
 */
export function parseArgs(argv: string[]): Record<string, string> {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index] ?? "";
    const name = FLAG.exec(flag)?.[1];
    if (name === undefined)
      throw new Error(`arguments must be --name value pairs (near ${JSON.stringify(flag)})`);
    const value = argv[index + 1];
    if (value === undefined)
      throw new Error(`arguments must be --name value pairs (${flag} has no value)`);
    if (values.has(name)) throw new Error(`${flag} is given more than once`);
    values.set(name, value);
  }
  return Object.fromEntries(values);
}
