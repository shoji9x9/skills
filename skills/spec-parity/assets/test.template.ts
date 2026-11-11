/**
 * スイートの基になる test（雛形）— spec-parity
 *
 * このファイルは、プロジェクトへコピーして使う雛形である。コピー先は `tests/parity/test.ts` にする。
 * スイートのすべてのテストは、`@e2e-dev/web` の test ではなく、このファイルの test を import する。
 *
 *   import { test } from "../parity/test.ts";
 *
 * fixture の runtimeCapture は、名前を受け取らなくても、この test で登録したすべてのテストで動く。
 * テストの後始末で、ページの記録（tests/parity/runtime-errors-init.js が sessionStorage に置いたもの）を取り出し、
 * 標準出力へ MARK で始まる 1 行で書く。行は reporter（tests/parity/runtime-errors-reporter.ts）がテストの結果と合わせてファイルにする。
 * e2e の afterEach と fixture はテストの名前と状態を受け取らないので、名前と状態は reporter の側で突き合わせる（e2e 0.23.0 で確かめた）。
 * 書き出すのは PARITY_RUNTIME_CAPTURE=1 の実行だけで、それ以外の実行（green の確認・故障注入）では何もしない。
 * 記録を取り出せなかったとき（ページが閉じた・別オリジンへ移った）は LOST の行を書き、reporter はそのテストの記録を作らない。
 * 記録が無いテストは、runtime-errors.mjs の比較で「記録が欠けたテスト」として止まる（0 件の記録として通らない）。
 */
import { test as base } from "@e2e-dev/web";

// fixture が使う browser の形（@e2e-dev/web の Browser のうち、使うメソッドだけ）
type EvaluatingBrowser = { evaluate<T>(fn: () => T | Promise<T>): Promise<T> };

export const MARK = "__PARITY_RUNTIME__ ";
export const LOST = "__PARITY_RUNTIME_LOST__";

export const test = base.extend({
  runtimeCapture: async (
    { browser }: { browser: EvaluatingBrowser },
    use: (value: void) => Promise<void>,
  ) => {
    await use();
    if (process.env.PARITY_RUNTIME_CAPTURE !== "1") return;
    try {
      const events: unknown = await browser.evaluate(() => {
        const read: unknown = Reflect.get(window, "__parityRuntimeEvents");
        return typeof read === "function" ? read() : null;
      });
      // init script が入っていないページは、記録が無いのであって 0 件ではない
      console.log(events === null ? LOST : MARK + JSON.stringify(events));
    } catch {
      console.log(LOST);
    }
  },
});
