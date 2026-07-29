# 新側ロケータマッピングの充填（例外のみ）

`parity-suite` が定義した論理名に対して新側の解決を埋める手順。既定は「不要」で、例外・操作差の分岐・脆弱マッピング不要化の確認・`new` プロジェクトの green 化を扱う。

## 既定は「不要」——書くのは例外だけ

- **既定は「不要」**（マッピング層の原則と「片側ずつ埋まる」契約の正本: `parity-suite` の `references/locator-mapping.md`）。**書くのは論理名で解決できない例外だけ**
- 例外の実パス既定は `<parity_suite_dir>/parity/lib/locator-map/<slug>.new.ts`（`metadata.json` の `suite` から引く。例外ゼロなら作らない）
- 現側マッピング・論理名の契約・スイート配置は `.replace/parity/<slug>/metadata.json` の `suite.*` から引く（推測しない）

## 新側の期待値（期待値解決層）

論理名に対する**期待値**は、ロケータマッピングとは別の層（期待値解決層）で解決される。層の定義・side の解決方法（Playwright の `projects` 名）・「宣言に無い差を side 別にしない」原則の正本は `parity-suite` の `references/locator-mapping.md`「期待値解決層」（転記しない）。本スキルの担当は**新側の値の充填**。

- 実パスは `metadata.json` の `suite.expectations` から引く（推測しない）。`parity-suite` は**現側の値だけ**を埋めた状態で引き渡している
- **新側の値を埋めるのは、意図的差異レジストリ `intentional_diffs.may_change` に宣言済みの差に対応する項目だけ。** 宣言に無い差を期待値で吸収しない（スイートが新に対して緑になっても、それはパリティの証拠ではなく期待値を新側に合わせただけになる）。宣言に無い差は `intentional_diffs.pending` へ非破壊追記してユーザー確認へ回す
- 充填した項目と根拠（レジストリの該当項目）を `porting.md` に残す

## 操作の実装差は分岐が必須

**ロケータが解決しても操作が通らない。** 分岐が必須なコンポーネント集合と理由の正本は `parity-suite` の `references/locator-mapping.md`「操作の実装差を吸収する層」（転記しない）。本スキルは新側の分岐を、`metadata.json` の `suite.interactions` が指す操作アダプタへ実装する。スイート本体には触れず、論理名と操作意図だけを保つ。

## 現側の脆弱マッピングが不要になったかを確認する

- 現側マッピングが `div` への CSS セレクタ等の脆弱な形にならざるを得なかった箇所は、**マッピング層のコメントに記録されている**（`parity-suite` が記録済み）。これを入力に、新側でセマンティクスが改善して不要になったかを確認する
- 不要になったか否かの確認結果を `porting.md`（「現側脆弱マッピングの不要化確認結果」節）へ記録する。不要になっていれば新側マッピングは書かない（セマンティクス改善の証拠）

## `new` プロジェクトの green 化

- Playwright の `projects` は `current` / `new` の 2 つを `parity-suite` が定義済み。**`new` の baseURL の解決・引き渡しと、新に対する green 化が本スキルの担当**
- baseURL は選択した target（設定 `skills.replace-strategy.targets` の `side: new`）から解決し、環境変数 `PARITY_NEW_UI_URL` / `PARITY_NEW_API_URL` に入れて渡す（`api_url` 省略時は `url`。
  `url_command` の target はコマンド実行で解決する——解決規則の正本は `replace-strategy` の `references/project-config.md`「URL の引き渡し」。配線の正本は `parity-suite`）
- green 化の前に target の稼働を確認する: `check_urls` で稼働判定し、落ちているときだけ `pre_commands` → `start` の順で起動して再確認する（稼働中なら `pre_commands` / `start` はどちらも実行しない）。
  **最初の稼働判定が落ちていることは停止条件ではなく起動の合図**で、`pre_commands` / `start` / 起動後の再確認の失敗は早期停止する
  （各項目の意味論と条件付き実行順の正本は `browser-test` の `references/project-config.md`）
- target の `url` が開発前で `none` なら、実装が URL を持つまで green 化を保留する（`url_command` の target はこの保留の対象外——実行可能な環境を指すため、解決に失敗したときにそこで停止する）

## assertion を変えたら強度ゲートを再実行する

例外充填・穴埋めで**スイートの assertion が変わった場合**は、`parity-suite` の強度ゲート再実行が必要（`strength.md` の「再実行条件」）。スケジュールではなく assertion 変更駆動で、`parity-suite` を対象 slug で再実行する。
