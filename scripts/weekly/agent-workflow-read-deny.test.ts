// claude-code-action は agent モードで、エージェントを起動する前に github_token を作業ツリーの .git/config（remote の URL）に書く。
// 作業ツリーの中を読む許可（`Read(./**)`）だけでは、その設定も読める。
// 拒否の規則 `Read(./.git/**)` が Read・Grep・Glob とサブエージェントに当たることは、手元の claude -p で確かめた。
// 確かめた内容は .agents/rules/github-actions-authoring.md と Issue #1031 にある。
// 規則が消えても、ほかの検査と run は成功のまま進むので、エージェントを動かすワークフローの宣言をここで確かめる。
// 同じ理由で、使えるツールを --tools で限ることと、リポジトリの設定を読ませないこと（--setting-sources user・--strict-mcp-config）も確かめる。
// 対象は、.github/workflows/ と skills/*/assets/ の YAML のうち、Claude Code の段を持つものすべてである。
import { describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadYamlAs } from "../lib/text/yaml-as.ts";
import { makeTempDir } from "../lib/testing/test-tmpdir.ts";
import { CHILD_TIMEOUT_MS } from "../lib/testing/child-timeout.ts";
import { REPO_ROOT as repoRoot } from "../lib/testing/repo-file.ts";

/** テストが読むワークフローの形（使うフィールドだけ）。 */
type Step = {
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
};
type Workflow = { env?: Record<string, unknown>; jobs: Record<string, { steps?: Step[] }> };

const load = (path: string) => loadYamlAs<Workflow>(readFileSync(join(repoRoot, path), "utf8"));

const steps = (path: string) => Object.values(load(path).jobs).flatMap((j) => j.steps ?? []);

const claudeSteps = (path: string) =>
  steps(path).filter((s) => (s.uses ?? "").startsWith("anthropics/claude-code-action@"));

/** with の値を文字列で取り出す。文字列でなければ空にする（テストが空の値で落ちる）。 */
const withString = (step: Step | undefined, key: string) => {
  const value = step?.with?.[key];
  return typeof value === "string" ? value : "";
};

/** claude_args の option の値を、空白区切りと `=` 区切りの両方で返す。引用符で囲んだ値は引用符を外す。 */
const optionValues = (args: string, option: string) =>
  [...args.matchAll(new RegExp(`(?<!\\S)${option}(?:=|\\s+)("[^"]*"|\\S+)`, "g"))].map((m) =>
    (m[1] ?? "").replace(/^"(.*)"$/, "$1"),
  );

const GIT_DENY = "Read(./.git/**)";

/** ワークフローと配布スキルの雛形のうち、Claude Code の段を持つものを集める（一覧を手で持つと、足したワークフローが抜ける）。 */
function claudeWorkflows() {
  const yml = (dir: string) =>
    readdirSync(join(repoRoot, dir))
      .filter((f) => /\.ya?ml$/.test(f))
      .map((f) => `${dir}/${f}`);
  const assets = readdirSync(join(repoRoot, "skills"), { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(repoRoot, "skills", d.name, "assets")))
    .flatMap((d) => yml(`skills/${d.name}/assets`));
  // 手順の断片の YAML（jobs を持たない）は読まない。
  const hasJobs = (path: string) => /^jobs:/m.test(readFileSync(join(repoRoot, path), "utf8"));
  return [...yml(".github/workflows"), ...assets]
    .filter(hasJobs)
    .filter((path) => claudeSteps(path).length > 0)
    .toSorted();
}

const WORKFLOWS = claudeWorkflows();

// 集める処理が空振りしたときに、どのワークフローも検査せずに通らないよう、知っているものが入っていることを確かめる。
test("Claude Code の段を持つワークフローと雛形を、もれなく集める", () => {
  for (const path of [
    ".github/workflows/self-review.yml",
    ".github/workflows/self-review-fix.yml",
    ".github/workflows/security-audit.yml",
    ".github/workflows/kaizen-schedule.yml",
    ".github/workflows/claude-review.yml",
    "skills/kaizen/assets/kaizen-schedule.yml",
    "skills/pr-finalize-loop/assets/claude-review.yml",
  ]) {
    expect(WORKFLOWS).toContain(path);
  }
});

describe("エージェントに .git/ を読ませない", () => {
  test.each(WORKFLOWS)("%s の Claude Code の段は、Read(./.git/**) を拒否する", (path) => {
    const found = claudeSteps(path);
    // 0 件を合格として扱わない（段を 1 つも見つけられずに通ったテストを根拠にしない）。
    expect(found.length, `${path} に Claude Code の段が無い`).toBeGreaterThan(0);
    for (const step of found) {
      const args = withString(step, "claude_args");
      const denied = optionValues(args, "--disallowed-tools");
      // 2 つ書くと、後のものだけが使われるかを確かめていない。1 つにまとめる。
      expect(denied, `${path} の --disallowed-tools`).toHaveLength(1);
      expect(denied[0]?.split(","), `${path} の --disallowed-tools`).toContain(GIT_DENY);
      // 許可の規則に .git/ を名指しする規則を置かない。拒否の規則を消したときに、名指しの許可が残らないようにする。
      for (const allowed of optionValues(args, "--allowed-tools")) {
        expect(allowed, `${path} の --allowed-tools`).not.toContain(".git/");
      }
    }
  });

  // 権限のモードを渡さないと action のデフォルトになる。auto mode をデフォルトにしたバージョンの action では、
  // 許可の規則に無い呼び出しを安全性の判定で通しうる。bypassPermissions・acceptEdits も同じく通しうる。
  test.each(WORKFLOWS)("%s の Claude Code の段は、権限のモードに default だけを渡す", (path) => {
    const found = claudeSteps(path);
    expect(found.length, `${path} に Claude Code の段が無い`).toBeGreaterThan(0);
    for (const step of found) {
      const args = withString(step, "claude_args");
      // `--permission-mode=<mode>` の形も CLI は受け付けるので、空白と `=` の両方で値を取る。
      expect(optionValues(args, "--permission-mode"), `${path} の --permission-mode`).toStrictEqual(
        ["default"],
      );
      expect(args, path).not.toContain("dangerously-skip-permissions");
    }
  });
});

// 使えるツールを拒否の一覧で限ると、エージェントがツールを足すたびに抜けが出る（#958）。
// リポジトリの .claude/settings.json の Hook と .mcp.json の MCP サーバーは --tools の制限の外で動く（#977）。
// 規約は .agents/rules/github-actions-authoring.md「エージェントのツールが読める場所と書ける場所」にある。
const ALLOWED_TOOL_NAMES = ["Read", "Grep", "Glob", "Edit", "Write", "Agent", "Bash"];

describe("エージェントのツールを限り、リポジトリの設定を読ませない", () => {
  test.each(WORKFLOWS)("%s の Claude Code の段は、--tools で使えるツールを限る", (path) => {
    const found = claudeSteps(path);
    expect(found.length, `${path} に Claude Code の段が無い`).toBeGreaterThan(0);
    for (const step of found) {
      const tools = optionValues(withString(step, "claude_args"), "--tools");
      // 2 つ書くと、どちらが使われるかを確かめていない。1 つにまとめる。
      expect(tools, `${path} の --tools`).toHaveLength(1);
      // `--tools default` はすべての組み込みのツールを使わせる（https://code.claude.com/docs/en/cli-reference）。
      // `*` のような値も限ったことにならないので、ツールの名前を 1 つずつ、知っている名前の一覧と照合する。
      // 新しいツールを使わせるときは、この一覧に足して、レビューで許すかを決める。
      const names = (tools[0] ?? "").split(",");
      expect(names, `${path} の --tools`).not.toContain("");
      for (const name of names) {
        expect(ALLOWED_TOOL_NAMES, `${path} の --tools の ${name}`).toContain(name);
      }
    }
  });

  test.each(WORKFLOWS)("%s の Claude Code の段は、user の設定だけを読み、MCP を限る", (path) => {
    const found = claudeSteps(path);
    expect(found.length, `${path} に Claude Code の段が無い`).toBeGreaterThan(0);
    for (const step of found) {
      const args = withString(step, "claude_args");
      // project・local を含めると、リポジトリの .claude/settings.json の Hook と permissions を読む。
      expect(optionValues(args, "--setting-sources"), `${path} の --setting-sources`).toStrictEqual(
        ["user"],
      );
      expect(args, `${path} の --strict-mcp-config`).toMatch(/(?<!\S)--strict-mcp-config(?!\S)/);
    }
  });
});

// 検証スクリプトは引数のファイルを読み、エラーのメッセージに値を含める。引数を出力のディレクトリの記録に限る。
describe("security-audit.yml は、検証スクリプトの引数を出力のディレクトリの記録に限る", () => {
  const PATH = ".github/workflows/security-audit.yml";
  const OUT = "${{ steps.settings.outputs.runs_dir }}/run-${{ steps.restore.outputs.next }}";
  const SKILL = "${{ steps.settings.outputs.skill_dir }}";
  const expected = [
    `Bash(node ${SKILL}/validate-findings.cjs ${OUT}/findings.json)`,
    `Bash(node ${SKILL}/validate-coverage-ledger.cjs ${OUT}/coverage-ledger.json)`,
  ];

  test("Bash の許可の規則は、2 つの記録を検証するコマンドだけで、ワイルドカードを含まない", () => {
    const [step] = claudeSteps(PATH);
    const allowed = optionValues(withString(step, "claude_args"), "--allowed-tools");
    expect(allowed).toHaveLength(1);
    const bash = (allowed[0] ?? "").split(",").filter((r) => r.startsWith("Bash"));
    expect(bash).toStrictEqual(expected);
  });

  test("prompt は、許可の規則と同じコマンドを示す", () => {
    const prompt = withString(claudeSteps(PATH)[0], "prompt");
    for (const rule of expected) {
      expect(prompt).toContain(`- ${rule.slice("Bash(".length, -1)}\n`);
    }
  });
});

// security-audit.yml の上流のスキルは、監査した commit を記録する。.git/HEAD を読ませない代わりに、ワークフローが渡す。
describe("security-audit.yml は、監査する commit をエージェントに渡す", () => {
  const PATH = ".github/workflows/security-audit.yml";
  const SHA = "0123456789abcdef0123456789abcdef01234567";

  /** Resolve settings の段を実行し、GITHUB_OUTPUT に書いた値を返す。 */
  function resolveSettings(env: Record<string, string>) {
    const doc = load(PATH);
    const step = steps(PATH).find((s) => s.name === "Resolve settings");
    expect(step?.run, "Resolve settings の段").toBeTypeOf("string");
    // makeTempDir は、テストの終わりにディレクトリを消す予約まで済ませる。
    const dir = makeTempDir("security-audit-settings-");
    const script = join(dir, "step.sh");
    const output = join(dir, "output");
    writeFileSync(script, String(step?.run));
    writeFileSync(output, "");
    const res = spawnSync("bash", ["-eo", "pipefail", script], {
      cwd: dir,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        HOME: dir,
        RUNNER_TEMP: dir,
        GITHUB_WORKSPACE: join(dir, "ws"),
        GITHUB_OUTPUT: output,
        DVNA_SHA: String(doc.env?.DVNA_SHA),
        INPUT_PROFILE: "quick",
        INPUT_BUDGET: "40",
        ...env,
      },
      timeout: CHILD_TIMEOUT_MS,
    });
    expect(res.status, res.stderr).toBe(0);
    // GitHub Actions と同じく、同じ名前が続けて書かれたら後の値を使う。
    return Object.fromEntries(
      readFileSync(output, "utf8")
        .split("\n")
        .filter((l) => l.includes("="))
        .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
    );
  }

  test("self を監査するときは、checkout した commit（GITHUB_SHA）を渡す", () => {
    const out = resolveSettings({ INPUT_TARGET: "self", GITHUB_SHA: SHA });
    expect(out.valid).toBe("true");
    expect(out.source_ref).toBe(SHA);
  });

  test("dvna を監査するときは、固定した DVNA_SHA を渡す", () => {
    const dvna = String(load(PATH).env?.DVNA_SHA);
    expect(dvna).toMatch(/^[0-9a-f]{40}$/);
    const out = resolveSettings({ INPUT_TARGET: "dvna", GITHUB_SHA: SHA });
    expect(out.valid).toBe("true");
    expect(out.source_ref).toBe(dvna);
  });

  // 改行の後ろに valid=true を置いた値は、検査で弾いた値をそのまま GITHUB_OUTPUT に書くと、valid を上書きする。
  test.each(["", "0123456", `${SHA}\nx`, `${SHA}\nvalid=true`])(
    "commit が 40 桁の SHA でなければ（%j）、エージェントを起動しない",
    (sha) => {
      const out = resolveSettings({ INPUT_TARGET: "self", GITHUB_SHA: sha });
      expect(out.valid).toBe("false");
      expect(out.source_ref).toBe("");
    },
  );

  test("prompt は、渡した commit を使い、.git/HEAD を読む手順を書かない", () => {
    const [step] = claudeSteps(PATH);
    const prompt = withString(step, "prompt");
    expect(prompt).toContain("Source ref: commit ${{ steps.settings.outputs.source_ref }}");
    expect(prompt).not.toContain(".git/HEAD");
  });
});
