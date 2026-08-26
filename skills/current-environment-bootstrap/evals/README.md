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
  扱ってよいかの判断は書かない。dump は個人情報らしき値（担当者名・メール・電話）を含み、**成果物・応答へ書き出さない**ことも見る
- eval 5（`resume-after-answers`）: 質問票に回答が返った状態（Q-1 は確定回答、Q-2 は「現物が無く回答できない」、Q-3 は未回答）。
  **工程 1 からやり直さないこと**と、**「聞いていない」「聞いたが確定できない」「確定した」の 3 状態を潰さないこと**が弁別点
- 採点は `evals.json` の assertions と `result.json` / `project-files/` を突き合わせ、`grading.json` を残す
- 集計（`benchmark.json` / `benchmark.md`）は skill-creator 同梱の `aggregate_benchmark` を使う（詳細は `docs/skill-development.md`）
