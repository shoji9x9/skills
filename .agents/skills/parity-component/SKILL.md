---
argument-hint: <capture | build> [--component <slug>] [--target <name>] [--autonomous]
description: 仕様を変えないアプリケーションリプレイスで、共通 UI 部品を画面より先に作るときに、現行アプリから部品の見た目の基準を採り、実装し、部品カタログ上で照合する replace-strategy の姉妹スキル。採取の単位は部品インスタンス（部品 × ページ）で、要素単位のスクリーンショット・状態別の計算後スタイル・当たっている CSS 規則・データ依存部品の実データを採る。インスタンス間で値が割れた軸を可変（引数）、割れない軸を固定として決定論的に割り出し、実装後はカタログを同条件で採って parity-suite 同梱の差分ツールで照合する。1 回で 1 部品。replace-strategy setup と .replace/components.md が前提で、未整備なら停止する。「共通部品の見た目の基準を採って」「部品を先に作る」「parity-component」や capture / build を伴う依頼で発動する。
license: MIT
name: parity-component
---
# Parity Component

`replace-strategy` の姉妹スキル。共通 UI 部品を画面より先に作るときに、その実装の正解になる「現行の部品の見た目」を採り、実装し、部品カタログ上で照合するところまでを受け持つ。

機能（画面）単位の工程は、ページが 1 枚できてから動く。工程は `parity-suite` の採取、`parity-replace` の実装、`parity-diff` の差分である。
部品を先に作ると、その時点では対象のページが無いので、採取する対象も比較する対象も無い。
足りないのはそこだけなので、このスキルは部品の分だけを埋め、機能単位の工程には触らない。

## 使い方

```text
parity-component capture [--component <slug>] [--target <name>] [--autonomous]
parity-component build   [--component <slug>] [--target <name>] [--autonomous]
```

| モード | 対象環境 | 内容 |
|---|---|---|
| `capture` | `side: current` | `.replace/components.md` が挙げた部品インスタンス（部品 × ページ）ごとに、要素単位で見た目の基準を採る。採ったインスタンスを突き合わせて、固定軸と可変軸を割り出す |
| `build` | `side: new` | 割り出した軸から引数を設計して部品を実装する。カタログに状態ごとの見本を置き、同じ条件で採って照合し、差分がゼロになるまで往復する |

- 1 回の実行で扱うのは 1 部品である。複数の部品を並行して進めない（採取・設計・照合が浅くなる）。
- `--autonomous` は、その実行だけを自律で進めるという宣言である（下の「自律実行」）。省略したときは、判断のたびに確認する。
- `slug` は `.replace/components.md` が採番したものを使い、自分で採番しない。省略したときは、まだ着手していない部品から対話で選ぶ。
- `--target <name>` の選び方は、`replace-strategy` の `references/project-config.md`「実行対象環境」の「選択規則」に従う（ここへ転記しない）。`capture` は `side: current` だけを、`build` は `side: new` だけを候補にする。
- 自然文でも発動する。例は「共通部品の見た目の基準を採って」「部品を先に作りたい」「この部品を現行と突き合わせて」である。

## 前提

- ツール: `git` と Node.js（Playwright の実行環境）。
  `build` には `gh`（GitHub CLI）も要る。手順 1 で `issue-start` に任せてブランチを作り、手順 8 で部品の Issue を再取得して受け入れ条件を突き合わせるためである。`capture` は Issue を操作しないので要らない。
- 前提スキル: `replace-strategy`（`setup` が完了していること）、`golden-dataset`（フェーズ A が完了していること）、`parity-suite`。
  `parity-suite` は、同梱の差分ツールと、撮影条件を定義した原本を読むために使う。対象の slug で `parity-suite` を実行しておく必要は無い。
  `build` では、`issue-start`（ブランチの作成と受け入れ条件の突き合わせを任せる先。`--branch-only` と `--acceptance` で呼ぶ）と、`parity-replace`（敵対的レビューの手順の原本）も使う。
- 前提スキルがインストールされていなければ、`gh skill install shoji9x9/skills <name>` で入れてから実行する。
  設定スキーマ・差分ツール・撮影条件の原本は `replace-strategy` と `parity-suite` にあるので、このスキルだけでは動かない。
- MCP: 要らない。現行アプリとカタログは Playwright 自身が操作する。
- Playwright（TypeScript）を前提にする。`parity-suite` の撮影条件の規約・差分ツール・特性採取ツールをそのまま当てるためで、別のランナーでは同じ条件を再現できない。Playwright を使えないプロジェクトでは停止する。
  ノイズ基準値は、`parity-suite` の実行を待たずに `capture` の中で自分で測る（[`references/capture.md`](references/capture.md)「ノイズ基準値」）。
  機能単位の `parity-suite` は部品より後に実行されるので、その結果を前提にすると部品を先に作れなくなる。
- 部品カタログが要る（`build` だけ）。実体は問わないが、取り決めを満たしていること。取り決めと設定の解決は [`references/catalog.md`](references/catalog.md) にある。
- 前提を次のように判定する。無ければ停止し、該当するスキルの実行を促す。無いものを作り出さない。
  - `replace-strategy setup` の完了は、設定 `.config/skills/shoji9x9/skills.yml` の `skills.replace-strategy` と `.replace/features.md` が在ることで判定する。
  - 部品インベントリは、`.replace/components.md` が在り、対象の slug の行にインスタンスが 2 つ以上挙がっていることで判定する（[`references/instances.md`](references/instances.md)）。
  - `golden-dataset` のフェーズ A の完了は、`.replace/dataset/metadata.json` が在ることで判定する。
  - setup とフェーズ A は、まだ解決していない保留があれば、証拠があっても完了していないものとして扱う。どの保留を見るかは、`replace-strategy` の `references/autonomy.md`「下流の前提判定」で定義する。
  - `build` の前提は、対象の slug の `capture` が完了していること（`.replace/components/<slug>/metadata.json` の `capture.complete`）と、`axes.ok` が真であることの両方である。
    `capture.complete` だけでは足りない。全インスタンス × 全状態を採っていても、id の重複・採っていない状態・片側でしか採れていない軸が残っていれば、`axis-diff.mjs` は `ok: false` を返す。
    そのときの `component-api.md` は実装の根拠にならないので、採取へ戻る。
  - `metadata.json` の宣言だけで通さない。下の「比較の母集合」のすべての組み合わせについて、採取で必須の成果物がすべて揃っていることを確かめる。
    `baseline/<instance>/<state>/` には、要素のスクリーンショット（`element.png`）・撮影の記録（`element.shot.json`）・特性（`traits.json`）・当たっている CSS 規則（`css-rules.json`）の 4 点が要る。
    slug の直下には `axes.json` と `component-api.md` が要る。ファイル名まで固定するのは、名前を決めないと前提を機械的に判定できず、在るはずのものを人が目で探すことになるからである。
  - データ依存の部品（`.replace/components.md` で `データ依存: true`）は、`baseline/<instance>/data.json` も必須である。
  - 操作の結果の `baseline/<instance>/behaviors.json` も、全インスタンスで必須である。ただし、`capture.operations_none_reason` で操作の無い部品と宣言した場合は除く。
    この時点では突き合わせ表がまだ無いので、`behavior-compare.mjs` は `comparison-missing` で必ず exit 1 になる。
    そのため終了コードでは判定せず、ほかの finding（`behavior-baseline-*`・`unreachable-declaration-invalid`）が 0 件であることで判定する。残っていれば、`build` の前に `capture` へ戻す。
  - 動きの時系列の `baseline/<instance>/motions.json` も、全インスタンスで必須である。ただし、`capture.motions.none_reason` で動きの無い部品と宣言した場合は除く。
    `capture.motions` 自体が無ければ、`motion-compare.mjs` が形式の誤り（exit 2）で失敗するので、動きを数えていない部品は `capture` へ戻す。
    判定は操作の結果と同じく、`comparison-missing` 以外の finding が 0 件であることで行う。
    対象の finding は `motion-baseline-*`・`motion-noise-missing`・現行側の `motion-timeline-invalid` と `motion-probe-version-mismatch`・`unreachable-declaration-invalid` である。
  - 一部だけ揃った採取を通すと、画素比較の入力やカタログに入れるデータが無いまま `build` に入る。
    宣言は古い実行の残りの場合もあるので、実体を見ずに通すと、比較の対象が空のまま `build` に入る。
- 比較の母集合: 採取・前提の判定・見本・照合・完了判定は、すべて次の 1 つの定義を使う。
  母集合は、`instances[]` × `capture.states` の組み合わせから、そのインスタンスの `unreachable_states` に宣言された状態を除いたものである。
  除くかどうかの根拠は宣言である。`metadata.json` の `instances[].unreachable_states` に状態名と理由があり、同じ内容が `gaps.md` にも残っていることを確かめる（[`references/instances.md`](references/instances.md)）。
  宣言の無い欠けは除かない。採り忘れと区別できないので、母集合に含めたまま実体が無いものとして扱い、採取へ戻る。
  `capture.complete` も、全インスタンス × 全状態ではなく、この母集合に対して判定する。宣言済みの到達できない組み合わせは数えない。
- 軸の割り出しの対象は、母集合より狭い。全インスタンスで到達できる状態だけが対象になる。
  あるインスタンスで作れない状態は、突き合わせる相手が居ないので、固定とも可変とも言えない。
  `axis-diff.mjs` は、マニフェストの `instances[].unreachable_states` に宣言された欠けを除外として扱い、対象から外した組み合わせを `not_compared` に残す（宣言の無い欠けは問題にする）。
  外れるのは「そのインスタンス × その状態」の組み合わせだけで、照合の母集合からも同じ単位で外れる。
  到達できない状態はそのインスタンスで採れないので基準が無く、見本も作らない（[`references/catalog.md`](references/catalog.md)）。
  同じ状態でも、到達できる別のインスタンスは母集合に残り、そのインスタンスの見本は作る。
  状態ごと落とすと、採れている基準が照合されないまま消える。外した事実と理由は `gaps.md` に残し、完了報告でも収束と並べて示す。

## 厳守の制約（禁止事項）

- 採取していない状態とインスタンスを、実装の根拠にしない。
  「ボタンなら hover と disabled があるはず」は、採取する対象を挙げる材料であって、正解ではない。
  正解は動いている現行アプリである（`parity-suite` の `references/coverage.md`「状態網羅の導出源」と同じ考え方）。
- 1 つのインスタンスで測った値を、部品の値として固定しない。固定と可変は、2 つ以上のインスタンスを突き合わせないと区別できない。
  インスタンスが 1 つしか無い部品は、共通部品として先に作る対象にしない（その機能を実装するときに `parity-replace` が作る）。
- 計算後スタイルだけで実装しない。計算値は「今の状態の結果」なので、`:hover` の宣言も `!important` の勝ち負けも見えない。
  当たっている CSS 規則も併せて採る（[`references/capture.md`](references/capture.md)）。
- 採取ツールが「読めなかった」と報告した箇所を、無かったことにしない。
  `inaccessible`（クロスオリジンのスタイルシート）と `unresolved`（判定できないセレクタ）が 0 でなければ、`gaps.md` に残す。0 件を「差が無い」の根拠にしない。
- `component-coverage.json`（`parity-suite` の部品の網羅表）を、見た目の根拠にしない。
  この表は操作と状態の有無を数える表で、色・寸法・余白は見ていない。機能が揃っていて見た目が全部違う部品も、`present` で埋まる。
- 見た目の照合を、操作の結果の根拠にしない。状態ごとの見た目が全部一致していても、操作した結果（全選択になる・チェックが残る・書き出しで失敗する）は別の測定である。
  操作の結果を示すのは、`behavior-compare.mjs` の突き合わせだけである。
- 「アニメーションは対象外」として、部品の動きを済ませない。見た目の照合は動きを止めて撮るので、動きの有無も長さも示さない。
  部品ごとに動きを数え、時系列を `motion-compare.mjs` で突き合わせる（[`references/motion.md`](references/motion.md)）。
  同じように、毎回同じ順で描く照合とスイートは、部品の一生の順番で不具合が出ることを示さない（[`references/lifecycle.md`](references/lifecycle.md)）。
- LLM に「差分があるか」を聞かない。差分の検出は決定論的なツール（画素の比較・特性の照合）が行い、LLM は分類（要対応・許容・環境ノイズ）だけを行う。
  「同じに見えます」を収束の根拠にしない。
- 現行アプリには、操作して状態を作る範囲を超えて触らない。正解の基準を変えないため、現行アプリのコードとデータを変更しない。
  状態を作る操作は「読み取りだけ」に含まれない。選択した target の `forbidden_actions` を先に読み、禁止された操作で作る状態には遷移せず、`gaps.md` に残す。
- 現行から抜き出したデータを、出所を確かめずにカタログへ持ち込まない。ゴールデンデータセットから来たと確かめられないデータは使わない（[`references/capture.md`](references/capture.md)「データ依存部品」）。
- カタログ同士や、カタログとベンダーの見本を突き合わせない。比べる相手は、常に現行アプリから採った基準である。
- 意図的差異レジストリに宣言の無い差を、引数のデフォルト値や個別の分岐で吸収しない。宣言に無い差は `intentional_diffs.pending` へ回して、ユーザーに確認する。
- 既存のパッケージを探さずに、自前の実装を始めない。探した結果として自前の実装を選ぶのはよい。そのときは理由を記録する（原本は `replace-strategy` の `references/dependency-selection.md`）。
- 部品の Issue の受け入れ条件を、利用者に確認せずに外さない。
  確認してから決めるのは、受け入れ条件と違う実装にすることと、受け入れ条件に当たる観点や検証を飛ばすことである。
  たとえば、現行に無い振る舞い（フォーカスの閉じ込め・キーボード操作・引数のデフォルト値など）を「現行に合わせる」という理由で外すことが当たる。
  飛ばす前に、元に戻す手段を探し、探した結果を判断材料に書く。
  コードの注記・`gaps.md`・`parity.md` に「条件を満たさない理由」を書いたら、同じ内容を判断待ちにも積む。注記は「理由を書いた」形になり、照合もレビューもそれ以上を求めないからである。
  この取り決めの原本は、`replace-strategy` の `references/autonomy.md`「受け入れ条件から外れる判断」である。
- 破壊的な変更を自分で決めない。既存の見本の出力が変わる引数の削除や意味の変更は、影響範囲を示してユーザーに判断を求める（[`references/amend.md`](references/amend.md)）。
- シークレットの値を、コード・ログ・成果物に残さない。環境変数の名前だけを扱い、値は書き写さない。

## プロジェクト設定の解決

設定ファイル `.config/skills/shoji9x9/skills.yml` の `skills.replace-strategy.*` を直接読む（転記しない）。
スキーマの原本は `replace-strategy` の `references/project-config.md` である。このスキルが読み書きするキーは次のとおりである。

| キー | 用途 |
|---|---|
| `targets` | 実行対象環境。`capture` は `side: current`、`build` は `side: new` の中から `--target` で選ぶ。`pre_commands`・`start`・`check_urls` があれば、起動と稼働の確認に使う |
| `targets[].catalog_url` / `targets[].catalog_url_command` | 新側の target の部品カタログの baseURL。`build` ではどちらか 1 つが必須である。固定の文字列なら `catalog_url`、実行ごとに変わる環境なら `catalog_url_command` を使う（`url` / `url_command` と同じく、両方は書けず、解決の規則も同じ）。両方あるときも、どちらも無いときも、推測せずに停止してユーザーに確認する（取り決めは [`references/catalog.md`](references/catalog.md)） |
| `targets[].auth.roles` / `targets[].forbidden_actions` | 選択した target の、ロールごとの認証情報（環境変数の名前）と、実施しない操作。`capture`（現行の target）と `build`（新側の target のカタログ）の両方で読む。保護されたカタログは、認証しないと見本に到達できないからである。`storageState` の作り方とロール名の扱いの原本は、`parity-suite` の `references/auth.md` である。`capture` も `forbidden_actions` を読む。`checked`・`selected`・`error` の状態はクリックや送信でしか作れず、採取自体は読み取りでも、状態を作る操作は書き込みになることがある。禁止された操作で作る状態には遷移せず、`gaps.md` に残す |
| `references.component_catalog` | カタログの取り決めを書いた文書のパス。実体（Storybook など）・見本の書き方・データの入れ方・URL の決まり方を書く。整備されていなければ `build` に入らずに停止し、整備を促す。カタログの実体を、スキルが勝手に決めない |
| `references.ui_library` | 新しい UI ライブラリの設定と、旧→新の design token の対応表。整備されていなければ、`build` の手順 5（テーマ寄せ）に入らずに停止する。源流で系統差を縮められず、宣言と未検証が増えるからである。止める位置は手順 5 の直前で、手順 1 ではない。手順 1〜4（前提の検証・引数の設計・部品の採否・実装）はこのファイルを読まないので、そこで止めると要らない停止になる。手順の原本は `parity-replace` の `references/theming.md` である |
| `references.architecture` | 新側のアプリの骨格の決定記録。部品は骨格の上に載るので、整備されていなければ `build` に入らずに停止する |
| `references.coding_conventions` | 部品と見本を書くときに従う規約。整備されていなくても停止しないが、推測で自分の流儀を持ち込まない。基底ドキュメント・リントの設定・既存のコードから読み取る |
| `references.dependency_policy` | 依存を入れるときの方針。値は 3 つあり、`none` とキーが無いことを同じに扱わない。キーが無い（まだ確認していない）ときだけ、ユーザーに要否を確認し、その結果を同じキーに追記する（既存の値は消さない） |
| `new.stack` | 新側のスタックの一覧。部品の候補がスタックと両立するかの判断に使う。空かキーが無ければ、推測せずにユーザーに確認し、その結果を同じキーに追記する（既存の値は消さない） |
| `intentional_diffs.{keep,may_change,pending}` | 意図的差異レジストリ。見つけた差は、誰が足したか分かる形で `pending` に追記し（既存の値は消さない）、ユーザーに確認する。書くキーは 4 つで、差の文言の `item`（照合のキー）、`slug`、`added_by: parity-component`、追記した日の `added_at` である。`slug` には `cross-cutting` を書く。`slug` は機能の slug の名前空間なので、部品の slug を書くとどの機能の棚卸しでも対象外になり、いつまでも棚卸しされない。`item` を別のキー名で書くと、追記のときは通り、数工程後の `parity-diff` の棚卸しで「`item` が空」として現れる。`keep` と `may_change` へ移すのは人である。例外は、静的資産で「同等物を作る」を選んだときの宣言で、ユーザーの承認を得てから `may_change` に追記する（`pending` を通さない。原本は `replace-strategy` の `references/static-assets.md`） |
| `component_diffs` | テーマで消せない構造の差を登録する、系統差のレジストリ。宣言の原本は `parity-replace`（`references/theming.md`）である。このスキルは、読んで照合の正規化に使うだけで、書くときは同じ手順（ユーザーの確認）を通す |
| `artifacts.{retention,storage,size_threshold_mb,overrides.<slug>}` | 大きなバイナリの保存先のデフォルトと、部品ごとの上書き |
| `verification_commands` | 実装と見本に通す検証コマンド。通すのは `full`（全体を調べる）である。`full` キーが無いとき、または `verification_commands` 自体の値がリスト（実行する範囲を宣言していない古い形）のときは、`build` の完了を判定できないので停止する。`full` の値がコマンドのリストなのは新しい形で、正常である（`full` と `diff` の 2 列に分かれていれば移行済み。見分け方の原本は、スキーマの文書の「`verification_commands` の形の変更」） |
| `parity_suite_dir` | パリティスイートの置き場所（指定が無ければ `e2e/`）。差分ツールのコピー先と、カタログを採るスペックの置き場所の起点にする |
| `secrets.wrapper` | シークレットが要るコマンドの前に付けるラッパー |

- 古いキーを代わりに読まない。スキーマの原本の「移行」の節に挙がった古いキーを見つけたら、同じ節の対応表を示して停止する。

## 自律実行（`--autonomous`）

自律実行の規約（宣言・越えない線・停止の 2 分類・保留の記録の形・最後にまとめて聞く手順）の原本は、`replace-strategy` の `references/autonomy.md` である（ここへ転記しない）。
このファイルを読めないときは自律実行せず、確認のたびに止まる。このスキルに固有の扱いは次のとおりである。

- 対象の選択（`--component` を省いたときと、デフォルトの無い `--target`）は保留にせず、候補を示して停止する。記録先が slug と target で決まるためである（原本の「宣言」）。
- 判断待ち（保留に積む）にするものは次のとおりである。
  - 同梱ツールのコピー先が同梱版と一致しないときの扱い
  - インスタンス間で割れているが、区別する理由が見つからない軸（現行の不整合）を揃えるか
  - 部品の依存の決定（`new.stack` が空のときを含む）
  - 台帳に無い静的資産の方針
  - 部品の Issue の受け入れ条件と違う実装と、受け入れ条件に当たる観点の省略（上の「厳守の制約」）
  - 受け入れ条件の突き合わせ（`build` の手順 8）の結果を Issue にコメントし、チェックを付けること（外向きの操作）
- 保留に積んでも進める工程がある。割れた軸の扱いが保留なら、その軸を含まない引数の設計・実装・見本の採取は進め、その軸に依存する見本の照合は行わない。
- 記録先は `pending_decisions[]` と `run.autonomous` である。
  ファイルは、`capture` なら `.replace/components/<slug>/metadata.json`、`build` なら `.replace/components/<slug>/new/<target>/build-metadata.json` である。
  まだ解決していない保留が残る間は、`capture.complete` を `true` にしない。`build` は収束したと報告せず、`loop.stopped_reason` に判断待ちを書く。
- `build` の敵対的レビューの手順（`parity-replace` の `references/adversarial-review.md`）で、サブエージェントを起動できないときは「人のレビュアーへ渡す」ことになる。これも判断待ちに積む。

## 実行フロー（capture）

詳しい手順は、それぞれの reference に任せる。番号の順に進める。

1. 前提を検証し、早めに失敗する。上の「前提」を実測で判定し、欠けていれば、無いものを作り出さずに停止して、該当するスキルの実行を促す。
   `slug` を `.replace/components.md` と突き合わせる（無い slug なら停止する。自分で採番しない）。
   現行の target を決めて、稼働を確かめる（`check_urls` で確かめ、落ちていれば `pre_commands` → `start` を実行して、もう一度確かめる）。
   稼働を確かめたら、次に認証する。選択した target が `auth.roles` を持つなら、`parity-suite` の `references/auth.md` に従って、ロールごとの `storageState` を用意し、そのロールで採る。
   ここを飛ばすと、保護された画面で論理名が 1 件も解決せず、「部品が無い」と「ログインしていない」を取り違える。
   使ったロール名は、`metadata.json` の `capture.auth_roles` と `instances[].auth_role` に記録する。ロール名は、設定と成果物を通して同じ名前を使い、読み替えない。
   認証が要るのにできないときは、推測で先へ進まずに停止する。
2. 採取の対象を決める。`.replace/components.md` の対象の行から、インスタンス（部品 × ページ）と、各インスタンスの論理名を読む。
   インスタンスが 2 件より少ない行と、ページか論理名が空の行は、固定と可変を区別できないので採取に進まない。
   足りない分は `replace-strategy` の側で埋めるよう、ユーザーに促す。詳しくは [`references/instances.md`](references/instances.md) にある。
3. 保存先を検証する。`artifacts`（`overrides.<slug>` を含む）に書き込めるかを撮影の前に確かめ、書き込めなければ早めに失敗する。全部撮ってから保存できないと分かるのを避けるためである。
4. 状態を列挙する。採る状態を、部品の規範となる資料と現行の UI から挙げる。
   資料は、状態を挙げる材料であって正解ではない（材料の原本は、`parity-suite` の `references/coverage.md`「状態網羅の導出源」）。
   資料が 1 つにまとめている状態でも、現行が描き分けているなら分けて採る（単一選択と範囲選択・複数選択など。同じ原本の同じ節）。
   候補の状態の集合は、全インスタンスで共通にする。片方で採らなかった状態は、「差が無い」ではなく「測っていない」になるからである。
   例外は到達できない状態だけである。そのインスタンスで作れない状態は、禁止された遷移を試さずに `unreachable_states` に理由と一緒に宣言し、比較の母集合と軸の割り出しの両方から外す（[`references/instances.md`](references/instances.md)）。
5. 採取する。先に、`parity-suite` 同梱の特性採取ツールをプロジェクトの側に用意する（[`references/capture.md`](references/capture.md)「`parity-suite` 同梱ツールの用意」）。用意できなければ停止する。
   インスタンス × 状態ごとに、次の 4 点を採る。
   - 要素単位のスクリーンショット。`parity-suite` 同梱の element-shot.mjs を使う。`locator.screenshot()` は外接する整数の矩形に丸めるので使わない。
   - 計算後スタイル。`parity-suite` 同梱の trait-capture.mjs を使う。
   - 当たっている CSS 規則。同梱の [`scripts/css-rules-capture.mjs`](scripts/css-rules-capture.mjs) を使う。
   - データ依存の部品なら、見えている行の実データ。

   撮影条件は `parity-suite` の `references/baseline.md` に従う。同じ条件で 2 回撮ってノイズ基準値を出す（2 回目の採取物は、基準値を記録したら削除する）。詳しくは [`references/capture.md`](references/capture.md) にある。

   見た目に加えて、操作の結果も採る。部品の機能表から操作を挙げて `metadata.json` の `capture.operations` に書く。
   インスタンスごとに現行で操作し、観測した結果の状態（画素ではない）を `baseline/<instance>/behaviors.json` に書く。
   見た目の照合は、操作の結果を 1 件も示さない。詳しくは [`references/behavior.md`](references/behavior.md) にある。

   部品に掛かる動きも数えて採る。現行のソースと実機の両方で動きを数え、`capture.motions` に書く。
   動きのある遷移は、同梱の motion-probe.mjs で、インスタンスごとに同じ条件で 2 回採り、`baseline/<instance>/motions.json` に書く。2 回の差が揺れで、許容差の根拠になる。
   動きの無い部品は `none_reason` を書く。
   動きが終わってから始まる処理（フォーカス・タイマー・操作の受け付けの開始）は、操作として挙げる。詳しくは [`references/motion.md`](references/motion.md) にある。
6. 固定軸と可変軸を割り出す。`node <skill>/scripts/axis-diff.mjs --baseline .replace/components/<slug>/ --out .replace/components/<slug>/axes.json` を、exit 0 になるまで通す。
   マニフェストは手で組まない。このスクリプトが、採取物から決定論的に組み立てる。コピーせず、スキルの中のスクリプトをそのまま実行する。
   採っていないもの・片側だけのもの・id の重複は問題として報告されるので、採取へ戻して埋める。問題を残したまま「可変軸なし」と結論しない。
   詳しくは [`references/component-api.md`](references/component-api.md) にある。
7. 成果物を記録する。書くものは次の 3 つである。
   - `component-api.md`: 固定と可変の割り出しと、引数の候補
   - `metadata.json`: 撮影条件・ノイズ基準値・ツールの版・データセットの版・`capture.complete`
   - `gaps.md`: 採れなかった箇所と理由

   `inaccessible` か `unresolved` が 0 でなければ、必ず `gaps.md` に残す。

## 実行フロー（build）

1. 前提を検証して着手する。`capture` の完了と、`references.architecture`・`references.component_catalog`・`verification_commands.full` を実測し、欠けていれば停止する。
   採取物が古くなっていないかも、あわせて判定する。宣言だけを見ると、古い基準の上に実装して「一致した」と報告することになる。
   判定は 2 段で行う。先に設定の宣言と採取物の実体を全部調べ、欠けがあれば、下の 3 項目（古くなっていないかの判定）に進まずに、見つけた欠けをすべて挙げて停止する。
   宣言と実体はプロジェクトの中のファイルを読むだけで決まるが、古くなっていないかの判定は `parity-suite` 同梱ツールなど、外の実体に依存する。
   順番を決めないと、外の実体のせいで先に止まった実行が宣言の欠けを報告せず、利用者は直して再実行するたびに別の欠けに当たる。
   - ツールの版を比べる。`metadata.json` の `capture.tools` に記録された版と集合を、今使うツールの実際の版と集合と突き合わせる。
     版は `traits_version`・`element_shot_version`・`css_rules_version`・`axis_diff_version`・`motion_probe_version`（動きのある部品だけ）で、集合は `traits_property_set` である。
     違っていれば実装に進まず、`capture` からやり直す。採取のスキーマが違う基準は、比較の入力にならない。
   - 軸を導き直す。`node <skill>/scripts/axis-diff.mjs --baseline .replace/components/<slug>/ --out <一時パス>` を実行し、exit 0 で、記録済みの `axes.json` と一致することを確かめる。
     `metadata.json` の `axes.ok` と、`axes.json` が在ることだけでは、採取物が変わった後の古い軸や、手で直した軸がそのまま引数の設計に渡る（出力からは区別できない）。
   - データセットの版を比べる（データ依存の部品だけ）。`metadata.json` の `dataset_version` と今の版の間の `changes[].affects` が、その部品の実効参照テーブルと交差するなら、古くなっている。
     版の数値が古いだけでは、古くなったと判定しない。無関係なテーブルが変わるたびに、採り直しを強いることになるからである。
     導き方の規則と、導けないときに停止する取り決めの原本は、`golden-dataset` の `references/versioning.md` である。

   選択した新側の target が `auth.roles` を持つなら、カタログに到達する前に、`capture` と同じやり方で `storageState` を用意する（原本は `parity-suite` の `references/auth.md`）。
   対象の slug に対応する `.replace/components.md` の Issue 列の番号で、`issue-start <番号> --branch-only` を実行してブランチを作る。まだ起票されていなければ停止して、`replace-strategy issues` を促す。
   `--branch-only` は外さない。モードを指定しない `issue-start` は、ブランチを作った後そのまま実装へ進む取り決めなので、任せると同じ Issue に対して実装が二重に実行される。実装は、このスキルの手順 2 以降が受け持つ。
2. 引数を設計する。`component-api.md` の可変軸を引数（props）に、固定軸を実装の定数に割り当てる。状態を表す引数（`disabled` など）も、可変軸として扱う。
   軸を引数にしないと判断したら、理由を書く。たとえば、インスタンスの差が現行の不整合で、揃えることをユーザーが決めた場合である。その場合は `intentional_diffs.pending` へ回す。
   詳しくは [`references/component-api.md`](references/component-api.md) にある。
3. 部品の採否と依存を決める。このフェーズで要る部品を自前で書くか、どのパッケージを使うかを実装に入る前に決める。決めたことは `.replace/dependencies.md` に追記する（既存の行は消さない）。
   判断の材料・順番・リポジトリの方針の扱いは、`replace-strategy` の `references/dependency-selection.md` に従う。`setup` で決めた部品は、ここで決め直さない。
   台帳は、`状態` が `有効` の行だけを読む。`取り消し済み` は履歴である。同じ部品で `有効` が 2 行あれば、進まずに確認する。
   `内蔵` の行の部品は、単体で実装しない。「採用したもの」列のパッケージに含まれるので、そのパッケージを採ったことを確かめて使う。採らないことになっていたら、決定が覆ったものとして扱い、決め直す。
   `機能固有` の行は、このスキルの対象外である（機能を実装するときに `parity-replace` が決める）。
   決定が覆ったら、古い行の `状態` を `取り消し済み` にしてから、新しい行を追記する。値の意味・覆り方・読む側の規則の原本は、`replace-strategy` の `references/dependency-selection.md`「洗い出しの 6 値」である。
   部品が描く静的資産（アイコン・画像・書体）は、`.replace/assets.md` の同じ種類で、状態が `有効` の行に従う（`取り消し済み` の行は履歴）。部品の中でコピーするかどうかを決めない。
   台帳に無ければ、方針を空けた行を追記してユーザーに確認し、決まるまでその資産に依存する実装を進めない。原本は `replace-strategy` の `references/static-assets.md` である。
4. 実装し、見本を置く。現行のソースコードと採取物を一次情報として実装し、インスタンス × 状態ごとに見本（story など）を置く。
   見本には、採取と同じ状態の集合を持たせる。見本の無い状態は照合されない。
   CSS の値を実装に転記する前に、`css-rules.json` の `matched` と `inline_declarations` の両方から、実際に勝っている宣言を確定する。
   同梱の `node <skill>/scripts/cascade-resolve.mjs --css-rules <path> --state <state> --all` を通し、`undecidable` が残ったら、現行の CSS を直接読んで決める。
   インラインの値が `!important` 付きの規則に負ける形と、後に読み込まれるテーマの再宣言が前のものを上書きする形は、目で見ると取り違えやすい。
   詳しくは [`references/catalog.md`](references/catalog.md)「勝っている宣言を確定してから転記する」にある。
   データ依存の部品は、`capture` が採った実データを見本の入力にする。書き方は `references.coding_conventions` に従う。詳しくは [`references/catalog.md`](references/catalog.md) にある。

   実装したら、部品の一生の順番で不具合が出る流れの対象かを判定する。対象になるのは、次の 3 つがそろうときである。
   - 初期化を 1 度しか通らず、その後の変化を自分で受け直す。
   - その流れを、既存の検査が通らない。
   - 不具合が出る処理を名指しできる。

   対象なら、4 つの実行パスのうち名指しできるものに、順番を強制する見本と検査を置き、`build-metadata.json` の `lifecycle` に記録する。
   検査は、その流れに入った回数（`data-*` 属性）を先に確かめてから、症状を見る。
   この見本は見た目の照合の見本ではないので、`catalog.stories` に載せず、`parity.unbaselined_stories` にも数えない。詳しくは [`references/lifecycle.md`](references/lifecycle.md) にある。
5. 見た目の系統差を源流で縮める。`references.ui_library` が整備されていない（キーが無い・値が空・パスを解決できない）なら、ここで停止して整備を促す。推測でライブラリを決めない。
   整備されていれば、トークンの対応表で、古い design token を新側のテーマに寄せる。
   テーマで消せない構造の差の扱い（`component_diffs` に宣言するか、`gaps.md` に書くか）は、`parity-replace` の `references/theming.md` で定義する。
6. 敵対的レビューをする。commit の前に、ローカルの commit していない差分をレビューする。実装役とレビュー役を分け、レビュー役には判断の基準（差分・現行のコード・採取物・規約・レジストリ）だけを渡す。
   手順の原本は、`parity-replace` の `references/adversarial-review.md` である。サブエージェントを起動できないことを、レビューを省く理由にしない。差分だけを人のレビュアーへ渡す方法に切り替える。
7. カタログを採って照合する。カタログを現行と同じ条件で採り、`parity-suite` 同梱の差分ツール（画素の比較・特性の照合）で基準と突き合わせる。
   差分は決定論的なツールが出し、LLM は 1 件ずつ分類（要対応・許容・環境ノイズ）する。要対応は手順 4 へ戻す。詳しくは [`references/compare.md`](references/compare.md) にある。

   操作の結果も突き合わせる。`capture` と同じ操作を、見本で同じ手順で行い、`new/<target>/behavior-comparison.json` に書く。
   次に `node <skill>/scripts/behavior-compare.mjs --baseline .replace/components/<slug>/ --comparison <その表> --target <target>` を通す。
   一致しないものは要対応として手順 4 へ戻す。現行の挙動を引き継がないと判断するなら、利用者に上げる。詳しくは [`references/behavior.md`](references/behavior.md) にある。

   動きも突き合わせる。`capture` と同じ遷移を、見本で同じ版のプローブで採り、`new/<target>/motion-comparison.json` に書く。
   次に `node <skill>/scripts/motion-compare.mjs --baseline .replace/components/<slug>/ --comparison <その表> --target <target>` を通す。
   一致しないものは要対応として手順 4 へ戻す。動きを引き継がないと判断するなら、利用者に上げる。詳しくは [`references/motion.md`](references/motion.md) にある。
8. 完了を判定する。次のすべてを満たしたら完了である。
   - 説明できない差分が 0 件である。要対応が 0 件で、許容は全件が `intentional_diffs` か `component_diffs` の宣言に結び付いている。
   - `verification_commands.full` が通る。
   - 比較の母集合（上の「前提」）のすべての組み合わせに対応する見本があり、全件を照合した。
   - 母集合に対応しない見本（基準の無い見本）が 0 件である（[`references/catalog.md`](references/catalog.md)「現行に無い見た目を見本に作らない」）。
   - `behavior-compare.mjs` が exit 0 である（操作の結果に、突き合わせていないものと一致しないものが 0 件）。
   - `motion-compare.mjs` が exit 0 である（動きに、突き合わせていないものと一致しないものが 0 件）。
   - 一生の順番で不具合が出る流れの対象なら、次のすべてを満たす。
     - `lifecycle.paths[]` の全件で検査が通る。
     - 各検査が、症状より先に、その流れに入ったこと（回数が 1 以上）を確かめている。
     - 直した処理を外すと検査が失敗することを確かめてある。
     - 順番の見本を、`catalog.stories` にも `unbaselined_stories` にも入れていない。

     記録は、`node <skill>/scripts/lifecycle-check.mjs --build-metadata <build-metadata.json>` が exit 0 になることで確かめる。
     このスクリプトは、4 つの実行パスの振り分けの抜けと重複も報告する。対象でない部品にも実行する（[`references/lifecycle.md`](references/lifecycle.md)「完了判定」）。
   - 部品の Issue の受け入れ条件の突き合わせが exit 0 である。

   受け入れ条件の突き合わせが要るのは、上のほかの判定がどれも採取物との照合で、部品の Issue にだけ書かれた条件（フォーカスの閉じ込め・キーボード操作・引数のデフォルト値など）を数えないからである。
   手順 1 で使った `.replace/components.md` の Issue 列の番号で、次のコマンドを実行する。

   ```text
   issue-start <番号> --acceptance --out .replace/components/<slug>/new/<target>/acceptance.json --decisions .replace/components/<slug>/new/<target>/build-metadata.json
   ```

   - 渡す前に、`build-metadata.json` の `verification` と `pending_decisions` を確定して commit する。commit していない変更が残ると、表が根拠の版を固定できない。
   - 検査の結果は、後から同じファイルの `acceptance` に書く。`loop.stopped_reason` もこのときに書き、次の commit に含める。検査の前に「収束」と書かない。
   - 表を作り直すときは、`commit` をその時点の HEAD にする。手順と表の様式の原本は、`issue-start` の `references/acceptance.md` である。
   - `--allow-later` は渡さない。部品の Issue の条件は、すべてこのスキルの完了で満たす条件だからである（`replace-strategy` の `references/features-issues.md`「共通部品 Issue」）。
     後の工程の `parity-diff` は画面の収束を見る工程なので、部品の条件を引き受けない（下の「姉妹スキルとの連携」の「`parity-diff` との関係」）。後の工程へ回すと、どの工程も数えないまま Issue が閉じる。
   - 満たせない条件は自分で外さず、判断待ちに積み（上の「厳守の制約」）、その行を `pending-decision` にする。
   - 番号を機能の行と共有していて、機能の条件が表に入るときは、`later` に回さず、停止して利用者に確認する。
     行と Issue は 1 対 1 であることが前提である。原本は、`replace-strategy` の `references/features-issues.md`「起票の後に行と受け入れ条件を突き合わせる」である。
   - `issue-start` がインストールされておらず、任せる先に到達できないときは、合格として扱わずに完了を止め、入れる手順（`gh skill install shoji9x9/skills issue-start`）を示す。
   - 結果を Issue にコメントし、チェックを付ける手順は、`issue-start` の `references/acceptance.md` の手順 7 に従う。自律実行では行わず、保留に積む。

   完了報告には、次のものを並べる。
   - 受け入れ条件の突き合わせの、行ごとの状態と根拠の強さ（実測か読解か）。`pending-decision` と `deferred` の行も省かない。
   - 比べなかった操作と遷移（到達できない・承認を得て残した）と、挙げた範囲の外の挙動を引き受ける工程。収束と並べて示す（[`references/behavior.md`](references/behavior.md)「完了報告に書くこと」、[`references/motion.md`](references/motion.md)「射程」）。

   実行した検証コマンドと結果、反復の回数を、`.replace/components/<slug>/new/<target>/build-metadata.json`（環境ごと）に記録する。
   commit・push・PR は、`issue-start` が解決した規約に従う。`issue-start` の実装の手順には入り直さない。

## 成果物

すべて対象のプロジェクトの側に置く。スキーマの原本はこのスキルで、テンプレートは [`assets/`](assets/) にある。
ただし、部品インベントリ `.replace/components.md` の原本は、それを作る `replace-strategy` である。

| 成果物 | 場所 | 原本のテンプレート |
|---|---|---|
| 要素のスクリーンショット | `.replace/components/<slug>/baseline/<instance>/<state>/element.png` | — |
| 撮影の記録（clip・PNG の実寸） | `.replace/components/<slug>/baseline/<instance>/<state>/element.shot.json`（element-shot.mjs が PNG と対で書く） | — |
| 計算後スタイル | `.replace/components/<slug>/baseline/<instance>/<state>/traits.json` | — |
| 当たっている CSS 規則 | `.replace/components/<slug>/baseline/<instance>/<state>/css-rules.json` | — |
| データ依存の部品の実データ | `.replace/components/<slug>/baseline/<instance>/data.json` | — |
| 操作の結果（現行） | `.replace/components/<slug>/baseline/<instance>/behaviors.json` | [`assets/behaviors-template.json`](assets/behaviors-template.json) |
| 操作の結果の突き合わせ（環境ごと） | `.replace/components/<slug>/new/<target>/behavior-comparison.json` | [`assets/behavior-comparison-template.json`](assets/behavior-comparison-template.json) |
| 動きの時系列（現行） | `.replace/components/<slug>/baseline/<instance>/motions.json` | [`assets/motions-template.json`](assets/motions-template.json) |
| 動きの突き合わせ（環境ごと） | `.replace/components/<slug>/new/<target>/motion-comparison.json` | [`assets/motion-comparison-template.json`](assets/motion-comparison-template.json) |
| 引数の設計（固定と可変の割り出し） | `.replace/components/<slug>/component-api.md` | [`assets/component-api-template.md`](assets/component-api-template.md) |
| メタデータとノイズ基準値 | `.replace/components/<slug>/metadata.json` | [`assets/metadata-template.json`](assets/metadata-template.json) |
| 照合と往復の記録 | `.replace/components/<slug>/parity.md` | [`assets/parity-template.md`](assets/parity-template.md) |
| 完了の証跡（環境ごと） | `.replace/components/<slug>/new/<target>/build-metadata.json` | [`assets/build-metadata-template.json`](assets/build-metadata-template.json) |
| 受け入れ条件の突き合わせ表（環境ごと） | `.replace/components/<slug>/new/<target>/acceptance.json` | 様式と検査の原本は、`issue-start` の `assets/acceptance-template.json` と `scripts/acceptance-check.mjs` |
| 未検証の領域 | `.replace/components/<slug>/gaps.md` | 様式の原本は、`parity-suite` の `assets/gaps-template.md` |
| 依存の決定の記録 | `.replace/dependencies.md` に追記する（既存の行は消さない。無ければテンプレートから作る） | 様式の原本は、`replace-strategy` の `assets/dependencies-template.md` |
| 静的資産の台帳への追記 | `.replace/assets.md` に、台帳に無い資産を方針を空けて追記し（既存の行は消さない）、ユーザーが決めた方針を記録する（無ければテンプレートから作る） | 様式の原本は、`replace-strategy` の `assets/assets-template.md` |
| 実装と見本 | 新側のリポジトリ（`references.architecture` の構成に従う） | — |

- テキストの成果物は Git で管理する。対象は、特性の JSON・CSS 規則の JSON・操作の結果の JSON・動きの時系列の JSON・`metadata.json`・`component-api.md`・`parity.md`・`gaps.md`・`new/<target>/acceptance.json` である。
  スクリーンショットなどの大きなバイナリは `artifacts` の設定に従い、デフォルトは `local`（commit しない）である。
- ノイズを測るための 2 回目の採取物は、成果物ではない。基準値を `metadata.json.noise_baseline` に記録したら削除する（原本は `parity-suite` の `references/baseline.md`）。
- 差分ツールと特性採取ツールは、`parity-suite` 同梱のものを原本として使い、このスキルで実装し直さない。実行するときは `<parity_suite_dir>/parity/lib/tools/vendor/` にコピーし、実際のパスを `metadata.json` に記録する。
  このスキルは機能単位の `parity-suite` より先に実行されるので、コピーが無いのが普通である。
  インストール済みの `parity-suite` から用意する方法と、既存のコピーが同梱版と違うときに停止する取り決めは、[`references/capture.md`](references/capture.md)「`parity-suite` 同梱ツールの用意」にある。
- 次のスクリプトはコピーせず、スキルの中のものをそのまま実行する。`gh skill update` で自動で更新されるようにするためである。
  - [`scripts/css-rules-capture.mjs`](scripts/css-rules-capture.mjs)
  - [`scripts/axis-diff.mjs`](scripts/axis-diff.mjs)
  - [`scripts/behavior-compare.mjs`](scripts/behavior-compare.mjs)
  - [`scripts/motion-compare.mjs`](scripts/motion-compare.mjs)
  - [`scripts/lifecycle-check.mjs`](scripts/lifecycle-check.mjs)
- [`scripts/motion-probe.mjs`](scripts/motion-probe.mjs) だけはコピーする。Playwright のスペックから import するためである。
  `parity-suite` 同梱のツールと同じ置き場所に、同じ一致の確認をして用意する（[`references/motion.md`](references/motion.md)「時系列を採る」）。

## 姉妹スキルとの連携

- 依存の順番: 全体の順番の原本は、`replace-strategy` の `SKILL.md`「姉妹スキルと依存順」である（ここへ転記しない）。
  このスキル（`capture` → `build`）の直前は `golden-dataset`（フェーズ A。部品インベントリは `replace-strategy setup` の手順 10 が作る）で、直後は各機能の `parity-suite` である。
  部品を画面より先に作らない方針のプロジェクトでは、このスキルを使わない（機能ごとに `parity-replace` が部品も作る）。
- `replace-strategy` から受け取るもの: `.replace/components.md`（部品・slug・インスタンス・採否・データ依存の有無・Issue 番号）。
  このスキルはこのファイルを書かない。Issue 番号を書き戻すのは `replace-strategy issues` である。
- `parity-suite` から受け取るもの: 特性採取ツールと差分ツール、撮影条件とノイズ基準値の規約、状態網羅の導出源の考え方。
  対象の slug で `parity-suite` を実行しておくことは前提にしない。部品の採取に、ページ単位のスイートは要らない。
- `parity-suite` へ渡すものは無い。ただし、機能の採取が始まったら、部品の基準は、そのインスタンスの現行側のベースラインと同じ現行アプリを指している。
  データセットの版が上がったときに部品の基準が古くなるかは、版の数値だけでは決まらない。
  記録した版から今までの `changes[].affects` が、その部品の実効参照テーブルと交差するときだけ、古くなったと判定する（原本は `golden-dataset` の `references/versioning.md`）。
  部品の slug の実効参照テーブルは、インスタンスのページ → `features.md` のページ一覧 → 機能の slug → テーブルの順にたどり、和集合をとって求める。
- `parity-replace` との関係: 機能の実装中に共通部品を変える必要が出たときの取り決めは、[`references/amend.md`](references/amend.md) で定義し、`parity-replace` はそこに任せる。
  逆に、敵対的レビューとテーマ寄せの手順は `parity-replace` の references が原本で、このスキルがそこに任せる。
- `parity-diff` との関係: このスキルの照合の対象は、カタログ上の部品単体である。画面に載せた後の差分は `parity-diff` が見る。
  部品が単体で合っていても、画面では合わないことがある（周りの余白・親の指定の継承）。このスキルの収束を、機能の収束の代わりにしない。
