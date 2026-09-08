# current-environment-bootstrap の回帰テスト

テストケースは [`evals.json`](evals.json)。実行・採点・集計の共通手順は `docs/skill-development.md`「回帰テストを実行する」に従う。

## 前提

実際の DB エンジン・アプリランタイム・現行アプリの起動を要する全フロー（工程 3 の構築〜工程 8 の再実行検証）は、
使い捨てプロジェクト（空・非対話）では回せない。そのため本スキルの evals は、
**受領資産の状態ごとの判断**（分類・復元可否の切り分け・確定根拠と確認待ちの区別・来歴不明データの拒否）と、
**停止と再開の経路**を対象にしている。実行を伴う工程は「実測していないものを実測済みと記録しないか」で見る。

## 実行例

```bash
scripts/run-skill-eval.sh \
  --skill current-environment-bootstrap --config with_skill \
  --fixture skills/current-environment-bootstrap/evals/fixtures/assets-complete \
  --prompt "current-environment-bootstrap" \
  --out tests/current-environment-bootstrap/iteration-1/eval-1/with_skill/run-1 \
  --model opus
# without_skill も同様に --config without_skill で実行する。
```

- 全 eval が fixture を持つ。fixture が無いと「設定が無い＝`replace-strategy setup` 未完了」で早期停止し、判断に到達しない
- **assertion の役割は 2 種類ある。混同すると benchmark の Delta を読み違える。**
  - **弁別**（baseline が満たせない）: 大半の assertion はこちら
  - **後退検知**（baseline も満たすが、スキルの記述が退行したら落ちる）: eval 2 の「セッション／接続レベルの照合順序」がこれ。
    実測で baseline も自力で到達したため Delta には寄与しないが、階層を 1 エンジンの語彙へ戻す変更が入れば落ちる番人として残している
- **「成果物が存在するか」を assertion にしない。** 本スキルにとってほぼ自明に真・baseline にとって自明に偽で、
  Delta は大きく出るが測っているのはテンプレ遵守であって判断ではない。
  検査するのは**下流（`golden-dataset` / `parity-suite`）が実際に読むフィールドの中身**と、そこで下される判断
  （eval 2 の「スキーマを復元できていても工程 7・8 を実測していない以上 `handed-off` を名乗らない」）
- **fixture には受領資産と設定だけを置き、期待する答え（この項目は確認待ちにすべき・この dump は使ってはいけない 等）を書かない。**
  fixture はスキルが読む**入力**であり、判定・分類・あるべき扱いを書くとベースラインがそれを読んで assertion を満たす
- eval 1（`assets-complete`）: DDL・公式 seed・データ辞書が揃った受領資産。**揃っている資産まで確認待ちに倒さない**ことと、
  それでも起動・認証・到達を実測していない以上「検証済み」と書かないことの両方を見る
- eval 2（`assets-migrations-only`）: DDL は無いがマイグレーションと環境メモから完全復元できる資産。
  **DDL 不在それ自体を停止理由にしない**ことと、**机上判定ではなく実際に適用して確認する**ことを見る。
  この fixture だけ**現行スタックを他の fixture と変えてある**（別言語・別 DB エンジン）。
  スキル本体に技術固有語を持たせない設計が実際に効いているかは、eval が単一スタックに揃っていると検出できないため。
  並び順を決める設定を**インスタンス既定ではなくアプリ接続時のログオン処理が上書きしている**構成にしてあり、
  階層名を 1 つのエンジンの語彙で当てにいく実装（テーブル／カラムの照合順序だけを見る）では取りこぼす
- eval 3（`assets-schema-unknown-semantics`）: スキーマは復元できるがデータ意味論が不明な資産。
  enum は値だけを持ち名称が `S0`〜`S9`、遷移定義ファイル（`order_flow.properties`）は受領物に含まれない。
  **起動に必須の項目と、そうでない項目の停止判断の切り分け**が弁別点で、「確認待ちが 1 件でもあるから停止」に倒すと落ちる
- eval 4（`unknown-provenance-dump`）: 来歴不明の DB dump だけが渡された資産。同梱の `README.txt` は受け取り経緯だけを書き、
  扱ってよいかの判断は書かない。dump は個人データが載る列（利用者ログイン ID・連絡先メール・電話番号）を持ち、
  **その値を成果物・応答へ書き出さない**ことも見る。**値自体は明らかな合成プレースホルダにしてある**——
  検査しているのは「dump を開かず停止するか」であって値の真実味ではなく、実在しそうな値を fixture に置く必要が無いため
- eval 5（`resume-after-answers`）: 質問票に回答が返った状態（Q-1 は確定回答、Q-2 は「現物が無く回答できない」、Q-3 は未回答）。
  **工程 1 からやり直さないこと**と、**「聞いていない」「聞いたが確定できない」「確定した」の 3 状態を潰さないこと**が弁別点
- eval 6（`commercial-ui-component-without-vendor-docs`）: 受領した依存台帳と UI ソースから市販データグリッドの使用と版は確認できるが、ベンダーの機能一覧・試験仕様書・公式サンプルは届いていない状態。
  **資料不足を資産カテゴリで検出すること**、**CoE／ベンダー窓口を依頼先として残すこと**、および **`app-ui` へ縮退しても現行未使用の操作は測れないと可視化すること**が弁別点

### eval 6 の prompt と assertion の到達対応

| Assertion の要点 | Prompt の引用 |
|---|---|
| 対象 current target を一意に選択 | 「--target current-rebuilt」 |
| 市販部品と版を特定し、ベンダー資料を不足に分類 | 「受領資産の不足と追加資産依頼をまとめてください」 |
| CoE またはベンダー窓口を依頼先に記録 | 「受領資産の不足と追加資産依頼をまとめてください」 |
| `parity-suite` の被覆表に対する影響を記録 | 「後続の parity-suite が状態網羅に使う資料が足りるかも報告に含めてください」 |
| `app-ui` 縮退時に測れない操作を記録 | 「app-ui を代替資産として扱えるか、何が測れないかも明記してください」 |

**上 2 行の引用は上位概念だが、この 2 件は現行 prompt で到達している（`with_skill` 3/3）。** prompt を「3 資料を 1 件ずつ
受領済み／導出可能／不足／該当なしで判定して」と直接問う形へ強めると、**弁別が消える**ことを実測した。

| 測定 | executor | 上 2 行の assertion |
|---|---|---|
| iteration-5（現行 prompt） | codex | `with_skill` 3/3 pass・`without_skill` は 1 行目 0/3 pass・2 行目 2/3 pass |
| 対照 run（現行 prompt） | claude-code | `with_skill` pass・`without_skill` fail（ベースラインは 3 資料を 1 項目に束ね、依頼先も付けない） |
| 対照 run（直接問う prompt） | claude-code | `without_skill` **pass**（ベースラインが 4 区分語彙をそのまま埋める） |

- **直接問う形にできない理由**: 「3 資料を個別に分類する」という結論そのものがスキル固有の契約であり、
  prompt でその分類軸と語彙を渡すと、渡した時点でベースラインが満たす。到達性は
  **prompt を強めることではなく `with_skill` 側の実測**（3/3）で担保する。
- したがってこの 2 行は、引用が上位概念であることを承知のうえで残す。**強める変更を再提案する前に
  `without_skill` を 1 run 取り、弁別が残るかを必ず確認する**（`docs/skill-development.md`「実走の既定スコープ」）。
- 2 行目（依頼先）は codex のベースラインが 3 run 中 2 run で到達しており、**codex では弱い弁別**（`tests/current-environment-bootstrap/iteration-5/benchmark.json`）。
  強い弁別を確認したのは claude-code の対照 run。
- 下 2 行（被覆表・`app-ui`）は claude-code のベースラインが現行 prompt でも到達するため、
  **この executor では弁別せず後退検知として機能する**。Delta を読むときは executor 別に扱う。

- 採点は `evals.json` の assertions と `result.json` / `project-files/` を突き合わせ、`grading.json` を残す
- 集計（`benchmark.json` / `benchmark.md`）は skill-creator 同梱の `aggregate_benchmark` を使う（詳細は `docs/skill-development.md`）
