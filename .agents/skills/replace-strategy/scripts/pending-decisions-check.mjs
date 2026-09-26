// 自律実行の保留（pending_decisions[]）が「済んだ」かを数える検査（正本）。Issue #462。
// 正本はこのスキル側にあり、実行時はスキルディレクトリ内から直接実行する
// （プロジェクトへコピーしない。gh skill update の自動更新を効かせるため）。
//
// 何のためか: 保留は「決まった（resolution あり）」と「済んだ（blocks に挙げた工程まで実施した）」が別の状態なのに、
// resolution の有無だけで数えると、回答が付いた時点で解決と数えられる。「方針は A。実施は後で」の回答では
// blocks の工程が行われないまま、前提の判定・完了判定・収束判定がすべて通る。
// そこで blocks を持つ保留には、resolution の後に工程を実施した記録（resumed）か、
// 残作業の置き場（follow_up.tracked_in）のどちらかを要求する。状態の定義の正本は references/autonomy.md「保留の状態」。
//
// 何をしないか: 回答の内容の当否・工程が本当に行われたかの再測定はしない（記録の形だけを見る）。
// 成果物の書き換えもしない。
//
// 範囲の絞り込み（--mode / --phase / --slug / --target）は references/autonomy.md「下流の前提判定」の表に従う。
// 絞り込みの材料が欠けた要素は範囲に入れる（fail-closed。範囲を決められない保留で止めずに進めない）。
//
// 終了コード: 0 ＝ 範囲内に未解決の保留が無い（ファイルが無い＝保留なし を含む）、1 ＝ 未解決が残る、
// 2 ＝ 使い方の誤り・読めない入力（JSON でない・pending_decisions が配列でない）。
//
// 決定論的: 乱数・現在時刻に依存しない。入力順を保って数える。
// TypeScript 構文は使わない（型は JSDoc）。

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * ツールのバージョン（正本）。判定規則・出力形状を変えたら上げる。
 * @type {string}
 */
export const VERSION = "1";

/** 保留の状態の語彙（正本は references/autonomy.md「保留の状態」）。 */
export const STATES = ["open", "decided", "settled"];

/**
 * 空でない文字列か。
 * @param {unknown} value
 * @returns {boolean}
 */
function nonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * プレーンなオブジェクトか。
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 保留 1 件の状態を決める。
 *   - open: resolution が無い（null・欠落）か、回答として読めない
 *   - decided: 回答はあるが、blocks の工程を実施した記録も残作業の置き場も無い
 *   - settled: 回答があり、blocks が空か、実施の記録か置き場のどちらかがある
 * @param {unknown} element
 * @returns {{ state: "open" | "decided" | "settled", reason: string, tracked_in?: string }}
 */
export function classifyDecision(element) {
  if (!isObject(element)) return { state: "open", reason: "要素がオブジェクトでない" };
  const resolution = element.resolution;
  if (resolution === null || resolution === undefined) {
    return { state: "open", reason: "resolution が無い" };
  }
  // 回答として読めない resolution を「解決済み」に倒さない（`true` や空オブジェクトで通さない）。
  if (!isObject(resolution) || !nonEmptyString(resolution.answer)) {
    return { state: "open", reason: "resolution に answer が無い" };
  }
  if (!nonEmptyString(resolution.answered_at)) {
    return { state: "open", reason: "resolution に answered_at が無い" };
  }
  const blocks = element.blocks;
  // blocks の欠落・型崩れは「止めた工程が無い」ではなく「分からない」なので、工程があるものとして扱う。
  if (!Array.isArray(blocks)) {
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
  // 実施の記録は日時と証拠の両方を要る——日時だけだと「再開した」と書けば通る。
  if (
    isObject(resumed) &&
    nonEmptyString(resumed.at) &&
    Array.isArray(resumed.evidence) &&
    resumed.evidence.some(nonEmptyString)
  ) {
    return { state: "settled", reason: "blocks の工程を実施した記録がある" };
  }
  const followUp = resolution.follow_up;
  // 置き場は残作業（what）と追跡先（tracked_in）の両方を要る——追跡先だけでは何を追っているか分からない。
  if (isObject(followUp) && nonEmptyString(followUp.what) && nonEmptyString(followUp.tracked_in)) {
    return {
      state: "settled",
      reason: "残作業を別の置き場で追跡している",
      tracked_in: /** @type {string} */ (followUp.tracked_in),
    };
  }
  return { state: "decided", reason: missingReason };
}

/**
 * 範囲の絞り込み。材料が欠けた要素は範囲に入れる（fail-closed）。
 * @param {Record<string, unknown>} element
 * @param {{ mode?: string, phase?: string, slug?: string, target?: string }} scope
 * @returns {boolean}
 */
export function inScope(element, scope) {
  if (!isObject(element)) return true;
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
    if (Array.isArray(slugs) && slugs.length > 0 && !slugs.includes(scope.slug)) return false;
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
  if (!isObject(doc)) return { structural: true, error: "成果物がオブジェクトでない" };
  const list = doc.pending_decisions;
  // 配列が無いのは「保留なし」ではない（保留が無ければ空配列を書く規約。references/autonomy.md「記録の形」）。
  if (!Array.isArray(list)) return { structural: true, error: "pending_decisions が配列でない" };
  const counts = { total: list.length, in_scope: 0, open: 0, decided: 0, settled: 0 };
  /** @type {Array<{ id: unknown, state: string, reason: string, blocks: unknown }>} */
  const unsettled = [];
  /** @type {Array<{ id: unknown, tracked_in: string }>} */
  const tracked = [];
  for (const element of list) {
    if (!inScope(/** @type {Record<string, unknown>} */ (element), scope)) continue;
    counts.in_scope += 1;
    const result = classifyDecision(element);
    counts[result.state] += 1;
    const id = isObject(element) ? element.id : undefined;
    if (result.state === "settled") {
      if (result.tracked_in !== undefined) tracked.push({ id, tracked_in: result.tracked_in });
      continue;
    }
    unsettled.push({
      id,
      state: result.state,
      reason: result.reason,
      blocks: isObject(element) ? element.blocks : undefined,
    });
  }
  return { structural: false, unsettled, tracked, counts };
}

const USAGE =
  "usage: node pending-decisions-check.mjs --file <pending_decisions を持つ JSON> " +
  "[--mode <mode>] [--phase a|b] [--slug <slug>] [--target <target>]";

/**
 * CLI。
 * @param {string[]} argv
 * @param {{ cwd?: string, stdout?: (s: string) => void, stderr?: (s: string) => void }} [deps]
 * @returns {number} 終了コード
 */
export function main(argv, deps = {}) {
  const cwd = deps.cwd ?? process.cwd();
  const out = (/** @type {unknown} */ value) =>
    (deps.stdout ?? ((s) => process.stdout.write(s)))(`${JSON.stringify(value, null, 2)}\n`);
  const fail = (/** @type {string} */ message) => {
    (deps.stderr ?? ((s) => process.stderr.write(s)))(`${message}\n${USAGE}\n`);
    return 2;
  };
  const known = new Set(["--file", "--mode", "--phase", "--slug", "--target"]);
  /** @type {Record<string, string>} */
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!known.has(key)) return fail(`未知の引数: ${key}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) return fail(`${key} に値が無い`);
    if (Object.hasOwn(args, key)) return fail(`${key} が重複している`);
    args[key] = value;
    i += 1;
  }
  if (args["--file"] === undefined) return fail("--file は必須");
  if (args["--phase"] !== undefined && !["a", "b"].includes(args["--phase"])) {
    return fail(`--phase は a か b: ${args["--phase"]}`);
  }
  // フェーズ B の範囲は slug × target で決まる。片方だけでは他の slug・target の保留で止めるか決められない。
  if (args["--phase"] === "b" && (args["--slug"] === undefined || args["--target"] === undefined)) {
    return fail("--phase b には --slug と --target が要る");
  }
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
    return fail(`${path} を読めない: ${error && /** @type {Error} */ (error).message}`);
  }
  /** @type {{ mode?: string, phase?: string, slug?: string, target?: string }} */
  const scope = {};
  if (args["--mode"] !== undefined) scope.mode = args["--mode"];
  if (args["--phase"] !== undefined) scope.phase = args["--phase"];
  if (args["--slug"] !== undefined) scope.slug = args["--slug"];
  if (args["--target"] !== undefined) scope.target = args["--target"];
  const result = checkPendingDecisions(doc, scope);
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

// CLI エントリ判定は両辺を実パスに解決してから突き合わせる（シンボリックリンク経由の起動でサイレント no-op にしない）。
const invokedAsCli = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  const self = fileURLToPath(import.meta.url);
  try {
    return realpathSync(entry) === realpathSync(self);
  } catch {
    return entry === self;
  }
})();

if (invokedAsCli) {
  // process.exit は書き込み中の stdout を捨てるため、終了コードだけ設定して自然終了させる。
  process.exitCode = main(process.argv.slice(2));
}
