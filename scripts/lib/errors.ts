// catch で受けた値（unknown）を、型の表明なしに読むための helper。
// `(error as Error).message` と書くと、Error でない値が投げられたときも Error として読む。
// ここでは `instanceof` で確かめてから読み、Error でなければ文字列にする。

/** catch で受けた値のメッセージ。Error でなければ `String(error)`。 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 読めなかった理由。Node のシステムエラーなら `code`（`ENOENT` など）、それ以外はメッセージ。 */
export function errorCodeOrMessage(error: unknown): string {
  return (isErrnoException(error) ? error.code : undefined) ?? errorMessage(error);
}

/** Node のシステムエラー（`code` を持つ Error）か。`error.code === "ENOENT"` などを読む前に確かめる。 */
export function isErrnoException(
  error: unknown,
): error is NodeJS.ErrnoException & { readonly __isErrnoException: true } {
  return error instanceof Error && "code" in error;
}

/** spawnSync の結果の終わり方（`exit 1`・`signal SIGTERM`・起動できなかった理由）。失敗のメッセージに書く。 */
export function spawnEnd(res: {
  status: number | null;
  signal: NodeJS.Signals | null;
  error?: Error;
}): string {
  if (res.error) return `起動できない: ${res.error.message}`;
  return res.status !== null ? `exit ${res.status}` : `signal ${res.signal}`;
}
