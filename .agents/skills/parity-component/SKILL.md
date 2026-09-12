---
argument-hint: <capture | build> [--component <slug>] [--target <name>]
description: 仕様を変えないアプリケーションリプレイスで、共通 UI 部品を画面より先に作るときに、現行アプリから部品の見た目の基準を採り、実装し、部品カタログ上で照合する replace-strategy の姉妹スキル。採取の単位は部品インスタンス（部品 × ページ）で、要素単位のスクリーンショット・状態別の計算後スタイル・当たっている CSS 規則・データ依存部品の実データを採る。インスタンス間で値が割れた軸を可変（引数）、割れない軸を固定として決定論的に割り出し、実装後はカタログを同条件で採って parity-suite 同梱の差分器で照合する。1 回で 1 部品。replace-strategy setup と .replace/components.md が前提で、未整備なら停止する。「共通部品の見た目の基準を採って」「部品を先に作る」「parity-component」や capture / build を伴う依頼で発動する。
license: MIT
name: parity-component
---
# Parity Component

`replace-strategy` の姉妹スキル。**共通 UI 部品を画面より先に作るときに、その実装の正解になる「現行の部品の見た目」を採り、実装し、部品カタログ上で照合するところまで**を担う。

機能（画面）単位の工程——`parity-suite` の採取、`parity-replace` の実装、`parity-diff` の差分——は**ページが 1 枚できてから**動く。
部品を先に作ると**その時点で対象のページが無く**、採取にも比較にも対象が無い。**空くのはそこだけ**なので、本スキルは部品の分だけを埋め、機能単位の工程には触らない。

## 使い方

```text
parity-component capture [--component <slug>] [--target <name>]
parity-component build   [--component <slug>] [--target <name>]
```

| モード | 対象環境 | 内容 |
|---|---|---|
| `capture` | `side: current` | `.replace/components.md` が挙げた**部品インスタンス（部品 × ページ）ごと**に、要素単位で見た目の基準を採る。採ったインスタンス間から固定軸・可変軸を割り出す |
| `build` | `side: new` | 割り出した軸から引数を設計して部品を実装し、カタログに状態ごとの見本を置き、同条件で採って照合し、差分ゼロまで往復する |

- **1 回の実行につき 1 部品。** 複数部品を並行して進めない（採取・設計・照合が浅くなる）
- `slug` は `.replace/components.md` が採番したもの。**自分で採番しない。** 省略時は未着手から対話選択する
- `--target <name>` の選択規則は `replace-strategy` の `references/project-config.md`「実行対象環境」の「選択規則」に従う（ここへ転記しない）。`capture` は `side: current`、`build` は `side: new` だけを候補にする
- 自然文でも発動する:「共通部品の見た目の基準を採って」「部品を先に作りたい」「この部品を現行と突き合わせて」

## 前提

- **ツール**: `git`、Node.js（Playwright の実行環境）。**`build` は `gh`（GitHub CLI）も要る**——手順 1 で `issue-start` へ委譲してブランチを作るため（`capture` は Issue を操作しないので不要）
- **前提スキル**: `replace-strategy`（`setup` 完了）、`golden-dataset`（フェーズ A 完了）、`parity-suite`（**同梱の差分器と撮影条件の正本を読むため。対象 slug の実行は不要**）。
  `build` は `issue-start`（ブランチ作成の委譲先）と `parity-replace`（敵対的レビューの手順の正本）も使う
- **前提スキルが未インストールの場合**: `gh skill install shoji9x9/skills <name>` で導入してから実行する。
  本スキルは設定スキーマ・差分器・撮影条件の**正本を `replace-strategy` / `parity-suite` に持つ**ため、単体では成立しない
- **MCP**: 不要（現行アプリ・カタログの駆動は Playwright 自身が行う）
- **Playwright（TypeScript）前提**。`parity-suite` が採ったノイズ基準値・撮影条件・差分器をそのまま当てるため、別ランナーでは同一条件を再現できない。使えないプロジェクトでは停止する
- **部品カタログが要る**（`build` のみ）。実体は問わないが契約を満たすこと。契約と設定の解決は [`references/catalog.md`](references/catalog.md)
- **前提の判定（無ければ停止し、該当スキルの実行を促す。捏造しない）**:
  - `replace-strategy setup` 完了 = 設定 `.config/skills/shoji9x9/skills.yml` の `skills.replace-strategy` と `.replace/features.md` の存在
  - **部品インベントリ** = `.replace/components.md` の存在と、対象 slug の行に**インスタンスが 2 つ以上**挙がっていること（[`references/instances.md`](references/instances.md)）
  - `golden-dataset` フェーズ A 完了 = `.replace/dataset/metadata.json` の存在
  - `build` の前提 = 対象 slug の `capture` 完了（`.replace/components/<slug>/metadata.json` の `capture.complete`）**かつ `axes.ok` が真**。
    `capture.complete` だけでは足りない——全インスタンス × 全状態を採っていても、id の重複・未採取の状態・
    片側でしか採れていない軸が残っていれば `axis-diff.mjs` は `ok: false` を返す。
    その `component-api.md` は実装の根拠にならないので、採取へ戻る。
    **`metadata.json` の宣言だけで通さない**——**比較の母集合**（下記）の全組み合わせについて
    **採取が必須とする成果物を漏れなく**確かめる——`baseline/<instance>/<state>/` の
    **要素スクリーンショット・特性・当たっている CSS 規則**の 3 点と、slug 直下の `axes.json` / `component-api.md`。
    **データ依存の部品（`.replace/components.md` の `データ依存: true`）は `baseline/<instance>/data.json` も必須**。
    一部だけ揃った採取を通すと、画素比較の入力やカタログへ注入するデータが無いまま `build` に入る。
    宣言は古い実行の残りでもありうるので、実体が無ければ比較対象が空のまま `build` に入る
- **比較の母集合**（採取・前提判定・見本・照合・完了判定がすべてこの 1 つの定義を使う）:
  **`instances[]` × `capture.states` から、そのインスタンスの `unreachable_states` に宣言された状態を除いた組み合わせ**。
  除外は**宣言が根拠**であり、`metadata.json` の `instances[].unreachable_states` に状態名と理由があり、
  同じ内容が `gaps.md` にも残っていることを確かめる（[`references/instances.md`](references/instances.md)）。
  **宣言の無い欠落は除外にしない**——採り忘れと区別できないので、母集合に含めたまま実体が無いものとして扱い、採取へ戻る。
  **`capture.complete` もこの母集合に対して判定する**（全インスタンス × 全状態ではない。宣言済みの到達不能な組み合わせは数えない）
- **軸の割り出しの対象は母集合とは別**（狭い）: **全インスタンスで到達できる状態**だけが対象になる。
  あるインスタンスで作れない状態は突き合わせる相手が居ないので、固定とも可変とも言えない。
  `axis-diff.mjs` はマニフェストの `instances[].unreachable_states` に宣言された欠落を除外として扱い、
  対象から外した組み合わせを `not_compared` に残す（宣言の無い欠落は従来どおり問題にする）。
  **その組み合わせは照合の母集合からも外れる**——到達できない状態は採れないので基準が無く、見本も作らない
  （[`references/catalog.md`](references/catalog.md)）。外した事実と理由は `gaps.md` に残り、完了報告でも収束と並べて示す。
  **同じ状態でも到達できる別のインスタンスは母集合に残る**（除外はインスタンス単位であって状態単位ではない）

## 厳守の制約（禁止事項）

- **採取していない状態・インスタンスを実装の根拠にしない。** 「ボタンなら hover / disabled があるはず」は採取対象の生成源であって正解ではない。正解は動いている現行アプリ（`parity-suite` の `references/coverage.md`「状態網羅の導出源」と同じ規律）
- **1 インスタンスで測った値を部品の値として固定しない。** 固定と可変は 2 つ以上のインスタンスを突き合わせないと区別できない。インスタンスが 1 つしか無い部品は、**共通部品として先に作る対象にしない**（その機能の実装時に `parity-replace` が作る）
- **計算後スタイルだけで実装しない。** 計算値は「いまの状態の結果」なので、`:hover` の宣言も `!important` の勝ち負けも見えない。当たっている CSS 規則を併せて採る（[`references/capture.md`](references/capture.md)）
- **採取ツールが「読めなかった」と報告した箇所を、無かったことにしない。** `inaccessible`（クロスオリジンのスタイルシート）・`unresolved`（判定できないセレクタ）が非ゼロなら `gaps.md` へ残す。**0 件を「差が無い」の根拠にしない**
- **`component-coverage.json`（`parity-suite` の部品被覆表）を見た目の根拠にしない。** あれは操作と状態の**有無**を数える表で、色・寸法・余白は見ていない。機能が揃っていて見た目が全部違う部品も `present` で埋まる
- **LLM に「差分があるか」を聞かない。** 検出は決定論的ツール（画素・特性照合）の仕事、LLM の仕事は分類（要対応／許容／環境ノイズ）。**「同じに見えます」を収束根拠にしない**
- **現行アプリを変更・駆動の範囲を超えて触らない。** 現行アプリのコード・データを変更しない（正解の基準を動かさないため）。**状態を作る操作は「読み取りだけ」に含まれない**——選択した target の `forbidden_actions` を先に引き、禁止された操作で作る状態は遷移させず `gaps.md` へ残す
- **現行から抜いたデータを、来歴を確かめずにカタログへ持ち込まない。** ゴールデンデータセット由来であることを確認できないデータは使わない（[`references/capture.md`](references/capture.md)「データ依存部品」）
- **カタログ同士・カタログとベンダーの見本を突き合わせない。** 比較の相手は常に現行アプリから採った基準
- **意図的差異レジストリに宣言の無い差を、引数の既定値や個別分岐で吸収しない**（宣言に無い差は `intentional_diffs.pending` へ回してユーザー確認）
- **既存パッケージを探さずに自前実装を始めない。探した結果として自前実装を選ぶのは可**（理由を記録する。正本は `replace-strategy` の `references/dependency-selection.md`）
- **破壊的変更を自分で決めない。** 既存の見本の出力が変わる引数の削除・意味変更は、影響範囲を示してユーザーに判断を求める（[`references/amend.md`](references/amend.md)）
- **シークレットの値をコード・ログ・成果物に残さない。** 環境変数名だけを扱い、値は復唱しない

## プロジェクト設定の解決

設定ファイル `.config/skills/shoji9x9/skills.yml` の `skills.replace-strategy.*` を**直接読む**（転記しない）。スキーマの正本は `replace-strategy` の `references/project-config.md`。本スキルが読む・書くキー:

| キー | 用途 |
|---|---|
| `targets` | 実行対象環境。`capture` は `side: current`、`build` は `side: new` から `--target` で選ぶ。`pre_commands` / `start` / `check_urls` があれば起動・稼働確認に使う |
| `targets[].catalog_url` / `targets[].catalog_url_command` | **新側 target の部品カタログの baseURL**（`build` でどちらか 1 つが必須）。固定文字列は `catalog_url`、実行ごとに変わる環境は `catalog_url_command`（`url` / `url_command` と同じ排他・解決規則）。両方あるのも、どちらも無いのも推測せず停止してユーザーに確認する（契約は [`references/catalog.md`](references/catalog.md)） |
| `targets[].auth.roles` / `targets[].forbidden_actions` | 現行 target のロール別認証情報（環境変数の**名前**）と、実施しない操作。**`capture` も `forbidden_actions` を引く**——`checked` / `selected` / `error` の状態はクリック・送信でしか作れず、採取自体は読み取りでも**状態を作る操作は書き込みになりうる**。禁止された操作で作る状態は遷移させず `gaps.md` へ残す |
| `references.component_catalog` | **カタログの契約ドキュメントのパス**。実体（Storybook 等）・見本の書き方・データの注入経路・URL の決まり方を書く。**未整備なら `build` に入らず停止し、整備を促す**（カタログの実体をスキルが勝手に決めない） |
| `references.ui_library` | 新 UI ライブラリ設定と旧→新 design token マッピング。**未整備なら `build` の手順 5（テーマ寄せ）に入らず停止する**（源流で系統差を縮められず、宣言と未検証が膨らむ）。**ゲートの位置は手順 5 の直前**であり手順 1 ではない——手順 1〜4（前提検証・引数設計・部品の採否・実装）はこのファイルを読まないので、そこで止めると必要のない停止になる。正本の手順は `parity-replace` の `references/theming.md` |
| `references.architecture` | 新側アプリの骨格の決定記録。**未整備なら `build` に入らず停止する**（部品は骨格の上に載るため） |
| `references.coding_conventions` | 部品・見本を書くときに従う規約。**未整備でも停止しないが、推測で自分の流儀を持ち込まない**——基底ドキュメント・リント設定・既存コードから読み取る |
| `references.dependency_policy` | 依存導入の方針（**三値**。`none` と欠落を同一視しない）。**キー欠落＝未確認**のときだけ、ユーザーに要否を確認した結果を同キーへ非破壊追記する |
| `new.stack` | 新側スタックの列挙。部品の候補がスタックと両立するかの判断に使う。空・欠落なら推測せずユーザーに確認し、結果を同キーへ非破壊追記する |
| `intentional_diffs.{keep,may_change,pending}` | 意図的差異レジストリ。発見した差は `pending` へ**追記元が分かる形で**非破壊追記しユーザー確認（`slug` は対象の部品 slug、`added_by: parity-component`、`added_at` に追記日）。`keep` / `may_change` へ移すのは人間 |
| `component_diffs` | テーマで消せない構造差の系統差レジストリ。**宣言の正本は `parity-replace`**（`references/theming.md`）。本スキルは**読んで照合の正規化に使うだけ**で、書くときは同じ手順（ユーザー確認）を通す |
| `artifacts.{retention,storage,size_threshold_mb,overrides.<slug>}` | 大きなバイナリの保存先既定と部品ごとの上書き |
| `verification_commands` | 実装・見本に通す検証コマンド。**通すのは `full`（全体走査）**。`full` キーが無いか、**`verification_commands` 自体の値がリスト**（旧形式＝走る範囲が未宣言）なら **`build` の完了判定が成立しないため停止する**。**`full` の値がコマンドのリストであるのは新形式であり正常**（`full` / `diff` の 2 列に分かれていれば移行済み。判別の正本はスキーマ文書「`verification_commands` の形の変更」） |
| `parity_suite_dir` | パリティスイートの配置（未指定時 `e2e/`）。差分器のコピー先と、カタログ採取スペックの置き場所の起点にする |
| `secrets.wrapper` | シークレットが要るコマンドの前置ラッパー |

- **旧キーはフォールバックとして読まない。** スキーマ正本の「移行」節に列挙された旧キーを見つけたら、同節の対応表を示して停止する

## 実行フロー（capture）

詳細は各 reference へ委譲する。番号順に進める。

1. **前提検証と早期失敗**: 上記「前提」を実測で判定し、欠ければ捏造せず停止して該当スキルの実行を促す。
   `slug` を `.replace/components.md` と突き合わせ（無い slug は停止。自分で採番しない）、現行 target を確定して稼働を確認する（`check_urls` → 落ちていれば `pre_commands` → `start` → 再確認）
2. **採取対象の確定**: `.replace/components.md` の対象行から**インスタンス（部品 × ページ）**と各インスタンスの論理名を引く。
   **インスタンスが 2 件未満、またはページ・論理名が空の行は採取へ進まない**（固定と可変を区別できないため）。不足は `replace-strategy` 側で埋めるようユーザーに促す。詳細: [`references/instances.md`](references/instances.md)
3. **保存先検証**: `artifacts`（`overrides.<slug>` を考慮）の書き込み可否を**撮影前に**検証し、不可なら早期に失敗する（全部撮ってから保存できないと分かるのを避ける）
4. **状態の列挙**: 採る状態を部品の規範的な資料と現行 UI から列挙する。**資料は生成源であって正解ではない**（導出源の正本は `parity-suite` の `references/coverage.md`「状態網羅の導出源」）。
   **列挙する候補の状態集合は全インスタンスで共通**にする——片方で採らなかった状態は「差が無い」ではなく「測っていない」になる。
   **例外は到達できない状態だけ**。そのインスタンスで作れない状態は、禁止された遷移を試さず `unreachable_states` に理由付きで宣言し、
   比較の母集合と軸の割り出しの両方から外す（[`references/instances.md`](references/instances.md)）
5. **採取**: インスタンス × 状態ごとに 4 点を採る。要素単位のスクリーンショット、計算後スタイル（`parity-suite` 同梱の trait-capture.mjs）、**当たっている CSS 規則**（同梱の [`scripts/css-rules-capture.mjs`](scripts/css-rules-capture.mjs)）、データ依存部品なら可視行の実データ。
   撮影条件は `parity-suite` の `references/baseline.md` に従い、**同一条件で 2 回撮ってノイズ基準値を出す**（2 回目の採取物は基準値を記録したら削除する）。詳細: [`references/capture.md`](references/capture.md)
6. **固定軸・可変軸の割り出し**: 採取物から `node <skill>/scripts/axis-diff.mjs <manifest> --out <path>` を **exit 0 まで通す**（**コピーせずスキル配下のスクリプトをそのまま実行する**）。
   未採取・片側のみ・id 重複は問題として落ちるので、採取へ戻して埋める。**問題を残したまま「可変軸なし」を結論にしない**。詳細: [`references/component-api.md`](references/component-api.md)
7. **成果物記録**: `component-api.md`（固定・可変の割り出しと引数の候補）・`metadata.json`（撮影条件・ノイズ基準値・ツール版・データセット版・`capture.complete`）・`gaps.md`（採れなかった箇所と理由）を書く。
   `inaccessible` / `unresolved` が非ゼロなら必ず `gaps.md` に残す

## 実行フロー（build）

1. **前提検証と着手**: `capture` 完了と `references.architecture` / `references.component_catalog` / `verification_commands.full` を実測し、欠ければ停止する。
   対象 slug に対応する `.replace/components.md` の **Issue 列の番号**で `issue-start <番号>` を実行してブランチを作る（`--commit` / `--pr` は付けない）。未起票なら停止して `replace-strategy issues` を促す。
   **使うのはブランチ作成・checkout までで、その後の調査・実装は `issue-start` に委ねず本スキルの実行フローとして進める**——
   モード未指定の `issue-start` はそのまま実装へ進む契約なので、委ねると同じ Issue に対して実装が二重に走る
2. **引数の設計**: `component-api.md` の可変軸を**引数（props）へ、固定軸を実装の定数へ**割り付ける。状態を表す引数（`disabled` 等）も可変軸として扱う。
   **軸を引数にしない判断をしたら理由を書く**（インスタンス差が現行の不整合で、揃えることをユーザーが決めた場合など。その場合は `intentional_diffs.pending` へ回す）。詳細: [`references/component-api.md`](references/component-api.md)
3. **部品の採否と依存の決定**: このフェーズで要る部品を**自前で書くか／どのパッケージを使うか**を実装に入る前に決め、`.replace/dependencies.md` へ**非破壊追記**する。
   判断材料・順序・リポジトリ方針の扱いは `replace-strategy` の `references/dependency-selection.md` に従う。`setup` で決定済みの部品はここで再決定しない
4. **実装と見本**: 現行のソースコードと採取物を一次情報源に実装し、**インスタンス × 状態ごとに見本（story 等）を置く**。見本は採取と同じ状態集合を持たせる——見本の無い状態は照合されない。
   データ依存部品は `capture` が採った実データを見本の入力にする。書き方は `references.coding_conventions` に従う。詳細: [`references/catalog.md`](references/catalog.md)
5. **見た目の系統差を源流で縮める**: **`references.ui_library` が未整備（キー欠落・空値・解決できないパス）ならここで停止し、整備を促す**（推測でライブラリを決めない）。
   整備済みならトークンマッピングで旧 design token を新側テーマへ寄せる。テーマで消せない構造差の扱い（`component_diffs` 宣言か `gaps.md`）は `parity-replace` の `references/theming.md` が正本
6. **敵対的レビュー**: **ローカルの未コミット差分**に対し commit 前に実施する。実装役とレビュー役を分離し、レビュー役には判断の基準だけ（差分・現行コード・採取物・規約・レジストリ）を渡す。
   手順の正本は `parity-replace` の `references/adversarial-review.md`。**サブエージェントを起動できないことを省略の理由にしない**（差分だけを人間のレビュアーへ渡す代替を取る）
7. **カタログ採取と照合**: カタログを現行と同一条件で採り、`parity-suite` 同梱の差分器（画素・特性照合）で基準と突き合わせる。
   差分は決定論的ツールが出し、LLM は 1 件ずつ分類（要対応／許容／環境ノイズ）する。要対応は手順 4 へ戻す。詳細: [`references/compare.md`](references/compare.md)
8. **完了判定**: **未説明差分ゼロ**（要対応が 0 件で、許容は全件が `intentional_diffs` か `component_diffs` の宣言に紐づく）＋ **`verification_commands.full` が通る**＋ **比較の母集合（上記「前提」）の全組み合わせに対応する見本があり、全件を照合した**こと。
   実行した検証コマンドと結果、反復回数を **`.replace/components/<slug>/new/<target>/build-metadata.json`**（環境別）へ記録する。commit / push / PR は `issue-start` が解決した規約に従う（`issue-start` の実装ステップへ再入しない）

## 成果物

すべて対象プロジェクト側に置く。**スキーマの正本は本スキル**（テンプレート: [`assets/`](assets/)）。ただし部品インベントリ `.replace/components.md` の正本は `replace-strategy`（生産側）。

| 成果物 | 場所 | 正本テンプレート |
|---|---|---|
| 見た目の基準（インスタンス × 状態） | `.replace/components/<slug>/baseline/` | — |
| 当たっている CSS 規則 | `.replace/components/<slug>/baseline/<instance>/<state>/css-rules.json` | — |
| 引数の設計（固定・可変の割り出し） | `.replace/components/<slug>/component-api.md` | [`assets/component-api-template.md`](assets/component-api-template.md) |
| メタデータ・ノイズ基準値 | `.replace/components/<slug>/metadata.json` | [`assets/metadata-template.json`](assets/metadata-template.json) |
| 照合と往復の記録 | `.replace/components/<slug>/parity.md` | [`assets/parity-template.md`](assets/parity-template.md) |
| 完了証跡（**環境別**） | `.replace/components/<slug>/new/<target>/build-metadata.json` | [`assets/build-metadata-template.json`](assets/build-metadata-template.json) |
| 未検証領域 | `.replace/components/<slug>/gaps.md` | 様式の正本: `parity-suite` の `assets/gaps-template.md` |
| 依存の決定記録 | `.replace/dependencies.md` へ**非破壊追記**（無ければテンプレートから作成） | 様式の正本: `replace-strategy` の `assets/dependencies-template.md` |
| 実装・見本 | 新側リポジトリ（`references.architecture` の構成に従う） | — |

- テキスト成果物（特性 JSON・CSS 規則 JSON・`metadata.json`・`component-api.md`・`parity.md`・`gaps.md`）は Git。スクリーンショット等の大きなバイナリは `artifacts` 設定に従い、既定 `local`（コミットしない）
- **ノイズ測定の 2 回目の採取物は成果物ではない。** 基準値を `metadata.json.noise_baseline` へ記録したら削除する（正本: `parity-suite` の `references/baseline.md`）
- **差分器・特性採取ツールは `parity-suite` 同梱を正本として使う**（本スキルで再実装しない）。実行時は `<parity_suite_dir>/parity/lib/tools/vendor/` へコピーし、実際のパスを `metadata.json` に記録する
- **[`scripts/css-rules-capture.mjs`](scripts/css-rules-capture.mjs) と [`scripts/axis-diff.mjs`](scripts/axis-diff.mjs) はコピーしない。** スキル配下のスクリプトをそのまま実行する（`gh skill update` の自動更新を効かせる）

## 姉妹スキルとの連携

- **依存順**: `replace-strategy`（`setup`。手順 10 で部品インベントリを作る）→ `golden-dataset`（フェーズ A）→ **`parity-component`（`capture` → `build`）** → 各機能で〔`parity-suite` → `parity-replace` → `golden-dataset`（フェーズ B）→ `parity-diff`〕。
  **部品を画面より先に作らない方針のプロジェクトでは本スキルを使わない**（機能ごとに `parity-replace` が部品も作る）
- **`replace-strategy` から受け取るもの**: `.replace/components.md`（部品 / slug / インスタンス / 採否 / データ依存の有無 / Issue 番号）。**本スキルはこのファイルを書かない**（Issue 番号の書き戻しは `replace-strategy issues` の担当）
- **`parity-suite` から受け取るもの**: 特性採取ツールと差分器、撮影条件・ノイズ基準値の規約、状態網羅の導出源の規律。**対象 slug の `parity-suite` 実行は前提にしない**（部品の採取にページ単位のスイートは要らない）
- **`parity-suite` へ渡すもの**: 無い。ただし機能の採取が始まったら、部品の基準は**そのインスタンスの現側ベースラインと同じ現行アプリ**を指しているので、データセットのバージョンが上がったら両方が陳腐化する（`metadata.json` の `dataset_version` で検出する）
- **`parity-replace` との関係**: 機能の実装中に共通部品へ手を入れる必要が出たときの規律は [`references/amend.md`](references/amend.md) が正本で、`parity-replace` はそこへ委譲する。
  敵対的レビュー・テーマ寄せの手順は逆に `parity-replace` の references が正本で、本スキルが委譲する
- **`parity-diff` との関係**: 本スキルの照合は**カタログ上の部品単体**が対象で、画面に載せた後の差分は `parity-diff` が見る。
  部品が単体で合っていても画面では合わないこと（周囲の余白・親の指定の継承）はありうるので、**本スキルの収束を機能の収束の代わりにしない**
