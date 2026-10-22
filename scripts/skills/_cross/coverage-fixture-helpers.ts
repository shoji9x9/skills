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
