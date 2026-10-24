// ファイルごとのカバレッジを、ディレクトリごとの閾値（coverage-thresholds.json）と比べる。
//
// 測定は run-coverage.ts が行い、この関数群は測定の結果と設定だけを読む。
// 閾値はファイルごとに当てる。ディレクトリでまとめた値で比べると、よく測られたファイルが、測られていないファイルを隠す。
//
// 設定の読み方は次のとおり。
// - `rules` の `path` が `/` で終わるものはディレクトリの規則で、その下のファイルに当てる。複数が当たるときは、最も長い `path` を使う。
//   `/` で終わらないものは 1 ファイルだけの規則で、ディレクトリの規則より優先する。`reason` を必須にする。
// - 測る対象は JavaScript・TypeScript（`.ts`・`.mjs`）だけである。シェルスクリプトは測らない。
// - `exclude` のファイルは比べない。`reason` を必須にする。
//
// 判定できないものは合格にせず、finding にする。対象のファイルに当たる規則が無いとき、測定の結果に対象のファイルが無いとき、
// 設定に書いたファイルが対象に無いとき（古い除外や規則が残ると、同じ名前で作り直したファイルが警告なしに外れる）である。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isNonBlankString, isRecord } from "../lib/guards.ts";
import { isArray } from "../lib/is-array.ts";

export const CONFIG_PATH = "scripts/coverage/coverage-thresholds.json";

export const METRICS = ["lines", "branches", "functions"] as const;
export type Metric = (typeof METRICS)[number];
export type Rule = {
  path: string;
  thresholds: Partial<Record<Metric, number>>;
  reason?: string;
};
export type Exclusion = { path: string; reason: string };
export type Config = { rules: Rule[]; exclude: Exclusion[] };

/** 1 ファイルの測定値（百分率）。c8 は 3 つの指標をすべて測る。 */
export type FileMeasure = Record<Metric, number>;

export type Finding =
  | { type: "below"; file: string; metric: Metric; actual: number; threshold: number; rule: string }
  | { type: "no-rule"; file: string }
  | { type: "not-measured"; file: string }
  | { type: "stale-config"; path: string; section: "rules" | "exclude" }
  | { type: "excluded-and-ruled"; path: string };

/** カバレッジを測る対象のファイルか。拡張子で決め、テストと型の宣言は対象にしない。 */
export function isMeasured(file: string): boolean {
  return /\.(?:ts|mjs)$/.test(file) && !file.endsWith(".test.ts") && !file.endsWith(".d.ts");
}

function isPercent(value: unknown): value is number & { readonly __isPercent: true } {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
}

/** 設定の形を確かめて読む。形が違うときは、判定できないとして例外にする。 */
export function parseConfig(value: unknown): Config {
  if (!isRecord(value) || !isArray(value.rules) || !isArray(value.exclude)) {
    throw new Error(`${CONFIG_PATH}: rules と exclude の配列を持つ object でない`);
  }
  const rules: Rule[] = value.rules.map((raw, i) => {
    const at = `${CONFIG_PATH}: rules[${i}]`;
    if (!isRecord(raw) || !isNonBlankString(raw.path)) throw new Error(`${at}: path が無い`);
    const thresholds: Partial<Record<Metric, number>> = {};
    for (const key of Object.keys(raw)) {
      if (key === "path" || key === "reason") continue;
      const metric = METRICS.find((m) => m === key);
      if (metric === undefined) throw new Error(`${at}: 規則に使えないキー ${key}`);
      const threshold = raw[key];
      if (!isPercent(threshold)) throw new Error(`${at}: ${key} が 0 から 100 の数でない`);
      thresholds[metric] = threshold;
    }
    if (Object.keys(thresholds).length === 0) throw new Error(`${at}: 閾値が 1 つも無い`);
    const isFile = !raw.path.endsWith("/");
    if (isFile && !isNonBlankString(raw.reason))
      throw new Error(`${at}: 1 ファイルの規則には reason が要る`);
    if (isFile && !isMeasured(raw.path))
      throw new Error(`${at}: ${raw.path} はカバレッジを測る対象のファイルでない`);
    const rule: Rule = { path: raw.path, thresholds };
    if (isNonBlankString(raw.reason)) rule.reason = raw.reason;
    return rule;
  });
  const keys = rules.map((r) => r.path);
  const dup = keys.find((k, i) => keys.indexOf(k) !== i);
  if (dup !== undefined) throw new Error(`${CONFIG_PATH}: 同じ path の規則が 2 つある: ${dup}`);

  const exclude: Exclusion[] = value.exclude.map((raw, i) => {
    const at = `${CONFIG_PATH}: exclude[${i}]`;
    if (!isRecord(raw) || !isNonBlankString(raw.path)) throw new Error(`${at}: path が無い`);
    if (!isNonBlankString(raw.reason)) throw new Error(`${at}: reason が無い`);
    if (raw.path.endsWith("/"))
      throw new Error(`${at}: 除外はファイルごとに書く（ディレクトリは書けない）`);
    if (!isMeasured(raw.path))
      throw new Error(
        `${at}: ${raw.path} はカバレッジを測る対象のファイルでない（除外は要らない）`,
      );
    return { path: raw.path, reason: raw.reason };
  });
  const paths = exclude.map((e) => e.path);
  const dupEx = paths.find((p, i) => paths.indexOf(p) !== i);
  if (dupEx !== undefined)
    throw new Error(`${CONFIG_PATH}: 同じファイルの除外が 2 つある: ${dupEx}`);
  return { rules, exclude };
}

export function loadConfig(root: string): Config {
  return parseConfig(JSON.parse(readFileSync(join(root, CONFIG_PATH), "utf8")));
}

/** ファイルに当てる規則。1 ファイルの規則を優先し、無ければ最も長いディレクトリの規則。 */
export function ruleFor(rules: readonly Rule[], file: string): Rule | null {
  let best: Rule | null = null;
  for (const rule of rules) {
    if (rule.path === file) return rule;
    if (
      rule.path.endsWith("/") &&
      file.startsWith(rule.path) &&
      (best === null || rule.path.length > best.path.length)
    ) {
      best = rule;
    }
  }
  return best;
}

/**
 * 対象のファイル（`files`）を測定値（`measures`）と規則で比べる。
 * `files` は git が管理する対象のファイルの一覧で、`measures` に無いファイルは測っていないものとして finding にする。
 */
export function evaluate(
  config: Config,
  files: readonly string[],
  measures: ReadonlyMap<string, FileMeasure>,
): Finding[] {
  const findings: Finding[] = [];
  const fileSet = new Set(files);
  const excluded = new Set(config.exclude.map((e) => e.path));

  for (const e of config.exclude) {
    if (!fileSet.has(e.path))
      findings.push({ type: "stale-config", path: e.path, section: "exclude" });
  }
  for (const rule of config.rules) {
    if (rule.path.endsWith("/")) continue;
    if (!fileSet.has(rule.path))
      findings.push({ type: "stale-config", path: rule.path, section: "rules" });
    else if (excluded.has(rule.path))
      findings.push({ type: "excluded-and-ruled", path: rule.path });
  }

  for (const file of files) {
    if (excluded.has(file)) continue;
    if (!isMeasured(file)) continue;
    const rule = ruleFor(config.rules, file);
    if (rule === null) {
      findings.push({ type: "no-rule", file });
      continue;
    }
    const measure = measures.get(file);
    if (measure === undefined) {
      findings.push({ type: "not-measured", file });
      continue;
    }
    for (const metric of METRICS) {
      const threshold = rule.thresholds[metric];
      if (threshold === undefined) continue;
      const actual = measure[metric];
      if (actual < threshold)
        findings.push({ type: "below", file, metric, actual, threshold, rule: rule.path });
    }
  }
  return findings;
}

/** finding を 1 行の文にする。 */
export function describe(finding: Finding): string {
  switch (finding.type) {
    case "below":
      return `${finding.file}: ${finding.metric} ${finding.actual}% が閾値 ${finding.threshold}%（規則 ${finding.rule}）を下回る`;
    case "no-rule":
      return `${finding.file}: 当たる規則が無い。${CONFIG_PATH} の rules に、このファイルを含むディレクトリの規則を足す`;
    case "not-measured":
      return `${finding.file}: 測定の結果に無い。測定の対象（run-coverage.ts の c8 の引数）を確かめる`;
    case "stale-config":
      return `${CONFIG_PATH} の ${finding.section}: ${finding.path} は対象のファイルに無い。消すか、パスを直す`;
    case "excluded-and-ruled":
      return `${CONFIG_PATH}: ${finding.path} が exclude と rules の両方にある。どちらかにする`;
  }
}
