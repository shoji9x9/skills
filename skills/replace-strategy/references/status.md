# status モード

Issue の状態とリポジトリ内の成果物から現況を導出する。**自前の状態を持たず毎回導出する**（ブランチのマージ後でも動くようにするため）。

## 入力

| 情報源 | 読むもの |
|---|---|
| `.replace/features.md` | 機能・横断 API・バッチ・その他の Issue（4 種以外）の一覧、slug、fan-out、ページ一覧（ページ × 乗る機能）、ページ要素の帰属（要素 × 配置の所有者 slug）、**API の「要求単位の根拠」列（`実測` / `推定`）**、Issue 番号（**番号だけ。旧版テンプレート由来の「状態」列と、突き合わせの出力である「受け入れ条件」列は読まない**——下記「Issue 状態の取得」「導出する内容」12） |
| `.replace/components.md` | 共通部品の一覧、slug、インスタンス、データ依存の有無、採否、Issue 番号（**画面より先に部品を作る方針のときだけ存在する。無いのは未着手ではなく「この方針を採っていない」**——`setup` 未実施として報告しない） |
| `.replace/assets.md` | 静的資産の種類ごとの方針（空欄＝未決）と未走査・未確認の記録（`replace-strategy` の `setup` が作る。形式の正本は [`static-assets.md`](static-assets.md)。**無いのは本工程の導入前に `setup` を終えたプロジェクト**——`setup` 未実施として報告しない） |
| GitHub Issue | 各 Issue の open/closed（下記のとおりページネーションを処理する） |
| `.replace/components/<slug>/metadata.json` | 部品の採取の状態（`capture.complete`・`axes.ok`・`capture_gaps`）と基準の陳腐化判定材料（`dataset_version`・`target.name`）（`parity-component` が生成。スキーマ正本は同スキル） |
| `.replace/components/<slug>/new/<target>/build-metadata.json` | 部品の実装・照合の証跡（`parity.unexplained`・`parity.missing_stories`・`verification`・`loop`）（同上）。新側成果物は環境別のため target ごとに存在しうる |
| `.replace/parity/<slug>/strength.md` | パリティスイートの強度（捕捉した故障種別・素通り＝弱点・未検証種別。`parity-suite` が生成） |
| `.replace/parity/<slug>/gaps.md` | 未検証領域（特性化できなかった箇所・hermetic でないテスト・スコープ外の副作用。同上） |
| `.replace/parity/<slug>/metadata.json` | 取得時のゴールデンデータセットバージョン・対象コミット・部品被覆表の宣言（`component_coverage`。キーごと無ければ旧成果物）・反応の被覆表の宣言（`reaction_coverage`。同）（同上） |
| `.replace/parity/<slug>/component-coverage.json` | 部品被覆表（項目 × 部品インスタンス〈ページ〉の 3 値。被覆プロファイルを宣言した部品ではインスタンスごとの候補が期待セル。`parity-suite` が生成。スキーマ・プロファイルの正本は同スキル）。現側の測定結果のため slug 直下に 1 つ |
| `.replace/parity/<slug>/component-diff-exceptions.json` | 承認済みインスタンス例外の規模（`component_diff_exception_causes[]` の原因数と `component_diff_exceptions[]` のインスタンス数。`parity-diff` が生成。スキーマ正本は同スキル）。環境非依存のため slug 直下に 1 つ |
| `.replace/parity/<slug>/new/<target>/replace-metadata.json` | 新側の green 証跡（`suite.new_green`・`verification.passed_at`）と差し戻しループの状態（`loop.iterations` / `loop.max_iterations` / `loop.last_diff_report`）（`parity-replace` が生成。スキーマ正本は同スキル）。新側成果物は環境別のため target ごとに存在しうる |
| `.replace/parity/<slug>/new/<target>/diff.md` | 検出した差分と分類（要対応／許容／環境ノイズ）・根拠（`parity-diff` が生成。スキーマ正本は同スキル）。新側成果物は環境別のため target ごとに存在しうる |
| `.replace/parity/<slug>/new/<target>/diff-metadata.json` | 収束判定の機械可読値（`converged`・`results`・`component_coverage`・`reaction_coverage`・`intentional_diffs_pending`）と他機能待ちの帰属（`blocked_by[]`）（`parity-diff` が生成。スキーマ正本は同スキル）。同上 |
| `.replace/dataset/metadata.json` | 現在のデータセットバージョン（`version`）、版ごとの影響範囲（`changes[].affects`。テーブル名、`dataset_mode: static` では静的データ単位）、新側投入記録（`phase_b.<slug>.<target>`。target 別）（`golden-dataset` が生成） |
| `.replace/dataset/verification.md` | 「意味論が未確定の機能」（`current.origin: received-assets` のときだけ。`golden-dataset` が生成。スキーマ正本は同スキル） |
| `.replace/bootstrap/metadata.json` | 現行環境の再構築の状態（`status` / `blocked_on` / `semantics.pending_features`）（`current-environment-bootstrap` が生成。スキーマ正本は同スキル。`received-assets` のときだけ） |
| 上記の各 JSON 成果物・`.replace/dataset/pending-decisions.json`・`.replace/parity/<slug>/pending-decisions.json`・`.replace/parity/<slug>/new/<target>/pending-decisions.json`・`.replace/strategy-pending.json` | 自律実行（`--autonomous`）で人の判断待ちにした保留（`pending_decisions[]`。形の正本は [`autonomy.md`](autonomy.md)「記録の形」）。`.replace/strategy-pending.json` は `replace-strategy` 自身が自律実行したときだけ存在する |

成果物のスキーマ正本は各生産スキルにある。ファイルが無い場合は「未着手」として扱う（エラーにしない）。
ただし `.replace/features.md` 自体が無い場合は `setup` 未実施として報告し、`setup` の実行を案内する（以降の導出は行わない）。
**この場合も先に `.replace/strategy-pending.json` と `.replace/bootstrap/metadata.json` の未解決の保留（下記「導出する内容」9）を集めて報告する**——
`setup --autonomous` は `features.md` を書く前に保留で止まることがあり、そのとき `setup` を続ける手がかりはこの保留だけにある

## Issue 状態の取得

features.md と、**`.replace/components.md` があればその「部品一覧」表**に記録された Issue 番号だけを個別取得する（リポジトリの全 Issue 一覧を取らない。対象は既知の番号なので全件走査は不要）。
**部品の番号も同じ集合に入れる**——共通部品 Issue の番号は `components.md` にしか無いので、features.md だけから集めると「共通部品の現況」（下記 7）の Issue 状態が常に判定不能になる。
`components.md` が無いプロジェクトでは features.md の番号だけで取得する（部品の方針を採っていないだけで、取得漏れではない）:

```bash
# $NUMBERS は features.md（と、あれば components.md の部品一覧表）から抽出した Issue 番号の一覧。**`#` を外した数字だけ**にする
# （features.md は `#103` の形で記録するため、そのまま渡すとパスが `issues/#103` になり
#  404 で全件が判定不能に化ける。取得失敗と表記ミスが同じ出力になり区別できない）
for n in $NUMBERS; do
  # 取得できた番号だけ行が出る作りにすると、失敗した番号が出力から黙って消える
  # （gh のエラーは番号を含まない）。失敗も 1 行として残し、後段で「判定不能」に落とす
  # stderr は握り潰さない（認証切れ・404 の別を残す）
  if row="$(gh api "repos/$OWNER/$REPO/issues/$n" --jq '[.number, .state, .title] | @tsv')"; then
    printf '%s\n' "$row"
  else
    # 成功行と同じ 3 列に揃える（列数が揺れると後段が判定不能行を落とす）
    printf '%s\t判定不能\t-\n' "$n"
  fi
done
```

番号を列挙できない取得（横断的な検索等）を行う場合は、指定件数で打ち切らずページネーションを処理する（REST は `--paginate`、GraphQL は `pageInfo`/`endCursor` ＋ `--paginate`）。

**状態はこの問い合わせだけを根拠にする。** features.md に「状態」列（旧版テンプレート由来）があっても読まない——写しは閉じたときに更新されず黙って古くなる（正本は [`features-issues.md`](features-issues.md)「Issue の状態は写さない」）。

**取得できなかった番号は `判定不能` として報告する**（`gh` が使えない・認証が無い・番号が存在しない等）。open とも closed とも仮定せず、features.md の記述で代替しない。
取得失敗を closed に倒すと「終わった」と読め、open に倒すと未着手の山に紛れる——どちらも取得できていない事実が消える。**取得できた分の導出は続け、判定不能の番号を一覧で示す**。

## 導出する内容

1. **機能ごとの現況表**: slug ごとに、Issue 状態（未起票／open／closed／判定不能）、パリティスイートの有無と強度（`strength.md` の弱点・未検証種別を含む）、ベースラインの有無、
   データセットバージョンの陳腐化（ベースラインの `dataset_version` より後の `changes[].affects` と、その slug の実効参照テーブルが交差するときだけ「要再取得」。実効参照テーブルと fail-closed 条件の正本は `golden-dataset` の `references/versioning.md`）、
   フェーズ B の状態（**`new/<target>/` が存在する target**〈`diff.md` の有無は問わない——差分検出前でも新側データは要る〉に対応する `phase_b.<slug>.<target>` が無ければ「その環境でフェーズ B 未実施の疑い」、
   `phase_b.<slug>.<target>.dataset_version` より後の変更がその slug に影響するなら「その環境の新側データが陳腐化・要再投入」。数値が古くても影響変更が無ければ再投入不要として記録 version は書き換えない。
   ただし**投入対象でない target は対象にしない**——`dataset_mode: db`（既定）では `db` 未定義の target と、`db.env_vars` はあるが `seedable` が無い読み取り専用の target が該当する。
   `dataset_mode: static` では**全 target が投入対象**なので免除は起きず、どの target もフェーズ B の状態を見る〈契約の正本は [`project-config.md`](project-config.md)〉）、
   新側の到達点（`replace-metadata.json` の `suite.new_green` が true なのに `new/<target>/diff.md` が無ければ「**green 済み・差分検出は未実施**」として区別する。`parity-diff` の未実行が「未着手」に埋もれるのを防ぐ。
   同じ判定を機械可読で取るなら `parity-suite` の `scripts/artifact-health-check.mjs --metadata <現側 metadata.json> --target <target> --stage diff` を使う——`diff-metadata.json` の**不在と鮮度**まで見る）、
   差し戻しループの状態（`loop.iterations` と `loop.max_iterations`。1 以上で未収束なら「往復中（n 反復目）」、`loop.iterations` が `max_iterations` に達していれば「上限到達・人手の判断待ち」）、
   `parity-diff` の進捗（`new/<target>/diff.md` の分類を集計した「要対応」の残数。収束判定そのものは `parity-diff` が担い、本モードは集計値の報告に留める）。
   **新側の進捗は target（環境）ごとに分かれる**ため、同じ slug でも環境別に状態を示す（例: local-dev は収束済み・preview は未実施）。`new/` 配下に無い target は「その環境では未実施」として扱う
2. **他機能待ちの解除検出**: `diff-metadata.json` の `blocked_by[]` を全 slug × target で集め、**依存先が同じ target で新側 green（`new/<target>/replace-metadata.json` の `suite.new_green` が true）になっているものを列挙する**。
   これは「依存先が実装されたので依存元の `parity-diff` を再実行すれば解消しうる差分」であり、**再判定のトリガーは本モードが持つ**（`parity-replace` は自分が green にした機能の依存元を知らない）。
   依存先がまだ green でない `blocked_by` は「他機能待ちで停止中（依存先 slug と Issue）」として報告する——`converged: false` を「往復中」と混同しない
3. **未検証領域と許容した差分の一覧**: 全 slug の `gaps.md` を集約する。
   **`current.origin: received-assets` では、`.replace/dataset/verification.md` の「意味論が未確定の機能」（無ければ `.replace/bootstrap/metadata.json` の `semantics.pending_features`）も併せて集約し、
   「意味論の確認待ちで開始できない」機能を未着手と区別して示す**——スイートを持たないことは同じでも、待っているものが違う（前者は質問票の回答、後者は着手）。スコープ外にした副作用（メール・外部連携）・hermetic でないテスト・データ不足も含め、**対象外にした事実を隠さない**。切替判断の材料として提示する。
   合わせて**部品被覆表の状態**を slug ごとに示す——`metadata.json.component_coverage` が `declared: true` なら未測定セル数（測っていない部品の操作は差分ゼロとして通るため未検証領域）を、
   `diff-metadata.json.component_coverage.unmeasured` から取る（`parity-diff` を実行済みの target のもの）。**`component-coverage.json` の `value: unmeasured` 行を目視で数えず、`metadata.json` の宣言値も転記しない**
   （行が無い組み合わせ・`evidence` が空・`present` なのに `covered_by` が空・重複行も未測定であり、目視の行数え・宣言値はいずれも少なく出る。数え方の正本は `parity-suite` の `references/coverage.md`）。
   **どの target でも `parity-diff` 未実行なら「未測定数は未算出（`parity-diff` の実行で確定する）」と報告する**——本モードは自前で数えない（数え直しは `parity-diff` 同梱ツールの担当で、本スキル単体では到達できない）、
   `declared: false` ならその理由、**キーごと無ければ「被覆表が未導出（旧版 `parity-suite` の成果物）」**として区別する（`declared: false` と混同しない）。
   **反応の被覆表も同じ形で示す**——未測定の操作数は `diff-metadata.json.reaction_coverage.unmeasured_operations` から取り（`reactions.json` を目視で数えない）、`parity-diff` 未実行なら未算出、`declared: false` ならその理由、キーごと無ければ旧成果物として区別する。
   合わせて `component-diff-exceptions.json` の**原因数とインスタンス数**を slug ごとに示す——承認済みで説明済みではあるが、**インスタンス件数は検証の弱さのシグナル**である
   （件数を畳んで隠さない契約なので、原因数ではなくインスタンス数もそのまま数えて報告する）
   合わせて**意図的差異の保留（`intentional_diffs.pending`）の滞留**を示す——設定ファイルの `pending` を全件数え、`slug` ごとの内訳（機能に帰属 / `cross-cutting` / 帰属不明）と**最も古い `added_at`** を報告する。
   保留は機能をまたいで積み上がるため、**件数と滞留期間が「判断の先送り」のシグナル**になる（棚卸しを要求するのは `parity-diff` の収束判定で、本モードは横断の集計に留める。要素の形の正本は [`project-config.md`](project-config.md)「`pending` 要素の形」）。
   **素の文字列の要素は帰属不明として数え、`added_at` が読めないことも report する**（黙って 0 件へ丸めない）
   合わせて**未測定の機械可読な宣言**を示す——`metadata.json.unmeasured` が `declared: true` なら `disposition: blocking` の件数を
   （`parity-diff` はこれが 1 件でも残る間は収束させない。数え直しは `parity-suite` の `scripts/artifact-health-check.mjs`）、
   `declared: false` ならその理由、**キーごと無ければ「未測定が未宣言（旧版 `parity-suite` の成果物で、`gaps.md` の散文しか無い）」**として区別する
   （`gaps.md` の散文は人向けの説明であって収束判定の入力ではない。正本は `parity-suite` の `references/coverage.md`「未測定を機械可読にする」）。
   **`gaps.md` の行を目視で数えて blocking 件数の代わりにしない**——散文には承認済みの未検証も測るべき未測定も混ざっている
4. **横断 API の影響範囲**: 横断 API に手が入ったら利用側の全機能を再検証する必要がある。features.md の fan-out から「このリソースを使う機能一覧」を導出し、横断 API Issue の状態変化（再オープン・変更）に対して**再検証が必要な機能**を列挙する
5. **その他の Issue（4 種以外）の状態**: 「その他の Issue」表の各行について、Issue 状態（未起票／open／closed／判定不能）と依存順・影響範囲を報告する。
   **`.replace/parity/<slug>/` の成果物は持たない**ため、スイート強度・ベースライン・フェーズ B・差分の列は導出せず「対象外」として示す（未着手と混同しない）。
   **依存順が「先頭」等で他の Issue の前提になっている行が open のまま**なら、それを前提とする Issue が進行中であることを併せて示す。
   **節が「なし」（該当が無いと明記）なら「該当なし」として報告する**。節そのものが features.md に無い場合だけ「その他の Issue が未導出（テンプレート更新前の features.md）」として報告する——**節の不在を「該当なし」と読まない**
6. **ページ単位の在席**: features.md のページ一覧から**複数機能が乗るページ**を抽出し、そのうち新側で未実装の機能（当該 slug の `new/<target>/replace-metadata.json` が無い、または `suite.new_green` でない）を列挙する。
   **在席チェックがスキップされたままの範囲**であり、そのページでセクションが丸ごと欠けていてもどのスイートも赤くならない（環境ごとに分かれる）。ページ一覧を持たない features.md では「在席が未導出」として報告する
7. **共通部品の現況**（`.replace/components.md` があるときだけ）: 部品 slug ごとに、Issue 状態（未起票／open／closed／判定不能）、採取の状態（`metadata.json` の `capture.complete` と `axes.ok`。
   `axes.ok` が false なら「軸の割り出しに未解決の問題あり——採取へ戻す必要がある」）、基準の陳腐化（`dataset_version` より後の `changes[].affects` がその部品の描画に効くデータと交差するとき、および `target.name` が現在の current target と違うとき）、
   照合の到達点（`new/<target>/build-metadata.json` の `parity.unexplained` と `parity.missing_stories`。`missing_stories` が 1 以上なら「見本が足りず未照合の組み合わせがある」）、
   往復の状態（`loop.iterations` と `loop.stopped_reason`）を、**新側は target ごとに**示す。
   **`.replace/components.md` が無いときは「共通部品を先に作る方針を採っていない」と報告し、未着手として数えない**（節の不在を未整備と読まない）。
   合わせて `metadata.json.capture_gaps` の `inaccessible_sheets` / `unresolved_selectors` を未検証領域（項目 3）へ含める——**0 件を「差が無い」の根拠にしない**
8. **ページ要素の帰属**: features.md の「ページ要素の帰属」表から、**配置の所有者が空欄の行**を未検証領域として列挙する——誰も配置しない要素は実装後の `parity-diff` まで説明できない差分として現れないため、着手前の確認事項として示す。
   **節が「なし」（該当が無いと明記）なら「該当なし」として報告する**。節そのものが features.md に無い場合だけ「要素の帰属が未導出（テンプレート更新前の features.md）」として報告する——**節の不在を「該当なし」と読まない**

9. **判断待ちの保留**: 上記の全 JSON 成果物（slug × target を含む）・`pending-decisions.json`・`.replace/strategy-pending.json` から `resolution` が `null` の `pending_decisions[]` を集め、
   成果物のパス・`question`・`blocks`・`raised_at` を**古い順**に列挙する。**保留は「止めている工程がある」ことを表す**ので、`converged: false` の「往復中」や未着手と混同せず区別して示す。
   キーごと無い成果物は自律実行していない（または本ポリシー導入前の）成果物として数えない
10. **静的資産の未決**: `.replace/assets.md` の方針が空欄の行と「未走査・未確認」を、着手前の確認事項として列挙する（未決の種類の資産を使う実装単位は `parity-replace` が進めないため）。
    **ファイルが無ければ「静的資産の方針が未決定（`setup` 手順 11 未実施）」と報告する**——無いことを「資産が無い」と読まない
11. **要求単位が未確認の API**: features.md の機能一覧と横断 API 表について、**行ではなく口の単位で**未検証領域を導出する
    （根拠は口ごとに書かれる。正本は [`features-issues.md`](features-issues.md)「API の形は要求単位を読んでから決める」）。
    **導出は 2 つの集合の差分で行う**——行ごとに「API 列に並ぶ口の集合」と「根拠列のエントリが対応づく口の集合」を作り、次のどちらかに当たる口をすべて列挙する（slug と口を書く）。
    - 根拠が `推定` の口
    - **API 列にあるのに根拠列のどのエントリにも対応づかない口**（根拠が無い＝未確認。`推定` と同じ扱いにする）

    **「セルが空でない」「`推定` が 1 つも無い」を全ての口が実測済みの根拠にしない**——`GET → 実測` の 1 エントリだけで
    `PATCH` / `DELETE` の根拠が無いセルが典型で、集合の差分を取らずに `推定` の有無だけを見ると、その 2 口が報告から落ちて「決まっている形」として下流に渡る。
    同じ理由で、**行に 1 つでも `実測` があることを根拠に行ごと除外しない**。
    採番は特性化より先に来るためこの列は未実測の画面についても埋まっており、未確認の口は**実装のほぼ最後まで「決まっている形」として読まれる**（着手時に確定すべき口が残っている、というシグナル）。
    **列そのものが無い features.md では「要求単位の根拠が未導出（テンプレート更新前の features.md）」と報告する**——列の不在を「全て実測済み」と読まない。
    **空欄のセル、および口に対応づかないエントリだけのセルは、その行の全ての口を未確認として数える**（`実測` に倒さない）

12. **受け入れ条件に現れない行**: インベントリの全行の slug（機能一覧・横断 API・バッチ・その他の Issue と、`.replace/components.md` があれば部品一覧）を母集合に、
    **記録された Issue 番号の本文の受け入れ条件が引き受けていると読める slug** を被覆集合として差分を取り、**どの Issue にも引き受けられていない行**を未検証領域として列挙する
    （**出現だけで数えない**——除外・参照だけの言及は被覆にせず、引き受けか判断できない項は被覆に倒さず未被覆として挙げる。
行の被覆に加えて**部分**〈その Issue が作る・比較する単位だけ。機能行はページ ＋ 新規実装 API の口 ＋ 比較対象の副作用出力、横断 API 行は口、バッチ行は比較する出力、部品行はインスタンス。参照テーブル・バッチの入力は `golden-dataset` が投入する側なので入れない。「その他の Issue」表の行は部分を持たないので対象外〉の集合差分も取り、覆われない部分を挙げる。全体を覆うと述べている項があればその軸は被覆済みに数える）
    （導出の正本は [`features-issues.md`](features-issues.md)「起票の後に行と受け入れ条件を突き合わせる」）。
    本文は「Issue 状態の取得」で引いたのと同じ番号の集合に対して、番号ごとに `--jq '.body'` で別に取る
    （本文は複数行なので状態取得の TSV 行へは混ぜない）。**取得できなかった番号は判定不能として残し、その番号を記録した行は落ちた行に数えない**——
    落ちた行 0 件は全番号の本文を取得できたときだけ結論にする。
    **slug の照合は完全一致で取り**（`order` と `order-export` のように一方が他方の部分文字列になる slug を被覆済みに化けさせない）、
    **消費側の配線の項に現れるリソース slug は被覆集合に入れない**（引き受ける行ではないため。正本は上記リンク先）。
    合わせて**横断 API の fan-out に挙がった消費側の機能 Issue に「この機能から `<リソース slug>` を呼ぶ」項が無いもの**を、落ちた配線として列挙する
    （**消費側の行が複数 Issue に散っているときは、1 つの Issue に配線項があることを行全体の根拠にしない**）。
    **消費側が未起票・本文が取得できない場合は落ちた配線に数えず、未起票／判定不能として別に示す**。
    どちらも**症状が「緑」**で、落ちた機能・落ちた配線はどの Issue のゲートにもならない。
    **features.md の「受け入れ条件」列は読まない**——列は突き合わせの出力（写し）であり、本文が後から書き換われば黙って古くなる（「状態」列と同じ理由）。
    合わせて**同じ slug を 2 つ以上の Issue が引き受けている状態**（本文の受け入れ条件が同じ行を引き受ける形で現れる）と、
    **同じ Issue 番号が 2 つ以上の行の Issue 列に入っている状態**（features.md の機能・横断 API・バッチと components.md の部品一覧。ファイルをまたいだ共有も数える）を要確認として挙げる——
    前者は本文が後から書き換われば起こるので、**毎回本文から取り直す本モードでなければ検出できない**。
    被覆の差分には出ないが、下流は slug ごとにその番号で着手するため 2 行が同じブランチ・PR へ畳まれる。
    **未起票の行は落ちた行に数えず未起票として示す**（まだ起票していないので被覆が無いのは当然。ただし起票済みの行に混ぜると、吸収されたつもりの候補が未着手の山に紛れる）。
    Issue 番号が 1 つも無い（全行が未起票の）インベントリでは「起票前のため未導出」として報告し、落ちた行 0 件と書かない

## 報告

- **判断待ちの保留**（人が答えれば進む工程があるため先頭に示す）＋**その他の Issue（4 種以外）の状態**＋機能 × 状態の表＋**他機能待ちと解除済みの一覧**＋未検証領域の一覧＋影響範囲、の順で提示する（その他の Issue は他の Issue の前提になりうるため先に示す）
- 「Issue が closed」と「検証済み」は別。closed でも `gaps.md` に残る未検証領域は未検証として報告する
- 数（機能数・gaps 件数）は部分ビューではなく完全出力で数える
