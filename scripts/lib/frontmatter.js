// SKILL.md 等の先頭 frontmatter（`---` で挟まれた YAML）を分割する単一実装。
// BOM（先頭の U+FEFF）と CRLF（`\r\n`）の両方に対応し、frontmatter 検査系
// スクリプト（check-skill-frontmatter.js / check-skills-sync.js）が同じ規則で
// frontmatter を切り出せるようにする。
//
// splitFrontmatter(content) → { fm, body } | null
//   - frontmatter が無ければ null。
//   - fm:   開始 `---` と終了 `---` に挟まれた生テキスト（前後の改行を含まない）。
//   - body: 終了 `---`（と直後の改行 1 個）より後ろの残り全体。
//
// 終了 `---` の後ろは行末までの空白（スペース・タブ）を許容し、その後の改行 1 個を
// 消費する（gh install が終了 `---` 直後の空行を落とすケースにも耐える）。
export function splitFrontmatter(content) {
  // 先頭 BOM を除去してから照合する（BOM 付きでも無しでも同一結果にする）。
  const text = content.replace(/^\uFEFF/, "");
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/.exec(text);
  if (!m) return null;
  return { fm: m[1], body: text.slice(m[0].length) };
}
