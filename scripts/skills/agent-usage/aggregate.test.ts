// agent-usage の費用の計算・明細の重複の扱い・停止の分類のテスト。
//
// 入力の軸:
//   単価             リポジトリの設定・同梱・どちらにも無い／モデル名の [1m] と日付。
//   cost-state       ある（その時刻までをモデルごとに合わせる）・無い／単価の無いモデル（proxyWeight の比）／応答の記録の無いモデル。
//   明細の重複       同じ key の複数の行（observed_at の新しい方）／同じ時刻（内容で決める）／内容が同じ行は書き直さない。
//   停止の分類       人の活動の幅・CI・レビュー待ち・取得していない期間の優先順位／どれにも当たらない（未活用）。

import { describe, expect, test } from "vitest";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { formulaSafe, parseCsv, toCsv } from "../../../skills/agent-usage/scripts/lib/csv.mjs";
import { classifyingFailuresOf } from "../../../skills/agent-usage/scripts/lib/run-collect.mjs";
import {
  parseRepoConfig,
  parseUserConfig,
} from "../../../skills/agent-usage/scripts/lib/config.mjs";
import {
  costOf,
  normalizeModel,
  resolvePrice,
} from "../../../skills/agent-usage/scripts/lib/pricing.mjs";
import { changedRows, latestByKey } from "../../../skills/agent-usage/scripts/lib/records.mjs";
import {
  buildReport,
  classifySpan,
  endOfLocalDate,
  dateRange,
  formatPeriod,
  periodBounds,
  runReport,
} from "../../../skills/agent-usage/scripts/lib/report/report.mjs";
import {
  renderHtml,
  STATUS_LABELS,
  STOP_LABELS,
} from "../../../skills/agent-usage/scripts/lib/report/html.mjs";
import { STATUSES } from "../../../skills/agent-usage/scripts/lib/report/categories.mjs";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";
import { emptySummary } from "../../../skills/agent-usage/scripts/lib/sources/session.mjs";
import {
  localParts,
  parseTime,
  splitByLocalHour,
} from "../../../skills/agent-usage/scripts/lib/time.mjs";
import { messageCosts, usageRows } from "../../../skills/agent-usage/scripts/lib/sources/usage.mjs";

const zero = { input: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, output: 0, reasoning: 0 };
const H = (h: number, m = 0) =>
  Date.parse(`2026-10-01T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00.000Z`);

describe("単価", () => {
  test.each([
    ["claude-opus-5-5[1m]", "claude-opus-5-5"],
    ["claude-haiku-4-5-20251001", "claude-haiku-4-5"],
    ["gpt-5.6-sol", "gpt-5.6-sol"],
  ])("%s を %s にそろえる", (raw, expected) => {
    expect(normalizeModel(raw)).toBe(expected);
  });

  test("リポジトリの設定を同梱より優先し、どちらにも無ければ unknown", () => {
    const repo = { x: { input: 1, output: 2 } };
    const bundled = { x: { input: 9, output: 9 }, y: { input: 3, output: 4 } };
    expect(resolvePrice("x", repo, bundled).source).toBe("repo");
    expect(resolvePrice("y[1m]", repo, bundled).source).toBe("bundled");
    expect(resolvePrice("z", repo, bundled)).toEqual({ price: null, source: "unknown" });
  });

  test("欄の無い種類のトークンは近い欄の単価で数える", () => {
    const t = { ...zero, input: 1e6, cacheRead: 1e6, cacheWrite1h: 1e6, output: 1e6 };
    expect(costOf(t, { input: 2, output: 10, cacheRead: 0.5 })).toBeCloseTo(2 + 0.5 + 2 + 10);
    expect(costOf(t, { input: 2, output: 10, cacheRead: 0.5, cacheWrite5m: 3 })).toBeCloseTo(
      2 + 0.5 + 3 + 10,
    );
  });
});

describe("費用", () => {
  const ctx = {
    person: "p-00000001",
    tz: "UTC",
    repoPricing: {},
    bundledPricing: { "claude-opus-5-5": { input: 1, output: 1 } },
  };
  const msg = (key: string, h: number, model: string, input: number) => ({
    key,
    ts: H(h),
    model,
    tokens: { ...zero, input },
  });

  test("cost-state があれば、その時刻までの応答の合計をモデルごとに cost-state に合わせ、後の応答は単価で数える", () => {
    const s = {
      ...emptySummary("claude-code", "s"),
      messages: [
        msg("a", 1, "claude-opus-5-5", 1e6),
        msg("b", 2, "claude-opus-5-5", 3e6),
        msg("c", 5, "claude-opus-5-5", 1e6),
      ],
      costSnapshots: [{ ts: H(3), models: { "claude-opus-5-5": { costUSD: 8, tokens: zero } } }],
    };
    // cost-state の 8 ドルを、その時刻（3 時）までの応答に単価の比（1:3）で配る。5 時の応答は単価で数える
    expect(usageRows(s, ctx).map((r) => [r.start, r.cost_usd, r.cost_source])).toEqual([
      ["2026-10-01T01:00:00.000Z", "2.000000", "log"],
      ["2026-10-01T02:00:00.000Z", "6.000000", "log"],
      ["2026-10-01T05:00:00.000Z", "1.000000", "bundled"],
    ]);
  });

  test("単価の無いモデルは proxyWeight の比で cost-state を配り、cost-state が無ければ空欄にする", () => {
    const s = {
      ...emptySummary("claude-code", "s"),
      messages: [
        msg("a", 1, "mystery", 1e6),
        msg("b", 1, "mystery", 1e6),
        msg("c", 1, "other", 1e6),
      ],
      costSnapshots: [{ ts: H(3), models: { mystery: { costUSD: 4, tokens: zero } } }],
    };
    const costs = messageCosts(s, ctx);
    expect(costs.map((c) => c.cost)).toEqual([2, 2, null]);
    const rows = usageRows(s, ctx);
    expect(rows.find((r) => r.model === "other")?.cost_usd).toBe("");
    expect(rows.find((r) => r.model === "other")?.cost_source).toBe("unknown");
  });

  test("cost-state にあって応答の記録が無いモデルは、cost-state の時刻の行にまとめる", () => {
    const s = {
      ...emptySummary("claude-code", "s"),
      messages: [msg("a", 1, "claude-opus-5-5", 1)],
      costSnapshots: [
        {
          ts: H(3, 30),
          models: {
            "claude-opus-5-5": { costUSD: 1, tokens: zero },
            "claude-haiku-4-5": { costUSD: 0.25, tokens: { ...zero, output: 7 } },
          },
        },
      ],
    };
    const row = usageRows(s, ctx).find((r) => r.model === "claude-haiku-4-5");
    expect(row).toMatchObject({
      key: "usage:claude-code:s:claude-haiku-4-5:cost-state",
      start: "2026-10-01T03:00:00.000Z",
      cost_usd: "0.250000",
      output_tokens: "7",
      cost_source: "log",
    });
  });

  test("1 時間ごと・モデルごとにまとめる", () => {
    const s = {
      ...emptySummary("claude-code", "s"),
      messages: [
        msg("a", 1, "claude-opus-5-5", 1),
        msg("b", 1, "claude-opus-5-5", 2),
        msg("c", 2, "claude-opus-5-5", 3),
      ],
    };
    expect(usageRows(s, ctx).map((r) => [r.start, r.input_tokens, r.messages])).toEqual([
      ["2026-10-01T01:00:00.000Z", "3", "2"],
      ["2026-10-01T02:00:00.000Z", "3", "1"],
    ]);
  });

  test("1 時間の途中でブランチを切り替えたら、切り替えた後のメッセージを切り替えた後のブランチに入れる。最初のブランチの行は元の key のまま", () => {
    const at = (key: string, h: number, m: number, input: number) => ({
      key,
      ts: H(h, m),
      model: "claude-opus-5-5",
      tokens: { ...zero, input },
    });
    const s = {
      ...emptySummary("claude-code", "s"),
      branches: [
        { ts: H(1, 0), branch: "feature/1-a" },
        { ts: H(1, 30), branch: "feature/2-b" },
      ],
      messages: [
        at("a", 1, 10, 1e6),
        at("b", 1, 20, 2e6),
        at("c", 1, 40, 4e6),
        at("d", 2, 10, 8e6),
      ],
    };
    expect(
      usageRows(s, ctx).map((r) => [
        r.key,
        r.branch,
        r.issue,
        r.input_tokens,
        r.messages,
        r.cost_usd,
      ]),
    ).toEqual([
      [
        "usage:claude-code:s:claude-opus-5-5:2026-10-01T01:00:00.000Z",
        "feature/1-a",
        "1",
        "3000000",
        "2",
        "3.000000",
      ],
      [
        "usage:claude-code:s:claude-opus-5-5:2026-10-01T01:00:00.000Z:feature/2-b",
        "feature/2-b",
        "2",
        "4000000",
        "1",
        "4.000000",
      ],
      [
        "usage:claude-code:s:claude-opus-5-5:2026-10-01T02:00:00.000Z",
        "feature/2-b",
        "2",
        "8000000",
        "1",
        "8.000000",
      ],
    ]);
  });
});

describe("明細の重複", () => {
  const row = (key: string, observed: string, cost: string) => ({
    key,
    kind: "usage",
    observed_at: observed,
    cost_usd: cost,
  });

  test("同じ key は observed_at の新しい行を使い、同じ時刻なら読む順に依らない", () => {
    const a = row("k", "2026-10-01T00:00:00.000Z", "1");
    const b = row("k", "2026-10-02T00:00:00.000Z", "2");
    expect(latestByKey([a, b]).get("k")?.cost_usd).toBe("2");
    expect(latestByKey([b, a]).get("k")?.cost_usd).toBe("2");
    const c = row("k", "2026-10-02T00:00:00.000Z", "3");
    expect(latestByKey([b, c]).get("k")?.cost_usd).toBe(latestByKey([c, b]).get("k")?.cost_usd);
  });

  test("内容が同じ行は書き直さず、新しい key と内容の変わった行だけを残す", () => {
    const existing = latestByKey([
      row("k1", "2026-10-01T00:00:00.000Z", "1"),
      row("k2", "2026-10-01T00:00:00.000Z", "1"),
    ]);
    const next = [row("k1", "x", "1"), row("k2", "x", "2"), row("k3", "x", "1")];
    expect(changedRows(next, existing).map((r) => r.key)).toEqual(["k2", "k3"]);
  });

  test("リポジトリ全体の行は、取得した人とタイムゾーンの違いだけでは書き直さない", () => {
    const by = (kind: string, person: string, tz: string) => ({
      key: `${kind}:1`,
      kind,
      observed_at: "x",
      person,
      tz,
      start: "2026-10-01T00:00:00.000Z",
    });
    const existing = latestByKey(
      ["ci", "review-wait", "review", "activity"].map((k) => by(k, "p-a", "UTC")),
    );
    const next = ["ci", "review-wait", "review", "activity"].map((k) => by(k, "p-b", "Asia/Tokyo"));
    expect(changedRows(next, existing).map((r) => r.kind)).toEqual(["activity"]);
  });
});

describe("CSV の数式", () => {
  test("report の CSV では、数式として読まれる値の先頭に ' を付け、数は変えない", () => {
    // formulaSafe の戻り値は、report の CSV に書くセルの値になる。
    expect(formulaSafe("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(formulaSafe("+cmd")).toBe("'+cmd");
    expect(formulaSafe("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(formulaSafe("-x")).toBe("'-x");
    expect(formulaSafe("-1.5")).toBe("-1.5");
    expect(formulaSafe("feature/1-x")).toBe("feature/1-x");
    expect(toCsv(["a"], [{ a: "=1+1" }], { formulaSafe: true })).toBe("a\n'=1+1\n");
    expect(toCsv(["a"], [{ a: "=1+1" }])).toBe("a\n=1+1\n");
  });
});

describe("CSV", () => {
  test("区切り・引用符・改行を含む値を往復できる", () => {
    const rows = [
      { a: 'x,"y"', b: "1\n2" },
      { a: "", b: "z" },
    ];
    expect(parseCsv(toCsv(["a", "b"], rows))).toEqual(rows);
  });

  test("閉じていない引用符と、列数の違う行はエラーにする", () => {
    expect(() => parseCsv('a\n"x\n')).toThrow(/引用符/);
    expect(() => parseCsv("a,b\n1\n")).toThrow(/列数/);
  });
});

describe("設定", () => {
  test("知らないキーと型の誤りはエラーにする", () => {
    expect(() => parseRepoConfig({ pricng: {} })).toThrow(/知らないキー/);
    expect(() => parseRepoConfig({ ci: { external: "yes" } })).toThrow(/true か false/);
    expect(() => parseRepoConfig({ pricing: { x: { input: 1 } } })).toThrow(/input と output/);
    expect(() => parseRepoConfig({ aliases: { a: "b", b: "c" } })).toThrow(/別名/);
    expect(() => parseRepoConfig({ aliases: { "p-00000001": "../x" } })).toThrow(/16 進数/);
    expect(parseRepoConfig({ aliases: { "p-00000001": "p-00000002" } }).aliases).toEqual({
      "p-00000001": "p-00000002",
    });
  });

  test("省いたキーはデフォルトにする", () => {
    expect(parseRepoConfig({})).toMatchObject({
      activityWindowMinutes: 15,
      ci: { external: false },
      defaultDecision: null,
    });
    expect(parseUserConfig({ personId: "p-0123abcd" }, "u").defaultDecision).toBeUndefined();
  });

  test("defaultDecision は record か decline だけを受け付ける", () => {
    expect(parseRepoConfig({ defaultDecision: "record" }).defaultDecision).toBe("record");
    expect(parseRepoConfig({ defaultDecision: "decline" }).defaultDecision).toBe("decline");
    expect(
      parseUserConfig({ personId: "p-0123abcd", defaultDecision: "decline" }, "u").defaultDecision,
    ).toBe("decline");
    // null は置いていないのと同じに扱う
    expect(parseRepoConfig({ defaultDecision: null }).defaultDecision).toBeNull();
    expect(
      parseUserConfig({ personId: "p-0123abcd", defaultDecision: null }, "u").defaultDecision,
    ).toBeUndefined();
    for (const v of ["ask", "", true, ["record"]]) {
      expect(() => parseRepoConfig({ defaultDecision: v })).toThrow(/record か decline/);
      expect(() => parseUserConfig({ personId: "p-0123abcd", defaultDecision: v }, "u")).toThrow(
        /record か decline/,
      );
    }
  });

  test("人の ID の形とタイムゾーンを確かめる", () => {
    expect(() => parseUserConfig({ personId: "alice" }, "u")).toThrow(/personId/);
    expect(() => parseUserConfig({ personId: "p-0123abcd", timeZone: "Mars/Base" }, "u")).toThrow(
      /timeZone/,
    );
    expect(parseUserConfig({ personId: "p-0123abcd", timeZone: "Asia/Tokyo" }, "u")).toMatchObject({
      billing: "none",
    });
  });
});

describe("時刻", () => {
  test("オフセットの無い時刻は受け付けない", () => {
    expect(parseTime("2026-10-01T00:00:00")).toBeNull();
    expect(parseTime("2026-10-01T09:00:00+09:00")).toBe(H(0));
  });

  test("タイムゾーンで日付と時を切る", () => {
    expect(localParts(H(15), "Asia/Tokyo")).toMatchObject({ date: "2026-10-02", hour: 0 });
    expect(
      splitByLocalHour(H(14, 30), H(15, 30), "Asia/Tokyo").map((p) => [p.hour, p.end - p.start]),
    ).toEqual([
      [23, 1800000],
      [0, 1800000],
    ]);
    expect(endOfLocalDate("2026-10-01", "Asia/Tokyo")).toBe(H(15));
  });
});

describe("停止の分類", () => {
  const iso = (h: number, m = 0) => new Date(H(h, m)).toISOString();
  const report = (
    rows: Parameters<typeof buildReport>[0],
    over: Partial<Parameters<typeof buildReport>[1]> = {},
  ) =>
    buildReport(rows, {
      config: parseRepoConfig({}),
      bundledPricing: {},
      bundledReviewPricing: {},
      tz: "UTC",
      now: H(23),
      since: null,
      until: null,
      recordFiles: 1,
      ...over,
    });
  const stopsOf = (r: ReturnType<typeof buildReport>) =>
    r.intervals.filter((x) => x.type === "stop").map((x) => [x.start, x.end, x.category]);
  const runRow = (key: string, from: number, to: number, extra: Record<string, string> = {}) => ({
    key,
    kind: "run",
    observed_at: iso(10),
    person: "p-00000001",
    tz: "UTC",
    start: iso(from),
    end: iso(to),
    branch: "a",
    detail: "prompt",
    ...extra,
  });
  const coverageRow = (key: string, from: number, to: number, detail = "ok") => ({
    key,
    kind: "coverage",
    observed_at: iso(10),
    person: "p-00000001",
    tz: "UTC",
    start: iso(from),
    end: iso(to),
    detail,
  });

  test("report: 重なる run をまとめ、その隙間だけを停止にする", () => {
    const r = report(
      [runRow("r1", 5, 7), runRow("r2", 1, 3), runRow("r3", 2, 4), coverageRow("cov", 0, 10)],
      { now: H(10) },
    );
    expect(stopsOf(r)).toEqual([
      [iso(4), iso(5), "idle"],
      [iso(7), iso(10), "idle"],
    ]);
  });

  // classifySpan の戻り値は、intervals.csv の停止の行（start・end・category）と同じ意味を持つ。
  test("層の優先順位の順に分類し、どれにも当たらなければ fallback にする", () => {
    const pieces = classifySpan(
      [0, 100],
      [
        { category: "reviewing", spans: [[40, 60]] },
        { category: "ci-wait", spans: [[10, 50]] },
        { category: "unknown", spans: [[80, 120]] },
      ],
      "idle",
    );
    expect(pieces).toEqual([
      { start: 0, end: 10, category: "idle" },
      { start: 10, end: 40, category: "ci-wait" },
      { start: 40, end: 60, category: "reviewing" },
      { start: 60, end: 80, category: "idle" },
      { start: 80, end: 100, category: "unknown" },
    ]);
  });

  test("report: 人の稼働を合わせた隙間を停止にし、人の活動の幅・直前のブランチの CI・取得した期間で分類する", () => {
    const iso = (h: number, m = 0) => new Date(H(h, m)).toISOString();
    const base = { observed_at: iso(23), person: "p-00000001", tz: "UTC" };
    const rows = [
      {
        ...base,
        key: "run1",
        kind: "run",
        start: iso(1),
        end: iso(2),
        branch: "feature/1-a",
        issue: "1",
        detail: "prompt",
      },
      {
        ...base,
        key: "run2",
        kind: "run",
        start: iso(6),
        end: iso(7),
        branch: "feature/1-a",
        issue: "1",
        detail: "prompt",
      },
      { ...base, key: "p1", kind: "prompt", start: iso(6), end: iso(6) },
      { ...base, key: "ci1", kind: "ci", start: iso(2), end: iso(3), branch: "feature/1-a" },
      { ...base, key: "cov", kind: "coverage", start: iso(0), end: iso(5), detail: "ok" },
    ];
    const config = parseRepoConfig({});
    const r = buildReport(rows, {
      config,
      bundledPricing: {},
      bundledReviewPricing: {},
      tz: "UTC",
      now: H(7),
      since: null,
      until: null,
      recordFiles: 1,
    });
    expect(
      r.intervals.filter((x) => x.type === "stop").map((x) => [x.start, x.end, x.category]),
    ).toEqual([
      [iso(2), iso(3), "ci-wait"],
      [iso(3), iso(5), "idle"],
      [iso(5), iso(5, 45), "unknown"],
      [iso(5, 45), iso(6), "reviewing"],
    ]);
    expect(r.runHistogram).toEqual([0, 0, 0, 2, 0]);
  });

  // classifyingFailuresOf の戻り値は、coverage の行の detail（failed:<段>）に挙げる段になる。
  test("coverage は、課金 API と artifact の失敗だけなら判定不能にしない", () => {
    expect(classifyingFailuresOf(["billing 2026-10-01: 404", "artifacts: 500"])).toEqual([]);
    expect(classifyingFailuresOf(["pulls: 502", "billing 2026-10-01: 404"])).toEqual([
      "pulls: 502",
    ]);
    expect(classifyingFailuresOf(["check-runs#1: 500", "user: 401"])).toEqual([
      "check-runs#1: 500",
      "user: 401",
    ]);
  });

  test("report: 単価のある応答と単価不明の応答が混在する行も、単価不明に数える", () => {
    const base = { observed_at: "2026-10-01T05:00:00.000Z", person: "p-00000001", tz: "UTC" };
    const rows = [
      {
        ...base,
        key: "u1",
        kind: "usage",
        agent: "claude-code",
        model: "m",
        start: "2026-10-01T01:00:00.000Z",
        end: "2026-10-01T02:00:00.000Z",
        cost_usd: "1.000000",
        cost_source: "log+unknown",
      },
    ];
    const r = buildReport(rows, {
      config: parseRepoConfig({}),
      bundledPricing: {},
      bundledReviewPricing: {},
      tz: "UTC",
      now: Date.parse("2026-10-01T06:00:00Z"),
      since: null,
      until: null,
      recordFiles: 1,
    });
    expect(r.unknownCostBuckets).toBe(1);
    expect(Number(r.usage[0].cost_usd)).toBe(1);
  });

  test("report: 人ごとの停止は、その人が最後に記録した時刻（observed_at）で打ち切る", () => {
    const iso = (h: number, m = 0) => new Date(H(h, m)).toISOString();
    const base = { observed_at: iso(4), person: "p-00000001", tz: "UTC" };
    const rows = [
      {
        ...base,
        key: "run1",
        kind: "run",
        start: iso(1),
        end: iso(2),
        branch: "feature/1-a",
        issue: "1",
        detail: "prompt",
      },
      { ...base, key: "cov", kind: "coverage", start: iso(0), end: iso(4), detail: "ok" },
    ];
    const r = buildReport(rows, {
      config: parseRepoConfig({}),
      bundledPricing: {},
      bundledReviewPricing: {},
      tz: "UTC",
      now: H(10),
      since: null,
      until: null,
      recordFiles: 1,
    });
    const stops = r.intervals.filter((x) => x.type === "stop");
    expect(stops.map((x) => [x.start, x.end])).toEqual([[iso(2), iso(4)]]);
  });

  test("report: 停止の直前のブランチは、隙間の前に最も遅く終わった run から取る（後に始まって先に終わった run ではない）", () => {
    const iso = (h: number, m = 0) => new Date(H(h, m)).toISOString();
    const base = { observed_at: iso(23), person: "p-00000001", tz: "UTC" };
    const rows = [
      {
        ...base,
        key: "long",
        kind: "run",
        start: iso(1),
        end: iso(5),
        branch: "a",
        detail: "prompt",
      },
      {
        ...base,
        key: "short",
        kind: "run",
        start: iso(2),
        end: iso(3),
        branch: "b",
        detail: "prompt",
      },
      { ...base, key: "ci-a", kind: "ci", start: iso(5), end: iso(6), branch: "a" },
      { ...base, key: "cov", kind: "coverage", start: iso(0), end: iso(7), detail: "ok" },
    ];
    const r = buildReport(rows, {
      config: parseRepoConfig({}),
      bundledPricing: {},
      bundledReviewPricing: {},
      tz: "UTC",
      now: H(6),
      since: null,
      until: null,
      recordFiles: 1,
    });
    expect(
      r.intervals
        .filter((x) => x.type === "stop")
        .map((x) => [x.start, x.end, x.category, x.branch]),
    ).toEqual([[iso(5), iso(6), "ci-wait", "a"]]);
  });

  test("report: 記録の時点で単価の無かった行は、今の単価表で計算し直し、それでも無ければ単価不明として数える", () => {
    const base = {
      observed_at: "2026-10-02T00:00:00.000Z",
      person: "p-00000001",
      tz: "UTC",
      kind: "usage",
      agent: "codex",
      start: "2026-10-01T01:00:00.000Z",
      end: "2026-10-01T02:00:00.000Z",
    };
    const rows = [
      {
        ...base,
        key: "u1",
        model: "late-model",
        input_tokens: "1000000",
        output_tokens: "0",
        cost_usd: "",
        cost_source: "unknown",
      },
      {
        ...base,
        key: "u2",
        model: "still-unknown",
        input_tokens: "5",
        output_tokens: "0",
        cost_usd: "",
        cost_source: "unknown",
      },
    ];
    const config = parseRepoConfig({ pricing: { "late-model": { input: 3, output: 9 } } });
    const r = buildReport(rows, {
      config,
      bundledPricing: {},
      bundledReviewPricing: {},
      tz: "UTC",
      now: Date.parse("2026-10-02T00:00:00Z"),
      since: null,
      until: null,
      recordFiles: 1,
    });
    expect(
      r.usage.map((u) => [u.model, u.cost_usd, u.cost_unknown_buckets, u.cost_sources]),
    ).toEqual([
      ["late-model", "3.000000", "0", "repo@report"],
      ["still-unknown", "0.000000", "1", "unknown"],
    ]);
    expect(r.unknownCostBuckets).toBe(1);
  });

  test("report: 推定額の無いレビューは、今の単価（リポジトリの設定・同梱）で推定し直す", () => {
    const base = {
      observed_at: "2026-10-02T00:00:00.000Z",
      person: "p-00000001",
      tz: "UTC",
      kind: "review",
      start: "2026-10-01T01:00:00.000Z",
      end: "2026-10-01T01:00:00.000Z",
      cost_usd: "",
      cost_source: "unknown",
      detail: "pr=1;author=a;state=commented",
    };
    const rows = [
      { ...base, key: "r1", agent: "copilot" },
      { ...base, key: "r2", agent: "codex-cloud" },
      { ...base, key: "r3", agent: "other" },
    ];
    const config = parseRepoConfig({ reviewPricing: { "codex-cloud": 0.2 } });
    const r = buildReport(rows, {
      config,
      bundledPricing: {},
      bundledReviewPricing: { copilot: 0.52, "codex-cloud": 9 },
      tz: "UTC",
      now: Date.parse("2026-10-02T00:00:00Z"),
      since: null,
      until: null,
      recordFiles: 1,
    });
    expect(r.reviews.map((x) => [x.tool, x.cost_usd, x.cost_source])).toEqual([
      ["codex-cloud", "0.200000", "estimate-repo@report"],
      ["copilot", "0.520000", "estimate-bundled@report"],
      ["other", "", "unknown"],
    ]);
  });

  test("HTML: Issue ごとの表の稼働中は、外部待ちを含め、同時に動いた Issue の数で等分し、未活用は直前の指示の Issue に数える", () => {
    const base = {
      observed_at: "2026-10-01T05:00:00.000Z",
      person: "p-00000001",
      tz: "UTC",
      kind: "run",
      detail: "prompt",
    };
    const rows = [
      // Issue 1 の指示が 2 つ重なる（1〜3 時と 2 時半〜3 時半）。最初の指示には 1 時間の外部待ちがある
      {
        ...base,
        key: "a",
        issue: "1",
        start: "2026-10-01T01:00:00.000Z",
        end: "2026-10-01T03:00:00.000Z",
        wait_ms: "3600000",
      },
      {
        ...base,
        key: "b",
        issue: "1",
        start: "2026-10-01T02:30:00.000Z",
        end: "2026-10-01T03:30:00.000Z",
      },
      // 同じ人が同時に動かした Issue 2 の指示（2〜4 時）
      {
        ...base,
        key: "c",
        issue: "2",
        start: "2026-10-01T02:00:00.000Z",
        end: "2026-10-01T04:00:00.000Z",
      },
      // 4〜5 時は止まっていた（GitHub は取得済みなので未活用）。直前に動いていたのは Issue 2 の指示
      {
        key: "cov",
        kind: "coverage",
        observed_at: "2026-10-01T05:00:00.000Z",
        person: "p-00000001",
        tz: "UTC",
        start: "2026-10-01T00:00:00.000Z",
        end: "2026-10-01T06:00:00.000Z",
        detail: "ok",
      },
    ];
    const r = buildReport(rows, {
      config: parseRepoConfig({}),
      bundledPricing: {},
      bundledReviewPricing: {},
      tz: "UTC",
      now: Date.parse("2026-10-01T05:00:00Z"),
      since: null,
      until: null,
      recordFiles: 1,
    });
    // 1〜2 時は Issue 1 だけ、2〜3 時半は 2 つの Issue で等分、3 時半〜4 時は Issue 2 だけ
    expect(r.activeByIssue).toEqual({ "1": 1.75, "2": 1.25 });
    // Issue ごとの合計は、人ごとの稼働中と一致する
    expect(r.activeByPerson).toEqual({ "p-00000001": 3 });
    expect(r.idleByIssue).toEqual({ "2": 1 });
    const html = renderHtml(r);
    const start = html.indexOf("<h2>Issue ごと");
    const section = html.slice(start, html.indexOf("</section>", start));
    const rowsOf = [...section.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) =>
      [...m[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((c) => c[1]),
    );
    expect(rowsOf).toEqual([
      ["Issue", "指示の数", `${STATUS_LABELS.active}（時間）`, `${STOP_LABELS.idle}（時間）`],
      ["1", "2", "1.8", "0.0"],
      ["2", "1", "1.3", "1.0"],
      ["合計（すべての Issue）", "3", "3.0", "1.0"],
    ]);
  });

  test("HTML: 人ごとの表に、人ごとの費用・指示の数・稼働状況の内訳と、合計の行を出し、上部の稼働状況と同じ値にする", () => {
    const base = { observed_at: "2026-10-02T00:00:00.000Z", tz: "UTC" };
    const rows = [
      {
        ...base,
        key: "u1",
        kind: "usage",
        person: "p-00000001",
        agent: "codex",
        model: "m",
        start: "2026-10-01T01:00:00.000Z",
        end: "2026-10-01T02:00:00.000Z",
        cost_usd: "1.5",
        cost_source: "bundled",
      },
      {
        ...base,
        key: "u2",
        kind: "usage",
        person: "p-00000002",
        agent: "codex",
        model: "m",
        start: "2026-10-01T01:00:00.000Z",
        end: "2026-10-01T02:00:00.000Z",
        cost_usd: "2.5",
        cost_source: "bundled",
      },
      {
        ...base,
        key: "r1",
        kind: "run",
        person: "p-00000001",
        start: "2026-10-01T01:00:00.000Z",
        end: "2026-10-01T02:00:00.000Z",
        wait_ms: "1800000",
        detail: "prompt",
      },
    ];
    const config = parseRepoConfig({ people: { "p-00000002": { name: "花子" } } });
    const html = renderHtml(
      buildReport(rows, {
        config,
        bundledPricing: {},
        bundledReviewPricing: {},
        tz: "UTC",
        now: Date.parse("2026-10-01T03:00:00Z"),
        since: null,
        until: null,
        recordFiles: 1,
      }),
    );
    // 「人ごと」の節の表を、列の見出しと対応づけた行にする（マークアップの細部には依らない）
    const start = html.indexOf("<h2>人ごと</h2>");
    const section = html.slice(start, html.indexOf("</section>", start));
    const [header, ...body] = [...section.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) =>
      [...m[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((c) => c[1]),
    );
    const byId = new Map(
      body.map((cells) => [cells[0], Object.fromEntries(header.map((h, i) => [h, cells[i]]))]),
    );
    expect(byId.get("p-00000002")).toMatchObject({
      表示名: "花子",
      費用: "$2.50",
      指示の数: "0",
    });
    // p-00000001 は 1〜2 時に稼働し、2〜3 時は GitHub を取得していないので「判定不能」の停止になる。
    // 稼働中は稼働状況のチャートと同じ定義なので、指示の中の外部待ち（30 分）も含めて 1 時間になる
    expect(byId.get("p-00000001")).toMatchObject({
      表示名: "p-00000001",
      費用: "$1.50",
      指示の数: "1",
      [`${STATUS_LABELS.active}（時間）`]: "1.0",
      [`${STOP_LABELS.idle}（時間）`]: "0.0",
      [`${STOP_LABELS.unknown}（時間）`]: "1.0",
    });
    expect(byId.get("合計")).toMatchObject({
      費用: "$4.00",
      指示の数: "1",
      [`${STATUS_LABELS.active}（時間）`]: "1.0",
    });
    // 上部の稼働状況のタイルも、同じ値を出す
    const tile = html.slice(
      html.indexOf("<h2>稼働状況</h2>"),
      html.indexOf("</dl>", html.indexOf("<h2>稼働状況</h2>")),
    );
    expect(tile).toContain("<dt>稼働中</dt><dd>1.0 時間</dd>");
    expect(tile).toContain(`<dt>${STOP_LABELS.unknown}</dt><dd>1.0 時間</dd>`);
    expect(tile).toContain('<span class="v">2.0 時間</span>');
  });

  test("期間の表示: 指定が無い側は記録の最も古い日付・新しい日付にし、coverage の行は数えない", () => {
    const rows = [
      {
        key: "a",
        kind: "run",
        start: "2026-09-30T16:00:00.000Z",
        end: "2026-09-30T17:00:00.000Z",
        tz: "Asia/Tokyo",
      },
      {
        key: "b",
        kind: "usage",
        start: "2026-10-03T01:00:00.000Z",
        end: "2026-10-03T02:00:00.000Z",
        tz: "UTC",
      },
      {
        key: "c",
        kind: "coverage",
        start: "2026-08-01T00:00:00.000Z",
        end: "2026-10-09T00:00:00.000Z",
        tz: "UTC",
        detail: "ok",
      },
    ];
    // periodBounds と formatPeriod で作る文字列は、report の HTML に出す期間の表示になる。
    const label = (r: typeof rows, o: Parameters<typeof periodBounds>[1]) => {
      const { from, to } = periodBounds(r, o);
      return formatPeriod(from, to);
    };
    expect(label(rows, { since: null, until: null, tz: "UTC" })).toBe("2026-10-01 〜 2026-10-03");
    expect(label(rows, { since: "2026-09-01", until: null, tz: "UTC" })).toBe(
      "2026-09-01 〜 2026-10-03",
    );
    expect(label([], { since: null, until: null, tz: "UTC" })).toBe("記録なし");
  });
});

// report の集計で、行の欄が欠けた・読めない・期間の外にある入力の状態。
//   期間       since・until の外の行 / タイムゾーンの無い行（report のタイムゾーンで日付を切る）/ until の日の終わりで打ち切る。
//   時刻       start か end を読めない run・ci・coverage・usage。
//   人         別名でまとめる / 人の無い行 / observed_at の無い人 / 同じ時刻に始まる別の人。
//   人の活動   human-wait は終わりの時刻、activity は始まりの時刻。
//   レビュー   課金の行 / artifact の使用量 / 推定額のある行 / 欄の無い行。
describe("report の集計（欄の欠け・期間・時刻）", () => {
  const options = (over: Partial<Parameters<typeof buildReport>[1]> = {}) => ({
    config: parseRepoConfig({}),
    bundledPricing: {},
    bundledReviewPricing: {},
    tz: "UTC",
    now: H(23),
    since: null,
    until: null,
    recordFiles: 1,
    ...over,
  });
  const stops = (r: ReturnType<typeof buildReport>) =>
    r.intervals.filter((x) => x.type === "stop").map((x) => [x.start, x.end, x.category]);

  test("since・until の外の行を数えず、タイムゾーンの無い行は report のタイムゾーンで日付を切り、停止は until の日の終わりで打ち切る", () => {
    const base = { observed_at: "2026-10-05T00:00:00.000Z", person: "p-00000001" };
    const run = (key: string, start: string, end: string) => ({
      ...base,
      key,
      kind: "run",
      start,
      end,
      branch: "a",
      detail: "prompt",
    });
    const rows = [
      // 東京で 9 月 30 日（since より前）・10 月 2 日・10 月 3 日（until より後）の run
      run("r0", "2026-09-30T10:00:00.000Z", "2026-09-30T11:00:00.000Z"),
      run("r1", "2026-10-01T23:00:00.000Z", "2026-10-01T23:30:00.000Z"),
      run("r2", "2026-10-02T16:00:00.000Z", "2026-10-02T17:00:00.000Z"),
      {
        ...base,
        key: "u",
        kind: "usage",
        agent: "codex",
        model: "m",
        start: "2026-10-01T16:00:00.000Z",
        end: "2026-10-01T17:00:00.000Z",
        cost_usd: "1.000000",
        cost_source: "bundled",
      },
      // 停止より前に終わる取得と、停止より後に始まる取得。どちらも停止に重ならない
      {
        ...base,
        key: "cov-before",
        kind: "coverage",
        start: "2026-10-01T00:00:00.000Z",
        end: "2026-10-01T01:00:00.000Z",
        detail: "ok",
      },
      {
        ...base,
        key: "cov-after",
        kind: "coverage",
        start: "2026-10-02T16:00:00.000Z",
        end: "2026-10-03T00:00:00.000Z",
        detail: "ok",
      },
    ];
    const r = buildReport(
      rows,
      options({
        tz: "Asia/Tokyo",
        since: "2026-10-01",
        until: "2026-10-02",
        now: Date.parse("2026-10-05T00:00:00Z"),
      }),
    );
    expect(r.intervals.filter((x) => x.type === "run").map((x) => x.start)).toEqual([
      "2026-10-01T23:00:00.000Z",
    ]);
    // 東京の日付の終わりは、UTC の同じ日の 15:00 である
    expect(stops(r)).toEqual([["2026-10-01T23:30:00.000Z", "2026-10-02T15:00:00.000Z", "unknown"]]);
    expect(r.usage.map((u) => [u.date, u.cost_usd])).toEqual([["2026-10-02", "1.000000"]]);
    expect(r.period).toBe("2026-10-01 〜 2026-10-02");
  });

  test("時刻を読めない行は、稼働・停止・取得した期間・費用に数えない", () => {
    const base = { observed_at: "2026-10-01T10:00:00.000Z", person: "p-00000001", tz: "UTC" };
    const rows = [
      // end を読めない run だけを持つ人は、稼働も停止も無い
      {
        ...base,
        key: "r",
        kind: "run",
        start: "2026-10-01T01:00:00.000Z",
        end: "x",
        detail: "prompt",
      },
      { ...base, key: "ci", kind: "ci", start: "2026-10-01T02:00:00.000Z", end: "x", branch: "a" },
      {
        ...base,
        key: "cov",
        kind: "coverage",
        start: "2026-10-01T00:00:00.000Z",
        end: "x",
        detail: "ok",
      },
      {
        ...base,
        key: "u",
        kind: "usage",
        model: "m",
        start: "x",
        end: "x",
        cost_usd: "5.000000",
        cost_source: "bundled",
      },
    ];
    const r = buildReport(rows, options());
    expect(r.intervals).toEqual([]);
    expect(r.usage).toEqual([]);
    expect(r.rows).toBe(3);
    expect(r.period).toBe("2026-10-01 〜 2026-10-01");
  });

  test("別名で人をまとめ、欄の無い usage は空の値と 0 として数え、単価があれば計算し直す", () => {
    const base = {
      observed_at: "2026-10-02T00:00:00.000Z",
      tz: "UTC",
      kind: "usage",
      start: "2026-10-01T01:00:00.000Z",
      end: "2026-10-01T02:00:00.000Z",
    };
    const rows = [
      {
        ...base,
        key: "u1",
        person: "p-00000001",
        agent: "codex",
        model: "m",
        output_tokens: "1000000",
        cost_usd: "",
      },
      {
        ...base,
        key: "u2",
        person: "p-00000002",
        agent: "codex",
        model: "m",
        cost_usd: "1.000000",
        cost_source: "bundled",
      },
      // 人・エージェント・モデル・費用の出所の欄が無い行
      { ...base, key: "u3", cost_usd: "0.500000" },
    ];
    const config = parseRepoConfig({
      aliases: { "p-00000001": "p-00000002" },
      people: { "p-00000002": { name: "花子" } },
      pricing: { m: { input: 1, output: 2 } },
    });
    const r = buildReport(rows, options({ config }));
    expect(
      r.usage.map((u) => [
        u.person,
        u.name,
        u.agent,
        u.model,
        u.output_tokens,
        u.cost_usd,
        u.cost_sources,
      ]),
    ).toEqual([
      ["", "", "", "", "0", "0.500000", ""],
      ["p-00000002", "花子", "codex", "m", "1000000", "3.000000", "bundled+repo@report"],
    ]);
    expect(r.names).toEqual({ "p-00000002": "花子" });
    expect(r.unknownCostBuckets).toBe(0);
  });

  test("human-wait は終わり、activity は始まりの前後を人の活動にし、observed_at の無い人は期間の終わりまで停止に数える", () => {
    const base = { person: "p-00000001", tz: "UTC" };
    const iso = (h: number, m = 0) => new Date(H(h, m)).toISOString();
    const rows = [
      {
        ...base,
        key: "r1",
        kind: "run",
        start: iso(1),
        end: iso(2),
        branch: "a",
        detail: "prompt+open",
        wait_ms: "600000",
      },
      {
        ...base,
        key: "r2",
        kind: "run",
        start: iso(5),
        end: iso(6),
        branch: "a",
        detail: "prompt",
      },
      { ...base, key: "hw", kind: "human-wait", start: iso(2, 30), end: iso(3) },
      { ...base, key: "act", kind: "activity", start: iso(4, 30), end: iso(4, 30) },
      { ...base, key: "cov", kind: "coverage", start: iso(0), end: iso(8), detail: "ok" },
    ];
    const r = buildReport(rows, options({ now: H(8) }));
    expect(stops(r)).toEqual([
      [iso(2), iso(2, 45), "idle"],
      [iso(2, 45), iso(3, 15), "reviewing"],
      [iso(3, 15), iso(4, 15), "idle"],
      [iso(4, 15), iso(4, 45), "reviewing"],
      [iso(4, 45), iso(5), "idle"],
      [iso(6), iso(8), "idle"],
    ]);
    expect(
      r.intervals
        .filter((x) => x.type === "run")
        .map((x) => [x.category, x.minutes, x.active_minutes]),
    ).toEqual([
      ["running", "60.0", "50.0"],
      ["run", "60.0", "60.0"],
    ]);
  });

  test("同じ時刻に始まる区間は、人の ID の順に並べる", () => {
    const run = (key: string, person: string) => ({
      key,
      kind: "run",
      person,
      tz: "UTC",
      observed_at: new Date(H(2)).toISOString(),
      start: new Date(H(1)).toISOString(),
      end: new Date(H(2)).toISOString(),
      detail: "prompt",
    });
    const r = buildReport([run("b", "p-00000002"), run("a", "p-00000001")], options({ now: H(2) }));
    expect(r.intervals.map((x) => x.person)).toEqual(["p-00000001", "p-00000002"]);
  });

  test("課金の行と artifact の使用量は推定し直さず、欄の無いレビューは空の値にする", () => {
    const base = {
      observed_at: "2026-10-02T00:00:00.000Z",
      person: "p-00000001",
      tz: "UTC",
      start: "2026-10-01T01:00:00.000Z",
      end: "2026-10-01T01:00:00.000Z",
    };
    const rows = [
      {
        ...base,
        key: "b",
        kind: "billing",
        agent: "copilot",
        cost_usd: "0.040000",
        cost_source: "billing",
      },
      {
        ...base,
        key: "art",
        kind: "review",
        agent: "codex-cloud",
        model: "x",
        cost_usd: "",
        detail: "source=artifact;pr=2",
      },
      {
        ...base,
        key: "est",
        kind: "review",
        agent: "copilot",
        cost_usd: "0.100000",
        cost_source: "estimate-bundled",
        detail: "pr=3;author=a",
      },
      { ...base, key: "bare", kind: "review" },
    ];
    const r = buildReport(
      rows,
      options({ bundledReviewPricing: { copilot: 0.52, "codex-cloud": 9 } }),
    );
    expect(
      r.reviews.map((x) => [
        x.type,
        x.tool,
        x.model,
        x.pr,
        x.author,
        x.branch,
        x.cost_usd,
        x.cost_source,
        x.detail,
      ]),
    ).toEqual([
      ["review", "", "", "", "", "", "", "", ""],
      ["usage", "codex-cloud", "x", "2", "", "", "", "", "source=artifact;pr=2"],
      ["billing", "copilot", "", "", "", "", "0.040000", "billing", ""],
      ["review", "copilot", "", "3", "a", "", "0.100000", "estimate-bundled", "pr=3;author=a"],
    ]);
  });
});

// 日別のチャートの横軸と、日別・時刻ごとの稼働状況（稼働中と停止の分類）。
//   期間       since・until の指定なし（記録の最初と最後の日）/ 指定あり（端の日に記録が無い）/ 年をまたぐ。
//   記録       記録の無い日が途中にある / 停止が observed_at まで続き、記録の最後の日より後に置かれる。
//   停止       日をまたぐ（UTC と UTC 以外のタイムゾーン）/ 期間の途中で使い始めた人。
//   稼働中     複数の人の run / 期間の終わりをまたぐ run。
describe("日別のチャート", () => {
  const options = (over: Partial<Parameters<typeof buildReport>[1]> = {}) => ({
    config: parseRepoConfig({}),
    bundledPricing: {},
    bundledReviewPricing: {},
    tz: "UTC",
    now: Date.parse("2026-10-10T00:00:00Z"),
    since: null,
    until: null,
    recordFiles: 1,
    ...over,
  });
  const usage = (key: string, start: string, cost: string, model = "m") => ({
    key,
    kind: "usage",
    observed_at: start,
    person: "p-00000001",
    tz: "UTC",
    agent: "codex",
    model,
    start,
    end: start,
    cost_usd: cost,
    cost_source: "bundled",
  });
  const run = (key: string, person: string, start: string, end: string, observedAt: string) => ({
    key,
    kind: "run",
    observed_at: observedAt,
    person,
    tz: "UTC",
    start,
    end,
    branch: "a",
    detail: "prompt",
  });
  // GitHub を取得した期間。停止を「判定不能」にしないために置く
  const coverage = {
    key: "cov",
    kind: "coverage",
    observed_at: "2026-10-01T00:00:00.000Z",
    person: "p-00000001",
    tz: "UTC",
    start: "2026-09-01T00:00:00.000Z",
    end: "2026-11-01T00:00:00.000Z",
    detail: "ok",
  };
  // チャートの figure から、「表で見る」の表の行を取り出す
  const tableOf = (html: string, title: string) => {
    const start = html.indexOf(`<figcaption>${title}</figcaption>`);
    expect(start).toBeGreaterThan(-1);
    const figure = html.slice(start, html.indexOf("</figure>", start));
    return [...figure.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) =>
      [...m[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((c) => c[1]),
    );
  };
  const axisLabels = (html: string, title: string) => {
    const start = html.indexOf(`<figcaption>${title}</figcaption>`);
    const svg = html.slice(start, html.indexOf("</svg>", start));
    return [...svg.matchAll(/<text class="axis"[^>]*text-anchor="middle">([^<]*)<\/text>/g)].map(
      (m) => m[1],
    );
  };

  test("記録の無い日も、日別の費用のチャートと表に 0 として並べる", () => {
    const r = buildReport(
      [
        usage("u1", "2026-10-01T01:00:00.000Z", "1.0"),
        usage("u3", "2026-10-03T01:00:00.000Z", "2.0"),
      ],
      options(),
    );
    expect(r.days).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
    const html = renderHtml(r);
    expect(tableOf(html, "日別の費用（モデル別）")).toEqual([
      ["項目", "m", "合計"],
      ["2026-10-01", "$1.00", "$1.00"],
      ["2026-10-02", "$0.00", "$0.00"],
      ["2026-10-03", "$2.00", "$2.00"],
      ["合計", "$3.00", "$3.00"],
    ]);
    expect(axisLabels(html, "日別の費用（モデル別）")).toEqual(["10-01", "10-02", "10-03"]);
  });

  test("since・until を指定したら、端の日に記録が無くても、その範囲のすべての日を並べる", () => {
    const r = buildReport(
      [usage("u3", "2026-10-03T01:00:00.000Z", "2.0")],
      options({ since: "2026-10-01", until: "2026-10-05" }),
    );
    expect(r.days).toEqual(["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"]);
    expect(tableOf(renderHtml(r), "日別の費用（モデル別）").map((row) => row[0])).toEqual([
      "項目",
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
      "2026-10-05",
      "合計",
    ]);
  });

  test("期間が年をまたぐときは、日付の目盛りに年も書く", () => {
    const r = buildReport(
      [
        usage("u1", "2026-12-31T01:00:00.000Z", "1.0"),
        usage("u2", "2027-01-01T01:00:00.000Z", "1.0"),
      ],
      options({ now: Date.parse("2027-01-02T00:00:00Z") }),
    );
    expect(axisLabels(renderHtml(r), "日別の費用（モデル別）")).toEqual([
      "2026-12-31",
      "2027-01-01",
    ]);
  });

  test("稼働中と停止を日ごと・時刻ごとに分けて積み上げ、使わなかった日は人数 × 24 時間の未活用にし、使い始める前の日は数えない", () => {
    const rows = [
      coverage,
      // p1 は 10 月 1 日と 3 日に使い、2 日は使わない。最後に記録したのは 3 日の 3 時
      run(
        "a1",
        "p-00000001",
        "2026-10-01T22:00:00.000Z",
        "2026-10-01T23:00:00.000Z",
        "2026-10-03T03:00:00.000Z",
      ),
      run(
        "a3",
        "p-00000001",
        "2026-10-03T01:00:00.000Z",
        "2026-10-03T02:00:00.000Z",
        "2026-10-03T03:00:00.000Z",
      ),
      // p2 は 3 日に使い始める
      run(
        "b3",
        "p-00000002",
        "2026-10-03T01:00:00.000Z",
        "2026-10-03T02:00:00.000Z",
        "2026-10-03T04:00:00.000Z",
      ),
    ];
    const r = buildReport(rows, options());
    expect(r.days).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
    const byStatus = Object.fromEntries(r.statusByDay.map((s) => [s.status, s.byDay]));
    // 稼働中: 1 日は p1 の 22〜23 時。3 日は p1 と p2 の 1〜2 時
    expect(byStatus.active).toEqual([1, 0, 2]);
    // 未活用: 1 日は p1 の 23〜24 時。2 日は p1 の 24 時間（p2 はまだ使っていない）。3 日は p1 の 0〜1 時と 2〜3 時、p2 の 2〜4 時
    expect(byStatus.idle).toEqual([1, 24, 4]);
    for (const c of ["reviewing", "ci-wait", "review-wait", "unknown"]) {
      expect(byStatus[c]).toEqual([0, 0, 0]);
    }
    // 日別の停止を全日で足すと、停止の分類ごとの合計（intervals の停止）と一致する
    for (const s of r.statusByDay.filter((x) => x.status !== "active")) {
      const total = r.intervals
        .filter((x) => x.type === "stop" && x.category === s.status)
        .reduce((a, x) => a + Number(x.minutes) / 60, 0);
      expect(s.byDay.reduce((a, b) => a + b, 0)).toBeCloseTo(total, 6);
    }
    // 時刻ごとも同じ区間を数える。全時刻で足すと、全日で足した値と一致する
    const hourly = Object.fromEntries(r.statusByHour.map((s) => [s.status, s.byHour]));
    expect(hourly.active[22]).toBe(1);
    expect(hourly.active[1]).toBe(2);
    for (const s of r.statusByDay) {
      expect(hourly[s.status].reduce((a, b) => a + b, 0)).toBeCloseTo(
        s.byDay.reduce((a, b) => a + b, 0),
        6,
      );
    }
    const html = renderHtml(r);
    // 日別の費用のチャートの下に、日別の稼働状況のチャートがある
    expect(html.indexOf("<figcaption>日別の稼働状況（時間）</figcaption>")).toBeGreaterThan(
      html.indexOf("<figcaption>日別の費用（モデル別）</figcaption>"),
    );
    const header = ["項目", ...STATUSES.map((c) => STATUS_LABELS[c]), "合計"];
    expect(header.slice(1, 3)).toEqual(["稼働中", STOP_LABELS.idle]);
    const table = tableOf(html, "日別の稼働状況（時間）");
    expect(table[0]).toEqual(header);
    expect(table.slice(1).map((row) => [row[0], row[1], row[2], row[row.length - 1]])).toEqual([
      ["2026-10-01", "1.0", "1.0", "2.0"],
      ["2026-10-02", "0.0", "24.0", "24.0"],
      ["2026-10-03", "2.0", "4.0", "6.0"],
      ["合計", "3.0", "29.0", "32.0"],
    ]);
    const hourTable = tableOf(html, "時刻ごとの稼働状況（時間）");
    expect(hourTable[0]).toEqual(header);
    expect(hourTable[hourTable.length - 1].slice(1, 3)).toEqual(["3.0", "29.0"]);
  });

  test("稼働中は、期間の終わりで打ち切る", () => {
    // until の日の 23 時から翌日の 1 時まで動いた run
    const rows = [
      coverage,
      run(
        "a1",
        "p-00000001",
        "2026-10-02T23:00:00.000Z",
        "2026-10-03T01:00:00.000Z",
        "2026-10-03T01:00:00.000Z",
      ),
    ];
    const r = buildReport(rows, options({ since: "2026-10-02", until: "2026-10-02" }));
    expect(r.days).toEqual(["2026-10-02"]);
    const active = r.statusByHour.find((s) => s.status === "active")?.byHour ?? [];
    expect(active.reduce((a, b) => a + b, 0)).toBe(1);
    expect(r.statusByDay.find((s) => s.status === "active")?.byDay).toEqual([1]);
    // 人ごとと Issue ごとの稼働中も、同じ所で打ち切る
    expect(r.activeByPerson).toEqual({ "p-00000001": 1 });
    expect(r.activeByIssue).toEqual({ "": 1 });
  });

  test("停止は人のタイムゾーンの日付で分け、記録の最後の日より後に続いた停止の日も並べる", () => {
    const rows = [
      { ...coverage, tz: "Asia/Tokyo" },
      // 東京の 10 月 1 日 22〜23 時に使い、最後に記録したのは東京の 10 月 2 日 1 時
      {
        ...run(
          "t1",
          "p-00000001",
          "2026-10-01T13:00:00.000Z",
          "2026-10-01T14:00:00.000Z",
          "2026-10-01T16:00:00.000Z",
        ),
        tz: "Asia/Tokyo",
      },
    ];
    const r = buildReport(rows, options({ tz: "Asia/Tokyo" }));
    expect(r.days).toEqual(["2026-10-01", "2026-10-02"]);
    expect(r.statusByDay.find((s) => s.status === "idle")?.byDay).toEqual([1, 1]);
    expect(r.period).toBe("2026-10-01 〜 2026-10-02");
  });

  test("期間の終わりは、report のタイムゾーンではなく、人のタイムゾーンでの until の日の終わりにする（東）", () => {
    // report のタイムゾーンは UTC。東京の人が、東京の 10 月 1 日 19 時から 10 月 2 日 1 時まで動いた（UTC では 10 月 1 日の中）。
    // 東京の 10 月 1 日の終わり（UTC 15 時）で打ち切り、東京の 10 月 2 日に入った 1 時間は数えない
    const rows = [
      { ...coverage, tz: "Asia/Tokyo" },
      {
        ...run(
          "t1",
          "p-00000001",
          "2026-10-01T10:00:00.000Z",
          "2026-10-01T16:00:00.000Z",
          "2026-10-01T16:00:00.000Z",
        ),
        tz: "Asia/Tokyo",
      },
    ];
    const r = buildReport(rows, options({ until: "2026-10-01" }));
    expect(r.days).toEqual(["2026-10-01"]);
    // 日別の稼働中を足すと、人ごとの稼働中と一致する
    expect(r.statusByDay.find((s) => s.status === "active")?.byDay).toEqual([5]);
    expect(r.activeByPerson).toEqual({ "p-00000001": 5 });
  });

  test("--until に先の日付を渡しても、横軸は今日までにし、9999 年の終わりでも止まる", () => {
    const r = buildReport(
      [usage("u1", "2026-10-08T01:00:00.000Z", "1.0")],
      options({ until: "2099-12-31" }),
    );
    // now は options の既定のままなので、横軸は now の日で終わる
    expect(r.days).toEqual(["2026-10-08", "2026-10-09", "2026-10-10"]);
    expect(r.period).toBe("2026-10-08 〜 2099-12-31");
    expect(dateRange("9999-12-30", "9999-12-31")).toEqual(["9999-12-30", "9999-12-31"]);
  });

  test("期間の終わりは、report のタイムゾーンではなく、人のタイムゾーンでの until の日の終わりにする（西）", () => {
    // report のタイムゾーンは UTC。ロサンゼルスの人が、ロサンゼルスの 10 月 1 日 10〜11 時（UTC 17〜18 時）と
    // 20〜21 時（UTC 10 月 2 日 3〜4 時）に動いた。どちらもロサンゼルスの 10 月 1 日なので期間に入り、
    // 費用・指示の数・稼働中・停止がどれも同じ期間を数える
    const la = (key: string, start: string, end: string) => ({
      ...run(key, "p-00000001", start, end, "2026-10-02T05:00:00.000Z"),
      tz: "America/Los_Angeles",
    });
    const rows = [
      coverage,
      la("a", "2026-10-01T17:00:00.000Z", "2026-10-01T18:00:00.000Z"),
      la("b", "2026-10-02T03:00:00.000Z", "2026-10-02T04:00:00.000Z"),
      { ...usage("u", "2026-10-02T03:30:00.000Z", "5.0"), tz: "America/Los_Angeles" },
    ];
    const r = buildReport(rows, options({ until: "2026-10-01" }));
    expect(r.usage.map((u) => u.cost_usd)).toEqual(["5.000000"]);
    expect(r.runHistogram.reduce((a, b) => a + b, 0)).toBe(2);
    expect(r.activeByPerson).toEqual({ "p-00000001": 2 });
    // 停止は run の間と、最後に記録した時刻（UTC 5 時）までの隙間
    expect(
      r.intervals.filter((x) => x.type === "stop").map((x) => [x.start, x.end, x.category]),
    ).toEqual([
      ["2026-10-01T18:00:00.000Z", "2026-10-02T03:00:00.000Z", "idle"],
      ["2026-10-02T04:00:00.000Z", "2026-10-02T05:00:00.000Z", "idle"],
    ]);
  });

  test("人ごとの停止は、intervals.csv の丸めた分ではなく、丸める前の値から足す", () => {
    // 10 秒の停止が 3 回。intervals.csv の minutes は 0.2 分に丸まる（足すと 0.6 分）が、実際は 0.5 分
    const s = (sec: number) =>
      new Date(Date.parse("2026-10-01T01:00:00.000Z") + sec * 1000).toISOString();
    const rows = [
      coverage,
      run("a", "p-00000001", s(0), s(60), s(250)),
      run("b", "p-00000001", s(70), s(130), s(250)),
      run("c", "p-00000001", s(140), s(200), s(250)),
      run("d", "p-00000001", s(210), s(250), s(250)),
    ];
    const r = buildReport(rows, options());
    const idle = r.stopByPerson["p-00000001"].get("idle") ?? 0;
    expect(idle * 60).toBeCloseTo(0.5, 9);
    const byDay = r.statusByDay.find((x) => x.status === "idle")?.byDay ?? [];
    expect(byDay.reduce((a, b) => a + b, 0)).toBeCloseTo(idle, 12);
    // Issue ごとの未活用も、丸める前の値から足す
    expect((r.idleByIssue[""] ?? 0) * 60).toBeCloseTo(0.5, 9);
  });
});

describe("runReport の入力の誤り", () => {
  const run = (over: Partial<Parameters<typeof runReport>[0]>) => {
    const root = makeTempDir("agent-usage-report-");
    const env = { AGENT_USAGE_CONFIG_DIR: join(root, "user") };
    return () => runReport({ root, now: H(1), env, since: null, until: null, out: null, ...over });
  };

  test.each([
    ["--since", { since: "10/01" }, /--since は YYYY-MM-DD で書く/],
    ["--until", { until: "2026-1-1" }, /--until は YYYY-MM-DD で書く/],
    // 形は合っていても、暦に無い日付（月が 0、2 月 30 日）
    ["--since（月が 0）", { since: "2026-00-15" }, /--since は YYYY-MM-DD で書く/],
    ["--until（2 月 30 日）", { until: "2026-02-30" }, /--until は YYYY-MM-DD で書く/],
  ])("%s の形が違えばエラーにする", (_name, over, message) => {
    expect(run(over)).toThrow(message);
  });

  test("--since が --until より後ならエラーにする", () => {
    expect(run({ since: "2026-10-02", until: "2026-10-01" })).toThrow(/--since が --until より後/);
  });

  test("記録のファイルが 1 つも無ければ、collect を先に実行するよう伝える", () => {
    const root = makeTempDir("agent-usage-report-");
    mkdirSync(join(root, ".agent-usage", "records"), { recursive: true });
    expect(() =>
      runReport({
        root,
        now: H(1),
        env: { AGENT_USAGE_CONFIG_DIR: join(root, "user") },
        since: null,
        until: null,
        out: null,
      }),
    ).toThrow(/記録が無い。先に collect を実行する/);
  });
});
