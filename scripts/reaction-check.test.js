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
import { fileURLToPath, pathToFileURL } from "node:url";
import { makeTempDir } from "./lib/test-tmpdir.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repoRoot, "skills/parity-suite/scripts/reaction-check.mjs");
const {
  main,
  coveredByOwners,
  tableFingerprint,
  indexTestList,
  specsFingerprint,
  OPERATIONLESS_TABLE_REVISION,
} = await import(pathToFileURL(script).href);

/** 観測した反応（トースト）。消えるまでの時間を 2 標本で持つ。 */
const toast = () => ({
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
const noneReaction = () => ({
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
const noLayoutChange = () => ({
  changes: false,
  evidence: "操作の前後で scrollHeight と主な論理名の矩形が同じ",
  covered_by: ["layout.spec.ts › 操作の後も頁の高さが変わらない"],
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
  covered_by: ["layout.spec.ts › 条件を 2 回足した後も頁が窓に収まりグリッドが縮む"],
});

/** 押した後に見た目が残らず、どこへも戻らないことを実測で書いた記録（Issue #471）。 */
const quietAftermath = () => ({
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
const writeAt = (line) => ({
  file: "src/export.js",
  line,
  column: EXPORT_SOURCE.split("\n")[line - 1].indexOf("writeAccessLog") + 1,
  pattern: "access-log",
});

/** 到達点まで読んで送る前の判定が無いことを確かめた記録。 */
const noPreSend = () => ({
  found: false,
  traced_to: [{ file: "src/share.js", symbol: "copy" }],
  trace: "コピーボタンのハンドラ copy から、クリップボードへ書く処理まで読んだ",
  evidence: "copy の中に件数・長さ・形式を判定して止める分岐が無い",
});

/** 送信の関数の中にある件数の上限を、境界の両側で測った記録。 */
const rowLimit = () => ({
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
const sideEffectWrites = () => ({
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
const noResubmit = () => ({
  sends: false,
  reason: "copy はクリップボードへ書くだけで要求を送らない（押している間の通信を監視して 0 件）",
});

/** 応答を保留して押し直した記録。表への書き込みを持つ操作なので書き込みの回数も数える（Issue #500）。 */
const heldResubmit = () => ({
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
const stateDisplayRow = (page = "共有画面") => ({
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
      setup: { method: "not-applicable", detail: "画面が開くダイアログの器を持たない" },
      observed: "移行元の画面のテンプレートにダイアログの要素が無い",
    },
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

/** ルートの外に置くファイルの名前と、その絶対パスに置き換える目印（テストの表を書く時点では一時ディレクトリが決まっていない）。 */
const OUTSIDE_FILE = "outside.js";
const OUTSIDE_ABS = "__OUTSIDE_ABS__";
/** ルートの中のファイル（src/export.js）の絶対パスに置き換える目印。 */
const INSIDE_ABS = "__INSIDE_ABS__";

/**
 * main を同じプロセスで呼ぶ（子プロセスの起動を省く。変異実証が変異ごとにこのファイルを丸ごと回すため、Issue #507）。
 * CLI として起動できること（エントリ判定・引数と出力・終了コードの受け渡し）は cli() の陽性コントロールが持つ。
 * @param {string} dir - 起動時の作業ディレクトリ
 * @param {string[]} args
 */
function call(dir, args) {
  args = withTests(args);
  let stdout = "";
  let stderr = "";
  const status = main(["--metadata", "metadata.json", ...args], {
    cwd: dir,
    out: (s) => (stdout += s),
    err: (s) => (stderr += s),
  });
  return { dir, status, stdout, stderr };
}

/**
 * 子プロセスとして CLI を起動する。
 * @param {string} dir
 * @param {string[]} [args]
 */
function cli(dir, args = []) {
  const r = spawnSync(
    process.execPath,
    [script, "--metadata", "metadata.json", ...withTests(args)],
    {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  return { dir, status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/**
 * --tests の一覧（run が書く tests.json）を足す。--no-tests は足さない（一覧が無いときの振る舞いを測る）。
 * @param {string[]} args
 */
function withTests(args) {
  return args.includes("--tests") || args.includes("--no-tests")
    ? args.filter((a) => a !== "--no-tests")
    : [...args, "--tests", "tests.json"];
}

/**
 * `playwright test --list --reporter=json` の出力の形（@playwright/test 1.63.0 の実測）で、テストの一覧を作る。
 * 名前は「スペックのパス › 題 …」で、最初の区切りの前をファイル、残りを describe と題に割る。spec は projects ごとに別の要素で並ぶ。
 * @param {string[]} names
 * @param {string[]} [projects]
 */
function testList(names, projects = ["current", "new"]) {
  /** @type {Map<string, object>} */
  const files = new Map();
  for (const name of names) {
    const [file, ...titles] = name.split(" › ");
    // 区切りの無い名前（テンプレートの説明文など）はどのテストにもならない
    if (titles.length === 0) continue;
    const top = files.get(file) ?? { title: file, file, line: 0, column: 0, specs: [], suites: [] };
    files.set(file, top);
    let suite = top;
    for (const t of titles.slice(0, -1)) {
      let child = suite.suites.find((c) => c.title === t);
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

/**
 * 表の全ての covered_by を名乗った通りの一覧と、全行を reaches とした監査の記録を作る（陽性コントロールの既定）。
 * @param {Record<string, unknown>} table
 */
function passingAudit(table) {
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
const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * 名指しされたスペックを一時プロジェクトに置く（中身は監査の指紋を取るためだけのもの）。
 * @param {string} dir
 * @param {string} file
 */
function writeSpec(dir, file) {
  const path = join(dir, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `// ${file}\nexpect(page.getByText('Saved')).toHaveText('Saved');\n`);
}

/**
 * 一時プロジェクトを作って main を実行する。
 * tests.json（--tests）は表の covered_by から、assertion_audit は表に無ければ全行 reaches で作る。
 * 変えたいテストは opts.tests（名前の一覧か、一覧そのもの）・opts.audit: false で差し替える。
 * @param {object} table
 * 部品被覆表（opts.coverage）を渡すと component-coverage.json として置く（metadata の component_coverage.path が指す先）。
 * @param {{ args?: string[], metadata?: object, source?: string, exportSource?: string, tests?: string[] | object, audit?: false, coverage?: object }} [opts]
 */
function run(table, opts = {}) {
  // 移行元ソースのルート（dir）の外に、実在するファイルを 1 つ置く。ルートの外を指す参照を照合が読まないことを確かめる陽性コントロール
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
  // JSON 文字列の中へ入れるので、区切りがバックスラッシュのパス（Windows）もエスケープしてから置き換える
  const final = JSON.parse(
    JSON.stringify(table)
      .replaceAll(OUTSIDE_ABS, JSON.stringify(join(outer, OUTSIDE_FILE)).slice(1, -1))
      .replaceAll(INSIDE_ABS, JSON.stringify(join(dir, "src/export.js")).slice(1, -1)),
  );
  if (opts.audit !== false && !Object.hasOwn(final, "assertion_audit")) {
    final.assertion_audit = passingAudit(final);
  }
  const tests = opts.tests ?? coveredByOwners(final).flatMap((o) => o.names);
  const list = Array.isArray(tests) ? testList([...new Set(tests)]) : tests;
  // スペックの起点（config.rootDir）は一時プロジェクト。名指しされたスペックを実ファイルとして置く
  if (isObject(list) && isObject(list.config) && !Object.hasOwn(list.config, "rootDir")) {
    list.config.rootDir = dir;
  }
  for (const suite of isObject(list) && Array.isArray(list.suites) ? list.suites : []) {
    writeSpec(dir, suite.file);
  }
  writeFileSync(join(dir, "tests.json"), JSON.stringify(list));
  // 監査の記録にはスペックの指紋を写す（--audit-sheet の出力を写すのと同じ値。指紋を変えるテストは自分で書く）
  if (
    isObject(final.assertion_audit) &&
    !Object.hasOwn(final.assertion_audit, "specs_fingerprint")
  ) {
    try {
      final.assertion_audit.specs_fingerprint = specsFingerprint(
        coveredByOwners(final),
        indexTestList(list),
        dir,
        (f) => readFileSync(f, "utf8"),
      ).fingerprint;
    } catch {
      // 一覧そのものが壊れている場合（使い方の誤りを測るテスト）は指紋を写さない
    }
  }
  writeFileSync(join(dir, "reactions.json"), JSON.stringify(final));
  return call(dir, opts.args ?? []);
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

test("陽性コントロール（CLI）: 子プロセスとして起動しても、完全な表は exit 0 で結果を stdout に出す", () => {
  const { dir } = run(baseTable());
  const r = cli(dir);
  expect(r.stderr).toBe("");
  expect(r.status).toBe(0);
  expect(JSON.parse(r.stdout)).toMatchObject({ tool: "reaction-check", ok: true });
});

test("陽性コントロール（CLI）: 子プロセスとして起動しても、不整合は exit 1 で stderr に出す", () => {
  const t = mutated((x) => {
    x.feedback_calls.call_sites = [];
    x.feedback_calls.zero_calls_reason = "呼び出しは無い";
  });
  const { dir } = run(t);
  const r = cli(dir);
  expect(r.stderr).toContain('["src/share.js",2,3,"toast"] が被覆表に記録されていない');
  expect(r.status).toBe(1);
  expect(JSON.parse(r.stdout)).toMatchObject({ ok: false });
});

test("陽性コントロール（CLI）: 子プロセスとして起動しても、使い方の誤りは exit 2 で usage を stderr に出す", () => {
  const { dir } = run(baseTable());
  const r = cli(dir, ["--bogus"]);
  expect(r.stderr).toContain("error: 不明な引数 --bogus");
  expect(r.stderr).toMatch(/^usage: reaction-check\.mjs/m);
  expect(r.stdout).toBe("");
  expect(r.status).toBe(2);
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
        pre_send: noPreSend(),
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
  return call(dir, args);
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
      target: {
        name: "current-test",
        commit: "abc123",
        ui_url: "http://localhost:3000/",
        ...targetPatch,
      },
      reaction_coverage: { declared: true, path: "reactions.json" },
      capture_conditions: {
        states: ["default", "copy-toast"],
        pages: [{ name: "共有画面", path: "share" }],
      },
    };
    // 走査する 2 つの範囲（フィードバック呼び出しと表への書き込み）は同じ版を照合する
    const sources = (t) => [t.feedback_calls.source, t.side_effect_writes.source];
    const noReason = run(
      mutated((t) => sources(t).forEach((src) => Object.assign(src, sourcePatch))),
      { metadata },
    );
    expect(noReason.status).toBe(1);
    expect(noReason.stderr).toContain("feedback_calls.source.version_unverified_reason が空");
    expect(noReason.stderr).toContain("side_effect_writes.source.version_unverified_reason が空");
    const withReason = run(
      mutated((t) =>
        sources(t).forEach((src) =>
          Object.assign(src, sourcePatch, {
            version_unverified_reason: "受領資産にコミット履歴が無く、受領日のアーカイブを走査した",
          }),
        ),
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
      target: { name: "current-test", commit: "abc123", ui_url: "http://localhost:3000/" },
      reaction_coverage: { declared: true, path: "reactions.json" },
      capture_conditions: { states: ["default", "copy-toast"] },
    }),
  );
  writeFileSync(join(dir, "reactions.json"), JSON.stringify(t));
  const list = testList([...new Set(coveredByOwners(t).flatMap((o) => o.names))]);
  list.config.rootDir = dir;
  writeFileSync(join(dir, "tests.json"), JSON.stringify(list));
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
    target: { name: "current-test", commit: "abc123", ui_url: "http://localhost:3000/" },
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
    side_effects_checked: true,
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
  expect(bare.stderr).toContain('撮る状態 "共有画面 の copy-toast" を');
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
    target: { name: "current-test", commit: "abc123", ui_url: "http://localhost:3000/" },
    reaction_coverage: { declared: true, path: "reactions.json" },
    capture_conditions: {
      states: ["default", "copy-toast"],
      pages: [
        { name: "共有画面", path: "share" },
        { name: "検索画面", path: "search" },
      ],
    },
  };
  // copy の反応（copy-toast）と search の残る見た目（copy-toast）
  const share = (t, pages) => {
    const it = t.operations[1].aftermath.look.items[1];
    it.captured = "copy-toast";
    it.covered_by = [];
    t.operations[0].capture_page = pages[0];
    t.operations[1].capture_page = pages[1];
    // 検索は検索画面へ遷移して撮る（押した後の URL が capture_page の path と合う）
    t.operations[1].aftermath.returns_to.url_after =
      pages[1] === "共有画面" ? "/share?id=1" : "/search";
    // 状態表示は capture_conditions.pages の全ての画面で振り分ける（Issue #500）
    t.state_displays.pages.push(stateDisplayRow("検索画面"));
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
    'capture_page "旧検索画面" が metadata.json の capture_conditions.pages に無い',
  );
  // ページ一覧が無い metadata では page を照合できないので通さない
  const noPages = run(
    mutated((t) => share(t, ["共有画面", "検索画面"])),
    {
      metadata: {
        ...metadata,
        capture_conditions: { states: metadata.capture_conditions.states },
      },
    },
  );
  expect(noPages.status).toBe(1);
  expect(noPages.stderr).toContain("capture_conditions.pages を読めない");
});

test("ページが 2 つ以上ある機能で撮る状態を持つ操作は capture_page を要求し、1 つならそのページとみなす（Codex レビュー）", () => {
  const meta = (pages) => ({
    slug: "share",
    target: { name: "current-test", commit: "abc123", ui_url: "http://localhost:3000/" },
    reaction_coverage: { declared: true, path: "reactions.json" },
    capture_conditions: {
      states: ["default", "copy-toast"],
      pages: pages.map((name) => ({ name, path: { 共有画面: "share", 検索画面: "search" }[name] })),
    },
  });
  // 状態表示は capture_conditions.pages の全ての画面で振り分ける（Issue #500）
  const bothPages = (t) => t.state_displays.pages.push(stateDisplayRow("検索画面"));
  const two = run(mutated(bothPages), { metadata: meta(["共有画面", "検索画面"]) });
  expect(two.status).toBe(1);
  expect(two.stderr).toContain("capture_page が無い");
  const one = run(baseTable(), { metadata: meta(["共有画面"]) });
  expect(one.stderr).toBe("");
  expect(one.status).toBe(0);
  const written = run(
    mutated((t) => {
      bothPages(t);
      t.operations[0].capture_page = "共有画面";
    }),
    { metadata: meta(["共有画面", "検索画面"]) },
  );
  expect(written.stderr).toBe("");
  expect(written.status).toBe(0);
});

// --- 押した後に撮ったページと URL の照合（Issue #484）---

/**
 * ページを宣言した metadata。状態表示は全ての画面で振り分ける（Issue #500）ので、表の側は withPages で揃える。
 * @param {string | null} uiUrl
 * @param {Record<string, string>} pages - 名前 → path
 */
const pagesMeta = (uiUrl, pages) => ({
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
const namedAfter = (pages, page, urlAfter) =>
  mutated((t) => {
    t.state_displays.pages = Object.keys(pages).map((name) => stateDisplayRow(name));
    t.operations[0].capture_page = page;
    t.operations[0].aftermath.returns_to.url_after = urlAfter;
  });

test.each(
  [
    {
      shape: "baseURL にパスの接頭辞がある target の根のページ",
      uiUrl: "https://host/portal/",
      pages: { 根: "", 注文: "orders" },
      urlAfter: "/portal/",
      right: "根",
      wrong: "注文",
    },
    {
      shape: "接尾辞で重なる path",
      uiUrl: "https://host/portal/",
      pages: { 注文: "orders", 保管注文: "archive/orders" },
      urlAfter: "/portal/archive/orders",
      right: "保管注文",
      wrong: "注文",
    },
    {
      shape: "クエリで分かれるページ（書いたクエリの方が狭い）",
      uiUrl: "https://host/portal/",
      pages: { 一覧: "orders", 注文タブ: "orders?tab=orders" },
      urlAfter: "/portal/orders?tab=orders",
      right: "注文タブ",
      wrong: "一覧",
    },
    {
      shape: "クエリを書かないページは、押した後の URL のクエリが何でも合う",
      uiUrl: "https://host/portal/",
      pages: { 一覧: "orders", 注文タブ: "orders?tab=orders" },
      urlAfter: "/portal/orders?q=abc",
      right: "一覧",
      wrong: "注文タブ",
    },
    {
      shape: "フラグメントで分かれるページ（ハッシュルーティング）",
      uiUrl: "https://host/portal/",
      pages: { 根: "", 注文: "#/orders" },
      urlAfter: "/portal/#/orders",
      right: "注文",
      wrong: "根",
    },
    {
      shape: "フラグメントを書かないページは、書いたフラグメントと違う URL に合う",
      uiUrl: "https://host/portal/",
      pages: { 根: "", 注文: "#/orders" },
      urlAfter: "/portal/#/archive",
      right: "根",
      wrong: "注文",
    },
    {
      shape: "ui_url が runtime でも / から書いた path は照合する",
      uiUrl: "runtime",
      pages: { 注文: "/portal/orders", 保管注文: "/portal/archive/orders" },
      urlAfter: "/portal/orders",
      right: "注文",
      wrong: "保管注文",
    },
  ].map((c) => [c.shape, c]),
)("押した後に撮ったページを URL と照合する: %s（Issue #484）", (_shape, c) => {
  const metadata = pagesMeta(c.uiUrl, c.pages);
  const right = run(namedAfter(c.pages, c.right, c.urlAfter), { metadata });
  expect(right.stderr).toBe("");
  expect(right.status).toBe(0);
  expect(JSON.parse(right.stdout).capture_page_urls).toEqual({
    checked: true,
    reason: null,
    operations: 1,
  });
  const wrong = run(namedAfter(c.pages, c.wrong, c.urlAfter), { metadata });
  expect(wrong.status).toBe(1);
  expect(wrong.stderr).toContain(
    `押した後に撮ったページを "${c.wrong}" と名乗っているが、押した後の URL ${c.urlAfter} は "${c.right}" に解決する`,
  );
});

test("target.ui_url が runtime で相対の path があれば照合せず、理由を出力に残す（Issue #484）", () => {
  const pages = { 注文: "orders", 保管注文: "archive/orders" };
  // 別のページを名乗っても照合しないので通る。照合していないことは capture_page_urls に出る
  const r = run(namedAfter(pages, "注文", "/portal/archive/orders"), {
    metadata: pagesMeta("runtime", pages),
  });
  expect(r.stderr).toBe("");
  expect(r.status).toBe(0);
  const out = JSON.parse(r.stdout).capture_page_urls;
  expect(out.checked).toBe(false);
  expect(out.reason).toContain('target.ui_url が "runtime"');
  expect(out.operations).toBe(0);
});

test.each(
  [
    {
      name: "どのページにも解決しない URL",
      pages: { 注文: "orders", 保管注文: "archive/orders" },
      page: "注文",
      urlAfter: "/portal/home",
      message: '"/portal/home" が capture_conditions.pages のどのページにも解決しない',
    },
    {
      name: "同じ狭さの 2 ページに解決する URL",
      pages: { 注文タブ: "orders?tab=orders", 注文の印: "orders#mark" },
      page: "注文タブ",
      urlAfter: "/portal/orders?tab=orders#mark",
      message: "同じ狭さの複数のページ（注文タブ, 注文の印）に解決する",
    },
    {
      // "/\\host/x" は http(s) ではスキーム相対になり、別のホストのパスとして解ける
      name: "バックスラッシュを含む URL",
      pages: { 注文: "orders", 保管注文: "archive/orders" },
      page: "注文",
      urlAfter: "/\\host/portal/orders",
      message: '"/\\host/portal/orders" が "/" で始まるオリジンを除いたパスでない',
    },
    {
      // 末尾のスラッシュを正規化しない（別の URL として扱う）
      name: "末尾のスラッシュだけが違う URL",
      pages: { 注文: "orders", 保管注文: "archive/orders" },
      page: "注文",
      urlAfter: "/portal/orders/",
      message: '"/portal/orders/" が capture_conditions.pages のどのページにも解決しない',
    },
  ].map((c) => [c.name, c]),
)("押した後の URL を一意に引けなければ落とす: %s（Issue #484）", (_name, c) => {
  const r = run(namedAfter(c.pages, c.page, c.urlAfter), {
    metadata: pagesMeta("https://host/portal/", c.pages),
  });
  expect(r.status).toBe(1);
  expect(r.stderr).toContain(c.message);
});

test("target.ui_url が URL でも runtime でもなければ、撮る状態を持つ操作があるとき落とす（Issue #484）", () => {
  const pages = { 共有画面: "share" };
  for (const uiUrl of [null, "", "localhost:3000", "ftp://host/"]) {
    const r = run(namedAfter(pages, "共有画面", "/share?id=1"), {
      metadata: pagesMeta(uiUrl, pages),
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("target.ui_url が絶対 URL（http / https）でも");
  }
});

test.each([
  ["path が無い", { name: "検索画面" }, 'capture_conditions.pages の "検索画面" に path'],
  [
    "path がオリジンを持つ",
    { name: "検索画面", path: "https://host/search" },
    'capture_conditions.pages の "検索画面" の path がオリジンを持つ',
  ],
  [
    "path がスキーム相対",
    { name: "検索画面", path: "//host/search" },
    'capture_conditions.pages の "検索画面" の path がオリジンを持つ',
  ],
  [
    // http(s) の URL ではバックスラッシュが "/" と同じに読まれ、別のホストへ解ける
    "path がバックスラッシュを含む",
    { name: "検索画面", path: "\\\\host\\search" },
    'capture_conditions.pages の "検索画面" の path がオリジンを持つかバックスラッシュを含む',
  ],
])(
  "ページの path を解けなければ、撮る状態を持つ操作があるとき落とす: %s（Issue #484）",
  (_n, page, message) => {
    const metadata = pagesMeta("http://localhost:3000/", { 共有画面: "share" });
    metadata.capture_conditions.pages.push(page);
    const r = run(
      namedAfter({ 共有画面: "share", 検索画面: "search" }, "共有画面", "/share?id=1"),
      {
        metadata,
      },
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(message);
  },
);

test("撮る状態が状態表示だけでも、ページを解けなければ落とす（別名をまたいだ使い回しを数えられない。Issue #484）", () => {
  const pages = { 共有画面: "share" };
  const t = mutated((x) => {
    x.operations[0].reactions[0].capture = { state: null, reason: "通知は撮らない" };
    x.state_displays.pages[0].candidates.empty.captured = "copy-toast";
  });
  const ok = run(t, { metadata: pagesMeta("http://localhost:3000/", pages) });
  expect(ok.stderr).toBe("");
  expect(ok.status).toBe(0);
  const r = run(t, { metadata: pagesMeta(null, pages) });
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("target.ui_url が絶対 URL（http / https）でも");
});

test("別名のページ（同じ path の別の名前）は同じ 1 枚として数え、名乗りの照合も通す（Issue #484）", () => {
  const pages = { 共有画面: "share", 共有画面の別名: "share" };
  const metadata = pagesMeta("http://localhost:3000/", pages);
  // コピーは別名を名乗り、検索は本名を名乗って同じ状態名を撮る
  const share = (t, reasons) => {
    t.state_displays.pages = Object.keys(pages).map((name) => stateDisplayRow(name));
    t.operations[0].capture_page = "共有画面の別名";
    t.operations[1].capture_page = "共有画面";
    const it = t.operations[1].aftermath.look.items[1];
    it.captured = "copy-toast";
    it.covered_by = [];
    t.operations[0].reactions[0].capture.shared_capture_reason = reasons[0];
    it.shared_capture_reason = reasons[1];
  };
  const bare = run(
    mutated((t) => share(t, [null, null])),
    { metadata },
  );
  expect(bare.status).toBe(1);
  expect(bare.stderr).toContain('撮る状態 "共有画面の別名 の copy-toast" を');
  const both = run(
    mutated((t) =>
      share(t, [
        "コピーの後に検索しても同じ通知が残り、1 枚に両方が写ることを実 UI で確かめた",
        "同上",
      ]),
    ),
    { metadata },
  );
  expect(both.stderr).toBe("");
  expect(both.status).toBe(0);
});

test("ui_url が runtime で解けない相対の path も、同じ path の別名は同じ 1 枚として数える（Claude Code レビュー #524）", () => {
  const pages = { 共有画面: "share", 共有画面の別名: "share" };
  const metadata = pagesMeta("runtime", pages);
  const share = (t, reasons) => {
    t.state_displays.pages = Object.keys(pages).map((name) => stateDisplayRow(name));
    t.operations[0].capture_page = "共有画面の別名";
    t.operations[1].capture_page = "共有画面";
    const it = t.operations[1].aftermath.look.items[1];
    it.captured = "copy-toast";
    it.covered_by = [];
    t.operations[0].reactions[0].capture.shared_capture_reason = reasons[0];
    it.shared_capture_reason = reasons[1];
  };
  const bare = run(
    mutated((t) => share(t, [null, null])),
    { metadata },
  );
  expect(bare.status).toBe(1);
  expect(bare.stderr).toContain('撮る状態 "共有画面の別名 の copy-toast" を');
  // URL との照合はしていない（相対の path を解けない）ことも出力に残る
  expect(JSON.parse(bare.stdout).capture_page_urls.checked).toBe(false);
  const both = run(
    mutated((t) =>
      share(t, [
        "コピーの後に検索しても同じ通知が残り、1 枚に両方が写ることを実 UI で確かめた",
        "同上",
      ]),
    ),
    { metadata },
  );
  expect(both.stderr).toBe("");
  expect(both.status).toBe(0);
});

// --- 部品被覆表と反応の被覆表をまたいだ撮る状態の使い回し（Issue #485）---

const coverageTemplate = JSON.parse(
  readFileSync(
    join(repoRoot, "skills/parity-suite/assets/component-coverage-template.json"),
    "utf8",
  ),
);

/**
 * テンプレートの形の部品被覆表。部品 grid のインスタンスごとに、導いた行（after-operation）が 1 つずつ撮る状態を指す。
 * @param {{ instance: string, page: string, captured: string, reason?: string | null }[]} rows
 */
const coverageWith = (rows) => {
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

/** 部品被覆表を宣言した metadata（ページは 2 つ。表の状態表示も 2 画面ぶん振り分ける）。 */
const coverageMeta = () => ({
  ...pagesMeta("http://localhost:3000/", { 共有画面: "share", 検索画面: "search" }),
  component_coverage: { declared: true, path: "component-coverage.json" },
});

/** コピー（反応の copy-toast）を共有画面で撮る表。反応の側の根拠を reason にする。 */
const copyOnShare = (reason) =>
  mutated((t) => {
    t.state_displays.pages = [stateDisplayRow("共有画面"), stateDisplayRow("検索画面")];
    t.operations[0].capture_page = "共有画面";
    t.operations[0].reactions[0].capture.shared_capture_reason = reason;
  });

test("表をまたいで同じページ × 状態名を指す 2 行は、根拠なしなら落ち、両方に根拠があれば通す（Issue #485）", () => {
  const bare = run(copyOnShare(null), {
    metadata: coverageMeta(),
    coverage: coverageWith([{ instance: "main", page: "共有画面", captured: "copy-toast" }]),
  });
  expect(bare.status).toBe(1);
  expect(bare.stderr).toContain('撮る状態 "共有画面 の copy-toast" を');
  expect(bare.stderr).toContain(
    "component-coverage.json: visual_state_coverage.rows[0]（grid / main / row-select / after-operation）",
  );
  // 片方だけの根拠では通さない（部品被覆表の側が空）
  const half = run(copyOnShare("コピーの後に行を選んでも同じ通知が残る"), {
    metadata: coverageMeta(),
    coverage: coverageWith([{ instance: "main", page: "共有画面", captured: "copy-toast" }]),
  });
  expect(half.status).toBe(1);
  expect(half.stderr).toContain("根拠が空: component-coverage.json: visual_state_coverage.rows[0]");
  const both = run(
    copyOnShare("コピーの後に行を選んだ 1 枚に通知と選択の塗りが写ることを実 UI で確かめた"),
    {
      metadata: coverageMeta(),
      coverage: coverageWith([
        {
          instance: "main",
          page: "共有画面",
          captured: "copy-toast",
          reason: "同上（1 枚で両方を確かめた）",
        },
      ]),
    },
  );
  expect(both.stderr).toBe("");
  expect(both.status).toBe(0);
  expect(JSON.parse(both.stdout).coverage_captures).toEqual({ counted: 1, skipped: 0 });
});

test("表をまたいでも別のページなら同じ状態名で通す（Issue #485）", () => {
  const r = run(copyOnShare(null), {
    metadata: coverageMeta(),
    coverage: coverageWith([{ instance: "main", page: "検索画面", captured: "copy-toast" }]),
  });
  expect(r.stderr).toBe("");
  expect(r.status).toBe(0);
  expect(JSON.parse(r.stdout).coverage_captures).toEqual({ counted: 1, skipped: 0 });
});

test("部品被覆表を宣言していなければ表をまたいだ照合の相手は無い（coverage_captures: null。Issue #485）", () => {
  const r = run(copyOnShare(null), {
    metadata: pagesMeta("http://localhost:3000/", { 共有画面: "share", 検索画面: "search" }),
  });
  expect(r.stderr).toBe("");
  expect(r.status).toBe(0);
  expect(JSON.parse(r.stdout).coverage_captures).toBe(null);
});

test.each([
  ["部品被覆表が無い", undefined, "部品被覆表を読めない: component-coverage.json"],
  ["visual_state_coverage.rows が無い", { components: [] }, "visual_state_coverage.rows が無い"],
])("部品被覆表を宣言したのに読めなければ落とす: %s（Issue #485）", (_name, coverage, message) => {
  const r = run(copyOnShare(null), { metadata: coverageMeta(), coverage });
  expect(r.status).toBe(1);
  expect(r.stderr).toContain(message);
});

test("部品被覆表の行のうちページを引けない行は数えず、件数を出力に残す（Issue #485）", () => {
  // インスタンスに page が無い行（coverage-expand.mjs が落とす形）。黙って捨てず skipped に数える
  const cov = coverageWith([{ instance: "main", page: "共有画面", captured: "copy-toast" }]);
  delete cov.components[0].instances[0].page;
  const r = run(copyOnShare(null), { metadata: coverageMeta(), coverage: cov });
  expect(r.stderr).toBe("");
  expect(r.status).toBe(0);
  expect(JSON.parse(r.stdout).coverage_captures).toEqual({ counted: 0, skipped: 1 });
});

test("部品被覆表を宣言したのに path が空なら落とす（Issue #485）", () => {
  const metadata = coverageMeta();
  metadata.component_coverage.path = "";
  const r = run(copyOnShare(null), { metadata });
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("component_coverage.path が空");
});

test("部品被覆表の中だけの使い回しは、同じページ名なら coverage-expand.mjs に任せ、別名をまたぐならここで数える（Issue #485）", () => {
  // 同じページ名の 2 インスタンスが同じ状態名を指す（coverage-expand.mjs が落とす形）。反応の側は別の状態名にする
  const noToast = mutated((t) => {
    t.state_displays.pages = [stateDisplayRow("共有画面"), stateDisplayRow("検索画面")];
    t.operations[0].reactions[0].capture = { state: null, reason: "通知は撮らない" };
  });
  const samePage = run(noToast, {
    metadata: coverageMeta(),
    coverage: coverageWith([
      { instance: "main", page: "共有画面", captured: "copy-toast" },
      { instance: "side", page: "共有画面", captured: "copy-toast" },
    ]),
  });
  expect(samePage.stderr).toBe("");
  expect(samePage.status).toBe(0);
  // 別名のページ（同じ path の別の名前）は coverage-expand.mjs が名前で分けて数えるので、ここで落とす
  const aliasMeta = coverageMeta();
  aliasMeta.capture_conditions.pages.push({ name: "共有画面の別名", path: "share" });
  const aliased = mutated((t) => {
    t.state_displays.pages = ["共有画面", "検索画面", "共有画面の別名"].map((n) =>
      stateDisplayRow(n),
    );
    t.operations[0].reactions[0].capture = { state: null, reason: "通知は撮らない" };
  });
  const alias = run(aliased, {
    metadata: aliasMeta,
    coverage: coverageWith([
      { instance: "main", page: "共有画面", captured: "copy-toast" },
      { instance: "side", page: "共有画面の別名", captured: "copy-toast" },
    ]),
  });
  expect(alias.status).toBe(1);
  expect(alias.stderr).toContain('撮る状態 "共有画面 の copy-toast" を');
});

// --- 送る前の判定（Issue #483）---

test("到達点まで読んで判定が無い操作と、境界の両側を測った判定は通す（Issue #483）", () => {
  const r = run(baseTable());
  expect(r.stderr).toBe("");
  expect(r.status).toBe(0);
});

test("ゴールデンデータが境界に届かず代わりの作り方で測った側も、作り方を書けば通す（Issue #483）", () => {
  const t = mutated((x) => {
    x.operations[1].pre_send.items[0].sides[1].setup =
      "ゴールデンデータは 120 行で上限に届かないので、画面の行の追加で 501 行にしてから選ぶ";
  });
  const r = run(t);
  expect(r.stderr).toBe("");
  expect(r.status).toBe(0);
});

test.each([
  ["読めるファイルとシンボル", { file: "src/export.js", symbol: "sendExport" }, 0, null],
  [
    "無いファイル",
    { file: "lib/elsewhere.js", symbol: "send" },
    1,
    "pre_send.traced_to のファイル lib/elsewhere.js を --root から読めない",
  ],
  [
    // ルートの外に実在するファイルを指す。ガードが無ければ読めてしまい、シンボル sendOutside が見つかって通る
    "ルートの外",
    { file: `../${OUTSIDE_FILE}`, symbol: "sendOutside" },
    1,
    `../${OUTSIDE_FILE} を --root から読めない`,
  ],
  [
    "絶対パス",
    { file: OUTSIDE_ABS, symbol: "sendOutside" },
    1,
    `${OUTSIDE_FILE} を --root から読めない`,
  ],
  [
    // ルートの中を指していても、走査範囲のキー（相対パス）と形が違うと declared: true で合否が逆になる
    "ルートの中の絶対パス",
    { file: INSIDE_ABS, symbol: "sendExport" },
    1,
    "src/export.js を --root から読めない",
  ],
  [
    "./ で始まる相対パス",
    { file: "./src/export.js", symbol: "sendExport" },
    1,
    "./src/export.js を --root から読めない",
  ],
  [
    "ファイルに無いシンボル",
    { file: "src/export.js", symbol: "submitExport" },
    1,
    "pre_send.traced_to の submitExport が src/export.js に見つからない",
  ],
])(
  "feedback_calls.declared: false でも送る前の判定の到達点を --root から読んで照合する: %s（Issue #483）",
  (_name, ref, status, message) => {
    const t = mutated((x) => {
      x.feedback_calls = { declared: false, reason: "設定の呼び出しが空と確認済み" };
      x.operations[1].pre_send.traced_to = [ref];
    });
    const r = run(t);
    expect(r.status).toBe(status);
    if (message === null) expect(r.stderr).toBe("");
    else expect(r.stderr).toContain(message);
  },
);

test("feedback_calls.declared: false の --recorded は送る前の判定の参照を読まない（Issue #483）", () => {
  const t = mutated((x) => {
    x.feedback_calls = { declared: false, reason: "設定の呼び出しが空と確認済み" };
  });
  const w = run(t, { args: ["--write"] });
  expect(w.status).toBe(0);
  // parity-diff の実行環境に移行元ソースがあるとは限らない
  writeFileSync(join(w.dir, "src/export.js"), "");
  expect(rerun(w.dir, ["--recorded"]).status).toBe(0);
});

test.each([
  ["pre_send が無い", (t) => delete t.operations[0].pre_send, "pre_send が無い"],
  [
    "追えなかった",
    (t) => (t.operations[0].pre_send = { found: null, reason: "部品が難読化されている" }),
    "pre_send: 未測定（部品が難読化されている）",
  ],
  ["found が真偽値でない", (t) => (t.operations[0].pre_send.found = "no"), "pre_send.found が"],
  ["到達点が空", (t) => (t.operations[0].pre_send.traced_to = []), "pre_send.traced_to"],
  [
    "到達点のシンボルが欠けている",
    (t) => (t.operations[0].pre_send.traced_to = [{ file: "src/share.js" }]),
    "pre_send.traced_to",
  ],
  [
    "辿り方がテンプレートの説明文のまま",
    (t) => (t.operations[0].pre_send.trace = "<どう辿ったか>"),
    "pre_send.trace が空",
  ],
  [
    "判定が無いと書いて確かめた記録が無い",
    (t) => delete t.operations[0].pre_send.evidence,
    "found: false なのに evidence が空",
  ],
  [
    "判定があると書いて列挙していない",
    (t) => (t.operations[1].pre_send.items = []),
    "found: true なのに items が空",
  ],
  [
    "判定の種類が語彙に無い",
    (t) => (t.operations[1].pre_send.items[0].kind = "limit"),
    'pre_send.items["max-rows"]: kind が語彙',
  ],
  [
    "判定の場所が無い",
    (t) => delete t.operations[1].pre_send.items[0].location,
    'pre_send.items["max-rows"]: location',
  ],
  [
    "止める条件が空",
    (t) => (t.operations[1].pre_send.items[0].condition = ""),
    "condition（止める条件）",
  ],
  [
    "止めたときに起きることが空",
    (t) => delete t.operations[1].pre_send.items[0].on_block,
    "on_block（止めたときに起きること）",
  ],
  [
    "順序にこの判定が無い",
    (t) => (t.operations[1].pre_send.items[0].order = ["confirm", "send"]),
    'pre_send.items["max-rows"]: order',
  ],
  [
    "順序がこの判定だけ",
    (t) => (t.operations[1].pre_send.items[0].order = ["max-rows"]),
    'pre_send.items["max-rows"]: order',
  ],
  [
    "順序に同じ工程が 2 回",
    (t) => (t.operations[1].pre_send.items[0].order = ["max-rows", "send", "send"]),
    'pre_send.items["max-rows"]: order',
  ],
  [
    "境界を 1 つも測っていない",
    (t) => (t.operations[1].pre_send.items[0].sides = []),
    "sides が空",
  ],
  [
    "止まる側を測っていない",
    (t) => t.operations[1].pre_send.items[0].sides.pop(),
    "境界の outside 側を測っていない",
  ],
  [
    "通る側を測っていない",
    (t) => t.operations[1].pre_send.items[0].sides.shift(),
    "境界の inside 側を測っていない",
  ],
  [
    "両側とも通る側",
    (t) => (t.operations[1].pre_send.items[0].sides[1].side = "inside"),
    "境界の outside 側を測っていない",
  ],
  [
    "側の語彙が無い",
    (t) => (t.operations[1].pre_send.items[0].sides[1].side = "over"),
    "sides[1]: side が",
  ],
  [
    "止まる側を測れなかった",
    (t) => {
      const side = t.operations[1].pre_send.items[0].sides[1];
      delete side.observed;
      side.covered_by = [];
      side.reason = "上限を超える行を作れない";
    },
    "sides[1]: 未測定（上限を超える行を作れない）",
  ],
  [
    "止まる側の assertion が無い",
    (t) => (t.operations[1].pre_send.items[0].sides[1].covered_by = []),
    "sides[1]: observed（現行で測った結果）/ covered_by（assertion）が空",
  ],
  [
    "境界の状態の作り方が空",
    (t) => (t.operations[1].pre_send.items[0].sides[1].setup = ""),
    "setup（境界の状態をどう作ったか",
  ],
  [
    "判定 id の重複",
    (t) => t.operations[1].pre_send.items.push({ ...t.operations[1].pre_send.items[0] }),
    'pre_send.items: id "max-rows" が 2 回重複',
  ],
  [
    "到達点が走査範囲の外",
    (t) => {
      t.operations[1].pre_send.traced_to = [{ file: "lib/export.js", symbol: "sendExport" }];
    },
    "pre_send.traced_to のファイル lib/export.js が走査範囲に無い",
  ],
  [
    "判定の場所のシンボルがファイルに無い",
    (t) => (t.operations[1].pre_send.items[0].location.symbol = "sendExportAll"),
    "location の sendExportAll が src/export.js に見つからない",
  ],
])("送る前の判定の欠けは未測定として落とす: %s（Issue #483）", (_name, mutate, message) => {
  const r = run(mutated(mutate));
  expect(r.status).toBe(1);
  expect(r.stderr).toContain(message);
  expect(JSON.parse(r.stdout).unmeasured_operations).toBeGreaterThan(0);
});

test("判定が無いと書いたのに判定を列挙した操作は矛盾として落とす（Issue #483）", () => {
  const r = run(mutated((t) => (t.operations[0].pre_send.items = [...rowLimit().items])));
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("found: false なのに items がある");
});

test("同梱テンプレートのプレースホルダのままの pre_send は落とす（Issue #483）", () => {
  const template = JSON.parse(
    readFileSync(join(repoRoot, "skills/parity-suite/assets/reactions-template.json"), "utf8"),
  );
  const t = mutated((x) => {
    x.operations[1].pre_send = template.operations[0].pre_send;
  });
  const r = run(t);
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("pre_send");
});

// --- 表への書き込み（Issue #466）---

test("書き込みを持たない機能は declared: false と理由で通す（Issue #466）", () => {
  const t = mutated((x) => {
    x.side_effect_writes = {
      declared: false,
      reason: "features.md の副作用出力に表への書き込みが無い",
    };
    // 書き込みが無ければ押し直しで数える書き込みも無い（Issue #500）
    delete x.operations[1].resubmit.writes;
  });
  const r = run(t);
  expect(r.stderr).toBe("");
  expect(r.status).toBe(0);
  expect(JSON.parse(r.stdout).side_effect_writes).toMatchObject({
    declared: false,
    checked: false,
  });
});

test("declared: false の空の配列は記録とみなさず通す（Issue #466）", () => {
  const t = mutated((x) => {
    x.side_effect_writes = {
      declared: false,
      reason: "features.md の副作用出力に表への書き込みが無い",
      tables: [],
      patterns: [],
      sites: [],
    };
    delete x.operations[1].resubmit.writes;
  });
  const r = run(t);
  expect(r.stderr).toBe("");
  expect(r.status).toBe(0);
});

test("画面を開いたときの書き込みは operation: null と時機で、別機能の書き込みは除外理由で通す（Issue #466）", () => {
  const t = mutated((x) => {
    x.side_effect_writes.sites[0] = {
      ...writeAt(3),
      operation: null,
      occasion: "画面を開いたとき",
      path: "normal",
      values: "種別 open・利用者 id",
      count: "開くたびに 1 行",
      verification: "assertion",
      covered_by: ["open.spec.ts › 画面を開くとアクセスログが 1 行書かれる"],
    };
    x.side_effect_writes.sites.push({
      file: "src/share.js",
      line: 4,
      column: 1,
      pattern: "access-log",
      excluded_reason: "一覧画面（別 slug）の書き込み",
    });
  });
  const r = run(t, {
    source: "function copy() {\n  showFeedback('Copied');\n}\nwriteAccessLog('list');\n",
  });
  expect(r.stderr).toBe("");
  expect(r.status).toBe(0);
  expect(JSON.parse(r.stdout).side_effect_writes).toMatchObject({
    declared: true,
    checked: true,
    found: 3,
  });
});

test.each([
  [
    "キーごと無い",
    (t) => delete t.side_effect_writes,
    "side_effect_writes.declared が真偽値でない",
  ],
  [
    "declared: false なのに記録がある",
    (t) =>
      Object.assign(t.side_effect_writes, {
        declared: false,
        reason: "features.md の副作用出力に表への書き込みが無い",
      }),
    "side_effect_writes.declared: false なのに sites がある",
  ],
  [
    "書き込みが無いと書いて理由が無い",
    (t) => (t.side_effect_writes = { declared: false, reason: "" }),
    "declared: false なのに reason が空",
  ],
  ["表が空", (t) => (t.side_effect_writes.tables = []), "side_effect_writes.tables が"],
  ["パターンが空", (t) => (t.side_effect_writes.patterns = []), "side_effect_writes.patterns が空"],
  [
    "パターンが実際の呼び出しに一致しない",
    (t) => (t.side_effect_writes.patterns[0].example = "logAccess('export')"),
    "regex が example に一致しない",
  ],
  [
    "パターンの表が表の一覧に無い",
    (t) => (t.side_effect_writes.patterns[0].table = "audit"),
    'table "audit" が side_effect_writes.tables に無い',
  ],
  [
    "パターンを持たない表がある",
    (t) => t.side_effect_writes.tables.push("audit"),
    "表 audit への書き込みを探すパターンが無い",
  ],
  [
    "表に書く箇所を 1 件も記録していない",
    (t) => {
      t.side_effect_writes.tables.push("audit");
      t.side_effect_writes.patterns.push({
        id: "audit",
        table: "audit",
        regex: "\\bwriteAudit\\s*\\(",
        example: "writeAudit('x')",
      });
    },
    "表 audit に書く箇所が 1 件も記録されていない",
  ],
  ["例外時の書き込みを記録していない", (t) => t.side_effect_writes.sites.pop(), "ソースの書き込み"],
  [
    "ソースに無い書き込みを記録している",
    (t) => t.side_effect_writes.sites.push({ ...t.side_effect_writes.sites[0], line: 9 }),
    "がソースに見つからない",
  ],
  [
    "同じ書き込みを 2 回記録している",
    (t) => t.side_effect_writes.sites.push({ ...t.side_effect_writes.sites[0] }),
    "2 回重複している",
  ],
  [
    "書き込みのパターンが一覧に無い",
    (t) => (t.side_effect_writes.sites[0].pattern = "audit"),
    'pattern "audit" が side_effect_writes.patterns に無い',
  ],
  [
    "操作が被覆表に無い",
    (t) => (t.side_effect_writes.sites[0].operation = "export"),
    'operation "export" が被覆表の操作に無い',
  ],
  [
    "操作を書いていない",
    (t) => delete t.side_effect_writes.sites[0].operation,
    'operation "undefined" が被覆表の操作に無い',
  ],
  ["時機が空", (t) => (t.side_effect_writes.sites[0].occasion = ""), "occasion（いつ書くか"],
  ["書く値が空", (t) => delete t.side_effect_writes.sites[0].values, "values（書く値）"],
  ["回数が空", (t) => (t.side_effect_writes.sites[0].count = "<回数>"), "count（回数）"],
  ["経路が語彙に無い", (t) => (t.side_effect_writes.sites[0].path = "catch"), "path が語彙"],
  [
    "assertion と書いて assertion が無い",
    (t) => (t.side_effect_writes.sites[0].covered_by = []),
    "verification: assertion なのに covered_by が空",
  ],
  [
    "読解のみと書いて理由が無い",
    (t) => delete t.side_effect_writes.sites[1].source_only_reason,
    "verification: source-only なのに source_only_reason",
  ],
  [
    "読解のみと書いて assertion もある",
    (t) => (t.side_effect_writes.sites[1].covered_by = ["export.spec.ts › 例外時にログが書かれる"]),
    "verification: source-only なのに covered_by がある",
  ],
  [
    "書き込みの位置が欠けている",
    (t) => delete t.side_effect_writes.sites[0].column,
    "side_effect_writes.sites: file / line / column / pattern が欠けた行がある",
  ],
  [
    "確かめ方が語彙に無い",
    (t) => (t.side_effect_writes.sites[1].verification = "db"),
    "verification が語彙",
  ],
  [
    "走査した版が違う",
    (t) => (t.side_effect_writes.source.version = "def456"),
    "side_effect_writes.source.version（def456）",
  ],
  [
    "走査範囲が空",
    (t) => (t.side_effect_writes.source.paths = []),
    "side_effect_writes.source.paths が空",
  ],
  [
    "走査範囲にテキストファイルが無い",
    (t) => (t.side_effect_writes.source.paths = ["empty"]),
    "side_effect_writes: 走査対象のテキストファイルが 0 件",
  ],
])("表への書き込みの欠けは落とす: %s（Issue #466）", (_name, mutate, message) => {
  const r = run(mutated(mutate));
  expect(r.status).toBe(1);
  expect(r.stderr).toContain(message);
});

test.each([
  ["書き込みの記録が配列でない", (t) => (t.side_effect_writes.sites = {})],
  ["書き込みのパターンが不正な正規表現", (t) => (t.side_effect_writes.patterns[0].regex = "(")],
  ["走査範囲がルートの外", (t) => (t.side_effect_writes.source.paths = ["../outside"])],
])("表への書き込みの型崩れは exit 2: %s（Issue #466）", (_name, mutate) => {
  expect(run(mutated(mutate)).status).toBe(2);
});

test("--recorded は表への書き込みを突き合わせていない記録を落とす（Issue #466）", () => {
  const w = run(baseTable(), { args: ["--write"] });
  expect(w.status).toBe(0);
  const written = JSON.parse(readFileSync(join(w.dir, "reactions.json"), "utf8"));
  written.conformance.side_effects_checked = false;
  writeFileSync(join(w.dir, "reactions.json"), JSON.stringify(written));
  const r = rerun(w.dir, ["--recorded"]);
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("conformance.side_effects_checked が true でない");
});

// --- 画面ごとの状態表示（Issue #500）---

/** @param {ReturnType<typeof baseTable>} t @param {string} c */
const candidate = (t, c) => t.state_displays.pages[0].candidates[c];

test("状態表示を画面ごとに全候補で振り分けた表は通し、数えた件数を出す（Issue #500）", () => {
  const r = run(baseTable());
  expect(r.stderr).toBe("");
  expect(r.status).toBe(0);
  expect(JSON.parse(r.stdout).state_displays).toEqual({ pages: 1, entries: 5, unmeasured: 0 });
});

test.each([
  [
    "取得の失敗が起きないことを横取りの abort で確かめ、不在を assertion にした",
    (t) =>
      (t.state_displays.pages[0].candidates["fetch-error"] = {
        status: "absent",
        setup: {
          method: "route-abort",
          request: "/api/share/list",
          detail: "一覧の取得を abort する",
        },
        observed: "取得に失敗しても表示が変わらない",
        covered_by: ["share.spec.ts › 取得に失敗しても警告が出ない"],
      }),
  ],
  [
    "画面が取得の要求を送らない（no-request）",
    (t) =>
      (t.state_displays.pages[0].candidates["fetch-error"] = {
        status: "absent",
        setup: {
          method: "no-request",
          detail: "一覧はサーバーが HTML に描き込み、画面は要求を送らない",
        },
        observed: "画面を開いてから操作するまで要求が 0 件",
      }),
  ],
  [
    "読み込み中を応答の保留で作り、反応と 1 枚を共有する根拠を両方に書いて撮る状態に割り当てた",
    (t) => {
      t.state_displays.pages[0].candidates.loading = {
        status: "present",
        setup: { method: "route-delay", request: "/api/share/list", detail: "応答を 5 秒保留する" },
        observed: "一覧の上に読み込み中の覆いが出る",
        captured: "copy-toast",
        shared_capture_reason:
          "コピーの通知と読み込み中の覆いが同じ 1 枚に写ることを実 UI で確かめた",
      };
      t.operations[0].reactions[0].capture.shared_capture_reason = "同上";
    },
  ],
  [
    "0 件を横取りの fulfill（空の一覧）で作った",
    (t) =>
      Object.assign(candidate(t, "empty").setup, {
        method: "route-fulfill",
        request: "/api/share/list",
        detail: "空の一覧を返す",
      }),
  ],
])("状態表示の正規の記録は通す: %s（Issue #500）", (_name, mutate) => {
  const r = run(mutated(mutate));
  expect(r.stderr).toBe("");
  expect(r.status).toBe(0);
});

test.each([
  ["キーごと無い", (t) => delete t.state_displays, "state_displays.pages が配列でない"],
  [
    "page が空の行",
    (t) => (t.state_displays.pages[0].page = ""),
    "page（capture_conditions.pages の名前）が空の行がある",
  ],
  [
    "画面の名前が capture_conditions.pages に無い",
    (t) => (t.state_displays.pages[0].page = "旧共有画面"),
    "画面 旧共有画面 が capture_conditions.pages に無い",
  ],
  [
    "同じ画面が 2 行",
    (t) => t.state_displays.pages.push(stateDisplayRow()),
    '画面 "共有画面" が 2 回ある',
  ],
  [
    "candidates がオブジェクトでない",
    (t) => (t.state_displays.pages[0].candidates = []),
    "candidates が候補ごとの記録のオブジェクトでない",
  ],
  [
    "候補が欠けている",
    (t) => delete t.state_displays.pages[0].candidates.loading,
    "候補 loading を振り分けていない",
  ],
  [
    "語彙に無い候補",
    (t) => (t.state_displays.pages[0].candidates.spinner = { status: "absent" }),
    "候補の語彙（empty / fetch-error / loading / toast / dialog）に無いキー: spinner",
  ],
  ["status が語彙に無い", (t) => (candidate(t, "empty").status = "n/a"), "empty.status が語彙"],
  [
    "理由付きの未測定",
    (t) =>
      (t.state_displays.pages[0].candidates["fetch-error"] = {
        status: "unmeasured",
        reason: "移行元で失敗を起こす手段が無い",
      }),
    "fetch-error: 未測定（移行元で失敗を起こす手段が無い）",
  ],
  [
    "取得の失敗の「ない」を横取りで試していない",
    (t) =>
      Object.assign(candidate(t, "fetch-error"), {
        status: "absent",
        setup: { method: "ui", detail: "画面を開いた" },
      }),
    "「起こせない」と書く前に要求の横取り",
  ],
  [
    "読み込み中の「ない」を abort で確かめた（保留していない）",
    (t) => (candidate(t, "loading").setup.method = "route-abort"),
    "loading: absent の setup.method が route-delay / no-request でない",
  ],
  [
    "present に要求が無いことの記録",
    (t) => (candidate(t, "empty").setup.method = "no-request"),
    "empty: present の setup.method が",
  ],
  [
    "横取りした要求が空",
    (t) => (candidate(t, "loading").setup.request = ""),
    "setup.method: route-delay なのに setup.request",
  ],
  ["作り方が空", (t) => (candidate(t, "empty").setup.detail = ""), "empty: setup.detail"],
  [
    "現行で見たものがテンプレートの説明文のまま",
    (t) => (candidate(t, "empty").observed = "<現行で見た文言>"),
    "empty: observed",
  ],
  [
    "present をどこにも割り当てていない",
    (t) => (candidate(t, "empty").covered_by = []),
    "empty: present なのに撮る状態（captured）にも",
  ],
  [
    "present の撮る状態が capture_conditions.states に無い",
    (t) => {
      candidate(t, "empty").covered_by = [];
      candidate(t, "empty").captured = "empty-result";
    },
    'empty: captured "empty-result" が capture_conditions.states に無い',
  ],
  [
    "toast に反応の参照を書いた（Codex レビュー #504 で入力形式ごと外した）",
    (t) => (candidate(t, "toast").reactions = ["copy/toast"]),
    "toast: reactions は書けない",
  ],
  [
    "dialog の反応の参照が空配列（キーがあれば落とす）",
    (t) => (candidate(t, "dialog").reactions = []),
    "dialog: reactions は書けない",
  ],
  [
    "撮る状態を反応と根拠なしに共有する",
    (t) => {
      candidate(t, "empty").covered_by = [];
      candidate(t, "empty").captured = "copy-toast";
    },
    'state_displays["共有画面"].empty',
  ],
  [
    "absent の不在を assertion にしていない",
    (t) => (candidate(t, "loading").covered_by = []),
    "loading: absent なのに covered_by が空",
  ],
  [
    "absent に撮る状態",
    (t) => (candidate(t, "loading").captured = "copy-toast"),
    "loading: absent なのに captured がある",
  ],
])("状態表示の振り分けの欠けは落とす: %s（Issue #500）", (_name, mutate, message) => {
  const r = run(mutated(mutate));
  expect(r.status).toBe(1);
  expect(r.stderr).toContain(message);
});

test("状態表示は metadata.json の画面の宣言から期待集合を作る（記録に無い画面・読めない宣言を落とす。Issue #500）", () => {
  const base = {
    slug: "share",
    target: { name: "current-test", commit: "abc123", ui_url: "http://localhost:3000/" },
    reaction_coverage: { declared: true, path: "reactions.json" },
  };
  // 画面が 2 つある機能で 1 画面しか振り分けていない。copy は capture_page を書いて、capture_page の欠けと分ける
  const two = run(
    mutated((t) => (t.operations[0].capture_page = "共有画面")),
    {
      metadata: {
        ...base,
        capture_conditions: {
          states: ["default", "copy-toast"],
          pages: [
            { name: "共有画面", path: "share" },
            { name: "検索画面", path: "search" },
          ],
        },
      },
    },
  );
  expect(two.status).toBe(1);
  expect(two.stderr).toContain("画面 検索画面 の状態表示を振り分けていない");
  expect(JSON.parse(two.stdout).state_displays.unmeasured).toBe(1);
  const noPages = run(baseTable(), {
    metadata: { ...base, capture_conditions: { states: ["default", "copy-toast"] } },
  });
  expect(noPages.status).toBe(1);
  expect(noPages.stderr).toContain("state_displays を画面の集合と照合できない");
});

test("状態表示の未測定は ok を落とし、未測定の件数に数える（Issue #500）", () => {
  const r = run(
    mutated(
      (t) =>
        (t.state_displays.pages[0].candidates.loading = {
          status: "unmeasured",
          reason: "保留の手段を用意していない",
        }),
    ),
  );
  expect(r.status).toBe(1);
  expect(JSON.parse(r.stdout)).toMatchObject({
    ok: false,
    unmeasured_operations: 0,
    state_displays: { unmeasured: 1 },
  });
  expect(r.stderr).toContain("状態表示の未測定 1 件");
});

// --- 送っている間の押し直し（Issue #500）---

test.each([
  [
    "書き込みを持たない送る操作は writes なしで通す",
    (t) =>
      (t.operations[0].resubmit = {
        sends: true,
        reason: null,
        hold: { method: "route-delay", request: "/api/share" },
        presses: 3,
        observed: { requests_sent: 3, confirms_shown: 0, overlay: "何もしない（押すたびに送る）" },
        covered_by: ["share.spec.ts › 応答の保留中に 3 回押すと 3 回送る"],
      }),
  ],
  [
    "書き込みの回数 0（押し直しで送っても行に畳む）",
    (t) =>
      (t.operations[1].resubmit.writes = { count: 0, evidence: "送信は横取りして届けず、行は 0" }),
  ],
])("送っている間の押し直しの正規の記録は通す: %s（Issue #500）", (_name, mutate) => {
  const r = run(mutated(mutate));
  expect(r.stderr).toBe("");
  expect(r.status).toBe(0);
});

test.each([
  ["キーごと無い", (t) => delete t.operations[0].resubmit, 'operations["copy"]: resubmit が無い'],
  [
    "理由付きの未測定",
    (t) => (t.operations[0].resubmit = { sends: null, reason: "保留の手段を用意していない" }),
    "resubmit: 未測定（保留の手段を用意していない）",
  ],
  [
    "sends が語彙に無い",
    (t) => (t.operations[0].resubmit.sends = "no"),
    "resubmit.sends が true / false / null のどれでもない",
  ],
  [
    "送らない根拠が空",
    (t) => (t.operations[0].resubmit.reason = ""),
    "resubmit.sends: false なのに reason",
  ],
  [
    "書き込む操作を送らないと書いた",
    (t) => (t.operations[1].resubmit = { sends: false, reason: "送らない" }),
    'operations["search"]: resubmit.sends: false なのに、この操作の表への書き込みが',
  ],
  [
    "送らないのに測定が残っている",
    (t) => (t.operations[0].resubmit.presses = 2),
    "resubmit.sends: false なのに presses がある",
  ],
  [
    "応答を保留していない",
    (t) => (t.operations[1].resubmit.hold.method = "route-abort"),
    "resubmit.hold が { method: route-delay",
  ],
  [
    "保留した要求が空",
    (t) => (t.operations[1].resubmit.hold.request = ""),
    "resubmit.hold が { method: route-delay",
  ],
  ["押し直していない（1 回）", (t) => (t.operations[1].resubmit.presses = 1), "resubmit.presses"],
  [
    "送った回数が 0",
    (t) => (t.operations[1].resubmit.observed.requests_sent = 0),
    "resubmit.observed に、送った回数",
  ],
  [
    "確認の回数が負",
    (t) => (t.operations[1].resubmit.observed.confirms_shown = -1),
    "resubmit.observed に、送った回数",
  ],
  [
    "覆いが空",
    (t) => (t.operations[1].resubmit.observed.overlay = ""),
    "resubmit.observed に、送った回数",
  ],
  [
    "書き込む操作で書き込みの回数を数えていない",
    (t) => delete t.operations[1].resubmit.writes,
    "resubmit.writes が { count:",
  ],
  [
    "書き込みの回数が整数でない",
    (t) => (t.operations[1].resubmit.writes.count = "1 行"),
    "resubmit.writes が { count:",
  ],
  [
    "書き込みの数え方が空",
    (t) => (t.operations[1].resubmit.writes.evidence = ""),
    "resubmit.writes が { count:",
  ],
  [
    "書き込みの無い操作に書き込みの回数",
    (t) =>
      (t.operations[0].resubmit = {
        ...heldResubmit(),
        hold: { method: "route-delay", request: "/api/share" },
      }),
    'operations["copy"]: resubmit.writes があるのに、この操作の表への書き込みが side_effect_writes.sites に無い',
  ],
  [
    "assertion にしていない",
    (t) => (t.operations[1].resubmit.covered_by = []),
    "resubmit.covered_by が空",
  ],
])("送っている間の押し直しの欠けは落とす: %s（Issue #500）", (_name, mutate, message) => {
  const r = run(mutated(mutate));
  expect(r.status).toBe(1);
  expect(r.stderr).toContain(message);
});

test("同梱テンプレートのプレースホルダのままの状態表示と押し直しは落とす（Issue #500）", () => {
  const template = JSON.parse(
    readFileSync(
      new URL("../skills/parity-suite/assets/reactions-template.json", import.meta.url),
      "utf8",
    ),
  );
  const t = mutated((x) => {
    // 画面名だけ実在の名前にして、候補ごとの記録をテンプレートのまま入れる（画面名の欠けで先に落ちないようにする）
    x.state_displays = {
      pages: [{ ...structuredClone(template.state_displays.pages[0]), page: "共有画面" }],
    };
    x.operations[0].resubmit = structuredClone(template.operations[1].resubmit);
    x.operations[1].resubmit = structuredClone(template.operations[0].resubmit);
  });
  const r = run(t);
  expect(r.status).toBe(1);
  for (const c of ["empty", "fetch-error", "loading", "toast", "dialog"]) {
    expect(r.stderr).toContain(`state_displays["共有画面"]: ${c}`);
  }
  expect(r.stderr).toContain('operations["copy"]: resubmit.sends: false なのに reason');
  expect(r.stderr).toContain('operations["search"]: resubmit.presses');
});

test.each([
  [
    "name の無い宣言",
    [{ name: "共有画面", path: "share" }, { path: "orphan" }],
    "capture_conditions.pages[1] に name",
  ],
  [
    "空の name",
    [
      { name: "共有画面", path: "share" },
      { name: "", path: "x" },
    ],
    "capture_conditions.pages[1] に name",
  ],
  [
    "オブジェクトでない宣言",
    [{ name: "共有画面", path: "share" }, "検索画面"],
    "capture_conditions.pages[1] に name",
  ],
  [
    "同じ名前の宣言",
    [
      { name: "共有画面", path: "share" },
      { name: "共有画面", path: "share2" },
    ],
    '画面 "共有画面" が 2 つある',
  ],
])(
  "画面の宣言の型崩れは黙って捨てずに exit 2: %s（Codex レビュー #504）",
  (_name, pages, message) => {
    const r = run(baseTable(), {
      metadata: {
        slug: "share",
        target: { name: "current-test", commit: "abc123", ui_url: "http://localhost:3000/" },
        reaction_coverage: { declared: true, path: "reactions.json" },
        capture_conditions: { states: ["default", "copy-toast"], pages },
      },
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(message);
  },
);

test.each([
  [
    "状態表示の横取りした要求が絶対 URL",
    (t) => (candidate(t, "loading").setup.request = "https://current.example/api/share/list"),
    "loading: setup.method: route-delay なのに setup.request",
  ],
  [
    "状態表示の横取りした要求がスキーム相対",
    (t) => (candidate(t, "fetch-error").setup.request = "//current.example/api/share/list"),
    "fetch-error: setup.method: route-abort なのに setup.request",
  ],
  [
    "押し直しの保留した要求が絶対 URL",
    (t) => (t.operations[1].resubmit.hold.request = "http://localhost:8080/api/export"),
    "resubmit.hold が { method: route-delay",
  ],
  [
    "状態表示の横取りした要求が glob の後ろにホストを持つ",
    (t) => (candidate(t, "loading").setup.request = "**://current.example/api/share/list"),
    "loading: setup.method: route-delay なのに setup.request",
  ],
  [
    "押し直しの保留した要求が glob の後ろにホストを持つ",
    (t) => (t.operations[1].resubmit.hold.request = "*://localhost:8080/api/export"),
    "resubmit.hold が { method: route-delay",
  ],
  [
    "状態表示の横取りした要求が / で始まらない",
    (t) => (candidate(t, "loading").setup.request = "current.example/api/share/list"),
    "loading: setup.method: route-delay なのに setup.request",
  ],
])(
  "要求のパターンにオリジンを残す記録は落とす: %s（Codex レビュー #504）",
  (_name, mutate, message) => {
    const r = run(mutated(mutate));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(message);
  },
);

test("オリジンを含まない glob の要求パターンは通す（Codex レビュー #504）", () => {
  const r = run(
    mutated((t) => {
      candidate(t, "loading").setup.request = "**/api/share/list";
      t.operations[1].resubmit.hold.request = "**/api/export?format=csv";
    }),
  );
  expect(r.stderr).toBe("");
  expect(r.status).toBe(0);
});

// --- covered_by の解決・共有と assertion の深さの監査（Issue #506）---

/** 表の covered_by の名前（重複を除く）。 */
const namesOf = (t) => [...new Set(coveredByOwners(t).flatMap((o) => o.names))];

test("陽性コントロール: --write は covered_by を解決した記録を残し、--recorded も同じ一覧で通る（Issue #506）", () => {
  const w = run(baseTable(), { args: ["--write"] });
  expect(w.stderr).toBe("");
  expect(w.status).toBe(0);
  const written = JSON.parse(readFileSync(join(w.dir, "reactions.json"), "utf8"));
  expect(written.conformance.covered_by_resolved).toBe(true);
  expect(rerun(w.dir, ["--recorded"]).status).toBe(0);
});

test("covered_by の名前が一覧のどのテストにも解決しなければ落とす（Issue #506）", () => {
  const t = baseTable();
  const r = run(t, { tests: namesOf(t).filter((n) => !n.includes("500 行なら送信される")) });
  expect(r.status).toBe(1);
  expect(r.stderr).toContain(
    '$.operations[1].pre_send.items[0].sides[0].covered_by: "export.spec.ts › 500 行なら送信される" が --tests の一覧のどのテストにも解決しない',
  );
});

test("表のどの欄の covered_by も解決の対象にする（欄を列挙せず表全体を歩く。Issue #506）", () => {
  const t = mutated(
    (x) => (x.operations[0].future_field = { covered_by: ["share.spec.ts › 無いテスト"] }),
  );
  const r = run(t, { tests: namesOf(baseTable()) });
  expect(r.status).toBe(1);
  expect(r.stderr).toContain(
    '$.operations[0].future_field.covered_by: "share.spec.ts › 無いテスト"',
  );
});

test("covered_by のテストが current / new の片側でしか走らなければ落とす（Issue #506）", () => {
  const t = baseTable();
  const r = run(t, { tests: testList(namesOf(t), ["current"]) });
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("が new プロジェクトで走らない");
});

test("1 つの名前が 2 本のテストに当たるなら曖昧として落とす（Issue #506）", () => {
  const t = mutated(
    (x) => (x.operations[0].layout.covered_by = ["layout.spec.ts › 高さ › 変わらない"]),
  );
  const list = testList(namesOf(t));
  // 題に区切りを含むトップレベルのテスト「高さ › 変わらない」が、describe「高さ」の中の「変わらない」と同じ名前になる
  list.suites
    .find((s) => s.file === "layout.spec.ts")
    .specs.push(
      ...["current", "new"].map((projectName) => ({
        title: "高さ › 変わらない",
        file: "layout.spec.ts",
        line: 9,
        column: 1,
        tests: [{ projectName, expectedStatus: "passed", annotations: [], results: [] }],
      })),
    );
  const r = run(t, { tests: list });
  expect(r.status).toBe(1);
  expect(r.stderr).toContain('"layout.spec.ts › 高さ › 変わらない" が 2 本のテストに当たり曖昧');
});

test("題の空の describe は名前に入らない（一覧表示と同じ。Issue #506）", () => {
  const t = mutated((x) => (x.operations[0].layout.covered_by = ["layout.spec.ts › 変わらない"]));
  const list = testList(namesOf(t).filter((n) => n !== "layout.spec.ts › 変わらない"));
  list.suites.push({
    title: "layout.spec.ts",
    file: "layout.spec.ts",
    line: 0,
    column: 0,
    specs: [],
    suites: [
      {
        title: "",
        file: "layout.spec.ts",
        line: 1,
        column: 1,
        suites: [],
        specs: ["current", "new"].map((projectName) => ({
          title: "変わらない",
          file: "layout.spec.ts",
          line: 2,
          column: 3,
          tests: [{ projectName, expectedStatus: "passed", annotations: [], results: [] }],
        })),
      },
    ],
  });
  const r = run(t, { tests: list });
  expect(r.stderr).toBe("");
  expect(r.status).toBe(0);
});

test("1 本のテストを 2 行が名乗るのに根拠の無い行があれば落とし、全行に根拠があれば通す（Issue #506）", () => {
  const r = run(
    mutated((x) => delete x.state_displays.pages[0].candidates.toast.shared_assertion_reason),
  );
  expect(r.status).toBe(1);
  expect(r.stderr).toContain(
    'テスト "share.spec.ts › コピーで通知が出て消える" を $.state_displays.pages[0].candidates.toast / $.operations[0].reactions[0] が covered_by に名乗っている',
  );
  expect(r.stderr).toContain("根拠が空: $.state_displays.pages[0].candidates.toast）");
  // 陽性コントロール: 同じ表で両方に根拠がある（baseTable）なら通る
  expect(run(baseTable()).status).toBe(0);
});

test("別の欄が同じテストを名乗る形も共有として数える（layout と returns_to。Issue #506）", () => {
  const r = run(
    mutated((x) => {
      x.operations[0].layout.covered_by = x.operations[0].aftermath.returns_to.covered_by;
    }),
  );
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("$.operations[0].layout / $.operations[0].aftermath.returns_to");
});

test("1 行の covered_by に同じ名前が 2 回あれば落とす（Issue #506）", () => {
  const r = run(
    mutated((x) => x.operations[0].layout.covered_by.push(x.operations[0].layout.covered_by[0])),
  );
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("$.operations[0].layout.covered_by: 同じ名前が 2 回ある");
});

test("--tests が無ければ使い方の誤りとして exit 2（Issue #506）", () => {
  const r = run(baseTable(), { args: ["--no-tests"] });
  expect(r.status).toBe(2);
  expect(r.stderr).toContain("--tests が無い");
});

test.each([
  [
    "読み込みエラーがある",
    { config: {}, suites: [], errors: [{ message: "SyntaxError" }] },
    "読み込みエラーが 1 件ある",
  ],
  ["テストが 0 件", { config: {}, suites: [], errors: [] }, "テストが 1 件も無い"],
  ["errors が無い", { config: {}, suites: [] }, "errors が配列でない"],
  ["suites が無い", { config: {}, errors: [] }, "suites が無い"],
])("--tests の一覧が使えなければ exit 2: %s（Issue #506）", (_name, list, message) => {
  const r = run(baseTable(), { tests: list });
  expect(r.status).toBe(2);
  expect(r.stderr).toContain(message);
});

test("assertion の深さの監査の記録が無ければ落とす（Issue #506）", () => {
  const r = run(baseTable(), { audit: false });
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("assertion_audit が無い");
});

test("監査の後に期待値を変えたら、監査の指紋で落とす（Issue #506）", () => {
  const t = baseTable();
  t.assertion_audit = passingAudit(t);
  // 期待値だけを変える（covered_by は同じ）。監査した時点の期待値に対する判定は、今の期待値には当たらない
  t.operations[0].reactions[0].description = "コピー完了のトーストと、押した行の番号";
  const r = run(t);
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("assertion_audit.table_fingerprint が表の内容と一致しない");
});

test.each([
  [
    "監査していない行がある",
    (a) => a.entries.splice(0, 1),
    "assertion_audit.entries に監査していない行がある: $.side_effect_writes.sites[0]",
  ],
  [
    "期待値に届いていない行がある",
    (a) =>
      Object.assign(a.entries[0], {
        verdict: "short",
        checked: null,
        missing: "書かれた行の値（種別 export）を確かめていない",
      }),
    "assertion が期待値に届いていない（書かれた行の値（種別 export）を確かめていない）",
  ],
  [
    "reaches なのに確かめた部分が空",
    (a) => (a.entries[0].checked = ""),
    "verdict: reaches なのに checked が空",
  ],
  ["語彙外の verdict", (a) => (a.entries[0].verdict = "ok"), "verdict が reaches / short でない"],
  [
    "covered_by を持たない行を監査した",
    (a) => a.entries.push({ ...a.entries[0], path: "$.operations[0]" }),
    "$.operations[0] は covered_by を持つ行でない",
  ],
  ["同じ行を 2 回監査した", (a) => a.entries.push({ ...a.entries[0] }), "が 2 回ある"],
  ["監査役が空", (a) => (a.auditor = ""), "assertion_audit.auditor が空"],
])("監査の記録の不備は落とす: %s（Issue #506）", (_name, mutate, message) => {
  const t = baseTable();
  t.assertion_audit = passingAudit(t);
  mutate(t.assertion_audit);
  const r = run(t);
  expect(r.status).toBe(1);
  expect(r.stderr).toContain(message);
});

test("--recorded は covered_by を解決した記録が無ければ落とす（Issue #506）", () => {
  const w = run(baseTable(), { args: ["--write"] });
  const path = join(w.dir, "reactions.json");
  const written = JSON.parse(readFileSync(path, "utf8"));
  written.conformance.covered_by_resolved = false;
  writeFileSync(path, JSON.stringify(written));
  const r = rerun(w.dir, ["--recorded"]);
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("conformance.covered_by_resolved が true でない");
});

test("--write は解決できない名前が残れば covered_by_resolved: false を記録する（Issue #506）", () => {
  const t = baseTable();
  const w = run(t, { args: ["--write"], tests: namesOf(t).slice(1) });
  expect(w.status).toBe(1);
  const written = JSON.parse(readFileSync(join(w.dir, "reactions.json"), "utf8"));
  expect(written.conformance.covered_by_resolved).toBe(false);
  expect(rerun(w.dir, ["--recorded"]).status).toBe(1);
});

test("--audit-sheet は監査の入力（期待値とテストの所在）を出し、監査の記録が無くても通る（Issue #506）", () => {
  const r = run(baseTable(), { args: ["--audit-sheet"], audit: false });
  expect(r.stderr).toBe("");
  expect(r.status).toBe(0);
  const out = JSON.parse(r.stdout);
  const toastEntry = out.entries.find((e) => e.path === "$.operations[0].reactions[0]");
  expect(toastEntry.tests).toEqual([
    { name: "share.spec.ts › コピーで通知が出て消える", file: "share.spec.ts", line: 3 },
  ]);
  // 期待値は covered_by と共有の根拠を除いた欄そのもの
  expect(toastEntry.expected).toMatchObject({ id: "toast", description: "コピー完了のトースト" });
  expect(toastEntry.expected).not.toHaveProperty("covered_by");
  expect(toastEntry.expected).not.toHaveProperty("shared_assertion_reason");
  expect(out.entries.map((e) => e.path)).toEqual(coveredByOwners(baseTable()).map((o) => o.path));
});

test("--audit-sheet は解決できない名前があれば exit 1（監査の土台にしない。Issue #506）", () => {
  const t = baseTable();
  const r = run(t, { args: ["--audit-sheet"], tests: namesOf(t).slice(1) });
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("が --tests の一覧のどのテストにも解決しない");
});

test("--audit-sheet は形の壊れた covered_by があれば exit 1（欠けた監査入力を ok として出さない。Issue #506）", () => {
  const r = run(
    mutated((x) => (x.operations[0].future_field = { covered_by: [""] })),
    {
      args: ["--audit-sheet"],
      audit: false,
    },
  );
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("$.operations[0].future_field.covered_by: 空でない文字列の配列でない");
  expect(JSON.parse(r.stdout).ok).toBe(false);
});

test("--audit-sheet は --write と同時に使えない（Issue #506）", () => {
  const r = run(baseTable(), { args: ["--audit-sheet", "--write"] });
  expect(r.status).toBe(2);
  expect(r.stderr).toContain("同時に使えない");
});

test.each([
  ["文字列", "share.spec.ts › 無いテスト"],
  ["空文字を含む配列", [""]],
  ["文字列以外を含む配列", [1, "share.spec.ts › 無いテスト"]],
])("未知の欄の形の壊れた covered_by は黙って捨てず落とす: %s（Issue #506）", (_name, value) => {
  const r = run(mutated((x) => (x.operations[0].future_field = { covered_by: value })));
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("$.operations[0].future_field.covered_by: 空でない文字列の配列でない");
});

test("covered_by が null・空配列の行は名乗らない行として通す（Issue #506）", () => {
  const r = run(
    mutated((x) => {
      x.operations[0].future_field = { covered_by: null };
      x.operations[1].future_field = { covered_by: [] };
    }),
  );
  expect(r.stderr).toBe("");
  expect(r.status).toBe(0);
});

test("_ で始まるキーの下の行も走査する（注記の文字列だけを飛ばす。Issue #506）", () => {
  const t = mutated(
    (x) => (x.operations[0]._draft = { covered_by: ["share.spec.ts › 無いテスト"] }),
  );
  const r = run(t, { tests: namesOf(baseTable()) });
  expect(r.status).toBe(1);
  expect(r.stderr).toContain('$.operations[0]._draft.covered_by: "share.spec.ts › 無いテスト"');
});

/** 監査の後にスペックの assertion を弱める（表は触らない）。 */
const weakenSpec = (dir) =>
  writeFileSync(
    join(dir, "share.spec.ts"),
    "// share.spec.ts\nexpect(page.getByText('Saved')).toBeVisible();\n",
  );

test("監査の後に covered_by のスペックの assertion を弱めたら落とす（表は同じ。Issue #506）", () => {
  const r = run(baseTable());
  expect(r.status).toBe(0);
  // 陽性コントロール: 何も変えずに取り直せば通る
  expect(rerun(r.dir).status).toBe(0);
  weakenSpec(r.dir);
  const after = rerun(r.dir);
  expect(after.status).toBe(1);
  expect(after.stderr).toContain(
    "assertion_audit.specs_fingerprint が今のスペックの中身と一致しない",
  );
});

test("--recorded もスペックの指紋を取り直し、--write の後に弱めたスペックを落とす（Issue #506）", () => {
  const w = run(baseTable(), { args: ["--write"] });
  expect(w.status).toBe(0);
  expect(rerun(w.dir, ["--recorded"]).status).toBe(0);
  weakenSpec(w.dir);
  const r = rerun(w.dir, ["--recorded"]);
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("assertion_audit.specs_fingerprint が今のスペックの中身と一致しない");
});

test("--recorded も --tests が無ければ exit 2（記録だけではスペックを取り直せない。Issue #506）", () => {
  const w = run(baseTable(), { args: ["--write"] });
  const r = rerun(w.dir, ["--recorded", "--no-tests"]);
  expect(r.status).toBe(2);
  expect(r.stderr).toContain("--tests が無い");
});

test("監査の記録にスペックの指紋が無ければ落とす（Issue #506）", () => {
  const t = baseTable();
  t.assertion_audit = { ...passingAudit(t), specs_fingerprint: "" };
  const r = run(t);
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("assertion_audit.specs_fingerprint が空");
});

test.each([
  ["無い", undefined],
  ["相対パス", "e2e"],
])("--tests の config.rootDir が %s なら exit 2（Issue #506）", (_name, rootDir) => {
  const t = baseTable();
  const list = testList(namesOf(t));
  list.config = rootDir === undefined ? {} : { rootDir };
  // run は rootDir が無ければ一時プロジェクトを入れるので、キーを持たせたうえで値を消す
  if (rootDir === undefined) list.config.rootDir = null;
  const r = run(t, { tests: list });
  expect(r.status).toBe(2);
  expect(r.stderr).toContain("config.rootDir が絶対パスでない");
});

test("covered_by のスペックを rootDir から読めなければ落とす（Issue #506）", () => {
  const t = baseTable();
  const list = testList(namesOf(t));
  const outer = makeTempDir("reaction-check-specs-");
  list.config.rootDir = outer;
  const r = run(t, { tests: list });
  expect(r.status).toBe(1);
  expect(r.stderr).toContain(`スペック export.spec.ts を一覧の rootDir（${outer}）から読めない`);
});

test("--audit-sheet はスペックの指紋を出し、それを写した監査の記録が通る（Issue #506）", () => {
  const sheet = run(baseTable(), { args: ["--audit-sheet"], audit: false });
  expect(sheet.status).toBe(0);
  const { specs_fingerprint: fp } = JSON.parse(sheet.stdout);
  expect(fp).toMatch(/^[0-9a-f]{64}$/);
  const t = baseTable();
  t.assertion_audit = { ...passingAudit(t), specs_fingerprint: fp };
  const r = run(t);
  expect(r.stderr).toBe("");
  expect(r.status).toBe(0);
});

test("covered_by のテストを片側で静的に飛ばす（test.skip / test.fixme）なら、その側では走らないものとして落とす（Issue #506）", () => {
  const t = baseTable();
  const list = testList(namesOf(t));
  const layoutSpec = list.suites.find((s) => s.file === "layout.spec.ts");
  for (const spec of layoutSpec.specs) {
    if (spec.tests[0].projectName === "new") {
      spec.tests[0].expectedStatus = "skipped";
      spec.tests[0].annotations = [{ type: "skip" }];
    }
  }
  const r = run(t, { tests: list });
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("が new プロジェクトで走らない");
  // 陽性コントロール: 同じ一覧で飛ばさなければ通る
  expect(run(t, { tests: testList(namesOf(t)) }).status).toBe(0);
});

test.each([
  ["失敗を期待する（failed）", "failed"],
  ["値が無い", undefined],
])(
  "covered_by のテストの expectedStatus が passed でない側は走らないものとして落とす: %s（Issue #506）",
  (_name, status) => {
    const t = baseTable();
    const list = testList(namesOf(t));
    const layoutSpec = list.suites.find((s) => s.file === "layout.spec.ts");
    for (const spec of layoutSpec.specs) {
      if (spec.tests[0].projectName === "new") {
        if (status === undefined) delete spec.tests[0].expectedStatus;
        else spec.tests[0].expectedStatus = status;
      }
    }
    const r = run(t, { tests: list });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("が new プロジェクトで走らない");
  },
);

test.each([
  [
    "共有の根拠",
    (t) =>
      (t.state_displays.pages[0].candidates.toast.shared_assertion_reason =
        "<covered_by のテストを別の行も名乗るときだけ、その 1 本がこの行の期待値も全て確かめている根拠>"),
    "根拠が空: $.state_displays.pages[0].candidates.toast）",
  ],
  [
    "監査役",
    (t) => (t.assertion_audit.auditor = "<監査した subagent（実装役と別の文脈で起動したもの）>"),
    "assertion_audit.auditor が空かテンプレートの説明文のまま",
  ],
  [
    "確かめた部分",
    (t) =>
      (t.assertion_audit.entries[0].checked =
        "<reaches のとき、期待値のどの部分をどの assertion が確かめているか>"),
    "verdict: reaches なのに checked が空かテンプレートの説明文のまま",
  ],
])(
  "根拠の欄をテンプレートの説明文のまま出したら落とす: %s（Codex レビュー #510）",
  (_name, mutate, message) => {
    const t = baseTable();
    t.assertion_audit = passingAudit(t);
    mutate(t);
    // 監査の指紋は根拠を書き換えた後の表で取り直す（指紋の不一致で落ちたのと区別する）
    t.assertion_audit.table_fingerprint = tableFingerprint(t);
    const r = run(t);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(message);
  },
);

test("同じ題で位置の違うテストは 1 本に畳まず曖昧として落とす（片側だけ走る 2 本を合算しない。Codex レビュー #510）", () => {
  const t = baseTable();
  const list = testList(namesOf(t));
  const layoutSpec = list.suites.find((s) => s.file === "layout.spec.ts");
  // 同じ名前の 2 本目を別の行に置き、1 本目は current だけ・2 本目は new だけで走らせる
  const first = layoutSpec.specs.filter(
    (sp) => sp.title === "条件を 2 回足した後も頁が窓に収まりグリッドが縮む",
  );
  for (const sp of first) {
    if (sp.tests[0].projectName === "new") sp.line = 9;
  }
  const r = run(t, { tests: list });
  expect(r.status).toBe(1);
  expect(r.stderr).toContain(
    '"layout.spec.ts › 条件を 2 回足した後も頁が窓に収まりグリッドが縮む" が 2 本のテストに当たり曖昧',
  );
});

test('区切りを含むキーの下の行は別の位置として監査させる（"a.b" と a.b を 1 件で満たさない。Codex レビュー #510）', () => {
  const t = mutated((x) => {
    x["a.b"] = { covered_by: ["layout.spec.ts › 操作の後も頁の高さが変わらない"] };
    x.a = { b: { covered_by: ["search.spec.ts › 絞り込んだ列の見出しが赤くなる"] } };
  });
  t.assertion_audit = passingAudit(t);
  // "a.b" の行だけ監査の記録から外す（位置が衝突すると、a.b の記録がこちらも満たしてしまう）
  t.assertion_audit.entries = t.assertion_audit.entries.filter((e) => e.path !== '$["a.b"]');
  const r = run(t);
  expect(r.status).toBe(1);
  expect(r.stderr).toContain('assertion_audit.entries に監査していない行がある: $["a.b"]');
});

test("--audit-sheet は操作・画面の中の行に、それを含む操作と画面の同定を添える（Codex レビュー #510）", () => {
  const r = run(baseTable(), { args: ["--audit-sheet"], audit: false });
  expect(r.status).toBe(0);
  const { entries } = JSON.parse(r.stdout);
  const byPath = (p) => entries.find((e) => e.path === p);
  const ctx = (p) => byPath(p).context;
  // 操作の中の行は操作の同定を持つ
  expect(ctx("$.operations[1].layout")[0]).toMatchObject({
    path: "$.operations[1]",
    fields: { id: "search", trigger: "clickButton(検索)" },
  });
  expect(ctx("$.operations[0].reactions[0]")[0].fields).toMatchObject({ id: "copy" });
  // 送る前の判定の境界の行は、操作に加えて親の判定の項目（id・kind・condition）も持つ
  const side = ctx("$.operations[1].pre_send.items[0].sides[0]");
  expect(side.map((c) => c.path)).toEqual([
    "$.operations[1]",
    "$.operations[1].pre_send",
    "$.operations[1].pre_send.items[0]",
  ]);
  expect(side[2].fields).toEqual({
    id: "max-rows",
    kind: "count-limit",
    condition: "選んだ行が 500 件を超える",
    on_block: "上限の通知を出して送信しない",
  });
  // 状態表示の行は画面名を持つ
  expect(ctx("$.state_displays.pages[0].candidates.toast")).toContainEqual({
    path: "$.state_displays.pages[0]",
    fields: { page: "共有画面" },
  });
  // 表の直下の欄の行（書き込みの箇所）は表そのものを祖先に載せない
  expect(ctx("$.side_effect_writes.sites[0]").map((c) => c.path)).toEqual(["$.side_effect_writes"]);
});

test.each([
  ["line が無い", (sp) => delete sp.line],
  ["column が無い", (sp) => delete sp.column],
  ["line が 0", (sp) => (sp.line = 0)],
  ["line が文字列", (sp) => (sp.line = "3")],
])(
  "--tests の spec の位置が %s なら exit 2（位置の無い同じ題のテストを畳まない。Codex レビュー #510）",
  (_name, mutate) => {
    const t = baseTable();
    const list = testList(namesOf(t));
    for (const sp of list.suites.find((s) => s.file === "layout.spec.ts").specs) mutate(sp);
    const r = run(t, { tests: list });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("に line / column（1 以上の整数）が無い");
  },
);

// --- 操作を持たない画面駆動の機能（Issue #503）---
// declared: false で表ごと省くと、表示だけの画面の状態表示（0 件・取得の失敗・読み込み中）を一度も測らずに完了・収束する。
// 画面駆動の機能は operations: [] と理由の表で振り分けさせ、改訂より前の declared: false だけを旧成果物として判定しない

/** 手順の改訂 4 以降の、操作を持たない画面駆動の機能の metadata.json。 */
const displayOnlyMeta = (patch = {}) => ({
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
    popup_inventory: [],
  },
  ...patch,
});

/** 表示だけの 1 画面の状態表示。0 件は撮る状態で押さえ、操作の反応を名乗る候補（トースト）は「ない」にする。 */
const displayOnlyRow = (page) => {
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
    observed: "トーストの器に何も出ない",
    covered_by: [`share.spec.ts › ${page}: 表示してもトーストが出ない`],
  };
  return row;
};

/** 操作を持たない画面駆動の機能の、全画面・全候補を振り分けた表。 */
const displayOnlyTable = () => {
  const t = baseTable();
  t.operations = [];
  t.operations_none_reason =
    "移行元の画面のテンプレートに押せる要素（ボタン・リンク・入力）が無く、実 UI でもフォーカスの移る要素が無い";
  t.observation_window_ms = null;
  t.feedback_calls = { declared: false, reason: "設定 current.feedback_calls が空と確認済み" };
  t.side_effect_writes = {
    declared: false,
    reason: "features.md の副作用出力に表への書き込みが無い",
  };
  t.state_displays = { pages: [displayOnlyRow("共有画面"), displayOnlyRow("履歴画面")] };
  return t;
};

test("操作を持たない画面駆動の機能で、全画面・全候補を振り分けた表は通る（Issue #503）", () => {
  const r = run(displayOnlyTable(), { metadata: displayOnlyMeta() });
  expect(r.stderr).toBe("");
  expect(r.status).toBe(0);
  expect(JSON.parse(r.stdout)).toMatchObject({
    judged: true,
    ok: true,
    operations: 0,
    state_displays: { pages: 2, entries: 10, unmeasured: 0 },
  });
});

test.each([
  [
    "画面を 1 つ振り分けていない",
    (t) => t.state_displays.pages.pop(),
    "画面 履歴画面 の状態表示を振り分けていない",
  ],
  [
    "候補を 1 つ振り分けていない",
    (t) => delete t.state_displays.pages[1].candidates.loading,
    "候補 loading を振り分けていない",
  ],
  ["状態表示の振り分けが無い", (t) => delete t.state_displays, "state_displays.pages が配列でない"],
])(
  "操作を持たない画面駆動の機能で、状態表示を振り分けていない表は落ちる: %s（Issue #503）",
  (_n, mutate, message) => {
    const t = displayOnlyTable();
    mutate(t);
    // スイートのテスト一覧は振り分けを消す前の表から作る（振り分けを消しても、画面のテストはスイートに残る）
    const r = run(t, { metadata: displayOnlyMeta(), tests: namesOf(displayOnlyTable()) });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(message);
  },
);

test.each([
  ["改訂 4", OPERATIONLESS_TABLE_REVISION],
  ["改訂 4 より後", OPERATIONLESS_TABLE_REVISION + 1],
])(
  "画面駆動の機能の declared: false は %s の成果物なら exit 2（表を作らせる。Issue #503）",
  (_n, revision) => {
    const metadata = displayOnlyMeta({
      run: { procedure_revision: revision },
      reaction_coverage: { declared: false, reason: "操作を持たない" },
      capture_conditions: { states: ["default"], pages: [{ name: "共有画面", path: "share" }] },
    });
    const r = run(displayOnlyTable(), { metadata });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("画面駆動の機能は reaction_coverage.declared: false を使えない");
  },
);

test.each([
  ["mode が無い", { mode: undefined }],
  ["mode が語彙外", { mode: "screen" }],
])(
  "画面駆動として扱う: %s の declared: false も改訂 4 以降なら exit 2（Issue #503）",
  (_n, patch) => {
    const metadata = displayOnlyMeta({
      reaction_coverage: { declared: false, reason: "操作を持たない" },
      capture_conditions: { states: ["default"] },
      ...patch,
    });
    const r = run(displayOnlyTable(), { metadata });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("画面駆動の機能は reaction_coverage.declared: false を使えない");
  },
);

test.each([
  [
    "改訂 4 より前",
    { procedure_revision: OPERATIONLESS_TABLE_REVISION - 1 },
    "run.procedure_revision: 3",
  ],
  ["改訂番号の導入前（キーが無い）", {}, "run.procedure_revision: 0"],
])(
  "画面駆動の機能の declared: false は %s の成果物なら旧手順として判定しない（Issue #503）",
  (_n, run_, shown) => {
    const metadata = displayOnlyMeta({
      run: run_,
      reaction_coverage: { declared: false, reason: "操作を持たない" },
      capture_conditions: { states: ["default"], popup_inventory: [] },
    });
    const r = run(displayOnlyTable(), { metadata });
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.judged).toBe(false);
    expect(out.reason).toContain("画面ごとの状態表示を振り分けていない");
    expect(out.reason).toContain(shown);
  },
);

test.each([
  ["文字列", "4"],
  ["負の数", -1],
  ["小数", 3.5],
])("run.procedure_revision が %s なら exit 2（旧成果物に倒さない。Issue #503）", (_n, revision) => {
  const metadata = displayOnlyMeta({
    run: { procedure_revision: revision },
    reaction_coverage: { declared: false, reason: "操作を持たない" },
    capture_conditions: { states: ["default"] },
  });
  const r = run(displayOnlyTable(), { metadata });
  expect(r.status).toBe(2);
  expect(r.stderr).toContain("run.procedure_revision が 0 以上の整数でない");
});

test.each([
  ["文字列", "4"],
  ["配列", []],
  ["null", null],
])("run が %s なら exit 2（改訂番号の導入前に倒さない。Issue #503）", (_n, runValue) => {
  const metadata = displayOnlyMeta({
    run: runValue,
    reaction_coverage: { declared: false, reason: "操作を持たない" },
    capture_conditions: { states: ["default"] },
  });
  const r = run(displayOnlyTable(), { metadata });
  expect(r.status).toBe(2);
  expect(r.stderr).toContain("run がオブジェクトでない");
});

test.each([["api-resource"], ["batch"]])(
  "%s モードの declared: false は改訂 4 以降でも従来どおり通す（画面を持たない。Issue #503）",
  (mode) => {
    const metadata = displayOnlyMeta({
      mode,
      reaction_coverage: { declared: false, reason: "画面を持たない" },
    });
    const r = run(displayOnlyTable(), { metadata });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({
      tool: "reaction-check",
      version: expect.any(String),
      judged: false,
      reason: "画面を持たない",
    });
  },
);

test.each([
  [
    "理由が無い",
    (t) => delete t.operations_none_reason,
    {},
    "operations が空なのに operations_none_reason が空",
  ],
  [
    "理由がテンプレートの説明文のまま",
    (t) =>
      (t.operations_none_reason = JSON.parse(
        readFileSync(
          new URL("../skills/parity-suite/assets/reactions-template.json", import.meta.url),
          "utf8",
        ),
      ).operations_none_reason),
    {},
    "operations が空なのに operations_none_reason が空",
  ],
  [
    "器の棚卸しが空でない",
    () => {},
    { popup_inventory: [{ name: "x" }] },
    "operations が空だが、操作の痕跡がある（capture_conditions.popup_inventory が空でない）",
  ],
  [
    "観測時間の下限が正の数でも null でもない",
    (t) => (t.observation_window_ms = 0),
    {},
    "observation_window_ms が正の数でない（none の観測時間の下限が無い。操作の無い表では null と書く）",
  ],
])("操作の無い表で %s なら落ちる（Issue #503）", (_n, mutate, ccPatch, message) => {
  const t = displayOnlyTable();
  mutate(t);
  const meta = displayOnlyMeta();
  meta.capture_conditions = { ...meta.capture_conditions, ...ccPatch };
  const r = run(t, { metadata: meta });
  expect(r.status).toBe(1);
  expect(r.stderr).toContain(message);
});

test("操作の無い表で部品被覆表を宣言していれば落ちる（操作の痕跡。Issue #503）", () => {
  const meta = displayOnlyMeta({
    component_coverage: { declared: true, path: "component-coverage.json" },
  });
  const r = run(displayOnlyTable(), { metadata: meta, coverage: coverageWith([]) });
  expect(r.status).toBe(1);
  expect(r.stderr).toContain(
    "operations が空だが、操作の痕跡がある（component_coverage.declared が true）",
  );
});

test("操作がある表の operations_none_reason は落ちる（Issue #503）", () => {
  const t = mutated((x) => (x.operations_none_reason = "操作が無い"));
  const r = run(t);
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("operations があるのに operations_none_reason が null でない");
});

test("操作がある表の observation_window_ms: null は落ちる（Issue #503）", () => {
  const r = run(mutated((x) => (x.observation_window_ms = null)));
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("observation_window_ms が正の数でない（none の観測時間の下限が無い）");
  expect(r.stderr).not.toContain("操作の無い表では null と書く");
});

test("操作の無い表も --write の後の --recorded で通り、振り分けを消すと落ちる（parity-diff の収束判定。Issue #503）", () => {
  const w = run(displayOnlyTable(), { metadata: displayOnlyMeta(), args: ["--write"] });
  expect(w.status).toBe(0);
  expect(rerun(w.dir, ["--recorded"]).status).toBe(0);
  const written = JSON.parse(readFileSync(join(w.dir, "reactions.json"), "utf8"));
  written.state_displays.pages.pop();
  writeFileSync(join(w.dir, "reactions.json"), JSON.stringify(written));
  const edited = rerun(w.dir, ["--recorded"]);
  expect(edited.status).toBe(1);
  expect(edited.stderr).toContain("画面 履歴画面 の状態表示を振り分けていない");
});

test("OPERATIONLESS_TABLE_REVISION は parity-suite の手順の改訂一覧に feature を対象として載っている（Issue #503）", () => {
  const revisions = JSON.parse(
    readFileSync(join(repoRoot, "skills/parity-suite/assets/procedure-revisions.json"), "utf8"),
  );
  const change = revisions.changes.find((c) => c.revision === OPERATIONLESS_TABLE_REVISION);
  expect(change).toBeDefined();
  expect(change.affects).toContain("feature");
  expect(revisions.revision).toBeGreaterThanOrEqual(OPERATIONLESS_TABLE_REVISION);
});
