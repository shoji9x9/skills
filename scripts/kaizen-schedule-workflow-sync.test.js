import { describe, test, expect } from "vitest";
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

// スクリプトの探索条件は、本リポでは緑のまま配布先だけで壊れる（`.kaizen/2026-09-20-
// distributed-script-probe-assumed-exec-bit.md`）。本リポには 755 のソース配置
// `skills/kaizen/scripts/` があるので、`-x` に戻しても `.github/skills/...` を落としても
// ここ以外は誰も赤くならない。2 つの軸を別々に固定する。
describe("スクリプト探索条件（配布先でだけ壊れるので実配置から固定する）", () => {
  const canon = () => readFileSync(join(repoRoot, CANON), "utf8");

  test("実行ビットではなく可読性で判定する", () => {
    // `gh skill install` は 100644 で配るため、`-x` は配布先で必ず外れる。
    expect(canon()).toContain('[ -r "$dir/kaizen-schedule-report.sh" ]');
    expect(canon()).not.toContain('[ -x "$dir/kaizen-schedule-report.sh" ]');
  });

  test("setup.md が正規配置として挙げるリポジトリ内のパスを網羅する", () => {
    // 期待集合は観測ではなく宣言（setup.md の探索スニペット）から構成する。
    const setup = readFileSync(join(repoRoot, "skills/kaizen/references/setup.md"), "utf8");
    const declared = [...setup.matchAll(/(^|\s)((?:\.[\w.-]+\/)+skills\/kaizen\/scripts)\b/g)].map(
      (m) => m[2],
    );
    // 宣言側が空なら期待集合を作れていない（0 件を合格に倒さない）。
    expect(declared.length).toBeGreaterThan(0);
    const loop = canon().match(/for dir in ([\s\S]*?); do/);
    expect(loop).not.toBeNull();
    for (const path of new Set(declared)) {
      expect(loop[1]).toContain(path);
    }
  });
});
