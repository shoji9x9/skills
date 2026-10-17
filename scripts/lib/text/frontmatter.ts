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
//     null の metadata（`metadata: ~`）も、metadata が無いものとして比べる。負のゼロ（`-0`）は 0 として比べる。
//   - 値は isDeepStrictEqual で比べる。JSON の文字列にして比べると、`!!set` の Set は中身に関わらず同じ `{}` になり、
//     タイムスタンプの Date は同じ ISO の文字列を書いた値と区別できない。
//   - 読めなければ例外にする（どちらのファイルかは、呼び出し側が normalizeSkillFrontmatter で先に確かめる）。
import { isDeepStrictEqual } from "node:util";
import { isPlainObject } from "../guards.ts";
import { isArray } from "../is-array.ts";
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
 * 読んだばかりの YAML の値の中で、マッピングと配列の要素の負のゼロを、その場で 0 に書き換える。Set・Date などの中は見ない。
 * エイリアスは同じ値を共有し、自分自身を参照することもある（`a: &a [*a]`）ので、訪れた値を覚えて 1 回だけたどる。
 */
function zeroNegativeZeros(value: unknown, seen = new WeakSet<object>()): void {
  if (!isArray(value) && !isPlainObject(value)) return;
  if (seen.has(value)) return;
  seen.add(value);
  const entries: [string | number, unknown][] = isArray(value)
    ? [...value.entries()]
    : Object.entries(value);
  for (const [key, item] of entries) {
    if (Object.is(item, -0)) Reflect.set(value, key, 0);
    else zeroNegativeZeros(item, seen);
  }
}

/**
 * frontmatter を YAML として読み、`metadata.local-path` を除く。それで空になった metadata も除く。読めなければ例外にする。
 * 読んだ値が undefined か null のとき（空・コメントだけ・`~`・`null`）だけを空の frontmatter とみなす。false や 0 のようなスカラーは、そのまま比べる。
 * metadata がマッピングでない（Set・Date・配列など）ときは、キーが無く見えても消さずに比べる。
 * metadata が null（`metadata: ~`）のときは、metadata が無いものとして除く。`gh skill install` は null の metadata を `local-path` だけのマッピングにするので（#651）、除かないとインストールしただけで差分になる。
 * metadata は浅くコピーしてから `local-path` を消す。`metadata: *b` のようにエイリアスで書かれていると、その場で消すとアンカー側の値からも消えるからである。
 * js-yaml 5 は `-0`（整数）と `-0.0`（浮動小数点数）を負のゼロとして読み（4 は `-0` を +0）、isDeepStrictEqual は 0 と区別する。
 * 負のゼロと 0 の違いは frontmatter の内容の違いとして扱わないので、どちらも 0 にそろえてから比べる（#651）。
 * 空の入力（`"\t\n"`・`"...\n"`）は、loadYamlAs が undefined を返す（js-yaml 4 は null を返した）。どちらも `?? {}` で空の frontmatter として扱う。
 */
export function normalizeSkillFrontmatter(fmText: string): unknown {
  const loaded = loadYamlAs<SkillFrontmatter | null | undefined>(fmText) ?? {};
  zeroNegativeZeros(loaded);
  const obj = Object.is(loaded, -0) ? 0 : loaded;
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
