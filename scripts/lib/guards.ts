// 値の形を確かめる型ガード。同じ判定をファイルごとに別の名前で書き直さないよう、ここに 1 つだけ置く。

import { isArray } from "./is-array.ts";

/** null でも配列でもない object か（JSON の object・`Record<string, unknown>` として読める値）。 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !isArray(value);
}

/**
 * YAML や JSON のマッピングとして読んだ object か（プロトタイプが Object.prototype）。
 * isRecord と違い、js-yaml 5 が `!!set` から作る Set や、タイムスタンプの Date を含めない。
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && Object.getPrototypeOf(value) === Object.prototype;
}

/** 空でない文字列か（空白だけの文字列は通す）。 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

/** 空白だけでない文字列か。 */
export function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}
