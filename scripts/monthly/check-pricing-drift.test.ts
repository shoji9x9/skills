// check-pricing-drift.ts（同梱の単価表と公式の料金ページの差）のテスト。
//
// | 軸 | 値 |
// | --- | --- |
// | 見出し | 1 件 / 無い / 2 件 / 次の見出しで止まる（同じ階層・上の階層・下の階層は止まらない） |
// | 表 | 期待した列 / 列が違う / 区切りの行が無い / 0 件 / 複数（OpenAI） |
// | モデル名 | 素の名前 / 括弧の注記（リンク・コンテキストの長さ）/ 長いコンテキストの行 / 形が違う / 重複 |
// | 単価 | 数 / `<sup>` の注記 / `-`（OpenAI）/ 形が違う |
// | 取得 | 成功 / 失敗 / モデルが 0 件 |
// | 比較 | 単価表に無い / 料金ページに無い（全ページを読めたときだけ）/ 単価が違う（違う・片方に無い）/ 同じ |
// | 記録 | 無い / unknown の usage / unknown 以外 / usage 以外 / 打ち消した行 / 同じ key の新しい行 / 単価表にあるモデル / モデル名なし |
// | 前回の本文 | 無い / 識別子あり（継続・解消） / 報告済みのモデルあり（open・クローズ済みの Issue） |
// | 報告済み | 単価表に無い・記録の費用が空（挙げない・解消に入れない）/ 単価が違う・料金ページに無い・読めなかった（毎回挙げる） |
// | CLI の引数 | 正しい / 足りない |
// | 単価表 | 正しい / models が無い / 値が数でない / 期間の配列（今の期間・まだ始まっていない・同じ since） |
import { describe, expect, test } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  PAGES,
  anthropicModelId,
  compare,
  formatBody,
  formatComment,
  main,
  openaiModelId,
  parseAnthropic,
  parseOpenai,
  parseTable,
  previousKeys,
  previousSeen,
  priceDiff,
  readPage,
  section,
  selectReport,
  tables,
  unknownCostModels,
  type Fetcher,
  type Finding,
  type PageResult,
  type Prices,
  type Report,
} from "./check-pricing-drift.ts";
import { makeTempDir } from "../lib/testing/test-tmpdir.ts";

const ANTHROPIC_MD = `# Pricing

## Model pricing

| Model | Base input tokens | 5m cache writes | 1h cache writes | Cache hits and refreshes | Output tokens |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Claude Fable 5.2 | $8 / MTok | $10 / MTok | $16 / MTok | $0.20 / MTok<sup>1</sup> | $40 / MTok |
| Claude Opus 4.1 ([retired](https://example.com/x)) | $15 / MTok | $18.75 / MTok | $30 / MTok | $1.50 / MTok | $75 / MTok |
| Claude Haiku 5.5 (for prompts up to 100,000 tokens) | $0.10 / MTok | $0.125 / MTok | $0.20 / MTok | $0.01 / MTok | $0.50 / MTok |
| Claude Haiku 5.5 (for prompts over 100,000 tokens) | $0.50 / MTok | $0.625 / MTok | $1 / MTok | $0.05 / MTok | $2.50 / MTok |

### Notes

| Note | Value |
| --- | --- |
| Sub note | 1 |

## Cloud platform pricing

| Model | Base input tokens | 5m cache writes | 1h cache writes | Cache hits and refreshes | Output tokens |
| --- | --- | --- | --- | --- | --- |
| Claude Other 1 | $1 / MTok | $1 / MTok | $1 / MTok | $1 / MTok | $1 / MTok |
`;

const OPENAI_MD = `# Pricing

### Standard pricing data

| Model | Short context input | Short context output | Short context cached input | Short context 30m write | Short context 12h write | Long context input | Long context output | Long context cached input | Long context 30m write | Long context 12h write |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gpt-6-sol | $2.00 | $10.00 | $0.20 | $2.50 | $5.00 | $4.00 | $15.00 | $0.40 | $5.00 | $10.00 |
| gpt-5.5-pro (<272K context length) | $30.00 | $180.00 | - | - | - | $60.00 | $270.00 | - | - | - |

| Model | Input | Output | Cached input |
| --- | --- | --- | --- |
| gpt-4o | $2.50 | $10.00 | $1.25 |

### Batch pricing data

| Model | Input | Output | Cached input |
| --- | --- | --- | --- |
| gpt-batch | $1.00 | $1.00 | $1.00 |
`;

const pageFetcher =
  (bodies: Record<string, string | Error>): Fetcher =>
  async (url) => {
    const body = bodies[url];
    if (body === undefined) throw new Error(`想定しない URL: ${url}`);
    if (body instanceof Error) throw body;
    return body;
  };

const [ANTHROPIC, OPENAI] = PAGES;
const okFetcher = pageFetcher({ [ANTHROPIC.url]: ANTHROPIC_MD, [OPENAI.url]: OPENAI_MD });

describe("section と tables", () => {
  test("見出しの下から、同じか上の階層の次の見出しの手前までを返す（下の階層では止まらない）", () => {
    const lines = section(ANTHROPIC_MD, "Model pricing", 2);
    expect(lines.some((l) => l.includes("Sub note"))).toBe(true);
    expect(lines.some((l) => l.includes("Claude Other 1"))).toBe(false);
  });

  test("上の階層の見出しでも止まる", () => {
    const lines = section("### A\nx\n# B\ny\n", "A", 3);
    expect(lines).toEqual(["x"]);
  });

  test.each([
    ["無い", "# Pricing\n"],
    ["2 件", "## Model pricing\n\n## Model pricing\n"],
  ])("見出しが%sときは例外にする", (_, md) => {
    expect(() => section(md, "Model pricing", 2)).toThrow(/見出し「## Model pricing」が/u);
  });

  test("区切りの行が無い塊は表として扱わない", () => {
    expect(tables(["| a | b |", "| 1 | 2 |"])).toEqual([]);
    expect(tables(["| a | b |", "| --- | :-: |", "| 1 | 2 |"])).toEqual([
      { header: ["a", "b"], rows: [["1", "2"]] },
    ]);
  });
});

describe("parseAnthropic", () => {
  test("Model pricing の表を、ログのモデル名と単価にする", () => {
    const prices = parseAnthropic(ANTHROPIC_MD);
    expect([...prices.keys()]).toEqual(["claude-fable-5-2", "claude-opus-4-1", "claude-haiku-5-5"]);
    expect(prices.get("claude-fable-5-2")).toEqual({
      input: 8,
      cacheWrite5m: 10,
      cacheWrite1h: 16,
      cacheRead: 0.2,
      output: 40,
    });
    // 長いコンテキストの行は読まず、100,000 トークン以下の行の単価を採る。
    expect(prices.get("claude-haiku-5-5")?.input).toBe(0.1);
  });

  test("列が違う表しか無ければ例外にする", () => {
    const md = ANTHROPIC_MD.replaceAll("Base input tokens", "Input");
    expect(() => parseAnthropic(md)).toThrow(/表が 0 件ある/u);
  });

  test.each([
    ["単価の形が違う", "$8 / MTok", "8 USD"],
    ["モデル名の形が違う", "Claude Fable 5.2", "Fable"],
  ])("%sときは例外にする", (_, from, to) => {
    expect(() => parseAnthropic(ANTHROPIC_MD.replace(from, to))).toThrow(/読めない|形でない/u);
  });

  test("同じモデルの行が 2 つあれば例外にする", () => {
    const md = ANTHROPIC_MD.replace("Claude Opus 4.1", "Claude Fable 5.2");
    expect(() => parseAnthropic(md)).toThrow(/claude-fable-5-2 の行が 2 つある/u);
  });

  test.each([
    ["Claude Opus 5.5", "claude-opus-5-5"],
    ["Claude Fable 5", "claude-fable-5"],
    ["Claude Mythos 5.2 ([limited availability](https://example.com))", "claude-mythos-5-2"],
    ["Claude Sonnet 5<sup>3</sup>", "claude-sonnet-5"],
    ["Claude Haiku 5.5 (for prompts over 100,000 tokens)", null],
  ])("anthropicModelId(%j) は %j", (cell, id) => {
    expect(anthropicModelId(cell)).toBe(id);
  });
});

describe("parseOpenai", () => {
  test("Standard pricing data の表をすべて読み、短いコンテキストの単価とキャッシュ済みの入力を採る", () => {
    const prices = parseOpenai(OPENAI_MD);
    expect([...prices.keys()]).toEqual(["gpt-6-sol", "gpt-5.5-pro", "gpt-4o"]);
    expect(prices.get("gpt-6-sol")).toEqual({ input: 2, output: 10, cacheRead: 0.2 });
    // `-` は単価が無いとして扱う。
    expect(prices.get("gpt-5.5-pro")).toEqual({ input: 30, output: 180 });
  });

  test("知らない列の表があれば例外にする", () => {
    const md = OPENAI_MD.replace(
      "| Model | Input | Output | Cached input |",
      "| Model | Input | Output | Cache |",
    );
    expect(() => parseOpenai(md)).toThrow(/知らない形/u);
  });

  test("表が無ければ例外にする", () => {
    expect(() => parseOpenai("### Standard pricing data\n\ntext\n")).toThrow(/表が無い/u);
  });

  test.each([
    ["単価の形が違う", "| gpt-4o | $2.50 |", "| gpt-4o | 2.50 |"],
    ["モデル名の形が違う", "| gpt-4o |", "| GPT 4o |"],
    ["モデルが重複する", "| gpt-4o |", "| gpt-6-sol |"],
  ])("%sときは例外にする", (_, from, to) => {
    expect(() => parseOpenai(OPENAI_MD.replace(from, to))).toThrow(/読めない|形でない|2 つある/u);
  });

  test("括弧の注記を外す", () => {
    expect(openaiModelId("gpt-5.4 (<272K context length)")).toBe("gpt-5.4");
  });
});

describe("readPage", () => {
  test("読めたら単価を返す", async () => {
    const result = await readPage(ANTHROPIC, okFetcher);
    expect(result.ok).toBe(true);
  });

  test.each([
    ["取得に失敗した", new Error("HTTP 503"), /HTTP 503/u],
    ["見出しが変わった", "# Pricing\n## Prices\n", /見出し/u],
    [
      "モデルの行が 0 件",
      "### Standard pricing data\n\n| Model | Input | Output | Cached input |\n| --- | --- | --- | --- |\n",
      /0 件/u,
    ],
  ])("%sときは、例外にせず読めなかった結果を返す", async (_, body, reason) => {
    const result = await readPage(OPENAI, pageFetcher({ [OPENAI.url]: body }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(reason);
  });
});

describe("parseTable", () => {
  test("models の単価を読む", () => {
    const prices = parseTable(JSON.stringify({ models: { m: { input: 1, output: 2 } } }), 0);
    expect(prices.get("m")).toEqual({ input: 1, output: 2 });
  });

  test("期間の配列は、時刻に有効な期間の単価にし、まだ始まっていないモデルは最初の期間と比べる", () => {
    const text = JSON.stringify({
      models: {
        changed: [
          { input: 1, output: 1 },
          { since: "2026-12-01", input: 2, output: 2 },
        ],
        later: [{ since: "2027-01-01", input: 3, output: 3 }],
      },
    });
    const dec = Date.parse("2026-12-01T00:00:00Z");
    expect(parseTable(text, dec - 1).get("changed")).toEqual({ input: 1, output: 1 });
    expect(parseTable(text, dec).get("changed")).toEqual({ input: 2, output: 2 });
    expect(parseTable(text, dec).get("later")).toEqual({ input: 3, output: 3 });
  });

  test.each([
    ["models が無い", {}],
    ["値が数でない", { models: { m: { input: "1" } } }],
    ["モデルがオブジェクトでない", { models: { m: 1 } }],
    [
      "同じ since が 2 つある",
      {
        models: {
          m: [
            { since: "2026-12-01", input: 1, output: 1 },
            { since: "2026-12-01", input: 2, output: 2 },
          ],
        },
      },
    ],
  ])("%sときは例外にする", (_, value) => {
    expect(() => parseTable(JSON.stringify(value), 0)).toThrow();
  });
});

const ok = (spec: PageResult["spec"], prices: Prices): PageResult => ({ spec, ok: true, prices });

describe("compare", () => {
  const table: Prices = new Map([
    ["claude-a", { input: 1, cacheWrite5m: 1, cacheWrite1h: 1, cacheRead: 1, output: 1 }],
    ["gpt-b", { input: 2, cacheRead: 0.2, output: 10 }],
    ["gpt-old", { input: 1, output: 1 }],
  ]);
  const anthropic = new Map([
    ["claude-a", { input: 1, cacheWrite5m: 1, cacheWrite1h: 1, cacheRead: 1, output: 1 }],
    ["claude-new", { input: 1 }],
  ]);
  const openai = new Map([["gpt-b", { input: 2, output: 12 }]]);

  test("単価表に無い・単価が違う・料金ページに無い・記録の費用が空を挙げる", () => {
    const findings = compare(
      table,
      [ok(ANTHROPIC, anthropic), ok(OPENAI, openai)],
      new Map([
        ["codex-auto-review", 3],
        ["claude-a", 5],
      ]),
    );
    expect(findings).toEqual([
      { kind: "missing-in-table", target: "claude-new", detail: "Anthropic の料金ページにある" },
      {
        kind: "price-mismatch",
        target: "gpt-b",
        detail: "cacheRead: $0.2 → なし、output: $10 → $12",
      },
      { kind: "missing-on-page", target: "gpt-old", detail: "どの料金ページにも無い" },
      // claude-a は単価表にあるので、記録の費用が空でも挙げない。
      { kind: "unknown-cost", target: "codex-auto-review", detail: "費用が空の行が 3 行" },
    ]);
  });

  test("どれかの料金ページを読めなければ、読めなかったことを挙げ、料金ページに無いモデルは挙げない", () => {
    const findings = compare(
      table,
      [ok(ANTHROPIC, anthropic), { spec: OPENAI, ok: false, reason: "HTTP 503" }],
      new Map(),
    );
    expect(findings.map((f) => `${f.kind} ${f.target}`)).toEqual([
      "missing-in-table claude-new",
      "unreadable OpenAI",
    ]);
  });

  test("差が無ければ 0 件", () => {
    const same: Prices = new Map([["claude-a", { input: 1 }]]);
    expect(
      compare(same, [ok(ANTHROPIC, new Map([["claude-a", { input: 1 }]]))], new Map()),
    ).toEqual([]);
  });

  test("ページが持たない項目は比べない", () => {
    expect(
      priceDiff({ input: 1, cacheWrite5m: 9 }, { input: 1 }, ["input", "cacheRead", "output"]),
    ).toEqual([]);
  });
});

describe("unknownCostModels", () => {
  const header =
    "key,kind,observed_at,person,agent,session,subagent,model,start,end,tz,branch,issue,input_tokens,cache_read_tokens,cache_write_tokens,output_tokens,reasoning_tokens,messages,cost_usd,cost_source,wait_ms,detail,retracted";
  // 引数は key・kind・observed_at・model・cost_source・retracted の順に並べる。記録の 1 行を返す。
  const row = ([key, kind, at, model, source, retracted = ""]: readonly string[]): string =>
    `${key},${kind},${at},p,codex,,,${model},,,,,,,,,,,,,${source},,,${retracted}`;

  test("最新の行のうち、費用が空の usage を、打ち消した行を除いてモデルごとに数える", () => {
    const dir = makeTempDir("pricing-drift-records-");
    mkdirSync(join(dir, "p", "branches"), { recursive: true });
    writeFileSync(
      join(dir, "p", "branches", "20261101T000000Z-x.csv"),
      [
        header,
        row(["u1", "usage", "2026-11-01T00:00:00Z", "codex-auto-review", "unknown"]),
        row(["u2", "usage", "2026-11-01T00:00:00Z", "codex-auto-review[1m]", "unknown"]),
        row(["u3", "usage", "2026-11-01T00:00:00Z", "gpt-6-sol", "bundled"]),
        row(["u4", "review", "2026-11-01T00:00:00Z", "", "unknown"]),
        row(["u5", "usage", "2026-11-01T00:00:00Z", "gone", "unknown"]),
        row(["u5", "usage", "2026-11-02T00:00:00Z", "gone", "unknown", "1"]),
        row(["u6", "usage", "2026-11-01T00:00:00Z", "later-priced", "unknown"]),
        row(["u6", "usage", "2026-11-02T00:00:00Z", "later-priced", "repo"]),
        row(["u7", "usage", "2026-11-01T00:00:00Z", "", "unknown"]),
        "",
      ].join("\n"),
    );
    expect(unknownCostModels(dir)).toEqual(
      new Map([
        ["codex-auto-review", 2],
        ["（モデル名なし）", 1],
      ]),
    );
  });

  test("記録のディレクトリが無ければ 0 件", () => {
    expect(unknownCostModels(join(makeTempDir("pricing-drift-none-"), "missing"))).toEqual(
      new Map(),
    );
  });
});

describe("selectReport", () => {
  const all: Finding[] = [
    { kind: "missing-in-table", target: "old", detail: "Anthropic の料金ページにある" },
    { kind: "missing-in-table", target: "new", detail: "Anthropic の料金ページにある" },
    { kind: "unknown-cost", target: "codex-auto-review", detail: "費用が空の行が 3 行" },
    { kind: "price-mismatch", target: "p", detail: "input: $1 → $2" },
    { kind: "missing-on-page", target: "m", detail: "どの料金ページにも無い" },
    { kind: "unreadable", target: "OpenAI", detail: "HTTP 503" },
  ];
  const seenBefore = [
    "missing-in-table old",
    "unknown-cost codex-auto-review",
    "price-mismatch p",
    "missing-on-page m",
    "unreadable OpenAI",
    "missing-in-table retired",
  ];

  test("報告済みの「単価表に無い」と「記録の費用が空」だけを除き、ほかの種類は報告済みでも挙げる", () => {
    const report = selectReport(all, seenBefore);
    expect(report.findings.map((f) => `${f.kind} ${f.target}`)).toEqual([
      "missing-in-table new",
      "price-mismatch p",
      "missing-on-page m",
      "unreadable OpenAI",
    ]);
    expect(report.acknowledged).toEqual(["missing-in-table old", "unknown-cost codex-auto-review"]);
  });

  test("次の実行に渡す一覧は、前回の一覧に今回の新しいモデルを足したもの（今回の結果に無いものも残す）", () => {
    expect(selectReport(all, ["missing-in-table retired"]).seen).toEqual([
      "missing-in-table new",
      "missing-in-table old",
      "missing-in-table retired",
      "unknown-cost codex-auto-review",
    ]);
  });
});

describe("本文とコメント", () => {
  const pages: PageResult[] = [
    ok(ANTHROPIC, new Map([["a", {}]])),
    ok(OPENAI, new Map([["b", {}]])),
  ];
  const fresh = (findings: readonly Finding[]): Report => selectReport(findings, []);

  test("前回の識別子と比べて新規・継続を書き、解消したものを挙げ、目印を読み直せる", () => {
    const findings = fresh(compare(new Map(), pages, new Map()));
    const previous = ["missing-in-table a", "unknown-cost gone"];
    const body = formatBody(findings, pages, previous);
    expect(body).toContain("| 単価表に無い | a | Anthropic の料金ページにある | 継続 |");
    expect(body).toContain("| 単価表に無い | b | OpenAI の料金ページにある | 新規 |");
    expect(body).toContain("前回から解消したもの: unknown-cost gone");
    expect(previousKeys(body)).toEqual(["missing-in-table a", "missing-in-table b"]);
    expect(previousSeen(body)).toEqual(["missing-in-table a", "missing-in-table b"]);
    expect(formatComment(findings, previous)).toContain("新規 1 件・継続 1 件・前回から解消 1 件");
  });

  test("報告済みで挙げなくなったモデルは、解消に入れず、挙げなかった件数に数える", () => {
    const report = selectReport(compare(new Map(), pages, new Map()), ["missing-in-table a"]);
    const previous = ["missing-in-table a"];
    const body = formatBody(report, pages, previous);
    expect(body).not.toContain("前回から解消したもの");
    expect(body).toContain("挙げなかった「単価表に無い」「記録の費用が空」のモデル: 1 件");
    expect(formatComment(report, previous)).toContain("新規 1 件・継続 0 件・前回から解消 0 件");
  });

  test("料金ページを読めなかった実行では、ページと比べる種類を解消に入れない", () => {
    const failed: PageResult[] = [
      ok(ANTHROPIC, new Map([["a", {}]])),
      { spec: OPENAI, ok: false, reason: "HTTP 503" },
    ];
    const report = fresh(compare(new Map([["a", {}]]), failed, new Map()));
    const previous = [
      "missing-on-page old",
      "price-mismatch b",
      "missing-in-table c",
      "unknown-cost gone",
    ];
    const body = formatBody(report, failed, previous);
    expect(body).toContain("前回から解消したもの: unknown-cost gone");
    expect(body).not.toMatch(/解消したもの: .*(missing-on-page|price-mismatch|missing-in-table)/u);
    expect(formatComment(report, previous)).toContain("前回から解消 1 件");
  });

  test("読めなかったときと差が無いときを、本文の上で区別できる", () => {
    const failed: PageResult[] = [
      ok(ANTHROPIC, new Map([["a", {}]])),
      { spec: OPENAI, ok: false, reason: "HTTP 503" },
    ];
    const unreadable = formatBody(fresh(compare(new Map([["a", {}]]), failed, new Map())), failed);
    expect(unreadable).toContain("| 料金ページを読めなかった | OpenAI |");
    expect(unreadable).toContain(
      "料金ページを読めなかったので、「料金ページに無い」は挙げていません。",
    );
    const same = formatBody(
      fresh(
        compare(
          new Map([
            ["a", {}],
            ["b", {}],
          ]),
          pages,
          new Map(),
        ),
      ),
      pages,
    );
    expect(same).toContain("差と、記録で費用が空のモデル: 0 件");
    expect(same).not.toContain("読めなかった |");
  });
});

describe("main", () => {
  const setup = (): {
    dir: string;
    out: string;
    comment: string;
    pricing: string;
    records: string;
  } => {
    const dir = makeTempDir("pricing-drift-main-");
    const pricing = join(dir, "pricing.json");
    writeFileSync(
      pricing,
      JSON.stringify({ models: { "claude-fable-5-2": { input: 8, output: 40 } } }),
    );
    return {
      dir,
      out: join(dir, "body.md"),
      comment: join(dir, "comment.md"),
      pricing,
      records: join(dir, "records"),
    };
  };

  test("本文とコメントを書き、件数を due= で出す", async () => {
    const { out, comment, pricing, records } = setup();
    const logs: string[] = [];
    const log = console.log;
    console.log = (line: string) => logs.push(line);
    try {
      expect(
        await main(["--out", out, "--comment-out", comment], {
          fetcher: okFetcher,
          pricing,
          records,
        }),
      ).toBe(0);
    } finally {
      console.log = log;
    }
    expect(logs.at(-1)).toMatch(/^due=\d+$/u);
    expect(readFileSync(out, "utf8")).toContain("check-pricing-drift:keys");
    expect(readFileSync(comment, "utf8")).toContain("差と、記録で費用が空のモデル");
  });

  test("前回の本文で報告済みのモデルは挙げず、2 回目の実行は 0 件になる", async () => {
    const { dir, out, comment, pricing, records } = setup();
    const run = async (previous: string[]): Promise<string | undefined> => {
      const logs: string[] = [];
      const log = console.log;
      console.log = (line: string) => logs.push(line);
      try {
        await main(["--out", out, "--comment-out", comment, ...previous], {
          fetcher: okFetcher,
          pricing,
          records,
        });
      } finally {
        console.log = log;
      }
      return logs.at(-1);
    };
    // fixture の料金ページで単価表に無いモデルは、Opus 4.1・Haiku 5.5・gpt-6-sol・gpt-5.5-pro・gpt-4o の 5 つ。
    // 単価表の Fable 5.2 は単価が違う（キャッシュの単価が単価表に無い）ので、毎回挙げる。
    expect(await run([])).toBe("due=6");
    const first = join(dir, "first.md");
    writeFileSync(first, readFileSync(out, "utf8"));
    expect(await run(["--previous", first])).toBe("due=1");
    expect(readFileSync(out, "utf8")).toContain("price-mismatch claude-fable-5-2");
    expect(previousSeen(readFileSync(out, "utf8"))).toEqual(
      previousSeen(readFileSync(first, "utf8")),
    );
  });

  test("引数が足りなければ 2", async () => {
    expect(await main(["--out", "x"])).toBe(2);
  });

  test("単価表を読めなければ 1（料金ページを取得しない）", async () => {
    const { out, comment, dir } = setup();
    const fetcher: Fetcher = async () => {
      throw new Error("呼ばれない");
    };
    expect(
      await main(["--out", out, "--comment-out", comment], {
        fetcher,
        pricing: join(dir, "none.json"),
      }),
    ).toBe(1);
  });
});
