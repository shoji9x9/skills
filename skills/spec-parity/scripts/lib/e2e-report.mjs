// e2e の結果の JSON（.e2e/report.json）から、1 つの target で選ばれたテストの結果を読む部品。
// 強度の確認（strength-check.mjs）と収束の判定（convergence-check.mjs）が、同じ読み方で同じテストを数えるために共有する。
// 同じテストの結果が 2 つある（--repeat-each や複数の agent で実行した）ときは、どちらの判定でも読まずに止める。
// どちらか 1 つを採ると、結果の並び順で合否が変わる。

import { isArray } from "./is-array.mjs";
import { isPlainObject, nonEmptyString } from "./guards.mjs";
import { UsageError } from "./read-json.mjs";

/** e2e の結果の JSON の形式。e2e が形を変えると schemaVersion が変わる。 */
export const REPORT_SCHEMA = "report-1";

/**
 * 選ばれたテストの結果を、テストの名前（「ファイルのパス › describe › テスト名」）→ 結果の要素にする。
 * ファイルのパスは書かれたまま使う（強度の計画のテストの名前も、結果の file と同じ字面で書く）。
 * @param {unknown} report
 * @param {{ targetId: string, where: string }} ctx - targetId は e2e の設定の target 名（current / new）、where は誤りの文に出す名前
 * @returns {{ run: Record<string, unknown>, results: Map<string, { result: Record<string, unknown>, index: number, file: string }> }}
 */
export function selectedResults(report, { targetId, where }) {
  if (!isPlainObject(report) || report.schemaVersion !== REPORT_SCHEMA)
    throw new UsageError(`${where} が e2e の結果（schemaVersion: ${REPORT_SCHEMA}）でない`);
  const run = report.run;
  if (!isPlainObject(run) || !isArray(run.results))
    throw new UsageError(`${where} に run.results が無い`);
  /** @type {Map<string, { result: Record<string, unknown>, index: number, file: string }>} */
  const results = new Map();
  for (const [index, r] of run.results.entries()) {
    if (!isPlainObject(r))
      throw new UsageError(`${where} の results[${index}] がオブジェクトでない`);
    if (r.targetId !== targetId || r.selected !== true) continue;
    if (!nonEmptyString(r.file) || !isArray(r.titlePath))
      throw new UsageError(`${where} の results[${index}] に file か titlePath が無い`);
    const name = [r.file, ...r.titlePath.map(String)].join(" › ");
    if (results.has(name))
      throw new UsageError(
        `${where} に同じテストの結果が 2 つある（--repeat-each や複数の agent を外して実行し直す）: ${name}`,
      );
    results.set(name, { result: r, index, file: r.file });
  }
  return { run, results };
}
