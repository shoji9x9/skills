// errors.test.ts のヘルパー（関数が投げた値を受け取る）。
/** body が投げた値を返す。投げなければ、そのことを表す Error を返す（読む関数の期待値と一致しないので、テストが落ちる）。 */
export function caught(body: () => unknown): unknown {
  let thrown: unknown = new Error("例外が投げられなかった");
  try {
    body();
  } catch (error) {
    thrown = error;
  }
  return thrown;
}
