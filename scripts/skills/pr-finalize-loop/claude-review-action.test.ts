// pr-finalize-loop と pr-review-handle に同梱する claude-review-action.sh（review_tool: claude-code-action の
// レビュー済みの判定と、重ねない依頼）の回帰テスト。
//
// 判定を誤ると、レビューしていない HEAD をレビュー済みとして収束させるか、同じ HEAD のレビューを重ねて起動する。
// どちらもエラーにならないので、状態ごとに出力と終了コードを確かめる。
// 偽の gh は、引数の --jq を本物の jq に渡して、fixture の JSON から gh と同じ出力を作る。ページは配列の要素ごとに分ける。
//
// | 軸             | 値                                                                                         |
// | -------------- | ------------------------------------------------------------------------------------------ |
// | 目印の書き手   | github-actions[bot] / 人（同じ形を書いた）                                                  |
// | 目印の SHA     | HEAD / 前の HEAD                                                                           |
// | 目印の run     | HEAD を対象にした成功した run / 一覧に無い（別のワークフロー・別の SHA）/ 失敗 / 進行中      |
// | 目印の形       | 正しい / open が findings より大きい / 1 行目が違う形                                       |
// | 目印の件数     | 0 件 / 1 件 / 同じ SHA に 2 件（後のもの）                                                 |
// | effort         | 指定なし / 一致 / 不一致                                                                   |
// | --since        | なし / run がそれより前 / 後                                                               |
// | run の状態     | 無い / 進行中 / 成功で目印あり / 成功で目印なし（一時停止）/ skipped / dispatch の失敗        |
// | ページ         | 1 ページ / 2 ページ目にだけある                                                            |
// | 取得           | 成功 / PR の取得の失敗 / ワークフローが無い（404）/ コメントの取得の失敗                    |
// | request        | 依頼できる / 状態が許さない / SHA が HEAD と違う / 依頼の失敗 / run が現れない / effort なし |
import { describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SCRIPT = join(repoRoot, "skills/pr-finalize-loop/scripts/claude-review-action.sh");

// jq はユーザーのグローバル設定の mise から入ることがある。実体のパスを先に取得し、偽物と同じディレクトリにリンクを置く。
const JQ = spawnSync("bash", ["-c", "mise which jq 2>/dev/null || command -v jq"], {
  cwd: repoRoot,
  encoding: "utf8",
  timeout: CHILD_TIMEOUT_MS,
}).stdout.trim();

const FAKE_GH = `#!/usr/bin/env bash
set -u
dir="$FAKE_GH_DIR"
printf '%s\\n' "$*" >>"$dir/calls.log"
jq_expr=""
method="GET"
endpoint=""
args=("$@")
for ((i = 0; i < \${#args[@]}; i++)); do
  case "\${args[i]}" in
  --jq) jq_expr="\${args[i + 1]}" ;;
  --method) method="\${args[i + 1]}" ;;
  repos/*) endpoint="\${args[i]}" ;;
  esac
done
pages() { jq -c '.[]' "$1" | while IFS= read -r page; do jq -r "$jq_expr" <<<"$page"; done; }
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  [ -f "$dir/pr-fail" ] && { echo "GraphQL: Could not resolve to a PullRequest" >&2; exit 1; }
  jq -r "$jq_expr" "$dir/pr.json"
elif [ "$method" = "POST" ]; then
  [ -f "$dir/dispatch-fail" ] && { echo "HTTP 422: Unexpected inputs" >&2; exit 1; }
  [ -f "$dir/dispatch-notrigger" ] && { echo "gh: Workflow does not have 'workflow_dispatch' trigger (HTTP 422)" >&2; exit 1; }
  [ ! -f "$dir/runs-after.json" ] || cp "$dir/runs-after.json" "$dir/runs.json"
elif [[ "$endpoint" == */actions/workflows/*/runs* ]]; then
  [ -f "$dir/runs-404" ] && { echo "gh: Not Found (HTTP 404)" >&2; exit 1; }
  pages "$dir/runs.json"
elif [[ "$endpoint" == */issues/*/comments* ]]; then
  [ -f "$dir/comments-fail" ] && { echo "HTTP 502" >&2; exit 1; }
  pages "$dir/comments.json"
else
  echo "fake gh: 想定していない呼び出し: $*" >&2
  exit 3
fi
`;

const HEAD = "a".repeat(40);
const OLD = "b".repeat(40);
const PR_CREATED = "2026-01-01T00:00:00Z";
const BOT = "github-actions[bot]";
const marker = (o: {
  sha?: string;
  findings?: number;
  open?: number;
  effort?: string;
  run: number;
}) =>
  `<!-- claude-review sha=${o.sha ?? HEAD} findings=${o.findings ?? 0} open=${o.open ?? 0} effort=${o.effort ?? "high"} run=${o.run} -->\n## Claude のレビュー\n`;

type Run = {
  id: number;
  event?: string;
  status?: string;
  conclusion?: string | null;
  created_at?: string;
  sha?: string;
};
type Comment = { id: number; login: string; body: string };
type Fixture = {
  runs?: Run[][];
  runsAfter?: Run[][];
  comments?: Comment[][];
  fail?: ("pr" | "comments" | "dispatch" | "dispatch-notrigger" | "runs-404")[];
};

const toRun = (r: Run) => ({
  id: r.id,
  event: r.event ?? "pull_request",
  status: r.status ?? "completed",
  conclusion: r.conclusion === undefined ? "success" : r.conclusion,
  created_at: r.created_at ?? "2026-01-02T00:00:00Z",
  display_title: `Claude review PR #7 ${r.sha ?? HEAD}`,
});

function setup(f: Fixture = {}) {
  const dir = makeTempDir("claude-review-action-");
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "gh"), FAKE_GH);
  chmodSync(join(bin, "gh"), 0o755);
  if (JQ) symlinkSync(JQ, join(bin, "jq"));
  writeFileSync(
    join(dir, "pr.json"),
    JSON.stringify({
      url: "https://github.com/o/r/pull/7",
      headRefOid: HEAD,
      headRefName: "feature/x",
      createdAt: PR_CREATED,
    }),
  );
  const runPages = (pages: Run[][]) =>
    JSON.stringify(pages.map((p) => ({ total_count: 0, workflow_runs: p.map(toRun) })));
  writeFileSync(join(dir, "runs.json"), runPages(f.runs ?? [[]]));
  if (f.runsAfter) writeFileSync(join(dir, "runs-after.json"), runPages(f.runsAfter));
  writeFileSync(
    join(dir, "comments.json"),
    JSON.stringify(
      (f.comments ?? [[]]).map((p) =>
        p.map((c) => ({ id: c.id, user: { login: c.login }, body: c.body })),
      ),
    ),
  );
  writeFileSync(join(dir, "sha"), `${HEAD}\n`);
  for (const k of f.fail ?? []) {
    const name = k === "runs-404" || k === "dispatch-notrigger" ? k : `${k}-fail`;
    writeFileSync(join(dir, name), "");
  }
  return dir;
}

function run(dir: string, args: string[]) {
  const r = spawnSync("bash", [SCRIPT, ...args], {
    encoding: "utf8",
    cwd: dir,
    timeout: CHILD_TIMEOUT_MS,
    env: {
      PATH: `${join(dir, "bin")}:${process.env.PATH}`,
      HOME: dir,
      FAKE_GH_DIR: dir,
      CLAUDE_REVIEW_POLL_SECONDS: "0",
      CLAUDE_REVIEW_POLL_TRIES: "2",
    },
  });
  const out: Record<string, string> = Object.fromEntries(
    r.stdout
      .trim()
      .split("\n")
      .filter((l) => l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );
  const log = existsSync(join(dir, "calls.log"))
    ? readFileSync(join(dir, "calls.log"), "utf8")
    : "";
  return { status: r.status, out, stderr: r.stderr, dispatched: log.includes("/dispatches") };
}

const check = (f: Fixture, extra: string[] = []) => run(setup(f), ["check", "--pr", "7", ...extra]);

describe("check", () => {
  test("HEAD を対象にした成功した run が書いた目印があれば reviewed で、件数と effort を出す", () => {
    const r = check({
      runs: [[{ id: 11 }]],
      comments: [[{ id: 1, login: BOT, body: marker({ run: 11, findings: 3, open: 1 }) }]],
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.out).toMatchObject({
      head: HEAD,
      status: "reviewed",
      requestable: "no",
      run: "11",
      findings: "3",
      open: "1",
      effort: "high",
      runs: "1",
      ignored: "0",
    });
  });

  test("run も目印も無ければ not-reviewed で、依頼してよい", () => {
    const r = check({});
    expect(r.status, r.stderr).toBe(1);
    expect(r.out).toMatchObject({ status: "not-reviewed", requestable: "yes", runs: "0" });
  });

  test("前の HEAD の目印だけなら not-reviewed（直した commit をレビューしていない）", () => {
    const r = check({
      runs: [[{ id: 10, sha: OLD }]],
      comments: [[{ id: 1, login: BOT, body: marker({ sha: OLD, run: 10 }) }]],
    });
    expect(r.status).toBe(1);
    expect(r.out).toMatchObject({ status: "not-reviewed", requestable: "yes" });
  });

  test("人が同じ形の目印を書いても数えない（目印の run が HEAD の成功した run を指していても）", () => {
    const r = check({
      runs: [[{ id: 11 }]],
      comments: [[{ id: 1, login: "alice", body: marker({ run: 11 }) }]],
    });
    expect(r.status).toBe(1);
    expect(r.out.status).toBe("paused");
  });

  test("目印の run が HEAD を対象にした run の一覧に無ければ（別のワークフローや別の SHA の run）数えない", () => {
    const r = check({
      runs: [[{ id: 13 }, { id: 12, sha: OLD }]],
      comments: [[{ id: 1, login: BOT, body: marker({ run: 12 }) }]],
    });
    expect(r.status).toBe(1);
    expect(r.out).toMatchObject({ status: "paused", ignored: "1" });
    expect(r.stderr).toMatch(/run 12 は、この HEAD を対象にした claude-review\.yml の run でない/);
  });

  test("目印の run が失敗で終わっていれば数えない", () => {
    const r = check({
      runs: [[{ id: 11, conclusion: "failure" }]],
      comments: [[{ id: 1, login: BOT, body: marker({ run: 11 }) }]],
    });
    expect(r.status).toBe(1);
    expect(r.out).toMatchObject({ status: "not-reviewed", requestable: "yes", ignored: "1" });
  });

  test("open が findings より大きい目印は数えない", () => {
    const r = check({
      runs: [[{ id: 11 }]],
      comments: [[{ id: 1, login: BOT, body: marker({ run: 11, findings: 1, open: 2 }) }]],
    });
    expect(r.status).toBe(1);
    expect(r.out.ignored).toBe("1");
  });

  test("HEAD の run が進行中なら、前の run の目印があっても in-progress で、依頼しない", () => {
    const r = check({
      runs: [[{ id: 13, status: "queued", conclusion: null }, { id: 11 }]],
      comments: [[{ id: 1, login: BOT, body: marker({ run: 11 }) }]],
    });
    expect(r.status).toBe(1);
    expect(r.out).toMatchObject({ status: "in-progress", requestable: "no", in_progress: "13" });
  });

  test("目印の effort が --effort と違えば not-reviewed、--effort を省けば reviewed", () => {
    const f: Fixture = {
      runs: [[{ id: 11 }]],
      comments: [[{ id: 1, login: BOT, body: marker({ run: 11, effort: "high" }) }]],
    };
    const medium = check(f, ["--effort", "medium"]);
    expect(medium.status).toBe(1);
    expect(medium.out).toMatchObject({ status: "not-reviewed", requestable: "yes" });
    const any = check(f);
    expect(any.status).toBe(0);
    expect(any.out.effort).toBe("high");
  });

  test("--since より前に作られた run の目印は、対応を見ていないので数えない", () => {
    const f: Fixture = {
      runs: [[{ id: 11, created_at: "2026-01-02T00:00:00Z" }]],
      comments: [[{ id: 1, login: BOT, body: marker({ run: 11 }) }]],
    };
    const after = check(f, ["--since", "2026-01-03T00:00:00Z"]);
    expect(after.status).toBe(1);
    expect(after.out).toMatchObject({ status: "not-reviewed", requestable: "yes" });
    const before = check(f, ["--since", "2026-01-01T12:00:00Z"]);
    expect(before.status).toBe(0);
  });

  test("最後の run が成功したのに目印が無ければ paused で、依頼しない", () => {
    const r = check({ runs: [[{ id: 11 }]] });
    expect(r.status).toBe(1);
    expect(r.out).toMatchObject({ status: "paused", requestable: "no", run: "11" });
  });

  test("一時停止の後に目印のある run があれば、その目印で判定する（一時停止にしない）", () => {
    const r = check(
      {
        runs: [[{ id: 12 }, { id: 11 }]],
        comments: [[{ id: 1, login: BOT, body: marker({ run: 12, effort: "high" }) }]],
      },
      ["--effort", "medium"],
    );
    expect(r.out).toMatchObject({ status: "not-reviewed", requestable: "yes" });
  });

  test("job を飛ばした run（skipped）は数えず、依頼してよい", () => {
    const r = check({ runs: [[{ id: 11, conclusion: "skipped" }]] });
    expect(r.out).toMatchObject({ status: "not-reviewed", requestable: "yes", runs: "1" });
  });

  test("最後の workflow_dispatch の run が失敗していれば failed で、依頼しない", () => {
    const r = check({
      runs: [
        [
          { id: 12, event: "workflow_dispatch", conclusion: "failure" },
          { id: 11, conclusion: "failure" },
        ],
      ],
    });
    expect(r.out).toMatchObject({ status: "failed", requestable: "no", run: "12" });
  });

  test("失敗した dispatch の後に成功した dispatch があれば failed にしない", () => {
    const r = check(
      {
        runs: [
          [
            { id: 13, event: "workflow_dispatch" },
            { id: 12, event: "workflow_dispatch", conclusion: "cancelled" },
          ],
        ],
        comments: [[{ id: 1, login: BOT, body: marker({ run: 13, effort: "high" }) }]],
      },
      ["--effort", "low"],
    );
    expect(r.out).toMatchObject({ status: "not-reviewed", requestable: "yes" });
  });

  test("失敗した dispatch の後に pull_request の run が成功していれば failed にしない", () => {
    const r = check(
      {
        runs: [[{ id: 13 }, { id: 12, event: "workflow_dispatch", conclusion: "timed_out" }]],
        comments: [[{ id: 1, login: BOT, body: marker({ run: 13, effort: "high" }) }]],
      },
      ["--effort", "medium"],
    );
    expect(r.out).toMatchObject({ status: "not-reviewed", requestable: "yes" });
  });

  test("--since より前に失敗した dispatch と一時停止の run は数えず、依頼してよい", () => {
    const f: Fixture = {
      runs: [
        [
          {
            id: 12,
            event: "workflow_dispatch",
            conclusion: "failure",
            created_at: "2026-01-02T00:00:00Z",
          },
          { id: 11, created_at: "2026-01-01T12:00:00Z" },
        ],
      ],
    };
    expect(check(f).out.status).toBe("failed");
    expect(check(f, ["--since", "2026-01-03T00:00:00Z"]).out).toMatchObject({
      status: "not-reviewed",
      requestable: "yes",
    });
  });

  test("同じ HEAD の目印が 2 件あれば、後のものを使う", () => {
    const r = check({
      runs: [[{ id: 12, event: "workflow_dispatch" }, { id: 11 }]],
      comments: [
        [
          { id: 1, login: BOT, body: marker({ run: 11, findings: 2 }) },
          { id: 2, login: BOT, body: marker({ run: 12, findings: 0, effort: "medium" }) },
        ],
      ],
    });
    expect(r.status).toBe(0);
    expect(r.out).toMatchObject({ run: "12", findings: "0", effort: "medium" });
  });

  test("run と目印が 2 ページ目にだけあっても見つける", () => {
    const r = check({
      runs: [[], [{ id: 11 }]],
      comments: [
        [{ id: 1, login: "alice", body: "x" }],
        [{ id: 2, login: BOT, body: marker({ run: 11 }) }],
      ],
    });
    expect(r.status, r.stderr).toBe(0);
  });

  test("ワークフローが無ければ exit 3、PR やコメントを取得できなければ exit 2", () => {
    expect(check({ fail: ["runs-404"] }).status).toBe(3);
    expect(check({ fail: ["pr"] }).status).toBe(2);
    expect(check({ fail: ["comments"] }).status).toBe(2);
  });

  test.each([
    [["--effort", "huge"]],
    [["--since", "2026-01-01"]],
    [["--sha-file", "x"]],
    [["--effort", "low", "--effort", "high"]],
  ])("不正な引数 %j は exit 64", (args) => {
    expect(check({}, args).status).toBe(64);
  });
});

describe("request", () => {
  const request = (f: Fixture, extra: string[] = []) => {
    const dir = setup(f);
    return { dir, ...run(dir, ["request", "--pr", "7", "--sha-file", join(dir, "sha"), ...extra]) };
  };

  test("依頼できる状態なら、head のブランチと入力（pr・sha・effort）で dispatch し、現れた run を出す", () => {
    const r = request(
      { runsAfter: [[{ id: 21, event: "workflow_dispatch", status: "queued", conclusion: null }]] },
      ["--effort", "medium"],
    );
    expect(r.status, r.stderr).toBe(0);
    expect(r.out).toMatchObject({ status: "requested", run: "21" });
    // dispatch の API が本文を返さないとき（204）は、空の括弧を出さない
    expect(r.stderr).toMatch(/effort medium で依頼した$/m);
    const log = readFileSync(join(r.dir, "calls.log"), "utf8");
    const call = log.split("\n").find((l) => l.includes("/dispatches")) ?? "";
    expect(call).toContain("repos/o/r/actions/workflows/claude-review.yml/dispatches");
    for (const arg of [
      "ref=feature/x",
      "inputs[pr]=7",
      `inputs[sha]=${HEAD}`,
      "inputs[effort]=medium",
    ]) {
      expect(call).toContain(arg);
    }
  });

  test("--effort を省けば、入力の effort を渡さない", () => {
    const r = request({
      runsAfter: [[{ id: 21, event: "workflow_dispatch", status: "queued", conclusion: null }]],
    });
    expect(r.status, r.stderr).toBe(0);
    const log = readFileSync(join(r.dir, "calls.log"), "utf8");
    expect(log).not.toContain("inputs[effort]");
  });

  const refusing: [string, Fixture, string][] = [
    ["進行中", { runs: [[{ id: 13, status: "in_progress", conclusion: null }]] }, "in-progress"],
    [
      "レビュー済み",
      { runs: [[{ id: 11 }]], comments: [[{ id: 1, login: BOT, body: marker({ run: 11 }) }]] },
      "reviewed",
    ],
    ["一時停止", { runs: [[{ id: 11 }]] }, "paused"],
  ];
  test.each(refusing)("%s なら依頼せずに exit 4", (_label, f, status) => {
    const r = request(f);
    expect(r.status).toBe(4);
    expect(r.out.status).toBe(status);
    expect(r.dispatched).toBe(false);
  });

  test("--sha-file の SHA が HEAD と違えば依頼せずに exit 1", () => {
    const dir = setup({});
    writeFileSync(join(dir, "sha"), OLD);
    const r = run(dir, ["request", "--pr", "7", "--sha-file", join(dir, "sha")]);
    expect(r.status).toBe(1);
    expect(r.dispatched).toBe(false);
  });

  test("依頼が失敗すれば exit 2、run が現れなければ exit 5（依頼し直さない）", () => {
    expect(request({ fail: ["dispatch"] }).status).toBe(2);
    const r = request({});
    expect(r.status).toBe(5);
    expect(r.stderr).toMatch(/依頼し直さずに/);
  });

  test("head のブランチのワークフローが workflow_dispatch を持たない（GitHub が 422 を返す）なら、ワークフローが無いとして exit 3", () => {
    const r = request({ fail: ["dispatch-notrigger"] });
    expect(r.status).toBe(3);
    expect(r.stderr).toMatch(/ブランチ feature\/x に無い/);
  });

  test("--sha-file が無ければ exit 64", () => {
    expect(run(setup({}), ["request", "--pr", "7"]).status).toBe(64);
  });
});
