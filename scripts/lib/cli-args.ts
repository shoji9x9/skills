// `--名前 値` の組を並べた CLI の引数を読む処理。

/** `--名前 値` の組を並べた引数を読む。引数を誤っている箇所を、引用符で囲んでメッセージに出す。 */
export function parseArgs(argv: string[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--"))
      throw new Error(`arguments must be --name value pairs (near ${JSON.stringify(flag)})`);
    if (value === undefined)
      throw new Error(`arguments must be --name value pairs (${flag} has no value)`);
    values[flag.slice(2)] = value;
  }
  return values;
}
