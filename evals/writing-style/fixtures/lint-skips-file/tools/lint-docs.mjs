import { readFileSync } from "node:fs";

// Markdown の文書の、200 文字を超える行を数える。
const files = process.argv.slice(2).filter((f) => f.endsWith(".md"));
let count = 0;
for (const f of files) {
  for (const line of readFileSync(f, "utf8").split("\n")) {
    if (line.length > 200) count += 1;
  }
}
console.log(`lint-docs: 指摘 ${count} 件`);
process.exit(count > 0 ? 1 : 0);
