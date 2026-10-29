// coverage-expand.test.ts のヘルパー（網羅表・プロファイル・撮影条件の型と fixture、証拠の取り出し、CLI の実行）。

import { assert, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fillSetProvenance } from "../../../lib/testing/coverage-set-provenance-fixture.ts";
import { makeTempDir } from "../../../lib/testing/test-tmpdir.ts";
import {
  expandCandidates,
  fillVisualStateRows,
  fillVisualStates,
  loadProfiles,
  readEnumeration,
  reconcile as reconcileRaw,
} from "../../../../skills/parity-suite/scripts/coverage-expand.mjs";
import { isArray } from "../../../lib/is-array.ts";
import { invalidInput, removeField } from "../../../lib/testing/test-input.ts";
import { CHILD_TIMEOUT_MS } from "../../../lib/testing/child-timeout.ts";
import {
  datagridEnumeration,
  findOrFail,
  reconcile,
} from "../../_cross/coverage-fixture-helpers.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
export const script = join(repoRoot, "skills/parity-suite/scripts/coverage-expand.mjs");
export const bundledProfiles = join(repoRoot, "skills/parity-suite/assets/coverage-profiles");

// このテストが組み立てて書き換える網羅表・プロファイル・撮影条件の形。
// 被験の .mjs は動的 import なので型を持たない。ここではテストが触るフィールドだけを宣言する。
export type ExpandedCandidate = { id: string; rule: string; axes: Record<string, string> };
export type VisualStateRow = {
  component: string;
  instance: string;
  kind: string;
  required_by: string;
  captured: string | null;
  reason: string | null;
  shared_capture_reason?: string;
};
export type SetInventory = {
  // fillSetProvenance の setInventory が書く形
  source: { kind: string; ref: string; version: string; condition: string };
  complete?: boolean;
  incomplete_reason?: string;
  stronger_source_unavailable_reason?: string;
};
export type EnumElement = { id: string; flags: Record<string, boolean> };
export type Enumeration = {
  source: {
    kind: string;
    ref: string;
    version: string;
    extracted_at: string;
    condition?: string;
  };
  complete: boolean;
  incomplete_reason?: string | null;
  stronger_source_unavailable_reason?: string;
  justified_absences?: { scope: string; reason: string }[];
  elements: Record<string, EnumElement[]>;
};
export type ApplicableStates = {
  source: { kind: string; ref: string; version: string; condition: string };
  complete: boolean;
  items: { id: string; transition: string }[];
};
export type BoundingBox = { x: number; y: number; width: number; height: number };
export type HiddenBy = {
  target_locator: string;
  locator: string;
  relation: string;
  relationship_verified: boolean;
  computed_style: Record<string, string>;
};
export type AbsenceState = {
  name: string;
  transition: string;
  locator_match_count?: number;
  bounding_box: BoundingBox | null;
  offset_parent?: string | null;
  hidden_by?: HiddenBy | null;
};
/** absent の証拠。kind ごとに使うフィールドが違うので、kind に依るフィールドは省略できる。 */
export type AbsenceEvidence = {
  kind: string;
  locator?: string;
  state_source?: string;
  locator_includes_hidden?: boolean;
  states_exhaustive?: boolean;
  expected_states?: string[];
  states?: AbsenceState[];
  action?: {
    locator: string;
    method: string;
    detail: string;
    bounding_box: BoundingBox;
    visible: boolean;
    actionability_bypassed: boolean;
    hit_test_target: string;
    hit_test_is_target_or_descendant: boolean;
  };
  fired?: { signal: string; detail: string; verified: boolean };
  observation?: string;
};
/** non-renderable の証拠（状態ごとの記録を持つ）。 */
type NonRenderableEvidence = AbsenceEvidence & { states: AbsenceState[] };
/** fired-without-response の証拠（送り方と発火確認を持つ）。 */
export type FiredEvidence = AbsenceEvidence & {
  action: NonNullable<AbsenceEvidence["action"]>;
  fired: NonNullable<AbsenceEvidence["fired"]>;
};
export type Cell = {
  component: string;
  item: string;
  instance: string;
  value: string;
  evidence: string;
  covered_by: string[];
  unmeasured_reason?: string | null;
  absence_evidence?: AbsenceEvidence | null;
};
export type Item = {
  id: string;
  category: string;
  name: string;
  candidate: { rule: string; axes: Record<string, string> };
  visual_states?: string[];
  no_visual_state_reason?: string | null;
};
export type Instance = {
  id: string;
  page: string;
  locator: string;
  enumeration: Enumeration;
  candidates: string[];
  applicable_states?: ApplicableStates;
};
export type EquivalenceClass = {
  id: string;
  axis: string;
  rationale: string;
  members: string[];
  representative: string;
};
export type Component = {
  id: string;
  profile?: string | null;
  profile_version: string;
  items: Item[];
  instances: Instance[];
  equivalence_classes?: EquivalenceClass[];
  instance_inventory?: SetInventory;
};
/** プロファイルの候補から作った網羅表（datagridCoverage が返す形）。 */
export type Coverage = {
  slug: string;
  visual_state_coverage: { rows: VisualStateRow[] };
  components: Component[];
  cells: Cell[];
  component_inventory?: SetInventory;
};
/** プロファイルを宣言しない部品の網羅表。visual_state_coverage は fillVisualStateRows が埋める。 */
export type GenericCoverage = {
  slug?: string;
  feature?: string;
  visual_state_coverage?: { rows: VisualStateRow[] };
  components: {
    id: string;
    profile: string | null;
    profile_absent_reason: string;
    items: {
      id: string;
      name?: string;
      visual_states?: string[];
      no_visual_state_reason?: string | null;
    }[];
    instances: { id: string; page?: string; locator?: string }[];
  }[];
  cells: Cell[];
};
export type CandidateRule = {
  id: string;
  name?: string;
  axes: string[];
  guard: Record<string, boolean>;
  requirement?: string;
  visual_states?: string[];
  no_visual_state_reason?: string;
};
export type Profile = {
  id: string;
  version: string;
  name?: string;
  applies_to: string;
  axes: { id: string; kind: string; name?: string; flags?: string[]; values?: string[] }[];
  enumeration: { sources: string[]; procedure: string; pitfalls: string[]; fail_closed: string };
  candidate_rules: CandidateRule[];
  required_rules: (string | string[])[];
  equivalence: { reducible_axes: string[]; constraints?: string[] };
};
export type CaptureConditions = { pageNames: string[]; states: string[]; popupStates: string[] };
/** visual_state_coverage をまだ導出していない網羅表（resolveVisualStates が埋める）。 */
export type UnresolvedCoverage = Omit<Coverage, "visual_state_coverage"> &
  Partial<Pick<Coverage, "visual_state_coverage">>;

/** fillVisualStateRows が埋めた撮影状態の行。 */
export function rowsOf(coverage: {
  visual_state_coverage?: { rows: VisualStateRow[] };
}): VisualStateRow[] {
  assert.exists(coverage.visual_state_coverage, "visual_state_coverage が無い");
  return coverage.visual_state_coverage.rows;
}

function isNonRenderable(evidence: AbsenceEvidence): evidence is NonRenderableEvidence {
  return isArray(evidence.states);
}

function isFired(evidence: AbsenceEvidence): evidence is FiredEvidence {
  return evidence.action !== undefined && evidence.fired !== undefined;
}

/** セルの non-renderable の証拠（状態ごとの記録を持つもの）。 */
function nonRenderable(cell: Cell): NonRenderableEvidence {
  const evidence = cell.absence_evidence;
  assert.exists(evidence, "セルに absence_evidence が無い");
  assert(isNonRenderable(evidence), "absence_evidence に states が無い");
  return evidence;
}

/** セルの fired-without-response の証拠（送り方と発火確認を持つもの）。 */
export function firedEvidenceOf(cell: Cell): FiredEvidence {
  const evidence = cell.absence_evidence;
  assert.exists(evidence, "セルに absence_evidence が無い");
  assert(isFired(evidence), "absence_evidence に action・fired が無い");
  return evidence;
}

/** non-renderable の証拠の最初の状態。 */
export function firstState(cell: Cell): AbsenceState {
  return nonRenderable(cell).states[0];
}

function expectedStates(cell: Cell): string[] {
  const { expected_states: states } = nonRenderable(cell);
  assert.exists(states, "absence_evidence に expected_states が無い");
  return states;
}

function applicableStates(instance: Instance): ApplicableStates {
  assert.exists(
    instance.applicable_states,
    `インスタンス ${instance.id} に applicable_states が無い`,
  );
  return instance.applicable_states;
}

function assertRowsFilled(coverage: UnresolvedCoverage): asserts coverage is Coverage {
  assert.exists(
    coverage.visual_state_coverage,
    "fillVisualStateRows が visual_state_coverage を書いていない",
  );
}

/**
 * 撮影状態の導出を「決め済み」にしてから返す。撮影状態の未決はこのファイルの被験対象ではないので、
 * 他の検査が撮影状態の problems に埋もれないよう、導いた行を全て captured で解決しておく。
 * 決め方そのものは deriveVisualStateRows / checkVisualStates の専用テストで見る。
 */
export function resolveVisualStates(
  // visual_state_coverage は、まだ導出していない網羅表では無い（この関数が埋める）
  coverage: UnresolvedCoverage,
  profiles: Profiles = bundled,
  // 行は「要求元の操作 × 種別」なので、状態名も要求元ごとに分ける
  // （種別名だけを配ると opens-container の別々のコンテナが同じ状態名を指してしまう）。
  decide = (row: VisualStateRow) => `${row.required_by}:${row.kind}`,
): Coverage {
  fillVisualStates(coverage, profiles);
  fillVisualStateRows(coverage);
  assertRowsFilled(coverage);
  for (const row of coverage.visual_state_coverage.rows) row.captured = decide(row);
  return coverage;
}

/** filter(Boolean) と同じく null と空文字を除き、型も string に絞る。 */
function isNonEmpty(value: string | null): value is string & { readonly __isNonEmpty: true } {
  return Boolean(value);
}

/** 導いた行が要求する撮影状態名とページ名をそのまま metadata の撮影条件にしたもの。 */
export function captureConditionsFor(coverage: Coverage): CaptureConditions {
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
    states: [...new Set(["default", ...rows.map((r) => r.captured).filter(isNonEmpty)])],
    popupStates: [
      ...new Set(
        rows
          .filter((r) => r.kind === "opens-container")
          .map((r) => r.captured)
          .filter(isNonEmpty),
      ),
    ],
  };
}

export const { profiles: bundled, problems: bundledProblems } = loadProfiles(bundledProfiles);

/** loadProfiles が返すプロファイルの表（JSON をパースした値なので、欄は使う側で確かめる）。 */
export type Profiles = Parameters<typeof reconcileRaw>[1];

/** パースしたプロファイルが、テストが読む欄を持つかを確かめる。 */
function isProfile(value: Record<string, unknown>): value is Profile {
  return (
    typeof value.id === "string" &&
    isArray(value.axes) &&
    isArray(value.candidate_rules) &&
    isArray(value.required_rules)
  );
}

/** 同梱プロファイルを id で取り出す。無いか形が違えばテストを落とす。 */
export function bundledProfile(id: string): Profile {
  const found = bundled.get(id);
  assert.exists(found, `同梱プロファイル ${id} が無い`);
  assert(isProfile(found), `同梱プロファイル ${id} の形が違う`);
  return found;
}

/**
 * プロファイル 1 件を、CLI と同じ loadProfiles で読んだときの problems を返す。
 * プロファイルを配る人に見えるのは CLI が表示する problems なので、形式の検査はこの出口で確かめる。
 * ファイル名は id から決める（id とファイル名の不一致は別の検査なので、ここでは起こさない）。
 */
export function profileProblems(
  profile: { id?: unknown },
  name = `${String(profile.id)}.json`,
): string[] {
  const { profiles, problems } = loadProfiles("profiles", {
    readdir: () => [name],
    readFile: () => JSON.stringify(profile),
  });
  // 問題が無いのに読み込まれていなければ、警告なしに外れたことになる。
  if (problems.length === 0) expect(profiles.has(String(profile.id))).toBe(true);
  return problems;
}

/** DataGrid の列挙（_cross/coverage-fixture-helpers.ts の datagridEnumeration）から展開される全候補を、present で埋めた網羅表。 */
export function datagridCoverage() {
  const profile = bundledProfile("datagrid");
  const { elements } = readEnumeration(datagridEnumeration(), profile, "t");
  const candidates: ExpandedCandidate[] = expandCandidates(profile, elements);
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
            enumeration: datagridEnumeration(),
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

/**
 * 一時ディレクトリにプロファイルと網羅表を書いて CLI を実行する。
 * プロファイルディレクトリ（@profiles）と成果物ディレクトリを分ける。同じにすると
 * 網羅表がプロファイルとして読み込まれ、検証したい処理と別の理由で落ちる。
 */
export function runCli(
  args: string[],
  {
    profiles = {},
    files = {},
  }: { profiles?: Record<string, unknown>; files?: Record<string, unknown> } = {},
) {
  const root = makeTempDir("coverage-expand-");
  const profilesDir = join(root, "profiles");
  mkdirSync(profilesDir);
  const write = (dir: string, name: string, content: unknown) => {
    const path = join(dir, name);
    writeFileSync(
      path,
      typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`,
    );
    return path;
  };
  for (const [name, content] of Object.entries(profiles)) write(profilesDir, name, content);
  const paths: Record<string, string> = {};
  for (const [name, content] of Object.entries(files)) {
    // インプロセスの reconcile ラッパと同じく、網羅表には集合の出所を補ってから書き出す
    // （宣言そのものを見るテストは自分で書いた値を持つので上書きされない）。
    if (name === "component-coverage.json") fillSetProvenance(content);
    paths[name] = write(root, name, content);
  }
  const resolved = args.map((a) => paths[a] ?? (a === "@profiles" ? profilesDir : a));
  return {
    root,
    paths,
    ...spawnSync(process.execPath, [script, ...resolved], {
      timeout: CHILD_TIMEOUT_MS,
      encoding: "utf8",
    }),
  };
}

/** 網羅表が要求する撮影状態とページ名を、そのまま撮影条件に持つ metadata.json。 */
export function metadataFor(cov: Coverage) {
  const conditions = captureConditionsFor(cov);
  return {
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
}

/** 形式の検査を確かめるための最小のプロファイル（軸 1 つ・ルール 1 つ）。 */
export function minimalProfile(): Profile {
  return {
    id: "m",
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
}

/** 網羅表の形を 1 か所壊し、照合が合格として扱わず、狙った問題を報告することを確かめる。 */
export function expectRejected(
  mutate: (cov: Coverage) => unknown,
  pattern: RegExp,
  { unmeasured = true }: { unmeasured?: boolean } = {},
) {
  const cov = datagridCoverage();
  mutate(cov);
  const r = reconcile(cov, bundled);
  expect(r.ok).toBe(false);
  expect(r.problems.join("\n")).toMatch(pattern);
  if (unmeasured) expect(r.unmeasured).toBeGreaterThan(0);
  return r;
}

/** 最初の候補を、全状態で非描画だった absent として記録した網羅表（照合を通る形）。 */
export function nonRenderableCoverage(): Coverage {
  const cov = datagridCoverage();
  const locator = "getByRole('columnheader', { name: 'Price', includeHidden: true })";
  cov.cells[0] = {
    ...cov.cells[0],
    value: "absent",
    covered_by: [],
    evidence: "全到達状態で非描画",
    absence_evidence: {
      kind: "non-renderable",
      locator,
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
  return cov;
}

/** 非描画 absent の証拠で、非表示 CSS・expected_states の重複・検証していない関係を落とすことを確かめる（cov の証拠を複製して壊す）。 */
export function expectHiddenCauseChecked(cov: Coverage) {
  const visibleStyle = datagridCoverage();
  visibleStyle.cells[0] = structuredClone(cov.cells[0]);
  firstState(visibleStyle.cells[0]).offset_parent = null;
  firstState(visibleStyle.cells[0]).bounding_box = {
    x: 0,
    y: 0,
    width: 10,
    height: 20,
  };
  firstState(visibleStyle.cells[0]).hidden_by = {
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
  firstState(duplicateState.cells[0]).offset_parent = null;
  duplicateState.components[0].instances[0].applicable_states = structuredClone(
    cov.components[0].instances[0].applicable_states,
  );
  expectedStates(duplicateState.cells[0]).push("desktop/default");
  expect(reconcile(duplicateState, bundled).problems.join("\n")).toMatch(/expected_states が重複/);

  const unrelatedHidden = datagridCoverage();
  unrelatedHidden.cells[0] = structuredClone(cov.cells[0]);
  firstState(unrelatedHidden.cells[0]).bounding_box = null;
  firstState(unrelatedHidden.cells[0]).offset_parent = null;
  firstState(unrelatedHidden.cells[0]).hidden_by = {
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
}

/** 非描画 absent の証拠で、実在しない矩形と display: none の矛盾を落とし、visibility は巻き込まないことを確かめる。 */
export function expectBoxAndDisplayChecked(cov: Coverage) {
  // 実在しない矩形（負値・非有限）で 0 寸法判定を迂回させない
  for (const [field, value, pattern] of [
    ["width", -1, /負（実在しない矩形）/],
    ["height", -0.5, /負（実在しない矩形）/],
    ["x", Number.NaN, /有限の数値ではない/],
    ["y", Number.POSITIVE_INFINITY, /有限の数値ではない/],
  ] satisfies [keyof BoundingBox, number, RegExp][]) {
    const badBox = datagridCoverage();
    badBox.cells[0] = structuredClone(cov.cells[0]);
    firstState(badBox.cells[0]).offset_parent = null;
    const box = firstState(badBox.cells[0]).bounding_box;
    assert.exists(box, "複製した状態に bounding_box が無い");
    box[field] = value;
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
  firstState(displayNoneConflict.cells[0]).bounding_box = null;
  firstState(displayNoneConflict.cells[0]).offset_parent = "#visible-parent";
  firstState(displayNoneConflict.cells[0]).hidden_by = {
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

  // visibility の判定まで巻き込まない（offsetParent は残るため非 null が正当）
  const visibilityHidden = structuredClone(displayNoneConflict);
  const hiddenBy = firstState(visibilityHidden.cells[0]).hidden_by;
  assert.exists(hiddenBy, "複製した状態に hidden_by が無い");
  hiddenBy.computed_style = {
    visibility: "hidden",
  };
  expect(reconcile(visibilityHidden, bundled)).toMatchObject({ ok: true, unmeasured: 0 });
}

/** 一部の状態で DOM に無い候補（1 件の状態が残っているもの）を、非描画 absent として通すことを確かめる。 */
export function expectPartiallyAbsentAccepted(cov: Coverage) {
  // 新たに受理する入力クラス: 一部の状態で DOM に無い候補（1 件の状態が残っていれば通る）
  const partiallyAbsent = datagridCoverage();
  partiallyAbsent.cells[0] = structuredClone(cov.cells[0]);
  firstState(partiallyAbsent.cells[0]).offset_parent = null;
  expectedStates(partiallyAbsent.cells[0]).push("mobile/default");
  nonRenderable(partiallyAbsent.cells[0]).states.push({
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
  applicableStates(partiallyAbsent.components[0].instances[0]).items.push({
    id: "mobile/default",
    transition: "mobile viewport へ切り替える",
  });
  expect(reconcile(partiallyAbsent, bundled)).toMatchObject({ ok: true, unmeasured: 0 });
}

/** locator が対象を一意に引けていない記録と、矛盾した 0 件の記録を未測定として扱うことを確かめる。 */
export function expectLocatorRecordChecked(cov: Coverage) {
  // locator が対象を一意に引けていない記録・矛盾した 0 件記録は未測定として扱う
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
  ] satisfies [(e: NonRenderableEvidence) => unknown, RegExp][]) {
    const badLocator = datagridCoverage();
    badLocator.cells[0] = structuredClone(cov.cells[0]);
    firstState(badLocator.cells[0]).offset_parent = null;
    badLocator.components[0].instances[0].applicable_states = structuredClone(
      cov.components[0].instances[0].applicable_states,
    );
    // 直前に cov.cells[0] から複製した non-renderable の証拠
    mutate(nonRenderable(badLocator.cells[0]));
    const r = reconcile(badLocator, bundled);
    expect(r).toMatchObject({ ok: false, unmeasured: 1 });
    expect(r.problems.join("\n")).toMatch(pattern);
  }
}

/** applicable_states.source.kind が語彙の外なら未測定として扱い、語彙の 4 種は通すことを確かめる。 */
export function expectStateSourceKindChecked(cov: Coverage) {
  // 語彙外の source.kind は出所不明として未測定として扱う（非空判定だけでは通ってしまう）
  for (const kind of ["invented", "config"]) {
    const inventedSource = datagridCoverage();
    inventedSource.cells[0] = structuredClone(cov.cells[0]);
    firstState(inventedSource.cells[0]).offset_parent = null;
    inventedSource.components[0].instances[0].applicable_states = structuredClone(
      cov.components[0].instances[0].applicable_states,
    );
    applicableStates(inventedSource.components[0].instances[0]).source.kind = kind;
    const r = reconcile(inventedSource, bundled);
    expect(r).toMatchObject({ ok: false, unmeasured: 1 });
    expect(r.problems.join("\n")).toMatch(/applicable_states\.source\.kind/);
  }

  // 語彙内の 4 種はいずれも通る（allowlist を空にする変異で赤くなる）
  for (const kind of ["profile", "vendor-spec", "current-source", "app-ui"]) {
    const allowed = datagridCoverage();
    allowed.cells[0] = structuredClone(cov.cells[0]);
    firstState(allowed.cells[0]).offset_parent = null;
    allowed.components[0].instances[0].applicable_states = structuredClone(
      cov.components[0].instances[0].applicable_states,
    );
    applicableStates(allowed.components[0].instances[0]).source.kind = kind;
    expect(reconcile(allowed, bundled)).toMatchObject({ ok: true, unmeasured: 0 });
  }
}

/** 最初の候補を、座標操作で発火を確かめた fired-without-response の absent として記録した網羅表。 */
export function firedAbsentCoverage(): Coverage {
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
  const c = datagridCoverage();
  c.cells[0] = {
    ...c.cells[0],
    value: "absent",
    covered_by: [],
    evidence: "右クリックしても応答が無い",
    absence_evidence: firedEvidence(),
  };
  return c;
}

/** プロファイルを宣言しない部品 1 つ（項目 1・インスタンス 1）の網羅表。セルは証拠の足りない non-renderable の absent。 */
export function genericCoverage(): GenericCoverage {
  return {
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
  };
}

/** id が空・重複の要素を、読み飛ばさずにその要素が関わるセルの未測定として数えることを確かめる。 */
export function expectGenericIdChecked(good: GenericCoverage) {
  // id が空・重複の要素は警告なしに読み飛ばさず、その要素が関わるセルを未測定として数える
  // （読み飛ばすと、識別できない要素があるのに conformance.ok: true を出せる）
  for (const [mutate, pattern] of [
    // わざと id の無い項目を足す
    [(c) => c.components[0].items.push(invalidInput({ name: "id が無い" })), /items\[1\]: id が空/],
    [(c) => c.components[0].items.push({ id: "ctx-menu" }), /items\[1\]: id ctx-menu が重複/],
    // わざと id の無いインスタンスを足す
    [
      (c) => c.components[0].instances.push(invalidInput({ page: "id が無い" })),
      /instances\[1\]: id が空/,
    ],
    [(c) => c.components[0].instances.push({ id: "orders" }), /instances\[1\]: id orders が重複/],
  ] satisfies [(c: GenericCoverage) => unknown, RegExp][]) {
    const cov = structuredClone(good);
    mutate(cov);
    const r = reconcile(cov, bundled);
    expect(r).toMatchObject({ ok: false });
    expect(r.unmeasured).toBeGreaterThan(0);
    expect(r.problems.join("\n")).toMatch(pattern);
  }
}

/** プロファイルを宣言しない部品 chart（項目 zoom・インスタンス dashboard）を present で測った網羅表。 */
export function chartCoverage() {
  return {
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
  };
}

// ----- 共通処理を変えずに足せることを確かめる仮想部品（ノードと展開状態を軸に持つツリー） -----

/** DataGrid に一切似ていない仮想部品のプロファイル。 */
export function treeviewProfile() {
  return {
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
}

/** ツリーのノードの列挙（展開できる root と、展開できない leaf）。 */
function treeviewEnumeration() {
  return {
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
}

/** 列挙から展開される候補 4 件。 */
export function treeviewCandidates() {
  return [
    "node-expand/root/collapsed",
    "node-expand/root/expanded",
    "node-select/root",
    "node-select/leaf",
  ];
}

/** 候補ルールごとの撮影状態の種別。 */
const TREE_VISUAL_STATES: Record<string, string[]> = {
  "node-expand": ["opens-container"],
  "node-select": ["hover"],
};

/** 撮影状態の行。候補ごとに立ち、状態名も候補ごとに別の名前を振る。 */
function treeviewStateRows(candidates: string[]) {
  return candidates.map((id) => ({
    component: "tree",
    instance: "org",
    kind: TREE_VISUAL_STATES[id.split("/")[0]][0],
    required_by: id,
    captured: `状態:${id}`,
    reason: null,
  }));
}

/** 候補をすべて present で埋め、撮影状態の行を候補ごとに決めた網羅表。 */
export function treeviewCoverage(candidates: string[]) {
  return {
    slug: "org-tree",
    // 行は候補ごとに立つ（同値クラスを宣言していないので縮約しない）。
    // 同じインスタンスでは状態名も一意なので、候補ごとに別の名前を振る。
    visual_state_coverage: { rows: treeviewStateRows(candidates) },
    components: [
      {
        id: "tree",
        profile: "treeview",
        profile_version: "1",
        items: candidates.map((id) => ({
          id,
          visual_states: TREE_VISUAL_STATES[id.split("/")[0]],
          no_visual_state_reason: null,
          candidate: {
            rule: id.split("/")[0],
            axes: id.startsWith("node-expand")
              ? { node: id.split("/")[1], state: id.split("/")[2] }
              : { node: id.split("/")[1] },
          },
        })),
        instances: [
          {
            id: "org",
            page: "組織",
            locator: "org.tree",
            enumeration: treeviewEnumeration(),
            candidates,
          },
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
}

/** 網羅表が要求する撮影状態とページを持つ metadata.json。 */
export function treeviewMetadata(candidates: string[]) {
  return {
    slug: "org-tree",
    capture_conditions: {
      pages: [{ name: "組織", path: "/org" }],
      states: ["default", ...candidates.map((id) => `状態:${id}`)],
      popup_inventory: candidates
        .filter((id) => TREE_VISUAL_STATES[id.split("/")[0]][0] === "opens-container")
        .map((id) => ({
          name: `ポップアップ:${id}`,
          parent: null,
          opened_by: `expandNode(org.tree, ${id})`,
          captured: `状態:${id}`,
          reason: null,
        })),
    },
  };
}

/** 撮影状態の行が、種別やルール id でまとめずに要求元の候補ごとに分かれることを確かめる。 */
export function expectRowsSplitByRequirer(cov: Coverage) {
  // 行は要求元の候補ごとに分かれる。種別だけで束ねると、同じ opens-container を要求する
  // 列フィルタの吹き出しと右クリックメニューが 1 行へ潰れ、片方を撮るだけでチェックが通る。
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
  // **ルール id でまとめない**。ルールは複数の軸の直積へ展開されるので、まとめると
  // 縮約してはいけない軸（datagrid では sort-direction）まで畳んでしまう。
  const sortActive = cov.visual_state_coverage.rows.filter(
    (r) => r.kind === "active" && r.required_by.startsWith("column-sort/"),
  );
  const sortCandidates = cov.components[0].items.filter((i) => i.candidate.rule === "column-sort");
  expect(sortActive).toHaveLength(sortCandidates.length);
  expect(sortActive.map((r) => r.required_by).sort()).toEqual(
    sortCandidates.map((i) => i.id).sort(),
  );
}

/** 項目の撮影状態の種別が、プロファイルから書き戻されることを確かめる。 */
export function expectItemVisualStatesFromProfile(cov: Coverage) {
  // 項目の種別はプロファイルから書き戻される（部品ごとに手で書かない）。
  const sortItem = findOrFail(
    cov.components[0].items,
    (i) => i.candidate.rule === "column-sort",
    "column-sort の項目",
  );
  expect(sortItem.visual_states).toEqual(["hover", "focus", "active", "after-operation"]);
  const visibleItem = findOrFail(
    cov.components[0].items,
    (i) => i.candidate.rule === "column-visible",
    "column-visible の項目",
  );
  expect(visibleItem.visual_states).toEqual([]);
  expect(visibleItem.no_visual_state_reason).toMatch(/操作しない/);
}

/** 項目の visual_states の誤記を、空の宣言に読み替えずに誤記として 1 件だけ報告することを確かめる。 */
export function expectVisualStateTypoNotSplit() {
  // 誤記だけの宣言を「空の宣言」に読み替えない。読み替えると 1 つの誤記が
  // 「誤記」と「空なのに理由が無い」の 2 件に割れ、理由欄を埋める誤った直しへ誘導する
  // （理由欄の要否はプロファイル側の validateProfile と同じく宣言した長さで決まる）。
  const typo = datagridCoverage();
  findOrFail(
    typo.components[0].items,
    (i) => i.candidate.rule === "column-sort",
    "column-sort の項目",
  ).visual_states = ["pressed"];
  const typoProblems = reconcile(typo, bundled, captureConditionsFor(typo)).problems.join("\n");
  expect(typoProblems).toMatch(/は opens-container \| hover/);
  expect(typoProblems).not.toMatch(/no_visual_state_reason が空/);

  // 誤記だけの宣言に理由欄が埋まっていれば、それは「非空なのに理由が埋まっている」として残る。
  const typoWithReason = datagridCoverage();
  const sortItem = findOrFail(
    typoWithReason.components[0].items,
    (i) => i.candidate.rule === "column-sort",
    "column-sort の項目",
  );
  sortItem.visual_states = ["pressed"];
  sortItem.no_visual_state_reason = "余計な理由";
  expect(
    reconcile(typoWithReason, bundled, captureConditionsFor(typoWithReason)).problems.join("\n"),
  ).toMatch(/no_visual_state_reason が埋まっている/);
}

/** 撮影条件から状態を 1 つ落とした metadata を、CLI が撮影条件に無い状態名として落とすことを確かめる。 */
export function expectDroppedStateRejected(
  cov: Coverage,
  metadata: ReturnType<typeof metadataFor>,
) {
  // 落ちることの確認: 撮影条件から状態を 1 つ落とすと落ちる（常に通す実装を弾く）。
  const short = structuredClone(metadata);
  const droppedState = findOrFail(
    cov.visual_state_coverage.rows,
    (row) => row.kind === "focus" && row.required_by.startsWith("column-sort/"),
    "column-sort の focus の行",
  ).captured;
  assert.exists(droppedState, "column-sort の focus の行の captured が無い");
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
}

/** capture_conditions を持たない metadata と別機能の metadata を、CLI が使い方の誤り（exit 2）にすることを確かめる。 */
export function expectUnusableMetadataRejected(
  cov: Coverage,
  metadata: ReturnType<typeof metadataFor>,
) {
  // capture_conditions を持たない metadata は「照合しない」として扱わず使い方の誤りにする。
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

  // 別機能の metadata を警告なしに受理しない（状態名が汎用なら突き合わせも通ってしまう）。
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
  expect(otherFeature.stderr).toMatch(/slug（another-feature）が網羅表の slug（order-list）と違う/);
}

/** 列フィルタの吹き出しと右クリックメニュー（どちらも opens-container を要求する）を 1 インスタンスで測った網羅表。 */
export function sharedPopupCoverage(): GenericCoverage {
  return {
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
}

/** 状態名を使い回した行は、全行に根拠を書けば通り、一部の行だけでは通らないことを確かめる。 */
export function expectSharedCaptureJustified(onePopup: CaptureConditions) {
  // 不合格の後に進む先を残す: 同じコンテナを開く 2 操作は全行に根拠を書けば通る。
  const justified = sharedPopupCoverage();
  fillVisualStateRows(justified);
  for (const row of rowsOf(justified)) {
    row.captured = "only-one-popup";
    row.shared_capture_reason = "どちらの操作も同一のダイアログを開くことを実 UI で確認した";
  }
  expect(reconcile(justified, bundled, onePopup).problems).toEqual([]);

  // 根拠が一部の行にしか無ければ通さない（書いた行だけで全体を免除しない）。
  const partial = structuredClone(justified);
  delete rowsOf(partial)[0].shared_capture_reason;
  expect(reconcile(partial, bundled, onePopup).problems.join("\n")).toMatch(/根拠が空/);
}

/** 別ページのインスタンス間では、同じ状態名を使い回しても通すことを確かめる。 */
export function expectSharedAcrossPagesAccepted(names: Record<string, string>) {
  // 別ページのインスタンス間では使い回してよい（撮影単位が違うので別の 1 枚になる）。
  const twoPages = sharedPopupCoverage();
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
  for (const row of rowsOf(twoPages)) row.captured = names[row.required_by];
  expect(
    reconcile(twoPages, bundled, {
      pageNames: ["受注一覧", "受注履歴"],
      states: ["default", ...Object.values(names)],
      popupStates: Object.values(names),
    }).problems,
  ).toEqual([]);
}

/** 名前付きの列フィルタの吹き出しと右クリックメニュー（どちらも opens-container を要求する）を 1 インスタンスで測った網羅表。 */
export function namedPopupCoverage(): GenericCoverage {
  return {
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
}

/** 縮約してはいけない軸（sort-direction）で同値クラスを宣言すると、導出は寄せても照合が落とすことを確かめる。 */
export function expectIllegalAxisGroupingRejected(sortCandidates: string[]) {
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
}

/** インスタンスの page を宣言に無いページ名（TYPO）にした、プロファイルを宣言しない部品の網羅表。 */
export function typoPageCoverage(): GenericCoverage {
  return {
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
}

/** enumeration.sources を強い順（current-source → config → app-ui）に並べた最小のプロファイル。 */
export function sourcesOrderProfile(): Profile {
  return {
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
}

/** datagridCoverage の部品 grid。 */
function grid(cov: Coverage) {
  return cov.components[0];
}

/** datagridCoverage のインスタンス orders。 */
function instance(cov: Coverage) {
  return grid(cov).instances[0];
}

/** 部品の欄（components・id・profile・profile_version）の不備を、合格として扱わないことを確かめる。 */
export function expectComponentShapeRejected() {
  // わざと型に合わない値を入れる
  expectRejected(
    (cov) => (cov.components = invalidInput([42])),
    /components\[0\]: JSON オブジェクトではない/,
  );
  // 判定側（parity-diff の coverage-check.mjs）と同じく、部品が空なら未測定 0 のまま不合格にする。
  expectRejected((cov) => (cov.components = []), /components が空/, { unmeasured: false });
  expectRejected((cov) => (grid(cov).id = ""), /components\[0\]: id が空/);
  // わざと文字列でも null でもない profile を入れる
  expectRejected(
    (cov) => (grid(cov).profile = invalidInput(42)),
    /profile が空でない文字列でも null でもない/,
  );
  // 同梱に無いプロファイルは候補を展開できない。採点していない分を、少なくとも宣言セル数（項目 × インスタンス）だけ数える。
  const unknownProfile = expectRejected(
    (cov) => (grid(cov).profile = "nope"),
    /プロファイル nope が同梱ディレクトリに無い/,
  );
  expect(unknownProfile.unmeasured).toBeGreaterThanOrEqual(20);
  // バージョンの違いは展開し直しの指示として残す（候補は同じなので未測定には数えない）。
  expectRejected(
    (cov) => (grid(cov).profile_version = "999"),
    /記録されたプロファイルのバージョン（999）が同梱プロファイル（3）と違う/,
    { unmeasured: false },
  );
}

/** 項目とインスタンスの欄（空・型の誤り・id の空と重複）の不備を、合格として扱わないことを確かめる。 */
export function expectItemAndInstanceShapeRejected() {
  expectRejected((cov) => (grid(cov).instances = []), /instances が空（列挙が起きていない）/);
  // わざと JSON オブジェクトでない項目・インスタンスを入れる
  expectRejected(
    (cov) => grid(cov).items.push(invalidInput(42)),
    /items\[20\] が JSON オブジェクトではない/,
    {
      unmeasured: false,
    },
  );
  expectRejected(
    (cov) => grid(cov).items.push({ ...grid(cov).items[0], id: "" }),
    /items\[20\]: id が空/,
    { unmeasured: false },
  );
  expectRejected(
    (cov) => grid(cov).items.push(structuredClone(grid(cov).items[0])),
    /項目 id column-visible\/price が重複している/,
    { unmeasured: false },
  );
  expectRejected(
    (cov) => grid(cov).instances.push(invalidInput(42)),
    /instances\[1\] が JSON オブジェクトではない/,
  );
  expectRejected((cov) => (instance(cov).id = ""), /instances\[0\]: id が空/);
}

/** 項目の candidate の記録・セル行・instances[].candidates の欠落と食い違いを、合格として扱わないことを確かめる。 */
export function expectCandidateRecordRejected() {
  // 項目の candidate の記録が無い・展開結果と違うと、判定側（parity-diff）が数え直せない。
  expectRejected(
    (cov) => removeField(grid(cov).items[0], "candidate"),
    /項目 column-visible\/price に candidate（ルール id と軸値）が記録されていない/,
  );
  expectRejected(
    (cov) => (grid(cov).items[0].candidate.axes = { column: "name" }),
    /candidate.axes.column（name）が展開結果（price）と違う/,
  );
  // rule だけの不一致は判定側の件数を変えないので、問題として残すが未測定には数えない。
  const ruleOnly = expectRejected(
    (cov) => (grid(cov).items[0].candidate.rule = "column-filter"),
    /candidate.rule（column-filter）が展開結果（column-visible）と違う/,
    { unmeasured: false },
  );
  expect(ruleOnly.unmeasured).toBe(0);
  expectRejected(
    (cov) => cov.cells.push(structuredClone(cov.cells[0])),
    /候補 column-visible\/price のセル行が複数ある/,
  );
  expectRejected((cov) => cov.cells.shift(), /候補 column-visible\/price のセルが無い/);
  expectRejected(
    (cov) => (cov.cells[0].value = "maybe"),
    /候補 column-visible\/price: value が present \/ absent \/ unmeasured のいずれでもない/,
  );
  // instances[].candidates の記録の欠落・不足・余剰。
  expectRejected(
    (cov) => removeField(instance(cov), "candidates"),
    /instances\[\]\.candidates が無い/,
  );
  expectRejected(
    (cov) => instance(cov).candidates.shift(),
    /instances\[\]\.candidates に展開結果の候補が足りない（1 件）/,
  );
  expectRejected(
    (cov) => instance(cov).candidates.push("column-visible/ghost"),
    /instances\[\]\.candidates に展開結果に無い候補がある（1 件）/,
    { unmeasured: false },
  );
}

/** 最初のセルの non-renderable の証拠。 */
export function firstEvidence(cov: Coverage) {
  return nonRenderable(cov.cells[0]);
}

/** 最初のインスタンスの applicable_states。 */
export function firstManifest(cov: Coverage) {
  return applicableStates(cov.components[0].instances[0]);
}

/** 最初のセルの locator を対象にした、本人の display: none を原因とする hidden_by。 */
export function hiddenBySelf(cov: Coverage): HiddenBy {
  return {
    target_locator: firstEvidence(cov).locator ?? "",
    locator: "#price",
    relation: "self",
    relationship_verified: true,
    computed_style: { display: "none" },
  };
}
