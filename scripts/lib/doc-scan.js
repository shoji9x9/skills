// 文書のチェック（check-doc-refs.js・check-time-sensitive-prose.js）が共有する、走査対象と保留の一覧。
//
// 走査対象は、テキストの実体のファイル（コピーとリンクを除く。scripts/lib/source-scope.js）のうち、
// Tier 4（経過の記録）と階層の外（eval の入力）を除いたもの。階層は scripts/gates/doc-tiers.json で決める。
// Markdown は表の階層、それ以外のファイルはコードコメントとして Tier 3 に数える。
//
// 保留の一覧（scripts/gates/doc-pending.json）には、次の 2 種類がある。
// - pending: 今ある違反のうち、後の段階で直すもの。直したのに一覧に残ったもの（古い保留）は失敗にする。
// - allowed: 違反の形だが正しい記述（導入先の例など）。理由を必須にし、使われなくなったものは失敗にする。
// 違反は「ファイル・規則・一致した文字列」の組で一覧と突き合わせる。行番号は編集でずれるので使わない。
// pending の stage は、直す段階（Issue #372 の ③ 文書・④ スキル・⑤ コメント）。段階の完了条件は、その stage の保留が 0 件であること。
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TEXT_EXTENSIONS } from "../gates/check-control-chars.js";
import { loadDocTiers, tierOf } from "../gates/check-doc-tiers.js";
import { listSources } from "../gates/run-on-sources.js";

export const PENDING_PATH = "scripts/gates/doc-pending.json";
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

// eval の入力（prompt と期待値）は、eval が想定する別のリポジトリの状態を書いたものなので読まない。
const EVAL_INPUT_RE = /^evals\/[^/]+\/evals\.json$/;

/**
 * 走査するファイルと階層。
 * @param {string} root
 * @param {{ exclude?: string[] }} options exclude はチェック自身の fixture など、読まないファイル
 * @returns {{ file: string, tier: number, markdown: boolean }[]}
 */
export function scannedFiles(root, { exclude = [] } = {}) {
  const config = loadDocTiers(root);
  const out = [];
  for (const file of listSources(root, TEXT_EXTENSIONS)) {
    if (exclude.includes(file) || file === PENDING_PATH || EVAL_INPUT_RE.test(file)) continue;
    const markdown = file.endsWith(".md");
    const tier = tierOf(config, file);
    // 階層の外（null）と Tier 4 は読まない。Markdown の階層が決まらない（undefined）ものは
    // check-doc-tiers.js が失敗させるので、ここでは Tier 3 として読む（読まずに通さない）。
    if (tier === null || tier === 4) continue;
    out.push({ file, tier: markdown && tier !== undefined ? tier : 3, markdown });
  }
  return out;
}

/** 配布スキルのファイルなら、スキルのディレクトリ（`skills/<name>`）。 */
export const distributedSkillDir = (file) => /^skills\/[^/]+(?=\/)/.exec(file)?.[0] ?? null;

/** 例として書いた行（導入先の値や書式の例）。時間の記述と Issue 番号のチェックでは読まない。 */
export const EXAMPLE_LINE_RE = /例[:：]|（例|\be\.g\./;

/**
 * Markdown の行ごとに、コードフェンスの中かを返す。
 * @returns {boolean[]}
 */
export function fencedLines(lines) {
  let fence = null;
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
export const blankInlineCode = (line) => line.replace(/(`+)(.+?)\1/g, (m) => " ".repeat(m.length));

/** 保留の一覧を読む。無ければ空、形の誤りは例外（判定できないものを保留 0 件として扱わない）。 */
export function loadPending(root) {
  const path = join(root, PENDING_PATH);
  if (!existsSync(path)) return { pending: [], allowed: [] };
  const data = JSON.parse(readFileSync(path, "utf8"));
  const ok = (keys) => (e) => keys.every((k) => typeof e?.[k] === "string" && e[k].trim() !== "");
  if (!Array.isArray(data?.pending) || !data.pending.every(ok(["file", "rule", "text", "stage"])))
    throw new Error(`${PENDING_PATH}: pending は { file, rule, text, stage } の配列にする`);
  if (!Array.isArray(data?.allowed) || !data.allowed.every(ok(["file", "rule", "text", "reason"])))
    throw new Error(`${PENDING_PATH}: allowed は { file, rule, text, reason } の配列にする`);
  for (const e of [...data.pending, ...data.allowed]) {
    if (!KNOWN_RULES.includes(e.rule))
      throw new Error(`${PENDING_PATH}: 知らない規則「${e.rule}」`);
  }
  for (const e of data.pending) {
    if (!STAGES.includes(e.stage))
      throw new Error(`${PENDING_PATH}: stage は ${STAGES.join("・")} のどれか（${e.stage}）`);
  }
  return data;
}

const key = (e) => `${e.file}\u0000${e.rule}\u0000${e.text}`;

/**
 * 違反を保留の一覧と突き合わせる。rules はこのチェックが持つ規則（他のチェックの保留は見ない）。
 * @param {{ file: string, line: number, rule: string, text: string }[]} found
 * @returns {{ failures: string[], pendingCount: number, stale: object[] }}
 */
export function applyPending(found, list, rules) {
  const mine = (e) => rules.includes(e.rule);
  const pending = new Map(list.pending.filter(mine).map((e) => [key(e), e]));
  const allowed = new Map(list.allowed.filter(mine).map((e) => [key(e), e]));
  const usedPending = new Set();
  const usedAllowed = new Set();
  const failures = [];
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
export function prunePending(root, stale) {
  if (stale.length === 0) return 0;
  const path = join(root, PENDING_PATH);
  const data = JSON.parse(readFileSync(path, "utf8"));
  const drop = new Set(stale.map(key));
  data.pending = data.pending.filter((e) => !drop.has(key(e)));
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
  return stale.length;
}
