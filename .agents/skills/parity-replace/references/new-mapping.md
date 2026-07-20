# 新側ロケータマッピングの充填（例外のみ）

`parity-suite` が定義した論理名に対して新側の解決を埋める手順。既定は「不要」で、例外・操作差の分岐・脆弱マッピング不要化の確認・`new` プロジェクトの green 化を扱う。

## 既定は「不要」——書くのは例外だけ

- **既定は「不要」**（マッピング層の原則と「片側ずつ埋まる」契約の正本: `parity-suite` の `references/locator-mapping.md`）。**書くのは論理名で解決できない例外だけ**
- 例外の実パス既定は `<parity_suite_dir>/parity/lib/locator-map/<slug>.new.ts`（`metadata.json` の `suite` から引く。例外ゼロなら作らない）
- 現側マッピング・論理名の契約・スイート配置は `.replace/parity/<slug>/metadata.json` の `suite.*` から引く（推測しない）

## 操作の実装差は分岐が必須

**ロケータが解決しても操作が通らない。** 分岐が必須なコンポーネント集合と理由の正本は `parity-suite` の `references/locator-mapping.md`「操作の実装差を吸収する層」（転記しない）。本スキルは新側の分岐を、`metadata.json` の `suite.interactions` が指す操作アダプタへ実装する。スイート本体には触れず、論理名と操作意図だけを保つ。

## 現側の脆弱マッピングが不要になったかを確認する

- 現側マッピングが `div` への CSS セレクタ等の脆弱な形にならざるを得なかった箇所は、**マッピング層のコメントに記録されている**（`parity-suite` が記録済み）。これを入力に、新側でセマンティクスが改善して不要になったかを確認する
- 不要になったか否かの確認結果を `porting.md`（「現側脆弱マッピングの不要化確認結果」節）へ記録する。不要になっていれば新側マッピングは書かない（セマンティクス改善の証拠）

## `new` プロジェクトの green 化

- Playwright の `projects` は `current` / `new` の 2 つを `parity-suite` が定義済み。**`new` の baseURL 設定（設定の `new.url`）と、新に対する green 化が本スキルの担当**
- baseURL は設定 `skills.replace-strategy.new.url` から引く。開発前で `none` なら実装が URL を持つまで green 化を保留する

## assertion を変えたら強度ゲートを再実行する

例外充填・穴埋めで**スイートの assertion が変わった場合**は、`parity-suite` の強度ゲート再実行が必要（`strength.md` の「再実行条件」）。スケジュールではなく assertion 変更駆動で、`parity-suite` を対象 slug で再実行する。
