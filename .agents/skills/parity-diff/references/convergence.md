# 収束判定と差し戻し（parity-replace / issue-create）

## 収束の定義

収束とは、未説明の差分がゼロで、かつ未修正の回帰がゼロのことである（すべての差分が、系統差か宣言済みの例外に分類されている）。
生の差分ゼロは求めない。実装やライブラリが違えば、正当な差は残る。

- 判定するのは差分ツールである。[`../scripts/diff-normalize.mjs`](../scripts/diff-normalize.mjs) の機械的な分類と、`diff.md` の分類の集計で判定する。モデルの主観（「もう同じに見えます」）を根拠にしない。
- **収束の条件**は次のとおりである。
  - `diff-normalize.mjs` の出力に、`unexplained` / `deviates_T` / `pending_review` が無い。
  - [`triage.md`](triage.md) の分類「許容」が、すべてユーザーに承認され、記録先に追記されている（既存の内容を消さずに追記する）。
    記録先は、設定ファイルの `component_diffs` / `intentional_diffs`、または `.replace/parity/<slug>/component-diff-exceptions.json` と根拠の `component-diff-exceptions.md` である。
    `diff.md` に承認の前の分類（`許容候補（要確認）`）が 1 件も残っていない（承認の前のものは未説明として数える）。
    承認の単位は原因である（[`triage.md`](triage.md)「承認の単位は原因」で定義する）。原因が承認済みなら、それを参照する N インスタンスは承認済みとして数える。
    インスタンスごとの承認記録が無いことを、未承認の根拠にしない。
    ただし、承認済みとして数えられるのは、承認記録が覆う件数までである。原因ごとに、次の 2 つが一致することを確かめる。
    1 つは `component-diff-exceptions.md` の承認記録の各行にある「この承認で覆った件数 N」の累計（承認が 1 回なら、その 1 行の N）で、もう 1 つは JSON でその `cause` を参照するインスタンスの数である。
    JSON の側が多ければ、承認の後に足された未承認のインスタンスがある。超えた分は未説明として数え、収束させない（増えた分の承認を取って記録に追記する。手順は `triage.md`「承認の単位は原因」）。
  - インスタンス例外の台帳に、照合に使えない不整合が無い。
    不整合とは、`cause` を解決できない・`evidence` が空・`slug` が一致しない・照合キー（`page` / `viewport` / `element`）が欠けている、のいずれかである。
    `diff-metadata.json.accepted_exceptions.unresolved` が 0 であること。不整合な例外は吸収されないので、該当する候補は `unexplained` として残る。
  - `diff-metadata.json` の `blocked_by[]` が空である（他機能待ちが残っていれば、下記「他機能待ちの差分」の状態であって収束ではない）。
  - 未検証の領域（下記）が、`diff.md` に「未検証」として残されている（確認済みにしていない）。
  - `diff-metadata.json` の `pending_decisions[]` に、未解決の保留が無い（自律実行で人の判断待ちにした保留。記録の形は `replace-strategy` の `references/autonomy.md` で定義する）。
    未解決は `resolution: null` だけではない。回答が付いていても、`blocks` の工程を行った記録（`resumed`）も、残りの作業の置き場（`follow_up`）も無い保留は、未解決のままである。
    数え方は同じファイルの「保留の状態」で定義する。`node <replace-strategy>/scripts/pending-decisions-check.mjs --file .replace/parity/<slug>/new/<target>/diff-metadata.json` が exit 0 になること。
    このスキルは、このキーを毎回書く（自律実行でない実行と、保留の無い実行では空の配列にする）。
  - 意図的差異の保留（`intentional_diffs.pending`）の棚卸しが済んでいる（下記「`intentional_diffs.pending` の棚卸し」）。
    数え直しは [`../scripts/pending-triage-check.mjs`](../scripts/pending-triage-check.mjs) が行う。記録された件数を信用せず、設定ファイルの `pending` から数え直す。

    ```bash
    node <skill>/scripts/pending-triage-check.mjs --registries <registries.json> --metadata .replace/parity/<slug>/new/<target>/diff-metadata.json --features .replace/features.md
    ```

    `--features` は必ず渡す。機能の一覧が無いと slug が実在するかを確かめられないので、スクリプトは「別の機能に帰属する要素は報告だけにする」という緩和を使わず、全件を対象にする。
    確かめられないときは対象を広げる側に扱い、その旨を `note:` に出す。
    渡したファイルに slug の列を持つ表が無いか、対象の slug がその表に無い場合は、exit 2 で失敗する。
    綴りを間違えた slug を放っておくと、すべての帰属が「別の機能」に見えて、対象が 0 件のまま閉じられてしまうからである。
    渡す `registries.json` は、棚卸しの後の設定ファイルから組み立て直したものにする。
    正規化のときのスナップショットを使い回すと、人が `keep` / `may_change` へ移した要素が `pending` に残って見え、正しい記録が不整合として失敗する（組み立て方は [`normalize.md`](normalize.md)「registries.json の組み立て」）。
    終了コードは、0 が棚卸し済み、1 が未棚卸しか記録の不整合が残る、2 が使い方の誤りか型の誤り（設定ファイルに `intentional_diffs.pending` が無い・配列でない場合を含む）である。
    1 以上なら、収束させずに棚卸しする。
  - 部品網羅表に未測定が残っていない（部品網羅表は `parity-suite` の `references/coverage.md` の部品網羅表の節で定義する）。
    この項目が防ぐのは、測っていない操作が差分ゼロとして通ることだけで、部品の見た目は保証しない。網羅表が数えるのは、操作と状態の有無だけだからである。
    見た目は、下の画素と特性照合の項目が見る（画面より先に作った共通部品では、`parity-component` が別に持つ）。未測定が 0 であることを、見た目が一致する根拠にしない。
    `.replace/parity/<slug>/metadata.json` の `component_coverage.declared` が `true` のときだけ判定に入る。
    数え直しは [`../scripts/coverage-check.mjs`](../scripts/coverage-check.mjs) が行う。宣言された件数を信用せず、網羅表から数え直す（目視で数えない）。

    ```bash
    node <skill>/scripts/coverage-check.mjs --metadata .replace/parity/<slug>/metadata.json
    ```

    未測定として数えるものは次のとおりである。
    - `value: unmeasured` のセルと、期待セルの組み合わせのうち行が無いもの
    - `present` / `absent` なのに `evidence` が空のもの、`present` なのに `covered_by` が空のもの、`absent` なのに `absence_evidence.kind` が無いか未知のもの
    - `kind: non-renderable` で、次のいずれかが欠けているもの
      - `locator_includes_hidden: true`（hidden を含む取り方で実測したこと）。通常の `getByRole` は hidden を除くので、これが無いと 0 件を DOM に無いことと読み違える
      - 一意な locator（状態ごとの `locator_match_count` が 0 か 1 で、0 の状態は矩形・`offset_parent`・`hidden_by` がすべて `null`、かつ 1 件の状態が 1 つ以上ある）
      - 状態を導いた出所と、`states_exhaustive: true`
      - インスタンスの側の完全な `applicable_states` manifest（`source.kind` が `profile` / `vendor-spec` / `current-source` / `app-ui` のいずれかであることを含む）
      - `expected_states`・`states[].name`・manifest の状態 id が、重複が無く、文字列として一致し、遷移も一致すること
      - 1 件以上の状態ごとの証拠（矩形、`offset_parent`、0 の寸法、または対象そのものか祖先との関係を確かめた非表示の原因）
    - 同じ組み合わせの重複した行（先にあるものを採らない）
    - `kind: fired-without-response` で、次のいずれかが欠けているもの
      - `action`（`locator`、語彙の中の `method`、`detail`、正の矩形、`visible: true`、`actionability_bypassed: false`）。
        `coordinate` では、`hit_test_target` と `hit_test_is_target_or_descendant: true` も要る
      - `fired`（語彙の中の `signal` / `detail` / `verified: true`）
      - `observation`

    期待セルの取り方は、部品が網羅プロファイルを宣言しているかで変わる（プロファイルの取り決めは `parity-suite` の `references/coverage-profiles.md` で定義する）。
    宣言していない部品（`profile: null` と `profile_absent_reason`）では、項目 × インスタンスが期待セルになる。宣言した部品では、インスタンスごとに記録された候補（`instances[].candidates`）が期待セルになる。
    プロファイルの本体は `parity-suite` の同梱物なので、ここでは読まない。網羅表に記録された列挙・候補・適合の結果から数え直す。

    集合の出所と完全性も、数え直しの対象である（`parity-suite` の `references/coverage.md` の、3 つの集合に出所と完全性を求める節で定義する）。
    次のものは未測定として数える。
    - `component_inventory`（部品の集合）か `components[].instance_inventory`（インスタンスの集合）が無いもの
    - `source` の `kind` / `ref` / `version` / `condition` が空のもの、`kind` が `current-source` / `config` / `app-ui` のいずれでもないもの
    - `complete` が `true` でないもの（`false` なら `incomplete_reason` が必須）。逆に、`true` なのに `incomplete_reason` が残っているものは、使われていない免除として数える
    - 元の情報（`current-source`）以外で列挙したのに、`stronger_source_unavailable_reason` が空のもの。逆に、元の情報で列挙したのに理由が書かれているものは、使われていない免除として数える

    数える単位は、宣言を置いた場所に合わせる。`component_inventory` の不備は表全体で 1 件とする。
    `components[].instance_inventory` と `components[].source` の不備は、その部品でまとめて 1 件とする（同じ部品の 2 つの宣言が両方欠けても 2 件にはしない）。
    列挙しなかった部品やインスタンスは期待セルにも現れない。集合の側で宣言させない限り、測っていない部品があっても `unmeasured` が 0 のまま収束してしまう。

    `components[].source`（項目の集合の出所）も同じく調べる。`kind` / `ref` / `retrieved_at` が空でないことと、
    `kind` が `vendor-feature-list` / `vendor-test-spec` / `official-sample` / `current-source` / `app-ui` のいずれかであることを確かめる。

    プロファイルを宣言した部品では、さらに次のものを失敗にする。
    1. `enumeration` が無いもの、`complete` が `true` でないもの、`source` が無いもの（列挙の出所が残らない）。
       `complete: true` なのに `incomplete_reason` が残っている記録も、集合の出所と同じ扱いで失敗にする（使われていない免除。同じ表の中で「完全」と「未完了」を同時に主張させない）
    2. `enumeration.source.kind` が語彙の外のもの、または元の情報以外で列挙したのに `stronger_source_unavailable_reason` が空のもの（読めるのに読んでいない）
    3. `candidates` が空のもの（展開が記録されていない）
    4. `enumeration.elements` に挙げた要素が、どの候補にも現れないもの（「40 列を挙げたが、候補は代表の 1 列だけ」）。
       突き合わせは `items[].candidate.axes` で軸ごとに行う。軸の値を読めない候補は、和集合で代用せずに未測定にする。
       `enumeration.justified_absences` に要素の範囲の根拠があるものだけを通す
    5. 同値クラスを 1 つでも宣言したのに、すべての候補が属していないもの、`rationale` が空のもの、`representative` が `members` に無いもの（視覚の採取を減らした根拠が残らない）

    さらに、`components[].profile` のキーが無いもの（暗黙に汎用として扱われる）と、`profile: null` なのに `profile_absent_reason` が空のものも失敗にする。
    網羅表の `conformance` が無いか、`ok` が `true` でないもの（`parity-suite` の `coverage-expand.mjs` を実行していないか、条件を満たしていない）も失敗にする。
    `conformance` が無いことは、「古い成果物」ではなく未実行として扱う。`declared: true` は、網羅表の取り決めに従うという宣言だからである。
    後方互換で判定を飛ばすのは、`component_coverage` をキーごと持たない成果物だけである。

    撮影する状態の導出（`conformance.visual_states`）も同じ扱いで、キーが無い・`checked` が `true` でない・`undecided` が 0 でない・`missing_states` が空でない、のいずれかなら失敗にする。
    `checked: false` は、`coverage-expand.mjs` を `--metadata` なしで実行した記録で、網羅表から導いた撮影する状態を `capture_conditions.states` と突き合わせていない。
    撮っていない状態には差が出ず、差分ツールは撮った 2 枚しか比べないので、集合が足りないまま通すと、確かめていないのと区別が付かない
    （導出の取り決めは `parity-suite` の `references/baseline.md` の、撮影状態を網羅表から導く節で定義する）。

    要約は記録した時点の入力についての主張でしかないので、`table_fingerprint` / `capture_fingerprint` で今の入力と突き合わせ、欠けているか一致しなければ失敗にする。
    今の `metadata.json` から撮影条件を読めない場合も失敗にする。
    読めないことを「比べない」として扱うと、記録が正しくても `capture_conditions` を消しただけで、古い要約が収束を通してしまう
    （`checked: true` は撮影条件と突き合わせたという主張なので、突き合わせる相手が読めない時点で成り立たない）。

    生成した側の版も確かめる。`conformance.tool` が `coverage-expand` で、`tool_version` が `coverage-check.mjs` の `MIN_COVERAGE_EXPAND_VERSION` 以上でなければ失敗にする。
    指紋は「その表を忠実に反映したか」しか示さないので、誤った導出の規則で作った要約でも指紋は一致する。
    版を見ないと、スキルを上げても、既知の欠陥を持つ要約が収束を通り続ける（下限を上げるのは導出の意味を変えたときで、理由はその定数のコメントに残す）。
    指紋が無いと、`--write` の後に網羅表へ項目を足したり、`metadata.json` から撮る状態を消したりしても、古い要約のまま通る。
    その結果、必要な撮影をしないまま収束する（`reactions.json` の `conformance.table_fingerprint` と同じ形である）。

    終了コードは、0 が条件を満たす（判定しない場合を含む）、1 が未測定か不整合が残る、2 が使い方の誤りである。1 件以上なら、収束させずに `parity-suite` へ戻して測らせる。
    `metadata.json` や `component_coverage` の型の誤り（オブジェクトでない・`declared` が真偽値でない・`path` が空でない文字列でない）と、
    `declared: false` なのに `reason` が空のもの（免除の根拠が残らない）は、後方互換の「判定しない」として扱わず、exit 2 で失敗にする。
    古い成果物を見逃す分岐を、型の誤りや根拠の無い免除の逃げ道にしないためである（差分ツールは採取した状態しか見ないので、測っていない操作の欠落は差分ゼロとして通る）。
    `declared: true` なのに網羅表が無い・読めない・JSON として不正なときは、合格として扱わない（スクリプトも `unmeasured: null` と exit 1 を返す）。
    `declared: false` のときと、`component_coverage` をキーごと持たない古い成果物のときは、この項目を判定に入れない（後方互換）。
    ただし、判定しなかった事実と理由を `diff-metadata.json` の `component_coverage`（`judged: false`）に記録し、`diff.md` の未検証の領域にも残す（警告なしに合格にしない）。
  - 反応の網羅表に未測定が残っていない（`parity-suite` の `references/coverage.md`「操作の反応」で定義する）。
    差分ツールは採取した状態しか見ないので、遅れて出る反応・別の文書に出る反応・自動で消える反応を取り逃がしても、新側で反応が出たまま消えなくても、差分ゼロとして通る。
    `.replace/parity/<slug>/metadata.json` の `reaction_coverage.declared` が `true` のときだけ判定に入る。
    数え直しは、インストール済みの `parity-suite`（このスキルと同じインストール先の `parity-suite/scripts/`）の `reaction-check.mjs` を、`--tests <テスト一覧> --recorded` で呼んで行う（照合の規則を 2 つのスキルに複製しない）。

    ```bash
    # 一覧は作業ツリーの外の一時ファイルに置く（絶対パスの config.rootDir を含むので .replace/ に残して commit しない）
    TESTS="$(mktemp)"
    status=0
    # current と new を明示する（省くと new-capture の採取スペックまで読み込み、採取用の環境変数が無いと落ちる）
    npx playwright test --list --reporter=json --project=current --project=new > "$TESTS" || status=$?
    if [ "$status" -eq 0 ]; then
      node <parity-suite の skill>/scripts/reaction-check.mjs --metadata .replace/parity/<slug>/metadata.json \
        --tests "$TESTS" --recorded || status=$?
    fi
    rm -f "$TESTS"
    # 後片付けの後も終了コードを保つ（rm の 0 で照合の失敗を上書きしない。一覧の取得の失敗も 0 にしない）
    (exit "$status")
    ```

    `--recorded` は移行元のソースを読まない（テストの一覧は読む。`--tests` を省くと exit 2）。
    表の検査に加えて、`conformance.ok: true`・`tool_version` の一致・表の指紋の一致（照合の後に表を書き換えていない）を求める。
    終了コードは、0 が条件を満たす（判定しない場合を含む）、1 が未測定か不整合が残る（収束させずに `parity-suite` へ戻す）である。
    2 は、型の誤り、`declared: false` なのに `reason` が空、操作の痕跡がある機能の `declared: false`、手順の改訂 4 以降の画面を動かす機能の `declared: false` のいずれかである（後方互換として扱わず、現側の成果物を直す）。
    スクリプトが見つからないときは、判定を飛ばさずに停止し、`gh skill install shoji9x9/skills parity-suite` を促す。
    `declared: false` と、`reaction_coverage` をキーごと持たない古い成果物は判定に入れない（後方互換）。
    ただし、理由を `diff-metadata.json` の `reaction_coverage`（`judged: false`）と、`diff.md` の未検証の領域に残す。
    判定に入れない `declared: false` は、画面を持たない `api-resource` / `batch` と、改訂 4 より前の画面を動かす機能だけである。
    操作を持たない画面を動かす機能も、`operations: []` の表で画面ごとの状態の表示を振り分けるので、`declared: true` として同じ判定に入る（古い成果物の理由には、状態の表示を振り分けていない旨が出る）。

    次の記録も同じ判定に入る。
    - 表の文書ごとのオリジン（`document_origins` / `cross_origin_evidence`）と、`kind: none` の操作をした文書（`observation.source_document`）。
      これらを持たない表は、`declared: true` なら後方互換として扱わず exit 1 になる。`parity-suite` で記録させて `reaction-check.mjs --tests <テスト一覧> --write` を通し直させる（`tool_version` も上がっている）。
    - 操作ごとのページの組み方の変化（`layout`）。欠けた表は同じく exit 1 になる。
    - 押した後に残る見た目と戻り先（`aftermath`）。差分ツールは撮った状態しか見ないので、撮っていない操作の後の見た目、遷移、戻す範囲の差は、差分ゼロとして通る。
    - `covered_by` をスイートのテストに解決した記録（`conformance.covered_by_resolved`）と、assertion が期待値まで届くかを確かめた記録（`assertion_audit`）。
      欄が埋まっているだけでは、期待値より浅い assertion を名乗った表も、新側で緑になって差分ゼロで収束する。名前の解決は一覧から作り直す。
      確かめた記録の欠け、`verdict: short`、確かめた後に書き換えた表（表の指紋が一致しない）は失敗にする。
      確かめた後に `covered_by` のスペックを書き換えた形（スペックの指紋が一致しない）も失敗にする。新側を緑にする途中でスペックの assertion を弱めると、表は同じまま差分ゼロで収束するからである。
    - 送る前の判定（`pre_send`）と、表への書き込み（`side_effect_writes`）。境界の外の操作と DB への書き込みはどの差分ツールにも記録されないので、判定や書き込みが無い新側も差分ゼロとして通る。
    - 送っている間の押し直し（`resubmit`）と、画面ごとの状態の表示（`state_displays`）。応答を待つ間の受け付けと、0 件・取得の失敗・読み込み中は撮った状態に入らないので、振り分けていない表は収束させない。
    - 撮る状態の使い回し。部品網羅表をまたいで数え、名乗った撮影のページは押した後の URL と照合する。
      `component_coverage.declared: true` なら、部品網羅表の `visual_state_coverage.rows` も読み、同じページ × 状態名を根拠なしに指す行があれば失敗にする。
      どちらも照合を `--recorded` で作り直すので、`--write` の後に部品網羅表を書き換えても失敗する（`parity-suite` の `references/coverage.md`「押した後に残るもの」で定義する）。
  - 部品網羅表の `present` を、新側で突き合わせてある（`parity-suite` の `references/coverage.md` の、網羅表が移行元の側の測定であることを述べた節で定義する）。
    網羅表の 3 値は移行元の側の測定なので、`unmeasured` が 0 でも「新側で操作を完了できる」ことは意味しない。
    スイートが green でも、起点・当たり判定・完了のどこかで止まる欠落は、移行元の側の記録には 1 件も現れない。
    たとえば、下位を持つ項目を押すとメニューが閉じる・印が押せる範囲の外にある・並び替えの印が省略された文字に重なる、などである。
    現側の `metadata.json` の `component_coverage.declared` が `true` のときだけ判定に入る。
    数え直しは、インストール済みの `parity-suite` の `component-comparison-check.mjs` を呼んで行う（チェックの規則を 2 つのスキルに複製しない）。

    ```bash
    node <parity-suite の skill>/scripts/component-comparison-check.mjs \
      --coverage .replace/parity/<slug>/component-coverage.json \
      --comparison .replace/parity/<slug>/new/<target>/component-comparison.json \
      --metadata .replace/parity/<slug>/metadata.json \
      --replace-metadata .replace/parity/<slug>/new/<target>/replace-metadata.json --target <target>
    ```

    失敗にするのは次のものである。
    - `present` なのに突き合わせの行が無いもの、`compared: true` なのに起点・当たり判定・完了の観測が欠けているもの
    - 突き合わせを取った新側の版（`new_implementation.commit`）が無いか、今の `replace-metadata.json` の `new.commit` と違うもの（記録の後に実装が変わっている）。
      `--new-repo` を渡し、部品の改修の持ち越しが覆う違いは通す
    - `new.commit` が `none`（新側が git で管理されていない）のときに、`new_implementation.iteration` と `loop.iterations` が違うもの。
      両側が `none` なら文字列の比較は常に一致するので、新しさは反復の回数で確かめる
    - そのどちらかを読めないもの（`comparison-implementation-unversionable`）。代わりに確かめる手段が無いことを、合格として扱わない（規則は `parity-suite` の `references/coverage.md` で定義する）
    - どちらかの `dirty` が `false` でないもの（commit していない変更を持つ作業ツリーの記録は、commit で版を特定できない。欠落と真偽値でない値も失敗にする）
    - `--replace-metadata` を渡していないもの（照合の相手が無いと新しさの確認そのものが飛ぶので、この引数は省けない）
    - `new.dirty: true`（commit していない変更があると、版に結び付かない）
    - `compared: false` の理由が無いもの、承認記録の無い `accepted`、網羅表の指紋と合わない古い記録、別の target の記録、網羅表に無いセルの記録
    - 網羅表と突き合わせ表のどちらかに、同じ鍵（`component|item|instance`）の行が 2 つ以上あるもの（1 つのセルが 2 回数えられる）

    終了コードは、0 が条件を満たす、1 が突き合わせていないものか不整合が残る（収束させずに `parity-replace` へ戻す）、2 が型の誤り（網羅表が読めない）である。
    突き合わせ表が無いことは「まだ突き合わせていない」として exit 1 で失敗にする（型の誤りとして扱って判定を飛ばさない）。
    スクリプトが見つからないときは、判定を飛ばさずに停止し、`gh skill install shoji9x9/skills parity-suite` を促す。
  - 撮る範囲に、宣言されていない抜けが残っていない（`parity-suite` の `references/baseline.md`「撮る範囲の決め方」で定義する）。
    差分ツールは撮った 2 枚しか比べないので、撮影領域の外・内部のスクロール領域の中・領域の外に出た論理名は、差分ゼロとして通る。
    数え直しは、インストール済みの `parity-suite`（このスキルと同じインストール先の `parity-suite/scripts/`）の `capture-scope-check.mjs` を呼んで行う（チェックの規則を 2 つのスキルに複製しない）。

    ```bash
    node <parity-suite の skill>/scripts/capture-scope-check.mjs --metadata .replace/parity/<slug>/metadata.json
    ```

    終了コードは、0 が条件を満たす、1 が抜けか不整合が残る、2 が使い方の誤りか型の誤りである。
    1 なら収束させずに `parity-suite` へ戻し、範囲を広げるか対象外を宣言させる。
    `capture_conditions.capture_scope` をキーごと持たない現側の成果物は、後方互換として扱わない。この節ができる前の採取は範囲を測っていないからである。
    `popup_inventory` と同じく、範囲の実測を足して（必要なら撮り直して）から収束判定に入る。
    スクリプトが見つからないときは、判定を飛ばさずに停止し、`gh skill install shoji9x9/skills parity-suite` を促す。
    視覚の採取物を持たない機能（`api-resource` / `batch`）は `capture_conditions` を持たないので、判定に入れない。

    同じチェックが、次のものも数える。
    - スクロールバーの扱い（`capture_conditions.scrollbars`）と、スクロールバーを表示した窓のはみ出し（`capture_conditions.overflow`）。
      この 2 つのキーを持たない現側の成果物も後方互換として扱わず、`parity-suite` で記録させてから収束判定に入る（`parity-suite` の `references/baseline.md`「スクロールバーが場所を取る窓のはみ出し」で定義する）。
    - 表示を切り替える軸（`capture_conditions.display_axes`）の抜け。候補の振り分けの抜け、デフォルト以外の値の変種の欠落、軸の対の判断の欠落、スイートへの反映の方法の未決を失敗にする。
      宣言した変種を撮っていない組は、`#not-captured` の抜けになる（デフォルトの 1 つの値だけで撮った差は、3 つの比較方法のどれにも記録されない）。
    - 採取の環境と利用者の環境の一致（`viewer_environment`）が「未確認」の成果物と、撮影に使ったブラウザ（`browser`）の記録が無い成果物。
      未確認のまま `diff.md` へ転記するだけでは収束させない。
      これらのキーを持たない現側の成果物も後方互換として扱わず、`parity-suite` へ戻す（`parity-suite` の `references/baseline.md`「表示を切り替える軸」「採取環境と利用者環境の乖離」で定義する）。
  - 採取物と工程の健全性に、未検証が残っていない。
    `parity-suite` の `references/baseline.md`「採取物の健全性」「状態を変えるスイートは 2 回続けて緑にする」と、`parity-suite` の `references/coverage.md`「未測定を機械可読にする」で定義する。
    採取物は工程の出力であり、次の工程の入力でもある。そのため、次のものはどれも緑のまま通ってしまう。
    読まれていない採取物、古い加工物、実行されていない工程、後始末が機能していないスイート、未測定の宣言。
    数え直しは、インストール済みの `parity-suite`（このスキルと同じインストール先の `parity-suite/scripts/`）の `artifact-health-check.mjs` を呼んで行う（チェックの規則を 2 つのスキルに複製しない）。

    ```bash
    node <parity-suite の skill>/scripts/artifact-health-check.mjs --metadata .replace/parity/<slug>/metadata.json --target <target> --stage diff
    ```

    失敗にするのは、次の 4 つのグループである。
    1. 採取物
       - `read_by` も `unread_reason` も無いもの、`baseline_dir` にあるのに宣言が無いもの、宣言の実体が無いもの
       - `read_by` が指すスペックに、採取物の名前が現れないもの（文字列で照合する）
       - `kind: derived` の `derived_from` の `sha256` が、元の実体と一致しないもの（加工物が古い）
       - `derived_from` も `freshness_unverified_reason` も無いもの
    2. 繰り返しの実行
       - `suite.state_mutating: true` なのに `repeat_run.cleanup_in_suite` が真でないもの
       - 連続する 2 回の記録が無いもの、最後の 2 件が緑でないもの、`started_at` が同じか逆の順のもの
       - `suite_fingerprint` が 2 回で違うか、今のスイートと違うもの（記録した後にスペックや後始末を変えた）。片方だけが指紋を持つもの、今のスイートの指紋を計算できないもの
       - `repeat_run.specs` を持つ成果物は、スペックごとに次のものを失敗にする。
         - 分類されていないスペックがあるもの
         - 命名規則に当たらない JS / TS 系のファイルが、`specs` にも `shared_files` にも無いもの
         - 状態を変えるスペックを含む直近の 2 回が無いか、緑でないもの
         - 状態を変えないスペックの直近の記録が緑でないか、今の版でないもの
         - そのスペックの指紋か、基になる `shared_fingerprint` が今と違うもの
    3. 未測定
       - `unmeasured.entries` に `disposition: blocking` が残るもの。語彙の外の値と、承認記録が空のものは `blocking` として数える
    4. 工程の成果物
       - `new/<target>/replace-metadata.json` の `suite.new_green` が真なのに、同じ場所に `diff-metadata.json` が無いもの
       - `diff-metadata.json` が今の新側に対応していないもの（`new.commit` が `replace-metadata.json` と違う、または `iteration` が `loop.iterations` と違う）。
         ただし SHA の違いは、`--new-repo` を渡したときに限り、部品の改修の持ち越し（`evidence-carry.json`。[`component-change.md`](component-change.md) の手順 5）が覆えば通す。
         記録と `replace-metadata.json` の版が一致したままの一括再検証の直後は、検証先の版を `--carry-to` で渡したときだけ持ち越しを判定する（同じ手順 5）
       - `dataset_version` を読めないもの、今の版より新しいもの、区間の `changes[].affects` に `*` があるもの、`changes` の履歴が不正なもの

    対応づけを版だけに任せない。データセットを変えずに `parity-replace` が実装を作り直すと、前の反復で収束した `diff-metadata.json` が `dataset_version` の一致だけでこのチェックを満たす。
    差分を採り直していないのに、「済んだ」ように見えてしまう。そのため、両方の成果物が持つ識別子（新側の commit の SHA と反復の回数）で結び付ける。
    `new.commit` が `none` のとき、または片方が記録を持たない古い成果物のときは、その軸を判定せず、理由を出力に残す。
    `replace-metadata.json` の `new.dirty: true` は失敗にする。commit していない変更のある作業ツリーでは「差分を採った実装」を特定できず、同じ版・同じ反復のまま中身だけが変わった実装を見逃すからである
    （`parity-replace` の軽い手順も、両側の `dirty: false` を適用の条件にしている）。
    `new.commit` が `none` でも失敗にする。commit の比べ方を選ぶ前にこれを見る（`none` の分岐に入ると、この判定に届かない）。
    両方の成果物の `new.target` を `--target` と突き合わせる。同じ commit・同じ反復は環境をまたいで一致しうるので、版だけでは「別の target のディレクトリへコピーしただけの成果物」を見分けられない。
    `dataset_version_exempt` で免除するのは、`dataset_version: null` と対になっているときだけである。
    理由の文字列が残っているだけで版のチェックを飛ばすと、投入対象の target に古い免除の文字列が残ったまま、新しさの判定がまるごと外れる。

    数値が古いだけでは失敗にしない。古くなったかは `golden-dataset` の `references/versioning.md` で定義する。
    記録した版から今までの `changes[].affects` が、slug が実際に参照するテーブルと重なるときだけ、古くなったとする。
    実際に参照するテーブルの導き方は `golden-dataset` の側の取り決めなので、このスクリプトは同じ実装をもう 1 つ作らない。重なりを見るまでもなく確定する形だけを失敗にする（重なりの判定は preflight が行う）。
    投入対象でない target（`db` を持たない、または `seedable` の無い読み取り専用のもの）は、`dataset_version: null` にして `dataset_version_exempt` に理由を書き、免除する
    （[`preflight.md`](preflight.md) で定義する）。この免除は正規の記録なので、失敗にしない。
    `converged` が偽でも失敗にしない。偽は「まだ直っていない」という記録で、隠すものではない。失敗にするのは「無い」と「古い」だけである。

    `--stage diff` はデフォルトなので省いてもよいが、明示する。`parity-suite` は自分の完了の判定を `--stage suite` で通している（`blocking` は向こうが書く出力なので、失敗にしない）。
    どちらの工程のチェックかを読み手が取り違えると、収束判定で `suite` を渡して、未測定を通してしまう。
    終了コードは、0 が条件を満たす（判定しない節を含む）、1 が未検証か不整合が残る、2 が使い方の誤りか型の誤りである。

    このチェックは、`diff-metadata.json` に結果を書いた後に通す。工程の節は「`suite.new_green` が真なのに `diff-metadata.json` が無いか古い」を見るので、
    まだ書いていない時点で通すと、自分が記録していないことで失敗する（`converged` を真にする直前の、最後のチェックとして置く）。
    この節が実際に捕まえるのは、工程の外の状態である。`parity-diff` を一度も実行していない、または途中で止めた slug × target が、
    `replace-metadata.json` の `suite.new_green: true` だけを残して「済んだ」ように見える状態である。
    `replace-strategy status` の「green 済み・差分検出は未実施」を、機械で読める形にしたものに当たる。
    `artifact_health` / `unmeasured` / `suite.state_mutating` をキーごと持たない古い成果物では、その節を判定しない（後方互換）。
    ただし、判定しなかった事実と理由を `diff-metadata.json` の `artifact_health`（`judged: false`）と、`diff.md` の未検証の領域に残す。
    スクリプトが見つからないときは、判定を飛ばさずに停止し、`gh skill install shoji9x9/skills parity-suite` を促す。
  - 追記専用の成果物が縮んでいない（一覧は `replace-strategy` の `assets/append-only-manifest.json` で定義する）。
    決定を積み上げる成果物は、既存の内容を消さずに追記すると定めてある。
    対象は、設定ファイル、`features.md` / `components.md` / `assets.md` / `dependencies.md` / `weaknesses.md`、インスタンス例外の台帳とその根拠、`gaps.md`、データセットの版の記録である。
    ところが、追記であることを確かめないと、丸ごと書き直しても、今の状態が整合していればすべて通ってしまう。
    失われるのは過去の決定（なぜこの差分を許容したのか、いつ誰が承認したのか）で、収束の判定は今の状態しか見ないので、`converged: true` になりうる。
    数え直しは、インストール済みの `replace-strategy` のスクリプトが行う。

    ```bash
    node <replace-strategy の skill>/scripts/append-only-check.mjs --root . --base <機能に着手した時点の版>
    ```

    終了コードは次のとおりである。どの 0 件も合格として扱わない。機能を閉じる時点では、追記専用の成果物はあり、commit もされているはずだからである。
    - 0: 縮んでいない
    - 1: 単位が失われている、成果物が消えている、比較元にある成果物が 0 件（突き合わせが 1 件も成り立っていない）
    - 2: 使い方の誤り、判定できない、作業ツリーに対象が 0 件、一覧の `unit` が語彙の外、比較元の木にあるのに内容を取り出せない

    突き合わせの単位は、一覧の `unit` で決める（`lines` / `markdown-structure` / `json-arrays`）。
    すべてを行として比べると、原本が明示的に求めるその場での更新が「失われた行」として誤って判定され、決定を 1 つも捨てていない成果物で収束が止まる。
    その場での更新とは、版の +1、状態の列の `未`→`済`、Issue の列の `未起票`→番号、最終更新の日時などである。
    - `lines` では、鍵を名指しして単位を変える。
      `growable_containers` は、追記だけを許す鍵を要素ごとの単位に広げる（`component_diffs`）。
      `registry_groups` は、鍵をまたいで要素が移る台帳（`intentional_diffs` の `keep` / `may_change` / `pending`）を、グループに共通の要素の単位に広げる。
      下記「`intentional_diffs.pending` の棚卸し」で人が文言を移すのは通り、棚卸しを経ずに要素を消すと失敗する。どちらも、キーごと消すと失敗する。
    - Markdown では、見出し・表の列名・表の行（先頭のセルが鍵）・行 × 列のセル・定義の箇条書きの鍵・それ以外の散文の行を守る。
      鍵だけを守ると、残りのセルを自由に書き換えられる（決定の出どころ・方針・理由を丸ごと差し替えても、行は残る）。
      そのため、原本がその場での更新を定めている列だけを `mutable_columns` で外す（一覧の `requirement` が節・列・行だけを守ると定めている成果物は `"*"`）。
      定義の箇条書きも、鍵と値の両方を守る（`- ライセンス: MIT` を書き換えると失敗する）。値の更新を原本が定めている項目だけを `mutable_bullets` で外す。
      同じ鍵の行や箇条書きは、出てくる順で区別する（`assets.md` では、方針を覆した行と今の行が同じ「種類」で並ぶので、区別しないと入れ替えが見えない）。
    - JSON では、`arrays` に挙げた配列の要素を守り、`version` のようなスカラーは固定しない。
      同じかどうかは深い等価で決めるので、2 つの要素の間で承認記録を入れ替える書き換えも、縮小として失敗する。
      `key` を添えた配列は、鍵で要素を対応づけてフィールドごとに突き合わせる。デフォルトでは、鍵以外を変えてはいけない。
      原本が更新を認めている項目だけを、`fill_only`（空から空でない値への変更だけ。既にある承認記録の差し替えは失敗にする）と、
      `transitions`（明示した `<変更前>-><変更後>` だけ。`unmeasured.entries` の `blocking->accepted` など）で開ける。
    - どれも空白をまとめてから突き合わせるので、フォーマッタの桁そろえでは失敗しない。

    `--base` には、機能に着手した時点の版を渡す。デフォルトの `HEAD` は、作業ツリーと直近の commit の比較である。
    そのため、書き直しを commit した後は差が無く、何かが失われていても通ってしまう（着手した時点の版は、`git merge-base` や、機能のブランチが分かれた点から取る）。
  - 性能の比較に、回帰と判定できない組が残っていない。
    `metadata.json` の `performance.declared` が `true` のときだけ判定に入り、`perf-stats.mjs compare` が exit 0 であること（手順の原本は [`detect.md`](detect.md)「性能の比較」）。
    `regressed` は要対応として差し戻しに入り、`noisy`・`missing`・`insufficient`・`env_mismatch`・古い基準は差し戻さずに採り直す（`env_mismatch` は `parity-suite` での採り直しを利用者へ案内して停止する）。
    `results` の件数には足さず、`performance.ok` だけで判定する。
    `performance` が無い・`declared: false` の成果物は判定せず、`diff-metadata.json` の `performance.judged: false` と理由、`diff.md` の未検証の領域に残す。

## `intentional_diffs.pending` の棚卸し

機能を閉じる前に、意図的差異の保留を人へ見せて、処置を決める。
追記だけを定めて確定の時期を定めないと、保留が残ったまま機能が閉じられ、判断待ちが機能をまたいで積み上がる。
後から読む人は、「まだ決まっていない差」と「決まったが記録が古い差」を区別できなくなる。
`pending` は、設定ファイルに残る唯一の作業中の記録である。それを閉じる工程を持つのはここだけなので、このスキルが棚卸しを求める。

この棚卸しは `pending_review` とは別のものである。
`pending_review` は、その差分の分類が承認待ちであることを示す（`diff-normalize.mjs` の分類）。
この節で扱うのは、意図的差異として認めるかが決まっていないという宣言である（設定ファイルのレジストリ）。混同すると、片方だけを見て収束させてしまう。

### 対象

要素の形と `slug` の意味は、`replace-strategy` の `references/project-config.md`「`pending` 要素の形」で定義する。次の 3 つのグループをすべて見せる。

| グループ | 条件 | 見せる理由 |
|---|---|---|
| この機能の保留 | `slug` が対象の slug と一致する | この機能が積んだもの |
| 横断の保留 | `slug` が `cross-cutting` | 機能に帰属しないので、閉じる工程を持たない（どこかで見せないと、いつまでも残る） |
| 帰属不明の保留 | 素の文字列（古い形式）、または `slug` が無い | 警告なしに対象外にすると、いちばん古くから積まれている保留だけが、誰の目にも触れなくなる |

他の機能に帰属する保留（`slug` が別の slug）は対象外である。その機能の収束判定が扱う。

### 処置

1 件ずつ人へ見せる。まとめて「全部持ち越し」のような一括の指示には従わない。中身を見ずに決めると、棚卸しが形だけの手順になる。処置は次のいずれかである。
自律実行（`--autonomous`）では、処置を記録せず、`pending_decisions[]` に保留として残す。
`carried_over` を自分で書かない。理由を記録するだけで通る処置なので、自分で書くと人の判断を経ずに棚卸しが通ってしまう。

| 処置（`disposition`） | 意味 | 要る記録 |
|---|---|---|
| `keep` / `may_change` | 意図的差異として確定した | 人間が、設定ファイルの `pending` から該当する分類へ文言を移す（スキルは移さない。誰が書くかはスキーマの文書の「キーの書き手とライフサイクル」で定義する）。文言を変えて移したなら、`promoted_as` に移した後の文言を書く |
| `carried_over` | 次の工程へ持ち越す | `reason` に持ち越す理由（測定待ち・依存先の実装待ちなど）。理由を記録すれば通るので、機能をずっと止めることはない |

`keep` / `may_change` へ移すことを見せるときは、同じ種類の前例を探して、判断の材料に並べる。
前例とは、レジストリや他の機能の `diff.md` で、同じ種類の差を「現行に合わせる」とした判断である。
食い違うまま移すと、前の機能と後の機能で同じ種類の判断が分かれたまま、両方が収束する。
探し方・記録・食い違ったときの扱いは、`replace-strategy` の `references/project-config.md`「同じ種類の前例を突き合わせる」で定義する。

### 記録

`diff-metadata.json` の `intentional_diffs_pending` に、件数と各件の処置を残す（様式は [`../assets/diff-metadata-template.json`](../assets/diff-metadata-template.json) で定義する）。
`diff.md` にも同じ内訳を書く（件数の原本は `diff-metadata.json` である）。保留が積み上がっていることには件数で気づくので、対象が 0 件でも記録を省かない。

- 判定は [`../scripts/pending-triage-check.mjs`](../scripts/pending-triage-check.mjs) が行う（実行の方法は上記「収束の条件」）。記録された件数を信用せず、設定ファイルの `pending` から数え直す。
- スクリプトが失敗にするのは、次の 7 つである。
  1. 対象なのに記録が無い（未棚卸し）
  2. `keep` / `may_change` と記録したのに、`pending` に残っているか、移した先に見つからない（記録だけで通ると、棚卸しが「書けば通るチェックリスト」になる）
  3. 持ち越しの `reason` が空
  4. `pending` に同じ文言が複数ある（どれを棚卸ししたかを決められない。先にあるものを採らない）
  5. 記録した帰属が、設定ファイルの `pending` の帰属と違う（別の機能の保留を、自分の機能の slug で閉じられてしまう）
  6. 宣言した件数が、数え直した件数と一致しない
  7. `slug` の名前空間を確かめられない（帰属不明として、すべての機能の対象にする。そのままでは、どの機能の対象にもならず、いつまでも棚卸しされない）
- 失敗にする範囲は、棚卸しの対象の範囲と同じにする。
  設定ファイルの `pending` の要素の形の不備（`added_by` / `added_at` の欠落など）で失敗するのは、その要素が対象の 3 つのグループのいずれか（この機能に帰属・`cross-cutting`・帰属不明）のときだけである。
  別の機能に帰属すると読めている要素の不備は、`warn:` と件数の `note:` で報告するだけで、この機能の収束を妨げない。その要素は、その機能の棚卸しが失敗にする。
  ただし、これはその機能の収束判定がこの後もう一度実行されることが前提である。
  収束済みの機能の slug で不備のある要素が後から追記されると、その機能ではチェックが二度と実行されず、他の機能では `warn:` にしかならない。どこでも失敗にならない要素になる。
  そうした要素に気づく方法は `warn:` と `note:` の件数だけなので、0 件でない限り読み飛ばさず、帰属先の機能の担当へ戻す
  （この緩和で変わったのは止める範囲が狭くなったことで、チェックが実行される回数は増えていない）。
  `slug` を読めない要素（`slug` が無い、空か文字列でない、素の空文字列、文字列でもオブジェクトでもない）は、帰属不明としてすべての機能の対象になるので、失敗にする（対象を決められないものは合格として扱わない）。
  `slug` が機能の一覧（`.replace/features.md`）に実在することも確かめる。綴りの間違いや部品の slug は、担当する機能が現れないまま、どの機能の対象にもならない。そのため、帰属不明としてすべての機能の対象にする。
  `--features` を渡していない実行では実在を確かめられないので、この緩和自体を使わない（全件を対象にする）。
  帰属を信用できるのは、`added_by` が読めていて、その書き手が機能の slug を書けるとき（`golden-dataset` / `parity-suite` / `parity-replace`）だけである。
  `added_by` が無い・`unknown`・未知の名前の要素は、`slug` がどの名前空間のものかを確かめられず、「別の機能に帰属すると読めている」条件を満たさない。そのため、帰属不明としてすべての機能の対象にする。
  `parity-component` と `replace-strategy` は機能の slug を書けない（部品は複数の機能にまたがり、`replace-strategy` の追記は slug を採番する前の工程で行われる）。
  そのため、これらの追記は `cross-cutting` でなければ、同じく帰属不明として扱う。
  `cross-cutting` は書き手に関わらずすべての機能の対象なので、この確認の対象外である。
  `item` を読めない要素も、`slug` が読めればその機能の棚卸しが失敗にする（帰属で範囲が決まるのは、他の不備と同じである）。
- `error:` は、不正な箇所によって分かれる。
  設定ファイルの登録簿の不備は `error: 設定ファイルの登録簿の不整合（intentional_diffs.pending…）`、成果物の棚卸しの記録の不備は `error: 棚卸し記録の不整合（intentional_diffs_pending.entries…）` である。
  `error:` の行だけを読む自動化が、直す場所を取り違えないように分けてある
  （JSON の出力の `registry_problems` / `record_problems` / `out_of_scope_problems` も同じ区分である。`problems` は全件）。
- `intentional_diffs_pending` のキーが無いときは、古い成果物として合格にせず、未実施として失敗にする（対象 0 件と記録が無いことを、同じ出力にしない）。
- 未実施（exit 1）と、成果物の型の誤り（exit 2）を分ける。`intentional_diffs_pending` がキーごと無いのは未実施である（棚卸しをすれば直る）。
  一方、記録がオブジェクトでない、または `entries` が配列でない（キーが無い場合を含む）のは型の誤りなので、exit 2 で失敗にする。
  対象が 0 件の棚卸しも `entries: []` を書く取り決めなので、`entries` を持たない記録は「0 件」ではなく、不正な成果物である。
  両方を exit 1 にまとめると、自動化は「やり直せば直る」と「成果物が不正」を区別できない。

## 他機能待ちの差分（`blocked_by`）

機能ごとに分けて移行するので、同じページに乗る別の機能が新側で未実装であることに由来する差分は、必ず出る（欠けたセクションの分だけ親の要素の高さが変わり、相対的な位置関係が逆になるなど）。
その機能を実装しない限り解消しないので、`parity-replace` へ差し戻しても直せない。
要対応でも許容でもない 3 つ目の状態として、`diff-metadata.json` の `blocked_by[]` に帰属させる。

ただし、ページの一覧と `capture_conditions.cofeature_masks` から領域を決められる共同居住機能は、差分を検出する前に実行時のマスクで除く（[`capture-new.md`](capture-new.md)「共同居住機能の実行時マスク」で定義する）。
`blocked_by` は、領域を安全に限れない周りのレイアウトの差など、マスクの外に残った差分の置き場所である。マスクできる差分を毎回トリアージするための、通常の手順にはしない。

- 帰属できるのは、次の 3 つをすべて満たす差分だけである。1 つでも確かめられなければ、`unexplained` のまま残す。ここを緩めると、`blocked_by` が直せない差分の逃げ道になる。
  1. 依存先が、`.replace/features.md` にある slug である（自分で採番しない）
  2. 同じ target で、依存先が新側でまだ green でないことを読んで確かめた（`new/<target>/replace-metadata.json` が無い、または `suite.new_green` が false）。読んだパスと値を `evidence` に書く
  3. 差分が、「その機能の要素が新側に無いこと」で説明できる（説明を `reason` に書く）
- 帰属させても、差分は残っている。`results.unexplained` の件数から差し引かず、`converged` を `true` にしない。
- 差し戻さない（その target では直せない）。`on_diff` の分岐にも入れず、停止してユーザーへ「依存先の実装待ち」として報告する。要対応の差分が別にあれば、そちらは通常どおり差し戻す。
- 前回の実行の `blocked_by` は引き継がず、毎回検証し直す。依存先が `suite.new_green` になっていれば帰属を外し、その差分を通常の候補として判定し直す。

### 収束状態は 4 つ（`converged` の 2 値では表せない）

| 状態 | 導き方 | 次の行き先 |
|---|---|---|
| 収束 | `converged: true`（上記「収束の条件」をすべて満たす） | 完了 |
| 他機能待ち | `converged: false` で、残る未説明の差分がすべて `blocked_by` に帰属し、要対応・`deviates_T`・未解決の保留がゼロ | 停止してユーザーへ報告する。依存先を実装した後に再実行する |
| 判断待ち | `converged: false` で、要対応・`deviates_T` がゼロ、`pending_decisions[]` に未解決の保留が残り、残る未説明の差分がすべて未解決の保留（原因の単位の `許容候補（要確認）`）か `blocked_by` に帰属する（`blocked_by` が同時にあってもよい） | 終わりにまとめて聞く（`replace-strategy` の `references/autonomy.md`）。答えを反映して判定し直す |
| 未収束 | 上記以外（要対応が残る、または保留にも `blocked_by` にも帰属しない未説明の差分が残る） | 下記「差し戻し」（未解決の保留があっても、差し戻しは進める） |

判定し直すきっかけは、`replace-strategy status` が持つ。依存先が同じ target で `suite.new_green` になった slug を検出し、`blocked_by` で参照している側の `parity-diff` の再実行が要ると挙げる（成果物から毎回導く原則に沿う）。
`parity-replace` は、自分が green にした機能に依存している機能を知らないので、知らせる役を持たせない。

## 差し戻し（要対応が 1 件以上のとき）

差分レポートは、選択した target の `.replace/parity/<slug>/new/<target>/diff.md` である。
どう動くかは、target の `on_diff`（対応の手順を書いた Markdown のパス。任意）で決まる（意味は `replace-strategy` の `references/project-config.md`「on_diff」で定義する）。どの分岐でも、このスキルは修正しない。

- `on_diff` が無い（デフォルト）とき: `diff.md` を差し戻しの入力にして、同じ target で `parity-replace` へ渡す。
  該当のページ・分類・根拠が読める形にする（想定するフェーズ、つまり実装／新側のマッピング／テーマを示す）。
- `on_diff` があるとき: そのドキュメントに従う。厳密にしたい手順は、ドキュメントがリンクするスクリプトを実行する。
  ガードレールは、ドキュメントの指示より優先する。一覧は `replace-strategy` の `references/project-config.md`「`on_diff`」節の「ガードレール」で定義する。
  従う前にその一覧を読み、このスキルに関係する項目をすべて当てる（ここへ転記しない。転記すると原本の改訂に追従できない）。
  一覧を読めない（`replace-strategy` が未インストールなどで、そのファイルを読めない）場合は、ガードレールなしで従わずに停止し、ユーザーに上げる。
- ドキュメントが「修正のループを回さず、起票して停止する」運用（マージの後にデプロイする環境など）を指示するとき: 差し戻さずに、要対応の差分の要約を `issue-create` に渡して起票し、停止する。
  要約には、対象の slug・target・該当のページ・分類・根拠・`diff.md` のパスを含める。
  自分で Issue の本文を `gh` で直接起票しない（重複の確認・テンプレート・承認は `issue-create` の取り決めである）。
  起票したら、`diff-metadata.json` に `converged: false` のまま結果を残し、Issue の URL と番号を記録して終える（差分を「解決済み」にしない）。
- 従ったドキュメントのパスを、`diff-metadata.json` の `on_diff_doc` に記録する（無ければ `none`）。
- 反復の回数の記録と上限の管理は、`parity-replace` がその target の `new/<target>/replace-metadata.json` の `loop.*` で行う（環境ごとに独立している）。
  `loop.iterations >= loop.max_iterations`（デフォルトは 5）なら、このスキルは新たに差し戻さず、停止してユーザーへ上げる。
  最初から作り直さない（上限の管理は `parity-replace` の `references/diff-loop.md` で定義する）。

## 収束したとき

- `diff-metadata.json` の `converged` を `true` にする。条件は、上記「収束の定義」の収束の条件の箇条のすべてである（ここへ転記しない）。
  件数で数えない。転記した抜粋で判定すると、次のものを見落とす。
  `blocked_by` の残り、承認の前の分類の残り、例外の台帳の不整合、網羅表の未測定、反応の未測定、性能の回帰と判定できない組、保留の未棚卸し、未解決の判断待ち、採取物と工程の健全性、追記専用の成果物の縮小。
- 次のものを記録する。
  - `results`（total / actionable / accepted / noise / unexplained / unverified）
  - `accepted_exceptions`（原因の数 / インスタンスの数 / 不整合の数）
  - `component_coverage`（判定したか / 数え直した期待セルの数 / 未測定の数）
  - `reaction_coverage`（判定したか / 操作の数 / 未測定の操作の数）
  - `performance`（判定したか / 状態ごとの件数 / 回帰の組。`perf-stats.mjs compare --write` が書く）
  - `intentional_diffs_pending`（棚卸しの対象の内訳 / 確定した件数 / 持ち越した件数と各件の処置）

## 対象外・未検証の明示

- アニメーションが同じかは扱えない（止めてから比べるため）。`diff.md` に対象外として残す。
- ベースラインに記録されない箇所は、「未検証」として `diff.md` に残す（確認済みにしない）。
- 宣言できない構造の差（`gaps.md` の該当する節・フォーカスリングの形・内部の DOM・余白の配り方など）は、正規化の対象外（未検証）として `diff.md` に転記する。
