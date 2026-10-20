// catch した値を扱う helper。

/**
 * 例外の message を文字列で返す。Error ならその message を、Error でない値（文字列・オブジェクト・偽の値）は String() で文字列にした値を返す。
 * @param {unknown} error
 * @returns {string}
 */
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export { errorMessage };
