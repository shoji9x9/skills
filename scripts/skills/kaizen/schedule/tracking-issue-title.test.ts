import { describe, test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTempDir } from "../../../lib/testing/test-tmpdir.ts";
import { CHILD_TIMEOUT_MS } from "../../../lib/testing/child-timeout.ts";
import {
  declaredEnv,
  GH_EMPTY,
  GH_FAILING,
  GH_LOGGING,
  jqFilter,
  jqProbeCases,
  libPath,
  libSource,
  repoRoot,
  resolveLib,
  runBash,
  runLib,
  runLocate,
  TODAY,
  trackingStep,
  WORKFLOWS,
} from "./tracking-issue-title-helpers.ts";

// 週次ワークフローの追跡 Issue は、タイトルが固定文字列だと手動クローズのたびに
// 同名の Issue が open / closed に並び、一覧で世代を区別できない（Issue #417）。
// タイトルへ更新日を入れ、既存 Issue は「接頭辞 + 空 or (YYYY-MM-DD)」で引く。
//
// この照合には、次のように**両側の間違え方がある**。
//   - 狭すぎる（完全一致のまま）→ 毎週新しい Issue が立ち、追跡が分裂する
//   - 広すぎる（素の前方一致）→ 接頭辞で始まるだけの無関係な Issue を毎週上書きする
// どちらも run は緑のまま進むので、実際の jq 式を取り出してラベル付き検体で区別できるかを測る。
//
// 照会の原本は同梱スクリプト 1 本（`skills/kaizen/scripts/tracking-issue-lib.sh`）で、
// 2 つのワークフローがそれを source する（Issue #420 で約 100 行の重複を解消した）。
// このファイルは、次の 2 層に分けて検査する。
//   - lib: 実際に source して**挙動**を測る（照合・フォールバック・打ち切り・照会できないときの停止）
//   - ワークフロー: lib を呼んでいること＋分岐（リネーム・クローズ・警告）の**組み込み**
//
// **ミューテーションテストの結果は散文で持たない。** 以前はこの位置に A〜U のコメントとして置いていた。
// しかし、テストを直した瞬間に検証されない主張になる（実際に 3 通りの食い違い方をした。Issue #420）。
// 変異は `scripts/skills/kaizen/schedule/tracking-issue-title.mutations.json` にデータとして持つ。
// `node scripts/mutation/check-mutation-proof.ts` が、「置換が当たったこと」と「狙ったテストが
// 失敗したこと」の両方を機械で確かめる。
describe("照会の原本（tracking-issue-lib.sh）", () => {
  // **接頭辞が空なら `gh` を呼ぶ前に失敗する。** 空のまま進むと `startswith("")` が全 open
  // Issue に当たり、無関係な Issue をリネームして本文を上書きする。
  // 「呼ばなかった」は照会まで記録するスタブでないと測れない（変更系だけ記録するスタブでは、
  // 照会が実行されても空のまま緑になる）。
  test("接頭辞が空なら gh を 1 度も呼ばずに失敗する", () => {
    const res = runLib("resolve_tracking_issues", GH_LOGGING, { ISSUE_TITLE_PREFIX: "" });
    expect(res.status, "空の接頭辞で成功した").not.toBe(0);
    expect(res.calls, "空の接頭辞で gh を呼んだ").toBe("");

    // 検出されることの確認: 接頭辞があれば、同じスクリプトが照会まで到達する
    // （到達しない呼び出し方で「呼ばなかった」を測っても何も実証しない）。
    const ok = runLib("resolve_tracking_issues", GH_LOGGING, { ISSUE_TITLE_PREFIX: "p" });
    expect(ok.status, ok.stderr).toBe(0);
    expect(ok.calls).toContain("CALL: issue list");
  });

  // **`gh` の失敗を「追跡 Issue が無い」として扱わない。** `$( )` を代入に置けば `set -e` が
  // 拾うが、関数の引数に置くと終了コードが捨てられる（実測）。捨てると secondary rate
  // limit や 5xx を踏んだ週に「0 件」と読み、既存 Issue を残したまま 2 本目を作って緑で終わる。
  test("gh issue list が失敗したら非 0 で返る", () => {
    const res = runLib("resolve_tracking_issues", GH_FAILING, { ISSUE_TITLE_PREFIX: "p" });
    expect(res.status, "gh が失敗したのに成功した").not.toBe(0);
    expect(res.calls, "失敗した照会の後に Issue を触った").toBe("");

    // 検出されることの確認: 同じ呼び出しで `gh` が正常なら、0 件として返る。
    const ok = runLib('resolve_tracking_issues; echo "numbers=${#numbers[@]}"', GH_EMPTY, {
      ISSUE_TITLE_PREFIX: "p",
    });
    expect(ok.status, ok.stderr).toBe(0);
    expect(ok.stdout).toContain("numbers=0");
  });

  // **照会できないときの停止を、呼び出し側の `set -e` に依存させない。**
  // `if resolve_tracking_issues; then` や `|| ...` の左辺では errexit が機能しない。
  // そのため、照会の失敗を関数の戻り値で伝える必要がある
  // （伝えないと 0 件として新規作成の側へ進み、既存 Issue を残したまま 2 本目を立てる）。
  test("errexit が無効な文脈でも照会の失敗を戻り値で伝える", () => {
    const probe =
      'if resolve_tracking_issues; then echo "REACHED-SUCCESS"; else echo "FAILED-CLOSED"; fi';
    const failed = runLib(probe, GH_FAILING, { ISSUE_TITLE_PREFIX: "p" });
    expect(failed.stdout, "gh の失敗が成功として返った").toContain("FAILED-CLOSED");
    expect(failed.stdout).not.toContain("REACHED-SUCCESS");

    // 検出されることの確認: 同じ文脈で gh が正常なら、成功側へ入る。
    const ok = runLib(probe, GH_EMPTY, { ISSUE_TITLE_PREFIX: "p" });
    expect(ok.stdout).toContain("REACHED-SUCCESS");
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

    // フォールバックで拾えた週は、その処理を通ったことを stderr に残す。
    const late = runLib("resolve_tracking_issues", GH_LOGGING, {
      ISSUE_TITLE_PREFIX: "p",
      LIST_OUT: "scanned=0",
      LIST_OUT_2: "scanned=1\n9",
    });
    expect(late.status, late.stderr).toBe(0);
    expect(late.stderr).toContain("--search 無しで再取得");
  });

  // 100 件上限に張り付いたまま「無い」と結論すると、取りこぼしが警告なしに新規作成になる。
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

    // 誤検知しないことの確認: 上限を下回る週に鳴らさない（誤警告は毎週のノイズになる）。
    const below = runLib(probe, GH_LOGGING, {
      ISSUE_TITLE_PREFIX: "p",
      LIST_OUT: "scanned=99\n7",
    });
    expect(below.status, below.stderr).toBe(0);
    expect(below.stdout).not.toContain("::warning::");
  });

  // 打ち切り判定 `[ "$scanned" -ge "$list_limit" ]` は `if` の条件なので `set -e` が機能しない。
  // 非数値だと bash が `integer expression expected` を出して非 0 を返すが、その非 0 は
  // `truncated=false` として通過する（＝打ち切りを警告なしに成功として扱う）。入力の側で失敗させる。
  test("走査件数が 10 進でなければ落ちる（打ち切りを判定できないまま通さない）", () => {
    const res = runLib('resolve_tracking_issues; echo "REACHED-END"', GH_LOGGING, {
      ISSUE_TITLE_PREFIX: "p",
      LIST_OUT: "scanned=NaN\n7",
    });
    expect(res.status, "非数値の走査件数で成功した").not.toBe(0);
    expect(res.stdout).not.toContain("REACHED-END");
    expect(res.stderr).toContain("走査件数が 10 進でない");

    // 誤検知しないことの確認: 10 進なら通る（この検査が常に失敗させるだけの形になっていないこと）。
    const ok = runLib('resolve_tracking_issues; echo "REACHED-END"', GH_LOGGING, {
      ISSUE_TITLE_PREFIX: "p",
      LIST_OUT: "scanned=1\n7",
    });
    expect(ok.status, ok.stderr).toBe(0);
    expect(ok.stdout).toContain("REACHED-END");
  });

  // `gh issue list` の既定は 30 件なので、上限を渡さないと open の Issue が多いリポジトリで取りこぼす。
  // 打ち切りの閾値を上限と別の値で持つと、片方だけ変えたときに誤警告と見逃しが出る。
  // 上限の値を変えた lib で、照会の --limit と打ち切りの警告が同じ値に揃うことを確かめる
  // （既定の上限のままでは、閾値を同じ数のリテラルで書いた形と区別できない）。
  test("照会は既定の 30 件より多く取得し、打ち切りの閾値を取得の上限に揃える", () => {
    const probe = 'resolve_tracking_issues; warn_if_truncated "害の説明"';
    const limitOf = (calls: string) =>
      calls
        .split("\n")
        .filter((l) => l.startsWith("CALL: issue list"))
        .map((l) => Number(l.match(/--limit (\d+)/)?.[1]));

    const byDefault = runLib(probe, GH_LOGGING, {
      ISSUE_TITLE_PREFIX: "p",
      LIST_OUT: "scanned=1\n7",
    });
    expect(byDefault.status, byDefault.stderr).toBe(0);
    const [defaultLimit] = limitOf(byDefault.calls);
    expect(defaultLimit, byDefault.calls).toBeGreaterThan(30);

    const lowered = (scanned: number) =>
      runBash(`. ${JSON.stringify(libPath)}\nlist_limit=50\n${probe}\n`, GH_LOGGING, {
        ISSUE_TITLE_PREFIX: "p",
        LIST_OUT: `scanned=${scanned}\n7`,
      });
    const atLimit = lowered(50);
    expect(atLimit.status, atLimit.stderr).toBe(0);
    expect(limitOf(atLimit.calls)).toStrictEqual([50]);
    expect(atLimit.stdout).toContain("::warning::open Issue の照会が 50 件で打ち切られた。");
    // 誤検知しないことの確認: 上限を下回れば鳴らさない。
    const below = lowered(49);
    expect(below.status, below.stderr).toBe(0);
    expect(below.stdout).not.toContain("::warning::");
  });

  // 完全一致の検索へ戻すと、下の「jq 式が世代違いだけを拾う」の日付つきの検体を拾わなくなる。
  // 実式をそのまま jq へ通し、拾うべき検体と拾ってはいけない検体で、区別できるかを測る。
  // 接頭辞は 2 つのワークフローの宣言値と、正規表現のメタ文字を含む値の 3 通りで測る
  // （照合は文字列比較なので、メタ文字でも誤らないことまで含めて固定する）。
  // 接頭辞はここでは静的な値を使う（宣言と一致することは各ワークフローのテストが見る）。
  // 収集時にワークフローを読むと、宣言を落とす変異でファイルごと収集に失敗し、
  // 「どのテストが落ちたか」で実証できなくなる。
  test.each([...WORKFLOWS.map((w) => w.prefix), "tool (a.b) [x]*"])(
    "jq 式が世代違いだけを拾う: 接頭辞 %s",
    (prefix) => {
      const probe = spawnSync("bash", ["-c", "command -v jq"], {
        timeout: CHILD_TIMEOUT_MS,
        encoding: "utf8",
      });
      // jq が無い環境を「該当なし＝合格」として扱わない。
      expect(probe.status, "jq が必要（このテストは jq 式を実行して区別できるかを測る）").toBe(0);

      const cases = jqProbeCases(prefix);
      // 両側に検体があることを確かめる（片側だけだと区別できるかを測れない）。
      expect(cases.some((c) => c.hit)).toBe(true);
      expect(cases.some((c) => !c.hit)).toBe(true);

      const dir = makeTempDir("tracking-issue-");
      try {
        const fixture = join(dir, "issues.json");
        writeFileSync(
          fixture,
          JSON.stringify(
            cases.map(({ number, title, state }) => ({ number, title, state: state ?? "OPEN" })),
          ),
        );
        const res = spawnSync("jq", ["-r", jqFilter(libSource()), fixture], {
          timeout: CHILD_TIMEOUT_MS,
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

// 探索は配布先の構成でだけ失敗する（本リポには 4 つの探索先のうち 1 つが必ず在る）。
// レポートと lib が**同じディレクトリに揃っている**ことを条件にしてあるので、
// 片方だけのディレクトリを採らないことを、実際に実行して測る。
describe("kaizen スクリプトの探索（レポートと照会を同じバージョンから採る）", () => {
  const wfPath = ".github/workflows/kaizen-schedule.yml";
  const SEARCH_DIRS = [
    ".claude/skills/kaizen/scripts",
    ".agents/skills/kaizen/scripts",
    ".github/skills/kaizen/scripts",
    "skills/kaizen/scripts",
  ];

  /** 探索先に指定のファイルだけを置いた使い捨てツリーを作り、探索する。 */
  function locateWith(files: string[]) {
    const dir = makeTempDir("tracking-tree-");
    try {
      const target = join(dir, SEARCH_DIRS[SEARCH_DIRS.length - 1]);
      mkdirSync(target, { recursive: true });
      // `gh skill install` が配るのと同じ 644 にする。探索が実行ビット（`-x`）で判定すると、ここで見つからない。
      for (const f of files) {
        writeFileSync(join(target, f), "# stub\n");
        chmodSync(join(target, f), 0o644);
      }
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
    "%s だけのディレクトリは採らずに失敗する",
    (only) => {
      const res = locateWith([only]);
      expect(res.status, `${only} だけで成功した`).not.toBe(0);
      expect(res.outputs, "落ちたのに出力を書いた").toStrictEqual({});
    },
  );

  test("本リポでは実在する lib を指す（探索先の 1 つに原本がある）", () => {
    const res = runLocate(wfPath, repoRoot);
    expect(res.status, res.stderr).toBe(0);
    expect(SEARCH_DIRS.map((d) => `${d}/tracking-issue-lib.sh`)).toContain(res.outputs.lib);
    expect(existsSync(join(repoRoot, res.outputs.lib))).toBe(true);
  });
});

describe.each(WORKFLOWS)(
  "$path の追跡 Issue 更新ステップ",
  ({ path, prefix, createEnv, closeEnv, gateVar, badValues }) => {
    const run = () => trackingStep(path);
    /** 照会を除いた gh の呼び出し（作成・更新・コメント・クローズ）。 */
    const changes = (calls: string) =>
      calls.split("\n").filter((l) => l.startsWith("CALL: ") && !l.startsWith("CALL: issue list"));
    /** ステップを実行し、固定した日付（TODAY）で付くタイトルを添えて返す。 */
    const runDated = (env: NodeJS.ProcessEnv) => {
      const res = runStep(path, GH_LOGGING, env);
      return { ...res, titles: [`--title ${prefix} (${TODAY})`] };
    };

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
      // 原本の関数・上限がステップ側へ戻っていないこと。
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
      const updated = runDated({ ...createEnv, LIST_OUT: "scanned=1\n7" });
      expect(updated.status, updated.stderr).toBe(0);
      const edits = changes(updated.calls).filter((l) => l.startsWith("CALL: issue edit 7 "));
      expect(edits, updated.calls).toHaveLength(1);
      expect(
        updated.titles.some((t) => edits[0]?.includes(t)),
        edits[0],
      ).toBe(true);

      const created = runDated({ ...createEnv, LIST_OUT: "scanned=0" });
      expect(created.status, created.stderr).toBe(0);
      const creates = changes(created.calls).filter((l) => l.startsWith("CALL: issue create "));
      expect(creates, created.calls).toHaveLength(1);
      expect(
        created.titles.some((t) => creates[0]?.includes(t)),
        creates[0],
      ).toBe(true);
    });

    // ステップ全体を、差し替えた `gh` と実物の lib で実行する。静的な文字列検査では
    // 書き方を変えた瞬間に素通りするので、**実際に実行して**測る。
    test("gh issue list が失敗したら Issue を触らずに失敗する", () => {
      const failed = runStep(path, GH_FAILING, createEnv);
      expect(failed.status, "gh が失敗したのにステップが成功した").not.toBe(0);
      expect(failed.calls, "失敗した週に Issue を作成・更新・クローズした").toBe("");

      // 検出されることの確認: 同じ入力で `gh` が正常なら、新規作成まで到達する
      // （到達していない呼び出し方で「触らなかった」を測っても何も実証しない）。
      const ok = runStep(path, GH_EMPTY, createEnv);
      expect(ok.status, ok.stderr).toBe(0);
      expect(ok.calls).toContain("issue create");
      // 接頭辞と日付が実際にタイトルへ乗っていること。ここを見ないと、空の接頭辞で
      // 実行していても「作成へ到達した」だけで緑になる。
      expect(ok.calls).toContain(`--title ${prefix} (${TODAY})`);
    });

    // 照会できないまま分岐へ進むと、`numbers` が未設定のまま新規作成の側へ進み、重複を作る。
    // lib を読めない構成（配布先の古いインストール・パスの typo）でも Issue を触らない。
    test("lib を読めないときは Issue を触らずに失敗する", () => {
      const res = runStep(path, GH_EMPTY, {
        ...createEnv,
        TRACKING_LIB: join(repoRoot, "no/such/tracking-issue-lib.sh"),
      });
      expect(res.status, "lib が無いのにステップが成功した").not.toBe(0);
      expect(res.calls, "lib が無い週に Issue を触った").toBe("");
    });

    // ステップの挙動を決める入力は、空・仕様外の値だと**警告なしに片側と判定されてしまう**。
    // `[ "$PENDING_COUNT" = 0 ]` は文字列比較なので、空文字は「未適用あり」側と判定され、
    // 件数の抜けたコメントを投稿しつつ Issue を更新した（実測）。gh を呼ぶ前に失敗させる。
    test.each(badValues)(`${gateVar}="%s" なら Issue を触らずに失敗する`, (bad) => {
      const res = runStep(path, GH_EMPTY, { ...createEnv, [gateVar]: bad });
      expect(res.status, `${gateVar}="${bad}" で成功した`).not.toBe(0);
      expect(res.calls, `${gateVar}="${bad}" で Issue を触った`).toBe("");
    });

    test("クローズ時はリネームしない（閉じた Issue は当時の日付で固定する）", () => {
      const res = runStep(path, GH_LOGGING, { ...closeEnv, LIST_OUT: "scanned=1\n7" });
      expect(res.status, res.stderr).toBe(0);
      const done = changes(res.calls);
      // 検出されることの確認: クローズの分岐へ到達している。
      expect(
        done.some((l) => l.startsWith("CALL: issue close 7 ")),
        res.calls,
      ).toBe(true);
      expect(
        done.filter((l) => l.startsWith("CALL: issue edit")),
        res.calls,
      ).toStrictEqual([]);
      expect(
        done.filter((l) => l.includes("--title")),
        res.calls,
      ).toStrictEqual([]);
    });

    // 打ち切りの害は**動いた分岐ごと**に出る:
    //   作成 → 重複を作る / 更新 → 別の Issue を更新する / クローズ → 閉じ残す
    // 一方、何もしない分岐では害が無いので鳴らさない（追跡 Issue が無い正常な定常状態で
    // 毎週ノイズになる）。照会は 4 つとも上限の 100 件に張り付かせる。
    test.for([
      ["作成", "create", "scanned=100", true],
      ["更新", "update", "scanned=100\n7", true],
      ["クローズ", "close", "scanned=100\n7", true],
      ["何もしない", "close", "scanned=100", false],
    ] as const)(
      "打ち切りの警告は Issue を触った分岐すべてに置き、何もしない分岐には置かない: %s",
      ([, side, listOut, warned]) => {
        const env = side === "close" ? closeEnv : createEnv;
        const res = runStep(path, GH_LOGGING, { ...env, LIST_OUT: listOut });
        expect(res.status, res.stderr).toBe(0);
        // どの分岐へ入ったかを、gh の呼び出しの有無で確かめる。
        expect(changes(res.calls).length > 0, res.calls).toBe(warned);
        expect(res.stdout.includes("::warning::open Issue の照会が"), res.stdout).toBe(warned);
      },
    );

    // 一致が複数のときの扱いは分岐で違う（更新は最古 1 本、クローズは全件）。
    // 分岐前の行で「何をするか」を断定すると run ログが実挙動と食い違う。
    test("複数一致の通知は分岐前で挙動を断定しない", () => {
      const closed = runStep(path, GH_LOGGING, { ...closeEnv, LIST_OUT: "scanned=2\n7\n9" });
      expect(closed.status, closed.stderr).toBe(0);
      expect(closed.stderr).toContain("追跡 Issue が 2 件ある");
      expect(closed.stderr).toContain("閉じた: #7");
      expect(closed.stderr).toContain("閉じた: #9");
      // クローズの分岐は更新しないので、更新すると書いた通知を出さない。
      expect(closed.stderr).not.toContain("更新する");

      const updated = runStep(path, GH_LOGGING, { ...createEnv, LIST_OUT: "scanned=2\n7\n9" });
      expect(updated.status, updated.stderr).toBe(0);
      expect(updated.stderr).toContain("追跡 Issue が 2 件ある");
      expect(updated.stderr).toContain("更新するのは最も古い #7");
      expect(updated.stderr).not.toContain("閉じた");
    });

    // 最古の 1 本だけ閉じると、残りが「未対応がある」という本文のまま open で残り、
    // 一覧に矛盾した追跡 Issue が並ぶ。閉じるときは一致した全部を閉じる。
    test("クローズは一致した全件に当てる（更新は最古 1 本だけ）", () => {
      const closed = runStep(path, GH_LOGGING, { ...closeEnv, LIST_OUT: "scanned=2\n7\n9" });
      expect(closed.status, closed.stderr).toBe(0);
      const closes = changes(closed.calls).filter((l) => l.startsWith("CALL: issue close "));
      expect(
        closes.map((l) => l.split(" ")[3]),
        closed.calls,
      ).toStrictEqual(["7", "9"]);

      // 更新側は 1 本だけ（全件に当てる形へ広げていないことの確認）。
      const updated = runStep(path, GH_LOGGING, { ...createEnv, LIST_OUT: "scanned=2\n7\n9" });
      expect(updated.status, updated.stderr).toBe(0);
      const edits = changes(updated.calls).filter((l) => l.startsWith("CALL: issue edit "));
      expect(
        edits.map((l) => l.split(" ")[3]),
        updated.calls,
      ).toStrictEqual(["7"]);
    });

    /** ステップの `run` を、差し替えた `gh` と宣言から解決した lib で実際に実行する。 */
    function runStep(wfPath: string, ghScript: string, env: NodeJS.ProcessEnv) {
      // 宣言が実在の lib を指していることは先に確かめる（宣言を落とす変異はここで落ちる）。
      resolveLib(wfPath);
      return runBash(trackingStep(wfPath), ghScript, {
        // ステップは workflow-level の `env:` に依存する。`run` だけ取り出すこのヘルパには
        // 届かないので、宣言から読んで明示的に渡す（渡さないと空の接頭辞で実行される）。
        ISSUE_TITLE_PREFIX: declaredEnv(wfPath, "ISSUE_TITLE_PREFIX"),
        // **原本を source して測る**（インストール済みコピーではなく）。理由は `resolveLib`。
        TRACKING_LIB: libPath,
        ...env,
      });
    }
  },
);

// runner にはログインの設定が無く、`GH_TOKEN` だけを持つ。remote が github.com 以外を指すと、
// gh はホストを解決できずに失敗する（Issue #780）。ホストは `GITHUB_SERVER_URL` から決めて渡す。
describe("kaizen-schedule.yml の追跡 Issue 更新ステップが gh に渡すホスト", () => {
  const wfPath = ".github/workflows/kaizen-schedule.yml";
  // gh の呼び出しごとに、受け取った GH_HOST を記録するスタブ。照会は 0 件を返す。
  const GH_HOST_LOGGING = `#!/usr/bin/env bash
set -euo pipefail
printf 'HOST: %s CALL: %s\\n' "\${GH_HOST-unset}" "$*" >>"$GH_LOG"
if [ "\${1-}" = issue ] && [ "\${2-}" = list ]; then
  echo "scanned=0"
fi
`;

  test.each([
    ["https://github.com", "github.com"],
    ["https://example.ghe.com", "example.ghe.com"],
    ["https://ghes.example.internal", "ghes.example.internal"],
  ])("GITHUB_SERVER_URL=%s なら、すべての gh の呼び出しに GH_HOST=%s を渡す", (url, host) => {
    const res = runBash(trackingStep(wfPath), GH_HOST_LOGGING, {
      ISSUE_TITLE_PREFIX: declaredEnv(wfPath, "ISSUE_TITLE_PREFIX"),
      TRACKING_LIB: libPath,
      PENDING_COUNT: "3",
      GITHUB_SERVER_URL: url,
      // 呼び出し元の環境に GH_HOST があっても、ステップの値で上書きすることを確かめる。
      GH_HOST: "stale.example.com",
    });
    expect(res.status, res.stderr).toBe(0);
    // 引数（jq の式）は改行を含むので、記録を行ではなく呼び出しの先頭の `HOST: ` で区切る。
    const calls = [...res.calls.matchAll(/^HOST: (\S+) CALL: (\S+ \S+)/gm)].map((m) => ({
      host: m[1],
      command: m[2],
    }));
    // 照会と作成の両方に到達している（呼び出しが 0 件の緑を根拠にしない）。
    const commands = calls.map((c) => c.command);
    expect(commands, res.calls).toContain("issue list");
    expect(commands, res.calls).toContain("issue create");
    expect(new Set(calls.map((c) => c.host)), res.calls).toStrictEqual(new Set([host]));
  });

  // GitHub Enterprise Server のホストでは、gh は GH_TOKEN を読まず GH_ENTERPRISE_TOKEN を読む。
  // https://cli.github.com/manual/gh_help_environment
  test("GitHub Enterprise Server 向けに、GH_ENTERPRISE_TOKEN にも同じトークンを渡す", () => {
    expect(declaredEnv(wfPath, "GH_ENTERPRISE_TOKEN")).toBe(declaredEnv(wfPath, "GH_TOKEN"));
  });
});
