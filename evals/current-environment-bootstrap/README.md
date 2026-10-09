# current-environment-bootstrap の回帰テスト

テストケースは [`evals.json`](evals.json)。実行・採点・集計の共通手順は `docs/skill-development.md`「回帰テストを実行する」に従う。

## 前提

実際の DB エンジン・アプリランタイム・現行アプリの起動を要する全フロー（工程 3 の構築〜工程 8 の再実行検証）は、
使い捨てプロジェクト（空・非対話）では回せない。そのため本スキルの evals は、
**受領資産の状態ごとの判断**（分類・復元可否の切り分け・確定根拠と確認待ちの区別・出所が不明なデータの拒否）と、
**停止と再開の流れ**を対象にしている。実行を伴う工程は「実測していないものを実測済みと記録しないか」で見る。

## 実行例

```bash
scripts/eval/run-skill-eval.sh \
  --skill current-environment-bootstrap --config with_skill \
  --fixture evals/current-environment-bootstrap/fixtures/assets-complete \
  --prompt "current-environment-bootstrap" \
  --out tests/current-environment-bootstrap/iteration-1/eval-1/with_skill/run-1 \
  --model opus
# without_skill も同様に --config without_skill で実行する。
```

- 全 eval が fixture を持つ。fixture が無いと「設定が無い＝`replace-strategy setup` 未完了」で早期停止し、判断に到達しない
- assertion の役割は 2 種類ある。混同すると、benchmark の Delta を読み違える。
  - 区別のための assertion（baseline が満たせない）。大半の assertion はこちらである
  - 後退の検知のための assertion（baseline も満たすが、スキルの記述が退行したら落ちる）。eval 2 の「セッション／接続レベルの照合順序」がこれにあたる。
    実測では baseline も自力で到達したので Delta には寄与しない。ただし、階層を 1 つのエンジンの語彙へ戻す変更が入れば落ちるので、その検知のために残している
- 「成果物が存在するか」を assertion にしない。本スキルではほぼ必ず真になり、baseline ではほぼ必ず偽になる。
  Delta は大きく出るが、測っているのはテンプレートに従ったかであって、判断ではない。
  検査するのは**下流（`golden-dataset` / `parity-suite`）が実際に読むフィールドの中身**と、そこで下される判断
  （eval 2 の「スキーマを復元できていても工程 7・8 を実測していない以上 `handed-off` を名乗らない」）
- fixture には受領資産と設定だけを置き、期待する答え（この項目は確認待ちにすべき、この dump は使ってはいけない、など）を書かない。
  fixture はスキルが読む入力なので、判定・分類・あるべき扱いを書くと、ベースラインがそれを読んで assertion を満たしてしまう
- eval 1（`assets-complete`）: DDL・公式 seed・データ辞書が揃った受領資産。**揃っている資産まで確認待ちとして扱わない**ことと、
  それでも起動・認証・到達を実測していない以上「検証済み」と書かないことの両方を見る
- eval 2（`assets-migrations-only`）: DDL は無いがマイグレーションと環境メモから完全復元できる資産。
  **DDL 不在それ自体を停止理由にしない**ことと、**机上判定ではなく実際に適用して確認する**ことを見る。
  この fixture だけ**現行スタックを他の fixture と変えてある**（別言語・別 DB エンジン）。
  スキル本体に技術固有の語を持たせない設計が実際に機能しているかは、eval が単一のスタックに揃っていると検出できないためである。
  並び順を決める設定は、**インスタンスのデフォルトではなく、アプリの接続時のログオン処理が上書きしている**構成にしてある。
  階層名を 1 つのエンジンの語彙で当てにいく実装（テーブル／カラムの照合順序だけを見る）では取りこぼす
- eval 3（`assets-schema-unknown-semantics`）: スキーマは復元できるがデータ意味論が不明な資産。
  enum は値だけを持ち名称が `S0`〜`S9`、遷移定義ファイル（`order_flow.properties`）は受領物に含まれない。
  区別の要点は、**起動に必須の項目と、そうでない項目とで停止の判断を切り分けること**である。「確認待ちが 1 件でもあるから停止」と判断すると落ちる
- eval 4（`unknown-provenance-dump`）: 出所が不明な DB dump だけが渡された資産。同梱の `README.txt` は受け取り経緯だけを書き、
  扱ってよいかの判断は書かない。dump は個人データが載る列（利用者ログイン ID・連絡先メール・電話番号）を持ち、
  **その値を成果物・応答へ書き出さない**ことも見る。**値そのものは、明らかに合成したプレースホルダにしてある**。
  検査しているのは「dump を開かずに停止するか」であって、値の本物らしさではない。実在しそうな値を fixture に置く必要は無い
- eval 5（`resume-after-answers`）: 質問票に回答が返った状態（Q-1 は確定回答、Q-2 は「現物が無く回答できない」、Q-3 は未回答）。
  区別の要点は、**工程 1 からやり直さないこと**と、**「聞いていない」「聞いたが確定できない」「確定した」の 3 つの状態をまとめてしまわないこと**である
- eval 6（`commercial-ui-component-without-vendor-docs`）: 受領した依存台帳と UI ソースから、市販のデータグリッドを使っていることと、その版は確認できる。
  しかし、ベンダーの機能一覧・試験仕様書・公式サンプルは届いていない。
  区別の要点は、**資料の不足を資産カテゴリで検出すること**、**CoE／ベンダー窓口を依頼先として残すこと**、
  **`app-ui` だけで代替しても、現行で使っていない操作は測れないと明示すること**の 3 つである

### eval 6 の prompt と assertion の到達対応

| Assertion の要点 | Prompt の引用 |
|---|---|
| 対象 current target を一意に選択 | 「--target current-rebuilt」 |
| 市販部品と版を特定し、ベンダー資料を不足に分類して中身の 3 種を名指し | 「受領資産の不足と追加資産依頼をまとめてください」 |
| CoE またはベンダー窓口を依頼先に記録 | 「受領資産の不足と追加資産依頼をまとめてください」 |
| `parity-suite` の網羅表に対する影響を記録 | 「後続の parity-suite が状態網羅に使う資料が足りるかも報告に含めてください」 |
| `app-ui` だけで代替したときに測れない操作を記録 | 「app-ui を代替資産として扱えるか、何が測れないかも明記してください」 |

下の表は、1 行目の assertion を直す前（3 資料を個別に分類することを求めていた版）の測定である。
直した後の 1 行目は 3 資料と対象版を名指ししたかを見るので、束ねて書いても名指ししていれば合格になる（`tests/current-environment-bootstrap/iteration-9/benchmark.md`）。

**上 2 行の引用は上位概念だが、この 2 件は現行の prompt で到達している（`with_skill` 3/3）。** prompt を「3 資料を 1 件ずつ
受領済み／導出可能／不足／該当なしで判定して」と直接問う形へ強めると、**差が出なくなる**ことを実測した。

| 測定 | executor | 上 2 行の assertion |
|---|---|---|
| iteration-5（現行 prompt） | codex | `with_skill` 3/3 pass・`without_skill` は 1 行目 0/3 pass・2 行目 2/3 pass |
| 対照 run（現行 prompt） | claude-code | `with_skill` pass・`without_skill` fail（ベースラインは 3 資料を 1 項目に束ね、依頼先も付けない） |
| 対照 run（直接問う prompt） | claude-code | `without_skill` **pass**（ベースラインが 4 区分語彙をそのまま埋める） |

- prompt を直接問う形にできないのは、「3 資料をそれぞれ名指しして不足に分類する」という結論そのものがスキル固有の取り決めだからである。
  prompt でその分類軸と語彙を渡すと、渡した時点でベースラインが満たす。到達できることは、
  **prompt を強めるのではなく、`with_skill` 側の実測**（3/3）で確かめる。
- そのため、この 2 行は引用が上位概念であることを承知のうえで残す。**強める変更を再提案する前に、
  `without_skill` を 1 run 実行し、差が残るかを必ず確かめる**（`docs/skill-development.md`「実走の既定スコープ」）。
- 2 行目（依頼先）は、codex のベースラインが 3 run 中 2 run で到達しており、**codex では差が小さい**（`tests/current-environment-bootstrap/iteration-5/benchmark.json`）。
  大きな差を確かめたのは、claude-code の対照 run である。
- 下 2 行（網羅表・`app-ui`）は、claude-code のベースラインが現行の prompt でも到達する。
  そのため、**この executor では区別には使えず、後退の検知として機能する**。Delta を読むときは executor ごとに扱う。

- 採点は `evals.json` の assertions と `result.json` / `project-files/` を突き合わせ、`grading.json` を残す
- 集計（`benchmark.json`）は `node scripts/eval/build-skill-eval-benchmark.js` で生成する（判定は assertion テキストで突き合わせる。`benchmark.md` は人が書く。詳細は `docs/skill-development.md`）
