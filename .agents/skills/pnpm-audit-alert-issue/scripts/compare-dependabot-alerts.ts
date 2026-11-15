#!/usr/bin/env node
// 正規化した pnpm audit の findings を Dependabot alerts と比べ、起票に渡す findings を残す。
//
// 比べる 2 つの集合と一致の定義は docs/vulnerability-handling.md「private skill をやめる条件」で定義する。
// - pnpm audit の側: findings の GHSA とパッケージの組。
// - alerts の側: 状態が fixed でない alert の GHSA とパッケージの組。
// ignoreGhsas の GHSA は pnpm audit に出ないので、alerts の側の組と一致しても matched に数えず、matched_ignored に分ける。
// matched に入れると、pnpm audit が検出したかを確かめないまま、やめる条件の件数に加わるからである。
// alert の無い ignoreGhsas の GHSA も、片方にしか無い組にせず、ignored_without_alert に分ける。
// GHSA の無い finding は比べられないので、組にまとめずに without_ghsa に 1 件ずつ出す。
//
// 起票に渡すのは、GHSA とパッケージの組が open の alert に無い findings である。
// open の alert の Issue は、dependabot-alert-issue の Dependabot alerts を読むモードが作る。
import { readFileSync, writeFileSync } from "node:fs";
import { errorMessage } from "../../../../scripts/lib/errors.ts";
import { isRecord } from "../../../../scripts/lib/guards.ts";
import { isArray } from "../../../../scripts/lib/is-array.ts";
import { isCliEntry } from "../../../../scripts/lib/cli/entry.ts";
import { loadedGhsas } from "../../../../scripts/weekly/ignored-advisories.ts";

/** Dependabot alerts の API が返す状態（https://docs.github.com/en/rest/dependabot/alerts）。 */
const ALERT_STATES = ["open", "dismissed", "auto_dismissed", "fixed"] as const;
type AlertState = (typeof ALERT_STATES)[number];

export type Alert = { state: AlertState; ghsa: string; package: string };
export type Pair = { ghsa: string; package: string };
export type Comparison = {
  matched: Pair[];
  matched_ignored: Pair[];
  only_in_audit: Pair[];
  only_in_alerts: Pair[];
  ignored_without_alert: string[];
  without_ghsa: Pair[];
  findings_to_file: Record<string, unknown>[];
};

/**
 * GHSA を GitHub の表記（接頭辞だけ大文字で、本体は小文字）にそろえる。
 * Issue には大文字で書いたものもあるので、比べる前にそろえる。出力も、記録と比べられるようにこの表記で出す。
 */
const norm = (ghsa: string): string => ghsa.toLowerCase().replace(/^ghsa-/, "GHSA-");
const keyOf = (pair: Pair): string => `${norm(pair.ghsa)}\t${pair.package}`;

const ALERT_STATE_SET: ReadonlySet<string> = new Set(ALERT_STATES);

function isAlertState(value: string): value is AlertState {
  return ALERT_STATE_SET.has(value);
}

/** `gh api ... --jq '[.state, .security_advisory.ghsa_id, .security_vulnerability.package.name] | @tsv'` の出力を読む。 */
export function parseAlertsTsv(text: string): Alert[] {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line, i) => {
      const [state = "", ghsa = "", pkg = "", ...rest] = line.split("\t");
      if (rest.length > 0 || ghsa === "" || pkg === "" || !isAlertState(state)) {
        throw new Error(`alerts の ${i + 1} 行目を読めない: ${JSON.stringify(line)}`);
      }
      return { state, ghsa: norm(ghsa), package: pkg };
    });
}

/** findings の JSON（dependabot-alert-issue の外部 audit findings の形）から findings を取り出す。 */
export function findingsOf(doc: unknown): Record<string, unknown>[] {
  if (!isRecord(doc) || !isArray(doc["findings"])) throw new Error("findings の配列が無い");
  return doc["findings"].map((f, i) => {
    if (!isRecord(f) || typeof f["package"] !== "string" || f["package"] === "") {
      throw new Error(`findings[${i}] に package が無い`);
    }
    if (f["ghsa"] !== undefined && typeof f["ghsa"] !== "string") {
      throw new Error(`findings[${i}] の ghsa が文字列でない`);
    }
    return f;
  });
}

function pairOfFinding(f: Record<string, unknown>): Pair {
  return { ghsa: typeof f["ghsa"] === "string" ? f["ghsa"] : "", package: String(f["package"]) };
}

function uniquePairs(pairs: Pair[]): Map<string, Pair> {
  const map = new Map<string, Pair>();
  for (const p of pairs) map.set(keyOf(p), { ghsa: norm(p.ghsa), package: p.package });
  return map;
}

export function compare(
  findings: Record<string, unknown>[],
  alerts: Alert[],
  ignored: string[],
): Comparison {
  const ignoredSet = new Set(ignored.map(norm));
  const live = alerts.filter((a) => a.state !== "fixed");
  const findingPairs = findings.map(pairOfFinding);
  const auditSide = uniquePairs(findingPairs.filter((p) => p.ghsa !== ""));
  const alertSide = uniquePairs(live);
  const openKeys = new Set(alerts.filter((a) => a.state === "open").map(keyOf));
  const liveGhsa = new Set(live.map((a) => a.ghsa));

  const alertPairs = [...alertSide.values()];
  return {
    matched: [...auditSide].filter(([k]) => alertSide.has(k)).map(([, p]) => p),
    matched_ignored: alertPairs.filter((p) => ignoredSet.has(p.ghsa) && !auditSide.has(keyOf(p))),
    only_in_audit: [...auditSide].filter(([k]) => !alertSide.has(k)).map(([, p]) => p),
    only_in_alerts: alertPairs.filter((p) => !ignoredSet.has(p.ghsa) && !auditSide.has(keyOf(p))),
    ignored_without_alert: [...ignoredSet].filter((g) => !liveGhsa.has(g)),
    without_ghsa: findingPairs.filter((p) => p.ghsa === ""),
    findings_to_file: findings.filter((f) => !openKeys.has(keyOf(pairOfFinding(f)))),
  };
}

/**
 * 使い方: compare-dependabot-alerts.ts <findings.json> <alerts.tsv> <pnpm config get audit --json の出力> <起票に渡す findings.json>
 * 比べた結果を標準出力に JSON で出す。読めない入力は 1、引数の誤りは 2 で終える。
 */
function main(args: readonly string[]): number {
  if (args.length !== 4) {
    console.error(
      "Usage: compare-dependabot-alerts.ts <findings.json> <alerts.tsv> <pnpm-config-audit.json> <findings-to-file.json>",
    );
    return 2;
  }
  const [findingsPath = "", alertsPath = "", ignoredPath = "", outPath = ""] = args;
  try {
    const doc: unknown = JSON.parse(readFileSync(findingsPath, "utf8"));
    const findings = findingsOf(doc);
    const alerts = parseAlertsTsv(readFileSync(alertsPath, "utf8"));
    const ignored = loadedGhsas(readFileSync(ignoredPath, "utf8"));
    const result = compare(findings, alerts, ignored);
    const out = { ...(isRecord(doc) ? doc : {}), findings: result.findings_to_file };
    writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);
    const { findings_to_file, ...summary } = result;
    console.log(JSON.stringify({ ...summary, findings_to_file: findings_to_file.length }, null, 2));
    return 0;
  } catch (err) {
    console.error(`compare-dependabot-alerts: 比べられない: ${errorMessage(err)}`);
    return 1;
  }
}

if (isCliEntry(import.meta.url)) process.exit(main(process.argv.slice(2)));
