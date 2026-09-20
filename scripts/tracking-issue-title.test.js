import { describe, test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
//   J. 上限到達の警告を新規作成分岐から外す        → 警告配置テストが fail
//   K. 分岐前の通知へ「更新は…のみ」を戻す        → 分岐前断定テストが fail
//   L. 警告をクローズ分岐にも置く（偽陽性の再現）   → 警告配置テストが fail
//   M. 走査件数を別 API で引き直す                 → 同テストが fail
//   N. 照会を `read_matches "$(find_tracking_issues ...)"` へ戻す → fail-closed テストが fail
//      （`$( )` の失敗は**関数の引数**では伝播しない。実際に走らせて測る）
//   O. `env:` の `ISSUE_TITLE_PREFIX` 宣言を落とす    → 実行テストが fail
//      （最初の版は runStep が接頭辞を渡しておらず、**空の接頭辞で走ったまま緑**だった）
//   P. 閾値を `-ge 100` の数値リテラルへ戻す          → 上限の単一化テストが fail
//   Q. 検索側の打ち切り警告を外す                    → 検索打ち切りテストが fail
//      （最初の M はインデント違いで**変異が当たっておらず**、20 passed を「実証」と
//        読みかけた。当たったことを diff で確かめてから走らせ直した）
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// 同じパターンを持つワークフローの一覧。片方だけ直る余地を残さないため一括で検査する。
const WORKFLOWS = [
  {
    path: ".github/workflows/kaizen-schedule.yml",
    prefix: "kaizen: 未適用の学び",
    // 追跡 Issue が 1 件も見つからず、新規作成へ進む条件。
    createEnv: { PENDING_COUNT: "3" },
  },
  {
    path: ".github/workflows/outdated.yml",
    prefix: "mise outdated tool versions",
    createEnv: { HAS_OUTDATED: "true" },
  },
];

// `gh issue list` を失敗させるスタブ。変更系の呼び出しは GH_LOG へ記録する。
const GH_FAILING = `#!/usr/bin/env bash
set -euo pipefail
if [ "\${1-}" = issue ] && [ "\${2-}" = list ]; then
  echo "gh: HTTP 403: You have exceeded a secondary rate limit" >&2
  exit 1
fi
printf 'CALL: %s\\n' "$*" >>"$GH_LOG"
`;

// 一致 0 件を正常に返すスタブ（陽性コントロール: 新規作成の分岐へ到達することを示す）。
const GH_EMPTY = `#!/usr/bin/env bash
set -euo pipefail
if [ "\${1-}" = issue ] && [ "\${2-}" = list ]; then
  echo "scanned=0"
  exit 0
fi
printf 'CALL: %s\\n' "$*" >>"$GH_LOG"
`;

/** ステップの run を、差し替えた `gh` で実際に走らせる。 */
function runStep(wfPath, ghScript, env) {
  const dir = mkdtempSync(join(tmpdir(), "tracking-step-"));
  try {
    const bin = join(dir, "bin");
    mkdirSync(bin, { recursive: true });
    const gh = join(bin, "gh");
    writeFileSync(gh, ghScript);
    chmodSync(gh, 0o755);
    const script = join(dir, "step.sh");
    writeFileSync(script, trackingStep(wfPath));
    const log = join(dir, "gh.log");
    writeFileSync(log, "");
    const res = spawnSync("bash", ["-eo", "pipefail", script], {
      cwd: dir,
      encoding: "utf8",
      env: {
        PATH: `${bin}:${process.env.PATH}`,
        HOME: dir,
        LC_ALL: "C.UTF-8",
        GH_LOG: log,
        GITHUB_SERVER_URL: "https://github.com",
        GITHUB_REPOSITORY: "o/r",
        GITHUB_RUN_ID: "1",
        BODY_FILE: join(dir, "body.md"),
        // ステップは workflow-level の `env:` に依存する。`run` だけ取り出すこのヘルパには
        // 届かないので、宣言から読んで明示的に渡す（渡さないと空の接頭辞で走る）。
        ISSUE_TITLE_PREFIX: declaredPrefix(wfPath),
        ...env,
      },
    });
    return { ...res, calls: readFileSync(log, "utf8") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

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

/**
 * ワークフローが `env:` で宣言している接頭辞を返す。
 * **実行テストへはこの値を渡す**——ハードコードした期待値を渡すと、宣言を落とす変異で
 * テストが緑のまま通り、ステップが空の接頭辞で走っていることに気づけない（実測）。
 */
function declaredPrefix(wfPath) {
  const doc = yaml.load(readFileSync(join(repoRoot, wfPath), "utf8"));
  const envs = [doc.env ?? {}, ...Object.values(doc.jobs).map((j) => j.env ?? {})];
  const found = envs.map((e) => e.ISSUE_TITLE_PREFIX).filter(Boolean);
  // 宣言は 1 箇所だけ（`run` へ直書きすると照合と表示でずれる）。0 件も複数件も落とす。
  expect(found, `${wfPath}: env の ISSUE_TITLE_PREFIX 宣言`).toHaveLength(1);
  return found[0];
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

describe.each(WORKFLOWS)("$path の追跡 Issue タイトル", ({ path, prefix, createEnv }) => {
  const run = () => trackingStep(path);

  test("env で接頭辞を宣言し、タイトルへ UTC の更新日を付ける", () => {
    expect(declaredPrefix(path)).toBe(prefix);
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

  // **`gh` の失敗を「追跡 Issue が無い」へ倒さない。** `$( )` を代入に置けば `set -e` が
  // 拾うが、関数の引数に置くと終了コードが捨てられる（実測）。捨てると secondary rate
  // limit や 5xx を踏んだ週に「0 件」と読み、既存 Issue を残したまま 2 本目を作って緑で終わる。
  // 静的な文字列検査では書き方を変えた瞬間に素通りするので、**実際に走らせて**測る。
  test("gh issue list が失敗したら Issue を触らずに落ちる（fail-closed）", () => {
    const failed = runStep(path, GH_FAILING, createEnv);
    expect(failed.status, "gh が失敗したのにステップが成功した").not.toBe(0);
    expect(failed.calls, "失敗した週に Issue を作成・更新・クローズした").toBe("");

    // 陽性コントロール: 同じ入力で `gh` が正常なら新規作成まで到達する
    // （到達していない経路で「触らなかった」を測っても何も実証しない）。
    const ok = runStep(path, GH_EMPTY, createEnv);
    expect(ok.status, ok.stderr).toBe(0);
    expect(ok.calls).toContain("issue create");
    // 接頭辞と日付が実際にタイトルへ乗っていること。ここを見ないと、空の接頭辞で
    // 走っていても「作成へ到達した」だけで緑になる。
    const today = new Date().toISOString().slice(0, 10);
    expect(ok.calls).toContain(`--title ${prefix} (${today})`);
  });

  test("クローズ時はリネームしない（閉じた Issue は当時の日付で固定する）", () => {
    const { close } = branches(run());
    expect(close).toContain("gh issue close");
    expect(close).not.toContain("--title");
  });

  test("既定 30 件で打ち切らない（open Issue が多いと取りこぼして新規が乱立する）", () => {
    const r = run();
    expect(r).toContain('--limit "$list_limit"');
    // 上限そのものが 30 件の既定より大きいこと（変数化で値が緩んでいないか見る）。
    const decl = r.match(/^list_limit=(\d+)$/m);
    expect(decl).not.toBeNull();
    expect(Number(decl[1])).toBeGreaterThan(30);
  });

  // 検索インデックスは結果整合。作成・リネーム直後の workflow_dispatch で未反映だと
  // 「無い」と答え、2 本目を立てる（一覧 API は即時反映）。0 件なら --search 無しで引き直す。
  test("検索が 0 件なら --search 無しで引き直してから新規作成へ進む", () => {
    const r = run();
    expect(r).toContain("query_tracking_issues --search");
    // フォールバックは 0 件のときだけ。無条件の 2 度引きになっていないこと。
    const fallback = r.match(/^if \[ "\$\{#numbers\[@\]\}" -eq 0 \]; then$\n([\s\S]*?)^fi$/m);
    expect(fallback, "0 件ガード付きのフォールバックが無い").not.toBeNull();
    expect(fallback[1]).toMatch(/^ *query_tracking_issues$/m);
  });

  // 100 件上限に張り付いたまま「無い」と結論すると、取りこぼしが黙って新規作成に化ける。
  // ただし警告は**新規作成の分岐だけ**に置く。取りこぼしが害になるのは重複を作る経路だけで、
  // 何もしない分岐（追跡 Issue 無し × 対象 0 件）で鳴らすと正常な定常状態で毎週ノイズが出る。
  // 走査件数は照会と同じ呼び出しから採る（別 API で引き直すと 2 回の間に open 数が動く）。
  test("上限到達の警告は新規作成の分岐にだけ置く", () => {
    const r = run();
    expect(r).toContain('"scanned=" + (length | tostring)');
    expect(r).toContain('fallback_scanned="$scanned"');
    const { create, close, update } = branches(r);
    expect(create).toContain('[ "$fallback_scanned" -ge "$list_limit" ]');
    expect(create).toContain("::warning::");
    // 他の分岐では鳴らさない（偽陽性の陰性コントロール）。
    expect(close).not.toContain("::warning::");
    expect(update).not.toContain("::warning::");
  });

  // 取得上限と打ち切り判定の閾値を別リテラルにすると、片方だけ上げたときに
  // 誤警告（打ち切っていないのに鳴る）と検出漏れの両方が起きる。
  test("取得上限は 1 箇所で決め、閾値もそこから引く", () => {
    const r = run();
    const decl = r.match(/^list_limit=(\d+)$/m);
    expect(decl, "list_limit の宣言が無い").not.toBeNull();
    expect(r).toContain('--limit "$list_limit"');
    // 閾値側に数値リテラルが残っていないこと。
    expect(r).not.toMatch(/-ge 100\b/);
  });

  // 検索側が打ち切られると、本物の追跡 Issue が窓の外に落ちて別の Issue を毎週更新しうる。
  // この経路は新規作成を通らないので、作成直前の警告では拾えない。分岐に関わらず鳴らす。
  test("検索側の打ち切りは分岐に関わらず警告する", () => {
    const r = run();
    const branch = branches(r);
    const head = r.slice(0, r.indexOf(branch.close));
    expect(head).toContain('[ "$scanned" -ge "$list_limit" ]');
    expect(head).toContain("::warning::");
  });

  // 一致が複数のときの扱いは分岐で違う（更新は最古 1 本、クローズは全件）。
  // 分岐前の行で「何をするか」を断定すると run ログが実挙動と食い違う。
  test("複数一致の通知は分岐前で挙動を断定しない", () => {
    const r = run();
    const notice = r.match(/^ *echo "追跡 Issue が[^"]*" >&2$/m);
    expect(notice, "複数一致の通知が見つからない").not.toBeNull();
    expect(notice[0]).not.toContain("更新");
    expect(notice[0]).not.toContain("閉じ");
    // 何をしたかは分岐の中で出す。
    const { close, update } = branches(r);
    expect(update).toContain("更新するのは最も古い");
    expect(close).toContain("閉じた: #");
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
      const lines = res.stdout.split("\n").filter(Boolean);
      // 先頭行は走査件数。件数まで含めて確かめる（絞り込み前の母数が変わったら気づける）。
      expect(lines[0]).toBe(`scanned=${cases.length}`);
      const got = lines.slice(1).map(Number);
      const want = cases.filter((c) => c.hit).map((c) => c.number);
      expect(got).toStrictEqual(want);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
