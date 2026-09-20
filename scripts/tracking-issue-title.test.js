import { describe, test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import yaml from "js-yaml";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// 週次ワークフローの追跡 Issue は、タイトルが固定文字列だと手動クローズのたびに
// 同名の Issue が open / closed に並び、一覧で世代を区別できない（Issue #417）。
// タイトルへ更新日を入れ、既存 Issue は「接頭辞 + 空 or (YYYY-MM-DD)」で引く。
//
// この照合は**間違え方が両側にある**:
//   - 狭すぎる（完全一致のまま）→ 毎週新しい Issue が立ち、追跡が分裂する
//   - 広すぎる（素の前方一致）→ 接頭辞で始まるだけの無関係な Issue を毎週上書きする
// どちらも run は緑のまま進むので、実際の jq 式を取り出してラベル付き検体で弁別を測る。
//
// 変異による検出能力の実証（実測。いずれも狙った assertion が落ちることを確認した）:
//   A. jq から日付の形の検査を外して素の前方一致にする → 弁別テストが fail
//   B. タイトルを固定文字列へ戻す                      → 日付テストが fail
//   C. クローズ分岐で先にリネームする                  → クローズ分岐テストが fail
//      （最初に書いた `gh issue close` の行だけを見る版は**赤くならなかった**。
//        リネームは別の行として増えるので、行単位の検査では分岐に混ざっても緑になる）
//   D. `--limit 100` を外して既定 30 件に戻す          → 件数テストが fail
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// 同じパターンを持つワークフローの一覧。片方だけ直る余地を残さないため一括で検査する。
const WORKFLOWS = [
  { path: ".github/workflows/kaizen-schedule.yml", prefix: "kaizen: 未適用の学び" },
  { path: ".github/workflows/outdated.yml", prefix: "mise outdated tool versions" },
];

const STEP_NAME = "Update tracking issue";

/** ワークフローの追跡 Issue 更新ステップの `run` を返す（宣言そのものから取る）。 */
function trackingStep(wfPath) {
  const doc = yaml.load(readFileSync(join(repoRoot, wfPath), "utf8"));
  // `uses:` で再利用ワークフローを呼ぶ job には `steps` が無い（TypeError で落ちるのを避ける）。
  const steps = Object.values(doc.jobs).flatMap((job) => job.steps ?? []);
  const matched = steps.filter((s) => s.name === STEP_NAME);
  // 0 件・複数件を合格に倒さない（ステップ名を変えたら検査が空振りするだけになる）。
  expect(matched, `${wfPath}: "${STEP_NAME}" ステップ`).toHaveLength(1);
  return matched[0].run;
}

/** `--jq '<式>'` の中身を取り出す。 */
function jqFilter(run) {
  const m = run.match(/--jq '([\s\S]*?)'\)"/);
  expect(m, "--jq の式を取り出せない").not.toBeNull();
  return m[1];
}

/**
 * 「追跡 Issue が無い／閉じる」側の分岐本体を返す（`elif [ -n "$number" ]` の手前まで）。
 * `gh issue close` の行だけを見るのでは足りない——リネームは別の行として増えるので、
 * 行単位の検査は分岐にリネームが混ざっても緑のままになる（変異で実測した）。
 */
function closeBranch(run) {
  const elif = run.indexOf('elif [ -n "$number" ]; then');
  expect(elif, "更新分岐（elif）を見つけられない").toBeGreaterThan(-1);
  const head = run.slice(0, elif);
  const open = head.lastIndexOf("\nif [");
  expect(open, "クローズ分岐の if を見つけられない").toBeGreaterThan(-1);
  return head.slice(open);
}

describe.each(WORKFLOWS)("$path の追跡 Issue タイトル", ({ path, prefix }) => {
  const run = () => trackingStep(path);

  test("env で接頭辞を宣言し、タイトルへ UTC の更新日を付ける", () => {
    const doc = yaml.load(readFileSync(join(repoRoot, path), "utf8"));
    // 接頭辞は env に 1 箇所だけ置く（`run` へ直書きすると照合と表示でずれる）。
    const envs = [doc.env ?? {}, ...Object.values(doc.jobs).map((j) => j.env ?? {})];
    const declared = envs.map((e) => e.ISSUE_TITLE_PREFIX).filter(Boolean);
    expect(declared).toStrictEqual([prefix]);
    // 固定タイトルへ戻っていないこと。`date -u` でランナーの TZ に依存させない。
    expect(run()).toContain('title="$ISSUE_TITLE_PREFIX ($(date -u +%F))"');
    expect(run()).toContain('--title "$title"');
  });

  test("完全一致の検索へ戻っていない（戻ると毎週新しい Issue が立つ）", () => {
    expect(run()).not.toMatch(/select\(\s*\.title\s*==\s*env\./);
    expect(run()).toContain("startswith(env.ISSUE_TITLE_PREFIX)");
  });

  test("クローズ時はリネームしない（閉じた Issue は当時の日付で固定する）", () => {
    const branch = closeBranch(run());
    // 分岐へ到達していることの陽性コントロール（空文字を検査しても常に緑になる）。
    expect(branch).toContain("gh issue close");
    expect(branch).not.toContain("--title");
  });

  test("既定 30 件で打ち切らない（open Issue が多いと取りこぼして新規が乱立する）", () => {
    expect(run()).toContain("--limit 100");
  });

  // 実式をそのまま jq へ通し、拾うべき検体と拾ってはいけない検体で弁別を測る。
  test("jq 式が世代違いだけを拾い、接頭辞で始まるだけの Issue は拾わない", () => {
    const probe = spawnSync("bash", ["-c", "command -v jq"], { encoding: "utf8" });
    // jq が無い環境を「該当なし＝合格」に倒さない。
    expect(probe.status, "jq が必要（このテストは jq 式を実行して弁別を測る）").toBe(0);

    const cases = [
      { title: prefix, number: 1, hit: true, why: "日付を入れる前の既存追跡 Issue" },
      { title: `${prefix} (2026-09-14)`, number: 2, hit: true, why: "通常の世代" },
      { title: `${prefix} (2026-09-21)`, number: 3, hit: true, why: "別の世代" },
      { title: `${prefix} について相談`, number: 4, hit: false, why: "接頭辞で始まるだけ" },
      { title: `${prefix} (2026-9-1)`, number: 5, hit: false, why: "日付の桁が足りない" },
      { title: `${prefix}(2026-09-21)`, number: 6, hit: false, why: "空白が無い" },
      { title: `x ${prefix} (2026-09-21)`, number: 7, hit: false, why: "接頭辞で始まらない" },
      {
        title: `${prefix} (2026-09-21) 追記`,
        number: 8,
        hit: false,
        why: "日付の後ろに続きがある",
      },
    ];
    // 両側に検体があることを確かめる（片側だけだと弁別を測れない）。
    expect(cases.some((c) => c.hit)).toBe(true);
    expect(cases.some((c) => !c.hit)).toBe(true);

    const dir = mkdtempSync(join(tmpdir(), "tracking-issue-"));
    try {
      const fixture = join(dir, "issues.json");
      writeFileSync(fixture, JSON.stringify(cases.map(({ number, title }) => ({ number, title }))));
      const res = spawnSync("jq", ["-r", jqFilter(run()), fixture], {
        encoding: "utf8",
        env: { ...process.env, ISSUE_TITLE_PREFIX: prefix },
      });
      expect(res.stderr).toBe("");
      expect(res.status).toBe(0);
      const got = res.stdout.split("\n").filter(Boolean).map(Number);
      const want = cases.filter((c) => c.hit).map((c) => c.number);
      expect(got).toStrictEqual(want);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
