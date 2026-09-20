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
//   E. **update 分岐からだけ** `--title "$title"` を落とす → リネームテストが fail
//      （`run` 全体へ `toContain` を当てる版は**赤くならなかった**。create 側の
//        `gh issue create --title "$title"` だけで条件が満たされるため、本 PR の主目的である
//        「既存の追跡 Issue を毎回リネームする」の退行を見逃す——分岐ごとに当てる）
//   F. 検索 0 件時のフォールバックを外す          → フォールバックテストが fail
//   G. クローズを最古 1 本だけに戻す              → 全件クローズテストが fail
//   H. 更新側も全件ループにする（過剰一般化）     → 同テストの陰性コントロールが fail
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
  const m = run.match(/--jq '([\s\S]*?)'\s*$/m);
  expect(m, "--jq の式を取り出せない").not.toBeNull();
  return m[1];
}

/**
 * 追跡 Issue の分岐を 3 つに割る。**分岐ごとに別々の assertion を当てる**ために要る——
 * `run` 全体へ `toContain('--title "$title"')` を当てると、新規作成側の `gh issue create`
 * だけで満たされてしまい、更新側（`gh issue edit`）からリネームを落としても緑のままになる
 * （両方とも変異で実測した）。
 *
 *   close  : 追跡 Issue を閉じる／何もしない側（`elif` の手前）
 *   update : 既存の追跡 Issue を更新する側（`elif` 〜 `else`）
 *   create : 新規作成する側（`else` 以降）
 */
function branches(run) {
  const elif = run.indexOf('elif [ -n "$number" ]; then');
  expect(elif, "更新分岐（elif）を見つけられない").toBeGreaterThan(-1);
  const head = run.slice(0, elif);
  const open = head.lastIndexOf("\nif [");
  expect(open, "クローズ分岐の if を見つけられない").toBeGreaterThan(-1);
  const rest = run.slice(elif);
  const els = rest.indexOf("\nelse\n");
  expect(els, "新規作成分岐（else）を見つけられない").toBeGreaterThan(-1);
  return {
    close: head.slice(open),
    update: rest.slice(0, els),
    create: rest.slice(els),
  };
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
  });

  test("完全一致の検索へ戻っていない（戻ると毎週新しい Issue が立つ）", () => {
    expect(run()).not.toMatch(/select\(\s*\.title\s*==\s*env\./);
    expect(run()).toContain("startswith(env.ISSUE_TITLE_PREFIX)");
  });

  test("既存の追跡 Issue は毎回リネームし、新規作成も日付つきで立てる", () => {
    const { update, create } = branches(run());
    // 分岐へ到達していることの陽性コントロール（空文字を検査しても常に緑になる）。
    expect(update).toContain("gh issue edit");
    expect(create).toContain("gh issue create");
    // 本 PR の主目的。`run` 全体へ当てると create 側だけで満たされてしまうので分岐ごとに当てる。
    expect(update).toContain('--title "$title"');
    expect(create).toContain('--title "$title"');
  });

  test("クローズ時はリネームしない（閉じた Issue は当時の日付で固定する）", () => {
    const { close } = branches(run());
    expect(close).toContain("gh issue close");
    expect(close).not.toContain("--title");
  });

  test("既定 30 件で打ち切らない（open Issue が多いと取りこぼして新規が乱立する）", () => {
    expect(run()).toContain("--limit 100");
  });

  // 検索インデックスは結果整合。作成・リネーム直後の workflow_dispatch で未反映だと
  // 「無い」と答え、2 本目を立てる（一覧 API は即時反映）。0 件なら --search 無しで引き直す。
  test("検索が 0 件なら --search 無しで引き直してから新規作成へ進む", () => {
    const r = run();
    expect(r).toContain('matched="$(find_tracking_issues --search');
    // フォールバックは 0 件のときだけ。無条件の 2 度引きになっていないこと。
    const fallback = r.match(/^if \[ -z "\$matched" \]; then$\n([\s\S]*?)^fi$/m);
    expect(fallback, "0 件ガード付きのフォールバックが無い").not.toBeNull();
    expect(fallback[1]).toContain('matched="$(find_tracking_issues)"');
  });

  // 最古の 1 本だけ閉じると、残りが「未対応がある」という本文のまま open で残り、
  // 一覧に矛盾した追跡 Issue が並ぶ。閉じるときは一致した全部を閉じる。
  test("クローズは一致した全件に当てる（更新は最古 1 本だけ）", () => {
    const { close, update } = branches(run());
    expect(close).toContain('for n in "${numbers[@]}"');
    expect(close).toContain('gh issue close "$n"');
    // 更新側は 1 本だけ（ループになっていないこと＝過剰一般化の陰性コントロール）。
    expect(update).not.toContain('for n in "${numbers[@]}"');
    expect(update).toContain('gh issue edit "$number"');
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
