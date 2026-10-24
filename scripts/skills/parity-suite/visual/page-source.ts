// ページへ渡す関数を、ソースだけから評価し直して呼ぶ（trait-capture と element-shot のテストが使う）。
import { assert } from "vitest";
import { runInThisContext } from "node:vm";

/**
 * 関数のソースだけを評価し直して呼ぶ。locator.evaluate がページへ送るのも関数のソースだけである。
 * 評価し直した関数はモジュールのスコープを持たないので、本体の外の名前を参照すると ReferenceError になる。
 * 大域の名前（偽のブラウザの大域変数を含む）は、モジュールと同じものを読む。
 */
export function runFromSource(fn: (...args: never[]) => unknown, args: unknown[]): unknown {
  const rebuilt: unknown = runInThisContext(`(${String(fn)})`);
  assert(typeof rebuilt === "function", "ソースを評価し直した結果が関数でない");
  return Reflect.apply(rebuilt, undefined, args);
}
