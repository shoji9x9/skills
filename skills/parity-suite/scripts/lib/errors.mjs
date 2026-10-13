// catch した値を扱う helper。

/**
 * catch した値の message（`error && error.message` と同じ値）。
 * @param {unknown} error
 * @returns {unknown}
 */
function errorMessage(error) {
  if (!error) return error;
  return typeof error === "object" && "message" in error ? error.message : undefined;
}

export { errorMessage };
