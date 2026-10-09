import { defineConfig } from "oxfmt";
import { agentCopyGlobs } from "./scripts/lib/source-scope.js";

// oxfmt に割り当てた種類（lefthook.yml の oxfmt-* の glob と同じ）。これ以外は、引数でディレクトリや
// glob を渡されても整形しない。oxfmt は .md・.css・.html・.toml も整形するので、ディレクトリを渡すと
// Markdown の表の桁までそろえた（実測）。許可リストにするのは、対応する種類が増えても外れたままにするため。
const assigned = "js,mjs,cjs,jsx,ts,tsx,mts,cts,json,yml,yaml";

export default defineConfig({
  ignorePatterns: [
    "**/*.*",
    // `**/*.*` は名前にドットを含むディレクトリ（`.agents` など）にも当たる。外したディレクトリの中は `!` で
    // 戻せないので、ディレクトリはすべて戻してから、ファイルを種類で選ぶ。
    "!**/*/",
    `!**/*.{${assigned}}`,
    // エージェント用のコピーとリンクだけを除く。.agents/ を丸ごと除くと rule と private skill の実体も外れる。
    // 許可リストより後に置く（後の行が優先されるので、割り当てた種類でもコピーの中は除いたままにする）。
    ...agentCopyGlobs(import.meta.dirname),
  ],
});
