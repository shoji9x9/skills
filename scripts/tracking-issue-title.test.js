import { describe, test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
// 照会の正本は同梱スクリプト 1 本（`skills/kaizen/scripts/tracking-issue-lib.sh`）で、
// 2 つのワークフローがそれを source する（Issue #420 で約 100 行の重複を解消した）。
// このファイルは 2 層に分けて検査する:
//   - lib: 実際に source して**挙動**を測る（照合・フォールバック・打ち切り・fail-closed）
//   - ワークフロー: lib を呼んでいること＋分岐（リネーム・クローズ・警告）の**配線**
//
// **変異実証は散文で持たない。** 以前はこの位置に A〜U のコメントとして置いていたが、
// テストを直した瞬間に検証されない主張になる（実際に 3 通りの綻び方をした。Issue #420）。
// 変異は `scripts/tracking-issue-title.mutations.json` にデータとして持ち、
// `node scripts/check-mutation-proof.js` が「置換が当たったこと」と「狙ったテストが
// 落ちたこと」の両方を機械で確かめる。
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const LIB = "skills/kaizen/scripts/tracking-issue-lib.sh";
const libPath = join(repoRoot, LIB);
const libSource = () => readFileSync(libPath, "utf8");

// 同じ lib を source するワークフローの一覧。片方だけ直る余地を残さないため一括で検査する。
const WORKFLOWS = [
  {
    path: ".github/workflows/kaizen-schedule.yml",
    prefix: "kaizen: 未適用の学び",
    // 追跡 Issue が 1 件も見つからず、新規作成へ進む条件。
    createEnv: { PENDING_COUNT: "3" },
    // ステップの挙動を決める入力。空・仕様外の値で gh を呼ばずに落ちること（fail-closed）。
    gateVar: "PENDING_COUNT",
    badValues: ["", "3件", "-1"],
  },
  {
    path: ".github/workflows/outdated.yml",
    prefix: "mise outdated tool versions",
    createEnv: { HAS_OUTDATED: "true" },
    gateVar: "HAS_OUTDATED",
    badValues: ["", "TRUE", "1"],
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

/**
 * **照会の呼び出しまで記録する**スタブ。`gh` を呼ぶ前に落ちること（fail-closed の入口側）は
 * 変更系だけを記録するスタブでは測れない——照会が走っても記録が空のままになる。
 * 返す本文は `LIST_OUT` で与え、`--search` 付きと無しで出し分けたいときは `LIST_OUT_2` を使う。
 */
const GH_LOGGING = `#!/usr/bin/env bash
set -euo pipefail
printf 'CALL: %s\\n' "$*" >>"$GH_LOG"
if [ "\${1-}" = issue ] && [ "\${2-}" = list ]; then
  n="$(grep -c '^CALL: issue list' "$GH_LOG")"
  if [ "$n" -ge 2 ] && [ -n "\${LIST_OUT_2-}" ]; then
    printf '%s\\n' "$LIST_OUT_2"
  else
    printf '%s\\n' "\${LIST_OUT-scanned=0}"
  fi
fi
`;

/** スタブ化した `gh` を PATH 前段に置いて bash スクリプトを走らせる。 */
function runBash(script, ghScript, env) {
  const dir = mkdtempSync(join(tmpdir(), "tracking-step-"));
  try {
    const bin = join(dir, "bin");
    mkdirSync(bin, { recursive: true });
    const gh = join(bin, "gh");
    writeFileSync(gh, ghScript);
    chmodSync(gh, 0o755);
    const file = join(dir, "step.sh");
    writeFileSync(file, script);
    const log = join(dir, "gh.log");
    writeFileSync(log, "");
    const res = spawnSync("bash", ["-eo", "pipefail", file], {
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
        ...env,
      },
    });
    return { ...res, calls: readFileSync(log, "utf8") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** lib を source して `script` を走らせる（lib の挙動を実測する）。 */
function runLib(script, ghScript, env) {
  return runBash(`. ${JSON.stringify(libPath)}\n${script}\n`, ghScript, env);
}

const STEP_NAME = "Update tracking issue";
const LOCATE_STEP = "Locate kaizen scripts";

/** ワークフローの指定ステップ（宣言そのもの）を返す。 */
function step(wfPath, name) {
  const doc = yaml.load(readFileSync(join(repoRoot, wfPath), "utf8"));
  // `uses:` で再利用ワークフローを呼ぶ job には `steps` が無い（TypeError で落ちるのを避ける）。
  const steps = Object.values(doc.jobs).flatMap((job) => job.steps ?? []);
  const matched = steps.filter((s) => s.name === name);
  // 0 件・複数件を合格に倒さない（ステップ名を変えたら検査が空振りするだけになる）。
  expect(matched, `${wfPath}: "${name}" ステップ`).toHaveLength(1);
  return matched[0];
}

/** 追跡 Issue 更新ステップの `run` を返す。 */
function trackingStep(wfPath) {
  return step(wfPath, STEP_NAME).run;
}

/**
 * ワークフローが `env:` で宣言している値を返す（0 件・複数件は落とす）。
 * **実行テストへはこの値を渡す**——ハードコードした期待値を渡すと、宣言を落とす変異で
 * テストが緑のまま通り、空の値でステップが走っていることに気づけない（実測）。
 */
function declaredEnv(wfPath, key) {
  const doc = yaml.load(readFileSync(join(repoRoot, wfPath), "utf8"));
  const scopes = [
    doc.env ?? {},
    ...Object.values(doc.jobs).map((j) => j.env ?? {}),
    step(wfPath, STEP_NAME).env ?? {},
  ];
  const found = scopes.map((e) => e[key]).filter((v) => v !== undefined);
  // 宣言は 1 箇所だけ（`run` へ直書きすると照合と表示でずれる）。0 件も複数件も落とす。
  expect(found, `${wfPath}: env の ${key} 宣言`).toHaveLength(1);
  return String(found[0]);
}

/**
 * ステップの `TRACKING_LIB` 宣言が**実在する lib を指していること**を確かめる。
 *
 * kaizen 側は `Locate kaizen scripts` の出力を受けるので、**その探索ステップを実際に走らせて**
 * 解決する（ハードコードすると、探索が lib を出さなくなる変異で緑のまま通る）。
 * outdated 側はリポジトリ内の相対パス直書きなので、実在を確かめてから絶対パスにする。
 *
 * **返り値を実行テストへは渡さない。** 探索は `.claude/skills/kaizen/scripts` を先に見るので、
 * ここで解決した先は**インストール済みコピー**になりうる。それを source して測ると、
 * 再インストール前の週に正本ではない別のファイルを測ることになり、正本へ入れた退行が
 * 緑のまま通る（変異実証で実際に踏んだ）。実行は正本（`libPath`）で測り、
 * コピーとの一致は `scripts/check-skills-sync.js` が別に見る。
 */
function resolveLib(wfPath) {
  const declared = declaredEnv(wfPath, "TRACKING_LIB");
  const m = declared.match(/^\$\{\{\s*steps\.([\w-]+)\.outputs\.(\w+)\s*\}\}$/);
  if (!m) {
    expect(declared, "TRACKING_LIB は式かリポジトリ内の相対パス").not.toMatch(/\$\{\{/);
    const abs = join(repoRoot, declared);
    expect(existsSync(abs), `${wfPath}: TRACKING_LIB=${declared} が実在しない`).toBe(true);
    return abs;
  }
  const [, stepId, output] = m;
  expect(step(wfPath, LOCATE_STEP).id, `${wfPath}: ${LOCATE_STEP} の id`).toBe(stepId);
  const found = runLocate(wfPath, repoRoot);
  expect(found.status, found.stderr).toBe(0);
  const value = found.outputs[output];
  expect(value, `${LOCATE_STEP} が ${output} を出力していない`).toBeTruthy();
  const abs = join(repoRoot, value);
  expect(existsSync(abs), `${LOCATE_STEP} が出した ${value} が実在しない`).toBe(true);
  return abs;
}

/** 探索ステップを `cwd` で実際に走らせ、`$GITHUB_OUTPUT` へ書かれた値を返す。 */
function runLocate(wfPath, cwd) {
  const dir = mkdtempSync(join(tmpdir(), "tracking-locate-"));
  try {
    const out = join(dir, "output.txt");
    writeFileSync(out, "");
    const file = join(dir, "locate.sh");
    writeFileSync(file, step(wfPath, LOCATE_STEP).run);
    const res = spawnSync("bash", ["-eo", "pipefail", file], {
      cwd,
      encoding: "utf8",
      env: { PATH: process.env.PATH, HOME: dir, LC_ALL: "C.UTF-8", GITHUB_OUTPUT: out },
    });
    const outputs = Object.fromEntries(
      readFileSync(out, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
    );
    return { ...res, outputs };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** `--jq '<式>'` の中身を取り出す。 */
function jqFilter(source) {
  const m = source.match(/--jq '([\s\S]*?)'\s*$/m);
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

describe("照会の正本（tracking-issue-lib.sh）", () => {
  // **接頭辞が空なら `gh` を呼ぶ前に落ちる。** 空のまま進むと `startswith("")` が全 open
  // Issue に当たり、無関係な Issue をリネームして本文を上書きする。
  // 「呼ばなかった」は照会まで記録するスタブでないと測れない（変更系だけ記録するスタブでは
  // 照会が走っても空のまま緑になる）。
  test("接頭辞が空なら gh を 1 度も呼ばずに落ちる", () => {
    const res = runLib("resolve_tracking_issues", GH_LOGGING, { ISSUE_TITLE_PREFIX: "" });
    expect(res.status, "空の接頭辞で成功した").not.toBe(0);
    expect(res.calls, "空の接頭辞で gh を呼んだ").toBe("");

    // 陽性コントロール: 接頭辞があれば同じスクリプトが照会まで到達する
    // （到達しない経路で「呼ばなかった」を測っても何も実証しない）。
    const ok = runLib("resolve_tracking_issues", GH_LOGGING, { ISSUE_TITLE_PREFIX: "p" });
    expect(ok.status, ok.stderr).toBe(0);
    expect(ok.calls).toContain("CALL: issue list");
  });

  // **`gh` の失敗を「追跡 Issue が無い」へ倒さない。** `$( )` を代入に置けば `set -e` が
  // 拾うが、関数の引数に置くと終了コードが捨てられる（実測）。捨てると secondary rate
  // limit や 5xx を踏んだ週に「0 件」と読み、既存 Issue を残したまま 2 本目を作って緑で終わる。
  test("gh issue list が失敗したら非 0 で返る（fail-closed）", () => {
    const res = runLib("resolve_tracking_issues", GH_FAILING, { ISSUE_TITLE_PREFIX: "p" });
    expect(res.status, "gh が失敗したのに成功した").not.toBe(0);
    expect(res.calls, "失敗した照会の後に Issue を触った").toBe("");

    // 陽性コントロール: 同じ呼び出しで `gh` が正常なら 0 件として返る。
    const ok = runLib('resolve_tracking_issues; echo "numbers=${#numbers[@]}"', GH_EMPTY, {
      ISSUE_TITLE_PREFIX: "p",
    });
    expect(ok.status, ok.stderr).toBe(0);
    expect(ok.stdout).toContain("numbers=0");
  });

  // 検索インデックスは結果整合。作成・リネーム直後の workflow_dispatch で未反映だと
  // 「無い」と答え、2 本目を立てる（一覧 API は即時反映）。0 件なら --search 無しで引き直す。
  test("検索が 0 件なら --search 無しで引き直し、見つかった週は 2 度引かない", () => {
    const empty = runLib('resolve_tracking_issues; echo "numbers=${numbers[*]-}"', GH_LOGGING, {
      ISSUE_TITLE_PREFIX: "p",
      LIST_OUT: "scanned=0",
    });
    expect(empty.status, empty.stderr).toBe(0);
    const calls = empty.calls.split("\n").filter((l) => l.startsWith("CALL: issue list"));
    expect(calls, "照会が 2 回でない").toHaveLength(2);
    expect(calls[0]).toContain("--search");
    expect(calls[1], "フォールバックが --search 付きで引いている").not.toContain("--search");

    // 1 件目で見つかったら引き直さない（無条件の 2 度引きになっていないこと）。
    const hit = runLib('resolve_tracking_issues; echo "numbers=${numbers[*]-}"', GH_LOGGING, {
      ISSUE_TITLE_PREFIX: "p",
      LIST_OUT: "scanned=1\n7",
    });
    expect(hit.status, hit.stderr).toBe(0);
    expect(hit.calls.split("\n").filter((l) => l.startsWith("CALL: issue list"))).toHaveLength(1);
    expect(hit.stdout).toContain("numbers=7");

    // フォールバックで拾えた週は、その経路を通ったことを stderr に残す。
    const late = runLib("resolve_tracking_issues", GH_LOGGING, {
      ISSUE_TITLE_PREFIX: "p",
      LIST_OUT: "scanned=0",
      LIST_OUT_2: "scanned=1\n9",
    });
    expect(late.status, late.stderr).toBe(0);
    expect(late.stderr).toContain("--search 無しで再取得");
  });

  // 100 件上限に張り付いたまま「無い」と結論すると、取りこぼしが黙って新規作成に化ける。
  // 打ち切りの害は**照会ごと**ではなく**動いた分岐ごと**に出るので、flag は 1 本に畳み、
  // 鳴らすかどうかは呼び出し側（触った分岐だけ `warn_if_truncated`）が決める。
  test("どちらの照会が打ち切られても truncated を立て、下回れば鳴らさない", () => {
    const probe = 'resolve_tracking_issues; warn_if_truncated "害の説明"';
    // 1 回目（--search）が上限に張り付いた。
    const first = runLib(probe, GH_LOGGING, {
      ISSUE_TITLE_PREFIX: "p",
      LIST_OUT: "scanned=100\n7",
    });
    expect(first.status, first.stderr).toBe(0);
    expect(first.stdout).toContain("::warning::open Issue の照会が 100 件で打ち切られた。害の説明");

    // 2 回目（フォールバック）だけが上限に張り付いた。
    const second = runLib(probe, GH_LOGGING, {
      ISSUE_TITLE_PREFIX: "p",
      LIST_OUT: "scanned=0",
      LIST_OUT_2: "scanned=100\n7",
    });
    expect(second.status, second.stderr).toBe(0);
    expect(second.stdout).toContain("::warning::open Issue の照会が 100 件で打ち切られた。");

    // 陰性コントロール: 上限を下回る週に鳴らさない（誤警告は毎週のノイズになる）。
    const below = runLib(probe, GH_LOGGING, {
      ISSUE_TITLE_PREFIX: "p",
      LIST_OUT: "scanned=99\n7",
    });
    expect(below.status, below.stderr).toBe(0);
    expect(below.stdout).not.toContain("::warning::");
  });

  test("既定 30 件で打ち切らず、上限と閾値を 1 箇所で決める", () => {
    const src = libSource();
    expect(src).toContain('--limit "$list_limit"');
    // 上限そのものが 30 件の既定より大きいこと（変数化で値が緩んでいないか見る）。
    const decl = src.match(/^list_limit=(\d+)$/m);
    expect(decl, "list_limit の宣言が無い").not.toBeNull();
    expect(Number(decl[1])).toBeGreaterThan(30);
    // 閾値側に数値リテラルが残っていないこと（片方だけ上げたときに誤警告と検出漏れが出る）。
    expect(src).not.toMatch(/-ge 100\b/);
    expect(src).toContain('-ge "$list_limit"');
  });

  test("完全一致の検索へ戻っていない（戻ると毎週新しい Issue が立つ）", () => {
    const src = libSource();
    expect(src).not.toMatch(/select\(\s*\.title\s*==\s*env\./);
    expect(src).toContain("startswith(env.ISSUE_TITLE_PREFIX)");
  });

  // 実式をそのまま jq へ通し、拾うべき検体と拾ってはいけない検体で弁別を測る。
  // 接頭辞は 2 つのワークフローの宣言値と、正規表現のメタ文字を含む値の 3 通りで測る
  // （照合は文字列比較なので、メタ文字でも壊れないことまで含めて固定する）。
  // 接頭辞はここでは静的な値を使う（宣言と一致することは各ワークフローのテストが見る）。
  // 収集時にワークフローを読むと、宣言を落とす変異でファイルごと収集に失敗し、
  // 「どのテストが落ちたか」で実証できなくなる。
  test.each([...WORKFLOWS.map((w) => w.prefix), "tool (a.b) [x]*"])(
    "jq 式が世代違いだけを拾う: 接頭辞 %s",
    (prefix) => {
      const probe = spawnSync("bash", ["-c", "command -v jq"], { encoding: "utf8" });
      // jq が無い環境を「該当なし＝合格」に倒さない。
      expect(probe.status, "jq が必要（このテストは jq 式を実行して弁別を測る）").toBe(0);

      const cases = [
        { title: prefix, number: 1, hit: true, why: "日付を入れる前の既存追跡 Issue" },
        { title: `${prefix} (2026-09-14)`, number: 2, hit: true, why: "通常の世代" },
        { title: `${prefix} (2026-09-21)`, number: 3, hit: true, why: "別の世代" },
        // `--search` の `is:open` はインデックス側評価で、閉じた直後の Issue が open として
        // 返る（結果整合は偽陰性だけでなく偽陽性にも振れる）。返ってきた `state` で落とす。
        {
          title: `${prefix} (2026-09-07)`,
          number: 9,
          hit: false,
          state: "CLOSED",
          why: "閉じた直後でインデックスが追いついていない",
        },
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
        writeFileSync(
          fixture,
          JSON.stringify(
            cases.map(({ number, title, state }) => ({ number, title, state: state ?? "OPEN" })),
          ),
        );
        const res = spawnSync("jq", ["-r", jqFilter(libSource()), fixture], {
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
    },
  );
});

// 探索は配布先の構成でだけ壊れる（本リポには 4 つの探索先のうち 1 つが必ず在る）。
// レポートと lib が**同じディレクトリに揃っている**ことを条件にしてあるので、
// 片方だけのディレクトリを採らないことを実際に走らせて測る。
describe("kaizen スクリプトの探索（レポートと照会を同じ版から採る）", () => {
  const wfPath = ".github/workflows/kaizen-schedule.yml";
  const SEARCH_DIRS = [
    ".claude/skills/kaizen/scripts",
    ".agents/skills/kaizen/scripts",
    ".github/skills/kaizen/scripts",
    "skills/kaizen/scripts",
  ];

  /** 探索先に指定のファイルだけを置いた使い捨てツリーを作って探索を走らせる。 */
  function locateWith(files) {
    const dir = mkdtempSync(join(tmpdir(), "tracking-tree-"));
    try {
      const target = join(dir, SEARCH_DIRS[SEARCH_DIRS.length - 1]);
      mkdirSync(target, { recursive: true });
      for (const f of files) writeFileSync(join(target, f), "# stub\n");
      return runLocate(wfPath, dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test("両方揃ったディレクトリを採り、lib のパスを出力する", () => {
    const res = locateWith(["kaizen-schedule-report.sh", "tracking-issue-lib.sh"]);
    expect(res.status, res.stderr).toBe(0);
    expect(res.outputs.script).toBe(`${SEARCH_DIRS[3]}/kaizen-schedule-report.sh`);
    expect(res.outputs.lib).toBe(`${SEARCH_DIRS[3]}/tracking-issue-lib.sh`);
  });

  test.each([["kaizen-schedule-report.sh"], ["tracking-issue-lib.sh"]])(
    "%s だけのディレクトリは採らずに落ちる",
    (only) => {
      const res = locateWith([only]);
      expect(res.status, `${only} だけで成功した`).not.toBe(0);
      expect(res.outputs, "落ちたのに出力を書いた").toStrictEqual({});
    },
  );

  test("本リポでは実在する lib を指す（探索先の 1 つに正本がある）", () => {
    const res = runLocate(wfPath, repoRoot);
    expect(res.status, res.stderr).toBe(0);
    expect(SEARCH_DIRS.map((d) => `${d}/tracking-issue-lib.sh`)).toContain(res.outputs.lib);
    expect(existsSync(join(repoRoot, res.outputs.lib))).toBe(true);
  });
});

describe.each(WORKFLOWS)(
  "$path の追跡 Issue 更新ステップ",
  ({ path, prefix, createEnv, gateVar, badValues }) => {
    const run = () => trackingStep(path);

    test("env で接頭辞を宣言し、タイトルへ UTC の更新日を付ける", () => {
      expect(declaredEnv(path, "ISSUE_TITLE_PREFIX")).toBe(prefix);
      // 固定タイトルへ戻っていないこと。`date -u` でランナーの TZ に依存させない。
      expect(run()).toContain('title="$ISSUE_TITLE_PREFIX ($(date -u +%F))"');
    });

    // 照会を再展開すると、また片方だけ直る余地ができる（Issue #420 で解消した形）。
    test("照会は lib を source して呼び、ステップ内に再展開しない", () => {
      const r = run();
      expect(r).toContain('. "$TRACKING_LIB"');
      expect(r).toMatch(/^ *resolve_tracking_issues$/m);
      // 正本の関数・上限がステップ側へ戻っていないこと。
      for (const copied of [
        "find_tracking_issues()",
        "read_matches()",
        "query_tracking_issues()",
        "warn_if_truncated()",
        "list_limit=",
        "--jq",
      ]) {
        expect(r, `${copied} がステップへ再展開されている`).not.toContain(copied);
      }
      // 宣言から解決した lib が実在すること（宣言を落とす変異はここで落ちる）。
      expect(existsSync(resolveLib(path))).toBe(true);
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

    // ステップ全体を、差し替えた `gh` と実物の lib で走らせる。静的な文字列検査では
    // 書き方を変えた瞬間に素通りするので、**実際に走らせて**測る。
    test("gh issue list が失敗したら Issue を触らずに落ちる（fail-closed）", () => {
      const failed = runStep(path, GH_FAILING, createEnv);
      expect(failed.status, "gh が失敗したのにステップが成功した").not.toBe(0);
      expect(failed.calls, "失敗した週に Issue を作成・更新・クローズした").toBe("");

      // 陽性コントロール: 同じ入力で `gh` が正常なら新規作成まで到達する
      // （到達していない経路で「触らなかった」を測っても何も実証しない）。
      // 日付は**ステップ実行の前後**で採る。後で 1 回だけ採ると、シェルの `date -u` が先・
      // JS が後という並びのため UTC の日跨ぎで期待値だけ翌日になって落ちる。
      const before = new Date().toISOString().slice(0, 10);
      const ok = runStep(path, GH_EMPTY, createEnv);
      const after = new Date().toISOString().slice(0, 10);
      expect(ok.status, ok.stderr).toBe(0);
      expect(ok.calls).toContain("issue create");
      // 接頭辞と日付が実際にタイトルへ乗っていること。ここを見ないと、空の接頭辞で
      // 走っていても「作成へ到達した」だけで緑になる。
      const titles = [...new Set([before, after])].map((d) => `--title ${prefix} (${d})`);
      expect(
        titles.some((t) => ok.calls.includes(t)),
        ok.calls,
      ).toBe(true);
    });

    // 照会できないまま分岐へ進むと、`numbers` が未設定のまま新規作成へ倒れて重複を作る。
    // lib を読めない構成（配布先の古いインストール・パスの typo）でも Issue を触らない。
    test("lib を読めないときは Issue を触らずに落ちる", () => {
      const res = runStep(path, GH_EMPTY, {
        ...createEnv,
        TRACKING_LIB: join(repoRoot, "no/such/tracking-issue-lib.sh"),
      });
      expect(res.status, "lib が無いのにステップが成功した").not.toBe(0);
      expect(res.calls, "lib が無い週に Issue を触った").toBe("");
    });

    // ステップの挙動を決める入力は、空・仕様外の値で**黙って片側へ倒れる**。
    // `[ "$PENDING_COUNT" = 0 ]` は文字列比較なので、空文字は「未適用あり」側へ倒れ、
    // 件数の抜けたコメントを投稿しつつ Issue を更新した（実測）。gh を呼ぶ前に落とす。
    test.each(badValues)(`${gateVar}="%s" なら Issue を触らずに落ちる`, (bad) => {
      const res = runStep(path, GH_EMPTY, { ...createEnv, [gateVar]: bad });
      expect(res.status, `${gateVar}="${bad}" で成功した`).not.toBe(0);
      expect(res.calls, `${gateVar}="${bad}" で Issue を触った`).toBe("");
    });

    test("クローズ時はリネームしない（閉じた Issue は当時の日付で固定する）", () => {
      const { close } = branches(run());
      expect(close).toContain("gh issue close");
      expect(close).not.toContain("--title");
    });

    // 打ち切りの害は**動いた分岐ごと**に出る:
    //   作成 → 重複を作る / 更新 → 別の Issue を更新する / クローズ → 閉じ残す
    // 一方、何もしない分岐では害が無いので鳴らさない（追跡 Issue が無い正常な定常状態で
    // 毎週ノイズになる）。
    test("打ち切りの警告は Issue を触った分岐すべてに置き、何もしない分岐には置かない", () => {
      const r = run();
      const { create, close, update } = branches(r);
      for (const [name, branch] of [
        ["create", create],
        ["update", update],
        ["close", close],
      ]) {
        expect(branch, `${name} 分岐に打ち切り警告が無い`).toContain("warn_if_truncated ");
      }
      // 何もしない側（追跡 Issue が 1 件も無い）では鳴らさない。
      // **`indexOf("\nelse\n")` で切らない**——`yaml.load` の字下げ剥がしの後もこの `else` は
      // 入れ子のぶん字下げされており、-1 が返って検査対象が改行 1 文字になる。素通りして、
      // 何もしない分岐へ警告を挿す変異が緑のまま通った（実測）。
      const doNothing = close.match(/[\s\S]*\n *else\n([\s\S]*)$/);
      expect(doNothing, "何もしない分岐を切り出せない").not.toBeNull();
      // 切り出せた中身が本当に「何もしない」側であることの陽性コントロール。
      expect(doNothing[1]).toContain("何もしない");
      expect(doNothing[1]).not.toContain("warn_if_truncated");
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

    /** ステップの `run` を、差し替えた `gh` と宣言から解決した lib で実際に走らせる。 */
    function runStep(wfPath, ghScript, env) {
      // 宣言が実在の lib を指していることは先に確かめる（宣言を落とす変異はここで落ちる）。
      resolveLib(wfPath);
      return runBash(trackingStep(wfPath), ghScript, {
        // ステップは workflow-level の `env:` に依存する。`run` だけ取り出すこのヘルパには
        // 届かないので、宣言から読んで明示的に渡す（渡さないと空の接頭辞で走る）。
        ISSUE_TITLE_PREFIX: declaredEnv(wfPath, "ISSUE_TITLE_PREFIX"),
        // **正本を source して測る**（インストール済みコピーではなく）。理由は `resolveLib`。
        TRACKING_LIB: libPath,
        ...env,
      });
    }
  },
);
