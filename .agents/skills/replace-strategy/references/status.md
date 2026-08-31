# status モード

Issue の状態とリポジトリ内の成果物から現況を導出する。**自前の状態を持たず毎回導出する**（ブランチのマージ後でも動くようにするため）。

## 入力

| 情報源 | 読むもの |
|---|---|
| `.replace/features.md` | 機能・横断 API・バッチ・その他の Issue（4 種以外）の一覧、slug、fan-out、ページ一覧（ページ × 乗る機能）、Issue 番号 |
| GitHub Issue | 各 Issue の open/closed（下記のとおりページネーションを処理する） |
| `.replace/parity/<slug>/strength.md` | パリティスイートの強度（捕捉した故障種別・素通り＝弱点・未検証種別。`parity-suite` が生成） |
| `.replace/parity/<slug>/gaps.md` | 未検証領域（特性化できなかった箇所・hermetic でないテスト・スコープ外の副作用。同上） |
| `.replace/parity/<slug>/metadata.json` | 取得時のゴールデンデータセットバージョン・対象コミット（同上） |
| `.replace/parity/<slug>/component-diff-exceptions.json` | 承認済みインスタンス例外の規模（`component_diff_exception_causes[]` の原因数と `component_diff_exceptions[]` のインスタンス数。`parity-diff` が生成。スキーマ正本は同スキル）。環境非依存のため slug 直下に 1 つ |
| `.replace/parity/<slug>/new/<target>/replace-metadata.json` | 新側の green 証跡（`suite.new_green`・`verification.passed_at`）と差し戻しループの状態（`loop.iterations` / `loop.max_iterations` / `loop.last_diff_report`）（`parity-replace` が生成。スキーマ正本は同スキル）。新側成果物は環境別のため target ごとに存在しうる |
| `.replace/parity/<slug>/new/<target>/diff.md` | 検出した差分と分類（要対応／許容／環境ノイズ）・根拠（`parity-diff` が生成。スキーマ正本は同スキル）。新側成果物は環境別のため target ごとに存在しうる |
| `.replace/parity/<slug>/new/<target>/diff-metadata.json` | 収束判定の機械可読値（`converged`・`results`）と他機能待ちの帰属（`blocked_by[]`）（`parity-diff` が生成。スキーマ正本は同スキル）。同上 |
| `.replace/dataset/metadata.json` | 現在のデータセットバージョン（`version`）、版ごとの影響範囲（`changes[].affects`。テーブル名、`dataset_mode: static` では静的データ単位）、新側投入記録（`phase_b.<slug>.<target>`。target 別）（`golden-dataset` が生成） |
| `.replace/dataset/verification.md` | 「意味論が未確定の機能」（`current.origin: received-assets` のときだけ。`golden-dataset` が生成。スキーマ正本は同スキル） |
| `.replace/bootstrap/metadata.json` | 現行環境の再構築の状態（`status` / `blocked_on` / `semantics.pending_features`）（`current-environment-bootstrap` が生成。スキーマ正本は同スキル。`received-assets` のときだけ） |

成果物のスキーマ正本は各生産スキルにある。ファイルが無い場合は「未着手」として扱う（エラーにしない）。
ただし `.replace/features.md` 自体が無い場合は `setup` 未実施として報告し、`setup` の実行を案内する（以降の導出は行わない）。

## Issue 状態の取得

features.md に記録された Issue 番号だけを個別取得する（リポジトリの全 Issue 一覧を取らない。対象は既知の番号なので全件走査は不要）:

```bash
# <numbers> は features.md から抽出した Issue 番号の一覧
for n in $NUMBERS; do
  gh api "repos/$OWNER/$REPO/issues/$n" --jq '[.number, .state, .title] | @tsv'
done
```

番号を列挙できない取得（横断的な検索等）を行う場合は、指定件数で打ち切らずページネーションを処理する（REST は `--paginate`、GraphQL は `pageInfo`/`endCursor` ＋ `--paginate`）。

## 導出する内容

1. **機能ごとの現況表**: slug ごとに、Issue 状態（未起票／open／closed）、パリティスイートの有無と強度（`strength.md` の弱点・未検証種別を含む）、ベースラインの有無、
   データセットバージョンの陳腐化（ベースラインの `dataset_version` より後の `changes[].affects` と、その slug の実効参照テーブルが交差するときだけ「要再取得」。実効参照テーブルと fail-closed 条件の正本は `golden-dataset` の `references/versioning.md`）、
   フェーズ B の状態（**`new/<target>/` が存在する target**〈`diff.md` の有無は問わない——差分検出前でも新側データは要る〉に対応する `phase_b.<slug>.<target>` が無ければ「その環境でフェーズ B 未実施の疑い」、
   `phase_b.<slug>.<target>.dataset_version` より後の変更がその slug に影響するなら「その環境の新側データが陳腐化・要再投入」。数値が古くても影響変更が無ければ再投入不要として記録 version は書き換えない。
   ただし**投入対象でない target は対象にしない**——`dataset_mode: db`（既定）では `db` 未定義の target と、`db.env_vars` はあるが `seedable` が無い読み取り専用の target が該当する。
   `dataset_mode: static` では**全 target が投入対象**なので免除は起きず、どの target もフェーズ B の状態を見る〈契約の正本は [`project-config.md`](project-config.md)〉）、
   新側の到達点（`replace-metadata.json` の `suite.new_green` が true なのに `new/<target>/diff.md` が無ければ「**green 済み・差分検出は未実施**」として区別する。`parity-diff` の未実行が「未着手」に埋もれるのを防ぐ）、
   差し戻しループの状態（`loop.iterations` と `loop.max_iterations`。1 以上で未収束なら「往復中（n 反復目）」、`loop.iterations` が `max_iterations` に達していれば「上限到達・人手の判断待ち」）、
   `parity-diff` の進捗（`new/<target>/diff.md` の分類を集計した「要対応」の残数。収束判定そのものは `parity-diff` が担い、本モードは集計値の報告に留める）。
   **新側の進捗は target（環境）ごとに分かれる**ため、同じ slug でも環境別に状態を示す（例: local-dev は収束済み・preview は未実施）。`new/` 配下に無い target は「その環境では未実施」として扱う
2. **他機能待ちの解除検出**: `diff-metadata.json` の `blocked_by[]` を全 slug × target で集め、**依存先が同じ target で新側 green（`new/<target>/replace-metadata.json` の `suite.new_green` が true）になっているものを列挙する**。
   これは「依存先が実装されたので依存元の `parity-diff` を再実行すれば解消しうる差分」であり、**再判定のトリガーは本モードが持つ**（`parity-replace` は自分が green にした機能の依存元を知らない）。
   依存先がまだ green でない `blocked_by` は「他機能待ちで停止中（依存先 slug と Issue）」として報告する——`converged: false` を「往復中」と混同しない
3. **未検証領域と許容した差分の一覧**: 全 slug の `gaps.md` を集約する。
   **`current.origin: received-assets` では、`.replace/dataset/verification.md` の「意味論が未確定の機能」（無ければ `.replace/bootstrap/metadata.json` の `semantics.pending_features`）も併せて集約し、
   「意味論の確認待ちで開始できない」機能を未着手と区別して示す**——スイートを持たないことは同じでも、待っているものが違う（前者は質問票の回答、後者は着手）。スコープ外にした副作用（メール・外部連携）・hermetic でないテスト・データ不足も含め、**対象外にした事実を隠さない**。切替判断の材料として提示する。
   合わせて `component-diff-exceptions.json` の**原因数とインスタンス数**を slug ごとに示す——承認済みで説明済みではあるが、**インスタンス件数は検証の弱さのシグナル**である
   （件数を畳んで隠さない契約なので、原因数ではなくインスタンス数もそのまま数えて報告する）
4. **横断 API の影響範囲**: 横断 API に手が入ったら利用側の全機能を再検証する必要がある。features.md の fan-out から「このリソースを使う機能一覧」を導出し、横断 API Issue の状態変化（再オープン・変更）に対して**再検証が必要な機能**を列挙する
5. **その他の Issue（4 種以外）の状態**: 「その他の Issue」表の各行について、Issue 状態（未起票／open／closed）と依存順・影響範囲を報告する。
   **`.replace/parity/<slug>/` の成果物は持たない**ため、スイート強度・ベースライン・フェーズ B・差分の列は導出せず「対象外」として示す（未着手と混同しない）。
   **依存順が「先頭」等で他の Issue の前提になっている行が open のまま**なら、それを前提とする Issue が進行中であることを併せて示す。
   **節が「なし」（該当が無いと明記）なら「該当なし」として報告する**。節そのものが features.md に無い場合だけ「その他の Issue が未導出（テンプレート更新前の features.md）」として報告する——**節の不在を「該当なし」と読まない**
6. **ページ単位の在席**: features.md のページ一覧から**複数機能が乗るページ**を抽出し、そのうち新側で未実装の機能（当該 slug の `new/<target>/replace-metadata.json` が無い、または `suite.new_green` でない）を列挙する。
   **在席チェックがスキップされたままの範囲**であり、そのページでセクションが丸ごと欠けていてもどのスイートも赤くならない（環境ごとに分かれる）。ページ一覧を持たない features.md では「在席が未導出」として報告する

## 報告

- **その他の Issue（4 種以外）の状態**＋機能 × 状態の表＋**他機能待ちと解除済みの一覧**＋未検証領域の一覧＋影響範囲、の順で提示する（その他の Issue は他の Issue の前提になりうるため先に示す）
- 「Issue が closed」と「検証済み」は別。closed でも `gaps.md` に残る未検証領域は未検証として報告する
- 数（機能数・gaps 件数）は部分ビューではなく完全出力で数える
