// JSON の文字列を読む helper。

import { errorMessage } from "./errors.mjs";

/**
 * JSON として読む。読めなければ、構文エラーの message を toError に渡し、返った例外を投げる。
 * 呼び出し側は、自分の終了コードに対応する例外（UsageError など）と、何を読めなかったかを書いた文言を toError で作る。
 * @param {string} text
 * @param {(message: string) => Error} toError
 * @returns {unknown}
 */
function parseJsonOrThrow(text, toError) {
  try {
    return JSON.parse(text);
  } catch (e) {
    throw toError(errorMessage(e));
  }
}

export { parseJsonOrThrow };
