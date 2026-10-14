// report と HTML が共有する分類の定義。

/** 停止の分類（原本）。HTML の見出しと色の順もこの順にする。 */
export const STOP_CATEGORIES = /** @type {const} */ ([
  "idle",
  "reviewing",
  "ci-wait",
  "review-wait",
  "unknown",
]);
/** @typedef {(typeof STOP_CATEGORIES)[number]} StopCategory */

/** 連続稼働のヒストグラムの区間（分）。最後の区間は上限なし。 */
export const RUN_BINS = /** @type {const} */ ([
  { label: "5 分未満", max: 5 },
  { label: "5〜15 分", max: 15 },
  { label: "15〜60 分", max: 60 },
  { label: "1〜3 時間", max: 180 },
  { label: "3 時間以上", max: Number.POSITIVE_INFINITY },
]);
