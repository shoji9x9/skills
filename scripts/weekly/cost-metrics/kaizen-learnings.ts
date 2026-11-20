// kaizen の学び（`.kaizen/` の 1 件 1 ファイルの記録）の適用・再発・忘却の件数を数える（Issue #1096）。
// check-cost-metrics.ts が週次の指標の 1 つとして呼び、閾値を超えた週に候補として挙げる。学びを減らすか、まとめるかは人が決める。
//
// 数える対象は `<dir>/*.md` と `<dir>/archive/*.md` のうち、名前が `YYYY-MM-DD-<slug>.md` のファイルである（archive の INDEX.md などは学びではない）。
// 今の status は、作業ツリーのファイルの frontmatter から読む。
// status が変わった日は、frontmatter に欄が無いので、git の履歴（`status:` の行を足した commit の日時）から読む。
// 履歴は first-parent でたどり、merge commit は 1 つ目の親との差分で読む。日時は、変更が HEAD の系列（main など）に入った commit の日時になる。
// PR の branch の commit をたどると、merge のときの競合の解消で足した学びを取りこぼす（merge commit の差分はデフォルトでは出ない）。
// 学びはファイル名で追い、名前の変更（archive への移動・日付の書き直し）は git の `rename from`・`rename to` で追う。
// 履歴の `status:` の行のうち、次のものは status の事象として読まず、読み飛ばした件数を本文に出す。
// frontmatter の範囲（先頭の FRONTMATTER_LINES 行）の外に足した行（本文の例など）、知らない値の行、1 つの commit で同じ学びに 2 回目以降に足した行である。
// git の履歴は後から直せないので、例外にすると、そうした commit が 1 件入っただけで週次の点検が止まり続ける。
// 読み飛ばした結果で今の status が食い違えば、作業ツリーとの突き合わせ（checkHistory）が例外にする。
// 再発は、frontmatter の `recurrence-of`（適用済みの学びと同じ原因で起きたと書いた学び）だけを数える。
// 本文の KEDB 照合の記述は書き方が揃っていないので、読まない。
//
// 確かめられないものを「該当なし」として扱わない。次のときは例外にする。
// - 学びの frontmatter が読めない（status が無い・知らない値、recurrence-of が 1 行の flow 配列でない）
// - 同じ名前の学びが top-level と archive の両方にある
// - git の履歴が浅い
// - 履歴の最後の status が作業ツリーの status と違う、または履歴で消えていない学びのファイルが無い
// - recurrence-of が、無い学びか、再発した学びを書く前に適用していない学びを挙げている
// `<dir>` が無いリポジトリでは数えず、null を返す（呼び出し側が、数えなかったことを本文に書く）。
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { median } from "./median.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOTE_NAME = /^\d{4}-\d{2}-\d{2}-[^/\s]+\.md$/u;
const COMMIT = "@@C ";
/** frontmatter が収まると見なす行数。この行数より後に足した `status:` の行は、本文の行として読み飛ばす。 */
const FRONTMATTER_LINES = 40;

const STATUSES = ["pending", "applied", "forgotten", "rejected"] as const;
export type Status = (typeof STATUSES)[number];

export type KaizenConfig = {
  dir: string;
  days: number;
  staleDays: number;
  maxPending: number;
  maxStale: number;
};

export type Note = { status: Status; recurrenceOf: string[] };
/** status が null の事象は、そのファイルを消した commit である。 */
export type StatusEvent = { at: number; status: Status | null };
export type Runner = (command: string, args: readonly string[]) => Promise<string>;

function isStatus(value: string): value is Status {
  return STATUSES.some((s) => s === value);
}

// ---- 学びのファイル

function frontmatter(text: string, name: string): string[] {
  const lines = text.split("\n");
  const end = lines.indexOf("---", 1);
  if (lines[0] !== "---" || end === -1) throw new Error(`${name} の frontmatter を読めない`);
  return lines.slice(1, end);
}

function onlyLine(lines: readonly string[], key: string, name: string): string | undefined {
  const found = lines.filter((line) => line.startsWith(`${key}:`));
  if (found.length > 1) throw new Error(`${name} の ${key} が 2 回以上ある`);
  return found[0];
}

function parseRecurrence(line: string | undefined, name: string): string[] {
  if (line === undefined) return [];
  const match = /^recurrence-of: \[(.*)\]$/u.exec(line);
  if (match === null) throw new Error(`${name} の recurrence-of が 1 行の flow 配列でない`);
  const inner = (match[1] ?? "").trim();
  if (inner === "") return [];
  const names = inner.split(",").map((s) => s.trim());
  const bad = names.filter((n) => !NOTE_NAME.test(n));
  if (bad.length > 0) {
    throw new Error(
      `${name} の recurrence-of に学びのファイル名でない要素がある: ${bad.join(", ")}`,
    );
  }
  return names;
}

/** 学びの frontmatter から status と recurrence-of を読む。 */
export function parseNote(text: string, name: string): Note {
  const lines = frontmatter(text, name);
  const statusLine = onlyLine(lines, "status", name);
  const status = /^status: (\S+)$/u.exec(statusLine ?? "")?.[1];
  if (status === undefined || !isStatus(status)) {
    throw new Error(
      `${name} の status が無いか、知らない値: ${JSON.stringify(statusLine ?? null)}`,
    );
  }
  return { status, recurrenceOf: parseRecurrence(onlyLine(lines, "recurrence-of", name), name) };
}

function noteFiles(path: string): string[] {
  if (!existsSync(path)) return [];
  return readdirSync(path).filter((name) => NOTE_NAME.test(name));
}

/** `<dir>` と `<dir>/archive` の学びを、ファイル名ごとに読む。`<dir>` が無ければ null。 */
export function readNotes(root: string, dir: string): Map<string, Note> | null {
  const top = join(root, dir);
  if (!existsSync(top)) return null;
  const notes = new Map<string, Note>();
  for (const sub of [top, join(top, "archive")]) {
    for (const name of noteFiles(sub)) {
      if (notes.has(name)) throw new Error(`同じ名前の学びが top-level と archive にある: ${name}`);
      notes.set(name, parseNote(readFileSync(join(sub, name), "utf8"), name));
    }
  }
  return notes;
}

// ---- git の履歴

/** 学びのパス（`<dir>/<name>` か `<dir>/archive/<name>`）ならファイル名を、そうでなければ null を返す。 */
function noteNameOf(path: string, dir: string): string | null {
  const name = basename(path);
  if (!NOTE_NAME.test(name)) return null;
  const parent = path.slice(0, -name.length - 1);
  return parent === dir || parent === `${dir}/archive` ? name : null;
}

type CommitChanges = {
  at: number;
  renamed: [string, string][];
  deleted: string[];
  set: Map<string, Status>;
};

type LogState = {
  commit: CommitChanges | null;
  file: string | null;
  /** 次に足す行の、変更後のファイルでの行番号。hunk の見出しで決まる。 */
  line: number;
  renameFrom: string | null;
  commits: CommitChanges[];
  /** status の事象として読まなかった `status:` の行の数。 */
  skipped: number;
};

function startCommit(state: LogState, line: string): void {
  const at = Date.parse(line.slice(COMMIT.length).split(" ")[1] ?? "");
  if (Number.isNaN(at)) throw new Error(`git log の commit の日時を読めない: ${line}`);
  state.commit = { at, renamed: [], deleted: [], set: new Map() };
  state.commits.push(state.commit);
  state.file = null;
}

function renameLine(state: LogState, line: string, dir: string): void {
  const name = noteNameOf(line.replace(/^rename (from|to) /u, ""), dir);
  if (line.startsWith("rename from ")) {
    state.renameFrom = name;
    return;
  }
  if (state.renameFrom !== null && name !== null && state.renameFrom !== name) {
    state.commit?.renamed.push([state.renameFrom, name]);
  }
  state.renameFrom = null;
}

function addStatus(state: LogState, line: string): void {
  const { commit, file } = state;
  const at = state.line;
  state.line += 1;
  if (commit === null || file === null) return;
  const value = /^\+status: (\S+)$/u.exec(line)?.[1];
  // 同じ学びに 2 回目以降に足した行は、1 回目（ファイルの前の方にある frontmatter の行）より後ろの本文の行である。
  if (at > FRONTMATTER_LINES || value === undefined || !isStatus(value) || commit.set.has(file)) {
    state.skipped += 1;
    return;
  }
  commit.set.set(file, value);
}

function readLogLine(state: LogState, line: string, dir: string): void {
  if (line.startsWith(COMMIT)) return startCommit(state, line);
  if (line.startsWith("diff --git ")) {
    // git は ASCII 以外の文字を含むパスを引用符で囲んで出す（core.quotePath）。読めない見出しは学びでないとして扱い、
    // 前のファイルの名前を残さない。残すと、そのファイルに足した行を前の学びの status として読む。
    // 引用符で囲まれた学びは履歴に現れないので、checkHistory が作業ツリーとの食い違いとして例外にする。
    const diff = /^diff --git a\/.+ b\/(.+)$/u.exec(line);
    state.file = diff === null ? null : noteNameOf(diff[1] ?? "", dir);
    return;
  }
  const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/u.exec(line);
  if (hunk !== null) {
    state.line = Number(hunk[1]);
    return;
  }
  if (line.startsWith("rename from ") || line.startsWith("rename to "))
    return renameLine(state, line, dir);
  if (line.startsWith("deleted file mode") && state.file !== null) {
    state.commit?.deleted.push(state.file);
    return;
  }
  if (line.startsWith("+status:")) return addStatus(state, line);
  if (line.startsWith("+") && !line.startsWith("+++")) state.line += 1;
}

export type StatusHistory = { events: Map<string, StatusEvent[]>; skipped: number };

/**
 * `git log -p` の出力（新しい順）から、学びごとの status の事象を古い順に返す。
 * 1 つの commit の中では、名前の変更・消した学び・足した status の順に当てる（top-level から archive へ移したとき、git が名前の変更と判定しない場合がある）。
 */
export function parseStatusLog(log: string, dir: string): StatusHistory {
  const state: LogState = {
    commit: null,
    file: null,
    line: 0,
    renameFrom: null,
    commits: [],
    skipped: 0,
  };
  for (const line of log.split("\n")) readLogLine(state, line, dir);
  const events = new Map<string, StatusEvent[]>();
  const push = (name: string, event: StatusEvent): void => {
    events.set(name, [...(events.get(name) ?? []), event]);
  };
  for (const { at, renamed, deleted, set } of state.commits.reverse()) {
    // 名前を変えた学びは、それまでの事象を新しい名前に付け替える。
    // 新しい名前で前に消した学びがあると、両方の事象が並ぶので、時刻の順に並べ直す（最後の事象を今の status として読む）。
    for (const [from, to] of renamed) {
      const merged = [...(events.get(to) ?? []), ...(events.get(from) ?? [])];
      events.set(
        to,
        merged.sort((a, b) => a.at - b.at),
      );
      events.delete(from);
    }
    for (const name of deleted) if (!set.has(name)) push(name, { at, status: null });
    for (const [name, status] of set) push(name, { at, status });
  }
  return { events, skipped: state.skipped };
}

/**
 * `<dir>` を変えた commit を、差分と名前の変更つきで取得する。履歴が浅いと最初の記録を取りこぼすので例外にする。
 * `-G` で `status:` の行を変えた commit に絞ると、status を変えずに名前だけを変えた commit が落ちるので、絞らない。
 */
export async function statusLog(run: Runner, root: string, dir: string): Promise<string> {
  const git = (args: string[]): Promise<string> => run("git", ["-C", root, ...args]);
  if ((await git(["rev-parse", "--is-shallow-repository"])).trim() !== "false") {
    throw new Error("git の履歴が浅い（checkout の fetch-depth を 0 にする）");
  }
  return git([
    "log",
    "--first-parent",
    // merge commit は 1 つ目の親との差分だけを読む。2 つ目の親との差分は、branch の側から見た変更で、main に入った変更ではない。
    "--diff-merges=first-parent",
    "-M",
    `--format=${COMMIT}%H %cI`,
    "-p",
    "--unified=0",
    "--no-color",
    "--no-ext-diff",
    // 本文に制御文字を含む学びを、git は binary として扱い、差分を出さない（制御文字を扱う学びで実測した）。
    "--text",
    "--",
    dir,
  ]);
}

// ---- 数える

function statusAt(events: readonly StatusEvent[], at: number): Status | null {
  let status: Status | null = null;
  for (const event of events) if (event.at <= at) status = event.status;
  return status;
}

/** 履歴の最後の status が作業ツリーと一致することを確かめる。食い違えば、履歴から読んだ日付を信じられない。 */
function checkHistory(
  notes: ReadonlyMap<string, Note>,
  history: ReadonlyMap<string, StatusEvent[]>,
): void {
  const mismatched: string[] = [];
  for (const [name, note] of notes) {
    if (history.get(name)?.at(-1)?.status !== note.status) mismatched.push(name);
  }
  for (const [name, events] of history) {
    if (!notes.has(name) && events.at(-1)?.status !== null) mismatched.push(name);
  }
  if (mismatched.length > 0) {
    throw new Error(
      `履歴の最後の status が作業ツリーと違う（commit していない変更など）: ${mismatched.join(", ")}`,
    );
  }
}

function emptyCounts(): Record<Status, number> {
  return { pending: 0, applied: 0, forgotten: 0, rejected: 0 };
}

function countAt(history: ReadonlyMap<string, StatusEvent[]>, at: number): Record<Status, number> {
  const counts = emptyCounts();
  for (const events of history.values()) {
    const status = statusAt(events, at);
    if (status !== null) counts[status] += 1;
  }
  return counts;
}

/** その status に初めてなった時刻。なっていなければ undefined。 */
function firstAt(events: readonly StatusEvent[], status: Status): number | undefined {
  return events.find((e) => e.status === status)?.at;
}

/** 期間の中で最初に記録した学びの数。後で消した学びも、履歴に残るので数える。 */
function recordedIn(
  history: ReadonlyMap<string, StatusEvent[]>,
  window: { from: number; to: number },
): number {
  let count = 0;
  for (const events of history.values()) {
    const at = events[0]?.at;
    if (at !== undefined && at > window.from && at <= window.to) count += 1;
  }
  return count;
}

/** 期間の中で、別の status からその status に変わった学びの数。 */
function changedTo(
  history: ReadonlyMap<string, StatusEvent[]>,
  status: Status,
  window: { from: number; to: number },
): number {
  const { from, to } = window;
  let count = 0;
  for (const events of history.values()) {
    const changed = events.some(
      (e, i) =>
        e.status === status && e.at > from && e.at <= to && events[i - 1]?.status !== status,
    );
    if (changed) count += 1;
  }
  return count;
}

export type Recurrence = { name: string; of: string[]; at: number };

export type KaizenMetrics = {
  counts: Record<Status, number>;
  previous: Record<Status, number>;
  extracted: number;
  applied: number;
  forgotten: number;
  /** 今 applied の学びの、最初の記録から最初に applied になるまでの日数の中央値と、数えた件数。 */
  daysToApply: { median: number | null; notes: number };
  /** pending のまま、最初の記録から staleDays 日を過ぎた学び。 */
  stale: string[];
  recurrences: Recurrence[];
  /** 履歴で status の事象として読まなかった `status:` の行の数。 */
  skippedLines: number;
};

function recurrences(
  notes: ReadonlyMap<string, Note>,
  history: ReadonlyMap<string, StatusEvent[]>,
): Recurrence[] {
  const found: Recurrence[] = [];
  for (const [name, note] of notes) {
    if (note.recurrenceOf.length === 0) continue;
    const at = history.get(name)?.[0]?.at ?? 0;
    for (const of of note.recurrenceOf) {
      const applied = firstAt(history.get(of) ?? [], "applied");
      if (!notes.has(of) || applied === undefined || applied > at) {
        throw new Error(
          `${name} の recurrence-of の ${of} が、無いか、${name} を書く前に適用していない学び`,
        );
      }
    }
    found.push({ name, of: note.recurrenceOf, at });
  }
  return found.sort((a, b) => a.at - b.at || (a.name < b.name ? -1 : 1));
}

/** 作業ツリーの学びと git の履歴から、指標を数える。 */
export function kaizenMetrics(
  notes: ReadonlyMap<string, Note>,
  history: ReadonlyMap<string, StatusEvent[]>,
  input: { now: Date; config: KaizenConfig; skippedLines?: number },
): KaizenMetrics {
  checkHistory(notes, history);
  const { now, config, skippedLines = 0 } = input;
  const end = now.getTime();
  const start = end - config.days * DAY_MS;
  const counts = emptyCounts();
  const days: number[] = [];
  const stale: string[] = [];
  for (const [name, note] of notes) {
    counts[note.status] += 1;
    const events = history.get(name) ?? [];
    const created = events[0]?.at ?? end;
    const applied = firstAt(events, "applied");
    if (note.status === "applied" && applied !== undefined) days.push((applied - created) / DAY_MS);
    if (note.status === "pending" && end - created >= config.staleDays * DAY_MS) stale.push(name);
  }
  return {
    counts,
    previous: countAt(history, start),
    extracted: recordedIn(history, { from: start, to: end }),
    applied: changedTo(history, "applied", { from: start, to: end }),
    forgotten: changedTo(history, "forgotten", { from: start, to: end }),
    daysToApply: { median: median(days), notes: days.length },
    stale: stale.sort(),
    recurrences: recurrences(notes, history),
    skippedLines,
  };
}

/** `<dir>` を読み、履歴と合わせて数える。`<dir>` が無ければ null（git も呼ばない）。 */
export async function collectKaizen(
  run: Runner,
  input: { root: string; now: Date; config: KaizenConfig },
): Promise<KaizenMetrics | null> {
  const { root, now, config } = input;
  const notes = readNotes(root, config.dir);
  if (notes === null) return null;
  const { events, skipped } = parseStatusLog(await statusLog(run, root, config.dir), config.dir);
  return kaizenMetrics(notes, events, { now, config, skippedLines: skipped });
}

// ---- 候補と本文

export type KaizenFinding = {
  kind: "kaizen-pending" | "kaizen-stale" | "kaizen-recurrence";
  target: string;
  detail: string;
};

function isRecent(at: number, now: Date, days: number): boolean {
  return at > now.getTime() - days * DAY_MS && at <= now.getTime();
}

/** 閾値を超えた値と、直近の期間に書いた再発の学びを候補に挙げる。 */
export function kaizenFindings(
  metrics: KaizenMetrics | null,
  input: { now: Date; config: KaizenConfig },
): KaizenFinding[] {
  if (metrics === null) return [];
  const { now, config } = input;
  const findings: KaizenFinding[] = [];
  const pending = metrics.counts.pending;
  if (pending > config.maxPending) {
    findings.push({
      kind: "kaizen-pending",
      target: config.dir,
      detail: `pending の学び ${pending} 件（上限 ${config.maxPending} 件）`,
    });
  }
  if (metrics.stale.length > config.maxStale) {
    findings.push({
      kind: "kaizen-stale",
      target: config.dir,
      detail: `pending のまま ${config.staleDays} 日を過ぎた学び ${metrics.stale.length} 件（上限 ${config.maxStale} 件）`,
    });
  }
  for (const r of metrics.recurrences) {
    if (!isRecent(r.at, now, config.days)) continue;
    findings.push({
      kind: "kaizen-recurrence",
      target: r.name,
      detail: `適用済みの ${r.of.join("、")} と同じ原因で再発した`,
    });
  }
  return findings;
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function statusRows(m: KaizenMetrics): string[] {
  return STATUSES.map(
    (s) => `| ${s} | ${m.counts[s]} | ${m.previous[s]} | ${signed(m.counts[s] - m.previous[s])} |`,
  );
}

function listOrNone(names: readonly string[]): string {
  return names.length === 0 ? "無し" : names.map((n) => `\`${n}\``).join("、");
}

/** 追跡 Issue の本文に置く、学びの指標の表。数えなかったときは、その旨だけを書く。 */
export function kaizenTable(
  metrics: KaizenMetrics | null,
  input: { now: Date; config: KaizenConfig },
): string[] {
  const { now, config } = input;
  if (metrics === null) {
    return [`\`${config.dir}/\` が無いので、kaizen の学びは数えなかった。`, ""];
  }
  const recent = metrics.recurrences.filter((r) => isRecent(r.at, now, config.days)).length;
  const median = metrics.daysToApply.median;
  return [
    `<details><summary>kaizen の学び（直近 ${config.days} 日）</summary>`,
    "",
    `| status | 今 | ${config.days} 日前 | 増減 |`,
    "| --- | --- | --- | --- |",
    ...statusRows(metrics),
    "",
    `- 直近 ${config.days} 日に記録した学び: ${metrics.extracted} 件、適用した学び: ${metrics.applied} 件、忘却した学び: ${metrics.forgotten} 件`,
    `- 適用までの日数の中央値: ${median === null ? "適用した学びが無い" : `${median.toFixed(1)} 日`}（今 applied の ${metrics.daysToApply.notes} 件）`,
    `- pending のまま ${config.staleDays} 日を過ぎた学び: ${listOrNone(metrics.stale)}`,
    `- 適用した後に同じ原因で再発した学び: ${metrics.recurrences.length} 件（直近 ${config.days} 日に ${recent} 件）`,
    "",
    `日数は、git の履歴で \`status:\` の行を変えた commit の日時から数えた。履歴の \`status:\` の行のうち、frontmatter の範囲の外・知らない値・同じ commit の 2 回目以降の ${metrics.skippedLines} 行は読み飛ばした。`,
    "再発は、frontmatter に `recurrence-of` を書いた学びだけを数え、この欄を書く前の学びは数えていない。",
    "",
    "</details>",
    "",
  ];
}
