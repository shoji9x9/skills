# Skills

Claude Code・Codex・GitHub Copilot に対応した、マルチエージェント向けの汎用スキル集。
エージェントによる自律的な開発（Issue の起票・着手から実装・レビュー対応・リリースまで）に必要なスキルを提供する。

リポジトリと各スキルは、章ごとのスライドで説明している。スライドの元のファイルと直し方は [`docs/slides/`](docs/slides/README.md) にある。

| 章 | 日本語 | English |
| --- | --- | --- |
| 1. リポジトリの概要 | [スライド](https://shoji9x9.github.io/skills/docs/slides/#/ja/01-overview/1) | [Slides](https://shoji9x9.github.io/skills/docs/slides/#/en/01-overview/1) |
| 2. multiagent-setup | [スライド](https://shoji9x9.github.io/skills/docs/slides/#/ja/02-multiagent-setup/1) | [Slides](https://shoji9x9.github.io/skills/docs/slides/#/en/02-multiagent-setup/1) |
| 3. writing-style | [スライド](https://shoji9x9.github.io/skills/docs/slides/#/ja/03-writing-style/1) | [Slides](https://shoji9x9.github.io/skills/docs/slides/#/en/03-writing-style/1) |
| 4. Issue から merge まで | [スライド](https://shoji9x9.github.io/skills/docs/slides/#/ja/04-issue-to-merge/1) | [Slides](https://shoji9x9.github.io/skills/docs/slides/#/en/04-issue-to-merge/1) |
| 5. 依存の更新と脆弱性 | [スライド](https://shoji9x9.github.io/skills/docs/slides/#/ja/05-dependencies/1) | [Slides](https://shoji9x9.github.io/skills/docs/slides/#/en/05-dependencies/1) |
| 6. 仕様を変えないリプレイス | [スライド](https://shoji9x9.github.io/skills/docs/slides/#/ja/06-replace/1) | [Slides](https://shoji9x9.github.io/skills/docs/slides/#/en/06-replace/1) |
| 7. browser-test | [スライド](https://shoji9x9.github.io/skills/docs/slides/#/ja/07-browser-test/1) | [Slides](https://shoji9x9.github.io/skills/docs/slides/#/en/07-browser-test/1) |
| 8. aws-architecture-diagram | [スライド](https://shoji9x9.github.io/skills/docs/slides/#/ja/08-aws-architecture-diagram/1) | [Slides](https://shoji9x9.github.io/skills/docs/slides/#/en/08-aws-architecture-diagram/1) |
| 9. box | [スライド](https://shoji9x9.github.io/skills/docs/slides/#/ja/09-box/1) | [Slides](https://shoji9x9.github.io/skills/docs/slides/#/en/09-box/1) |
| 10. リポジトリの工夫 | [スライド](https://shoji9x9.github.io/skills/docs/slides/#/ja/10-repository-practices/1) | [Slides](https://shoji9x9.github.io/skills/docs/slides/#/en/10-repository-practices/1) |

## 利用可能なスキル

| スキル | 説明 |
|-------|------|
| [multiagent-setup](./skills/multiagent-setup/) | スキル・ルール・Hooks・ドキュメントをマルチエージェント対応構造でセットアップ |
| [kaizen](./skills/kaizen/) | セッションから失敗・修正・エラーを抽出し根本原因を分析。スキル・ルール・Hooks・ドキュメントへ反映して同じ失敗の再発を防ぐ |
| [writing-style](./skills/writing-style/) | 人が読む日本語の文章を、読み手が補わずに意味を取れる書き方の規則で書き、Issue と PR のタイトル・commit message の 1 行目などの要約の文を外に出す前に読み直す。他の配布スキルがタイトルや本文を書いた後に参照する |
| [issue-create](./skills/issue-create/) | 短い説明から GitHub Issue を作成。重複チェック・`.github/ISSUE_TEMPLATE/` 参照・ドラフト承認を経て起票 |
| [issue-start](./skills/issue-start/) | GitHub Issue を起点に branch 作成・実装・commit・PR 作成までを標準化 |
| [git-worktree](./skills/git-worktree/) | git worktree で作業を隔離する。渡された branch に worktree を用意してセッションをそこへ移し、`.gitignore` の対象のファイルの持ち込み、チェックツールからの除外、clean を確かめてからの後片付けまでを標準化する。worktree を作るだけでは、subagent・fork・バックグラウンドで動く Bash が共有の作業ツリーで動くので、隔離にならない。branch の作成と Issue との紐付けは呼び出し側（issue-start・issue-batch など）が行う。`setup`・`enter`・`cleanup` の 3 つのモードを持つ |
| [issue-batch](./skills/issue-batch/) | 複数 Issue を 1 件ずつ隔離 worktree・独立 branch / PR で連続処理し、実装、レビュー、検証、PR 収束、merge（GitHub の auto-merge／エージェントが実測して merge、を選択）、Issue close、deployment、branch cleanup まで追跡。依存先の Issue を先に処理する。初回は `setup` で無人実行ポリシーとマージ方式を確定し、`prepare` で run の前に判断を決めて Issue に記録する |
| [pr-review-handle](./skills/pr-review-handle/) | PR のレビューコメント（全レビュアー対象）を確認・妥当性判断・必要時のみ修正・返信・解決。`--push` で commit・push・CI 確認後の再レビュー依頼（依頼先は `review_tool` で選択: Copilot/Claude Code/Codex/none）まで |
| [dependabot-merge](./skills/dependabot-merge/) | Dependabot PR の CI 確認・影響レビュー・判断のコメント記録・マージを標準化。PR 単体または `--all` で open な全 PR を処理（0.x や自動マージ未設定リポジトリ向け） |
| [dependabot-alert-issue](./skills/dependabot-alert-issue/) | Dependabot alerts を確認し解消 Issue を作成。着手可否で分類し severity・パッケージ単位でグルーピング、着手不能なものは着手可能条件を明記。設定で特定 alert の無視・dismiss も指定可 |
| [pr-finalize-loop](./skills/pr-finalize-loop/) | 作成済み PR の CI エラー解消とレビュー指摘対応を、CI 成功かつ未解決スレッドなしになるまで自律ループで反復。再レビュー依頼先は `review_tool` で選択（Copilot/Claude Code/Codex/none）。`--max-iterations`（既定 5。使い切ったらレビューの effort を下げて半分の回数を足す）で停止し、人間判断を要する指摘だけ確認して反映後に復帰 |
| [browser-test](./skills/browser-test/) | フロント／バックエンドの変更を実ブラウザ（chrome-devtools MCP）で回帰確認。実施できる操作は環境ごとの設定（`forbidden_actions`）に従い、副作用を伴う操作は承認制（未設定の環境は読み取り専用）。変更の範囲から影響するページを割り出し、描画・console・API 応答を確認して課題をクロス環境で切り分け。`setup` で対話的に設定を記録 |
| [aws-architecture-diagram](./skills/aws-architecture-diagram/) | AWS 構成図を IaC（CDK / Terraform 等）や説明から spec に起こし SVG として生成・更新。作図ルール（線の交差を減らす・線を直角に曲げる・軸をそろえる）に従い、環境（prod・local など）ごとの図を 1 つの基本の spec と変換で出し分け、PNG 化して目視確認しながら反復。初回は `setup` で対話導入、以降は `update` |
| [box](./skills/box/) | Box のファイル/フォルダを Box REST API（`curl` + `jq`）で参照・検索・更新。フォルダ一覧・メタ取得・ダウンロード・検索・アップロード・新バージョン作成を、Dev Token または OAuth refresh のトークンで実行。MCP・SDK 不要 |
| [agent-usage](./skills/agent-usage/) | コーディングエージェント（Claude Code・Codex）の利用実績を、人別にリポジトリへ記録して集計。モデル別・日別のトークン数と費用、1 回の指示で動き続けた時間、エージェントが止まっていた時間（確認中・CI 待ち・レビュー待ち・未活用）と PR のレビューの回数と費用を、ローカルのログと GitHub から集める。コミットの前に Hook が記録するかを確かめ、要約は HTML、明細は CSV |
| [replace-strategy](./skills/replace-strategy/) | 仕様を変えないアプリケーションリプレイスの起点。現行アプリを実測（セマンティクス・DB 復元可否・コード入手性・副作用・既存テスト）して戦略を決め、機能に分解して姉妹スキルへ振り分ける。自分では実装しない。`setup` / `issues`（issue-create へ委譲）/ `status` / `evidence`（確定した要求単位の根拠を機能インベントリへ書き戻す唯一の方法）の 4 モード。測定できなければ停止 |
| [current-environment-bootstrap](./skills/current-environment-bootstrap/) | replace-strategy の姉妹スキル。先方から受領した資産だけを起点に、比較基準として測定可能な現行テスト環境（current target）を自社へ再構築する。受領資産の棚卸しと「受領済み／導出可能／不足」の分類、DB スキーマと設定の復元、データ意味論の根拠収集、不足に対する先方・SME 向け質問票の生成、根拠のある範囲での最小の暫定起動データ構築、起動・認証・主要画面到達の実測、空環境からの再構築の再実行検証、current target の引き渡しまで。カラム名や型からの推測でドメイン値を確定せず、出所・利用許可が不明なデータは投入しない。`current.origin: received-assets` のとき `replace-strategy setup` が測定の前に委譲する |
| [golden-dataset](./skills/golden-dataset/) | replace-strategy の姉妹スキル。現行と新側の比較を成立させる共通データセットを構築。データそのものではなく冪等・決定論的な投入ツール（TypeScript / SQL）を作り、本番を参照せず一から作る。新側スキーマは後から出来るため 2 フェーズ（A: 現行テスト環境へ投入・検証、B: 新側スキーマへの対応づけ・投入・現新一致検証）。データセットのバージョンで parity-suite / parity-diff のベースライン陳腐化を検出。replace-strategy setup 未完了なら停止 |
| [parity-component](./skills/parity-component/) | replace-strategy の姉妹スキル。共通 UI 部品を画面より先に作るときに、現行アプリから部品の見た目の基準を採り、実装し、部品カタログ上で照合する。採取の単位は部品インスタンス（部品 × ページ）で、要素単位のスクリーンショット・状態別の計算後スタイル・当たっている CSS 規則・データ依存部品の実データを採る。インスタンス間で値が割れた軸を可変（引数）、割れない軸を固定として決定論的に割り出す。`capture` / `build` の 2 モード。1 回で 1 部品。画面より先に部品を作らない方針なら使わない（機能ごとに parity-replace が作る） |
| [parity-suite](./skills/parity-suite/) | replace-strategy の姉妹スキル。現行アプリに対してパリティスイート（新旧どちらの実装にも当てられる実行可能な合否判定基準）を Playwright で構築し、故障注入で強度を検証。論理名のロケータマッピング・手書きの寛容な aria スナップショット・API の record/replay・視覚ベースラインとノイズ基準値の採取まで。1 回の実行で 1 機能。replace-strategy setup / golden-dataset 未完了・Playwright 不可なら停止 |
| [parity-replace](./skills/parity-replace/) | replace-strategy の姉妹スキル。parity-suite が定義した論理名に対して新側を実装する意図的に薄い層。機能をページ単位のフェーズに分割し、新側ロケータマッピングの例外を充填し、実装役と分離した敵対的レビューを未コミット差分にかける。ブランチ作成・commit・PR は issue-start へ委譲。現行コードを一次情報源に読み、推測せず確信度を申告し、スイートが新に対して green ＋ 検証コマンド ＋ Issue の受け入れ条件の照合で完了（差分ゼロは parity-diff との往復の終了条件）。1 回で 1 機能。前提未完了なら停止 |
| [parity-diff](./skills/parity-diff/) | replace-strategy の姉妹スキル。現行と新側の差分を検出・分類する。検出は決定論的ツール（画素・特性照合・aria の 3 つの方法）が行い、LLM は分類（要対応／許容／環境ノイズ）のみを行う。1 回の実行で 1 機能。前提（replace-strategy setup / golden-dataset / 対象 slug の parity-suite 完了・parity-replace の新側 green）未完了なら停止 |

## 前提条件

- [GitHub CLI](https://cli.github.com/) の v2.90.0 以降。`gh skill` コマンドは v2.90.0 で導入された（[リリースノート](https://github.com/cli/cli/releases/tag/v2.90.0)）。版は `gh --version` で確かめる。
- `gh auth login` で GitHub に認証済みであること

## インストール

```bash
gh skill install shoji9x9/skills multiagent-setup
gh skill install shoji9x9/skills kaizen
gh skill install shoji9x9/skills writing-style
gh skill install shoji9x9/skills issue-create
gh skill install shoji9x9/skills issue-start
gh skill install shoji9x9/skills issue-batch
gh skill install shoji9x9/skills git-worktree
gh skill install shoji9x9/skills pr-review-handle
gh skill install shoji9x9/skills dependabot-merge
gh skill install shoji9x9/skills dependabot-alert-issue
gh skill install shoji9x9/skills pr-finalize-loop
gh skill install shoji9x9/skills browser-test
gh skill install shoji9x9/skills aws-architecture-diagram
gh skill install shoji9x9/skills box
gh skill install shoji9x9/skills agent-usage
gh skill install shoji9x9/skills replace-strategy
gh skill install shoji9x9/skills current-environment-bootstrap
gh skill install shoji9x9/skills golden-dataset
gh skill install shoji9x9/skills parity-component
gh skill install shoji9x9/skills parity-suite
gh skill install shoji9x9/skills parity-replace
gh skill install shoji9x9/skills parity-diff
```

## スキルの更新

```bash
gh skill update --all
```

## スキルの設定

設定を読むスキルは、設定を JSONC（コメントを書ける JSON）のファイルから、すべて同じ置き場所と順序で読む。

設定は、「リポジトリ」「人ごと・リポジトリ限定」「人ごと」の 3 つの層に置く。
各層の置き場所・値を適用する範囲・commit するかは、[`skills/kaizen/references/config-files.md`](skills/kaizen/references/config-files.md)「層と置き場所」にある。

`<名前>` はスキル名か、複数のスキルが使うキーをまとめた `common` である。`shoji9x9` は配布元の名前で、インストール先のリポジトリ名ではない。
値は、CLI のオプション → 環境変数（プログラムが渡す値だけ）→ 人ごと・リポジトリ限定 → 人ごと → リポジトリ → デフォルトの順に探す。
キーごとに置ける層が決まっていて、リポジトリで揃える値（マージの方式など）はリポジトリの層にだけ置ける。
環境変数は、秘密の情報、プログラムが子プロセスに渡す値、他のツールが名前を決めている変数だけに使う。それ以外の値を `.env` などに置かない。

読み書きは、各スキルに同梱した `scripts/skill-config/skill-config.mjs` で行う（Node.js が要る）。知らないキー・型の誤り・置けない層に書いたキーはエラーになる。
層の選び方・読み方・書き込みの決まり・旧い置き場所からの移行は、各スキルの `references/config-files.md`（例: [`skills/kaizen/references/config-files.md`](skills/kaizen/references/config-files.md)）にある。キーの意味は、各スキルの文書とスキーマ（`config-schemas/`）にある。

設定ファイルは、設定を作るスキル（`replace-strategy setup`、`browser-test setup`、`issue-batch setup` など）が、既にあるキーとコメントを変えずに作るか追記する。
設定ファイルはスキルのディレクトリの外にあるので、`gh skill update` を実行しても残る。

| 名前 | 読むスキル | 主なキー |
| --- | --- | --- |
| `common` | issue-start・issue-batch・pr-review-handle・pr-finalize-loop・dependabot-alert-issue | `conventions_doc`（ブランチ運用と commit の規約のドキュメント）、`review_tool`（再レビューの依頼先） |
| `dependabot-merge` | dependabot-merge | `merge_method` |
| `dependabot-alert-issue` | dependabot-alert-issue | `minimum_release_age_days`・`ignore`・`dismiss` |
| `issue-batch` | issue-batch | 反復の上限・CI の待機・merge・deployment の監視 |
| `git-worktree` | git-worktree | worktree の置き場所とファイルを運ぶ方法 |
| `writing-style` | writing-style | `style_docs`（プロジェクトの文章の規約）・`word_list`（使わない語の一覧）・`lint_command`（文章のリンター） |
| `browser-test` | browser-test・issue-batch | 確認する環境と禁止する操作 |
| `replace-strategy` | replace-strategy・current-environment-bootstrap・golden-dataset・parity-component・parity-suite・parity-replace・parity-diff | リプレイスの対象・環境・成果物の方針・意図的差異のレジストリ |
| `kaizen` | kaizen | 忘却・定期実行・コミット前のチェックの時間の上限 |
| `agent-usage` | agent-usage | 単価・人の ID・判断の無いブランチの扱い |
| `box` | box | 操作の対象のフォルダ |
| `aws-architecture-diagram` | aws-architecture-diagram | 図のディレクトリ・出力先・Chrome の起動 |

例えば、このリポジトリでだけ自分が再レビューを Codex に頼むなら、`.config/skills/shoji9x9/common.local.jsonc` に次のように書く。1 回だけ変えるなら、`pr-finalize-loop 6 --review-tool codex` のように CLI で渡す。

```jsonc
{
  "review_tool": "codex"
}
```
