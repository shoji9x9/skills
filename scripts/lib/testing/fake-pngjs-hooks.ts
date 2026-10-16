// `node --import <このファイル>` で読み込ませ、`pngjs` の import を fake-pngjs.ts に向ける。
// スキルのスクリプトを書き換えずに、pngjs のある利用者のプロジェクトと同じ処理の流れで main を実行するためのもの。
import { registerHooks } from "node:module";

const fake = new URL("./fake-pngjs.ts", import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "pngjs") return { url: fake, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
