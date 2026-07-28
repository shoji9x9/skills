# status モード

Issue の状態とリポジトリ内の成果物から現況を導出する。**自前の状態を持たず毎回導出する**（ブランチのマージ後でも動くようにするため）。

## 入力

| 情報源 | 読むもの |
|---|---|
| `.replace/features.md` | 機能・横断 API・バッチの一覧、slug、fan-out、Issue 番号 |
| GitHub Issue | 各 Issue の open/closed（下記のとおりページネーションを処理する） |
| `.replace/parity/<slug>/strength.md` | パリティスイートの強度（捕捉した故障種別・素通り＝弱点・未検証種別。`parity-suite` が生成） |
| `.replace/parity/<slug>/gaps.md` | 未検証領域（特性化できなかった箇所・hermetic でないテスト・スコープ外の副作用。同上） |
| `.replace/parity/<slug>/metadata.json` | 取得時のゴールデンデータセットバージョン・対象コミット（同上） |
| `.replace/parity/<slug>/new/<target>/replace-metadata.json` | 新側の green 証跡（`suite.new_green`・`verification.passed_at`）と差し戻しループの状態（`loop.iterations` / `loop.max_iterations` / `loop.last_diff_report`）（`parity-replace` が生成。スキーマ正本は同スキル）。新側成果物は環境別のため target ごとに存在しうる |
| `.replace/parity/<slug>/new/<target>/diff.md` | 検出した差分と分類（要対応／許容／環境ノイズ）・根拠（`parity-diff` が生成。スキーマ正本は同スキル）。新側成果物は環境別のため target ごとに存在しうる |
| `.replace/parity/<slug>/new/<target>/diff-metadata.json` | 収束判定の機械可読値（`converged`・`results`）（`parity-diff` が生成。スキーマ正本は同スキル）。同上 |
| `.replace/dataset/metadata.json` | 現在のデータセットバージョン（`version`）と新側投入記録（`phase_b.<slug>.<target>`。target 別）（`golden-dataset` が生成） |

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
   データセットバージョンの陳腐化（`metadata.json` のバージョン < `.replace/dataset/metadata.json` のバージョンなら「要再取得」）、
   フェーズ B の状態（**`new/<target>/` が存在する target**〈`diff.md` の有無は問わない——差分検出前でも新側データは要る〉に対応する `phase_b.<slug>.<target>` が無ければ「その環境でフェーズ B 未実施の疑い」、
   `phase_b.<slug>.<target>.dataset_version` < 現在の `version` なら「その環境の新側データが陳腐化・要再投入」。
   ただし**投入対象でない target は対象にしない**——`dataset_mode: db`（既定）では `db` 未定義の target と、`db.env_vars` はあるが `seedable` が無い読み取り専用の target が該当する。
   `dataset_mode: static` では**全 target が投入対象**なので免除は起きず、どの target もフェーズ B の状態を見る〈契約の正本は [`project-config.md`](project-config.md)〉）、
   新側の到達点（`replace-metadata.json` の `suite.new_green` が true なのに `new/<target>/diff.md` が無ければ「**green 済み・差分検出は未実施**」として区別する。`parity-diff` の未実行が「未着手」に埋もれるのを防ぐ）、
   差し戻しループの状態（`loop.iterations` と `loop.max_iterations`。1 以上で未収束なら「往復中（n 反復目）」、`loop.iterations` が `max_iterations` に達していれば「上限到達・人手の判断待ち」）、
   `parity-diff` の進捗（`new/<target>/diff.md` の分類を集計した「要対応」の残数。収束判定そのものは `parity-diff` が担い、本モードは集計値の報告に留める）。
   **新側の進捗は target（環境）ごとに分かれる**ため、同じ slug でも環境別に状態を示す（例: local-dev は収束済み・preview は未実施）。`new/` 配下に無い target は「その環境では未実施」として扱う
2. **未検証領域の一覧**: 全 slug の `gaps.md` を集約する。スコープ外にした副作用（メール・外部連携）・hermetic でないテスト・データ不足も含め、**対象外にした事実を隠さない**。切替判断の材料として提示する
3. **横断 API の影響範囲**: 横断 API に手が入ったら利用側の全機能を再検証する必要がある。features.md の fan-out から「このリソースを使う機能一覧」を導出し、横断 API Issue の状態変化（再オープン・変更）に対して**再検証が必要な機能**を列挙する

## 報告

- 機能 × 状態の表＋未検証領域の一覧＋影響範囲、の順で提示する
- 「Issue が closed」と「検証済み」は別。closed でも `gaps.md` に残る未検証領域は未検証として報告する
- 数（機能数・gaps 件数）は部分ビューではなく完全出力で数える
