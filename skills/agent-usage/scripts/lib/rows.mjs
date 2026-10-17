// 明細（records/ の CSV）の行の形。1 回の collect は、種類の違う行を 1 つの CSV にまとめて書く。
//
// 行の種類（kind）:
//   usage        モデル・セッション・1 時間・ブランチごとのトークン数と費用。
//   run          1 回の指示の稼働の区間。
//   human-wait   人を待った区間（人への質問・人が判断した権限の確認）。
//   prompt       人の指示の時刻（人が起きていた証拠として、停止の分類に使う）。
//   activity     人の活動の時刻（人の commit・GitHub での自分の操作）。
//   ci           GitHub Actions（と、設定で有効にした外部の CI）の実行の区間。
//   review-wait  レビューを依頼してから届くまでの区間。
//   review       PR のレビュー 1 件（ツール・推定または実測の費用）。
//   billing      課金 API から取った日別の実額。
//   coverage     GitHub の情報を取得した期間と、その成否（取得していない期間の停止を「判定不能」にするため）。
//
// retracted が 1 の行は打ち消しの行で、同じ key の前の行を打ち消す（report は observed_at の最も新しい行が打ち消しなら、その key を数えない）。
// key は行の同一性。並行するブランチや繰り返しの collect で同じ key の行が複数あれば、
// report は observed_at の最も新しい行を使う（後の collect ほど多くのログを見ているため）。

/** 列の順（原本）。列を足すときは末尾に足し、report が古い列だけのファイルも読めるようにする。 */
export const COLUMNS = /** @type {const} */ ([
  "key",
  "kind",
  "observed_at",
  "person",
  "agent",
  "session",
  "subagent",
  "model",
  "start",
  "end",
  "tz",
  "branch",
  "issue",
  "input_tokens",
  "cache_read_tokens",
  "cache_write_tokens",
  "output_tokens",
  "reasoning_tokens",
  "messages",
  "cost_usd",
  "cost_source",
  "wait_ms",
  "detail",
  "retracted",
]);

/** @typedef {(typeof COLUMNS)[number]} Column */

/** 行の種類（原本）。 */
export const KINDS = /** @type {const} */ ([
  "usage",
  "run",
  "human-wait",
  "prompt",
  "activity",
  "ci",
  "review-wait",
  "review",
  "billing",
  "coverage",
]);

/** @typedef {(typeof KINDS)[number]} Kind */

/** @typedef {Partial<Record<Column, string>>} Row */

/**
 * @param {string} value
 * @returns {value is Kind}
 */
export function isKind(value) {
  return KINDS.some((k) => k === value);
}

/** 誰が取得しても内容が同じ、リポジトリ全体の行の種類（person と tz は取得した人の値が入るだけ）。 */
export const REPO_SCOPE_KINDS = ["ci", "review-wait", "review"];

/**
 * 書き直すかを決めるための内容の署名。リポジトリ全体の行では、person と tz の違いを無視する
 * （2 人が交互に collect したときに、互いの行を書き直し続けないため）。
 * @param {Row} row
 * @returns {string}
 */
export function contentSignature(row) {
  const repoScope = REPO_SCOPE_KINDS.includes(row.kind ?? "");
  return COLUMNS.filter(
    (c) => c !== "observed_at" && !(repoScope && (c === "person" || c === "tz")),
  )
    .map((c) => row[c] ?? "")
    .join("\u0001");
}

/**
 * 行の内容の署名。observed_at を除いたすべての列で作る（同じ key の行の順序を決めるため）。
 * @param {Row} row
 * @returns {string}
 */
export function signature(row) {
  return COLUMNS.filter((c) => c !== "observed_at")
    .map((c) => row[c] ?? "")
    .join("\u0001");
}

/**
 * 数を CSV に書く形にする。費用は小数 6 桁、それ以外は整数。null は空欄（単価不明など）。
 * @param {number | null} n
 * @param {boolean} money
 * @returns {string}
 */
export function fmt(n, money = false) {
  if (n === null) return "";
  return money ? n.toFixed(6) : String(Math.round(n));
}
