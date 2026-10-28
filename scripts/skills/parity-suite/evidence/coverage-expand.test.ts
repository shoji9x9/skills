// 網羅プロファイル（parity-suite）の候補展開と照合の回帰テスト（Issue #286）。
//
// 防ぐ抜け: 網羅表は登録された項目しか数えないため、データグリッドで代表列だけを操作して
// 2 項目を登録すれば、他の列・非表示列・横スクロール先の列・コンテキストメニューは
// 期待セルにすら現れず、未測定 0 で収束できてしまう。
// 候補集合（列挙した構成要素から機械的に展開されるもの）と網羅集合の差分が残ることを確認する。
//
// 「新しい部品は共通処理と中心ドキュメントを変えずに足せる」ことも、
// 仮想部品のプロファイルを一時ディレクトリへ置いて照合させることで確認する。

import { assert, test, expect, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fillSetProvenance } from "../../../lib/testing/coverage-set-provenance-fixture.ts";
import { parseJsonAs } from "../../../lib/parse-as.ts";
import {
  expandCandidates,
  fillVisualStateRows,
  main,
  readEnumeration,
  reconcile as reconcileRaw,
  validateProfile,
} from "../../../../skills/parity-suite/scripts/coverage-expand.mjs";
import { invalidInput, removeField } from "../../../lib/testing/test-input.ts";
import { CHILD_TIMEOUT_MS } from "../../../lib/testing/child-timeout.ts";
import {
  bundled,
  bundledProblems,
  bundledProfile,
  bundledProfiles,
  captureConditionsFor,
  type Cell,
  chartCoverage,
  type Coverage,
  datagridCoverage,
  type EquivalenceClass,
  type ExpandedCandidate,
  expectBoxAndDisplayChecked,
  expectCandidateRecordRejected,
  expectComponentShapeRejected,
  expectDroppedStateRejected,
  expectGenericIdChecked,
  expectHiddenCauseChecked,
  expectIllegalAxisGroupingRejected,
  expectItemAndInstanceShapeRejected,
  expectItemVisualStatesFromProfile,
  expectLocatorRecordChecked,
  expectPartiallyAbsentAccepted,
  expectRejected,
  expectRowsSplitByRequirer,
  expectSharedAcrossPagesAccepted,
  expectSharedCaptureJustified,
  expectStateSourceKindChecked,
  expectUnusableMetadataRejected,
  expectVisualStateTypoNotSplit,
  firedAbsentCoverage,
  type FiredEvidence,
  firedEvidenceOf,
  firstEvidence,
  firstManifest,
  firstState,
  type GenericCoverage,
  genericCoverage,
  hiddenBySelf,
  type Item,
  metadataFor,
  minimalProfile,
  namedPopupCoverage,
  nonRenderableCoverage,
  type Profile,
  profileProblems,
  type Profiles,
  resolveVisualStates,
  rowsOf,
  runCli,
  script,
  sharedPopupCoverage,
  sourcesOrderProfile,
  treeviewCandidates,
  treeviewCoverage,
  treeviewMetadata,
  treeviewProfile,
  typoPageCoverage,
} from "./coverage-expand-helpers.ts";
import {
  componentInventory,
  datagridEnumeration,
  findOrFail,
  instanceInventory,
  reconcile,
} from "../../_cross/coverage-fixture-helpers.ts";

test("同梱プロファイルはすべてスキーマ検証を通る（不正なまま配布しない）", () => {
  expect(bundledProblems).toEqual([]);
  expect(bundled.size).toBeGreaterThanOrEqual(1);
  expect(bundled.has("datagrid")).toBe(true);
});

test("誤検知しないことの確認: 候補が全てセルへ落ちていれば適合（常に落とす実装を弾く）", () => {
  const r = reconcile(datagridCoverage(), bundled);
  expect(r.problems).toEqual([]);
  expect(r.ok).toBe(true);
  // 列 2 の表示 ＋ price のフィルター ＋ 列 2 × 方向 3 のソート ＋ 複数列の並べ替え 1 組 × 先の列の向き 2 × 足した列の向き 3
  // ＋ 行の選択 1 手段 × 列 2 ＋ メニュー開閉 1 ＋ メニュー項目 2。
  // 初期非表示で表示切替できる列が無いので row-select-revealed は候補を生まない。
  expect(r.candidates).toBe(20);
  expect(r.unmeasured).toBe(0);
});

test("代表列だけを確認した網羅表は欠落として失敗する", () => {
  const cov = datagridCoverage();
  const c = cov.components[0];
  const keep = (id: string) => id.includes("/price");
  c.items = c.items.filter((i) => keep(i.id));
  c.instances[0].candidates = c.instances[0].candidates.filter(keep);
  cov.cells = cov.cells.filter((x) => keep(x.item));
  const r = reconcile(cov, bundled);
  expect(r.ok).toBe(false);
  expect(r.problems.join("\n")).toMatch(/候補 column-visible\/name に対応する項目が網羅表に無い/);
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

test("列挙した要素がどの候補にも現れなければ失敗する（フラグの記録忘れを落とす）", () => {
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
  ] satisfies [(cell: Cell) => unknown, RegExp | null][]) {
    const cov = datagridCoverage();
    mutate(cov.cells[0]);
    const r = reconcile(cov, bundled);
    expect(r.ok).toBe(false);
    expect(r.unmeasured).toBe(1);
    if (pattern) expect(r.problems.join("\n")).toMatch(pattern);
  }
});

test("候補由来の非描画 absent も全状態の機械可読証拠を検査する", () => {
  const cov = nonRenderableCoverage();
  expect(reconcile(cov, bundled)).toMatchObject({ ok: true, unmeasured: 0 });

  delete firstState(cov.cells[0]).offset_parent;
  const invalid = reconcile(cov, bundled);
  expect(invalid).toMatchObject({ ok: false, unmeasured: 1 });
  expect(invalid.problems.join("\n")).toMatch(/offset_parent/);

  expectHiddenCauseChecked(cov);

  expectBoxAndDisplayChecked(cov);

  expectPartiallyAbsentAccepted(cov);

  expectLocatorRecordChecked(cov);

  expectStateSourceKindChecked(cov);
});

test("候補由来の fired-without-response も送り方・発火確認・観測結果を構造化して検査する", () => {
  // 通ることの確認: 実測が揃えば absent として通る
  expect(reconcile(firedAbsentCoverage(), bundled)).toMatchObject({ ok: true, unmeasured: 0 });

  for (const [mutate, pattern] of [
    // わざと action を欠落させる
    [(e) => removeField(e, "action"), /fired-without-response/],
    [(e) => (e.action.method = "guess"), /action\.method/],
    // 型崩れが allowlist を通ると、coordinate 専用の hit-test 検査を回避できる
    // わざと文字列ではない値を入れる
    [(e) => (e.action.method = invalidInput(["coordinate"])), /action\.method/],
    [(e) => (e.fired.signal = invalidInput(["event-listener"])), /fired\.signal/],
    [(e) => (e.action.bounding_box.width = 0), /幅・高さが正ではない/],
    [(e) => (e.action.hit_test_is_target_or_descendant = false), /hit-test/],
    [(e) => (e.fired.verified = false), /発火確認/],
    [(e) => (e.action.visible = false), /action\.visible/],
    [(e) => (e.action.actionability_bypassed = true), /actionability_bypassed/],
    [(e) => (e.observation = "  "), /observation/],
  ] satisfies [(e: FiredEvidence) => unknown, RegExp][]) {
    const cov = firedAbsentCoverage();
    // firedAbsentCoverage() が入れた fired-without-response の証拠
    mutate(firedEvidenceOf(cov.cells[0]));
    const r = reconcile(cov, bundled);
    expect(r).toMatchObject({ ok: false, unmeasured: 1 });
    expect(r.problems.join("\n")).toMatch(pattern);
  }
});

test("プロファイルを宣言しない部品のセルも候補の処理と同じ規則で採点する", () => {
  // 記録側だけ通る表を作らない。片方だけ検査すると conformance.ok を出した表を収束側が弾く
  const broken = reconcile(genericCoverage(), bundled);
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
  ] satisfies [(c: GenericCoverage) => unknown, RegExp][]) {
    const cov = genericCoverage();
    mutate(cov);
    const r = reconcile(cov, bundled);
    expect(r.ok).toBe(false);
    expect(r.problems.join("\n")).toMatch(pattern);
  }

  // 通ることの確認: 正しく測れていれば通る（常に落とす実装を弾く）
  const good = genericCoverage();
  good.cells[0].value = "present";
  good.cells[0].covered_by = ["e2e/parity/order-list.spec.ts > ctx menu"];
  good.cells[0].absence_evidence = null;
  expect(reconcile(good, bundled)).toMatchObject({ ok: true, unmeasured: 0 });

  expectGenericIdChecked(good);
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

/**
 * 網羅表の最初の部品とインスタンスから、keep に当たらない項目・候補・セルを外す。
 * 測る操作を削ると撮影状態の要求も変わるので、導出し直す。直さないと古い行が残り、テストの対象と無関係な problem が含まれる。
 */
function dropItems(cov: ReturnType<typeof datagridCoverage>, keep: (id: string) => boolean) {
  const inst = cov.components[0].instances[0];
  cov.components[0].items = cov.components[0].items.filter((i) => keep(i.id));
  inst.candidates = inst.candidates.filter(keep);
  cov.cells = cov.cells.filter((c) => c.component !== cov.components[0].id || keep(c.item));
  resolveVisualStates(cov);
}

test("必須ルールの候補ゼロは justified_absences の根拠付きでだけ通す（行き止まりにしない）", () => {
  const cov = datagridCoverage();
  const inst = cov.components[0].instances[0];
  // 右クリックメニューを一切持たないグリッド。列挙は済ませたうえで対象が 0 件。
  for (const axis of ["menu-target", "menu-item", "menu-condition"]) {
    inst.enumeration.elements[axis] = [];
  }
  dropItems(cov, (id) => !id.startsWith("context-menu-"));

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
    dropItems(cov, (id) => !id.startsWith(`${rule}/`));

    const bare = reconcile(cov, bundled);
    expect(bare.ok).toBe(false);
    expect(bare.problems.join("\n")).toContain(`必須ルール ${label} の候補が 0 件`);

    inst.enumeration.justified_absences = [
      {
        scope: axis,
        reason:
          "行番号・チェックボックス・修飾キー付きのクリックを実 UI で試し、機能しないことを確かめた",
      },
    ];
    expect(reconcile(cov, bundled).problems).toEqual([]);
  }
});

test("必須ルールの代替の組は、どれか 1 つが候補を生めば満たす（全列が初期非表示のグリッド。Codex レビュー）", () => {
  // 全列が初期非表示で表示切替できるグリッドは row-select の候補を生まず、row-select-revealed だけが立つ。
  // 行を選ぶ手段も列も実在するので justified_absences では通せない。組にしないと行き止まりになる。
  const profile = bundledProfile("datagrid");
  const cov = datagridCoverage();
  const inst = cov.components[0].instances[0];
  for (const col of inst.enumeration.elements.column) {
    col.flags.initially_visible = false;
    col.flags.toggleable = true;
  }
  const { elements } = readEnumeration(inst.enumeration, profile, "t");
  const candidates: ExpandedCandidate[] = expandCandidates(profile, elements);
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
  // row-select-revealed は column が実在するので根拠にならず、組として列挙の抜けと区別できない。
  const dg = structuredClone(bundledProfile("datagrid"));
  findOrFail(
    dg.candidate_rules,
    (r) => r.id === "row-select-revealed",
    "candidate_rules の row-select-revealed",
  ).axes = ["column"];
  const profiles: Profiles = new Map(bundled);
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
  const keep = (id: string) => !id.startsWith("row-select/");
  cov.components[0].items = cov.components[0].items.filter((i) => keep(i.id));
  inst.candidates = inst.candidates.filter(keep);
  cov.cells = cov.cells.filter((c) => keep(c.item));
  resolveVisualStates(cov);
  expect(reconcile(cov, profiles).problems.join("\n")).toContain(
    "必須ルール row-select / row-select-revealed の候補が 0 件",
  );
});

test("required_rules の代替の組の形を検査する", () => {
  const profile = structuredClone(bundledProfile("datagrid"));
  expect(validateProfile(profile, "d.json")).toEqual([]);
  // 引くのは同梱の datagrid に在るルールだけ
  const rule = (p: Profile, id: string) =>
    findOrFail(p.candidate_rules, (r) => r.id === id, `candidate_rules の ${id}`);
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
  ] satisfies [(string | string[])[], RegExp, ((p: Profile) => unknown)?][]) {
    const p = structuredClone(profile);
    p.required_rules = bad;
    tweak?.(p);
    expect(validateProfile(p, "d.json").join("\n")).toMatch(pattern);
  }
});

test("初期非表示で表示切替できる列にも、行の選択の塗りの候補が立つ（Issue #471 レビュー）", () => {
  // 列を出してから行を選ぶ操作。初期表示の列だけを候補にすると、出した列の塗りの差が撮られない。
  const profile = bundledProfile("datagrid");
  const en = datagridEnumeration();
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
  const ids: string[] = expandCandidates(profile, elements).map((c: ExpandedCandidate) => c.id);
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
  const keep = (id: string) => !id.includes("/name");
  cov.components[0].items = cov.components[0].items.filter((i) => keep(i.id));
  inst.candidates = inst.candidates.filter(keep);
  cov.cells = cov.cells.filter((c) => keep(c.item));
  // 測る候補を削ったので撮影状態の要求も変わる。導出し直さないと古い行が余剰として残り、
  // このテストの被験対象（要素スコープの免除）と無関係な problem が含まれる。
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

test("使われない justified_absences は残さない（古い免除が機能して見える状態を作らない）", () => {
  const cov = datagridCoverage();
  cov.components[0].instances[0].enumeration.justified_absences = [
    { scope: "column/price", reason: "もう成り立たない根拠" },
  ];
  expect(reconcile(cov, bundled).problems.join("\n")).toMatch(
    /justified_absences の column\/price は有効になっていない/,
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

test("出所（enumeration.source）の欠落は失敗させる", () => {
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
  // わざと理由を欠落させる
  removeField(noReason.components[0], "profile_absent_reason");
  expect(reconcile(noReason, bundled).problems.join("\n")).toMatch(/profile_absent_reason が空/);
});

test("列挙が空・部品 id の重複・宣言に無い行は記録側でも失敗として扱う", () => {
  // いずれも判定側（coverage-check.mjs）が弾く条件。記録側だけ通ると conformance.ok が意味を失う。
  // 通ることの確認: 正しく測れていれば通る
  expect(reconcile(chartCoverage(), bundled)).toMatchObject({ ok: true, unmeasured: 0 });

  const emptyItems = chartCoverage();
  emptyItems.components[0].items = [];
  emptyItems.cells = [];
  const emptyResult = reconcile(emptyItems, bundled);
  expect(emptyResult).toMatchObject({ ok: false, unmeasured: 1 });
  expect(emptyResult.problems.join("\n")).toMatch(/items または instances が空/);

  const duplicated = chartCoverage();
  duplicated.components.push(structuredClone(duplicated.components[0]));
  const dupResult = reconcile(duplicated, bundled);
  expect(dupResult.ok).toBe(false);
  expect(dupResult.unmeasured).toBeGreaterThan(0);
  expect(dupResult.problems.join("\n")).toMatch(/id chart が重複している/);

  const stale = chartCoverage();
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
  const key = (id: string) => `orders/${id}`;
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

  // 通ることの確認: 列軸で束ね、全候補を過不足なく分類すれば通る。
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
  const key = (id: string) => `orders/${id}`;
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
  const base: Profile = { ...minimalProfile(), id: "x" };
  expect(validateProfile(base, "x.json")).toEqual([]);
  const typo = structuredClone(base);
  typo.candidate_rules[0].guard = { "a.onn": true };
  // 誤記したフラグ名は「該当なし」＝候補ゼロでエラーにならずに通るため、形式検査で落とす。
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
  // どの列挙元でも通ってしまう（判定できないのに合格になる）。配布前に形式検査で落とす。
  const base: Profile = { ...minimalProfile(), id: "y" };
  expect(validateProfile(base, "y.json")).toEqual([]);
  const missing = structuredClone(base);
  // わざと enumeration を欠落させる
  removeField(missing, "enumeration");
  expect(validateProfile(missing, "y.json").join("\n")).toMatch(/enumeration が無い/);
  for (const [mutate, pattern] of [
    [(p) => (p.enumeration.sources = []), /sources が空/],
    [(p) => (p.enumeration.procedure = "  "), /procedure が空/],
    [(p) => (p.enumeration.fail_closed = "  "), /fail_closed が空/],
    [(p) => (p.enumeration.pitfalls = []), /pitfalls が空/],
  ] satisfies [(p: Profile) => unknown, RegExp][]) {
    const broken = structuredClone(base);
    mutate(broken);
    expect(validateProfile(broken, "y.json").join("\n")).toMatch(pattern);
  }
});

test("新しい仮想部品のプロファイルを、共通処理と中心ドキュメントを変えずに追加できる", () => {
  // DataGrid に一切似ていない仮想部品（ノードと展開状態を軸に持つツリー）。
  // coverage-expand.mjs にも references/coverage-profiles.md にも手を入れていない。
  const treeview = treeviewProfile();
  const candidates = treeviewCandidates();
  const coverage = treeviewCoverage(candidates);
  const metadata = treeviewMetadata(candidates);
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

  // 落ちることの確認: 同じ仮想部品でノードを 1 つ落とすと失敗する（常に通す実装を弾く）。
  const short = structuredClone(coverage);
  short.components[0].items = short.components[0].items.filter((i) => i.id !== "node-select/leaf");
  short.components[0].instances[0].candidates = candidates.filter((i) => i !== "node-select/leaf");
  short.cells = short.cells.filter((c) => c.item !== "node-select/leaf");
  const bad = runCli(["--profiles", "@profiles", "--coverage", "component-coverage.json"], {
    profiles: { "treeview.json": treeview },
    files: { "component-coverage.json": short },
  });
  expect(bad.status).toBe(1);
  expect(bad.stderr).toMatch(/候補 node-select\/leaf に対応する項目が網羅表に無い/);
});

test("不正なプロファイルを警告なしに無視せず exit 2 で落ちる（候補ゼロで素通りさせない）", () => {
  const r = runCli(["--profiles", "@profiles", "--coverage", "component-coverage.json"], {
    profiles: { "broken.json": "{ not json" },
    files: { "component-coverage.json": datagridCoverage() },
  });
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/JSON として読めない/);
});

test("プロファイルが 1 件も読めない場合も合格として扱わない", () => {
  const r = runCli(["--profiles", "@profiles", "--coverage", "component-coverage.json"], {
    files: { "component-coverage.json": datagridCoverage() },
  });
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/プロファイルが 1 件も読み込めなかった/);
});

test("CLI --write は candidates と conformance を書き戻す（測定値には触れない）", () => {
  const cov = datagridCoverage();
  // 書き戻し前は candidates を持たない状態にしておく。
  // わざと candidates を欠落させる
  removeField(cov.components[0].instances[0], "candidates");
  const r = runCli(
    ["--coverage", "component-coverage.json", "--write", "--profiles", bundledProfiles],
    {
      files: { "component-coverage.json": cov },
    },
  );
  expect(r.status).toBe(0);
  const written = parseJsonAs<{
    components: Array<{ instances: Array<{ candidates: unknown[] }> }>;
    conformance: unknown;
    cells: unknown[];
  }>(readFileSync(r.paths["component-coverage.json"], "utf8"));
  expect(written.components[0].instances[0].candidates).toHaveLength(20);
  expect(written.conformance).toMatchObject({ tool: "coverage-expand", ok: true, unmeasured: 0 });
  // 測定値は書き換えない。
  expect(written.cells[0]).toMatchObject({ value: "present" });
});

test("CLI: 引数不足・重複指定は exit 2", () => {
  expect(
    spawnSync(process.execPath, [script], { timeout: CHILD_TIMEOUT_MS, encoding: "utf8" }).status,
  ).toBe(2);
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
  const r = spawnSync(process.execPath, [script, "--list-profiles"], {
    timeout: CHILD_TIMEOUT_MS,
    encoding: "utf8",
  });
  expect(r.status).toBe(0);
  expect(
    parseJsonAs<{ profiles: Array<{ id: string }> }>(r.stdout).profiles.map((p) => p.id),
  ).toContain("datagrid");
});

// ===== 撮影状態の導出（Issue #389） =====
//
// 防ぐ抜け: 撮る状態の集合が「思いついた分」で決まり、部品網羅表に並んだ操作と結び付いていなかった。
// 撮っていない状態には差が出ず、差分ツールは撮った 2 枚しか比べないので、集合の不足は「差 0 件」と
// 同じ見え方になる（素通りと見分けが付かない）。測った操作から必要な状態を導き、
// capture_conditions.states との差を撮る前に報告できることを確認する。

test("網羅表の操作から撮影状態を導く（種別はプロファイルで定義する）", () => {
  const cov = datagridCoverage();
  const kinds = cov.visual_state_coverage.rows.map((r) => r.kind);
  // コンテナを開く・指を乗せる・焦点を当てる・押している最中・不活性の 5 種と、
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
  expectRowsSplitByRequirer(cov);
  expectItemVisualStatesFromProfile(cov);
});

test("測っていない操作は撮影状態を要求しない（absent / unmeasured で行が立たない）", () => {
  const cov = datagridCoverage();
  // disabled を要求するのは context-menu-item だけ。そのセルを absent として扱うと行が消える。
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
  const row = findOrFail(
    cov.visual_state_coverage.rows,
    (r) => r.kind === "disabled",
    "disabled の行",
  );
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
  // 通ることの確認: 揃っていれば通る。
  expect(reconcile(cov, bundled, conditions).problems).toEqual([]);

  // 状態名は実データから取得する（ルール id ではなく候補 id が要求元になる）。
  const anySortHover = findOrFail(
    cov.visual_state_coverage.rows,
    (row) => row.kind === "hover" && row.required_by.startsWith("column-sort/"),
    "column-sort の hover の行",
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

  // コンテナを開く状態は states に在るだけでは足りない。コンテナの棚卸しにも行が要る。
  const noInventory = { ...conditions, popupStates: [] };
  const inv = reconcile(cov, bundled, noInventory);
  expect(inv.ok).toBe(false);
  expect(inv.problems.join("\n")).toMatch(/popup_inventory\[\].captured に無い/);
});

test("--metadata 無しの実行は照合済みとして扱わない（checked: false のまま）", () => {
  const cov = datagridCoverage();
  const r = reconcile(cov, bundled);
  expect(r.visualStates.checked).toBe(false);
  // 状態名を突き合わせないだけで、未決の検出は機能する。
  expect(r.problems).toEqual([]);
  expect(reconcile(cov, bundled, captureConditionsFor(cov)).visualStates.checked).toBe(true);
});

test("記録された行は導いた集合と過不足なく一致していなければならない", () => {
  const stale = datagridCoverage();
  stale.visual_state_coverage.rows.push({
    component: "grid",
    instance: "orders",
    kind: "hover",
    required_by: findOrFail(
      stale.visual_state_coverage.rows,
      (row) => row.kind === "hover",
      "hover の行",
    ).required_by,
    captured: findOrFail(
      stale.visual_state_coverage.rows,
      (row) => row.kind === "hover",
      "hover の行",
    ).captured,
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
    /撮影状態が導出から外れている: grid \/ orders \/ column-sort\/[^ ]* \/ focus/,
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
  // わざと visual_state_coverage を欠落させる
  removeField(noKey, "visual_state_coverage");
  expect(reconcile(noKey, bundled, captureConditionsFor(noKey)).problems.join("\n")).toMatch(
    /visual_state_coverage.rows が無い/,
  );
});

test("--write は撮る／撮らないの判断を引き継ぎ、要求の消えた行だけ落とす", () => {
  const cov = datagridCoverage();
  const decided = findOrFail(
    cov.visual_state_coverage.rows,
    (r) => r.kind === "hover",
    "hover の行",
  );
  decided.captured = null;
  decided.reason = "一覧のどの行にも hover の見た目が無いことを実 UI で確認した";
  // 同じキーの行は判断を引き継ぐ。
  fillVisualStateRows(cov);
  expect(cov.visual_state_coverage.rows.find((r) => r.kind === "hover")).toMatchObject({
    captured: null,
    reason: "一覧のどの行にも hover の見た目が無いことを実 UI で確認した",
  });
  // 同じキーが重複していたらどちらの判断も引き継がない（警告なしに一方を採ると判断が消える）。
  cov.visual_state_coverage.rows.push({
    ...findOrFail(cov.visual_state_coverage.rows, (r) => r.kind === "hover", "hover の行"),
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
  ] satisfies [(i: Item) => unknown, RegExp][]) {
    const cov = datagridCoverage();
    mutate(
      findOrFail(
        cov.components[0].items,
        (i) => i.candidate.rule === "column-sort",
        "column-sort の項目",
      ),
    );
    const r = reconcile(cov, bundled, captureConditionsFor(cov));
    expect(r.ok).toBe(false);
    expect(r.problems.join("\n")).toMatch(pattern);
  }

  expectVisualStateTypoNotSplit();
});

test("プロファイルは visual_states の宣言を省略できない（未宣言の状態が警告なしに外れない）", () => {
  const base: Profile = { ...minimalProfile(), id: "z" };
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
  ] satisfies [(p: Profile) => unknown, RegExp][]) {
    const p = structuredClone(base);
    mutate(p);
    expect(validateProfile(p, "z.json").join("\n")).toMatch(pattern);
  }
});

test("CLI: --metadata を渡すと撮影状態まで照合し、読めない metadata は合格として扱わない", () => {
  const cov = datagridCoverage();
  const metadata = metadataFor(cov);
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
  expect(parseJsonAs<{ visual_states: unknown }>(ok.stdout).visual_states).toMatchObject({
    checked: true,
    undecided: 0,
  });

  expectDroppedStateRejected(cov, metadata);

  expectUnusableMetadataRejected(cov, metadata);

  // --metadata 無しは通るが、照合していないことを警告する。
  const unchecked = runCli(
    ["--coverage", "component-coverage.json", "--profiles", bundledProfiles],
    { files: { "component-coverage.json": cov } },
  );
  expect(unchecked.status).toBe(0);
  expect(
    parseJsonAs<{ visual_states: { checked: unknown } }>(unchecked.stdout).visual_states.checked,
  ).toBe(false);
  expect(unchecked.stderr).toMatch(/--metadata が無いため撮影状態を/);
});

test("同じ種別を要求する別の操作を 1 行へ束ねない（片方だけ撮ってチェックが通らない）", () => {
  // 列フィルタの吹き出しと右クリックメニューはどちらも opens-container を要求する。
  // 種別だけで束ねると 1 行になり、片方の状態名を書くだけで 誤って undecided 0 と判定される。
  // 撮られなかったコンテナの差は「差 0 件」と同じ見え方になり、この導出で防ぐはずの抜けが残る。
  const cov = namedPopupCoverage();
  fillVisualStateRows(cov);
  expect(rowsOf(cov)).toHaveLength(2);

  // 片方だけ決めても通さない。
  findOrFail(rowsOf(cov), (r) => r.required_by === "filter-popup", "filter-popup の行").captured =
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

  // 通ることの確認: 両方を別の状態名で決めれば通る（常に落とす実装を弾く）。
  findOrFail(rowsOf(cov), (r) => r.required_by === "ctx-menu", "ctx-menu の行").captured =
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
  const onePopup = {
    pageNames: ["受注一覧"],
    states: ["default", "only-one-popup"],
    popupStates: ["only-one-popup"],
  };

  // 陰性: 2 操作が同じ状態名を指すと落ちる。
  const shared = sharedPopupCoverage();
  fillVisualStateRows(shared);
  for (const row of rowsOf(shared)) row.captured = "only-one-popup";
  const bad = reconcile(shared, bundled, onePopup);
  expect(bad.ok).toBe(false);
  expect(bad.visualStates.undecided).toBe(2);
  expect(bad.problems.join("\n")).toMatch(/撮影状態の使い回し/);

  // 陽性: 別の状態名にすれば通る（常に落とす実装を弾く）。
  const distinct = sharedPopupCoverage();
  fillVisualStateRows(distinct);
  const names: Record<string, string> = {
    "filter-popup": "フィルタの吹き出しを開いた状態",
    "ctx-menu": "右クリックメニューを開いた状態",
  };
  for (const row of rowsOf(distinct)) row.captured = names[row.required_by];
  expect(
    reconcile(distinct, bundled, {
      pageNames: ["受注一覧"],
      states: ["default", ...Object.values(names)],
      popupStates: Object.values(names),
    }).problems,
  ).toEqual([]);

  expectSharedCaptureJustified(onePopup);

  // --metadata 無しでも使い回しは検出する（構造の問題なので撮影条件に依らない）。
  expect(reconcile(shared, bundled).problems.join("\n")).toMatch(/撮影状態の使い回し/);

  expectSharedAcrossPagesAccepted(names);
});

test("--write は人が埋める欄を全部引き継ぐ（逃げ道が書き戻しで消えない）", () => {
  // shared_capture_reason を引き継がないと、手順 8 で必ず通す --write が根拠を消し、
  // 同じ実行の照合が「根拠なしの使い回し」で落ちる。逃げ道が構造的に死ぬ。
  const cov = sharedPopupCoverage();
  fillVisualStateRows(cov);
  for (const row of rowsOf(cov)) {
    row.captured = "only-one-popup";
    row.shared_capture_reason = "どちらの操作も同一のダイアログを開くことを実 UI で確認した";
    row.reason = null;
  }
  // 書き戻しても人の判断は残る。
  fillVisualStateRows(cov);
  expect(rowsOf(cov).map((r) => r.shared_capture_reason)).toEqual([
    "どちらの操作も同一のダイアログを開くことを実 UI で確認した",
    "どちらの操作も同一のダイアログを開くことを実 UI で確認した",
  ]);
  expect(
    reconcile(cov, bundled, {
      pageNames: ["受注一覧"],
      states: ["default", "only-one-popup"],
      popupStates: ["only-one-popup"],
    }).problems,
  ).toEqual([]);
});

test("page が無いインスタンスは撮影単位を決められないので落とす（狭いスコープとして扱わない）", () => {
  // page が撮影単位（ページ × 状態名 × ビューポート）を決めるキー。
  // 欠落を「そのインスタンスだけの重複を見る」として扱うと、同じページに載る別部品どうしが
  // 根拠なく状態名を使い回しても通ってしまう。
  const cov: GenericCoverage = {
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
  for (const row of rowsOf(cov)) row.captured = "only-one-popup";
  const conditions = {
    pageNames: ["受注一覧", "サイドパネルのページ"],
    states: ["default", "only-one-popup"],
    popupStates: ["only-one-popup"],
  };
  const bad = reconcile(cov, bundled, conditions);
  expect(bad.ok).toBe(false);
  expect(bad.problems.join("\n")).toMatch(/page が無い/);

  // 落ちることの確認: page を書けば、同じページの別部品どうしの使い回しとして落ちる。
  for (const component of cov.components) component.instances[0].page = "受注一覧";
  expect(reconcile(cov, bundled, conditions).problems.join("\n")).toMatch(/撮影状態の使い回し/);

  // 別ページなら通る（撮影単位が違う）。
  cov.components[1].instances[0].page = "サイドパネルのページ";
  expect(reconcile(cov, bundled, conditions).problems).toEqual([]);
});

test("インスタンスの page は宣言されたページ名でなければ通さない（非空なだけで受理しない）", () => {
  // 採取は metadata の capture_conditions.pages を外側のループにして回るので、
  // 宣言に無いページ名（誤記・旧称）を書いた行はどのページでも撮られない。
  // 誤記は使い回しの判定単位も割るため、共有すべきスコープが警告なしに分かれる。
  const cov = typoPageCoverage();
  fillVisualStateRows(cov);
  rowsOf(cov)[0].captured = "フィルタの吹き出しを開いた状態";
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

  // 通ることの確認: 宣言されたページ名なら通る（常に落とす実装を弾く）。
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
  for (const row of rowsOf(twoComponents)) row.captured = "フィルタの吹き出しを開いた状態";
  expect(reconcile(twoComponents, bundled, conditions).problems.join("\n")).toMatch(
    /撮影状態の使い回し/,
  );
});

test("metadata に capture_conditions.pages が無ければ読めたことにしない", () => {
  const cov = datagridCoverage();
  const run = (metadata: unknown) =>
    runCli(
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
  // 通ることの確認: pages を持つ metadata なら撮影状態まで照合して通る。
  const withPages = metadataFor(cov);
  const ok = run(withPages);
  expect(ok.status).toBe(0);
  expect(
    parseJsonAs<{ visual_states: { checked: unknown } }>(ok.stdout).visual_states.checked,
  ).toBe(true);
  // pages キーの欠落を「照合しない」として扱わず、使い方の誤りとして exit 2 にする。
  const noPages = structuredClone(withPages);
  // わざと pages を欠落させる
  removeField(noPages.capture_conditions, "pages");
  const broken = run(noPages);
  expect(broken.status).toBe(2);
  expect(broken.stderr).toMatch(/metadata に slug、または capture_conditions/);
});

test("撮影条件を渡したのにページ名一覧が無ければ照合しない扱いにしない", () => {
  // 「読めない」を「比較しない」として扱うと、呼び出し側が pageNames を落とすだけで
  // ページ名の検査が消え、合格になってしまう。
  const cov: GenericCoverage = {
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
  rowsOf(cov)[0].captured = "P";
  const base = { states: ["default", "P"], popupStates: ["P"] };
  // わざと pageNames を欠いた撮影条件を渡す
  const r = reconcile(cov, bundled, invalidInput(base));
  expect(r.ok).toBe(false);
  expect(r.problems.join("\n")).toMatch(/ページ名一覧を読めない/);
  // 通ることの確認: 渡せば通る（常に落とす実装を弾く）。
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
  const byDirection = new Map<string, string[]>();
  for (const item of cov.components[0].items) {
    if (item.candidate.rule !== "column-sort") continue;
    const dir = item.candidate.axes["sort-direction"];
    const ids = byDirection.get(dir) ?? [];
    ids.push(item.id);
    byDirection.set(dir, ids);
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

  expectIllegalAxisGroupingRejected(sortCandidates);
});

// --- 集合の出所と完全性（Issue #392 / #393）: 記録側 ---
//
// 判定側（coverage-check.mjs）と同じ検査を authoring 時にも当てる。片側だけが厳しいと
// 「記録側は conformance を出すのに判定側が収束させない」表が作れる。
// 補完ラッパを通さない reconcileRaw で呼ぶ（ラッパは宣言を埋めてしまう）。

test("記録側も 3 つの集合の出所と完全性を要求する（宣言が無ければ未測定へ数える）", () => {
  // 通ることの確認: 宣言が揃っていれば適合する（常に落とす実装を弾く）。
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
  // component_inventory は fillSetProvenance が埋めた
  componentInventory(invented).source.kind = "invented";
  expect(reconcileRaw(invented, bundled).problems.join("\n")).toMatch(
    /component_inventory.source.kind（invented）が current-source \/ config \/ app-ui のいずれでもない/,
  );

  const notDeclared = fillSetProvenance(datagridCoverage());
  // instance_inventory は fillSetProvenance が埋めた
  delete instanceInventory(notDeclared.components[0]).complete;
  expect(reconcileRaw(notDeclared, bundled).problems.join("\n")).toMatch(
    /instance_inventory.complete が true ではない/,
  );

  // 機能していない免除（complete: true なのに incomplete_reason が残っている）も判定側と同じく落とす。
  const staleReason = fillSetProvenance(datagridCoverage());
  instanceInventory(staleReason.components[0]).incomplete_reason = "数え切れていない（古い記録）";
  expect(reconcileRaw(staleReason, bundled).problems.join("\n")).toMatch(
    /instance_inventory: complete: true なのに incomplete_reason が書かれている/,
  );

  // 一次の情報源以外で列挙したら理由を要求する（読めるのに読んでいない場合）。
  const walked = fillSetProvenance(datagridCoverage());
  componentInventory(walked).source.kind = "app-ui";
  expect(reconcileRaw(walked, bundled).problems.join("\n")).toMatch(
    /app-ui で列挙したのに stronger_source_unavailable_reason が空/,
  );
  componentInventory(walked).stronger_source_unavailable_reason =
    "現行ソースは未受領で、画面しか参照できない";
  expect(reconcileRaw(walked, bundled).problems).toEqual([]);
});

test("列挙の出所も一次情報源を使わなかった理由を要求する（readEnumeration）", () => {
  const profile = bundledProfile("datagrid");

  // 通ることの確認: current-source で列挙した記録は使える。
  expect(readEnumeration(datagridEnumeration(), profile, "t").usable).toBe(true);

  const walked = datagridEnumeration();
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

  // 一次情報源を使ったのに理由が残っていれば機能していない免除として落とす。
  const stale = {
    ...datagridEnumeration(),
    stronger_source_unavailable_reason: "未受領（古い記録）",
  };
  const staleResult = readEnumeration(stale, profile, "t");
  expect(staleResult.usable).toBe(false);
  expect(staleResult.problems.join("\n")).toMatch(
    /current-source で列挙したのに stronger_source_unavailable_reason が書かれている/,
  );

  // complete: true なのに incomplete_reason が残る記録も同じ扱い（同じ表の中で「完全」と「未完了」を
  // 同時に主張させない）。集合の出所だけに当てて列挙側を素通りさせない。
  const staleReason = {
    ...datagridEnumeration(),
    incomplete_reason: "列定義が動的生成で読み切れない（complete を true へ直したときの残り）",
  };
  const staleReasonResult = readEnumeration(staleReason, profile, "t");
  expect(staleReasonResult.usable).toBe(false);
  expect(staleReasonResult.problems.join("\n")).toMatch(
    /complete: true なのに incomplete_reason が書かれている/,
  );

  // 通ることの確認: null / キー無しは通る（常に落とす実装を弾く）。
  expect(
    readEnumeration({ ...datagridEnumeration(), incomplete_reason: null }, profile, "t").usable,
  ).toBe(true);
});

test("プロファイルの形式検査: enumeration.sources は強い順に並んでいなければ落とす", () => {
  const base = sourcesOrderProfile();
  // 通ることの確認: 強い順・部分集合はどちらも通る。
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
  // 不正な宣言が「適合」として配布される（実測: 42 / "" / ["app-ui"] / null はいずれも problems 0 だった）。
  for (const [malformed, pattern] of [
    [["current-source", 42, "app-ui"], /空でない文字列でない要素がある（42）/],
    [["current-source", "", "app-ui"], /空でない文字列でない要素がある（""）/],
    [["current-source", ["app-ui"]], /空でない文字列でない要素がある（\["app-ui"\]）/],
    [["current-source", null, "app-ui"], /空でない文字列でない要素がある（null）/],
  ] satisfies [unknown[], RegExp][]) {
    const broken = structuredClone(base);
    // わざと文字列でない要素を含む sources を入れる
    broken.enumeration.sources = invalidInput(malformed);
    expect(validateProfile(broken, "z2.json").join("\n")).toMatch(pattern);
  }

  // 配列でない sources は「空」ではなく型の問題として報告する（原因を取り違えさせない）。
  const notArray = structuredClone(base);
  // わざと配列でない sources を入れる
  notArray.enumeration.sources = invalidInput("current-source");
  expect(validateProfile(notArray, "z2.json").join("\n")).toMatch(
    /enumeration.sources が配列ではない/,
  );
});

// ===== 形の不備を 1 件ずつ落とす（Issue #619） =====
//
// 照合が受け取る入力（プロファイル・網羅表・列挙・同値クラス・absent の証拠・CLI の引数）の各欄に
// 読めない状態（欠落・空・型の誤り・重複・未定義の参照）を 1 つずつ作り、合格として扱わないことを確かめる。
// 各表の最初で、壊す前の入力が通ることを確かめる（常に落とす実装を弾く）。

/** minimalProfile を 1 か所ずつ壊す変更と、loadProfiles が報告する問題の組。 */
const PROFILE_SHAPE_CASES = [
  [(p) => (p.version = ""), /version が空/],
  [(p) => (p.applies_to = " "), /applies_to が空/],
  [(p) => (p.axes = []), /axes が空/],
  // わざと JSON オブジェクトでない軸を入れる
  [(p) => (p.axes = [invalidInput(42), ...p.axes]), /axes\[0\]: JSON オブジェクトではない/],
  [(p) => p.axes.push({ id: "", kind: "element" }), /axes\[1\]: id が空/],
  [(p) => p.axes.push({ id: "a", kind: "element" }), /軸 id a が重複している/],
  [(p) => p.axes.push({ id: "b", kind: "set" }), /軸 b: kind が element \/ enum のいずれでもない/],
  [
    (p) => p.axes.push({ id: "b", kind: "enum", values: [] }),
    /軸 b: kind: enum なのに values が空/,
  ],
  [(p) => (p.candidate_rules = []), /candidate_rules が空/],
  [
    // わざと JSON オブジェクトでないルールを入れる
    (p) => p.candidate_rules.push(invalidInput("r2")),
    /candidate_rules\[1\]: JSON オブジェクトではない/,
  ],
  [
    (p) => p.candidate_rules.push({ id: "", axes: ["a"], guard: {}, visual_states: ["hover"] }),
    /candidate_rules\[1\]: id が空/,
  ],
  [(p) => (p.candidate_rules[0].id = "r/x"), /ルール r\/x: id に "\/" を含む/],
  [
    (p) => p.candidate_rules.push(structuredClone(p.candidate_rules[0])),
    /ルール id r が重複している/,
  ],
  [(p) => (p.candidate_rules[0].axes = []), /ルール r: axes が空/],
  // わざと JSON オブジェクトでない guard を入れる
  [(p) => (p.candidate_rules[0].guard = invalidInput(42)), /guard が JSON オブジェクトではない/],
  [(p) => (p.candidate_rules[0].guard = { on: true }), /<軸 id>.<フラグ名> の形になっていない/],
  [
    (p) => {
      p.axes.push({ id: "b", kind: "enum", values: ["v"] });
      p.candidate_rules[0].axes = ["a", "b"];
      p.candidate_rules[0].guard = { "a.on": true, "b.v": true };
    },
    /guard は element 軸にしか置けない（b.v）/,
  ],
  [
    // わざと真偽値でない guard の値を入れる
    (p) => (p.candidate_rules[0].guard = { "a.on": invalidInput("yes") }),
    /guard a.on の値が真偽値ではない/,
  ],
  [
    (p) => {
      p.axes.push({ id: "c", kind: "element", flags: ["on"] });
      p.candidate_rules[0].guard = { "a.on": true, "c.on": true };
    },
    /guard が axes に無い軸 c を参照している/,
  ],
  [
    (p) => (p.equivalence.reducible_axes = ["nope"]),
    /reducible_axes: 未定義の軸 nope を参照している/,
  ],
] satisfies [(p: Profile) => unknown, RegExp][];

test("プロファイルの形式検査: 軸・ルール・guard・同値の宣言の不備を 1 件ずつ弾く", () => {
  expect(profileProblems(minimalProfile())).toEqual([]);
  for (const [mutate, pattern] of PROFILE_SHAPE_CASES) {
    const p = minimalProfile();
    mutate(p);
    expect(profileProblems(p).join("\n")).toMatch(pattern);
  }
  // JSON オブジェクトでないプロファイルと、id が空のプロファイルも読み込まない。
  expect(profileProblems(invalidInput([]), "arr.json").join("\n")).toMatch(
    /arr.json: プロファイルが JSON オブジェクトではない/,
  );
  expect(profileProblems({ ...minimalProfile(), id: "" }, "noid.json").join("\n")).toMatch(
    /noid.json: id が空/,
  );
});

test("CLI: プロファイルディレクトリを読めない・id とファイル名が違うときは exit 2", () => {
  const missingDir = runCli(["--list-profiles", "--profiles", "no-such-dir"]);
  expect(missingDir.status).toBe(2);
  expect(missingDir.stderr).toMatch(/プロファイルディレクトリを読めない: no-such-dir/);

  // 通ることの確認: 同梱の datagrid を同じ名前で置けば一覧に出る。
  const datagrid = readFileSync(join(bundledProfiles, "datagrid.json"), "utf8");
  const ok = runCli(["--list-profiles", "--profiles", "@profiles"], {
    profiles: { "datagrid.json": datagrid },
  });
  expect(ok.status).toBe(0);
  expect(
    parseJsonAs<{ profiles: Array<{ id: string }> }>(ok.stdout).profiles.map((p) => p.id),
  ).toEqual(["datagrid"]);

  const renamed = runCli(["--list-profiles", "--profiles", "@profiles"], {
    profiles: { "grid.json": datagrid },
  });
  expect(renamed.status).toBe(2);
  expect(renamed.stderr).toMatch(/grid.json: id（datagrid）がファイル名と一致しない/);
});

test("CLI: 不明な引数・値の無いフラグ・読めない入力は exit 2", () => {
  const cov = datagridCoverage();
  const files = { "component-coverage.json": cov, "metadata.json": metadataFor(cov) };
  for (const [args, extraFiles, pattern] of [
    [["--coverage", "component-coverage.json", "--nope"], {}, /unknown argument: --nope/],
    [["--coverage"], {}, /^usage: /m],
    [["--coverage", "missing.json"], {}, /網羅表を読めない: missing.json/],
    [
      ["--coverage", "component-coverage.json", "--metadata", "broken.json"],
      { "broken.json": "{ not json" },
      /metadata を読めない/,
    ],
    [
      ["--coverage", "array.json", "--write"],
      { "array.json": "[]" },
      /網羅表が JSON オブジェクトではないので書き戻せない/,
    ],
    [
      ["--coverage", "noslug.json", "--metadata", "metadata.json"],
      { "noslug.json": { ...cov, slug: "" } },
      /網羅表に slug が無いので metadata と同じ機能か照合できない/,
    ],
  ] satisfies [string[], Record<string, unknown>, RegExp][]) {
    const r = runCli(args, { files: { ...files, ...extraFiles } });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(pattern);
  }
  // 書き戻さない実行では、JSON オブジェクトでない網羅表は照合の問題として exit 1 にする。
  const notObject = runCli(["--coverage", "array.json"], { files: { "array.json": "[]" } });
  expect(notObject.status).toBe(1);
  expect(notObject.stderr).toMatch(/網羅表が JSON オブジェクトではない/);
});

test("CLI --write: 網羅表を書き戻せなければ exit 2 で知らせる（書けたことにしない）", () => {
  const cov = JSON.stringify(datagridCoverage());
  const stderr: string[] = [];
  const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  try {
    const status = main(["--coverage", "cov.json", "--write"], {
      readFile: (p) => (p === "cov.json" ? cov : readFileSync(p, "utf8")),
      writeFile: () => {
        throw new Error("EACCES: permission denied");
      },
    });
    expect(status).toBe(2);
    expect(stderr.join("")).toMatch(/網羅表を書き戻せない: cov.json: Error: EACCES/);
    // 書き戻しに失敗したら、照合の結果を出力しない。
    expect(stdout).not.toHaveBeenCalled();
  } finally {
    spy.mockRestore();
    stdout.mockRestore();
  }
});

test("網羅表の部品・項目・インスタンス・セルの不備を 1 件ずつ未測定として扱う", () => {
  expect(reconcile(datagridCoverage(), bundled)).toMatchObject({ ok: true, unmeasured: 0 });
  expectComponentShapeRejected();
  expectItemAndInstanceShapeRejected();
  expectCandidateRecordRejected();
});

/** 列挙の justified_absences に入れる不正な宣言と、照合が報告する問題の組。 */
const JUSTIFIED_ABSENCE_CASES = [
  [42, /justified_absences が配列ではない/],
  [[42], /justified_absences\[0\] が JSON オブジェクトではない/],
  [[{ scope: "", reason: "根拠" }], /justified_absences\[0\]: scope が空/],
  [[{ scope: "nope", reason: "根拠" }], /未定義の element 軸 nope を参照している/],
  [
    [{ scope: "column/ghost", reason: "根拠" }],
    /軸 column に列挙されていない要素 ghost を参照している/,
  ],
] satisfies [unknown, RegExp][];

test("インスタンスの列挙の不備を 1 件ずつ未列挙として扱う（候補ゼロで素通りさせない）", () => {
  const en = (cov: Coverage) => cov.components[0].instances[0].enumeration;
  const columns = (cov: Coverage) => en(cov).elements.column;
  expectRejected(
    (cov) => removeField(cov.components[0].instances[0], "enumeration"),
    /enumeration が無い/,
  );
  expectRejected((cov) => removeField(en(cov), "source"), /enumeration.source が無い/);
  expectRejected(
    (cov) => (en(cov).source.kind = "vendor-spec"),
    /enumeration.source.kind（vendor-spec）がプロファイルの sources にない/,
  );
  // わざと真偽値でない complete を入れる
  expectRejected(
    (cov) => (en(cov).complete = invalidInput("yes")),
    /enumeration.complete が true ではない/,
  );
  // わざと JSON オブジェクトでない elements を入れる
  expectRejected(
    (cov) => (en(cov).elements = invalidInput(42)),
    /enumeration.elements が JSON オブジェクトではない/,
  );
  expectRejected((cov) => removeField(en(cov).elements, "column"), /軸 column の列挙が無い/);
  expectRejected(
    (cov) => columns(cov).push(invalidInput(42)),
    /軸 column\[2\] が JSON オブジェクトではない/,
  );
  expectRejected((cov) => columns(cov).push({ id: "", flags: {} }), /軸 column\[2\]: id が空/);
  expectRejected((cov) => (columns(cov)[1].id = "a/b"), /要素 a\/b: id に "\/" を含む/);
  expectRejected(
    (cov) => columns(cov).push(structuredClone(columns(cov)[0])),
    /要素 price が重複している/,
  );
  expectRejected(
    // わざと真偽値でないフラグを入れる
    (cov) => (columns(cov)[0].flags.sortable = invalidInput("yes")),
    /要素 price: フラグ sortable が真偽値で記録されていない/,
  );
  expectRejected(
    (cov) => (columns(cov)[0].flags.resizable = true),
    /要素 price: プロファイルに宣言の無いフラグ resizable がある/,
  );
  // 免除の宣言の不備。
  for (const [absences, pattern] of JUSTIFIED_ABSENCE_CASES) {
    // わざと型に合わない免除の宣言を入れる
    expectRejected((cov) => (en(cov).justified_absences = invalidInput(absences)), pattern);
  }
});

test("同値クラスの宣言の不備を 1 件ずつ弾く（id・根拠・軸・メンバー・代表）", () => {
  const key = (id: string) => `orders/${id}`;
  /** 全候補を 1 件ずつのクラスに分けた、通る宣言。 */
  const singletons = (cov: Coverage): EquivalenceClass[] =>
    cov.components[0].instances[0].candidates.map((id) => ({
      id: `c-${id}`,
      axis: "column",
      rationale: "現行 UI で同じセルレンダラ・同じ書式であることを確認した",
      members: [key(id)],
      representative: key(id),
    }));
  const withClasses = (edit: (classes: EquivalenceClass[]) => unknown) => (cov: Coverage) => {
    const classes = singletons(cov);
    edit(classes);
    cov.components[0].equivalence_classes = classes;
  };
  // 通ることの確認: 全候補を過不足なく分類すれば通る。
  const valid = datagridCoverage();
  valid.components[0].equivalence_classes = singletons(valid);
  expect(reconcile(valid, bundled).problems).toEqual([]);

  for (const [edit, pattern] of [
    // わざと JSON オブジェクトでないクラスを入れる
    [(c) => c.push(invalidInput(42)), /equivalence_classes\[20\] が JSON オブジェクトではない/],
    [(c) => (c[0].id = ""), /equivalence_classes\[0\]: id が空/],
    [(c) => (c[1].id = c[0].id), /同値クラス c-column-visible\/price の id が重複している/],
    [(c) => (c[0].rationale = " "), /rationale が空/],
    [(c) => (c[0].axis = ""), /axis が空/],
    [(c) => (c[0].members = []), /members が空/],
    [(c) => c[0].members.push(key("ghost")), /候補に無いメンバー orders\/ghost を参照している/],
    [(c) => c[0].members.push(c[1].members[0]), /の両方に属している/],
    [(c) => (c[0].representative = ""), /representative が空/],
    [(c) => (c[0].representative = c[1].members[0]), /が members に含まれていない/],
    [
      (c) => {
        // 列の表示と列の絞り込みは、同じ列でも別の操作なので束ねられない。
        const filter = c.find((x) => x.members[0] === key("column-filter/price"));
        assert.exists(filter, "column-filter/price のクラスが無い");
        c[0].members.push(...filter.members);
        c.splice(c.indexOf(filter), 1);
      },
      /ルールの違う候補が含まれている（column-visible と column-filter）/,
    ],
  ] satisfies [(c: EquivalenceClass[]) => unknown, RegExp][]) {
    expectRejected(withClasses(edit), pattern, { unmeasured: false });
  }
});

test("記録された撮影状態の行の形が読めなければ照合を通さない", () => {
  for (const [mutate, pattern] of [
    // わざと配列でない rows を入れる
    [
      (cov) => (cov.visual_state_coverage.rows = invalidInput(null)),
      /visual_state_coverage.rows が無い/,
    ],
    // わざと JSON オブジェクトでない行を入れる
    [
      (cov) => cov.visual_state_coverage.rows.push(invalidInput(42)),
      /JSON オブジェクトでない行がある/,
    ],
    [
      (cov) => (cov.visual_state_coverage.rows[0].kind = ""),
      /component \/ instance \/ required_by \/ kind が空の行がある/,
    ],
  ] satisfies [(cov: Coverage) => unknown, RegExp][]) {
    expectRejected(mutate, pattern, { unmeasured: false });
  }
});

/** nonRenderableCoverage を 1 か所ずつ壊す変更と、照合が報告する問題の組。 */
const NON_RENDERABLE_SHAPE_CASES = [
  // わざと JSON オブジェクトでない証拠を入れる
  [
    (cov) => (cov.cells[0].absence_evidence = invalidInput("見えない")),
    /absence_evidence が JSON オブジェクトではない/,
  ],
  [
    (cov) => (firstEvidence(cov).kind = "guess"),
    /absence_evidence.kind が fired-without-response \/ non-renderable のいずれでもない/,
  ],
  [(cov) => (firstEvidence(cov).locator = " "), /non-renderable の locator \/ state_source が空/],
  [(cov) => (firstEvidence(cov).states_exhaustive = false), /states_exhaustive が true ではない/],
  [
    (cov) => removeField(cov.components[0].instances[0], "applicable_states"),
    /インスタンスの applicable_states が無い/,
  ],
  [
    (cov) => (firstManifest(cov).complete = false),
    /applicable_states の complete \/ source が不完全/,
  ],
  [(cov) => (firstManifest(cov).items = []), /applicable_states.items が空/],
  // わざと JSON オブジェクトでない状態を入れる
  [(cov) => firstManifest(cov).items.push(invalidInput(42)), /applicable_states.items\[1\] が不正/],
  [
    (cov) => firstManifest(cov).items.push({ id: "", transition: "t" }),
    /applicable_states.items\[1\] の id \/ transition が空/,
  ],
  [
    (cov) => firstManifest(cov).items.push(structuredClone(firstManifest(cov).items[0])),
    /applicable_states.items の id desktop\/default が重複/,
  ],
  [(cov) => (firstEvidence(cov).states = []), /non-renderable の states が空/],
  [(cov) => (firstEvidence(cov).expected_states = [""]), /expected_states が空または不正/],
  // わざと JSON オブジェクトでない状態の記録を入れる
  [
    (cov) => (firstEvidence(cov).states = [invalidInput(42)]),
    /states\[0\] が JSON オブジェクトではない/,
  ],
  [(cov) => (firstState(cov.cells[0]).name = ""), /states\[0\] の name \/ transition が空/],
  [
    (cov) => firstEvidence(cov).states.push(structuredClone(firstState(cov.cells[0]))),
    /states\[1\]\.name desktop\/default が重複している/,
  ],
  [
    (cov) => (firstState(cov.cells[0]).transition = "別の手順"),
    /applicable_states の id \/ transition と一致しない/,
  ],
  [
    (cov) => (firstState(cov.cells[0]).offset_parent = ""),
    /offset_parent が null または空でない文字列ではない/,
  ],
  // わざと JSON オブジェクトでない矩形を入れる
  [
    (cov) => (firstState(cov.cells[0]).bounding_box = invalidInput("0x20")),
    /bounding_box が null または JSON オブジェクトではない/,
  ],
  // 非表示の原因を持つ状態は、矩形を持たない（hidden_by と矩形の両方は矛盾）。
  [
    (cov) => (firstState(cov.cells[0]).hidden_by = hiddenBySelf(cov)),
    /hidden_by があるのに bounding_box が null ではない/,
  ],
  // 正の寸法の矩形で、非表示の原因も無い状態は非描画の証拠にならない。
  [
    (cov) => (firstState(cov.cells[0]).bounding_box = { x: 0, y: 0, width: 10, height: 20 }),
    /に 0 寸法の矩形または非表示原因の証拠が無い/,
  ],
  // 測った状態が一覧の全状態に揃っていない。
  [
    (cov) =>
      firstManifest(cov).items.push({ id: "mobile/default", transition: "mobile へ切り替える" }),
    /expected_states \/ states\[\]\.name \/ applicable_states.items\[\]\.id が完全一致しない/,
  ],
] satisfies [(cov: Coverage) => unknown, RegExp][];

test("非描画 absent の証拠と状態の一覧の欠け・矛盾を 1 件ずつ未測定として扱う", () => {
  expect(reconcile(nonRenderableCoverage(), bundled)).toMatchObject({ ok: true, unmeasured: 0 });
  for (const [mutate, pattern] of NON_RENDERABLE_SHAPE_CASES) {
    const cov = nonRenderableCoverage();
    mutate(cov);
    const r = reconcile(cov, bundled);
    expect(r).toMatchObject({ ok: false, unmeasured: 1 });
    expect(r.problems.join("\n")).toMatch(pattern);
  }
});

test("fired-without-response の送り方・発火確認の欠けを 1 件ずつ未測定として扱う", () => {
  expect(reconcile(firedAbsentCoverage(), bundled)).toMatchObject({ ok: true, unmeasured: 0 });
  for (const [mutate, pattern] of [
    [(e) => (e.action.locator = ""), /action.locator \/ action.detail が空/],
    // わざと JSON オブジェクトでない矩形を入れる
    [
      (e) => (e.action.bounding_box = invalidInput(null)),
      /action.bounding_box が JSON オブジェクトではない/,
    ],
    [
      (e) => (e.action.bounding_box.x = Number.NaN),
      /action.bounding_box の x \/ y \/ width \/ height が有限の数値ではない/,
    ],
    [(e) => (e.action.hit_test_target = " "), /座標操作なのに action.hit_test_target が空/],
    // わざと JSON オブジェクトでない発火確認を入れる
    [(e) => (e.fired = invalidInput("受信した")), /fired が JSON オブジェクトではない/],
    [
      (e) => (e.fired.signal = "guess"),
      /fired.signal が event-listener \/ dom-change \/ state-change のいずれでもない/,
    ],
  ] satisfies [(e: FiredEvidence) => unknown, RegExp][]) {
    const cov = firedAbsentCoverage();
    mutate(firedEvidenceOf(cov.cells[0]));
    const r = reconcile(cov, bundled);
    expect(r).toMatchObject({ ok: false, unmeasured: 1 });
    expect(r.problems.join("\n")).toMatch(pattern);
  }
  // 座標を使わない送り方（locator-api）では hit-test を要求しない。
  const locatorApi = firedAbsentCoverage();
  const action = firedEvidenceOf(locatorApi.cells[0]).action;
  action.method = "locator-api";
  action.hit_test_target = "";
  expect(reconcile(locatorApi, bundled)).toMatchObject({ ok: true, unmeasured: 0 });
});
