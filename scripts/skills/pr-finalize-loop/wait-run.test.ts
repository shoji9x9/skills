// pr-finalize-loop に同梱する wait-run.sh（1 つの Actions の run が終わるか、人の操作を待つか、上限に達するまで待つ）の回帰テスト。
//
// 偽の gh は、取得の回ごとに run の状態の列（fixture の配列）から 1 つずつ返す。列を使い切ったら最後の状態を返し続ける。
//
// | 軸             | 値                                                                           |
// | -------------- | ---------------------------------------------------------------------------- |
// | 状態の列       | 待機中 → 実行中 → 成功 / すぐ失敗 / waiting / action_required / 実行中のまま |
// | 取得           | 成功 / 1 回だけ失敗 / 続けて失敗 / 別の run の応答                           |
// | 上限           | 0（1 回だけ）/ 上限まで終わらない                                            |
import { describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SCRIPT = join(repoRoot, "skills/pr-finalize-loop/scripts/wait-run.sh");

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
args=("$@")
for ((i = 0; i < \${#args[@]}; i++)); do
  [ "\${args[i]}" != "--jq" ] || jq_expr="\${args[i + 1]}"
done
n=$(cat "$dir/n" 2>/dev/null || echo 0)
echo $((n + 1)) >"$dir/n"
[ ! -f "$dir/fail.$n" ] && [ ! -f "$dir/fail" ] || { echo "HTTP 502" >&2; exit 1; }
last=$(($(jq 'length' "$dir/states.json") - 1))
[ "$n" -le "$last" ] || n=$last
jq -c ".[$n]" "$dir/states.json" | jq -r "$jq_expr"
`;

const SHA = "c".repeat(40);
type State = { status: string; conclusion?: string | null; id?: number };

function setupFakeGh() {
  const dir = makeTempDir("wait-run-");
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "gh"), FAKE_GH);
  chmodSync(join(bin, "gh"), 0o755);
  if (JQ) symlinkSync(JQ, join(bin, "jq"));
  return { dir, bin };
}

function waitRun(
  states: State[],
  opts: { timeout?: string; interval?: string; fail?: string[] } = {},
) {
  const { dir, bin } = setupFakeGh();
  writeFileSync(
    join(dir, "states.json"),
    JSON.stringify(
      states.map((s) => ({
        id: s.id ?? 42,
        head_sha: SHA,
        status: s.status,
        conclusion: s.conclusion ?? null,
      })),
    ),
  );
  for (const f of opts.fail ?? []) writeFileSync(join(dir, f), "");
  const r = spawnSync(
    "bash",
    [
      SCRIPT,
      "--repo",
      "o/r",
      "--run",
      "42",
      "--timeout",
      opts.timeout ?? "30",
      "--interval",
      opts.interval ?? "0",
    ],
    {
      encoding: "utf8",
      timeout: CHILD_TIMEOUT_MS,
      env: { PATH: `${bin}:${process.env.PATH}`, HOME: dir, FAKE_GH_DIR: dir },
    },
  );
  const out: Record<string, string> = Object.fromEntries(
    r.stdout
      .trim()
      .split("\n")
      .filter((l) => l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );
  const calls = readFileSync(join(dir, "calls.log"), "utf8").trim().split("\n");
  return { status: r.status, out, stderr: r.stderr, calls };
}

describe("wait-run", () => {
  test("待機中 → 実行中 → 成功の順に変われば、3 回の取得の後に 1 回だけ結果を返す", () => {
    const r = waitRun([
      { status: "queued" },
      { status: "in_progress" },
      { status: "completed", conclusion: "success" },
    ]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.out).toEqual({
      run: "42",
      head_sha: SHA,
      status: "completed",
      conclusion: "success",
      result: "completed",
      polls: "3",
    });
    expect(r.calls).toHaveLength(3);
    expect(r.calls[0]).toContain("repos/o/r/actions/runs/42");
  });

  test("失敗で完了しても completed（exit 0）で、conclusion に失敗を出す", () => {
    const r = waitRun([{ status: "completed", conclusion: "failure" }]);
    expect(r.status).toBe(0);
    expect(r.out).toMatchObject({ result: "completed", conclusion: "failure" });
  });

  test.each([[{ status: "waiting" }], [{ status: "completed", conclusion: "action_required" }]])(
    "人の操作を待つ状態（%j）なら waiting（exit 4）",
    (s) => {
      const r = waitRun([{ status: "in_progress" }, s]);
      expect(r.status).toBe(4);
      expect(r.out).toMatchObject({ result: "waiting", status: s.status, polls: "2" });
    },
  );

  test("上限まで終わらなければ、上限の後にもう 1 回取得してから timeout（exit 1）", () => {
    const r = waitRun([{ status: "in_progress" }], { timeout: "2", interval: "1" });
    expect(r.status).toBe(1);
    expect(r.out).toMatchObject({ result: "timeout", status: "in_progress", conclusion: "" });
    expect(Number(r.out.polls)).toBeGreaterThanOrEqual(2);
  });

  test("上限 0 なら 1 回だけ取得する", () => {
    const r = waitRun([{ status: "queued" }], { timeout: "0" });
    expect(r.status).toBe(1);
    expect(r.out.polls).toBe("1");
  });

  test("1 回だけ取得に失敗しても、次の取得で続ける", () => {
    const r = waitRun([{ status: "completed", conclusion: "success" }], { fail: ["fail.0"] });
    expect(r.status, r.stderr).toBe(0);
    expect(r.out.polls).toBe("2");
  });

  test("続けて取得に失敗したら exit 2 で、timeout を返さない", () => {
    const r = waitRun([{ status: "in_progress" }], { timeout: "0", fail: ["fail"] });
    expect(r.status).toBe(2);
    expect(r.out.result).toBeUndefined();
    expect(r.out.polls).toBe("3");
  });

  test("別の run の応答は、状態として使わない", () => {
    const r = waitRun([{ status: "completed", conclusion: "success", id: 43 }], { timeout: "0" });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/run の応答を解析できない/);
  });

  test.each([
    [["--repo", "o/r", "--run", "42"], /--timeout が無い/],
    [["--repo", "o", "--run", "42", "--timeout", "0"], /--repo は <owner>\/<repo>/],
    [["--repo", "o/r", "--run", "4x", "--timeout", "0"], /--run は run の ID/],
    [["--repo", "o/r", "--run", "42", "--run", "43", "--timeout", "0"], /--run が 2 回渡された/],
  ])("%j は 64 で止まる", (args, msg) => {
    const r = spawnSync("bash", [SCRIPT, ...args], { encoding: "utf8", timeout: CHILD_TIMEOUT_MS });
    expect(r.status).toBe(64);
    expect(r.stderr).toMatch(msg);
  });
});
