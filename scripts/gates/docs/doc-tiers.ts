// 文書の階層（Tier）の設定（scripts/gates/docs/doc-tiers.json）を読み、ファイルの階層を決める。
// 文書のチェックの走査対象（doc-scan-files.ts）が、Tier 4 と階層の外を読まないために使う。
//
// 読むのは各項目の glob と、項目が属する tier だけである。label・note・contents は人が読む説明の欄で、ここでは読まない。
// 設定の形の誤り（Tier が 1〜4 の順でない・docs が配列でない・glob が空でない文字列でない・glob の重複・outside に glob が無い）は例外にする。
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isNonBlankString, isRecord } from "../../lib/guards.ts";
import { isArray } from "../../lib/is-array.ts";

export const TIERS_PATH = "scripts/gates/docs/doc-tiers.json";

/** 読んだ設定。tiers は tier 1〜4 の順に、その tier の glob を持つ。outside は階層の外の glob。 */
export type DocTiers = { tiers: { tier: number; globs: string[] }[]; outside: string[] };

/**
 * glob を正規表現にする。`**` は 0 個以上のディレクトリ、`*` は `/` を含まない 0 文字以上。
 * ドットで始まる名前（`.replace/`・`.kaizen/`）にも当てる。node:path の matchesGlob は当てないので使わない。
 */
function globToRegExp(glob: string) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      i++;
      if (glob[i + 1] === "/") {
        i++;
        re += "(?:.*/)?";
      } else re += ".*";
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

const matchesGlob = (rel: string, glob: string) => globToRegExp(glob).test(rel);

/** doc-tiers.json を読み、glob と tier の形を確かめる。形の誤りは例外にする。 */
export function loadDocTiers(root: string): DocTiers {
  const path = join(root, TIERS_PATH);
  if (!existsSync(path)) throw new Error(`${TIERS_PATH} が無い`);
  const data: unknown = JSON.parse(readFileSync(path, "utf8"));
  const { tiers, outside }: Record<string, unknown> = isRecord(data) ? data : {};
  if (!isArray(tiers) || !isArray(outside)) throw new Error("tiers と outside は配列にする");
  // tier は数の 1〜4 だけを受ける（文字列の "1" は、tierOf の比較で数と食い違う）。
  // `tiers.every(isRecord)` は型を絞るためにある。object でない要素は tier が undefined になり、番号の比較でも落ちる。
  const tierNumbers = tiers.map((t) => (isRecord(t) ? t.tier : undefined));
  if (!tiers.every(isRecord) || tierNumbers.some((n, i) => n !== i + 1) || tiers.length !== 4)
    throw new Error("tiers は tier 1〜4 をこの順に 1 つずつ持つ");
  const seen = new Set<string>();
  /** 項目の glob。glob を持たない項目（説明だけの項目）は undefined。 */
  const globOf = (e: unknown, where: string): string | undefined => {
    const glob = isRecord(e) ? e.glob : undefined;
    if (glob === undefined) return undefined;
    if (!isNonBlankString(glob)) throw new Error(`${where}: glob は空でない文字列`);
    if (seen.has(glob)) throw new Error(`${where}: glob「${glob}」が重複している`);
    seen.add(glob);
    return glob;
  };
  const checkedTiers = tiers.map((t, n) => {
    const { docs } = t;
    if (!isArray(docs)) throw new Error(`tier ${n + 1}: docs は配列にする`);
    const globs = docs.flatMap((e, i) => globOf(e, `tier ${n + 1} の docs[${i}]`) ?? []);
    return { tier: n + 1, globs };
  });
  const checkedOutside = outside.map((e, i) => {
    const glob = globOf(e, `outside[${i}]`);
    if (glob === undefined) throw new Error(`outside[${i}]: glob を持つ`);
    return glob;
  });
  return { tiers: checkedTiers, outside: checkedOutside };
}

/** glob を持つ項目の一覧（{ glob, tier }。階層の外は tier: null）。 */
function globEntries({ tiers, outside }: DocTiers): { glob: string; tier: number | null }[] {
  return [
    ...tiers.flatMap((t) => t.globs.map((glob) => ({ glob, tier: t.tier }))),
    ...outside.map((glob) => ({ glob, tier: null })),
  ];
}

/**
 * リポジトリ相対パスの階層。当たる項目がちょうど 1 つならその tier（階層の外は null）、
 * 0 件か 2 件以上なら undefined。
 */
export function tierOf(config: DocTiers, rel: string) {
  const hits = globEntries(config).filter((e) => matchesGlob(rel, e.glob));
  return hits.length === 1 ? hits[0].tier : undefined;
}
