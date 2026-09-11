// parity-diff の部品被覆表チェッカ（coverage-check.mjs）の回帰テスト（Issue #274）。
//
// 収束条件に「未測定が残っていない」を足すとき、数え方を宣言値（metadata.json の件数）や
// 行数に任せると、被覆表を直さずに件数だけ 0 と書く／測れなかった行を落とすだけで
// converged: true へ到達できてしまう。数え直しが fail-closed であること
// （行が無い・evidence が空・present なのに covered_by が空・重複行）を固定する。
//
// 後方互換（component_coverage キーが無い旧成果物と declared: false は判定に入れない）は
// 陽性コントロールとして固定する——これが無いと「被覆表が無ければ常に落とす」実装と区別できない。

import { test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repoRoot, "skills/parity-diff/scripts/coverage-check.mjs");
const { countCoverage, readDeclaration } = await import(script);

/** coverage-expand が書き戻すプロファイル適合の記録（無い・ok: false は収束させない）。 */
const conformance = { tool: "coverage-expand", tool_version: "1", ok: true };

/** 適合プロファイルが無い部品の宣言（profile キーの欠落＝暗黙の汎用扱いと区別する）。 */
const noProfile = {
  profile: null,
  profile_absent_reason: "軸を持たない単純な部品で、適合プロファイルが無い",
};

/** 部品 1 つ・項目 2 つ・インスタンス 2 つ ＝ 期待セル 4 の被覆表の骨格。 */
const skeleton = {
  slug: "order-list",
  conformance,
  components: [
    {
      id: "grid",
      ...noProfile,
      items: [{ id: "ctx-menu" }, { id: "drag-reorder" }],
      instances: [{ id: "orders" }, { id: "search" }],
    },
  ],
};

const cell = (item, instance, extra) => ({
  component: "grid",
  item,
  instance,
  value: "present",
  evidence: "右クリックでメニューが出た",
  covered_by: ["context-menu"],
  ...extra,
});

/** 4 セルすべてが測れている被覆表。テストが components を書き換えても骨格を汚さないよう複製する。 */
function full() {
  return {
    ...structuredClone(skeleton),
    cells: [
      cell("ctx-menu", "orders"),
      cell("ctx-menu", "search", {
        value: "absent",
        evidence: "右クリックしてもメニューが出ない",
        absence_evidence: firedEvidence(),
        covered_by: [],
      }),
      cell("drag-reorder", "orders"),
      cell("drag-reorder", "search"),
    ],
  };
}

function firedEvidence(overrides = {}) {
  return {
    kind: "fired-without-response",
    action: {
      locator: "getByRole('row', { name: 'Order 1' })",
      method: "locator-api",
      detail: "locator.click({ button: 'right' })",
      bounding_box: { x: 10, y: 20, width: 200, height: 32 },
      visible: true,
      actionability_bypassed: false,
    },
    fired: {
      signal: "event-listener",
      detail: "contextmenu リスナで受信した",
      verified: true,
    },
    observation: "メニューが開かず DOM も変化しなかった",
    ...overrides,
  };
}

/** 座標操作で発火を確認した場合の証拠。重なった別要素の発火と区別するため hit-test まで実測する。 */
function firedCoordinateEvidence() {
  return firedEvidence({
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
  });
}

/** 全到達状態で非描画だった absent の機械可読証拠。 */
function nonRenderableEvidence() {
  return {
    kind: "non-renderable",
    locator: "getByRole('menuitem', { name: 'Back', includeHidden: true })",
    state_source: "vendor spec v2 と現行 UI",
    states_exhaustive: true,
    expected_states: ["desktop/default", "mobile/admin"],
    states: [
      {
        name: "desktop/default",
        transition: "desktop viewport でメニューを開く",
        locator_match_count: 1,
        bounding_box: { x: 60, y: 0, width: 0, height: 20 },
        offset_parent: null,
        hidden_by: null,
      },
      {
        name: "mobile/admin",
        transition: "mobile viewport・admin 権限でメニューを開く",
        locator_match_count: 1,
        bounding_box: null,
        offset_parent: null,
        hidden_by: {
          target_locator: "getByRole('menuitem', { name: 'Back', includeHidden: true })",
          locator: "#menu",
          relation: "ancestor",
          relationship_verified: true,
          computed_style: { display: "none" },
        },
      },
    ],
  };
}

function applicableStates() {
  return {
    source: {
      kind: "vendor-spec",
      ref: "docs/grid-v2.json",
      version: "v2",
      condition: "viewport と権限の全組み合わせ",
    },
    complete: true,
    items: [
      { id: "desktop/default", transition: "desktop viewport でメニューを開く" },
      { id: "mobile/admin", transition: "mobile viewport・admin 権限でメニューを開く" },
    ],
  };
}

test("陽性コントロール: 全セルが測れていれば未測定ゼロ・問題ゼロ（常に落とす実装を弾く）", () => {
  const r = countCoverage(full(), "order-list");
  expect(r).toMatchObject({ cells: 4, present: 3, absent: 1, unmeasured: 0, problems: [] });
});

test("行が無い組み合わせは未測定として数える（行を落として穴を消せない）", () => {
  const cov = full();
  cov.cells = cov.cells.slice(0, 3);
  expect(countCoverage(cov, "order-list").unmeasured).toBe(1);
});

test("value: unmeasured は未測定として数える", () => {
  const cov = full();
  cov.cells[3] = {
    ...cov.cells[3],
    value: "unmeasured",
    unmeasured_reason: "データが無く発火できない",
  };
  expect(countCoverage(cov, "order-list").unmeasured).toBe(1);
});

test("present なのに covered_by が空は未測定（列挙しただけでは押さえたことにしない）", () => {
  const cov = full();
  cov.cells[0] = { ...cov.cells[0], covered_by: [] };
  const r = countCoverage(cov, "order-list");
  expect(r.unmeasured).toBe(1);
  expect(r.problems.join("\n")).toMatch(/covered_by/);
});

test("evidence が空なら present / absent でも未測定", () => {
  const cov = full();
  cov.cells[1] = { ...cov.cells[1], evidence: "  " };
  const r = countCoverage(cov, "order-list");
  expect(r.unmeasured).toBe(1);
  expect(r.problems.join("\n")).toMatch(/evidence/);
});

test("非描画 absent は全状態の機械可読証拠が揃った場合だけ通る", () => {
  const cov = full();
  cov.cells[1].evidence = "全到達状態で非描画";
  cov.cells[1].absence_evidence = nonRenderableEvidence();
  cov.components[0].instances[1].applicable_states = applicableStates();
  expect(countCoverage(cov, "order-list")).toMatchObject({ absent: 1, unmeasured: 0 });
});

test("非描画 absent の証拠の欠落・型崩れ・空配列は未測定に倒す", () => {
  const mutations = [
    (e) => delete e.locator,
    (e) => delete e.state_source,
    (e) => (e.states_exhaustive = false),
    (e) => (e.states = []),
    (e) => (e.expected_states = []),
    (e) => e.expected_states.push("desktop/default"),
    (e) => (e.expected_states[0] = "desktop/other"),
    (e) => (e.states[1].name = "desktop/default"),
    (e) => delete e.states[0].bounding_box,
    (e) => delete e.states[0].offset_parent,
    (e) => (e.states[0].offset_parent = 3),
    (e) => (e.states[0].bounding_box.width = "0"),
    (e) => (e.states[0].bounding_box.width = 10),
    // 実在しない矩形（負値・非有限）で 0 寸法判定を迂回させない
    (e) => (e.states[0].bounding_box.width = -1),
    (e) => (e.states[0].bounding_box.height = -0.5),
    (e) => (e.states[0].bounding_box.x = Number.NaN),
    (e) => (e.states[0].bounding_box.y = Number.POSITIVE_INFINITY),
    // display: none の本人／祖先配下では実 DOM の offsetParent は必ず null
    (e) => (e.states[1].offset_parent = "#visible-parent"),
    // 状態ごとの一致数が実測されていない・一意でない
    (e) => (e.states[0].locator_match_count = 2),
    (e) => (e.states[0].locator_match_count = "1"),
    (e) => (e.states[0].locator_match_count = 1.5),
    (e) => (e.states[0].locator_match_count = -1),
    (e) => delete e.states[0].locator_match_count,
    // 0 件（DOM に無い）と矩形・offset_parent・hidden_by の矛盾
    (e) => (e.states[0].locator_match_count = 0),
    (e) => {
      e.states[1].locator_match_count = 0;
      e.states[1].hidden_by = null;
      e.states[1].offset_parent = "#menu-root";
    },
    // 全状態が 0 件だと locator の正しさを一度も実証できていない
    (e) => {
      for (const st of e.states) {
        st.locator_match_count = 0;
        st.bounding_box = null;
        st.offset_parent = null;
        st.hidden_by = null;
      }
    },
    (e) => (e.states[1].hidden_by.computed_style = {}),
    // hidden_by は「非表示原因なし」を明示的な null で書く。キーごとの省略は証拠の欠落として扱う
    (e) => delete e.states[0].hidden_by,
    (e) => delete e.states[1].hidden_by,
    (e) => {
      e.states[1].bounding_box = { x: 0, y: 0, width: 10, height: 20 };
      e.states[1].hidden_by.computed_style = { display: "block", color: "red" };
    },
  ];
  for (const mutate of mutations) {
    const cov = full();
    cov.cells[1].absence_evidence = nonRenderableEvidence();
    cov.components[0].instances[1].applicable_states = applicableStates();
    mutate(cov.cells[1].absence_evidence);
    const r = countCoverage(cov, "order-list");
    expect(r.absent).toBe(0);
    expect(r.unmeasured).toBe(1);
    expect(r.problems.join("\n")).toMatch(
      /absence_evidence|non-renderable|bounding_box|offset_parent|hidden_by|0 寸法|expected_states|重複|locator/,
    );
  }
});

test("非描画 absent は独立した applicable_states manifest と一致しなければ未測定", () => {
  for (const mutate of [
    (manifest) => (manifest.complete = false),
    (manifest) => delete manifest.source.version,
    (manifest) => manifest.items.push(structuredClone(manifest.items[0])),
    (manifest) => (manifest.items[0].transition = "別の遷移"),
    (manifest) => manifest.items.pop(),
    // 語彙外の source.kind。空でないだけでは出所不明の manifest を収束させられる
    (manifest) => (manifest.source.kind = "invented"),
    (manifest) => (manifest.source.kind = "config"),
  ]) {
    const cov = full();
    cov.cells[1].absence_evidence = nonRenderableEvidence();
    cov.components[0].instances[1].applicable_states = applicableStates();
    mutate(cov.components[0].instances[1].applicable_states);
    expect(countCoverage(cov, "order-list")).toMatchObject({ absent: 0, unmeasured: 1 });
  }
});

test("applicable_states.source.kind はテンプレートの語彙 4 種だけを受理する", () => {
  for (const kind of ["profile", "vendor-spec", "current-source", "app-ui"]) {
    const cov = full();
    cov.cells[1].evidence = "全到達状態で非描画";
    cov.cells[1].absence_evidence = nonRenderableEvidence();
    cov.components[0].instances[1].applicable_states = applicableStates();
    cov.components[0].instances[1].applicable_states.source.kind = kind;
    expect(countCoverage(cov, "order-list")).toMatchObject({ absent: 1, unmeasured: 0 });
  }
});

test("一部の状態で DOM に無い候補も、1 件の状態が残っていれば非描画証拠として通る", () => {
  // 候補ごとに適用可能な状態が違う場合（desktop では隠れて存在、mobile では描画されない）を測れるようにする
  const cov = full();
  cov.cells[1].evidence = "全到達状態で非描画";
  cov.cells[1].absence_evidence = nonRenderableEvidence();
  cov.cells[1].absence_evidence.states[1].locator_match_count = 0;
  cov.cells[1].absence_evidence.states[1].bounding_box = null;
  cov.cells[1].absence_evidence.states[1].offset_parent = null;
  cov.cells[1].absence_evidence.states[1].hidden_by = null;
  cov.components[0].instances[1].applicable_states = applicableStates();
  expect(countCoverage(cov, "order-list")).toMatchObject({ absent: 1, unmeasured: 0 });
});

test("visibility: hidden では offset_parent が非 null でも非描画証拠として通る", () => {
  // display: none だけが offsetParent を必ず null にする。visibility 経路まで巻き込むと正当な証拠を落とす
  const cov = full();
  cov.cells[1].evidence = "全到達状態で非描画";
  cov.cells[1].absence_evidence = nonRenderableEvidence();
  cov.cells[1].absence_evidence.states[1].hidden_by.computed_style = { visibility: "hidden" };
  cov.cells[1].absence_evidence.states[1].offset_parent = "#visible-parent";
  cov.components[0].instances[1].applicable_states = applicableStates();
  expect(countCoverage(cov, "order-list")).toMatchObject({ absent: 1, unmeasured: 0 });
});

test("id 欠落インスタンスは applicable_states の参照先にならない", () => {
  // String(undefined) が文字列 id "undefined" と衝突すると、別インスタンスの manifest を読んでしまう
  const cov = full();
  cov.components[0].instances = [
    { page: "id の無いインスタンス", applicable_states: applicableStates() },
    ...cov.components[0].instances,
  ];
  cov.components[0].instances[2].id = "undefined";
  for (const c of cov.cells) if (c.instance === "search") c.instance = "undefined";
  cov.cells[1].evidence = "全到達状態で非描画";
  cov.cells[1].absence_evidence = nonRenderableEvidence();
  const r = countCoverage(cov, "order-list");
  expect(r.absent).toBe(0);
  expect(r.problems.join("\n")).toMatch(/applicable_states が無い/);
});

test("座標操作で発火を確認した absent も、正の矩形と hit-test の実測が揃えば通る", () => {
  const cov = full();
  cov.cells[1].absence_evidence = firedCoordinateEvidence();
  expect(countCoverage(cov, "order-list")).toMatchObject({ absent: 1, unmeasured: 0 });
});

test("fired-without-response は送り方・発火確認・観測結果が揃わなければ未測定", () => {
  const mutations = [
    (e) => delete e.action,
    (e) => delete e.action.locator,
    (e) => delete e.action.detail,
    (e) => (e.action.method = "guess"),
    (e) => delete e.fired,
    (e) => (e.fired.signal = "assumed"),
    (e) => (e.fired.verified = false),
    (e) => delete e.fired.detail,
    (e) => (e.observation = "  "),
    // 可視要素への操作という前提を実測で示せていない
    (e) => delete e.action.bounding_box,
    (e) => (e.action.bounding_box.width = 0),
    (e) => (e.action.visible = false),
    (e) => delete e.action.visible,
    // force / dispatchEvent で actionability を迂回した操作は証拠にならない
    (e) => (e.action.actionability_bypassed = true),
    (e) => delete e.action.actionability_bypassed,
  ];
  for (const mutate of mutations) {
    const cov = full();
    cov.cells[1].absence_evidence = firedEvidence();
    mutate(cov.cells[1].absence_evidence);
    const r = countCoverage(cov, "order-list");
    expect(r).toMatchObject({ absent: 0, unmeasured: 1 });
    expect(r.problems.join("\n")).toMatch(
      /fired-without-response|action\.bounding_box|action\.visible|actionability_bypassed/,
    );
  }
});

test("座標操作は正の矩形と対象への hit-test を実測できない限り未測定", () => {
  // 0 幅要素の中心座標で重なった別要素が発火した結果を、対象の発火として通さない
  const mutations = [
    (e) => delete e.action.bounding_box,
    (e) => (e.action.bounding_box.width = 0),
    (e) => (e.action.bounding_box.height = -1),
    (e) => (e.action.bounding_box.x = Number.NaN),
    (e) => delete e.action.hit_test_target,
    (e) => (e.action.hit_test_is_target_or_descendant = false),
    (e) => delete e.action.hit_test_is_target_or_descendant,
  ];
  for (const mutate of mutations) {
    const cov = full();
    cov.cells[1].absence_evidence = firedCoordinateEvidence();
    mutate(cov.cells[1].absence_evidence);
    const r = countCoverage(cov, "order-list");
    expect(r).toMatchObject({ absent: 0, unmeasured: 1 });
    expect(r.problems.join("\n")).toMatch(/座標操作|bounding_box/);
  }
});

test("absent の経路識別が無い・未知なら散文 evidence があっても未測定", () => {
  for (const absenceEvidence of [undefined, { kind: "unknown" }]) {
    const cov = full();
    cov.cells[1].absence_evidence = absenceEvidence;
    expect(countCoverage(cov, "order-list")).toMatchObject({ absent: 0, unmeasured: 1 });
  }
});

test("同じ組み合わせの重複行は先勝ちにせず未測定として数える", () => {
  const cov = full();
  cov.cells.push({ ...cov.cells[0], value: "absent", evidence: "別の観測", covered_by: [] });
  const r = countCoverage(cov, "order-list");
  expect(r.unmeasured).toBe(1);
  expect(r.problems.join("\n")).toMatch(/複数ある/);
});

test("items / instances が空の部品は期待セル 0 に化けず未測定 1 として数える", () => {
  const cov = {
    slug: "order-list",
    components: [{ id: "grid", items: [], instances: [] }],
    cells: [],
  };
  expect(countCoverage(cov, "order-list")).toMatchObject({ cells: 1, unmeasured: 1 });
});

test("components が空なら問題として残す（空宣言で通さない）", () => {
  const r = countCoverage({ slug: "order-list", components: [], cells: [] }, "order-list");
  expect(r.problems.join("\n")).toMatch(/components が空/);
});

test("slug 不一致は問題として残す（別 slug の被覆表を読んでいる）", () => {
  expect(countCoverage(full(), "customer-list").problems.join("\n")).toMatch(/slug/);
});

test("components に無い組み合わせを参照する行は問題として残す", () => {
  const cov = full();
  cov.cells.push(cell("unknown-item", "orders"));
  expect(countCoverage(cov, "order-list").problems.join("\n")).toMatch(/components に無い/);
});

test("列挙側の id が空なら 1 行で全セルを満たせず未測定として数える（fail-closed）", () => {
  // id を落とすと全要素が同じキーへ潰れるため、素朴な実装では 1 行が全セルを満たしてしまう。
  const cov = {
    slug: "order-list",
    components: [{ items: [{ name: "x" }, { name: "y" }], instances: [{ page: "明細一覧" }] }],
    cells: [{ value: "present", evidence: "e", covered_by: ["s1"] }],
  };
  const r = countCoverage(cov, "order-list");
  expect(r.present).toBe(0);
  expect(r.unmeasured).toBeGreaterThan(0);
  expect(r.problems.join("\n")).toMatch(/id が空/);
});

test("列挙側の重複 id は期待セルを二重に数えず問題として残す", () => {
  const cov = {
    slug: "order-list",
    conformance,
    components: [
      {
        id: "grid",
        ...noProfile,
        items: [{ id: "a" }, { id: "a" }],
        instances: [{ id: "orders" }],
      },
    ],
    cells: [cell("a", "orders")],
  };
  const r = countCoverage(cov, "order-list");
  expect(r.present).toBe(1);
  expect(r.unmeasured).toBe(1);
  expect(r.problems.join("\n")).toMatch(/重複/);
});

test("どのセルの行か決まらない行（component / item / instance が空）は索引に入れない", () => {
  const cov = full();
  cov.cells[0] = { ...cov.cells[0], item: "" };
  const r = countCoverage(cov, "order-list");
  expect(r.unmeasured).toBe(1);
  expect(r.problems.join("\n")).toMatch(/component \/ item \/ instance/);
});

test("id 欠落の項目が関わるセルは「項目数 × インスタンス数」ぶん未測定として数える", () => {
  // 項目 3（うち 1 件 id 欠落）× インスタンス 4 = 期待セル 12。欠落項目の 4 セルはすべて未測定。
  const cov = {
    slug: "order-list",
    conformance,
    components: [
      {
        id: "grid",
        ...noProfile,
        items: [{ id: "a" }, { id: "b" }, { name: "id なし" }],
        instances: [{ id: "p1" }, { id: "p2" }, { id: "p3" }, { id: "p4" }],
      },
    ],
    cells: [],
  };
  for (const item of ["a", "b"]) {
    for (const instance of ["p1", "p2", "p3", "p4"]) {
      cov.cells.push(cell(item, instance));
    }
  }
  const r = countCoverage(cov, "order-list");
  expect(r.cells).toBe(12);
  expect(r.present).toBe(8);
  expect(r.unmeasured).toBe(4);
});

test("id 欠落のインスタンスも同様に、その列ぶんのセルが未測定になる", () => {
  const cov = {
    slug: "order-list",
    conformance,
    components: [
      {
        id: "grid",
        ...noProfile,
        items: [{ id: "a" }, { id: "b" }],
        instances: [{ id: "p1" }, { name: "id なし" }],
      },
    ],
    cells: [cell("a", "p1"), cell("b", "p1")],
  };
  const r = countCoverage(cov, "order-list");
  expect(r.cells).toBe(4);
  expect(r.present).toBe(2);
  expect(r.unmeasured).toBe(2);
});

test("配列の被覆表・列挙要素・セル行は JSON オブジェクトでないとして弾く", () => {
  // 被覆表そのもの: 「components が空」等へすり替わらず、型崩れの問題文が返ること。
  const arr = countCoverage([], "order-list");
  expect(arr.problems).toEqual(["被覆表が JSON オブジェクトではない"]);
  expect(arr.unmeasured).toBe(1);
  // 列挙要素とセル行: 配列を混ぜても索引に入らず、未測定として数えられること。
  const mixed = countCoverage(
    {
      slug: "order-list",
      conformance,
      components: [
        { id: "grid", ...noProfile, items: [{ id: "a" }, []], instances: [{ id: "p1" }] },
      ],
      cells: [[], cell("a", "p1")],
    },
    "order-list",
  );
  expect(mixed.cells).toBe(2);
  expect(mixed.present).toBe(1);
  expect(mixed.unmeasured).toBe(1);
  expect(mixed.problems.join("\n")).toMatch(/JSON オブジェクトでない要素/);
});

test("declared: false は reason が必須（免除の根拠が残らない形を通さない）", () => {
  expect(readDeclaration({ component_coverage: { declared: false } })).toMatchObject({
    judged: false,
    malformed: true,
  });
  expect(readDeclaration({ component_coverage: { declared: false, reason: "  " } })).toMatchObject({
    judged: false,
    malformed: true,
  });
});

test("components[].id が空・重複でも期待セルは 項目数 × インスタンス数 で数える", () => {
  const grid = {
    ...noProfile,
    items: [{ id: "a" }, { id: "b" }],
    instances: [{ id: "p1" }, { id: "p2" }, { id: "p3" }],
  };
  const noId = countCoverage(
    { slug: "order-list", conformance, components: [{ ...grid }], cells: [] },
    "order-list",
  );
  expect(noId).toMatchObject({ cells: 6, unmeasured: 6 });
  const dup = countCoverage(
    {
      slug: "order-list",
      conformance,
      components: [
        { id: "grid", ...grid },
        { id: "grid", ...grid },
      ],
      cells: [],
    },
    "order-list",
  );
  // 1 つ目は通常展開（6 セル・全未測定）、2 つ目は重複として 6 セルぶん未測定。
  expect(dup).toMatchObject({ cells: 12, unmeasured: 12 });
});

test("型崩れの metadata.json は旧成果物に倒さず malformed として弾く", () => {
  expect(readDeclaration([])).toMatchObject({ judged: false, malformed: true });
  expect(readDeclaration({ component_coverage: [] })).toMatchObject({
    judged: false,
    malformed: true,
  });
  expect(readDeclaration({ component_coverage: { declared: "true" } })).toMatchObject({
    judged: false,
    malformed: true,
  });
  expect(readDeclaration({ component_coverage: { declared: true, path: 5 } })).toMatchObject({
    judged: false,
    malformed: true,
  });
});

test("後方互換: component_coverage キーが無い旧成果物は判定に入れない", () => {
  const d = readDeclaration({ slug: "order-list" });
  expect(d.judged).toBe(false);
  expect(d.malformed).toBe(false);
  expect(d.reason).toMatch(/旧成果物/);
});

test("declared: false は理由付きで判定に入れない（キー欠落と区別する）", () => {
  const d = readDeclaration({
    component_coverage: { declared: false, reason: "共通部品を使っていない" },
  });
  expect(d.judged).toBe(false);
  expect(d.reason).toMatch(/共通部品を使っていない/);
});

// --- 被覆プロファイル（Issue #286）: 期待セルを候補集合で数え直す経路 ---

/** 列 2 つ（price / name）を列挙し、候補 3 件へ展開済みの部品。 */
function profiled(overrides = {}) {
  return {
    slug: "order-list",
    conformance,
    components: [
      {
        id: "grid",
        profile: "datagrid",
        profile_version: "1",
        items: [
          {
            id: "column-visible/price",
            candidate: { rule: "column-visible", axes: { column: "price" } },
          },
          {
            id: "column-visible/name",
            candidate: { rule: "column-visible", axes: { column: "name" } },
          },
          {
            id: "column-sort/price/asc",
            candidate: { rule: "column-sort", axes: { column: "price", "sort-direction": "asc" } },
          },
        ],
        instances: [
          {
            id: "orders",
            enumeration: {
              source: {
                kind: "current-source",
                ref: "src/grid/orderColumns.ts",
                version: "rev-abc123",
                extracted_at: "2026-09-03T00:00:00Z",
                condition: "columns 配列の全要素。hidden も含める",
              },
              complete: true,
              elements: { column: [{ id: "price" }, { id: "name" }] },
            },
            candidates: ["column-visible/price", "column-visible/name", "column-sort/price/asc"],
          },
        ],
        ...overrides,
      },
    ],
    cells: [
      cell("column-visible/price", "orders"),
      cell("column-visible/name", "orders"),
      cell("column-sort/price/asc", "orders"),
    ],
  };
}

test("陽性コントロール: プロファイル部品は候補ぶんの期待セルで数え、揃っていれば未測定ゼロ", () => {
  // 「常に落とす実装」を弾く。期待セルは 項目 × インスタンス（3×1）ではなく候補数（3）。
  const r = countCoverage(profiled(), "order-list");
  expect(r).toMatchObject({ cells: 3, present: 3, unmeasured: 0, problems: [] });
});

test("列挙した要素が候補に現れなければ未測定（代表列だけを確認した被覆表を落とす）", () => {
  const cov = profiled();
  const inst = cov.components[0].instances[0];
  // 列は price / name の 2 列と列挙したまま、候補・項目・セルを price だけに縮める。
  inst.candidates = ["column-visible/price"];
  cov.components[0].items = cov.components[0].items.filter((i) => i.id === "column-visible/price");
  cov.cells = cov.cells.filter((c) => c.item === "column-visible/price");
  const r = countCoverage(cov, "order-list");
  expect(r.unmeasured).toBeGreaterThan(0);
  expect(r.problems.join("\n")).toMatch(/要素 name がどの候補にも現れない/);
});

test("enumeration が無い・未完了・source 欠落はいずれも未測定に倒す", () => {
  for (const mutate of [
    (inst) => delete inst.enumeration,
    (inst) => {
      inst.enumeration.complete = false;
    },
    (inst) => delete inst.enumeration.source,
  ]) {
    const cov = profiled();
    mutate(cov.components[0].instances[0]);
    const r = countCoverage(cov, "order-list");
    expect(r.unmeasured).toBe(1);
    expect(r.problems.length).toBeGreaterThan(0);
  }
});

test("インスタンス id に区切り文字が入ったら未測定に倒す（同値クラスの members が切り分けられない）", () => {
  const cov = profiled();
  cov.components[0].instances[0].id = "admin/orders";
  for (const c of cov.cells) c.instance = "admin/orders";
  const r = countCoverage(cov, "order-list");
  expect(r).toMatchObject({ cells: 1, unmeasured: 1 });
  expect(r.problems.join("\n")).toMatch(/インスタンス id admin\/orders に "\/" を含む/);
});

test("candidates が空なら候補ゼロで素通りせず未測定 1 として数える", () => {
  const cov = profiled();
  cov.components[0].instances[0].candidates = [];
  expect(countCoverage(cov, "order-list")).toMatchObject({ cells: 1, unmeasured: 1 });
});

test("profile キーの欠落は暗黙の汎用扱いにせず未測定として数える", () => {
  const cov = profiled();
  delete cov.components[0].profile;
  const r = countCoverage(cov, "order-list");
  expect(r.unmeasured).toBeGreaterThan(0);
  expect(r.problems.join("\n")).toMatch(/profile キーが無い/);
});

test("profile: null は理由が必須（適合プロファイルが無いことの根拠を残す）", () => {
  const cov = full();
  delete cov.components[0].profile_absent_reason;
  expect(countCoverage(cov, "order-list").problems.join("\n")).toMatch(
    /profile_absent_reason が空/,
  );
});

test("conformance が無い・ok: false は収束させない（プロファイル適合の未実行を合格にしない）", () => {
  const missing = profiled();
  delete missing.conformance;
  expect(countCoverage(missing, "order-list").problems.join("\n")).toMatch(/conformance が無い/);
  const failed = profiled();
  failed.conformance = { tool: "coverage-expand", tool_version: "1", ok: false };
  expect(countCoverage(failed, "order-list").problems.join("\n")).toMatch(
    /conformance.ok が true ではない/,
  );
});

test("同値クラスを宣言したら全候補の所属が要る（削減した分だけの宣言で通さない）", () => {
  const cov = profiled();
  cov.components[0].equivalence_classes = [
    {
      id: "visible",
      axis: "column",
      rationale: "同じセルレンダラであることを現行 UI で確認した",
      members: ["orders/column-visible/price", "orders/column-visible/name"],
      representative: "orders/column-visible/price",
    },
  ];
  const r = countCoverage(cov, "order-list");
  // 3 件目（column-sort/price/asc）がどのクラスにも属していない。
  expect(r.problems.join("\n")).toMatch(/column-sort\/price\/asc がどの同値クラスにも属していない/);
  // 陽性コントロール: 全候補を分類すれば問題ゼロ（常に落とす実装を弾く）。
  cov.components[0].equivalence_classes.push({
    id: "sort",
    axis: "column",
    rationale: "ソート後の描画が同じ型であることを現行 UI で確認した",
    members: ["orders/column-sort/price/asc"],
    representative: "orders/column-sort/price/asc",
  });
  expect(countCoverage(cov, "order-list").problems).toEqual([]);
});

test("列挙要素の突き合わせは軸ごとに行う（別軸に同名の値があっても fail-open しない）", () => {
  const cov = profiled();
  const c = cov.components[0];
  const inst = c.instances[0];
  // menu-condition に "name" があり、column の "name" は自分の軸の候補に 1 件も無い状態。
  // 候補 id を "/" で割った値の和集合で見ると "name" が現れるため素通りしてしまう。
  inst.enumeration.elements["menu-condition"] = [{ id: "name" }];
  inst.candidates = ["column-visible/price", "column-sort/price/asc", "context-menu-open/row/name"];
  c.items = [
    {
      id: "column-visible/price",
      candidate: { rule: "column-visible", axes: { column: "price" } },
    },
    {
      id: "column-sort/price/asc",
      candidate: { rule: "column-sort", axes: { column: "price", "sort-direction": "asc" } },
    },
    {
      id: "context-menu-open/row/name",
      candidate: {
        rule: "context-menu-open",
        axes: { "menu-target": "row", "menu-condition": "name" },
      },
    },
  ];
  cov.cells = inst.candidates.map((id) => cell(id, "orders"));
  const r = countCoverage(cov, "order-list");
  expect(r.problems.join("\n")).toMatch(/列挙した column の要素 name がどの候補にも現れない/);
  expect(r.unmeasured).toBeGreaterThan(0);
  // 陽性コントロール: 同じ形で column の name も候補にすれば通る（常に落とす実装を弾く）。
  inst.candidates.push("column-visible/name");
  c.items.push({
    id: "column-visible/name",
    candidate: { rule: "column-visible", axes: { column: "name" } },
  });
  // menu-target は enumeration.elements に無いので突き合わせ対象外。
  cov.cells.push(cell("column-visible/name", "orders"));
  expect(countCoverage(cov, "order-list").problems).toEqual([]);
});

test("candidate.axes が引けない候補は和集合へフォールバックせず未測定に倒す", () => {
  const cov = profiled();
  delete cov.components[0].items[1].candidate;
  const r = countCoverage(cov, "order-list");
  expect(r.problems.join("\n")).toMatch(/candidate.axes が無い（軸ごとの突き合わせができない）/);
  expect(r.unmeasured).toBeGreaterThan(0);
});

test("候補にならない要素は justified_absences の根拠付きでだけ通す", () => {
  const cov = profiled();
  const inst = cov.components[0].instances[0];
  // name 列は定義に在るが、どの操作も有効でないため候補にならない。
  inst.candidates = ["column-visible/price", "column-sort/price/asc"];
  cov.components[0].items = cov.components[0].items.filter((i) => i.id.includes("/price"));
  cov.cells = inst.candidates.map((id) => cell(id, "orders"));
  expect(countCoverage(cov, "order-list").problems.join("\n")).toMatch(
    /要素 name がどの候補にも現れない/,
  );
  // 根拠を書けば通る（fail-closed の行き止まりを作らない）。
  inst.enumeration.justified_absences = [
    {
      scope: "column/name",
      reason:
        "表示・切替・スクロール到達・フィルター・ソートのいずれも無効なことを実 UI で確認した",
    },
  ];
  expect(countCoverage(cov, "order-list").problems).toEqual([]);
  // 根拠が空なら通さない。
  inst.enumeration.justified_absences = [{ scope: "column/name", reason: "  " }];
  expect(countCoverage(cov, "order-list").problems.join("\n")).toMatch(
    /要素 name がどの候補にも現れない/,
  );
});

test("同値クラスの rationale 空・members 外の representative は問題として残す", () => {
  const cov = profiled();
  cov.components[0].equivalence_classes = [
    {
      id: "visible",
      axis: "column",
      rationale: "  ",
      members: [
        "orders/column-visible/price",
        "orders/column-visible/name",
        "orders/column-sort/price/asc",
      ],
      representative: "orders/not-a-candidate",
    },
  ];
  const joined = countCoverage(cov, "order-list").problems.join("\n");
  expect(joined).toMatch(/rationale が空/);
  expect(joined).toMatch(/representative .* が members に含まれていない/);
});

/** 一時ディレクトリに metadata.json と被覆表を書いて CLI を実行する。 */
function runCli(metadata, coverage) {
  const dir = mkdtempSync(join(tmpdir(), "coverage-check-"));
  const metaPath = join(dir, "metadata.json");
  const covPath = join(dir, "component-coverage.json");
  writeFileSync(metaPath, JSON.stringify(metadata));
  // null ＝ 被覆表を書かない（読めないケース）、undefined ＝ --coverage も渡さない。
  if (coverage !== null && coverage !== undefined) writeFileSync(covPath, JSON.stringify(coverage));
  const args = [script, "--metadata", metaPath];
  if (coverage !== undefined) args.push("--coverage", covPath);
  return spawnSync(process.execPath, args, { encoding: "utf8" });
}

const declared = {
  slug: "order-list",
  component_coverage: { declared: true, path: "component-coverage.json" },
};

test("CLI 陽性コントロール: 未測定ゼロなら exit 0", () => {
  const r = runCli(declared, full());
  expect(r.status).toBe(0);
  expect(JSON.parse(r.stdout)).toMatchObject({ judged: true, cells: 4, unmeasured: 0 });
});

test("CLI 陰性コントロール: 未測定が残れば exit 1 で理由が stderr に出る", () => {
  const cov = full();
  cov.cells = cov.cells.slice(0, 2);
  const r = runCli(declared, cov);
  expect(r.status).toBe(1);
  expect(JSON.parse(r.stdout).unmeasured).toBe(2);
  expect(r.stderr).toMatch(/parity-suite へ戻す/);
});

test("CLI: declared: true なのに被覆表が読めなければ合格に倒さず exit 1", () => {
  const r = runCli(declared, null);
  expect(r.status).toBe(1);
  expect(JSON.parse(r.stdout)).toMatchObject({ judged: true, unmeasured: null });
});

test("CLI: 未測定 0 でも不整合が残れば error 行を出して exit 1 する", () => {
  const r = runCli(declared, { slug: "order-list", components: [], cells: [] });
  expect(r.status).toBe(1);
  expect(JSON.parse(r.stdout).unmeasured).toBe(0);
  expect(r.stderr).toMatch(/error: 被覆表の不整合/);
});

test("CLI: 型崩れの metadata.json は exit 2（後方互換の exit 0 に倒さない）", () => {
  const r = runCli([], full());
  expect(r.status).toBe(2);
  expect(JSON.parse(r.stdout)).toMatchObject({ judged: false, malformed: true, unmeasured: null });
});

test("CLI: キーを持たない旧成果物は exit 0 で judged: false を出力する", () => {
  const r = runCli({ slug: "order-list" }, full());
  expect(r.status).toBe(0);
  expect(JSON.parse(r.stdout)).toMatchObject({ judged: false });
});

test("CLI: declared: true で path も --coverage も無ければ判定した記録を出して exit 1", () => {
  const r = runCli({ slug: "order-list", component_coverage: { declared: true } }, undefined);
  expect(r.status).toBe(1);
  expect(JSON.parse(r.stdout)).toMatchObject({ judged: true, source: null, unmeasured: null });
});

test("CLI: 同じフラグの重複指定は後勝ちにせず exit 2", () => {
  const r = spawnSync(process.execPath, [script, "--metadata", "a.json", "--metadata", "b.json"], {
    encoding: "utf8",
  });
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/複数回指定/);
});
