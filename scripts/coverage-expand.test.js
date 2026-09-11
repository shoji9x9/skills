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
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repoRoot, "skills/parity-suite/scripts/coverage-expand.mjs");
const bundledProfiles = join(repoRoot, "skills/parity-suite/assets/coverage-profiles");
const { expandCandidates, loadProfiles, readEnumeration, reconcile, validateProfile } =
  await import(script);

const { profiles: bundled, problems: bundledProblems } = loadProfiles(bundledProfiles);

test("同梱プロファイルはすべてスキーマ検証を通る（壊れたまま配布しない）", () => {
  expect(bundledProblems).toEqual([]);
  expect(bundled.size).toBeGreaterThanOrEqual(1);
  expect(bundled.has("datagrid")).toBe(true);
});

/** DataGrid の列挙（列 2・メニュー対象 1・メニュー項目 2・条件 1）。 */
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
  return {
    slug: "order-list",
    components: [
      {
        id: "grid",
        profile: "datagrid",
        profile_version: "1",
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
  };
}

test("陽性コントロール: 候補が全てセルへ落ちていれば適合（常に落とす実装を弾く）", () => {
  const r = reconcile(datagridCoverage(), bundled);
  expect(r.problems).toEqual([]);
  expect(r.ok).toBe(true);
  // 列 2 の表示 ＋ price のフィルター ＋ 列 2 × 方向 3 のソート ＋ メニュー開閉 1 ＋ メニュー項目 2。
  expect(r.candidates).toBe(12);
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
  const keep = (id) => id.startsWith("column-");
  cov.components[0].items = cov.components[0].items.filter((i) => keep(i.id));
  inst.candidates = inst.candidates.filter(keep);
  cov.cells = cov.cells.filter((c) => keep(c.item));

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

test("要素が候補にならないことも根拠付きでだけ通す（要素スコープの免除）", () => {
  const cov = datagridCoverage();
  const inst = cov.components[0].instances[0];
  const column = inst.enumeration.elements.column[1];
  for (const key of Object.keys(column.flags)) column.flags[key] = false;
  const keep = (id) => !id.includes("/name");
  cov.components[0].items = cov.components[0].items.filter((i) => keep(i.id));
  inst.candidates = inst.candidates.filter(keep);
  cov.cells = cov.cells.filter((c) => keep(c.item));
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
    components: [
      {
        id: "chart",
        profile: null,
        profile_absent_reason: "Chart のプロファイルが未整備。gaps.md の未検証領域に記録した",
        items: [],
        instances: [],
      },
    ],
    cells: [],
  };
  const ok = reconcile(withReason, bundled);
  expect(ok.problems).toEqual([]);
  expect(ok.components[0]).toMatchObject({ component: "chart", profile: null, judged: false });
  // 理由が無ければ免除しない。
  const noReason = structuredClone(withReason);
  delete noReason.components[0].profile_absent_reason;
  expect(reconcile(noReason, bundled).problems.join("\n")).toMatch(/profile_absent_reason が空/);
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
    candidate_rules: [{ id: "r", axes: ["a"], guard: { "a.on": true } }],
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
    candidate_rules: [{ id: "r", axes: ["a"], guard: { "a.on": true } }],
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
  const root = mkdtempSync(join(tmpdir(), "coverage-expand-"));
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
  for (const [name, content] of Object.entries(files)) paths[name] = write(root, name, content);
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
      },
      { id: "node-select", name: "選択", axes: ["node"], guard: { "node.selectable": true } },
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
  const coverage = {
    slug: "org-tree",
    components: [
      {
        id: "tree",
        profile: "treeview",
        profile_version: "1",
        items: candidates.map((id) => ({
          id,
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
  const ok = runCli(["--profiles", "@profiles", "--coverage", "component-coverage.json"], {
    profiles: { "treeview.json": treeview },
    files: { "component-coverage.json": coverage },
  });
  expect(ok.stderr).toBe("");
  expect(ok.status).toBe(0);
  expect(JSON.parse(ok.stdout)).toMatchObject({ ok: true, candidates: 4, unmeasured: 0 });

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
  expect(written.components[0].instances[0].candidates).toHaveLength(12);
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
