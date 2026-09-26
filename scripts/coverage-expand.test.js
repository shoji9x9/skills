// 被覆プロファイル（parity-suite）の候補展開と照合の回帰テスト（Issue #286）。
//
// 塞ぐ穴: 被覆表は登録された項目しか数えないため、データグリッドで代表列だけを操作して
// 2 項目を登録すれば、他の列・非表示列・横スクロール先の列・コンテキストメニューは
// 期待セルにすら現れず、未測定 0 で収束できてしまう。
// 候補集合（列挙した構成要素から機械的に展開されるもの）と被覆集合の差分が残ることを確認する。
//
// 「新しい部品は共通処理と中心ドキュメントを変えずに足せる」ことも、
// 仮想部品のプロファイルを一時ディレクトリへ置いて照合させることで確認する。

import { test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fillSetProvenance } from "./lib/coverage-set-provenance-fixture.js";
import { makeTempDir } from "./lib/test-tmpdir.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repoRoot, "skills/parity-suite/scripts/coverage-expand.mjs");
const bundledProfiles = join(repoRoot, "skills/parity-suite/assets/coverage-profiles");
const {
  expandCandidates,
  fillVisualStateRows,
  fillVisualStates,
  loadProfiles,
  readCaptureConditions,
  readEnumeration,
  reconcile: reconcileRaw,
  validateProfile,
} = await import(script);

/**
 * 集合の来歴（component_inventory / instance_inventory / components[].source）を、
 * 宣言が無い fixture にだけ補ってから照合する。宣言そのものを見るテストは reconcileRaw を直接呼ぶ。
 * @param {unknown} coverage
 * @param {Map<string, Record<string, unknown>>} profiles
 * @param {{pageNames: string[], states: string[], popupStates: string[]} | null} [metadata]
 */
function reconcile(coverage, profiles, metadata = null) {
  return reconcileRaw(fillSetProvenance(coverage), profiles, metadata);
}

/**
 * 撮影状態の導出を「決め済み」にしてから返す。撮影状態の未決はこのファイルの被験対象ではないので、
 * 他の検査が撮影状態の problems に埋もれないよう、導いた行を全て captured で解決しておく。
 * 決め方そのものは deriveVisualStateRows / checkVisualStates の専用テストで見る。
 */
function resolveVisualStates(
  coverage,
  profiles = bundled,
  // 行は「要求元の操作 × 種別」なので、状態名も要求元ごとに分ける
  // （種別名だけを配ると opens-container の別々の器が同じ状態名を指してしまう）。
  decide = (row) => `${row.required_by}:${row.kind}`,
) {
  fillVisualStates(coverage, profiles);
  fillVisualStateRows(coverage);
  for (const row of coverage.visual_state_coverage.rows) row.captured = decide(row);
  return coverage;
}

/** 導いた行が要求する撮影状態名とページ名をそのまま metadata の撮影条件にしたもの。 */
function captureConditionsFor(coverage) {
  const rows = coverage.visual_state_coverage?.rows ?? [];
  const pageNames = [
    ...new Set(
      (coverage.components ?? []).flatMap((c) =>
        (c.instances ?? []).map((i) => i.page).filter(Boolean),
      ),
    ),
  ];
  return {
    pageNames,
    states: [...new Set(["default", ...rows.map((r) => r.captured).filter(Boolean)])],
    popupStates: [
      ...new Set(
        rows
          .filter((r) => r.kind === "opens-container")
          .map((r) => r.captured)
          .filter(Boolean),
      ),
    ],
  };
}

const { profiles: bundled, problems: bundledProblems } = loadProfiles(bundledProfiles);

test("同梱プロファイルはすべてスキーマ検証を通る（壊れたまま配布しない）", () => {
  expect(bundledProblems).toEqual([]);
  expect(bundled.size).toBeGreaterThanOrEqual(1);
  expect(bundled.has("datagrid")).toBe(true);
});

/** DataGrid の列挙（列 2・複数列の並べ替えの組 1・行を選ぶ手段 1・メニュー対象 1・メニュー項目 2・条件 1）。 */
function enumeration() {
  return {
    source: {
      kind: "current-source",
      ref: "src/grid/orderColumns.ts",
      version: "rev-abc123",
      extracted_at: "2026-09-03T00:00:00Z",
      condition: "columns 配列の全要素。hidden も含め、横スクロールを右端まで送って確認した",
    },
    complete: true,
    elements: {
      column: [
        {
          id: "price",
          flags: {
            initially_visible: true,
            toggleable: false,
            requires_horizontal_scroll: false,
            filterable: true,
            sortable: true,
          },
        },
        {
          id: "name",
          flags: {
            initially_visible: true,
            toggleable: false,
            requires_horizontal_scroll: false,
            filterable: false,
            sortable: true,
          },
        },
      ],
      "sort-combination": [{ id: "price-then-name", flags: {} }],
      "row-selector": [{ id: "row-number", flags: {} }],
      "menu-target": [{ id: "row", flags: { has_context_menu: true } }],
      "menu-item": [
        { id: "copy", flags: { enabled: true } },
        { id: "delete", flags: { enabled: true } },
      ],
      "menu-condition": [{ id: "default", flags: {} }],
    },
  };
}

/** 上の列挙から展開される全候補を present で埋めた被覆表。 */
function datagridCoverage() {
  const profile = bundled.get("datagrid");
  const { elements } = readEnumeration(enumeration(), profile, "t");
  const candidates = expandCandidates(profile, elements);
  return resolveVisualStates({
    slug: "order-list",
    components: [
      {
        id: "grid",
        profile: "datagrid",
        profile_version: "3",
        items: candidates.map((c) => ({
          id: c.id,
          category: c.rule,
          name: c.id,
          candidate: { rule: c.rule, axes: c.axes },
        })),
        instances: [
          {
            id: "orders",
            page: "受注一覧",
            locator: "orders.grid",
            enumeration: enumeration(),
            candidates: candidates.map((c) => c.id),
          },
        ],
      },
    ],
    cells: candidates.map((c) => ({
      component: "grid",
      item: c.id,
      instance: "orders",
      value: "present",
      evidence: "実 UI で操作し DOM 変化で発火を確認した",
      covered_by: [`e2e/order-list.spec.ts > ${c.id}`],
      unmeasured_reason: null,
    })),
  });
}

test("陽性コントロール: 候補が全てセルへ落ちていれば適合（常に落とす実装を弾く）", () => {
  const r = reconcile(datagridCoverage(), bundled);
  expect(r.problems).toEqual([]);
  expect(r.ok).toBe(true);
  // 列 2 の表示 ＋ price のフィルター ＋ 列 2 × 方向 3 のソート ＋ 複数列の並べ替え 1 組 × 先の列の向き 2 × 足した列の向き 3
  // ＋ 行の選択 1 手段 × 列 2 ＋ メニュー開閉 1 ＋ メニュー項目 2。
  // 初期非表示で表示切替できる列が無いので row-select-revealed は候補を生まない。
  expect(r.candidates).toBe(20);
  expect(r.unmeasured).toBe(0);
});

test("代表列だけを確認した被覆表は欠落として失敗する", () => {
  const cov = datagridCoverage();
  const c = cov.components[0];
  const keep = (id) => id.includes("/price");
  c.items = c.items.filter((i) => keep(i.id));
  c.instances[0].candidates = c.instances[0].candidates.filter(keep);
  cov.cells = cov.cells.filter((x) => keep(x.item));
  const r = reconcile(cov, bundled);
  expect(r.ok).toBe(false);
  expect(r.problems.join("\n")).toMatch(/候補 column-visible\/name に対応する項目が被覆表に無い/);
  expect(r.unmeasured).toBeGreaterThan(0);
});

test("インスタンス id に区切り文字が入ったら、余剰の誤検出ではなく id の問題として落とす", () => {
  // 候補キーは "<インスタンス id>/<候補 id>"。id に "/" が入ると前半と後半を切り分けられず、
  // 余剰判定が全項目を「候補集合に無い」と誤検出して原因の切り分けを誤らせる。
  const cov = datagridCoverage();
  const c = cov.components[0];
  c.instances[0].id = "admin/orders";
  for (const cell of cov.cells) cell.instance = "admin/orders";
  const r = reconcile(cov, bundled);
  expect(r.ok).toBe(false);
  expect(r.problems.join("\n")).toMatch(/id admin\/orders に "\/" を含む/);
});

test("インスタンス id の重複は先勝ちにせず問題として残す", () => {
  const cov = datagridCoverage();
  const c = cov.components[0];
  c.instances.push(structuredClone(c.instances[0]));
  const r = reconcile(cov, bundled);
  expect(r.ok).toBe(false);
  expect(r.problems.join("\n")).toMatch(/インスタンス id orders が重複している/);
});

test("コンテキストメニューの候補を欠落させた列挙は必須ルールで失敗する", () => {
  const cov = datagridCoverage();
  cov.components[0].instances[0].enumeration.elements["menu-item"] = [];
  const r = reconcile(cov, bundled);
  expect(r.ok).toBe(false);
  expect(r.problems.join("\n")).toMatch(/必須ルール context-menu-item の候補が 0 件/);
});

test("右クリック対象の列挙が空でもメニュー開閉の必須ルールで失敗する", () => {
  const cov = datagridCoverage();
  cov.components[0].instances[0].enumeration.elements["menu-target"] = [];
  const r = reconcile(cov, bundled);
  expect(r.problems.join("\n")).toMatch(/必須ルール context-menu-open の候補が 0 件/);
});

test("列挙した要素がどの候補にも現れなければ失敗する（フラグの記録漏れを落とす）", () => {
  const cov = datagridCoverage();
  const column = cov.components[0].instances[0].enumeration.elements.column[1];
  for (const key of Object.keys(column.flags)) column.flags[key] = false;
  const r = reconcile(cov, bundled);
  expect(r.problems.join("\n")).toMatch(/列挙した column の要素 name がどの候補にも現れない/);
});

test("セルの未測定・証拠なし・対応付けなしは候補由来の期待セルでも同じ規則で落ちる", () => {
  for (const [mutate, pattern] of [
    [(cell) => (cell.value = "unmeasured"), null],
    [(cell) => (cell.evidence = "  "), /evidence が空/],
    [(cell) => (cell.covered_by = []), /covered_by が空/],
  ]) {
    const cov = datagridCoverage();
    mutate(cov.cells[0]);
    const r = reconcile(cov, bundled);
    expect(r.ok).toBe(false);
    expect(r.unmeasured).toBe(1);
    if (pattern) expect(r.problems.join("\n")).toMatch(pattern);
  }
});

test("候補由来の非描画 absent も全状態の機械可読証拠を検査する", () => {
  const cov = datagridCoverage();
  cov.cells[0] = {
    ...cov.cells[0],
    value: "absent",
    covered_by: [],
    evidence: "全到達状態で非描画",
    absence_evidence: {
      kind: "non-renderable",
      locator: "getByRole('columnheader', { name: 'Price', includeHidden: true })",
      state_source: "datagrid profile と現行 UI",
      locator_includes_hidden: true,
      states_exhaustive: true,
      expected_states: ["desktop/default"],
      states: [
        {
          name: "desktop/default",
          transition: "右端までスクロールする",
          locator_match_count: 1,
          bounding_box: { x: 0, y: 0, width: 0, height: 20 },
          offset_parent: null,
          hidden_by: null,
        },
      ],
    },
  };
  cov.components[0].instances[0].applicable_states = {
    source: {
      kind: "current-source",
      ref: "src/grid/states.json",
      version: "rev-abc123",
      condition: "desktop の全状態",
    },
    complete: true,
    items: [{ id: "desktop/default", transition: "右端までスクロールする" }],
  };
  expect(reconcile(cov, bundled)).toMatchObject({ ok: true, unmeasured: 0 });

  delete cov.cells[0].absence_evidence.states[0].offset_parent;
  const invalid = reconcile(cov, bundled);
  expect(invalid).toMatchObject({ ok: false, unmeasured: 1 });
  expect(invalid.problems.join("\n")).toMatch(/offset_parent/);

  const visibleStyle = datagridCoverage();
  visibleStyle.cells[0] = structuredClone(cov.cells[0]);
  visibleStyle.cells[0].absence_evidence.states[0].offset_parent = null;
  visibleStyle.cells[0].absence_evidence.states[0].bounding_box = {
    x: 0,
    y: 0,
    width: 10,
    height: 20,
  };
  visibleStyle.cells[0].absence_evidence.states[0].hidden_by = {
    target_locator: "getByRole('columnheader', { name: 'Price', includeHidden: true })",
    locator: "#price",
    relation: "self",
    relationship_verified: true,
    computed_style: { display: "block", color: "red" },
  };
  visibleStyle.components[0].instances[0].applicable_states = structuredClone(
    cov.components[0].instances[0].applicable_states,
  );
  expect(reconcile(visibleStyle, bundled).problems.join("\n")).toMatch(/非表示 CSS/);

  const duplicateState = datagridCoverage();
  duplicateState.cells[0] = structuredClone(cov.cells[0]);
  duplicateState.cells[0].absence_evidence.states[0].offset_parent = null;
  duplicateState.components[0].instances[0].applicable_states = structuredClone(
    cov.components[0].instances[0].applicable_states,
  );
  duplicateState.cells[0].absence_evidence.expected_states.push("desktop/default");
  expect(reconcile(duplicateState, bundled).problems.join("\n")).toMatch(/expected_states が重複/);

  const unrelatedHidden = datagridCoverage();
  unrelatedHidden.cells[0] = structuredClone(cov.cells[0]);
  unrelatedHidden.cells[0].absence_evidence.states[0].bounding_box = null;
  unrelatedHidden.cells[0].absence_evidence.states[0].offset_parent = null;
  unrelatedHidden.cells[0].absence_evidence.states[0].hidden_by = {
    target_locator: "other-locator",
    locator: "#other",
    relation: "ancestor",
    relationship_verified: true,
    computed_style: { display: "none" },
  };
  unrelatedHidden.components[0].instances[0].applicable_states = structuredClone(
    cov.components[0].instances[0].applicable_states,
  );
  expect(reconcile(unrelatedHidden, bundled).problems.join("\n")).toMatch(/検証済み関係/);

  // 実在しない矩形（負値・非有限）で 0 寸法判定を迂回させない
  for (const [field, value, pattern] of [
    ["width", -1, /負（実在しない矩形）/],
    ["height", -0.5, /負（実在しない矩形）/],
    ["x", Number.NaN, /有限の数値ではない/],
    ["y", Number.POSITIVE_INFINITY, /有限の数値ではない/],
  ]) {
    const badBox = datagridCoverage();
    badBox.cells[0] = structuredClone(cov.cells[0]);
    badBox.cells[0].absence_evidence.states[0].offset_parent = null;
    badBox.cells[0].absence_evidence.states[0].bounding_box[field] = value;
    badBox.components[0].instances[0].applicable_states = structuredClone(
      cov.components[0].instances[0].applicable_states,
    );
    const r = reconcile(badBox, bundled);
    expect(r).toMatchObject({ ok: false, unmeasured: 1 });
    expect(r.problems.join("\n")).toMatch(pattern);
  }

  // display: none の本人／祖先配下では実 DOM の offsetParent は必ず null
  const displayNoneConflict = datagridCoverage();
  displayNoneConflict.cells[0] = structuredClone(cov.cells[0]);
  displayNoneConflict.cells[0].absence_evidence.states[0].bounding_box = null;
  displayNoneConflict.cells[0].absence_evidence.states[0].offset_parent = "#visible-parent";
  displayNoneConflict.cells[0].absence_evidence.states[0].hidden_by = {
    target_locator: "getByRole('columnheader', { name: 'Price', includeHidden: true })",
    locator: "#price",
    relation: "self",
    relationship_verified: true,
    computed_style: { display: "none" },
  };
  displayNoneConflict.components[0].instances[0].applicable_states = structuredClone(
    cov.components[0].instances[0].applicable_states,
  );
  expect(reconcile(displayNoneConflict, bundled).problems.join("\n")).toMatch(
    /display: none なのに offset_parent/,
  );

  // visibility 経路まで巻き込まない（offsetParent は残るため非 null が正当）
  const visibilityHidden = structuredClone(displayNoneConflict);
  visibilityHidden.cells[0].absence_evidence.states[0].hidden_by.computed_style = {
    visibility: "hidden",
  };
  expect(reconcile(visibilityHidden, bundled)).toMatchObject({ ok: true, unmeasured: 0 });

  // 新たに受理する入力クラス: 一部の状態で DOM に無い候補（1 件の状態が残っていれば通る）
  const partiallyAbsent = datagridCoverage();
  partiallyAbsent.cells[0] = structuredClone(cov.cells[0]);
  partiallyAbsent.cells[0].absence_evidence.states[0].offset_parent = null;
  partiallyAbsent.cells[0].absence_evidence.expected_states.push("mobile/default");
  partiallyAbsent.cells[0].absence_evidence.states.push({
    name: "mobile/default",
    transition: "mobile viewport へ切り替える",
    locator_match_count: 0,
    bounding_box: null,
    offset_parent: null,
    hidden_by: null,
  });
  partiallyAbsent.components[0].instances[0].applicable_states = structuredClone(
    cov.components[0].instances[0].applicable_states,
  );
  partiallyAbsent.components[0].instances[0].applicable_states.items.push({
    id: "mobile/default",
    transition: "mobile viewport へ切り替える",
  });
  expect(reconcile(partiallyAbsent, bundled)).toMatchObject({ ok: true, unmeasured: 0 });

  // locator が対象を一意に引けていない記録・矛盾した 0 件記録は未測定へ倒す
  for (const [mutate, pattern] of [
    [(e) => (e.states[0].locator_match_count = 2), /一意に引けていない/],
    [(e) => delete e.states[0].locator_match_count, /locator_match_count/],
    [(e) => (e.states[0].locator_match_count = -1), /locator_match_count/],
    [(e) => delete e.locator_includes_hidden, /locator_includes_hidden/],
    [(e) => (e.locator_includes_hidden = false), /locator_includes_hidden/],
    // hidden_by のキーごとの省略は、明示的な null と区別して証拠の欠落として扱う
    [(e) => delete e.states[0].hidden_by, /hidden_by が null または JSON オブジェクトではない/],
    // 0 件（DOM に無い）なのに矩形が残っている矛盾
    [(e) => (e.states[0].locator_match_count = 0), /0 件なのに/],
    // 全状態 0 件では locator の正しさを実証できていない
    [
      (e) => {
        e.states[0].locator_match_count = 0;
        e.states[0].bounding_box = null;
        e.states[0].offset_parent = null;
        e.states[0].hidden_by = null;
      },
      /どの状態でも 0 件/,
    ],
  ]) {
    const badLocator = datagridCoverage();
    badLocator.cells[0] = structuredClone(cov.cells[0]);
    badLocator.cells[0].absence_evidence.states[0].offset_parent = null;
    badLocator.components[0].instances[0].applicable_states = structuredClone(
      cov.components[0].instances[0].applicable_states,
    );
    mutate(badLocator.cells[0].absence_evidence);
    const r = reconcile(badLocator, bundled);
    expect(r).toMatchObject({ ok: false, unmeasured: 1 });
    expect(r.problems.join("\n")).toMatch(pattern);
  }

  // 語彙外の source.kind は出所不明として未測定に倒す（非空判定だけでは通ってしまう）
  for (const kind of ["invented", "config"]) {
    const inventedSource = datagridCoverage();
    inventedSource.cells[0] = structuredClone(cov.cells[0]);
    inventedSource.cells[0].absence_evidence.states[0].offset_parent = null;
    inventedSource.components[0].instances[0].applicable_states = structuredClone(
      cov.components[0].instances[0].applicable_states,
    );
    inventedSource.components[0].instances[0].applicable_states.source.kind = kind;
    const r = reconcile(inventedSource, bundled);
    expect(r).toMatchObject({ ok: false, unmeasured: 1 });
    expect(r.problems.join("\n")).toMatch(/applicable_states\.source\.kind/);
  }

  // 語彙内の 4 種はいずれも通る（allowlist を空にする変異で赤くなる）
  for (const kind of ["profile", "vendor-spec", "current-source", "app-ui"]) {
    const allowed = datagridCoverage();
    allowed.cells[0] = structuredClone(cov.cells[0]);
    allowed.cells[0].absence_evidence.states[0].offset_parent = null;
    allowed.components[0].instances[0].applicable_states = structuredClone(
      cov.components[0].instances[0].applicable_states,
    );
    allowed.components[0].instances[0].applicable_states.source.kind = kind;
    expect(reconcile(allowed, bundled)).toMatchObject({ ok: true, unmeasured: 0 });
  }
});

test("候補由来の fired-without-response も送り方・発火確認・観測結果を構造化して検査する", () => {
  const firedEvidence = () => ({
    kind: "fired-without-response",
    action: {
      locator: "getByTestId('grid-cell-1-1')",
      method: "coordinate",
      detail: "page.mouse.click(x, y, { button: 'right' })",
      bounding_box: { x: 10, y: 20, width: 120, height: 32 },
      visible: true,
      actionability_bypassed: false,
      hit_test_target: "getByTestId('grid-cell-1-1')",
      hit_test_is_target_or_descendant: true,
    },
    fired: { signal: "event-listener", detail: "contextmenu リスナで受信した", verified: true },
    observation: "メニューが開かず DOM も変化しなかった",
  });
  const base = () => {
    const c = datagridCoverage();
    c.cells[0] = {
      ...c.cells[0],
      value: "absent",
      covered_by: [],
      evidence: "右クリックしても応答が無い",
      absence_evidence: firedEvidence(),
    };
    return c;
  };
  // 陽性コントロール: 実測が揃えば absent として通る
  expect(reconcile(base(), bundled)).toMatchObject({ ok: true, unmeasured: 0 });

  for (const [mutate, pattern] of [
    [(e) => delete e.action, /fired-without-response/],
    [(e) => (e.action.method = "guess"), /action\.method/],
    // 型崩れが allowlist を通ると、coordinate 専用の hit-test 検査を回避できる
    [(e) => (e.action.method = ["coordinate"]), /action\.method/],
    [(e) => (e.fired.signal = ["event-listener"]), /fired\.signal/],
    [(e) => (e.action.bounding_box.width = 0), /幅・高さが正ではない/],
    [(e) => (e.action.hit_test_is_target_or_descendant = false), /hit-test/],
    [(e) => (e.fired.verified = false), /発火確認/],
    [(e) => (e.action.visible = false), /action\.visible/],
    [(e) => (e.action.actionability_bypassed = true), /actionability_bypassed/],
    [(e) => (e.observation = "  "), /observation/],
  ]) {
    const cov = base();
    mutate(cov.cells[0].absence_evidence);
    const r = reconcile(cov, bundled);
    expect(r).toMatchObject({ ok: false, unmeasured: 1 });
    expect(r.problems.join("\n")).toMatch(pattern);
  }
});

test("プロファイルを宣言しない部品のセルも候補経路と同じ規則で採点する", () => {
  // 記録側だけ通る表を作らない。片方だけ検査すると conformance.ok を出した表を収束側が弾く
  const generic = () => ({
    feature: "order-list",
    visual_state_coverage: { rows: [] },
    components: [
      {
        id: "grid",
        profile: null,
        profile_absent_reason: "適合プロファイルが無い",
        items: [
          {
            id: "ctx-menu",
            visual_states: [],
            no_visual_state_reason: "撮影状態の導出はこのテストの被験対象ではない",
          },
        ],
        instances: [{ id: "orders" }],
      },
    ],
    cells: [
      {
        component: "grid",
        item: "ctx-menu",
        instance: "orders",
        value: "absent",
        covered_by: [],
        evidence: "全状態で非表示",
        absence_evidence: { kind: "non-renderable" },
      },
    ],
  });

  const broken = reconcile(generic(), bundled);
  expect(broken).toMatchObject({ ok: false, unmeasured: 1 });
  expect(broken.problems.join("\n")).toMatch(/non-renderable/);

  for (const [mutate, pattern] of [
    [(c) => (c.cells = []), /セルが無い/],
    [(c) => (c.cells[0].evidence = "  "), /evidence が空/],
    [(c) => c.cells.push(structuredClone(c.cells[0])), /セル行が複数ある/],
    [
      (c) => {
        c.cells[0].value = "present";
        c.cells[0].absence_evidence = null;
      },
      /covered_by が空/,
    ],
  ]) {
    const cov = generic();
    mutate(cov);
    const r = reconcile(cov, bundled);
    expect(r.ok).toBe(false);
    expect(r.problems.join("\n")).toMatch(pattern);
  }

  // 陽性コントロール: 正しく測れていれば通る（常に落とす実装を弾く）
  const good = generic();
  good.cells[0].value = "present";
  good.cells[0].covered_by = ["e2e/parity/order-list.spec.ts > ctx menu"];
  good.cells[0].absence_evidence = null;
  expect(reconcile(good, bundled)).toMatchObject({ ok: true, unmeasured: 0 });

  // id が空・重複の要素は黙って読み飛ばさず、その要素が関わるセルを未測定として数える
  // （読み飛ばすと、識別できない要素があるのに conformance.ok: true を出せる）
  for (const [mutate, pattern] of [
    [(c) => c.components[0].items.push({ name: "id が無い" }), /items\[1\]: id が空/],
    [(c) => c.components[0].items.push({ id: "ctx-menu" }), /items\[1\]: id ctx-menu が重複/],
    [(c) => c.components[0].instances.push({ page: "id が無い" }), /instances\[1\]: id が空/],
    [(c) => c.components[0].instances.push({ id: "orders" }), /instances\[1\]: id orders が重複/],
  ]) {
    const cov = structuredClone(good);
    mutate(cov);
    const r = reconcile(cov, bundled);
    expect(r).toMatchObject({ ok: false });
    expect(r.unmeasured).toBeGreaterThan(0);
    expect(r.problems.join("\n")).toMatch(pattern);
  }
});

test("列挙が未完了なら候補ゼロで素通りせず、理由も必須", () => {
  const cov = datagridCoverage();
  cov.components[0].instances[0].enumeration.complete = false;
  expect(reconcile(cov, bundled).problems.join("\n")).toMatch(/incomplete_reason が空/);
  cov.components[0].instances[0].enumeration.incomplete_reason =
    "グリッド定義が動的生成で追えない。実 UI から列表示切替を全て開いて列挙する手順が要る";
  const r = reconcile(cov, bundled);
  expect(r.ok).toBe(false);
  expect(r.problems.join("\n")).toMatch(/列挙が未完了/);
});

test("必須ルールの候補ゼロは justified_absences の根拠付きでだけ通す（行き止まりにしない）", () => {
  const cov = datagridCoverage();
  const inst = cov.components[0].instances[0];
  // 右クリックメニューを一切持たないグリッド。列挙は済ませたうえで対象が 0 件。
  for (const axis of ["menu-target", "menu-item", "menu-condition"]) {
    inst.enumeration.elements[axis] = [];
  }
  const keep = (id) => !id.startsWith("context-menu-");
  cov.components[0].items = cov.components[0].items.filter((i) => keep(i.id));
  inst.candidates = inst.candidates.filter(keep);
  cov.cells = cov.cells.filter((c) => keep(c.item));
  // 測る操作を削ったので撮影状態の要求も変わる。導出し直さないと古い行が残り、
  // このテストの被験対象（必須ルールの免除）と無関係な problem が混ざる。
  resolveVisualStates(cov);

  // 根拠が無ければ「列挙していない」と区別できないので落とす。
  const bare = reconcile(cov, bundled);
  expect(bare.ok).toBe(false);
  expect(bare.problems.join("\n")).toMatch(/必須ルール context-menu-open の候補が 0 件/);

  // 根拠を書けば通る。フラグを偽って true にする以外の逃げ道が要る。
  inst.enumeration.justified_absences = [
    {
      scope: "menu-target",
      reason:
        "データ行・列ヘッダ・空白領域のいずれで右クリックしてもメニューが出ないことを実 UI で確認した",
    },
  ];
  expect(reconcile(cov, bundled).problems).toEqual([]);

  // 根拠が空なら通さない。
  inst.enumeration.justified_absences = [{ scope: "menu-target", reason: "  " }];
  expect(reconcile(cov, bundled).problems.join("\n")).toMatch(/reason が空/);
});

test("行の選択・複数列の並べ替えを持たないグリッドは、列挙が空でも根拠付きでだけ通す（Issue #471）", () => {
  // 終えた後に残る見た目（選択の塗り・複数列の並べ替えの印）は、軸を列挙しないと候補にすら現れない。
  // 空の列挙を「その部品には無い」と区別できない形で通さないため、必須ルールにして根拠を求める。
  for (const [axis, rule, label] of [
    ["row-selector", "row-select", "row-select / row-select-revealed"],
    ["sort-combination", "multi-column-sort", "multi-column-sort"],
  ]) {
    const cov = datagridCoverage();
    const inst = cov.components[0].instances[0];
    inst.enumeration.elements[axis] = [];
    const keep = (id) => !id.startsWith(`${rule}/`);
    cov.components[0].items = cov.components[0].items.filter((i) => keep(i.id));
    inst.candidates = inst.candidates.filter(keep);
    cov.cells = cov.cells.filter((c) => keep(c.item));
    resolveVisualStates(cov);

    const bare = reconcile(cov, bundled);
    expect(bare.ok).toBe(false);
    expect(bare.problems.join("\n")).toContain(`必須ルール ${label} の候補が 0 件`);

    inst.enumeration.justified_absences = [
      {
        scope: axis,
        reason:
          "行番号・チェックボックス・修飾キー付きのクリックを実 UI で試し、効かないことを確かめた",
      },
    ];
    expect(reconcile(cov, bundled).problems).toEqual([]);
  }
});

test("必須ルールの代替の組は、どれか 1 つが候補を生めば満たす（全列が初期非表示のグリッド。Codex レビュー）", () => {
  // 全列が初期非表示で表示切替できるグリッドは row-select の候補を生まず、row-select-revealed だけが立つ。
  // 行を選ぶ手段も列も実在するので justified_absences では通せない——組にしないと行き止まりになる。
  const profile = bundled.get("datagrid");
  const cov = datagridCoverage();
  const inst = cov.components[0].instances[0];
  for (const col of inst.enumeration.elements.column) {
    col.flags.initially_visible = false;
    col.flags.toggleable = true;
  }
  const { elements } = readEnumeration(inst.enumeration, profile, "t");
  const candidates = expandCandidates(profile, elements);
  expect(candidates.some((c) => c.rule === "row-select")).toBe(false);
  expect(candidates.some((c) => c.rule === "row-select-revealed")).toBe(true);
  const c = cov.components[0];
  c.items = candidates.map((x) => ({
    id: x.id,
    category: x.rule,
    name: x.id,
    candidate: { rule: x.rule, axes: x.axes },
  }));
  inst.candidates = candidates.map((x) => x.id);
  cov.cells = candidates.map((x) => ({
    component: "grid",
    item: x.id,
    instance: "orders",
    value: "present",
    evidence: "実 UI で列を出してから操作し、DOM 変化で発火を確認した",
    covered_by: [`e2e/order-list.spec.ts > ${x.id}`],
    unmeasured_reason: null,
  }));
  resolveVisualStates(cov);
  const r = reconcile(cov, bundled);
  // 残る問題は column-visible の候補 0 件だけであることを固定する。これは本 Issue 以前（datagrid v2）からの制約で、
  // 全列が初期非表示のグリッドは column-visible を満たせない（v2 でも同じく落ちることを実測した。回帰ではない）。
  // 列の表示を代替の組にする案は、column-toggle と guard が排他でなく組にできないため見送った（PR #482）
  expect(r.problems).toHaveLength(1);
  expect(r.problems[0]).toContain("必須ルール column-visible の候補が 0 件");
});

test("代替の組の全てのルールが候補 0 件なら、全てに根拠が要る（1 つだけの根拠では通さない）", () => {
  // row-select-revealed の軸を column だけにした版。row-selector を根拠付きで空にしても、
  // row-select-revealed は column が実在するので根拠にならず、組として列挙漏れと区別できない。
  const dg = structuredClone(bundled.get("datagrid"));
  dg.candidate_rules.find((r) => r.id === "row-select-revealed").axes = ["column"];
  const profiles = new Map(bundled);
  profiles.set("datagrid", dg);
  const cov = datagridCoverage();
  const inst = cov.components[0].instances[0];
  inst.enumeration.elements["row-selector"] = [];
  inst.enumeration.justified_absences = [
    {
      scope: "row-selector",
      reason: "行番号・チェックボックス・行のクリックを実 UI で試し、行を選べないことを確かめた",
    },
  ];
  const keep = (id) => !id.startsWith("row-select/");
  cov.components[0].items = cov.components[0].items.filter((i) => keep(i.id));
  inst.candidates = inst.candidates.filter(keep);
  cov.cells = cov.cells.filter((c) => keep(c.item));
  resolveVisualStates(cov);
  expect(reconcile(cov, profiles).problems.join("\n")).toContain(
    "必須ルール row-select / row-select-revealed の候補が 0 件",
  );
});

test("required_rules の代替の組の形を検査する", () => {
  const profile = structuredClone(bundled.get("datagrid"));
  expect(validateProfile(profile, "d.json")).toEqual([]);
  const rule = (p, id) => p.candidate_rules.find((r) => r.id === id);
  for (const [bad, pattern, tweak] of [
    [[[]], /空の要素・空の代替の組/],
    [[["row-select", ""]], /空の要素・空の代替の組/],
    [[["row-select", "nope"]], /未定義のルール nope/],
    [["row-select", ["row-select", "row-select-revealed"]], /ルール row-select が 2 回以上現れる/],
    [
      [["column-visible", "context-menu-open"]],
      /代替の組 column-visible \/ context-menu-open の axes が揃っていない/,
    ],
    // 軸が揃い guard が排他でも、同じ要求だと宣言していないルールは組にできない（Codex レビュー）
    [
      [["column-visible", "column-filter"]],
      /代替の組 column-visible \/ column-filter の requirement が揃っていない/,
      (p) => (rule(p, "column-filter").guard["column.initially_visible"] = false),
    ],
    // requirement を揃えても guard が排他でなければ落とす
    [
      [["column-visible", "column-filter"]],
      /column-visible と column-filter の guard が排他でない/,
      (p) => {
        rule(p, "column-visible").requirement = "x";
        rule(p, "column-filter").requirement = "x";
      },
    ],
  ]) {
    const p = structuredClone(profile);
    p.required_rules = bad;
    tweak?.(p);
    expect(validateProfile(p, "d.json").join("\n")).toMatch(pattern);
  }
});

test("初期非表示で表示切替できる列にも、行の選択の塗りの候補が立つ（Issue #471 レビュー）", () => {
  // 列を出してから行を選ぶ経路。初期表示の列だけを候補にすると、出した列の塗りの差が撮られない。
  const profile = bundled.get("datagrid");
  const en = enumeration();
  en.elements.column.push({
    id: "memo",
    flags: {
      initially_visible: false,
      toggleable: true,
      requires_horizontal_scroll: false,
      filterable: false,
      sortable: false,
    },
  });
  const { elements } = readEnumeration(en, profile, "t");
  const ids = expandCandidates(profile, elements).map((c) => c.id);
  expect(ids).toContain("row-select-revealed/row-number/memo");
  // 初期表示の列は row-select 側だけに立つ（同じ列が 2 つのルールで二重に数えられない）
  expect(ids).not.toContain("row-select/row-number/memo");
  expect(ids.filter((id) => id.startsWith("row-select-revealed/"))).toEqual([
    "row-select-revealed/row-number/memo",
  ]);
});

test("要素が候補にならないことも根拠付きでだけ通す（要素スコープの免除）", () => {
  const cov = datagridCoverage();
  const inst = cov.components[0].instances[0];
  const column = inst.enumeration.elements.column[1];
  for (const key of Object.keys(column.flags)) column.flags[key] = false;
  const keep = (id) => !id.includes("/name");
  cov.components[0].items = cov.components[0].items.filter((i) => keep(i.id));
  inst.candidates = inst.candidates.filter(keep);
  cov.cells = cov.cells.filter((c) => keep(c.item));
  // 測る候補を削ったので撮影状態の要求も変わる。導出し直さないと古い行が余剰として残り、
  // このテストの被験対象（要素スコープの免除）と無関係な problem が混ざる。
  resolveVisualStates(cov);
  expect(reconcile(cov, bundled).problems.join("\n")).toMatch(/要素 name がどの候補にも現れない/);
  inst.enumeration.justified_absences = [
    {
      scope: "column/name",
      reason: "定義に在るが表示・操作のいずれも有効でないことを実 UI で確認した",
    },
  ];
  expect(reconcile(cov, bundled).problems).toEqual([]);
});

test("使われない justified_absences は残さない（古い免除が効いて見える状態を作らない）", () => {
  const cov = datagridCoverage();
  cov.components[0].instances[0].enumeration.justified_absences = [
    { scope: "column/price", reason: "もう成り立たない根拠" },
  ];
  expect(reconcile(cov, bundled).problems.join("\n")).toMatch(
    /justified_absences の column\/price は効いていない/,
  );
});

test("軸に要素が在るのに軸ごとの免除は使えない（要素ごとの根拠を要求する）", () => {
  const cov = datagridCoverage();
  cov.components[0].instances[0].enumeration.justified_absences = [
    { scope: "column", reason: "列は見ない" },
  ];
  expect(reconcile(cov, bundled).problems.join("\n")).toMatch(
    /軸ごとの免除は使えない（要素ごとの scope にする）/,
  );
});

test("列挙できないインスタンスがあるとき余剰は判定しない（本当の原因を覆い隠さない）", () => {
  const cov = datagridCoverage();
  cov.components[0].instances[0].enumeration.complete = false;
  cov.components[0].instances[0].enumeration.incomplete_reason = "列定義が動的生成で追えない";
  const joined = reconcile(cov, bundled).problems.join("\n");
  expect(joined).toMatch(/列挙が未完了/);
  expect(joined).not.toMatch(/余剰/);
});

test("来歴（enumeration.source）の欠落は失敗させる", () => {
  const cov = datagridCoverage();
  delete cov.components[0].instances[0].enumeration.source.condition;
  expect(reconcile(cov, bundled).problems.join("\n")).toMatch(/source.condition が空/);
});

test("profile キーの欠落は暗黙の汎用扱いにせず失敗させる", () => {
  const cov = datagridCoverage();
  delete cov.components[0].profile;
  expect(reconcile(cov, bundled).problems.join("\n")).toMatch(/profile キーが無い/);
});

test("適合プロファイルが無い部品は理由付きで未検証として記録される", () => {
  const withReason = {
    slug: "order-list",
    visual_state_coverage: { rows: [] },
    components: [
      {
        id: "chart",
        profile: null,
        profile_absent_reason: "Chart のプロファイルが未整備。gaps.md の未検証領域に記録した",
        items: [
          {
            id: "zoom",
            visual_states: [],
            no_visual_state_reason: "撮影状態の導出はこのテストの被験対象ではない",
          },
        ],
        instances: [{ id: "dashboard" }],
      },
    ],
    cells: [
      {
        component: "chart",
        item: "zoom",
        instance: "dashboard",
        value: "present",
        evidence: "ホイールで拡大できる",
        covered_by: ["e2e/parity/dashboard.spec.ts > zoom"],
      },
    ],
  };
  const ok = reconcile(withReason, bundled);
  expect(ok.problems).toEqual([]);
  expect(ok.components[0]).toMatchObject({ component: "chart", profile: null, judged: false });
  // 理由が無ければ免除しない。
  const noReason = structuredClone(withReason);
  delete noReason.components[0].profile_absent_reason;
  expect(reconcile(noReason, bundled).problems.join("\n")).toMatch(/profile_absent_reason が空/);
});

test("列挙が空・部品 id の重複・宣言に無い行は記録側でも fail-closed にする", () => {
  // いずれも判定側（coverage-check.mjs）が弾く条件。記録側だけ通ると conformance.ok が意味を失う。
  const base = () => ({
    slug: "order-list",
    visual_state_coverage: { rows: [] },
    components: [
      {
        id: "chart",
        profile: null,
        profile_absent_reason: "未整備",
        items: [
          {
            id: "zoom",
            visual_states: [],
            no_visual_state_reason: "撮影状態の導出はこのテストの被験対象ではない",
          },
        ],
        instances: [{ id: "dashboard" }],
      },
    ],
    cells: [
      {
        component: "chart",
        item: "zoom",
        instance: "dashboard",
        value: "present",
        evidence: "測った",
        covered_by: ["spec > t"],
      },
    ],
  });
  // 陽性コントロール: 正しく測れていれば通る
  expect(reconcile(base(), bundled)).toMatchObject({ ok: true, unmeasured: 0 });

  const emptyItems = base();
  emptyItems.components[0].items = [];
  emptyItems.cells = [];
  const emptyResult = reconcile(emptyItems, bundled);
  expect(emptyResult).toMatchObject({ ok: false, unmeasured: 1 });
  expect(emptyResult.problems.join("\n")).toMatch(/items または instances が空/);

  const duplicated = base();
  duplicated.components.push(structuredClone(duplicated.components[0]));
  const dupResult = reconcile(duplicated, bundled);
  expect(dupResult.ok).toBe(false);
  expect(dupResult.unmeasured).toBeGreaterThan(0);
  expect(dupResult.problems.join("\n")).toMatch(/id chart が重複している/);

  const stale = base();
  stale.cells.push({
    component: "chart",
    item: "removed-item",
    instance: "dashboard",
    value: "present",
    evidence: "古い行",
    covered_by: ["spec > t"],
  });
  const staleResult = reconcile(stale, bundled);
  expect(staleResult.ok).toBe(false);
  expect(staleResult.problems.join("\n")).toMatch(/components に無い 部品／項目／インスタンス/);
});

test("同値クラス: 束ねてよい軸・全候補の所属・根拠を検査する", () => {
  const cov = datagridCoverage();
  const ids = cov.components[0].instances[0].candidates;
  const key = (id) => `orders/${id}`;
  // 束ねてはいけない軸（sort-direction）で束ねる。
  cov.components[0].equivalence_classes = [
    {
      id: "sort",
      axis: "sort-direction",
      rationale: "方向は同じ描画",
      members: [key("column-sort/price/asc"), key("column-sort/price/desc")],
      representative: key("column-sort/price/asc"),
    },
  ];
  const bad = reconcile(cov, bundled);
  expect(bad.problems.join("\n")).toMatch(/軸 sort-direction は reducible_axes にない/);
  expect(bad.problems.join("\n")).toMatch(/がどの同値クラスにも属していない/);

  // 陽性コントロール: 列軸で束ね、全候補を過不足なく分類すれば通る。
  cov.components[0].equivalence_classes = ids.map((id) => ({
    id: `c-${id}`,
    axis: "column",
    rationale: "現行 UI で同じセルレンダラ・同じ書式であることを確認した",
    members: [key(id)],
    representative: key(id),
  }));
  expect(reconcile(cov, bundled).problems).toEqual([]);
});

test("同値クラスは宣言した軸以外で束ねられない", () => {
  const cov = datagridCoverage();
  const key = (id) => `orders/${id}`;
  cov.components[0].equivalence_classes = [
    {
      id: "mixed",
      axis: "column",
      rationale: "同じ書式",
      // column 軸だけでなく sort-direction も違うメンバーを混ぜる。
      members: [key("column-sort/price/asc"), key("column-sort/name/desc")],
      representative: key("column-sort/price/asc"),
    },
  ];
  expect(reconcile(cov, bundled).problems.join("\n")).toMatch(
    /軸 column 以外（sort-direction）でも束ねている/,
  );
});

test("プロファイルの形式検査: 誤記したフラグ・未定義の軸・区切り文字を弾く", () => {
  const base = {
    id: "x",
    version: "1",
    applies_to: "テスト用",
    axes: [{ id: "a", kind: "element", flags: ["on"] }],
    enumeration: {
      sources: ["current-source"],
      procedure: "定義から a を抜く",
      pitfalls: ["隠れている a を落とす"],
      fail_closed: "読めなければ complete: false",
    },
    candidate_rules: [{ id: "r", axes: ["a"], guard: { "a.on": true }, visual_states: ["hover"] }],
    required_rules: ["r"],
    equivalence: { reducible_axes: ["a"] },
  };
  expect(validateProfile(base, "x.json")).toEqual([]);
  const typo = structuredClone(base);
  typo.candidate_rules[0].guard = { "a.onn": true };
  // 誤記したフラグ名は「該当なし」＝候補ゼロで静かに通るため、形式検査で落とす。
  expect(validateProfile(typo, "x.json").join("\n")).toMatch(/宣言の無いフラグ onn/);
  const unknownAxis = structuredClone(base);
  unknownAxis.candidate_rules[0].axes = ["nope"];
  expect(validateProfile(unknownAxis, "x.json").join("\n")).toMatch(/未定義の軸 nope/);
  const separator = structuredClone(base);
  separator.axes.push({ id: "b", kind: "enum", values: ["a/b"] });
  expect(validateProfile(separator, "x.json").join("\n")).toMatch(/候補 id が衝突する/);
});

test("プロファイルの形式検査: enumeration の欠落・空フィールドを弾く", () => {
  // enumeration.sources が空だと readEnumeration の source.kind 検査が候補ゼロで素通りし、
  // どの列挙元でも通ってしまう（fail-open）。配布前に形式検査で落とす。
  const base = {
    id: "y",
    version: "1",
    applies_to: "テスト用",
    axes: [{ id: "a", kind: "element", flags: ["on"] }],
    enumeration: {
      sources: ["current-source"],
      procedure: "定義から a を抜く",
      pitfalls: ["隠れている a を落とす"],
      fail_closed: "読めなければ complete: false",
    },
    candidate_rules: [{ id: "r", axes: ["a"], guard: { "a.on": true }, visual_states: ["hover"] }],
    required_rules: ["r"],
    equivalence: { reducible_axes: ["a"] },
  };
  expect(validateProfile(base, "y.json")).toEqual([]);
  const missing = structuredClone(base);
  delete missing.enumeration;
  expect(validateProfile(missing, "y.json").join("\n")).toMatch(/enumeration が無い/);
  for (const [mutate, pattern] of [
    [(p) => (p.enumeration.sources = []), /sources が空/],
    [(p) => (p.enumeration.procedure = "  "), /procedure が空/],
    [(p) => (p.enumeration.fail_closed = "  "), /fail_closed が空/],
    [(p) => (p.enumeration.pitfalls = []), /pitfalls が空/],
  ]) {
    const broken = structuredClone(base);
    mutate(broken);
    expect(validateProfile(broken, "y.json").join("\n")).toMatch(pattern);
  }
});

/**
 * 一時ディレクトリにプロファイルと被覆表を書いて CLI を実行する。
 * プロファイルディレクトリ（@profiles）と成果物ディレクトリを分ける——同じにすると
 * 被覆表がプロファイルとして読み込まれ、検証したい経路と別の理由で落ちる。
 */
function runCli(args, { profiles = {}, files = {} } = {}) {
  const root = makeTempDir("coverage-expand-");
  const profilesDir = join(root, "profiles");
  mkdirSync(profilesDir);
  const write = (dir, name, content) => {
    const path = join(dir, name);
    writeFileSync(
      path,
      typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`,
    );
    return path;
  };
  for (const [name, content] of Object.entries(profiles)) write(profilesDir, name, content);
  /** @type {Record<string, string>} */
  const paths = {};
  for (const [name, content] of Object.entries(files)) {
    // インプロセスの reconcile ラッパと同じく、被覆表には集合の来歴を補ってから書き出す
    // （宣言そのものを見るテストは自分で書いた値を持つので上書きされない）。
    if (name === "component-coverage.json") fillSetProvenance(content);
    paths[name] = write(root, name, content);
  }
  const resolved = args.map((a) => paths[a] ?? (a === "@profiles" ? profilesDir : a));
  return {
    root,
    paths,
    ...spawnSync(process.execPath, [script, ...resolved], { encoding: "utf8" }),
  };
}

test("新しい仮想部品のプロファイルを、共通処理と中心ドキュメントを変えずに追加できる", () => {
  // DataGrid に一切似ていない仮想部品（ノードと展開状態を軸に持つツリー）。
  // coverage-expand.mjs にも references/coverage-profiles.md にも手を入れていない。
  const treeview = {
    id: "treeview",
    version: "1",
    name: "ツリービュー",
    applies_to: "ノードごとに展開可否と選択可否が設定される階層表示部品",
    axes: [
      { id: "node", kind: "element", name: "ノード", flags: ["expandable", "selectable"] },
      { id: "state", kind: "enum", name: "展開状態", values: ["collapsed", "expanded"] },
    ],
    enumeration: {
      sources: ["current-source", "app-ui"],
      procedure: "ツリー定義のノード配列を読む",
      pitfalls: ["折りたたまれた子ノードを列挙から落とす"],
      fail_closed: "読めなければ complete: false ＋ incomplete_reason",
    },
    candidate_rules: [
      {
        id: "node-expand",
        name: "展開",
        axes: ["node", "state"],
        guard: { "node.expandable": true },
        visual_states: ["opens-container"],
      },
      {
        id: "node-select",
        name: "選択",
        axes: ["node"],
        guard: { "node.selectable": true },
        visual_states: ["hover"],
      },
    ],
    required_rules: ["node-select"],
    equivalence: { reducible_axes: ["node"], constraints: ["同じ深さのノードだけ束ねる"] },
  };
  const nodeEnum = {
    source: {
      kind: "current-source",
      ref: "src/tree/nodes.ts",
      version: "rev-1",
      extracted_at: "2026-09-03T00:00:00Z",
      condition: "nodes 配列の全要素。折りたたみ済みの子も辿った",
    },
    complete: true,
    elements: {
      node: [
        { id: "root", flags: { expandable: true, selectable: true } },
        { id: "leaf", flags: { expandable: false, selectable: true } },
      ],
    },
  };
  const candidates = [
    "node-expand/root/collapsed",
    "node-expand/root/expanded",
    "node-select/root",
    "node-select/leaf",
  ];
  const visualStates = {
    "node-expand": ["opens-container"],
    "node-select": ["hover"],
  };
  const coverage = {
    slug: "org-tree",
    // 行は候補ごとに立つ（同値クラスを宣言していないので縮約しない）。
    // 同じインスタンスでは状態名も一意なので、候補ごとに別の名前を振る。
    visual_state_coverage: {
      rows: candidates.map((id) => ({
        component: "tree",
        instance: "org",
        kind: visualStates[id.split("/")[0]][0],
        required_by: id,
        captured: `状態:${id}`,
        reason: null,
      })),
    },
    components: [
      {
        id: "tree",
        profile: "treeview",
        profile_version: "1",
        items: candidates.map((id) => ({
          id,
          visual_states: visualStates[id.split("/")[0]],
          no_visual_state_reason: null,
          candidate: {
            rule: id.split("/")[0],
            axes: id.startsWith("node-expand")
              ? { node: id.split("/")[1], state: id.split("/")[2] }
              : { node: id.split("/")[1] },
          },
        })),
        instances: [
          { id: "org", page: "組織", locator: "org.tree", enumeration: nodeEnum, candidates },
        ],
      },
    ],
    cells: candidates.map((id) => ({
      component: "tree",
      item: id,
      instance: "org",
      value: "present",
      evidence: "実 UI で操作し DOM 変化を確認",
      covered_by: [`e2e/org.spec.ts > ${id}`],
    })),
  };
  const metadata = {
    slug: "org-tree",
    capture_conditions: {
      pages: [{ name: "組織", path: "/org" }],
      states: ["default", ...candidates.map((id) => `状態:${id}`)],
      popup_inventory: candidates
        .filter((id) => visualStates[id.split("/")[0]][0] === "opens-container")
        .map((id) => ({
          name: `器:${id}`,
          parent: null,
          opened_by: `expandNode(org.tree, ${id})`,
          captured: `状態:${id}`,
          reason: null,
        })),
    },
  };
  const ok = runCli(
    [
      "--profiles",
      "@profiles",
      "--coverage",
      "component-coverage.json",
      "--metadata",
      "metadata.json",
    ],
    {
      profiles: { "treeview.json": treeview },
      files: { "component-coverage.json": coverage, "metadata.json": metadata },
    },
  );
  expect(ok.stderr).toBe("");
  expect(ok.status).toBe(0);
  expect(JSON.parse(ok.stdout)).toMatchObject({
    ok: true,
    candidates: 4,
    unmeasured: 0,
    visual_states: { checked: true, rows: candidates.length, undecided: 0, missing_states: [] },
  });

  // 陰性コントロール: 同じ仮想部品でノードを 1 つ落とすと失敗する（常に通す実装を弾く）。
  const short = structuredClone(coverage);
  short.components[0].items = short.components[0].items.filter((i) => i.id !== "node-select/leaf");
  short.components[0].instances[0].candidates = candidates.filter((i) => i !== "node-select/leaf");
  short.cells = short.cells.filter((c) => c.item !== "node-select/leaf");
  const bad = runCli(["--profiles", "@profiles", "--coverage", "component-coverage.json"], {
    profiles: { "treeview.json": treeview },
    files: { "component-coverage.json": short },
  });
  expect(bad.status).toBe(1);
  expect(bad.stderr).toMatch(/候補 node-select\/leaf に対応する項目が被覆表に無い/);
});

test("壊れたプロファイルを静かに無視せず exit 2 で落ちる（候補ゼロで素通りさせない）", () => {
  const r = runCli(["--profiles", "@profiles", "--coverage", "component-coverage.json"], {
    profiles: { "broken.json": "{ not json" },
    files: { "component-coverage.json": datagridCoverage() },
  });
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/JSON として読めない/);
});

test("プロファイルが 1 件も読めない場合も合格に倒さない", () => {
  const r = runCli(["--profiles", "@profiles", "--coverage", "component-coverage.json"], {
    files: { "component-coverage.json": datagridCoverage() },
  });
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/プロファイルが 1 件も読み込めなかった/);
});

test("CLI --write は candidates と conformance を書き戻す（測定値には触れない）", () => {
  const cov = datagridCoverage();
  // 書き戻し前は candidates を持たない状態にしておく。
  delete cov.components[0].instances[0].candidates;
  const r = runCli(
    ["--coverage", "component-coverage.json", "--write", "--profiles", bundledProfiles],
    {
      files: { "component-coverage.json": cov },
    },
  );
  expect(r.status).toBe(0);
  const written = JSON.parse(readFileSync(r.paths["component-coverage.json"], "utf8"));
  expect(written.components[0].instances[0].candidates).toHaveLength(20);
  expect(written.conformance).toMatchObject({ tool: "coverage-expand", ok: true, unmeasured: 0 });
  // 測定値は書き換えない。
  expect(written.cells[0]).toMatchObject({ value: "present" });
});

test("CLI: 引数不足・重複指定は exit 2", () => {
  expect(spawnSync(process.execPath, [script], { encoding: "utf8" }).status).toBe(2);
  const dup = runCli(
    ["--coverage", "component-coverage.json", "--coverage", "component-coverage.json"],
    {
      files: { "component-coverage.json": datagridCoverage() },
    },
  );
  expect(dup.status).toBe(2);
  expect(dup.stderr).toMatch(/複数回指定/);
});

test("CLI --list-profiles は同梱プロファイルを列挙する", () => {
  const r = spawnSync(process.execPath, [script, "--list-profiles"], { encoding: "utf8" });
  expect(r.status).toBe(0);
  expect(JSON.parse(r.stdout).profiles.map((p) => p.id)).toContain("datagrid");
});

// ===== 撮影状態の導出（Issue #389） =====
//
// 塞ぐ穴: 撮る状態の集合が「思いついた分」で決まり、部品被覆表に並んだ操作と結び付いていなかった。
// 撮っていない状態には差が出ず、差分器は撮った 2 枚しか比べないので、集合の不足は「差 0 件」と
// 同じ見え方になる（素通りと見分けが付かない）。測った操作から必要な状態を導き、
// capture_conditions.states との差を撮る前に報告できることを確認する。

test("被覆表の操作から撮影状態を導く（プロファイルが種別の正本）", () => {
  const cov = datagridCoverage();
  const kinds = cov.visual_state_coverage.rows.map((r) => r.kind);
  // 器を開く・指を乗せる・焦点を当てる・押している最中・不活性の 5 種と、
  // 操作を終えた後に残る見た目（Issue #471）が測った操作から立つ。
  expect(new Set(kinds)).toEqual(
    new Set(["opens-container", "hover", "focus", "active", "disabled", "after-operation"]),
  );
  // 終えた後の見た目は、絞り込み・並べ替え（方向ごと）・複数列の並べ替え・行の選択（列ごと）から立つ。
  // 途中の見た目だけを導くと、選択の塗りが付かない列や絞り込み中の見出しの色は撮られない。
  expect(
    cov.visual_state_coverage.rows
      .filter((r) => r.kind === "after-operation")
      .map((r) => r.required_by)
      .sort(),
  ).toEqual([
    "column-filter/price",
    "column-sort/name/asc",
    "column-sort/name/desc",
    "column-sort/name/none",
    "column-sort/price/asc",
    "column-sort/price/desc",
    "column-sort/price/none",
    "multi-column-sort/price-then-name/asc/asc",
    "multi-column-sort/price-then-name/asc/desc",
    "multi-column-sort/price-then-name/asc/none",
    "multi-column-sort/price-then-name/desc/asc",
    "multi-column-sort/price-then-name/desc/desc",
    "multi-column-sort/price-then-name/desc/none",
    "row-select/row-number/name",
    "row-select/row-number/price",
  ]);
  // 行は要求元の候補ごとに分かれる。種別だけで束ねると、同じ opens-container を要求する
  // 列フィルタの吹き出しと右クリックメニューが 1 行へ潰れ、片方を撮るだけで門が通る。
  // column-toggle はこの列挙に toggleable な列が無いため候補が立たず、行も立たない。
  const opensBy = cov.visual_state_coverage.rows
    .filter((r) => r.kind === "opens-container")
    .map((r) => r.required_by);
  expect(opensBy).toEqual([...opensBy].sort());
  expect(opensBy.some((id) => id.startsWith("column-filter/"))).toBe(true);
  expect(opensBy.some((id) => id.startsWith("context-menu-open/"))).toBe(true);
  expect(opensBy.some((id) => id.startsWith("column-toggle/"))).toBe(false);
  expect(cov.visual_state_coverage.rows[0]).toMatchObject({
    component: "grid",
    instance: "orders",
  });
  // **ルール id でまとめない**——ルールは複数の軸の直積へ展開されるので、まとめると
  // 縮約してはいけない軸（datagrid では sort-direction）まで畳んでしまう。
  const sortActive = cov.visual_state_coverage.rows.filter(
    (r) => r.kind === "active" && r.required_by.startsWith("column-sort/"),
  );
  const sortCandidates = cov.components[0].items.filter((i) => i.candidate.rule === "column-sort");
  expect(sortActive).toHaveLength(sortCandidates.length);
  expect(sortActive.map((r) => r.required_by).sort()).toEqual(
    sortCandidates.map((i) => i.id).sort(),
  );
  // 項目の種別はプロファイルから書き戻される（部品ごとに手で書かない）。
  const sortItem = cov.components[0].items.find((i) => i.candidate.rule === "column-sort");
  expect(sortItem.visual_states).toEqual(["hover", "focus", "active", "after-operation"]);
  const visibleItem = cov.components[0].items.find((i) => i.candidate.rule === "column-visible");
  expect(visibleItem.visual_states).toEqual([]);
  expect(visibleItem.no_visual_state_reason).toMatch(/操作しない/);
});

test("測っていない操作は撮影状態を要求しない（absent / unmeasured で行が立たない）", () => {
  const cov = datagridCoverage();
  // disabled を要求するのは context-menu-item だけ。そのセルを absent へ倒すと行が消える。
  for (const cell of cov.cells) {
    if (cell.item.startsWith("context-menu-item/")) {
      cell.value = "unmeasured";
      cell.covered_by = [];
      cell.unmeasured_reason = "該当ロールの利用者を用意できない";
    }
  }
  fillVisualStateRows(cov);
  expect(cov.visual_state_coverage.rows.map((r) => r.kind)).not.toContain("disabled");
});

test("撮影状態の未決は「足りない状態の一覧」として報告される", () => {
  const cov = datagridCoverage();
  const row = cov.visual_state_coverage.rows.find((r) => r.kind === "disabled");
  row.captured = null;
  row.reason = null;
  const r = reconcile(cov, bundled, captureConditionsFor(cov));
  expect(r.ok).toBe(false);
  expect(r.visualStates.undecided).toBe(1);
  expect(r.problems.join("\n")).toMatch(
    /撮影状態が未決: grid \/ orders \/ context-menu-item\/[^ ]* \/ disabled/,
  );
  // 撮れないなら理由で通る（gaps.md の「撮影状態の対象外」へ回す形）。
  row.reason = "不活性になる条件が現行に無い（全ロールで項目が活性）";
  const withReason = reconcile(cov, bundled, captureConditionsFor(cov));
  expect(withReason.problems).toEqual([]);
  expect(withReason.visualStates.undecided).toBe(0);
  // 撮る・撮らないが同時に成立する行は通さない。
  row.captured = "context-menu-item:disabled";
  expect(reconcile(cov, bundled, captureConditionsFor(cov)).problems.join("\n")).toMatch(
    /captured と reason が両方埋まっている/,
  );
});

test("導いた状態が capture_conditions.states に無ければ差として報告する", () => {
  const cov = datagridCoverage();
  const conditions = captureConditionsFor(cov);
  // 陽性コントロール: 揃っていれば通る。
  expect(reconcile(cov, bundled, conditions).problems).toEqual([]);

  // 状態名は実データから引く（ルール id ではなく候補 id が要求元になる）。
  const anySortHover = cov.visual_state_coverage.rows.find(
    (row) => row.kind === "hover" && row.required_by.startsWith("column-sort/"),
  ).captured;
  const missingHover = {
    ...conditions,
    states: conditions.states.filter((s) => s !== anySortHover),
  };
  const r = reconcile(cov, bundled, missingHover);
  expect(r.ok).toBe(false);
  expect(r.visualStates.missing_states).toEqual([anySortHover]);
  expect(r.problems.join("\n")).toMatch(
    new RegExp(`captured の ${anySortHover} が metadata.json の capture_conditions`),
  );

  // 器を開く状態は states に在るだけでは足りない。器の棚卸しにも行が要る。
  const noInventory = { ...conditions, popupStates: [] };
  const inv = reconcile(cov, bundled, noInventory);
  expect(inv.ok).toBe(false);
  expect(inv.problems.join("\n")).toMatch(/popup_inventory\[\].captured に無い/);
});

test("--metadata 無しの実行は照合済みに倒さない（checked: false のまま）", () => {
  const cov = datagridCoverage();
  const r = reconcile(cov, bundled);
  expect(r.visualStates.checked).toBe(false);
  // 状態名を突き合わせないだけで、未決の検出は効く。
  expect(r.problems).toEqual([]);
  expect(reconcile(cov, bundled, captureConditionsFor(cov)).visualStates.checked).toBe(true);
});

test("記録された行は導いた集合と過不足なく一致していなければならない", () => {
  const stale = datagridCoverage();
  stale.visual_state_coverage.rows.push({
    component: "grid",
    instance: "orders",
    kind: "hover",
    required_by: stale.visual_state_coverage.rows.find((row) => row.kind === "hover").required_by,
    captured: stale.visual_state_coverage.rows.find((row) => row.kind === "hover").captured,
    reason: null,
  });
  expect(reconcile(stale, bundled, captureConditionsFor(stale)).problems.join("\n")).toMatch(
    /行が重複している/,
  );

  const dropped = datagridCoverage();
  dropped.visual_state_coverage.rows = dropped.visual_state_coverage.rows.filter(
    (r) => r.kind !== "focus",
  );
  expect(reconcile(dropped, bundled, captureConditionsFor(dropped)).problems.join("\n")).toMatch(
    /撮影状態が導出から漏れている: grid \/ orders \/ column-sort\/[^ ]* \/ focus/,
  );

  // 余剰行: 導出が要求しなくなった行が残っているケース。メニュー項目の測定を落とすと
  // disabled を要求する候補が無くなるので、記録済みの行が余剰になる。
  const leftover = datagridCoverage();
  for (const cell of leftover.cells) {
    if (!cell.item.startsWith("context-menu-item/")) continue;
    cell.value = "unmeasured";
    cell.covered_by = [];
    cell.unmeasured_reason = "該当ロールの利用者を用意できない";
  }
  expect(reconcile(leftover, bundled, captureConditionsFor(leftover)).problems.join("\n")).toMatch(
    /要求の無い行 grid \/ orders \/ context-menu-item\/[^ ]* \/ disabled/,
  );

  const noKey = datagridCoverage();
  delete noKey.visual_state_coverage;
  expect(reconcile(noKey, bundled, captureConditionsFor(noKey)).problems.join("\n")).toMatch(
    /visual_state_coverage.rows が無い/,
  );
});

test("--write は撮る／撮らないの判断を引き継ぎ、要求の消えた行だけ落とす", () => {
  const cov = datagridCoverage();
  const decided = cov.visual_state_coverage.rows.find((r) => r.kind === "hover");
  decided.captured = null;
  decided.reason = "一覧のどの行にも hover の見た目が無いことを実 UI で確認した";
  // 同じキーの行は判断を引き継ぐ。
  fillVisualStateRows(cov);
  expect(cov.visual_state_coverage.rows.find((r) => r.kind === "hover")).toMatchObject({
    captured: null,
    reason: "一覧のどの行にも hover の見た目が無いことを実 UI で確認した",
  });
  // 同じキーが重複していたらどちらの判断も引き継がない（黙って一方を採ると判断が消える）。
  cov.visual_state_coverage.rows.push({
    ...cov.visual_state_coverage.rows.find((r) => r.kind === "hover"),
    reason: "別の判断",
  });
  fillVisualStateRows(cov);
  expect(cov.visual_state_coverage.rows.find((r) => r.kind === "hover")).toMatchObject({
    captured: null,
    reason: null,
  });
});

test("項目の visual_states は省略・誤記・空理由なしを通さない", () => {
  for (const [mutate, pattern] of [
    [(i) => delete i.visual_states, /visual_states が配列ではない/],
    [(i) => (i.visual_states = ["pressed"]), /は opens-container \| hover/],
    [(i) => (i.visual_states = ["hover", "hover"]), /visual_states の hover が重複/],
    [
      (i) => {
        i.visual_states = [];
        i.no_visual_state_reason = null;
      },
      /no_visual_state_reason が空/,
    ],
    [(i) => (i.no_visual_state_reason = "余計な理由"), /no_visual_state_reason が埋まっている/],
  ]) {
    const cov = datagridCoverage();
    mutate(cov.components[0].items.find((i) => i.candidate.rule === "column-sort"));
    const r = reconcile(cov, bundled, captureConditionsFor(cov));
    expect(r.ok).toBe(false);
    expect(r.problems.join("\n")).toMatch(pattern);
  }

  // 誤記だけの宣言を「空の宣言」に読み替えない。読み替えると 1 つの誤記が
  // 「誤記」と「空なのに理由が無い」の 2 件に割れ、理由欄を埋める誤った直しへ誘導する
  // （理由欄の要否はプロファイル側の validateProfile と同じく宣言した長さで決まる）。
  const typo = datagridCoverage();
  typo.components[0].items.find((i) => i.candidate.rule === "column-sort").visual_states = [
    "pressed",
  ];
  const typoProblems = reconcile(typo, bundled, captureConditionsFor(typo)).problems.join("\n");
  expect(typoProblems).toMatch(/は opens-container \| hover/);
  expect(typoProblems).not.toMatch(/no_visual_state_reason が空/);

  // 誤記だけの宣言に理由欄が埋まっていれば、それは「非空なのに理由が埋まっている」として残る。
  const typoWithReason = datagridCoverage();
  const sortItem = typoWithReason.components[0].items.find(
    (i) => i.candidate.rule === "column-sort",
  );
  sortItem.visual_states = ["pressed"];
  sortItem.no_visual_state_reason = "余計な理由";
  expect(
    reconcile(typoWithReason, bundled, captureConditionsFor(typoWithReason)).problems.join("\n"),
  ).toMatch(/no_visual_state_reason が埋まっている/);
});

test("プロファイルは visual_states の宣言を省略できない（未宣言の状態が静かに落ちない）", () => {
  const base = {
    id: "z",
    version: "1",
    applies_to: "テスト用",
    axes: [{ id: "a", kind: "element", flags: ["on"] }],
    enumeration: {
      sources: ["current-source"],
      procedure: "定義から a を抜く",
      pitfalls: ["隠れている a を落とす"],
      fail_closed: "読めなければ complete: false",
    },
    candidate_rules: [{ id: "r", axes: ["a"], guard: { "a.on": true }, visual_states: ["hover"] }],
    required_rules: ["r"],
    equivalence: { reducible_axes: ["a"] },
  };
  expect(validateProfile(base, "z.json")).toEqual([]);
  for (const [mutate, pattern] of [
    [(p) => delete p.candidate_rules[0].visual_states, /visual_states が配列ではない/],
    [(p) => (p.candidate_rules[0].visual_states = ["opened"]), /は opens-container \| hover/],
    [
      (p) => (p.candidate_rules[0].visual_states = ["focus", "focus"]),
      /visual_states の focus が重複/,
    ],
    [(p) => (p.candidate_rules[0].visual_states = []), /no_visual_state_reason が空/],
    [
      (p) => (p.candidate_rules[0].no_visual_state_reason = "余計な理由"),
      /no_visual_state_reason が埋まっている/,
    ],
  ]) {
    const p = structuredClone(base);
    mutate(p);
    expect(validateProfile(p, "z.json").join("\n")).toMatch(pattern);
  }
});

test("CLI: --metadata を渡すと撮影状態まで照合し、読めない metadata は合格に倒さない", () => {
  const cov = datagridCoverage();
  const conditions = captureConditionsFor(cov);
  const metadata = {
    slug: "order-list",
    capture_conditions: {
      pages: conditions.pageNames.map((name) => ({ name, path: `/${name}` })),
      states: conditions.states,
      popup_inventory: conditions.popupStates.map((state) => ({
        name: state,
        parent: null,
        opened_by: `open${state}(orders.grid)`,
        captured: state,
        reason: null,
      })),
    },
  };
  const ok = runCli(
    [
      "--coverage",
      "component-coverage.json",
      "--metadata",
      "metadata.json",
      "--profiles",
      bundledProfiles,
    ],
    { files: { "component-coverage.json": cov, "metadata.json": metadata } },
  );
  expect(ok.status).toBe(0);
  expect(JSON.parse(ok.stdout).visual_states).toMatchObject({ checked: true, undecided: 0 });

  // 陰性コントロール: 撮影条件から状態を 1 つ落とすと落ちる（常に通す実装を弾く）。
  const short = structuredClone(metadata);
  const droppedState = cov.visual_state_coverage.rows.find(
    (row) => row.kind === "focus" && row.required_by.startsWith("column-sort/"),
  ).captured;
  short.capture_conditions.states = short.capture_conditions.states.filter(
    (s) => s !== droppedState,
  );
  const bad = runCli(
    [
      "--coverage",
      "component-coverage.json",
      "--metadata",
      "metadata.json",
      "--profiles",
      bundledProfiles,
    ],
    { files: { "component-coverage.json": cov, "metadata.json": short } },
  );
  expect(bad.status).toBe(1);
  expect(bad.stderr).toMatch(
    new RegExp(`撮影条件に無い状態名 1 件（${droppedState.replace(/\//g, "\\/")}）`),
  );

  // capture_conditions を持たない metadata は「照合しない」に倒さず使い方の誤りにする。
  const broken = runCli(
    [
      "--coverage",
      "component-coverage.json",
      "--metadata",
      "metadata.json",
      "--profiles",
      bundledProfiles,
    ],
    { files: { "component-coverage.json": cov, "metadata.json": { slug: "order-list" } } },
  );
  expect(broken.status).toBe(2);
  expect(broken.stderr).toMatch(/capture_conditions.states \/ capture_conditions.popup_inventory/);

  // 別機能の metadata を黙って受理しない（状態名が汎用なら突き合わせも通ってしまう）。
  const otherFeature = runCli(
    [
      "--coverage",
      "component-coverage.json",
      "--metadata",
      "metadata.json",
      "--profiles",
      bundledProfiles,
    ],
    {
      files: {
        "component-coverage.json": cov,
        "metadata.json": { ...metadata, slug: "another-feature" },
      },
    },
  );
  expect(otherFeature.status).toBe(2);
  expect(otherFeature.stderr).toMatch(/slug（another-feature）が被覆表の slug（order-list）と違う/);

  // --metadata 無しは通るが、照合していないことを黙らない。
  const unchecked = runCli(
    ["--coverage", "component-coverage.json", "--profiles", bundledProfiles],
    { files: { "component-coverage.json": cov } },
  );
  expect(unchecked.status).toBe(0);
  expect(JSON.parse(unchecked.stdout).visual_states.checked).toBe(false);
  expect(unchecked.stderr).toMatch(/--metadata が無いため撮影状態を/);
});

test("同じ種別を要求する別の操作を 1 行へ束ねない（片方だけ撮って門が通らない）", () => {
  // 列フィルタの吹き出しと右クリックメニューはどちらも opens-container を要求する。
  // 種別だけで束ねると 1 行になり、片方の状態名を書くだけで undecided 0 に化ける——
  // 撮られなかった器の差は「差 0 件」と同じ見え方になり、この導出が塞ぐはずの穴が残る。
  const cov = {
    slug: "order-list",
    components: [
      {
        id: "grid",
        profile: null,
        profile_absent_reason: "自作グリッドで適合プロファイルが無い",
        items: [
          {
            id: "filter-popup",
            name: "列フィルタの吹き出し",
            visual_states: ["opens-container"],
            no_visual_state_reason: null,
          },
          {
            id: "ctx-menu",
            name: "右クリックメニュー",
            visual_states: ["opens-container"],
            no_visual_state_reason: null,
          },
        ],
        instances: [{ id: "orders", page: "受注一覧", locator: "orders.grid" }],
      },
    ],
    cells: ["filter-popup", "ctx-menu"].map((item) => ({
      component: "grid",
      item,
      instance: "orders",
      value: "present",
      evidence: "実 UI で開いた",
      covered_by: [`e2e/order-list.spec.ts > ${item}`],
    })),
  };
  fillVisualStateRows(cov);
  expect(cov.visual_state_coverage.rows).toHaveLength(2);

  // 片方だけ決めても通さない。
  cov.visual_state_coverage.rows.find((r) => r.required_by === "filter-popup").captured =
    "フィルタの吹き出しを開いた状態";
  const partial = reconcile(cov, bundled, {
    pageNames: ["受注一覧"],
    states: ["default", "フィルタの吹き出しを開いた状態"],
    popupStates: ["フィルタの吹き出しを開いた状態"],
  });
  expect(partial.ok).toBe(false);
  expect(partial.visualStates.undecided).toBe(1);
  expect(partial.problems.join("\n")).toMatch(
    /撮影状態が未決: grid \/ orders \/ ctx-menu \/ opens-container/,
  );

  // 陽性コントロール: 両方を別の状態名で決めれば通る（常に落とす実装を弾く）。
  cov.visual_state_coverage.rows.find((r) => r.required_by === "ctx-menu").captured =
    "右クリックメニューを開いた状態";
  const both = reconcile(cov, bundled, {
    pageNames: ["受注一覧"],
    states: ["default", "フィルタの吹き出しを開いた状態", "右クリックメニューを開いた状態"],
    popupStates: ["フィルタの吹き出しを開いた状態", "右クリックメニューを開いた状態"],
  });
  expect(both.problems).toEqual([]);
  expect(both.visualStates).toMatchObject({ checked: true, rows: 2, undecided: 0 });
});

test("同じ撮影単位で状態名を使い回した行は根拠なしに通さない（1 枚で複数操作を満たさせない）", () => {
  // 行のキーを要求元まで割っても、captured の値が同じなら同じ 1 枚を指す。
  // 撮影の単位は ページ × 状態名 × ビューポートなので、キーの粒度と同じ故障が値の側に残る。
  const base = () => ({
    slug: "order-list",
    components: [
      {
        id: "grid",
        profile: null,
        profile_absent_reason: "自作グリッドで適合プロファイルが無い",
        items: [
          { id: "filter-popup", visual_states: ["opens-container"], no_visual_state_reason: null },
          { id: "ctx-menu", visual_states: ["opens-container"], no_visual_state_reason: null },
        ],
        instances: [{ id: "orders", page: "受注一覧", locator: "orders.grid" }],
      },
    ],
    cells: ["filter-popup", "ctx-menu"].map((item) => ({
      component: "grid",
      item,
      instance: "orders",
      value: "present",
      evidence: "実 UI で開いた",
      covered_by: [`e2e/order-list.spec.ts > ${item}`],
    })),
  });
  const onePopup = {
    pageNames: ["受注一覧"],
    states: ["default", "only-one-popup"],
    popupStates: ["only-one-popup"],
  };

  // 陰性: 2 操作が同じ状態名を指すと落ちる。
  const shared = base();
  fillVisualStateRows(shared);
  for (const row of shared.visual_state_coverage.rows) row.captured = "only-one-popup";
  const bad = reconcile(shared, bundled, onePopup);
  expect(bad.ok).toBe(false);
  expect(bad.visualStates.undecided).toBe(2);
  expect(bad.problems.join("\n")).toMatch(/撮影状態の使い回し/);

  // 陽性: 別の状態名にすれば通る（常に落とす実装を弾く）。
  const distinct = base();
  fillVisualStateRows(distinct);
  const names = {
    "filter-popup": "フィルタの吹き出しを開いた状態",
    "ctx-menu": "右クリックメニューを開いた状態",
  };
  for (const row of distinct.visual_state_coverage.rows) row.captured = names[row.required_by];
  expect(
    reconcile(distinct, bundled, {
      pageNames: ["受注一覧"],
      states: ["default", ...Object.values(names)],
      popupStates: Object.values(names),
    }).problems,
  ).toEqual([]);

  // fail-closed を行き止まりにしない: 同じ器を開く 2 操作は全行に根拠を書けば通る。
  const justified = base();
  fillVisualStateRows(justified);
  for (const row of justified.visual_state_coverage.rows) {
    row.captured = "only-one-popup";
    row.shared_capture_reason = "どちらの操作も同一の器を開くことを実 UI で確認した";
  }
  expect(reconcile(justified, bundled, onePopup).problems).toEqual([]);

  // 根拠が一部の行にしか無ければ通さない（書いた行だけで全体を免除しない）。
  const partial = structuredClone(justified);
  delete partial.visual_state_coverage.rows[0].shared_capture_reason;
  expect(reconcile(partial, bundled, onePopup).problems.join("\n")).toMatch(/根拠が空/);

  // --metadata 無しでも使い回しは検出する（構造の問題なので撮影条件に依らない）。
  expect(reconcile(shared, bundled).problems.join("\n")).toMatch(/撮影状態の使い回し/);

  // 別ページのインスタンス間では使い回してよい（撮影単位が違うので別の 1 枚になる）。
  const twoPages = base();
  twoPages.components[0].instances.push({
    id: "archive",
    page: "受注履歴",
    locator: "archive.grid",
  });
  for (const item of ["filter-popup", "ctx-menu"]) {
    twoPages.cells.push({
      component: "grid",
      item,
      instance: "archive",
      value: "present",
      evidence: "実 UI で開いた",
      covered_by: [`e2e/archive.spec.ts > ${item}`],
    });
  }
  fillVisualStateRows(twoPages);
  for (const row of twoPages.visual_state_coverage.rows) row.captured = names[row.required_by];
  expect(
    reconcile(twoPages, bundled, {
      pageNames: ["受注一覧", "受注履歴"],
      states: ["default", ...Object.values(names)],
      popupStates: Object.values(names),
    }).problems,
  ).toEqual([]);
});

test("--write は人が埋める欄を全部引き継ぐ（逃げ道が書き戻しで消えない）", () => {
  // shared_capture_reason を引き継がないと、手順 8 で必ず通す --write が根拠を消し、
  // 同じ実行の照合が「根拠なしの使い回し」で落ちる——逃げ道が構造的に死ぬ。
  const cov = {
    slug: "order-list",
    components: [
      {
        id: "grid",
        profile: null,
        profile_absent_reason: "自作グリッドで適合プロファイルが無い",
        items: [
          { id: "filter-popup", visual_states: ["opens-container"], no_visual_state_reason: null },
          { id: "ctx-menu", visual_states: ["opens-container"], no_visual_state_reason: null },
        ],
        instances: [{ id: "orders", page: "受注一覧", locator: "orders.grid" }],
      },
    ],
    cells: ["filter-popup", "ctx-menu"].map((item) => ({
      component: "grid",
      item,
      instance: "orders",
      value: "present",
      evidence: "実 UI で開いた",
      covered_by: [`e2e/order-list.spec.ts > ${item}`],
    })),
  };
  fillVisualStateRows(cov);
  for (const row of cov.visual_state_coverage.rows) {
    row.captured = "only-one-popup";
    row.shared_capture_reason = "どちらの操作も同一の器を開くことを実 UI で確認した";
    row.reason = null;
  }
  // 書き戻しても人の判断は残る。
  fillVisualStateRows(cov);
  expect(cov.visual_state_coverage.rows.map((r) => r.shared_capture_reason)).toEqual([
    "どちらの操作も同一の器を開くことを実 UI で確認した",
    "どちらの操作も同一の器を開くことを実 UI で確認した",
  ]);
  expect(
    reconcile(cov, bundled, {
      pageNames: ["受注一覧"],
      states: ["default", "only-one-popup"],
      popupStates: ["only-one-popup"],
    }).problems,
  ).toEqual([]);
});

test("page が無いインスタンスは撮影単位を決められないので落とす（狭いスコープへ倒さない）", () => {
  // page が撮影単位（ページ × 状態名 × ビューポート）を決めるキー。
  // 欠落を「そのインスタンスだけの重複を見る」へ倒すと、同じページに載る別部品どうしが
  // 根拠なく状態名を使い回しても通る（fail-open）。
  const cov = {
    slug: "order-list",
    components: ["grid", "panel"].map((id) => ({
      id,
      profile: null,
      profile_absent_reason: "自作",
      items: [
        { id: `${id}-popup`, visual_states: ["opens-container"], no_visual_state_reason: null },
      ],
      instances: [{ id: `${id}-inst`, locator: `${id}.root` }],
    })),
    cells: ["grid", "panel"].map((id) => ({
      component: id,
      item: `${id}-popup`,
      instance: `${id}-inst`,
      value: "present",
      evidence: "実 UI で開いた",
      covered_by: [`e2e/x.spec.ts > ${id}`],
    })),
  };
  fillVisualStateRows(cov);
  for (const row of cov.visual_state_coverage.rows) row.captured = "only-one-popup";
  const conditions = {
    pageNames: ["受注一覧", "サイドパネルのページ"],
    states: ["default", "only-one-popup"],
    popupStates: ["only-one-popup"],
  };
  const bad = reconcile(cov, bundled, conditions);
  expect(bad.ok).toBe(false);
  expect(bad.problems.join("\n")).toMatch(/page が無い/);

  // 陽性コントロール: page を書けば、同じページの別部品どうしの使い回しとして落ちる。
  for (const component of cov.components) component.instances[0].page = "受注一覧";
  expect(reconcile(cov, bundled, conditions).problems.join("\n")).toMatch(/撮影状態の使い回し/);

  // 別ページなら通る（撮影単位が違う）。
  cov.components[1].instances[0].page = "サイドパネルのページ";
  expect(reconcile(cov, bundled, conditions).problems).toEqual([]);
});

test("インスタンスの page は宣言されたページ名でなければ通さない（非空なだけで受理しない）", () => {
  // 採取は metadata の capture_conditions.pages を外側のループにして回るので、
  // 宣言に無いページ名（誤記・旧称）を書いた行はどのページでも撮られない。
  // 誤記は使い回しの判定単位も割るため、共有すべきスコープが黙って分かれる。
  const cov = {
    slug: "order-list",
    components: [
      {
        id: "grid",
        profile: null,
        profile_absent_reason: "自作グリッドで適合プロファイルが無い",
        items: [{ id: "filter", visual_states: ["opens-container"], no_visual_state_reason: null }],
        instances: [{ id: "orders", page: "TYPO", locator: "orders.grid" }],
      },
    ],
    cells: [
      {
        component: "grid",
        item: "filter",
        instance: "orders",
        value: "present",
        evidence: "実 UI で開いた",
        covered_by: ["e2e/order-list.spec.ts > filter"],
      },
    ],
  };
  fillVisualStateRows(cov);
  cov.visual_state_coverage.rows[0].captured = "フィルタの吹き出しを開いた状態";
  const conditions = {
    pageNames: ["受注一覧"],
    states: ["default", "フィルタの吹き出しを開いた状態"],
    popupStates: ["フィルタの吹き出しを開いた状態"],
  };
  const bad = reconcile(cov, bundled, conditions);
  expect(bad.ok).toBe(false);
  expect(bad.problems.join("\n")).toMatch(
    /page「TYPO」が metadata.json の capture_conditions.pages に無い/,
  );

  // 陽性コントロール: 宣言されたページ名なら通る（常に落とす実装を弾く）。
  cov.components[0].instances[0].page = "受注一覧";
  expect(reconcile(cov, bundled, conditions).problems).toEqual([]);

  // 誤記でスコープが割れないこと: 同じページの 2 部品が同じ状態名を使えば使い回しとして落ちる。
  const twoComponents = structuredClone(cov);
  twoComponents.components.push({
    id: "panel",
    profile: null,
    profile_absent_reason: "自作",
    items: [{ id: "menu", visual_states: ["opens-container"], no_visual_state_reason: null }],
    instances: [{ id: "side", page: "受注一覧", locator: "side.panel" }],
  });
  twoComponents.cells.push({
    component: "panel",
    item: "menu",
    instance: "side",
    value: "present",
    evidence: "実 UI で開いた",
    covered_by: ["e2e/order-list.spec.ts > menu"],
  });
  fillVisualStateRows(twoComponents);
  for (const row of twoComponents.visual_state_coverage.rows)
    row.captured = "フィルタの吹き出しを開いた状態";
  expect(reconcile(twoComponents, bundled, conditions).problems.join("\n")).toMatch(
    /撮影状態の使い回し/,
  );
});

test("metadata に capture_conditions.pages が無ければ読めたことにしない", () => {
  const withPages = {
    slug: "order-list",
    capture_conditions: { pages: [{ name: "受注一覧" }], states: ["default"], popup_inventory: [] },
  };
  expect(readCaptureConditions(withPages)).toMatchObject({
    slug: "order-list",
    pageNames: ["受注一覧"],
  });
  // pages キーの欠落を「照合しない」に倒さない。
  const noPages = structuredClone(withPages);
  delete noPages.capture_conditions.pages;
  expect(readCaptureConditions(noPages)).toBeNull();
});

test("撮影条件を渡したのにページ名一覧が無ければ照合しないに倒さない", () => {
  // 「読めない」を「比較しない」に倒すと、呼び出し側が pageNames を落とすだけで
  // ページ名の検査が消える（fail-open）。
  const cov = {
    slug: "order-list",
    components: [
      {
        id: "grid",
        profile: null,
        profile_absent_reason: "自作",
        items: [{ id: "filter", visual_states: ["opens-container"], no_visual_state_reason: null }],
        instances: [{ id: "orders", page: "受注一覧", locator: "orders.grid" }],
      },
    ],
    cells: [
      {
        component: "grid",
        item: "filter",
        instance: "orders",
        value: "present",
        evidence: "実 UI で開いた",
        covered_by: ["e2e/order-list.spec.ts > filter"],
      },
    ],
  };
  fillVisualStateRows(cov);
  cov.visual_state_coverage.rows[0].captured = "P";
  const base = { states: ["default", "P"], popupStates: ["P"] };
  const r = reconcile(cov, bundled, base);
  expect(r.ok).toBe(false);
  expect(r.problems.join("\n")).toMatch(/ページ名一覧を読めない/);
  // 陽性コントロール: 渡せば通る（常に落とす実装を弾く）。
  expect(reconcile(cov, bundled, { ...base, pageNames: ["受注一覧"] }).problems).toEqual([]);
});

test("要求元はルール id でまとめない（縮約は宣言・検証済みの同値クラス経由だけ）", () => {
  // datagrid の column-sort は column × sort-direction へ展開されるが、
  // sort-direction は reducible_axes に無く「代表 1 件では差分が見えなくなる」と制約が明示している。
  // ルール id でまとめると、その軸をクラス宣言も根拠もなしに畳んでしまう。
  const cov = datagridCoverage();
  const sortCandidates = cov.components[0].items
    .filter((i) => i.candidate.rule === "column-sort")
    .map((i) => i.id);
  expect(sortCandidates.length).toBeGreaterThan(1);
  const activeRows = cov.visual_state_coverage.rows.filter(
    (r) => r.kind === "active" && r.required_by.startsWith("column-sort/"),
  );
  expect(activeRows.map((r) => r.required_by).sort()).toEqual([...sortCandidates].sort());

  // 縮約してよい軸（column）で同値クラスを宣言すれば代表へ寄る。
  const byDirection = new Map();
  for (const item of cov.components[0].items) {
    if (item.candidate.rule !== "column-sort") continue;
    const dir = item.candidate.axes["sort-direction"];
    if (!byDirection.has(dir)) byDirection.set(dir, []);
    byDirection.get(dir).push(item.id);
  }
  const grouped = datagridCoverage();
  grouped.components[0].equivalence_classes = [...byDirection].map(([dir, ids]) => ({
    id: `sort-${dir}`,
    axis: "column",
    rationale: "両列とも同じセルレンダラ・同じ書式で描画されることを実 UI で確認した",
    members: ids.map((id) => `orders/${id}`),
    representative: `orders/${ids[0]}`,
  }));
  fillVisualStateRows(grouped);
  const groupedActive = grouped.visual_state_coverage.rows.filter(
    (r) => r.kind === "active" && r.required_by.startsWith("column-sort/"),
  );
  // 方向ごとに 1 行（代表）へ寄り、方向そのものは畳まれない。
  expect(groupedActive).toHaveLength(byDirection.size);
  expect(groupedActive.map((r) => r.required_by).sort()).toEqual(
    [...byDirection.values()].map((ids) => ids[0]).sort(),
  );

  // 縮約してはいけない軸で束ねたら、導出は寄せても reconcile が落とす（緑にはならない）。
  const illegal = datagridCoverage();
  illegal.components[0].equivalence_classes = [
    {
      id: "dir",
      axis: "sort-direction",
      rationale: "方向は同じに見える",
      members: sortCandidates.map((id) => `orders/${id}`),
      representative: `orders/${sortCandidates[0]}`,
    },
  ];
  resolveVisualStates(illegal);
  const r = reconcile(illegal, bundled, captureConditionsFor(illegal));
  expect(r.ok).toBe(false);
  expect(r.problems.join("\n")).toMatch(/軸 sort-direction は reducible_axes にない/);
});

// --- 集合の来歴と完全性（Issue #392 / #393）: 記録側 ---
//
// 判定側（coverage-check.mjs）と同じ検査を authoring 時にも当てる。片側だけが厳しいと
// 「記録側は conformance を出すのに判定側が収束させない」表が作れる。
// 補完ラッパを通さない reconcileRaw で呼ぶ（ラッパは宣言を埋めてしまう）。

test("記録側も 3 つの集合の来歴と完全性を要求する（宣言が無ければ未測定へ数える）", () => {
  // 陽性コントロール: 宣言が揃っていれば適合する（常に落とす実装を弾く）。
  const ok = reconcileRaw(fillSetProvenance(datagridCoverage()), bundled);
  expect(ok.problems).toEqual([]);
  expect(ok).toMatchObject({ ok: true, unmeasured: 0 });

  // 宣言が無い表は問題文だけでなく未測定として数える（記録側だけ未測定 0 を主張しない）。
  const bare = reconcileRaw(datagridCoverage(), bundled);
  expect(bare.ok).toBe(false);
  expect(bare.problems.join("\n")).toMatch(/component_inventory が無い/);
  expect(bare.problems.join("\n")).toMatch(/部品 grid の instance_inventory が無い/);
  expect(bare.problems.join("\n")).toMatch(/部品 grid.source が無い/);
  expect(bare.unmeasured).toBeGreaterThanOrEqual(2);

  // 語彙外の kind・完全性の未宣言も落とす。
  const invented = fillSetProvenance(datagridCoverage());
  invented.component_inventory.source.kind = "invented";
  expect(reconcileRaw(invented, bundled).problems.join("\n")).toMatch(
    /component_inventory.source.kind（invented）が current-source \/ config \/ app-ui のいずれでもない/,
  );

  const notDeclared = fillSetProvenance(datagridCoverage());
  delete notDeclared.components[0].instance_inventory.complete;
  expect(reconcileRaw(notDeclared, bundled).problems.join("\n")).toMatch(
    /instance_inventory.complete が true ではない/,
  );

  // 効いていない免除（complete: true なのに incomplete_reason が残っている）も判定側と同じく落とす。
  const staleReason = fillSetProvenance(datagridCoverage());
  staleReason.components[0].instance_inventory.incomplete_reason = "数え切れていない（古い記録）";
  expect(reconcileRaw(staleReason, bundled).problems.join("\n")).toMatch(
    /instance_inventory: complete: true なのに incomplete_reason が書かれている/,
  );

  // 一次情報源以外で列挙したら理由を要求する（読めるのに読んでいない側の経路）。
  const walked = fillSetProvenance(datagridCoverage());
  walked.component_inventory.source.kind = "app-ui";
  expect(reconcileRaw(walked, bundled).problems.join("\n")).toMatch(
    /app-ui で列挙したのに stronger_source_unavailable_reason が空/,
  );
  walked.component_inventory.stronger_source_unavailable_reason =
    "現行ソースは未受領で、画面しか参照できない";
  expect(reconcileRaw(walked, bundled).problems).toEqual([]);
});

test("列挙の来歴も一次情報源を使わなかった理由を要求する（readEnumeration）", () => {
  const profile = bundled.get("datagrid");

  // 陽性コントロール: current-source で列挙した記録は使える。
  expect(readEnumeration(enumeration(), profile, "t").usable).toBe(true);

  const walked = enumeration();
  walked.source.kind = "app-ui";
  walked.source.ref = "受注一覧を歩いた";
  const noReason = readEnumeration(walked, profile, "t");
  expect(noReason.usable).toBe(false);
  expect(noReason.problems.join("\n")).toMatch(
    /app-ui で列挙したのに stronger_source_unavailable_reason が空/,
  );

  // 理由を書けば使える（「読めなかった」を残せる形にする）。
  const declared = {
    ...walked,
    stronger_source_unavailable_reason: "グリッド定義が動的生成で追えない",
  };
  expect(readEnumeration(declared, profile, "t").usable).toBe(true);

  // 一次情報源を使ったのに理由が残っていれば効いていない免除として落とす。
  const stale = { ...enumeration(), stronger_source_unavailable_reason: "未受領（古い記録）" };
  const staleResult = readEnumeration(stale, profile, "t");
  expect(staleResult.usable).toBe(false);
  expect(staleResult.problems.join("\n")).toMatch(
    /current-source で列挙したのに stronger_source_unavailable_reason が書かれている/,
  );

  // complete: true なのに incomplete_reason が残る記録も同じ扱い（同じ表の中で「完全」と「未完了」を
  // 同時に主張させない）。集合の来歴だけに当てて列挙側を素通りさせない。
  const staleReason = {
    ...enumeration(),
    incomplete_reason: "列定義が動的生成で読み切れない（complete を true へ直したときの残り）",
  };
  const staleReasonResult = readEnumeration(staleReason, profile, "t");
  expect(staleReasonResult.usable).toBe(false);
  expect(staleReasonResult.problems.join("\n")).toMatch(
    /complete: true なのに incomplete_reason が書かれている/,
  );

  // 陽性コントロール: null / キー無しは通る（常に落とす実装を弾く）。
  expect(readEnumeration({ ...enumeration(), incomplete_reason: null }, profile, "t").usable).toBe(
    true,
  );
});

test("プロファイルの形式検査: enumeration.sources は強い順に並んでいなければ落とす", () => {
  const base = {
    id: "z2",
    version: "1",
    applies_to: "テスト用",
    axes: [{ id: "a", kind: "element", flags: ["on"] }],
    enumeration: {
      sources: ["current-source", "config", "app-ui"],
      procedure: "定義から a を抜く",
      pitfalls: ["隠れている a を落とす"],
      fail_closed: "読めなければ complete: false",
    },
    candidate_rules: [{ id: "r", axes: ["a"], guard: { "a.on": true }, visual_states: ["hover"] }],
    required_rules: ["r"],
    equivalence: { reducible_axes: ["a"] },
  };
  // 陽性コントロール: 強い順・部分集合はどちらも通る。
  expect(validateProfile(base, "z2.json")).toEqual([]);
  const subset = structuredClone(base);
  subset.enumeration.sources = ["current-source", "app-ui"];
  expect(validateProfile(subset, "z2.json")).toEqual([]);

  // 弱い情報源を先に書くと、いちばん弱いものだけで complete: true が通る形になる。
  const reversed = structuredClone(base);
  reversed.enumeration.sources = ["app-ui", "current-source"];
  expect(validateProfile(reversed, "z2.json").join("\n")).toMatch(
    /enumeration.sources が強い順（current-source → config → app-ui）に並んでいない、または重複している/,
  );

  const duplicated = structuredClone(base);
  duplicated.enumeration.sources = ["current-source", "current-source"];
  expect(validateProfile(duplicated, "z2.json").join("\n")).toMatch(/強い順/);

  const unknown = structuredClone(base);
  unknown.enumeration.sources = ["current-source", "vendor-spec"];
  expect(validateProfile(unknown, "z2.json").join("\n")).toMatch(
    /enumeration.sources に語彙外の値がある（vendor-spec）/,
  );

  // 型崩れを filter で落としてから検査すると、残った要素だけが語彙・順序の検査を通り、
  // 壊れた宣言が「適合」として配布される（実測: 42 / "" / ["app-ui"] / null はいずれも problems 0 だった）。
  for (const [malformed, pattern] of [
    [["current-source", 42, "app-ui"], /空でない文字列でない要素がある（42）/],
    [["current-source", "", "app-ui"], /空でない文字列でない要素がある（""）/],
    [["current-source", ["app-ui"]], /空でない文字列でない要素がある（\["app-ui"\]）/],
    [["current-source", null, "app-ui"], /空でない文字列でない要素がある（null）/],
  ]) {
    const broken = structuredClone(base);
    broken.enumeration.sources = malformed;
    expect(validateProfile(broken, "z2.json").join("\n")).toMatch(pattern);
  }

  // 配列でない sources は「空」ではなく型の問題として報告する（原因を取り違えさせない）。
  const notArray = structuredClone(base);
  notArray.enumeration.sources = "current-source";
  expect(validateProfile(notArray, "z2.json").join("\n")).toMatch(
    /enumeration.sources が配列ではない/,
  );
});
