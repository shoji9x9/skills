// `--changed-since <ref>` で、PR のベースとの差分だけを見るチェックの引数を読む処理。

/**
 * 引数から `--changed-since <ref>`（`--changed-since=<ref>` も）を取り出し、残りの引数と分ける。
 * 2 回書いたときと、ref が無いときは例外にする（どちらの ref で選んだかが分からない・ファイル名として扱われて 0 件で通る）。
 */
export function splitChangedSince(args: string[]): { ref?: string; rest: string[] } {
  const refs: string[] = [];
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--changed-since=")) {
      refs.push(arg.slice("--changed-since=".length));
    } else if (arg === "--changed-since") {
      refs.push(args[i + 1] ?? "");
      i++;
    } else {
      rest.push(arg);
    }
  }
  if (refs.length > 1) throw new Error("--changed-since を 2 回書いている");
  const [ref] = refs;
  if (ref !== undefined && (ref === "" || ref.startsWith("-"))) {
    throw new Error("--changed-since に ref がない");
  }
  return { ref, rest };
}
