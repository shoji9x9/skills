// 文書の階層（Tier）の設定（scripts/gates/docs/doc-tiers.json）を読み、ファイルの階層を決める。
// 文書のチェックの走査対象（doc-scan-files.ts）が、Tier 4 と階層の外を読まないために使う。
//
// doc-tiers.json の形の誤り（Tier が 1〜4 の順でない・項目に glob も label も無い・「|」を含む・glob の重複）は例外にする。
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isNonBlankString as isText, isRecord } from "../../lib/guards.ts";
import { isArray } from "../../lib/is-array.ts";

const TIERS_PATH = "scripts/gates/docs/doc-tiers.json";

type DocEntry = { glob?: string; label?: string; note?: string };
type TierEntry = { tier: number; contents: string; docs: DocEntry[] };
export type DocTiers = { tiers: TierEntry[]; outside: (DocEntry & { glob: string })[] };

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

/** doc-tiers.json を読み、形を確かめる。形の誤りは例外にする。 */
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
  const globs = new Set<string>();
  const checkEntry = (e: unknown, where: string): DocEntry => {
    const record = isRecord(e) ? e : {};
    if (!isText(record.glob) && !isText(record.label))
      throw new Error(`${where}: glob か label のどちらかを持つ`);
    const text = (k: "glob" | "label" | "note") => {
      const v = record[k];
      if (v !== undefined && !isText(v)) throw new Error(`${where}: ${k} は空でない文字列`);
      if (v?.includes("|")) throw new Error(`${where}: ${k} に「|」がある（表の列がずれる）`);
      return v;
    };
    const glob = text("glob");
    const label = text("label");
    const note = text("note");
    if (glob !== undefined) {
      if (globs.has(glob)) throw new Error(`${where}: glob「${glob}」が重複している`);
      globs.add(glob);
    }
    return { ...record, glob, label, note };
  };
  const checkedTiers = tiers.map((t, n): TierEntry => {
    const { contents, docs } = t;
    if (!isText(contents) || contents.includes("|"))
      throw new Error(`tier ${n + 1}: contents は「|」を含まない空でない文字列`);
    if (!isArray(docs) || docs.length === 0) throw new Error(`tier ${n + 1}: docs は空でない配列`);
    return {
      tier: n + 1,
      contents,
      docs: docs.map((e, i) => checkEntry(e, `tier ${n + 1} の docs[${i}]`)),
    };
  });
  const checkedOutside = outside.map((e, i) => {
    const entry = checkEntry(e, `outside[${i}]`);
    const { glob } = entry;
    if (!isText(glob)) throw new Error(`outside[${i}]: glob を持つ`);
    return { ...entry, glob };
  });
  return { tiers: checkedTiers, outside: checkedOutside };
}

/** glob を持つ項目の一覧（{ glob, tier }。階層の外は tier: null）。 */
function globEntries({ tiers, outside }: DocTiers): { glob: string; tier: number | null }[] {
  return [
    ...tiers.flatMap((t) =>
      t.docs.flatMap((e) => (e.glob ? [{ glob: e.glob, tier: t.tier }] : [])),
    ),
    ...outside.map((e) => ({ glob: e.glob, tier: null })),
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
