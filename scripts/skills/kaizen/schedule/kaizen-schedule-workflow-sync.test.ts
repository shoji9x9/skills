import { assert, describe, test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadYamlAs } from "../../../lib/text/yaml-as.ts";
import { makeTempDir } from "../../../lib/testing/test-tmpdir.ts";
import { coverageEnv } from "../../../lib/testing/coverage-env.ts";
import { CHILD_TIMEOUT_MS } from "../../../lib/testing/child-timeout.ts";

// kaizen の定期実行ワークフローは、配布スキルに同梱したテンプレート
// （skills/kaizen/assets/kaizen-schedule.yml）を原本とし、本リポの
// .github/workflows/kaizen-schedule.yml はその複製。
//
// 複製にしているのは、actionlint / ghalint / pinact が .github/workflows/** しか
// 見ないため。テンプレート側だけを直すと、配布先へ配られる内容が誰にも検査されない
// まま本リポの実物と食い違う（逆も同じ）。プレースホルダを持たない設計にして
// バイト単位で一致させ、ここで決定論的に検査する。
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

const CANON = "skills/kaizen/assets/kaizen-schedule.yml";
const WIRED = ".github/workflows/kaizen-schedule.yml";

// **pin を含めた完全一致に戻した。** 前の版は `uses:` の SHA とバージョンコメントを
// 正規化して比較していた。それだと配布テンプレートの pin が**恒久的に古いまま**になり、
// どの検査でも検出されない。`pinact run --check` は SHA とコメントの整合を見るだけで、
// そのバージョンが最新かは見ないからである。
//
// 完全一致にする代わり、Dependabot が `.github/workflows/` 側だけを上げた PR では
// この検査が赤くなる。**silent な陳腐化より visible な 1 コマンドの手戻りを選ぶ**。
// 失敗メッセージに同期コマンドを書いてあり、その PR は `dependabot-merge` が
// どのみち人の目を通す。CI 側の pin 検査（`ci.yml` の "Pin check (distributed workflow
// templates)"）は、テンプレートが未 pin・コメント不整合になることを別途落とす。
const SYNC_HINT =
  "配布テンプレートと本リポのワークフローがずれている。`cp .github/workflows/kaizen-schedule.yml " +
  "skills/kaizen/assets/kaizen-schedule.yml` で同期し、" +
  "`scripts/tools/reinstall-skill.sh kaizen` を実行する。";

test("配布テンプレートと本リポのワークフローがバイト単位で一致する", () => {
  const canon = readFileSync(join(repoRoot, CANON), "utf8");
  const wired = readFileSync(join(repoRoot, WIRED), "utf8");
  expect(wired, SYNC_HINT).toBe(canon);
});

/** テストが読むワークフローの形（使うフィールドだけ）。 */
type Workflow = {
  env?: Record<string, unknown>;
  jobs: Record<string, { steps?: { name?: string; run?: string }[] }>;
};

/** 原本の「Append agent report」ステップを、成功したエージェントのレポートで実行し、本文を返す。 */
function appendReport(report: string) {
  const doc = loadYamlAs<Workflow>(readFileSync(join(repoRoot, CANON), "utf8"));
  const steps = Object.values(doc.jobs).flatMap((job) => job.steps ?? []);
  const matched = steps.filter((s) => s.name === "Append agent report");
  expect(matched, "Append agent report ステップ").toHaveLength(1);
  const run = matched[0]?.run;
  assert.exists(run, "Append agent report ステップに run が無い");
  const max = Number(doc.env?.MAX_REPORT_CHARS);
  expect(max, "env の MAX_REPORT_CHARS").toBeGreaterThan(0);

  const dir = makeTempDir("kaizen-append-report-");
  try {
    const step = join(dir, "step.sh");
    writeFileSync(step, run);
    writeFileSync(join(dir, "report.md"), report);
    const res = spawnSync("bash", ["-eo", "pipefail", step], {
      cwd: dir,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        HOME: dir,
        LC_ALL: "C.UTF-8",
        AGENT: "claude",
        CRED_PRESENT: "true",
        OUTCOME_CLAUDE: "success",
        MAX_REPORT_CHARS: String(max),
        REPORT_FILE: "report.md",
        BODY_FILE: "body.md",
        GITHUB_SERVER_URL: "https://github.com",
        GITHUB_REPOSITORY: "o/r",
        GITHUB_RUN_ID: "1",
        ...coverageEnv(),
      },
      timeout: CHILD_TIMEOUT_MS,
    });
    expect(res.status, res.stderr).toBe(0);
    return { body: readFileSync(join(dir, "body.md"), "utf8"), max };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// エージェントのレポートは Issue 本文へそのまま載る。無制限に載せると、
// 表を 60 行で切って守っている本文の文字数予算がエージェント経由で破られ、
// `gh issue edit/create` が落ちてその週の Issue が作成も更新もされない。
const OMITTED = "レポートが長いため以降を省略しました";
describe("エージェントのレポートを本文の予算の中で載せる", () => {
  test("上限を超えるレポートは行の境界で切り、省略したことを書く", () => {
    const lines = Array.from({ length: 1000 }, (_, i) => `L${i} ${"あ".repeat(60)}`);
    const { body, max } = appendReport(`${lines.join("\n")}\n`);
    // 検体が上限を超えていることの確認（超えなければ切り詰めの分岐へ入らない）。
    expect(lines.join("\n").length).toBeGreaterThan(max);
    const kept = body.split("\n").filter((l) => /^L\d+ /.test(l));
    expect(kept.length).toBeGreaterThan(0);
    // 載せた行はどれも元の行のまま（文字の途中で割っていない）で、合計が上限に収まる。
    for (const l of kept) expect(lines).toContain(l);
    expect(kept.reduce((n, l) => n + l.length + 1, 0)).toBeLessThanOrEqual(max);
    expect(body).toContain(OMITTED);
  });

  test("上限以下のレポートはそのまま載せ、省略したと書かない", () => {
    const { body } = appendReport("短いレポート\n2 行目\n");
    expect(body).toContain("短いレポート\n2 行目\n");
    expect(body).not.toContain(OMITTED);
  });
});

test("すべての uses: を 40 桁 SHA で固定している", () => {
  const canon = readFileSync(join(repoRoot, CANON), "utf8");
  const pins = [...canon.matchAll(/^\s*uses:\s*\S+?@(\S+)/gm)].map((m) => m[1]);
  // 0 件を合格として扱わない（正規表現が空振りしただけの緑を根拠にしない）。
  expect(pins.length).toBeGreaterThan(0);
  for (const pin of pins) {
    expect(pin).toMatch(/^[0-9a-f]{40}$/);
  }
});

test("原本が定期実行スキルの前提（cron・skip・エージェント選択）を保っている", () => {
  const canon = readFileSync(join(repoRoot, CANON), "utf8");
  // 検査対象は「このワークフローが何であるか」を決める要素だけに絞る。
  // 文面の細部まで固定すると、意味を変えない編集でテストが赤くなる。
  expect(canon).toMatch(/^\s+- cron: /m);
  expect(canon).toContain("vars.KAIZEN_SCHEDULE_SKIP");
  for (const agent of ["claude", "codex", "copilot"]) {
    expect(canon).toContain(`steps.settings.outputs.agent == '${agent}'`);
  }
});

// スクリプトの探索条件が誤っていても、本リポでは緑のまま、配布先でだけスクリプトが見つからなくなる。
// 本リポには 755 のソース配置 `skills/kaizen/scripts/` があるので、探索先の一覧から
// `.github/skills/...` を落としても、ここ以外は誰も赤くならない。
describe("スクリプト探索条件（配布先でだけ失敗するので実配置から固定する）", () => {
  const canon = () => readFileSync(join(repoRoot, CANON), "utf8");

  // `gh skill install` は 100644 で配るので、探索は実行ビット（`-x`）ではなく可読性で判定する。
  // これは tracking-issue-title.test.ts の「両方揃ったディレクトリを採り、lib のパスを出力する」が確かめる。
  // そのテストは、モード 644 のファイルを置いて探索ステップを実行する。

  // 探索は「レポートと照会が同じディレクトリに揃っていること」を条件にしている。
  // setup.md の確認スニペットが片方しか見ないと、**そのスニペットは緑なのに毎週の run が
  // 探索で落ちる**（Issue #420 で照会を同梱スクリプトへ括り出した）。同じ 2 本を見ることを固定する。
  test("探索は 2 本揃ったディレクトリだけを採り、setup.md の確認も同じ 2 本を見る", () => {
    const required = ["kaizen-schedule-report.sh", "tracking-issue-lib.sh"];
    const loop = canon().match(/for dir in [\s\S]*?\n(\s*if \[ [^\n]*\n)/);
    assert.exists(loop, "探索ループの条件行が見つからない");
    for (const name of required) {
      expect(loop[1], `探索が ${name} を見ていない`).toContain(`[ -r "$dir/${name}" ]`);
    }
    const setup = readFileSync(join(repoRoot, "skills/kaizen/references/setup.md"), "utf8");
    const check = setup.match(/for d in [\s\S]*?\n(\s*if \[ [^\n]*\n)/);
    assert.exists(check, "setup.md の確認スニペットが見つからない");
    for (const name of required) {
      expect(check[1], `setup.md の確認が ${name} を見ていない`).toContain(`[ -r "$d/${name}" ]`);
    }
  });

  test("setup.md が正規配置として挙げるリポジトリ内のパスを網羅する", () => {
    // 期待集合は観測ではなく宣言（setup.md の探索スニペット）から構成する。
    const setup = readFileSync(join(repoRoot, "skills/kaizen/references/setup.md"), "utf8");
    const declared = [...setup.matchAll(/(^|\s)((?:\.[\w.-]+\/)+skills\/kaizen\/scripts)\b/g)].map(
      (m) => m[2],
    );
    // 宣言側が空なら期待集合を作れていない（0 件を合格として扱わない）。
    expect(declared.length).toBeGreaterThan(0);
    const loop = canon().match(/for dir in ([\s\S]*?); do/);
    assert.exists(loop, "探索ループのディレクトリの一覧が見つからない");
    for (const path of new Set(declared)) {
      expect(loop[1]).toContain(path);
    }
  });
});
