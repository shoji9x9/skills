// agent-usage の費用の計算・明細の重複の扱い・停止の分類のテスト。
//
// 入力の軸:
//   単価             リポジトリの設定・同梱・どちらにも無い／モデル名の [1m] と日付。
//   cost-state       ある（その時刻までをモデルごとに合わせる）・無い／単価の無いモデル（proxyWeight の比）／応答の記録の無いモデル。
//   明細の重複       同じ key の複数の行（observed_at の新しい方）／同じ時刻（内容で決める）／内容が同じ行は書き直さない。
//   停止の分類       人の活動の幅・CI・レビュー待ち・取得していない期間の優先順位／どれにも当たらない（未活用）。

import { describe, expect, test } from "vitest";
import { parseCsv, toCsv } from "../../../skills/agent-usage/scripts/lib/csv.mjs";
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
  gaps,
  mergeSpans,
  periodLabel,
} from "../../../skills/agent-usage/scripts/lib/report.mjs";
import { renderHtml } from "../../../skills/agent-usage/scripts/lib/html.mjs";
import { emptySummary } from "../../../skills/agent-usage/scripts/lib/session.mjs";
import {
  localParts,
  parseTime,
  splitByLocalHour,
} from "../../../skills/agent-usage/scripts/lib/time.mjs";
import { messageCosts, usageRows } from "../../../skills/agent-usage/scripts/lib/usage.mjs";

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
    const costs = messageCosts(s, ctx);
    expect(costs.map((c) => c.source)).toEqual(["log", "log", "bundled"]);
    expect(costs[0].cost).toBeCloseTo(2);
    expect(costs[1].cost).toBeCloseTo(6);
    expect(costs[2].cost).toBeCloseTo(1);
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
    });
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
  test("重なる区間をまとめ、隙間を取る", () => {
    const m = mergeSpans([
      [5, 7],
      [1, 3],
      [2, 4],
    ]);
    expect(m).toEqual([
      [1, 4],
      [5, 7],
    ]);
    expect(gaps(m, 0, 10)).toEqual([
      [0, 1],
      [4, 5],
      [7, 10],
    ]);
  });

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

  test("HTML: 人ごとの表に、人ごとの費用・指示の数・停止の内訳と、合計の行を出す", () => {
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
    const start = html.indexOf("<h2>人ごと</h2>");
    const section = html.slice(start, html.indexOf("</section>", start));
    expect(section).toContain("<td>p-00000002</td><td>花子</td><td>$2.50</td><td>0</td>");
    expect(section).toContain(
      "<td>p-00000001</td><td>p-00000001</td><td>$1.50</td><td>1</td><td>1.0</td><td>0.0</td><td>0.0</td><td>0.0</td><td>0.0</td><td>1.0</td>",
    );
    expect(section).toContain("<tfoot><tr><td>合計</td><td></td><td>$4.00</td><td>1</td>");
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
    expect(periodLabel(rows, { since: null, until: null, tz: "UTC" })).toBe(
      "2026-10-01 〜 2026-10-03",
    );
    expect(periodLabel(rows, { since: "2026-09-01", until: null, tz: "UTC" })).toBe(
      "2026-09-01 〜 2026-10-03",
    );
    expect(periodLabel([], { since: null, until: null, tz: "UTC" })).toBe("記録なし");
  });
});
