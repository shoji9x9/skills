# 6. 仕様を変えないリプレイス

伝えること: 現行を測り、新旧で同じ合否の基準を当てて置き換える流れ。

含むスキル: replace-strategy・current-environment-bootstrap・golden-dataset・parity-component・parity-suite・parity-replace・parity-diff・spec-parity

## スライド

1. 困りごと。仕様を変えないリプレイスでは、同じ挙動かを推測や設計書で判断しやすい。設計書は今の現行の挙動と一致するとは限らない。
   新旧の画面の差分をモデルに探させると、余白・色・フォントのような細かな差を見落とす。
   根拠: `skills/replace-strategy/SKILL.md`「厳守の制約（禁止事項）」、`skills/parity-diff/SKILL.md` の冒頭
2. 考え方。現行の挙動を証拠として固定し（固定する）、別の実装で再現し（再現する）、差分がゼロであることを確かめる（確かめる）。これをループで回す。
   根拠: `skills/replace-strategy/SKILL.md` の冒頭
3. スタイルの方針。画面のある機能を確かめるスキルは、replace-strategy の設定にある `style_policy` で決まる。
   `reproduce`（デフォルト）は見た目も現行に合わせ、parity-suite と parity-diff で新旧の画面を比べる。
   `free` は UI の仕様（操作・状態・role・テキスト・API）だけを合わせ、見た目は人が見て違和感の無いものにする。spec-parity が新側だけを確かめ、新旧の画面は比べない。
   値は setup で戦略を決めるときに利用者が選び、機能に着手した後は変えない。どうしても変えるなら、利用者は、着手済みの機能で作った成果物を作り直すかを機能ごとに決めてから変える。横断 API とバッチは、どちらの値でも parity-suite と parity-diff で確かめる。
   根拠: `skills/replace-strategy/references/project-config.md`「スタイルの方針（`style_policy`）」、`skills/replace-strategy/SKILL.md`「姉妹スキルと依存順」
4. 全体の順序（図）。最初に 1 回、replace-strategy の setup → 必要なときだけ current-environment-bootstrap → 測定と戦略と機能の一覧 → golden-dataset のフェーズ A と進む。
   `reproduce` で部品を画面より先に作るなら parity-component を実行する。
   その後、機能ごとに、`reproduce` なら parity-suite → parity-replace → parity-diff を、`free` なら spec-parity suite → parity-replace → spec-parity verify を繰り返す。
   横断 API とバッチは、`free` でも `reproduce` の流れで進める。parity-replace は、新側のスキーマが決まった後に golden-dataset のフェーズ B を呼ぶ。
   根拠: `skills/replace-strategy/SKILL.md`「姉妹スキルと依存順」
5. replace-strategy。現行を測って戦略を決め、機能に分けて姉妹スキルに振り分ける。自分では実装しない。測れなければ止まる。
   仕様は、実行ログ → ソースコード → API → UI の順に、費用の低い方法から確かめる。見た目を現行に合わせるか（`style_policy`）を、戦略の決定で利用者に選んでもらう。
   Issue の起票は issue-create に任せる。
   `evidence` で、確定した API の要求単位の根拠を、機能の一覧（`.replace/features.md`）に書き戻す。parity-suite・parity-replace から任されて呼ばれることもある。
   呼び出し方は `replace-strategy setup`・`issues`・`status`・`evidence`。
   根拠: `skills/replace-strategy/SKILL.md` の冒頭・「使い方」・「厳守の制約（禁止事項）」・「setup モード」
6. current-environment-bootstrap。受け取った資産だけから、比べる基準になる現行のテスト環境を作り直す。
   型や列の名前から値を推測して確定せず、足りない情報は現行アプリの担当者や業務の専門家への質問票にする。
   根拠: `skills/current-environment-bootstrap/SKILL.md` の `description`・冒頭・「使い方」
7. golden-dataset。新旧に同じデータを入れる、冪等で決定論的な投入ツールを作る。本番環境は参照せず、データを一から作る。
   現行への投入（フェーズ A）と、新側への投入（フェーズ B）に分ける。データセットのバージョンで、古くなった基準を見つける。
   根拠: `skills/golden-dataset/SKILL.md` の `description`・冒頭・「使い方」
8. parity-component。共通の UI 部品を画面より先に作るときに、現行から見た目の基準を採り、実装して部品カタログで照合する。
   同じ部品をページごとに採って比べ、ページによって違う見た目（幅や色など）は部品の引数にし、どのページでも同じ見た目は部品の中に固定する。
   `style_policy` が `free` のときは使わない。
   根拠: `skills/parity-component/SKILL.md` の `description`・冒頭・「使い方」・「姉妹スキルとの連携」
9. parity-suite。新旧どちらにも当てられる合否の基準を Playwright で作る。要素を論理名で指し、API の応答を記録して再生する。
   わざと故障を入れて、基準が故障を検出できる強さかを確かめ、見た目の基準とノイズの幅を parity-diff に渡す。`style_policy` が `free` のときは、横断 API とバッチだけを扱う。
   根拠: `skills/parity-suite/SKILL.md` の `description`・冒頭・「使い方」・「姉妹スキルとの連携」
10. parity-replace。合否を決めるスイート（parity-suite か spec-parity）に対して新側を実装する。機能をページ単位のフェーズに分け、実装役と分けたレビュー役が差分をレビューする。
    ブランチの作成・commit・PR は issue-start に任せる。
    `style_policy` が `free` の画面のある機能では、spec-parity のスイートで新側を確かめ、spec-parity verify と往復する。
    根拠: `skills/parity-replace/SKILL.md` の `description`・冒頭・「使い方」、`skills/parity-replace/references/style-free.md`「相手のスキルと判定の置き換え」
11. parity-diff。差分は決定論的なツールが検出し、モデルは「この差分は重要か」の分類だけを行う。
    検出は、画素の比較・スタイルの比較（論理名の付いた要素の計算されたスタイル・擬似要素・位置関係）・構造の比較（aria スナップショット）で分担する。
    parity-diff のスキルの語では、スタイルの比較は特性照合に、構造の比較は aria の比較に当たる。
    対応が要る差分は parity-replace へ戻す。`style_policy` が `free` のときは、横断 API とバッチだけを扱う。
    根拠: `skills/parity-diff/SKILL.md` の冒頭・「使い方」・「姉妹スキルとの連携」、`skills/parity-diff/references/detect.md`「3 つの比較方法の分担」
12. spec-parity。`style_policy` が `free` の画面のある機能で、parity-suite と parity-diff の代わりに動く。新旧の画面は比べず、合否を決めるときにモデルに「問題ないか」を聞かない。
    `suite` は、現行に対して e2e のスイート（操作・状態・role ごとの assertion・API）を作って通し、故障を入れて強度を確かめ、操作中に出るエラーの基準と現行がはみ出さない画面の幅を記録する。
    `verify` は新側だけを確かめる。スイート・横のはみ出し・操作中のエラーはツールで、デザインの点検と人による確認は承認の記録で判定する。
    要対応は parity-replace に戻す。承認は追記だけの記録に残し、記録が減っていないことを確かめてから収束とする。
    根拠: `skills/spec-parity/SKILL.md` の冒頭・「使い方」・「実行フロー」
13. 人が判断する点。戦略と、見た目を現行に合わせるか（`style_policy`）の承認、現行アプリの担当者や業務の専門家による質問票への回答、測らない項目と後始末できない書き込みの承認、受け入れ条件と突き合わせない資産の承認、「許容」に分けた差分の承認。
    spec-parity では、受け入れるデザインの指摘と許容する操作中のエラーを承認し、保証する幅から、現行もはみ出した幅を外すことも承認する。
    新側の画面に違和感が無いことも確かめる。
    e2e と web-design-guidelines を入れるかと、agent のステップで画面の内容をモデルの提供元へ送るかも決める。
    新側のアーキテクチャ（フレームワーク・構成など）は、スキルが決めず、事前に決めておく。`--autonomous` では、判断が要るものを保留に記録し、最後にまとめて聞く。
    根拠: `skills/replace-strategy/SKILL.md`「前提」「自律実行（`--autonomous`）」、各姉妹スキルの承認の手順
14. 成果物。`.replace/` の測定レポート・戦略書・機能の一覧、機能ごとの Issue、データの投入ツール、Playwright のパリティスイートか e2e のスイート、新側の実装と PR、差分の分類か新側を確かめた記録。
    根拠: `skills/replace-strategy/SKILL.md`「成果物」、各姉妹スキルの `SKILL.md` の成果物の節
15. つながるスキル。起票は issue-create、実装の流れは issue-start に任せる（第 4 章）。現行アプリの操作は browser-test の作法に従う（第 7 章）。成果物の文書は writing-style で読み直す（第 3 章）。
    根拠: `skills/replace-strategy/SKILL.md`「前提」、`skills/parity-replace/SKILL.md` の冒頭
