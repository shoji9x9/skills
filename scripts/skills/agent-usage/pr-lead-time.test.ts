// PR ごとのリードタイムと手戻り（Issue #887）。collect が PR の行（kind: pr）を作り、report が prs.csv と HTML の中央値にする。
// 入力の軸:
//   PR の状態       merged／merge せずに closed／open／作った時刻が無い。
//   起点            同じブランチに作業の記録がある（その最初）／無い（PR を作った時刻）。
//   CI              conclusion が failure の行／success の行／別のブランチの failure。
//   レビュー        detail の pr がその PR／別の PR。
//   期間            merge・close の日が期間の中／外。open は期間に関わらず載せる。
import { describe, expect, test } from "vitest";
import { parseRepoConfig } from "../../../skills/agent-usage/scripts/lib/config.mjs";
import { median, renderHtml } from "../../../skills/agent-usage/scripts/lib/report/html.mjs";
import {
  buildReport,
  periodBounds,
} from "../../../skills/agent-usage/scripts/lib/report/report.mjs";
import { collectGitHub, prRow } from "../../../skills/agent-usage/scripts/lib/sources/github.mjs";
import { fakeGh, options, prNode } from "./github-helpers.ts";
import { sectionTableRows } from "./aggregate-helpers.ts";

const T = (d: number, h = 0) => Date.UTC(2026, 9, d, h);
const iso = (d: number, h = 0) => new Date(T(d, h)).toISOString();

describe("prRow", () => {
  const pr = (extra: object) => ({
    number: 7,
    branch: "feature/5-x",
    author: "me",
    sha: "abc",
    createdAt: T(1),
    closedAt: null,
    merged: false,
    mergedAt: null,
    ...extra,
  });
  const o = options(fakeGh([]), { now: T(9) });

  test.each([
    {
      name: "merge した PR は merge した時刻で終える",
      extra: { merged: true, mergedAt: T(3), closedAt: T(3, 1) },
      state: "merged",
      end: iso(3),
    },
    {
      name: "merge せずに閉じた PR は閉じた時刻で終える",
      extra: { closedAt: T(4) },
      state: "closed",
      end: iso(4),
    },
    // collect のたびに行が変わらないよう、open な PR は作った時刻で終える
    { name: "open な PR は作った時刻で終える", extra: {}, state: "open", end: iso(1) },
  ])("$name", ({ extra, state, end }) => {
    const row = prRow(pr(extra), o);
    expect(row).toMatchObject({
      key: "pr:7",
      kind: "pr",
      start: iso(1),
      end,
      branch: "feature/5-x",
      issue: "5",
      detail: `pr=7;author=me;state=${state}`,
    });
  });

  test("作った時刻が無い PR は行にしない", () => {
    expect(prRow(pr({ createdAt: null }), o)).toBeNull();
  });

  test("collect は PR の検索の応答から PR の行を作る", () => {
    const gh = fakeGh([
      prNode([], { createdAt: iso(1), merged: true, mergedAt: iso(2), closedAt: iso(2) }),
    ]);
    const res = collectGitHub(options(gh, { since: T(1), now: T(9) }));
    expect(res.rows.filter((r) => r.kind === "pr")).toMatchObject([
      { key: "pr:7", start: iso(1), end: iso(2), detail: "pr=7;author=me;state=merged" },
    ]);
  });
});

describe("prs.csv と HTML の PR の表", () => {
  const row = (r: Record<string, string>) => ({
    observed_at: iso(10),
    person: "p-00000001",
    tz: "UTC",
    ...r,
  });
  const prRowOf = ({
    n,
    branch,
    start,
    end,
    state,
  }: {
    n: number;
    branch: string;
    start: string;
    end: string;
    state: string;
  }) =>
    row({
      key: `pr:${n}`,
      kind: "pr",
      start,
      end,
      branch,
      issue: "",
      detail: `pr=${n};author=me;state=${state}`,
    });
  const rows = [
    // PR 1: 作業の記録が PR より前にある。CI の失敗 2 件・成功 1 件、レビュー 2 件
    row({ key: "u1", kind: "usage", start: iso(1, 2), end: iso(1, 3), branch: "feature/1-a" }),
    row({ key: "u2", kind: "run", start: iso(1, 1), end: iso(1, 2), branch: "feature/1-a" }),
    prRowOf({ n: 1, branch: "feature/1-a", start: iso(2), end: iso(3, 1), state: "merged" }),
    row({
      key: "c1",
      kind: "ci",
      start: iso(2),
      end: iso(2),
      branch: "feature/1-a",
      detail: "CI;pull_request;failure",
    }),
    row({
      key: "c2",
      kind: "ci",
      start: iso(2),
      end: iso(2),
      branch: "feature/1-a",
      detail: "CI;pull_request;failure",
    }),
    row({
      key: "c3",
      kind: "ci",
      start: iso(2),
      end: iso(2),
      branch: "feature/1-a",
      detail: "CI;pull_request;success",
    }),
    row({
      key: "r1",
      kind: "review",
      start: iso(2),
      end: iso(2),
      branch: "feature/1-a",
      detail: "pr=1;author=me;state=COMMENTED",
    }),
    row({
      key: "r2",
      kind: "review",
      start: iso(2),
      end: iso(2),
      branch: "feature/1-a",
      detail: "pr=1;author=me;state=COMMENTED",
    }),
    // 数えない行: Actions の使用量のレビューの行、dynamic の実行の失敗、他の人のレビューの活動
    row({
      key: "r3",
      kind: "review",
      start: iso(2),
      end: iso(2),
      branch: "feature/1-a",
      detail: "pr=1;source=artifact;run=9",
    }),
    row({
      key: "c5",
      kind: "ci",
      start: iso(2),
      end: iso(2),
      branch: "feature/1-a",
      detail: "Running Copilot Code Review;dynamic;failure",
    }),
    row({
      key: "c6",
      kind: "ci",
      start: iso(2),
      end: iso(2),
      branch: "feature/1-a",
      detail: "CI;pull_request;timed_out",
    }),
    // ワークフロー名に ; を含む失敗は数える。外部の CI の行と、名前に ; を含む dynamic の実行は数えない
    row({
      key: "c7",
      kind: "ci",
      start: iso(2),
      end: iso(2),
      branch: "feature/1-a",
      detail: "build;linux;pull_request;failure",
    }),
    row({
      key: "c8",
      kind: "ci",
      start: iso(2),
      end: iso(2),
      branch: "feature/1-a",
      detail: "lint;failure;check-run",
    }),
    row({
      key: "c9",
      kind: "ci",
      start: iso(2),
      end: iso(2),
      branch: "feature/1-a",
      detail: "review;a;dynamic;failure",
    }),
    // PR 2: 作業の記録が無い。別のブランチの CI の失敗と別の PR のレビューは数えない
    prRowOf({ n: 2, branch: "feature/2-b", start: iso(4), end: iso(5), state: "merged" }),
    row({
      key: "c4",
      kind: "ci",
      start: iso(4),
      end: iso(4),
      branch: "feature/9-z",
      detail: "CI;push;failure",
    }),
    // PR 2 のブランチの他の人のレビューの活動と、merge の後の作業は、起点に数えない
    row({
      key: "a1",
      kind: "activity",
      start: iso(3),
      end: iso(3),
      branch: "feature/2-b",
      detail: "gh-review",
    }),
    row({ key: "w1", kind: "run", start: iso(7), end: iso(7, 1), branch: "feature/2-b" }),
    // PR 3: merge せずに閉じた。PR 4: open。PR 5: 期間の外で merge した。PR 6: --until より後に作った open
    prRowOf({ n: 3, branch: "feature/3-c", start: iso(4), end: iso(6), state: "closed" }),
    prRowOf({ n: 4, branch: "feature/4-d", start: iso(5), end: iso(9), state: "open" }),
    prRowOf({ n: 5, branch: "feature/5-e", start: iso(1), end: iso(1, 5), state: "merged" }),
    prRowOf({ n: 6, branch: "feature/6-f", start: iso(11), end: iso(11), state: "open" }),
  ];
  const report = () =>
    buildReport(rows, {
      config: parseRepoConfig({}),
      bundledPricing: {},
      bundledReviewPricing: {},
      tz: "UTC",
      now: T(10),
      since: "2026-10-02",
      until: "2026-10-09",
      recordFiles: 1,
    });

  test("merge・close の日が期間に入る PR と open な PR を、PR の番号の順に載せる", () => {
    expect(report().prs.map((p) => [p.pr, p.state])).toEqual([
      ["1", "merged"],
      ["2", "merged"],
      ["3", "closed"],
      ["4", "open"],
    ]);
  });

  test("リードタイムは同じブランチの最初の作業の記録から merge まで。CI の失敗とレビューは PR ごとに数える", () => {
    expect(report().prs[0]).toMatchObject({
      first_record: iso(1, 1),
      first_source: "record",
      closed_at: iso(3, 1),
      lead_time_hours: "48.00",
      // failure 2 件・timed_out 1 件・名前に ; を含む failure 1 件。dynamic の実行と外部の CI の行は数えない
      ci_failures: "4",
      reviews: "2",
    });
  });

  test("作業の記録が無いブランチは、PR を作った時刻を起点にする", () => {
    expect(report().prs[1]).toMatchObject({
      first_record: iso(4),
      first_source: "pr",
      lead_time_hours: "24.00",
      ci_failures: "0",
      reviews: "0",
    });
  });

  test("open な PR は閉じた時刻とリードタイムを空にする", () => {
    expect(report().prs[3]).toMatchObject({ closed_at: "", lead_time_hours: "" });
  });

  test("HTML の PR の表は、merge した PR だけで中央値を出し、状態ごとの件数を出す", () => {
    const html = renderHtml(report());
    // 1 行目は見出しの行。同じ「PR」で始まる「PR のレビュー」の節と取り違えないよう、h2 ごと指定する
    expect(sectionTableRows(html, "<h2>PR</h2>").slice(1)).toEqual([
      // CI の失敗の中央値は、merge した PR 1（4 件）と PR 2（0 件）から 2.0
      ["2", "1", "1", "36.0", "2.0", "1.0"],
    ]);
  });

  test("PR の行は期間の表示に数えない（作業より前に作った PR で期間を広げない）", () => {
    const b = periodBounds(
      [prRowOf({ n: 9, branch: "feature/9-z", start: iso(1), end: iso(1), state: "merged" })],
      {
        since: null,
        until: null,
        tz: "UTC",
      },
    );
    expect(b).toEqual({ from: null, to: null });
  });
});

describe("median", () => {
  test.each([
    [[], null],
    [[3], 3],
    [[3, 1, 2], 2],
    [[4, 1, 3, 2], 2.5],
  ])("%j の中央値は %j", (xs, expected) => {
    expect(median(xs)).toBe(expected);
  });
});
