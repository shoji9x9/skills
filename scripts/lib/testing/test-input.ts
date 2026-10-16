// テストが型の外の入力を作るための helper。型の表明は、このファイルの 1 か所だけに置く。

/**
 * わざと不正な入力（型に合わない値・必須の欄が欠けた値）を、型の検査を外して渡す。
 * 不正な入力を拒否することを確かめるテストだけで使う。正しい形の値には使わない。
 */
export function invalidInput<T>(value: unknown): T {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- 不正な入力を渡すための唯一の抜け道
  return value as T;
}

/**
 * 必須の欄を消して、その欄が欠けた入力を作る。`delete (x as Partial<T>).field` の代わりに使う。
 * `Reflect.deleteProperty` は型の表明なしに任意の欄を消せる。
 */
export function removeField<T extends object>(target: T, key: keyof T): void {
  Reflect.deleteProperty(target, key);
}
