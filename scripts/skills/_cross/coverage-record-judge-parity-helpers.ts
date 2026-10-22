// coverage-record-judge-parity.test.ts のヘルパー（網羅表の fixture の型と基準の fixture、記録側と判定側の件数）。

import { assert } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fillSetProvenance } from "../../lib/testing/coverage-set-provenance-fixture.ts";
import {
  expandCandidates,
  loadProfiles,
  readEnumeration,
} from "../../../skills/parity-suite/scripts/coverage-expand.mjs";
import { countCoverage as countCoverageRaw } from "../../../skills/parity-diff/scripts/coverage-check.mjs";
import { reconcile } from "./coverage-fixture-helpers.ts";

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

// 網羅表の fixture の形。型は基準の fixture（generic・profiled）が置く正規の形にする。
// 変異が欄を消す箇所は `removeField(x, "field")` で、型に合わない値を入れる箇所は
// invalidInput で渡す（どちらも型の外の入力であることを呼び出し側に残す）。
export type EnumElement = { id: string; flags: Record<string, boolean> };
export type Enumeration = {
  source: { kind: string; ref: string; version: string; extracted_at: string; condition: string };
  complete: boolean;
  elements: Record<string, EnumElement[]>;
  incomplete_reason?: string;
};
export type Candidate = { rule: string; axes: Record<string, string> };
/** expandCandidates が返す候補。 */
export type ExpandedCandidate = Candidate & { id: string };
/** fillSetProvenance の setInventory が書く形。 */
export type SetInventory = {
  source: { kind: string; ref: string; version: string; condition: string };
  complete: boolean;
  incomplete_reason?: string;
};
/** fillSetProvenance の itemSource が書く形。 */
export type ItemSource = { kind: string; ref: string; retrieved_at: string };
/** 集合の出所。fixture は書かず、fillSetProvenance が補う。 */
export type Provenance = { instance_inventory?: SetInventory; source?: ItemSource };
export type ProfiledItem = { id: string; candidate: Candidate };
export type ProfiledInstance = { id: string; enumeration: Enumeration; candidates: string[] };
export type ProfiledComponent = Provenance & {
  id: string;
  profile: string;
  profile_version: string;
  items: ProfiledItem[];
  instances: ProfiledInstance[];
};
export type GenericComponent = Provenance & {
  id: string;
  profile: string | null;
  profile_absent_reason: string;
  items: { id: string }[];
  instances: { id: string }[];
};
export type Cell = {
  component: string;
  item: string;
  instance: string;
  value: string;
  evidence: string;
  covered_by: string[];
};
export type CoverageOf<C> = {
  slug: string;
  components: C[];
  cells: Cell[];
  component_inventory?: SetInventory;
};
export type ProfiledFixture = CoverageOf<ProfiledComponent>;
export type GenericFixture = CoverageOf<GenericComponent>;
export type Fixture = ProfiledFixture | GenericFixture;

// 集合の出所（component_inventory / instance_inventory / components[].source）は、
// このファイルの被験対象（件数の関係）ではないので、宣言が無い fixture にだけ補う。
// 両側へ同じオブジェクトを渡すため、補うのは片方の呼び出しの前で足りる。
export function countCoverage(
  coverage: Fixture,
  slug: string,
  captureNow?: Parameters<typeof countCoverageRaw>[2],
) {
  return countCoverageRaw(fillSetProvenance(coverage), slug, captureNow);
}
export const { profiles } = loadProfiles(
  join(repoRoot, "skills/parity-suite/assets/coverage-profiles"),
);

export const SLUG = "order-list";

/** DataGrid の列挙（列 2・複数列の並べ替えの組 1・行を選ぶ手段 1・メニュー対象 1・メニュー項目 2・条件 1）。 */
export function enumeration(): Enumeration {
  const column = (id: string, filterable: boolean) => ({
    id,
    flags: {
      initially_visible: true,
      toggleable: false,
      requires_horizontal_scroll: false,
      filterable,
      sortable: true,
    },
  });
  return {
    source: {
      kind: "current-source",
      ref: "src/grid/orderColumns.ts",
      version: "rev-abc123",
      extracted_at: "2026-09-03T00:00:00Z",
      condition: "columns 配列の全要素",
    },
    complete: true,
    elements: {
      column: [column("price", true), column("name", false)],
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

export const presentCell = (component: string, item: string, instance: string): Cell => ({
  component,
  item,
  instance,
  value: "present",
  evidence: "実 UI で操作し DOM 変化で発火を確認した",
  covered_by: [`e2e/${SLUG}.spec.ts > ${item}`],
});

/** プロファイルを使う場合: 全候補を present で埋めた網羅表。 */
export function profiled(): ProfiledFixture {
  const profile = profiles.get("datagrid");
  assert.exists(profile, "同梱プロファイル datagrid が無い");
  const { elements } = readEnumeration(enumeration(), profile, "t");
  const candidates: ExpandedCandidate[] = expandCandidates(profile, elements);
  return {
    slug: SLUG,
    components: [
      {
        id: "grid",
        profile: "datagrid",
        profile_version: String(profile.version),
        items: candidates.map((c) => ({
          id: c.id,
          candidate: { rule: c.rule, axes: c.axes },
        })),
        instances: [
          {
            id: "orders",
            enumeration: enumeration(),
            candidates: candidates.map((c) => c.id),
          },
        ],
      },
    ],
    cells: candidates.map((c) => presentCell("grid", c.id, "orders")),
  };
}

/** 汎用の場合（profile: null）: 項目 2 × インスタンス 3 を present で埋めた網羅表。 */
export function generic(): GenericFixture {
  const items = [{ id: "sort" }, { id: "filter" }];
  const instances = [{ id: "orders" }, { id: "customers" }, { id: "invoices" }];
  return {
    slug: SLUG,
    components: [
      {
        id: "toolbar",
        profile: null,
        profile_absent_reason: "適合する同梱プロファイルが無い",
        items,
        instances,
      },
    ],
    cells: items.flatMap((i) => instances.map((n) => presentCell("toolbar", i.id, n.id))),
  };
}

export function variant<F extends Fixture>(base: () => F, mutate: (cov: F) => void): () => F {
  return () => {
    const cov = base();
    mutate(cov);
    return cov;
  };
}
export const grid = <C>(cov: CoverageOf<C>): C => cov.components[0];
export const orders = (cov: ProfiledFixture) => cov.components[0].instances[0];

export const counts = (make: () => Fixture) => ({
  record: reconcile(make(), profiles).unmeasured,
  judge: countCoverage(make(), SLUG).unmeasured,
});

// visual_state_coverage と conformance は、fillVisualStateRows と recordConformance が書き足す。
export type RecordedComponent = Omit<GenericComponent, "items" | "instances"> & {
  items: { id: string; visual_states: string[]; no_visual_state_reason: string | null }[];
  instances: { id: string; page: string; locator: string }[];
};
export type Recorded = CoverageOf<RecordedComponent> & {
  visual_state_coverage?: { rows: { captured: string | null }[] };
  conformance?: { visual_states: { table_fingerprint: unknown; capture_fingerprint: unknown } };
};

/** 撮影状態の指紋を往復させる網羅表（汎用の部品 1 つ・項目 filter・インスタンス orders）と、その撮影条件を持つ metadata.json。 */
export function fingerprintFixture() {
  const coverage: Recorded = {
    slug: SLUG,
    components: [
      {
        id: "grid",
        profile: null,
        profile_absent_reason: "自作グリッドで適合プロファイルが無い",
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
  const metadata = {
    slug: SLUG,
    capture_conditions: {
      pages: [{ name: "受注一覧", path: "/orders" }],
      states: ["default", "フィルタの吹き出しを開いた状態"],
      popup_inventory: [
        {
          name: "フィルタ",
          parent: null,
          opened_by: "openFilter(orders.grid)",
          captured: "フィルタの吹き出しを開いた状態",
          reason: null,
        },
      ],
    },
  };
  return { coverage, metadata };
}
