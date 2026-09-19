import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// kaizen の定期実行ワークフローは、配布スキルに同梱したテンプレート
// （skills/kaizen/assets/kaizen-schedule.yml）が正本で、本リポの
// .github/workflows/kaizen-schedule.yml はその複製。
//
// 複製にしているのは、actionlint / ghalint / pinact が .github/workflows/** しか
// 見ないため。テンプレート側だけを直すと、配布先へ配られる内容が誰にも検査されない
// まま本リポの実物と食い違う（逆も同じ）。プレースホルダを持たない設計にして
// バイト単位で一致させ、ここで決定論的に検査する。
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const CANON = "skills/kaizen/assets/kaizen-schedule.yml";
const WIRED = ".github/workflows/kaizen-schedule.yml";

test("配布テンプレートと本リポのワークフローがバイト単位で一致する", () => {
  const canon = readFileSync(join(repoRoot, CANON), "utf8");
  const wired = readFileSync(join(repoRoot, WIRED), "utf8");
  expect(wired).toBe(canon);
});

test("正本が定期実行スキルの前提（cron・skip・エージェント選択）を保っている", () => {
  const canon = readFileSync(join(repoRoot, CANON), "utf8");
  // 検査対象は「このワークフローが何であるか」を決める要素だけに絞る。
  // 文面の細部まで固定すると、意味を変えない編集でテストが赤くなる。
  expect(canon).toMatch(/^\s+- cron: /m);
  expect(canon).toContain("vars.KAIZEN_SCHEDULE_SKIP");
  for (const agent of ["claude", "codex", "copilot"]) {
    expect(canon).toContain(`steps.settings.outputs.agent == '${agent}'`);
  }
});
