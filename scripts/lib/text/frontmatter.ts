// SKILL.md 等の先頭 frontmatter（`---` で挟まれた YAML）を分割し、SKILL.md の frontmatter どうしを比べる単一実装。
// 比べる処理が js-yaml を読み込むので、このモジュールを import すると splitFrontmatter だけを使う場合も js-yaml を読み込む。
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
//     null の metadata（`metadata: ~`）も、metadata が無いものとして比べる。
//   - 値は isDeepStrictEqual で比べる。JSON の文字列にして比べると、`!!set` の Set は中身に関わらず同じ `{}` になり、
//     タイムスタンプの Date は同じ ISO の文字列を書いた値と区別できない。
//   - 読めなければ例外にする（どちらのファイルかは、呼び出し側が normalizeSkillFrontmatter で先に確かめる）。
import { isDeepStrictEqual } from "node:util";
import { isPlainObject } from "../guards.ts";
import { loadYamlAs } from "./yaml-as.ts";

export function splitFrontmatter(content: string): { fm: string; body: string } | null {
  // 先頭 BOM を除去してから照合する（BOM 付きでも無しでも同一結果にする）。
  const text = content.replace(/^\uFEFF/, "");
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/.exec(text);
  if (!m) return null;
  return { fm: m[1], body: text.slice(m[0].length) };
}

type SkillFrontmatter = { metadata?: unknown };

/**
 * frontmatter を YAML として読み、`metadata.local-path` を除く。それで空になった metadata も除く。読めなければ例外にする。
 * 読んだ値が undefined か null のとき（空・コメントだけ・`~`・`null`）だけを空の frontmatter とみなす。false や 0 のようなスカラーは、そのまま比べる。
 * metadata がマッピングでない（Set・Date・配列など）ときは、キーが無く見えても消さずに比べる。
 * metadata が null（`metadata: ~`）のときは、metadata が無いものとして除く。`gh skill install` は null の metadata を `local-path` だけのマッピングにするので（#651）、除かないとインストールしただけで差分になる。
 * metadata は浅くコピーしてから `local-path` を消す。`metadata: *b` のようにエイリアスで書かれていると、その場で消すとアンカー側の値からも消えるからである。
 *
 * 次の 2 つは、直さずに残している（#651）。
 * - js-yaml 5 は `-0` を負のゼロとして読み、isDeepStrictEqual は 0 と区別する。SKILL.md の frontmatter は文字列の値だけを持つので、数値の書き方の差は比べる対象に現れない。
 * - 空の入力（`"\t\n"`・`"...\n"`）は、loadYamlAs が undefined を返し、js-yaml 4 は null を返した。どちらも `?? {}` で空の frontmatter として扱うので、結果は変わらない。
 */
export function normalizeSkillFrontmatter(fmText: string): unknown {
  const obj = loadYamlAs<SkillFrontmatter | null | undefined>(fmText) ?? {};
  if (isPlainObject(obj) && obj.metadata === null) delete obj.metadata;
  if (isPlainObject(obj) && isPlainObject(obj.metadata)) {
    const metadata = { ...obj.metadata };
    delete metadata["local-path"];
    if (Object.keys(metadata).length === 0) delete obj.metadata;
    else obj.metadata = metadata;
  }
  return obj;
}

/** normalizeSkillFrontmatter で正規化した 2 つの値が同じかを返す（キーの順は問わず、型と中身で比べる）。 */
export function sameNormalizedFrontmatter(a: unknown, b: unknown): boolean {
  return isDeepStrictEqual(a, b);
}

export function sameSkillFrontmatter(fmA: string, fmB: string): boolean {
  return sameNormalizedFrontmatter(normalizeSkillFrontmatter(fmA), normalizeSkillFrontmatter(fmB));
}
