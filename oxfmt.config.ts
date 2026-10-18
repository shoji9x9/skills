import { defineConfig } from "oxfmt";
import { VENDORED_GLOBS, agentCopyGlobs } from "./scripts/lib/source-scope.ts";

// oxfmt に割り当てた種類（lefthook.yml の oxfmt-* の glob と同じ）。これ以外は、引数でディレクトリや
// glob を渡されても整形しない。oxfmt は .md・.css・.html・.toml も整形するので、ディレクトリを渡すと
// Markdown の表の桁までそろえた（実測）。許可リストにするのは、対応する種類が増えても外れたままにするため。
// テスト（scripts/gates/tooling/lint-scope.test.ts・formatter-scope.test.ts）が、許可リストの行を探さずにこの値を読む。
export const assigned = "js,mjs,cjs,jsx,ts,tsx,mts,cts,json,jsonc,yml,yaml";

export default defineConfig({
  // .jsonc（スキルの設定ファイル）には末尾のカンマを付けない。VS Code の JSON の言語サポートは、.jsonc の末尾のカンマを
  // 警告（Trailing comma）にするので、利用者が設定ファイルを開くたびに警告が出る。読み取り（skill-config.mjs）の追記も、
  // 前の要素に合わせて付けないので、整形した後に書き足しても形がそろう。
  overrides: [{ files: ["**/*.jsonc"], options: { trailingComma: "none" } }],
  ignorePatterns: [
    "**/*.*",
    // `**/*.*` は名前にドットを含むディレクトリ（`.agents` など）にも当たる。外したディレクトリの中は `!` で
    // 戻せないので、ディレクトリはすべて戻してから、ファイルを種類で選ぶ。
    "!**/*/",
    `!**/*.{${assigned}}`,
    // エージェント用のコピーとリンクだけを除く。.agents/ を丸ごと除くと rule と private skill の実体も外れる。
    // 許可リストより後に置く（後の行が優先されるので、割り当てた種類でもコピーの中は除いたままにする）。
    ...agentCopyGlobs(import.meta.dirname),
    // 外部のパッケージから作った生成物も除く（scripts/lib/source-scope.ts の VENDORED_GLOBS）。
    ...VENDORED_GLOBS,
  ],
});
