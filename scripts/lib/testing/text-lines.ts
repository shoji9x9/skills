// テストが Markdown などの入力を組み立てるヘルパー。

/** 渡した行を改行でつなぎ、最後に改行を付ける。 */
export const lines = (...xs: string[]) => [...xs, ""].join("\n");
