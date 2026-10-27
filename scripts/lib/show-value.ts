// 型が決まっていない値（unknown）を、メッセージに埋め込む文字列にする helper。
// テンプレートリテラルや `String(x)` は、オブジェクトを `[object Object]` にするので、何が来たかが読めない。

/** メッセージに埋め込む文字列。オブジェクトと配列は JSON にし、それ以外は `String(value)` と同じ字面にする。 */
export function showValue(value: unknown): string {
  if (typeof value === "object" && value !== null) {
    try {
      return JSON.stringify(value);
    } catch {
      // 循環する参照を持つオブジェクトは JSON にできない。
      return Object.prototype.toString.call(value);
    }
  }
  return String(value);
}
