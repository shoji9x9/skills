// 捕まえた例外を、利用者に表示する文字列にする。
// throw できるのは Error だけではない（文字列や数値も投げられる）ので、Error ならその message を、それ以外は String() の結果を返す。

/**
 * @param {unknown} e
 * @returns {string}
 */
export function errorMessage(e) {
  return e instanceof Error ? e.message : String(e);
}
