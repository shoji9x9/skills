// SKILL.md 等の先頭 frontmatter（`---` で挟まれた YAML）を分割する単一実装。
// BOM（先頭の U+FEFF）と CRLF（`\r\n`）の両方に対応し、frontmatter 検査系
// スクリプト（check-skill-frontmatter.ts / check-skills-sync.ts）が同じ規則で
// frontmatter を切り出せるようにする。
//
// splitFrontmatter(content) → { fm, body } | null
//   - frontmatter が無ければ null。
//   - fm:   開始 `---` と終了 `---` に挟まれた生テキスト（前後の改行を含まない）。
//   - body: 終了 `---`（と直後の改行 1 個）より後ろの残り全体。
//
// 終了 `---` の後ろは行末までの空白（スペース・タブ）を許容し、その後の改行 1 個を
// 消費する（gh install が終了 `---` 直後の空行を落とすケースにも耐える）。
//
// sameSkillFrontmatter(fmA, fmB) → boolean
//   - 2 つの frontmatter を YAML として読み、キーの順と `metadata.local-path`（gh skill install が足す）を除いて同じかを返す。
//   - 値は isDeepStrictEqual で比べる。JSON の文字列にして比べると、`!!set` の Set とタイムスタンプの Date が
//     中身に関わらず同じ `{}` になり、Date と同じ ISO の文字列を書いた値も区別できない。
//   - 読めなければ例外にする（どちらのファイルかは、呼び出し側が normalizeSkillFrontmatter で先に確かめる）。
import { isDeepStrictEqual } from "node:util";
import { loadYamlAs } from "./yaml-as.ts";

export function splitFrontmatter(content: string): { fm: string; body: string } | null {
  // 先頭 BOM を除去してから照合する（BOM 付きでも無しでも同一結果にする）。
  const text = content.replace(/^\uFEFF/, "");
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/.exec(text);
  if (!m) return null;
  return { fm: m[1], body: text.slice(m[0].length) };
}

type SkillFrontmatter = { metadata?: Record<string, unknown> };

/** frontmatter を YAML として読み、`metadata.local-path` を除く。空になった metadata も除く。読めなければ例外にする。 */
export function normalizeSkillFrontmatter(fmText: string): SkillFrontmatter {
  const obj = loadYamlAs<SkillFrontmatter | null | undefined>(fmText) || {};
  if (obj.metadata && typeof obj.metadata === "object") {
    delete obj.metadata["local-path"];
    if (Object.keys(obj.metadata).length === 0) delete obj.metadata;
  }
  return obj;
}

export function sameSkillFrontmatter(fmA: string, fmB: string): boolean {
  return isDeepStrictEqual(normalizeSkillFrontmatter(fmA), normalizeSkillFrontmatter(fmB));
}
