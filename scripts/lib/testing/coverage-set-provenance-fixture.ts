// 部品網羅表の「集合の出所と完全性」（Issue #392 / #393）を、それを主題にしないテストの
// fixture へ補うヘルパ。
//
// 網羅表は 3 つの集合（部品・インスタンス・軸の要素）の上に立ち、どの集合も
// source ＋ complete を宣言する仕様になった。既存テストの主題は別（セルの採点・候補の展開・
// 撮影状態の導出など）なので、この宣言が無いだけで落ちると主題の判定が見えなくなる。
// そこで**宣言が無い fixture にだけ**妥当な値を補い、宣言そのものを見るテストは
// 補わない生の関数（reconcileRaw / countCoverageRaw）を直接呼ぶ。
//
// 補うのは「無いときだけ」。fixture が自分で書いた値は上書きしない（上書きすると、
// 意図して不正にした宣言が警告なしに直り、その入力クラスのテストが常に緑になる）。

import { isRecord } from "../guards.ts";
import { isArray } from "../is-array.ts";

/** 集合の出所＋完全性の宣言（`component_inventory` / `instance_inventory` の形）。 */
export function setInventory(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    source: {
      kind: "current-source",
      ref: "src/pages/OrderList.aspx",
      version: "rev-abc123",
      condition: "共通ブロックと部分ビューを含め、置かれている部品を全て数えた",
    },
    complete: true,
    ...overrides,
  };
}

/** 項目集合の出所（`components[].source` の形）。 */
export function itemSource(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "vendor-test-spec",
    ref: "ベンダー試験仕様書 v3（6 分類 24 ケース）",
    retrieved_at: "2026-09-03T00:00:00Z",
    ...overrides,
  };
}

/**
 * 網羅表に集合の出所が無ければ補う（in-place）。
 * coverage は component-coverage.json をパースしたもの。
 * 同じオブジェクトを同じ型で返す（呼び出し側がそのまま渡せるように）。
 */
export function fillSetProvenance<T>(coverage: T): T {
  if (!isRecord(coverage)) return coverage;
  // 同じオブジェクトを、欄を読み書きできる型で持つ（返すのは元の coverage）。
  const cov: Record<string, unknown> = coverage;
  if (cov.component_inventory === undefined) cov.component_inventory = setInventory();
  if (!isArray(cov.components)) return coverage;
  for (const component of cov.components) {
    if (!isRecord(component)) continue;
    if (component.instance_inventory === undefined) component.instance_inventory = setInventory();
    if (component.source === undefined) component.source = itemSource();
  }
  return coverage;
}

/** 配列でないオブジェクト（欄の型はまだ確かめていない）。 */
