// catch した値を扱う helper。

/**
 * 例外の message を読む。`error && error.message` と同じ値を返す（偽の値はそのまま、プリミティブは undefined）。
 * @param {unknown} error
 * @returns {unknown}
 */
function errorMessage(error) {
  if (!error) return error;
  return typeof error === "object" || typeof error === "function"
    ? Reflect.get(error, "message")
    : undefined;
}

export { errorMessage };
