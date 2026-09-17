# 収束判定と差し戻し（parity-replace / issue-create）

## 収束の定義

**収束＝未説明差分ゼロ かつ 未修正回帰ゼロ**（全差分が系統差／宣言済み例外に分類済み）。**生の差分ゼロは求めない**（実装・ライブラリが違えば正当な差は残る）。

- **差分器が判定する。** [`../scripts/diff-normalize.mjs`](../scripts/diff-normalize.mjs) の機械分類と `diff.md` の分類集計で判定し、**モデルの主観（「もう同じに見えます」）を根拠にしない**
- 収束の条件:
  - `diff-normalize.mjs` の出力に `unexplained` / `deviates_T` / `pending_review` が無い
  - [`triage.md`](triage.md) の「許容」がすべてユーザー承認済みで記録先（設定ファイルの `component_diffs` / `intentional_diffs`、または
    `.replace/parity/<slug>/component-diff-exceptions.json` ＋ 根拠の `component-diff-exceptions.md`）へ非破壊追記済み。
    `diff.md` に**承認前の分類**（`許容候補（要確認）`）が 1 件も残っていない（承認前は未説明として数える）。
    **承認の単位は原因**（正本: [`triage.md`](triage.md)「承認の単位は原因」）なので、原因が承認済みならそれを参照する N インスタンスは承認済みとして数える——
    インスタンスごとの承認記録が無いことを未承認の根拠にしない。
    ただし**承認済みとして数えられるのは承認記録が覆う件数まで**——原因ごとに、`component-diff-exceptions.md` の承認記録の
    **各行の「この承認で覆った件数 N」を合計した累計**（承認が 1 回なら その 1 行の N）と
    JSON でその `cause` を参照するインスタンス数が一致することを確認する。JSON 側が多ければ**承認後に足された未承認インスタンス**があるので、
    超過分は未説明として数え収束させない（増分の承認を取って記録へ追記する。手順は `triage.md`「承認の単位は原因」）
  - インスタンス例外の台帳に**照合に使えない不整合が無い**（`cause` が解決できない・`evidence` が空・`slug` 不一致・照合キー〈`page` / `viewport` / `element`〉欠落。
    `diff-metadata.json.accepted_exceptions.unresolved` が 0。不整合な例外は吸収されないため該当候補が `unexplained` として残る）
  - `diff-metadata.json` の `blocked_by[]` が空（他機能待ちが残っていれば下記「他機能待ちの差分」の状態であって収束ではない）
  - 未検証領域（下記）が `diff.md` に「未検証」として残されている（確認済みにしていない）
  - **`diff-metadata.json` の `pending_decisions[]` に未解決（`resolution: null`）の保留が無い**（自律実行で人の判断待ちにした保留。記録の形の正本は `replace-strategy` の `references/autonomy.md`。
    本スキルは毎回このキーを書く——自律実行でない実行・保留の無い実行は空配列）
  - **意図的差異の保留（`intentional_diffs.pending`）の棚卸しが済んでいる**（下記「`intentional_diffs.pending` の棚卸し」）。
    数え直しは [`../scripts/pending-triage-check.mjs`](../scripts/pending-triage-check.mjs) が行う（**記録された件数を信用せず設定ファイルの `pending` から数え直す**）:

    ```bash
    node <skill>/scripts/pending-triage-check.mjs --registries <registries.json> --metadata .replace/parity/<slug>/new/<target>/diff-metadata.json
    ```

    **渡す `registries.json` は棚卸しの後の設定ファイルから組み立て直したもの**にする（正規化のときのスナップショットを使い回すと、人が `keep` / `may_change` へ移した要素が `pending` に残って見え、正しい記録が不整合として落ちる。組み立て方は [`normalize.md`](normalize.md)「registries.json の組み立て」）。
    終了コードは 0 ＝ 棚卸し済み、1 ＝ 未棚卸し・記録の不整合が残る、2 ＝ 使い方の誤り・型崩れ（設定ファイル側に `intentional_diffs.pending` が無い・配列でない場合を含む）。1 以上なら収束させず棚卸しを行う
  - **部品被覆表に未測定が残っていない**（正本は `parity-suite` の `references/coverage.md`「部品被覆表」）。
    **この項目が防ぐのは「測っていない操作が差分ゼロとして通る」ことだけで、部品の見た目の担保ではない**——被覆表は操作と状態の有無しか数えない。
    見た目は下の画素・特性照合の項目が見る（画面より先に作った共通部品では `parity-component` が別に持つ）。**未測定 0 を見た目の一致の根拠にしない**。
    `.replace/parity/<slug>/metadata.json` の `component_coverage.declared` が `true` のときだけ判定に入り、
    数え直しは [`../scripts/coverage-check.mjs`](../scripts/coverage-check.mjs) が行う（**宣言された件数を信用せず被覆表から数え直す**。目視で数えない）:

    ```bash
    node <skill>/scripts/coverage-check.mjs --metadata .replace/parity/<slug>/metadata.json
    ```

    未測定として数えるのは `value: unmeasured` のセル、期待セルの組み合わせのうち**行が無いもの**、
    `present` / `absent` なのに `evidence` が空のもの、`present` なのに `covered_by` が空のもの、`absent` なのに `absence_evidence.kind` が無い・未知のもの、
    `kind: non-renderable` で次のいずれかを欠くもの——`locator_includes_hidden: true`（hidden を含む引き方の実測。通常の `getByRole` は hidden を除外するため、これが無いと 0 件を DOM 不在と読み替えられる）、一意な locator
    （状態ごとの `locator_match_count` が 0 または 1 で、0 の状態は矩形・`offset_parent`・`hidden_by` が全て `null`、かつ 1 件の状態が 1 つ以上ある）、
    状態の導出源、`states_exhaustive: true`、インスタンス側の完全な `applicable_states` manifest
    （`source.kind` が `profile` / `vendor-spec` / `current-source` / `app-ui` のいずれかであることを含む）、
    `expected_states` / `states[].name` / manifest 状態 id の一意な完全一致と遷移一致、1 件以上の状態別証拠（矩形、`offset_parent`、0 寸法または対象本人／祖先との検証済み関係を持つ非表示原因）。
    **同じ組み合わせの重複行**（先勝ちにしない）。`kind: fired-without-response` で次のいずれかを欠くもの——`action`（`locator`、語彙内の `method`、`detail`、正の矩形、`visible: true`、
    `actionability_bypassed: false`。`coordinate` では `hit_test_target` と `hit_test_is_target_or_descendant: true` も）、`fired`（語彙内の `signal` / `detail` / `verified: true`）、`observation`。
    **期待セルの取り方は部品が被覆プロファイルを宣言しているかで変わる**（プロファイルの契約は `parity-suite` の `references/coverage-profiles.md` が正本）:
    宣言していない部品（`profile: null` ＋ `profile_absent_reason`）は 項目 × インスタンス、宣言した部品は**インスタンスごとに記録された候補**（`instances[].candidates`）。
    プロファイル本体は `parity-suite` の同梱物なので**ここでは読まず**、被覆表に記録された列挙・候補・適合結果から数え直す。
    **集合の来歴と完全性も数え直しの対象**（正本は `parity-suite` の `references/coverage.md`「3 つの集合に来歴と完全性を要求する」）——
    **`component_inventory`（部品の集合）と `components[].instance_inventory`（インスタンスの集合）が無い・`source` の
    `kind` / `ref` / `version` / `condition` が空・`kind` が `current-source` / `config` / `app-ui` のいずれでもない・
    `complete` が `true` でない**（`false` は `incomplete_reason` 必須。逆に `true` なのに `incomplete_reason` が残っていれば効いていない免除）、および
    **一次情報源（`current-source`）以外で列挙したのに `stronger_source_unavailable_reason` が空**（逆に一次情報源で列挙したのに理由が書かれている＝効いていない免除）は、
    未測定として数える。**数え方の粒度は宣言の置き場所に揃える**——`component_inventory` の不備は表全体で 1 件、
    `components[].instance_inventory` と `components[].source` の不備は**その部品で合算して 1 件**（同じ部品の 2 つの宣言が両方欠けても 2 件にはしない）。
    **列挙しなかった部品・インスタンスは期待セルにも現れない**ため、集合の側で宣言させない限り測り漏れは `unmeasured` 0 で収束する。
    **`components[].source`（項目集合の来歴）も同じく検査する**——`kind` / `ref` / `retrieved_at` の非空と、
    `kind` が `vendor-feature-list` / `vendor-test-spec` / `official-sample` / `current-source` / `app-ui` のいずれかであること。
    プロファイル経路で追加で落とすのは次の 5 つ——
    **`enumeration` が無い・`complete` が `true` でない・`source` が無い**（列挙の来歴が残らない）。
    `complete: true` なのに `incomplete_reason` が残っている記録も集合の来歴と同じ扱いで落とす（効いていない免除。
    同じ表の中で「完全」と「未完了」を同時に主張させない）、
    **`enumeration.source.kind` が語彙外**、または**一次情報源以外で列挙したのに `stronger_source_unavailable_reason` が空**（読めるのに読んでいない側の経路）、
    **`candidates` が空**（展開が記録されていない）、
    **`enumeration.elements` に列挙した要素がどの候補にも現れない**（「40 列を列挙したが候補は代表 1 列だけ」。
    突き合わせは `items[].candidate.axes` で**軸ごと**に行い、軸値を引けない候補は和集合へフォールバックせず未測定にする。
    `enumeration.justified_absences` に要素スコープの根拠があるものだけ通す）、
    **同値クラスを 1 つでも宣言したのに全候補が属していない・`rationale` が空・`representative` が `members` に無い**（視覚採取の削減の根拠が残らない）。
    さらに **`components[].profile` キーの欠落**（暗黙の汎用扱い）と **`profile: null` なのに `profile_absent_reason` が空**、
    および被覆表の **`conformance` が無い・`ok` が `true` でない**（`parity-suite` の `coverage-expand.mjs` が未実行・未達）も落とす。
    `conformance` の欠落は「旧成果物」ではなく未実行として扱う——`declared: true` は被覆表の契約に乗ることの宣言だから
    （後方互換で判定を飛ばすのは `component_coverage` を**キーごと持たない**成果物だけ）。
    **撮影状態の導出**（`conformance.visual_states`）も同じ扱いで、**キーが無い・`checked` が `true` でない・`undecided` が 0 でない・`missing_states` が空でない**は落とす——
    `checked: false` は `coverage-expand.mjs` を `--metadata` 無しで走らせた記録で、被覆表から導いた撮影状態を `capture_conditions.states` と突き合わせていない。
    **撮っていない状態には差が出ず、差分器は撮った 2 枚しか比べない**ので、集合の不足を通すと素通りと見分けが付かない
    （導出の契約は `parity-suite` の `references/baseline.md`「撮影状態の決め方（1）被覆表から導く」）。
    **要約は記録時点の入力についての主張でしかないので、`table_fingerprint` / `capture_fingerprint` で現在の入力と突き合わせる**——
    欠落・不一致はいずれも落とす。**いまの `metadata.json` から撮影条件を読めない場合も落とす**——
    読めないことを「比較しない」に倒すと、記録が正常でも `capture_conditions` を落としただけで古い要約が収束を通す
    （`checked: true` は撮影条件と突き合わせたという主張なので、突き合わせる相手が読めない時点で成立しない）。
    **生成側の版も見る**——`conformance.tool` が `coverage-expand` で、`tool_version` が
    `coverage-check.mjs` の `MIN_COVERAGE_EXPAND_VERSION` 以上でなければ落とす。
    指紋は「その表を忠実に写したか」しか言わないので、**壊れた導出規則で作られた要約も指紋は一致する**。
    版を見ないと、スキルを上げても既知の欠陥を持つ要約が収束を通り続ける
    （下限を上げるのは導出の意味論を変えたときで、理由は同定数のコメントに残す）。指紋が無いと、`--write` の後に被覆表へ項目を足す・`metadata.json` から撮る状態を消す、といった変更が
    古い要約のまま通り、必要な撮影が無いまま収束する（`reactions.json` の `conformance.table_fingerprint` と同じ形）。
    終了コードは 0 ＝ 条件を満たす（判定しない場合を含む）、1 ＝ 未測定・不整合が残る、2 ＝ 使い方の誤り。1 件以上なら収束させず `parity-suite` へ戻して測らせる。
    **`metadata.json` や `component_coverage` の型崩れ**（オブジェクトでない・`declared` が真偽値でない・`path` が空でない文字列でない）と、
    **`declared: false` なのに `reason` が空**（免除の根拠が残らない）は、後方互換の「判定しない」に倒さず exit 2 で落ちる——
    旧成果物の経路を型崩れ・無根拠の免除の逃げ場にしない
    （差分器は**採取した状態しか見ない**ため、測っていない操作の欠落は差分ゼロとして通り抜ける）。
    **`declared: true` なのに被覆表が無い・読めない・JSON として壊れているときは合格に倒さない**（スクリプトも `unmeasured: null` ＋ exit 1 を返す）。
    `declared: false` のとき、および `component_coverage` を**キーごと持たない旧成果物**のときは本項目を判定に入れない（後方互換）——
    ただし判定しなかった事実と理由を `diff-metadata.json` の `component_coverage`（`judged: false`）に記録し、`diff.md` の未検証領域にも残す（黙って合格にしない）
  - **反応の被覆表に未測定が残っていない**（正本は `parity-suite` の `references/coverage.md`「操作の反応」）。
    差分器は採取した状態しか見ないため、**遅れて出る・別の文書に出る・自動で消える反応**の取りこぼしと、新側の「出しっぱなし」は差分ゼロとして通る。
    `.replace/parity/<slug>/metadata.json` の `reaction_coverage.declared` が `true` のときだけ判定に入り、数え直しは**インストール済みの `parity-suite`**
    （本スキルと同じインストール先の `parity-suite/scripts/`）の `reaction-check.mjs` を `--recorded` で呼んで行う（照合規則を 2 スキルに複製しない）:

    ```bash
    node <parity-suite の skill>/scripts/reaction-check.mjs --metadata .replace/parity/<slug>/metadata.json --recorded
    ```

    `--recorded` は移行元ソースを読まず、表の検査に加えて `conformance.ok: true`・`tool_version` の一致・**表の指紋の一致**（照合後に表を書き換えていない）を要求する。
    終了コードは 0 ＝ 条件を満たす（判定しない場合を含む）、1 ＝ 未測定・不整合が残る（収束させず `parity-suite` へ戻す）、2 ＝ 型崩れ・`declared: false` なのに `reason` が空、または操作の痕跡がある機能の `declared: false`（後方互換に倒さず現側の成果物を直す）。
    **スクリプトが見つからないときは判定を飛ばさず停止し**、`gh skill install shoji9x9/skills parity-suite` を促す。
    `declared: false` と `reaction_coverage` を**キーごと持たない旧成果物**は判定に入れない（後方互換）が、理由を `diff-metadata.json` の `reaction_coverage`（`judged: false`）と `diff.md` の未検証領域に残す
  - **採取物と工程の健全性に未検証が残っていない**（正本は `parity-suite` の `references/baseline.md`「採取物の健全性」「状態を変えるスイートは 2 回続けて緑にする」と
    `references/coverage.md`「未測定を機械可読にする」）。**採取物は工程の出力であり次の工程の入力**なので、
    読まれていない採取物・古い加工物・回っていない工程・後始末が効いていないスイート・未測定の宣言は、どれも**緑のまま抜ける**。
    数え直しは**インストール済みの `parity-suite`**（本スキルと同じインストール先の `parity-suite/scripts/`）の `artifact-health-check.mjs` を呼んで行う（検査規則を 2 スキルに複製しない）:

    ```bash
    node <parity-suite の skill>/scripts/artifact-health-check.mjs --metadata .replace/parity/<slug>/metadata.json --target <target> --stage diff
    ```

    落とすのは 4 群——**採取物**（`read_by` も `unread_reason` も無い・`baseline_dir` に在るのに宣言が無い・宣言の実体が無い・
    `read_by` の指すスペックに採取物の名前が現れない〈字面の照合〉・`kind: derived` の `derived_from` の `sha256` が元の実体と一致しない
    〈加工物が古い〉・`derived_from` も `freshness_unverified_reason` も無い）、
    **反復実行**（`suite.state_mutating: true` なのに `repeat_run.cleanup_in_suite` が真でない・連続する 2 回の記録が無い・
    末尾 2 件が緑でない・`started_at` が同じか逆順・`suite_fingerprint` が 2 回で違う／現在のスイートと違う
    〈記録した後にスペックや後始末を変えた〉・片方だけ指紋を持つ・現在のスイートの指紋を計算できない）、
    **未測定**（`unmeasured.entries` に `disposition: blocking` が残る。語彙外・承認記録の空は `blocking` として数える）、
    **工程の成果物**（`new/<target>/replace-metadata.json` の `suite.new_green` が真なのに同じ場所に `diff-metadata.json` が無い、
    それが**いまの新側に対応していない**〈`new.commit` が `replace-metadata.json` と違う・`iteration` が `loop.iterations` と違う〉、
    またはその `dataset_version` が読めない・現在の版より新しい・区間の `changes[].affects` に `*` がある・`changes` の履歴が壊れている）。
    **対応づけを版だけに委ねない**——データセットを変えずに `parity-replace` が実装を作り直すと、
    前の反復で収束した `diff-metadata.json` が `dataset_version` の一致だけでこのゲートを満たし、
    **差分を採り直していないのに「済んだ」ように見える**。両成果物が既に持つ識別子（新側のコミット SHA と反復回数）で結ぶ
    （`new.commit` が `none`、または片側が記録を持たない旧成果物はその軸を判定せず、理由を出力に残す）。
    **`replace-metadata.json` の `new.dirty: true` は SHA が一致しても落とす**——未コミット変更のある木では
    「差分を採った実装」を SHA で特定できず、同じ SHA・同じ反復のまま中身だけ変わった実装が素通りするため
    （`parity-replace` の軽量経路も両側 `dirty: false` を適用条件にしている）。
    **数値が古いだけでは落とさない**——陳腐化の正本は `golden-dataset` の `references/versioning.md` で、記録済みの版から現在までの
    `changes[].affects` が slug の実効参照テーブルと交差するときだけ陳腐化する。実効参照テーブルの導出は `golden-dataset` 側の契約なので
    このスクリプトは 2 つ目の実装を作らず、交差を見るまでもなく確定する形だけを落とす（交差の判定は preflight が行う）。
    **投入対象でない target**（`db` を持たない／`seedable` の無い読み取り専用）は `dataset_version: null` ＋ `dataset_version_exempt` に理由を書いて免除する
    （正本は [`preflight.md`](preflight.md)）——免除は正規の記録なので落とさない。
    **`converged` が偽でも落とさない**——偽は「まだ直っていない」の記録であって隠す相手ではなく、落とすのは「無い」と「古い」だけ。
    **`--stage diff` は既定なので省いてもよいが、明示する**——`parity-suite` は自分の完了判定を `--stage suite` で通しており（`blocking` はあちらが書く出力なので落とさない）、
    どちらの工程のゲートかを読み手が取り違えると、収束判定で `suite` を渡して未測定を素通りさせる。
    終了コードは 0 ＝ 条件を満たす（判定しない節を含む）、1 ＝ 未検証・不整合が残る、2 ＝ 使い方の誤り・型崩れ。
    **この検査は `diff-metadata.json` に結果を書いた後に通す**——工程の節は「`suite.new_green` が真なのに `diff-metadata.json` が無い／古い」を見るので、
    まだ書いていない時点で通すと自分の未記録で落ちる（`converged` を真にする直前の最後のゲートとして置く）。
    **この節が本当に捕まえるのは工程の外**——`parity-diff` を一度も回していない・途中で止めた slug × target が、
    `replace-metadata.json` の `suite.new_green: true` だけを残して「済んだ」ように見える状態で、
    `replace-strategy status` の「green 済み・差分検出は未実施」を機械可読にしたものにあたる。
    **`artifact_health` / `unmeasured` / `suite.state_mutating` をキーごと持たない旧成果物はその節を判定しない**（後方互換）が、
    判定しなかった事実と理由を `diff-metadata.json` の `artifact_health`（`judged: false`）と `diff.md` の未検証領域に残す。
    **スクリプトが見つからないときは判定を飛ばさず停止し**、`gh skill install shoji9x9/skills parity-suite` を促す
  - **追記専用の成果物が縮んでいない**（正本は `replace-strategy` の `assets/append-only-manifest.json`）。
    決定を積み上げる成果物（設定ファイル・`features.md` / `components.md` / `assets.md` / `dependencies.md`・
    インスタンス例外の台帳とその根拠・`gaps.md`・データセットの版の記録）は**非破壊追記**と定められているが、
    追記であることを確かめないと**丸ごと書き直しても現在の状態が整合していれば全部通る**。
    失われるのは**過去の決定**（なぜこの差分を許容したのか・いつ誰が承認したのか）で、
    **収束の判定は現在の状態しか見ないため `converged: true` になりうる**。数え直しは**インストール済みの `replace-strategy`** のスクリプトが行う:

    ```bash
    node <replace-strategy の skill>/scripts/append-only-check.mjs --root . --base <機能に着手した時点の版>
    ```

    終了コードは 0 ＝ 縮んでいない、1 ＝ 単位が失われている・成果物が消えている・**比較元に在る成果物が 0 件**（突き合わせが 1 件も成立していない）、
    2 ＝ 使い方の誤り・判定不能・**作業ツリーに対象が 0 件**・一覧の `unit` が語彙外・**比較元の木に在るのに内容を取り出せない**
    （**どの 0 件も合格に倒さない**——機能を閉じる時点で追記専用の成果物は在り、コミットもされている）。
    **突き合わせの単位は一覧の `unit` が決める**（`lines` / `markdown-structure` / `json-arrays`）。
    全部を行として比べると、正本が明示的に求めるその場の更新（版の +1・状態列の `未`→`済`・Issue 列の `未起票`→番号・最終更新の日時・
    空配列への最初の追記）が「失われた行」に化け、決定を 1 つも捨てていない成果物で収束が止まる。
    Markdown は**見出し・表の列名・表の行（先頭セルが鍵）・行 × 列のセル・定義箇条書きの鍵・それ以外の散文行**を守る。
    **鍵だけを残すと残りのセルが自由に書き換わる**（決定の出どころ・方針・理由を丸ごと差し替えても行は在る）ので、
    正本がその場の更新を定めている列だけ `mutable_columns` で外す（一覧の `requirement` が節・列・行だけを守ると定めている成果物は `"*"`）。
    JSON は `arrays` に挙げた配列の**要素**を守り、`version` のようなスカラは固定しない
    （同一性は深い等価なので、2 つの要素の間で承認記録を入れ替える書き換えも縮小として落ちる。
    `key` を添えた配列は鍵で要素を対応づけてフィールドごとに突き合わせ、既定は**鍵以外が不変**。
    正本が更新を認めている項目だけ `fill_only`（空 → 非空だけ。既に入っている承認記録の差し替えは落とす）と
    `transitions`（明示した `<変更前>-><変更後>` だけ。`unmeasured.entries` の `blocking->accepted`）で開ける）。
    いずれも空白を畳んで突き合わせるので、フォーマッタの桁詰めでは落ちない。
    **`--base` には機能に着手した時点の版を渡す**——既定の `HEAD` は作業ツリーと直近のコミットの比較なので、
    **書き直しを commit した後は差が無く、何も失われていなくても素通りする**（着手時点の版は `git merge-base` や機能の branch の分岐点から取る）

## `intentional_diffs.pending` の棚卸し

**機能を閉じる前に、意図的差異の保留を人へ提示して処置を決める。** 追記だけを定めて確定の時期を定めないと、
保留が残ったまま機能が閉じられ、**判断待ちが機能をまたいで積み上がる**（後から読む人には「まだ決まっていない差」と「決まったが記録が古い差」の区別が付かない）。
`pending` は**設定ファイルに残る唯一の作業中記録**であり、閉じる工程を持つのはここだけなので本スキルが要求する。

**`pending_review` とは別物である。** 前者は**その差分の分類が承認待ち**（`diff-normalize.mjs` の分類）で、
本節が扱うのは**意図的差異として認めるかどうかが未決**という宣言（設定ファイルのレジストリ）。混同すると片方だけを見て収束させる。

### 対象

要素の形と `slug` の意味論の正本は `replace-strategy` の `references/project-config.md`「`pending` 要素の形」。**次の 3 群すべて**を提示する。

| 群 | 条件 | 提示する理由 |
|---|---|---|
| この機能の保留 | `slug` が対象 slug と一致 | この機能が積んだもの |
| 横断の保留 | `slug` が `cross-cutting` | 機能に帰属しないため**閉じる工程を持たない**（どこかで提示しないと永久に残る） |
| 帰属不明の保留 | 素の文字列（旧形式）／`slug` 欠落 | 黙って対象外にすると、**いちばん古くから積んでいる保留だけが誰の目にも触れなくなる** |

**他の機能に帰属する保留（`slug` が別 slug）は対象外**。その機能の収束判定が扱う。

### 処置

**1 件ずつ人へ提示する**（まとめて「全部持ち越し」等の一括指示に従わない——内容を見ずに決めると棚卸しが素通りの儀式になる）。処置は 3 つのいずれか。
**自律実行（`--autonomous`）では処置を記録せず `pending_decisions[]` に保留として残す**（`carried_over` を自分で書かない。理由の記録だけで通過できる処置なので、人の判断を経ずに棚卸しが通ってしまう）。

| 処置（`disposition`） | 意味 | 必要な記録 |
|---|---|---|
| `keep` / `may_change` | 意図的差異として確定した | **人間が**設定ファイルの `pending` から当該分類へ**文言を移す**（スキルは移さない。書き手区分の正本はスキーマ文書「キーの書き手とライフサイクル」）。文言を変えて移したなら `promoted_as` に移動後の文言 |
| `carried_over` | 次工程へ持ち越す | `reason` に**持ち越す理由**（測定待ち・依存先の実装待ち等）。理由の記録で通過できるので、**恒久的に機能を止めることはない** |

### 記録

`diff-metadata.json` の `intentional_diffs_pending` に**件数と各件の処置**を残す（様式の正本は [`../assets/diff-metadata-template.json`](../assets/diff-metadata-template.json)）。
`diff.md` にも同じ内訳を書く（正本の件数は `diff-metadata.json`）。**積んでいることは件数で気づく**ので、対象 0 件でも記録を省かない。

- 判定は [`../scripts/pending-triage-check.mjs`](../scripts/pending-triage-check.mjs) が行う（実行方法は上記「収束の条件」）。**記録された件数を信用せず設定ファイルの `pending` から数え直す**
- スクリプトが落とすのは次の 6 つ——**対象なのに記録が無い**（未棚卸し）、
  **`keep` / `may_change` と記録したのに `pending` に残っている・移動先に見つからない**（記録だけで通ると棚卸しが「書けば通るチェックリスト」になる）、
  **持ち越しの `reason` が空**、**`pending` に同じ文言が複数ある**（どれを棚卸ししたか決められない。先勝ちにしない）、
  **記録した帰属が設定ファイルの `pending` の帰属と違う**（別機能の保留を自機能の slug で閉じられる）、
  **宣言した件数が数え直しと一致しない**
- **`intentional_diffs_pending` キーが無いときは旧成果物として合格に倒さず未実施として落とす**（対象 0 件と無記録を同じ出力にしない）
- **未実施（exit 1）と成果物の型崩れ（exit 2）を分ける。** `intentional_diffs_pending` キーごと無いのは**未実施**（棚卸しをすれば直る）。
  一方、記録がオブジェクトでない・`entries` が配列でない（キー欠落を含む）のは**型崩れ**なので exit 2 で落とす——
  対象 0 件の棚卸しも `entries: []` を書く契約なので、`entries` を持たない記録は「0 件」ではなく壊れた成果物である
  （両方を exit 1 に丸めると、自動化が「やり直せば直る」と「成果物が壊れている」を区別できない）

## 他機能待ちの差分（`blocked_by`）

機能単位で分割して移行する以上、**同じページに乗る別機能が新側に未実装であることに由来する差分**は必然的に出る（欠けたセクションのぶん親要素の高さが変わり相対幾何が反転する等）。
その機能を実装しない限り解消しないので、`parity-replace` へ差し戻しても直せない。**要対応でも許容でもない第 3 の状態**として `diff-metadata.json` の `blocked_by[]` に帰属させる。

ただし、ページ一覧と `capture_conditions.cofeature_masks` から領域を解決できる共同居住機能は、差分検出より前に実行時マスクで除外する（正本: [`capture-new.md`](capture-new.md)「共同居住機能の実行時マスク」）。`blocked_by` は、領域を安全に限定できない周辺レイアウト差など**マスクの外に残った差分**の退避先であり、マスク可能な差分を毎回トリアージするための通常経路にしない。

- **帰属できるのは次の 3 つをすべて満たす差分だけ**（ひとつでも確かめられなければ `unexplained` のまま残す。ここを緩めると `blocked_by` が直せない差分の逃げ場になる）:
  1. 依存先が `.replace/features.md` にある slug である（自分で採番しない）
  2. **同じ target** で依存先が新側未達であることを読んで確かめた（`new/<target>/replace-metadata.json` が無い、または `suite.new_green` が false）。読んだパスと値を `evidence` に書く
  3. 差分が「その機能の要素が新側に無いこと」で説明できる（説明を `reason` に書く）
- 帰属しても**差分は残っている**。`results.unexplained` の件数から差し引かず、`converged` を `true` にしない
- **差し戻さない**（その target では直せない）。`on_diff` の分岐にも入れず、停止してユーザーへ「依存先の実装待ち」として報告する。要対応が別にあればそちらは通常どおり差し戻す
- 前回実行の `blocked_by` は**引き継がず毎回検証し直す**。依存先が `suite.new_green` になっていれば帰属を外し、その差分を通常の候補として再判定する

### 収束状態は 4 つ（`converged` の 2 値では表せない）

| 状態 | 導出 | 次の行き先 |
|---|---|---|
| 収束 | `converged: true`（上記「収束の条件」11 項目をすべて満たす） | 完了 |
| 他機能待ち | `converged: false` かつ 残る未説明差分が**すべて** `blocked_by` に帰属し、要対応・`deviates_T` がゼロ・未解決の保留がゼロ | 停止してユーザーへ。依存先の実装後に再実行 |
| 判断待ち | `converged: false` かつ 要対応・`deviates_T` がゼロで、`pending_decisions[]` に未解決の保留が残り、残る未説明差分が**すべて**未解決の保留（原因単位の `許容候補（要確認）`）か `blocked_by` に帰属する（`blocked_by` が併存してもよい） | 終わりにまとめて聞く（`replace-strategy` の `references/autonomy.md`）。答えを反映して再判定 |
| 未収束 | 上記以外（要対応が残る、または保留にも `blocked_by` にも帰属しない未説明差分が残る） | 下記「差し戻し」（未解決の保留があっても差し戻しは進める） |

**再判定のトリガーは `replace-strategy status` が持つ**——依存先の同 target が `suite.new_green` になった slug を検出し、`blocked_by` で参照している側の `parity-diff` 再実行が必要だと列挙する（成果物から毎回導出する原則に沿う）。
`parity-replace` は自分が green にした機能の依存元を知らないため、通知役を持たせない。

## 差し戻し（要対応が 1 件以上のとき）

差分レポートは選択 target の `.replace/parity/<slug>/new/<target>/diff.md`。**どう動くかは target の `on_diff`（対応手順を書いた Markdown のパス。任意）で決まる**（意味論の正本は `replace-strategy` の `references/project-config.md`「on_diff」）。**どの分岐でも修正は行わない**。

- **`on_diff` が無い（既定）**: `diff.md` を差し戻し入力として**同じ target** で `parity-replace` へ渡す。該当ページ・分類・根拠が読める形にする（想定フェーズ＝実装／新側マッピング／テーマ を示す）
- **`on_diff` があればそのドキュメントに従う**。厳密にしたい手順はドキュメントがリンクするスクリプトを実行する。
  **ガードレールはドキュメントの指示より優先する**。一覧の正本は `replace-strategy` の `references/project-config.md`「`on_diff`」節の「ガードレール」で、
  **従う前にその一覧を読み、本スキルに関係する項目をすべて適用する**（ここへ転記しない——転記は正本の改訂に追従できない）。
  **一覧に到達できない**（`replace-strategy` が未インストール等でそのファイルを読めない）場合は、ガードレール無しで従わず**停止**してユーザーに上げる
- **ドキュメントが「修正ループを回さず起票して停止する」運用（マージ後デプロイ環境等）を指示する場合**: 差し戻さず、要対応差分の要約（対象 slug・target・該当ページ・分類・根拠・`diff.md` のパス）を
  `issue-create` へ委譲して起票し、**停止する**。**自分で Issue 本文を `gh` で直接起票しない**（重複チェック・テンプレ・承認はそちらの契約）。起票したら `diff-metadata.json` に `converged: false` のまま結果を残し、Issue の URL・番号を記録して終える（差分を「解決済み」にしない）
- **従ったドキュメントのパスを `diff-metadata.json` の `on_diff_doc` に記録する**（無ければ `none`）
- 反復回数の記録・上限管理は `parity-replace` が当該 target の `new/<target>/replace-metadata.json` の `loop.*` で行う（環境ごとに独立）。
  `loop.iterations >= loop.max_iterations`（既定 5）なら、本スキルは**新たな差し戻しをせず停止してユーザーへ上げる**（頭から作り直さない。上限管理の正本は `parity-replace` の `references/diff-loop.md`）

## 収束したとき

- `diff-metadata.json` の `converged: true` にする。条件は上記「収束の定義」の**収束の条件**（11 項目）**すべて**——ここへ転記しない（転記した抜粋で判定すると `blocked_by` 残存・承認前の分類残存・例外台帳の不整合・被覆表の未測定・反応の未測定・保留の未棚卸し・未解決の判断待ち・採取物と工程の健全性・追記専用の成果物の縮小を見落とす）
- `results`（total / actionable / accepted / noise / unexplained / unverified）と `accepted_exceptions`（原因数 / インスタンス数 / 不整合数）、
  `component_coverage`（判定の有無 / 数え直した期待セル数 / 未測定数）、`reaction_coverage`（判定の有無 / 操作数 / 未測定の操作数）、
  `intentional_diffs_pending`（棚卸しの対象内訳 / 確定件数 / 持ち越し件数と各件の処置）を記録する

## 対象外・未検証の明示

- **アニメーションのパリティは扱えない**（停止させて比較するため）。`diff.md` に対象外として残す
- **ベースラインに写らない箇所**は「未検証」として `diff.md` に残す（確認済みにしない）
- **宣言できない構造差**（`gaps.md` の該当節・フォーカスリング形状・内部 DOM・余白の配り方等）は正規化対象外＝未検証として `diff.md` に転記する
