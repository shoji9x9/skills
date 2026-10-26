// 文書の階層（Tier）の設定（scripts/gates/docs/doc-tiers.json）を読み、ファイルの階層を決める。
// 文書のチェックの走査対象（doc-scan-files.ts）が、Tier 4 と階層の外を読まないために使う。
//
// 読むのは各項目の glob と、項目が属する tier だけである。label・note・contents は人が読む説明の欄で、値は読まない。
// 設定の形の誤り（Tier が 1〜4 の順でない・docs が空か配列でない・項目が object でない・項目に知らないキーがある・
// glob も label も無い・glob が空か文字列でない・glob の重複・outside に glob が無い）は例外にする。
// 知らないキーを例外にするのは、glob の書き間違い（"gob" など）を説明だけの項目として読み飛ばさないためである。
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isNonBlankString, isRecord } from "../../lib/guards.ts";
import { isArray } from "../../lib/is-array.ts";

export const TIERS_PATH = "scripts/gates/docs/doc-tiers.json";

/** 項目が持ってよいキー。glob だけを読み、残りは説明の欄。 */
const ITEM_KEYS = new Set(["glob", "label", "note", "contents"]);

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

/** doc-tiers.json を JSON として読む。無いか読めなければ、パスを添えて例外にする。 */
function readTiersJson(root: string): unknown {
  const path = join(root, TIERS_PATH);
  if (!existsSync(path)) throw new Error(`${TIERS_PATH} が無い`);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new Error(
      `${TIERS_PATH} を JSON として読めない: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

/**
 * 項目の glob。glob を持たない項目（説明だけの項目）は undefined。seen に読んだ glob を足し、重複を例外にする。
 * glob の無い項目は、ファイルで分けられない文書の説明なので label が要る（{} や note だけの項目は、glob を消し忘れた誤り）。
 */
function globOf(e: unknown, where: string, seen: Set<string>): string | undefined {
  if (!isRecord(e)) throw new Error(`${where}: 項目は object にする`);
  const unknownKeys = Object.keys(e).filter((k) => !ITEM_KEYS.has(k));
  if (unknownKeys.length > 0)
    throw new Error(`${where}: 知らないキー（${unknownKeys.join("・")}）がある`);
  const { glob } = e;
  if (glob === undefined) {
    if (!isNonBlankString(e.label)) throw new Error(`${where}: glob か label を持つ`);
    return undefined;
  }
  if (!isNonBlankString(glob)) throw new Error(`${where}: glob は空でない文字列`);
  if (seen.has(glob)) throw new Error(`${where}: glob「${glob}」が重複している`);
  seen.add(glob);
  return glob;
}

/** doc-tiers.json を読み、glob と tier の形を確かめる。形の誤りは例外にする。 */
export function loadDocTiers(root: string): DocTiers {
  const data = readTiersJson(root);
  const { tiers, outside }: Record<string, unknown> = isRecord(data) ? data : {};
  if (!isArray(tiers) || !isArray(outside)) throw new Error("tiers と outside は配列にする");
  // tier は数の 1〜4 だけを受ける（文字列の "1" は、tierOf の比較で数と食い違う）。
  // `tiers.every(isRecord)` は型を絞るためにある。object でない要素は tier が undefined になり、番号の比較でも落ちる。
  const tierNumbers = tiers.map((t) => (isRecord(t) ? t.tier : undefined));
  if (!tiers.every(isRecord) || tierNumbers.some((n, i) => n !== i + 1) || tiers.length !== 4)
    throw new Error("tiers は tier 1〜4 をこの順に 1 つずつ持つ");
  const seen = new Set<string>();
  const checkedTiers = tiers.map((t, n) => {
    const { docs } = t;
    if (!isArray(docs) || docs.length === 0)
      throw new Error(`tier ${n + 1}: docs は空でない配列にする`);
    const globs = docs.flatMap((e, i) => globOf(e, `tier ${n + 1} の docs[${i}]`, seen) ?? []);
    return { tier: n + 1, globs };
  });
  const checkedOutside = outside.map((e, i) => {
    // 階層の外の項目は glob で外すので、label だけの項目を受け付けない。globOf の「glob か label」の案内より先に止める。
    if (isRecord(e) && e.glob === undefined) throw new Error(`outside[${i}]: glob を持つ`);
    const glob = globOf(e, `outside[${i}]`, seen);
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
