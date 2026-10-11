// 値の形を確かめる型ガード。同じ判定をファイルごとに別の名前で書き直さないよう、ここに 1 つだけ置く。

/** null でも配列でもない object か（JSON の object・`Record<string, unknown>` として読める値）。 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
