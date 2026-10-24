// pr-finalize-loop に同梱する local-review-record.sh（review_tool: local の記録の投稿と判定）の回帰テスト。
//
// 偽の gh は、引数の --jq を本物の jq に渡して、fixture の JSON から gh と同じ出力を作る。
// 状態空間の軸と、各セルに置いた入力:
//
// | 軸           | 値                                                                                   |
// | ------------ | ------------------------------------------------------------------------------------ |
// | 記録の SHA   | 無い / HEAD と一致 / 前の HEAD だけ（直した commit を再レビューしていない）/ 両方       |
// | 記録の書き手 | 作成者 / 担当者 / どちらでもない / 作成者の login を前方に含む別の login                 |
// | 1 行目の形   | 正しい / 短縮した SHA / 件数が整数でない / 件数の先頭が 0 / 件数が 20 桁 / open が無い  |
// |              | / 件数が 10 桁 / open が findings より大きい / 末尾に余計な文字 / CRLF                 |
// |              | / 1 行目に U+001F（途中・末尾の 1 文字）                                               |
// | 目印の位置   | 本文の先頭 / 前に空白か改行 / 本文の途中の引用（作成者・作成者でない人）/ 目印なし       |
// | 未対応       | open=0（reviewed）/ open が 1 以上（open）                                            |
// | previous     | 前の HEAD の記録がある（出す）/ 無い（出さない）                                       |
// | 取得         | 成功 / PR の取得の失敗 / コメントの取得の失敗 / headRefOid が完全な SHA でない           |
// | ホスト       | github.com / GHE（--hostname を渡す）                                                 |
// | post の引数  | 正しい / SHA が HEAD と違う / 短縮した SHA / 件数が負・先頭が 0 / 重複 / 投稿の失敗      |
import { test, expect } from "vitest";
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
const SCRIPT = join(repoRoot, "skills/pr-finalize-loop/scripts/local-review-record.sh");

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
body_ref=""
endpoint=""
args=("$@")
for ((i = 0; i < \${#args[@]}; i++)); do
  case "\${args[i]}" in
  --jq) jq_expr="\${args[i + 1]}" ;;
  --method) method="\${args[i + 1]}" ;;
  -F) body_ref="\${args[i + 1]}" ;;
  user) endpoint="user" ;;
  esac
done
emit() { if [ -n "$jq_expr" ]; then jq -r "$jq_expr" "$1"; else cat "$1"; fi; }
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  [ -f "$dir/pr-fail" ] && { echo "GraphQL: Could not resolve to a PullRequest" >&2; exit 1; }
  emit "$dir/pr.json"
elif [ "$1" = "api" ] && [ "$method" = "POST" ]; then
  [ -f "$dir/post-fail" ] && { echo "HTTP 403" >&2; exit 1; }
  cp "\${body_ref#body=@}" "$dir/posted.md"
  printf '{"id": 999}' >"$dir/post.json"
  emit "$dir/post.json"
elif [ "$1" = "api" ] && [ "$endpoint" = "user" ]; then
  [ -f "$dir/user-fail" ] && { echo "HTTP 403: Resource not accessible by integration" >&2; exit 1; }
  emit "$dir/user.json"
elif [ "$1" = "api" ]; then
  [ -f "$dir/comments-fail" ] && { echo "HTTP 502" >&2; exit 1; }
  emit "$dir/comments.json"
else
  echo "fake gh: 想定していない呼び出し: $*" >&2
  exit 3
fi
`;

const HEAD = "a".repeat(40);
const OLD = "b".repeat(40);
const marker = (sha: string, findings: string | number, open: string | number = 0) =>
  `<!-- pr-finalize-loop:local-review sha=${sha} findings=${findings} open=${open} -->`;

type Comment = { id: number; login: string; body: string };
type Fixture = {
  url?: string;
  head?: string;
  author?: string;
  assignees?: string[];
  // gh のユーザー（post が投稿する人）。省略したら作成者
  me?: string;
  comments?: Comment[];
  fail?: ("pr" | "comments" | "post" | "user")[];
};

function setup(f: Fixture = {}) {
  const dir = makeTempDir("local-review-record-");
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "gh"), FAKE_GH);
  chmodSync(join(bin, "gh"), 0o755);
  if (JQ) symlinkSync(JQ, join(bin, "jq"));
  writeFileSync(
    join(dir, "pr.json"),
    JSON.stringify({
      url: f.url ?? "https://github.com/o/r/pull/7",
      headRefOid: f.head ?? HEAD,
      author: { login: f.author ?? "alice" },
      assignees: (f.assignees ?? []).map((login) => ({ login })),
    }),
  );
  writeFileSync(join(dir, "user.json"), JSON.stringify({ login: f.me ?? f.author ?? "alice" }));
  writeFileSync(
    join(dir, "comments.json"),
    JSON.stringify(
      (f.comments ?? []).map((c) => ({ id: c.id, user: { login: c.login }, body: c.body })),
    ),
  );
  for (const k of f.fail ?? []) writeFileSync(join(dir, `${k}-fail`), "");
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
    },
  });
  const out = Object.fromEntries(
    r.stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l): [string, string] => {
        const i = l.indexOf("=");
        return [l.slice(0, i), l.slice(i + 1)];
      }),
  );
  return { status: r.status, out, stderr: r.stderr };
}

const calls = (dir: string) => readFileSync(join(dir, "calls.log"), "utf8");

test("jq の実体を解決できる（解決できないと、以下のテストは偽の gh の出力を作れずに失敗する）", () => {
  expect(JQ).not.toBe("");
});

test("記録が無ければ not-reviewed で exit 1", () => {
  const dir = setup();
  const r = run(dir, ["check", "--pr", "7"]);
  expect(r.status).toBe(1);
  expect(r.out).toEqual({ head: HEAD, status: "not-reviewed", records: "0", ignored: "0" });
});

test("作成者が HEAD に残した記録があれば reviewed で exit 0。指摘の件数も返す", () => {
  const dir = setup({ comments: [{ id: 11, login: "alice", body: `${marker(HEAD, 0)}\n\n本文` }] });
  const r = run(dir, ["check", "--pr", "7"]);
  expect(r.status).toBe(0);
  expect(r.out).toEqual({
    head: HEAD,
    status: "reviewed",
    record: "11",
    findings: "0",
    open: "0",
    records: "1",
    ignored: "0",
  });
});

test("直した commit を push した後に再レビューしていない（記録が前の HEAD だけ）なら not-reviewed", () => {
  const dir = setup({ comments: [{ id: 11, login: "alice", body: marker(OLD, 1) }] });
  const r = run(dir, ["check", "--pr", "7"]);
  expect(r.status).toBe(1);
  // 前の記録の SHA を、2 回目からのレビューの範囲の起点として出す
  expect(r.out).toMatchObject({
    status: "not-reviewed",
    previous: OLD,
    records: "1",
    ignored: "0",
  });
});

test("前の HEAD と今の HEAD の記録があれば、今の HEAD の記録を使う。同じ HEAD に 2 件あれば後のもの", () => {
  const dir = setup({
    comments: [
      { id: 11, login: "alice", body: marker(OLD, 1) },
      { id: 12, login: "alice", body: marker(HEAD, 2) },
      { id: 13, login: "alice", body: marker(HEAD, 0) },
    ],
  });
  const r = run(dir, ["check", "--pr", "7"]);
  expect(r.status).toBe(0);
  expect(r.out).toMatchObject({ record: "13", findings: "0", previous: OLD, records: "3" });
});

test("担当者の記録は数え、作成者でも担当者でもない人の記録は理由を出して読み飛ばす", () => {
  const byAssignee = setup({
    assignees: ["bob"],
    comments: [{ id: 21, login: "bob", body: marker(HEAD, 0) }],
  });
  expect(run(byAssignee, ["check", "--pr", "7"]).status).toBe(0);

  const byOther = setup({
    assignees: ["bob"],
    // 作成者の login を前方に含む別の login も、作成者として扱わない
    comments: [
      { id: 22, login: "mallory", body: marker(HEAD, 0) },
      { id: 23, login: "alice2", body: marker(HEAD, 0) },
      { id: 24, login: "ali", body: marker(HEAD, 0) },
    ],
  });
  const r = run(byOther, ["check", "--pr", "7"]);
  expect(r.status).toBe(1);
  expect(r.out).toMatchObject({ status: "not-reviewed", records: "0", ignored: "3" });
  expect(r.stderr).toMatch(/記録 22 を読み飛ばした（mallory は PR の作成者でも担当者でもない）/);
});

test.each([
  ["短縮した SHA", marker(HEAD.slice(0, 7), 0)],
  ["大文字の SHA", marker(HEAD.toUpperCase(), 0)],
  ["件数が整数でない", marker(HEAD, "none")],
  ["件数の先頭が 0", marker(HEAD, "01")],
  ["末尾に余計な文字", `${marker(HEAD, 0)} x`],
  [
    "open が無い（open を足す前の形）",
    `<!-- pr-finalize-loop:local-review sha=${HEAD} findings=0 -->`,
  ],
  ["open が整数でない", marker(HEAD, 1, "x")],
  // bash の整数（64 ビット）に収まらない値は比較が失敗し、open が findings より大きいことを見逃す
  ["件数が 20 桁", marker(HEAD, 1, "99999999999999999999")],
  ["件数が 10 桁", marker(HEAD, 1, "9999999999")],
  ["1 行目に U+001F", `${marker(HEAD, 0)}\u001fjunk`],
  // read は末尾の 1 文字の区切りを取り除くので、jq の側で見分けないと正しい記録として数える
  ["1 行目の末尾が U+001F 1 文字", `${marker(HEAD, 0)}\u001f`],
])("1 行目の形が違う記録（%s）は、数えずに読み飛ばす", (_name, body) => {
  const dir = setup({ comments: [{ id: 31, login: "alice", body }] });
  const r = run(dir, ["check", "--pr", "7"]);
  expect(r.status).toBe(1);
  expect(r.out).toMatchObject({ status: "not-reviewed", records: "0", ignored: "1" });
  expect(r.stderr).toMatch(/記録 31 を読み飛ばした（1 行目の形が違う）/);
});

test("目印の前に空白か改行がある記録は、記録として数えず、理由を出して読み飛ばす", () => {
  const dir = setup({ comments: [{ id: 41, login: "alice", body: `\n ${marker(HEAD, 0)}` }] });
  const r = run(dir, ["check", "--pr", "7"]);
  expect(r.status).toBe(1);
  expect(r.out).toMatchObject({ status: "not-reviewed", records: "0", ignored: "1" });
  expect(r.stderr).toMatch(
    /記録 41 を読み飛ばした（目印が本文の先頭に無い。前に空白か改行がある）/,
  );
});

test.each([
  ["目印を含まない", "LGTM"],
  ["本文の途中で目印を引用しただけ", `引用: ${marker(HEAD, 0)}`],
  ["Quote reply で記録を引用した", `> ${marker(HEAD, 0)}\n\n返信`],
])("%s コメントは、記録の候補にも、読み飛ばした件数にも入れない", (_name, body) => {
  const dir = setup({ comments: [{ id: 42, login: "mallory", body }] });
  const r = run(dir, ["check", "--pr", "7"]);
  expect(r.status).toBe(1);
  expect(r.out).toMatchObject({ status: "not-reviewed", records: "0", ignored: "0" });
  expect(r.stderr).toBe("");
});

test("HEAD の記録に未対応の指摘（open が 1 以上）が残っていれば、open で exit 1", () => {
  const dir = setup({ comments: [{ id: 81, login: "alice", body: marker(HEAD, 3, 2) }] });
  const r = run(dir, ["check", "--pr", "7"]);
  expect(r.status).toBe(1);
  expect(r.out).toEqual({
    head: HEAD,
    status: "open",
    record: "81",
    findings: "3",
    open: "2",
    records: "1",
    ignored: "0",
  });
});

test("open が findings より大きい記録は、形が正しくても数えずに読み飛ばす", () => {
  const dir = setup({ comments: [{ id: 82, login: "alice", body: marker(HEAD, 1, 2) }] });
  const r = run(dir, ["check", "--pr", "7"]);
  expect(r.status).toBe(1);
  expect(r.out).toMatchObject({ status: "not-reviewed", records: "0", ignored: "1" });
  expect(r.stderr).toMatch(/記録 82 を読み飛ばした（open が findings より大きい）/);
});

const UNDECIDABLE: [string, Fixture, RegExp][] = [
  ["PR を取得できない", { fail: ["pr"] }, /PR を取得できない/],
  ["コメントを取得できない", { fail: ["comments"] }, /PR のコメントを取得できない/],
  ["headRefOid が完全な SHA でない", { head: "abc1234" }, /完全な SHA でない/],
  ["PR の URL を解析できない", { url: "not-a-url" }, /PR の URL を解析できない/],
  // 欄の区切りが空白の扱いだと、空の作成者の欄が詰まり、担当者が作成者として読まれる
  [
    "作成者の login が空（担当者はいる）",
    { author: "", assignees: ["bob"] },
    /PR の作成者を取得できない/,
  ],
];

test.each(UNDECIDABLE)("%s ときは、記録が無いとせずに exit 2（判定できない）", (_name, f, msg) => {
  const dir = setup({ ...f, comments: [{ id: 51, login: "alice", body: marker(HEAD, 0) }] });
  const r = run(dir, ["check", "--pr", "7"]);
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(msg);
});

test("GHE の PR では、gh api に --hostname を渡す", () => {
  const dir = setup({ url: "https://ghe.example.com/o/r/pull/7" });
  expect(run(dir, ["check", "--pr", "https://ghe.example.com/o/r/pull/7"]).status).toBe(1);
  expect(calls(dir)).toMatch(
    /^api --hostname ghe\.example\.com --paginate repos\/o\/r\/issues\/7\/comments\?per_page=100 /m,
  );
});

test("github.com の PR では、--hostname を渡さない", () => {
  const dir = setup();
  run(dir, ["check", "--pr", "7"]);
  expect(calls(dir)).toMatch(/^api --paginate repos\/o\/r\/issues\/7\/comments\?per_page=100 /m);
});

test("post は HEAD と一致する SHA の記録を投稿し、check がその記録を reviewed と読む", () => {
  const dir = setup();
  const details = join(dir, "details.md");
  writeFileSync(details, "- 指摘なし\n");
  const p = run(dir, [
    "post",
    "--pr",
    "7",
    "--sha",
    HEAD,
    "--findings",
    "0",
    "--open",
    "0",
    "--reviewer",
    "code-review high --comment",
    "--details",
    details,
  ]);
  expect(p.status).toBe(0);
  expect(p.out).toEqual({ record: "999" });
  const posted = readFileSync(join(dir, "posted.md"), "utf8");
  expect(posted.split("\n")[0]).toBe(marker(HEAD, 0, 0));
  expect(posted).toContain(
    `HEAD \`${HEAD}\` を code-review high --comment でレビューし、指摘は 0 件、そのうち未対応は 0 件だった。`,
  );
  expect(posted).toContain("- 指摘なし");

  // 書いた記録を、読み手がそのまま読めること（書き手と読み手の結合）
  writeFileSync(
    join(dir, "comments.json"),
    JSON.stringify([{ id: 999, user: { login: "alice" }, body: posted }]),
  );
  const c = run(dir, ["check", "--pr", "7"]);
  expect(c.status).toBe(0);
  expect(c.out).toMatchObject({ status: "reviewed", record: "999", findings: "0" });
});

test("post は、渡した SHA が HEAD と違えば投稿せずに exit 1", () => {
  const dir = setup();
  const r = run(dir, ["post", "--pr", "7", "--sha", OLD, "--findings", "0", "--open", "0"]);
  expect(r.status).toBe(1);
  expect(r.stderr).toMatch(/HEAD をレビューし直してから記録する/);
  expect(calls(dir)).not.toMatch(/--method POST/);
  expect(existsSync(join(dir, "posted.md"))).toBe(false);
});

test("post は、gh のユーザーが作成者でも担当者でもなければ、check が読み飛ばす記録を投稿せずに exit 3", () => {
  const dir = setup({ me: "mallory" });
  const r = run(dir, ["post", "--pr", "7", "--sha", HEAD, "--findings", "0", "--open", "0"]);
  // SHA の不一致（exit 1）と区別できる終了コードにする。呼び出し側の対処が違う
  expect(r.status).toBe(3);
  expect(r.stderr).toMatch(/mallory）は PR の作成者でも担当者でもない/);
  expect(calls(dir)).not.toMatch(/--method POST/);

  const byAssignee = setup({ me: "bob", assignees: ["bob"] });
  expect(
    run(byAssignee, ["post", "--pr", "7", "--sha", HEAD, "--findings", "0", "--open", "0"]).status,
  ).toBe(0);
});

test("post は、未対応の件数を記録に残し、check はその記録を open と読む", () => {
  const dir = setup();
  expect(
    run(dir, ["post", "--pr", "7", "--sha", HEAD, "--findings", "2", "--open", "1"]).status,
  ).toBe(0);
  const posted = readFileSync(join(dir, "posted.md"), "utf8");
  expect(posted.split("\n")[0]).toBe(marker(HEAD, 2, 1));
  writeFileSync(
    join(dir, "comments.json"),
    JSON.stringify([{ id: 999, user: { login: "alice" }, body: posted }]),
  );
  const c = run(dir, ["check", "--pr", "7"]);
  expect(c.status).toBe(1);
  expect(c.out).toMatchObject({ status: "open", open: "1" });
});

test("post は、gh のユーザーを取得できなければ（ユーザーでないトークン）、投稿せずに exit 4", () => {
  const dir = setup({ fail: ["user"] });
  const r = run(dir, ["post", "--pr", "7", "--sha", HEAD, "--findings", "0", "--open", "0"]);
  // 一時的な失敗（exit 2）と区別できる終了コードにする。取得し直しても直らない
  expect(r.status).toBe(4);
  expect(r.stderr).toMatch(/local を使わずに止まる/);
  expect(calls(dir)).not.toMatch(/--method POST/);
});

test("GitHub App が作った PR では、作成者の app/<name> を <name>[bot] として記録の書き手と照合する", () => {
  const dir = setup({
    author: "app/renovate",
    comments: [{ id: 61, login: "renovate[bot]", body: marker(HEAD, 0) }],
  });
  expect(run(dir, ["check", "--pr", "7"]).status).toBe(0);
});

test("1 行目の末尾の CR（CRLF の改行）は、形の照合の前に取り除く", () => {
  const dir = setup({ comments: [{ id: 71, login: "alice", body: `${marker(HEAD, 0)}\r\n本文` }] });
  const r = run(dir, ["check", "--pr", "7"]);
  expect(r.status).toBe(0);
  expect(r.out).toMatchObject({ record: "71", ignored: "0" });
});

test("post は、投稿に失敗したら exit 2", () => {
  const dir = setup({ fail: ["post"] });
  expect(
    run(dir, ["post", "--pr", "7", "--sha", HEAD, "--findings", "0", "--open", "0"]).status,
  ).toBe(2);
});

test.each([
  ["モードが無い", []],
  ["不明なモード", ["show", "--pr", "7"]],
  ["--pr が無い", ["check"]],
  ["--pr の値が空", ["check", "--pr", ""]],
  ["--pr が 2 回", ["check", "--pr", "7", "--pr", "8"]],
  ["check に --sha", ["check", "--pr", "7", "--sha", HEAD]],
  ["check に --reviewer", ["check", "--pr", "7", "--reviewer", "x"]],
  ["post に --sha が無い", ["post", "--pr", "7", "--findings", "0", "--open", "0"]],
  ["post に --findings が無い", ["post", "--pr", "7", "--sha", HEAD, "--open", "0"]],
  ["post に --open が無い", ["post", "--pr", "7", "--sha", HEAD, "--findings", "0"]],
  ["--open が整数でない", ["post", "--pr", "7", "--sha", HEAD, "--findings", "1", "--open", "x"]],
  [
    "--open が --findings より大きい",
    ["post", "--pr", "7", "--sha", HEAD, "--findings", "1", "--open", "2"],
  ],
  [
    "短縮した SHA",
    ["post", "--pr", "7", "--sha", HEAD.slice(0, 7), "--findings", "0", "--open", "0"],
  ],
  ["件数が負", ["post", "--pr", "7", "--sha", HEAD, "--findings", "-1", "--open", "0"]],
  ["件数の先頭が 0", ["post", "--pr", "7", "--sha", HEAD, "--findings", "01", "--open", "0"]],
  ["件数が 10 桁", ["post", "--pr", "7", "--sha", HEAD, "--findings", "9999999999", "--open", "0"]],
  [
    "読めない --details",
    [
      "post",
      "--pr",
      "7",
      "--sha",
      HEAD,
      "--findings",
      "0",
      "--open",
      "0",
      "--details",
      "/nonexistent",
    ],
  ],
  ["不明な引数", ["check", "--pr", "7", "--x"]],
])("引数が不正（%s）なら、gh を呼ばずに exit 64", (_name, args) => {
  const dir = setup();
  const r = run(dir, args);
  expect(r.status).toBe(64);
  expect(existsSync(join(dir, "calls.log"))).toBe(false);
});
