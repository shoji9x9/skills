// 操作の反応の網羅表（reactions.json）を照合する（原本）。
// 原本は parity-suite にあり、スキルディレクトリ内から直接実行する（プロジェクトへコピーしない）。
// parity-diff は収束判定でインストール済みの parity-suite から同じスクリプトを --recorded で呼ぶ。
//
// 何をするか: 次のものを照合する。
//   1. 現側 metadata.json の reaction_coverage 宣言を読み、declared: true のときだけ反応の網羅表を開く。
//      画面駆動の機能は操作を持たなくても declared: false を使えず、operations: [] と operations_none_reason の表で
//      状態表示を振り分けさせる（表示だけの画面も取得の失敗・読み込み中・0 件を持ちうる）。
//      手順の改訂 OPERATIONLESS_TABLE_REVISION より前の declared: false は旧成果物として判定しない。
//   2. 操作ごとに反応の欄が埋まっているかを数え直す（空欄・証拠の欠けは未測定。「なし」も実測の記録を要求する）。
//      文書ごとのオリジン（対象 URL と同じか）も数える。別オリジンの文書は親へ反応が届かず誤って「なし」と判定されうるので根拠を要求する。
//      操作ごとの頁の組み方の変化（layout）も数える。操作で頁の高さ・要素の位置が変わるなら、2 回以上繰り返した後の実測を要求する。
//      操作を終えた後に残るもの（aftermath）も数える。残る見た目は撮る状態か assertion に割り当て、
//      戻り先は押す前後の URL と、押す前に動かした状態のうち戻った範囲を実測させる。
//      撮る状態を持つ操作は、名乗った撮影ページ（capture_page）を押した後の URL を解いたページと照合する（解決規則は page-identity.mjs）。
//      撮る状態の使い回しは解いたページ × 状態名で数え、部品網羅表（component_coverage）の導いた行も同じ集合に入れる。
//      操作が最終的に呼ぶ送信・実行の関数の手前にある判定（pre_send）も数える。部品の内側の判定は画面の処理にも
//      部品へ渡す引数にも現れず、境界の外側でしか姿を現さないので、境界の両側を現行で測らせる。
//      表への書き込み（side_effect_writes）も数える。移行元ソースを書き込みのパターンで走査して全件と突き合わせ、
//      1 か所ずつ値・時機・回数と確かめ方を記録させる（利用者に見える反応が無いので反応の欄には現れない）。
//      画面ごとの状態表示（空データ・取得の失敗・読み込み中・トースト・ダイアログ）も数える。候補ごとに ある／ない を現行で測らせ、
//      要求に結び付く候補（取得の失敗・読み込み中）の「ない」は要求の横取りで試した記録か、要求が無いことの記録でだけ通す。
//      送る操作ごとの「送っている間にもう一度押す」（resubmit）も数える。応答を保留して押し直し、送った回数・確認の回数・覆いを測らせ、
//      表への書き込みを持つ操作は書き込みの回数とも突き合わせる（1 回押した後の反応や押している最中の見た目には現れない）。
//   3. feedback_calls.declared: true なら、移行元ソースを設定のパターンで走査して呼び出し箇所を列挙し、
//      網羅表の call_sites と集合で突き合わせる（記録忘れ・記録だけ残った箇所・反応へ対応付かない箇所を落とす）。
//      side_effect_writes.declared: true なら、表に書いた書き込みのパターンで同じく走査して sites と突き合わせる。
//   4. 表の全ての covered_by を --tests（playwright test --list --reporter=json の出力）のテストへ解決し、
//      1 本のテストを 2 行以上が名乗るなら全行に根拠（shared_assertion_reason）を要求する。あわせて、covered_by の assertion が
//      期待値まで届いているかを実装役と別の subagent が 1 行ずつ監査した記録（assertion_audit）が今の表に対してあるかを数える。
//      欄の検査は空でない文字列かまでしか見ないので、欄の検査だけでは、浅い assertion を名乗っても緑になる。監査の入力は --audit-sheet が出す。
//      監査の記録は表の指紋に加えて covered_by のスペックファイルの中身の指紋を持ち、監査の後に assertion を弱めたら落とす（--recorded も一覧を読んで指紋を計算し直す）。
//   5. --write なら照合結果を conformance として網羅表へ書き戻す（表の指紋付き）。
//   --recorded: 移行元ソースを走査せず、表の検査に加えて conformance.ok と表の指紋の一致を要求する（テスト一覧〈--tests〉は要る）。
//   parity-diff の実行環境に移行元ソースがあるとは限らないためである。表を後から書き換えたら、指紋の不一致で落ちる。
//
// 何をしないか: 反応の観測（出るまで待つ・消えるまで測る）はスイートと採取の仕事で、ここでは記録を検査するだけ。
//
// 行が無い・欄が空・型の誤り・重複 id・走査対象 0 件・呼び出し箇所 0 件の免除なしは、合格として扱わない。
// 後方互換: reaction_coverage をキーごと持たない旧成果物は判定しない（judged: false。理由を出力に残す）。
//
// 決定論的: 乱数・現在時刻に依存しない（--write の conformance にも時刻を入れない）。
// TypeScript 構文は使わない（型は JSDoc）。

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { isArray } from "./lib/is-array.mjs";

import { pageForUrl, pageKey, resolvePages } from "./page-identity.mjs";
import { isCliEntry } from "./lib/cli.mjs";
import { fileIo } from "./lib/file-io.mjs";
import { errorMessage } from "./lib/errors.mjs";
import { parseFlags } from "./lib/flags.mjs";
import {
  isInteger,
  isPlaceholder,
  isPlainObject,
  nonEmptyString,
  nonNegativeNumber,
  positiveNumber,
} from "./lib/guards.mjs";
import { canonicalize } from "./lib/json.mjs";

/**
 * ツールのバージョン（原本）。判定ロジック・出力形状を変えたら上げる。
 * conformance.tool_version と一致しない記録は --recorded で落ちる。
 * @type {string}
 */
export const VERSION = "9";

/**
 * 撮る状態を指す 1 行（使い回しの照合の単位）。
 * source は出どころの表（reactions ＝ 反応の網羅表、coverage ＝ 部品網羅表の visual_state_coverage）、page は名乗ったページ名。
 * @typedef {{ opId: string | null, label: string, shared: boolean, source: "reactions" | "coverage", page: string | null }} CaptureUse
 */

/** 反応の種類。none / unmeasured も「欄を埋めた」記録として明示させる（空欄を許さない）。 */
const REACTION_KINDS = ["observed", "none", "unmeasured"];

/**
 * 文書のオリジンが対象 URL（targets[].url）のオリジンと同じか。
 * 値そのもの（ホスト・ポート）は書かせない。url_command の target は URL を成果物に残さない規約なので、関係だけを記録する。
 */
const ORIGIN_RELATIONS = ["same-origin", "cross-origin"];

/** observed の消え方。auto は消えるまでの時間の標本を要求する。 */
const DISMISSAL_MODES = ["auto", "manual", "persistent", "not-applicable"];

/** layout の矩形 1 つが持つ数値の軸。 */
const RECT_AXES = ["x", "y", "width", "height"];

/** 送る前の判定の種類。 */
const PRE_SEND_KINDS = [
  "count-limit",
  "length-limit",
  "size-limit",
  "required",
  "format",
  "range",
  "other",
];

/** 境界のどちら側を測ったか。inside ＝ 判定を通る側（上限ちょうど・形式の内側）、outside ＝ 止まる側（1 つ超え・形式の外側）。 */
const BOUNDARY_SIDES = ["inside", "outside"];

/** 表への書き込みが実行される処理の流れ。例外処理の中の書き込みは通常の操作では起きないので、分けて数える。 */
const WRITE_PATHS = ["normal", "exception"];

/** 表への書き込みの確かめ方。source-only は移行元で起こせない書き込み（例外時等）を読解だけで記録したもの。 */
const WRITE_VERIFICATIONS = ["assertion", "source-only"];

/**
 * 画面ごとに ある／ない を振り分ける状態表示の候補。
 * 操作が返すトースト・ダイアログは反応の欄が測るが、画面の状態（0 件・取得の失敗・読み込み中）に出るものは操作の反応に現れない。
 */
const STATE_DISPLAY_CANDIDATES = ["empty", "fetch-error", "loading", "toast", "dialog"];

/** 状態表示の候補の振り分け。unmeasured は理由付きでも未測定として数える。 */
const STATE_DISPLAY_STATUSES = ["present", "absent", "unmeasured"];

/**
 * 状態表示を作った（作ろうとした）手段。route-* は要求の横取り（Playwright の page.route で abort / fulfill / 応答の保留）。
 * no-request は画面がその状態に結び付く要求を送らないこと、not-applicable は画面がその状態を持つコンテナを持たないことの記録。
 */
const STATE_SETUP_METHODS = [
  "data",
  "ui",
  "route-abort",
  "route-fulfill",
  "route-delay",
  "no-request",
  "not-applicable",
];

/** 要求の横取り。request（横取りした要求）を要求する。 */
const INTERCEPT_METHODS = ["route-abort", "route-fulfill", "route-delay"];

/**
 * 候補ごとに absent（ない）を名乗れる手段。取得の失敗と読み込み中は、移行元で「起こせない」と書かれやすいが
 * 要求の横取りで起こせる。横取りで試した記録か、要求が無いことの記録が無い「ない」は通さない。
 * @type {Record<string, string[]>}
 */
const ABSENT_METHODS = {
  empty: ["data", "ui", "route-fulfill", "not-applicable"],
  "fetch-error": ["route-abort", "route-fulfill", "no-request"],
  loading: ["route-delay", "no-request"],
  toast: ["data", "ui", "route-abort", "route-fulfill", "route-delay", "not-applicable"],
  dialog: ["data", "ui", "route-abort", "route-fulfill", "route-delay", "not-applicable"],
};

/** absent の記録のうち、不在を確かめる assertion を置けないもの（状態を作る要求・コンテナがそもそも無い）。 */
const ABSENT_WITHOUT_ASSERTION = ["no-request", "not-applicable"];

/** 走査で辿らないディレクトリ名。 */
const SKIP_DIRS = new Set([".git", "node_modules"]);

/**
 * 集合が値を持つか（Set#has と同じ照合。値の型を絞る前の値をそのまま照合に使う）。
 * @param {ReadonlySet<unknown>} set
 * @param {unknown} v
 * @returns {boolean}
 */
function setHas(set, v) {
  return set.has(v);
}

/**
 * 配列が値を含むか（Array#includes と同じ照合。値の型を絞る前の値をそのまま照合に使う）。
 * @param {readonly unknown[]} list
 * @param {unknown} v
 * @returns {boolean}
 */
function listIncludes(list, v) {
  return list.includes(v);
}

/** 使い方の誤り・型崩れ（exit 2）。 */
export class UsageError extends Error {}

/**
 * 画面駆動の機能に declared: false を認めなくした手順の改訂（parity-suite の assets/procedure-revisions.json の revision）。
 * これより前の成果物の declared: false は、状態表示を振り分ける前の旧手順として判定しない（当て直すかは replace-strategy の台帳で決める）。
 */
export const OPERATIONLESS_TABLE_REVISION = 4;

/**
 * 成果物の run.procedure_revision を読む。キーが無いのは改訂番号の導入前なので 0（replace-strategy の procedure-staleness-check.mjs と同じ読み方）。
 * @param {Record<string, unknown>} metadata
 * @returns {number}
 */
function procedureRevisionOf(metadata) {
  if (!Object.hasOwn(metadata, "run")) return 0;
  // run が在るのに読めない形なら、改訂番号の導入前として扱わない（型の誤りの procedure_revision を落とすのと揃える）
  if (!isPlainObject(metadata.run)) throw new UsageError("run がオブジェクトでない");
  const run = metadata.run;
  if (!Object.hasOwn(run, "procedure_revision")) return 0;
  const rev = run.procedure_revision;
  if (typeof rev !== "number" || !Number.isInteger(rev) || rev < 0) {
    throw new UsageError("run.procedure_revision が 0 以上の整数でない");
  }
  return rev;
}

/**
 * 画面駆動の機能で、成果物に残った操作の痕跡を返す（コンテナの棚卸し・部品網羅表の宣言。withStates なら default 以外の撮影状態も）。
 * 操作の無い表（operations: []）では撮影状態を痕跡に数えない。状態表示（0 件・取得の失敗）も撮る状態になるためである。
 * @param {Record<string, unknown>} metadata
 * @param {{ withStates: boolean }} opts
 * @returns {string[]}
 */
export function operationTraces(metadata, { withStates }) {
  const cc = isPlainObject(metadata.capture_conditions) ? metadata.capture_conditions : {};
  /** @type {string[]} */
  const traces = [];
  if (withStates && isArray(cc.states) && cc.states.some((st) => st !== "default")) {
    traces.push("capture_conditions.states に default 以外の状態がある");
  }
  if (isArray(cc.popup_inventory) && cc.popup_inventory.length > 0) {
    traces.push("capture_conditions.popup_inventory が空でない");
  }
  if (isPlainObject(metadata.component_coverage) && metadata.component_coverage.declared === true) {
    traces.push("component_coverage.declared が true");
  }
  return traces;
}

/**
 * metadata.json の reaction_coverage 宣言を読む。
 * @param {unknown} metadata
 * @returns {{ judged: false, reason: string } | { judged: true, path: string }}
 */
export function readDeclaration(metadata) {
  if (!isPlainObject(metadata)) throw new UsageError("metadata.json がオブジェクトでない");
  if (!Object.hasOwn(metadata, "reaction_coverage")) {
    return {
      judged: false,
      reason: "metadata.json に reaction_coverage が無い旧成果物（反応の網羅を導入する前の採取）",
    };
  }
  const decl = metadata.reaction_coverage;
  if (!isPlainObject(decl)) throw new UsageError("reaction_coverage がオブジェクトでない");
  if (typeof decl.declared !== "boolean")
    throw new UsageError("reaction_coverage.declared が真偽値でない");
  if (decl.declared === false) {
    if (!nonEmptyString(decl.reason)) {
      throw new UsageError(
        "reaction_coverage.declared: false なのに reason が空（免除の根拠が残らない）",
      );
    }
    // 画面を持たない api-resource / batch だけが表を作らずに通れる
    if (metadata.mode === "api-resource" || metadata.mode === "batch") {
      return { judged: false, reason: decl.reason };
    }
    // 画面駆動の機能（mode が無い・語彙外も含める）は、操作を持たなくても状態表示（0 件・取得の失敗・読み込み中）を持ちうる。
    // declared: false で表ごと省くと振り分けを一度も測らずに完了・収束するので、operations: [] の表を作らせる
    const revision = procedureRevisionOf(metadata);
    if (revision >= OPERATIONLESS_TABLE_REVISION) {
      throw new UsageError(
        "画面駆動の機能は reaction_coverage.declared: false を使えない（操作を持たない機能も、operations: [] と operations_none_reason を書いた反応の網羅表で画面ごとの状態表示を振り分け、declared: true と path を書く）",
      );
    }
    // 改訂より前の成果物。免除は「操作を持たない機能」だけで、理由の文字列だけで通すと操作のある機能が反応の判定を飛ばして収束する。
    // 成果物に操作の痕跡（default 以外の撮影状態・コンテナの棚卸し・部品網羅表の宣言）があれば矛盾として落とす
    const traces = operationTraces(metadata, { withStates: true });
    if (traces.length > 0) {
      throw new UsageError(
        `reaction_coverage.declared: false は操作を持たない機能だけに使えるが、操作の痕跡がある（${traces.join(" / ")}）`,
      );
    }
    return {
      judged: false,
      reason: `${decl.reason}（手順の改訂 ${OPERATIONLESS_TABLE_REVISION} より前〈run.procedure_revision: ${revision}〉の成果物で、画面ごとの状態表示を振り分けていない）`,
    };
  }
  if (!nonEmptyString(decl.path))
    throw new UsageError("reaction_coverage.path が空でない文字列でない");
  return { judged: true, path: decl.path };
}

/**
 * 走査で見つけた箇所（ファイル・行・列・パターン id の組）の照合キー。
 * 区切り文字の連結はファイル名・パターン id に ":" があると別の箇所が同じキーに潰れるため、組を JSON で符号化する。
 * @param {Record<string, unknown>} s
 * @returns {string}
 */
function siteKeyOf(s) {
  return JSON.stringify([s.file, s.line, s.column, s.pattern]);
}

/**
 * 表の指紋。conformance と assertion_audit を除いた内容をキー順に正規化して sha256 を取る。
 * @param {Record<string, unknown>} table
 * @returns {string}
 */
export function tableFingerprint(table) {
  // 監査の記録（assertion_audit）は表の指紋をコピーして持つ側なので、指紋の外に置く（入れると記録するたびに指紋が変わり一致しない）
  const { conformance: _ignored, assertion_audit: _audit, ...rest } = table;
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(rest)))
    .digest("hex");
}

/** covered_by の名前でテストを指すときの区切り（Playwright の一覧表示と同じ）。 */
const TITLE_SEPARATOR = " › ";

/** covered_by のテストを実行しなければならない Playwright の projects 名（locator-mapping.md で確定した取り決め）。 */
const REQUIRED_PROJECTS = ["current", "new"];

/** 監査の判定の語彙。short（期待値に届いていない部分がある）は未解消として落ちる。 */
const AUDIT_VERDICTS = ["reaches", "short"];

/** @param {unknown} v @returns {v is number & { readonly __positiveInteger: true }} */
const positiveInteger = (v) => typeof v === "number" && Number.isInteger(v) && v >= 1;

/** 位置の文字列で . の後にそのまま書けるキー（区切りを含まない）。それ以外は $["…"] で書く。 */
const SAFE_KEY = /^[A-Za-z_$][A-Za-z0-9_$-]*$/;

/** 表を歩くときに covered_by の持ち主として数えない最上位のキー（記録側の欄）。 */
const NON_TABLE_KEYS = new Set(["conformance", "assertion_audit"]);

/**
 * 表の中で covered_by を持つオブジェクト（持ち主）を全て列挙する。欄の位置を決め打ちせず表全体を歩く。
 * 欄を足すたびに列挙を足す形にすると、足し忘れた欄の covered_by が解決・共有・監査のどれにも入らない。
 * path は JSON の位置（例: $.operations[0].reactions[1]）で、監査の記録（assertion_audit.entries[].path）の突き合わせに使う。
 * @param {Record<string, unknown>} table
 * @returns {{ path: string, owner: Record<string, unknown>, names: string[], ancestors: { path: string, obj: Record<string, unknown> }[] }[]}
 */
export function coveredByOwners(table) {
  return scanCoveredBy(table).owners;
}

/**
 * coveredByOwners の走査本体。形の不正な covered_by（配列でない・空文字や文字列以外の要素を持つ）の位置も返す。
 * 欄の位置を列挙しない走査なので、未知の欄で形が不正だと、解決・共有・監査のどれにも入らず警告なしに消える。
 * 空配列と null は「名乗らない」として通す（撮る状態だけで押さえる行・source-only の書き込み等）。
 * @param {unknown} table - 表（オブジェクトでなくても走査だけはする。表の形は、通常の判定では checkReactions が、`--audit-sheet` では main が落とす）
 */
function scanCoveredBy(table) {
  /** @type {{ path: string, owner: Record<string, unknown>, names: string[], ancestors: { path: string, obj: Record<string, unknown> }[] }[]} */
  const found = [];
  /** @type {string[]} */
  const malformed = [];
  /** @param {unknown} v @param {string} path @param {{ path: string, obj: Record<string, unknown> }[]} chain 外側から並べた祖先（表そのものを除く） */
  const walk = (v, path, chain) => {
    if (isArray(v)) {
      v.forEach((x, i) => walk(x, `${path}[${i}]`, chain));
      return;
    }
    if (!isPlainObject(v)) return;
    recordCoveredBy(v, { path, chain }, { found, malformed });
    for (const k of Object.keys(v)) {
      // _note 等の注記（文字列）だけを飛ばす。_ で始まるキーの下の行は数える
      if (k === "covered_by" || (k.startsWith("_") && typeof v[k] === "string")) continue;
      if (path === "$" && NON_TABLE_KEYS.has(k)) continue;
      // 区切り（. [ ] 等）を含みうるキーは JSON 文字列の添字で書く。字面を連結すると "a.b" と a.b が同じ位置になり、
      // 監査の記録 1 件が別々の 2 行を満たす
      walk(
        v[k],
        SAFE_KEY.test(k) ? `${path}.${k}` : `${path}[${JSON.stringify(k)}]`,
        path === "$" ? chain : [...chain, { path, obj: v }],
      );
    }
  };
  walk(table, "$", []);
  return { owners: found, malformed };
}

/**
 * 走査中のオブジェクト 1 つの covered_by を、形が正しければ found に、不正なら malformed に足す。空配列と null は足さない。
 * @param {Record<string, unknown>} v
 * @param {{ path: string, chain: { path: string, obj: Record<string, unknown> }[] }} at - v の位置と、外側から並べた祖先
 * @param {{ found: { path: string, owner: Record<string, unknown>, names: string[], ancestors: { path: string, obj: Record<string, unknown> }[] }[], malformed: string[] }} out
 */
function recordCoveredBy(v, { path, chain }, { found, malformed }) {
  if (!Object.hasOwn(v, "covered_by") || v.covered_by === null) return;
  if (!isArray(v.covered_by) || !v.covered_by.every(nonEmptyString)) malformed.push(path);
  else if (v.covered_by.length > 0) {
    found.push({ path, owner: v, names: v.covered_by, ancestors: chain });
  }
}

/**
 * `playwright test --list --reporter=json` の出力から、covered_by に書く名前 → テストの索引を作る。
 * 名前は「スペックのパス › describe の題 › テストの題」（パスは JSON の file そのまま＝Playwright の rootDir からの相対）。
 * 同じ名前に別のテストが 2 つ以上当たるもの（題に区切りを含む等）は曖昧として記録し、解決に使わせない。
 * 形式の出典は、https://playwright.dev/docs/test-reporters#json-reporter と、@playwright/test 1.64.1 の --list の実測である。
 * spec は projects ごとに別の要素で並び、ファイル自体の suite は題がファイルパスになる。題の空の describe は、一覧表示でも題に入らない。
 * test.skip / test.fixme は tests[].expectedStatus: skipped で残る。本文の中で条件付きに飛ばす test.skip(cond) と、
 * test.fail(title, fn) は、1.64.1 の --list では expectedStatus: passed のままで区別できない。
 * @param {unknown} report
 * @returns {Map<string, { keys: Set<string>, projects: Set<string>, file: string, line: number | null }>}
 */
export function indexTestList(report) {
  const suites = testListSuites(report);
  /** @type {TestIndex} */
  const index = new Map();
  /** @param {unknown} suite @param {string[]} titles @param {boolean} top */
  const walk = (suite, titles, top) => {
    if (!isPlainObject(suite)) throw new UsageError("--tests の suites に不正な要素がある");
    // ファイル自体の suite の題はファイルパスなので題の列に入れない。空の題の describe も入れない（一覧表示と同じ）
    const here = top || !nonEmptyString(suite.title) ? titles : [...titles, suite.title];
    for (const spec of isArray(suite.specs) ? suite.specs : []) indexSpec(index, spec, here);
    for (const child of isArray(suite.suites) ? suite.suites : []) walk(child, here, false);
  };
  for (const s of suites) walk(s, [], true);
  if (index.size === 0) {
    throw new UsageError(
      "--tests の一覧にテストが 1 件も無い（一覧の取得が空のまま照合を通さない）",
    );
  }
  return index;
}

/**
 * covered_by に書く名前 → テストの索引（indexTestList が作る）。
 * @typedef {Map<string, { keys: Set<string>, projects: Set<string>, file: string, line: number | null }>} TestIndex
 */

/**
 * `playwright test --list --reporter=json` の出力の形を確かめ、最上位の suites を返す。
 * @param {unknown} report
 * @returns {unknown[]}
 */
function testListSuites(report) {
  if (!isPlainObject(report) || !isArray(report.suites)) {
    throw new UsageError(
      "--tests が playwright test --list --reporter=json の出力でない（suites が無い）",
    );
  }
  if (!isArray(report.errors)) {
    throw new UsageError("--tests の errors が配列でない（一覧の取得が成功したか確かめられない）");
  }
  if (report.errors.length > 0) {
    // 読み込みに失敗したスペックのテストは一覧から警告なしに消えるので、解決できない名前と区別が付かない
    throw new UsageError(
      `--tests の一覧に読み込みエラーが ${report.errors.length} 件ある（スペックを直して一覧を作り直す）`,
    );
  }
  return report.suites;
}

/**
 * 一覧の spec 1 つを索引に足す。
 * @param {TestIndex} index
 * @param {unknown} spec
 * @param {string[]} here - spec を囲む describe の題の列
 */
function indexSpec(index, spec, here) {
  if (!isPlainObject(spec) || !nonEmptyString(spec.file) || typeof spec.title !== "string") {
    throw new UsageError("--tests の specs に file / title の無い要素がある");
  }
  // 位置はテストの同定に使う。欠けを null で埋めると、位置の無い同じ題の別のテストが 1 本に畳まれる（
  // Playwright の一覧は常に 1 始まりの line / column を持つので、欠けは作り変えた一覧として落とす）
  if (!positiveInteger(spec.line) || !positiveInteger(spec.column)) {
    throw new UsageError(
      `--tests の spec「${spec.file} ${spec.title}」に line / column（1 以上の整数）が無い（一覧を作り変えずに渡す）`,
    );
  }
  const path = [...here, spec.title];
  const name = [spec.file, ...path].join(TITLE_SEPARATOR);
  // 同じテストの project ごとのコピーだけを 1 本に畳む。位置（行・列）も同定に入れ、同じ題の別のテストは曖昧として残す
  // （Playwright は同じ題を読み込みエラーにするが、一覧を手で作り変えた入力でも別のテストの project を合算しない）
  const key = JSON.stringify([spec.file, spec.line, spec.column, ...path]);
  const entry = index.get(name) ?? {
    keys: new Set(),
    projects: new Set(),
    file: spec.file,
    line: typeof spec.line === "number" ? spec.line : null,
  };
  entry.keys.add(key);
  for (const t of isArray(spec.tests) ? spec.tests : []) {
    // 実行して通ることを期待する（expectedStatus: passed）project だけを数える。静的に飛ばす test.skip / test.fixme は skipped で残る。
    // 失敗を期待する形（failed）や欠けた値も、その project で assertion が通ることを示さない
    if (isPlainObject(t) && nonEmptyString(t.projectName) && t.expectedStatus === "passed") {
      entry.projects.add(t.projectName);
    }
  }
  index.set(name, entry);
}

/**
 * covered_by を検査する。
 * - 解決: 名前が一覧のテストへ 1 つだけ解決し、current / new の両プロジェクトで実行されること（testIndex があるときだけ）
 * - 共有: 1 本のテストを 2 つ以上の持ち主が名乗るなら、全ての持ち主に shared_assertion_reason を要求する
 *   （1 本の assertion が持ち主ごとの期待値を全て確かめている保証は無いので、同じテストで足りる根拠を書かせる）
 * @param {ReturnType<typeof coveredByOwners>} owners
 * @param {ReturnType<typeof indexTestList> | null} testIndex
 * @returns {{ problems: string[], resolved: boolean }}
 */
export function coveredByProblems(owners, testIndex) {
  /** @type {string[]} */
  const problems = [];
  /** @type {Map<string, string[]>} 名前 → 名乗った持ち主の位置 */
  const uses = new Map();
  let resolvable = 0;
  for (const { path, names } of owners) {
    if (new Set(names).size !== names.length) {
      problems.push(`${path}.covered_by: 同じ名前が 2 回ある`);
    }
    for (const name of new Set(names)) {
      uses.set(name, [...(uses.get(name) ?? []), path]);
      if (testIndex === null) continue;
      const problem = resolutionProblem(path, name, testIndex);
      if (problem === null) resolvable += 1;
      else problems.push(problem);
    }
  }
  problems.push(...sharedTestProblems(uses, owners));
  const total = owners.reduce((n, o) => n + new Set(o.names).size, 0);
  return {
    problems,
    resolved: testIndex !== null && resolvable === total && problems.length === 0,
  };
}

/**
 * covered_by の名前 1 つが一覧のテストへ 1 つだけ解決し、current / new の両プロジェクトで実行されるかを確かめる。
 * @param {string} path - 持ち主の位置
 * @param {string} name
 * @param {TestIndex} testIndex
 * @returns {string | null} 解決できれば null
 */
function resolutionProblem(path, name, testIndex) {
  const hit = testIndex.get(name);
  if (hit === undefined) {
    return `${path}.covered_by: "${name}" が --tests の一覧のどのテストにも解決しない（名前は「スペックのパス${TITLE_SEPARATOR}describe の題${TITLE_SEPARATOR}テストの題」。--audit-sheet の出力か一覧からコピーする）`;
  } else if (hit.keys.size > 1) {
    return `${path}.covered_by: "${name}" が ${hit.keys.size} 本のテストに当たり曖昧（題を変えて 1 本に決まる名前にする）`;
  }
  const absentIn = REQUIRED_PROJECTS.filter((p) => !hit.projects.has(p));
  if (absentIn.length === 0) return null;
  return `${path}.covered_by: "${name}" が ${absentIn.join(" / ")} プロジェクトで実行されない（現側専用・新側専用のスペックや、その側で静的に飛ばす test.skip / test.fixme は両側の合否を押さえない）`;
}

/**
 * 1 本のテストを 2 つ以上の持ち主が名乗るなら、全ての持ち主に shared_assertion_reason を要求する。
 * @param {Map<string, string[]>} uses - 名前 → 名乗った持ち主の位置
 * @param {ReturnType<typeof coveredByOwners>} owners
 * @returns {string[]}
 */
function sharedTestProblems(uses, owners) {
  /** @type {string[]} */
  const problems = [];
  for (const [name, paths] of uses) {
    if (paths.length < 2) continue;
    const lacking = paths.filter((p) => {
      const o = owners.find((x) => x.path === p);
      return !o || !filled(o.owner.shared_assertion_reason);
    });
    if (lacking.length > 0) {
      problems.push(
        `テスト "${name}" を ${paths.join(" / ")} が covered_by に名乗っている（1 本で各行の期待値を全て確かめている根拠を全行の shared_assertion_reason に書くか、行ごとにテストを分ける。根拠が空: ${lacking.join(" / ")}）`,
      );
    }
  }
  return problems;
}

/**
 * assertion の深さの監査の記録（assertion_audit）を検査する。
 * 監査そのもの（期待値のどこを確かめていないか）は実装役と別の subagent が行い、ここでは「全ての持ち主を 1 件ずつ当てた記録が、
 * 今の表に対して残っているか」だけを数える。記録の指紋が表と違えば、監査の後に期待値か covered_by が変わっている。
 * @param {unknown} audit
 * @param {ReturnType<typeof coveredByOwners>} owners
 * @param {{ fingerprint: string, specs?: string | null }} current - fingerprint は今の表の指紋。
 *   specs は今のスペックの指紋（取り直せなかったら null。そのときは照合できないことを落とす側が別に積む）
 * @returns {string[]}
 */
export function assertionAuditProblems(audit, owners, { fingerprint, specs = null }) {
  if (owners.length === 0) return [];
  if (!isPlainObject(audit)) {
    return [
      "assertion_audit が無い（covered_by の assertion が期待値まで届いているかを、実装役と別の subagent に 1 件ずつ監査させて記録する）",
    ];
  }
  const problems = auditHeaderProblems(audit, fingerprint, specs);
  if (!isArray(audit.entries)) {
    problems.push("assertion_audit.entries が配列でない");
    return problems;
  }
  problems.push(...auditEntryProblems(audit.entries, owners));
  return problems;
}

/**
 * 監査の記録の、監査した人と指紋の欠けを返す。
 * @param {Record<string, unknown>} audit
 * @param {string} fingerprint - 今の表の指紋
 * @param {string | null} specs - 今のスペックの指紋
 * @returns {string[]}
 */
function auditHeaderProblems(audit, fingerprint, specs) {
  /** @type {string[]} */
  const problems = [];
  if (!filled(audit.auditor)) {
    problems.push(
      "assertion_audit.auditor が空かテンプレートの説明文のまま（誰が監査したか〈実装役と別の subagent〉を書く）",
    );
  }
  if (audit.table_fingerprint !== fingerprint) {
    problems.push(
      "assertion_audit.table_fingerprint が表の内容と一致しない（監査の後に期待値か covered_by が変わった。--audit-sheet から監査し直す）",
    );
  }
  if (!nonEmptyString(audit.specs_fingerprint)) {
    problems.push(
      "assertion_audit.specs_fingerprint が空（監査したときのスペックの中身を --audit-sheet の出力から転記する）",
    );
  } else if (specs !== null && audit.specs_fingerprint !== specs) {
    problems.push(
      "assertion_audit.specs_fingerprint が今のスペックの中身と一致しない（監査の後に covered_by のスペックを書き換えた。assertion を弱めていないかを --audit-sheet から監査し直す）",
    );
  }
  return problems;
}

/**
 * 監査の記録の entries を、covered_by の持ち主と 1 件ずつ突き合わせる。
 * @param {unknown[]} entries
 * @param {ReturnType<typeof coveredByOwners>} owners
 * @returns {string[]}
 */
function auditEntryProblems(entries, owners) {
  /** @type {string[]} */
  const problems = [];
  const expected = new Set(owners.map((o) => o.path));
  const seen = new Set();
  entries.forEach((e, i) => {
    const at = `assertion_audit.entries[${i}]`;
    if (!isPlainObject(e) || !nonEmptyString(e.path)) {
      problems.push(`${at}: path が空`);
      return;
    }
    if (seen.has(e.path)) problems.push(`${at}: ${e.path} が 2 回ある`);
    seen.add(e.path);
    if (!expected.has(e.path)) {
      problems.push(`${at}: ${e.path} は covered_by を持つ行でない（表と監査の記録がずれている）`);
    }
    const verdict = auditVerdictProblem(e, at);
    if (verdict !== null) problems.push(verdict);
  });
  const lacking = [...expected].filter((p) => !seen.has(p));
  if (lacking.length > 0) {
    problems.push(`assertion_audit.entries に監査していない行がある: ${lacking.join(", ")}`);
  }
  return problems;
}

/**
 * 監査の記録 1 件の判定（verdict）の欠けを返す（無ければ null）。
 * @param {Record<string, unknown>} e
 * @param {string} at - 記録の位置
 * @returns {string | null}
 */
function auditVerdictProblem(e, at) {
  if (!listIncludes(AUDIT_VERDICTS, e.verdict)) {
    return `${at}: verdict が ${AUDIT_VERDICTS.join(" / ")} でない`;
  } else if (e.verdict === "short") {
    return `${at}: ${String(e.path)} の assertion が期待値に届いていない（${nonEmptyString(e.missing) ? e.missing : "届いていない部分が空"}）。assertion を深くして監査し直すか、測れないなら表の側を未測定にする`;
  } else if (!filled(e.checked)) {
    return `${at}: verdict: reaches なのに checked が空かテンプレートの説明文のまま（期待値のどの部分をどの assertion が確かめているかを書く）`;
  }
  return null;
}

/**
 * covered_by が名指ししたスペックファイルの中身の指紋。
 * 監査の記録は表の指紋だけだと、監査の後にスペックの assertion を弱めても（toHaveText を toBeVisible に置き換える等）表を触らない限り通る。
 * 監査したときのスペックの中身を指紋で結び、--write・--recorded で計算し直して照合する。
 * 範囲は covered_by が名指ししたスペックファイルだけである。マッピング層・期待値解決層は新側の実装で正規に変わるので含めない
 * （その層へ assertion を逃がした分は射程外。coverage.md に書く）。
 * @param {ReturnType<typeof coveredByOwners>} owners
 * @param {ReturnType<typeof indexTestList>} testIndex
 * @param {{ rootDir: string, readFile: (p: string) => string }} source - rootDir は一覧の config.rootDir（スペックのパスの起点）
 * @returns {{ fingerprint: string | null, problems: string[] }}
 */
export function specsFingerprint(owners, testIndex, { rootDir, readFile }) {
  /** @type {Set<string>} */
  const files = new Set();
  for (const o of owners) {
    for (const name of o.names) {
      const hit = testIndex.get(name);
      if (hit !== undefined) files.add(hit.file);
    }
  }
  if (files.size === 0) return { fingerprint: null, problems: [] };
  /** @type {string[]} */
  const problems = [];
  /** @type {[string, string][]} */
  const contents = [];
  for (const file of [...files].sort()) {
    try {
      contents.push([file, readFile(resolve(rootDir, file))]);
    } catch (e) {
      problems.push(
        `スペック ${file} を一覧の rootDir（${rootDir}）から読めない（${errorMessage(e)}）`,
      );
    }
  }
  if (problems.length > 0) return { fingerprint: null, problems };
  return {
    fingerprint: createHash("sha256").update(JSON.stringify(contents)).digest("hex"),
    problems,
  };
}

/**
 * 監査用の入力（期待値とテストの所在）を作る。監査役の subagent には、これとテストのソースの 2 つだけを渡す。
 * expected は持ち主の欄から covered_by と共有の根拠を除いたもの（期待値そのもの）。
 * context は持ち主を含む祖先（外側から。表そのものは除く）の位置と値の欄である。例えば、操作の id / trigger、送る前の判定の項目の
 * id / kind / condition、状態表示の画面名など。欄だけを渡すと、似た期待値を持つ別の操作・別の判定のテストでも
 * 「届いている」と判定されうる（祖先を 1 段ずつ足すと段の数だけ抜けるので、全ての祖先を載せる）。
 * @param {ReturnType<typeof coveredByOwners>} owners
 * @param {ReturnType<typeof indexTestList>} testIndex
 */
export function auditSheet(owners, testIndex) {
  return owners.map(({ path, owner, names, ancestors }) => {
    const { covered_by: _c, shared_assertion_reason: _s, ...expected } = owner;
    return {
      path,
      context: ancestors.map((a) => ({ path: a.path, fields: scalarFields(a.obj) })),
      expected,
      tests: names.map((name) => {
        const hit = testIndex.get(name);
        return { name, file: hit?.file ?? null, line: hit?.line ?? null };
      }),
    };
  });
}

/**
 * 祖先の値の欄（文字列・数値・真偽値・null）だけを取る。入れ子の欄は持ち主の系列か兄弟なので載せない。注記（_ で始まる）も除く。
 * @param {Record<string, unknown>} obj
 * @returns {Record<string, unknown>}
 */
function scalarFields(obj) {
  return Object.fromEntries(
    Object.entries(obj).filter(
      ([k, v]) =>
        !k.startsWith("_") && (v === null || ["string", "number", "boolean"].includes(typeof v)),
    ),
  );
}

/**
 * id の一意性を検査し、使える id の集合を返す（空・重複は problems に積み、集合から外す）。
 * @param {unknown[]} entries
 * @param {string} label
 * @param {string[]} problems
 * @returns {Set<string>}
 */
function collectIds(entries, label, problems) {
  const seen = new Map();
  for (const e of entries) {
    const id = isPlainObject(e) ? e.id : undefined;
    if (!nonEmptyString(id)) {
      problems.push(`${label}: id が空の要素がある`);
      continue;
    }
    if (id.includes("/")) {
      // 反応キー <操作 id>/<反応 id> が別の組と衝突するため索引に入れない
      problems.push(`${label}: id "${id}" が "/" を含む`);
      continue;
    }
    seen.set(id, (seen.get(id) ?? 0) + 1);
  }
  const ok = new Set();
  for (const [id, n] of seen) {
    if (n > 1) problems.push(`${label}: id "${id}" が ${n} 回重複している（先勝ちにしない）`);
    else ok.add(id);
  }
  return ok;
}

/**
 * observed の反応の欠けを返す（無ければ null）。
 * @param {Record<string, unknown>} r
 * @param {Set<string> | null} captureStates - metadata.json の capture_conditions.states（渡されたときだけ照合）
 * @param {Set<string> | null} documents - 表の documents（文書の棚卸し。不正なら null で、表側の問題として別の箇所で不合格になる）
 * @returns {string | null}
 */
function observedProblem(r, captureStates, documents) {
  if (!nonEmptyString(r.description)) return "description が空";
  if (typeof r.visible !== "boolean") return "visible が真偽値でない";
  if (!isArray(r.covered_by) || r.covered_by.length === 0 || !r.covered_by.every(nonEmptyString)) {
    return "covered_by が空（スイートの assertion に落としていない）";
  }
  if (!r.visible) {
    if (!nonEmptyString(r.observation))
      return "visible: false なのに observation（どう確かめたか）が空";
    return null;
  }
  return (
    destinationProblem(r.destination, documents) ??
    appearanceProblem(r.appearance) ??
    dismissalProblem(r.dismissal) ??
    reactionCaptureProblem(r.capture, captureStates)
  );
}

/**
 * observed の反応の出る先（destination）の欠けを返す（無ければ null）。
 * @param {unknown} dest
 * @param {Set<string> | null} documents
 * @returns {string | null}
 */
function destinationProblem(dest, documents) {
  if (!isPlainObject(dest) || !nonEmptyString(dest.document) || !nonEmptyString(dest.locator)) {
    return "destination の document / locator が空（出る先の文書と論理名を記録していない）";
  }
  if (documents && !documents.has(dest.document)) {
    return `destination.document "${dest.document}" が表の documents に無い`;
  }
  return null;
}

/**
 * observed の反応の出方（appearance）の欠けを返す（無ければ null）。
 * @param {unknown} app
 * @returns {string | null}
 */
function appearanceProblem(app) {
  if (!isPlainObject(app) || !positiveNumber(app.wait_limit_ms))
    return "appearance.wait_limit_ms が正の数でない";
  const delays = app.delay_ms_samples;
  if (!isArray(delays) || delays.length === 0 || !delays.every(nonNegativeNumber)) {
    return "appearance.delay_ms_samples が空・非数を含む";
  }
  if (Math.max(...delays) > app.wait_limit_ms)
    return "appearance.delay_ms_samples に wait_limit_ms を超える標本がある";
  return null;
}

/**
 * observed の反応の消え方（dismissal）の欠けを返す（無ければ null）。
 * @param {unknown} dis
 * @returns {string | null}
 */
function dismissalProblem(dis) {
  if (!isPlainObject(dis) || typeof dis.mode !== "string" || !DISMISSAL_MODES.includes(dis.mode)) {
    return `dismissal.mode が語彙（${DISMISSAL_MODES.join(" / ")}）に無い`;
  }
  if (dis.mode === "auto") {
    const d = dis.duration_ms_samples;
    if (!isArray(d) || d.length < 2 || !d.every(positiveNumber)) {
      return "dismissal.mode: auto なのに duration_ms_samples が 2 標本未満・非正数を含む（1 回の観測で消える時間を決めない）";
    }
    if (!nonNegativeNumber(dis.tolerance_ms)) return "dismissal.tolerance_ms が 0 以上の数でない";
    if (dis.tolerance_ms < Math.max(...d) - Math.min(...d)) {
      return "dismissal.tolerance_ms が標本の幅（最大 − 最小）より小さい";
    }
  } else if (!nonEmptyString(dis.evidence)) {
    return `dismissal.mode: ${dis.mode} なのに evidence が空（消えないこと・消え方を確かめた記録が無い）`;
  }
  return null;
}

/**
 * observed の反応を撮るか（capture）の欠けを返す（無ければ null）。
 * @param {unknown} cap
 * @param {Set<string> | null} captureStates
 * @returns {string | null}
 */
function reactionCaptureProblem(cap, captureStates) {
  if (!isPlainObject(cap)) return "capture が無い（撮る／撮らないを決めていない）";
  const hasState = nonEmptyString(cap.state);
  // 同じ状態名の使い回しの照合は checkReactions が全操作を見た後に行う（残る見た目の captured と合わせて数える）
  const hasReason = nonEmptyString(cap.reason);
  if (hasState === hasReason) return "capture は state と reason のどちらか一方だけを埋める";
  if (hasState && captureStates && !setHas(captureStates, cap.state)) {
    return `capture.state "${String(cap.state)}" が capture_conditions.states に無い`;
  }
  return null;
}

/**
 * none の反応の欠けを返す（無ければ null）。
 * @param {Record<string, unknown>} r
 * @param {number | null} windowMs - 表の observation_window_ms
 * @param {Set<string> | null} documents - 表の documents（top と全フレーム）
 * @returns {string | null}
 */
function noneProblem(r, windowMs, documents) {
  const obs = r.observation;
  if (!isPlainObject(obs))
    return "kind: none なのに observation が無い（見ていないと無いを区別できない）";
  if (!positiveNumber(obs.window_ms)) return "observation.window_ms が正の数でない";
  if (windowMs !== null && obs.window_ms < windowMs) {
    return `observation.window_ms が表の observation_window_ms（${windowMs}）より短い`;
  }
  const documentsProblem = observedDocumentsProblem(obs.documents, documents);
  if (documentsProblem !== null) return documentsProblem;
  // 操作した文書。反応の出どころと見た文書のオリジンが違うと、実在する反応が同一オリジンポリシーで届かず、誤って「無い」と判定される（表の document_origins で照合する）
  if (!nonEmptyString(obs.source_document)) {
    return "observation.source_document が空（どの文書で操作したかを記録していない。オリジンの照合に使う）";
  }
  if (documents && !documents.has(obs.source_document)) {
    return `observation.source_document "${obs.source_document}" が表の documents に無い`;
  }
  if (!nonEmptyString(obs.method)) return "observation.method が空";
  // 新側が反応を足しても（遅れて出て消えるトースト等）静止画・特性照合には表れないので、不在もスイートで確かめる
  if (!isArray(r.covered_by) || r.covered_by.length === 0 || !r.covered_by.every(nonEmptyString)) {
    return "kind: none なのに covered_by が空（観測時間・文書にわたる不在をスイートの assertion に落としていない）";
  }
  return null;
}

/**
 * none の反応で、見た文書（observation.documents）が欠けているか表の documents と食い違えば、その理由を返す（無ければ null）。
 * @param {unknown} observed - observation.documents
 * @param {Set<string> | null} documents - 表の documents（top と全フレーム）
 * @returns {string | null}
 */
function observedDocumentsProblem(observed, documents) {
  if (!isArray(observed) || observed.length === 0 || !observed.every(nonEmptyString)) {
    return "observation.documents が空（どの文書を見たか記録していない）";
  }
  // 操作したコンテナ（iframe など）の中だけを見た none は、親文書や別フレームに出る反応を取りこぼす
  if (!observed.some((d) => d === "top"))
    return "observation.documents に top（最上位の文書）が無い";
  if (documents) {
    /** @type {Set<string>} */
    const seen = new Set(observed);
    const missing = [...documents].filter((d) => !seen.has(d));
    if (missing.length > 0) {
      return `observation.documents が表の documents を網羅していない（見ていない文書: ${missing.join(", ")}）`;
    }
    const unknown = observed.filter((d) => !documents.has(d));
    if (unknown.length > 0) {
      return `observation.documents に表の documents に無い文書がある: ${unknown.join(", ")}`;
    }
  }
  return null;
}

/**
 * 頁の組み方の 1 回の測定（操作の前 before、または操作を繰り返した後の samples の 1 件）の欠けを返す（無ければ null）。
 * @param {unknown} m
 * @returns {string | null}
 */
function layoutMeasureProblem(m) {
  if (!isPlainObject(m)) return "オブジェクトでない";
  if (!nonNegativeNumber(m.scroll_height)) return "scroll_height が 0 以上の数でない";
  // 窓に収まるか（scroll_height <= client_height）を読むための分母。スクロールバーを隠す撮影では横幅のずれが矩形に出ないので、はみ出しは高さで見る
  if (!positiveNumber(m.client_height)) return "client_height が正の数でない";
  if (!isPlainObject(m.rects) || Object.keys(m.rects).length === 0) {
    return "rects が空（主な論理名の矩形を測っていない）";
  }
  for (const [name, r] of Object.entries(m.rects)) {
    const problem = rectProblem(name, r);
    if (problem !== null) return problem;
  }
  return null;
}

/**
 * 頁の組み方を 1 回測った記録で、rects の 1 件（論理名と矩形）が欠けていれば、その理由を返す（無ければ null）。
 * @param {string} name - 論理名
 * @param {unknown} r - 矩形
 * @returns {string | null}
 */
function rectProblem(name, r) {
  // 論理名の無い矩形は、どの要素の位置かを名指さないので測った記録にならない
  if (!nonEmptyString(name)) return "rects に空の論理名がある";
  // null は「その時点で表示されない」の記録（操作で現れる要素は操作の前には無い）
  if (r === null) return null;
  if (
    !isPlainObject(r) ||
    !RECT_AXES.every((k) => typeof r[k] === "number" && Number.isFinite(r[k]))
  ) {
    return `rects["${name}"] が { x, y, width, height } の数値でも null でもない`;
  }
  if (
    (typeof r.width === "number" && r.width < 0) ||
    (typeof r.height === "number" && r.height < 0)
  ) {
    return `rects["${name}"] の width / height が負`;
  }
  return null;
}

/**
 * 頁の組み方の 1 回の測定のうち、layoutMeasureProblem が欠けを見つけなかったもの。
 * repeat は layoutMeasureProblem では確かめず、samples の連番の検査で確かめる。
 * @typedef {{ scroll_height: number, client_height: number, rects: Record<string, Record<string, number> | null>, repeat?: unknown }} LayoutMeasure
 */

/**
 * layoutMeasureProblem が欠けを見つけないか（型を絞るための述語）。
 * @param {unknown} m
 * @returns {m is LayoutMeasure & { readonly __isLayoutMeasure: true }}
 */
function isLayoutMeasure(m) {
  return layoutMeasureProblem(m) === null;
}

/**
 * 操作の頁の組み方の変化（layout）の欠けを返す（無ければ null）。
 *
 * 寸法の式（dimension_model）と視覚ベースラインは初期表示の状態しか見ないので、操作で頁の高さや要素の位置が変わる振る舞いは
 * どの比較方法にも入らない。1 回の操作の差分では「窓から書き直す絶対値」と「前の値からの相対」を区別できないため、
 * 変わるなら 2 回以上繰り返した後を測らせる。
 * @param {unknown} layout
 * @returns {{ problem: string | null, unmeasured: boolean }}
 */
function layoutProblem(layout) {
  if (!isPlainObject(layout)) {
    return {
      problem:
        "layout が無い（操作で頁の高さ・要素の位置が変わるかを測っていない。変わらないなら changes: false を確かめ方付きで書く）",
      unmeasured: true,
    };
  }
  const coveredBy = layout.covered_by;
  const covered =
    isArray(coveredBy) &&
    coveredBy.length > 0 &&
    coveredBy.every((c) => nonEmptyString(c) && !isPlaceholder(c));
  if (layout.changes === null) {
    // 測れなかった記録。未測定として数える（空欄と区別するため理由を要求する）
    return {
      problem: `layout: 未測定${nonEmptyString(layout.reason) ? `（${layout.reason}）` : "（reason が空）"}`,
      unmeasured: true,
    };
  }
  if (typeof layout.changes !== "boolean") {
    return { problem: "layout.changes が true / false / null のどれでもない", unmeasured: true };
  }
  if (layout.changes === false) return layoutUnchangedProblem(layout, covered);
  return layoutChangedProblem(layout, covered);
}

/**
 * layout.changes: false の記録の欠けを返す。
 * @param {Record<string, unknown>} layout
 * @param {boolean} covered - covered_by が埋まっているか
 * @returns {{ problem: string | null, unmeasured: boolean }}
 */
function layoutUnchangedProblem(layout, covered) {
  if (!nonEmptyString(layout.evidence) || isPlaceholder(layout.evidence)) {
    return {
      problem:
        "layout.changes: false なのに evidence が空・テンプレートの説明文のまま（操作の前後で頁の高さ・矩形が変わらないことを確かめた記録が無い）",
      unmeasured: true,
    };
  }
  if (!covered) {
    return {
      problem:
        "layout.changes: false なのに covered_by が空（新側が操作で頁の組み方を変えても、静止画・寸法の照合には表れない）",
      unmeasured: true,
    };
  }
  return { problem: null, unmeasured: false };
}

/**
 * layout.changes: true の記録の欠けを返す。
 * @param {Record<string, unknown>} layout
 * @param {boolean} covered - covered_by が埋まっているか
 * @returns {{ problem: string | null, unmeasured: boolean }}
 */
function layoutChangedProblem(layout, covered) {
  const before = layout.before;
  // 欠けの理由は、述語が偽のときだけもう一度求める（同じ検査を 2 つの条件に分けると、片方だけが真のとき理由が null になる）
  if (!isLayoutMeasure(before))
    return { problem: `layout.before: ${layoutMeasureProblem(before)}`, unmeasured: true };
  const { problem, measures } = layoutSamples(layout.samples);
  if (problem !== null) return { problem, unmeasured: true };
  // 測った論理名の集合は前後で揃える（ある回だけ測った要素は、回を跨いだ変わり方を読めない）
  const beforeKeys = keysOf(before);
  if (!measures.every((m) => keysOf(m) === beforeKeys)) {
    return {
      problem:
        "layout の before と samples で測った論理名が揃っていない（表示されない回は null で書く）",
      unmeasured: true,
    };
  }
  if (measures.every((m) => same(m, before))) {
    return {
      problem:
        "layout.changes: true なのに before と全ての samples が同じ（変わらないなら changes: false と確かめ方を書く）",
      unmeasured: false,
    };
  }
  if (!covered) {
    return {
      problem:
        "layout.changes: true なのに covered_by が空（2 回以上繰り返した後の頁の高さ・矩形をスイートの assertion に落としていない）",
      unmeasured: true,
    };
  }
  return { problem: null, unmeasured: false };
}

/**
 * layout.samples（操作を繰り返した後の測定）を読む。欠けがあれば problem に理由を入れる。
 * @param {unknown} samples
 * @returns {{ problem: string | null, measures: LayoutMeasure[] }}
 */
function layoutSamples(samples) {
  if (!isArray(samples) || samples.length < 2) {
    return {
      problem:
        "layout.changes: true なのに samples が 2 回未満（1 回の操作の差分では、窓から書き直す絶対値か前の値からの相対かを区別できない）",
      measures: [],
    };
  }
  /** @type {LayoutMeasure[]} */
  const measures = [];
  for (const [i, m] of samples.entries()) {
    if (!isLayoutMeasure(m))
      return { problem: `layout.samples[${i}]: ${layoutMeasureProblem(m)}`, measures: [] };
    measures.push(m);
  }
  // repeat は 1 から始まる連番（何回目の操作の後か）。欠番・重複は繰り返しの記録として読めない
  const repeats = measures.map((m) => m.repeat);
  if (!repeats.every((r, i) => r === i + 1)) {
    return {
      problem: "layout.samples の repeat が 1 から始まる連番でない（何回目の操作の後かを読めない）",
      measures: [],
    };
  }
  return { problem: null, measures };
}

/** @param {LayoutMeasure} m */
const keysOf = (m) => JSON.stringify(Object.keys(m.rects).sort());

// 矩形は軸の順に正規化して比べる（`{ width, height, x, y }` と `{ x, y, width, height }` を別物にしない）
/** @param {LayoutMeasure} m */
const rectsText = (m) =>
  JSON.stringify(
    Object.keys(m.rects)
      .sort()
      .map((k) => {
        const rect = m.rects[k];
        return [k, rect === null ? null : RECT_AXES.map((ax) => rect[ax])];
      }),
  );

/** @param {LayoutMeasure} a @param {LayoutMeasure} b */
const same = (a, b) =>
  a.scroll_height === b.scroll_height &&
  a.client_height === b.client_height &&
  rectsText(a) === rectsText(b);

/**
 * 値が空でない文字列の配列か（テンプレートの説明文のままの要素を含まない）。
 * @param {unknown} v
 * @returns {boolean}
 */
function filledStrings(v) {
  return isArray(v) && v.length > 0 && v.every((c) => nonEmptyString(c) && !isPlaceholder(c));
}

/**
 * 空でなく、テンプレートの説明文のままでもない文字列か。
 * @param {unknown} v
 * @returns {v is string & { readonly __filled: true }}
 */
function filled(v) {
  return nonEmptyString(v) && !isPlaceholder(v);
}

/**
 * 操作を終えた後に残る見た目（aftermath.look）の欠けを返す。
 *
 * 撮影状態の導出は操作の途中（コンテナを開く・指を乗せるなど）までしか導かないので、終えた後に残る塗り・色・印は
 * 撮る状態にも assertion にも入らず、差は「差 0 件」と同じ見え方になる。見た目ごとに現行で測った値を残させ、
 * 撮る状態か assertion のどちらか（両方でもよい）に割り当てさせる。どちらにもしないなら理由を要求する。
 * @param {unknown} look
 * @param {Set<string> | null} captureStates
 * @returns {{ problem: string, unmeasured: boolean }[]}
 */
function aftermathLookProblems(look, captureStates) {
  if (!isPlainObject(look)) {
    return [
      {
        problem:
          "aftermath.look が無い（押した後に残る見た目〈塗り・色・印・焦点〉を測っていない。残らないなら changes: false を確かめ方付きで書く）",
        unmeasured: true,
      },
    ];
  }
  if (look.changes === null) {
    return [
      {
        problem: `aftermath.look: 未測定${nonEmptyString(look.reason) ? `（${look.reason}）` : "（reason が空）"}`,
        unmeasured: true,
      },
    ];
  }
  if (typeof look.changes !== "boolean") {
    return [
      { problem: "aftermath.look.changes が true / false / null のどれでもない", unmeasured: true },
    ];
  }
  if (look.changes === false) return lookUnchangedProblems(look);
  return lookChangedProblems(look.items, captureStates);
}

/**
 * 欠け 1 件（problem）と、それを未測定に数えるか（unmeasured）。
 * @typedef {{ problem: string, unmeasured: boolean }} Finding
 */

/**
 * aftermath.look.changes: false の記録の欠けを返す。
 * @param {Record<string, unknown>} look
 * @returns {Finding[]}
 */
function lookUnchangedProblems(look) {
  /** @type {Finding[]} */
  const out = [];
  if (!filled(look.evidence)) {
    out.push({
      problem:
        "aftermath.look.changes: false なのに evidence が空・テンプレートの説明文のまま（押した後に見た目が残らないことを確かめた記録が無い）",
      unmeasured: true,
    });
  }
  // 残らないことを確かめた論理名。強度チェックがここへ押した後だけ残る塗りを注入し、不在の assertion が赤くなるかを確かめる
  if (!filledStrings(look.targets)) {
    out.push({
      problem:
        "aftermath.look.changes: false なのに targets（残らないことを確かめた論理名）が空（強度チェックが注入する先が無く、不在の assertion の空振りを検出できない）",
      unmeasured: true,
    });
  }
  // 残らないことも assertion にする。新側が押した後に塗り・焦点の輪を残しても、撮っていない状態は 3 つの比較方法に表れない
  if (!filledStrings(look.covered_by)) {
    out.push({
      problem:
        "aftermath.look.changes: false なのに covered_by が空（押した後に見た目が残らないことをスイートの assertion に落としていない）",
      unmeasured: true,
    });
  }
  if (isArray(look.items) && look.items.length > 0) {
    out.push({
      problem:
        "aftermath.look.changes: false なのに items がある（残らないと残るが同時に成立する）",
      unmeasured: false,
    });
  }
  return out;
}

/**
 * aftermath.look.changes: true の記録（残る見た目の items）の欠けを返す。
 * @param {unknown} items
 * @param {Set<string> | null} captureStates
 * @returns {Finding[]}
 */
function lookChangedProblems(items, captureStates) {
  if (!isArray(items) || items.length === 0) {
    return [
      {
        problem:
          "aftermath.look.changes: true なのに items が空（残る見た目を 1 つずつ列挙していない）",
        unmeasured: true,
      },
    ];
  }
  /** @type {string[]} */
  const idProblems = [];
  const ids = collectIds(items, "aftermath.look.items", idProblems);
  /** @type {Finding[]} */
  const out = idProblems.map((problem) => ({ problem, unmeasured: true }));
  for (const item of items) {
    if (!isPlainObject(item) || !setHas(ids, item.id)) continue;
    const found = lookItemProblem(item, captureStates);
    if (found !== null) out.push(found);
  }
  return out;
}

/**
 * 残る見た目 1 つ（aftermath.look.items の 1 件）の欠けを返す（無ければ null）。
 * @param {Record<string, unknown>} item
 * @param {Set<string> | null} captureStates
 * @returns {Finding | null}
 */
function lookItemProblem(item, captureStates) {
  const at = `aftermath.look.items["${String(item.id)}"]`;
  if (!filled(item.target) || !filled(item.description)) {
    return { problem: `${at}: target（論理名）/ description が空`, unmeasured: true };
  }
  // 現行で 1 度測った値。書かせないと、見た目を思い浮かべただけの列挙と区別が付かない
  if (!filled(item.observed)) {
    return {
      problem: `${at}: observed（現行で測った値〈計算後スタイル・印の文言など〉）が空・テンプレートの説明文のまま`,
      unmeasured: true,
    };
  }
  const hasState = filled(item.captured);
  const hasAssertion = filledStrings(item.covered_by);
  const hasReason = filled(item.reason);
  if (hasReason && (hasState || hasAssertion)) {
    return {
      problem: `${at}: reason と captured / covered_by が両方埋まっている（撮る・押さえると、どちらにもしないが同時に成立する）`,
      unmeasured: false,
    };
  }
  if (!hasState && !hasAssertion && !hasReason) {
    return {
      problem: `${at}: 撮る状態（captured）にも assertion（covered_by）にも割り当てていない（どちらにもしないなら reason を書き、gaps.md に残す）`,
      unmeasured: true,
    };
  }
  if (hasState && captureStates && !setHas(captureStates, item.captured)) {
    return {
      problem: `${at}: captured "${String(item.captured)}" が capture_conditions.states に無い`,
      unmeasured: true,
    };
  }
  return null;
}

/**
 * 押した後に URL の上でも状態の上でもどこへ戻るか（aftermath.returns_to）の欠けを返す。
 *
 * 遷移しないはずの操作が遷移する・戻すはずの状態を戻さない差は、撮った画面の上には現れない。
 * 押す前後の URL と、押す前にデフォルトから変えた状態（probed）のうち、押した後にデフォルトへ戻ったもの（reset）を実測させる。
 * 変えていない状態が戻るかは測れないので、変えずに測った記録は範囲を語れない。
 * URL は成果物にホスト・ポートを残さない規約（url_command の target）に合わせ、オリジンを除いたパスで書かせる。
 * probed が操作ごとの自己申告だと、1 つだけ変えて 1 つだけ確かめた記録が通る。
 * そこで、表で 1 回だけ宣言した画面の状態の棚卸し（screen_states）と突き合わせ、変えなかった状態には理由を要求する。
 * @param {unknown} ret
 * @param {string[] | null} screenStates - 表の screen_states.states（読めなければ null で、表側の問題として別の箇所で不合格になる）
 * @returns {{ problem: string, unmeasured: boolean }[]}
 */
function aftermathReturnsProblems(ret, screenStates) {
  if (!isPlainObject(ret)) {
    return [
      {
        problem:
          "aftermath.returns_to が無い（押した後の遷移先と、押す前に動かした状態のうち戻った範囲を測っていない）",
        unmeasured: true,
      },
    ];
  }
  if (ret.measured === false) {
    return [
      {
        problem: `aftermath.returns_to: 未測定${nonEmptyString(ret.reason) ? `（${ret.reason}）` : "（reason が空）"}`,
        unmeasured: true,
      },
    ];
  }
  if (ret.measured !== true) {
    return [{ problem: "aftermath.returns_to.measured が真偽値でない", unmeasured: true }];
  }
  /** @type {Finding[]} */
  const out = returnsUrlProblems(ret);
  out.push(...returnsStateProblems(ret, screenStates));
  if (!filledStrings(ret.covered_by)) {
    out.push({
      problem:
        "aftermath.returns_to.covered_by が空（押した後の URL と、戻る・戻らない状態をスイートの assertion に落としていない）",
      unmeasured: true,
    });
  }
  return out;
}

/**
 * 押す前後の URL（url_before / url_after）の欠けを返す。
 * @param {Record<string, unknown>} ret
 * @returns {Finding[]}
 */
function returnsUrlProblems(ret) {
  /** @type {Finding[]} */
  const out = [];
  for (const key of ["url_before", "url_after"]) {
    const v = ret[key];
    if (!filled(v) || !String(v).startsWith("/") || String(v).startsWith("//")) {
      out.push({
        problem: `aftermath.returns_to.${key} が "/" で始まるオリジンを除いたパス（クエリ・フラグメントを含む）でない`,
        unmeasured: true,
      });
    }
  }
  return out;
}

/**
 * 押す前に動かした状態（probed）と戻った状態（reset）の欠けを返す。
 * @param {Record<string, unknown>} ret
 * @param {string[] | null} screenStates
 * @returns {Finding[]}
 */
function returnsStateProblems(ret, screenStates) {
  const probed = ret.probed;
  const reset = ret.reset;
  /** @param {unknown} v @returns {v is string[] & { readonly __stringsOk: true }} */
  const stringsOk = (v) => isArray(v) && v.every(filled) && new Set(v).size === v.length;
  if (!stringsOk(probed) || !stringsOk(reset)) {
    return [
      {
        problem:
          "aftermath.returns_to の probed / reset が、重複の無い空でない文字列の配列でない（何も動かしていないなら空配列）",
        unmeasured: true,
      },
    ];
  }
  /** @type {Finding[]} */
  const out = [];
  /** @type {Set<string>} */
  const probedSet = new Set(probed);
  const stray = reset.filter((x) => !probedSet.has(x));
  if (stray.length > 0) {
    out.push({
      problem: `aftermath.returns_to.reset に probed に無い状態がある: ${stray.join(", ")}（動かしていない状態が戻ったかは測れない）`,
      unmeasured: true,
    });
  }
  const notProbed = ret.not_probed;
  if (!isPlainObject(notProbed)) {
    out.push({
      problem:
        'aftermath.returns_to.not_probed が状態ごとの理由のオブジェクトでない（{ "<状態>": "<動かさなかった理由>" }。全て動かしたなら {}）',
      unmeasured: true,
    });
  } else if (screenStates !== null) {
    out.push(...notProbedProblems(probed, notProbed, screenStates));
  }
  return out;
}

/**
 * 表の画面の状態の棚卸し（screen_states）と、動かした状態・動かさなかった理由を突き合わせる。
 * @param {string[]} probed
 * @param {Record<string, unknown>} notProbed
 * @param {string[]} screenStates
 * @returns {Finding[]}
 */
function notProbedProblems(probed, notProbed, screenStates) {
  /** @type {Finding[]} */
  const out = [];
  /** @type {Set<string>} */
  const probedSet = new Set(probed);
  const declared = new Set(screenStates);
  const unknown = probed.filter((x) => !declared.has(x));
  if (unknown.length > 0) {
    out.push({
      problem: `aftermath.returns_to.probed に表の screen_states に無い状態がある: ${unknown.join(", ")}（棚卸しに足すか名前を合わせる）`,
      unmeasured: true,
    });
  }
  // 動かしていない状態が戻るかは測れない。棚卸しの全ての状態を、動かしたか・理由付きで動かさなかったかのどちらかにする
  const lacking = screenStates.filter((x) => !probedSet.has(x) && !filled(notProbed[x]));
  if (lacking.length > 0) {
    out.push({
      problem: `aftermath.returns_to: 画面の状態 ${lacking.join(", ")} を押す前に動かしておらず、not_probed に理由も無い（戻す範囲を語れない）`,
      unmeasured: true,
    });
  }
  const stale = Object.keys(notProbed).filter((x) => !declared.has(x) || probedSet.has(x));
  if (stale.length > 0) {
    out.push({
      problem: `aftermath.returns_to.not_probed に、棚卸しに無い・動かした状態の理由が残っている: ${stale.join(", ")}`,
      unmeasured: false,
    });
  }
  return out;
}

/**
 * 横取り・保留した要求の URL のパターンが、オリジン（スキームとホスト・ポート）を含まない形か。
 * 成果物にホスト・ポートを残さない規約（url_command の target）に合わせ、実行時に解決した URL がそのまま記録されるのを落とす。
 * 先頭の `*`（Playwright の glob）を外した残りが `/` で始まるパス（`//` で始まらない）で、
 * どこにも `://` を含まないものだけを通す。`https://host/…`・`//host/…` に加えて、glob の後ろにスキームやホストを書いた
 * `*` + `*://host/…` の形も落とす。
 * @param {unknown} v
 * @returns {boolean}
 */
function originFreePattern(v) {
  if (!filled(v)) return false;
  const path = String(v).trim().replace(/^\*+/, "");
  return path.startsWith("/") && !path.startsWith("//") && !path.includes("://");
}

/**
 * 状態表示の候補 1 つ（state_displays.pages[].candidates の 1 値）の欠けを返す。
 *
 * 「状態表示」を散文の観点にしておくと、画面がその状態を持つかを一度も測らないまま完了できる。
 * 候補ごとに ある（present）／ない（absent）を現行で測らせ、ある は撮る状態か assertion へ割り当てさせる。
 * ない も測った結果なので、不在を確かめる assertion を要求する（新側が警告のダイアログを足しても、撮っていない状態は 3 つの比較方法に表れない）。
 * toast / dialog も操作の反応を参照させない。参照するなら、画面・見えるか・種別の一致を検査で保証し続ける必要がある。
 * 軸を 1 つ直すたびに別の軸の抜けが出たので、入力形式ごと外した。反応と同じ assertion 名を covered_by に書く。
 * @param {unknown} entry
 * @param {string} candidate - STATE_DISPLAY_CANDIDATES の 1 つ
 * @param {Set<string> | null} captureStates
 * @returns {{ problem: string, unmeasured: boolean }[]}
 */
function stateDisplayProblems(entry, candidate, captureStates) {
  if (!isPlainObject(entry)) {
    return [
      {
        problem: `${candidate} の記録がオブジェクトでない（status: present / absent / unmeasured で書く）`,
        unmeasured: true,
      },
    ];
  }
  if (typeof entry.status !== "string" || !STATE_DISPLAY_STATUSES.includes(entry.status)) {
    return [
      {
        problem: `${candidate}.status が語彙（${STATE_DISPLAY_STATUSES.join(" / ")}）に無い`,
        unmeasured: true,
      },
    ];
  }
  if (entry.status === "unmeasured") {
    return [
      {
        problem: `${candidate}: 未測定${filled(entry.reason) ? `（${entry.reason}）` : "（reason が空）"}`,
        unmeasured: true,
      },
    ];
  }
  /** @type {Record<string, unknown>} */
  const setup = isPlainObject(entry.setup) ? entry.setup : {};
  return [
    ...stateSetupProblems(setup, entry.status, candidate),
    ...stateRecordProblems(entry, candidate, captureStates),
  ];
}

/**
 * 状態表示の候補 1 つを作った手段（setup）の欠けを返す。
 * @param {Record<string, unknown>} setup
 * @param {string} status - present か absent
 * @param {string} candidate
 * @returns {Finding[]}
 */
function stateSetupProblems(setup, status, candidate) {
  /** @type {Finding[]} */
  const out = [];
  const method = setup.method;
  const allowed =
    status === "present"
      ? STATE_SETUP_METHODS.filter((m) => !ABSENT_WITHOUT_ASSERTION.includes(m))
      : ABSENT_METHODS[candidate];
  if (typeof method !== "string" || !allowed.includes(method)) {
    out.push({
      problem:
        status === "absent" && (candidate === "fetch-error" || candidate === "loading")
          ? `${candidate}: absent の setup.method が ${allowed.join(" / ")} でない（「起こせない」と書く前に要求の横取り〈page.route の abort / fulfill / 応答の保留〉で試す。画面がその要求を送らないなら no-request）`
          : `${candidate}: ${status} の setup.method が ${allowed.join(" / ")} でない（その状態をどう作った・作ろうとしたかが残らない）`,
      unmeasured: true,
    });
    return out;
  }
  if (!filled(setup.detail)) {
    out.push({
      problem: `${candidate}: setup.detail（状態の作り方〈検索条件・横取りした応答の中身・保留した時間〉）が空`,
      unmeasured: true,
    });
  }
  // 横取りした要求を書かせないと、どの要求を止めたか（画面の本体の取得か、無関係な要求か）を読めない
  if (INTERCEPT_METHODS.includes(method) && !originFreePattern(setup.request)) {
    out.push({
      problem: `${candidate}: setup.method: ${method} なのに setup.request（横取りした要求の URL のパターン。オリジンは書かない）が空・オリジン付き`,
      unmeasured: true,
    });
  }
  return out;
}

/**
 * 状態表示の候補 1 つの、現行で見たもの（observed）と割り当て（captured / covered_by）の欠けを返す。
 * @param {Record<string, unknown>} entry - status が present か absent のもの
 * @param {string} candidate
 * @param {Set<string> | null} captureStates
 * @returns {Finding[]}
 */
function stateRecordProblems(entry, candidate, captureStates) {
  /** @type {Finding[]} */
  const out = [];
  // 現行で見たもの。ある なら文言・覆い・ページ表示、ない なら代わりに見えたもの（表示が変わらない等）
  if (!filled(entry.observed)) {
    out.push({
      problem: `${candidate}: observed（現行で見た文言・覆い・ページ表示。ない なら代わりに見えたもの）が空・テンプレートの説明文のまま`,
      unmeasured: true,
    });
  }
  // 反応の参照は受け付けない（警告なしに無視すると、参照だけで割り当てたつもりの記録が「割り当てなし」と別の理由で落ち、直し方を誤る）
  if (Object.hasOwn(entry, "reactions")) {
    out.push({
      problem: `${candidate}: reactions は書けない（操作の反応を参照せず、撮る状態〈captured〉か assertion〈covered_by。反応と同じ assertion 名でよいが、両方の行に shared_assertion_reason が要る〉で押さえる）`,
      unmeasured: true,
    });
  }
  if (entry.status === "present")
    out.push(...presentStateProblems(entry, candidate, captureStates));
  else out.push(...absentStateProblems(entry, candidate));
  return out;
}

/**
 * status: present の候補の、撮る状態か assertion への割り当ての欠けを返す。
 * @param {Record<string, unknown>} entry
 * @param {string} candidate
 * @param {Set<string> | null} captureStates
 * @returns {Finding[]}
 */
function presentStateProblems(entry, candidate, captureStates) {
  /** @type {Finding[]} */
  const out = [];
  const hasState = filled(entry.captured);
  const hasAssertion = filledStrings(entry.covered_by);
  if (!hasState && !hasAssertion) {
    out.push({
      problem: `${candidate}: present なのに撮る状態（captured）にも assertion（covered_by）にも割り当てていない`,
      unmeasured: true,
    });
  }
  if (hasState && captureStates && !setHas(captureStates, entry.captured)) {
    out.push({
      problem: `${candidate}: captured "${String(entry.captured)}" が capture_conditions.states に無い`,
      unmeasured: true,
    });
  }
  return out;
}

/**
 * status: absent の候補の、撮る状態の矛盾と不在の assertion の欠けを返す。
 * @param {Record<string, unknown>} entry
 * @param {string} candidate
 * @returns {Finding[]}
 */
function absentStateProblems(entry, candidate) {
  /** @type {Finding[]} */
  const out = [];
  const method = isPlainObject(entry.setup) ? entry.setup.method : undefined;
  const hasState = filled(entry.captured);
  const hasAssertion = filledStrings(entry.covered_by);
  if (hasState) {
    out.push({
      problem: `${candidate}: absent なのに captured がある（ないと在るが同時に成立する）`,
      unmeasured: false,
    });
  }
  if (!listIncludes(ABSENT_WITHOUT_ASSERTION, method) && !hasAssertion) {
    out.push({
      problem: `${candidate}: absent なのに covered_by が空（その状態で何も出ないことをスイートの assertion にしていない。新側が出しても検出されない）`,
      unmeasured: true,
    });
  }
  return out;
}

/**
 * 画面ごとの状態表示の振り分け（state_displays）を検査する。
 *
 * 画面の集合は metadata.json の capture_conditions.pages（宣言）から取る。記録した画面の一覧を期待値にすると、
 * 画面ごと落とした振り分けが期待値からも消える。
 * @param {unknown} sd
 * @param {{ pageNames: Set<string> | null, captureStates: Set<string> | null, problems: string[], captureUses: Map<string, CaptureUse[]>, captureLabel: Map<string, string>, pageResolution: import("./page-identity.mjs").PageResolution | null }} ctx
 * @returns {{ pages: number | null, entries: number, unmeasured: number }}
 */
function checkStateDisplays(sd, ctx) {
  const { pageNames, problems } = ctx;
  /** @type {DisplaySummary} */
  const summary = { pages: null, entries: 0, unmeasured: 0 };
  if (!isPlainObject(sd) || !isArray(sd.pages)) {
    problems.push(
      "state_displays.pages が配列でない（画面ごとに状態表示の候補〈空データ・取得の失敗・読み込み中・トースト・ダイアログ〉を ある／ない へ振り分ける。キーごと省略しない）",
    );
    summary.unmeasured += 1;
    return summary;
  }
  if (pageNames === null || pageNames.size === 0) {
    problems.push(
      "state_displays を画面の集合と照合できない（metadata.json の capture_conditions.pages を読めない）",
    );
    summary.unmeasured += 1;
  }
  const seen = countDisplayPages(sd.pages, problems, summary);
  if (pageNames !== null) displayPageSetProblems(seen, pageNames, { problems, summary });
  summary.pages = seen.size;
  for (const row of sd.pages) {
    if (!isPlainObject(row) || !filled(row.page) || seen.get(row.page) !== 1) continue;
    checkDisplayRow(row, ctx, summary);
  }
  return summary;
}

/**
 * state_displays の集計（checkStateDisplays の戻り値）。
 * @typedef {{ pages: number | null, entries: number, unmeasured: number }} DisplaySummary
 */

/**
 * checkStateDisplays の ctx。
 * @typedef {{ pageNames: Set<string> | null, captureStates: Set<string> | null, problems: string[], captureUses: Map<string, CaptureUse[]>, captureLabel: Map<string, string>, pageResolution: import("./page-identity.mjs").PageResolution | null }} DisplayContext
 */

/**
 * state_displays.pages の画面ごとの行数を数える（page の空・重複は problems に積む）。
 * @param {unknown[]} pages
 * @param {string[]} problems
 * @param {DisplaySummary} summary
 * @returns {Map<string, number>}
 */
function countDisplayPages(pages, problems, summary) {
  /** @type {Map<string, number>} */
  const seen = new Map();
  for (const row of pages) {
    const page = isPlainObject(row) ? row.page : undefined;
    if (!filled(page)) {
      problems.push("state_displays.pages: page（capture_conditions.pages の名前）が空の行がある");
      summary.unmeasured += 1;
      continue;
    }
    seen.set(page, (seen.get(page) ?? 0) + 1);
  }
  for (const [page, n] of seen) {
    if (n > 1)
      problems.push(`state_displays.pages: 画面 "${page}" が ${n} 回ある（先勝ちにしない）`);
  }
  return seen;
}

/**
 * 振り分けた画面の集合を、metadata.json の capture_conditions.pages（宣言）と突き合わせる。
 * @param {Map<string, number>} seen
 * @param {Set<string>} pageNames
 * @param {{ problems: string[], summary: DisplaySummary }} out
 */
function displayPageSetProblems(seen, pageNames, { problems, summary }) {
  const lacking = [...pageNames].filter((pg) => !seen.has(pg));
  if (lacking.length > 0) {
    problems.push(
      `state_displays: 画面 ${lacking.join(", ")} の状態表示を振り分けていない（capture_conditions.pages の全ての画面を 1 回ずつ書く）`,
    );
    summary.unmeasured += lacking.length;
  }
  const unknown = [...seen.keys()].filter((pg) => !pageNames.has(pg));
  if (unknown.length > 0) {
    problems.push(
      `state_displays: 画面 ${unknown.join(", ")} が capture_conditions.pages に無い（誤記・旧称）`,
    );
  }
}

/**
 * state_displays.pages の 1 行（1 画面）の候補を検査する。
 * @param {Record<string, unknown>} row - page が 1 回だけ現れる行
 * @param {DisplayContext} ctx
 * @param {DisplaySummary} summary
 */
function checkDisplayRow(row, ctx, summary) {
  const { captureStates, problems } = ctx;
  const at = `state_displays["${String(row.page)}"]`;
  const candidates = row.candidates;
  if (!isPlainObject(candidates)) {
    problems.push(
      `${at}: candidates が候補ごとの記録のオブジェクトでない（${STATE_DISPLAY_CANDIDATES.join(" / ")} を全て書く）`,
    );
    summary.unmeasured += 1;
    return;
  }
  candidateKeyProblems(candidates, at, { problems, summary });
  for (const c of STATE_DISPLAY_CANDIDATES) {
    if (!Object.hasOwn(candidates, c)) continue;
    summary.entries += 1;
    const entry = candidates[c];
    const found = stateDisplayProblems(entry, c, captureStates);
    if (found.some((f) => f.unmeasured)) summary.unmeasured += 1;
    for (const f of found) problems.push(`${at}: ${f.problem}`);
    // 撮る状態は撮影の単位（ページ × 状態名）で、反応・残る見た目の撮る状態と同じ集合に入れて使い回しを数える
    if (isPlainObject(entry) && entry.status === "present" && filled(entry.captured)) {
      const page = String(row.page);
      const key = JSON.stringify([pageKey(page, ctx.pageResolution), entry.captured]);
      if (!ctx.captureLabel.has(key)) ctx.captureLabel.set(key, `${page} の ${entry.captured}`);
      addCaptureUse(ctx.captureUses, key, {
        opId: null,
        label: `${at}.${c}`,
        shared: filled(entry.shared_capture_reason),
        source: "reactions",
        page,
      });
    }
  }
}

/**
 * state_displays.pages の 1 行で、candidates に振り分けていない候補か語彙に無いキーがあれば、problems に積む。
 * @param {Record<string, unknown>} candidates
 * @param {string} at - 行の位置
 * @param {{ problems: string[], summary: DisplaySummary }} out
 */
function candidateKeyProblems(candidates, at, { problems, summary }) {
  const lacking = STATE_DISPLAY_CANDIDATES.filter((c) => !Object.hasOwn(candidates, c));
  if (lacking.length > 0) {
    problems.push(
      `${at}: 候補 ${lacking.join(", ")} を振り分けていない（ある／ない を現行で測って書く。測れなければ status: unmeasured と理由）`,
    );
    summary.unmeasured += lacking.length;
  }
  const unknown = Object.keys(candidates).filter((c) => !STATE_DISPLAY_CANDIDATES.includes(c));
  if (unknown.length > 0) {
    problems.push(
      `${at}: 候補の語彙（${STATE_DISPLAY_CANDIDATES.join(" / ")}）に無いキー: ${unknown.join(", ")}`,
    );
  }
}

/**
 * 撮る状態の使い回しの照合のキーに、割り当てた行を 1 つ足す。
 * @param {Map<string, CaptureUse[]>} captureUses
 * @param {string} key
 * @param {CaptureUse} use
 */
function addCaptureUse(captureUses, key, use) {
  const uses = captureUses.get(key) ?? [];
  uses.push(use);
  captureUses.set(key, uses);
}

/**
 * 送っている間にもう一度押したときの振る舞い（resubmit）の欠けを返す。
 *
 * 撮影状態の active は押している最中の見た目で、反応の欄は 1 回押した後を測る。要求が往復している間の操作の受け付け
 * （無視する・もう一度送る・確認をもう一度出す）はどちらにも現れず、移行元と移行先で違いやすい。
 * 応答を保留して（page.route で応答を返さずに待つ）押し直し、送った回数・確認の回数・画面の覆いを現行で測らせる。
 * @param {unknown} rs
 * @param {boolean} writes - この操作に表への書き込み（side_effect_writes の除外していない sites）があるか
 * @returns {{ problem: string, unmeasured: boolean }[]}
 */
function resubmitProblems(rs, writes) {
  if (!isPlainObject(rs)) {
    return [
      {
        problem:
          "resubmit が無い（送る操作なら、応答を保留して押し直したときの送った回数・確認の回数・覆いを測る。送らないなら sends: false と根拠）",
        unmeasured: true,
      },
    ];
  }
  if (rs.sends === null) {
    return [
      {
        problem: `resubmit: 未測定${filled(rs.reason) ? `（${rs.reason}）` : "（reason が空）"}`,
        unmeasured: true,
      },
    ];
  }
  if (rs.sends === false) return noResubmitProblems(rs, writes);
  if (rs.sends !== true) {
    return [{ problem: "resubmit.sends が true / false / null のどれでもない", unmeasured: true }];
  }
  /** @type {Finding[]} */
  const out = resubmitMeasureProblems(rs);
  out.push(...resubmitWritesProblems(rs.writes, writes));
  if (!filledStrings(rs.covered_by)) {
    out.push({
      problem:
        "resubmit.covered_by が空（送っている間の押し直しで送った回数・確認の回数・覆いをスイートの assertion にしていない）",
      unmeasured: true,
    });
  }
  return out;
}

/**
 * resubmit.sends: false の記録の欠けと矛盾を返す。
 * @param {Record<string, unknown>} rs
 * @param {boolean} writes - この操作に表への書き込みがあるか
 * @returns {Finding[]}
 */
function noResubmitProblems(rs, writes) {
  /** @type {Finding[]} */
  const out = [];
  if (!filled(rs.reason)) {
    out.push({
      problem:
        "resubmit.sends: false なのに reason（要求を送らないことを確かめた記録）が空・テンプレートの説明文のまま",
      unmeasured: true,
    });
  }
  // 表へ書き込む操作は要求を送っている。送らないと書いた記録は書き込みの記録と矛盾する
  if (writes) {
    out.push({
      problem:
        "resubmit.sends: false なのに、この操作の表への書き込みが side_effect_writes.sites にある（書き込む操作は送っている）",
      unmeasured: true,
    });
  }
  for (const key of ["hold", "presses", "observed", "writes", "covered_by"]) {
    if (rs[key] !== undefined && rs[key] !== null) {
      out.push({
        problem: `resubmit.sends: false なのに ${key} がある（送らないと送るが同時に成立する）`,
        unmeasured: false,
      });
    }
  }
  return out;
}

/**
 * resubmit.sends: true の記録の、応答の保留・押した回数・現行で測った結果の欠けを返す。
 * @param {Record<string, unknown>} rs
 * @returns {Finding[]}
 */
function resubmitMeasureProblems(rs) {
  /** @type {Finding[]} */
  const out = [];
  // 応答を保留しないと、押し直す前に往復が終わり「送っている間」を一度も作らない
  const hold = rs.hold;
  if (!isPlainObject(hold) || hold.method !== "route-delay" || !originFreePattern(hold.request)) {
    out.push({
      problem:
        "resubmit.hold が { method: route-delay, request: <保留した要求の URL のパターン。オリジンは書かない> } でない（応答を保留せずに押し直すと、送っている間を作れない）",
      unmeasured: true,
    });
  }
  if (!isInteger(rs.presses) || rs.presses < 2) {
    out.push({
      problem:
        "resubmit.presses（応答を保留している間に押した回数。最初の 1 回を含む）が 2 以上の整数でない",
      unmeasured: true,
    });
  }
  const obs = rs.observed;
  if (
    !isPlainObject(obs) ||
    !isInteger(obs.requests_sent) ||
    obs.requests_sent < 1 ||
    !isInteger(obs.confirms_shown) ||
    obs.confirms_shown < 0 ||
    !filled(obs.overlay)
  ) {
    out.push({
      problem:
        "resubmit.observed に、送った回数（requests_sent: 1 以上の整数）・確認の回数（confirms_shown: 0 以上の整数）・覆い（overlay: 画面を覆って受け付けない・押した要素だけ不活性・何もしない等）が揃っていない",
      unmeasured: true,
    });
  }
  return out;
}

/**
 * resubmit.writes（押し直しで表に書かれた行の数）の欠けと矛盾を返す。
 * @param {unknown} w - resubmit.writes
 * @param {boolean} writes - この操作に表への書き込みがあるか
 * @returns {Finding[]}
 */
function resubmitWritesProblems(w, writes) {
  if (writes) {
    // 書き込みの回数は送った回数と別に数える（1 回の送信が 2 行書く・2 回送っても 1 行に畳む処理がある）
    if (!isPlainObject(w) || !isInteger(w.count) || w.count < 0 || !filled(w.evidence)) {
      return [
        {
          problem:
            "resubmit.writes が { count: <押し直しで表に書かれた行の数>, evidence: <数え方> } でない（この操作は side_effect_writes.sites に書き込みがあるので、送った回数を書き込みの回数と突き合わせる）",
          unmeasured: true,
        },
      ];
    }
  } else if (w !== undefined && w !== null) {
    return [
      {
        problem:
          "resubmit.writes があるのに、この操作の表への書き込みが side_effect_writes.sites に無い（書き込みを sites に記録するか writes を消す）",
        unmeasured: false,
      },
    ];
  }
  return [];
}

/**
 * 移行元ソースの 1 箇所（ファイルとシンボル）の参照か。
 * @param {unknown} ref
 * @returns {ref is { file: string, symbol: string } & { readonly __isSourceRef: true }}
 */
function isSourceRef(ref) {
  return isPlainObject(ref) && filled(ref.file) && filled(ref.symbol);
}

/**
 * 操作のハンドラ（file と symbol が空でない文字列）か。isSourceRef と違い、テンプレートの説明文のままの値を弾かない。
 * @param {unknown} h
 * @returns {h is { file: string, symbol: string } & { readonly __isHandlerRef: true }}
 */
function isHandlerRef(h) {
  return isPlainObject(h) && nonEmptyString(h.file) && nonEmptyString(h.symbol);
}

/**
 * シンボルが本文に語として現れるか（前後が識別子の文字でない）。
 * @param {string} text
 * @param {string} symbol
 * @returns {boolean}
 */
function symbolIn(text, symbol) {
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\w$])${escaped}([^\\w$]|$)`).test(text);
}

/**
 * 操作が最終的に呼ぶ送信・実行の関数の手前にある判定（pre_send）の欠けを返す。
 *
 * 件数・長さ・大きさの上限や必須・形式の検証は、共通部品のクライアント側スクリプトや送信の関数の中に置かれることがあり、
 * 画面の処理にも部品へ渡す引数にも現れない。ふだんの操作では通るので、スイートも差分ツールも両側で緑のまま新側に判定が無いことが分からない。
 * そこで、どこまで追ったか（traced_to）を残させ、判定ごとに境界の両側（通る側と止まる側）を現行で測った記録と assertion を要求する。
 * 判定の順序（確認・記録・送信のどれより前か）も order に残させる。順序が違うと、止めたときに残る記録や出る確認の回数が変わる。
 * @param {unknown} ps
 * @returns {{ problems: { problem: string, unmeasured: boolean }[], refs: { file: string, symbol: string, label: string }[] }}
 */
function preSendProblems(ps) {
  /** @type {Finding[]} */
  const out = [];
  /** @type {SourceRef[]} */
  const refs = [];
  if (!isPlainObject(ps)) {
    out.push({
      problem:
        "pre_send が無い（操作が最終的に呼ぶ送信・実行の関数まで追い、送る前の判定〈上限・境界値・検証〉を列挙していない。無いなら found: false を確かめ方付きで書く）",
      unmeasured: true,
    });
    return { problems: out, refs };
  }
  if (ps.found === null) {
    out.push({
      problem: `pre_send: 未測定${nonEmptyString(ps.reason) ? `（${ps.reason}）` : "（reason が空）"}`,
      unmeasured: true,
    });
    return { problems: out, refs };
  }
  if (typeof ps.found !== "boolean") {
    out.push({ problem: "pre_send.found が true / false / null のどれでもない", unmeasured: true });
    return { problems: out, refs };
  }
  out.push(...preSendTraceProblems(ps, refs));
  if (ps.found === false) out.push(...preSendAbsentProblems(ps));
  else out.push(...preSendItemsProblems(ps.items, refs));
  return { problems: out, refs };
}

/**
 * 送る前の判定の到達点と判定の場所（ファイルとシンボル）。label は出力に出す欄の位置。
 * @typedef {{ file: string, symbol: string, label: string }} SourceRef
 */

/**
 * pre_send の到達点（traced_to）と辿り方（trace）の欠けを返す。到達点は refs に足す。
 * @param {Record<string, unknown>} ps
 * @param {SourceRef[]} refs
 * @returns {Finding[]}
 */
function preSendTraceProblems(ps, refs) {
  /** @type {Finding[]} */
  const out = [];
  // 到達点。画面の処理で読むのを止めると、部品の内側の判定は読まれない（実例は送信の関数の中の上限）
  const traced = ps.traced_to;
  if (!isArray(traced) || traced.length === 0 || !traced.every(isSourceRef)) {
    out.push({
      problem:
        "pre_send.traced_to（追った到達点〈送信・実行の直前の関数〉のファイルとシンボル）が空・欠けている（どこまで読んだかが残らない）",
      unmeasured: true,
    });
  } else {
    for (const t of traced)
      refs.push({ file: t.file, symbol: t.symbol, label: "pre_send.traced_to" });
  }
  if (!filled(ps.trace)) {
    out.push({
      problem:
        "pre_send.trace が空（操作のハンドラから部品の内側を通って到達点までどう辿ったかが残らない）",
      unmeasured: true,
    });
  }
  return out;
}

/**
 * pre_send.found: false の記録の欠けと矛盾を返す。
 * @param {Record<string, unknown>} ps
 * @returns {Finding[]}
 */
function preSendAbsentProblems(ps) {
  /** @type {Finding[]} */
  const out = [];
  if (!filled(ps.evidence)) {
    out.push({
      problem:
        "pre_send.found: false なのに evidence が空・テンプレートの説明文のまま（到達点まで読んで送る前の判定が無いことを確かめた記録が無い）",
      unmeasured: true,
    });
  }
  if (isArray(ps.items) && ps.items.length > 0) {
    out.push({
      problem: "pre_send.found: false なのに items がある（無いと在るが同時に成立する）",
      unmeasured: false,
    });
  }
  return out;
}

/**
 * pre_send.found: true の記録の判定（items）の欠けを返す。判定の場所は refs に足す。
 * @param {unknown} checks - pre_send.items
 * @param {SourceRef[]} refs
 * @returns {Finding[]}
 */
function preSendItemsProblems(checks, refs) {
  if (!isArray(checks) || checks.length === 0) {
    return [
      {
        problem: "pre_send.found: true なのに items が空（判定を 1 つずつ列挙していない）",
        unmeasured: true,
      },
    ];
  }
  /** @type {string[]} */
  const idProblems = [];
  const ids = collectIds(checks, "pre_send.items", idProblems);
  /** @type {Finding[]} */
  const out = idProblems.map((problem) => ({ problem, unmeasured: true }));
  for (const item of checks) {
    if (!isPlainObject(item) || !setHas(ids, item.id)) continue;
    preSendItemProblems(item, out, refs);
  }
  return out;
}

/**
 * 送る前の判定 1 つ（pre_send.items の 1 件）の欠けを out に積む。判定の場所は refs に足す。
 * @param {Record<string, unknown>} item
 * @param {Finding[]} out
 * @param {SourceRef[]} refs
 */
function preSendItemProblems(item, out, refs) {
  const at = `pre_send.items["${String(item.id)}"]`;
  if (typeof item.kind !== "string" || !PRE_SEND_KINDS.includes(item.kind)) {
    out.push({
      problem: `${at}: kind が語彙（${PRE_SEND_KINDS.join(" / ")}）に無い`,
      unmeasured: true,
    });
  }
  if (!isSourceRef(item.location)) {
    out.push({
      problem: `${at}: location（判定のあるファイルとシンボル）が空・欠けている`,
      unmeasured: true,
    });
  } else {
    refs.push({ file: item.location.file, symbol: item.location.symbol, label: `${at}.location` });
  }
  if (!filled(item.condition) || !filled(item.on_block)) {
    out.push({
      problem: `${at}: condition（止める条件）/ on_block（止めたときに起きること）が空`,
      unmeasured: true,
    });
  }
  // 判定の順序。確認・記録・送信と並べて、この判定がどこに入るかを残す（自分だけの 1 要素では前後を語れない）
  const order = item.order;
  if (
    !isArray(order) ||
    order.length < 2 ||
    !order.every(filled) ||
    new Set(order).size !== order.length ||
    !listIncludes(order, item.id)
  ) {
    out.push({
      problem: `${at}: order が、この判定の id を 1 回含む 2 つ以上の重複の無い工程の並びでない（確認・記録・送信のどれより前かが残らない）`,
      unmeasured: true,
    });
  }
  preSendSidesProblems(item.sides, at, out);
}

/**
 * 送る前の判定 1 つの境界の両側（sides）の欠けを out に積む。
 * @param {unknown} sides
 * @param {string} at - 判定の位置
 * @param {Finding[]} out - それまでに積んだ欠け（この判定の sides の欠けがあるかの判定にも使う）
 */
function preSendSidesProblems(sides, at, out) {
  if (!isArray(sides) || sides.length === 0) {
    out.push({
      problem: `${at}: sides が空（境界の両側〈通る側 inside と止まる側 outside〉を現行で測っていない）`,
      unmeasured: true,
    });
    return;
  }
  /** @type {Set<string>} */
  const measuredSides = new Set();
  for (const [i, side] of sides.entries()) {
    const { measured, problem } = boundarySide(side, `${at}.sides[${i}]`);
    if (measured !== null) measuredSides.add(measured);
    if (problem !== null) out.push({ problem, unmeasured: true });
  }
  const lacking = BOUNDARY_SIDES.filter((x) => !measuredSides.has(x));
  if (lacking.length > 0 && out.every((o) => !o.problem.startsWith(`${at}.sides`))) {
    out.push({
      problem: `${at}: 境界の ${lacking.join(" / ")} 側を測っていない（ふだんの操作は通る側しか通らないので、止まる側を測らないと新側に判定が無くても緑になる）`,
      unmeasured: true,
    });
  }
}

/**
 * 境界の片側 1 件を読む。測れていれば measured にその側（inside / outside）、欠けがあれば problem に理由を入れる。
 * @param {unknown} side
 * @param {string} sat - その側の位置
 * @returns {{ measured: string | null, problem: string | null }}
 */
function boundarySide(side, sat) {
  if (
    !isPlainObject(side) ||
    typeof side.side !== "string" ||
    !BOUNDARY_SIDES.includes(side.side)
  ) {
    return { measured: null, problem: `${sat}: side が ${BOUNDARY_SIDES.join(" / ")} でない` };
  }
  // どう境界の状態を作ったか。ゴールデンデータの件数が境界に届かないときは、届かないことと代わりの作り方をここに残す
  if (!filled(side.input) || !filled(side.setup)) {
    return {
      measured: null,
      problem: `${sat}: input（与えた値）/ setup（境界の状態をどう作ったか。ゴールデンデータが届かないなら代わりの作り方）が空`,
    };
  }
  if (filled(side.observed) && filledStrings(side.covered_by)) {
    return { measured: side.side, problem: null };
  }
  return {
    measured: null,
    problem: filled(side.reason)
      ? `${sat}: 未測定（${side.reason}）`
      : `${sat}: observed（現行で測った結果）/ covered_by（assertion）が空`,
  };
}

/**
 * 走査のパターン（id・regex・example）をコンパイルする。example に一致しないパターンは落とす（走査 0 件を「無い」と区別するための、検出されることの確認）。
 * @param {unknown[]} patterns
 * @param {{ patIds: Set<string>, label: string, problems: string[] }} ctx - patIds は使える id、label は出力に出す位置
 * @returns {{ id: string, re: RegExp, pattern: Record<string, unknown> }[]}
 */
function compilePatterns(patterns, { patIds, label, problems }) {
  /** @type {{ id: string, re: RegExp, pattern: Record<string, unknown> }[]} */
  const compiled = [];
  for (const p of patterns) {
    if (!isPlainObject(p) || !nonEmptyString(p.id) || !patIds.has(p.id)) continue;
    if (!nonEmptyString(p.regex)) {
      problems.push(`${label}["${p.id}"]: regex が空`);
      continue;
    }
    /** @type {RegExp} */
    let re;
    try {
      // ファイル全体に照合するので、^ / $ が行頭・行末に一致するよう複数行モードにする（行ごとに照合していたときの意味を保つ）
      re = new RegExp(p.regex, "gm");
    } catch (e) {
      throw new UsageError(`${label}["${p.id}"]: regex が不正（${errorMessage(e)}）`);
    }
    // 検出されることの確認: 実際の呼び出しの字面に一致しないパターンは、走査 0 件を「呼び出しが無い」と区別できない
    if (!nonEmptyString(p.example)) {
      problems.push(`${label}["${p.id}"]: example（一致すべき呼び出しの字面）が空`);
      continue;
    }
    re.lastIndex = 0;
    if (!re.test(p.example)) {
      problems.push(
        `${label}["${p.id}"]: regex が example に一致しない（検出ツールが呼び出しを認識できない）`,
      );
      continue;
    }
    re.lastIndex = 0;
    compiled.push({ id: p.id, re, pattern: p });
  }
  return compiled;
}

/**
 * 走査範囲と走査したバージョンの欠けを返す。走査したバージョンが測定した現行のバージョンと違えば、測定側にだけある呼び出しが走査に現れない。
 * @param {unknown} src
 * @param {unknown} targetCommit - metadata.json の target.commit（undefined なら照合しない）
 * @param {string} label - 例: feedback_calls.source
 * @returns {string[]}
 */
function sourceProblems(src, targetCommit, label) {
  const paths = isPlainObject(src) && isArray(src.paths) ? src.paths : [];
  if (!isPlainObject(src) || paths.length === 0 || !paths.every(nonEmptyString)) {
    return [`${label}.paths が空（走査範囲が無い）`];
  }
  if (!nonEmptyString(src.version))
    return [`${label}.version が空（どのバージョンを走査したか残らない）`];
  if (targetCommit === undefined) return [];
  const measured = nonEmptyString(targetCommit) && targetCommit !== "none" ? targetCommit : null;
  const unverified = nonEmptyString(src.version_unverified_reason);
  if (measured === null || src.version === "none") {
    return unverified
      ? []
      : [
          `走査したバージョンと metadata.json の target.commit を照合できない（どちらかが none）のに ${label}.version_unverified_reason が空`,
        ];
  }
  if (src.version !== measured) {
    return [
      `${label}.version（${src.version}）が metadata.json の target.commit（${measured}）と違う（測定したバージョンと別のバージョンを走査している）`,
    ];
  }
  if (unverified) {
    return [
      `${label}: 走査したバージョンが target.commit と一致しているのに version_unverified_reason が埋まっている`,
    ];
  }
  return [];
}

/**
 * 表への書き込み（side_effect_writes）を検査する。
 *
 * 監査・利用ログのような表への書き込みは利用者に見える反応を出さないので、反応の欄では「反応が無い」として扱われる。
 * 差分ツールの 3 つの比較方法（画素・特性・aria）も DB を見ない。書き込みがまるごと無い新側でもスイートと差分検出が緑になる。
 * 書き込みのパターンで移行元ソースを走査して全件（例外処理の中を含む）と突き合わせ、1 か所ずつ値・時機・回数と確かめ方を残させる。
 * @param {unknown} sew
 * @param {{ opIds: Set<string>, root: string, recorded: boolean, targetCommit: unknown, problems: string[], writeOps: Set<string> }} ctx
 *   writeOps には、表への書き込みを持つ操作の id を足す（呼び出し側が送っている間の押し直しの判定に使う）。
 * @returns {{ declared: boolean | null, checked: boolean, found: number | null, recorded: number | null, files: number | null }}
 */
function checkSideEffectWrites(sew, ctx) {
  const { problems } = ctx;
  /** @type {WriteSummary} */
  const summary = { declared: null, checked: false, found: null, recorded: null, files: null };
  if (!isPlainObject(sew) || typeof sew.declared !== "boolean") {
    problems.push(
      "side_effect_writes.declared が真偽値でない（表への書き込み〈監査・利用ログ等〉を移行元ソースから列挙したかを書く。書き込みを持たない機能は declared: false と理由。キーごと省略しない）",
    );
    return summary;
  }
  summary.declared = sew.declared;
  if (sew.declared === false) {
    undeclaredWriteProblems(sew, problems);
    return summary;
  }
  const tableSet = writeTables(sew.tables, problems);
  const patterns = isArray(sew.patterns) ? sew.patterns : [];
  if (patterns.length === 0)
    problems.push("side_effect_writes.patterns が空（書き込みの呼び出しを探すパターンが無い）");
  const label = "side_effect_writes.patterns";
  const patIds = collectIds(patterns, label, problems);
  const compiled = compilePatterns(patterns, { patIds, label, problems });
  const tableOfPattern = patternTables(compiled, tableSet, problems);
  const sites = isArray(sew.sites) ? sew.sites : null;
  if (sites === null) throw new UsageError("side_effect_writes.sites が配列でない");
  const recordedCount = recordWriteSites(sites, { patIds, tableOfPattern, tableSet }, ctx);
  summary.recorded = sites.length;
  const srcProblems = sourceProblems(sew.source, ctx.targetCommit, "side_effect_writes.source");
  problems.push(...srcProblems);
  scanWriteSites(sew.source, compiled, { recordedCount, ctx, summary });
  return summary;
}

/**
 * checkSideEffectWrites の集計。
 * @typedef {{ declared: boolean | null, checked: boolean, found: number | null, recorded: number | null, files: number | null }} WriteSummary
 */

/**
 * checkSideEffectWrites の ctx。
 * @typedef {{ opIds: Set<string>, root: string, recorded: boolean, targetCommit: unknown, problems: string[], writeOps: Set<string> }} WriteContext
 */

/**
 * side_effect_writes.declared: false の記録の欠けと矛盾を problems に積む。
 * @param {Record<string, unknown>} sew
 * @param {string[]} problems
 */
function undeclaredWriteProblems(sew, problems) {
  if (!filled(sew.reason)) problems.push("side_effect_writes.declared: false なのに reason が空");
  for (const key of ["tables", "patterns", "sites"]) {
    const value = sew[key];
    if (value !== undefined && !(isArray(value) && value.length === 0))
      problems.push(
        `side_effect_writes.declared: false なのに ${key} がある（書き込みが無いと在るが同時に成立する。記録したなら declared: true で走査させる）`,
      );
  }
}

/**
 * 書き込み先の表（side_effect_writes.tables）を集合にする。形が誤っていれば problems に積んで空の集合を返す。
 * @param {unknown} tables
 * @param {string[]} problems
 * @returns {Set<string>}
 */
function writeTables(tables, problems) {
  if (
    !isArray(tables) ||
    tables.length === 0 ||
    !tables.every(filled) ||
    new Set(tables).size !== tables.length
  ) {
    problems.push(
      "side_effect_writes.tables が重複の無い空でない文字列の配列でない（features.md の副作用出力にある書き込み先の表を列挙する）",
    );
    return new Set();
  }
  return new Set(tables);
}

/**
 * パターン id → 書き込み先の表を作る。表の無いパターンと、パターンの無い表は problems に積む。
 * @param {{ id: string, re: RegExp, pattern: Record<string, unknown> }[]} compiled
 * @param {Set<string>} tableSet
 * @param {string[]} problems
 * @returns {Map<string, string>}
 */
function patternTables(compiled, tableSet, problems) {
  /** @type {Map<string, string>} パターン id → 書き込み先の表 */
  const tableOfPattern = new Map();
  for (const c of compiled) {
    const t = c.pattern.table;
    if (!filled(t) || !tableSet.has(t)) {
      problems.push(
        `side_effect_writes.patterns["${c.id}"]: table "${String(t)}" が side_effect_writes.tables に無い`,
      );
      continue;
    }
    tableOfPattern.set(c.id, t);
  }
  const patternless = [...tableSet].filter((t) => ![...tableOfPattern.values()].includes(t));
  if (patternless.length > 0) {
    problems.push(
      `side_effect_writes: 表 ${patternless.join(", ")} への書き込みを探すパターンが無い（走査しない表は全件を突き合わせられない）`,
    );
  }
  return tableOfPattern;
}

/**
 * 記録した書き込み箇所（side_effect_writes.sites）を検査し、照合キーごとの件数を返す。
 * @param {unknown[]} sites
 * @param {{ patIds: Set<string>, tableOfPattern: Map<string, string>, tableSet: Set<string> }} lookup
 * @param {WriteContext} ctx - writeOps に、表への書き込みを持つ操作の id を足す
 * @returns {Map<string, number>}
 */
function recordWriteSites(sites, lookup, ctx) {
  const { patIds, tableOfPattern, tableSet } = lookup;
  const { opIds, problems, writeOps } = ctx;
  /** @type {Map<string, number>} */
  const recordedCount = new Map();
  /** @type {Set<string>} 書き込み箇所を 1 件以上記録した表 */
  const writtenTables = new Set();
  for (const s of sites) {
    if (!isSiteRow(s)) {
      problems.push("side_effect_writes.sites: file / line / column / pattern が欠けた行がある");
      continue;
    }
    const key = siteKeyOf(s);
    recordedCount.set(key, (recordedCount.get(key) ?? 0) + 1);
    const at = `side_effect_writes.sites ${key}`;
    if (!patIds.has(s.pattern)) {
      problems.push(`${at}: pattern "${s.pattern}" が side_effect_writes.patterns に無い`);
      continue;
    }
    if (filled(s.excluded_reason)) continue; // この機能の書き込みではない（別 slug の操作の呼び出し等）
    const table = tableOfPattern.get(s.pattern);
    if (table !== undefined) writtenTables.add(table);
    // 送っている間の押し直し（resubmit）で書き込みの回数を突き合わせる操作
    if (typeof s.operation === "string" && opIds.has(s.operation)) writeOps.add(s.operation);
    problems.push(...writeSiteProblems(s, at, opIds));
  }
  pushDuplicateSites(recordedCount, "side_effect_writes.sites", problems);
  const unwritten = [...tableSet].filter((t) => !writtenTables.has(t));
  if (unwritten.length > 0) {
    problems.push(
      `side_effect_writes: 表 ${unwritten.join(", ")} に書く箇所が 1 件も記録されていない（例外処理の中を含めて移行元ソースから全件列挙する）`,
    );
  }
  return recordedCount;
}

/**
 * 書き込み箇所 1 件の、操作・時機・値・回数・処理の流れ・確かめ方の欠けを返す。
 * @param {Record<string, unknown>} s
 * @param {string} at - 箇所の位置
 * @param {Set<string>} opIds
 * @returns {string[]}
 */
function writeSiteProblems(s, at, opIds) {
  /** @type {string[]} */
  const problems = [];
  // 画面を開いたときの書き込みのように操作に結び付かない書き込みは operation: null（occasion で時機を書く）
  if (s.operation !== null && !setHas(opIds, s.operation)) {
    problems.push(
      `${at}: operation "${typeof s.operation === "string" ? s.operation : JSON.stringify(s.operation)}" が網羅表の操作に無い（操作に結び付かない書き込みは null にして occasion に時機を書く。この機能の書き込みでなければ excluded_reason）`,
    );
  }
  if (!filled(s.occasion) || !filled(s.values) || !filled(s.count)) {
    problems.push(
      `${at}: occasion（いつ書くか。送信・確認・例外との前後）/ values（書く値）/ count（回数）が空`,
    );
  }
  if (typeof s.path !== "string" || !WRITE_PATHS.includes(s.path)) {
    problems.push(`${at}: path が語彙（${WRITE_PATHS.join(" / ")}）に無い`);
  }
  problems.push(...writeVerificationProblems(s, at));
  return problems;
}

/**
 * 書き込み箇所 1 件の確かめ方（verification）と、それに伴う covered_by・source_only_reason の欠けを返す。
 * @param {Record<string, unknown>} s
 * @param {string} at - 箇所の位置
 * @returns {string[]}
 */
function writeVerificationProblems(s, at) {
  /** @type {string[]} */
  const problems = [];
  if (s.verification === "assertion") {
    if (!filledStrings(s.covered_by)) {
      problems.push(`${at}: verification: assertion なのに covered_by が空`);
    }
  } else if (s.verification === "source-only") {
    // 移行元で起こせない書き込み（例外時等）は読解だけで記録する。新側の書き込み箇所は parity-replace が porting.md に残す
    if (!filled(s.source_only_reason)) {
      problems.push(
        `${at}: verification: source-only なのに source_only_reason（移行元で起こせない理由）が空`,
      );
    }
    // 読解のみと assertion が同時に成立する記録は、どちらで確かめたかを読めない
    if (isArray(s.covered_by) && s.covered_by.length > 0) {
      problems.push(
        `${at}: verification: source-only なのに covered_by がある（assertion で確かめたなら verification: assertion にする）`,
      );
    }
  } else {
    problems.push(`${at}: verification が語彙（${WRITE_VERIFICATIONS.join(" / ")}）に無い`);
  }
  return problems;
}

/**
 * 移行元ソースを書き込みのパターンで走査し、記録した書き込み箇所と突き合わせる（--recorded では走査しない）。
 * @param {unknown} src - side_effect_writes.source
 * @param {{ id: string, re: RegExp }[]} compiled
 * @param {{ recordedCount: Map<string, number>, ctx: WriteContext, summary: WriteSummary }} state
 */
function scanWriteSites(src, compiled, { recordedCount, ctx, summary }) {
  const { root, recorded, problems } = ctx;
  const paths = isPlainObject(src) && isArray(src.paths) ? src.paths : [];
  if (recorded || paths.length === 0 || !paths.every(nonEmptyString) || compiled.length === 0) {
    return;
  }
  const scan = scanSources(root, paths, {
    patterns: compiled,
    label: "side_effect_writes.source.paths",
  });
  summary.checked = true;
  summary.files = scan.files;
  summary.found = scan.sites.length;
  if (scan.files === 0)
    problems.push("side_effect_writes: 走査対象のテキストファイルが 0 件（走査範囲が誤っている）");
  const foundKeys = new Set(scan.sites.map(siteKeyOf));
  for (const key of foundKeys) {
    if (!recordedCount.has(key))
      problems.push(`side_effect_writes.sites: ソースの書き込み ${key} が網羅表に記録されていない`);
  }
  for (const key of recordedCount.keys()) {
    if (!foundKeys.has(key))
      problems.push(
        `side_effect_writes.sites: 記録された ${key} がソースに見つからない（バージョンの食い違い・行ずれ）`,
      );
  }
}

/**
 * 移行元ソースの 1 ファイルを --root から読む。--root からの / 区切りの相対パスそのもの（走査範囲のキーと同じ形）でないもの
 * （絶対パス・`./` や `..` を含む形・ルートの外）・読めない・バイナリは null。形を揃えないと、declared を true に切り替えたときに
 * 同じ参照が走査範囲のキーと一致せず合否が逆になり、マシン固有の絶対パスが表の指紋に残る。
 * feedback_calls.declared: false で走査範囲を持たないときに、送る前の判定の参照を照合するために使う。
 * @param {string} root
 * @param {string} file - --root からの相対（/ 区切り）
 * @returns {string | null}
 */
function readSourceFile(root, file) {
  const absRoot = resolve(root);
  const abs = resolve(absRoot, file);
  const rel = relative(absRoot, abs);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`)) return null;
  if (rel.split(sep).join("/") !== file) return null;
  try {
    const buf = readFileSync(abs);
    return buf.includes(0) ? null : buf.toString("utf8");
  } catch {
    return null;
  }
}

/**
 * 送る前の判定の到達点と判定の場所（ファイルとシンボル）をソースと照合する。
 * @param {Map<string, { file: string, symbol: string, label: string }[]>} refsByOp
 * @param {(file: string) => string | null | undefined} read - ファイルの本文（読めなければ null / undefined）
 * @param {string} unreadable - 読めないときの説明
 * @returns {{ opId: string, problem: string }[]}
 */
function preSendRefProblems(refsByOp, read, unreadable) {
  /** @type {{ opId: string, problem: string }[]} */
  const out = [];
  for (const [opId, refs] of refsByOp) {
    for (const ref of refs) {
      const text = read(ref.file);
      if (text === null || text === undefined) {
        out.push({
          opId,
          problem: `operations["${opId}"]: ${ref.label} のファイル ${ref.file} ${unreadable}`,
        });
      } else if (!symbolIn(text, ref.symbol)) {
        out.push({
          opId,
          problem: `operations["${opId}"]: ${ref.label} の ${ref.symbol} が ${ref.file} に見つからない`,
        });
      }
    }
  }
  return out;
}

/**
 * 移行元ソースを走査して呼び出し箇所を列挙する。
 * @param {string} root
 * @param {string[]} paths
 * @param {{ patterns: { id: string, re: RegExp }[], label?: string }} scan - label はエラーに出す走査範囲の名前
 * @returns {{ files: number, texts: Map<string, string>, sites: { file: string, line: number, column: number, pattern: string }[] }}
 */
export function scanSources(root, paths, { patterns, label = "feedback_calls.source.paths" }) {
  const absRoot = resolve(root);
  const unique = listScanFiles(absRoot, paths, label);
  /** @type {{ file: string, line: number, column: number, pattern: string }[]} */
  const sites = [];
  /** @type {Map<string, string>} 走査したファイル（/ 区切りの相対パス）→ 本文。ハンドラの出所の照合に使う */
  const texts = new Map();
  let scanned = 0;
  for (const abs of unique) {
    const buf = readFileSync(abs);
    if (buf.includes(0)) continue; // バイナリは走査しない
    scanned += 1;
    const text = buf.toString("utf8");
    const file = relative(absRoot, abs).split(sep).join("/");
    texts.set(file, text);
    sites.push(...matchSites(text, file, patterns));
  }
  return { files: scanned, texts, sites };
}

/**
 * 走査範囲のパスから、走査するファイルの絶対パスを重複なく並べて返す。
 * @param {string} absRoot
 * @param {string[]} paths
 * @param {string} label - エラーに出す走査範囲の名前
 * @returns {string[]}
 */
function listScanFiles(absRoot, paths, label) {
  /** @type {string[]} */
  const files = [];
  /** @param {string} abs */
  const visit = (abs) => {
    const st = statSync(abs);
    if (st.isDirectory()) {
      for (const name of readdirSync(abs).sort()) {
        if (SKIP_DIRS.has(name)) continue;
        visit(join(abs, name));
      }
    } else if (st.isFile()) {
      files.push(abs);
    }
  };
  for (const p of paths) {
    if (isAbsolute(p)) throw new UsageError(`${label} に絶対パスがある: ${p}`);
    const abs = resolve(absRoot, p);
    const rel = relative(absRoot, abs);
    if (rel === ".." || rel.startsWith(`..${sep}`)) {
      throw new UsageError(`${label} がルートの外を指す: ${p}`);
    }
    try {
      visit(abs);
    } catch (e) {
      throw new UsageError(`${label} を読めない: ${p}（${errorMessage(e)}）`);
    }
  }
  return [...new Set(files)].sort();
}

/**
 * 1 ファイルの本文をパターンで照合し、一致した箇所（行・列は 1 始まり）を返す。
 * @param {string} text
 * @param {string} file - --root からの / 区切りの相対パス
 * @param {{ id: string, re: RegExp }[]} patterns
 * @returns {{ file: string, line: number, column: number, pattern: string }[]}
 */
function matchSites(text, file, patterns) {
  // 行ごとに切ってから照合すると、改行をまたぐ呼び出し（名前と括弧が別の行）を検出できない。
  // ファイル全体に照合し、一致位置から行・列を求める
  const lineStarts = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "\n") lineStarts.push(i + 1);
  }
  const sites = [];
  for (const p of patterns) {
    p.re.lastIndex = 0;
    for (let m = p.re.exec(text); m !== null; m = p.re.exec(text)) {
      const lo = lineIndexOf(lineStarts, m.index);
      sites.push({ file, line: lo + 1, column: m.index - lineStarts[lo] + 1, pattern: p.id });
      if (m[0] === "") p.re.lastIndex += 1; // 空一致で止まらない
    }
  }
  return sites;
}

/**
 * 文字の位置を含む行の番号（0 始まり）を、行頭の位置の一覧から二分探索で求める。
 * @param {number[]} lineStarts - 各行の先頭の位置（昇順。先頭は 0）
 * @param {number} index
 * @returns {number}
 */
function lineIndexOf(lineStarts, index) {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= index) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * 網羅表を検査する。
 * @param {unknown} table
 * @param {{ root?: string, recorded?: boolean, captureStates?: Set<string> | null, pageNames?: Set<string> | null, slug?: string | null, target?: string | null, targetCommit?: unknown, testIndex?: ReturnType<typeof indexTestList> | null, specs?: ReturnType<typeof specsFingerprint> | null, pageResolution?: import("./page-identity.mjs").PageResolution | null, coverageCaptures?: { page: string, captured: string, label: string, shared: boolean }[] | null, coverageProblem?: string | null, coverageSkipped?: number, operationTraces?: string[] | null }} [opts]
 *   targetCommit は metadata.json の target.commit（undefined なら照合しない。null / none は照合不能として扱う）。
 */
export function checkReactions(table, opts = {}) {
  const ctx = reactionOptions(opts);
  if (!isPlainObject(table)) throw new UsageError("反応の網羅表がオブジェクトでない");
  const env = tableEnv(table, ctx);
  const { problems, state, operations } = env;
  for (const op of operations) {
    if (!isPlainObject(op) || !nonEmptyString(op.id) || !env.opIds.has(op.id)) continue;
    checkOperation(op, op.id, env);
  }
  // none の観測時間の下限が観測済みの遅れ以下だと、遅れて出る反応を「無い」と記録しても通る
  const { windowMs } = env;
  if (windowMs !== null && state.maxObservedDelay !== null && windowMs <= state.maxObservedDelay) {
    problems.push(
      `observation_window_ms（${windowMs}）が observed の遅れの最大値（${state.maxObservedDelay}）以下（none の観測が遅れて出る反応を取りこぼす）`,
    );
  }
  // --- 移行元のフィードバック呼び出しとの突き合わせ ---
  const callSummary = checkFeedbackCalls(table.feedback_calls, env);
  const sideEffects = checkWritesAndResubmits(table, env);
  const stateDisplays = checkDisplaysAndCaptures(table, env);
  // --- covered_by の解決・共有と、assertion の深さの監査の記録 ---
  const fingerprint = tableFingerprint(table);
  const { owners, coveredBy } = checkCoveredBy(table, fingerprint, env);
  // --- 記録済みの照合結果（--recorded）---
  if (ctx.recorded) problems.push(...recordedProblems(table, { fingerprint, sideEffects, owners }));
  const { coverageCaptures, coverageSkipped } = ctx;
  return {
    operations: operations.length,
    reactions: state.reactionCount,
    unmeasured_operations: state.unmeasuredOps.size,
    call_sites: callSummary,
    side_effect_writes: sideEffects,
    state_displays: stateDisplays,
    capture_page_urls: state.capturePageUrls,
    // 部品網羅表の撮る状態を何行数えたか（null は部品網羅表を宣言していない＝表をまたいだ照合の相手が無い）
    coverage_captures:
      coverageCaptures === null
        ? null
        : { counted: coverageCaptures.length, skipped: coverageSkipped },
    covered_by: { owners: owners.length, resolved: coveredBy.resolved },
    table_fingerprint: fingerprint,
    problems,
  };
}

/**
 * checkReactions の opts のデフォルトを埋めたもの。
 * @typedef {{ root: string, recorded: boolean, captureStates: Set<string> | null, pageNames: Set<string> | null, slug: string | null, target: string | null, targetCommit: unknown, testIndex: TestIndex | null, specs: { fingerprint: string | null, problems: string[] } | null, pageResolution: import("./page-identity.mjs").PageResolution | null, coverageCaptures: { page: string, captured: string, label: string, shared: boolean }[] | null, coverageProblem: string | null, coverageSkipped: number, traces: string[] | null }} ReactionOptions
 */

/**
 * 操作を走査しながら集める状態。
 * @typedef {{
 *   reactionKinds: Map<unknown, string>,
 *   reactionCount: number,
 *   maxObservedDelay: number | null,
 *   unmeasuredOps: Set<string>,
 *   aftermathCaptureUses: Map<string, CaptureUse[]>,
 *   capturePageUrls: { checked: boolean, reason: string | null, operations: number },
 *   capturePageNeedsResolution: boolean,
 *   captureLabel: Map<string, string>,
 *   handlersByOp: Map<string, unknown>,
 *   preSendRefsByOp: Map<string, SourceRef[]>,
 * }} OperationState
 * reactionKinds: 反応キー（<操作 id>/<反応 id>）→ kind。call_sites の対応付け先。
 * maxObservedDelay: observed の delay_ms_samples の最大値（observation_window_ms の下限照合に使う）。
 * aftermathCaptureUses: [解決したページ, 撮る状態名] → 割り当てた行（状態表示・部品網羅表の行は opId: null）。
 * capturePageUrls: 押した後の URL と名乗ったページの照合。照合できないときは理由を出力に残す（警告なしに照合済みにしない）。
 * captureLabel: 使い回しの照合のキー → 人が読む名前（最初に現れたページ名 × 状態名）。
 * handlersByOp: 操作 id → handlers（移行元ソースとの突き合わせで照合する）。
 * preSendRefsByOp: 操作 id → 送る前の判定の到達点と判定の場所。
 */

/**
 * checkReactions の各検査に渡す値（opts と、表の最上位の欄を読んだ結果と、操作を走査しながら集める状態）。
 * @typedef {ReactionOptions & { problems: string[], documents: Set<string> | null, windowMs: number | null, screenStates: string[] | null, operations: unknown[], opIds: Set<string>, state: OperationState }} ReactionEnv
 */

/**
 * checkReactions の opts のデフォルトを埋める。
 * @param {NonNullable<Parameters<typeof checkReactions>[1]>} opts
 * @returns {ReactionOptions}
 */
function reactionOptions(opts) {
  const {
    root = process.cwd(),
    recorded = false,
    captureStates = null,
    pageNames = null,
    slug = null,
    target = null,
    targetCommit,
    testIndex = null,
    specs = null,
    pageResolution = null,
    coverageCaptures = null,
    coverageProblem = null,
    coverageSkipped = 0,
    operationTraces: traces = null,
  } = opts;
  return {
    root,
    recorded,
    captureStates,
    pageNames,
    slug,
    target,
    targetCommit,
    testIndex,
    specs,
    pageResolution,
    coverageCaptures,
    coverageProblem,
    coverageSkipped,
    traces,
  };
}

/**
 * 表の最上位の欄（slug・文書・観測時間・画面の状態・操作）を読み、各検査に渡す値を作る。
 * @param {Record<string, unknown>} table
 * @param {ReactionOptions} ctx
 * @returns {ReactionEnv}
 */
function tableEnv(table, ctx) {
  /** @type {string[]} */
  const problems = [];
  // 別機能・別 target の表を取り違えて通さない（metadata.json 側の値が無ければ照合できないので main が落とす）
  if (ctx.slug !== null && table.slug !== ctx.slug) {
    problems.push(
      `網羅表の slug（${String(table.slug)}）が metadata.json の slug（${ctx.slug}）と違う`,
    );
  }
  if (ctx.target !== null && table.measured_target !== ctx.target) {
    problems.push(
      `網羅表の measured_target（${String(table.measured_target)}）が metadata.json の target.name（${ctx.target}）と違う`,
    );
  }
  const documents = readDocuments(table.documents, problems);
  const crossOrigin = readDocumentOrigins(table.document_origins, documents, problems);
  crossOriginEvidenceProblems(table.cross_origin_evidence, crossOrigin, problems);
  const windowMs = readObservationWindow(table, problems);
  const screenStates = readScreenStates(table.screen_states, problems);
  const operations = readOperations(table, ctx.traces, problems);
  const opIds = collectIds(operations, "operations", problems);
  const state = newOperationState(ctx.pageResolution);
  return { ...ctx, problems, documents, windowMs, screenStates, operations, opIds, state };
}

/**
 * 文書の棚卸し（最上位の文書 top と全フレーム）を読む。none の観測範囲と出る先の照合に使う。
 * @param {unknown} docs - 表の documents
 * @param {string[]} problems
 * @returns {Set<string> | null} 読めなければ null
 */
function readDocuments(docs, problems) {
  if (!isArray(docs) || docs.length === 0 || !docs.every(nonEmptyString)) {
    problems.push("documents が空でない文字列の配列でない（top と全フレームを棚卸ししていない）");
  } else if (new Set(docs).size !== docs.length) {
    problems.push("documents に重複がある");
  } else if (!docs.some((d) => d === "top")) {
    problems.push("documents に top（最上位の文書）が無い");
  } else {
    return new Set(docs);
  }
  return null;
}

/**
 * 文書ごとのオリジン（対象 URL と同じか）を読み、別オリジンの文書を返す。
 * 移行元が絶対 URL で組み立てるフレームの読み込み先と targets[].url のオリジンが違うと、フレームの中の処理が親の文書に届かず、
 * 実在する反応が「無い」と記録される。差分ツールは「無い」同士で一致させてしまうので、別オリジンの文書には根拠を要求する
 * @param {unknown} origins - 表の document_origins
 * @param {Set<string> | null} documents
 * @param {string[]} problems
 * @returns {string[] | null} 別オリジンの文書（読めなければ null）
 */
function readDocumentOrigins(origins, documents, problems) {
  if (!isPlainObject(origins)) {
    problems.push(
      "document_origins が無い（documents の各文書のオリジンが対象 URL と同じか〈same-origin / cross-origin〉を記録していない）",
    );
    return null;
  }
  if (!documents) return null;
  const keys = Object.keys(origins);
  const lacking = [...documents].filter((d) => !Object.hasOwn(origins, d));
  const unknown = keys.filter((k) => !documents.has(k));
  const invalid = keys.filter(
    (k) => documents.has(k) && !listIncludes(ORIGIN_RELATIONS, origins[k]),
  );
  if (lacking.length > 0) problems.push(`document_origins に無い文書: ${lacking.join(", ")}`);
  if (unknown.length > 0)
    problems.push(`document_origins に表の documents に無い文書がある: ${unknown.join(", ")}`);
  if (invalid.length > 0) {
    problems.push(
      `document_origins の値が ${ORIGIN_RELATIONS.join(" / ")} でない文書: ${invalid.join(", ")}`,
    );
  }
  if (lacking.length === 0 && unknown.length === 0 && invalid.length === 0) {
    return keys.filter((k) => origins[k] === "cross-origin");
  }
  return null;
}

/**
 * 別オリジンの文書ごとの根拠（cross_origin_evidence）の欠けと、古い根拠を problems に積む。
 * 根拠は別オリジンの文書ごとに持たせる。表全体で 1 本だと、意図して別オリジンにした文書の根拠が
 * 環境の都合で別オリジンになった文書まで通してしまう
 * @param {unknown} evidence - 表の cross_origin_evidence
 * @param {string[] | null} crossOrigin
 * @param {string[]} problems
 */
function crossOriginEvidenceProblems(evidence, crossOrigin, problems) {
  if (!isPlainObject(evidence)) {
    problems.push(
      'cross_origin_evidence が文書ごとの根拠のオブジェクトでない（{ "<文書>": "<根拠>" }。別オリジンの文書が無ければ {} と書く。キーの欠落を根拠不要として扱わない）',
    );
    return;
  }
  if (crossOrigin === null) return;
  const lackingEvidence = crossOrigin.filter((d) => !nonEmptyString(evidence[d]));
  if (lackingEvidence.length > 0) {
    problems.push(
      `文書 ${lackingEvidence.join(", ")} が対象 URL と別オリジンなのに cross_origin_evidence にその文書の根拠が無い（移行元の本来の配置でも別オリジンになることを、移行元が組み立てる絶対 URL 等で確かめた根拠を文書ごとに書く。環境の都合で別オリジンになっているなら、targets[].url をそのオリジンに揃えて測り直す）`,
    );
  }
  const staleEvidence = Object.keys(evidence).filter((d) => !crossOrigin.includes(d));
  if (staleEvidence.length > 0) {
    problems.push(
      `cross_origin_evidence に別オリジンでない文書の根拠が残っている: ${staleEvidence.join(", ")}（古い記録。どの文書の根拠かが実測と合わない）`,
    );
  }
}

/**
 * none の観測時間の下限（observation_window_ms）を読む。
 * @param {Record<string, unknown>} table
 * @param {string[]} problems
 * @returns {number | null}
 */
function readObservationWindow(table, problems) {
  const windowMs = positiveNumber(table.observation_window_ms) ? table.observation_window_ms : null;
  // 操作の無い表には none の反応が無いので、観測時間の下限は null でよい（測っていない値を書かせない）。
  // 正の数を書いた表も通す。照合する none が無いので値は判定に使われず、落とす理由が無い
  const noOperations = isArray(table.operations) && table.operations.length === 0;
  if (windowMs === null && !(noOperations && table.observation_window_ms === null))
    problems.push(
      `observation_window_ms が正の数でない（none の観測時間の下限が無い${noOperations ? "。操作の無い表では null と書く" : ""}）`,
    );
  return windowMs;
}

/**
 * 画面が持つ状態の棚卸し（screen_states）を読む。押した後に戻す範囲を、操作ごとの自己申告ではなくこの一覧と突き合わせる。
 * @param {unknown} ss - 表の screen_states
 * @param {string[]} problems
 * @returns {string[] | null} 読めなければ null
 */
function readScreenStates(ss, problems) {
  if (
    !isPlainObject(ss) ||
    !isArray(ss.states) ||
    !ss.states.every(filled) ||
    new Set(ss.states).size !== ss.states.length
  ) {
    problems.push(
      "screen_states.states が重複の無い空でない文字列の配列でない（画面が持つ状態〈検索条件・並べ替え・列フィルター・列の変更・行の選択・ページ送り等〉の棚卸し。持たないなら空配列）",
    );
  } else if (!filled(ss.source)) {
    problems.push(
      "screen_states.source が空（状態の棚卸しをどこから列挙したか〈移行元ソースの状態を持つ変数・URL のクエリ・実 UI〉が残らない）",
    );
  } else {
    return ss.states;
  }
  return null;
}

/**
 * 操作の一覧（operations）を読み、操作の無い表の理由（operations_none_reason）と突き合わせる。
 * @param {Record<string, unknown>} table
 * @param {string[] | null} traces - 成果物に残った操作の痕跡
 * @param {string[]} problems
 * @returns {unknown[]}
 */
function readOperations(table, traces, problems) {
  const operations = isArray(table.operations) ? table.operations : null;
  if (operations === null) throw new UsageError("operations が配列でない");
  // 操作の無い表は、理由を書いたときだけ正規の記録として通す（理由の無い 0 件は採り忘れと区別できない）。
  // 画面の状態表示の振り分けは操作の有無に依らず下で数える
  const noneReason = table.operations_none_reason;
  if (operations.length === 0) {
    if (!filled(noneReason)) {
      problems.push(
        "operations が空なのに operations_none_reason が空・テンプレートの説明文のまま（操作を持たない機能は、画面に押せる要素が無いことをどう確かめたかを書く）",
      );
    }
    // 操作の痕跡（コンテナの棚卸し・部品網羅表の宣言）がある機能は、操作を持たないと言えない
    if (traces !== null && traces.length > 0) {
      problems.push(`operations が空だが、操作の痕跡がある（${traces.join(" / ")}）`);
    }
  } else if (noneReason !== undefined && noneReason !== null) {
    problems.push(
      "operations があるのに operations_none_reason が null でない（操作が無いことの理由と操作の記録が同時に成立する）",
    );
  }
  return operations;
}

/**
 * 操作を走査する前の、空の状態を作る。
 * @param {import("./page-identity.mjs").PageResolution | null} pageResolution
 * @returns {OperationState}
 */
function newOperationState(pageResolution) {
  return {
    reactionKinds: new Map(),
    reactionCount: 0,
    maxObservedDelay: null,
    unmeasuredOps: new Set(),
    aftermathCaptureUses: new Map(),
    capturePageUrls: {
      checked: pageResolution !== null && pageResolution.resolvable,
      reason:
        pageResolution === null
          ? "metadata.json の capture_conditions.pages が無い"
          : pageResolution.reason,
      operations: 0,
    },
    capturePageNeedsResolution: false,
    captureLabel: new Map(),
    handlersByOp: new Map(),
    preSendRefsByOp: new Map(),
  };
}

/**
 * 操作 1 つを検査する。
 * @param {Record<string, unknown>} op
 * @param {string} opId
 * @param {ReactionEnv} env
 */
function checkOperation(op, opId, env) {
  const { problems, state } = env;
  const label = `operations["${opId}"]`;
  /** @param {string} msg */
  const fail = (msg) => {
    problems.push(`${label}: ${msg}`);
    state.unmeasuredOps.add(opId);
  };
  /** @param {Finding} f */
  const report = (f) => {
    if (f.unmeasured) fail(f.problem);
    else problems.push(`${label}: ${f.problem}`);
  };
  if (!nonEmptyString(op.trigger)) fail("trigger（操作アダプタの呼び出し）が空");
  if (!nonEmptyString(op.immediate_state)) fail("immediate_state（直後の状態）が空");
  const lp = layoutProblem(op.layout);
  if (lp.problem) report({ problem: lp.problem, unmeasured: lp.unmeasured });
  // 押した後に残る見た目と戻り先。欠けは layout と同じく未測定に数える
  for (const ap of aftermathProblems(op.aftermath, env)) report(ap);
  // 送る前の判定。欠けは layout と同じく未測定に数える
  const ps = preSendProblems(op.pre_send);
  for (const pp of ps.problems) report(pp);
  state.preSendRefsByOp.set(opId, ps.refs);
  const page = operationCapturePage(op, env, fail);
  collectOperationCaptures(op, { opId, label, page }, env);
  state.handlersByOp.set(opId, op.handlers);
  checkOperationReactions(op, { opId, label, fail }, env);
}

/**
 * 押した後に残る見た目と戻り先（aftermath）の欠けを返す。
 * @param {unknown} am - op.aftermath
 * @param {ReactionEnv} env
 * @returns {Finding[]}
 */
function aftermathProblems(am, env) {
  if (!isPlainObject(am)) {
    return [
      {
        problem:
          "aftermath が無い（押した後に残る見た目〈look〉と戻り先〈returns_to〉を測っていない）",
        unmeasured: true,
      },
    ];
  }
  return [
    ...aftermathLookProblems(am.look, env.captureStates),
    ...aftermathReturnsProblems(am.returns_to, env.screenStates),
  ];
}

/**
 * 操作が押した後に撮ったページを決める（決められなければ null）。名乗ったページは押した後の URL とも照合する。
 * 撮影の単位はページ × 状態名 × ビューポートなので、別のページの同じ状態名は別の 1 枚（baseline.md）。
 * 割る単位は操作が載るページではなく、押した後に撮ったページ（capture_page。遷移する操作は遷移先）。
 * 載るページで割ると、別のページから同じ遷移先へ移る 2 操作が 1 枚を共有しても通ってしまう（Codex レビュー）。
 * 省略は同じページとみなして使い回しを厳しく見る
 * @param {Record<string, unknown>} op
 * @param {ReactionEnv} env
 * @param {(msg: string) => void} fail
 * @returns {string | null}
 */
function operationCapturePage(op, env, fail) {
  const { pageNames } = env;
  let page = namedCapturePage(op, env, fail);
  // ページが 2 つ以上ある機能で capture_page を省くと、撮った状態がどのページの 1 枚かを決められない
  // （別のページの同名の 1 枚でも行が満たされる）。ページが 1 つだけならそのページとみなす
  const consumesCapture = consumesCaptureState(op);
  if (page === null && op.capture_page == null && consumesCapture && pageNames !== null) {
    if (pageNames.size === 1) page = [...pageNames][0];
    else if (pageNames.size > 1)
      fail(
        "capture_page が無い（撮る状態を持つ操作は、capture_conditions.pages が 2 つ以上なら押した後に撮ったページを書く）",
      );
  }
  // 名乗ったページが本当に撮ったページかを、押した後の URL（returns_to.url_after）を宣言済みのページへ解決して確かめる。
  // 解決規則は page-identity.mjs（原本は baseline.md「ページの path の解決規則」）。別名のページ（path が同じ別の名前）は同じ 1 枚として通す。
  // 戻り先を測っていない操作は returns_to の欠けとして別の箇所で不合格になるので、ここでは照合しない
  if (page !== null && consumesCapture) {
    env.state.capturePageNeedsResolution = true;
    checkCapturePageUrl(page, op.aftermath, { env, fail });
  }
  return page;
}

/**
 * 操作が名乗った capture_page を、metadata.json の capture_conditions.pages と照合して返す（無い・不正なら null）。
 * @param {Record<string, unknown>} op
 * @param {ReactionEnv} env
 * @param {(msg: string) => void} fail
 * @returns {string | null}
 */
function namedCapturePage(op, env, fail) {
  const { pageNames, captureStates } = env;
  if (op.capture_page === undefined || op.capture_page === null) return null;
  if (!filled(op.capture_page))
    fail("capture_page が空でない文字列でない（省略するか capture_conditions.pages の名前を書く）");
  else if (pageNames === null && captureStates !== null)
    fail(
      `capture_page "${op.capture_page}" を照合できない（metadata.json の capture_conditions.pages を読めない）`,
    );
  else if (pageNames !== null && !pageNames.has(op.capture_page))
    fail(`capture_page "${op.capture_page}" が metadata.json の capture_conditions.pages に無い`);
  else return op.capture_page;
  return null;
}

/**
 * 操作が撮る状態を持つか（観測した反応の capture.state か、残る見た目の captured）。
 * @param {Record<string, unknown>} op
 * @returns {boolean}
 */
function consumesCaptureState(op) {
  return (
    (isArray(op.reactions) ? op.reactions : []).some(
      (r) =>
        isPlainObject(r) &&
        r.kind === "observed" &&
        isPlainObject(r.capture) &&
        filled(r.capture.state),
    ) ||
    (isPlainObject(op.aftermath) &&
      isPlainObject(op.aftermath.look) &&
      isArray(op.aftermath.look.items) &&
      op.aftermath.look.items.some((it) => isPlainObject(it) && filled(it.captured)))
  );
}

/**
 * 名乗ったページと、押した後の URL（returns_to.url_after）を解決したページが一致するかを確かめる。
 * @param {string} page
 * @param {unknown} am - op.aftermath
 * @param {{ env: ReactionEnv, fail: (msg: string) => void }} ctx
 */
function checkCapturePageUrl(page, am, { env, fail }) {
  const { pageResolution } = env;
  const ret = isPlainObject(am) ? am.returns_to : undefined;
  const urlAfter = isPlainObject(ret) && ret.measured === true ? ret.url_after : undefined;
  const named = pageResolution?.pages.get(page);
  if (pageResolution !== null && pageResolution.resolvable && named && filled(urlAfter)) {
    env.state.capturePageUrls.operations += 1;
    const got = pageForUrl(urlAfter, pageResolution);
    if (got.problem !== null) {
      fail(
        `aftermath.returns_to.url_after ${got.problem}（押した後に撮ったページ "${page}" と照合できない）`,
      );
    } else if (got.page !== null && got.page.key !== named.key) {
      fail(
        `押した後に撮ったページを "${page}" と名乗っているが、押した後の URL ${String(urlAfter)} は "${got.page.name}" に解決する（capture_page に押した後に撮ったページを書く）`,
      );
    }
  }
}

/**
 * 操作の撮る状態（観測した反応の capture.state と、残る見た目の captured）を、使い回しの照合の集合に足す。
 * @param {Record<string, unknown>} op
 * @param {{ opId: string, label: string, page: string | null }} where
 * @param {ReactionEnv} env
 */
function collectOperationCaptures(op, { opId, label, page }, env) {
  const { pageResolution } = env;
  const { captureLabel, aftermathCaptureUses } = env.state;
  // 使い回しは解決したページ × 状態名で数える（別名で同じページを指す 2 つの名前は同じ 1 枚）
  const captureKey = (/** @type {string} */ state) => {
    const key = JSON.stringify([page === null ? null : pageKey(page, pageResolution), state]);
    if (!captureLabel.has(key))
      captureLabel.set(key, page === null ? state : `${page} の ${state}`);
    return key;
  };
  // 撮る状態へ割り当てた残る見た目を、ページ × 状態名ごとに集める（使い回しの照合は全操作を見た後）
  const am = op.aftermath;
  const lookItems =
    isPlainObject(am) && isPlainObject(am.look) && isArray(am.look.items) ? am.look.items : [];
  // 観測した反応の capture.state も同じ状態名の集合に入れる（別の操作の残る見た目と 1 枚を共有しても通さない）
  for (const r of isArray(op.reactions) ? op.reactions : []) {
    if (!isPlainObject(r) || r.kind !== "observed" || !isPlainObject(r.capture)) continue;
    if (!filled(r.capture.state) || !nonEmptyString(r.id)) continue;
    addCaptureUse(aftermathCaptureUses, captureKey(r.capture.state), {
      opId,
      label: `${label}: reactions["${r.id}"].capture`,
      shared: filled(r.capture.shared_capture_reason),
      source: "reactions",
      page,
    });
  }
  for (const item of lookItems) {
    if (!isPlainObject(item) || !filled(item.captured) || !nonEmptyString(item.id)) continue;
    addCaptureUse(aftermathCaptureUses, captureKey(item.captured), {
      opId,
      label: `${label}: aftermath.look.items["${item.id}"]`,
      shared: filled(item.shared_capture_reason),
      source: "reactions",
      page,
    });
  }
}

/**
 * 操作の反応（reactions）を検査する。
 * @param {Record<string, unknown>} op
 * @param {{ opId: string, label: string, fail: (msg: string) => void }} where
 * @param {ReactionEnv} env
 */
function checkOperationReactions(op, { opId, label, fail }, env) {
  const reactions = isArray(op.reactions) ? op.reactions : [];
  if (reactions.length === 0) {
    fail("reactions が空（反応の欄が無い＝見ていない。無いなら kind: none を実測で書く）");
    return;
  }
  const rIds = collectIds(reactions, `${label}.reactions`, env.problems);
  if (rIds.size !== reactions.length) env.state.unmeasuredOps.add(opId);
  const kinds = reactions.map((r) => (isPlainObject(r) ? r.kind : undefined));
  if (kinds.includes("none") && reactions.length > 1)
    fail("kind: none と他の反応が同居している（無いと在るが同時に成立する）");
  for (const r of reactions) {
    if (!isPlainObject(r) || !nonEmptyString(r.id) || !rIds.has(r.id)) continue;
    checkReaction(r, { opId, fail }, env);
  }
}

/**
 * 反応 1 つを検査する。
 * @param {Record<string, unknown>} r
 * @param {{ opId: string, fail: (msg: string) => void }} where
 * @param {ReactionEnv} env
 */
function checkReaction(r, { opId, fail }, env) {
  const { state } = env;
  state.reactionCount += 1;
  const rLabel = `reactions["${String(r.id)}"]`;
  if (typeof r.kind !== "string" || !REACTION_KINDS.includes(r.kind)) {
    fail(`${rLabel}: kind が語彙（${REACTION_KINDS.join(" / ")}）に無い`);
    return;
  }
  state.reactionKinds.set(`${opId}/${String(r.id)}`, r.kind);
  if (r.kind === "unmeasured") {
    fail(
      `${rLabel}: unmeasured${nonEmptyString(r.reason) ? `（${r.reason}）` : "（reason が空）"}`,
    );
    return;
  }
  const p =
    r.kind === "observed"
      ? observedProblem(r, env.captureStates, env.documents)
      : noneProblem(r, env.windowMs, env.documents);
  if (p) fail(`${rLabel}: ${p}`);
  if (r.kind === "observed" && isPlainObject(r.appearance)) {
    const d = r.appearance.delay_ms_samples;
    if (isArray(d) && d.length > 0 && d.every(nonNegativeNumber)) {
      state.maxObservedDelay = Math.max(state.maxObservedDelay ?? 0, ...d);
    }
  }
}

/**
 * 移行元のフィードバック呼び出し（feedback_calls）と突き合わせる。
 * @param {unknown} fc - 表の feedback_calls
 * @param {ReactionEnv} env
 * @returns {Record<string, unknown>}
 */
function checkFeedbackCalls(fc, env) {
  if (!isPlainObject(fc) || typeof fc.declared !== "boolean") {
    throw new UsageError("feedback_calls.declared が真偽値でない（キーごと省略しない）");
  }
  /** @type {Record<string, unknown>} */
  const callSummary = { checked: false, found: null, recorded: null, files: null };
  if (fc.declared === false) undeclaredFeedbackProblems(fc, env);
  else checkDeclaredFeedbackCalls(fc, env, callSummary);
  return callSummary;
}

/**
 * feedback_calls.declared: false の記録を検査する。
 * @param {Record<string, unknown>} fc
 * @param {ReactionEnv} env
 */
function undeclaredFeedbackProblems(fc, env) {
  const { problems, recorded, root } = env;
  if (!nonEmptyString(fc.reason))
    problems.push("feedback_calls.declared: false なのに reason が空");
  // 走査範囲が無くても、送る前の判定の到達点と判定の場所は --root から直接読んで照合する。
  // 照合しないと、存在しないファイル・関数を書いた pre_send が完全な記録として通る（code-review）。
  // 移行元ソースを読めない環境では到達点まで追えないので、found: null と理由で未測定にする
  if (!recorded) {
    for (const { opId, problem } of preSendRefProblems(
      env.state.preSendRefsByOp,
      (file) => readSourceFile(root, file),
      "を --root から読めない（--root からの / 区切りの相対パスで書く。移行元ソースを読めないなら pre_send.found: null と理由を書く）",
    )) {
      problems.push(problem);
      env.state.unmeasuredOps.add(opId);
    }
  }
}

/**
 * feedback_calls.declared: true の記録を、移行元ソースの走査と突き合わせる。
 * @param {Record<string, unknown>} fc
 * @param {ReactionEnv} env
 * @param {Record<string, unknown>} callSummary
 */
function checkDeclaredFeedbackCalls(fc, env, callSummary) {
  const { problems } = env;
  const patterns = isArray(fc.patterns) ? fc.patterns : [];
  if (patterns.length === 0)
    problems.push("feedback_calls.patterns が空（突き合わせる呼び出しが無い）");
  const label = "feedback_calls.patterns";
  const patIds = collectIds(patterns, label, problems);
  const compiled = compilePatterns(patterns, { patIds, label, problems });
  const zeroReason = nonEmptyString(fc.zero_calls_reason);
  const recordedSites = isArray(fc.call_sites) ? fc.call_sites : null;
  if (recordedSites === null) throw new UsageError("feedback_calls.call_sites が配列でない");
  const recordedCount = recordCallSites(recordedSites, env);
  const src = fc.source;
  const paths = isPlainObject(src) && isArray(src.paths) ? src.paths : [];
  problems.push(...sourceProblems(src, env.targetCommit, "feedback_calls.source"));
  callSummary.recorded = recordedSites.length;
  const handlerRefs = collectHandlerRefs(env);
  // 呼び出し 0 件は「本当に無い」と「走査が外れている」が同じ出力になるため、根拠付きでだけ通す
  if (recordedSites.length === 0 && !zeroReason) {
    problems.push(
      "feedback_calls.call_sites が 0 件なのに zero_calls_reason が空（走査が外れていないことを示せない）",
    );
  }
  if (recordedSites.length > 0 && zeroReason) {
    problems.push(
      "feedback_calls.call_sites があるのに zero_calls_reason が埋まっている（0 件の根拠と矛盾する）",
    );
  }
  if (!env.recorded && paths.length > 0 && paths.every(nonEmptyString) && compiled.length > 0) {
    const scan = scanSources(env.root, paths, { patterns: compiled });
    callSummary.checked = true;
    callSummary.files = scan.files;
    callSummary.found = scan.sites.length;
    compareFeedbackScan(scan, { handlerRefs, recordedCount }, env);
  }
}

/**
 * 記録した呼び出し箇所（feedback_calls.call_sites）を検査し、照合キーごとの件数を返す。
 * @param {unknown[]} recordedSites
 * @param {ReactionEnv} env
 * @returns {Map<string, number>}
 */
function recordCallSites(recordedSites, env) {
  const { problems } = env;
  /** @type {Map<string, number>} */
  const recordedCount = new Map();
  for (const s of recordedSites) {
    if (!isSiteRow(s)) {
      problems.push("feedback_calls.call_sites: file / line / column / pattern が欠けた行がある");
      continue;
    }
    const key = siteKeyOf(s);
    recordedCount.set(key, (recordedCount.get(key) ?? 0) + 1);
    const hasReaction = nonEmptyString(s.reaction);
    const hasExcluded = nonEmptyString(s.excluded_reason);
    if (hasReaction === hasExcluded) {
      problems.push(`call_sites ${key}: reaction と excluded_reason のどちらか一方だけを埋める`);
    } else if (hasReaction) {
      checkCallSiteReaction(s.reaction, key, env);
    }
  }
  pushDuplicateSites(recordedCount, "call_sites", problems);
  return recordedCount;
}

/**
 * 呼び出し箇所が対応付けた反応が、網羅表の観測した反応（kind: observed）かを検査する。
 * 観測していない反応なら、その操作を未測定に数える。
 * @param {unknown} reaction - 呼び出し箇所の reaction
 * @param {string} key - 呼び出し箇所の照合キー
 * @param {ReactionEnv} env
 */
function checkCallSiteReaction(reaction, key, env) {
  const { problems, opIds, state } = env;
  const kind = state.reactionKinds.get(reaction);
  if (kind === undefined)
    problems.push(`call_sites ${key}: reaction "${String(reaction)}" が網羅表の反応に無い`);
  else if (kind !== "observed") {
    problems.push(
      `call_sites ${key}: reaction "${String(reaction)}" は kind: ${kind}（呼び出しがあるのに観測した反応へ対応付いていない）`,
    );
    const opId = String(reaction).split("/")[0];
    if (opIds.has(opId)) state.unmeasuredOps.add(opId);
  }
}

/**
 * 記録した箇所の照合キーのうち、2 回以上現れたものを problems に積む。
 * @param {Map<string, number>} recordedCount
 * @param {string} label - 指摘の先頭に付ける欄の名前
 * @param {string[]} problems
 */
function pushDuplicateSites(recordedCount, label, problems) {
  for (const [key, n] of recordedCount) {
    if (n > 1) problems.push(`${label} ${key}: ${n} 回重複している`);
  }
}

/**
 * 記録した箇所の 1 行が、照合キーの材料（file・line・1 以上の column・pattern）を揃えているか。
 * @param {unknown} s
 * @returns {s is Record<string, unknown> & { file: string, line: number, column: number, pattern: string }}
 */
function isSiteRow(s) {
  return (
    isPlainObject(s) &&
    nonEmptyString(s.file) &&
    isInteger(s.line) &&
    isInteger(s.column) &&
    s.column >= 1 &&
    nonEmptyString(s.pattern)
  );
}

/**
 * 操作のハンドラ（file と symbol）を集める。欠けた操作は problems に積み、未測定に数える。
 * ハンドラの出所: 走査範囲がどの操作のハンドラを覆っているかを表に残させる（範囲の書き忘れを操作単位で見えるようにする）
 * @param {ReactionEnv} env
 * @returns {{ opId: string, file: string, symbol: string }[]}
 */
function collectHandlerRefs(env) {
  /** @type {{ opId: string, file: string, symbol: string }[]} */
  const handlerRefs = [];
  for (const [opId, handlers] of env.state.handlersByOp) {
    if (!isArray(handlers) || handlers.length === 0 || !handlers.every(isHandlerRef)) {
      env.problems.push(
        `operations["${opId}"]: handlers（file と symbol）が空・欠けている（走査範囲が操作のハンドラを覆うか照合できない）`,
      );
      env.state.unmeasuredOps.add(opId);
      continue;
    }
    for (const h of handlers) handlerRefs.push({ opId, file: h.file, symbol: h.symbol });
  }
  return handlerRefs;
}

/**
 * 移行元ソースの走査の結果を、ハンドラ・送る前の判定の参照・記録した呼び出し箇所と突き合わせる。
 * @param {ReturnType<typeof scanSources>} scan
 * @param {{ handlerRefs: { opId: string, file: string, symbol: string }[], recordedCount: Map<string, number> }} recordedRefs
 * @param {ReactionEnv} env
 */
function compareFeedbackScan(scan, { handlerRefs, recordedCount }, env) {
  const { problems, state } = env;
  problems.push(...handlerScanProblems(handlerRefs, scan.texts, state.unmeasuredOps));
  // 送る前の判定の到達点と判定の場所も走査範囲に入れさせる。部品の内側まで範囲を広げると、
  // そこにあるフィードバック呼び出し（上限を超えたときの通知等）も call_sites に現れて反応と突き合わせられる
  for (const { opId, problem } of preSendRefProblems(
    state.preSendRefsByOp,
    (file) => scan.texts.get(file),
    "が走査範囲に無い・読めていない（feedback_calls.source.paths に部品の内側を含める）",
  )) {
    problems.push(problem);
    state.unmeasuredOps.add(opId);
  }
  if (scan.files === 0) problems.push("走査対象のテキストファイルが 0 件（走査範囲が誤っている）");
  const foundKeys = new Set(scan.sites.map(siteKeyOf));
  for (const key of foundKeys) {
    if (!recordedCount.has(key))
      problems.push(`call_sites: ソースの呼び出し ${key} が網羅表に記録されていない`);
  }
  for (const key of recordedCount.keys()) {
    if (!foundKeys.has(key))
      problems.push(
        `call_sites: 記録された ${key} がソースに見つからない（バージョンの食い違い・行ずれ）`,
      );
  }
}

/**
 * 操作のハンドラが走査したファイルにあるかを確かめる。見つからない操作は未測定に数える。
 * @param {{ opId: string, file: string, symbol: string }[]} handlerRefs
 * @param {Map<string, string>} texts - 走査したファイル → 本文
 * @param {Set<string>} unmeasuredOps
 * @returns {string[]}
 */
function handlerScanProblems(handlerRefs, texts, unmeasuredOps) {
  /** @type {string[]} */
  const problems = [];
  for (const h of handlerRefs) {
    const text = texts.get(h.file);
    if (text === undefined) {
      problems.push(
        `operations["${h.opId}"]: ハンドラのファイル ${h.file} が走査範囲に無い・読めていない`,
      );
      unmeasuredOps.add(h.opId);
      continue;
    }
    if (!symbolIn(text, h.symbol)) {
      problems.push(`operations["${h.opId}"]: ハンドラ ${h.symbol} が ${h.file} に見つからない`);
      unmeasuredOps.add(h.opId);
    }
  }
  return problems;
}

/**
 * 表への書き込みと、送っている間の押し直しを検査する。
 * @param {Record<string, unknown>} table
 * @param {ReactionEnv} env
 * @returns {ReturnType<typeof checkSideEffectWrites>}
 */
function checkWritesAndResubmits(table, env) {
  const { opIds, root, recorded, targetCommit, problems, operations } = env;
  // --- 表への書き込みとの突き合わせ ---
  /** @type {Set<string>} 表への書き込みを持つ操作 */
  const writeOps = new Set();
  const sideEffects = checkSideEffectWrites(table.side_effect_writes, {
    opIds,
    root,
    recorded,
    targetCommit,
    problems,
    writeOps,
  });
  // --- 送っている間の押し直し ---
  // 書き込みを持つ操作は表への書き込みの突き合わせが済んでから分かるので、操作の走査とは別に回す
  for (const op of operations) {
    if (!isPlainObject(op) || !nonEmptyString(op.id) || !opIds.has(op.id)) continue;
    for (const rp of resubmitProblems(op.resubmit, writeOps.has(op.id))) {
      problems.push(`operations["${op.id}"]: ${rp.problem}`);
      if (rp.unmeasured) env.state.unmeasuredOps.add(op.id);
    }
  }
  return sideEffects;
}

/**
 * 画面ごとの状態表示を検査し、撮る状態の使い回しを表をまたいで数える。
 * @param {Record<string, unknown>} table
 * @param {ReactionEnv} env
 * @returns {DisplaySummary}
 */
function checkDisplaysAndCaptures(table, env) {
  const { pageNames, captureStates, problems, pageResolution, state } = env;
  // --- 画面ごとの状態表示 ---
  const stateDisplays = checkStateDisplays(table.state_displays, {
    pageNames,
    captureStates,
    problems,
    captureUses: state.aftermathCaptureUses,
    captureLabel: state.captureLabel,
    pageResolution,
  });
  // 操作の無い表では、状態表示のどれも撮らない default 以外の撮影状態を操作の痕跡に数える。
  // 撮影状態の照合は「表が名乗った状態が宣言に在るか」の片向きなので、ここで数えないと、タブを押して撮る状態を
  // 宣言したまま operations: [] と理由だけで反応の判定を飛ばせる
  if (env.operations.length === 0 && captureStates !== null) {
    problems.push(...operationlessStateProblems(table.state_displays, captureStates));
  }
  if (env.coverageProblem !== null) problems.push(env.coverageProblem);
  addCoverageCaptures(env.coverageCaptures, env);
  problems.push(...pageResolutionProblems(state, pageResolution));
  sharedCaptureProblems(env);
  return stateDisplays;
}

/**
 * 操作の無い表で、どの状態表示も撮らない default 以外の撮影状態を返す。
 * @param {unknown} sd - 表の state_displays
 * @param {Set<string>} captureStates
 * @returns {string[]}
 */
function operationlessStateProblems(sd, captureStates) {
  /** @type {Set<string>} */
  const displayed = new Set();
  const sdPages = isPlainObject(sd) ? sd.pages : null;
  for (const row of isArray(sdPages) ? sdPages : []) {
    const candidates = isPlainObject(row) ? row.candidates : null;
    if (!isPlainObject(candidates)) continue;
    for (const entry of Object.values(candidates)) {
      if (!isPlainObject(entry) || entry.status !== "present" || !filled(entry.captured)) continue;
      displayed.add(entry.captured);
    }
  }
  const unexplained = [...captureStates].filter((st) => st !== "default" && !displayed.has(st));
  if (unexplained.length > 0) {
    return [
      `operations が空だが、どの状態表示も撮らない撮影状態がある: ${unexplained.join(", ")}（操作で作る状態なら操作を記録する。状態表示なら state_displays の captured に割り当てる）`,
    ];
  }
  return [];
}

/**
 * 部品網羅表の撮る状態も同じ集合（解決したページ × 状態名）に足す。
 * 部品から導いた行と反応・残る見た目・状態表示の行が同じ 1 枚を指すと、各表の中では 1 件にしか見えず根拠なしで通る
 * @param {ReactionOptions["coverageCaptures"]} coverageCaptures
 * @param {ReactionEnv} env
 */
function addCoverageCaptures(coverageCaptures, env) {
  const { pageResolution } = env;
  const { captureLabel, aftermathCaptureUses } = env.state;
  for (const c of coverageCaptures ?? []) {
    const key = JSON.stringify([pageKey(c.page, pageResolution), c.captured]);
    if (!captureLabel.has(key)) captureLabel.set(key, `${c.page} の ${c.captured}`);
    addCaptureUse(aftermathCaptureUses, key, {
      opId: null,
      label: c.label,
      shared: c.shared,
      source: "coverage",
      page: c.page,
    });
  }
}

/**
 * 撮る状態が 1 つでもあれば（操作・状態表示・部品網羅表のどれでも）ページを解けない理由を返す。
 * 解けないページは名前で数えることになり、別名をまたいだ使い回しを数えられない
 * @param {OperationState} state
 * @param {import("./page-identity.mjs").PageResolution | null} pageResolution
 * @returns {string[]}
 */
function pageResolutionProblems(state, pageResolution) {
  const { capturePageNeedsResolution, aftermathCaptureUses } = state;
  if (
    (capturePageNeedsResolution || aftermathCaptureUses.size > 0) &&
    pageResolution !== null &&
    pageResolution.problems.length > 0
  ) {
    return pageResolution.problems.map((rp) => `押した後に撮ったページの照合: ${rp}`);
  }
  return [];
}

/**
 * 同じ撮る状態を複数の行が指すときに、全行に根拠（shared_capture_reason）を要求する。
 * 同じ撮る状態名を複数の残る見た目が指すと、その 1 枚が片方の操作しか作っていなくても全行が満たされる（Codex レビュー）。
 * coverage-expand.mjs の撮影状態と同じく、使い回す全行に実 UI で確かめた根拠（shared_capture_reason）を要求する。
 * 状態表示を撮る状態も同じ集合で数える（0 件の 1 枚を、押した後の 1 枚と根拠なしに兼ねさせない）
 * @param {ReactionEnv} env
 */
function sharedCaptureProblems(env) {
  const { aftermathCaptureUses, captureLabel, unmeasuredOps } = env.state;
  for (const [key, uses] of aftermathCaptureUses) {
    if (uses.length < 2) continue;
    // 部品網羅表の中だけの同じページ名の使い回しは coverage-expand.mjs が数える（二重に報告しない）。
    // 別名のページ（同じ path の別の名前）をまたぐものは coverage-expand.mjs が名前で数えるので、ここで数える
    if (uses.every((u) => u.source === "coverage") && new Set(uses.map((u) => u.page)).size === 1)
      continue;
    const name = captureLabel.get(key) ?? key;
    const lacking = uses.filter((u) => !u.shared);
    if (lacking.length === 0) continue;
    for (const u of lacking) if (u.opId !== null) unmeasuredOps.add(u.opId);
    env.problems.push(
      `撮る状態 "${name}" を ${uses.map((u) => u.label).join(" / ")} が使い回している（その 1 枚が全ての操作の後を撮っていることを実 UI で確かめた根拠を全行の shared_capture_reason に書くか、別の状態名にする。根拠が空: ${lacking.map((u) => u.label).join(" / ")}）`,
    );
  }
}

/**
 * covered_by の解決・共有と、assertion の深さの監査の記録を検査する。
 * 欄の検査は「空でない文字列の配列か」までなので、書いた名前のテストが実在するか・1 本を何行が名乗るか・
 * その assertion が期待値まで届くかをここで数える（届くかの判断は監査役の subagent。ここは全行を当てた記録があるかだけ）
 * @param {Record<string, unknown>} table
 * @param {string} fingerprint
 * @param {ReactionEnv} env
 * @returns {{ owners: ReturnType<typeof coveredByOwners>, coveredBy: ReturnType<typeof coveredByProblems> }}
 */
function checkCoveredBy(table, fingerprint, env) {
  const { problems, specs } = env;
  const scanned = scanCoveredBy(table);
  const owners = scanned.owners;
  for (const at of scanned.malformed) {
    problems.push(
      `${at}.covered_by: 空でない文字列の配列でない（null か空配列以外は、テストの名前だけを並べる）`,
    );
  }
  const coveredBy = coveredByProblems(owners, env.testIndex);
  problems.push(...coveredBy.problems);
  if (specs !== null) problems.push(...specs.problems);
  problems.push(
    ...assertionAuditProblems(table.assertion_audit, owners, {
      fingerprint,
      specs: specs === null ? null : specs.fingerprint,
    }),
  );
  return { owners, coveredBy };
}

/**
 * --recorded で、記録済みの照合結果（conformance）が今の表と照合規則に合うかを確かめる。
 * @param {Record<string, unknown>} table
 * @param {{ fingerprint: string, sideEffects: ReturnType<typeof checkSideEffectWrites>, owners: ReturnType<typeof coveredByOwners> }} checked
 * @returns {string[]}
 */
function recordedProblems(table, { fingerprint, sideEffects, owners }) {
  const conf = table.conformance;
  const fc = table.feedback_calls;
  if (!isPlainObject(conf))
    return ["conformance が無い（parity-suite で reaction-check を --write 付きで通していない）"];
  /** @type {string[]} */
  const problems = [];
  if (conf.ok !== true) problems.push("conformance.ok が true でない");
  if (conf.tool_version !== VERSION)
    problems.push(
      `conformance.tool_version が ${VERSION} でない（採り直しの時点と照合規則が違う）`,
    );
  if (conf.table_fingerprint !== fingerprint)
    problems.push(
      "conformance.table_fingerprint が表の内容と一致しない（照合後に表が書き換えられた）",
    );
  if (isPlainObject(fc) && fc.declared === true && conf.call_sites_checked !== true)
    problems.push("conformance.call_sites_checked が true でない");
  if (sideEffects.declared === true && conf.side_effects_checked !== true)
    problems.push("conformance.side_effects_checked が true でない");
  if (owners.length > 0 && conf.covered_by_resolved !== true)
    problems.push(
      "conformance.covered_by_resolved が true でない（covered_by をスイートのテスト一覧〈--tests〉へ解決して通していない）",
    );
  return problems;
}

/**
 * 部品網羅表（metadata.json の component_coverage）の撮る状態を、表をまたいだ使い回しの照合用に読む。
 * 行のページはインスタンスの page（capture_conditions.pages の名前）。page が無い・宣言に無い行は
 * coverage-expand.mjs が落とす（parity-diff の収束判定は部品網羅表の conformance.ok を要求する）ので、ここでは数えない。
 * @param {Record<string, unknown>} metadata
 * @param {Set<string> | null} pageNames
 * @param {{ readFile: (p: string) => string, cwd: string }} io
 * 数えなかった行は件数（skipped）を返して出力に残す（警告なしに捨てた行と、撮る状態の無い表を同じ見え方にしない）。
 * @returns {{ captures: { page: string, captured: string, label: string, shared: boolean }[] | null, problem: string | null, skipped: number }}
 */
export function readCoverageCaptures(metadata, pageNames, { readFile, cwd }) {
  const decl = metadata.component_coverage;
  // 宣言が無い・declared: false は部品網羅表を持たない機能（後方互換の扱いは parity-diff の coverage-check.mjs が持つ）
  if (!isPlainObject(decl) || decl.declared !== true)
    return { captures: null, problem: null, skipped: 0 };
  if (!nonEmptyString(decl.path)) {
    return {
      captures: [],
      skipped: 0,
      problem:
        "metadata.json の component_coverage.path が空（部品網羅表を読めず、表をまたいだ撮る状態の使い回しを照合できない）",
    };
  }
  let cov;
  try {
    cov = JSON.parse(readFile(resolve(cwd, decl.path)));
  } catch (e) {
    return {
      captures: [],
      skipped: 0,
      problem: `部品網羅表を読めない: ${decl.path}（${errorMessage(e)}。表をまたいだ撮る状態の使い回しを照合できない）`,
    };
  }
  const rows =
    isPlainObject(cov) && isPlainObject(cov.visual_state_coverage)
      ? cov.visual_state_coverage.rows
      : undefined;
  if (!isArray(rows)) {
    return {
      captures: [],
      skipped: 0,
      problem: `部品網羅表 ${decl.path} に visual_state_coverage.rows が無い（coverage-expand.mjs --write で導出してから通す）`,
    };
  }
  return coverageRowCaptures(rows, instancePages(cov), { path: decl.path, pageNames });
}

/**
 * 部品網羅表の部品インスタンス（部品 id × インスタンス id）→ ページを作る。
 * @param {unknown} cov - 部品網羅表
 * @returns {Map<string, string>}
 */
function instancePages(cov) {
  /** @type {Map<string, string>} */
  const pageByInstance = new Map();
  for (const c of isPlainObject(cov) && isArray(cov.components) ? cov.components : []) {
    if (!isPlainObject(c) || !nonEmptyString(c.id)) continue;
    addInstancePages(c.id, c.instances, pageByInstance);
  }
  return pageByInstance;
}

/**
 * 部品 1 つのインスタンスのページを pageByInstance に足す。先に足したものを優先する。
 * @param {string} componentId
 * @param {unknown} instances - 部品の instances
 * @param {Map<string, string>} pageByInstance
 */
function addInstancePages(componentId, instances, pageByInstance) {
  for (const inst of isArray(instances) ? instances : []) {
    if (!isPlainObject(inst) || !nonEmptyString(inst.id) || !nonEmptyString(inst.page)) continue;
    const k = JSON.stringify([componentId, inst.id]);
    if (!pageByInstance.has(k)) pageByInstance.set(k, inst.page);
  }
}

/**
 * visual_state_coverage.rows の撮る状態を読む。ページを決められない行は数えず、件数を skipped に残す。
 * @param {unknown[]} rows
 * @param {Map<string, string>} pageByInstance
 * @param {{ path: string, pageNames: Set<string> | null }} where - path は部品網羅表のパス
 * @returns {{ captures: { page: string, captured: string, label: string, shared: boolean }[], problem: null, skipped: number }}
 */
function coverageRowCaptures(rows, pageByInstance, { path, pageNames }) {
  /** @type {{ page: string, captured: string, label: string, shared: boolean }[]} */
  const captures = [];
  let skipped = 0;
  rows.forEach((row, i) => {
    if (!isPlainObject(row) || !filled(row.captured)) return;
    const page = pageByInstance.get(JSON.stringify([row.component, row.instance]));
    if (page === undefined || (pageNames !== null && !pageNames.has(page))) {
      skipped += 1;
      return;
    }
    captures.push({
      page,
      captured: row.captured,
      label: `${path}: visual_state_coverage.rows[${i}]（${String(row.component)} / ${String(row.instance)} / ${String(row.required_by)} / ${String(row.kind)}）`,
      shared: filled(row.shared_capture_reason),
    });
  });
  return { captures, problem: null, skipped };
}

/**
 * capture_conditions.pages から画面名の集合を作る。名前の無い・空・重複した宣言は警告なしに捨てずに落とす。
 * 捨てると、宣言した画面の一部が期待集合から消え、状態表示の全画面の振り分けが残りの画面だけで通る。
 * @param {unknown[]} pages
 * @returns {Set<string>}
 */
function pageNameSet(pages) {
  const names = new Set();
  pages.forEach((pg, i) => {
    if (!isPlainObject(pg) || !nonEmptyString(pg.name)) {
      throw new UsageError(
        `metadata.json の capture_conditions.pages[${i}] に name（空でない文字列）が無い`,
      );
    }
    if (names.has(pg.name)) {
      throw new UsageError(
        `metadata.json の capture_conditions.pages に画面 "${pg.name}" が 2 つある`,
      );
    }
    names.add(pg.name);
  });
  return names;
}

/**
 * @param {string[]} argv - process.argv.slice(2)
 * @param {{ readFile?: (p: string) => string, writeFile?: (p: string, s: string) => void, cwd?: string, out?: (s: string) => void, err?: (s: string) => void }} [deps]
 *   out / err は出力先（デフォルトは process.stdout / process.stderr）。テストが子プロセスを起動せず main を直接呼ぶために差し込む。
 * @returns {number}
 */
export function main(argv, deps = {}) {
  /** @type {MainIo} */
  const io = {
    ...fileIo(deps),
    stdout: deps.out ?? ((s) => process.stdout.write(s)),
    stderr: deps.err ?? ((s) => process.stderr.write(s)),
  };
  const args = parseArgs(argv, io.cwd);
  if (args.error !== null) {
    io.stderr(`error: ${args.error}\n${USAGE}\n`);
    return 2;
  }
  try {
    return run(args.options, io);
  } catch (e) {
    io.stderr(`error: ${errorMessage(e)}\n${USAGE}\n`);
    return 2;
  }
}

/** 使い方の表示。 */
const USAGE =
  "usage: reaction-check.mjs --metadata <metadata.json> [--root <移行元ソースのルート>] --tests <playwright test --list --reporter=json の出力> [--write | --audit-sheet]\n" +
  "       reaction-check.mjs --metadata <metadata.json> --tests <一覧> --recorded";

/**
 * main の入出力（テストが差し込む）。
 * @typedef {import("./lib/file-io.mjs").FileIo & { stdout: (s: string) => void, stderr: (s: string) => void }} MainIo
 */

/**
 * 引数を読んだ結果。
 * @typedef {{ metadataPath: string, root: string, testsPath: string | null, write: boolean, recorded: boolean, sheet: boolean }} MainOptions
 */

/**
 * 引数を読む。誤りがあれば error に理由を入れる。
 * @param {string[]} argv
 * @param {string} cwd
 * @returns {{ error: string, options: null } | { error: null, options: MainOptions }}
 */
function parseArgs(argv, cwd) {
  const flags = readFlags(argv, cwd);
  if (flags.error !== null) return { error: flags.error, options: null };
  const { metadataPath, write, recorded, sheet } = flags.options;
  const argError =
    metadataPath === null
      ? "--metadata が無い"
      : [write, recorded, sheet].filter(Boolean).length > 1
        ? "--write・--recorded・--audit-sheet は同時に使えない"
        : null;
  // metadataPath === null なら argError も null でない（型を絞るために並べて書く）
  if (argError !== null || metadataPath === null) return { error: `${argError}`, options: null };
  return { error: null, options: { ...flags.options, metadataPath } };
}

/**
 * 引数を読む（組み合わせの検査は parseArgs が行う）。--root は cwd からの絶対パスにする。
 * @param {string[]} argv
 * @param {string} cwd
 * @returns {{ error: string, options: null } | { error: null, options: Omit<MainOptions, "metadataPath"> & { metadataPath: string | null } }}
 */
function readFlags(argv, cwd) {
  const parsed = parseFlags(argv, {
    values: ["--metadata", "--root", "--tests"],
    bools: ["--write", "--recorded", "--audit-sheet"],
  });
  if (parsed.error !== undefined) return { error: parsed.error, options: null };
  const { strings, bools } = parsed;
  const root = strings["--root"];
  const options = {
    metadataPath: strings["--metadata"] ?? null,
    root: root === undefined ? cwd : resolve(cwd, root),
    testsPath: strings["--tests"] ?? null,
    write: bools["--write"] === true,
    recorded: bools["--recorded"] === true,
    sheet: bools["--audit-sheet"] === true,
  };
  return { error: null, options };
}

/**
 * 引数を読んだ後の本体。使い方の誤り・型崩れは UsageError を投げる（main が exit 2 にする）。
 * @param {MainOptions} args
 * @param {MainIo} io
 * @returns {number}
 */
function run(args, io) {
  const { readFile, cwd } = io;
  const metadata = JSON.parse(readFile(resolve(cwd, args.metadataPath)));
  // readDeclaration の最初の検査と同じ（型を絞るために先に書く）
  if (!isPlainObject(metadata)) throw new UsageError("metadata.json がオブジェクトでない");
  const decl = readDeclaration(metadata);
  if (!decl.judged) {
    printJson(io, { judged: false, reason: decl.reason });
    return 0;
  }
  // covered_by の解決とスペックの指紋の計算し直しはスイートのテスト一覧が要る。--recorded（parity-diff の収束判定）も同じである。
  // 記録だけで判定すると、--write の後にスペックの assertion を弱めても収束する（parity-replace が新側を緑にする過程で起こりうる）
  if (args.testsPath === null) {
    throw new UsageError(
      "--tests が無い（covered_by をテストへ解決するため、playwright test --list --reporter=json の出力を渡す）",
    );
  }
  const tests = readTestList(args.testsPath, io);
  const tablePath = resolve(cwd, decl.path);
  let table;
  try {
    table = JSON.parse(readFile(tablePath));
  } catch (e) {
    printJson(io, { judged: true, reason: null, ok: false, unmeasured_operations: null });
    io.stderr(`error: 反応の網羅表を読めない: ${decl.path}（${errorMessage(e)}）\n`);
    return 1;
  }
  const meta = checkedMetadata(metadata);
  const job = { table, tablePath, path: decl.path, tests };
  if (args.sheet) return printAuditSheet(job, io);
  return runCheck(job, { args, meta, metadata }, io);
}

/**
 * JSON を 1 つ stdout に出す（tool と version を先頭に付ける）。
 * @param {MainIo} io
 * @param {Record<string, unknown>} obj
 */
function printJson(io, obj) {
  io.stdout(`${JSON.stringify({ tool: "reaction-check", version: VERSION, ...obj }, null, 2)}\n`);
}

/**
 * --tests の一覧を読んで索引を作る。
 * @param {string} testsPath
 * @param {MainIo} io
 * @returns {{ testIndex: TestIndex, testsRoot: string }}
 */
function readTestList(testsPath, io) {
  let report;
  try {
    report = JSON.parse(io.readFile(resolve(io.cwd, testsPath)));
  } catch (e) {
    throw new UsageError(`--tests を JSON として読めない: ${testsPath}（${errorMessage(e)}）`);
  }
  const testIndex = indexTestList(report);
  // indexTestList がオブジェクトでない report を落とすので、isPlainObject(report) は常に成り立つ（型を絞るために書く）
  const rootDir =
    isPlainObject(report) && isPlainObject(report.config) ? report.config.rootDir : undefined;
  if (!nonEmptyString(rootDir) || !isAbsolute(rootDir)) {
    throw new UsageError(
      "--tests の config.rootDir が絶対パスでない（スペックの中身を読む起点が無い。playwright test --list --reporter=json の出力をそのまま渡す）",
    );
  }
  return { testIndex, testsRoot: rootDir };
}

/**
 * declared: true の照合に要る metadata.json の値を確かめて返す。
 * 照合は撮影状態・slug・target を必須にする（欠落を照合のスキップとして扱うと、存在しない状態名や取り違えた表が通る）
 * @param {Record<string, unknown>} metadata
 * @returns {{ states: string[], pages: unknown[] | null, slug: string, target: Record<string, unknown> & { name: string, commit: string } }}
 */
function checkedMetadata(metadata) {
  const cc = metadata.capture_conditions;
  if (
    !isPlainObject(cc) ||
    !isArray(cc.states) ||
    cc.states.length === 0 ||
    !cc.states.every(nonEmptyString)
  ) {
    throw new UsageError(
      "metadata.json の capture_conditions.states が空でない文字列の配列でない（撮影状態を確定してから通す）",
    );
  }
  if (!nonEmptyString(metadata.slug)) throw new UsageError("metadata.json の slug が空");
  const target = metadata.target;
  if (!isPlainObject(target) || !nonEmptyString(target.name)) {
    throw new UsageError("metadata.json の target.name が空");
  }
  // 欠落を明示の none と同じ免除へ流さない（照合不能の理由さえ書けば任意のバージョンを通せてしまう）
  if (!nonEmptyString(target.commit)) {
    throw new UsageError(
      "metadata.json の target.commit が空（コミット SHA か、入手不可なら none を書く）",
    );
  }
  return {
    states: cc.states,
    pages: isArray(cc.pages) ? cc.pages : null,
    slug: metadata.slug,
    target: { ...target, name: target.name, commit: target.commit },
  };
}

/**
 * 照合する表と、テスト一覧の索引。
 * @typedef {{ table: unknown, tablePath: string, path: string, tests: { testIndex: TestIndex, testsRoot: string } }} CheckJob
 */

/**
 * covered_by が名指ししたスペックの指紋を計算する。
 * @param {ReturnType<typeof coveredByOwners>} owners
 * @param {CheckJob["tests"]} tests
 * @param {MainIo} io
 */
function specsOf(owners, tests, io) {
  return specsFingerprint(owners, tests.testIndex, {
    rootDir: tests.testsRoot,
    readFile: io.readFile,
  });
}

/**
 * --audit-sheet: 監査役に渡す入力だけを出す。解決できない名前が残るうちは監査の入力にならないので落とす。
 * @param {CheckJob} job
 * @param {MainIo} io
 * @returns {number}
 */
function printAuditSheet({ table, path, tests }, io) {
  if (!isPlainObject(table)) throw new UsageError("反応の網羅表がオブジェクトでない");
  const scanned = scanCoveredBy(table);
  const owners = scanned.owners;
  // 形の不正な covered_by は owners に入らないので、警告なしに欠けた監査入力を ok として出さない
  const problems = [
    ...scanned.malformed.map(
      (at) =>
        `${at}.covered_by: 空でない文字列の配列でない（null か空配列以外は、テストの名前だけを並べる）`,
    ),
    ...coveredByProblems(owners, tests.testIndex).problems,
  ];
  const specs = specsOf(owners, tests, io);
  problems.push(...specs.problems);
  printJson(io, {
    judged: true,
    reason: null,
    ok: problems.length === 0,
    path,
    table_fingerprint: tableFingerprint(table),
    specs_fingerprint: specs.fingerprint,
    entries: auditSheet(owners, tests.testIndex),
    problems,
  });
  for (const p of problems) io.stderr(`warn: ${p}\n`);
  return problems.length === 0 ? 0 : 1;
}

/**
 * 網羅表を照合して結果を出す（--write なら conformance を書き戻す）。
 * @param {CheckJob} job
 * @param {{ args: MainOptions, meta: ReturnType<typeof checkedMetadata>, metadata: Record<string, unknown> }} input
 * @param {MainIo} io
 * @returns {number}
 */
function runCheck(job, { args, meta, metadata }, io) {
  const { table, tests } = job;
  const pageNames = meta.pages !== null ? pageNameSet(meta.pages) : null;
  const coverage = readCoverageCaptures(metadata, pageNames, io);
  const result = checkReactions(table, {
    root: args.root,
    recorded: args.recorded,
    captureStates: new Set(meta.states),
    pageNames,
    pageResolution: meta.pages !== null ? resolvePages(meta.pages, meta.target.ui_url) : null,
    coverageCaptures: coverage.captures,
    coverageProblem: coverage.problem,
    coverageSkipped: coverage.skipped,
    operationTraces: operationTraces(metadata, { withStates: false }),
    slug: meta.slug,
    target: meta.target.name,
    targetCommit: meta.target.commit,
    testIndex: tests.testIndex,
    specs: specsOf(scanCoveredBy(table).owners, tests, io),
  });
  const ok =
    result.unmeasured_operations === 0 &&
    result.state_displays.unmeasured === 0 &&
    result.problems.length === 0;
  // checkReactions がオブジェクトでない表を落とすので、isPlainObject(table) は常に成り立つ（型を絞るために書く）
  if (args.write && isPlainObject(table)) writeConformance(table, { result, ok, job }, io);
  printJson(io, { judged: true, reason: null, ok, path: job.path, ...result });
  for (const p of result.problems) io.stderr(`warn: ${p}\n`);
  if (!ok) {
    io.stderr(
      `error: 反応の未測定 ${result.unmeasured_operations} 操作・状態表示の未測定 ${result.state_displays.unmeasured} 件・不整合 ${result.problems.length} 件 — 測り直す（parity-diff では収束させず parity-suite へ戻す）\n`,
    );
  }
  return ok ? 0 : 1;
}

/**
 * 照合結果を conformance として網羅表へ書き戻す（表の指紋付き。時刻は入れない）。
 * @param {Record<string, unknown>} table
 * @param {{ result: ReturnType<typeof checkReactions>, ok: boolean, job: CheckJob }} checked
 * @param {MainIo} io
 */
function writeConformance(table, { result, ok, job }, io) {
  table.conformance = {
    tool: "reaction-check",
    tool_version: VERSION,
    ok,
    call_sites_checked: result.call_sites.checked,
    side_effects_checked: result.side_effect_writes.checked,
    covered_by_resolved: result.covered_by.resolved,
    table_fingerprint: result.table_fingerprint,
    problems: result.problems.length,
  };
  io.writeFile(job.tablePath, `${JSON.stringify(table, null, 2)}\n`);
}

if (isCliEntry(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
