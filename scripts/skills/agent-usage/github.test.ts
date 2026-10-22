// agent-usage の GitHub の取得（偽の gh で）と、artifact の zip の展開のテスト。
//
// 入力の軸:
//   timeline     ボットのレビュー（ツールの対応表・単価の有無）／自分のレビュー・コメント（エージェントの gh の直後は除く）／。
//                レビューの依頼と到着（同じツール）／@codex review のコメント／まだ届かない依頼（open）。
//   actions/runs 上限に達した期間（半分に分けて再取得する）／実行中（open）。
//   reflog       commit の操作／それ以外の操作（checkout など）／エージェントの git の直後／since より前。
//   artifact     Claude Code の Action の実行結果／Codex の Action のログ／単価の無いモデル。
//   zip          無圧縮・deflate／知らない圧縮方式。

import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { parseRepoConfig } from "../../../skills/agent-usage/scripts/lib/config.mjs";
import {
  RUNS_QUERY_LIMIT,
  actionRuns,
  artifactRows,
  collectGitHub,
  commitActivityRows,
  makeGh,
  normalizeLogin,
  timelineRows,
  withoutEnvTokens,
} from "../../../skills/agent-usage/scripts/lib/sources/github.mjs";
import { unzip } from "../../../skills/agent-usage/scripts/lib/sources/unzip.mjs";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";
import {
  options,
  noGh,
  makeZip,
  fakeGh,
  prNode,
  waits,
  throwingUser,
  graphqlReturning,
  type Gh,
} from "./github-helpers.ts";
import { iso, ms } from "./utc-day-helpers.ts";

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

  test("gh を呼ばない計算に渡す偽の gh は、呼ばれると例外を投げる", () => {
    expect(() => noGh(["api", "x"], {})).toThrow("呼ばれない想定");
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

  // normalizeLogin の戻り値は、レビューツールの対応表に無いレビュアーの、review-wait の行の agent になる。
  test("login の [bot] と大文字を除いて比べ、REST の Copilot を GraphQL の login にそろえる", () => {
    expect(normalizeLogin("Copilot-Pull-Request-Reviewer[bot]")).toBe(
      "copilot-pull-request-reviewer",
    );
    expect(normalizeLogin("Copilot")).toBe("copilot-pull-request-reviewer");
    expect(normalizeLogin("copilot-x")).toBe("copilot-x");
  });

  test("レビューツールがコメントで結果を返したら、そこで待ちを終える（@codex review の指摘なし）", () => {
    const rows = timelineRows(
      pr,
      [
        { type: "comment", id: 1, login: "me", at: ms(1), body: "@codex review" },
        {
          type: "comment",
          id: 2,
          login: "chatgpt-codex-connector[bot]",
          at: ms(3),
          body: "No issues found.",
        },
      ],
      "me",
      options(noGh),
    );
    expect(
      rows.filter((r) => r.kind === "review-wait").map((r) => [r.agent, r.start, r.end, r.detail]),
    ).toEqual([
      ["codex-cloud", new Date(ms(1)).toISOString(), new Date(ms(3)).toISOString(), "pr=7"],
    ]);
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
    expect(res.failures).toEqual(["pulls: HTTP 502", "pulls (open): HTTP 502"]);
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
      key: "billing:p-00000001:2026-10-01:Copilot:gpt-x:premium",
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

  test("更新されていない open な PR と、since より前に始まって実行中の run も取得する", () => {
    const calls: string[] = [];
    const gh: Gh = (args) => {
      calls.push(args.join(" "));
      if (args[0] === "user") return Buffer.from(JSON.stringify({ login: "me" }));
      if (args[0] === "graphql") throw new Error("HTTP 502");
      const path = args.find((a) => a.includes("actions/runs")) ?? "";
      if (path.includes("status=in_progress")) {
        return Buffer.from(
          JSON.stringify([
            {
              workflow_runs: [
                {
                  id: 7,
                  run_attempt: 1,
                  status: "in_progress",
                  run_started_at: "2026-09-30T23:00:00Z",
                  head_branch: "feature/1-x",
                  name: "CI",
                  event: "pull_request",
                },
                {
                  id: 8,
                  run_attempt: 1,
                  status: "in_progress",
                  run_started_at: iso(1),
                  head_branch: "feature/1-x",
                  name: "CI",
                  event: "pull_request",
                },
              ],
            },
          ]),
        );
      }
      return Buffer.from(JSON.stringify([{ workflow_runs: [], artifacts: [] }]));
    };
    const res = collectGitHub(options(gh));
    expect(calls.some((c) => c.includes("is:pr is:open"))).toBe(true);
    const ci = res.rows.filter((r) => r.kind === "ci");
    // since（0 時）より前に始まった run だけを足す。後に始まった run は created で取る
    expect(ci.map((r) => r.key)).toEqual(["ci:7:1"]);
    expect(ci[0].end).toBe(new Date(ms(12)).toISOString());
  });

  test("記録済みの artifact はダウンロードしない", () => {
    const calls: string[] = [];
    const gh: Gh = (args) => {
      calls.push(args.join(" "));
      if (args[0] === "user") return Buffer.from(JSON.stringify({ login: "me" }));
      if (args[0] === "graphql") throw new Error("HTTP 502");
      if (args[0].includes("/zip")) throw new Error("ダウンロードしない想定");
      const artifacts = args.some((a) => a.includes("agent-usage-review-claude"))
        ? [{ id: 42, created_at: iso(1), expired: false, workflow_run: {} }]
        : [];
      return Buffer.from(JSON.stringify([{ workflow_runs: [], artifacts }]));
    };
    const res = collectGitHub(options(gh, { knownArtifacts: new Set([42]) }));
    expect(res.failures.some((f) => f.startsWith("artifacts"))).toBe(false);
    expect(calls.some((c) => c.includes("/zip"))).toBe(false);
  });

  test("artifact が 1 件読めなくても、残りの artifact は取得する", () => {
    const gh: Gh = (args) => {
      if (args[0] === "user") return Buffer.from(JSON.stringify({ login: "me" }));
      if (args[0] === "graphql") throw new Error("HTTP 502");
      if (args[0].endsWith("/41/zip")) return Buffer.from("not a zip");
      if (args[0].endsWith("/42/zip")) throw new Error("ダウンロードの失敗");
      const artifacts = args.some((a) => a.includes("agent-usage-review-claude"))
        ? [
            { id: 41, created_at: iso(1), expired: false, workflow_run: {} },
            { id: 42, created_at: iso(2), expired: false, workflow_run: {} },
          ]
        : [];
      return Buffer.from(JSON.stringify([{ workflow_runs: [], artifacts }]));
    };
    const res = collectGitHub(options(gh));
    const failed = res.failures.filter((f) => f.startsWith("artifacts"));
    expect(failed.map((f) => f.split(":")[0])).toEqual(["artifacts#41", "artifacts#42"]);
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

describe("外部の CI", () => {
  // PR 7 だけを見つける search の 1 ページ。open の PR の検索には、空の結果を返す
  const searchPages = (args: readonly string[]) => [
    {
      data: {
        search: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: args.some((a) => a.includes("is:open"))
            ? []
            : [
                {
                  number: 7,
                  headRefName: "feature/7-x",
                  author: { login: "me" },
                  headRefOid: "abc",
                  timelineItems: { nodes: [], pageInfo: { hasNextPage: false } },
                },
              ],
        },
      },
    },
  ];
  // レビューツールの check run と、外部の CI の check run
  const EXTERNAL_CHECK_RUNS = [
    {
      check_runs: [
        {
          id: 1,
          name: "copilot-pull-request-reviewer",
          app: { slug: "copilot-pull-request-reviewer" },
          started_at: iso(1),
          completed_at: iso(2),
        },
        {
          id: 2,
          name: "build",
          app: { slug: "circleci-checks" },
          started_at: iso(1),
          completed_at: iso(3),
        },
      ],
    },
  ];

  test("ci.external では、レビューツールの check run を CI に入れない", () => {
    const gh: Gh = (args) => {
      if (args[0] === "user") return Buffer.from(JSON.stringify({ login: "me" }));
      if (args[0] === "graphql") {
        const pages = searchPages(args);
        return Buffer.from(JSON.stringify(pages));
      }
      if (args.some((a) => a.includes("/statuses"))) return Buffer.from(JSON.stringify([[]]));
      if (args.some((a) => a.includes("/check-runs"))) {
        return Buffer.from(JSON.stringify(EXTERNAL_CHECK_RUNS));
      }
      return Buffer.from(JSON.stringify([{ workflow_runs: [], artifacts: [] }]));
    };
    const res = collectGitHub(options(gh, { config: parseRepoConfig({ ci: { external: true } }) }));
    expect(res.failures).toEqual([]);
    expect(res.rows.filter((r) => r.kind === "ci").map((r) => r.key)).toEqual(["ci-ext:2"]);
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

describe("collectGitHub の timeline", () => {
  test("GraphQL の項目をそろえる（チームへの依頼は name を使い、時刻や依頼先の無い項目は数えない）", () => {
    const res = collectGitHub(
      options(
        fakeGh([
          prNode([
            {
              __typename: "ReviewRequestedEvent",
              createdAt: iso(1),
              requestedReviewer: { __typename: "Team", name: "core" },
            },
            { __typename: "ReviewRequestedEvent", createdAt: iso(1), requestedReviewer: null },
            {
              __typename: "PullRequestReview",
              databaseId: 3,
              author: { login: "core" },
              submittedAt: null,
            },
            { __typename: "IssueComment", databaseId: 4, author: { login: "me" }, createdAt: null },
            {
              __typename: "IssueComment",
              databaseId: 5,
              author: { login: "me" },
              createdAt: iso(2),
            },
            { __typename: "LabeledEvent", createdAt: iso(2) },
            "not a record",
          ]),
          // number の無い項目と、2 つの問い合わせの両方に出る PR は数えない
          { headRefName: "x" },
        ]),
      ),
    );
    expect(res.failures).toEqual([]);
    expect(waits(res.rows)).toEqual([
      ["core", new Date(ms(1)).toISOString(), new Date(ms(12)).toISOString(), "pr=7;open"],
    ]);
    expect(res.rows.filter((r) => r.kind === "activity").map((r) => r.key)).toEqual([
      "activity:gh-comment:5",
    ]);
  });

  test("100 件を超える timeline は REST で取り、REST の Copilot と [bot]・大文字の付いた login を同じレビュアーとして扱う", () => {
    const rest = [
      {
        event: "review_requested",
        created_at: iso(1),
        requested_reviewer: { login: "Copilot-Pull-Request-Reviewer[bot]" },
      },
      {
        event: "reviewed",
        id: 5,
        submitted_at: iso(2),
        user: { login: "Copilot" },
        state: "COMMENTED",
      },
      { event: "review_requested", created_at: iso(3), requested_team: { name: "core" } },
      { event: "review_requested", created_at: iso(3) },
      { event: "reviewed", id: 6, submitted_at: null, user: { login: "core" } },
      { event: "commented", id: 8, created_at: iso(4), user: { login: "me" }, body: "見ました" },
      { event: "commented", id: 9, created_at: "読めない時刻", user: { login: "me" } },
      { event: "labeled", created_at: iso(4) },
      "not a record",
    ];
    const res = collectGitHub(
      options(
        fakeGh(
          [prNode([], { timelineItems: { pageInfo: { hasNextPage: true }, nodes: [] } })],
          [["issues/7/timeline", [rest]]],
        ),
      ),
    );
    expect(res.failures).toEqual([]);
    expect(
      res.rows
        .filter((r) => r.kind === "review")
        .map((r) => [r.key, r.agent, r.cost_usd, r.detail]),
    ).toEqual([["review:5", "copilot", "0.040000", "pr=7;author=me;state=commented"]]);
    expect(waits(res.rows)).toEqual([
      ["copilot", new Date(ms(1)).toISOString(), new Date(ms(2)).toISOString(), "pr=7"],
      ["core", new Date(ms(3)).toISOString(), new Date(ms(12)).toISOString(), "pr=7;open"],
    ]);
    expect(res.rows.filter((r) => r.kind === "activity").map((r) => r.key)).toEqual([
      "activity:gh-comment:8",
    ]);
  });

  test("since より前のレビューは行にしないが待ちの終わりには使い、since より前に終わった待ちは行にしない。単価の無いツールは費用を空にする", () => {
    const before = (h: number) => `2026-09-30T${h}:00:00Z`;
    const res = collectGitHub(
      options(
        fakeGh([
          prNode([
            {
              __typename: "ReviewRequestedEvent",
              createdAt: before(21),
              requestedReviewer: { login: "copilot-pull-request-reviewer" },
            },
            {
              __typename: "PullRequestReview",
              databaseId: 1,
              author: { login: "copilot-pull-request-reviewer" },
              submittedAt: before(22),
              state: "COMMENTED",
            },
            {
              __typename: "PullRequestReview",
              databaseId: 2,
              author: { login: "unpriced-bot" },
              submittedAt: iso(2),
              state: "APPROVED",
            },
          ]),
        ]),
        { config: parseRepoConfig({ reviewTools: { "unpriced-bot": "unpriced" } }) },
      ),
    );
    expect(waits(res.rows)).toEqual([]);
    expect(
      res.rows.filter((r) => r.kind === "review").map((r) => [r.key, r.cost_usd, r.cost_source]),
    ).toEqual([["review:2", "", "unknown"]]);
  });
});

describe("collectGitHub の失敗と読めない応答", () => {
  test.each([
    ["login の無い user", fakeGh([], [], {}), "user: login を取得できない"],
    ["Error でない例外", throwingUser, "user: 文字列の例外"],
    [
      "ページの配列でない GraphQL",
      graphqlReturning("{}"),
      "pulls: GraphQL の応答がページの配列でない",
    ],
    [
      "search の無い GraphQL",
      graphqlReturning("[{}]"),
      "pulls: GraphQL の応答に search.nodes が無い",
    ],
    [
      "ページの配列でない REST",
      fakeGh([], [["actions/runs?created", {}]]),
      /^actions\/runs: repos\/o\/r\/actions\/runs\?created=\S+: ページの配列でない$/,
    ],
    [
      "項目の配列が無い REST",
      fakeGh([], [["actions/runs?created", [{}]]]),
      /^actions\/runs: repos\/o\/r\/actions\/runs\?created=\S+: 項目の配列が無い$/,
    ],
  ])("%s は、その段を failures に残す", (_name, gh, failure) => {
    const res = collectGitHub(options(gh, { billing: "user" }));
    expect(
      res.failures.some((f) => (typeof failure === "string" ? f === failure : failure.test(f))),
    ).toBe(true);
  });

  test("login を取得できなければ、課金 API を呼ばない", () => {
    const calls: string[] = [];
    const inner = fakeGh([], [], {});
    const gh: Gh = (args, opts) => {
      calls.push(args.join(" "));
      return inner(args, opts);
    };
    const res = collectGitHub(options(gh, { billing: "user" }));
    expect(res.rows.some((r) => r.kind === "billing")).toBe(false);
    expect(calls.some((c) => c.includes("billing"))).toBe(false);
  });

  test("課金 API の応答に usageItems が無い日・項目が object でない日は、行を作らずに失敗にもしない", () => {
    const res = collectGitHub(
      options(fakeGh([], [["premium_request/usage", { usageItems: ["x"] }]]), { billing: "user" }),
    );
    expect(res.rows.some((r) => r.kind === "billing")).toBe(false);
    expect(res.failures.some((f) => f.startsWith("billing"))).toBe(false);
    const none = collectGitHub(
      options(fakeGh([], [["premium_request/usage", {}]]), { billing: "user" }),
    );
    expect(none.rows.some((r) => r.kind === "billing")).toBe(false);
  });
});

describe("collectGitHub の CI", () => {
  test("run は created_at・updated_at が無くても区間にし、開始の時刻が無い run と object でない run は数えない", () => {
    const res = collectGitHub(
      options(
        fakeGh(
          [],
          [
            [
              "actions/runs?created",
              [
                {
                  workflow_runs: [
                    { id: 1, created_at: iso(1), status: "completed", name: "CI", event: "push" },
                    { id: 2, status: "completed" },
                    "not a record",
                  ],
                },
              ],
            ],
          ],
        ),
      ),
    );
    expect(res.failures).toEqual([]);
    expect(
      res.rows.filter((r) => r.kind === "ci").map((r) => [r.key, r.start, r.end, r.detail]),
    ).toEqual([
      ["ci:1:1", new Date(ms(1)).toISOString(), new Date(ms(1)).toISOString(), "CI;push;"],
    ]);
  });

  test("1 時間の実行が上限を超えたら、その期間を失敗にする", () => {
    const full = Array.from({ length: RUNS_QUERY_LIMIT }, (_, i) => ({ id: i }));
    const gh: Gh = () => Buffer.from(JSON.stringify([{ workflow_runs: full }]));
    expect(() => actionRuns(options(gh), ms(0), ms(1))).toThrow(/1 時間の実行が 1000 件を超えて/);
  });

  // 外部の CI の check run と commit status を返す gh の応答。数えない記録を混ぜる
  const EXTERNAL_CI_ROUTES: [string, unknown][] = [
    [
      "/check-runs",
      [
        {
          check_runs: [
            { id: 1, name: "ci", app: { slug: "github-actions" }, started_at: iso(1) },
            { id: 2, name: "lint", started_at: iso(1), completed_at: null },
            { id: 3, name: "x", app: { slug: "circleci-checks" }, started_at: null },
            "not a record",
          ],
        },
      ],
    ],
    [
      "/statuses",
      [
        [
          { context: "ext", state: "pending", created_at: iso(2) },
          { context: "ext", state: "success", created_at: iso(3) },
          { context: "ext", state: "pending", created_at: iso(1) },
          { context: "slow", state: "pending", created_at: iso(4) },
          { context: "bad", state: "success", created_at: null },
          "not a record",
        ],
      ],
    ],
  ];

  test("外部の CI: check run と commit status を区間にし、Actions の check run・開始の無い check run・head の無い PR は数えない", () => {
    const res = collectGitHub(
      options(fakeGh([prNode([]), prNode([], { number: 8, headRefOid: "" })], EXTERNAL_CI_ROUTES), {
        config: parseRepoConfig({ ci: { external: true } }),
      }),
    );
    expect(res.failures).toEqual([]);
    expect(
      res.rows
        .filter((r) => r.kind === "ci")
        .map((r) => [r.key, r.agent, r.start, r.end, r.detail]),
    ).toEqual([
      [
        "ci-ext:2",
        "external",
        new Date(ms(1)).toISOString(),
        new Date(ms(12)).toISOString(),
        "lint;check-run",
      ],
      [
        "ci-status:abc:ext",
        "external",
        new Date(ms(1)).toISOString(),
        new Date(ms(3)).toISOString(),
        "ext;status",
      ],
      [
        "ci-status:abc:slow",
        "external",
        new Date(ms(4)).toISOString(),
        new Date(ms(12)).toISOString(),
        "slow;status",
      ],
    ]);
  });
});

describe("collectGitHub の artifact", () => {
  test("期限切れ・id が数でない・作成の時刻が無いか since より前の artifact はダウンロードしない", () => {
    const calls: string[] = [];
    const inner = fakeGh(
      [],
      [
        [
          "agent-usage-review-claude",
          [
            {
              artifacts: [
                { id: 1, created_at: iso(1), expired: true },
                { id: "2", created_at: iso(1) },
                { id: 3, created_at: null },
                { id: 4, created_at: "2026-09-30T23:00:00Z" },
                "not a record",
              ],
            },
          ],
        ],
      ],
    );
    const gh: Gh = (args, opts) => {
      calls.push(args.join(" "));
      return inner(args, opts);
    };
    const res = collectGitHub(options(gh));
    expect(res.failures).toEqual([]);
    expect(calls.some((c) => c.includes("/zip"))).toBe(false);
  });

  test("meta.json の無い artifact は tool を unknown・PR を 0 にし、workflow_run が無くても行を作る", () => {
    const exec = [
      {
        type: "result",
        modelUsage: { "claude-opus-5-5": { inputTokens: 1, costUSD: 0.5 }, bad: "x" },
      },
    ];
    const zip = makeZip([
      { name: "claude-execution-output.json", data: Buffer.from(JSON.stringify(exec)), method: 0 },
    ]);
    const res = collectGitHub(
      options(
        fakeGh(
          [],
          [
            ["artifacts/9/zip", zip],
            ["agent-usage-review-claude", [{ artifacts: [{ id: 9, created_at: iso(1) }] }]],
          ],
        ),
      ),
    );
    expect(res.failures).toEqual([]);
    expect(
      res.rows
        .filter((r) => r.kind === "review")
        .map((r) => [r.agent, r.model, r.cost_usd, r.branch, r.detail]),
    ).toEqual([["unknown", "claude-opus-5-5", "0.500000", "", "pr=0;source=artifact;run=0"]]);
  });

  test("meta.json の tool と pr の型が違えば unknown と 0 にし、実行結果が配列でなければ行を作らない", () => {
    const files = new Map<string, Buffer>([
      ["meta.json", Buffer.from(JSON.stringify({ tool: 1, pr: "7" }))],
      ["claude-execution-output.json", Buffer.from(JSON.stringify({ type: "result" }))],
      ["notes.txt", Buffer.from("x")],
    ]);
    expect(
      artifactRows(files, { id: 1, created: ms(1), branch: "b", runId: 2 }, options(noGh)),
    ).toEqual([]);
  });
});

describe("commitActivityRows の読めない記録", () => {
  test("selector に時刻が無い記録と、欄の足りない記録は数えない", () => {
    const reflog = ["a\x00HEAD@{0}\x00commit: x", "b\x00HEAD\x00commit: y", "c\x00only-two"].join(
      "\x1e",
    );
    expect(commitActivityRows(reflog, [], { person: "p", tz: "UTC", since: ms(0) })).toEqual([]);
  });
});

describe("makeGh（PATH の前に置いた偽の gh）", () => {
  // 偽の gh は、受け取った引数と GH_HOST を stdout に出す。FAIL があれば stderr に出して失敗する。
  function stubGh(body: string) {
    const dir = makeTempDir("agent-usage-gh-");
    const gh = join(dir, "gh");
    writeFileSync(gh, `#!/usr/bin/env bash\n${body}\n`);
    chmodSync(gh, 0o755);
    return { PATH: `${dir}:${process.env.PATH}` };
  }

  test("gh api に引数を渡し、ホストが空なら github.com に、そうでなければそのホストに向ける", () => {
    const env = { ...stubGh('printf "%s|" "$GH_HOST" "$@"'), GH_HOST: "利用者の設定" };
    expect(makeGh("", env)(["user"], {}).toString()).toBe("github.com|api|user|");
    expect(makeGh("ghe.example.com", env)(["user"], {}).toString()).toBe(
      "ghe.example.com|api|user|",
    );
  });

  test("0 以外で終われば、stderr を添えて失敗にし、stderr が空なら終了コードを添える", () => {
    const withErr = stubGh('echo "HTTP 404" >&2; exit 1');
    expect(() => makeGh("", withErr)(["repos/o/r"], {})).toThrow("gh api repos/o/r: HTTP 404");
    const silent = stubGh("exit 3");
    expect(() => makeGh("", silent)(["repos/o/r"], {})).toThrow("gh api repos/o/r: exit 3");
  });

  test("gh を起動できなければ失敗にする", () => {
    const dir = makeTempDir("agent-usage-nogh-");
    expect(() => makeGh("", { PATH: dir })(["user"], {})).toThrow(/ENOENT/);
  });

  test("withoutEnvTokens は環境変数の token だけを除く", () => {
    expect(
      withoutEnvTokens({
        GH_TOKEN: "a",
        GITHUB_TOKEN: "b",
        GH_ENTERPRISE_TOKEN: "c",
        GITHUB_ENTERPRISE_TOKEN: "d",
        PATH: "/bin",
      }),
    ).toEqual({ PATH: "/bin" });
  });
});

describe("unzip の読めない zip", () => {
  test("ディレクトリの項目は除く", () => {
    const files = unzip(
      makeZip([
        { name: "dir/", data: Buffer.alloc(0), method: 0 },
        { name: "dir/a", data: Buffer.from("a"), method: 0 },
      ]),
    );
    expect([...files.keys()]).toEqual(["dir/a"]);
  });

  test.each([
    [
      "ZIP64（項目数が 0xffff）",
      (z: Buffer) => z.writeUInt16LE(0xffff, z.length - 22 + 10),
      /ZIP64/,
    ],
    [
      "中央ディレクトリの署名が違う",
      (z: Buffer) => z.writeUInt32LE(0, z.readUInt32LE(z.length - 22 + 16)),
      /中央ディレクトリが不正/,
    ],
    [
      "暗号化の flag",
      (z: Buffer) => z.writeUInt16LE(1, z.readUInt32LE(z.length - 22 + 16) + 8),
      /暗号化された項目/,
    ],
    ["ローカルヘッダの署名が違う", (z: Buffer) => z.writeUInt32LE(0, 0), /ローカルヘッダが不正: a/],
  ])("%s はエラーにする", (_name, corrupt, message) => {
    const z = makeZip([{ name: "a", data: Buffer.from("a"), method: 0 }]);
    corrupt(z);
    expect(() => unzip(z)).toThrow(message);
  });
});
