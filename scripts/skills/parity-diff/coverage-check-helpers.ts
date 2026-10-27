// coverage-check.test.ts のヘルパー（網羅表の型と基準の fixture、absent の証拠、指紋を揃えた数え直し、CLI の実行）。

import { assert } from "vitest";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  fillSetProvenance,
  itemSource,
  setInventory,
} from "../../lib/testing/coverage-set-provenance-fixture.ts";
import { isRecord } from "../../lib/guards.ts";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";
import {
  captureFingerprint,
  countCoverage as countCoverageRaw,
  coverageFingerprint,
  MIN_COVERAGE_EXPAND_VERSION,
} from "../../../skills/parity-diff/scripts/coverage-check.mjs";
import { isArray } from "../../lib/is-array.ts";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";

// fixture の型。基準の fixture（full()・profiled() など）が置く正規の形を宣言する。
// テストは fixture を書き換えて不正な入力を作る。型に合わない値を書く箇所は invalidInput を通し、
// 必須の欄を消す箇所は `removeField(x, "field")` で書く。

/** 矩形。 */
export type Rect = { x: number; y: number; width: number; height: number };

/** 非描画の原因になった要素と、その計算後スタイル。 */
export type HiddenBy = {
  target_locator: string;
  locator: string;
  relation: string;
  relationship_verified: boolean;
  computed_style: Record<string, string>;
};

/** 非描画の状態ごとの実測。 */
export type RenderState = {
  name: string;
  transition: string;
  locator_match_count: number;
  bounding_box: Rect | null;
  offset_parent: string | null;
  hidden_by: HiddenBy | null;
};

/** absence_evidence の kind: non-renderable。 */
export type NonRenderableEvidence = {
  kind: string;
  locator: string;
  state_source: string;
  locator_includes_hidden: boolean;
  states_exhaustive: boolean;
  expected_states: string[];
  states: RenderState[];
};

/** fired-without-response の送り方。hit-test の欄は座標操作のときだけ書く。 */
export type FiredAction = {
  locator: string;
  method: string;
  detail: string;
  bounding_box: Rect;
  visible: boolean;
  actionability_bypassed: boolean;
  hit_test_target?: string;
  hit_test_is_target_or_descendant?: boolean;
};

/** fired-without-response の発火の確認。 */
export type Fired = { signal: string; detail: string; verified: boolean };

/** absence_evidence の kind: fired-without-response。 */
export type FiredEvidence = {
  kind: string;
  action: FiredAction;
  fired: Fired;
  observation: string;
};

/** 網羅表の 1 行。 */
export type Cell = {
  component: string;
  item: string;
  instance: string;
  value: string;
  evidence: string;
  covered_by: string[];
  absence_evidence?: NonRenderableEvidence | FiredEvidence | undefined;
  unmeasured_reason?: string;
};

/** インスタンスの applicable_states manifest。 */
export type ApplicableStates = {
  source: { kind: string; ref: string; version: string; condition: string };
  complete: boolean;
  items: { id: string; transition: string }[];
};

/** プロファイル部品のインスタンスの列挙。 */
export type Enumeration = {
  source: {
    kind: string;
    ref: string;
    version: string;
    extracted_at: string;
    condition: string;
  };
  complete: boolean;
  elements: Record<string, { id: string }[]>;
  justified_absences?: { scope: string; reason: string }[];
  stronger_source_unavailable_reason?: string;
  incomplete_reason?: string | null;
};

/** プロファイルを使わない部品のインスタンス。 */
export type Instance = { id: string; applicable_states?: ApplicableStates };

/** プロファイル部品のインスタンス。 */
export type ProfiledInstance = { id: string; enumeration: Enumeration; candidates: string[] };

export type Item = {
  id: string;
  candidate?: { rule: string; axes: Record<string, string> };
};

/** 同値クラスの宣言。 */
export type EquivalenceClass = {
  id: string;
  axis: string;
  rationale: string;
  members: string[];
  representative: string;
};

/** 集合の出所の宣言（形は coverage-set-provenance-fixture.ts の setInventory・itemSource が決める）。 */
export type SetDeclaration = Record<string, unknown>;

export type Component<I> = {
  id: string;
  profile: string | null;
  profile_version?: string;
  profile_absent_reason?: string;
  instance_inventory?: SetDeclaration;
  source?: SetDeclaration;
  items: Item[];
  instances: I[];
  equivalence_classes?: EquivalenceClass[];
};

/** 撮影状態の要約。指紋は記録するときに足す。 */
export type VisualStates = {
  checked: boolean;
  rows: number;
  undecided: number;
  missing_states: string[];
  table_fingerprint?: string;
  capture_fingerprint?: string;
};

/** coverage-expand のプロファイル適合の記録。 */
export type Conformance = {
  tool: string;
  tool_version: string;
  ok: boolean;
  visual_states: VisualStates;
};

export type Coverage<I = Instance> = {
  slug: string;
  conformance: Conformance;
  component_inventory?: SetDeclaration;
  components: Component<I>[];
  cells: Cell[];
};

export type ProfiledCoverage = Coverage<ProfiledInstance>;

/** countCoverage と runCli が受け取る網羅表。型崩れの網羅表は invalidInput で渡す。 */
export type AnyCoverage = Coverage | ProfiledCoverage;

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const script = join(repoRoot, "skills/parity-diff/scripts/coverage-check.mjs");

// 撮影状態の要約は記録時点の入力に結び付いている（指紋）。このファイルの被験対象は件数の数え直しなので、
// 呼ぶ直前に「その表・その撮影条件で記録した」状態へ揃えてから数える。
// 指紋そのものの検査は「撮影状態の要約は現在の入力と結び付いていなければ通さない」テストが持つ。
export const CAPTURE = { slug: "order-list", pageNames: [], states: [], popupStates: [] };
export function countCoverage(
  coverage: AnyCoverage,
  slug: string,
  captureNow: string | null = captureFingerprint(CAPTURE),
) {
  // 集合の出所（component_inventory / instance_inventory / components[].source）は
  // 宣言が無い fixture にだけ補う。宣言そのものを見るテストは countCoverageRaw を直接呼ぶ。
  fillSetProvenance(coverage);
  if (coverage && typeof coverage === "object" && !isArray(coverage)) {
    const conf = coverage.conformance;
    if (conf && typeof conf === "object" && conf.visual_states) {
      conf.visual_states = {
        ...conf.visual_states,
        table_fingerprint: coverageFingerprint(coverage),
        capture_fingerprint: captureFingerprint(CAPTURE),
      };
    }
  }
  return countCoverageRaw(coverage, slug, captureNow);
}

/** coverage-expand が書き戻すプロファイル適合の記録（無い・ok: false は収束させない）。 */
export const conformance: Conformance = {
  tool: "coverage-expand",
  // 撮影状態の要約は生成側の版が下限以上のときだけ信頼される（導出の意味論が変わった版）。
  tool_version: String(MIN_COVERAGE_EXPAND_VERSION),
  ok: true,
  visual_states: { checked: true, rows: 0, undecided: 0, missing_states: [] },
};

/** 適合プロファイルが無い部品の宣言（profile キーの欠落＝暗黙の汎用扱いと区別する）。 */
export const noProfile = {
  profile: null,
  profile_absent_reason: "軸を持たない単純な部品で、適合プロファイルが無い",
};

/** 部品 1 つ・項目 2 つ・インスタンス 2 つ ＝ 期待セル 4 の網羅表の骨格。 */
const skeleton = {
  slug: "order-list",
  conformance,
  // 3 つの集合（部品・インスタンス・項目）の出所と完全性。専任のテストが別に見るので、
  // 骨格では妥当な宣言を持たせておく。
  component_inventory: setInventory(),
  components: [
    {
      id: "grid",
      ...noProfile,
      instance_inventory: setInventory(),
      source: itemSource(),
      items: [{ id: "ctx-menu" }, { id: "drag-reorder" }],
      instances: [{ id: "orders" }, { id: "search" }],
    },
  ],
};

export const cell = (item: string, instance: string, extra?: Partial<Cell>): Cell => ({
  component: "grid",
  item,
  instance,
  value: "present",
  evidence: "右クリックでメニューが出た",
  covered_by: ["context-menu"],
  ...extra,
});

/** 4 セルすべてが測れている網羅表。テストが components を書き換えても骨格を汚さないよう複製する。 */
export function full(): Coverage {
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

export function firedEvidence(overrides: Partial<FiredEvidence> = {}): FiredEvidence {
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
export function firedCoordinateEvidence(): FiredEvidence {
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
export function nonRenderableEvidence(): NonRenderableEvidence {
  return {
    kind: "non-renderable",
    locator: "getByRole('menuitem', { name: 'Back', includeHidden: true })",
    state_source: "vendor spec v2 と現行 UI",
    locator_includes_hidden: true,
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

/** 実測した矩形を持つはずの状態から矩形を取り出す。無ければテストを失敗させる。 */
export function boxOf(state: RenderState): Rect {
  const box = state.bounding_box;
  assert.exists(box, `${state.name} の bounding_box が無い`);
  return box;
}

/** 非表示原因を持つはずの状態から hidden_by を取り出す。無ければテストを失敗させる。 */
export function hiddenByOf(state: RenderState): HiddenBy {
  const hiddenBy = state.hidden_by;
  assert.exists(hiddenBy, `${state.name} の hidden_by が無い`);
  return hiddenBy;
}

/** setInventory() の source（妥当な宣言）を取り出す。 */
export function inventorySource(): Record<string, unknown> {
  const { source } = setInventory();
  assert(isRecord(source), "setInventory() の source がオブジェクトでない");
  return source;
}

export function applicableStates(): ApplicableStates {
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

/** 列 2 つ（price / name）を列挙し、候補 3 件へ展開済みの部品。 */
export function profiled(overrides: Partial<Component<ProfiledInstance>> = {}): ProfiledCoverage {
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

/** 一時ディレクトリに metadata.json と網羅表を書いて CLI を実行する。 */
export function runCli(metadata: unknown, coverage: AnyCoverage | null | undefined) {
  const dir = makeTempDir("coverage-check-");
  const metaPath = join(dir, "metadata.json");
  const covPath = join(dir, "component-coverage.json");
  writeFileSync(metaPath, JSON.stringify(metadata));
  // null ＝ 網羅表を書かない（読めないケース）、undefined ＝ --coverage も渡さない。
  if (coverage !== null && coverage !== undefined) {
    // インプロセスの countCoverage ラッパと同じく、集合の出所を補ってから指紋を現在の内容へ揃える。
    fillSetProvenance(coverage);
    if (coverage && typeof coverage === "object" && coverage.conformance?.visual_states) {
      coverage.conformance.visual_states = {
        ...coverage.conformance.visual_states,
        table_fingerprint: coverageFingerprint(coverage),
        capture_fingerprint: captureFingerprint(CAPTURE),
      };
    }
    writeFileSync(covPath, JSON.stringify(coverage));
  }
  const args = [script, "--metadata", metaPath];
  if (coverage !== undefined) args.push("--coverage", covPath);
  return spawnSync(process.execPath, args, { timeout: CHILD_TIMEOUT_MS, encoding: "utf8" });
}

/** 集合の宣言だけを差し替えられる、未測定 0 の網羅表。 */
export function withSets({
  componentInventory,
  instanceInventory,
  source,
}: {
  componentInventory?: SetDeclaration | null;
  instanceInventory?: SetDeclaration | null;
  source?: SetDeclaration | null;
} = {}) {
  const cov = full();
  if (componentInventory === undefined) cov.component_inventory = setInventory();
  else if (componentInventory === null) delete cov.component_inventory;
  else cov.component_inventory = componentInventory;
  if (instanceInventory === undefined) cov.components[0].instance_inventory = setInventory();
  else if (instanceInventory === null) delete cov.components[0].instance_inventory;
  else cov.components[0].instance_inventory = instanceInventory;
  if (source === undefined) cov.components[0].source = itemSource();
  else if (source === null) delete cov.components[0].source;
  else cov.components[0].source = source;
  cov.conformance = {
    ...conformance,
    visual_states: { ...conformance.visual_states, rows: 0 },
  };
  cov.conformance.visual_states.table_fingerprint = coverageFingerprint(cov);
  cov.conformance.visual_states.capture_fingerprint = captureFingerprint(CAPTURE);
  return cov;
}

export const countSets = (cov: Coverage) =>
  countCoverageRaw(cov, "order-list", captureFingerprint(CAPTURE));
