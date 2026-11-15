// pnpm audit の findings と Dependabot alerts を比べるスクリプトのテスト。
//
// 期待値は次の仕様から決める。
// - `docs/vulnerability-handling.md`「private skill をやめる条件」: 比べるのは、pnpm audit の findings の組と、
//   状態が fixed でない alert の組。GHSA の ID とパッケージの名前が同じ組で載っていれば一致とする。
//   ignoreGhsas の advisory は pnpm audit に出ないので、alert と組になっても一致に数えない（matched_ignored に分ける）。
// - 同じ文書「脆弱性の確認と起票」: 起票に渡すのは、GHSA とパッケージの組が open の alert にも
//   自動で却下された alert（auto_dismissed）にも無い findings。auto_dismissed は GitHub の自動トリアージの判断に従い、
//   起票の対象にしない（Issue #1038 の決定）。matched には数え、skipped_auto_dismissed にも出す。
//   人が却下した alert（dismissed）と fixed の alert の組は、open でないので起票に渡す。
// - GHSA は大文字と小文字を区別しない（Dependabot alerts の API は小文字、Issue には大文字の表記もある）。
//   出力は、記録と比べられるように GitHub の表記（接頭辞だけ大文字で、本体は小文字）にそろえる。
// - alert の無い ignoreGhsas の GHSA は片方にしか無い組にせず、GHSA の無い finding は組にまとめずに出す。
import { describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type Alert,
  compare,
  findingsOf,
  parseAlertsTsv,
} from "../../../.agents/skills/pnpm-audit-alert-issue/scripts/compare-dependabot-alerts.ts";
import { parseJsonAs } from "../../lib/parse-as.ts";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";

type Summary = {
  matched: unknown[];
  skipped_auto_dismissed: unknown[];
  only_in_audit: unknown[];
  ignored_without_alert: unknown[];
  findings_to_file: number;
};

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const script = join(
  repoRoot,
  ".agents/skills/pnpm-audit-alert-issue/scripts/compare-dependabot-alerts.ts",
);

const A = "GHSA-aaaa-aaaa-aaaa";
const B = "GHSA-bbbb-bbbb-bbbb";
const C = "GHSA-cccc-cccc-cccc";
const D = "GHSA-dddd-dddd-dddd";
const up = (g: string): string => g.toUpperCase();
const alert = (state: Alert["state"], ghsa: string, pkg: string): Alert => ({
  state,
  ghsa,
  package: pkg,
});

describe("parseAlertsTsv", () => {
  test("状態・GHSA・パッケージの行を読み、GHSA を GitHub の表記にそろえる。空行は飛ばす", () => {
    expect(parseAlertsTsv(`open\t${up(A)}\tp1\n\nauto_dismissed\t${B}\tp2\n`)).toEqual([
      alert("open", A, "p1"),
      alert("auto_dismissed", B, "p2"),
    ]);
  });

  test("空の出力は alert 0 件として読む", () => {
    expect(parseAlertsTsv("")).toEqual([]);
  });

  test.each([
    ["未知の状態", `reopened\t${A}\tp1`],
    ["GHSA が空", "open\t\tp1"],
    ["パッケージが無い", `open\t${A}`],
    ["列が多い", `open\t${A}\tp1\textra`],
  ])("%s の行は読めないとして失敗する", (_label, line) => {
    expect(() => parseAlertsTsv(line)).toThrow(/1 行目を読めない/);
  });
});

describe("findingsOf", () => {
  test("findings の配列を返す", () => {
    const f = [{ package: "p1", ghsa: A }, { package: "p2" }];
    expect(findingsOf({ source: "pnpm-audit", findings: f })).toEqual(f);
  });

  test.each([
    ["findings が無い", { source: "pnpm-audit" }, /findings の配列が無い/],
    ["配列でない", { findings: {} }, /findings の配列が無い/],
    ["package が無い", { findings: [{ ghsa: A }] }, /findings\[0\] に package が無い/],
    ["package が空", { findings: [{ package: "" }] }, /findings\[0\] に package が無い/],
    ["ghsa が文字列でない", { findings: [{ package: "p", ghsa: 1 }] }, /ghsa が文字列でない/],
  ])("%s なら失敗する", (_label, doc, re) => {
    expect(() => findingsOf(doc)).toThrow(re);
  });
});

describe("compare", () => {
  test("両方に同じ組で載る advisory は matched になり、open の alert の組は起票に渡さない", () => {
    const findings = [{ package: "p1", ghsa: up(A) }];
    const r = compare(findings, [alert("open", A, "p1")], []);
    expect(r.matched).toEqual([{ ghsa: A, package: "p1" }]);
    expect(r.only_in_audit).toEqual([]);
    expect(r.only_in_alerts).toEqual([]);
    expect(r.without_ghsa).toEqual([]);
    expect(r.findings_to_file).toEqual([]);
  });

  test("GHSA の大文字と小文字は区別しない", () => {
    const r = compare([{ package: "p1", ghsa: A }], [alert("open", A, "p1")], []);
    expect(r.matched).toHaveLength(1);
    expect(r.findings_to_file).toEqual([]);
  });

  test("dismissed の alert は一致に数え、その findings は起票に渡す", () => {
    const findings = [{ package: "p1", ghsa: A }];
    const r = compare(findings, [alert("dismissed", A, "p1")], []);
    expect(r.matched).toEqual([{ ghsa: A, package: "p1" }]);
    expect(r.skipped_auto_dismissed).toEqual([]);
    expect(r.findings_to_file).toEqual(findings);
  });

  test("auto_dismissed の alert は一致に数え、その findings は起票に渡さず skipped_auto_dismissed に出す", () => {
    const findings = [{ package: "p2", ghsa: B }];
    const r = compare(findings, [alert("auto_dismissed", B, "p2")], []);
    expect(r.matched).toEqual([{ ghsa: B, package: "p2" }]);
    expect(r.skipped_auto_dismissed).toEqual([{ ghsa: B, package: "p2" }]);
    expect(r.findings_to_file).toEqual([]);
  });

  test("open 3 件・auto_dismissed 2 件の alert と、pnpm audit の 5 件が一致すると、起票に渡すのは 0 件になる", () => {
    const pairs: [string, string, Alert["state"]][] = [
      ["GHSA-1111-1111-1111", "o1", "open"],
      ["GHSA-2222-2222-2222", "o2", "open"],
      ["GHSA-3333-3333-3333", "o3", "open"],
      ["GHSA-4444-4444-4444", "d1", "auto_dismissed"],
      ["GHSA-5555-5555-5555", "d2", "auto_dismissed"],
    ];
    const r = compare(
      pairs.map(([ghsa, pkg]) => ({ package: pkg, ghsa })),
      pairs.map(([ghsa, pkg, state]) => alert(state, ghsa, pkg)),
      [],
    );
    expect(r.matched).toHaveLength(5);
    expect(r.skipped_auto_dismissed.map((p) => p.package)).toEqual(["d1", "d2"]);
    expect(r.only_in_audit).toEqual([]);
    expect(r.findings_to_file).toEqual([]);
  });

  test("同じ組に open と auto_dismissed の alert があれば、open として扱い skipped_auto_dismissed に出さない", () => {
    const r = compare(
      [{ package: "p1", ghsa: A }],
      [alert("auto_dismissed", A, "p1"), alert("open", A, "p1")],
      [],
    );
    expect(r.skipped_auto_dismissed).toEqual([]);
    expect(r.findings_to_file).toEqual([]);
  });

  test("auto_dismissed の alert が pnpm audit に無ければ、only_in_alerts に出し、skipped_auto_dismissed には出さない", () => {
    const r = compare([], [alert("auto_dismissed", B, "p2")], []);
    expect(r.only_in_alerts).toEqual([{ ghsa: B, package: "p2" }]);
    expect(r.skipped_auto_dismissed).toEqual([]);
  });

  test("auto_dismissed の alert と GHSA が同じでもパッケージが違う finding は、起票に渡す", () => {
    const r = compare([{ package: "p3", ghsa: B }], [alert("auto_dismissed", B, "p2")], []);
    expect(r.skipped_auto_dismissed).toEqual([]);
    expect(r.findings_to_file).toEqual([{ package: "p3", ghsa: B }]);
  });

  test("GHSA の大文字と小文字が違っても、auto_dismissed の alert と同じ組として起票に渡さない", () => {
    const r = compare([{ package: "p2", ghsa: up(B) }], [alert("auto_dismissed", B, "p2")], []);
    expect(r.findings_to_file).toEqual([]);
  });

  test("fixed の alert と同じ組の finding は、起票に渡す", () => {
    const findings = [{ package: "p1", ghsa: A }];
    const r = compare(findings, [alert("fixed", A, "p1")], []);
    expect(r.only_in_audit).toEqual([{ ghsa: A, package: "p1" }]);
    expect(r.skipped_auto_dismissed).toEqual([]);
    expect(r.findings_to_file).toEqual(findings);
  });

  test("fixed の alert は比べる集合に入れない", () => {
    const r = compare([], [alert("fixed", A, "p1")], []);
    expect(r.only_in_alerts).toEqual([]);
    expect(r.matched).toEqual([]);
  });

  test("同じ GHSA でもパッケージが違えば一致にせず、open の alert の無いパッケージの finding は起票に渡す", () => {
    const findings = [
      { package: "p1", ghsa: A },
      { package: "p2", ghsa: A },
    ];
    const r = compare(findings, [alert("open", A, "p1")], []);
    expect(r.matched).toEqual([{ ghsa: A, package: "p1" }]);
    expect(r.only_in_audit).toEqual([{ ghsa: A, package: "p2" }]);
    expect(r.findings_to_file).toEqual([{ package: "p2", ghsa: A }]);
  });

  test("片方にしか無い組を、それぞれの側に出す", () => {
    const r = compare([{ package: "p1", ghsa: A }], [alert("open", B, "p2")], []);
    expect(r.only_in_audit).toEqual([{ ghsa: A, package: "p1" }]);
    expect(r.only_in_alerts).toEqual([{ ghsa: B, package: "p2" }]);
    expect(r.findings_to_file).toEqual([{ package: "p1", ghsa: A }]);
  });

  test("GHSA の無い finding は比べられないので、まとめずに without_ghsa に 1 件ずつ出し、起票に渡す", () => {
    const r = compare([{ package: "p1" }, { package: "p1" }], [], []);
    expect(r.without_ghsa).toEqual([
      { ghsa: "", package: "p1" },
      { ghsa: "", package: "p1" },
    ]);
    expect(r.only_in_audit).toEqual([]);
    expect(r.findings_to_file).toEqual([{ package: "p1" }, { package: "p1" }]);
  });

  test("ignoreGhsas の GHSA は、alert と組になっても matched に数えず matched_ignored に出す", () => {
    const r = compare([], [alert("dismissed", C, "p3")], [C]);
    expect(r.matched).toEqual([]);
    expect(r.matched_ignored).toEqual([{ ghsa: C, package: "p3" }]);
    expect(r.only_in_alerts).toEqual([]);
    expect(r.ignored_without_alert).toEqual([]);
  });

  test("ignoreGhsas の GHSA でも pnpm audit が報告した組は matched に入れ、matched_ignored に重ねない", () => {
    const r = compare([{ package: "p3", ghsa: C }], [alert("dismissed", C, "p3")], [C]);
    expect(r.matched).toEqual([{ ghsa: C, package: "p3" }]);
    expect(r.matched_ignored).toEqual([]);
  });

  test("ignoreGhsas の GHSA で fixed でない alert が無いものは、片方にしか無い組にせず ignored_without_alert に出す", () => {
    const r = compare([], [alert("fixed", C, "p3")], [up(C)]);
    expect(r.ignored_without_alert).toEqual([C]);
    expect(r.only_in_audit).toEqual([]);
    expect(r.matched_ignored).toEqual([]);
  });

  test("同じ組の findings が複数あっても、組は 1 件として数える", () => {
    const r = compare(
      [
        { package: "p1", ghsa: A },
        { package: "p1", ghsa: up(A) },
      ],
      [alert("dismissed", A, "p1")],
      [],
    );
    expect(r.matched).toHaveLength(1);
    expect(r.findings_to_file).toHaveLength(2);
  });
});

describe("CLI", () => {
  function run(files: { findings: string; alerts: string; ignored: string }) {
    const dir = makeTempDir("compare-alerts-");
    const paths = {
      findings: join(dir, "findings.json"),
      alerts: join(dir, "alerts.tsv"),
      ignored: join(dir, "ignored.json"),
      out: join(dir, "to-file.json"),
    };
    writeFileSync(paths.findings, files.findings);
    writeFileSync(paths.alerts, files.alerts);
    writeFileSync(paths.ignored, files.ignored);
    const res = spawnSync(
      process.execPath,
      [script, paths.findings, paths.alerts, paths.ignored, paths.out],
      { encoding: "utf8", timeout: CHILD_TIMEOUT_MS },
    );
    return { res, out: paths.out };
  }

  test("比べた結果を出し、起票に渡す findings を source などを残したまま書く", () => {
    const findings = JSON.stringify({
      source: "pnpm-audit",
      findings: [
        { package: "p1", ghsa: up(A) },
        { package: "p2", ghsa: up(B) },
        { package: "p3", ghsa: up(C) },
      ],
    });
    const { res, out } = run({
      findings,
      alerts: `open\t${A}\tp1\nauto_dismissed\t${B}\tp2\ndismissed\t${C}\tp3\n`,
      ignored: `{"ignore":["${D}"]}`,
    });
    expect(res.status).toBe(0);
    const summary = parseJsonAs<Summary>(res.stdout);
    expect(summary.matched).toHaveLength(3);
    expect(summary.matched).toContainEqual({ ghsa: A, package: "p1" });
    expect(summary.skipped_auto_dismissed).toEqual([{ ghsa: B, package: "p2" }]);
    expect(summary.ignored_without_alert).toEqual([D]);
    expect(summary.findings_to_file).toBe(1);
    expect(parseJsonAs<unknown>(readFileSync(out, "utf8"))).toEqual({
      source: "pnpm-audit",
      findings: [{ package: "p3", ghsa: up(C) }],
    });
  });

  test.each([
    ["空の出力", ""],
    ["null", "null\n"],
  ])("無視の一覧が %s なら、無視した GHSA は 0 件として比べる", (_label, ignored) => {
    const { res } = run({ findings: '{"findings":[]}', alerts: "", ignored });
    expect(res.status).toBe(0);
    expect(parseJsonAs<Summary>(res.stdout).ignored_without_alert).toEqual([]);
  });

  test("alerts を読めなければ 1 で終える", () => {
    const { res } = run({ findings: '{"findings":[]}', alerts: "bad line\n", ignored: "" });
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/比べられない/);
  });

  test("引数が 4 つでなければ 2 で終える", () => {
    const res = spawnSync(process.execPath, [script], {
      encoding: "utf8",
      timeout: CHILD_TIMEOUT_MS,
    });
    expect(res.status).toBe(2);
  });
});
