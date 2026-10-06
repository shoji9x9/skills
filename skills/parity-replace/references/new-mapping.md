# 新側ロケータマッピングの充填（例外だけ）

`parity-suite` が定義した論理名に対して、新側の解決を埋める手順。デフォルトでは書かず、例外・操作の差の分岐・脆弱なマッピングが要らなくなったかの確認・`new` プロジェクトの green 化を扱う。

## デフォルトでは書かない。書くのは例外だけ

- デフォルトでは書かない（マッピングの層の原則と、「片側ずつ埋まる」取り決めの原本は `parity-suite` の `references/locator-mapping.md`）。書くのは、論理名で解決できない例外だけである
- 例外を置くパスのデフォルトは `<parity_suite_dir>/parity/lib/locator-map/<slug>.new.ts` である（`metadata.json` の `suite` から読む。例外がゼロなら作らない）
- 現側マッピング・論理名の取り決め・スイートの配置は、`.replace/parity/<slug>/metadata.json` の `suite.*` から読む（推測しない）

## 新側の期待値（期待値解決層）

論理名に対する期待値は、ロケータマッピングとは別の層（期待値解決層）で解決される。
層の定義、side の解決のしかた（Playwright の `projects` の名前）、「宣言に無い差を side ごとに分けない」原則の原本は、`parity-suite` の `references/locator-mapping.md`「期待値解決層」である（転記しない）。
このスキルが担うのは、新側の値の充填である。

- パスは `metadata.json` の `suite.expectations` から読む（推測しない）。`parity-suite` は、現側の値だけを埋めた状態で引き渡している
- 新側の値を埋めるのは、意図的差異レジストリ `intentional_diffs.may_change` に宣言した差に対応する項目だけである。宣言に無い差を、期待値で吸収しない。
  吸収すると、スイートが新側に対して緑になっても、それはパリティの証拠ではなく、期待値を新側に合わせただけになる。宣言に無い差は、`intentional_diffs.pending` へ非破壊で追記し、ユーザーの確認へ回す
- 埋めた項目と根拠（レジストリの該当する項目）を、`porting.md` に残す

## 操作の実装の差には、分岐が要る

ロケータが解決しても、操作が通るとは限らない。分岐が要るコンポーネントの集合と理由の原本は、`parity-suite` の `references/locator-mapping.md`「操作の実装差を吸収する層」である（転記しない）。
このスキルは、新側の分岐を、`metadata.json` の `suite.interactions` が指す操作アダプタへ実装する。スイート本体には触れず、論理名と操作の意図だけを保つ。
新側の分岐を足しても、撮影の状態へ移る関数が、撮る対象の矩形が落ち着くまで待ってから返す取り決めは変えない。
分岐から早く return して待ちを飛ばすと、新側の採取でだけ、1 画素の揺れが 2 つの値に分かれる（原本は `parity-suite` の `references/baseline.md`「撮る対象が動かなくなるまで待つ」）。

## 現側の脆弱なマッピングが要らなくなったかを確かめる

- 現側マッピングが、`div` への CSS セレクタなどの脆弱な形にならざるを得なかった箇所は、マッピングの層のコメントに記録されている（`parity-suite` が記録している）。
  これを入力に、新側でセマンティクスが改善して要らなくなったかを確かめる
- 要らなくなったかどうかの確認の結果を、`porting.md` の節（見出しは `現側脆弱マッピングの不要化確認結果`）へ記録する。要らなくなっていれば、新側マッピングは書かない（セマンティクスが改善した証拠になる）

## `new` プロジェクトの green 化

- Playwright の `projects` は、`current` と `new` の 2 つを `parity-suite` が定義している。`new` の baseURL の解決と引き渡し、新側に対する green 化は、このスキルが担う
- baseURL は、選んだ target（設定 `skills.replace-strategy.targets` の `side: new`）から解決し、環境変数 `PARITY_NEW_UI_URL`・`PARITY_NEW_API_URL` に入れて渡す（`api_url` を省いたときは `url`）。
  `url_command` の target は、コマンドを実行して解決する。解決の規則の原本は `replace-strategy` の `references/project-config.md`「URL の引き渡し」、設定の原本は `parity-suite` である
- 寸法の採取（`parity-suite` の `dimension/` の測定スペック）は、`PARITY_DIMENSION_CAPTURE=1` と `PARITY_NEW_TARGET`（選んだ target の名前）を渡した実行でだけ行う。
  書き先は `new/<target>/dimension-samples.json` である。
  通常の green 化では渡さない（測定スペックは飛ばされる）。採るのは、完了の判定の直前だけである（`SKILL.md` の手順 8）
- green 化の前に、target の稼働を確かめる。`check_urls` で稼働を判定し、落ちているときだけ `pre_commands`、`start` の順に起動して判定し直す。
  稼働中なら、`pre_commands` も `start` も実行しない。
  最初の判定が失敗するのは止まる条件ではなく、起動の合図である。`pre_commands`・`start`・起動の後の判定し直しが失敗したら、早めに止まる
  （各項目の意味と、条件付きの実行の順の原本は `browser-test` の `references/project-config.md`）
- target の `url` が、開発の前で `none` なら、実装が URL を持つまで green 化を保留する。
  `url_command` の target は、この保留の対象外である。実行できる環境を指すので、解決に失敗したときにそこで止まる

## assertion を変えたら、強度チェックを実行し直す

例外の充填や抜けの穴埋めで、スイートの assertion が変わった場合は、`parity-suite` の強度チェックを実行し直す必要がある（`strength.md` の「再実行条件」）。
決まった時期にではなく、assertion を変えたことをきっかけに、`parity-suite` を対象の slug で実行し直す。
