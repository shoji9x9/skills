// pr-finalize-loop に同梱する wait-review.sh（依頼したレビューが HEAD に届くのを、3 つの方法で待つ）の回帰テスト。
//
// 1 つの方法だけを見て待つと、別の方法で届いたレビューを上限まで待ち続ける（Issue #1099。issue_comment で起動した
// 再レビューは HEAD に check-run を付けず、bot のコメントで届いた）。起動のきっかけを引数で受け取らないので、
// どの方法で届いても同じ呼び出しで拾うことを、方法ごとに確かめる。
// 偽の gh は、引数の --jq を本物の jq に渡して、fixture の JSON から gh と同じ出力を作る。ページは配列の要素ごとに分ける。
// 取得の回（poll）ごとに fixture を変えられる（<名前>.<回>.json があればそれを使う）。
//
// | 軸                 | 値                                                                                  |
// | ------------------ | ----------------------------------------------------------------------------------- |
// | 届いた方法         | review / check-run（名前を渡した）/ bot-comment（完全な SHA・短縮した SHA）/ どれも無い |
// | review の書き手    | 作成者 / bot / 書き込み権限のある人 / 権限の無い人 / 権限を取得できない人            |
// | review の commit   | HEAD / 前の HEAD                                                                    |
// | 時刻               | --since より前 / 後                                                                 |
// | check-run の名前   | 渡した名前と一致 / 名前を渡していない（候補として出す）                             |
// | check-run の状態   | 完了（success・neutral）/ 完了（failure）/ 進行中                                   |
// | コメントの書き手   | 作成者以外の bot / 人 / 作成者                                                      |
// | コメントの SHA     | HEAD / 前の HEAD / 短縮して HEAD に解決できる / 解決できない / 別の語の一部          |
// | --seen             | なし / 同じ id と時刻 / 同じ id で時刻が新しい                                     |
// | PR                 | OPEN / CLOSED / HEAD が進んだ                                                       |
// | 回                 | 1 回目で届く / 2 回目で届く / 上限まで届かない                                      |
// | 取得               | 成功 / 1 回だけ失敗 / 続けて失敗                                                    |
// | ページ             | 1 ページ / 2 ページ目にだけある                                                     |
import { describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SCRIPT = join(repoRoot, "skills/pr-finalize-loop/scripts/wait-review.sh");

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
endpoint=""
args=("$@")
for ((i = 0; i < \${#args[@]}; i++)); do
  case "\${args[i]}" in
  --jq) jq_expr="\${args[i + 1]}" ;;
  repos/*) endpoint="\${args[i]}" ;;
  esac
done
poll=$(cat "$dir/poll" 2>/dev/null || echo 0)
fixture() { if [ -f "$dir/$1.$poll.json" ]; then echo "$dir/$1.$poll.json"; else echo "$dir/$1.json"; fi; }
failing() { [ -f "$dir/$1-fail" ] || [ -f "$dir/$1-fail.$poll" ]; }
pages() { jq -c '.[]' "$1" | while IFS= read -r page; do jq -r "$jq_expr" <<<"$page"; done; }
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  poll=$((poll + 1))
  echo "$poll" >"$dir/poll"
  failing pr && { echo "HTTP 502" >&2; exit 1; }
  jq -r "$jq_expr" "$(fixture pr)"
elif [[ "$endpoint" == */pulls/*/reviews* ]]; then
  failing reviews && { echo "HTTP 502" >&2; exit 1; }
  pages "$(fixture reviews)"
elif [[ "$endpoint" == */check-runs* ]]; then
  failing checks && { echo "HTTP 502" >&2; exit 1; }
  pages "$(fixture checks)"
elif [[ "$endpoint" == */issues/*/comments* ]]; then
  failing comments && { echo "HTTP 502" >&2; exit 1; }
  pages "$(fixture comments)"
elif [[ "$endpoint" == */collaborators/*/permission ]]; then
  login=\${endpoint%/permission}
  login=\${login##*/}
  p=$(jq -r --arg l "$login" '.[$l] // empty' "$(fixture perms)")
  [ -n "$p" ] || { echo "HTTP 404" >&2; exit 1; }
  jq -n -r --arg p "$p" '{permission: $p}' | jq -r "$jq_expr"
elif [[ "$endpoint" == */commits/* ]]; then
  token=\${endpoint##*/}
  sha=$(jq -r --arg t "$token" '.[$t] // empty' "$dir/shas.json")
  [ -n "$sha" ] || { echo "HTTP 422: No commit found for SHA: $token" >&2; exit 1; }
  jq -n -r --arg s "$sha" '{sha: $s}' | jq -r "$jq_expr"
else
  echo "fake gh: 想定していない呼び出し: $*" >&2
  exit 3
fi
`;

const HEAD = "a1b2c3d".padEnd(40, "e");
const OLD = "b".repeat(40);
const AUTHOR = "alice";
const SINCE = "2026-01-02T00:00:00Z";
const AFTER = "2026-01-02T00:05:00Z";
const BEFORE = "2026-01-01T23:55:00Z";

type Review = { id: number; login: string; type?: string; commit?: string; at?: string };
type Check = {
  id: number;
  name: string;
  status?: string;
  conclusion?: string | null;
  at?: string;
};
type Comment = { id: number; login: string; type?: string; body: string; at?: string };
type Pr = { head?: string; state?: string };
type Responses = {
  pr?: Pr;
  reviews?: Review[][];
  checks?: Check[][];
  comments?: Comment[][];
};
// 取得の回ごとの応答は、polls の回（1 から）に置く。置かない回は、最上位の応答を使う
type Fixture = Responses & {
  polls?: Record<number, Responses>;
  perms?: Record<string, string>;
  // 取得の回ごとの権限。置かない回は perms を使う
  pollPerms?: Record<number, Record<string, string>>;
  shas?: Record<string, string>;
  fail?: string[];
};

const prJson = (p: Pr) => ({
  url: "https://github.com/o/r/pull/7",
  headRefOid: p.head ?? HEAD,
  state: p.state ?? "OPEN",
  author: { login: AUTHOR },
});
const reviewsJson = (pages: Review[][]) =>
  pages.map((p) =>
    p.map((r) => ({
      id: r.id,
      user: { login: r.login, type: r.type ?? "User" },
      commit_id: r.commit ?? HEAD,
      submitted_at: r.at ?? AFTER,
      html_url: `https://github.com/o/r/pull/7#pullrequestreview-${r.id}`,
    })),
  );
const checksJson = (pages: Check[][]) =>
  pages.map((p) => ({
    total_count: p.length,
    check_runs: p.map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status ?? "completed",
      conclusion: c.conclusion === undefined ? "success" : c.conclusion,
      completed_at: (c.status ?? "completed") === "completed" ? (c.at ?? AFTER) : null,
      app: { slug: "github-actions" },
      html_url: `https://github.com/o/r/runs/${c.id}`,
    })),
  }));
const commentsJson = (pages: Comment[][]) =>
  pages.map((p) =>
    p.map((c) => ({
      id: c.id,
      user: { login: c.login, type: c.type ?? "Bot" },
      body: c.body,
      created_at: c.at ?? AFTER,
      updated_at: c.at ?? AFTER,
      html_url: `https://github.com/o/r/pull/7#issuecomment-${c.id}`,
    })),
  );

function writeResponses(dir: string, suffix: string, r: Responses) {
  const write = (name: string, v: unknown) =>
    writeFileSync(join(dir, `${name}${suffix}.json`), JSON.stringify(v));
  if (suffix === "" || r.pr) write("pr", prJson(r.pr ?? {}));
  if (suffix === "" || r.reviews) write("reviews", reviewsJson(r.reviews ?? [[]]));
  if (suffix === "" || r.checks) write("checks", checksJson(r.checks ?? [[]]));
  if (suffix === "" || r.comments) write("comments", commentsJson(r.comments ?? [[]]));
}

function setup(f: Fixture = {}) {
  const dir = makeTempDir("wait-review-");
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "gh"), FAKE_GH);
  chmodSync(join(bin, "gh"), 0o755);
  if (JQ) symlinkSync(JQ, join(bin, "jq"));
  writeResponses(dir, "", f);
  for (const [n, r] of Object.entries(f.polls ?? {})) writeResponses(dir, `.${n}`, r);
  writeFileSync(join(dir, "perms.json"), JSON.stringify(f.perms ?? {}));
  for (const [n, v] of Object.entries(f.pollPerms ?? {}))
    writeFileSync(join(dir, `perms.${n}.json`), JSON.stringify(v));
  writeFileSync(join(dir, "shas.json"), JSON.stringify(f.shas ?? {}));
  writeFileSync(join(dir, "head"), `${HEAD}\n`);
  for (const k of f.fail ?? []) writeFileSync(join(dir, k), "");
  return dir;
}

type Opts = { timeout?: string; since?: string; interval?: string };

function wait(f: Fixture, extra: string[] = [], o: Opts = {}) {
  const dir = setup(f);
  const r = spawnSync(
    "bash",
    [
      SCRIPT,
      "--pr",
      "7",
      "--head-file",
      join(dir, "head"),
      "--since",
      o.since ?? SINCE,
      "--timeout",
      o.timeout ?? "0",
      "--interval",
      o.interval ?? "0",
      ...extra,
    ],
    {
      encoding: "utf8",
      cwd: dir,
      timeout: CHILD_TIMEOUT_MS,
      env: { PATH: `${join(dir, "bin")}:${process.env.PATH}`, HOME: dir, FAKE_GH_DIR: dir },
    },
  );
  const lines = r.stdout.trim().split("\n").filter(Boolean);
  const out: Record<string, string> = {};
  const evidence: string[][] = [];
  const unnamed: string[][] = [];
  const unverified: string[][] = [];
  for (const l of lines) {
    const k = l.slice(0, l.indexOf("="));
    const v = l.slice(l.indexOf("=") + 1);
    if (k === "evidence") evidence.push(v.split("\t"));
    else if (k === "unnamed_check_run") unnamed.push(v.split("\t"));
    else if (k === "unverified") unverified.push(v.split("\t"));
    else out[k] = v;
  }
  return { status: r.status, out, evidence, unnamed, unverified, stderr: r.stderr };
}

const NAME = "Review pull request";

describe("届いた方法", () => {
  test("作成者以外の bot のレビューが HEAD に届けば arrived（review）", () => {
    const r = wait({ reviews: [[{ id: 1, login: "copilot[bot]", type: "Bot" }]] });
    expect(r.status, r.stderr).toBe(0);
    expect(r.out).toMatchObject({ head: HEAD, result: "arrived", polls: "1" });
    expect(r.evidence).toEqual([
      ["review", "1", AFTER, "https://github.com/o/r/pull/7#pullrequestreview-1"],
    ]);
  });

  test("名前を渡した check-run が HEAD で成功すれば arrived（check-run）", () => {
    const r = wait({ checks: [[{ id: 5, name: NAME }]] }, ["--check-run-name", NAME]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.evidence).toEqual([["check-run", "5", AFTER, "https://github.com/o/r/runs/5"]]);
  });

  test("neutral で完了した check-run も arrived", () => {
    const r = wait({ checks: [[{ id: 5, name: NAME, conclusion: "neutral" }]] }, [
      "--check-run-name",
      NAME,
    ]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.evidence[0][0]).toBe("check-run");
  });

  test("check-run の名前を渡していても、HEAD に check-run が無く bot のコメントで届けば arrived（bot-comment）", () => {
    // issue_comment で起動した再レビューの形。check-run だけを見る待ちは、ここで上限まで待ち続けた
    const r = wait(
      {
        comments: [[{ id: 9, login: "claude[bot]", body: `## Review\nReviewed commit ${HEAD}` }]],
      },
      ["--check-run-name", NAME],
    );
    expect(r.status, r.stderr).toBe(0);
    expect(r.evidence).toEqual([
      ["bot-comment", "9", AFTER, "https://github.com/o/r/pull/7#issuecomment-9"],
    ]);
  });

  test("短縮した SHA を書いたコメントは、API で HEAD に解決できれば arrived", () => {
    const r = wait({
      comments: [[{ id: 9, login: "codex[bot]", body: "Reviewed commit: `a1b2c3d`" }]],
      shas: { a1b2c3d: HEAD },
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.evidence[0][0]).toBe("bot-comment");
  });

  test("短縮した SHA が HEAD に解決できなければ数えない", () => {
    const r = wait({
      comments: [[{ id: 9, login: "codex[bot]", body: "Reviewed commit a1b2c3d" }]],
    });
    expect(r.status).toBe(1);
    expect(r.out.result).toBe("timeout");
    expect(r.stderr).toMatch(/a1b2c3d を完全な SHA に解決できない/);
    // 照会に失敗した根拠は stdout にも出し、届いていないと判定させない
    expect(r.unverified).toEqual([["bot-comment", "9", "a1b2c3d"]]);
  });

  test("HEAD の前方と一致しない短縮した SHA は、解決しても数えない（API も呼ばない）", () => {
    const r = wait({
      comments: [[{ id: 9, login: "codex[bot]", body: "Reviewed commit bbbbbbb" }]],
      shas: { bbbbbbb: HEAD },
    });
    expect(r.status).toBe(1);
  });

  test("SHA が別の語の一部なら数えない", () => {
    const r = wait({ comments: [[{ id: 9, login: "codex[bot]", body: `x${HEAD}` }]] });
    expect(r.status).toBe(1);
  });

  test("1 回の取得で見つけた根拠は、すべて review・check-run・bot-comment の順に出す", () => {
    const r = wait(
      {
        reviews: [[{ id: 1, login: "copilot[bot]", type: "Bot" }]],
        checks: [[{ id: 5, name: NAME }]],
        comments: [[{ id: 9, login: "claude[bot]", body: HEAD }]],
      },
      ["--check-run-name", NAME],
    );
    expect(r.status).toBe(0);
    expect(r.evidence.map((e) => e[0])).toEqual(["review", "check-run", "bot-comment"]);
  });

  test("2 ページ目にだけある根拠も拾う", () => {
    const r = wait({
      reviews: [[{ id: 1, login: AUTHOR }], [{ id: 2, login: "copilot[bot]", type: "Bot" }]],
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.evidence[0][1]).toBe("2");
  });
});

describe("数えないもの", () => {
  test("作成者のレビュー（返信は作成者の COMMENTED のレビューになる）は数えない", () => {
    const r = wait({ reviews: [[{ id: 1, login: AUTHOR }]], perms: { [AUTHOR]: "admin" } });
    expect(r.status).toBe(1);
  });

  test("書き込み権限のある人のレビューは数え、権限の無い人のレビューは数えない", () => {
    const ok = wait({ reviews: [[{ id: 1, login: "bob" }]], perms: { bob: "write" } });
    expect(ok.status, ok.stderr).toBe(0);
    const ng = wait({ reviews: [[{ id: 1, login: "eve" }]], perms: { eve: "read" } });
    expect(ng.status).toBe(1);
  });

  test("権限を取得できない人のレビューは数えない", () => {
    const r = wait({ reviews: [[{ id: 1, login: "eve" }]] });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/eve の権限を取得できない/);
    // 照会に失敗した根拠は stdout にも出し、届いていないと判定させない
    expect(r.unverified).toEqual([["review", "1", "eve"]]);
  });

  test("権限を取得でき、書き込み権限が無いと分かった人のレビューは、unverified に出さない", () => {
    const r = wait({ reviews: [[{ id: 1, login: "eve" }]], perms: { eve: "read" } });
    expect(r.status).toBe(1);
    expect(r.unverified).toEqual([]);
  });

  test("権限を一時的に取得できなくても、次の取得で書き込み権限を確かめられれば arrived", () => {
    const r = wait(
      { reviews: [[{ id: 1, login: "eve" }]], pollPerms: { 2: { eve: "write" } } },
      [],
      { timeout: "30" },
    );
    expect(r.status, r.stderr).toBe(0);
    expect(r.out.polls).toBe("2");
    expect(r.evidence.map((e) => e[0])).toEqual(["review"]);
  });

  test("前の HEAD へのレビューは数えない", () => {
    const r = wait({ reviews: [[{ id: 1, login: "copilot[bot]", type: "Bot", commit: OLD }]] });
    expect(r.status).toBe(1);
  });

  test("--since より前のレビュー・check-run・コメントは数えない", () => {
    const r = wait(
      {
        reviews: [[{ id: 1, login: "copilot[bot]", type: "Bot", at: BEFORE }]],
        checks: [[{ id: 5, name: NAME, at: BEFORE }]],
        comments: [[{ id: 9, login: "claude[bot]", body: HEAD, at: BEFORE }]],
      },
      ["--check-run-name", NAME],
    );
    expect(r.status).toBe(1);
    expect(r.evidence).toEqual([]);
  });

  test("前の HEAD を書いたコメント・人のコメント・作成者のコメントは数えない", () => {
    const r = wait({
      comments: [
        [
          { id: 9, login: "claude[bot]", body: OLD },
          { id: 10, login: "bob", type: "User", body: HEAD },
          { id: 11, login: AUTHOR, type: "Bot", body: HEAD },
        ],
      ],
    });
    expect(r.status).toBe(1);
  });

  test("名前を渡していない check-run は届いた根拠にせず、timeout のときに候補として出す", () => {
    const r = wait({
      checks: [
        [
          { id: 5, name: NAME },
          { id: 6, name: "Lint", at: BEFORE },
        ],
      ],
    });
    expect(r.status).toBe(1);
    expect(r.out.result).toBe("timeout");
    expect(r.unnamed).toEqual([["5", NAME, "github-actions", "success"]]);
  });

  test("名前の部分一致では数えない", () => {
    const r = wait({ checks: [[{ id: 5, name: `${NAME} (extra)` }]] }, ["--check-run-name", NAME]);
    expect(r.status).toBe(1);
  });

  test("--seen に渡した根拠は、同じ時刻なら数えず、時刻が新しければもう一度数える", () => {
    const f: Fixture = {
      comments: [[{ id: 9, login: "claude[bot]", body: `working on ${HEAD}` }]],
    };
    const same = wait(f, ["--seen", `bot-comment:9@${AFTER}`]);
    expect(same.status).toBe(1);
    const older = wait(f, ["--seen", `bot-comment:9@${SINCE}`]);
    expect(older.status).toBe(0);
    const check = wait({ checks: [[{ id: 5, name: NAME }]] }, [
      "--check-run-name",
      NAME,
      "--seen",
      `check-run:5@${AFTER}`,
    ]);
    expect(check.status).toBe(1);
  });
});

describe("待ちの終わり方", () => {
  test("2 回目の取得で届けば、そこで arrived を返す", () => {
    const r = wait(
      { polls: { 2: { comments: [[{ id: 9, login: "claude[bot]", body: HEAD }]] } } },
      [],
      {
        timeout: "30",
      },
    );
    expect(r.status, r.stderr).toBe(0);
    expect(r.out.polls).toBe("2");
  });

  test("上限まで届かなければ、上限の後にもう 1 回取得してから timeout を返す", () => {
    const r = wait({}, [], { timeout: "1", interval: "1" });
    expect(r.status).toBe(1);
    expect(r.out.result).toBe("timeout");
    expect(Number(r.out.polls)).toBeGreaterThanOrEqual(2);
  });

  test("名前を渡した check-run が終わっていなければ pending_check_runs に出す", () => {
    const r = wait({ checks: [[{ id: 5, name: NAME, status: "in_progress" }]] }, [
      "--check-run-name",
      NAME,
    ]);
    expect(r.status).toBe(1);
    expect(r.out.pending_check_runs).toBe(NAME);
  });

  test("名前を渡した check-run が失敗で完了したら check-run-failed（exit 4）", () => {
    const r = wait({ checks: [[{ id: 5, name: NAME, conclusion: "failure" }]] }, [
      "--check-run-name",
      NAME,
    ]);
    expect(r.status).toBe(4);
    expect(r.out).toMatchObject({
      result: "check-run-failed",
      failed_check_run: `5\t${NAME}\tfailure`,
    });
  });

  test("同じ名前の check-run が再実行中なら、失敗した古い試行で check-run-failed にしない", () => {
    const r = wait(
      {
        checks: [
          [
            { id: 5, name: NAME, conclusion: "failure" },
            { id: 6, name: NAME, status: "in_progress" },
          ],
        ],
      },
      ["--check-run-name", NAME],
    );
    expect(r.status).toBe(1);
    expect(r.out.result).toBe("timeout");
    expect(r.out.pending_check_runs).toBe(NAME);
  });

  test("HEAD が進んだら head-changed、PR が閉じたら closed（どちらも exit 3）", () => {
    const moved = wait({ pr: { head: OLD } });
    expect(moved.status).toBe(3);
    expect(moved.out.result).toBe("head-changed");
    const closed = wait({ pr: { state: "CLOSED" } });
    expect(closed.status).toBe(3);
    expect(closed.out.result).toBe("closed");
  });

  test("1 回だけ取得に失敗しても、次の取得で届けば arrived", () => {
    const r = wait(
      { comments: [[{ id: 9, login: "claude[bot]", body: HEAD }]], fail: ["comments-fail.1"] },
      [],
      { timeout: "30" },
    );
    expect(r.status, r.stderr).toBe(0);
    expect(r.out.polls).toBe("2");
  });

  test("上限の後の取得が失敗したら timeout を返さず、続けて失敗したら exit 2", () => {
    const r = wait({ fail: ["reviews-fail"] });
    expect(r.status).toBe(2);
    expect(r.out.result).toBeUndefined();
    expect(r.out.polls).toBe("3");
  });
});

describe("引数", () => {
  test.each([
    {
      name: "--since 2026-01-02",
      extra: [],
      o: { since: "2026-01-02" },
      msg: /--since は GitHub の時刻の形/,
    },
    { name: "--timeout -1", extra: [], o: { timeout: "-1" }, msg: /--timeout は 0 以上の整数/ },
    { name: "--seen bot-comment:9", extra: ["--seen", "bot-comment:9"], o: {}, msg: /--seen は/ },
    { name: "--pr の重複", extra: ["--pr", "8"], o: {}, msg: /--pr が 2 回渡された/ },
  ])("$name は 64 で止まる", ({ extra, o, msg }) => {
    const r = wait({}, extra, o);
    expect(r.status).toBe(64);
    expect(r.stderr).toMatch(msg);
  });

  test("--head-file の中身が短縮した SHA なら 64", () => {
    const dir = setup();
    writeFileSync(join(dir, "head"), "a1b2c3d\n");
    const r = spawnSync(
      "bash",
      [SCRIPT, "--pr", "7", "--head-file", join(dir, "head"), "--since", SINCE, "--timeout", "0"],
      {
        encoding: "utf8",
        timeout: CHILD_TIMEOUT_MS,
        env: { PATH: `${join(dir, "bin")}:${process.env.PATH}`, FAKE_GH_DIR: dir },
      },
    );
    expect(r.status).toBe(64);
  });
});
