---
argument-hint: '[--feature <slug>] [--target <name>] [--max-iterations <n>] [--autonomous]'
description: 仕様を変えないアプリケーションリプレイスで、parity-suite が定義した論理名に対し新側を実装する replace-strategy の姉妹スキル。担うのは 3 つ——機能をページ単位のフェーズに分割し、新側ロケータマッピングの例外を充填し、実装役と分離した敵対的レビューを未コミット差分にかける。ブランチ作成・commit・PR は issue-start へ委譲。現行コードを一次情報源に読み確信度を申告し、スイートの新側 green・検証コマンド・Issue の受け入れ条件の照合が通れば完了（差分ゼロは parity-diff との往復の終了条件）。対象環境は --target で選び、証跡は環境別に残す。1 回で 1 機能。replace-strategy setup・golden-dataset・対象 slug の parity-suite 完了が前提で、未完了なら停止する。「新側を実装して」「parity-replace」や --feature / --target / --max-iterations を伴う依頼で発動する。
license: MIT
name: parity-replace
---
# Parity Replace

`replace-strategy` の姉妹スキル。意図的に薄くした層で、リプレイスに固有の次の 3 つだけを担う。

1. ページ単位への分割（機能 Issue の中でのフェーズ分け）
2. 新側ロケータマッピングの充填（`parity-suite` が定義した論理名に対して。例外だけを書く）
3. 敵対的レビュー（実装役とレビュー役を分け、未コミット差分に対して行う）

実装の流れそのもの（ブランチ作成・調査・commit・push・PR）は `issue-start` に委譲し、このスキルでは作り直さない。
差分の検出は `parity-diff`、パリティスイートの構築は `parity-suite` が担う。

## 使い方

```text
parity-replace [--feature <slug>] [--target <name>] [--max-iterations <n>] [--autonomous]
```

- 1 回の実行で扱うのは 1 機能である。ページをまたいで並行に実装しない。並行にすると調査・実装・比較が浅くなり、差異を見落とす
- `slug` は `.replace/features.md` が採番したものを使い、自分で採番しない。省略したときは、features.md の未着手の機能から対話で選ぶ
- モードは `.replace/parity/<slug>/metadata.json` の `mode`（feature / api-resource / batch）から読む。フラグは無く、features.md の表の位置から導き直さない。
  `mode` は、`parity-suite` が features.md の分類（下の表の起点）から記録している
- `--target <name>`（任意）: 実装して検証する新側の実行対象環境。設定 `targets` のうち `side: new` のものだけを候補にする（このスキルが対象とする側は、ここで定義する）。
  省略したときのデフォルト・候補の提示・存在しない名前や側の違いで止まることなどの選択規則は、`replace-strategy` の `references/project-config.md`「実行対象環境」の「選択規則」に従う（ここへ転記しない）
- `--max-iterations <n>`（任意、デフォルト 5）: `parity-diff` との往復ループの反復の上限。超えたら止まり、ユーザーに判断を求める
- `--autonomous` は、その実行だけを自律で進める宣言である（下の「自律実行」）。省略したときは、判断のたびに確認する

| モード | 起点 | 内容 |
|---|---|---|
| 機能（feature） | features.md の機能 | ページ単位にフェーズを分ける。新側マッピング・視覚系を含む全工程を使う |
| 横断 API（api-resource） | features.md の横断 API リソース | 画面を持たない API だけ。バックエンドの diff レビューと API スイートの green だけで、ページ分割・視覚・新側マッピングは無い |
| バッチ（batch） | features.md のバッチ | バッチ本体の diff レビューと、出力の一致。画面系の工程は動かさない |

- 自然文でも発動する（「新側を実装して」「リプレイスの実装を進めて」「この差分レポートから続きを直して」）。

## 前提

- ツール: `git`。ブランチ作成・commit・push・PR は `issue-start` が行う（このスキルは実装の流れを作り直さない）
- 前提スキル: `issue-start`（実装の流れと受け入れ条件の突き合わせの委譲先）、`replace-strategy`（`setup` の完了）、`golden-dataset`（フェーズ A の完了）、対象 slug の `parity-suite`（完了）
- 前提スキルがインストールされていない場合: `gh skill install shoji9x9/skills <name>` で導入してから実行する。
  このスキルは設定スキーマ・成果物の様式の原本を `replace-strategy` と `parity-suite` の `references/`・`assets/` に置いているので、単体では動かない（同時に導入されている前提である）
- MCP: 不要
- 新側アーキテクチャは事前に決まっている前提に立つ。骨格（フレームワーク・レイヤとディレクトリの構成・API の設計方針・ホスティングの構成）の選定はスキル群の対象外である。
  新側リポジトリには骨格がスキャフォールドされている前提で、このスキルは決定記録（`references.architecture`）を読んで従うだけで、決めない
  （原本は `replace-strategy` の `references/project-config.md`「新側アーキテクチャ」）
- 実行環境の能力: 敵対的レビュー（手順 7）は必須の工程である。実装役とは別のサブエージェント（Agent ツールなど）をレビュー役として起動できる必要がある。
  起動できない実行環境や、起動のたびにユーザーの承認が要る実行環境では、着手する前に可否を確かめる（工程 7 で初めて分かる事態を避けるため）。
  起動できない場合は、差分だけを人間のレビュアーへ渡してレビューを受け、記録を `review.md` に残す（レビュー役が人間だったことを書く）。
  この代わりの方法も取れないときでも、レビューは省略しない（手順は [`references/adversarial-review.md`](references/adversarial-review.md)）
- 前提の判定（無ければ止まり、該当するスキルの実行を促す。成果物を捏造しない）:
  - `replace-strategy setup` の完了は、設定 `.config/skills/shoji9x9/skills.yml` の `skills.replace-strategy` と `.replace/features.md` があることで判定する
  - `golden-dataset` のフェーズ A の完了は、`.replace/dataset/metadata.json` があることで判定する（`version` は 1 から始まる整数）
  - 対象 slug の `parity-suite` の完了は、`.replace/parity/<slug>/metadata.json` があることで判定する。
    `suite.current_green` と `differ.validated_by_strength_gate` がどちらも `true` であることも求める（`parity-diff` の前提確認と同じ条件）
  - 上の setup・フェーズ A・`parity-suite` と、下のフェーズ B（slug × target）は、未解決の保留があれば、証拠があっても未完了として扱う。
    見る保留の範囲の原本は `replace-strategy` の `references/autonomy.md`「下流の前提判定」
  - `golden-dataset` のフェーズ B は、新側スキーマが確定した後の実行で、選んだ target が投入対象のときだけ判定する。
    `.replace/dataset/metadata.json` の `phase_b.<slug>.<target>.dataset_version` があり、その版より後の `changes[].affects` が slug の実効参照テーブルと交差しないことで判定する。
    影響する変更があれば、`golden-dataset --phase b --feature <slug> --target <target>` を先に実行する。数値が古いだけなら投入し直さない。
    判定の取り決めは `golden-dataset` の `references/versioning.md` を参照する
  - 投入対象は、設定の `dataset_mode` で決まる。`db`（デフォルト）なら `db.seedable: true` の target だけ、`static` ならすべての target である（取り決めの原本は `replace-strategy` の `references/project-config.md`）。
    投入対象でない target はフェーズ B の対象外である（投入しないので要らない。データの整合を確かめていないことは `parity-diff` が扱う）
- パスは推測せず、`.replace/parity/<slug>/metadata.json` から読む（スイート・現側マッピング・操作アダプタの実際のパス）。`slug` は `.replace/features.md` から読み、自分で採番しない

## 厳守の制約（禁止事項）

- 仕様の確認は、十分な証拠が得られる最もコストの低い方法から始める。調べる順は次のとおりで、下位の証拠だけでは実装の判断を確定できない場合に限って次へ進む。
  1. 選んだ target から採取し、前提のチェックで対象の版・採取の時点・条件の一致を確かめたパリティ成果物と観測記録
  2. 現行のソースコード
  3. API の実際の動作
  4. UI の実際の動作

  調査のコストはこの順に高くなるので、必要な証拠が得られた時点で止め、API や UI の操作は足りないときだけ行う。
  設計書・仕様書・受領ログを含む受領資料は、調査の候補を挙げるのに使ってよいが、現行の挙動を確定する根拠にはしない。UI に固有の表示と操作は、UI で確定する

- パリティスイートが無い状態で実装を始めない。判定の基準が無ければ、何をもって完了とするかを決められない
- 推測で実装しない。判断できない箇所は `TODO` などでコード上に未解決と書き、レビューへ回す。間違ったコードより、未解決と書いてあるほうがよい
- DB の方言差を点検せずに、クエリやデータアクセスを書かない。書く前に `references.db_semantics` の点検表を読む（整備されていなければ、スキーマ文書「DB 意味論」の点検項目そのものを読む）。
  該当するか・しないかと対応を、`porting.md` へ記録する。「型検査もテストも通った」を点検の代わりにしない。
  絞り込みが全件の取得に変わるような差は、データの件数が少ないとスイートが green のまま残り、実装後の敵対的レビューで見つけると手戻りが最も大きい
- 新側アーキテクチャ（骨格）を自分で決めない。整備されていなければ実装の工程に入らずに止まり、事前に決めるよう促す
  （既存の実装から読み取った内容を下書きとして示すのはよい。確定は必ずユーザーが行う）
- IaC（CDK・Terraform など）は、実装に付随する差分だけを触る。テーブルの追加・ルートの追加など、新側の実装に要る差分は書いてよい。パイプラインや基盤を新しく作ることはしない
  （事前の条件である。区分の原本は `replace-strategy` の `references/scope.md`「スキルが行う作業の範囲」）。付随の範囲を超えると判断したら、止まってユーザーに判断を求める。
  書いた付随の差分は、敵対的レビューと `verification_commands.full`（`cdk synth`・`terraform validate` など）に通す。パリティスイートは IaC を検証しないので、この 2 つだけが担保になる。
  `verification_commands` は環境に依存しないコードの検証に限る規約なので、認証情報・リモートの state・実環境への問い合わせが要るコマンド（`terraform plan` など）は入れない
- すでに作られた共通部品を、他の利用箇所への影響を測らずに直さない。目の前の画面を直す変更は、別の画面の見た目を警告なしに変え、その画面のスイートができるまで誰も失敗に気付かない。
  切り分け・直し方・破壊的変更の判断の原本は `parity-component` の `references/amend.md` である（`parity-component` を使っていないプロジェクトでは、共通部品も機能ごとに作るので、この規律は当てはまらない）
- 既存のパッケージを探さずに、自前の実装を始めない。探した結果として自前の実装を選ぶのはよい（理由を記録する）
- 移行元の静的資産（画像・アイコン・favicon・ロゴ・図・書体）をどう扱うかを、機能の中で決めない。
  - `.replace/assets.md` の同じ種類で、状態が `有効` の行に従う（`取り消し済み` の行は履歴なので従わない）
  - 台帳に無ければ、方針を空欄にした行を追記する。3 つの方針（`実体をコピーする`／`同等物を作る`／`コピーしない`）と、それぞれの再配布の可否・残る差を添えてユーザーに確認する
  - 決まるまで、その資産に依存する実装単位は進めない（`porting.md` に判断を書いて進めることはせず、台帳の行を指す 1 行だけを残す）
  - `display: none` の `img` を、表示されないからといって描かないと決めない。同じ場所を、疑似要素のグリフが描いていることがある。
    棚卸し・判断・宣言の原本は `replace-strategy` の `references/static-assets.md`
- 配布元の素性とライセンスを確かめないまま、依存を追加しない（実装が進むほど、差し替えのコストが上がる）。判断の材料と工程の原本は `replace-strategy` の `references/dependency-selection.md`
- 確信度の申告を、迷ったときだけに限らない。実装単位ごとに、常に高・中・低を `porting.md` へ申告する（「低」は、おそらく間違っているので、レビューで現行を読み直す必要があることを表す）
- モデルが「同じに見えます」と言ったことを、完了の根拠にしない
- このスキルの完了（新側 green）を、「現行と一致」と報告しない。スイートが見るのは値・ラベル・役割で、余白・幅・罫線・背景・色・寸法・配置は `parity-diff` が担う。
  - 現行との比較が収束した（見た目も含めて比べ終えた）と報告できるのは、同じ target の `parity-diff` が `.replace/parity/<slug>/new/<target>/diff-metadata.json` を `converged: true` にした後である
  - そのときも無条件の「一致」とは書かない。収束したことと、承認済みの例外・意図的差異・未検証の領域を並べて報告する
    （収束は生の差分がゼロであることを求めない。原本は `parity-diff` の `references/convergence.md`「収束の定義」）
  - 収束する前に `parity-diff` が止まった（要対応・他の機能待ち・判断待ち・反復の上限）ときは、その差分と止まった理由をそのまま報告してよい。禁じるのは、一致や収束を主張することだけである
  - 報告の書き方は、手順 8 の「完了の報告」に従う
- 撮影したビューポートで測った px を並べて、版組を作らない。3 つの比較方法はその 1 点でしか比べないので、1 点の px を並べた版組は、すべての比較方法で緑のまま、別の窓の幅で崩れる。
  位置と寸法は、`parity-suite` が読み取った式（`metadata.json` の `capture_conditions.dimension_model.fits`）で組み、完了の判定で `dimension-fit.mjs check` を通す（手順 8）
- 振る舞いを保つことと、品質を改善することを、同じフェーズで狙わない。レガシーの奇妙な挙動も再現する
- リントを off にして差異を避けない。ロケータマッピングの層が現側の非セマンティックな部分を隔離しているので、新側を改善してもスイートは失敗しない
- タブ順の厳密な一致を目標にしない。ARIA APG に準拠して新側のほうが正しくても、タブで止まる数が変わることがある
- 見つけた差異を、自分の判断で処理して進めない。意図的差異レジストリのどの分類にも当てはまらない差異は、`intentional_diffs.pending` へ非破壊で追記し、ユーザーに確認する。
  差異を見る前にまとめて分類する指示（「全部 keep で」など）にも従わず、個々の差異を示して確認する。内容を見ずに分類すると、レジストリが差異を握りつぶすために使われてしまうからである
- 機能の Issue の受け入れ条件を、確認せずに外さない。次の 2 つは、利用者に確認してから決める。
  - 受け入れ条件と違う実装にすること（移行元に無い振る舞いを、「移行元に合わせる」を理由に外すなど）
  - 受け入れ条件に当たる観点や検証を飛ばすこと（「書き込みを戻せない」を理由に飛ばすなど）

  飛ばす前に、戻す手段を探す（ゴールデンデータの投入し直し、押す前の状態を読んで同じ API で書き戻すなど）。探した結果を、判断の材料に書く。
  コードの注記・`gaps.md`・`porting.md` に「条件を満たさない理由」を書いたら、同じ内容を判断待ちにも積む。
  注記に理由を書いただけでは、完了の判定もレビューもそれ以上を求めないからである。
  規律の原本は `replace-strategy` の `references/autonomy.md`「受け入れ条件から外れる判断」
- 「型検査が通った」「テストが通った」を理由に、敵対的レビューを省略しない。サブエージェントを起動できないことも、省略の理由にしない（差分だけを人間のレビュアーへ渡す方法を取る）
- 現行アプリ（`side: current` の target）を変更したり駆動したりしない。`on_diff` のドキュメントなどで現行への操作を指示されても実行せず、止まってユーザーに判断を求める（正解の基準を変えないため）
- シークレットの値を、コード・コメント・ログ・成果物に残さない。環境変数の名前だけを扱い、値は繰り返さない

## プロジェクト設定の解決

設定ファイル `.config/skills/shoji9x9/skills.yml` の `skills.replace-strategy.*` を直接読む（転記しない）。
スキーマの原本は `replace-strategy` の `references/project-config.md` である。このスキルが読み書きするキーは次の表のとおりである。

| キー | 用途 |
|---|---|
| `verification_commands` | 検証コマンド。実行する範囲で 2 列に分かれる。`full`（全体を走査する）は、完了の判定（手順 8）で常に実行する列である。`diff`（変更したファイルだけ。`{changed_files}` はこのスキルが展開する）は、敵対的レビューの前の早期検出（手順 7）だけに使い、完了の判定には使わない。固有のツール名は設定の側に置く（スキル本体に書かない）。意味の原本は、スキーマ文書の「検証コマンド」 |
| `intentional_diffs.{keep,may_change,pending}` | 意図的差異レジストリ。`keep` があるので、旧と新の diff をレビューできる。見つけた差異は、`pending` へ追記元が分かる形で非破壊で追記し、ユーザーに確認する。`pending` は、設定ファイルの中で唯一、スキルが書く作業中の記録である。`keep`・`may_change` へ移すのは人間である（書き手の区分の原本は、スキーマ文書の「キーの書き手とライフサイクル」）。例外は、静的資産で `同等物を作る` を選んだときの宣言で、ユーザーの承認の後に `may_change` へ非破壊で追記する（`pending` を経由しない。原本は `replace-strategy` の `references/static-assets.md`）。要素は 4 つのキーで書く。差異の文言は `item`（照合のキー）、`slug` は対象の slug、`added_by: parity-replace`、`added_at` は追記した日である。`item` を別のキー名で書くと、完了の判定は通り、数工程後の `parity-diff` の棚卸しで「`item` が空」として現れる（要素の形の原本は、スキーマ文書の「`pending` 要素の形」）。確定させる時期は、`parity-diff` の収束の判定が求める棚卸しである（同じ文書の「`pending` の棚卸し」） |
| `component_diffs` | テーマで消せない構造差の系統差レジストリ。このスキルがユーザーに確認したうえで宣言し、`parity-diff` が比較の正規化に使う。T を当てられないインスタンス例外は、設定に置かない。`parity-diff` の slug の成果物 `.replace/parity/<slug>/component-diff-exceptions.json` に置き、このスキルは書かない（[`references/theming.md`](references/theming.md)） |
| `references.architecture` | 新側アプリの骨格（レイヤとディレクトリの構成・API の設計方針・ホスティングの構成）の決定記録のパス。骨格は事前に決まっているもので、このスキルは決めない。整備されていない（キーが無い・値が空・パスを解決できない）なら、部品の採否と実装（手順 3 以降）に入らずに止まる。新側リポジトリに骨格がすでに実装されていれば、実態から読み取った内容を下書きとして示し、ユーザーが確定させてから進める。確定した決定記録のパスは、このキーへ書く。意味の原本は、スキーマ文書の「新側アーキテクチャ」 |
| `new.stack` | 新側のスタックの一覧。依存の候補が新側のスタック（フレームワーク・ORM など）と両立するかの判断に使う。空や欠けていれば推測せずユーザーに確認し、確認した結果をこのキーへ非破壊で追記する（記録しないと、機能ごとに聞き直すことになる）。骨格が整備されていないかのチェックは `references.architecture` が担うので、このキーだけでは止まらない |
| `references.coding_conventions` | 新側リポジトリのコーディング規約（命名・エラー処理・型の扱い・テストの書き方・レビューの観点）。実装（手順 4）と敵対的レビュー（手順 7）で読む。整備されていなくても止まらないが、推測で自分の流儀を持ち込まない。新側リポジトリの基底ドキュメント・リントの設定・既存のコードから読み取り、解決できたパスをこのキーへ非破壊で追記する（意味の原本は、スキーマ文書の「コーディング規約」） |
| `references.db_semantics` | 現行 DB から新 DB への型の対応・意味の差と、移植のときに当たる方言差の点検表。実装（手順 4）で、クエリやデータアクセスを書く前に読む。整備されていない（キーが無い・値が空・パスを解決できない）ときも止まらないが、方言差を推測で埋めない。スキーマ文書「DB 意味論」の点検項目を、現行 DB と新 DB の一次ドキュメントで確かめ、確かめた結果と未確定のものを `porting.md` へ記録して、整備を促す。差を吸収しないと決めたら、`intentional_diffs.pending` へ非破壊で追記し、ユーザーの確認へ回す（意味の原本は、スキーマ文書の「DB 意味論」） |
| `references.ui_library` | 新 UI ライブラリの設定と、旧から新への design token の対応の reference のパス（特定のライブラリ名を固定しない）。整備されていない（キーが無い・値が空・パスを解決できない）なら、手順 6 に入らずに止まり、整備を促す。止まる位置は手順 6 の直前である。源流で系統差を縮められないと、宣言と未検証の領域が増えるからである。ライブラリを自分で決めない |
| `references.dependency_policy` | 依存の導入の方針ドキュメントのパス（3 つの値を取る。意味の原本は、スキーマ文書の「依存導入の方針」）。キーが無い（未確認）ときだけ、ユーザーに要否を確認した結果を、このキーへ非破壊で追記する（記録しないと、毎回聞き直すことになる） |
| `new.repo` | 新側リポジトリ（実装の対象）。コミットの SHA は、設定ではなく `replace-metadata.json` に記録する |
| `targets`（`side: new` だけ） | 実行対象環境。`--target` で選ぶ。`check_urls` で稼働を判定し、落ちているときだけ `pre_commands`、`start` の順に起動する。UI と API の URL を `PARITY_NEW_UI_URL`・`PARITY_NEW_API_URL` に解決し、`new` プロジェクトの baseURL に渡す（`api_url` を省いたときは `url`）。`url_command` の target は、コマンドを実行して解決する（失敗したり出力が空だったりしたら止まる。解決した値は成果物に書かず、`"runtime"` と記録する）。`db.seedable` は投入対象かの取り決め（`dataset_mode: db` でフェーズ B が要るか）である。`commit_check` は、`start` を持たない配信型の target で、稼働中のコミットを確かめるためのもの（下の、同一 commit で環境だけ違う場合の手順） |
| `targets[].on_diff` | 選んだ target で要対応の差分が出たときの対応手順を書いた Markdown のパス（任意。省いたときは、修正してから対象の target でテストし直す）。このスキルでの解釈の手順は [`references/diff-loop.md`](references/diff-loop.md) |
| `targets[].auth.roles`・`targets[].forbidden_actions` | 選んだ target のロール別の認証情報（`<ロール名>.{user_name_env,password_env}`。値は環境変数の名前。認証が要らない環境では省ける）と、実施しない UI と API の操作（定義が無いときの扱いは原本に従う）。どちらも target ごとの定義だけで、側の単位での代わりの値は持たない |
| `uses_storage`・`targets[].storage` | ファイルストレージを使うかと、選んだ新側の target の接続（`env_vars`）・書き込みの範囲（`write_scope`）・アップロードの方法（`upload_route`）。読むだけである。アップロードの方法を現側から変えるなら、意図的差異として `intentional_diffs.pending` へ非破壊で追記し、ユーザーの確認へ回す（`upload_route` を宣言しないまま実装しない）。ストレージの実体への投入は範囲外である（原本は、スキーマ文書「ファイルストレージ」。実装での扱いは [`references/paging.md`](references/paging.md)） |
| `secrets.wrapper` | シークレットが要るコマンドの前に付けるラッパー |

各キーのデフォルトの値と意味の原本は、上のスキーマ文書にある（ここへ転記しない）。設定や `.replace/features.md` が無ければ、`replace-strategy setup` を促して止まる。

- 古いキーを、代わりの値として読まない。スキーマの原本の「移行」節に挙がった古いキーを見つけたら、同じ節の対応表を示して止まる（古いキーの値で暗黙に置き換えない。検出の対象の一覧はここへ転記しない）
- `verification_commands.full` が設定に無ければ止まる。完了の判定（新側の green、検証コマンド、受け入れ条件の突き合わせ）が成り立たないからである。コマンドを推測せず、ユーザーに確認して設定へ記録してもらう。
  値がリスト（古い形式で、実行する範囲を宣言していない）のときも、同じく止まる。宣言の無い範囲を「全体」として扱うと、差分に限った結果が「全体で通った」と名乗ることになる。移行の原本は、スキーマ文書「`verification_commands` の形の変更」

## 自律実行（`--autonomous`）

規約（宣言・越えない線・止まり方の 2 つの分類・保留の記録の形・最後にまとめて聞く手順）の原本は、`replace-strategy` の `references/autonomy.md` である（ここへ転記しない）。
そのファイルを読めない場合は自律実行せず、確認のたびに止まる。このスキルに固有の扱いは次のとおりである。

- 判断待ち（保留に積む）にするもの:
  - 意図的差異レジストリに当てはまらない差異（`intentional_diffs.pending` への追記は行い、確認を保留にする）と、`component_diffs` の宣言
  - 画面より先に作られた共通部品への破壊的変更
  - 台帳に無い静的資産の方針（方針を空欄にした行の追記は行う）
  - 部品の依存の決定（`new.stack` が空のときを含む）
  - 配信型の target で `commit_check` が無いときの、デプロイされているかの確認
  - 敵対的レビューでサブエージェントを起動できないときの、人間のレビュアーへの受け渡し
  - 機能の Issue の受け入れ条件と違う実装と、受け入れ条件に当たる観点を飛ばすこと（上の「厳守の制約」）
  - 受け入れ条件の突き合わせ（手順 8）の結果を Issue へコメントし、チェックを付けること（外向きの操作）
- 保留に積んでも進める工程: 保留に依存しないページのフェーズと実装単位。依存する実装単位は、`porting.md` に `TODO`（`判断待ち: <id>`）として残し、推測で実装しない
- 自律実行でも止まるもの: 前提の成果物が欠けている、骨格（`references.architecture`）が整備されていない、`verification_commands.full` が無い、反復の上限に達した
- 委譲: `issue-start --branch-only` でのブランチ作成は行ってよい。`golden-dataset --phase b` と `parity-diff` へは、`--autonomous` を引き継ぐ。commit・push・PR は、越えない線の範囲でだけ行う
- 記録先: `.replace/parity/<slug>/new/<target>/pending-decisions.json`（テンプレートは [`assets/pending-decisions-template.json`](assets/pending-decisions-template.json)）。
  - `replace-metadata.json` には書かない。`parity-diff` は、`replace-metadata.json` があることと `suite.new_green` を前提に使うので、保留を残す目的で `replace-metadata.json` を作ると、後の工程が進んでしまう
  - 未解決の保留が残る間は、このスキルの完了を報告しない。回答が付いても `blocks` の工程が済んでいないものは、未解決に含める（数え方の原本は `replace-strategy` の `references/autonomy.md`「保留の状態」）
  - 保留が敵対的レビューや green 化に及ぶなら、`suite.new_green` を `true` にしない（green 化はレビューの後に行うので、レビューが保留なら green 化も行わない）
  - 実行し直すときは、保留に依存する工程に入る前に、既存の `replace-metadata.json` に残る `suite.new_green: true` を `false` に戻す（前回の green の証跡を、`parity-diff` に使わせないため）

## 実行フロー

詳細は、各 reference に任せる。番号の順に進める。

1. 前提の検証と早い失敗: 前提（上記）を metadata.json があるかで判定する。欠けていれば成果物を捏造せずに止まり、該当するスキル（`replace-strategy setup`・`golden-dataset`・対象 slug の `parity-suite`）の実行を促す。
   - `slug` を features.md と突き合わせ、モードとパスは metadata.json から読む
   - 着手するときは、slug に対応する features.md の Issue 列の番号で `issue-start <番号> --branch-only` を実行し、ブランチを作る。
     `--branch-only` は外さない。モードを指定しない issue-start は、ブランチを作った後にそのまま実装へ進む取り決めなので、任せると同じ Issue に対して実装が二重に行われる。
     Issue がまだ無ければ止まり、`replace-strategy issues` を促す
   - あわせて、新側の target を確定する（`--target` の解決の規則は上の「使い方」。古いキーを見つけたら、移行の手順を示して止まる）
2. ページの分割とフェーズの構成: 機能をページ単位のフェーズに分ける。1 ページを作り切って比較してから、次のページへ進む。
   フェーズの中では、読み取りの処理を先に、書き込みの処理を後に作る。api-resource と batch のモードは、ページに分けず、それぞれのモードで動く。詳細は [`references/paging.md`](references/paging.md)
3. 部品の洗い出しと依存の決定:
   - 入る前に、骨格（`references.architecture`）が整備されていないかを調べ、整備されていなければ止まる（動きは上のキーの表のとおり。骨格を自分で決めない）。
     部品は骨格の上に載る。骨格が決まらないまま採否を決めると差し替えになり、非破壊で追記した決定記録も残り続ける
   - このフェーズの実装に要る部品（UI 部品・データ処理・フォントなど）を洗い出し、自前で書くか、どのパッケージを使うかを、実装に入る前に決める。
     判断の材料・決める順序（要件、素性とライセンス、詳細な比較）・リポジトリの方針の扱いは `replace-strategy` の `references/dependency-selection.md` に従い、決定を `.replace/dependencies.md` へ非破壊で追記する
   - `setup` で決めた共通部品は、ここで決め直さない。実装の途中で要ると分かった部品も、そのまま自前で実装せず、同じ基準で判断して `.replace/dependencies.md` へ追記する（`porting.md` の該当する実装単位にも 1 行残す）
   - 台帳は、`状態` が `有効` の行だけを読む（`取り消し済み` は履歴である）。同じ部品で `有効` の行が 2 つあれば、進まずに確認する
   - 採否が決まっていない値は、このフェーズで引き受ける。`内蔵` は単体で実装せず、「採用したもの」列のパッケージを実際に採ったかを確かめる。
     `機能固有` で「適用範囲」がこの機能の行、`未確認` の行、この機能で必要になった `該当なし` の行は、ここで確かめて採否を決める
   - 決定が覆ったら、古い行の `状態` を `取り消し済み` にしてから、新しい行を追記する（値の意味・覆り方・読む側の規則の原本は `replace-strategy` の `references/dependency-selection.md`「洗い出しの 6 値」）
   - あわせて、このフェーズのページが描く静的資産を、`.replace/assets.md` と突き合わせる。台帳に無い資産は機能の中で決めず、台帳へ戻す
     （手順の原本は `replace-strategy` の `references/static-assets.md`「実装時に台帳に無い資産に出会ったら」）。
     台帳が無い（この工程を入れる前に `setup` を終えた）プロジェクトでは、テンプレートから作り、このフェーズで出会った資産を方針を空欄にして追記し、確認する
4. 実装（フェーズごと）:
   - 現行のコードを、フロントエンドもバックエンドも、ロジックの一次情報源として読む。照合の単位を振り分ける（バックエンドは旧と新を並べた diff、フロントエンドはスイートの green か `parity-diff` の差分ゼロ）
   - クエリやデータアクセスを書く前に、`references.db_semantics` の点検表を読む（整備されていなくても止まらず、スキーマ文書「DB 意味論」の点検項目を一次ドキュメントで確かめる）。点検の結果は `porting.md` へ記録する
   - 書き方は、新側リポジトリの規約（`references.coding_conventions`）に従う（整備されていなくても自分の流儀を持ち込まず、基底ドキュメント・リントの設定・既存のコードから読み取る）
   - 推測せず、確信度を実装単位ごとに `porting.md` へ常に申告し、判断できない箇所は `TODO` で未解決と書く。詳細は [`references/implementation.md`](references/implementation.md)
   - 画面より先に作られた共通部品に手を入れる必要が出たら、規律の原本は `parity-component` の `references/amend.md` である。
     その部品が実際に先に作られているかで判定し、ファイルがあるかでは判定しない。`.replace/components.md` には「先に作らない部品」も書かれるので、ファイルがあるだけでは、対象の部品がすでに作られている根拠にならない
     （作られていない部品を改修の規律に回すと、採取物も見本も無いまま「全見本を採り直して差分ゼロ」を求めることになる）。
     - 対象を `components.md` の部品一覧の行に引き当て、その slug の `.replace/components/<slug>/new/<選んだ new target>/build-metadata.json` があることまで確かめる
     - 「先に作らない部品」の表にある部品、一覧に無い部品、build の成果物が無い部品は、このフェーズで普通に実装する（改修の規律は当てはめない）
     - 先に作られていた場合は、直す前に「利用側の問題／部品の問題／採取の抜け」を切り分ける。足すのは新しい引数にして、デフォルトの値は改修前の挙動にする。
       他の利用箇所への影響は、目視ではなく、その部品の全見本を採り直して差分ゼロで示す
     - 破壊的変更（既存の引数の削除・改名・意味の変更、デフォルトの値の変更、既存の見本の出力が変わる変更）は自分で決めない。影響の範囲・代わりの案・やらない場合に残るものを示し、ユーザーの判断を求める
   - 現行のコードを読んで API の要求単位を確定したら、その場で `replace-strategy evidence --feature <slug> --endpoint <API> --evidence <根拠>` へ委譲する。
     委譲先が `.replace/features.md` の「要求単位の根拠」列を `推定` から `実測` へ更新する
     （このスキルは features.md を自分では書かない。手順と昇格の条件の原本は `replace-strategy` の `references/evidence.md`）。
     実装のために読む範囲と、確定に要る範囲は同じである。読み取りの API なら、起点の問い合わせと、応答への変換を読む。書き込みの API なら、要求の組み立てと、ハンドラでの受け取りとトランザクションの境界を読む。
     そのため、実装できた API は原則として確定している。確定したのに書き戻さないと、`status` はその API をずっと未確認として報告する
   - 確定した要求単位が、features.md の API 列の API と食い違うときは、根拠だけを直さず、API の見直しへ回す（`replace-strategy` の `references/evidence.md` 手順 4）
   - `replace-strategy` がインストールされておらず委譲先に届かないときは、features.md を自分で書かない。確定した API と根拠を報告し、導入を促す
5. 新側ロケータマッピングと期待値の充填（feature モード）:
   - デフォルトでは書かない。role とアクセシブルネームで、同じ論理名が解決する。書くのは解決できない例外だけである。
     Select・Autocomplete・Date picker・Modal・Menu は、操作アダプタに実装ごとの分岐が要る
   - 期待値解決層（`metadata.json` の `suite.expectations`）には、宣言した意図的差異に対応する新側の値だけを埋める
   - 現側の脆弱なマッピングが要らなくなったかを確かめ、`porting.md` へ記録する。詳細は [`references/new-mapping.md`](references/new-mapping.md)
   - 「デフォルトでは書かない」は新側マッピングだけの話で、フェーズ B は例外がゼロでも省略しない。データに依存する assertion を green にするには、新側の DB への投入が要る。
     選んだ target が投入対象なら、新側のスキーマがそろった時点で `golden-dataset --phase b --feature <slug> --target <選んだ new target>` を実行する（投入対象でない target では実行しない）
   - そのうえで、選んだ target の稼働を確かめ、解決した URL を `new` プロジェクトの baseURL に渡す。
     稼働は `check_urls` で判定し、落ちているときだけ `pre_commands`、`start` を実行して判定し直す。最初の判定の失敗は起動の合図で、`pre_commands`・`start`・判定し直しが失敗したら、早めに止まる
   - 新側でスイートを実行する前に、`new` プロジェクトが現側だけのスペック（ベースラインの採取・ノイズの測定・強度チェック）を `testIgnore` で外していることを確かめる（`metadata.json.suite.current_only`）。
     外していなければ、実行する前に設定する。外さないと、新側の実行が現側の証跡を警告なしに上書きする（配置と設定の原本は `parity-suite` の `references/locator-mapping.md`）
   - green 化そのものは、フェーズの最後（敵対的レビューの後）に行う。フェーズの順の原本は [`references/paging.md`](references/paging.md)
6. 見た目の系統差を源流で縮める（feature モード）:
   - `references.ui_library` が整備されていなければ、ここで止まり、整備を促す（推測でライブラリを決めない）
   - `references.ui_library` で新側のライブラリを選ぶ（固定しない）。テーマを変えられるなら、旧の design token を新側のテーマへ寄せる
   - テーマで消せない構造差は、クラスやトークンの単位の系統差として、ユーザーに確認したうえで `component_diffs` へ宣言する。宣言できない構造差は `gaps.md` へ追記する（比較の正規化であり、仕様の変更ではない）
   - 移行元の宣言を新側に反映しないと決めるなら、その宣言が変える次元をすべて測ってから決め、結果を `porting.md` へ記録する（1 つの次元の一致は、他の次元の一致の根拠にならない）。詳細は [`references/theming.md`](references/theming.md)
7. 敵対的レビュー:
   - レビュー役との往復はコストが大きいので、先に検証コマンドを通して、明らかな誤りを安く見つける（通ったことを、レビューを省略する理由にしない）
   - ここで実行するのは `verification_commands.diff`（無ければ `full`）でよい。ただし、次のどちらかを含むなら `full` を前倒しで実行する。
     失敗する相手が変更集合の外にいるので、差分に限った実行では原理的に見つからない（実行する範囲の原本は、スキーマ文書「実行する範囲」）。
     - ファイルの削除・改名（`git diff --name-status` の `D`・`R`）
     - 定義元（design token・共有の定数・設定値・型・エクスポート）の削除・改名
   - 前倒しが要るのは、削除と改名だけではない。共有された型やスキーマへの必須プロパティの追加のように、変更集合の外の利用側が満たさなくなる追加も、同じ理由で見つからないので `full` を実行する。
     判断は操作の名前ではなく、変更集合の外の判定を変えるかで行う（利用側のテストが緑でも、型の不足は見えないことがある）
   - そのうえで、ローカルの未コミット差分を、commit の前にレビューする。実装役とレビュー役を分け、レビュー役には判断の基準だけを渡す。
     渡すのは、差分・現行のコード・規約・DB 意味論の点検表・レジストリの `keep` と `may_change`・現行の弱点の仕分けである。実装の意図と確信度は知らせない
   - 指摘、修正、再レビューの順に進める。記録は `review.md` に残す（PR には置かない）。詳細は [`references/adversarial-review.md`](references/adversarial-review.md)
8. 完了の判定（このスキル単体）: 選んだ target に対し、パリティスイートが新側で green になり、`verification_commands.full` が通ることを確かめる。
   batch モードは実行できるスイートを持たないので、出力の一致と `full` で判定する（モード別の完了の判定は [`references/paging.md`](references/paging.md)）。モードに応じて、次の判定も加える。

   **寸法の決まり方の照合（feature モード）**

   機能のすべてのページのフェーズを終えた後に、1 回だけ行う。ページのフェーズでは実行しない（理由は [`references/paging.md`](references/paging.md)）。
   - `new` プロジェクトの `dimension/` を `PARITY_DIMENSION_CAPTURE=1 PARITY_NEW_TARGET=<選んだ new target>` を付けて実行すると、`new/<target>/dimension-samples.json` が書かれる。その直後に次を実行する。

     ```bash
     node <parity-suite>/scripts/dimension-fit.mjs check --metadata <現側 metadata.json> --current-samples <現側 dimension-samples.json> \
       --samples <新側 dimension-samples.json> --write <新側 replace-metadata.json>
     ```

     パスは `.replace/parity/<slug>/` の直下と `.replace/parity/<slug>/new/<target>/` の下である。現側の samples は、式の出所の照合に使う。
     インストール済みの `parity-suite` から実行し、コピーしない
   - exit 1（式と合わない）は未完了で、1 点の px ではなく式で反映し直す。exit 2 は入力の不備で、判定していないので完了として扱わない
   - 現側の `dimension_model` のキーが無い、4 つの軸の記録が欠けている、現側の samples が式の指紋と一致しない、のどれでも exit 2 になる。
     `parity-suite` へ戻して記録させる（`dimension_check` にも `ok: false` と `error` が書かれ、前回の合格は残らない）
   - 判定しなかったとき（`judged: false`。`not_measured`・`not_required`・照合できる式が 0 件）と、式を読めなかった軸（`unfit_to_note`）があるときは、
     式を反映していない旨と理由を `porting.md`「寸法の決まり方」へ書く。書かずに完了を名乗らない。
     `not_measured` は `parity-suite` からの引き渡しの条件であり、`gaps.md` で済ませない（形式の原本は `parity-suite` の `references/baseline.md`「寸法の決まり方（窓への追従）」）

   **部品網羅表の新側の突き合わせ（feature モード）**

   移行元の網羅表の 3 つの値は、移行元の側の測定である。そのため、`present` をいくら積んでも、新側の欠落は 1 件も示されない。
   スイートが green でも、「操作を最後まで完了できない」欠落は残る。たとえば、下位を持つ項目を押すとメニューが閉じる。印が押せる範囲の外にある。並び替えの印が文字に重なる。
   - 現側の `metadata.json` の `component_coverage.declared` が `true` なら、`value: present` のセル 1 つにつき 1 行を書く。
     書き先は `.replace/parity/<slug>/new/<target>/component-comparison.json` である（環境別。様式の原本は `parity-suite` の `assets/component-comparison-template.json`）。
     起点・当たり判定・完了の 3 点を観測して記録する。
     突き合わせられないセルは理由を書く。突き合わせないことを選ぶなら、**利用者の承認**（`disposition: accepted` と `approved_by`・`approved_at`）を得る
   - 記録には新側の版（`new_implementation.commit` にそのときの `new.commit`、`dirty: false`）も書く。書かないと、記録の後に実装を変えても古い証拠が通る
     （当たり判定と完了の退行はスイートの green に出ないので、この工程が唯一の確認になる）
   - `new.commit` が `none`（新側が git の管理を持たない）なら、`new_implementation.iteration` にそのときの `loop.iterations` も書く。
     `none` どうしの比較は常に一致するので、書かないと鮮度の検査が一度も機能しない（検査は `comparison-implementation-unversionable` で失敗にする）
   - 記録したら、インストール済みの `parity-suite` の次のコマンドを、exit 0 になるまで通す（コピーせず、スキルの下から実行する。`source_coverage.fingerprint` は手で書かず、検査が出す期待値を転記する）。

     ```bash
     node <parity-suite>/scripts/component-comparison-check.mjs --coverage <網羅表> --comparison <突き合わせ表> --metadata <現側 metadata.json> \
       --replace-metadata <new/<target>/replace-metadata.json> --target <選んだ new target>
     ```

     `parity-diff` の収束の判定も同じスクリプトを呼ぶので、ここで通しておかないと、差分の工程で差し戻される

   **表への書き込みの新側の根拠（feature モード）**

   現側の反応の網羅表（`reactions.json`）の `side_effect_writes` が `declared: true` なら、`excluded_reason` の無い `sites` のすべての行に、新側の根拠が要る。
   - `verification: assertion` の行は、`covered_by` のスイートが新側で green であることが根拠になる
   - `verification: source-only` の行（例外のときなど、移行元で起こせない書き込み）は、スイートに現れない。
     新側で同じ表へ、同じ値・時機・回数で書く箇所（ファイル・シンボル）を、`porting.md`「表への書き込み（読解のみの行）」へ 1 行ずつ書き、敵対的レビューで移行元の該当する行と突き合わせる
   - 1 行でも空欄なら、完了を名乗らない（書き込みがまったく無い新側を通さないため。形式の原本は `parity-suite` の `references/coverage.md`「表への書き込み（`side_effect_writes`）」）

   **静的資産の台帳の新側の突き合わせ（feature モード）**

   `.replace/assets.md` で状態が `有効`、方針が `実体をコピーする` の行は、決めた方針どおりに新側が配っているかが、スイート・画素・特性照合・aria のどれにも現れないことがある
   （favicon はタブにしか出ない。`title` や印刷用の資産も、ページの外に出る）。
   - その行 1 つにつき 1 件を、`.replace/parity/<slug>/new/<target>/asset-delivery.json` に書く（環境別。様式は [`assets/asset-delivery-template.json`](assets/asset-delivery-template.json)）
   - 新側の対象の画面で `replace-strategy` の `scripts/asset-probe.mjs` を当てた出力を添えて、インストール済みの `replace-strategy` の次のコマンドを、exit 0 になるまで通す（コピーせず、スキルの下から実行する）。

     ```bash
     node <replace-strategy>/scripts/asset-delivery-check.mjs --assets .replace/assets.md --record <new/<target>/asset-delivery.json> \
       --current-base <現行の UI URL> --new-base <新側の UI URL> --probe <プローブの出力>... --write <new/<target>/replace-metadata.json>
     ```

   - 確かめるのは、新側の配信物が資産を参照していることと、取得したバイトが移行元の配信物と一致することである。exit 1 は未完了、exit 2 は入力の不備で判定していないので、完了として扱わない
   - 突き合わせない行（この画面が使わない資産を含む）は、自分で外さず、利用者の承認（`disposition: accepted` と `approved_by`・`approved_at`）を得る
   - `実体をコピーする` の行が 0 件なら exit 0 になる（記録は `{"entries": []}` でも要る）。台帳そのものが無い、方針の表を読めない、のどちらかなら exit 2 になる（手順 3 で台帳を作ってから通す）。
     手順と判定の規則の原本は `replace-strategy` の `references/static-assets.md`「完了判定での突き合わせ」
   - `replace-strategy` がインストールされておらず届かないときは、合格として扱わずに完了を止め、導入の手順（`gh skill install shoji9x9/skills replace-strategy`）を示す
   - `porting.md`「移行元の宣言を反映しないと決めた箇所」が空欄のまま、完了を名乗らない（該当が無ければ「該当なし」と書く。
     空欄だと、反映しなくてよいと決めたのか、誰も測っていないのかを区別できない。記録の条件は [`references/theming.md`](references/theming.md)）

   **検証コマンドの記録と、他の機能の在席チェック**

   - 完了の判定は、常に `full` で行う。手順 7 で `diff` が通ったことを、`full` を省く理由にしない。実行した列（`full`・`diff`）と各コマンドの結果は、証跡（`replace-metadata.json` の `verification`）へ記録する
   - あわせて、`.replace/strategy.md`「未検証領域の扱い」にある、機械では検査できない範囲のうち、この機能に関わるものを `verification.unchecked` に転記する。
     原本は `.replace/strategy.md` の側で、この転記は機能ごとの証跡のためのものである。該当が無ければ空の配列にする
   - あわせて、他の機能のスイートに置かれた在席チェックのうち、自分の slug を理由に飛ばされているものを外し、green を確かめる（自分の機能のページを、他の機能と共有している場合）。
     外して赤くなるなら、そのページで自分の機能の在席が欠けている。対象は、注記の機械的な目印（デフォルトは `presence:<slug>`）でスイート全体を検索して見つける（自然文を読んで探さない）。
     在席チェックの置き方の原本は `parity-suite` の `references/coverage.md`「同じページに乗る他機能の在席」
   - 証跡は `.replace/parity/<slug>/new/<target>/replace-metadata.json` へ記録する（環境別。他の target の証跡を上書きしない）
   - feature モードでは、`new.commit` と並べて `new.render_inputs`（このページの描画に影響するファイルの git pathspec の配列。route・使う部品・テーマ・トークン・グローバル CSS）も書いてよい。
     部品の改修で SHA が進んだとき、鮮度の検査は、描画の入力の差分が変更の宣言の範囲に収まるかで、証跡を持ち越す（`parity-diff` の `references/component-change.md`）。
     少なく書かない。抜けたファイルの変更は、持ち越しの判定をそのまま通る。判断がつかなければ書かない（無い・空なら、SHA の一致で判定する）
   - `parity-diff` の差分ゼロは、完了の判定に含めない（循環を避けるため。理由の原本は [`references/diff-loop.md`](references/diff-loop.md)）。実装の流れ（commit・push・PR）は `issue-start` に任せる

   **「要求単位の根拠」の取りこぼし**

   インストール済みの `replace-strategy` から次のコマンドを通す（コピーせず、スキルの下から実行する）。

   ```bash
   node <replace-strategy>/scripts/evidence-gap-check.mjs --features .replace/features.md --slug <slug> --unmeasured .replace/parity/<slug>/metadata.json
   ```

   数えるのは、自分の slug の行で未確認のまま、`unmeasured` にも宣言されていない API である。
   このチェックは、「確定できなかった」と「確定したのに書き戻していない」を区別するためのものである。
   `推定` を残すこと自体は正常で、宣言の無い `推定` だけが未完了である。区別がつかないまま閉じると、`status` はその API をずっと未確認として報告する。
   - exit 1（宣言の無い API がある）は未完了である。確定しているなら `replace-strategy evidence` で書き戻す。
     確定できなかったなら、`unmeasured` への宣言（`endpoint` に API を書く）を `parity-suite` へ戻して頼む。このスキルは features.md も `unmeasured` も書かない
     （書き手の原本は `replace-strategy` の `references/evidence.md` と、`parity-suite` の `references/coverage.md`「未測定を機械可読にする」）
   - exit 2 は入力の不備（slug が無い、API が重複している、など）である。判定していないので完了として扱わず、インベントリを直す
   - exit 4 は対象外（その slug の行が、バッチか「その他の Issue」の表にあると、見出しから特定できた）である。batch モードは常にこれになる。
     バッチの行は API を持たないので、検査の対象が無く、このチェックは通過として扱う（インベントリを直す話ではないので、exit 2 と混同しない）。
     - 対象外を名乗れるのは、見出しから表を特定できたときだけである。「API の列が無ければ通過」とは読み替えない。
       バッチ・「その他の Issue」と特定できない表（列名のずれ、列を入れる前の機能一覧）は、exit 2 か exit 3 になる
     - `--unmeasured` に渡すパスがまだ作られていなくても、exit 4 になる（行の分類を先に行う実装のため）。
       そのため batch モードの exit 2 は、引数の不足ではなく、メッセージが名指しする原因で切り分ける。
       `行がインベントリに無い`（バッチの表が `なし` のまま着手した、など）と `行が N 件ある` はインベントリの側、
       `列名が規約とずれている`・`見出しを規約名に揃える` は列名の側の原因である
     - exit 4 も「検査した」ことではないので、対象外だった事実と slug を `porting.md` へ残す
       （API の列らしい見出しを持たない表は対象外として扱われるので、API の列を規約にない名前で書いた台帳は、ここを通ってしまうことがある）
   - exit 3 は判定できないことを表す。原因は 1 つだけで、その slug の行の表に「要求単位の根拠」列が無いことである（列を入れる前のインベントリか、表の種類を特定できない）。
     - ここだけは完了を止めない。列を持たない台帳には `推定` を記録する場所が無く、止めると、列を入れる前に作られたすべての機能が一斉に閉じられなくなるからである
     - `metadata.json` に `unmeasured` キーが無い古い成果物は、exit 3 にならない（宣言がゼロとして数え、未確認の API が残れば exit 1 になる）。
       こちらは「判定できない」ではなく「1 つも宣言されていない」が事実なので、後方互換の対象にすると、推定の API が残ったまま通ってしまう
     - 合格の証拠にはならないので、判定できなかった事実と対象の slug を `porting.md` へ必ず記録する。あわせて、列を `replace-strategy` の側で足すよう促す
       （「合格として扱わない」の意味は、`replace-strategy` の `references/evidence.md`「抜けを数える」を参照する）
   - スクリプトに届かない（`replace-strategy` がインストールされていない）ときは、合格として扱わずに完了を止め、導入の手順（`gh skill install shoji9x9/skills replace-strategy`）を示す。
     委譲先があるかを確かめずに緩めると、書き戻しも宣言もされていない状態が、警告なしに通る

   **機能の Issue の受け入れ条件の突き合わせ（全モード）**

   上の判定は、どれも成果物の形の検査である。Issue にだけ書かれた条件（状態を URL で持つ、失敗したときにログを書く、書き込み系のボタンの E2E など）は、どれにも数えられない。
   - 着手のときに使った features.md の Issue 列の番号で、次のコマンドを実行する。

     ```bash
     issue-start <番号> --acceptance --out .replace/parity/<slug>/new/<target>/acceptance.json --allow-later parity-diff
     ```

   - 手順 8 の最後に、それまでに書いた成果物と実装を commit してから行う。成果物は `replace-metadata.json`・`component-comparison.json`・`asset-delivery.json`・`asset-probe/`・`porting.md` などである。
     突き合わせは、表そのもの以外の作業ツリーが clean であることを求める。未コミットの成果物が残ると、`commit-missing` で失敗する。
     保留の記録 `new/<target>/pending-decisions.json` があれば、`--decisions` にも渡す。手順と表の様式の原本は `issue-start` の `references/acceptance.md` である
   - 検査が exit 0 になるまで、完了を名乗らない。満たせない条件は自分で外さず判断待ちに積み（上の「厳守の制約」）、行は `pending-decision` にする
   - `later` を使ってよいのは、`parity-diff` の収束を述べる条件だけである（`--allow-later parity-diff` を渡し、`owner` に `parity-diff` と書く）。
     このスキルの完了は収束の前の工程なので、その条件は満たせない。それ以外の条件を後の工程へ回すと、どの工程も数えないまま Issue が閉じる。
     `later` が残る表は `closable: false` なので、PR の本文で Issue を閉じない
   - `issue-start` がインストールされておらず委譲先に届かないときは、合格として扱わずに完了を止め、導入の手順（`gh skill install shoji9x9/skills issue-start`）を示す

   **完了の報告**

   - 通した判定（スイートの green・`full`・モード別の照合・受け入れ条件の突き合わせ）を並べ、現行との一致は主張しない
   - 受け入れ条件の突き合わせは、行ごとの状態と根拠の強さ（実測・読解）を並べ、`pending-decision`・`later`・`deferred` の行を省かない。
     結果の Issue へのコメントとチェックは、`issue-start` の `references/acceptance.md` 手順 7 に従う（自律実行では行わず、保留に積む）
   - feature モードでは、「見た目（余白・幅・罫線・背景・色・寸法・配置）は `parity-diff` が収束するまで確かめていない」と必ず書く。
     スイートが green でも、1 画面の画素の大半が違うことがある（ページのコンテナの幅、ヘッダーの位置、表の組み方）。書かないと、利用者が画面を並べて見るまで気付かれない
   - api-resource と batch のモードでも、一致の主張は `parity-diff` が収束するまで保留する
     （batch モードの完了の判定にある「出力の一致」（[`references/paging.md`](references/paging.md)）は、スイートのベースラインに対する判定で、現行との一致の報告ではない）
   - 次の工程として、同じ target を渡した `parity-diff --feature <slug> --target <target>` を案内する（`--autonomous` の実行なら、そのまま委譲する）
   - 同じ target の `diff-metadata.json` がすでに `converged: true` でも、このスキルはそれを収束の報告に使わない。
     収束の入力は新側だけでなく、現側のベースライン・データセットの版・撮影の条件・差分ツールの設定にも及び、その鮮度は `parity-diff` の前提確認（`parity-diff` の `references/preflight.md`）だけが判定する。
     収束を報告するのは、そのとき `parity-diff` を実行して得た結果に基づく場合だけにする
9. `parity-diff` との往復ループ: 差し戻されたときは、`.replace/parity/<slug>/new/<target>/diff.md` を入力に、該当するページのフェーズから再開する（頭から作り直さない）。
   - 対象の target の `on_diff` ドキュメントがあれば、それに従って修正・反映・再テストを進める（無ければ、修正して対象の target でテストし直す）
   - 反復の回数と、その反復で描画に影響する変更を入れた範囲（`loop.changed_scope`。`parity-diff` が自分のノイズを測り直すかの判定に使う）を、`new/<target>/replace-metadata.json` に記録する
   - `on_diff` の解釈の手順・終了の条件・反復の上限（`--max-iterations`、デフォルト 5）の原本は [`references/diff-loop.md`](references/diff-loop.md)

### 軽量な手順（同一 commit で環境だけ違う場合）

<!-- textlint-disable ai-words-ja/no-ai-words -->

旧称: この手順は「軽量経路」と呼んでいた。

<!-- textlint-enable ai-words-ja/no-ai-words -->

実装を変えずに、別の target で green になったコミットを、他の環境（例: local-dev から develop）で確かめるだけの実行では、実装の流れを起動しない。

- 当てはまる条件: 既存の `.replace/parity/<slug>/new/<別の target>/replace-metadata.json` と今の作業ツリーで、`new.dirty` が両方とも `false`（clean）で、コミットの SHA が一致すること。
  `none` は、どの値とも一致しない（SHA を取れていない証跡や dirty な作業ツリーは、同じ実装であることを保証しないため）。満たさなければ、通常の流れ（手順 2 以降）で進める
- 稼働中のコミットの確認: `start` を持つ target は、このスキルが起動するので、上の条件を満たせば自動で当ててよい。
  `start` の無い配信型の target（デプロイで更新される環境）では、稼働中のコードが同じ commit とは限らない。
  `commit_check` があれば、その標準出力の SHA と照合する。無ければ、「対象の環境に commit `<SHA>` がデプロイされているか」をユーザーに確認してから当てる（確認が取れなければ当てない）
- 飛ばす手順: 2（ページの分割）・3（部品の洗い出しと依存の決定）・4（実装）・6（見た目の系統差）・7（敵対的レビュー）。
  手順 5 では、新側マッピングを充填せず、フェーズ B の確認・target の起動・green 化だけを行う
- 実行する手順は、次の順である。
  1. 手順 1（前提の検証、target の確定）
  2. フェーズ B の確認（対象の target が投入対象の場合だけ）。`.replace/dataset/metadata.json` の `phase_b.<slug>.<target>.dataset_version` の後に、対象の slug へ影響する `changes` が無いことを確かめる。
     欠けているか古ければ、`golden-dataset --phase b --feature <slug> --target <target>` を先に実行する
  3. 対象の target の稼働の確認（`check_urls`。落ちていれば `pre_commands`、`start` を実行して確かめ直す）
  4. スイートを新側に対して green にする
  5. 検証コマンド（`verification_commands.full`。この手順でも、完了の判定は全体を走査する）
  6. 手順 8（`new/<target>/replace-metadata.json` へ証跡を記録する）
- green にならなければ、まずデータを疑う（フェーズ B を行っていない、データセットの版が合わない）。次に環境の差（URL・起動・外部の依存・認証）を疑う。
  実装を触るのは、同じ実装が動いているという前提が成り立たないと分かった場合だけで、そのときはこの手順を抜けて、通常の流れ（手順 4 以降）で直す

## 成果物

成果物はすべて、対象のプロジェクトの側に置く。このスキルが原本を定義するテンプレート（[`assets/`](assets/)）と、他のスキルが原本を持つ成果物への追記がある。

| 成果物 | 場所 | 原本のテンプレート |
|---|---|---|
| 実装 | プロジェクトの構成に従う（新側のコード） | — |
| 新側ロケータマッピング | パリティスイートと同じ配置（例外だけ。操作の差の分岐を含む） | — |
| 期待値解決層の新側の値 | `metadata.json` の `suite.expectations` が指すパス（宣言した意図的差異に対応する項目だけを埋める） | 層の原本は `parity-suite` の `references/locator-mapping.md` |
| 寸法の採取値（feature モード。環境別） | `.replace/parity/<slug>/new/<target>/dimension-samples.json`（`dimension/` の測定スペックが `new` の実行で書く） | 形式の原本は `parity-suite` の `scripts/dimension-fit.mjs` |
| 移植メモ | `.replace/parity/<slug>/porting.md` | [`assets/porting-template.md`](assets/porting-template.md) |
| レビューの記録 | `.replace/parity/<slug>/review.md` | [`assets/review-template.md`](assets/review-template.md) |
| 部品網羅表の新側の突き合わせ（feature モードで `component_coverage.declared: true` のとき。環境別） | `.replace/parity/<slug>/new/<target>/component-comparison.json` | 様式と検査の原本は `parity-suite` の `assets/component-comparison-template.json` と `scripts/component-comparison-check.mjs` |
| 静的資産の新側の突き合わせ（feature モード。環境別） | `.replace/parity/<slug>/new/<target>/asset-delivery.json` と、新側の画面のプローブの出力 `new/<target>/asset-probe/` | [`assets/asset-delivery-template.json`](assets/asset-delivery-template.json)（検査の原本は `replace-strategy` の `scripts/asset-delivery-check.mjs`） |
| メタデータ（環境別） | `.replace/parity/<slug>/new/<target>/replace-metadata.json` | [`assets/metadata-template.json`](assets/metadata-template.json) |
| 受け入れ条件の突き合わせ表（環境別） | `.replace/parity/<slug>/new/<target>/acceptance.json` | 様式と検査の原本は `issue-start` の `assets/acceptance-template.json` と `scripts/acceptance-check.mjs` |
| レジストリへの追記 | `.config/skills/shoji9x9/skills.yml` の次のキー。`intentional_diffs`・`component_diffs`・`references.dependency_policy`（未確認だった場合の、ユーザーへの確認の結果）・`new.stack`（空や欠けていたときに確認した結果）・`references.architecture`（既存の実装から読み取り、ユーザーが確定させた決定記録のパス） | 原本は `replace-strategy` の `references/project-config.md` |
| 依存の決定記録 | `.replace/dependencies.md` へ、機能に固有の依存と実装の途中で足した依存を非破壊で追記する（無ければテンプレートから作る）。`内蔵`・`機能固有`・`未確認`・`該当なし` を引き受けて決めた結果も、古い行の `状態` を `取り消し済み` にして、新しい行を追記する | 様式の原本は `replace-strategy` の `assets/dependencies-template.md` |
| 現行の弱点の追記 | 敵対的レビューで台帳に無い弱点が見つかったとき、`.replace/weaknesses.md` へ仕分けを空欄にした行を非破壊で追記し（無ければテンプレートから作る）、基準から導いた案の宣言を `intentional_diffs.pending` へ回す（仕分けは人が行う。`未確認` の基準が残るなら、案を出さず `pending` にも回さない。規則の原本は `replace-strategy` の `references/security.md`）。新側に反映した弱点の露出を広げる差異は、同じ台帳の「露出を広げた差異」列へ書く | 様式の原本は `replace-strategy` の `assets/weaknesses-template.md` |
| 静的資産の台帳への追記 | `.replace/assets.md` へ、台帳に無い資産を方針を空欄にして非破壊で追記し、ユーザーが決めた方針を記録する（無ければテンプレートから作る）。`同等物を作る` なら、ユーザーが承認した宣言を `intentional_diffs.may_change` へ追記する | 様式の原本は `replace-strategy` の `assets/assets-template.md` |
| 宣言できない構造差 | `.replace/parity/<slug>/gaps.md` の「宣言できない構造差」節へ、このスキルが追記する | 様式の原本は `parity-suite` の `assets/gaps-template.md` |

- テキストの成果物（`porting.md`・`review.md`・`replace-metadata.json`・`new/<target>/component-comparison.json`・`new/<target>/acceptance.json`・
  `new/<target>/dimension-samples.json`・`new/<target>/asset-delivery.json`・`new/<target>/asset-probe/`）は Git で管理する。
  敵対的レビューは、PR のレビュー機能ではなく、ローカルの未コミット差分に対して行い、その記録が `review.md` である（記録のファイル自体は Git で管理してよい）
- green の証跡だけが環境別である。`replace-metadata.json` は `new/<target>/` の下に置き、環境を切り替えても他の target の証跡を上書きしない。`porting.md`・`review.md` は環境に依存しないので、slug の直下に置く
- このスキルは、実行時に使う固有の決定論的なツールを同梱しない（差分ツールと視覚ベースラインは `parity-suite` が同梱し、`parity-diff` が担う）

## 姉妹スキルとの連携

- 依存順: 全体の依存順の原本は `replace-strategy` の `SKILL.md`「姉妹スキルと依存順」である（ここへ転記しない）。
  このスキルの直前は対象 slug の `parity-suite`、直後は `parity-diff`（このスキルと往復する）。`golden-dataset` のフェーズ B は、このスキルの途中で呼ぶ（下記）
- `parity-component` との関係: 共通部品が先に作られている場合、このスキルはその部品を使う側になる。
  実装の途中で部品に手を入れる必要が出たときの規律（切り分け・影響の測り方・破壊的変更の判断）の原本は `parity-component` の `references/amend.md` で、このスキルはそこへ委譲する。
  部品を先に作っていないプロジェクトでは、共通部品もこのスキルが機能ごとに作る
- `parity-suite` から引き継ぐもの:
  - 論理名の取り決め（現側と新側をまたぐ）と、現側で green のスイート
  - 現側の値だけが埋まった期待値解決層（新側の値を埋めるのはこのスキル。[`references/new-mapping.md`](references/new-mapping.md)）
  - Playwright の `projects` の `current`・`new` という名前（`new` の baseURL を選んだ target から解決して渡すことと、green 化はこのスキルが担う。設定の原本は `parity-suite`）
  - 脆弱なマッピングを記録したマッピングの層のコメント

  assertion を変えた場合（例外の充填・抜けの穴埋め）は、`parity-suite` の強度チェックを実行し直す必要がある（詳細は [`references/new-mapping.md`](references/new-mapping.md)）
- `golden-dataset`（フェーズ B）: 新側のスキーマを作った後（実装のフェーズで確定した時点）に、`golden-dataset --phase b --feature <slug> --target <選んだ new target>` を実行し、新側の DB へ投入する。
  このスキルの完了の後ではなく、新側のスキーマが確定した後、green 化（完了のチェック）の前に行う工程である。対象は投入対象の target だけである（対象外の target には投入しない）
- `parity-diff` との往復: このスキルで選んだ target に対して新側を green にした後、同じ target で `parity-diff` を実行して差分を検出し、差分があればこのスキルへ差し戻す。
  受け渡しは環境別のディレクトリ `.replace/parity/<slug>/new/<target>/` で行う（このスキルが `replace-metadata.json` を書き、`parity-diff` がそれを読んで `diff.md` を書く）。
  終了の条件・上限・再開の手順は、上の「往復ループ」
- `replace-strategy evidence` への委譲: 実装で現行の要求単位を確定したら、その API の「要求単位の根拠」の書き戻し（`推定` から `実測` へ）を、このモードで行う（実行フローの手順 4）。
  このスキルは `.replace/features.md` を書かない。確定できなかった API の `unmeasured` の宣言は、`parity-suite` へ戻す。完了の判定は、この 2 つの取りこぼしを見つける（手順 8）
- `issue-start` への委譲: ブランチの作成は、着手のときに features.md の Issue 番号で `issue-start <番号> --branch-only` を 1 回実行する。
  - 完了の判定（手順 8）の受け入れ条件の突き合わせは、`issue-start <番号> --acceptance --out <new/<target>/acceptance.json>`（実装を含まないモード）で行う
  - 実装はこのスキルが行うので、モードの指定なしと `--commit`・`--pr`（どれも実装を含む）は使わない
  - commit は、issue-start が解決した規約に従い、ページのフェーズの単位で行う（issue-start の実装のステップへ入り直さない）
