// coverage-expand.test.ts と coverage-record-judge-parity.test.ts が共有するヘルパー（網羅表の fixture を読む・照合する）。

import { assert } from "vitest";
import { fillSetProvenance } from "../../lib/testing/coverage-set-provenance-fixture.ts";
import { reconcile as reconcileRaw } from "../../../skills/parity-suite/scripts/coverage-expand.mjs";

/** 配列から条件に合う要素を取り出す。無ければ what を理由にテストを落とす。 */
export function findOrFail<T>(values: T[], predicate: (value: T) => boolean, what: string): T {
  const found = values.find(predicate);
  assert.exists(found, `${what} が無い`);
  return found;
}

/** fillSetProvenance が埋めた component_inventory。 */
export function componentInventory<S>(coverage: { component_inventory?: S }): S {
  assert.exists(coverage.component_inventory, "component_inventory が無い");
  return coverage.component_inventory;
}

/** fillSetProvenance が埋めた instance_inventory。 */
export function instanceInventory<S>(component: { id: string; instance_inventory?: S }): S {
  assert.exists(component.instance_inventory, `部品 ${component.id} に instance_inventory が無い`);
  return component.instance_inventory;
}

/**
 * 集合の出所（component_inventory / instance_inventory / components[].source）を、
 * 宣言が無い fixture にだけ補ってから照合する。宣言そのものを見るテストは coverage-expand.mjs の reconcile を直接呼ぶ。
 */
export function reconcile(
  coverage: unknown,
  profiles: Parameters<typeof reconcileRaw>[1],
  metadata: Parameters<typeof reconcileRaw>[2] = null,
) {
  return reconcileRaw(fillSetProvenance(coverage), profiles, metadata);
}

/** DataGrid の列挙（列 2・複数列の並べ替えの組 1・行を選ぶ手段 1・メニュー対象 1・メニュー項目 2・条件 1）。 */
export function datagridEnumeration() {
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
