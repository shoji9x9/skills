// agent-usage の GitHub の取得（偽の gh で）と、artifact の zip の展開のテスト。
//
// 入力の軸:
//   timeline     ボットのレビュー（ツールの対応表・単価の有無）／自分のレビュー・コメント（エージェントの gh の直後は除く）／。
//                レビューの依頼と到着（同じツール）／@codex review のコメント／まだ届かない依頼（open）。
//   actions/runs 上限に達した期間（半分に分けて再取得する）／実行中（open）。
//   reflog       commit の操作／それ以外の操作（checkout など）／エージェントの git の直後／since より前。
//   artifact     Claude Code の Action の実行結果／Codex の Action のログ／単価の無いモデル。
//   zip          無圧縮・deflate／知らない圧縮方式。

import { crc32, deflateRawSync } from "node:zlib";
import { describe, expect, test } from "vitest";
import { parseRepoConfig } from "../../../skills/agent-usage/scripts/lib/config.mjs";
import {
  RUNS_QUERY_LIMIT,
  actionRuns,
  artifactRows,
  collectGitHub,
  commitActivityRows,
  fromGraphqlItem,
  normalizeLogin,
  timelineRows,
} from "../../../skills/agent-usage/scripts/lib/github.mjs";
import { unzip } from "../../../skills/agent-usage/scripts/lib/unzip.mjs";

const iso = (h: number, m = 0) =>
  `2026-10-01T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`;
const ms = (h: number, m = 0) => Date.parse(iso(h, m));

type Gh = (args: readonly string[], opts: { binary?: boolean }) => Buffer;

function options(
  gh: Gh,
  extra: Partial<Parameters<typeof collectGitHub>[0]> = {},
): Parameters<typeof collectGitHub>[0] {
  return {
    slug: "o/r",
    since: ms(0),
    now: ms(12),
    person: "p-00000001",
    tz: "UTC",
    config: parseRepoConfig({ reviewPricing: { copilot: 0.04 } }),
    bundledTools: {
      "copilot-pull-request-reviewer": "copilot",
      "chatgpt-codex-connector": "codex-cloud",
    },
    bundledPricing: { "gpt-5.5": { input: 5, output: 30 } },
    bundledReviewPricing: { "codex-cloud": 0.1 },
    commands: [],
    billing: "none",
    gh,
    ...extra,
  };
}

const noGh: Gh = () => {
  throw new Error("呼ばれない想定");
};

describe("timelineRows", () => {
  const pr = { number: 7, branch: "feature/5-x", author: "me" };

  test("ボットのレビューはツールの行にし、推定額をリポジトリの設定・同梱の順に探して付ける", () => {
    const rows = timelineRows(
      pr,
      [
        {
          type: "review",
          id: 1,
          login: "copilot-pull-request-reviewer[bot]",
          at: ms(2),
          state: "commented",
        },
        { type: "review", id: 2, login: "chatgpt-codex-connector", at: ms(3), state: "commented" },
      ],
      "me",
      options(noGh),
    );
    expect(rows.map((r) => [r.kind, r.agent, r.cost_usd, r.cost_source, r.issue])).toEqual([
      ["review", "copilot", "0.040000", "estimate-repo", "5"],
      ["review", "codex-cloud", "0.100000", "estimate-bundled", "5"],
    ]);
  });

  test("自分のレビューとコメントは活動にし、エージェントの gh の直後のものは除く", () => {
    const o = options(noGh, { commands: [{ ts: ms(4), text: "gh pr comment 7 --body-file x" }] });
    const rows = timelineRows(
      pr,
      [
        { type: "comment", id: 10, login: "Me", at: ms(2), body: "見ました" },
        { type: "comment", id: 11, login: "me", at: ms(4, 1), body: "agent" },
        { type: "review", id: 12, login: "me", at: ms(5), state: "approved" },
        { type: "comment", id: 13, login: "someone", at: ms(6), body: "x" },
      ],
      "me",
      o,
    );
    expect(rows.map((r) => r.key)).toEqual(["activity:gh-comment:10", "activity:gh-review:12"]);
  });

  test("レビューの依頼から同じツールのレビューの到着までを待ちにし、届いていなければ open にする", () => {
    const rows = timelineRows(
      pr,
      [
        { type: "request", login: "copilot-pull-request-reviewer", at: ms(1) },
        {
          type: "review",
          id: 1,
          login: "copilot-pull-request-reviewer",
          at: ms(2),
          state: "commented",
        },
        { type: "comment", id: 2, login: "me", at: ms(3), body: "@codex review" },
        { type: "request", login: "copilot-pull-request-reviewer", at: ms(4) },
      ],
      "me",
      options(noGh),
    );
    expect(
      rows.filter((r) => r.kind === "review-wait").map((r) => [r.agent, r.start, r.end, r.detail]),
    ).toEqual([
      ["copilot", new Date(ms(1)).toISOString(), new Date(ms(2)).toISOString(), "pr=7"],
      ["codex-cloud", new Date(ms(3)).toISOString(), new Date(ms(12)).toISOString(), "pr=7;open"],
      ["copilot", new Date(ms(4)).toISOString(), new Date(ms(12)).toISOString(), "pr=7;open"],
    ]);
  });

  test("レビューが届かないまま PR が閉じたら、閉じた時刻で待ちを終える（チームへの依頼）", () => {
    const rows = timelineRows(
      { ...pr, closedAt: ms(5) },
      [
        { type: "request", login: "core", at: ms(1) },
        { type: "request", login: "copilot-pull-request-reviewer", at: ms(6) },
      ],
      "me",
      options(noGh),
    );
    expect(
      rows.filter((r) => r.kind === "review-wait").map((r) => [r.agent, r.end, r.detail]),
    ).toEqual([
      ["core", new Date(ms(5)).toISOString(), "pr=7"],
      ["copilot", new Date(ms(12)).toISOString(), "pr=7;open"],
    ]);
  });

  test("GraphQL の項目をそろえる（チームへの依頼は name を使う）", () => {
    expect(
      fromGraphqlItem({
        __typename: "ReviewRequestedEvent",
        createdAt: iso(1),
        requestedReviewer: { __typename: "Team", name: "core" },
      }),
    ).toEqual([{ type: "request", login: "core", at: ms(1) }]);
    expect(
      fromGraphqlItem({
        __typename: "PullRequestReview",
        databaseId: 3,
        author: { login: "a" },
        submittedAt: null,
      }),
    ).toEqual([]);
  });

  test("login の [bot] と大文字を除いて比べる", () => {
    expect(normalizeLogin("Copilot-Pull-Request-Reviewer[bot]")).toBe(
      "copilot-pull-request-reviewer",
    );
  });
});

describe("actionRuns", () => {
  test("上限に達した期間は半分に分けて再取得し、実行中の run は今の時刻までの open にする", () => {
    const calls: string[] = [];
    const gh: Gh = (args) => {
      const path = args[args.length - 1];
      calls.push(path);
      const full = calls.length === 1;
      const runs = full
        ? Array.from({ length: RUNS_QUERY_LIMIT }, (_, i) => ({ id: i }))
        : [
            {
              id: calls.length,
              run_attempt: 1,
              head_branch: "feature/3-y",
              run_started_at: iso(1),
              updated_at: iso(2),
              status: calls.length === 2 ? "completed" : "in_progress",
              name: "CI",
              event: "push",
              conclusion: "success",
            },
          ];
      return Buffer.from(JSON.stringify([{ workflow_runs: runs }]));
    };
    const rows = actionRuns(options(gh), ms(0), ms(10));
    expect(calls).toHaveLength(3);
    expect(rows.map((r) => [r.end, r.detail])).toEqual([
      [new Date(ms(2)).toISOString(), "CI;push;success"],
      [new Date(ms(12)).toISOString(), "CI;push;open"],
    ]);
  });
});

describe("collectGitHub", () => {
  test("取得に失敗した段を failures に残し、他の段は続ける", () => {
    const gh: Gh = (args) => {
      if (args[0] === "user") return Buffer.from(JSON.stringify({ login: "me" }));
      if (args[0] === "graphql") throw new Error("HTTP 502");
      return Buffer.from(JSON.stringify([{ workflow_runs: [], artifacts: [] }]));
    };
    const res = collectGitHub(options(gh));
    expect(res.failures).toEqual(["pulls: HTTP 502"]);
  });

  test("人の設定で billing が user のときだけ、課金 API の日別の実額を billing の行にする", () => {
    const calls: string[] = [];
    const gh: Gh = (args) => {
      const path = args.find((a) => a.includes("/")) ?? args[0];
      calls.push(path);
      if (args[0] === "user") return Buffer.from(JSON.stringify({ login: "me" }));
      if (path.includes("settings/billing/premium_request/usage")) {
        return Buffer.from(
          JSON.stringify({
            usageItems: [
              {
                product: "Copilot",
                model: "gpt-x",
                sku: "premium",
                netQuantity: 13,
                netAmount: 0.52,
              },
            ],
          }),
        );
      }
      if (args[0] === "graphql") throw new Error("HTTP 502");
      return Buffer.from(JSON.stringify([{ workflow_runs: [], artifacts: [] }]));
    };
    const res = collectGitHub(options(gh, { billing: "user" }));
    const billing = res.rows.filter((r) => r.kind === "billing");
    expect(billing).toHaveLength(1);
    expect(billing[0]).toMatchObject({
      key: "billing:2026-10-01:Copilot:gpt-x:premium",
      cost_usd: "0.520000",
      cost_source: "billing",
      detail: "sku=premium;quantity=13",
    });
    expect(calls.some((c) => c.includes("users/me/settings/billing/premium_request/usage"))).toBe(
      true,
    );
    expect(res.failures.some((f) => f.startsWith("billing"))).toBe(false);
    // デフォルト（none）では課金 API を呼ばない
    calls.length = 0;
    const none = collectGitHub(options(gh));
    expect(none.rows.some((r) => r.kind === "billing")).toBe(false);
    expect(calls.some((c) => c.includes("billing"))).toBe(false);
  });

  test("ツールごとの名前の artifact を、名前ごとに取得する", () => {
    const calls: string[] = [];
    const gh: Gh = (args) => {
      calls.push(args.join(" "));
      if (args[0] === "user") return Buffer.from(JSON.stringify({ login: "me" }));
      if (args[0] === "graphql") throw new Error("HTTP 502");
      return Buffer.from(JSON.stringify([{ workflow_runs: [], artifacts: [] }]));
    };
    collectGitHub(options(gh));
    for (const name of ["agent-usage-review-claude", "agent-usage-review-codex"])
      expect(calls.some((c) => c.includes(`artifacts?name=${name}&`))).toBe(true);
  });
});

describe("commitActivityRows", () => {
  const rec = (sha: string, at: string, subject: string) =>
    `${sha}\x00HEAD@{${at}}\x00${subject}\x1e`;

  test("reflog の commit の操作だけを数え、エージェントの git の直後と since より前は除く", () => {
    const reflog = [
      rec("a", "2026-10-01T10:00:00+09:00", "commit: 人の commit"),
      rec("a", "2026-10-01T10:00:00+09:00", "commit: 同じ commit（別の ref の reflog）"),
      rec("b", "2026-10-01T11:00:00+09:00", "checkout: moving from main to x"),
      rec("c", "2026-10-01T12:00:30+09:00", "commit (merge): Merge"),
      rec("d", "2026-09-30T00:00:00+09:00", "commit: 古い"),
    ].join("\n");
    const rows = commitActivityRows(
      reflog,
      [{ ts: Date.parse("2026-10-01T03:00:00Z"), text: "git merge origin/main" }],
      { person: "p", tz: "UTC", since: ms(0) },
    );
    expect(rows.map((r) => r.key)).toEqual(["activity:commit:a"]);
    expect(rows[0].start).toBe("2026-10-01T01:00:00.000Z");
  });
});

/** 無圧縮と deflate の項目を持つ zip を作る（テスト用の最小の書き手）。 */
function makeZip(entries: { name: string; data: Buffer; method: 0 | 8 | 99 }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const body = e.method === 8 ? deflateRawSync(e.data) : e.data;
    const name = Buffer.from(e.name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(e.method, 8);
    local.writeUInt32LE(crc32(e.data), 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(e.method, 10);
    central.writeUInt32LE(crc32(e.data), 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

describe("unzip と artifactRows", () => {
  test("無圧縮と deflate を取り出し、知らない圧縮方式はエラーにする", () => {
    const files = unzip(
      makeZip([
        { name: "a.txt", data: Buffer.from("あ"), method: 0 },
        { name: "dir/b.txt", data: Buffer.from("b".repeat(100)), method: 8 },
      ]),
    );
    expect(files.get("a.txt")?.toString()).toBe("あ");
    expect(files.get("dir/b.txt")?.toString()).toBe("b".repeat(100));
    expect(() => unzip(makeZip([{ name: "c", data: Buffer.from("c"), method: 99 }]))).toThrow(
      /圧縮方式/,
    );
    expect(() => unzip(Buffer.from("not a zip"))).toThrow(/終わりの記録/);
  });

  test("Claude Code の Action の結果はモデルごとの費用、Codex の Action のログは単価で数える", () => {
    const exec = [
      { type: "system" },
      {
        type: "result",
        total_cost_usd: 1.5,
        modelUsage: { "claude-opus-5-5[1m]": { inputTokens: 10, outputTokens: 20, costUSD: 1.5 } },
      },
    ];
    const codex = [
      { type: "session_meta", timestamp: iso(1), payload: { id: "c", source: "exec" } },
      { type: "turn_context", timestamp: iso(1), payload: { turn_id: "t", model: "gpt-5.5" } },
      {
        type: "token_usage_record",
        timestamp: iso(1),
        payload: { response_id: "r", turn_id: "t", usage: { input_tokens: 1e6, output_tokens: 0 } },
      },
      { type: "turn_context", timestamp: iso(1), payload: { turn_id: "u", model: "mystery" } },
      {
        type: "token_usage_record",
        timestamp: iso(1),
        payload: { response_id: "s", turn_id: "u", usage: { input_tokens: 1, output_tokens: 0 } },
      },
    ];
    const files = new Map<string, Buffer>([
      ["meta.json", Buffer.from(JSON.stringify({ tool: "claude-code-action", pr: 7 }))],
      ["claude-execution-output.json", Buffer.from(JSON.stringify(exec))],
      ["codex/rollout.jsonl", Buffer.from(codex.map((x) => JSON.stringify(x)).join("\n"))],
    ]);
    const rows = artifactRows(
      files,
      { id: 9, created: ms(1), branch: "feature/7-z", runId: 3 },
      options(noGh),
    );
    expect(rows.map((r) => [r.model, r.cost_usd, r.cost_source, r.detail])).toEqual([
      ["claude-opus-5-5", "1.500000", "log", "pr=7;source=artifact;run=3"],
      ["gpt-5.5", "5.000000", "bundled", "pr=7;source=artifact;run=3"],
      ["mystery", "", "unknown", "pr=7;source=artifact;run=3"],
    ]);
  });
});
