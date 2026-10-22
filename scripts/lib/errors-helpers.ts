// errors.test.ts のヘルパー（関数が投げた値を受け取る）。
/** body が投げた値を返す。投げなければ、その場で失敗する。 */
export function caught(body: () => unknown): unknown {
  try {
    body();
  } catch (error) {
    return error;
  }
  throw new Error("例外が投げられなかった");
}
