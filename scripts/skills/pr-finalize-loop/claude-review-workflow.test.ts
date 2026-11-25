// pr-finalize-loop に同梱したワークフローの雛形（skills/pr-finalize-loop/assets/claude-review.yml）の段（run の本文）を取り出し、
// 偽の gh で実行して振る舞いを確かめる（Issue #1030）。
// このリポジトリの .github/workflows/claude-review.yml は、雛形のバイト単位の複製である（下の「雛形と複製の一致」）。
//
// このワークフローは、レビューを依頼する側（pr-finalize-loop など）が読む目印のコメントを書く。
// 目印が誤って残ると、依頼する側はレビューしていない HEAD をレビュー済みとして扱う。
// また、workflow_dispatch の入力の検査を誤ると、fork のコードや古い HEAD を secret のある job でレビューする。
// どちらも run は緑のまま進むので、段の本文を実際に実行して確かめる。
import { describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isArray } from "../../lib/is-array.ts";
import { loadYamlAs } from "../../lib/text/yaml-as.ts";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const WORKFLOW = "skills/pr-finalize-loop/assets/claude-review.yml";
const WIRED = ".github/workflows/claude-review.yml";

// 複製を置くのは、actionlint・ghalint が .github/workflows/** しか見ず、このリポジトリのレビューもこの複製で動くからである。
// 片方だけを直すと、配布先へ配る雛形と、このリポジトリで確かめた実物が食い違う。
test("雛形と複製の一致: 雛形とこのリポジトリのワークフローがバイト単位で一致する", () => {
  const canon = readFileSync(join(repoRoot, WORKFLOW), "utf8");
  const wired = readFileSync(join(repoRoot, WIRED), "utf8");
  expect(
    wired,
    `雛形と複製がずれている。直した側のファイルを他方へ cp でコピーし、scripts/tools/reinstall-skill.sh pr-finalize-loop を実行する`,
  ).toBe(canon);
});

type Step = {
  name?: string;
  if?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, string>;
};
type Workflow = { env: Record<string, string>; jobs: { review: { steps: Step[] } } };

const doc = loadYamlAs<Workflow>(readFileSync(join(repoRoot, WORKFLOW), "utf8"));

/** 名前で段を返す。0 件・複数件は落とす（段の名前を変えたら、検査が空振りするだけになるため）。 */
function step(name: string): Step {
  const matched = doc.jobs.review.steps.filter((s) => s.name === name);
  expect(matched, `${WORKFLOW}: "${name}" の段`).toHaveLength(1);
  return matched[0] ?? {};
}

function stepRun(name: string): string {
  const run = step(name).run;
  expect(run, `${WORKFLOW}: "${name}" に run が無い`).toBeTypeOf("string");
  return run ?? "";
}

const SHA = "a".repeat(40);
const OTHER_SHA = "b".repeat(40);

// 偽の gh。呼び出しを GH_LOG に 1 行ずつ書き、引数ごとに決まった応答を返す。
// --jq を渡された呼び出しは、本物と同じく応答に jq を当てて返す。
const FAKE_GH = `#!/usr/bin/env bash
echo "$*" >>"$GH_LOG"
jqf=""
input=""
body_file=""
args=("$@")
for ((i = 0; i < \${#args[@]}; i++)); do
  case "\${args[i]}" in
    --jq) jqf="\${args[i+1]}" ;;
    --input) input="\${args[i+1]}" ;;
    --body-file) body_file="\${args[i+1]}" ;;
  esac
done
emit() { if [ -n "$jqf" ]; then jq -r "$jqf"; else cat; fi; }
case "$*" in
  "api -X POST "*"/comments "*)
    if [ -n "\${FAIL_PATH:-}" ] && [ "$(jq -r .path "$input")" = "$FAIL_PATH" ]; then exit 1; fi
    jq -c . "$input" >>"$INLINE_LOG" ;;
  "pr comment "*) cp "$body_file" "$COMMENT_OUT" ;;
  "api graphql "*) emit <"$THREADS_JSON" ;;
  "api --paginate "*"/issues/"*"/comments"*) emit <"$COMMENTS_JSON" ;;
  "api repos/"*"/pulls/"*) [ -f "\${PR_JSON:-}" ] || exit 1; emit <"$PR_JSON" ;;
  *) echo "unexpected gh call: $*" >&2; exit 99 ;;
esac
`;

type RunResult = { status: number | null; stdout: string; stderr: string; dir: string };

/** 段の本文を、偽の gh を PATH の先頭に置いた bash で実行する。cwd は dir（無ければ一時ディレクトリ）。 */
function runStep(script: string, env: Record<string, string>, cwd?: string): RunResult {
  const dir = makeTempDir("claude-review-step-");
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "gh"), FAKE_GH);
  chmodSync(join(bin, "gh"), 0o755);
  for (const f of ["gh.log", "inline.log", "output", "summary"]) writeFileSync(join(dir, f), "");
  writeFileSync(join(dir, "step.sh"), script);
  // GitHub Actions が shell: bash の段を起動するときと同じオプションで実行する（pipefail を含む）。
  const res = spawnSync(
    "bash",
    ["--noprofile", "--norc", "-eo", "pipefail", join(dir, "step.sh")],
    {
      cwd: cwd ?? dir,
      encoding: "utf8",
      timeout: CHILD_TIMEOUT_MS,
      env: {
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        HOME: dir,
        LC_ALL: "C.UTF-8",
        RUNNER_TEMP: dir,
        GITHUB_OUTPUT: join(dir, "output"),
        GITHUB_STEP_SUMMARY: join(dir, "summary"),
        GH_LOG: join(dir, "gh.log"),
        INLINE_LOG: join(dir, "inline.log"),
        COMMENT_OUT: join(dir, "comment.md"),
        REPO: "o/r",
        ...doc.env,
        ...env,
      },
    },
  );
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, dir };
}

const read = (dir: string, f: string) => readFileSync(join(dir, f), "utf8");

function outputs(dir: string): Record<string, string> {
  return Object.fromEntries(
    read(dir, "output")
      .split("\n")
      .filter((l) => l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );
}

describe("Resolve target", () => {
  const script = stepRun("Resolve target");

  function prJson(dir: string, over: Record<string, unknown> = {}) {
    const pr = {
      state: "open",
      head: { sha: SHA, repo: { full_name: "o/r" } },
      user: { login: "someone" },
      base: { ref: "main" },
      ...over,
    };
    const path = join(dir, "pr.json");
    writeFileSync(path, JSON.stringify(pr));
    return path;
  }

  function dispatch(inputs: Record<string, string>, pr: Record<string, unknown> = {}) {
    const dir = makeTempDir("claude-review-pr-");
    return runStep(script, {
      EVENT_NAME: "workflow_dispatch",
      INPUT_PR: "12",
      INPUT_SHA: SHA,
      INPUT_EFFORT: "",
      VAR_EFFORT: "",
      PR_JSON: prJson(dir, pr),
      ...inputs,
    });
  }

  test("pull_request では、イベントの PR と SHA を使い、effort はリポジトリ変数が無ければ DEFAULT_EFFORT にする", () => {
    const dir = makeTempDir("claude-review-pr-");
    const res = runStep(script, {
      EVENT_NAME: "pull_request",
      EVENT_PR: "7",
      EVENT_SHA: SHA,
      VAR_EFFORT: "",
      PR_JSON: prJson(dir),
    });
    expect(res.status, res.stderr + res.stdout).toBe(0);
    expect(outputs(res.dir)).toMatchObject({
      pr: "7",
      sha: SHA,
      effort: doc.env.DEFAULT_EFFORT,
      base_ref: "main",
    });
  });

  test("dispatch の effort は、入力・リポジトリ変数・DEFAULT_EFFORT の順に決める", () => {
    expect(outputs(dispatch({ INPUT_EFFORT: "low", VAR_EFFORT: "max" }).dir).effort).toBe("low");
    expect(outputs(dispatch({ VAR_EFFORT: "max" }).dir).effort).toBe("max");
    expect(outputs(dispatch({}).dir).effort).toBe(doc.env.DEFAULT_EFFORT);
  });

  test("dispatch で、SHA が PR の HEAD・同じリポジトリ・open・Dependabot でない、のすべてを満たせば進む", () => {
    const res = dispatch({ INPUT_EFFORT: "medium" });
    expect(res.status, res.stderr + res.stdout).toBe(0);
    expect(outputs(res.dir)).toMatchObject({ pr: "12", sha: SHA, effort: "medium" });
  });

  test("dry_run は、dispatch の入力が true のときだけ true にし、入力が無い dispatch と pull_request では false にする", () => {
    expect(outputs(dispatch({ INPUT_DRY_RUN: "true" }).dir).dry_run).toBe("true");
    expect(outputs(dispatch({ INPUT_DRY_RUN: "false" }).dir).dry_run).toBe("false");
    expect(outputs(dispatch({}).dir).dry_run).toBe("false");
    const dir = makeTempDir("claude-review-pr-");
    const pr = runStep(script, {
      EVENT_NAME: "pull_request",
      EVENT_PR: "7",
      EVENT_SHA: SHA,
      VAR_EFFORT: "",
      INPUT_DRY_RUN: "true",
      PR_JSON: prJson(dir),
    });
    expect(outputs(pr.dir).dry_run).toBe("false");
  });

  test("dry_run でも、dispatch の検査（SHA が PR の HEAD・open）は同じに当てる", () => {
    const stale = dispatch(
      { INPUT_DRY_RUN: "true" },
      { head: { sha: OTHER_SHA, repo: { full_name: "o/r" } } },
    );
    expect(stale.status).toBe(1);
    expect(stale.stdout).toContain("一致しない");
    const closed = dispatch({ INPUT_DRY_RUN: "true" }, { state: "closed" });
    expect(closed.status).toBe(1);
    expect(closed.stdout).toContain("open でない");
  });

  test.each([
    ["SHA が HEAD と違う", { head: { sha: OTHER_SHA, repo: { full_name: "o/r" } } }, "一致しない"],
    ["HEAD が fork", { head: { sha: SHA, repo: { full_name: "fork/r" } } }, "同じリポジトリ"],
    ["HEAD のリポジトリが削除済み", { head: { sha: SHA, repo: null } }, "同じリポジトリ"],
    ["PR が closed", { state: "closed" }, "open でない"],
    ["Dependabot の PR", { user: { login: "dependabot[bot]" } }, "Dependabot"],
  ])("dispatch で %s なら止まり、何も出力しない", (_label, pr, message) => {
    const res = dispatch({}, pr);
    expect(res.status).toBe(1);
    expect(res.stdout).toContain(message);
    expect(read(res.dir, "output")).toBe("");
  });

  test.each([
    ["PR の番号に数字以外", { INPUT_PR: "12 --x" }],
    ["PR の番号が 0 始まり", { INPUT_PR: "012" }],
    ["短い SHA", { INPUT_SHA: SHA.slice(0, 7) }],
    ["大文字の SHA", { INPUT_SHA: SHA.toUpperCase() }],
    ["改行を含む SHA", { INPUT_SHA: `${SHA}\n${SHA}` }],
    ["語彙に無い effort", { INPUT_EFFORT: "ultra" }],
    ["空白を含む effort", { INPUT_EFFORT: "high --tools Bash" }],
    ["真偽値でない dry_run", { INPUT_DRY_RUN: "yes" }],
  ])("%s は、PR を取得する前に止まる", (_label, inputs) => {
    const res = dispatch(inputs);
    expect(res.status).toBe(1);
    expect(read(res.dir, "gh.log")).toBe("");
    expect(read(res.dir, "output")).toBe("");
  });
});

describe("Resolve options", () => {
  const script = stepRun("Resolve options");
  const run = (model: string, maxTurns: string) =>
    runStep(script, { CLAUDE_REVIEW_MODEL: model, CLAUDE_REVIEW_MAX_TURNS: maxTurns });

  test("変数が無ければ --model を渡さず、往復の上限は DEFAULT_MAX_TURNS にする", () => {
    const res = run("", "");
    expect(res.status, res.stderr + res.stdout).toBe(0);
    expect(outputs(res.dir)).toEqual({ model_args: "", max_turns: doc.env.DEFAULT_MAX_TURNS });
  });

  test.each(["opus", "claude-opus-5-5", "us.anthropic.claude:1"])("モデル名 %s は通す", (model) => {
    const res = run(model, "30");
    expect(res.status, res.stderr + res.stdout).toBe(0);
    expect(outputs(res.dir)).toEqual({ model_args: `--model ${model}`, max_turns: "30" });
  });

  test.each([
    ["空白を含むモデル名", "opus --tools Bash", ""],
    ["引用符を含むモデル名", 'opus"', ""],
    ["- で始まるモデル名", "-x", ""],
    ["改行を含むモデル名", "opus\n--tools Bash", ""],
    ["往復の上限が 0", "", "0"],
    ["往復の上限が 1000", "", "1000"],
    ["往復の上限に空白", "", "6 --x"],
  ])("%s なら止まり、何も出力しない", (_label, model, maxTurns) => {
    const res = run(model, maxTurns);
    expect(res.status).toBe(1);
    expect(read(res.dir, "output")).toBe("");
  });
});

describe("Post review", () => {
  const script = stepRun("Post review");
  const base = {
    PR: "12",
    SHA,
    EFFORT: "high",
    RUN_ID: "345",
    RUN_URL: "https://example.invalid/run/345",
    CLAUDE_CODE_OAUTH_TOKEN: "oauth-value-xyz",
    GITHUB_TOKEN_VALUE: "github-token-value-xyz",
    // 段の env の値をそのまま使い、ワークフローの正規表現を確かめる。
    SECRET_FORMS: step("Post review").env?.SECRET_FORMS ?? "",
  };
  /** 実行記録（SDK のメッセージの配列）を書いて段を実行する。null なら実行記録が無い状態にする。 */
  const postRaw = (execution: string | null, env: Record<string, string> = {}) => {
    const file = join(makeTempDir("claude-review-exec-"), "execution.json");
    if (execution !== null) writeFileSync(file, execution);
    return runStep(script, { ...base, EXECUTION_FILE: execution === null ? "" : file, ...env });
  };
  const post = (result: unknown, env: Record<string, string> = {}) =>
    postRaw(
      JSON.stringify([
        { type: "system", subtype: "init" },
        { type: "result", subtype: "success", structured_output: result },
      ]),
      env,
    );
  const marker = (findings: number, open: number) =>
    `<!-- claude-review sha=${SHA} findings=${findings} open=${open} effort=high run=345 -->`;

  test("指摘 0 件でも、目印を 1 行目に置いた総評を投稿する", () => {
    const res = post({ summary: "問題なし", findings: [] });
    expect(res.status, res.stderr + res.stdout).toBe(0);
    const comment = read(res.dir, "comment.md");
    expect(comment.split("\n")[0]).toBe(marker(0, 0));
    expect(comment).toContain("問題なし");
    expect(read(res.dir, "inline.log")).toBe("");
  });

  test("行の指摘はインラインコメントに、行の無い指摘は総評に書き、件数を目印に入れる", () => {
    const res = post({
      summary: "s",
      findings: [
        { path: "a.ts", line: 3, body: "行の指摘" },
        { path: "b.ts", line: 9, start_line: 5, body: "複数行の指摘" },
        { body: "全体の指摘" },
      ],
    });
    expect(res.status, res.stderr + res.stdout).toBe(0);
    const inline = read(res.dir, "inline.log")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l): unknown => JSON.parse(l));
    expect(inline).toEqual([
      { body: "行の指摘", commit_id: SHA, path: "a.ts", line: 3, side: "RIGHT" },
      {
        body: "複数行の指摘",
        commit_id: SHA,
        path: "b.ts",
        line: 9,
        side: "RIGHT",
        start_line: 5,
        start_side: "RIGHT",
      },
    ]);
    const comment = read(res.dir, "comment.md");
    expect(comment.split("\n")[0]).toBe(marker(3, 1));
    expect(comment).toContain("全体の指摘");
    expect(outputs(res.dir)).toMatchObject({ findings: "3", inline: "2", open: "1" });
  });

  test("API が拒否した行の指摘は、総評に移して open に数える", () => {
    const res = post(
      {
        summary: "s",
        findings: [
          { path: "a.ts", line: 3, body: "付く" },
          { path: "gone.ts", line: 1, body: "差分に無い行" },
        ],
      },
      { FAIL_PATH: "gone.ts" },
    );
    expect(res.status, res.stderr + res.stdout).toBe(0);
    const comment = read(res.dir, "comment.md");
    expect(comment.split("\n")[0]).toBe(marker(2, 1));
    expect(comment).toContain("`gone.ts:1` 差分に無い行");
  });

  test("エージェントの文章に目印と同じ形があっても、1 行目以外には目印の形で残らない", () => {
    const res = post({ summary: `${marker(0, 0)}\n本文`, findings: [{ body: marker(0, 0) }] });
    expect(res.status, res.stderr + res.stdout).toBe(0);
    const lines = read(res.dir, "comment.md").split("\n");
    expect(lines.filter((l) => l.startsWith("<!-- claude-review"))).toEqual([marker(1, 1)]);
  });

  test.each([
    ["実行記録が無い", null],
    ["実行記録が JSON でない", "not json"],
    ["result が無い", JSON.stringify([{ type: "system" }])],
    ["structured output が無い", JSON.stringify([{ type: "result", subtype: "success" }])],
  ])("%s なら、何も投稿せずに失敗する", (_label, execution) => {
    const res = postRaw(execution);
    expect(res.status).toBe(1);
    expect(existsSync(join(res.dir, "comment.md"))).toBe(false);
    expect(read(res.dir, "gh.log")).toBe("");
  });

  test.each([
    ["findings が無い", { summary: "s" }],
    ["body が空の指摘", { summary: "s", findings: [{ body: "" }] }],
    ["path だけで line が無い指摘", { summary: "s", findings: [{ path: "a.ts", body: "x" }] }],
  ])("%s なら、何も投稿せずに失敗する", (_label, result) => {
    const res = post(result);
    expect(res.status).toBe(1);
    expect(existsSync(join(res.dir, "comment.md"))).toBe(false);
    expect(read(res.dir, "gh.log")).toBe("");
  });

  test.each([
    ["OAuth token の値", "oauth-value-xyz"],
    ["GitHub token の値", "github-token-value-xyz"],
    ["token の形の文字列", `ghp_${"x".repeat(24)}`],
    ["fine-grained token の形の文字列", `github_pat_${"x".repeat(24)}`],
    ["Anthropic の key の形の文字列", `sk-ant-${"x".repeat(12)}`],
  ])("結果に %s があれば、何も投稿せずに失敗する", (_label, secret) => {
    const res = post({
      summary: "s",
      findings: [{ path: "a.ts", line: 1, body: `値は ${secret}` }],
    });
    expect(res.status).toBe(1);
    expect(read(res.dir, "gh.log")).toBe("");
    // 検出されることの確認: 同じ形で資格情報が無ければ投稿する。
    const ok = post({ summary: "s", findings: [{ path: "a.ts", line: 1, body: "値は無い" }] });
    expect(ok.status, ok.stderr + ok.stdout).toBe(0);
  });

  test("dry_run では、PR に何も書かず（目印も書かない）、検査を通った結果をファイルに残す", () => {
    const result = {
      summary: "s",
      findings: [{ path: "a.ts", line: 3, body: "行の指摘" }, { body: "全体の指摘" }],
    };
    const res = post(result, { DRY_RUN: "true" });
    expect(res.status, res.stderr + res.stdout).toBe(0);
    expect(read(res.dir, "gh.log")).toBe("");
    expect(existsSync(join(res.dir, "comment.md"))).toBe(false);
    const saved: unknown = JSON.parse(read(res.dir, "claude-review-result/review-result.json"));
    expect(saved).toEqual(result);
    expect(outputs(res.dir)).toMatchObject({ findings: "2" });
    // 検出されることの確認: DRY_RUN が false なら、同じ結果を投稿する。
    const posted = post(result, { DRY_RUN: "false" });
    expect(posted.status, posted.stderr + posted.stdout).toBe(0);
    expect(read(posted.dir, "comment.md").split("\n")[0]).toBe(marker(2, 1));
    expect(existsSync(join(posted.dir, "claude-review-result"))).toBe(false);
  });

  test("dry_run でも、結果に資格情報があれば、ファイルに残さずに失敗する", () => {
    const res = post(
      { summary: "s", findings: [{ body: "値は oauth-value-xyz" }] },
      { DRY_RUN: "true" },
    );
    expect(res.status).toBe(1);
    expect(existsSync(join(res.dir, "claude-review-result"))).toBe(false);
    expect(read(res.dir, "gh.log")).toBe("");
  });

  test("実行記録に result が複数あれば最後のものを使い、オブジェクトでない要素は読み飛ばす", () => {
    const res = postRaw(
      JSON.stringify([
        "文字列の要素",
        null,
        { type: "result", structured_output: { summary: "古い総評", findings: [] } },
        { type: "assistant" },
        { type: "result", structured_output: { summary: "新しい総評", findings: [] } },
        42,
      ]),
    );
    expect(res.status, res.stderr + res.stdout).toBe(0);
    const comment = read(res.dir, "comment.md");
    expect(comment).toContain("新しい総評");
    expect(comment).not.toContain("古い総評");
  });

  test("総評が上限より長くても、文字の途中で切らずに目印付きで投稿する", () => {
    // 切る位置に複数バイトの文字を置く。結果は実行記録から読むので、環境変数 1 つの上限（128 KiB）を超える長さでも投稿できる。
    const res = post({ summary: "a".repeat(59000) + "あ".repeat(50000), findings: [] });
    expect(res.status, res.stderr + res.stdout).toBe(0);
    const comment = read(res.dir, "comment.md");
    expect(comment.split("\n")[0]).toBe(marker(0, 0));
    // UTF-16 の単位の長さは文字数以上なので、これが上限を下回れば文字数も下回る。
    expect(comment.length).toBeLessThan(65536);
    expect(comment).not.toContain("�");
    expect(comment).toContain("省いた");
  });
});

describe("Collect review inputs", () => {
  const script = stepRun("Collect review inputs");
  const MARK = (sha: string, run: string) =>
    `<!-- claude-review sha=${sha} findings=1 open=0 effort=high run=${run} -->\n本文`;

  /** main と、そこから 2 commit 進んだ HEAD を持つリポジトリを作り、HEAD と 1 つ前の SHA を返す。 */
  function makeRepo() {
    const repo = makeTempDir("claude-review-repo-");
    const git = (...args: string[]) => {
      const r = spawnSync("git", args, { cwd: repo, encoding: "utf8", timeout: CHILD_TIMEOUT_MS });
      expect(r.status, r.stderr).toBe(0);
      return r.stdout.trim();
    };
    git("init", "-q", "-b", "main");
    git("config", "user.email", "t@example.invalid");
    git("config", "user.name", "t");
    writeFileSync(join(repo, "f.txt"), "base\n");
    git("add", ".");
    git("commit", "-q", "-m", "base");
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    writeFileSync(join(repo, "f.txt"), "base\nfirst\n");
    git("commit", "-q", "-am", "first");
    writeFileSync(join(repo, "f.txt"), "base\nfirst\nsecond\n");
    git("commit", "-q", "-am", "second");
    return { repo, git };
  }

  type Comment = { user: { login: string }; body: string };

  /** 偽の gh が返す応答（コメント・スレッド）と、Resolve target が保存する PR を書き、その場所を env の形で返す。 */
  function writeApiResponses(comments: Comment[], threads: unknown[]) {
    const tmp = makeTempDir("claude-review-collect-");
    const write = (name: string, value: unknown) => {
      const path = join(tmp, name);
      writeFileSync(path, JSON.stringify(value));
      return path;
    };
    return {
      COMMENTS_JSON: write(
        "comments.json",
        comments.map((c) => ({ ...c, created_at: "2026-01-01T00:00:00Z" })),
      ),
      TARGET_PR_JSON: write("target-pr.json", {
        number: 12,
        title: "タイトル",
        body: "本文",
        user: { login: "author" },
        base: { ref: "main" },
        head: { ref: "feature" },
        html_url: "https://example.invalid/pull/12",
      }),
      THREADS_JSON: write("threads.json", {
        data: { repository: { pullRequest: { reviewThreads: { nodes: threads } } } },
      }),
    };
  }

  /** コメントは HEAD と 1 つ前の SHA から作る（目印に実在の SHA を書くため）。 */
  function collect(
    makeComments: (head: string, first: string) => Comment[],
    prepare?: (repo: string, git: (...args: string[]) => string) => void,
    threads: unknown[] = [],
  ) {
    const { repo, git } = makeRepo();
    prepare?.(repo, git);
    const head = git("rev-parse", "HEAD");
    const first = git("rev-parse", "HEAD~1");
    const res = runStep(
      script,
      {
        PR: "12",
        SHA: head,
        BASE_REF: "main",
        ...writeApiResponses(makeComments(head, first), threads),
      },
      repo,
    );
    expect(res.status, res.stderr + res.stdout).toBe(0);
    const input = join(repo, doc.env.INPUT_DIR ?? "");
    return { res, head, first, input };
  }

  test("pr.json は Resolve target が検査した PR から作る", () => {
    const { res, input } = collect(() => []);
    expect(JSON.parse(read(input, "pr.json"))).toEqual({
      number: 12,
      title: "タイトル",
      body: "本文",
      author: "author",
      base: "main",
      head: "feature",
      url: "https://example.invalid/pull/12",
    });
    expect(read(res.dir, "gh.log")).not.toContain("pr view");
  });

  test("threads.md に、解決済みか・古い行か・返信の本文と、載せきれなかった件数を書く", () => {
    const comment = (login: string | null, body: string) => ({
      author: login === null ? null : { login },
      createdAt: "2026-01-01T00:00:00Z",
      body,
    });
    const { input } = collect(() => [], undefined, [
      {
        isResolved: true,
        isOutdated: false,
        path: "a.ts",
        line: 3,
        originalLine: 3,
        comments: {
          totalCount: 2,
          nodes: [comment("bot", "指摘 A"), comment("author", "直さない理由")],
        },
      },
      {
        isResolved: false,
        isOutdated: true,
        path: "b.ts",
        line: null,
        originalLine: 7,
        comments: { totalCount: 150, nodes: [comment(null, "指摘 B")] },
      },
    ]);
    const md = read(input, "threads.md");
    expect(md).toContain("## a.ts:3（解決済み）");
    expect(md).toContain("### author（2026-01-01T00:00:00Z）\n\n直さない理由");
    expect(md).toContain("## b.ts:7（未解決・古い行）");
    expect(md).toContain("### 削除されたユーザー");
    expect(md).toContain("コメント 150 件のうち、最初の 1 件");
    expect(md).not.toMatch(/a\.ts[^\n]*\n[\s\S]*件のうち[\s\S]*## b\.ts/);
  });

  test.each([
    ["base を取り込んだ（merge commit がある）", false],
    ["rebase した（前回の commit が残っていて、HEAD の祖先でない）", true],
  ])("%s後も、since.diff は PR が変えたファイルだけに絞る", (_label, rebase) => {
    // 前回レビューした commit（previous）の後に、base のブランチが別のファイル（g.txt）を変えて進む。
    // PR はそれを取り込み（merge か rebase）、さらに f.txt を変える。since.diff に g.txt が入ってはいけない。
    let previous = "";
    const { input } = collect(
      () => [{ user: { login: "github-actions[bot]" }, body: MARK(previous, "1") }],
      (repo, git) => {
        previous = git("rev-parse", "HEAD");
        git("checkout", "-q", "-b", "base-moved", "refs/remotes/origin/main");
        writeFileSync(join(repo, "g.txt"), "base 側の変更\n");
        git("add", "g.txt");
        git("commit", "-q", "-m", "base moved");
        git("update-ref", "refs/remotes/origin/main", "HEAD");
        git("checkout", "-q", "main");
        if (rebase) git("rebase", "-q", "base-moved");
        else git("merge", "-q", "--no-edit", "base-moved");
        writeFileSync(join(repo, "f.txt"), "base\nfirst\nsecond\nthird\n");
        git("commit", "-q", "-am", "third");
      },
    );
    const since = read(input, "since.diff");
    expect(since).toContain("+third");
    expect(since).not.toContain("g.txt");
    expect(read(input, "full.diff")).not.toContain("g.txt");
    expect(read(input, "README.md")).toContain(`前回レビューした commit は ${previous}`);
  });

  type Git = (...args: string[]) => string;

  /**
   * before で前回までの状態を作り、その HEAD を前回の目印にしてから after で後の変更を作る。
   * after の前に、base のブランチが moved のファイルを変えて進み、PR がそれを merge で取り込む。
   */
  function sinceAfter(
    before: (repo: string, git: Git) => void,
    after: (repo: string, git: Git) => void,
    moved: Record<string, string> = { "g.txt": "base 側の変更\n" },
  ) {
    let previous = "";
    const { input } = collect(
      () => [{ user: { login: "github-actions[bot]" }, body: MARK(previous, "1") }],
      (repo, git) => {
        before(repo, git);
        previous = git("rev-parse", "HEAD");
        git("checkout", "-q", "-b", "base-moved", "refs/remotes/origin/main");
        for (const [name, content] of Object.entries(moved))
          writeFileSync(join(repo, name), content);
        git("add", "-A");
        git("commit", "-q", "-m", "base moved");
        git("update-ref", "refs/remotes/origin/main", "HEAD");
        git("checkout", "-q", "main");
        git("merge", "-q", "--no-edit", "base-moved");
        after(repo, git);
      },
    );
    return {
      input,
      since: existsSync(join(input, "since.diff")) ? read(input, "since.diff") : null,
    };
  }

  test("ファイル名の [ ] をワイルドカードとして読まず、名前が一致するファイルだけを since.diff に入れる", () => {
    const { since } = sinceAfter(
      () => {},
      (repo, git) => {
        writeFileSync(join(repo, "x[ab].txt"), "PR の変更\n");
        git("add", "-A");
        git("commit", "-q", "-m", "pr");
      },
      { "xa.txt": "base 側の変更\n" },
    );
    expect(since).toContain("x[ab].txt");
    expect(since).not.toContain("xa.txt");
  });

  test("前回の後に base と同じ内容へ戻したファイルも since.diff に入れる", () => {
    const { since } = sinceAfter(
      (repo, git) => {
        writeFileSync(join(repo, "h.txt"), "前回までに足したファイル\n");
        git("add", "-A");
        git("commit", "-q", "-m", "add h");
      },
      (_repo, git) => {
        git("rm", "-q", "h.txt");
        git("commit", "-q", "-m", "remove h");
      },
    );
    expect(since).toContain("deleted file");
    expect(since).toContain("h.txt");
    expect(since).not.toContain("g.txt");
  });

  test("前回の後の rename は、元の名前の削除と新しい名前の追加の両方を since.diff に入れる", () => {
    // base にあり PR がまだ触れていない r.txt を、内容を変えずに rename する。
    // rename として扱うと、ファイルの一覧に元の名前（r.txt）が出ず、削除が since.diff から抜ける。
    const { since } = sinceAfter(
      (repo, git) => {
        // 前回より前に、base が r.txt を足し、PR がそれを取り込む。
        git("checkout", "-q", "-b", "base-r", "refs/remotes/origin/main");
        writeFileSync(
          join(repo, "r.txt"),
          "base にある、PR がまだ触れていないファイル\n".repeat(5),
        );
        git("add", "-A");
        git("commit", "-q", "-m", "base adds r");
        git("update-ref", "refs/remotes/origin/main", "HEAD");
        git("checkout", "-q", "main");
        git("merge", "-q", "--no-edit", "base-r");
      },
      (_repo, git) => {
        git("mv", "r.txt", "r2.txt");
        git("commit", "-q", "-m", "rename");
      },
    );
    expect(since).toContain("--- a/r.txt");
    expect(since).toContain("+++ b/r2.txt");
    expect(since).not.toContain("g.txt");
  });

  test("前回までの rename を前回の後に戻したときも、両方の名前を since.diff に入れる", () => {
    // 前回の時点で PR は base の r.txt を r2.txt に rename していた。前回の後に r.txt へ戻すと、
    // 今の時点では base と同じなので full.diff に出ない。前回の時点の一覧が rename を 1 つの名前にまとめると、r.txt が抜ける。
    const { since } = sinceAfter(
      (repo, git) => {
        git("checkout", "-q", "-b", "base-r", "refs/remotes/origin/main");
        writeFileSync(join(repo, "r.txt"), "base にあるファイル\n".repeat(5));
        git("add", "-A");
        git("commit", "-q", "-m", "base adds r");
        git("update-ref", "refs/remotes/origin/main", "HEAD");
        git("checkout", "-q", "main");
        git("merge", "-q", "--no-edit", "base-r");
        git("mv", "r.txt", "r2.txt");
        git("commit", "-q", "-m", "rename");
      },
      (_repo, git) => {
        git("mv", "r2.txt", "r.txt");
        git("commit", "-q", "-m", "rename back");
      },
    );
    expect(since).toContain("--- a/r2.txt");
    expect(since).toContain("+++ b/r.txt");
    expect(since).not.toContain("g.txt");
  });

  test("前回の commit と base のブランチに共通の祖先が無ければ since.diff を作らず、README にそう書く", () => {
    let previous = "";
    const { res, input } = collect(
      () => [{ user: { login: "github-actions[bot]" }, body: MARK(previous, "1") }],
      (repo, git) => {
        git("checkout", "-q", "--orphan", "unrelated");
        writeFileSync(join(repo, "f.txt"), "履歴の無い内容\n");
        git("add", "-A");
        git("commit", "-q", "-m", "unrelated");
        previous = git("rev-parse", "HEAD");
        git("checkout", "-q", "-f", "main");
      },
    );
    expect(outputs(res.dir).previous).toBe(previous);
    expect(existsSync(join(input, "since.diff"))).toBe(false);
    expect(read(input, "README.md")).toContain("git merge-base の終了コード: 1");
    expect(read(input, "README.md")).not.toContain("履歴に無い");
  });

  test("取り込みのコンフリクトを base の内容で解消して PR の変更を捨てたファイルも、since.diff に入れる", () => {
    const { since, input } = sinceAfter(
      () => {},
      (repo, git) => {
        // sinceAfter の merge は f.txt で競合しないので、ここで base 側を進めてから競合させる。
        git("checkout", "-q", "base-moved");
        writeFileSync(join(repo, "f.txt"), "base 側の f\n");
        git("commit", "-q", "-am", "base changes f");
        git("update-ref", "refs/remotes/origin/main", "HEAD");
        git("checkout", "-q", "main");
        const merge = spawnSync("git", ["merge", "-q", "base-moved"], {
          cwd: repo,
          encoding: "utf8",
          timeout: CHILD_TIMEOUT_MS,
        });
        // 前提: f.txt でコンフリクトして merge が止まる。
        expect(merge.status, merge.stderr).toBe(1);
        expect(git("diff", "--name-only", "--diff-filter=U")).toBe("f.txt");
        git("checkout", "--theirs", "f.txt");
        git("add", "f.txt");
        git("commit", "-q", "--no-edit");
      },
    );
    expect(since).toContain("f.txt");
    expect(since).toContain("-second");
    // f.txt は今の時点で base と同じなので full.diff に出ず、前回の時点の一覧からだけ拾われる。
    expect(read(input, "full.diff")).not.toContain("f.txt");
  });

  test("merge の 2 番目の親の側の commit が base と同じ内容へ戻したファイルも、since.diff に入れる", () => {
    const { since } = sinceAfter(
      (repo, git) => {
        writeFileSync(join(repo, "h.txt"), "前回までに足したファイル\n");
        git("add", "-A");
        git("commit", "-q", "-m", "add h");
      },
      (repo, git) => {
        // 別の branch で h.txt を消し、手元の別の commit の後に merge する（git pull の merge と同じ形）。
        git("checkout", "-q", "-b", "remote-side");
        git("rm", "-q", "h.txt");
        git("commit", "-q", "-m", "remove h");
        git("checkout", "-q", "main");
        writeFileSync(join(repo, "a.txt"), "手元の変更\n");
        git("add", "-A");
        git("commit", "-q", "-m", "local");
        git("merge", "-q", "--no-edit", "remote-side");
      },
    );
    expect(since).toContain("deleted file");
    expect(since).toContain("h.txt");
    expect(since).not.toContain("g.txt");
  });

  test("PR が変えたファイルが無ければ、空の since.diff を作り、base 側の変更を入れない", () => {
    const { since } = sinceAfter(
      (repo, git) => {
        // PR 全体を base と同じ内容に戻す。
        writeFileSync(join(repo, "f.txt"), "base\n");
        git("commit", "-q", "-am", "revert all");
      },
      (_repo, git) => {
        git("commit", "-q", "--allow-empty", "-m", "empty");
      },
    );
    expect(since).toBe("");
  });

  test("前回の目印が無ければ初回として full.diff だけを作る", () => {
    const { res, input } = collect(() => []);
    expect(outputs(res.dir).previous).toBe("");
    expect(read(input, "full.diff")).toContain("+second");
    expect(existsSync(join(input, "since.diff"))).toBe(false);
  });

  test("作業ツリーに同じ名前のディレクトリがあっても、ワークフローが書いたファイルだけを残す", () => {
    const { res, input } = collect(
      () => [],
      (repo) => {
        const dir = join(repo, doc.env.INPUT_DIR ?? "");
        mkdirSync(dir);
        writeFileSync(join(dir, "since.diff"), "仕込まれた差分\n");
      },
    );
    expect(outputs(res.dir).previous).toBe("");
    expect(existsSync(join(input, "since.diff"))).toBe(false);
  });

  test("github-actions[bot] の目印のうち、HEAD と違う最後の SHA から since.diff を作る", () => {
    const { res, first, input } = collect((headSha, firstSha) => [
      { user: { login: "github-actions[bot]" }, body: MARK(OTHER_SHA, "1") },
      { user: { login: "github-actions[bot]" }, body: MARK(firstSha, "2") },
      // HEAD をレビューした目印と、人が書いた同じ形のコメントは、前回の目印として扱わない。
      { user: { login: "github-actions[bot]" }, body: MARK(headSha, "3") },
      { user: { login: "someone" }, body: MARK(OTHER_SHA, "4") },
    ]);
    expect(outputs(res.dir).previous).toBe(first);
    const since = read(input, "since.diff");
    expect(since).toContain("+second");
    expect(since).not.toContain("+first");
    expect(read(input, "comments.md")).toContain("someone");
  });

  test("前回の SHA が履歴に無ければ since.diff を作らず、README にそう書く", () => {
    const { res, input } = collect(() => [
      { user: { login: "github-actions[bot]" }, body: MARK(OTHER_SHA, "1") },
    ]);
    expect(outputs(res.dir).previous).toBe(OTHER_SHA);
    expect(existsSync(join(input, "since.diff"))).toBe(false);
    expect(read(input, "README.md")).toContain("履歴に無い");
  });
});

// action は agent モードで、github_token を使わせる設定を作業ツリーの git の設定に書き込む。
// 作業ツリーの中を許可する規則だけでは、その設定も読める。拒否の規則 Read(./.git/**) が Read・Grep・Glob の 3 つに当たることは、
// 手元の claude -p で確かめた（docs/claude-review.md「危険と対策」）。ここでは、宣言から拒否の規則が消えていないことを確かめる。
describe("Run Claude Code の claude_args", () => {
  const args = step("Run Claude Code").with?.claude_args ?? "";

  test("使えるツールを読み取りの 3 つに限り、git の設定のディレクトリの読み取りを拒否する", () => {
    expect(args).toContain('--tools "Read,Grep,Glob"');
    expect(args).toContain("--permission-mode default");
    expect(args).toMatch(/--disallowed-tools "[^"]*Read\(\.\/\.git\/\*\*\)[^"]*"/);
  });
});

// action は許した bot のリポジトリの権限を確かめないので、'*' や他の bot を足すと、外部の App が作った PR や起動した run でも
// エージェントが動く。許すのは、このリポジトリのワークフローだけが actor にできる github-actions[bot] だけである（Issue #1143）。
describe("Run Claude Code の allowed_bots", () => {
  test("github-actions[bot] だけを許す", () => {
    expect(step("Run Claude Code").with?.allowed_bots).toBe("github-actions[bot]");
  });
});

// GitHub Actions の式を、job の if が使う構文（文字列・文脈の参照・`!`・`&&`・`||`・`==`・`!=`・括弧・contains・fromJSON・
// format）だけ評価する。規則は公式の文書の「Operators」と「Functions」に従う。
//   https://docs.github.com/en/actions/reference/workflows-and-actions/expressions
// - 型の違う値の比較は数値に変換する（null・空文字は 0、真偽値は 1 と 0、JSON の数でない文字列は NaN）。文字列どうしは大文字と小文字を区別しない。
// - && と || は、評価した値をそのまま返す。偽になるのは false・0・空文字・null・NaN である。
// - contains の search が配列なら、要素と item を上の比較で比べる。未設定の変数を null とすると、配布元で実際に
//   job を飛ばした run（未設定の変数を contains にそのまま渡した式）と同じ結果になる。
// - 文脈に無い参照は失敗にする。テストの文脈に足し忘れた参照を null として評価すると、条件を足しても結果が変わらない
//   ことがあり、足した条件を確かめないまま通る。未設定の変数は、文脈に null を置いて表す。
type GhaValue = string | number | boolean | null | GhaValue[];
type GhaCtx = Record<string, GhaValue>;
const toNumber = (v: GhaValue): number => {
  if (v === null) return 0;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") return v;
  if (isArray(v)) return Number.NaN;
  if (v === "") return 0;
  return /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(v.trim()) ? Number(v) : Number.NaN;
};
const looseEq = (a: GhaValue, b: GhaValue): boolean => {
  if (typeof a === "string" && typeof b === "string") return a.toLowerCase() === b.toLowerCase();
  if (isArray(a) || isArray(b)) return a === b;
  if (typeof a === typeof b) return a === b;
  return toNumber(a) === toNumber(b);
};
const isTruthy = (v: GhaValue): boolean =>
  !(
    v === false ||
    v === null ||
    v === "" ||
    (typeof v === "number" && (v === 0 || Number.isNaN(v)))
  );
const toStr = (v: GhaValue): string => (v === null ? "" : isArray(v) ? "Array" : String(v));

function toGhaValue(x: unknown): GhaValue {
  if (x === null || typeof x === "string" || typeof x === "number" || typeof x === "boolean") {
    return x;
  }
  if (isArray(x)) return x.map(toGhaValue);
  throw new Error(`評価できない JSON の値: ${JSON.stringify(x)}`);
}

// format は、このワークフローが使う {0} だけを置き換える。
function callGhaFunction(name: string, args: GhaValue[]): GhaValue {
  const [a = null, b = null] = args;
  if (name === "fromJSON") return toGhaValue(JSON.parse(toStr(a)));
  if (name === "format") return toStr(a).replaceAll("{0}", () => toStr(b));
  if (name === "contains") {
    return isArray(a)
      ? a.some((e) => looseEq(e, b))
      : toStr(a).toLowerCase().includes(toStr(b).toLowerCase());
  }
  throw new Error(`評価できない関数: ${name}`);
}

type GhaCursor = { tokens: string[]; i: number; ctx: GhaCtx };
const ghaPeek = (c: GhaCursor): string | undefined => c.tokens[c.i];
function ghaTake(c: GhaCursor, expected?: string): string {
  const tok = c.tokens[c.i++];
  if (expected !== undefined) expect(tok, `式の構文: ${expected} を期待した`).toBe(expected);
  return tok ?? "";
}

function ghaArgs(c: GhaCursor): GhaValue[] {
  ghaTake(c, "(");
  const args: GhaValue[] = [];
  while (ghaPeek(c) !== ")") {
    args.push(ghaOr(c));
    if (ghaPeek(c) !== ")") ghaTake(c, ",");
  }
  ghaTake(c, ")");
  return args;
}

function ghaPrimary(c: GhaCursor): GhaValue {
  const tok = ghaTake(c);
  if (tok === "(") {
    const v = ghaOr(c);
    ghaTake(c, ")");
    return v;
  }
  if (tok.startsWith("'")) return tok.slice(1, -1).replaceAll("''", "'");
  if (tok === "true" || tok === "false") return tok === "true";
  if (tok === "null") return null;
  if (ghaPeek(c) === "(") return callGhaFunction(tok, ghaArgs(c));
  expect(tok, "評価できない項").toMatch(/^[a-z_][\w.-]*$/);
  expect(Object.hasOwn(c.ctx, tok), `文脈に無い参照: ${tok}`).toBe(true);
  return c.ctx[tok] ?? null;
}

function ghaUnary(c: GhaCursor): GhaValue {
  if (ghaPeek(c) !== "!") return ghaPrimary(c);
  ghaTake(c, "!");
  return !isTruthy(ghaUnary(c));
}

function ghaEq(c: GhaCursor): GhaValue {
  const left = ghaUnary(c);
  const op = ghaPeek(c);
  if (op !== "==" && op !== "!=") return left;
  ghaTake(c, op);
  const same = looseEq(left, ghaUnary(c));
  return op === "==" ? same : !same;
}

function ghaAnd(c: GhaCursor): GhaValue {
  let v = ghaEq(c);
  while (ghaPeek(c) === "&&") {
    ghaTake(c, "&&");
    const r = ghaEq(c);
    v = isTruthy(v) ? r : v;
  }
  return v;
}

function ghaOr(c: GhaCursor): GhaValue {
  let v = ghaAnd(c);
  while (ghaPeek(c) === "||") {
    ghaTake(c, "||");
    const r = ghaAnd(c);
    v = isTruthy(v) ? v : r;
  }
  return v;
}

function evalGha(expr: string, ctx: GhaCtx): GhaValue {
  const tokens = expr.match(/'(?:[^']|'')*'|&&|\|\||==|!=|[!(),]|[A-Za-z_][\w.-]*|\S/g) ?? [];
  const c: GhaCursor = { tokens, i: 0, ctx };
  const value = ghaOr(c);
  expect(c.i, `式を最後まで読めない: ${expr}`).toBe(tokens.length);
  return value;
}

// CLAUDE_REVIEW_AUTO を切ったときは、pull_request の job を飛ばし、run を skipped で終える。依頼する側は skipped の run を
// 数えないので、HEAD を未レビューとして workflow_dispatch で依頼できる（claude-review-action.test.ts の request のテスト）。
// 段の中で止めると run が成功で終わり、依頼する側は「一時停止」として依頼しなくなるので、job の if で止める。
describe("自動のレビューの切り替え（CLAUDE_REVIEW_AUTO）", () => {
  const raw = loadYamlAs<{ jobs: { review: { if: string } } }>(
    readFileSync(join(repoRoot, WORKFLOW), "utf8"),
  );
  const cond = raw.jobs.review.if;
  // 最初の || より前が workflow_dispatch の側、後ろの括弧の中が pull_request の側である。
  const dispatchPrefix = "github.event_name == 'workflow_dispatch' || (";

  test("workflow_dispatch の側は、変数を読まない", () => {
    expect(cond.startsWith(dispatchPrefix)).toBe(true);
    expect(cond.endsWith(")")).toBe(true);
  });

  // 未設定の値が null か空文字かを確かめきれていないので、式は 2 つの守りを両方持つ（雛形のコメント）。
  // 下の評価の関数の規則では片方だけでも未設定を扱えるので、片方を消しても評価のテストは落ちない。両方があることをここで固定する。
  test("空でないことの確認と、format で文字列にしてからの比較を、両方持つ", () => {
    expect(cond).toContain("vars.CLAUDE_REVIEW_AUTO != ''");
    expect(cond).toContain("format('{0}', vars.CLAUDE_REVIEW_AUTO)");
  });

  // 以前のテストは式の字面だけを見ていたので、未設定（null）の変数が '0' と等しいと判定されて job を飛ばす誤りを
  // 検出できなかった。ここでは、GitHub の式の規則（下の evalGha）で job の if を評価し、値ごとの結果を固定する。
  const prCtx = (auto: string | null): GhaCtx => ({
    "github.event_name": "pull_request",
    "github.event.pull_request.draft": false,
    "github.event.pull_request.head.repo.full_name": "o/r",
    "github.repository": "o/r",
    "github.event.pull_request.user.login": "someone",
    "github.actor": "someone",
    "vars.CLAUDE_REVIEW_AUTO": auto,
  });
  test.each<[string, string | null, boolean]>([
    ["未設定（null）", null, true],
    ["空文字", "", true],
    ["off", "off", false],
    ["OFF", "OFF", false],
    ["0", "0", false],
    ["false", "false", false],
    ["no", "no", false],
    ["on", "on", true],
    ["1", "1", true],
    ["true", "true", true],
    ["前後に空白のある off", " off ", true],
  ])("pull_request で変数が %s のときに job を実行するかを固定する", (_label, auto, runs) => {
    expect(isTruthy(evalGha(cond, prCtx(auto)))).toBe(runs);
  });

  test("workflow_dispatch は、変数が切る値でも job を実行する", () => {
    expect(
      isTruthy(evalGha(cond, { ...prCtx("off"), "github.event_name": "workflow_dispatch" })),
    ).toBe(true);
  });

  test("検出されることの確認: 変数を contains にそのまま渡す式は、未設定（null）で job を飛ばす", () => {
    const naive = `github.event_name == 'workflow_dispatch' || (!contains(fromJSON('["off","false","no","0"]'), vars.CLAUDE_REVIEW_AUTO))`;
    expect(isTruthy(evalGha(naive, prCtx(null)))).toBe(false);
  });

  // 承認した github-actions[bot] の PR は job を実行し（allowed_bots で action も断らない）、Dependabot の PR は除く（Issue #1143）。
  test.each<{ label: string; author: string; actor: string; runs: boolean }>([
    {
      label: "github-actions[bot] が作り、承認した run",
      author: "github-actions[bot]",
      actor: "github-actions[bot]",
      runs: true,
    },
    {
      label: "github-actions[bot] の PR を人が更新した run",
      author: "github-actions[bot]",
      actor: "someone",
      runs: true,
    },
    { label: "Dependabot の PR", author: "dependabot[bot]", actor: "dependabot[bot]", runs: false },
    {
      label: "Dependabot の PR を人が更新した run",
      author: "dependabot[bot]",
      actor: "someone",
      runs: false,
    },
    {
      label: "人の PR を Dependabot が更新した run",
      author: "someone",
      actor: "dependabot[bot]",
      runs: false,
    },
  ])("pull_request で $label のときに job を実行するかを固定する", ({ author, actor, runs }) => {
    const ctx = {
      ...prCtx(null),
      "github.event.pull_request.user.login": author,
      "github.actor": actor,
    };
    expect(isTruthy(evalGha(cond, ctx))).toBe(runs);
  });

  test("段の中（一時停止の段）では、CLAUDE_REVIEW_AUTO を読まない", () => {
    expect(JSON.stringify(doc.jobs.review.steps)).not.toContain("CLAUDE_REVIEW_AUTO");
  });
});

// 依頼する側（claude-review-action.sh）は、run-name が「Claude review PR #<番号> <SHA>」と一致する run を HEAD の run として数える。
// dry_run の run がこの形だと、目印の無い成功した run として「一時停止した回」に数えられ、その HEAD の依頼が止まる。
describe("dry_run の run の見分け", () => {
  const raw = loadYamlAs<{ "run-name": string; concurrency: { group: string } }>(
    readFileSync(join(repoRoot, WORKFLOW), "utf8"),
  );
  const action = readFileSync(
    join(repoRoot, "skills/pr-finalize-loop/scripts/claude-review-action.sh"),
    "utf8",
  );

  // 式は、このワークフローが使う形（`a || b` と `a && 'x' || 'y'`）だけを GitHub の評価の規則で評価する。
  // 値が falsy（undefined・false・空文字）なら次の項に進み、最後の項の値を返す。
  type Ctx = Record<string, string | boolean | undefined>;
  const operand = (term: string, ctx: Ctx): string | boolean | undefined => {
    const t = term.trim();
    const lit = /^'([^']*)'$/.exec(t);
    if (lit) return lit[1];
    expect(t, "評価できない項").toMatch(/^[a-z_.]+$/);
    return ctx[t];
  };
  const evaluate = (expr: string, ctx: Ctx): string => {
    let value: string | boolean | undefined;
    for (const alt of expr.split("||")) {
      const [cond, then] = alt.split("&&");
      value =
        then === undefined
          ? operand(cond ?? "", ctx)
          : operand(cond ?? "", ctx) && operand(then, ctx);
      if (value) break;
    }
    return value ? String(value) : "";
  };
  const render = (template: string, ctx: Ctx) =>
    template.replace(/\$\{\{(.*?)\}\}/g, (_m, expr: string) => evaluate(expr, ctx));

  const PR = "12";
  const pullRequest: Ctx = {
    "github.workflow": "Claude review",
    "github.event_name": "pull_request",
    "github.event.pull_request.number": PR,
    "github.event.pull_request.head.sha": SHA,
  };
  const dispatch = (dryRun: boolean): Ctx => ({
    "github.workflow": "Claude review",
    "github.event_name": "workflow_dispatch",
    "inputs.pr": PR,
    "inputs.sha": SHA,
    "inputs.dry_run": dryRun,
  });
  // 依頼する側が探す run-name。claude-review-action.sh の title の形に、番号と SHA を入れたもの。
  const counted = `Claude review PR #${PR} ${SHA}`;

  test("run-name は、dry_run でない run では依頼する側が数える形と全体で一致し、dry_run の run では一致しない", () => {
    expect(action).toContain('title="Claude review PR #${number} ${head}"');
    expect(render(raw["run-name"], pullRequest)).toBe(counted);
    expect(render(raw["run-name"], dispatch(false))).toBe(counted);
    expect(render(raw["run-name"], dispatch(true))).toBe(
      `Claude review (dry run) PR #${PR} ${SHA}`,
    );
  });

  test("concurrency の group は、dry_run の run だけを分け、ほかの run は dry_run を足す前と同じ group にする", () => {
    expect(render(raw.concurrency.group, pullRequest)).toBe(`Claude review-pull_request-${PR}`);
    expect(render(raw.concurrency.group, dispatch(false))).toBe(
      `Claude review-workflow_dispatch-${PR}`,
    );
    expect(render(raw.concurrency.group, dispatch(true))).toBe(
      `Claude review-workflow_dispatch-dry-run-${PR}`,
    );
  });

  test("dry_run の結果を残す段は、Post review が成功し dry_run のときだけ動き、再実行では前の試行の結果を上書きする", () => {
    const upload = step("Upload dry-run result");
    expect(upload.if).toBe(
      "steps.post.outcome == 'success' && steps.target.outputs.dry_run == 'true'",
    );
    expect(upload.with?.overwrite).toBe(true);
  });
});
