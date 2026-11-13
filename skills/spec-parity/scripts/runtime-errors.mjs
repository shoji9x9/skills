// 操作中に出たコンソールのエラーと失敗したリクエストの集計と、新側との比較（原本）。
//
// 何のためか: 画素・特性照合・aria の 3 つの比較方法は、画面に出た結果しか比べない。
// 新側で画面が同じに見えても、裏で JavaScript の例外やリクエストの失敗が起きていれば、どれにも表れない。
// 現行にも同じエラーが出ていることはあるので、0 件を基準にはできない。そこで、現側でスイートを N 回実行して
// 出たエラーを基準にし、新側で同じテストを実行したときに、基準に無かったエラーだけを差分として数える。
// 回によって出たり出なかったりするエラーも、N 回のうち 1 回でも出れば基準に入る（ノイズ基準値と同じ考え方）。
//
// サブコマンドは 2 つある。
//   summarize: 現側の記録（実行ごとのディレクトリ）を集計し、metadata.json の runtime_errors に書く（parity-suite の手順 6）。
//   compare:   新側の記録を、metadata.json の runtime_errors と比べる（parity-diff の手順 4 と 7）。
// parity-diff は、インストールした parity-suite から同じスクリプトを compare で呼ぶ。プロジェクトへコピーしない。
//
// 記録（Playwright のテストごとに、pageerror・console の error・requestfailed・4xx と 5xx の応答を書く）は、
// 同梱の雛形 assets/runtime-errors.fixture.template.ts から起こした fixture が行う。このスクリプトはブラウザを駆動しない。
//
// 比べる単位は「テスト × 署名」である。テストは、そのテストが操作でたどった状態を表す（ページ・状態ごとの記録）。
// 署名は、種類・ページの path・リクエストのメソッドと path・状態コード・本文を正規化した文字列から作る。
// 正規化では、オリジン・クエリ・フラグメントを捨て、数字の連なりを <n> にする。現側と新側でホストが違い、
// 採番した id や行番号が実装ごとに違っても、同じエラーを同じ署名にするためである。
// 代わりに、path だけが同じで別のホストへのリクエストの失敗は、同じ署名として扱われる（見逃しうる）。
//
// 新側だけに出た署名は、トリアージで分類する（要対応・許容・環境ノイズ）。分類は diff-metadata.json の
// runtime_errors.new_signatures[] に書き、compare をもう一度通す。compare は前の分類を同じテスト × 署名へ持ち越す。
// 許容は承認の日時（approved_at）と理由、環境ノイズは根拠（evidence）が無ければ、説明の付いていない差分として数える。
//
// 決定論的: 乱数・現在時刻・ネットワークに依存しない。TypeScript 構文は使わない（型は JSDoc）。
//
// 終了コード: 0 ＝ 条件を満たす、1 ＝ 説明の付いていない差分・要対応・記録の欠け・基準と合わない記録が残る、2 ＝ 使い方の誤り・入力の型の誤り。

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { isArray } from "./lib/is-array.mjs";
import { isCliEntry } from "./lib/cli.mjs";
import { errorMessage } from "./lib/errors.mjs";
import { writeFileAtomic } from "./lib/file-io.mjs";
import { parseFlags, stripDashes } from "./lib/flags.mjs";
import {
  isFilled,
  isInteger,
  isPlaceholder,
  isPlainObject,
  nonEmptyString,
} from "./lib/guards.mjs";

/**
 * ツールのバージョン（原本）。署名の判定規則・正規化・出力の形を変えたら上げる。上げると、前のバージョンの基準をすべて作り直すことになる。
 * 読み手が読まなくても判定が変わらない欄を足すだけ（compare の tree）なら上げない。
 * 分類の読み方（judgeClassification）だけを変えたときも上げない。基準の署名には関わらず、次に compare を通したときに新しい読み方で判定し直される。
 * 前に書いた compare の結果（ok・state）は、通し直すまで前の読み方のまま残る。
 * 収束の判定だけが呼ぶ関数（approvalLogged）を足したり変えたりしたときも上げない。compare の出力は変わらない。
 * @type {string}
 */
export const VERSION = "1";

/** 記録の形式のバージョン。雛形の `RUNTIME_ERRORS_VERSION` と同じ値にする。 */
export const RECORD_VERSION = "1";

/** 記録する種類。pageerror は捕まえていない例外、console-error は console の error、requestfailed は通信の失敗、http-error は 4xx と 5xx の応答である。 */
export const KINDS = ["pageerror", "console-error", "requestfailed", "http-error"];

/** 1 つの側に要る実行の回数の下限。1 回だけでは、回によって出たり出なかったりするエラーを基準に入れられない。 */
export const MIN_RUNS = 2;

/** トリアージの分類。日本語の語は diff.md の分類と同じ字面にする。 */
export const CLASSIFICATIONS = ["要対応", "許容", "環境ノイズ"];

/** Playwright のテストの結果のうち、記録として読むもの。 */
const STATUSES = ["passed", "failed", "timedOut", "skipped", "interrupted"];

/** 正規化した本文の長さの上限。スタックや長い本文で署名がぶれないよう、先頭だけを使う。 */
const TEXT_LIMIT = 300;

class UsageError extends Error {}

/**
 * URL をオリジン・クエリ・フラグメント抜きの path にし、数字の連なりを <n> にする。URL として読めなければ、文字列のまま数字を置き換える。
 * @param {string} url
 * @returns {string}
 */
export function normalizeUrl(url) {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    path = url.replace(/[?#].*$/s, "");
  }
  return path.replace(/\d+/g, "<n>");
}

/**
 * 本文を正規化する。中の URL はオリジン・クエリを捨て、数字の連なりを <n> に、空白の連なりを 1 つにして、先頭だけを残す。
 * @param {string} text
 * @returns {string}
 */
export function normalizeText(text) {
  const withoutUrls = text.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>()]+/gi, (u) =>
    normalizeUrl(u),
  );
  return withoutUrls.replace(/\d+/g, "<n>").replace(/\s+/g, " ").trim().slice(0, TEXT_LIMIT);
}

/**
 * 正規化した後の署名の欄から id を作る。正規化はもう一度当てない。
 * 正規化は 2 回当てると値が変わることがある（path が URL の blob: の URL、上限で切った本文）ので、保存した基準の id もこの関数で作り直す。
 * @param {Record<string, unknown>} sig - kind・page・method・url・status・text を持つ署名
 * @returns {string}
 */
export function signatureId(sig) {
  return createHash("sha256")
    .update(JSON.stringify([sig.kind, sig.page, sig.method, sig.url, sig.status, sig.text]))
    .digest("hex")
    .slice(0, 16);
}

/**
 * 1 件のイベントを正規化した署名にする。id は署名の欄から作る（同じ欄なら同じ id）。
 * @param {Record<string, unknown>} e - 形を確かめた後のイベント
 * @returns {{ id: string, kind: string, page: string, method: string | null, url: string | null, status: number | null, text: string }}
 */
export function signatureOf(e) {
  const sig = {
    kind: String(e.kind),
    page: normalizeUrl(String(e.page)),
    method: typeof e.method === "string" ? e.method.toUpperCase() : null,
    url: typeof e.url === "string" ? normalizeUrl(e.url) : null,
    status: typeof e.status === "number" ? e.status : null,
    text: normalizeText(typeof e.text === "string" ? e.text : ""),
  };
  return { id: signatureId(sig), ...sig };
}

/**
 * イベントの形を確かめる。誤りなら理由を返す。
 * @param {Record<string, unknown>} e
 * @returns {string | null}
 */
function eventProblem(e) {
  if (!KINDS.includes(String(e.kind))) return `kind が語彙の外: ${String(e.kind)}`;
  if (typeof e.page !== "string") return "page が文字列でない";
  if (typeof e.text !== "string") return "text が文字列でない";
  const request = e.kind === "requestfailed" || e.kind === "http-error";
  if (request && (!nonEmptyString(e.method) || !nonEmptyString(e.url)))
    return `${String(e.kind)} に method か url が無い`;
  if (e.kind === "http-error" && !(isInteger(e.status) && e.status >= 400 && e.status <= 599))
    return `http-error の status が 400〜599 の整数でない: ${String(e.status)}`;
  return null;
}

/**
 * 記録の見出し（version・side・slug・target・run・test・status）を確かめる。誤りなら理由を返す。
 * @param {Record<string, unknown>} doc
 * @param {{ side: "current" | "new", slug: string, target: string | null, run: number }} expect
 * @returns {string | null}
 */
function recordHeaderProblem(doc, expect) {
  /** @type {[boolean, string][]} */
  const checks = [
    [doc.version !== RECORD_VERSION, `version が ${RECORD_VERSION} でない`],
    [doc.side !== expect.side, `side が ${expect.side} でない（${String(doc.side)}）`],
    [doc.slug !== expect.slug, `slug が ${expect.slug} でない（${String(doc.slug)}）`],
    [
      (doc.target ?? null) !== expect.target,
      `target が ${String(expect.target)} でない（${String(doc.target)}）`,
    ],
    [doc.run !== expect.run, `run が ディレクトリの回 ${expect.run} と違う（${String(doc.run)}）`],
    [!nonEmptyString(doc.test), "test が空"],
    [!STATUSES.includes(String(doc.status)), `status が語彙の外（${String(doc.status)}）`],
  ];
  const failed = checks.find(([bad]) => bad);
  return failed ? failed[1] : null;
}

/**
 * 記録のイベントを署名にする。最初に出たときの本文も、署名ごとに残す。
 * @param {unknown[]} events
 * @param {string} where
 * @returns {{ signatures: ReturnType<typeof signatureOf>[], samples: Map<string, string> }}
 */
function readEvents(events, where) {
  const signatures = [];
  /** @type {Map<string, string>} */
  const samples = new Map();
  for (const [i, e] of events.entries()) {
    if (!isPlainObject(e))
      throw new UsageError(`events[${i}]: イベントがオブジェクトでない: ${where}`);
    const problem = eventProblem(e);
    if (problem !== null) throw new UsageError(`events[${i}]: ${problem}: ${where}`);
    const sig = signatureOf(e);
    signatures.push(sig);
    if (!samples.has(sig.id)) samples.set(sig.id, String(e.text).slice(0, 1000));
  }
  return { signatures, samples };
}

/**
 * 1 テストの記録を読む。誤りなら UsageError を投げる。
 * @param {unknown} doc
 * @param {{ side: "current" | "new", slug: string, target: string | null, run: number, file: string }} expect
 * @returns {{ test: string, status: string, signatures: ReturnType<typeof signatureOf>[], samples: Map<string, string> }}
 */
export function readRecord(doc, expect) {
  const where = expect.file;
  if (!isPlainObject(doc)) throw new UsageError(`記録がオブジェクトでない: ${where}`);
  const problem = recordHeaderProblem(doc, expect);
  if (problem !== null) throw new UsageError(`記録の ${problem}: ${where}`);
  if (!isArray(doc.events)) throw new UsageError(`記録の events が配列でない: ${where}`);
  return { test: String(doc.test), status: String(doc.status), ...readEvents(doc.events, where) };
}

/**
 * 実行のディレクトリの名前（`run-<回>`）から回を読む。
 * @param {string} dir
 * @returns {number}
 */
export function runNumberOf(dir) {
  const m = /(?:^|[\\/])run-([1-9]\d*)[\\/]?$/.exec(dir);
  if (!m) throw new UsageError(`実行のディレクトリの名前が run-<1 以上の整数> でない: ${dir}`);
  return Number(m[1]);
}

/**
 * @typedef {{ tests: Map<string, { statuses: string[] }>, signatures: Map<string, { sig: ReturnType<typeof signatureOf>, test: string, runs: Set<number>, sample: string }> }} Collected
 */

/**
 * 1 テストの記録を、集めた結果に足す。
 * @param {Collected} acc
 * @param {ReturnType<typeof readRecord>} r
 * @param {number} run
 */
function addRecord(acc, r, run) {
  const t = acc.tests.get(r.test) ?? { statuses: [] };
  t.statuses.push(r.status);
  acc.tests.set(r.test, t);
  // スキップした試行は操作を終えていないので、その前に出たイベントも署名に数えない（未検証として一覧に残す）
  if (r.status === "skipped") return;
  for (const sig of r.signatures) {
    const key = `${r.test}\u0000${sig.id}`;
    const entry = acc.signatures.get(key) ?? {
      sig,
      test: r.test,
      runs: new Set(),
      sample: r.samples.get(sig.id) ?? "",
    };
    entry.runs.add(run);
    acc.signatures.set(key, entry);
  }
}

/**
 * N 回分の記録を、テスト × 署名に集める。
 * @param {{ dir: string, run: number, records: ReturnType<typeof readRecord>[] }[]} runs
 * @returns {Collected}
 */
export function collect(runs) {
  /** @type {Collected} */
  const acc = { tests: new Map(), signatures: new Map() };
  const seenRuns = new Set();
  for (const { dir, run, records } of runs) {
    if (seenRuns.has(run))
      throw new UsageError(`同じ回の実行が 2 つ渡された: run-${run}（${dir}）`);
    seenRuns.add(run);
    if (records.length === 0) throw new UsageError(`記録が 0 件の実行: ${dir}`);
    const testsInRun = new Set();
    for (const r of records) {
      if (testsInRun.has(r.test))
        throw new UsageError(`同じテストの記録が 1 つの実行に 2 つある: ${r.test}（${dir}）`);
      testsInRun.add(r.test);
      addRecord(acc, r, run);
    }
  }
  return acc;
}

/** @param {string} a @param {string} b */
function byText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * 現側の N 回を集計し、metadata.json の runtime_errors に書く値を返す。
 * @param {{ dir: string, run: number, records: ReturnType<typeof readRecord>[] }[]} runs
 * @returns {{ ok: true, runtime_errors: Record<string, unknown> } | { ok: false, problems: string[] }}
 */
export function summarize(runs) {
  if (runs.length < MIN_RUNS)
    throw new UsageError(`実行は ${MIN_RUNS} 回以上渡す（渡したのは ${runs.length} 回）`);
  const { tests, signatures } = collect(runs);
  const problems = [];
  for (const [test, t] of [...tests].sort(([a], [b]) => byText(a, b))) {
    if (t.statuses.length !== runs.length)
      problems.push(
        `一部の実行にしか記録が無いテスト: ${test}（${t.statuses.length}/${runs.length} 回）`,
      );
    const bad = t.statuses.filter((s) => s !== "passed" && s !== "skipped");
    if (bad.length > 0)
      problems.push(
        `現側で通らなかったテスト（スイートを緑にしてから採る）: ${test}（${bad.join(", ")}）`,
      );
    if (new Set(t.statuses.map((s) => s === "skipped")).size > 1)
      problems.push(`回によって実行とスキップが変わるテスト: ${test}（${t.statuses.join(", ")}）`);
  }
  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    runtime_errors: {
      declared: true,
      tool_version: VERSION,
      runs: runs.length,
      run_dirs: runs.map((r) => r.dir).sort(byText),
      tests: [...tests]
        .map(([test, t]) => ({ test, skipped: t.statuses[0] === "skipped" }))
        .sort((a, b) => byText(a.test, b.test)),
      signatures: [...signatures.values()]
        .map((s) => ({ test: s.test, ...s.sig, seen_runs: s.runs.size, sample: s.sample }))
        .sort((a, b) => byText(`${a.test}\u0000${a.id}`, `${b.test}\u0000${b.id}`)),
    },
  };
}

/**
 * 基準の表の欄を確かめる（宣言・回数・配列）。
 * @param {unknown} base
 * @returns {{ runs: number, tests: unknown[], signatures: unknown[] }}
 */
function baselineTables(base) {
  if (!isPlainObject(base))
    throw new UsageError(
      "metadata.json に runtime_errors が無い（parity-suite の summarize を通してから比べる）",
    );
  if (base.declared !== true)
    throw new UsageError(
      "runtime_errors.declared が true でない（compare を呼ばず、judged: false と理由を書く）",
    );
  if (!(isInteger(base.runs) && base.runs >= MIN_RUNS))
    throw new UsageError(`runtime_errors.runs が ${MIN_RUNS} 以上の整数でない`);
  if (!isArray(base.tests) || base.tests.length === 0)
    throw new UsageError("runtime_errors.tests が空か配列でない");
  if (!isArray(base.signatures)) throw new UsageError("runtime_errors.signatures が配列でない");
  return { runs: base.runs, tests: base.tests, signatures: base.signatures };
}

/**
 * 基準のテストを読む（テスト → 現側でスキップしたか）。
 * @param {unknown[]} list
 * @returns {Map<string, boolean>}
 */
function baselineTests(list) {
  /** @type {Map<string, boolean>} */
  const tests = new Map();
  for (const [i, t] of list.entries()) {
    if (!isPlainObject(t) || !nonEmptyString(t.test) || typeof t.skipped !== "boolean")
      throw new UsageError(`runtime_errors.tests[${i}] に test か skipped が無い`);
    if (tests.has(t.test))
      throw new UsageError(`runtime_errors.tests の test が重複している: ${t.test}`);
    tests.set(t.test, t.skipped);
  }
  return tests;
}

/**
 * 基準の署名を、テスト × 署名の鍵の集合にする。
 * @param {unknown[]} list
 * @param {Map<string, boolean>} tests
 * @returns {Set<string>}
 */
function baselineKeys(list, tests) {
  const keys = new Set();
  for (const [i, s] of list.entries()) {
    if (!isPlainObject(s) || !nonEmptyString(s.test) || !nonEmptyString(s.id))
      throw new UsageError(`runtime_errors.signatures[${i}] に test か id が無い`);
    if (!tests.has(s.test))
      throw new UsageError(`runtime_errors.signatures[${i}] の test が tests に無い: ${s.test}`);
    // 保存された id を信じず、欄から作り直して突き合わせる（手で書き換えた基準で、別の署名を「現行にもあった」にしない）
    if (signatureId(s) !== s.id)
      throw new UsageError(`runtime_errors.signatures[${i}] の id が欄から作った値と違う: ${s.id}`);
    keys.add(`${s.test}\u0000${s.id}`);
  }
  return keys;
}

/**
 * 現側の基準（metadata.json の runtime_errors）の形を確かめる。
 * @param {unknown} base
 * @returns {{ tests: Map<string, boolean>, keys: Set<string>, runs: number }}
 */
export function readBaseline(base) {
  const tables = baselineTables(base);
  // 正規化の規則はバージョンで変わる。古い規則の基準と比べると、同じエラーも基準に無い署名になる
  if (isPlainObject(base) && base.tool_version !== VERSION)
    throw new UsageError(
      `runtime_errors.tool_version が ${VERSION} でない（${String(base.tool_version)}。parity-suite の summarize で基準を作り直す）`,
    );
  const tests = baselineTests(tables.tests);
  return { tests, keys: baselineKeys(tables.signatures, tests), runs: tables.runs };
}

/**
 * 前の実行の分類を読む（diff-metadata.json の runtime_errors.new_signatures）。読めない要素は持ち越さない。
 * 持ち越しは新側のバージョン（tree）を見ない。許容と環境ノイズの承認は、収束の判定が承認の記録（approvals）と照合する（approvalLogged）。
 * spec-parity は要素の tree の一致も求めるので、前のバージョンの承認を数えない。parity-diff は tree を照合せず、承認をバージョンをまたいで持つ。
 * 持ち越しにバージョンの一致を求めると、parity-diff でも新側を直すたびに全件を分類し直すことになる。
 * @param {unknown} previous
 * @returns {Map<string, Record<string, unknown>>}
 */
function previousClassifications(previous) {
  /** @type {Map<string, Record<string, unknown>>} */
  const out = new Map();
  if (!isPlainObject(previous) || !isArray(previous.new_signatures)) return out;
  for (const s of previous.new_signatures) {
    if (!isPlainObject(s) || !nonEmptyString(s.test) || !nonEmptyString(s.id)) continue;
    out.set(`${s.test}\u0000${s.id}`, s);
  }
  return out;
}

/**
 * 分類が説明になっているかを判定する。雛形のプレースホルダ（`<...>`）のままの欄は、書いていないものとして読む。
 * @param {Record<string, unknown> | undefined} c
 * @returns {{ classification: string | null, reason: string | null, approved_at: string | null, evidence: string | null, state: "actionable" | "explained" | "unexplained" }}
 */
export function judgeClassification(c) {
  const written = writtenClassification(c);
  const pick = (/** @type {keyof typeof written} */ k) => {
    const v = written[k];
    return v !== null && !isPlaceholder(v) ? v : null;
  };
  const classification = pick("classification");
  const reason = pick("reason");
  const approvedAt = pick("approved_at");
  const evidence = pick("evidence");
  const fields = { classification, reason, approved_at: approvedAt, evidence };
  if (classification === "要対応") return { ...fields, state: "actionable" };
  // 許容は承認を経て確定する。承認の前（許容候補）は説明の付いていない差分として数える
  if (classification === "許容" && reason !== null && approvedAt !== null)
    return { ...fields, state: "explained" };
  if (classification === "環境ノイズ" && evidence !== null)
    return { ...fields, state: "explained" };
  return { ...fields, state: "unexplained" };
}

/**
 * 現側の metadata.json の runtime_errors の宣言を読む。spec-parity の収束の判定（convergence-check.mjs）が、
 * 比較の結果を読むこのスクリプトと同じ読み方で宣言を判定するために、ここで定義する。
 * declared は declared: true、exempt は declared: false と理由（雛形のプレースホルダでない値）の組、absent はキーごと無い記録である。
 * それ以外（オブジェクトでない・declared が雛形の値のまま・真偽値でない・理由の無い declared: false）は invalid にする。
 * @param {unknown} re - metadata.json の runtime_errors
 * @returns {"declared" | "exempt" | "absent" | "invalid"}
 */
export function runtimeErrorsDeclaration(re) {
  if (re === undefined) return "absent";
  if (!isPlainObject(re)) return "invalid";
  if (re.declared === true) return "declared";
  if (re.declared === false && isFilled(re.reason)) return "exempt";
  return "invalid";
}

/**
 * 許容か環境ノイズの分類が、承認の記録（approvals）に同じ値で積まれているかを判定する。
 * 収束の判定（spec-parity の convergence-check.mjs と parity-suite の artifact-health-check.mjs --stage diff）が呼ぶ。
 * 分類の欄は書き直せるので、承認を後から書き換えても欄だけでは検出できない。追記専用の承認の記録と突き合わせて、書き換えを承認待ちにする。
 *
 * 照合するのは kind: runtime_errors で、承認した人（approved_by）と日時（approved_at）を書いた要素だけである。
 * 許容は、同じテスト × 署名・同じ approved_at と reason を持つ要素を求める。classification が無い要素も許容の承認として読む
 * （spec-parity が環境ノイズを照合する前に積んだ要素は classification を持たない）。
 * 環境ノイズは、同じテスト × 署名・classification: 環境ノイズ・同じ evidence を持つ要素を求める。
 * classification を照合の鍵に入れるので、許容の承認を環境ノイズの承認として数えず、その逆も数えない。
 * テストか署名の id が無い署名は、照合の鍵が無いので積まれていないものとして扱う（欠けた鍵どうしを一致させない）。
 * @param {unknown} s - new_signatures の要素
 * @param {{ approvals: unknown[], tree: string | null }} ctx - tree が文字列なら、要素の tree の一致も求める（spec-parity）。null なら見ない（parity-diff）
 * @returns {"logged" | "missing" | "not-required"} not-required は、承認を照合しない状態（要対応・説明の付いていない署名）
 */
export function approvalLogged(s, { approvals, tree }) {
  const judged = judgeClassification(isPlainObject(s) ? s : undefined);
  if (judged.state !== "explained") return "not-required";
  if (!isPlainObject(s) || !nonEmptyString(s.test) || !nonEmptyString(s.id)) return "missing";
  const sameValue =
    judged.classification === "許容"
      ? (/** @type {Record<string, unknown>} */ a) =>
          (a.classification === undefined || a.classification === "許容") &&
          a.approved_at === judged.approved_at &&
          a.reason === judged.reason
      : (/** @type {Record<string, unknown>} */ a) =>
          a.classification === "環境ノイズ" && a.evidence === judged.evidence;
  const found = approvals.some(
    (a) =>
      isPlainObject(a) &&
      a.kind === "runtime_errors" &&
      isFilled(a.approved_by) &&
      isFilled(a.approved_at) &&
      a.test === s.test &&
      a.id === s.id &&
      (tree === null || a.tree === tree) &&
      sameValue(a),
  );
  return found ? "logged" : "missing";
}

/**
 * 前の分類の欄を、書いた値で返す。文字列でない値と、空の文字列（空白だけのものを含む）は null にする。
 * compare --write が書き戻すので、それ以外の読み方（雛形のプレースホルダを外すなど）はここで当てない。分類の欄の一覧はこの関数が持つ。
 * @param {Record<string, unknown> | undefined} c
 * @returns {Record<"classification" | "reason" | "approved_at" | "evidence", string | null>}
 */
function writtenClassification(c) {
  const raw = (/** @type {string} */ k) => (c && nonEmptyString(c[k]) ? String(c[k]) : null);
  return {
    classification: raw("classification"),
    reason: raw("reason"),
    approved_at: raw("approved_at"),
    evidence: raw("evidence"),
  };
}

/**
 * 基準のテストと新側のテストを突き合わせ、記録の欠け・通らなかった・基準に無い・スキップしたテストを挙げる。
 * @param {ReturnType<typeof readBaseline>} baseline
 * @param {ReturnType<typeof collect>["tests"]} tests
 * @param {number} runCount
 */
function testLists(baseline, tests, runCount) {
  /** @type {Record<"missing" | "failed" | "extra" | "skipped" | "currentSkipped", string[]>} */
  const lists = { missing: [], failed: [], extra: [], skipped: [], currentSkipped: [] };
  for (const [test, skippedOnCurrent] of baseline.tests) {
    const t = tests.get(test);
    if (skippedOnCurrent) lists.currentSkipped.push(test);
    else if (!t || t.statuses.length !== runCount) lists.missing.push(test);
    else if (t.statuses.some((s) => s === "skipped")) lists.skipped.push(test);
  }
  for (const [test, t] of tests) {
    if (!baseline.tests.has(test)) lists.extra.push(test);
    if (t.statuses.some((s) => s !== "passed" && s !== "skipped")) lists.failed.push(test);
  }
  for (const list of Object.values(lists)) list.sort(byText);
  return lists;
}

/**
 * 基準に無いテスト × 署名を挙げ、前の分類を持ち越して判定する。
 * @param {ReturnType<typeof readBaseline>} baseline
 * @param {ReturnType<typeof collect>["signatures"]} signatures
 * @param {{ runCount: number, previous: unknown }} ctx
 */
function newSignaturesOf(baseline, signatures, { runCount, previous }) {
  const carried = previousClassifications(previous);
  return (
    [...signatures]
      // 現側でスキップしたテストは基準が無いので比べない（現側の記録が無いことを「現行に無かった」にしない）
      .filter(([key, s]) => !baseline.keys.has(key) && baseline.tests.get(s.test) === false)
      .map(([key, s]) => {
        const c = carried.get(key);
        const { state } = judgeClassification(c);
        return {
          test: s.test,
          ...s.sig,
          seen_runs: s.runs.size,
          runs: runCount,
          sample: s.sample,
          // 書いた値はそのまま書き戻す（雛形のプレースホルダも消さない）。判定は state だけが表す
          ...writtenClassification(c),
          state,
        };
      })
      .sort((a, b) => byText(`${a.test}\u0000${a.id}`, `${b.test}\u0000${b.id}`))
  );
}

/**
 * 新側の N 回を、現側の基準と比べる。
 * @param {unknown} base - metadata.json の runtime_errors
 * @param {{ dir: string, run: number, records: ReturnType<typeof readRecord>[] }[]} runs
 * @param {unknown} previous - 前の diff-metadata.json の runtime_errors（無ければ undefined）
 */
export function compare(base, runs, previous) {
  const baseline = readBaseline(base);
  if (runs.length < MIN_RUNS)
    throw new UsageError(`新側の実行は ${MIN_RUNS} 回以上渡す（渡したのは ${runs.length} 回）`);
  const { tests, signatures } = collect(runs);
  const lists = testLists(baseline, tests, runs.length);
  const newSignatures = newSignaturesOf(baseline, signatures, { runCount: runs.length, previous });
  const count = (/** @type {string} */ state) =>
    newSignatures.filter((s) => s.state === state).length;
  const counts = {
    new_signatures: newSignatures.length,
    actionable: count("actionable"),
    explained: count("explained"),
    unexplained: count("unexplained"),
  };
  return {
    tool: "runtime-errors",
    version: VERSION,
    judged: true,
    ok:
      counts.actionable === 0 &&
      counts.unexplained === 0 &&
      lists.missing.length === 0 &&
      lists.failed.length === 0 &&
      lists.extra.length === 0,
    runs: runs.length,
    counts,
    missing_tests: lists.missing,
    failed_tests: lists.failed,
    extra_tests: lists.extra,
    skipped_tests: lists.skipped,
    current_skipped_tests: lists.currentSkipped,
    new_signatures: newSignatures,
  };
}

const USAGE = [
  "usage: runtime-errors.mjs summarize --metadata <metadata.json> --run <run-1 のディレクトリ> --run <run-2 のディレクトリ> [...] [--write]",
  "       runtime-errors.mjs compare   --metadata <現側 metadata.json> --target <新側の target> --run <run-1> --run <run-2> [...] [--write <diff-metadata.json>] [--tree <記録を採った新側の new.tree>]",
].join("\n");

/**
 * main が使う入出力。テストはメモリ上のファイルを渡す。
 * @typedef {{ readFile: (p: string) => string, writeFile: (p: string, s: string) => void, readDir: (p: string) => string[], cwd: string, stdout: (s: string) => void, stderr: (s: string) => void }} CliIo
 */

/**
 * @param {Partial<CliIo>} deps
 * @returns {CliIo}
 */
function cliIo(deps) {
  return {
    readFile: deps.readFile ?? ((p) => readFileSync(p, "utf8")),
    writeFile: deps.writeFile ?? writeFileAtomic,
    readDir: deps.readDir ?? ((p) => readdirSync(p)),
    cwd: deps.cwd ?? process.cwd(),
    stdout: deps.stdout ?? ((s) => process.stdout.write(s)),
    stderr: deps.stderr ?? ((s) => process.stderr.write(s)),
  };
}

const FLAG_SPECS = {
  summarize: { values: ["--metadata", "--run"], repeat: ["--run"], bools: ["--write"] },
  compare: {
    values: ["--metadata", "--run", "--target", "--write", "--tree"],
    repeat: ["--run"],
  },
};

/**
 * @param {string} path
 * @param {CliIo} io
 * @returns {unknown}
 */
function readJson(path, io) {
  let text;
  try {
    text = io.readFile(resolve(io.cwd, path));
  } catch (e) {
    throw new UsageError(`読めない: ${path}（${errorMessage(e)}）`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new UsageError(`JSON でない: ${path}（${errorMessage(e)}）`);
  }
}

/**
 * 実行のディレクトリから、テストごとの記録（*.json）を読む。
 * @param {string} dir
 * @param {{ side: "current" | "new", slug: string, target: string | null }} expect
 * @param {CliIo} io
 */
function readRun(dir, expect, io) {
  if (isAbsolute(dir) || dir.split(/[\\/]/).includes(".."))
    throw new UsageError(
      `--run はリポジトリのルートからの相対パスで渡す（絶対パスと .. は受けない）: ${dir}`,
    );
  const run = runNumberOf(dir);
  let names;
  try {
    names = io.readDir(resolve(io.cwd, dir));
  } catch (e) {
    throw new UsageError(`実行のディレクトリを読めない: ${dir}（${errorMessage(e)}）`);
  }
  const files = names.filter((n) => n.endsWith(".json")).sort(byText);
  const records = files.map((n) => {
    const file = join(dir, n);
    return readRecord(readJson(file, io), { ...expect, run, file });
  });
  return { dir, run, records };
}

/**
 * @param {Record<string, unknown>} metadata
 * @returns {string}
 */
function slugOf(metadata) {
  if (!nonEmptyString(metadata.slug)) throw new UsageError("metadata.json に slug が無い");
  return metadata.slug;
}

/**
 * 1 回の実行で読んだ引数と metadata.json。
 * @typedef {{ opts: Record<string, string>, runDirs: string[], write: boolean, metadataPath: string, metadata: Record<string, unknown>, slug: string, io: CliIo }} CliRun
 */

/**
 * @param {"summarize" | "compare"} command
 * @param {string[]} rest
 * @param {CliIo} io
 * @returns {CliRun}
 */
function parseRun(command, rest, io) {
  const parsed = parseFlags(rest, FLAG_SPECS[command]);
  if (parsed.error !== undefined) throw new UsageError(parsed.error);
  const opts = stripDashes(parsed.strings);
  if (!opts.metadata) throw new UsageError("--metadata が要る");
  const metadata = readJson(opts.metadata, io);
  if (!isPlainObject(metadata)) throw new UsageError("metadata.json がオブジェクトでない");
  return {
    opts,
    runDirs: parsed.lists["--run"] ?? [],
    write: parsed.bools["--write"] === true,
    metadataPath: resolve(io.cwd, opts.metadata),
    metadata,
    slug: slugOf(metadata),
    io,
  };
}

/**
 * @param {CliRun} r
 * @returns {number}
 */
function runSummarize({ runDirs, write, metadataPath, metadata, slug, io }) {
  const runs = runDirs.map((d) => readRun(d, { side: "current", slug, target: null }, io));
  const result = summarize(runs);
  if (!result.ok) {
    io.stderr(`error: 現側の記録から基準を作れない。${result.problems.join(" / ")}\n`);
    return 1;
  }
  if (write) {
    metadata.runtime_errors = result.runtime_errors;
    io.writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
  }
  const out = { tool: "runtime-errors", version: VERSION, command: "summarize", written: write };
  io.stdout(`${JSON.stringify({ ...out, runtime_errors: result.runtime_errors }, null, 2)}\n`);
  return 0;
}

/**
 * 通らなかった compare の結果から、利用者に示す理由を並べる。
 * @param {ReturnType<typeof compare>} result
 * @returns {string[]}
 */
function compareFailureReasons(result) {
  const reasons = [];
  if (result.counts.actionable > 0) reasons.push(`要対応 ${result.counts.actionable} 件`);
  if (result.counts.unexplained > 0)
    reasons.push(`説明の付いていない署名 ${result.counts.unexplained} 件（トリアージで分類する）`);
  if (result.missing_tests.length > 0)
    reasons.push(`新側の記録が欠けたテスト: ${result.missing_tests.join(", ")}`);
  if (result.failed_tests.length > 0)
    reasons.push(`新側で通らなかったテスト: ${result.failed_tests.join(", ")}`);
  if (result.extra_tests.length > 0)
    reasons.push(`現側の基準に無いテスト（基準を採り直す）: ${result.extra_tests.join(", ")}`);
  return reasons;
}

/**
 * @param {CliRun} r
 * @returns {number}
 */
function runCompare({ opts, runDirs, metadata, slug, io }) {
  if (!nonEmptyString(opts.target)) throw new UsageError("--target が要る");
  // 記録を採った新側のバージョン。読み手（spec-parity の convergence-check.mjs）が new.tree と比べ、古いバージョンで採った比較を数えない
  if (opts.tree !== undefined && (!nonEmptyString(opts.tree) || opts.tree.trim() === "none"))
    throw new UsageError("--tree は記録を採った新側の new.tree（none でない値）で渡す");
  const tree = opts.tree === undefined ? {} : { tree: opts.tree.trim() };
  const runs = runDirs.map((d) => readRun(d, { side: "new", slug, target: opts.target }, io));
  /** @type {Record<string, unknown> | null} */
  let diffMetadata = null;
  if (opts.write) {
    const doc = readJson(opts.write, io);
    if (!isPlainObject(doc)) throw new UsageError("diff-metadata.json がオブジェクトでない");
    diffMetadata = doc;
  }
  const result = {
    ...compare(metadata.runtime_errors, runs, diffMetadata?.runtime_errors),
    ...tree,
  };
  // 書き込みに失敗しても判定の結果が残るよう、先に出力する
  io.stdout(`${JSON.stringify(result, null, 2)}\n`);
  if (diffMetadata && opts.write) {
    diffMetadata.runtime_errors = { ...result, run_dirs: [...runDirs].sort(byText) };
    io.writeFile(resolve(io.cwd, opts.write), `${JSON.stringify(diffMetadata, null, 2)}\n`);
  }
  if (result.ok) return 0;
  io.stderr(
    `error: 現行に無かったエラーの比較が通らない。${compareFailureReasons(result).join(" / ")}\n`,
  );
  return 1;
}

/** サブコマンドごとの処理。 */
const COMMANDS = { summarize: runSummarize, compare: runCompare };

/**
 * @param {string | undefined} command
 * @returns {command is keyof typeof COMMANDS}
 */
function isCommand(command) {
  return command === "summarize" || command === "compare";
}

/**
 * @param {string[]} argv - process.argv.slice(2)
 * @param {Partial<CliIo>} [deps]
 * @returns {number}
 */
export function main(argv, deps = {}) {
  const io = cliIo(deps);
  const [command, ...rest] = argv;
  if (!isCommand(command)) {
    io.stderr(`error: サブコマンドが無い・不明: ${command ?? ""}\n${USAGE}\n`);
    return 2;
  }
  try {
    return COMMANDS[command](parseRun(command, rest, io));
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    io.stderr(`error: ${errorMessage(e)}\n${USAGE}\n`);
    return 2;
  }
}

if (isCliEntry(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
