# status モード

Issue の状態とリポジトリの中の成果物から、今の状況を導出する。
**このモードは自分の状態を持たず、毎回導出する。** ブランチをマージした後でも動くようにするためである。

## 入力

| 情報源 | 読むもの |
|---|---|
| `.replace/features.md` | 機能・横断 API・バッチ・その他の Issue（4 種以外）の一覧、slug、fan-out、ページ一覧（ページ × 乗る機能）、ページ要素の帰属（要素 × 配置の所有者の slug）、API の「要求単位の根拠」列（`実測` / `推定`）、Issue 番号。Issue は番号だけを読む。旧版のテンプレートから来た「状態」列と、突き合わせの出力である「受け入れ条件」列は読まない（下記「Issue 状態の取得」と「導出する内容」の 12） |
| `.replace/components.md` | 共通部品の一覧、slug、インスタンス、データ依存の有無、採否、Issue 番号。画面より先に部品を作る方針のときだけ存在する。無いのは未着手ではなく「この方針を採っていない」という意味なので、`setup` 未実施として報告しない |
| `.replace/assets.md` | 静的資産の種類ごとの方針（空欄は未決）と、未走査・未確認の記録。`replace-strategy` の `setup` が作り、形式の原本は [`static-assets.md`](static-assets.md) にある。無いのは、この工程を入れる前に `setup` を終えたプロジェクトなので、`setup` 未実施として報告しない |
| `.replace/weaknesses.md` | 現行のセキュリティ上の弱点ごとの仕分け（空欄は未決）・扱う設計作業・露出を広げた差異。`replace-strategy` の `setup` が作り、形式の原本は [`security.md`](security.md) にある。無いのは、この工程を入れる前に `setup` を終えたプロジェクトか、未実施である |
| `.replace/procedure-changes.md` と `parity-suite` の `assets/procedure-revisions.json` | 確かめる軸を足した変更（プロジェクトの側の台帳と、スキルの側の改訂）と、すでに閉じた機能への当て直しの判断。形式の原本は [`procedure-changes.md`](procedure-changes.md) にある。台帳が無いのは、プロジェクトの側で軸を足していないだけである。スキルの側の改訂は、台帳が無くても判定する |
| GitHub Issue | 各 Issue の open/closed（下記のとおりページネーションを処理する） |
| `.replace/components/<slug>/metadata.json` | 部品の採取の状態（`capture.complete`・`axes.ok`・`capture_gaps`）と、基準が古くなったかを判定する材料（`dataset_version`・`target.name`）。`parity-component` が作り、スキーマの原本は `parity-component` にある |
| `.replace/components/<slug>/new/<target>/build-metadata.json` | 部品の実装・照合の記録（`parity.unexplained`・`parity.missing_stories`・`parity.unbaselined_stories`・`behavior`・`acceptance`・`verification`・`loop`）。作るスキルとスキーマの原本は上と同じ。新側の成果物は環境ごとなので、target ごとに存在することがある |
| `.replace/parity/<slug>/strength.md` | パリティスイートの強度（捕捉した故障の種別・素通りした種別＝弱点・未検証の種別）。`parity-suite` が作る |
| `.replace/parity/<slug>/gaps.md` | 未検証の領域（特性化できなかった箇所・hermetic でないテスト・スコープ外の副作用）。`parity-suite` が作る |
| `.replace/parity/<slug>/metadata.json` | 取得したときのゴールデンデータセットのバージョン・対象のコミット・部品網羅表の宣言（`component_coverage`）・反応の網羅表の宣言（`reaction_coverage`）・性能の基準（`performance`）・未測定の宣言（`unmeasured`）。宣言のキーごと無ければ旧版の成果物である。`parity-suite` が作る |
| `.replace/parity/<slug>/component-coverage.json` | 部品網羅表（項目 × 部品インスタンス〈ページ〉の 3 値）。網羅プロファイルを宣言した部品では、インスタンスごとの候補が期待するセルになる。`parity-suite` が作り、スキーマとプロファイルの原本は `parity-suite` にある。現側の測定の結果なので、slug の直下に 1 つだけある |
| `.replace/parity/<slug>/new/<target>/component-comparison.json` | 部品網羅表の `present` を新側で突き合わせた記録（`cells[].compared` と、起点・当たり判定・完了の観測）。`parity-replace` が作り、様式とチェックの原本は `parity-suite` にある。網羅表の 3 値は移行元の側の測定なので、突き合わせていないものが残る機能は「新側で操作を完了できる」と報告しない。新側の成果物は環境ごとなので、target ごとに存在することがある |
| `.replace/parity/<slug>/component-diff-exceptions.json` | 承認済みのインスタンス例外の規模（`component_diff_exception_causes[]` の原因の数と、`component_diff_exceptions[]` のインスタンスの数）。`parity-diff` が作り、スキーマの原本は `parity-diff` にある。環境に依存しないので、slug の直下に 1 つだけある |
| `.replace/parity/<slug>/new/<target>/replace-metadata.json` | 新側の green の記録（`suite.new_green`・`verification.passed_at`）と、差し戻しの往復の状態（`loop.iterations` / `loop.max_iterations` / `loop.last_diff_report`）。`parity-replace` が作り、スキーマの原本は `parity-replace` にある。新側の成果物は環境ごとなので、target ごとに存在することがある |
| `.replace/parity/<slug>/new/<target>/diff.md` | 検出した差分と分類（要対応／許容／環境ノイズ）・根拠。`parity-diff` が作り、スキーマの原本は `parity-diff` にある。新側の成果物は環境ごとなので、target ごとに存在することがある |
| `.replace/parity/<slug>/new/<target>/diff-metadata.json` | 収束の判定の機械可読な値（`converged`・`results`・`component_coverage`・`reaction_coverage`・`performance`・`intentional_diffs_pending`）と、他の機能を待っている差分の帰属（`blocked_by[]`）。`parity-diff` が作り、スキーマの原本は `parity-diff` にある。target ごとに存在することがある |
| `.replace/dataset/metadata.json` | 今のデータセットのバージョン（`version`）、版ごとの影響範囲（`changes[].affects`。テーブル名で、`dataset_mode: static` では静的データの単位）、新側への投入の記録（`phase_b.<slug>.<target>`。target ごと）。`golden-dataset` が作る |
| `.replace/dataset/verification.md` | 「意味論が未確定の機能」。`current.origin: received-assets` のときだけある。`golden-dataset` が作り、スキーマの原本は `golden-dataset` にある |
| `.replace/bootstrap/metadata.json` | 現行の環境を作り直す作業の状態（`status` / `blocked_on` / `semantics.pending_features`）。`current-environment-bootstrap` が作り、スキーマの原本は `current-environment-bootstrap` にある。`received-assets` のときだけある |
| 上の各 JSON の成果物・`.replace/dataset/pending-decisions.json`・`.replace/parity/<slug>/pending-decisions.json`・`.replace/parity/<slug>/new/<target>/pending-decisions.json`・`.replace/strategy-pending.json` | 自律実行（`--autonomous`）で人の判断待ちにした保留（`pending_decisions[]`）。形の原本は [`autonomy.md`](autonomy.md)「記録の形」にある。`.replace/strategy-pending.json` は、`replace-strategy` 自身が自律実行したときだけ存在する |

成果物のスキーマの原本は、それぞれの成果物を作るスキルにある。ファイルが無い場合は「未着手」として扱い、エラーにしない。
ただし `.replace/features.md` 自体が無い場合は、`setup` 未実施として報告し、`setup` の実行を案内する。それ以降の導出は行わない。
この場合も、先に `.replace/strategy-pending.json` と `.replace/bootstrap/metadata.json` の未解決の保留（下記「導出する内容」の 9）を集めて報告する。
`setup --autonomous` は `features.md` を書く前に保留で止まることがあり、そのとき `setup` を続ける手がかりはこの保留にしか無いからである

## Issue 状態の取得

features.md と、`.replace/components.md` があればその「部品一覧」表に記録された Issue 番号だけを、1 件ずつ取得する。
対象は分かっている番号なので、リポジトリの Issue の一覧をすべて取得する必要は無い。
部品の番号も同じ集合に入れる。共通部品 Issue の番号は `components.md` にしか無いので、features.md だけから集めると、「共通部品の現況」（下記の 7）の Issue 状態がいつも判定不能になる。
`components.md` が無いプロジェクトでは、features.md の番号だけで取得する。部品の方針を採っていないだけで、取得の抜けではない。

```bash
# $NUMBERS は features.md（と、あれば components.md の部品一覧表）から抽出した Issue 番号の一覧。**`#` を外した数字だけ**にする
# （features.md は `#103` の形で記録するので、そのまま渡すとパスが `issues/#103` になり、
#  404 ですべてが判定不能になる。取得の失敗と表記の誤りが同じ出力になり、区別できない）
for n in $NUMBERS; do
  # 取得できた番号だけ行が出る作りにすると、失敗した番号が出力から警告なしに消える
  # （gh のエラーは番号を含まない）。失敗も 1 行として残し、後の段で「判定不能」として扱う
  # stderr は捨てない（認証切れと 404 の区別を残す）
  if row="$(gh api "repos/$OWNER/$REPO/issues/$n" --jq '[.number, .state, .title] | @tsv')"; then
    printf '%s\n' "$row"
  else
    # 成功した行と同じ 3 列に揃える（列の数が変わると、後の段が判定不能の行を読み落とす）
    printf '%s\t判定不能\t-\n' "$n"
  fi
done
```

番号を並べられない取得（横断的な検索など）を行う場合は、指定した件数で打ち切らず、ページネーションを処理する（REST は `--paginate`、GraphQL は `pageInfo`/`endCursor` と `--paginate`）。

**状態は、この問い合わせだけを根拠にする。** features.md に「状態」列（旧版のテンプレートから来た列）があっても読まない。
転記した値は閉じたときに更新されず、警告なしに古くなるからである（原本は [`features-issues.md`](features-issues.md)「Issue の状態は転記しない」）。

取得できなかった番号は、`判定不能` として報告する（`gh` が使えない・認証が無い・番号が存在しない、など）。
open とも closed とも仮定せず、features.md の記述で代わりにしない。
取得の失敗を closed として扱うと「終わった」と読め、open として扱うと未着手の中に埋もれる。どちらの場合も、取得できていないという事実が消える。
取得できた分の導出は続け、判定不能の番号を一覧で示す。

## 導出する内容

1. 機能ごとの現況表。slug ごとに、次のものを示す。
   - Issue 状態（未起票／open／closed／判定不能）
   - パリティスイートの有無と強度（`strength.md` の弱点・未検証の種別を含む）、ベースラインの有無
   - データセットのバージョンが古くなったか。ベースラインの `dataset_version` より後の `changes[].affects` が、その slug の実効の参照テーブルと交わるときだけ「要再取得」とする。
     実効の参照テーブルと、判定できないときに失敗として扱う条件の原本は、`golden-dataset` の `references/versioning.md` にある
   - フェーズ B の状態。`new/<target>/` が存在する target について見る（`diff.md` の有無は問わない。差分を検出する前でも新側のデータは要る）。
     - 対応する `phase_b.<slug>.<target>` が無ければ、「その環境でフェーズ B が未実施の疑い」とする
     - `phase_b.<slug>.<target>.dataset_version` より後の変更がその slug に影響するなら、「その環境の新側のデータが古い・再投入が要る」とする。
       数値が古くても影響する変更が無ければ、再投入は要らないとして記録し、記録したバージョンは書き換えない
     - ただし、投入の対象でない target は対象にしない。
       `dataset_mode: db`（デフォルト）では、`db` が定義されていない target と、`db.env_vars` はあるが `seedable` が無い読み取り専用の target がこれに当たる。
       `dataset_mode: static` では、すべての target が投入の対象なので、免除は起きず、どの target もフェーズ B の状態を見る（取り決めの原本は [`project-config.md`](project-config.md)）
   - 新側の到達点。`replace-metadata.json` の `suite.new_green` が true なのに `new/<target>/diff.md` が無ければ、「green 済み・差分検出は未実施」として区別する。
     `parity-diff` を実行していないことが、「未着手」の中に埋もれないようにするためである。
     同じ判定を機械可読で取るなら、`parity-suite` の `scripts/artifact-health-check.mjs --metadata <現側 metadata.json> --target <target> --stage diff` を使う。
     これは `diff-metadata.json` が無いことと、古いことまで見る
   - 差し戻しの往復の状態（`loop.iterations` と `loop.max_iterations`）。
     1 以上で収束していなければ「往復中（n 回目）」、`loop.iterations` が `max_iterations` に達していれば「上限に到達・人の判断待ち」とする
   - `parity-diff` の進み具合（`new/<target>/diff.md` の分類を集計した「要対応」の残りの数）。収束の判定そのものは `parity-diff` が行い、このモードは集計した値を報告するだけである

   新側の進み具合は target（環境）ごとに分かれるので、同じ slug でも環境ごとに状態を示す（例: local-dev は収束済み・preview は未実施）。
   `new/` の下に無い target は、「その環境では未実施」として扱う
2. 他の機能を待っている差分が解けたかの検出。`diff-metadata.json` の `blocked_by[]` をすべての slug × target で集める。
   依存先が同じ target で新側の green（`new/<target>/replace-metadata.json` の `suite.new_green` が true）になっているものを並べる。
   これは「依存先が実装されたので、依存元の `parity-diff` を実行し直せば解ける可能性がある差分」である。
   判定し直すきっかけは、このモードが持つ（`parity-replace` は、自分が green にした機能の依存元を知らない）。
   依存先がまだ green でない `blocked_by` は、「他の機能を待って止まっている（依存先の slug と Issue）」として報告する。`converged: false` を「往復中」と混同しない
3. 未検証の領域と、許容した差分の一覧。すべての slug の `gaps.md` をまとめる。
   - `current.origin: received-assets` では、`.replace/dataset/verification.md` の「意味論が未確定の機能」もまとめる。
     このファイルが無ければ、`.replace/bootstrap/metadata.json` の `semantics.pending_features` をまとめる。
     そして「意味論の確認待ちで開始できない」機能を、未着手と区別して示す。
     スイートを持たない点は同じでも、待っているものが違う（前者は質問票の回答、後者は着手）
   - スコープ外にした副作用（メール・外部連携）・hermetic でないテスト・データの不足も含め、対象外にした事実を隠さない。切り替えを判断する材料として示す
   - 部品網羅表の状態を slug ごとに示す。`metadata.json.component_coverage` が `declared: true` なら、未測定のセルの数を `diff-metadata.json.component_coverage.unmeasured` から取る（`parity-diff` を実行した target のもの）。
     測っていない部品の操作は差分ゼロとして通るので、未検証の領域である。
     `component-coverage.json` の `value: unmeasured` の行を目で数えず、`metadata.json` の宣言の値も書き写さない。
     行が無い組み合わせ・`evidence` が空・`present` なのに `covered_by` が空・重複した行も未測定なので、目で数えた行や宣言の値はどれも少なく出る（数え方の原本は `parity-suite` の `references/coverage.md`）
   - どの target でも `parity-diff` を実行していなければ、「未測定の数は未算出（`parity-diff` の実行で確定する）」と報告する。
     このモードは自分で数えない。数え直すのは `parity-diff` に同梱のツールで、このスキルだけでは届かない
   - `declared: false` ならその理由を示す。キーごと無ければ「網羅表が未導出（旧版の `parity-suite` の成果物）」として区別し、`declared: false` と混同しない
   - 反応の網羅表も同じ形で示す。
     未測定の操作の数は `diff-metadata.json.reaction_coverage.unmeasured_operations` から、画面ごとの状態表示の未測定の数は同じく `state_displays_unmeasured` から取る（`reactions.json` を目で数えない）。
     `parity-diff` を実行していなければ未算出、`declared: false` ならその理由、キーごと無ければ旧版の成果物として区別する
   - 性能の比較も同じ形で示す。回帰と判定できない組の件数は `diff-metadata.json.performance.counts` から取る（`perf-samples.json` を自分で集計しない）。
     `performance.judged: false` ならその理由を示し、現側の `metadata.json` に `performance` が無ければ旧版の成果物として区別する
   - `component-diff-exceptions.json` の原因の数とインスタンスの数を、slug ごとに示す。承認済みで説明もついているが、インスタンスの件数は検証の弱さを示す。
     件数をまとめて隠さない取り決めなので、原因の数だけでなく、インスタンスの数もそのまま数えて報告する
   - 意図的差異の保留（`intentional_diffs.pending`）がたまっている状況を示す。
     設定ファイルの `pending` をすべて数え、`slug` ごとの内訳（機能に帰属 / `cross-cutting` / 帰属不明）と、最も古い `added_at` を報告する。
     保留は機能をまたいで積み上がるので、件数とたまっている期間が「判断の先送り」を示す。
     棚卸しを求めるのは `parity-diff` の収束の判定で、このモードは横断の集計だけを行う（要素の形の原本は [`project-config.md`](project-config.md)「`pending` 要素の形」）。
     ただの文字列の要素は帰属不明として数え、`added_at` が読めないことも報告する（警告なしに 0 件にまとめない）
   - 未測定の機械可読な宣言を示す。`metadata.json.unmeasured` が `declared: true` なら、`disposition: blocking` の件数を示す。
     `parity-diff` は、これが 1 件でも残る間は収束させない（数え直しは `parity-suite` の `scripts/artifact-health-check.mjs`）。
     `declared: false` ならその理由を示す。キーごと無ければ、「未測定が未宣言（旧版の `parity-suite` の成果物で、`gaps.md` の文章しか無い）」として区別する。
     `gaps.md` の文章は人向けの説明であって、収束の判定の入力ではない（原本は `parity-suite` の `references/coverage.md`「未測定を機械可読にする」）。
     `gaps.md` の行を目で数えて、blocking の件数の代わりにしない。文章には、承認済みの未検証と、測るべき未測定の両方が含まれている
4. 横断 API の影響範囲。横断 API に手が入ったら、利用側のすべての機能を検証し直す必要がある。
   features.md の fan-out から「このリソースを使う機能の一覧」を導き、横断 API Issue の状態の変化（再オープン・変更）に対して、検証し直しが要る機能を並べる
5. その他の Issue（4 種以外）の状態。「その他の Issue」表の各行について、Issue 状態（未起票／open／closed／判定不能）と、依存順・影響範囲を報告する。
   - `.replace/parity/<slug>/` の成果物を持たないので、スイートの強度・ベースライン・フェーズ B・差分の列は導出せず、「対象外」として示す（未着手と混同しない）
   - 依存順が「先頭」などで他の Issue の前提になっている行が open のままなら、それを前提にする Issue が進んでいることもあわせて示す
   - 節が「なし」（該当が無いと明記）なら、「該当なし」として報告する。
     節そのものが features.md に無い場合だけ、「その他の Issue が未導出（テンプレートを更新する前の features.md）」として報告する。節が無いことを「該当なし」と読まない
6. ページ単位の在席。features.md のページ一覧から、複数の機能が乗るページを取り出し、そのうち新側で未実装の機能を並べる。
   未実装とは、その slug の `new/<target>/replace-metadata.json` が無いか、`suite.new_green` でないことである。
   これは在席チェックがスキップされたままの範囲で、そのページでセクションが丸ごと欠けていても、どのスイートも赤くならない（環境ごとに分かれる）。
   ページ一覧を持たない features.md では、「在席が未導出」として報告する
7. 共通部品の現況（`.replace/components.md` があるときだけ）。部品の slug ごとに、次のものを示す。新側は target ごとに示す。
   - Issue 状態（未起票／open／closed／判定不能）
   - 採取の状態（`metadata.json` の `capture.complete` と `axes.ok`）。`axes.ok` が false なら、「軸の割り出しに未解決の問題がある。採取に戻す必要がある」とする
   - 基準が古くなったか。`dataset_version` より後の `changes[].affects` がその部品の描画に影響するデータと交わるときと、`target.name` が今の current target と違うときに古いとする
   - 照合の到達点（`new/<target>/build-metadata.json` の `parity.unexplained`・`parity.missing_stories`・`parity.unbaselined_stories`）。
     - `missing_stories` が 1 以上なら、「見本が足りず、照合していない組み合わせがある」とする
     - `unbaselined_stories` が 1 以上なら、「基準の無い見本があり、照合されていない」とする
     - 操作の結果の `behavior.check_exit` が 0 以外なら、「操作の結果が未突合・不一致」とする
     - `acceptance.check_exit` が 0 以外か、`acceptance.closable` が false なら、「部品の Issue の受け入れ条件が未突合・未充足」とする
     - キーが無ければ「未記録（テンプレートを更新する前の記録）」として示し、0 と読まない
   - 往復の状態（`loop.iterations` と `loop.stopped_reason`）

   `.replace/components.md` が無いときは、「共通部品を先に作る方針を採っていない」と報告し、未着手として数えない（節が無いことを、整備していないと読まない）。
   あわせて、`metadata.json.capture_gaps` の `inaccessible_sheets` / `unresolved_selectors` を未検証の領域（項目 3）に含める。0 件を「差が無い」の根拠にしない
8. ページ要素の帰属。features.md の「ページ要素の帰属」表から、配置の所有者が空欄の行を、未検証の領域として並べる。
   誰も配置しない要素は、実装した後の `parity-diff` まで、説明できない差分として現れない。そのため、着手前の確認事項として示す。
   節が「なし」（該当が無いと明記）なら、「該当なし」として報告する。
   節そのものが features.md に無い場合だけ、「要素の帰属が未導出（テンプレートを更新する前の features.md）」として報告する。節が無いことを「該当なし」と読まない

9. 判断待ちの保留。上の JSON の成果物すべて（slug × target を含む）・`pending-decisions.json`・`.replace/strategy-pending.json` から、未解決の `pending_decisions[]` を集める。
   成果物のパス・`question`・`blocks`・`raised_at` を、古い順に並べる。
   - 未解決には、`resolution` が `null` のもの（`open`）に加えて、回答はあるが `blocks` の工程が済んでいないもの（`decided`）も含める。
     2 つは分けて示す。「決まったが実施していない」は、判断ではなく作業が残っている状態である（数え方の原本は [`autonomy.md`](autonomy.md)「保留の状態」の `pending-decisions-check.mjs`）
   - 置き場に回した保留（`follow_up`）は解決済みだが、残りの作業と置き場を別に並べる
   - 保留は「止めている工程がある」ことを表すので、`converged: false` の「往復中」や未着手と混同せず、区別して示す
   - キーごと無い成果物は、自律実行していない（またはこの方針を入れる前の）成果物なので、数えない
10. 静的資産の未決。`.replace/assets.md` で方針が空欄の行と、「未走査・未確認」を、着手前の確認事項として並べる。
    未決の種類の資産を使う実装の単位は、`parity-replace` が進めないからである。
    ファイルが無ければ、「静的資産の方針が未決定（`setup` 手順 11 が未実施）」と報告する。無いことを「資産が無い」と読まない
11. 要求単位が未確認の API。features.md の機能一覧と横断 API の表について、行ではなく口の単位で未検証の領域を導出する
    （根拠は口ごとに書かれる。原本は [`features-issues.md`](features-issues.md)「API の形は要求単位を読んでから決める」）。
    導出は 2 つの集合の差分で行う。行ごとに「API 列に並ぶ口の集合」と「根拠列のエントリが対応づく口の集合」を作り、次のどれかに当たる口をすべて並べる（slug と口を書く）。
    - 根拠が `推定` の口
    - API 列にあるのに、根拠列のどのエントリにも対応づかない口。根拠が無いので未確認で、`推定` と同じ扱いにする
    - 根拠の語彙が `実測:` でも `推定:` でもない口（`実測できず: …` のような書き方）。
      前方一致で `実測` として扱わず、未確認として数える。
      機械のチェック（[`evidence.md`](evidence.md)「抜けを数える」）も同じ 3 つの条件で数えるので、ここを外すと、人の導出とツールで判定が分かれる

    「セルが空でない」「`推定` が 1 つも無い」を、すべての口が実測済みである根拠にしない。
    よくあるのは、`GET → 実測` の 1 エントリだけで、`PATCH` / `DELETE` の根拠が無いセルである。
    集合の差分を取らずに `推定` の有無だけを見ると、その 2 つの口が報告から外れ、「決まっている形」として下流に渡る。
    同じ理由で、行に 1 つでも `実測` があることを根拠に、行ごと除外しない。
    採番は特性化より先に行うので、この列はまだ測っていない画面についても埋まっている。
    未確認の口は、実装のほぼ最後まで「決まっている形」として読まれる（着手するときに確定すべき口が残っている、という意味である）。
    列そのものが無い features.md では、「要求単位の根拠が未導出（テンプレートを更新する前の features.md）」と報告する。列が無いことを「すべて実測済み」と読まない。
    空欄のセルと、口に対応づかないエントリだけのセルは、その行のすべての口を未確認として数える（`実測` として扱わない）

    並べた口は、さらに「まだ着手していないので推定のまま」と「着手済みなのに未確定のまま」に分けて示す。
    前者は、採番が特性化より先に行われる以上、正常な状態である。後者は、書き戻しか未測定の宣言が抜けていることを示す。
    同じ `推定` でも、読む人が次にすることが違う。
    分け方は、その slug の成果物がどの段階まで進んだかと、`unmeasured` の宣言で決める（口の単位で見る）。
    - `.replace/parity/<slug>/metadata.json` が無い（特性化の前）なら、まだ着手していない
    - 特性化済み、または `new/<target>/replace-metadata.json` の `suite.new_green: true` なのに `推定` が残る場合は、次のように分ける。
      - その口が `metadata.json` の `unmeasured.entries` に宣言されていれば、「未測定として宣言済み」とする（`disposition` を添える）
      - 宣言として認めるのは、`entries[].endpoint` が口と文字単位で一致する要素だけである。`item` の文章に口が含まれるだけのものは数えない。部分一致にすると、別の口が宣言済みと誤って判定される
      - `declared: false` の成果物は、`entries` を読まない。`parity-suite` の `artifact-health-check.mjs` がその節を判定しないので、読むと、誰も有効にしていない宣言で「宣言済み」と判定されてしまう。
        機械のチェック（[`evidence.md`](evidence.md)「抜けを数える」）も同じ規則なので、ここを緩めると、人の導出とツールで判定が分かれる
      - 宣言も無ければ、「書き戻しの抜けの疑い」として名前を挙げる。
        確定したのに `replace-strategy evidence` を通していないか、確定できなかったのに宣言していないかのどちらかである。
        どちらも放っておくと、`status` がその口をいつまでも未確認として報告し続ける（書き戻しの方法の原本は [`evidence.md`](evidence.md)）
    - `unmeasured` をキーごと持たない成果物（旧版の `parity-suite`）は、「宣言ゼロ」として扱い、未確認の口を書き戻しの抜けの疑いとして名前を挙げる。
      機械のチェックと同じ規則である（原本は [`evidence.md`](evidence.md)「抜けを数える」）

    同じ判定は、slug ごとに機械可読で取れる。`node <skill>/scripts/evidence-gap-check.mjs --features .replace/features.md --slug <slug>` を使う。
    - `--unmeasured .replace/parity/<slug>/metadata.json` を付けるのは、そのファイルがあるときだけにする。
      特性化の前の slug には無く、渡すと読めずに exit 2 で失敗し、`measured:` の行が 1 行も出ない（採番した直後は、ほとんどの slug がこれに当たる）
    - 省いて実行すると宣言を考えないので、未確認の口をそのまま並べる（上の「まだ着手していない推定」の一覧になる）
    - exit は、1 = 未宣言の未確認の口がある、2 = 入力の不備、3 = 判定不能、4 = 対象外（バッチ・「その他の Issue」の行は口を持たない）である

    手順の原本は [`evidence.md`](evidence.md) にある。セルを目で数えず、このツールの `measured:` 行を根拠にする

12. 受け入れ条件に現れない行。インベントリのすべての行の slug を母集合にする（機能一覧・横断 API・バッチ・その他の Issue と、`.replace/components.md` があれば部品一覧）。
    記録された Issue 番号の本文の受け入れ条件が引き受けていると読める slug を、引き受け集合にする。
    この差分を取り、どの Issue にも引き受けられていない行を、未検証の領域として並べる
    （導出の原本は [`features-issues.md`](features-issues.md)「起票の後に行と受け入れ条件を突き合わせる」）。
    - 出てきただけで数えない。除外や参照だけの言及は引き受けにせず、引き受けかどうか判断できない項は引き受けとして扱わずに `未対応` として挙げる
    - 行の引き受けに加えて、部分の集合の差分も取り、含まれない部分を挙げる。部分は、その Issue が作るものと比べるものの単位だけである。
      機能行はページ ＋ 新規実装 API の口 ＋ 比較の対象の副作用出力、横断 API の行は口、バッチの行は比較する出力、部品行はインスタンスである。
      参照テーブルとバッチの入力は `golden-dataset` が投入する側なので入れない。「その他の Issue」表の行は部分を持たないので、対象外である。
      全体を含むと述べている項があれば、その軸は引き受け済みとして数える
    - 本文は、「Issue 状態の取得」で取得したのと同じ番号の集合について、番号ごとに `--jq '.body'` で別に取得する（本文は複数行なので、状態を取得する TSV の行には含めない）
    - 取得できなかった番号は判定不能として残し、その番号を記録した行は落ちた行に数えない。落ちた行 0 件は、すべての番号の本文を取得できたときだけ結論にする
    - slug の照合は完全一致で取る。`order` と `order-export` のように、一方が他方の部分文字列になる slug を、引き受け済みと誤って判定しない
    - 消費側の呼び出しの項に出てくるリソース slug は、引き受け集合に入れない（引き受ける行ではないため。原本は上のリンク先）
    - 横断 API の fan-out に挙がった消費側の機能 Issue に、「この機能から `<リソース slug>` を呼ぶ」項が無いものを、呼び出しが届いていない状態（`呼び出し未達`）として並べる。
      消費側の行が複数の Issue に散っているときは、1 つの Issue に呼び出しの項があることを、行全体の根拠にしない
    - 消費側が未起票か、本文を取得できない場合は、呼び出しが届いていない状態に数えず、未起票／判定不能として別に示す

    落ちた行も届いていない呼び出しも、症状は「緑」で、どの Issue の完了の条件にもならない。
    features.md の「受け入れ条件」列は読まない。この列は突き合わせの出力（転記した値）で、本文が後で書き換わると警告なしに古くなる（「状態」列と同じ理由）。

    あわせて、次の 2 つの状態を要確認として挙げる。
    - 同じ slug を、2 つ以上の Issue が引き受けている状態（本文の受け入れ条件に、同じ行が引き受ける形で現れる）。
      本文が後で書き換わると起きるので、毎回本文から取得し直すこのモードでなければ検出できない
    - 同じ Issue 番号が、2 つ以上の行の Issue 列に入っている状態（features.md の機能・横断 API・バッチと、components.md の部品一覧。ファイルをまたいだ共有も数える）。
      引き受けの差分には出ないが、下流は slug ごとにその番号で着手するので、2 行が同じブランチ・PR にまとめられる

    未起票の行は落ちた行に数えず、未起票として示す。まだ起票していないので、引き受けが無いのは当然である。
    ただし、起票済みの行と一緒にすると、他の行に吸収されたつもりの候補が未着手の中に埋もれる。
    Issue 番号が 1 つも無い（すべての行が未起票の）インベントリでは、「起票の前なので未導出」として報告し、落ちた行 0 件と書かない

13. 部品の洗い出しの未決。`.replace/dependencies.md` の一覧から、`状態` が `有効` で、`決定` が `未確認` / `機能固有` / `内蔵` の行を、着手前の確認事項として並べる
    （値の意味と引き取り手の原本は [`dependency-selection.md`](dependency-selection.md)「洗い出しの 6 値」）。
    - `未確認` は、未検証の領域として数える。確かめられていない種類は、その部品が要る機能を実装するまで誰も見ない。「理由・引き取り手」列の「確かめるのに要る条件」を添える
    - `機能固有` は、「適用範囲」列の機能の `parity-replace` が、実装のフェーズの前に決める予定として示す（未決だが、引き取り手は決まっている）
    - `内蔵` は、「採用したもの」列のパッケージが、同じ台帳で `パッケージ採用` の `有効` な行として決まっているかを突き合わせる。
      決定が無い・取り消されている内蔵は、要確認として挙げる（誰も実装しない部品が残るため）
    - 同じ `部品（用途）` で `有効` の行が 2 つある状態も、要確認として挙げる（どちらが今の決定かを、台帳から決められない）
    - 行はあるのに `有効` が 1 つも無い部品も、要確認として挙げる。決定を覆したときの追記を飛ばした形である。
      `状態` は、その場での更新を許される唯一の列なので、追記専用のチェックを通り、読む側には「行が無い」のと区別がつかない。
      「まだ見ていない」ではなく、「今の決定が失われている」として報告する

    ファイルが無ければ、「部品の洗い出しが未実施（`setup` 手順 10 が未実施）」と報告する。無いことを「部品が無い」と読まない。
    `状態` 列が無い台帳（この値を入れる前に作られたもの）は、すべての行を `有効` として読み、`決定` 列に 6 つの値以外があれば要確認として挙げる
    （原本は [`dependency-selection.md`](dependency-selection.md)「列が無い台帳を読んだとき」）

14. 旧手順で閉じた機能。確かめる軸を足した変更（`parity-suite` の手順の改訂と、`.replace/procedure-changes.md` の「観点の追加」）より前に特性化を終えた機能のうち、
    当て直しの判断が無いものと見直し中のものを、変更（足した軸・見直しの置き場）ごとに並べる。
    データセットのバージョンが古くなったときと同じく「要再確認」として扱い、Issue が closed でも、`parity-diff` が収束済みでも出す。
    軸を足す前の手順で閉じたことは、どのチェックも失敗にしないからである。
    - 導出は、同梱の [`scripts/procedure-staleness-check.mjs`](../scripts/procedure-staleness-check.mjs) で行い、成果物を目で比べない
      （手順・終了コードの原本は [`procedure-changes.md`](procedure-changes.md)「チェック」）
    - `--revisions` には、インストール済みの `parity-suite` の `assets/procedure-revisions.json` を渡す（プロジェクトにコピーしない）
    - 結果は次のように書き分け、どれも 0 件にまとめない。
      `unresolved` は未解決、`undeterminable`（exit 3）は「対象かどうかを判定できない」、exit 4 は「特性化を終えた機能が無く、判定の対象が無い」である。
      exit 2 は「入力を読めない（台帳の不整合・改訂の一覧や成果物の置き場を読めない）」で、stderr か `errors` の内容を添える
    - `run.procedure_revision` を持たない成果物は、改訂番号を入れる前のものなので、すべての改訂の対象として出る（旧版の `parity-suite` の成果物。判断を台帳に記録すれば消える）
15. 現行の弱点の未決と、露出の拡大。`.replace/weaknesses.md` の `状態` が `有効` の行から、次の行を並べる（形式の原本は [`security.md`](security.md)「現行の弱点の仕分け」）。
    - 仕分けが空欄の行（`該当なし` は未決ではない）
    - `引き継ぐ` に仕分けたもので、基準 3 が「否」（直すと仕様が変わる）なのに、扱う設計作業が空欄か「-」の行
    - 「露出を広げた差異」が、空欄でも「-」でもない行

    ファイルが無ければ、「現行の弱点が未仕分け（`setup` 手順 8 が未実施）」と報告する。無いことを「弱点が無い」と読まない。
    あわせて、`.replace/response-headers.json` の次のものを並べる。
    - `responses` に `static` か `not-found` を含むのに、`owner_slug` が `null` の行（機能の応答にだけ付く行は、`null` が正しい）
    - `setter` が `unknown` の行
    - `server_config_slug` が `null`

    ファイルが無いか `status: unmeasured` なら、「横断の応答ヘッダーが未測定」と報告する。
    7 節が表のままの `survey.md` しか無いなら、「一覧が旧形式（表）で、`parity-suite` に読まれない。測定の 7 をやり直して JSON に移す」と報告する。表を読んで並べない

## 報告

- 次の順で示す。
  1. 判断待ちの保留（人が答えれば進む工程があるので、先頭に示す）
  2. その他の Issue（4 種以外）の状態（他の Issue の前提になることがあるので、先に示す）
  3. 機能 × 状態の表
  4. 他の機能を待っている差分と、解けた差分の一覧
  5. 旧手順で閉じた機能
  6. 未検証の領域の一覧
  7. 影響範囲
- 「Issue が closed」と「検証済み」は別である。closed でも、`gaps.md` に残る未検証の領域は、未検証として報告する
- 数（機能の数・gaps の件数）は、一部だけを見たものではなく、すべてを出力したもので数える
