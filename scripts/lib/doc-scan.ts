// 文書のチェック（check-doc-refs.ts・check-time-sensitive-prose.ts）が共有する、許可の一覧とテキストの読み方。
//
// 走査対象は scripts/gates/docs/doc-scan-files.ts で決める（scripts/lib/ は scripts/gates/ を import しないので、
// 階層の設定を読む部分だけを分けている）。
//
// 許可の一覧（scripts/gates/docs/doc-allowed.json）には、違反の形だが正しい記述（導入先の例など）を書く。
// 理由を必須にし、使われなくなったものは失敗にする。
// 違反は「ファイル・規則・一致した文字列」の組で一覧と突き合わせる。行番号は編集でずれるので使わない。
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isRecord } from "./guards.ts";
import { isArray } from "./is-array.ts";

export const ALLOWED_PATH = "scripts/gates/docs/doc-allowed.json";
// 許可に書ける規則。誤記した規則はどのチェックにも拾われず、使われていない許可にもならずに残るので、ここで弾く。
export const KNOWN_RULES = [
  "link",
  "section",
  "tier-down",
  "dist-kaizen",
  "dist-issue",
  "dist-repo-path",
  "time-word",
  "date",
  "version-mention",
];

/** 許可が一覧と突き合わせる組（ファイル・規則・一致した文字列）。 */
type EntryKey = { file: string; rule: string; text: string };
export type AllowedEntry = EntryKey & { reason: string };
/** チェックが見つけた違反。message があれば失敗の行に text の代わりに出す。 */
export type Finding = EntryKey & { line: number; message?: string };

/** 配布スキルのファイルなら、スキルのディレクトリ（`skills/<name>`）。 */
export const distributedSkillDir = (file: string): string | null =>
  /^skills\/[^/]+(?=\/)/.exec(file)?.[0] ?? null;

/** 例として書いた行（導入先の値や書式の例）。時間の記述と Issue 番号のチェックでは読まない。 */
export const EXAMPLE_LINE_RE = /例[:：]|（例|\be\.g\./;

/** Markdown の行ごとに、コードフェンスの中かを返す。 */
export function fencedLines(lines: readonly string[]): boolean[] {
  let fence: string | null = null;
  return lines.map((line) => {
    const m = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence === null) {
      if (m) fence = m[1];
      return m !== null;
    }
    if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null;
    return true;
  });
}

/** インラインコード（`...`）を同じ長さの空白に置き換える（位置を保ったまま中身を読まない）。 */
export const blankInlineCode = (line: string): string =>
  line.replace(/(`+)(.+?)\1/g, (m) => " ".repeat(m.length));

/** 許可の一覧を読む。無ければ空、形の誤りは例外（判定できないものを許可 0 件として扱わない）。 */
export function loadAllowed(root: string): AllowedEntry[] {
  const path = join(root, ALLOWED_PATH);
  if (!existsSync(path)) return [];
  // 形はこの後で確かめるので、型を付けずに受けて型ガードで絞る。
  const data: unknown = JSON.parse(readFileSync(path, "utf8"));
  const { allowed } = isRecord(data) ? data : {};
  if (
    !isArray(allowed) ||
    !allowed.every((e) => hasNonEmptyStrings(e, ["file", "rule", "text", "reason"]))
  )
    throw new Error(`${ALLOWED_PATH}: allowed は { file, rule, text, reason } の配列にする`);
  for (const e of allowed) {
    if (!KNOWN_RULES.includes(e.rule))
      throw new Error(`${ALLOWED_PATH}: 知らない規則「${e.rule}」`);
  }
  return allowed;
}

/** keys の欄がすべて空でない文字列の object か。 */
function hasNonEmptyStrings<K extends string>(
  e: unknown,
  keys: readonly K[],
): e is Record<K, string> & { readonly __hasNonEmptyStrings: true } {
  return (
    isRecord(e) &&
    keys.every((k) => {
      const v = e[k];
      return typeof v === "string" && v.trim() !== "";
    })
  );
}

const key = (e: EntryKey) => `${e.file}\u0000${e.rule}\u0000${e.text}`;

/** 違反を許可の一覧と突き合わせる。rules はこのチェックが持つ規則（他のチェックの許可は見ない）。 */
export function applyAllowed(
  found: readonly Finding[],
  list: readonly AllowedEntry[],
  rules: readonly string[],
): { failures: string[] } {
  const allowed = new Map(list.filter((e) => rules.includes(e.rule)).map((e) => [key(e), e]));
  const usedAllowed = new Set<string>();
  const failures: string[] = [];
  for (const v of found) {
    const k = key(v);
    if (allowed.has(k)) usedAllowed.add(k);
    else failures.push(`${v.file}:${v.line}: [${v.rule}] ${v.message ?? v.text}`);
  }
  for (const [k, e] of allowed) {
    if (!usedAllowed.has(k))
      failures.push(
        `使われていない許可: ${e.file} [${e.rule}] ${e.text}（記述が消えたなら許可も消す）`,
      );
  }
  return { failures };
}
