# 新側の確認（verify）

<!-- spec-parity verify が .replace/parity/<slug>/new/<target>/verify.md として書く。このファイルの形式は spec-parity が定義する。 -->
<!-- 判定の原本は verify-metadata.json と convergence-check.mjs の出力である。この文書は、人が読む要約と差し戻しの入力にする。 -->
<!-- 「収束」と書けるのは、convergence-check.mjs が exit 0 を返したときだけである。モデルの「問題ないように見える」を根拠にしない。 -->

- 対象 slug: （features.md の slug）
- 新側の target: （target の名前）
- 新側のバージョン: （new.commit）
- 実施日時: （ISO 8601）
- 収束の判定: （convergence-check.mjs の終了コードと converged の値）
- 従った on_diff のドキュメント: （選んだ target の on_diff のパス。無ければ -）

## 判定の内訳

| 確かめたこと | ツール・記録 | 結果 |
|---|---|---|
| スイートが新側で通る | e2e の結果（`new/<target>/suite-report.json`） | （全件 passed / 通らないテストの一覧） |
| 横にはみ出さない | overflow-check.mjs（capture_conditions の幅 × ページ） | （exit 0 / はみ出した組の一覧） |
| 操作中のエラーが増えていない | runtime-errors.mjs compare | （exit 0 / 現行に無かった署名の一覧と分類） |
| デザインの点検 | web-design-guidelines か同梱の観点 | （指摘の件数・直す・受け入れる） |
| 人による確認 | 利用者の承認の記録 | （approved / rejected と notes） |

## 差し戻す内容

<!-- convergence-check.mjs の reasons のうち category が send-back のものを、parity-replace へ渡す入力として並べる。 -->

| 確かめたこと | 内容 | 直す先の見当（ページ・論理名） |
|---|---|---|

## デザインの指摘

<!-- 指摘は「直す」か「受け入れる」に分ける。受け入れるものは、利用者の承認（承認した人・日時・理由）を verify-metadata.json に書く。 -->
<!-- web-design-guidelines は規則を実行のたびに GitHub の main から取得するので、同じ画面でも実行ごとに指摘が変わりうる。取得した日時を書く。 -->

| id | 規則・観点 | ページ | 内容 | 直す / 受け入れる | 承認 |
|---|---|---|---|---|---|

## 判断待ち

<!-- 自律実行の保留（verify-metadata.json の pending_decisions）を並べる。 -->

## 未検証の領域

<!-- verify-metadata.json の unverified と同じ文言を書く。performance は必ず入る。 -->

| 項目 | 理由 |
|---|---|
| performance | 性能の比較は Playwright の採取を前提にしているので、spec-parity では確かめない |
