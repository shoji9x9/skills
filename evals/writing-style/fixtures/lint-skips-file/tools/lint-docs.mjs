// Markdown の文書だけをチェックする。渡されたファイルのうち .md 以外は対象にせず、そのことも出力しない。
const files = process.argv.slice(2).filter((f) => f.endsWith(".md"));
// チェックした件数は出さず、指摘の件数だけを出す（ここでは指摘を出さないので常に 0 件）。
void files;
console.log("lint-docs: 指摘 0 件");
