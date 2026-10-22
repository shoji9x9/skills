# 6. 仕様を変えないリプレイス

伝えること: 現行を測り、新旧で同じ合否の基準を当てて置き換える流れ。

含むスキル: replace-strategy・current-environment-bootstrap・golden-dataset・parity-component・parity-suite・parity-replace・parity-diff

## スライド

1. 困りごと。仕様を変えないリプレイスでは、同じ挙動かを推測や設計書で判断しやすい。設計書は今の現行の挙動と一致するとは限らない。
   新旧の画面の差分をモデルに探させると、余白・色・フォントのような細かな差を見落とす。
   根拠: `skills/replace-strategy/SKILL.md`「厳守の制約（禁止事項）」、`skills/parity-diff/SKILL.md` の冒頭
2. 考え方。現行の挙動を証拠として固定し（固定する）、別の実装で再現し（再現する）、差分がゼロであることを確かめる（確かめる）。これをループで回す。
   根拠: `skills/replace-strategy/SKILL.md` の冒頭
3. 全体の順序（図）。最初に 1 回、replace-strategy の setup → 必要なときだけ current-environment-bootstrap → 測定と戦略と機能の一覧 → golden-dataset のフェーズ A と進む。
   部品を画面より先に作るなら parity-component を実行する。その後、機能ごとに parity-suite → parity-replace → parity-diff を繰り返す。
   parity-replace は、新側のスキーマが決まった後に golden-dataset のフェーズ B を呼ぶ。
   根拠: `skills/replace-strategy/SKILL.md`「姉妹スキルと依存順」
4. replace-strategy。現行を測って戦略を決め、機能に分けて姉妹スキルに振り分ける。自分では実装しない。測れなければ止まる。
   仕様は、実行ログ → ソースコード → API → UI の順に、費用の低い方法から確かめる。Issue の起票は issue-create に任せる。
   呼び出し方は `replace-strategy setup`・`issues`・`status`。
   根拠: `skills/replace-strategy/SKILL.md` の冒頭・「使い方」・「厳守の制約（禁止事項）」
5. current-environment-bootstrap。受け取った資産だけから、比べる基準になる現行のテスト環境を作り直す。
   型や列の名前から値を推測して確定せず、足りない情報は現行アプリの担当者や業務の専門家への質問票にする。
   根拠: `skills/current-environment-bootstrap/SKILL.md` の `description`・冒頭・「使い方」
6. golden-dataset。新旧に同じデータを入れる、冪等で決定論的な投入ツールを作る。本番環境は参照せず、データを一から作る。
   現行への投入（フェーズ A）と、新側への投入（フェーズ B）に分ける。データセットのバージョンで、古くなった基準を見つける。
   根拠: `skills/golden-dataset/SKILL.md` の `description`・冒頭・「使い方」
7. parity-component。共通の UI 部品を画面より先に作るときに、現行から見た目の基準を採り、実装して部品カタログで照合する。
   同じ部品をページごとに採って比べ、ページによって違う見た目（幅や色など）は部品の引数にし、どのページでも同じ見た目は部品の中に固定する。
   根拠: `skills/parity-component/SKILL.md` の `description`・冒頭・「使い方」
8. parity-suite。新旧どちらにも当てられる合否の基準を Playwright で作る。要素を論理名で指し、API の応答を記録して再生する。
   わざと故障を入れて、基準が故障を検出できる強さかを確かめ、見た目の基準とノイズの幅を parity-diff に渡す。
   根拠: `skills/parity-suite/SKILL.md` の `description`・冒頭・「使い方」
9. parity-replace。parity-suite の論理名に対して新側を実装する。機能をページ単位のフェーズに分け、実装役と分けたレビュー役が差分をレビューする。
   ブランチの作成・commit・PR は issue-start に任せる。
   根拠: `skills/parity-replace/SKILL.md` の `description`・冒頭・「使い方」
10. parity-diff。差分は決定論的なツールが検出し、モデルは「この差分は重要か」の分類だけを行う。
    検出は、画素の比較・スタイルの比較（論理名の付いた要素の計算されたスタイル・擬似要素・位置関係）・構造の比較（aria スナップショット）で分担する。
    parity-diff のスキルの語では、スタイルの比較は特性照合に、構造の比較は aria の比較に当たる。
    対応が要る差分は parity-replace へ戻す。
    根拠: `skills/parity-diff/SKILL.md` の冒頭・「使い方」、`skills/parity-diff/references/detect.md`「3 つの比較方法の分担」
11. 人が判断する点。戦略の承認、現行アプリの担当者や業務の専門家による質問票への回答、測らない項目と後始末できない書き込みの承認、受け入れ条件と突き合わせない資産の承認、「許容」に分けた差分の承認。
    新側のアーキテクチャ（フレームワーク・構成など）は、スキルが決めず、事前に決めておく。`--autonomous` では、判断が要るものを保留に記録し、最後にまとめて聞く。
    根拠: `skills/replace-strategy/SKILL.md`「前提」「自律実行（`--autonomous`）」、各姉妹スキルの承認の手順
12. 成果物。`.replace/` の測定レポート・戦略書・機能の一覧、機能ごとの Issue、データの投入ツール、パリティスイート、新側の実装と PR、差分の分類の結果。
    根拠: `skills/replace-strategy/SKILL.md`「成果物」、各姉妹スキルの `SKILL.md` の成果物の節
13. つながるスキル。起票は issue-create、実装の流れは issue-start に任せる（第 4 章）。現行アプリの操作は browser-test の作法に従う（第 7 章）。成果物の文書は writing-style で読み直す（第 3 章）。
    根拠: `skills/replace-strategy/SKILL.md`「前提」、`skills/parity-replace/SKILL.md` の冒頭
