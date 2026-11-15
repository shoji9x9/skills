// claude-code-action は agent モードで、エージェントを起動する前に github_token を作業ツリーの .git/config（remote の URL）に書く。
// 作業ツリーの中を読む許可（`Read(./**)`）だけでは、その設定も読める。
// 拒否の規則 `Read(./.git/**)` が Read・Grep・Glob とサブエージェントに当たることは、手元の claude -p で確かめた。
// 確かめた内容は .agents/rules/github-actions-authoring.md と Issue #1031 にある。
// 規則が消えても、ほかの検査と run は成功のまま進むので、エージェントを動かすワークフローの宣言をここで確かめる。
// .github/workflows/claude-review.yml は scripts/skills/pr-finalize-loop/claude-review-workflow.test.ts が確かめる。
import { describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
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

/** claude_args の、引用符で囲んだ値を持つオプションの値をすべて返す。 */
const optionValues = (args: string, option: string) =>
  [...args.matchAll(new RegExp(`${option} "([^"]*)"`, "g"))].map((m) => m[1] ?? "");

const GIT_DENY = "Read(./.git/**)";

// Claude Code を動かすワークフロー（claude-review.yml を除く）と、kaizen の配布する雛形。
const WORKFLOWS = [
  ".github/workflows/self-review.yml",
  ".github/workflows/self-review-fix.yml",
  ".github/workflows/security-audit.yml",
  ".github/workflows/kaizen-schedule.yml",
  "skills/kaizen/assets/kaizen-schedule.yml",
];

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
      const modes = [...args.matchAll(/--permission-mode(?:=|\s+)(\S+)/g)].map((m) => m[1]);
      expect(modes, `${path} の --permission-mode`).toStrictEqual(["default"]);
      expect(args, path).not.toContain("dangerously-skip-permissions");
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
