// 部品被覆表の「集合の来歴と完全性」（Issue #392 / #393）を、それを主題にしないテストの
// fixture へ補うヘルパ。
//
// 被覆表は 3 つの集合（部品・インスタンス・軸の要素）の上に立ち、どの集合も
// source ＋ complete を宣言する契約になった。既存テストの主題は別（セルの採点・候補の展開・
// 撮影状態の導出など）なので、この宣言が無いだけで落ちると主題の判定が見えなくなる。
// そこで**宣言が無い fixture にだけ**妥当な値を補い、宣言そのものを見るテストは
// 補わない生の関数（reconcileRaw / countCoverageRaw）を直接呼ぶ。
//
// 補うのは「無いときだけ」。fixture が自分で書いた値は上書きしない（上書きすると、
// 意図的に壊した宣言が黙って直り、その入力クラスのテストが常に緑になる）。

/**
 * 集合の来歴＋完全性の宣言（`component_inventory` / `instance_inventory` の形）。
 * @param {Record<string, unknown>} [overrides]
 * @returns {Record<string, unknown>}
 */
export function setInventory(overrides = {}) {
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

/**
 * 項目集合の来歴（`components[].source` の形）。
 * @param {Record<string, unknown>} [overrides]
 * @returns {Record<string, unknown>}
 */
export function itemSource(overrides = {}) {
  return {
    kind: "vendor-test-spec",
    ref: "ベンダー試験仕様書 v3（6 分類 24 ケース）",
    retrieved_at: "2026-09-03T00:00:00Z",
    ...overrides,
  };
}

/**
 * 被覆表に集合の来歴が無ければ補う（in-place）。
 * @param {unknown} coverage - component-coverage.json をパースしたもの
 * @returns {unknown} 同じオブジェクト（呼び出し側がそのまま渡せるように返す）
 */
export function fillSetProvenance(coverage) {
  if (!coverage || typeof coverage !== "object" || Array.isArray(coverage)) return coverage;
  const cov = /** @type {Record<string, unknown>} */ (coverage);
  if (cov.component_inventory === undefined) cov.component_inventory = setInventory();
  if (!Array.isArray(cov.components)) return coverage;
  for (const component of cov.components) {
    if (!component || typeof component !== "object" || Array.isArray(component)) continue;
    const c = /** @type {Record<string, unknown>} */ (component);
    if (c.instance_inventory === undefined) c.instance_inventory = setInventory();
    if (c.source === undefined) c.source = itemSource();
  }
  return coverage;
}
