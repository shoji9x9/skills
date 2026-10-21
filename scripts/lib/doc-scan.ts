// 文書のチェック（check-doc-refs.ts・check-time-sensitive-prose.ts）が共有する、保留の一覧とテキストの読み方。
//
// 走査対象は scripts/gates/docs/doc-scan-files.ts で決める（scripts/lib/ は scripts/gates/ を import しないので、
// 階層の設定を読む部分だけを分けている）。
//
// 保留の一覧（scripts/gates/docs/doc-pending.json）には、次の 2 種類がある。
// - pending: 今ある違反のうち、後の段階で直すもの。直したのに一覧に残ったもの（古い保留）は失敗にする。
// - allowed: 違反の形だが正しい記述（導入先の例など）。理由を必須にし、使われなくなったものは失敗にする。
// 違反は「ファイル・規則・一致した文字列」の組で一覧と突き合わせる。行番号は編集でずれるので使わない。
// pending の stage は、直す段階（Issue #372 の ③ 文書・④ スキル・⑤ コメント）。段階の完了条件は、その stage の保留が 0 件であること。
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isRecord } from "./guards.ts";
import { isArray } from "./is-array.ts";

export const PENDING_PATH = "scripts/gates/docs/doc-pending.json";
// 保留と許可に書ける規則と段階。誤記した規則はどのチェックにも拾われず、古い保留にもならずに残るので、ここで弾く。
export const KNOWN_RULES = [
  "link",
  "section",
  "tier-down",
  "dist-kaizen",
  "dist-issue",
  "dist-repo-path",
  "time-word",
  "date",
];
export const STAGES = ["3", "4", "5"];

/** 保留と許可が一覧と突き合わせる組（ファイル・規則・一致した文字列）。 */
type EntryKey = { file: string; rule: string; text: string };
export type PendingEntry = EntryKey & { stage: string };
export type AllowedEntry = EntryKey & { reason: string };
export type PendingList = { pending: PendingEntry[]; allowed: AllowedEntry[] };
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

/** 保留の一覧を読む。無ければ空、形の誤りは例外（判定できないものを保留 0 件として扱わない）。 */
export function loadPending(root: string): PendingList {
  const path = join(root, PENDING_PATH);
  if (!existsSync(path)) return { pending: [], allowed: [] };
  // 形はこの後で確かめるので、型を付けずに受けて型ガードで絞る。
  const data: unknown = JSON.parse(readFileSync(path, "utf8"));
  const record: Record<string, unknown> = isRecord(data) ? data : {};
  const { pending, allowed } = record;
  if (
    !isArray(pending) ||
    !pending.every((e) => hasNonEmptyStrings(e, ["file", "rule", "text", "stage"]))
  )
    throw new Error(`${PENDING_PATH}: pending は { file, rule, text, stage } の配列にする`);
  if (
    !isArray(allowed) ||
    !allowed.every((e) => hasNonEmptyStrings(e, ["file", "rule", "text", "reason"]))
  )
    throw new Error(`${PENDING_PATH}: allowed は { file, rule, text, reason } の配列にする`);
  for (const e of [...pending, ...allowed]) {
    if (!KNOWN_RULES.includes(e.rule))
      throw new Error(`${PENDING_PATH}: 知らない規則「${e.rule}」`);
  }
  for (const e of pending) {
    if (!STAGES.includes(e.stage))
      throw new Error(`${PENDING_PATH}: stage は ${STAGES.join("・")} のどれか（${e.stage}）`);
  }
  return { ...record, pending, allowed };
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

/** 違反を保留の一覧と突き合わせる。rules はこのチェックが持つ規則（他のチェックの保留は見ない）。 */
export function applyPending(
  found: readonly Finding[],
  list: PendingList,
  rules: readonly string[],
): { failures: string[]; pendingCount: number; stale: PendingEntry[] } {
  const mine = (e: EntryKey) => rules.includes(e.rule);
  const pending = new Map(list.pending.filter(mine).map((e) => [key(e), e]));
  const allowed = new Map(list.allowed.filter(mine).map((e) => [key(e), e]));
  const usedPending = new Set<string>();
  const usedAllowed = new Set<string>();
  const failures: string[] = [];
  let pendingCount = 0;
  for (const v of found) {
    const k = key(v);
    if (allowed.has(k)) usedAllowed.add(k);
    else if (pending.has(k)) {
      usedPending.add(k);
      pendingCount += 1;
    } else failures.push(`${v.file}:${v.line}: [${v.rule}] ${v.message ?? v.text}`);
  }
  const stale = [...pending.entries()].filter(([k]) => !usedPending.has(k)).map(([, e]) => e);
  for (const e of stale) {
    failures.push(
      `古い保留: ${e.file} [${e.rule}] ${e.text}（直したなら ${PENDING_PATH} から消す。--prune で消せる）`,
    );
  }
  for (const [k, e] of allowed) {
    if (!usedAllowed.has(k))
      failures.push(
        `使われていない許可: ${e.file} [${e.rule}] ${e.text}（記述が消えたなら許可も消す）`,
      );
  }
  return { failures, pendingCount, stale };
}

/** 古い保留を一覧から消して書き戻す（足すことはしない）。 */
export function prunePending(root: string, stale: readonly EntryKey[]): number {
  if (stale.length === 0) return 0;
  const path = join(root, PENDING_PATH);
  // 形を確かめてから書き戻す（読み直した一覧が不正なら、理由付きの例外にする）。
  const data = loadPending(root);
  const drop = new Set(stale.map(key));
  data.pending = data.pending.filter((e) => !drop.has(key(e)));
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
  return stale.length;
}
