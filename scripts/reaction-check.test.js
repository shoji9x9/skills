// parity-suite の反応の被覆表チェッカ（reaction-check.mjs）の回帰テスト（Issue #351）。
//
// 操作の特性化が「押した直後」で止まると、遅れて出る・操作した器の外に出る・自動で消える反応が
// 被覆表を埋めたまま取りこぼされる。反応の欄の空欄・「なし」の無証拠・消える時間の単一標本・
// 移行元のフィードバック呼び出しとの記録漏れを、それぞれ落とすことを固定する。
//
// 陽性コントロール（完全な表が exit 0、旧成果物は判定しない）を置く——これが無いと「常に落とす」実装と区別できない。

import { test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir } from "./lib/test-tmpdir.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repoRoot, "skills/parity-suite/scripts/reaction-check.mjs");

/** 観測した反応（トースト）。消えるまでの時間を 2 標本で持つ。 */
const toast = () => ({
  id: "toast",
  kind: "observed",
  description: "コピー完了のトースト",
  visible: true,
  destination: { document: "top", locator: "コピー完了の通知" },
  appearance: { wait_limit_ms: 5000, delay_ms_samples: [480, 530] },
  dismissal: { mode: "auto", duration_ms_samples: [15400, 15600], tolerance_ms: 500 },
  covered_by: ["share.spec.ts: コピーで通知が出て消える"],
  capture: { state: "copy-toast", reason: null },
});

/** 反応が無いことを実測で書いた操作。 */
const noneReaction = () => ({
  id: "none",
  kind: "none",
  observation: {
    window_ms: 3000,
    documents: ["top", "共有ダイアログの iframe"],
    source_document: "top",
    method: "全文書の DOM 変化を監視",
  },
  covered_by: ["search.spec.ts: 検索で観測時間内にどの文書にも通知が出ない"],
});

/** 操作で頁の組み方が変わらないことを実測で書いた記録。 */
const noLayoutChange = () => ({
  changes: false,
  evidence: "操作の前後で scrollHeight と主な論理名の矩形が同じ",
  covered_by: ["layout.spec.ts: 操作の後も頁の高さが変わらない"],
});

/** 頁の組み方を変える操作の記録（条件の行を足すたびに、グリッドの高さを窓の高さから書き直す）。 */
const layoutChange = () => ({
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
  covered_by: ["layout.spec.ts: 条件を 2 回足した後も頁が窓に収まりグリッドが縮む"],
});

/** 押した後に見た目が残らず、どこへも戻らないことを実測で書いた記録（Issue #471）。 */
const quietAftermath = () => ({
  look: {
    changes: false,
    evidence: "押した後に対象の論理名の計算後スタイルと印の文言が押す前と同じ",
    targets: ["コピーボタン", "一覧"],
    covered_by: ["share.spec.ts: コピーの後もボタンと一覧の計算後スタイルが押す前と同じ"],
  },
  returns_to: {
    measured: true,
    url_before: "/share?id=1",
    url_after: "/share?id=1",
    probed: ["検索条件", "並べ替え", "列フィルター", "列の変更"],
    reset: [],
    not_probed: {},
    covered_by: [
      "share.spec.ts: コピーの後も URL と検索条件・並べ替え・列フィルター・列の変更が残る",
    ],
  },
});

/** 押した後に見た目が残り、状態の一部を戻す操作の記録（絞り込み中の見出しの色・Clear が戻す範囲）。 */
const lingeringAftermath = () => ({
  look: {
    changes: true,
    items: [
      {
        id: "filtered-header",
        target: "価格列の見出し",
        description: "絞り込み中の見出しの文字色",
        observed: "color: rgb(204, 0, 0)",
        captured: null,
        covered_by: ["search.spec.ts: 絞り込んだ列の見出しが赤くなる"],
        reason: null,
      },
      {
        id: "result-toast",
        target: "コピー完了の通知",
        description: "押した後に残る通知の背景",
        observed: "background-color: rgb(0, 128, 0)",
        captured: null,
        covered_by: ["search.spec.ts: 押した後に通知の背景が緑で残る"],
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
    covered_by: ["search.spec.ts: Clear で検索条件と並べ替え・列フィルター・列の変更が既定に戻る"],
  },
});

const baseTable = () => ({
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
  operations: [
    {
      id: "copy",
      trigger: "clickButton(コピー)",
      handlers: [{ file: "src/share.js", symbol: "copy" }],
      immediate_state: "ダイアログが閉じる",
      layout: noLayoutChange(),
      aftermath: quietAftermath(),
      reactions: [toast()],
    },
    {
      id: "search",
      trigger: "clickButton(検索)",
      handlers: [{ file: "src/share.js", symbol: "search" }],
      immediate_state: "一覧が絞られる",
      layout: layoutChange(),
      aftermath: lingeringAftermath(),
      reactions: [noneReaction()],
    },
  ],
});

/**
 * 一時プロジェクトを作って CLI を実行する。
 * @param {object} table
 * @param {{ args?: string[], metadata?: object, source?: string }} [opts]
 */
function run(table, opts = {}) {
  const dir = makeTempDir("reaction-check-");
  mkdirSync(join(dir, "src"));
  // 操作 search のハンドラは全ての source の末尾に置く（行番号を動かさない）
  writeFileSync(
    join(dir, "src/share.js"),
    `${opts.source ?? "function copy() {\n  showFeedback('Copied');\n}\n"}function search() {}\n`,
  );
  mkdirSync(join(dir, "empty"));
  const metadata = opts.metadata ?? {
    slug: "share",
    target: { name: "current-test", commit: "abc123" },
    reaction_coverage: { declared: true, path: "reactions.json" },
    capture_conditions: { states: ["default", "copy-toast"] },
  };
  writeFileSync(join(dir, "metadata.json"), JSON.stringify(metadata));
  writeFileSync(join(dir, "reactions.json"), JSON.stringify(table));
  const r = spawnSync(
    process.execPath,
    [script, "--metadata", "metadata.json", ...(opts.args ?? [])],
    {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  return { dir, status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** @param {(t: ReturnType<typeof baseTable>) => void} mutate */
const mutated = (mutate) => {
  const t = baseTable();
  mutate(t);
  return t;
};

test("陽性コントロール: 完全な表は exit 0", () => {
  const r = run(baseTable());
  expect(r.stderr).toBe("");
  expect(r.status).toBe(0);
  expect(JSON.parse(r.stdout)).toMatchObject({
    ok: true,
    unmeasured_operations: 0,
    call_sites: { checked: true, found: 1 },
  });
});

test("別オリジンの文書は、移行元の本来の配置でも別オリジンになる根拠があれば通す（Issue #450）", () => {
  const t = mutated((x) => {
    x.document_origins["共有ダイアログの iframe"] = "cross-origin";
    x.cross_origin_evidence = {
      "共有ダイアログの iframe":
        "移行元は共有ダイアログを設定 share.origin の絶対 URL で読み込み、本番の配置でも本体と別オリジンになる",
    };
    // フレームの中で操作して、どの文書にも反応が出ないことを見た
    x.operations[1].reactions[0].observation.source_document = "共有ダイアログの iframe";
  });
  const r = run(t);
  expect(r.stderr).toBe("");
  expect(r.status).toBe(0);
  expect(JSON.parse(r.stdout)).toMatchObject({ ok: true });
});

test("reaction_coverage を持たない旧成果物は判定しない（exit 0・judged: false）", () => {
  const r = run(baseTable(), { metadata: {} });
  expect(r.status).toBe(0);
  expect(JSON.parse(r.stdout)).toMatchObject({ judged: false });
});

test("declared: false で reason が空なら exit 2", () => {
  const r = run(baseTable(), { metadata: { reaction_coverage: { declared: false, reason: "" } } });
  expect(r.status).toBe(2);
});

test.each([
  ["反応の欄が空", (t) => (t.operations[1].reactions = []), "reactions が空"],
  [
    "none に観測記録が無い",
    (t) => delete t.operations[1].reactions[0].observation,
    "observation が無い",
  ],
  [
    "none の観測時間が表の下限より短い",
    (t) => (t.operations[1].reactions[0].observation.window_ms = 1000),
    "observation_window_ms（3000）より短い",
  ],
  [
    "表の観測時間の下限が observed の遅れ以下",
    (t) => {
      t.observation_window_ms = 500;
      t.operations[1].reactions[0].observation.window_ms = 500;
    },
    "observed の遅れの最大値（530）以下",
  ],
  [
    "none と他の反応が同居",
    (t) => t.operations[1].reactions.push({ ...toast(), id: "other" }),
    "kind: none と他の反応が同居",
  ],
  [
    "自動で消える時間が 1 標本",
    (t) => (t.operations[0].reactions[0].dismissal.duration_ms_samples = [15500]),
    "2 標本未満",
  ],
  [
    "許容幅が標本の幅より小さい",
    (t) => (t.operations[0].reactions[0].dismissal.tolerance_ms = 100),
    "標本の幅",
  ],
  [
    "出る先の文書が空",
    (t) => (t.operations[0].reactions[0].destination.document = ""),
    "destination の document",
  ],
  [
    "出現の標本が待ち上限を超える",
    (t) => (t.operations[0].reactions[0].appearance.delay_ms_samples = [6000]),
    "wait_limit_ms を超える",
  ],
  [
    "assertion に落としていない",
    (t) => (t.operations[0].reactions[0].covered_by = []),
    "covered_by が空",
  ],
  [
    "capture の state と reason が両方",
    (t) => (t.operations[0].reactions[0].capture.reason = "撮らない"),
    "どちらか一方だけ",
  ],
  [
    "capture.state が撮影状態に無い",
    (t) => (t.operations[0].reactions[0].capture.state = "missing"),
    "capture_conditions.states に無い",
  ],
  [
    "unmeasured の反応",
    (t) => (t.operations[0].reactions[0] = { id: "toast", kind: "unmeasured", reason: "未観測" }),
    "unmeasured（未観測）",
  ],
  ["操作 id の重複", (t) => (t.operations[1].id = "copy"), "重複している"],
  [
    "none の不在を assertion に落としていない",
    (t) => delete t.operations[1].reactions[0].covered_by,
    "kind: none なのに covered_by が空",
  ],
  ["直後の状態が空", (t) => (t.operations[1].immediate_state = ""), "immediate_state"],
  [
    "none の観測に top が無い（iframe の中だけを見た）",
    (t) => (t.operations[1].reactions[0].observation.documents = ["共有ダイアログの iframe"]),
    "top（最上位の文書）が無い",
  ],
  [
    "none の観測が棚卸しした文書を網羅していない",
    (t) => (t.operations[1].reactions[0].observation.documents = ["top"]),
    "見ていない文書: 共有ダイアログの iframe",
  ],
  [
    "none の観測に棚卸しに無い文書がある",
    (t) => t.operations[1].reactions[0].observation.documents.push("別のフレーム"),
    "表の documents に無い文書",
  ],
  [
    "文書の棚卸しに top が無い",
    (t) => (t.documents = ["共有ダイアログの iframe"]),
    "documents に top",
  ],
  ["文書の棚卸しが無い", (t) => delete t.documents, "documents が空でない文字列の配列でない"],
  // 文書のオリジン（Issue #450）: 対象 URL と別オリジンのフレームは親の文書へ反応を届けられず、実在する反応が「無い」に化ける
  [
    "none に操作した文書が無い",
    (t) => delete t.operations[1].reactions[0].observation.source_document,
    "observation.source_document が空",
  ],
  [
    "none の操作した文書が棚卸しに無い",
    (t) => (t.operations[1].reactions[0].observation.source_document = "別のフレーム"),
    'observation.source_document "別のフレーム" が表の documents に無い',
  ],
  ["文書のオリジンの記録が無い", (t) => delete t.document_origins, "document_origins が無い"],
  [
    "文書のオリジンの記録が配列",
    (t) => (t.document_origins = ["same-origin"]),
    "document_origins が無い",
  ],
  [
    "文書のオリジンに棚卸しの文書が欠けている",
    (t) => delete t.document_origins["共有ダイアログの iframe"],
    "document_origins に無い文書: 共有ダイアログの iframe",
  ],
  [
    "文書のオリジンに棚卸しに無い文書がある",
    (t) => (t.document_origins["別のフレーム"] = "same-origin"),
    "document_origins に表の documents に無い文書がある: 別のフレーム",
  ],
  [
    "文書のオリジンが語彙外（オリジンの値そのものを書いた）",
    (t) => (t.document_origins["共有ダイアログの iframe"] = "https://app.example.com"),
    "same-origin / cross-origin でない文書: 共有ダイアログの iframe",
  ],
  [
    "別オリジンの文書があるのに根拠が無い",
    (t) => (t.document_origins["共有ダイアログの iframe"] = "cross-origin"),
    "文書 共有ダイアログの iframe が対象 URL と別オリジンなのに cross_origin_evidence にその文書の根拠が無い",
  ],
  [
    "別オリジンの文書の根拠が空白だけ",
    (t) => {
      t.document_origins["共有ダイアログの iframe"] = "cross-origin";
      t.cross_origin_evidence = { "共有ダイアログの iframe": "  " };
    },
    "cross_origin_evidence にその文書の根拠が無い",
  ],
  [
    // 意図して別オリジンにした文書の根拠で、環境の都合で別オリジンになった文書まで通さない（Codex レビュー #453）
    "別オリジンの文書が複数あり、根拠が一方にしか無い",
    (t) => {
      t.documents.push("決済フレーム");
      t.operations[1].reactions[0].observation.documents.push("決済フレーム");
      t.document_origins["決済フレーム"] = "cross-origin";
      t.document_origins["共有ダイアログの iframe"] = "cross-origin";
      t.cross_origin_evidence = {
        決済フレーム: "決済は外部サービスのドメインで本番でも別オリジン",
      };
    },
    "文書 共有ダイアログの iframe が対象 URL と別オリジンなのに cross_origin_evidence にその文書の根拠が無い",
  ],
  [
    "根拠が表全体で 1 本の文字列（旧形式）",
    (t) => {
      t.document_origins["共有ダイアログの iframe"] = "cross-origin";
      t.cross_origin_evidence = "本番でも別オリジン";
    },
    "cross_origin_evidence が文書ごとの根拠のオブジェクトでない",
  ],
  [
    "別オリジンでない文書の根拠が残っている",
    (t) => (t.cross_origin_evidence = { "共有ダイアログの iframe": "決済フレームは外部サービス" }),
    "cross_origin_evidence に別オリジンでない文書の根拠が残っている: 共有ダイアログの iframe",
  ],
  [
    "オリジンの根拠のキーが無い",
    (t) => delete t.cross_origin_evidence,
    "cross_origin_evidence が文書ごとの根拠のオブジェクトでない",
  ],
  [
    "オリジンの根拠が null",
    (t) => (t.cross_origin_evidence = null),
    "cross_origin_evidence が文書ごとの根拠のオブジェクトでない",
  ],
  [
    "出る先の文書が棚卸しに無い",
    (t) => (t.operations[0].reactions[0].destination.document = "別のフレーム"),
    "destination.document",
  ],
  ["被覆表の slug が別機能", (t) => (t.slug = "other"), "slug（other）"],
  [
    "被覆表の測定 target が別環境",
    (t) => (t.measured_target = "local-dev"),
    "measured_target（local-dev）",
  ],
  ["操作 id が / を含む", (t) => (t.operations[1].id = "search/x"), '"/" を含む'],
  [
    "反応 id の / で反応キーが衝突する",
    (t) => {
      // copy/toast と同じキーになる組を作る（索引に入れると後勝ちで上書きされる）
      t.operations[1].id = "copy";
      t.operations[1].reactions[0].id = "toast";
      t.operations.push({
        id: "c",
        trigger: "x()",
        immediate_state: "y",
        layout: noLayoutChange(),
        aftermath: quietAftermath(),
        reactions: [{ ...toast(), id: "opy/toast" }],
      });
    },
    '"/" を含む',
  ],
  ["反応 id の欠落", (t) => delete t.operations[1].reactions[0].id, "id が空の要素"],
  ["trigger が空", (t) => (t.operations[1].trigger = ""), "trigger"],
  [
    "見えない反応に確認方法が無い",
    (t) => Object.assign(t.operations[0].reactions[0], { visible: false, observation: "" }),
    "observation（どう確かめたか）が空",
  ],
  [
    "消えない反応に証拠が無い",
    (t) => (t.operations[0].reactions[0].dismissal = { mode: "persistent" }),
    "evidence が空",
  ],
])("未測定として落とす: %s", (_name, mutate, message) => {
  const r = run(mutated(mutate));
  expect(r.status).toBe(1);
  expect(JSON.parse(r.stdout).ok).toBe(false);
  expect(r.stderr).toContain(message);
});

test.each([
  [
    "ソースの呼び出しが記録されていない",
    (t) => (t.feedback_calls.call_sites = []),
    "被覆表に記録されていない",
  ],
  [
    "記録だけ残っている（行ずれ）",
    (t) => (t.feedback_calls.call_sites[0].line = 3),
    "ソースに見つからない",
  ],
  [
    "観測していない反応へ対応付け",
    (t) => (t.feedback_calls.call_sites[0].reaction = "search/none"),
    "観測した反応へ対応付いていない",
  ],
  [
    "存在しない反応へ対応付け",
    (t) => (t.feedback_calls.call_sites[0].reaction = "copy/missing"),
    "被覆表の反応に無い",
  ],
  [
    "reaction と excluded_reason が両方空",
    (t) => (t.feedback_calls.call_sites[0].reaction = null),
    "どちらか一方だけ",
  ],
  ["走査対象が 0 件", (t) => (t.feedback_calls.source.paths = ["empty"]), "0 件"],
  ["patterns が空", (t) => (t.feedback_calls.patterns = []), "patterns が空"],
  [
    "呼び出し箇所の行番号が文字列",
    (t) => (t.feedback_calls.call_sites[0].line = "2"),
    "欠けた行がある",
  ],
  [
    "パターンに例が無い",
    (t) => delete t.feedback_calls.patterns[0].example,
    "example（一致すべき呼び出しの字面）が空",
  ],
  [
    "パターンが例に一致しない（古いパターン）",
    (t) => (t.feedback_calls.patterns[0].example = "notifyUser('Copied')"),
    "regex が example に一致しない",
  ],
  [
    "走査で 0 件なのに根拠が無い（走査範囲の誤り）",
    (t) => {
      t.__source = "function copy() {\n  navigator.clipboard.writeText(url);\n}\n";
      t.feedback_calls.call_sites = [];
    },
    "zero_calls_reason が空",
  ],
  [
    "呼び出しがあるのに 0 件の根拠が埋まっている",
    (t) => (t.feedback_calls.zero_calls_reason = "呼び出しは無い"),
    "0 件の根拠と矛盾する",
  ],
  [
    "呼び出し箇所の列が無い",
    (t) => delete t.feedback_calls.call_sites[0].column,
    "file / line / column / pattern",
  ],
  [
    "同じ行の 2 つ目の呼び出しが記録されていない",
    (t) => {
      t.__source = "function copy() {\n  showFeedback('Copied'); showFeedback('Again');\n}\n";
    },
    '["src/share.js",2,27,"toast"] が被覆表に記録されていない',
  ],
  [
    "呼び出し箇所の重複",
    (t) => t.feedback_calls.call_sites.push({ ...t.feedback_calls.call_sites[0] }),
    "回重複している",
  ],
  [
    "パターン id の重複",
    (t) => t.feedback_calls.patterns.push({ id: "toast", regex: "x", example: "x" }),
    "重複している",
  ],
  ["走査した版が空", (t) => (t.feedback_calls.source.version = ""), "source.version が空"],
  [
    "declared: false で reason が空",
    (t) => (t.feedback_calls = { declared: false, reason: "" }),
    "declared: false なのに reason が空",
  ],
])("呼び出しの突き合わせで落とす: %s", (_name, mutate, message) => {
  const t = mutated(mutate);
  const source = t.__source;
  delete t.__source;
  const r = run(t, { source });
  expect(r.status).toBe(1);
  expect(JSON.parse(r.stdout).ok).toBe(false);
  expect(r.stderr).toContain(message);
});

/** 同じ一時プロジェクトで再実行する。 */
function rerun(dir, args = []) {
  const r = spawnSync(process.execPath, [script, "--metadata", "metadata.json", ...args], {
    cwd: dir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { dir, status: r.status, stdout: r.stdout, stderr: r.stderr };
}

test("改行をまたぐ呼び出しも検出する（記録が無ければ落ちる）", () => {
  const t = mutated((x) => {
    x.feedback_calls.call_sites = [];
    x.feedback_calls.zero_calls_reason = "呼び出しは無い";
  });
  const r = run(t, { source: "function copy() {\n  showFeedback\n    ('Copied');\n}\n" });
  expect(r.status).toBe(1);
  expect(r.stderr).toContain('["src/share.js",2,3,"toast"] が被覆表に記録されていない');
});

test("改行をまたぐ呼び出しと CRLF でも名前の開始位置を行・列で記録すれば通す", () => {
  const r = run(baseTable(), {
    source: "function copy() {\r\n  showFeedback\r\n    ('Copied');\r\n}\r\n",
  });
  expect(r.stderr).toBe("");
  expect(r.status).toBe(0);
});

test.each([
  [
    "ハンドラの記録が無い",
    (t) => delete t.operations[1].handlers,
    "handlers（file と symbol）が空",
  ],
  [
    "ハンドラのファイルが走査範囲に無い（範囲の書き漏れ）",
    (t) => (t.operations[1].handlers = [{ file: "src/list.js", symbol: "search" }]),
    "ハンドラのファイル src/list.js が走査範囲に無い",
  ],
  [
    "ハンドラのシンボルがファイルに無い",
    (t) => (t.operations[1].handlers[0].symbol = "searchAll"),
    "ハンドラ searchAll が src/share.js に見つからない",
  ],
])("ハンドラの来歴で落とす: %s", (_name, mutate, message) => {
  const r = run(mutated(mutate));
  expect(r.status).toBe(1);
  expect(r.stderr).toContain(message);
});

test("ハンドラが走査範囲外のファイルにあると、そこにある呼び出しの記録漏れが操作単位で見える", () => {
  // Codex の再現例: ハンドラが a.js と b.js にあるのに paths が a.js だけ
  const t = mutated((x) => {
    x.feedback_calls.source.paths = ["src/share.js"];
    x.operations[1].handlers = [{ file: "src/b.js", symbol: "search" }];
  });
  const r = run(t);
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("ハンドラのファイル src/b.js が走査範囲に無い");
});

test("feedback_calls.declared: false ならハンドラの来歴は要求しない", () => {
  const t = mutated((x) => {
    x.feedback_calls = { declared: false, reason: "移行元ソースを入手できない" };
    delete x.operations[0].handlers;
  });
  expect(run(t).status).toBe(0);
});

test("走査した版が測定した版と違えば落とす", () => {
  const r = run(mutated((t) => (t.feedback_calls.source.version = "def456")));
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("target.commit（abc123）と違う");
});

test.each([
  ["target.commit が none", { commit: "none" }, {}],
  ["走査した版が none", {}, { version: "none" }],
])(
  "版を照合できないとき理由が無ければ落とし、理由があれば通す: %s",
  (_n, targetPatch, sourcePatch) => {
    const metadata = {
      slug: "share",
      target: { name: "current-test", commit: "abc123", ...targetPatch },
      reaction_coverage: { declared: true, path: "reactions.json" },
      capture_conditions: { states: ["default", "copy-toast"] },
    };
    const noReason = run(
      mutated((t) => Object.assign(t.feedback_calls.source, sourcePatch)),
      { metadata },
    );
    expect(noReason.status).toBe(1);
    expect(noReason.stderr).toContain("version_unverified_reason が空");
    const withReason = run(
      mutated((t) =>
        Object.assign(t.feedback_calls.source, sourcePatch, {
          version_unverified_reason: "受領資産にコミット履歴が無く、受領日のアーカイブを走査した",
        }),
      ),
      { metadata },
    );
    expect(withReason.stderr).toBe("");
    expect(withReason.status).toBe(0);
  },
);

test("版が一致しているのに照合不能の理由が埋まっていれば落とす", () => {
  const r = run(mutated((t) => (t.feedback_calls.source.version_unverified_reason = "不明")));
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("version_unverified_reason が埋まっている");
});

test("ファイル名やパターン id に : があっても別の呼び出しを 1 件に潰さない", () => {
  // 連結キーでは ("src/a", 1, 1, "2:toast") と ("src/a:1", 1, 2, "toast") がどちらも "src/a:1:1:2:toast" になる
  const dir = makeTempDir("reaction-check-colon-");
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src/a"), "notify();\n");
  writeFileSync(join(dir, "src/a:1"), " showFeedback('x');\n");
  const t = mutated((x) => {
    x.feedback_calls.patterns = [
      { id: "toast", regex: "\\bshowFeedback\\s*\\(", example: "showFeedback('x')" },
      { id: "2:toast", regex: "\\bnotify\\s*\\(", example: "notify()" },
    ];
    x.feedback_calls.source.paths = ["src"];
    x.feedback_calls.call_sites = [
      { file: "src/a:1", line: 1, column: 2, pattern: "toast", reaction: "copy/toast" },
    ];
    x.operations[0].handlers = [{ file: "src/a:1", symbol: "showFeedback" }];
    x.operations[1].handlers = [{ file: "src/a", symbol: "notify" }];
  });
  writeFileSync(
    join(dir, "metadata.json"),
    JSON.stringify({
      slug: "share",
      target: { name: "current-test", commit: "abc123" },
      reaction_coverage: { declared: true, path: "reactions.json" },
      capture_conditions: { states: ["default", "copy-toast"] },
    }),
  );
  writeFileSync(join(dir, "reactions.json"), JSON.stringify(t));
  const r = rerun(dir);
  expect(r.status).toBe(1);
  expect(r.stderr).toContain('["src/a",1,1,"2:toast"] が被覆表に記録されていない');
});

test("行頭アンカー付きのパターンでも 2 行目以降の呼び出しを検出する", () => {
  const t = mutated((x) => {
    x.feedback_calls.patterns = [
      { id: "toast", regex: "^\\s*showFeedback\\s*\\(", example: "showFeedback('Copied')" },
    ];
    x.feedback_calls.call_sites = [];
    x.feedback_calls.zero_calls_reason = "呼び出しは無い";
  });
  const r = run(t);
  expect(r.status).toBe(1);
  expect(r.stderr).toContain('["src/share.js",2,1,"toast"] が被覆表に記録されていない');
});

test.each([
  ["撮影状態に default 以外がある", { capture_conditions: { states: ["default", "copy-toast"] } }],
  [
    "器の棚卸しが空でない",
    { capture_conditions: { states: ["default"], popup_inventory: [{ name: "x" }] } },
  ],
  [
    "部品被覆表を宣言している",
    { capture_conditions: { states: ["default"] }, component_coverage: { declared: true } },
  ],
])("操作の痕跡がある機能の declared: false は exit 2: %s", (_n, patch) => {
  const metadata = {
    mode: "feature",
    reaction_coverage: { declared: false, reason: "操作が無い" },
    ...patch,
  };
  const r = run(baseTable(), { metadata });
  expect(r.status).toBe(2);
  expect(r.stderr).toContain("操作の痕跡がある");
});

test.each([
  [
    "操作の痕跡が無い画面駆動の機能",
    { mode: "feature", capture_conditions: { states: ["default"], popup_inventory: [] } },
  ],
  [
    "api-resource モード",
    { mode: "api-resource", capture_conditions: { states: ["default", "x"] } },
  ],
])("declared: false は理由付きなら通す: %s", (_n, patch) => {
  const metadata = { reaction_coverage: { declared: false, reason: "操作を持たない" }, ...patch };
  const r = run(baseTable(), { metadata });
  expect(r.status).toBe(0);
  expect(JSON.parse(r.stdout)).toMatchObject({ judged: false });
});

test("呼び出しが 0 件でも根拠があれば通す", () => {
  const t = mutated((x) => {
    x.feedback_calls.call_sites = [];
    x.feedback_calls.zero_calls_reason =
      "対象ハンドラはフィードバックを出さない（ハンドラ全体を読んで確認）";
  });
  const r = run(t, { source: "function copy() {\n  navigator.clipboard.writeText(url);\n}\n" });
  expect(r.stderr).toBe("");
  expect(r.status).toBe(0);
});

test("同じ行の複数の呼び出しを列で区別して記録すれば通す", () => {
  const t = mutated((x) => {
    x.feedback_calls.call_sites.push({
      file: "src/share.js",
      line: 2,
      column: 27,
      pattern: "toast",
      reaction: null,
      excluded_reason: "同じハンドラの別機能向け通知（slug: list）",
    });
  });
  const r = run(t, {
    source: "function copy() {\n  showFeedback('Copied'); showFeedback('Again');\n}\n",
  });
  expect(r.stderr).toBe("");
  expect(r.status).toBe(0);
});

test("除外理由付きの呼び出しは通す（他機能の呼び出し）", () => {
  const t = mutated((x) => {
    x.feedback_calls.call_sites.push({
      file: "src/share.js",
      line: 5,
      column: 3,
      pattern: "toast",
      reaction: null,
      excluded_reason: "一覧機能の保存（slug: list）",
    });
  });
  const r = run(t, {
    source:
      "function copy() {\n  showFeedback('Copied');\n}\nfunction save() {\n  showFeedback('Saved');\n}\n",
  });
  expect(r.status).toBe(0);
});

test("feedback_calls.declared: false は理由付きなら突き合わせを飛ばす", () => {
  const r = run(
    mutated((t) => (t.feedback_calls = { declared: false, reason: "移行元ソースを入手できない" })),
  );
  expect(r.status).toBe(0);
  expect(JSON.parse(r.stdout).call_sites.checked).toBe(false);
});

test.each([
  ["撮影状態が配列でない", (m) => (m.capture_conditions = { states: "default" })],
  ["撮影状態が空の配列", (m) => (m.capture_conditions = { states: [] })],
  ["target.commit が無い", (m) => delete m.target.commit],
  ["slug が無い", (m) => delete m.slug],
  ["target.name が無い", (m) => (m.target = {})],
])("metadata.json の照合材料が欠けたら exit 2: %s", (_name, mutate) => {
  const metadata = {
    slug: "share",
    target: { name: "current-test", commit: "abc123" },
    reaction_coverage: { declared: true, path: "reactions.json" },
    capture_conditions: { states: ["default", "copy-toast"] },
  };
  mutate(metadata);
  expect(run(baseTable(), { metadata }).status).toBe(2);
});

test("走査範囲がルートの外を指すと exit 2", () => {
  const r = run(mutated((t) => (t.feedback_calls.source.paths = ["../outside"])));
  expect(r.status).toBe(2);
});

test("--write の後の --recorded は通り、表を書き換えると指紋で落ちる", () => {
  const w = run(baseTable(), { args: ["--write"] });
  expect(w.status).toBe(0);
  const written = JSON.parse(readFileSync(join(w.dir, "reactions.json"), "utf8"));
  expect(written.conformance).toMatchObject({
    ok: true,
    tool: "reaction-check",
    call_sites_checked: true,
  });

  expect(rerun(w.dir, ["--recorded"]).status).toBe(0);

  written.operations[0].reactions[0].dismissal.duration_ms_samples = [15400, 15400];
  writeFileSync(join(w.dir, "reactions.json"), JSON.stringify(written));
  const edited = rerun(w.dir, ["--recorded"]);
  expect(edited.status).toBe(1);
  expect(edited.stderr).toContain("table_fingerprint");
});

test("--recorded は conformance が無ければ落とす", () => {
  expect(run(baseTable(), { args: ["--recorded"] }).status).toBe(1);
});

test("declared: true なのに表が読めなければ exit 1（合格に倒さない）", () => {
  const r = run(baseTable(), {
    metadata: { reaction_coverage: { declared: true, path: "missing.json" } },
  });
  expect(r.status).toBe(1);
});

test("同梱テンプレートのプレースホルダのままの文書のオリジンは落とす（Issue #450）", () => {
  const template = JSON.parse(
    readFileSync(
      new URL("../skills/parity-suite/assets/reactions-template.json", import.meta.url),
      "utf8",
    ),
  );
  const t = mutated((x) => {
    x.document_origins = template.document_origins;
    x.cross_origin_evidence = template.cross_origin_evidence;
  });
  const r = run(t);
  expect(r.status).toBe(1);
  expect(r.stdout + r.stderr).toContain("same-origin / cross-origin でない文書: top");
});

test("頁の組み方を変えない操作と、2 回繰り返して測った変える操作は通す（Issue #460）", () => {
  // 陽性コントロールの表そのもの（copy は changes: false、search は changes: true）。
  // layout の分岐を足したことで正規の記録まで落とすようになっていないことを、他の欄と独立に固定する
  const r = run(baseTable());
  expect(r.status).toBe(0);
  expect(r.stdout + r.stderr).not.toContain("layout");
});

test.each([
  ["layout が無い", (t) => delete t.operations[0].layout, "layout が無い"],
  ["layout が配列", (t) => (t.operations[0].layout = []), "layout が無い"],
  [
    "changes が語彙外",
    (t) => (t.operations[0].layout.changes = "yes"),
    "true / false / null のどれでもない",
  ],
  [
    "changes: null（測れなかった）",
    (t) => (t.operations[0].layout = { changes: null, reason: "窓を変えられない" }),
    "未測定（窓を変えられない）",
  ],
  [
    "changes: false に確かめ方が無い",
    (t) => (t.operations[0].layout.evidence = ""),
    "evidence が空",
  ],
  [
    "changes: false に assertion が無い",
    (t) => (t.operations[0].layout.covered_by = []),
    "changes: false なのに covered_by が空",
  ],
  [
    "changes: true の標本が 1 回",
    (t) => t.operations[1].layout.samples.pop(),
    "samples が 2 回未満",
  ],
  [
    "changes: true に操作の前の測定が無い",
    (t) => delete t.operations[1].layout.before,
    "layout.before: オブジェクトでない",
  ],
  [
    "標本の repeat が連番でない",
    (t) => (t.operations[1].layout.samples[1].repeat = 3),
    "repeat が 1 から始まる連番でない",
  ],
  [
    "標本の repeat が重複",
    (t) => (t.operations[1].layout.samples[1].repeat = 1),
    "repeat が 1 から始まる連番でない",
  ],
  [
    "標本に client_height が無い",
    (t) => delete t.operations[1].layout.samples[0].client_height,
    "client_height が正の数でない",
  ],
  [
    "標本の scroll_height が非数",
    (t) => (t.operations[1].layout.samples[0].scroll_height = "768"),
    "scroll_height が 0 以上の数でない",
  ],
  ["標本の矩形が空", (t) => (t.operations[1].layout.samples[0].rects = {}), "rects が空"],
  [
    "矩形の論理名が空",
    (t) => {
      const l = t.operations[1].layout;
      for (const m of [l.before, ...l.samples]) m.rects = { "": m.rects.グリッド };
    },
    "rects に空の論理名がある",
  ],
  [
    "矩形の論理名が空白だけ",
    (t) => {
      const l = t.operations[1].layout;
      for (const m of [l.before, ...l.samples]) m.rects = { " ": m.rects.グリッド };
    },
    "rects に空の論理名がある",
  ],
  [
    "矩形の軸が欠けている",
    (t) => delete t.operations[1].layout.samples[0].rects.グリッド.height,
    "数値でも null でもない",
  ],
  [
    "矩形の幅が負",
    (t) => (t.operations[1].layout.samples[0].rects.グリッド.width = -1),
    "width / height が負",
  ],
  [
    "回によって測った論理名が違う",
    (t) => delete t.operations[1].layout.samples[1].rects.条件の行2,
    "測った論理名が揃っていない",
  ],
  [
    "changes: true なのに全ての標本が操作の前と同じ",
    (t) => {
      const l = t.operations[1].layout;
      l.samples = l.samples.map((m, i) => ({ ...structuredClone(l.before), repeat: i + 1 }));
    },
    "before と全ての samples が同じ",
  ],
  [
    "changes: true なのに全ての標本が操作の前と同じ（矩形の軸の書き順だけが違う）",
    (t) => {
      const l = t.operations[1].layout;
      const reorder = (rects) =>
        Object.fromEntries(
          Object.entries(rects).map(([k, r]) =>
            r === null ? [k, null] : [k, { height: r.height, width: r.width, y: r.y, x: r.x }],
          ),
        );
      l.samples = l.samples.map((m, i) => ({
        ...structuredClone(l.before),
        rects: reorder(l.before.rects),
        repeat: i + 1,
      }));
    },
    "before と全ての samples が同じ",
  ],
  [
    "changes: true に assertion が無い",
    (t) => (t.operations[1].layout.covered_by = [""]),
    "changes: true なのに covered_by が空",
  ],
])("頁の組み方の記録の欠けを落とす: %s（Issue #460）", (_name, mutate, needle) => {
  const r = run(mutated(mutate));
  expect(r.status).toBe(1);
  expect(r.stderr).toContain(needle);
});

test("同梱テンプレートのプレースホルダのままの layout は落とす（Issue #460）", () => {
  const template = JSON.parse(
    readFileSync(
      new URL("../skills/parity-suite/assets/reactions-template.json", import.meta.url),
      "utf8",
    ),
  );
  const t = mutated((x) => {
    x.operations[0].layout = template.operations[0].layout;
    x.operations[1].layout = template.operations[1].layout;
  });
  const r = run(t);
  expect(r.status).toBe(1);
  expect(r.stderr).toContain('operations["copy"]: layout');
  expect(r.stderr).toContain('operations["search"]: layout');
});

test.each([
  [
    "evidence がテンプレートの説明文のまま",
    (tpl) => (x) => (x.operations[0].layout.evidence = tpl.operations[1].layout.evidence),
    "テンプレートの説明文のまま",
  ],
  [
    "covered_by がテンプレートの説明文のまま",
    (tpl) => (x) => (x.operations[0].layout.covered_by = tpl.operations[1].layout.covered_by),
    "changes: false なのに covered_by が空",
  ],
  [
    "changes: true の covered_by がテンプレートの説明文のまま",
    (tpl) => (x) => (x.operations[1].layout.covered_by = tpl.operations[0].layout.covered_by),
    "changes: true なのに covered_by が空",
  ],
])(
  "layout の欄をテンプレートの説明文のまま出したら落とす: %s（Codex レビュー）",
  (_name, mk, needle) => {
    const template = JSON.parse(
      readFileSync(
        new URL("../skills/parity-suite/assets/reactions-template.json", import.meta.url),
        "utf8",
      ),
    );
    const r = run(mutated(mk(template)));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(needle);
  },
);

test("押した後に何も残らない操作と、残る見た目・戻す範囲を測った操作は通す（Issue #471）", () => {
  // 陽性コントロールの表そのもの（copy は残らない・戻さない、search は残る・戻す）。
  // aftermath の分岐を足したことで正規の記録まで落とすようになっていないことを、他の欄と独立に固定する
  const r = run(baseTable());
  expect(r.status).toBe(0);
  expect(r.stdout + r.stderr).not.toContain("aftermath");
});

test.each([
  ["aftermath が無い", (t) => delete t.operations[0].aftermath, "aftermath が無い"],
  ["aftermath が配列", (t) => (t.operations[0].aftermath = []), "aftermath が無い"],
  ["look が無い", (t) => delete t.operations[0].aftermath.look, "aftermath.look が無い"],
  [
    "look.changes が語彙外",
    (t) => (t.operations[0].aftermath.look.changes = "yes"),
    "aftermath.look.changes が true / false / null のどれでもない",
  ],
  [
    "look.changes: null（測れなかった）",
    (t) => (t.operations[0].aftermath.look = { changes: null, reason: "選択を保てない" }),
    "aftermath.look: 未測定（選択を保てない）",
  ],
  [
    "look.changes: false に確かめ方が無い",
    (t) => (t.operations[0].aftermath.look.evidence = ""),
    "aftermath.look.changes: false なのに evidence が空",
  ],
  [
    "look.changes: false に assertion が無い",
    (t) => (t.operations[0].aftermath.look.covered_by = []),
    "aftermath.look.changes: false なのに covered_by が空",
  ],
  [
    "look.changes: false に確かめた論理名が無い",
    (t) => (t.operations[0].aftermath.look.targets = []),
    "aftermath.look.changes: false なのに targets",
  ],
  [
    "look.changes: false なのに items がある",
    (t) => (t.operations[0].aftermath.look.items = lingeringAftermath().look.items),
    "changes: false なのに items がある",
  ],
  [
    "look.changes: true に items が無い",
    (t) => (t.operations[1].aftermath.look.items = []),
    "changes: true なのに items が空",
  ],
  [
    "items の id が重複",
    (t) => (t.operations[1].aftermath.look.items[1].id = "filtered-header"),
    'aftermath.look.items: id "filtered-header" が 2 回重複している',
  ],
  [
    "items に現行で測った値が無い",
    (t) => (t.operations[1].aftermath.look.items[0].observed = ""),
    "observed（現行で測った値",
  ],
  [
    "items の論理名が空",
    (t) => (t.operations[1].aftermath.look.items[0].target = " "),
    "target（論理名）/ description が空",
  ],
  [
    "items を撮る状態にも assertion にも割り当てていない",
    (t) => (t.operations[1].aftermath.look.items[0].covered_by = []),
    "撮る状態（captured）にも assertion（covered_by）にも割り当てていない",
  ],
  [
    "items が理由と割り当てを両方持つ",
    (t) => (t.operations[1].aftermath.look.items[0].reason = "外部連携が起動する"),
    "reason と captured / covered_by が両方埋まっている",
  ],
  [
    "items の撮る状態が撮影条件に無い",
    (t) => (t.operations[1].aftermath.look.items[1].captured = "selected-row"),
    'captured "selected-row" が capture_conditions.states に無い',
  ],
  [
    "returns_to が無い",
    (t) => delete t.operations[0].aftermath.returns_to,
    "aftermath.returns_to が無い",
  ],
  [
    "returns_to.measured: false（測れなかった）",
    (t) => (t.operations[0].aftermath.returns_to = { measured: false, reason: "遷移先が外部" }),
    "aftermath.returns_to: 未測定（遷移先が外部）",
  ],
  [
    "returns_to.measured が真偽値でない",
    (t) => (t.operations[0].aftermath.returns_to.measured = "yes"),
    "aftermath.returns_to.measured が真偽値でない",
  ],
  [
    "押した後の URL が無い",
    (t) => delete t.operations[0].aftermath.returns_to.url_after,
    "aftermath.returns_to.url_after が",
  ],
  [
    "押す前の URL にオリジンが入っている",
    (t) => (t.operations[0].aftermath.returns_to.url_before = "https://app.example/share?id=1"),
    "aftermath.returns_to.url_before が",
  ],
  [
    "押す前の URL がプロトコル相対",
    (t) => (t.operations[0].aftermath.returns_to.url_before = "//app.example/share"),
    "aftermath.returns_to.url_before が",
  ],
  [
    "動かしていない状態を戻したと書く",
    (t) => (t.operations[1].aftermath.returns_to.probed = ["検索条件"]),
    "reset に probed に無い状態がある: 並べ替え, 列フィルター, 列の変更",
  ],
  [
    "棚卸しの状態を動かさず理由も無い（1 つだけ動かして 1 つだけ確かめる）",
    (t) => (t.operations[0].aftermath.returns_to.probed = ["検索条件"]),
    "画面の状態 並べ替え, 列フィルター, 列の変更 を押す前に動かしておらず、not_probed に理由も無い",
  ],
  [
    "何も動かさず理由も無い",
    (t) => (t.operations[0].aftermath.returns_to.probed = []),
    "を押す前に動かしておらず、not_probed に理由も無い",
  ],
  [
    "棚卸しに無い状態を動かしたと書く",
    (t) => t.operations[0].aftermath.returns_to.probed.push("ページ送り"),
    "probed に表の screen_states に無い状態がある: ページ送り",
  ],
  [
    "動かした状態に動かさなかった理由が残っている",
    (t) => (t.operations[0].aftermath.returns_to.not_probed = { 検索条件: "古い理由" }),
    "not_probed に、棚卸しに無い・動かした状態の理由が残っている: 検索条件",
  ],
  [
    "not_probed が無い",
    (t) => delete t.operations[0].aftermath.returns_to.not_probed,
    "not_probed が状態ごとの理由のオブジェクトでない",
  ],
  [
    "画面の状態の棚卸しが無い",
    (t) => delete t.screen_states,
    "screen_states.states が重複の無い空でない文字列の配列でない",
  ],
  [
    "画面の状態の棚卸しに出どころが無い",
    (t) => (t.screen_states.source = ""),
    "screen_states.source が空",
  ],
  [
    "probed に重複がある",
    (t) => t.operations[0].aftermath.returns_to.probed.push("検索条件"),
    "probed / reset が、重複の無い空でない文字列の配列でない",
  ],
  [
    "reset が配列でない",
    (t) => (t.operations[0].aftermath.returns_to.reset = null),
    "probed / reset が、重複の無い空でない文字列の配列でない",
  ],
  [
    "戻り先に assertion が無い",
    (t) => (t.operations[0].aftermath.returns_to.covered_by = [""]),
    "aftermath.returns_to.covered_by が空",
  ],
])("押した後に残るものの記録の欠けを落とす: %s（Issue #471）", (_name, mutate, needle) => {
  const r = run(mutated(mutate));
  expect(r.status).toBe(1);
  expect(r.stderr).toContain(needle);
});

test("動かさなかった状態に理由があれば通し、状態を持たない画面は空の棚卸しで通す（Issue #471）", () => {
  const withReason = run(
    mutated((t) => {
      t.operations[0].aftermath.returns_to.probed = ["検索条件", "並べ替え"];
      t.operations[0].aftermath.returns_to.not_probed = {
        列フィルター: "この操作は列フィルターを開いている間は押せない（実 UI で確かめた）",
        列の変更: "列の変更の器を開いている間は押せない（実 UI で確かめた）",
      };
    }),
  );
  expect(withReason.stderr).toBe("");
  expect(withReason.status).toBe(0);
  const r = run(
    mutated((t) => {
      t.screen_states.states = [];
      for (const op of t.operations) {
        op.aftermath.returns_to.probed = [];
        op.aftermath.returns_to.reset = [];
      }
    }),
  );
  expect(r.stderr).toBe("");
  expect(r.status).toBe(0);
});

test("撮る状態にも assertion にもしない見た目は、理由があれば通す（Issue #471）", () => {
  const r = run(
    mutated((t) => {
      const item = t.operations[1].aftermath.look.items[0];
      item.covered_by = [];
      item.reason = "押すと外部の決済画面へ移り、戻った後の見出しを同じ条件で作れない";
    }),
  );
  expect(r.stderr).toBe("");
  expect(r.status).toBe(0);
});

test("同梱テンプレートのプレースホルダのままの aftermath は落とす（Issue #471）", () => {
  const template = JSON.parse(
    readFileSync(
      new URL("../skills/parity-suite/assets/reactions-template.json", import.meta.url),
      "utf8",
    ),
  );
  const r = run(
    mutated((x) => {
      x.operations[0].aftermath = template.operations[0].aftermath;
      x.operations[1].aftermath = template.operations[1].aftermath;
    }),
  );
  expect(r.status).toBe(1);
  expect(r.stderr).toContain('operations["copy"]: aftermath');
  expect(r.stderr).toContain('operations["search"]: aftermath');
});

test("残る見た目の撮る状態を操作をまたいで使い回すなら、全行に根拠を要求する（Codex レビュー）", () => {
  // 反応の撮影は外し、2 つの操作の残る見た目だけが copy-toast を指す形にする
  const share = (t, reasons) => {
    t.operations[0].reactions[0].capture = { state: null, reason: "通知は aftermath 側で撮る" };
    const item = { ...structuredClone(lingeringAftermath().look.items[1]), id: "copied-row" };
    t.operations[0].aftermath.look = { changes: true, items: [item] };
    const other = t.operations[1].aftermath.look.items[1];
    for (const [i, it] of [item, other].entries()) {
      it.captured = "copy-toast";
      it.covered_by = [];
      it.shared_capture_reason = reasons[i];
    }
  };
  const bare = run(mutated((t) => share(t, [null, null])));
  expect(bare.status).toBe(1);
  expect(bare.stderr).toContain('撮る状態 "copy-toast" を');
  const half = run(mutated((t) => share(t, ["コピーの後に検索しても同じ通知が残る", null])));
  expect(half.status).toBe(1);
  expect(half.stderr).toContain('根拠が空: operations["search"]');
  const both = run(
    mutated((t) =>
      share(t, [
        "コピーと検索を続けて行った 1 枚に両方の後の見た目が写ることを実 UI で確かめた",
        "同上（コピーと検索を続けて行った 1 枚で両方を確かめた）",
      ]),
    ),
  );
  expect(both.stderr).toBe("");
  expect(both.status).toBe(0);
});

test("反応の撮る状態と、別の操作の残る見た目が 1 枚を共有するなら根拠を要求する（Codex レビュー）", () => {
  // copy の反応（copy-toast）と search の残る見た目（copy-toast）。反応側を数えないと 1 件に見えて通る
  const shareToast = (t) => {
    const it = t.operations[1].aftermath.look.items[1];
    it.captured = "copy-toast";
    it.covered_by = [];
  };
  const bare = run(mutated(shareToast));
  expect(bare.status).toBe(1);
  expect(bare.stderr).toContain('reactions["toast"].capture');
  const both = run(
    mutated((t) => {
      shareToast(t);
      t.operations[0].reactions[0].capture.shared_capture_reason =
        "コピーの後に検索しても同じ通知が残り、1 枚に両方が写ることを実 UI で確かめた";
      t.operations[1].aftermath.look.items[1].shared_capture_reason = "同上";
    }),
  );
  expect(both.stderr).toBe("");
  expect(both.status).toBe(0);
});

test("別のページの同じ状態名は別の 1 枚として扱い、同じページだけ根拠を要求する（Codex レビュー）", () => {
  const metadata = {
    slug: "share",
    target: { name: "current-test", commit: "abc123" },
    reaction_coverage: { declared: true, path: "reactions.json" },
    capture_conditions: {
      states: ["default", "copy-toast"],
      pages: [{ name: "共有画面" }, { name: "検索画面" }],
    },
  };
  // copy の反応（copy-toast）と search の残る見た目（copy-toast）
  const share = (t, pages) => {
    const it = t.operations[1].aftermath.look.items[1];
    it.captured = "copy-toast";
    it.covered_by = [];
    t.operations[0].page = pages[0];
    t.operations[1].page = pages[1];
  };
  const cross = run(
    mutated((t) => share(t, ["共有画面", "検索画面"])),
    { metadata },
  );
  expect(cross.stderr).toBe("");
  expect(cross.status).toBe(0);
  const same = run(
    mutated((t) => share(t, ["共有画面", "共有画面"])),
    { metadata },
  );
  expect(same.status).toBe(1);
  expect(same.stderr).toContain('撮る状態 "共有画面 の copy-toast" を');
  const unknown = run(
    mutated((t) => share(t, ["共有画面", "旧検索画面"])),
    { metadata },
  );
  expect(unknown.status).toBe(1);
  expect(unknown.stderr).toContain(
    'page "旧検索画面" が metadata.json の capture_conditions.pages に無い',
  );
  // ページ一覧が無い metadata では page を照合できないので通さない
  const noPages = run(mutated((t) => share(t, ["共有画面", "検索画面"])));
  expect(noPages.status).toBe(1);
  expect(noPages.stderr).toContain("capture_conditions.pages を読めない");
});
