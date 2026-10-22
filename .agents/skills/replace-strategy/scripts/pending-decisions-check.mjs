// 自律実行の保留（pending_decisions[]）が「済んだ」かを数えるチェック。判定の規則は、このファイルで定義する。
// 原本はこのスキルの側にあり、スキルのディレクトリから直接実行する
// （プロジェクトへコピーしない。gh skill update の自動更新が反映されるようにするため）。
//
// 何のためか: 保留は「決まった（resolution あり）」と「済んだ（blocks に挙げた工程まで実施した）」が別の状態なのに、
// resolution の有無だけで数えると、回答が付いた時点で解決と数えられる。「方針は A。実施は後で」の回答では
// blocks の工程が行われないまま、前提の判定・完了判定・収束判定がすべて通る。
// そこで blocks を持つ保留には、resolution の後に工程を実施した記録（resumed）か、
// 残作業の置き場（follow_up.tracked_in）のどちらかを要求する。状態の定義の原本は references/autonomy.md「保留の状態」である。
//
// 何をしないか: 回答の内容の当否・工程が本当に行われたかの再測定はしない（記録の形だけを見る）。
// 成果物の書き換えもしない。
//
// 範囲の絞り込み（--mode / --phase / --slug / --target）は references/autonomy.md「下流の前提判定」の表に従う。
// 絞り込みの材料が欠けた要素は範囲に入れる（判定できないときは失敗として扱う。範囲を決められない保留で止めずに進めない）。
//
// 終了コード: 0 ＝ 範囲内に未解決の保留が無い（ファイルが無い＝保留なし を含む）、1 ＝ 未解決が残る、
// 2 ＝ 使い方の誤り・読めない入力（JSON でない・pending_decisions が配列でない）。
//
// 決定論的: 乱数・現在時刻に依存しない。入力順を保って数える。
// TypeScript 構文は使わない（型は JSDoc）。

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isArray } from "./lib/is-array.mjs";
import { isCliEntry } from "./lib/cli.mjs";
import { errorMessage } from "./lib/errors.mjs";
import { makeIo, parseFlagArgs } from "./lib/flag-args.mjs";
import { isPlainObject, nonEmptyString } from "./lib/guards.mjs";

/**
 * ツールのバージョン（このファイルで定義する）。判定の規則や出力の形を変えたら上げる。
 * @type {string}
 */
export const VERSION = "1";

/** 保留の状態の語彙（原本は references/autonomy.md「保留の状態」）。 */
export const STATES = ["open", "decided", "settled"];

/**
 * 保留 1 件の状態を決める。
 *   - open: resolution が無い（null・欠落）か、回答として読めない
 *   - decided: 回答はあるが、blocks の工程を実施した記録も残作業の置き場も無い
 *   - settled: 回答があり、blocks が空か、実施の記録か置き場のどちらかがある
 * @param {unknown} element
 * @returns {{ state: "open" | "decided" | "settled", reason: string, tracked_in?: string }}
 */
export function classifyDecision(element) {
  if (!isPlainObject(element)) return { state: "open", reason: "要素がオブジェクトでない" };
  const resolution = element.resolution;
  if (resolution === null || resolution === undefined) {
    return { state: "open", reason: "resolution が無い" };
  }
  // 回答として読めない resolution を「解決済み」として扱わない（`true` や空オブジェクトで通さない）。
  if (!isPlainObject(resolution) || !nonEmptyString(resolution.answer)) {
    return { state: "open", reason: "resolution に answer が無い" };
  }
  if (!nonEmptyString(resolution.answered_at)) {
    return { state: "open", reason: "resolution に answered_at が無い" };
  }
  const blocks = element.blocks;
  // blocks の欠落・型崩れは「止めた工程が無い」ではなく「分からない」なので、工程があるものとして扱う。
  if (!isArray(blocks)) {
    return settledOrDecided(resolution, "blocks が配列でない（止めた工程を読めない）");
  }
  if (blocks.length === 0) return { state: "settled", reason: "止めた工程が無い" };
  return settledOrDecided(
    resolution,
    "blocks の工程を実施した記録（resumed）も残作業の置き場（follow_up.tracked_in）も無い",
  );
}

/**
 * 止めた工程がある（または読めない）保留を、実施の記録か置き場で済んだと数えるか。
 * @param {Record<string, unknown>} resolution
 * @param {string} missingReason
 * @returns {{ state: "decided" | "settled", reason: string, tracked_in?: string }}
 */
function settledOrDecided(resolution, missingReason) {
  const resumed = resolution.resumed;
  // 実施の記録は日時と証拠の両方を要る。日時だけだと「再開した」と書けば通る。
  if (
    isPlainObject(resumed) &&
    nonEmptyString(resumed.at) &&
    isArray(resumed.evidence) &&
    resumed.evidence.some(nonEmptyString)
  ) {
    return { state: "settled", reason: "blocks の工程を実施した記録がある" };
  }
  const followUp = resolution.follow_up;
  // 置き場は残作業（what）と追跡先（tracked_in）の両方を要る。追跡先だけでは何を追っているか分からない。
  const trackedIn = isPlainObject(followUp) ? followUp.tracked_in : undefined;
  // nonEmptyString が真なら文字列なので、typeof は型を絞るためだけにある（判定は変わらない）。
  if (
    isPlainObject(followUp) &&
    nonEmptyString(followUp.what) &&
    typeof trackedIn === "string" &&
    nonEmptyString(trackedIn)
  ) {
    return {
      state: "settled",
      reason: "残作業を別の置き場で追跡している",
      tracked_in: trackedIn,
    };
  }
  return { state: "decided", reason: missingReason };
}

/**
 * 範囲の絞り込み。材料が欠けた要素は範囲に入れる（判定できないときは失敗として扱う）。
 * @param {unknown} element
 * @param {{ mode?: string, phase?: string, slug?: string, target?: string }} scope
 * @returns {boolean}
 */
export function inScope(element, scope) {
  if (!isPlainObject(element)) return true;
  if (scope.mode !== undefined) {
    // 要素の mode が欠落していれば setup のものとして止める（references/autonomy.md「下流の前提判定」）。
    const mode = element.mode;
    if (nonEmptyString(mode) && mode !== scope.mode) return false;
  }
  if (scope.phase !== undefined) {
    const phase = element.phase;
    if (nonEmptyString(phase) && phase !== scope.phase) return false;
  }
  if (scope.target !== undefined) {
    const target = element.target;
    if (nonEmptyString(target) && target !== scope.target) return false;
  }
  if (scope.slug !== undefined) {
    // slugs が欠落・空の要素は範囲を決められないので、同じ target のすべての slug を止める。
    const slugs = element.slugs;
    if (isArray(slugs) && slugs.length > 0 && !slugs.includes(scope.slug)) return false;
  }
  return true;
}

/**
 * pending_decisions を数える。
 * @param {unknown} doc 成果物の JSON（pending_decisions 配列を持つ）
 * @param {{ mode?: string, phase?: string, slug?: string, target?: string }} [scope]
 * @returns {{ structural: true, error: string } | {
 *   structural: false,
 *   unsettled: Array<{ id: unknown, state: string, reason: string, blocks: unknown }>,
 *   tracked: Array<{ id: unknown, tracked_in: string }>,
 *   counts: { total: number, in_scope: number, open: number, decided: number, settled: number },
 * }}
 */
export function checkPendingDecisions(doc, scope = {}) {
  if (!isPlainObject(doc)) return { structural: true, error: "成果物がオブジェクトでない" };
  const list = doc.pending_decisions;
  // 配列が無いのは「保留なし」ではない（保留が無ければ空配列を書く規約。references/autonomy.md「記録の形」）。
  if (!isArray(list)) return { structural: true, error: "pending_decisions が配列でない" };
  const counts = { total: list.length, in_scope: 0, open: 0, decided: 0, settled: 0 };
  /** @type {Array<{ id: unknown, state: string, reason: string, blocks: unknown }>} */
  const unsettled = [];
  /** @type {Array<{ id: unknown, tracked_in: string }>} */
  const tracked = [];
  for (const element of list) {
    if (!inScope(element, scope)) continue;
    counts.in_scope += 1;
    const result = classifyDecision(element);
    counts[result.state] += 1;
    const id = isPlainObject(element) ? element.id : undefined;
    if (result.state === "settled") {
      if (result.tracked_in !== undefined) tracked.push({ id, tracked_in: result.tracked_in });
      continue;
    }
    unsettled.push({
      id,
      state: result.state,
      reason: result.reason,
      blocks: isPlainObject(element) ? element.blocks : undefined,
    });
  }
  return { structural: false, unsettled, tracked, counts };
}

const USAGE =
  "usage: node pending-decisions-check.mjs --file <pending_decisions を持つ JSON> " +
  "[--mode <mode>] [--phase a|b] [--slug <slug>] [--target <target>]";

/**
 * 引数を読む。誤りがあれば error に理由を入れて返す。
 * @param {string[]} argv
 * @returns {{ args: Record<string, string>, error?: undefined } | { args?: undefined, error: string }}
 */
function parseArgs(argv) {
  const known = new Set(["--file", "--mode", "--phase", "--slug", "--target"]);
  const parsed = parseFlagArgs(argv, known);
  if (parsed.error !== undefined) return parsed;
  const { args } = parsed;
  if (args["--file"] === undefined) return { error: "--file は必須" };
  if (args["--phase"] !== undefined && !["a", "b"].includes(args["--phase"])) {
    return { error: `--phase は a か b: ${args["--phase"]}` };
  }
  // フェーズ B の範囲は slug × target で決まる。片方だけでは他の slug・target の保留で止めるか決められない。
  if (args["--phase"] === "b" && (args["--slug"] === undefined || args["--target"] === undefined)) {
    return { error: "--phase b には --slug と --target が要る" };
  }
  return { args };
}

/**
 * 引数から範囲の絞り込みを作る。指定の無い軸は持たない。
 * @param {Record<string, string>} args
 * @returns {{ mode?: string, phase?: string, slug?: string, target?: string }}
 */
function scopeFromArgs(args) {
  /** @type {{ mode?: string, phase?: string, slug?: string, target?: string }} */
  const scope = {};
  if (args["--mode"] !== undefined) scope.mode = args["--mode"];
  if (args["--phase"] !== undefined) scope.phase = args["--phase"];
  if (args["--slug"] !== undefined) scope.slug = args["--slug"];
  if (args["--target"] !== undefined) scope.target = args["--target"];
  return scope;
}

/**
 * CLI。
 * @param {string[]} argv
 * @param {{ cwd?: string, stdout?: (s: string) => void, stderr?: (s: string) => void }} [deps]
 * @returns {number} 終了コード
 */
export function main(argv, deps = {}) {
  const cwd = deps.cwd ?? process.cwd();
  const { out, fail } = makeIo(deps, USAGE);
  const parsed = parseArgs(argv);
  if (parsed.error !== undefined) return fail(parsed.error);
  const { args } = parsed;
  const path = resolve(cwd, args["--file"]);
  // 記録先のファイルが無いのは「保留なし」（references/autonomy.md「下流の前提判定」）。
  // ただしパスの誤りと区別できるよう、無かったことを出力に残す。
  if (!existsSync(path)) {
    out({ ok: true, file: path, file_exists: false, unsettled: [], tracked: [], counts: null });
    return 0;
  }
  /** @type {unknown} */
  let doc;
  try {
    doc = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return fail(`${path} を読めない: ${errorMessage(error)}`);
  }
  const result = checkPendingDecisions(doc, scopeFromArgs(args));
  if (result.structural) {
    out({ ok: false, structural: true, file: path, error: result.error });
    return 2;
  }
  out({
    ok: result.unsettled.length === 0,
    file: path,
    file_exists: true,
    unsettled: result.unsettled,
    tracked: result.tracked,
    counts: result.counts,
  });
  return result.unsettled.length === 0 ? 0 : 1;
}

if (isCliEntry(import.meta.url)) {
  // process.exit は書き込み中の stdout を捨てるため、終了コードだけ設定して自然終了させる。
  process.exitCode = main(process.argv.slice(2));
}
