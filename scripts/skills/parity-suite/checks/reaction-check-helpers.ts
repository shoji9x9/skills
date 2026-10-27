// reaction-check.test.ts が使うヘルパーと fixture。
import { assert } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir } from "../../../lib/testing/test-tmpdir.ts";
import { isRecord } from "../../../lib/guards.ts";
import { parseJsonAs } from "../../../lib/parse-as.ts";
import { isArray } from "../../../lib/is-array.ts";
import { CHILD_TIMEOUT_MS } from "../../../lib/testing/child-timeout.ts";
import {
  main,
  coveredByOwners,
  tableFingerprint,
  indexTestList,
  specsFingerprint,
  OPERATIONLESS_TABLE_REVISION,
} from "../../../../skills/parity-suite/scripts/reaction-check.mjs";

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const script = join(repoRoot, "skills/parity-suite/scripts/reaction-check.mjs");
export { coveredByOwners, tableFingerprint, OPERATIONLESS_TABLE_REVISION };

/** 観測した反応（トースト）。消えるまでの時間を 2 標本で持つ。 */
export const toast = (): ObservedReaction => ({
  id: "toast",
  kind: "observed",
  description: "コピー完了のトースト",
  visible: true,
  destination: { document: "top", locator: "コピー完了の通知" },
  appearance: { wait_limit_ms: 5000, delay_ms_samples: [480, 530] },
  dismissal: { mode: "auto", duration_ms_samples: [15400, 15600], tolerance_ms: 500 },
  covered_by: ["share.spec.ts › コピーで通知が出て消える"],
  shared_assertion_reason:
    "通知が出て消えることを確かめる 1 本で、状態表示の toast の行の期待値（出て消える）も同じ assertion が確かめる",
  capture: { state: "copy-toast", reason: null },
});

/** 反応が無いことを実測で書いた操作。 */
const noneReaction = (): NoneReaction => ({
  id: "none",
  kind: "none",
  observation: {
    window_ms: 3000,
    documents: ["top", "共有ダイアログの iframe"],
    source_document: "top",
    method: "全文書の DOM 変化を監視",
  },
  covered_by: ["search.spec.ts › 検索で観測時間内にどの文書にも通知が出ない"],
});

/** 操作で頁の組み方が変わらないことを実測で書いた記録。 */
export const noLayoutChange = (): LayoutUnchanged => ({
  changes: false,
  evidence: "操作の前後で scrollHeight と主な論理名の矩形が同じ",
  covered_by: ["layout.spec.ts › 操作の後も頁の高さが変わらない"],
});

/** 頁の組み方を変える操作の記録（条件の行を足すたびに、グリッドの高さを窓の高さから書き直す）。 */
const layoutChange = (): LayoutChanged => ({
  changes: true,
  before: {
    scroll_height: 768,
    client_height: 768,
    rects: { 条件の行2: null, グリッド: { x: 0, y: 100, width: 1366, height: 600 } },
  },
  samples: [
    {
      repeat: 1,
      scroll_height: 768,
      client_height: 768,
      rects: {
        条件の行2: { x: 0, y: 57, width: 1366, height: 36 },
        グリッド: { x: 0, y: 136, width: 1366, height: 564 },
      },
    },
    {
      repeat: 2,
      scroll_height: 768,
      client_height: 768,
      rects: {
        条件の行2: { x: 0, y: 57, width: 1366, height: 36 },
        グリッド: { x: 0, y: 172, width: 1366, height: 528 },
      },
    },
  ],
  covered_by: ["layout.spec.ts › 条件を 2 回足した後も頁が窓に収まりグリッドが縮む"],
});

/** 押した後に見た目が残らず、どこへも戻らないことを実測で書いた記録（Issue #471）。 */
export const quietAftermath = (): { look: LookUnchanged; returns_to: ReturnsMeasured } => ({
  look: {
    changes: false,
    evidence: "押した後に対象の論理名の計算後スタイルと印の文言が押す前と同じ",
    targets: ["コピーボタン", "一覧"],
    covered_by: ["share.spec.ts › コピーの後もボタンと一覧の計算後スタイルが押す前と同じ"],
  },
  returns_to: {
    measured: true,
    url_before: "/share?id=1",
    url_after: "/share?id=1",
    probed: ["検索条件", "並べ替え", "列フィルター", "列の変更"],
    reset: [],
    not_probed: {},
    covered_by: [
      "share.spec.ts › コピーの後も URL と検索条件・並べ替え・列フィルター・列の変更が残る",
    ],
  },
});

/** 押した後に見た目が残り、状態の一部を戻す操作の記録（絞り込み中の見出しの色・Clear が戻す範囲）。 */
export const lingeringAftermath = (): { look: LookChanged; returns_to: ReturnsMeasured } => ({
  look: {
    changes: true,
    items: [
      {
        id: "filtered-header",
        target: "価格列の見出し",
        description: "絞り込み中の見出しの文字色",
        observed: "color: rgb(204, 0, 0)",
        captured: null,
        covered_by: ["search.spec.ts › 絞り込んだ列の見出しが赤くなる"],
        reason: null,
      },
      {
        id: "result-toast",
        target: "コピー完了の通知",
        description: "押した後に残る通知の背景",
        observed: "background-color: rgb(0, 128, 0)",
        captured: null,
        covered_by: ["search.spec.ts › 押した後に通知の背景が緑で残る"],
        reason: null,
      },
    ],
  },
  returns_to: {
    measured: true,
    url_before: "/share?id=1&sort=price",
    url_after: "/share?id=1",
    probed: ["検索条件", "並べ替え", "列フィルター", "列の変更"],
    reset: ["検索条件", "並べ替え", "列フィルター", "列の変更"],
    not_probed: {},
    covered_by: ["search.spec.ts › Clear で検索条件と並べ替え・列フィルター・列の変更が既定に戻る"],
  },
});

/**
 * 書き出しの送信の関数（共通部品の内側）。上限の判定と、書き出しの前・例外時のアクセスログへの書き込みを持つ（Issue #483 / #466）。
 * 行・列は side_effect_writes.sites と送る前の判定の location が参照するので、動かしたら両方を直す。
 */
const EXPORT_SOURCE = [
  "function sendExport(rows) {",
  "  if (rows.length > 500) return alertLimit();",
  "  writeAccessLog('export');",
  "  try { post(rows); } catch (e) { writeAccessLog('error'); }",
  "}",
  "",
].join("\n");

/** EXPORT_SOURCE の中の書き込みの位置（1 始まりの行・列）。 */
export const writeAt = (line: number): WritePosition => ({
  file: "src/export.js",
  line,
  column: EXPORT_SOURCE.split("\n")[line - 1].indexOf("writeAccessLog") + 1,
  pattern: "access-log",
});

/** 到達点まで読んで送る前の判定が無いことを確かめた記録。 */
export const noPreSend = (): PreSendNone => ({
  found: false,
  traced_to: [{ file: "src/share.js", symbol: "copy" }],
  trace: "コピーボタンのハンドラ copy から、クリップボードへ書く処理まで読んだ",
  evidence: "copy の中に件数・長さ・形式を判定して止める分岐が無い",
});

/** 送信の関数の中にある件数の上限を、境界の両側で測った記録。 */
export const rowLimit = (): PreSendFound => ({
  found: true,
  traced_to: [{ file: "src/export.js", symbol: "sendExport" }],
  trace: "検索ボタンのハンドラ search → 書き出しの共通部品 → 送信の関数 sendExport",
  items: [
    {
      id: "max-rows",
      kind: "count-limit",
      location: { file: "src/export.js", symbol: "sendExport" },
      condition: "選んだ行が 500 件を超える",
      on_block: "上限の通知を出して送信しない",
      order: ["confirm", "max-rows", "write-log", "send"],
      sides: [
        {
          side: "inside",
          input: "500 行を選ぶ",
          setup: "ゴールデンデータの 600 行から 500 行を選ぶ",
          observed: "送信される",
          covered_by: ["export.spec.ts › 500 行なら送信される"],
        },
        {
          side: "outside",
          input: "501 行を選ぶ",
          setup: "ゴールデンデータの 600 行から 501 行を選ぶ",
          observed: "上限の通知が出て送信されない",
          covered_by: ["export.spec.ts › 501 行なら通知が出て送信されない"],
        },
      ],
    },
  ],
});

/** アクセスログの表への書き込みを、書き出しの前と例外時の 2 か所で記録した表。 */
const sideEffectWrites = (): WritesDeclared => ({
  declared: true,
  reason: null,
  tables: ["access_log"],
  patterns: [
    {
      id: "access-log",
      table: "access_log",
      regex: "\\bwriteAccessLog\\s*\\(",
      example: "writeAccessLog('export')",
    },
  ],
  source: { paths: ["src"], version: "abc123" },
  sites: [
    {
      ...writeAt(3),
      operation: "search",
      occasion: "送信の前（上限の判定の後）",
      path: "normal",
      values: "種別 export・利用者 id",
      count: "1 操作につき 1 行",
      verification: "assertion",
      covered_by: ["export.spec.ts › 書き出しの前にアクセスログが 1 行書かれる"],
    },
    {
      ...writeAt(4),
      operation: "search",
      occasion: "送信が例外で失敗したとき",
      path: "exception",
      values: "種別 error・利用者 id",
      count: "失敗 1 回につき 1 行",
      verification: "source-only",
      source_only_reason: "移行元の送信を例外で失敗させられない",
    },
  ],
});

/** 要求を送らない操作（クリップボードへ書くだけ）の押し直しの記録（Issue #500）。 */
const noResubmit = (): ResubmitNone => ({
  sends: false,
  reason: "copy はクリップボードへ書くだけで要求を送らない（押している間の通信を監視して 0 件）",
});

/** 応答を保留して押し直した記録。表への書き込みを持つ操作なので書き込みの回数も数える（Issue #500）。 */
export const heldResubmit = (): ResubmitHeld => ({
  sends: true,
  reason: null,
  hold: { method: "route-delay", request: "/api/export" },
  presses: 2,
  observed: {
    requests_sent: 1,
    confirms_shown: 1,
    overlay: "送信中は画面を覆い、2 回目の押下を受け付けない",
  },
  writes: { count: 1, evidence: "押し直しの後に access_log の行を数えて 1 行" },
  covered_by: ["export.spec.ts › 応答の保留中に 2 回押しても送信 1 回・確認 1 回"],
});

/** 1 画面の状態表示の候補を全て振り分けた記録（Issue #500）。 */
export const stateDisplayRow = (page = "共有画面"): StateDisplayPage => ({
  page,
  candidates: {
    empty: {
      status: "present",
      setup: { method: "data", detail: "一致する行が無い検索条件で検索する" },
      observed: "覆いに「結果が無い」の文言、ページ表示 1 / 0",
      covered_by: [`share.spec.ts › ${page}: 0 件で結果が無い旨とページ表示 1 / 0 が出る`],
    },
    "fetch-error": {
      status: "present",
      setup: {
        method: "route-abort",
        request: "/api/share/list",
        detail: "一覧の取得を page.route で abort する",
      },
      observed: "覆いを出したまま、検索ボタンの操作を受け付ける",
      covered_by: [`share.spec.ts › ${page}: 取得に失敗すると覆いが残り検索は押せる`],
    },
    loading: {
      status: "absent",
      setup: {
        method: "route-delay",
        request: "/api/share/list",
        detail: "一覧の応答を 5 秒保留する",
      },
      observed: "保留している間も表示が変わらない（読み込み中の表示が出ない）",
      covered_by: [`share.spec.ts › ${page}: 応答の保留中に読み込み中の表示が出ない`],
    },
    // 通知は操作の反応を参照せず、反応と同じ assertion 名で押さえる（1 本を 2 行が名乗るので両方に根拠を書く。Issue #506）
    toast: {
      status: "present",
      setup: { method: "ui", detail: "コピーを押す" },
      observed: "コピー完了のトーストが最上部に出て消える",
      covered_by: ["share.spec.ts › コピーで通知が出て消える"],
      shared_assertion_reason:
        "コピーの反応の行と同じ 1 本が、トーストが最上部に出て消えることまで確かめる",
    },
    dialog: {
      status: "absent",
      setup: { method: "not-applicable", detail: "画面がダイアログを開かない" },
      observed: "移行元の画面のテンプレートにダイアログの要素が無い",
    },
  },
});

export const baseTable = (): Table => ({
  slug: "share",
  measured_target: "current-test",
  documents: ["top", "共有ダイアログの iframe"],
  document_origins: { top: "same-origin", "共有ダイアログの iframe": "same-origin" },
  cross_origin_evidence: {},
  observation_window_ms: 3000,
  screen_states: {
    states: ["検索条件", "並べ替え", "列フィルター", "列の変更"],
    source:
      "移行元ソースの一覧画面が保持する状態（検索フォームの値・グリッドの並べ替え・列フィルター・列の表示設定）",
  },
  feedback_calls: {
    declared: true,
    reason: null,
    patterns: [{ id: "toast", regex: "\\bshowFeedback\\s*\\(", example: "showFeedback('Copied')" }],
    source: { paths: ["src"], version: "abc123" },
    call_sites: [
      { file: "src/share.js", line: 2, column: 3, pattern: "toast", reaction: "copy/toast" },
    ],
  },
  side_effect_writes: sideEffectWrites(),
  state_displays: { pages: [stateDisplayRow()] },
  operations: [
    {
      id: "copy",
      trigger: "clickButton(コピー)",
      handlers: [{ file: "src/share.js", symbol: "copy" }],
      immediate_state: "ダイアログが閉じる",
      layout: noLayoutChange(),
      aftermath: quietAftermath(),
      pre_send: noPreSend(),
      resubmit: noResubmit(),
      reactions: [toast()],
    },
    {
      id: "search",
      trigger: "clickButton(検索)",
      handlers: [{ file: "src/share.js", symbol: "search" }],
      immediate_state: "一覧が絞られる",
      layout: layoutChange(),
      aftermath: lingeringAftermath(),
      pre_send: rowLimit(),
      resubmit: heldResubmit(),
      reactions: [noneReaction()],
    },
  ],
});

/*
 * 網羅表の型。チェックが受ける形（同じ欄の正規の別の形を含む）を、欄ごとに宣言する。
 * declared: false・measured: false・changes: null のように、同じ欄が正規に持つ別の形は判別できる共用体にする。
 * テストが正規の形の値で書き換えるなら、そのまま代入できる。型に合わない値・欠けた必須の欄は invalidInput で渡す。
 */

/** ソースの中の位置（ファイルとシンボル）。 */
type Located = { file: string; symbol: string };

/** 走査した移行元ソースの範囲。 */
type ScanSource = { paths: string[]; version: string; version_unverified_reason?: string };

/** observed の消え方。auto は消えるまでの時間の標本を、それ以外は消えない・消し方の根拠を持つ。 */
type AutoDismissal = { mode: "auto"; duration_ms_samples: number[]; tolerance_ms: number };
type OtherDismissal = { mode: "manual" | "persistent" | "not-applicable"; evidence: string };

/** 観測した反応。 */
type ObservedReaction = {
  id: string;
  kind: "observed";
  description: string;
  visible: boolean;
  /** 見えない反応をどう確かめたか。 */
  observation?: string;
  destination: { document: string; locator: string };
  appearance: { wait_limit_ms: number; delay_ms_samples: number[] };
  dismissal: AutoDismissal | OtherDismissal;
  covered_by: string[];
  shared_assertion_reason?: string;
  capture: { state: string | null; reason: string | null; shared_capture_reason?: string | null };
};

/** 反応が無いことの観測。 */
type NoneObservation = {
  window_ms: number;
  documents: string[];
  source_document: string;
  method: string;
};
type NoneReaction = {
  id: string;
  kind: "none";
  observation: NoneObservation;
  covered_by: string[];
};

/** 観測できなかった反応（未測定として数えられる）。 */
type UnmeasuredReaction = { id: string; kind: "unmeasured"; reason: string };

type Reaction = ObservedReaction | NoneReaction | UnmeasuredReaction;

/** layout の矩形。 */
export type Rect = { x: number; y: number; width: number; height: number };
/** 操作の前の測定。 */
type LayoutMeasure = {
  scroll_height: number;
  client_height: number;
  rects: Record<string, Rect | null>;
};
/** 操作を繰り返した後の測定。 */
type LayoutSample = LayoutMeasure & { repeat: number };
type LayoutUnchanged = { changes: false; evidence: string; covered_by: string[] };
type LayoutChanged = {
  changes: true;
  before: LayoutMeasure;
  samples: LayoutSample[];
  covered_by: string[];
};
type LayoutUnmeasured = { changes: null; reason: string };
type Layout = LayoutUnchanged | LayoutChanged | LayoutUnmeasured;

/** 押した後に残る見た目の 1 行。 */
export type LookItem = {
  id: string;
  target: string;
  description: string;
  observed: string;
  captured: string | null;
  covered_by: string[];
  reason: string | null;
  shared_capture_reason?: string | null;
};
type LookUnchanged = { changes: false; evidence: string; targets: string[]; covered_by: string[] };
export type LookChanged = { changes: true; items: LookItem[] };
type LookUnmeasured = { changes: null; reason: string };
type Look = LookUnchanged | LookChanged | LookUnmeasured;

/** 押した後にどこへ戻るか。 */
type ReturnsMeasured = {
  measured: true;
  url_before: string;
  url_after: string;
  probed: string[];
  reset: string[];
  not_probed: Record<string, string>;
  covered_by: string[];
};
type ReturnsUnmeasured = { measured: false; reason: string };
type Aftermath = { look: Look; returns_to: ReturnsMeasured | ReturnsUnmeasured };

/** 送る前の判定の境界の片側。測れなかった側は observed の代わりに reason を持つ。 */
type PreSendSide = {
  side: "inside" | "outside";
  input: string;
  setup: string;
  observed?: string;
  covered_by: string[];
  reason?: string;
};
type PreSendItem = {
  id: string;
  kind: "count-limit" | "length-limit" | "size-limit" | "required" | "format" | "range" | "other";
  location: Located;
  condition: string;
  on_block: string;
  order: string[];
  sides: PreSendSide[];
};
type PreSendNone = { found: false; traced_to: Located[]; trace: string; evidence: string };
export type PreSendFound = {
  found: true;
  traced_to: Located[];
  trace: string;
  items: PreSendItem[];
};
type PreSendUnmeasured = { found: null; reason: string };
type PreSend = PreSendNone | PreSendFound | PreSendUnmeasured;

/** 送っている間の押し直し。 */
type ResubmitNone = { sends: false; reason: string };
export type ResubmitHeld = {
  sends: true;
  reason: null;
  hold: { method: "route-delay"; request: string };
  presses: number;
  observed: { requests_sent: number; confirms_shown: number; overlay: string };
  /** 表への書き込みを持つ操作だけが持つ。 */
  writes?: { count: number; evidence: string };
  covered_by: string[];
};
type ResubmitUnmeasured = { sends: null; reason: string };
type Resubmit = ResubmitNone | ResubmitHeld | ResubmitUnmeasured;

/** covered_by だけを持つ行（表全体を歩くことを測るために、決まった欄の外に置く）。 */
type CoveredRow = { covered_by: string[] | null };

type Operation = {
  id: string;
  trigger: string;
  handlers: Located[];
  immediate_state: string;
  capture_page?: string;
  layout: Layout;
  aftermath: Aftermath;
  pre_send: PreSend;
  resubmit: Resubmit;
  reactions: Reaction[];
  /** 表に無い欄（covered_by の走査が欄を列挙せず表全体を歩くことを測る）。 */
  future_field?: CoveredRow;
  _draft?: CoveredRow;
};

/** フィードバック呼び出しのパターンと、ソースの中の呼び出し箇所。 */
type CallPattern = { id: string; regex: string; example: string };
type CallSite = {
  file: string;
  line: number;
  column: number;
  pattern: string;
  reaction: string | null;
  excluded_reason?: string;
};
type FeedbackDeclared = {
  declared: true;
  reason: null;
  patterns: CallPattern[];
  source: ScanSource;
  call_sites: CallSite[];
  zero_calls_reason?: string;
};
type FeedbackUndeclared = { declared: false; reason: string };

/** 表への書き込みのパターンと、ソースの中の書き込み箇所（この機能の書き込みと、別機能として除外した書き込み）。 */
type WritePattern = { id: string; table: string; regex: string; example: string };
type WritePosition = { file: string; line: number; column: number; pattern: string };
type RecordedWrite = WritePosition & {
  operation: string | null;
  occasion: string;
  path: "normal" | "exception";
  values: string;
  count: string;
  verification: "assertion" | "source-only";
  covered_by?: string[];
  source_only_reason?: string;
};
type ExcludedWrite = WritePosition & { excluded_reason: string };
type WriteSite = RecordedWrite | ExcludedWrite;
type WritesDeclared = {
  declared: true;
  reason: null;
  tables: string[];
  patterns: WritePattern[];
  source: ScanSource;
  sites: WriteSite[];
};
/** 書き込みを持たない機能。空の配列は記録とみなされない。 */
type WritesUndeclared = {
  declared: false;
  reason: string;
  tables?: string[];
  patterns?: WritePattern[];
  sites?: WriteSite[];
};

/** 状態表示の 1 候補。 */
type CandidateSetup = {
  method:
    | "data"
    | "ui"
    | "route-abort"
    | "route-fulfill"
    | "route-delay"
    | "no-request"
    | "not-applicable";
  request?: string;
  detail: string;
};
type MeasuredCandidate = {
  status: "present" | "absent";
  setup: CandidateSetup;
  observed: string;
  covered_by?: string[];
  captured?: string;
  shared_assertion_reason?: string;
  shared_capture_reason?: string;
};
type UnmeasuredCandidate = { status: "unmeasured"; reason: string };
type Candidate = MeasuredCandidate | UnmeasuredCandidate;
type Candidates = {
  empty: Candidate;
  "fetch-error": Candidate;
  loading: Candidate;
  toast: Candidate;
  dialog: Candidate;
};
type StateDisplayPage = { page: string; candidates: Candidates };

/** 監査の記録。 */
type AuditEntry = { path: string; verdict: string; checked: string | null; missing: string | null };
export type Audit = {
  auditor: string;
  table_fingerprint: string;
  specs_fingerprint?: string | null;
  entries: AuditEntry[];
};

/** テストが書き換える網羅表。 */
export type Table = {
  slug: string;
  measured_target: string;
  documents: string[];
  document_origins: Record<string, "same-origin" | "cross-origin">;
  cross_origin_evidence: Record<string, string>;
  observation_window_ms: number | null;
  screen_states: { states: string[]; source: string };
  feedback_calls: FeedbackDeclared | FeedbackUndeclared;
  side_effect_writes: WritesDeclared | WritesUndeclared;
  state_displays: { pages: StateDisplayPage[] };
  operations: Operation[];
  operations_none_reason?: string;
  assertion_audit?: Audit;
  /** テストだけの欄。移行元ソースの差し替えを mutate から run へ渡す（表に残さず消してから run に渡す）。 */
  __source?: string;
  /** 区切りを含むキーと入れ子のキー（位置の衝突を測る）。 */
  "a.b"?: CoveredRow;
  a?: { b: CoveredRow };
};

/**
 * baseTable の操作 copy（operations[0]）の形。
 * 組み方を変えない・何も残さない・送る前の判定が無い・要求を送らない。反応は自動で消えるトースト。
 */
type CopyOperation = Omit<
  Operation,
  "layout" | "aftermath" | "pre_send" | "resubmit" | "reactions"
> & {
  layout: LayoutUnchanged;
  aftermath: { look: LookUnchanged; returns_to: ReturnsMeasured };
  pre_send: PreSendNone;
  resubmit: ResubmitNone;
  reactions: [ObservedReaction & { dismissal: AutoDismissal }, ...Reaction[]];
};

/**
 * baseTable の操作 search（operations[1]）の形。
 * 組み方を変える・見た目が残る・送る前の判定がある・応答を保留して押し直す。反応は無い。
 */
type SearchOperation = Omit<
  Operation,
  "layout" | "aftermath" | "pre_send" | "resubmit" | "reactions"
> & {
  layout: LayoutChanged;
  aftermath: { look: LookChanged; returns_to: ReturnsMeasured };
  pre_send: PreSendFound;
  resubmit: ResubmitHeld;
  reactions: [NoneReaction, ...Reaction[]];
};

const isCopyOperation = (op: Operation): op is CopyOperation =>
  op.layout.changes === false &&
  op.aftermath.look.changes === false &&
  op.aftermath.returns_to.measured === true &&
  op.pre_send.found === false &&
  op.resubmit.sends === false &&
  op.reactions.length > 0 &&
  op.reactions[0].kind === "observed" &&
  op.reactions[0].dismissal.mode === "auto";

const isSearchOperation = (op: Operation): op is SearchOperation =>
  op.layout.changes === true &&
  op.aftermath.look.changes === true &&
  op.aftermath.returns_to.measured === true &&
  op.pre_send.found === true &&
  op.resubmit.sends === true &&
  op.reactions.length > 0 &&
  op.reactions[0].kind === "none";

/*
 * 網羅表の欄を、baseTable が置いた形に絞って返す。テストは、その形の中の欄を書き換える。
 * 形が違えば、テストの組み立ての誤りとして、書き換える前に落とす。
 */

/** 操作 copy（operations[0]）。 */
export function copyOp(t: Table): CopyOperation {
  const op = t.operations[0];
  assert.exists(op, "operations[0] が無い");
  assert(isCopyOperation(op), "operations[0] が baseTable の copy の形でない");
  return op;
}

/** 操作 search（operations[1]）。 */
export function searchOp(t: Table): SearchOperation {
  const op = t.operations[1];
  assert.exists(op, "operations[1] が無い");
  assert(isSearchOperation(op), "operations[1] が baseTable の search の形でない");
  return op;
}

/** 操作の、測った戻り先。 */
export function measuredReturns(op: Operation): ReturnsMeasured {
  const r = op.aftermath.returns_to;
  assert(r.measured, `operations["${op.id}"].aftermath.returns_to が measured: true でない`);
  return r;
}

/** declared: true のフィードバック呼び出しの記録。 */
export function feedback(t: Table): FeedbackDeclared {
  const f = t.feedback_calls;
  assert(f.declared, "feedback_calls が declared: true でない");
  return f;
}

/** declared: true の表への書き込みの記録。 */
export function writes(t: Table): WritesDeclared {
  const w = t.side_effect_writes;
  assert(w.declared, "side_effect_writes が declared: true でない");
  return w;
}

/** 表への書き込みのうち、この機能の書き込みとして記録した i 番目。 */
export function recordedWrite(t: Table, i: number): RecordedWrite {
  const s = writes(t).sites[i];
  assert.exists(s, `side_effect_writes.sites[${i}] が無い`);
  assert("verification" in s, `side_effect_writes.sites[${i}] が除外の記録`);
  return s;
}

/** 最初の画面の状態表示の、測った候補。 */
export function candidate(t: Table, c: keyof Candidates): MeasuredCandidate {
  const page = t.state_displays.pages[0];
  assert.exists(page, "state_displays.pages[0] が無い");
  const found = page.candidates[c];
  assert(found.status !== "unmeasured", `候補 ${c} が未測定`);
  return found;
}

/** 操作の前後の測定の、論理名の矩形。 */
export function rectOf(m: LayoutMeasure, name: string): Rect {
  const r = m.rects[name];
  assert.exists(r, `rects.${name} が無い`);
  return r;
}

/** 操作 search の押し直しで数えた書き込みの回数。 */
export function resubmitWrites(t: Table): NonNullable<ResubmitHeld["writes"]> {
  const w = searchOp(t).resubmit.writes;
  assert.exists(w, "operations[1].resubmit.writes が無い");
  return w;
}

/** 同梱の部品網羅表のテンプレート（テストが読む欄だけ）。 */
type CoverageTemplate = {
  components: { id: string; instances: { id: string; page?: string }[] }[];
  visual_state_coverage: { rows: Record<string, unknown>[] };
};

/** 監査の記録。 */
export function auditOf(t: Table): Audit {
  assert.exists(t.assertion_audit, "assertion_audit が無い");
  return t.assertion_audit;
}

/** ルートの外に置くファイルの名前と、その絶対パスに置き換える目印（テストの表を書く時点では一時ディレクトリが決まっていない）。 */
export const OUTSIDE_FILE = "outside.js";
export const OUTSIDE_ABS = "__OUTSIDE_ABS__";
/** ルートの中のファイル（src/export.js）の絶対パスに置き換える目印。 */
export const INSIDE_ABS = "__INSIDE_ABS__";

/**
 * main を同じプロセスで呼ぶ（子プロセスの起動を省く。ミューテーションテストが変異ごとにこのファイルを丸ごと回すため、Issue #507）。
 * CLI として起動できること（エントリ判定・引数と出力・終了コードの受け渡し）は cli() の通ることの確認が受け持つ。
 * @param {string} dir - 起動時の作業ディレクトリ
 * @param {string[]} args
 */
function call(dir: string, args: string[]) {
  args = withTests(args);
  let stdout = "";
  let stderr = "";
  const status = main(["--metadata", "metadata.json", ...args], {
    cwd: dir,
    out: (s: string) => (stdout += s),
    err: (s: string) => (stderr += s),
  });
  return { dir, status, stdout, stderr };
}

/**
 * 子プロセスとして CLI を起動する。
 * @param {string} dir
 * @param {string[]} [args]
 */
export function cli(dir: string, args: string[] = []) {
  const r = spawnSync(
    process.execPath,
    [script, "--metadata", "metadata.json", ...withTests(args)],
    { timeout: CHILD_TIMEOUT_MS, cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return { dir, status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/**
 * --tests の一覧（run が書く tests.json）を足す。--no-tests は足さない（一覧が無いときの振る舞いを測る）。
 * @param {string[]} args
 */
function withTests(args: string[]) {
  return args.includes("--tests") || args.includes("--no-tests")
    ? args.filter((a: string) => a !== "--no-tests")
    : [...args, "--tests", "tests.json"];
}

/** testList が作るテストの一覧の要素（`playwright test --list --reporter=json` の出力の形）。 */
export type Spec = {
  title: string | undefined;
  file: string;
  line: number;
  column: number;
  tests: {
    projectName: string;
    expectedStatus: string;
    annotations: unknown[];
    results: unknown[];
  }[];
};
type Suite = {
  title: string;
  file: string;
  line: number;
  column: number;
  specs: Spec[];
  suites: Suite[];
};
type TestList = {
  config: Record<string, unknown>;
  suites: Suite[];
  errors: unknown[];
  stats: Record<string, unknown>;
};

/** テストの一覧の、ファイル file のトップレベルの suite。 */
export function suiteOf(list: TestList, file: string): Suite {
  const found = list.suites.find((s) => s.file === file);
  assert.exists(found, `一覧に ${file} の suite が無い`);
  return found;
}

/**
 * `playwright test --list --reporter=json` の出力の形（@playwright/test 1.63.0 の実測）で、テストの一覧を作る。
 * 名前は「スペックのパス › 題 …」で、最初の区切りの前をファイル、残りを describe と題に割る。spec は projects ごとに別の要素で並ぶ。
 * @param {string[]} names
 * @param {string[]} [projects]
 */
export function testList(names: string[], projects: string[] = ["current", "new"]): TestList {
  /** @type {Map<string, object>} */
  const files = new Map<string, Suite>();
  for (const name of names) {
    const [file, ...titles] = name.split(" › ");
    // 区切りの無い名前（テンプレートの説明文など）はどのテストにもならない
    if (titles.length === 0) continue;
    const top = files.get(file) ?? { title: file, file, line: 0, column: 0, specs: [], suites: [] };
    files.set(file, top);
    let suite = top;
    for (const t of titles.slice(0, -1)) {
      let child = suite.suites.find((c: Suite) => c.title === t);
      if (!child) {
        child = { title: t, file, line: 1, column: 1, specs: [], suites: [] };
        suite.suites.push(child);
      }
      suite = child;
    }
    for (const projectName of projects) {
      suite.specs.push({
        title: titles.at(-1),
        file,
        line: 3,
        column: 3,
        tests: [{ projectName, expectedStatus: "passed", annotations: [], results: [] }],
      });
    }
  }
  return { config: {}, suites: [...files.values()], errors: [], stats: {} };
}

/** 表の全ての covered_by を名乗った通りの一覧と、全行を reaches とした監査の記録を作る（通ることの確認で使う既定）。 */
export function passingAudit(table: Table): Audit {
  return {
    auditor: "監査役の subagent（実装役と別の文脈）",
    table_fingerprint: tableFingerprint(table),
    entries: coveredByOwners(table).map((o) => ({
      path: o.path,
      verdict: "reaches",
      checked: "期待値の全ての部分を covered_by の assertion が確かめている",
      missing: null,
    })),
  };
}

/** @param {unknown} v @returns {v is Record<string, any>} */

/**
 * 名指しされたスペックを一時プロジェクトに置く（中身は監査の指紋を取るためだけのもの）。
 * @param {string} dir
 * @param {string} file
 */
function writeSpec(dir: string, file: string) {
  const path = join(dir, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `// ${file}\nexpect(page.getByText('Saved')).toHaveText('Saved');\n`);
}

/** run の差し替え。tests は名前の一覧か、一覧そのもの（わざと不正な一覧も渡す）。 */
type RunOptions = {
  args?: string[];
  metadata?: Record<string, unknown>;
  source?: string;
  exportSource?: string;
  tests?: string[] | Record<string, unknown>;
  audit?: false;
  coverage?: unknown;
};

/**
 * 一時プロジェクトを作って main を実行する。
 * tests.json（--tests）は表の covered_by から、assertion_audit は表に無ければ全行 reaches で作る。
 * 変えたいテストは opts.tests（名前の一覧か、一覧そのもの）・opts.audit: false で差し替える。
 * @param {object} table
 * 部品網羅表（opts.coverage）を渡すと component-coverage.json として置く（metadata の component_coverage.path が指す先）。
 * @param {{ args?: string[], metadata?: object, source?: string, exportSource?: string, tests?: string[] | object, audit?: false, coverage?: object }} [opts]
 */
export function run(table: Record<string, unknown>, opts: RunOptions = {}) {
  const paths = makeRunProject(opts);
  const final = finalTable(table, paths, opts);
  const list = writeTestList(paths.dir, final, opts);
  copySpecsFingerprint(final, list, paths.dir);
  writeFileSync(join(paths.dir, "reactions.json"), JSON.stringify(final));
  return call(paths.dir, opts.args ?? []);
}

/** run の一時プロジェクト（outer の下の dir）に、移行元ソース・metadata・部品網羅表を置く。 */
function makeRunProject(opts: RunOptions) {
  // 移行元ソースのルート（dir）の外に、実在するファイルを 1 つ置く。ルートの外を指す参照を照合が読まないことを確かめるための入力
  // （外に何も無いと、判定を外しても「読めない」で落ち、判定の有無を区別できない）
  const outer = makeTempDir("reaction-check-");
  writeFileSync(join(outer, OUTSIDE_FILE), "function sendOutside() {}\n");
  const dir = join(outer, "project");
  mkdirSync(dir);
  mkdirSync(join(dir, "src"));
  // 操作 search のハンドラは全ての source の末尾に置く（行番号を動かさない）
  writeFileSync(
    join(dir, "src/share.js"),
    `${opts.source ?? "function copy() {\n  showFeedback('Copied');\n}\n"}function search() {}\n`,
  );
  writeFileSync(join(dir, "src/export.js"), opts.exportSource ?? EXPORT_SOURCE);
  mkdirSync(join(dir, "empty"));
  const metadata = opts.metadata ?? {
    slug: "share",
    target: { name: "current-test", commit: "abc123", ui_url: "http://localhost:3000/" },
    reaction_coverage: { declared: true, path: "reactions.json" },
    capture_conditions: {
      states: ["default", "copy-toast"],
      pages: [{ name: "共有画面", path: "share" }],
    },
  };
  writeFileSync(join(dir, "metadata.json"), JSON.stringify(metadata));
  if (opts.coverage !== undefined) {
    writeFileSync(join(dir, "component-coverage.json"), JSON.stringify(opts.coverage));
  }
  return { outer, dir };
}

/** 表の中の目印のパスを一時プロジェクトの実パスに置き換え、assertion_audit が無ければ全行 reaches で足す。 */
function finalTable(
  table: Record<string, unknown>,
  { outer, dir }: { outer: string; dir: string },
  opts: RunOptions,
) {
  // JSON 文字列の中へ入れるので、区切りがバックスラッシュのパス（Windows）もエスケープしてから置き換える
  const final = parseJsonAs<Table>(
    JSON.stringify(table)
      .replaceAll(OUTSIDE_ABS, JSON.stringify(join(outer, OUTSIDE_FILE)).slice(1, -1))
      .replaceAll(INSIDE_ABS, JSON.stringify(join(dir, "src/export.js")).slice(1, -1)),
  );
  if (opts.audit !== false && !Object.hasOwn(final, "assertion_audit")) {
    final.assertion_audit = passingAudit(final);
  }
  return final;
}

/** tests.json を書き、名指しされたスペックを実ファイルとして置く。書いたテストの一覧を返す。 */
function writeTestList(dir: string, final: Table, opts: RunOptions) {
  const tests = opts.tests ?? coveredByOwners(final).flatMap((o) => o.names);
  const list = isArray(tests) ? testList([...new Set(tests)]) : tests;
  // スペックの起点（config.rootDir）は一時プロジェクト。名指しされたスペックを実ファイルとして置く
  if (isRecord(list) && isRecord(list.config) && !Object.hasOwn(list.config, "rootDir")) {
    list.config.rootDir = dir;
  }
  for (const suite of isRecord(list) && isArray(list.suites) ? list.suites : []) {
    const file = isRecord(suite) ? suite.file : undefined;
    if (typeof file !== "string") throw new Error("tests の suites[].file が文字列でない");
    writeSpec(dir, file);
  }
  writeFileSync(join(dir, "tests.json"), JSON.stringify(list));
  return list;
}

/** 監査の記録にスペックの指紋をコピーする（--audit-sheet の出力をコピーするのと同じ値。指紋を変えるテストは自分で書く）。 */
function copySpecsFingerprint(final: Table, list: unknown, dir: string) {
  if (
    !isRecord(final.assertion_audit) ||
    Object.hasOwn(final.assertion_audit, "specs_fingerprint")
  ) {
    return;
  }
  try {
    final.assertion_audit.specs_fingerprint = specsFingerprint(
      coveredByOwners(final),
      indexTestList(list),
      { rootDir: dir, readFile: (f) => readFileSync(f, "utf8") },
    ).fingerprint;
  } catch {
    // 一覧そのものが不正な場合（使い方の誤りを測るテスト）は指紋をコピーしない
  }
}

/** @param {(t: ReturnType<typeof baseTable>) => void} mutate */
export const mutated = (mutate: (t: Table) => void) => {
  const t = baseTable();
  mutate(t);
  return t;
};

/** 同じ一時プロジェクトで再実行する。 */
export function rerun(dir: string, args: string[] = []) {
  return call(dir, args);
}

// --- 押した後に撮ったページと URL の照合（Issue #484）---

/**
 * ページを宣言した metadata。状態表示は全ての画面で振り分ける（Issue #500）ので、表の側は withPages で揃える。
 * @param {string | null} uiUrl
 * @param {Record<string, string>} pages - 名前 → path
 */
export const pagesMeta = (uiUrl: string | null, pages: Record<string, string | undefined>) => ({
  slug: "share",
  target: { name: "current-test", commit: "abc123", ui_url: uiUrl },
  reaction_coverage: { declared: true, path: "reactions.json" },
  capture_conditions: {
    states: ["default", "copy-toast"],
    pages: Object.entries(pages).map(([name, path]) => ({ name, path })),
  },
});

/**
 * コピー（copy-toast を撮る操作）が page を名乗り、押した後の URL が urlAfter の表。
 * @param {Record<string, string>} pages
 * @param {string} page
 * @param {string} urlAfter
 */
export const namedAfter = (
  pages: Record<string, string | undefined>,
  page: string,
  urlAfter: string,
) =>
  mutated((t: Table) => {
    t.state_displays.pages = Object.keys(pages).map((name) => stateDisplayRow(name));
    t.operations[0].capture_page = page;
    copyOp(t).aftermath.returns_to.url_after = urlAfter;
  });

// --- 部品網羅表と反応の網羅表をまたいだ撮る状態の使い回し（Issue #485）---

const coverageTemplate = parseJsonAs<CoverageTemplate>(
  readFileSync(
    join(repoRoot, "skills/parity-suite/assets/component-coverage-template.json"),
    "utf8",
  ),
);

/**
 * テンプレートの形の部品網羅表。部品 grid のインスタンスごとに、導いた行（after-operation）が 1 つずつ撮る状態を指す。
 * @param {{ instance: string, page: string, captured: string, reason?: string | null }[]} rows
 */
export const coverageWith = (
  rows: { instance: string; page: string; captured: string; reason?: string | null }[],
) => {
  const cov = structuredClone(coverageTemplate);
  const component = cov.components[0];
  const instance = component.instances[0];
  cov.components = [
    {
      ...component,
      id: "grid",
      instances: [...new Set(rows.map((r) => r.instance))].map((id) => ({
        ...structuredClone(instance),
        id,
        page: rows.find((r) => r.instance === id)?.page,
      })),
    },
  ];
  cov.visual_state_coverage.rows = rows.map((r) => ({
    ...structuredClone(coverageTemplate.visual_state_coverage.rows[0]),
    component: "grid",
    instance: r.instance,
    required_by: "row-select",
    kind: "after-operation",
    captured: r.captured,
    shared_capture_reason: r.reason ?? null,
  }));
  return cov;
};

/** 部品網羅表を宣言した metadata（ページは 2 つ。表の状態表示も 2 画面ぶん振り分ける）。 */
export const coverageMeta = () => ({
  ...pagesMeta("http://localhost:3000/", { 共有画面: "share", 検索画面: "search" }),
  component_coverage: { declared: true, path: "component-coverage.json" },
});

/** コピー（反応の copy-toast）を共有画面で撮る表。反応の側の根拠を reason にする。 */
export const copyOnShare = (reason: string | null) =>
  mutated((t: Table) => {
    t.state_displays.pages = [stateDisplayRow("共有画面"), stateDisplayRow("検索画面")];
    t.operations[0].capture_page = "共有画面";
    copyOp(t).reactions[0].capture.shared_capture_reason = reason;
  });

// --- covered_by の解決・共有と assertion の深さの監査（Issue #506）---

/** 表の covered_by の名前（重複を除く）。 */
export const namesOf = (t: Record<string, unknown>) => [
  ...new Set(coveredByOwners(t).flatMap((o) => o.names)),
];

/** 監査の後にスペックの assertion を弱める（表は触らない）。 */
export const weakenSpec = (dir: string) =>
  writeFileSync(
    join(dir, "share.spec.ts"),
    "// share.spec.ts\nexpect(page.getByText('Saved')).toBeVisible();\n",
  );

/** ポップアップの棚卸し（空。テストが要素を足す）。 */
const noPopups = (): { name: string }[] => [];

/** 手順の改訂 4 以降の、操作を持たない画面駆動の機能の metadata.json。 */
export const displayOnlyMeta = (patch = {}) => ({
  slug: "share",
  mode: "feature",
  run: { procedure_revision: OPERATIONLESS_TABLE_REVISION },
  target: { name: "current-test", commit: "abc123", ui_url: "http://localhost:3000/" },
  reaction_coverage: { declared: true, path: "reactions.json" },
  capture_conditions: {
    states: ["default", "share-empty"],
    pages: [
      { name: "共有画面", path: "share" },
      { name: "履歴画面", path: "history" },
    ],
    popup_inventory: noPopups(),
  },
  ...patch,
});

/** 表示だけの 1 画面の状態表示。0 件は撮る状態で押さえ、操作の反応を名乗る候補（トースト）は「ない」にする。 */
const displayOnlyRow = (page: string) => {
  const row = stateDisplayRow(page);
  row.candidates.empty = {
    status: "present",
    setup: { method: "data", detail: "一覧の元になる行を 0 件にする" },
    observed: "覆いに「結果が無い」の文言",
    captured: "share-empty",
  };
  row.candidates.toast = {
    status: "absent",
    setup: { method: "data", detail: "一覧を表示して待つ" },
    observed: "トーストの表示領域に何も出ない",
    covered_by: [`share.spec.ts › ${page}: 表示してもトーストが出ない`],
  };
  return row;
};

/** 操作を持たない画面駆動の機能の、全画面・全候補を振り分けた表。 */
export const displayOnlyTable = () => {
  const t = baseTable();
  t.operations = [];
  t.operations_none_reason =
    "移行元の画面のテンプレートに押せる要素（ボタン・リンク・入力）が無く、実 UI でもフォーカスの移る要素が無い";
  t.observation_window_ms = null;
  t.feedback_calls = {
    declared: false,
    reason: "設定 current.feedback_calls が空と確認済み",
  };
  t.side_effect_writes = {
    declared: false,
    reason: "features.md の副作用出力に表への書き込みが無い",
  };
  t.state_displays = { pages: [displayOnlyRow("共有画面"), displayOnlyRow("履歴画面")] };
  return t;
};

/**
 * copy の反応（copy-toast）と search の残る見た目（copy-toast）を、pages[0] と pages[1] のページで撮る表にする。
 * 別のページの同じ状態名を別の 1 枚として扱うかを確かめるテストが使う。
 */
export function shareCopyToastOn(t: Table, pages: string[]) {
  const it = searchOp(t).aftermath.look.items[1];
  it.captured = "copy-toast";
  it.covered_by = [];
  t.operations[0].capture_page = pages[0];
  t.operations[1].capture_page = pages[1];
  // 検索は検索画面へ遷移して撮る（押した後の URL が capture_page の path と合う）
  searchOp(t).aftermath.returns_to.url_after = pages[1] === "共有画面" ? "/share?id=1" : "/search";
  // 状態表示は capture_conditions.pages の全ての画面で振り分ける（Issue #500）
  t.state_displays.pages.push(stateDisplayRow("検索画面"));
}
