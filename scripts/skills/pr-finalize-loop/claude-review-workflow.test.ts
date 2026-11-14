// .github/workflows/claude-review.yml の段（run の本文）を取り出し、偽の gh で実行して振る舞いを確かめる（Issue #1030）。
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
import { loadYamlAs } from "../../lib/text/yaml-as.ts";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const WORKFLOW = ".github/workflows/claude-review.yml";

type Step = {
  name?: string;
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
    [
      "前回から HEAD までに merge commit がある",
      (repo: string, git: (...args: string[]) => string) => {
        git("checkout", "-q", "-b", "side", "HEAD~2");
        writeFileSync(join(repo, "g.txt"), "main の変更\n");
        git("add", "g.txt");
        git("commit", "-q", "-m", "side");
        git("checkout", "-q", "main");
        git("merge", "-q", "--no-edit", "side");
      },
      "merge commit",
    ],
  ])("%s なら since.diff を作らず、README にそう書く", (_label, prepare, message) => {
    // 目印は、merge する前の HEAD（merge の後の HEAD~1 の 1 つ目の親）を指す。
    const { input } = collect(
      (_head, first) => [{ user: { login: "github-actions[bot]" }, body: MARK(first, "1") }],
      prepare,
    );
    expect(existsSync(join(input, "since.diff"))).toBe(false);
    expect(read(input, "README.md")).toContain(message);
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

// action は agent モードで github_token を作業ツリーの git の設定（remote の URL）に書き込む。
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
