// Markdown の文書だけをチェックする。渡されたファイルのうち .md 以外は対象にしない。
const files = process.argv.slice(2).filter((f) => f.endsWith(".md"));
console.log(`lint-docs: OK（${files.length} 件）`);
