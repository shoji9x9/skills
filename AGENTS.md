# Skills

Claude Code / Codex / GitHub Copilot に対応したマルチエージェント向けスキル集。

## プロジェクト概要

このリポジトリは、複数の AI エージェントが共通のスキル・ルール・Hooks・ドキュメント構造を共有できるよう整備するための汎用スキルを提供する。  
スキルは `gh skill install` で任意のプロジェクトにインストールして使用する。

## 技術スタック

- **スキル管理**: GitHub CLI (`gh skill`、**v2.90.0+**)、Agent Skills 仕様
- **パッケージマネージャ**: pnpm（mise で管理）。正本は `package.json` の `packageManager` / `devEngines.packageManager` と `pnpm-lock.yaml`。**npm は使わない**（`package-lock.json` を作らない。誤った PM 利用は `devEngines` が警告する）
  - bump 手順（正本 4 箇所の同期）・broken 版回避は [`docs/package-manager.md`](docs/package-manager.md) を参照
- **フォーマッタ／リンタ**: 下表の通り（**prettier は使わない**）
- **テスト**: skill-creator、Python 3.8+（集計スクリプト）
- **環境管理**: mise
- **ツール起動**: スクリプト・lefthook・CI からツールを起動する際は `./node_modules/.bin/<tool>` のハードパスで叩かず、`pnpm exec <tool>`（または mise の shim）経由で起動する
  - **mise の shim は cwd の設定階層で解決する。** リポジトリ外の cwd（`/tmp` 等）から素のコマンド名で起動すると
    `No version is set for shim` で落ちる（グローバル既定が無いため。untrusted とは別の失敗）。
    プロジェクト外で動かす検証は `mise which <tool>` で実体パスを解決して渡すか、cwd をプロジェクト内に保つ

### リント／フォーマット

| 対象                                              | リント              | フォーマット        | 補助検査                                                                                  |
| ------------------------------------------------- | ------------------- | ------------------- | ----------------------------------------------------------------------------------------- |
| Markdown (`*.md`)                                 | `markdownlint-cli2` | `markdownlint-cli2` | `scripts/lint-pagination.js` で shell コードブロック内の `gh api` ページネーションを検査 |
| JavaScript / TypeScript (`*.js`, `*.mjs`, `*.ts` 等) | `oxlint`          | `oxfmt`             | なし                                                                                      |
| JSON (`*.json`)                                   | `jsonlint`          | `oxfmt`             | duplicate key も検査                                                                      |
| YAML (`*.yml`, `*.yaml`)                          | `js-yaml`           | `oxfmt`             | なし                                                                                      |
| Shell (`*.sh`)                                    | `shellcheck`        | `shfmt`             | `scripts/lint-pagination.js` で `gh api` ページネーションを検査                          |
| GitHub Actions (`.github/workflows/*.{yml,yaml}`) | `actionlint` + `ghalint` | `oxfmt` | `pinact` で SHA pinning を確認 |

表のうち `shellcheck`・`shfmt`・`actionlint`・`pinact`・`ghalint`・`gitleaks` は mise でインストールし（`mise.toml`）素のコマンド名で起動する。それ以外は pnpm devDependencies（`pnpm exec` で起動）。

- **`oxlint` / `oxfmt` の対象は JS/TS ファミリ全体**（`js` / `mjs` / `cjs` / `jsx` / `ts` / `tsx` / `mts` / `cts`）。CI は引数なし（`pnpm run lint:js`）で走らせるためこの範囲を自動で拾う。
  **lefthook の glob と `format:js*` スクリプトの glob もこの範囲に揃える**——片方だけ狭いと、その拡張子は手元で検査されず CI でだけ落ちる（`.ts` を配布テンプレートに追加した際に実際に起きた）。
- **GitHub Actions のポリシー検査**: `actionlint`（構文）に加え `ghalint`（`permissions`・`timeout-minutes`・`persist-credentials` 等のポリシー）で多層検査する。`ghalint` は全走査のため pre-commit に入れず CI（`GitHub Actions lint`）専任。
- **横断ゲート（ファイル種別に依らない検査）**: pre-commit と CI の `Lint` ジョブで次を走らせる。いずれも対象 0 件を成功に倒さない。
  `scripts/check-rule-symlinks.js`（rule の多エージェント配線）/ `scripts/check-control-chars.js`（テキスト拡張子への制御バイト混入）/
  `scripts/check-eval-reachability.js`（eval の assertion と prompt の対応）/ `scripts/check-skills-sync.js` / `scripts/check-js-extensions.js` /
  `scripts/check-skill-frontmatter.js` / `scripts/lint-pagination.js`。
- **実行前ゲート（PreToolUse）**: `scripts/bash-command-guard.sh` が、文章規約で防げず再発した 2 形を Bash 実行前に止める——
  `gh api` と同じセグメントの `--body-file`（`gh api` にこのフラグは無い。`gh pr` / `gh issue` の `--body-file` は通す）と、
  文字クラスで自分を避けていない `pkill -f` / `killall -f`（照合対象が full command line なので自分のシェルに一致する）。
  3 エージェントぶん配線してある（`.claude/settings.json` / `.codex/hooks.json` / `.github/hooks/kaizen-session.json`）。
- **シークレット走査**: `gitleaks` で行う。pre-commit はステージ差分（`gitleaks git --staged`）、CI はリポジトリ全体・全履歴（`Secret scan` ジョブ・`fetch-depth: 0`）を走査する。
- **整形の割り当ての正本は `lefthook.yml` の glob と `package.json` の `format:*`**。上表はその要約であって、ツールが扱える範囲の上限ではない。
  フォーマッタを当てる前に、そのファイル種別がそのフォーマッタに**割り当てられているか**を正本で確かめる。
  割り当て外のファイルに `--check` を当てて赤くなっても、それは誰も強制していない検査なので指摘ではない（直すと無関係な差分になる）。
- **`oxfmt` には Markdown を渡さない**。oxfmt は渡されたファイルを種類で判定して整形するため、`.md` を渡すと表の桁揃えまで行う（4 回踏んだ）。
  Markdown の整形は `markdownlint-cli2 --fix`。**oxfmt にディレクトリを渡さず対象ファイルを列挙する**（ディレクトリを渡すと目的外のファイルが黙って書き換わる）。
  生成物の整形は生成スクリプト自身が出力ファイルを列挙して行い、手順書で人に oxfmt を当てさせない。
- **Markdown の行長（MD013）**: `markdownlint-cli2` の MD013 は非 strict 運用（`line_length: 200`、`code_blocks` / `tables` / `headings` は除外）。
  200 桁超でも**半角スペース（改行可能点）が 200 桁を超えた位置に残る行だけ**を弾く。
  純 CJK の長行は分かち書きしないため通るが、英数字・ツール名など半角スペースを含む語を長行に足すと fail する。
  日本語長行に英数を追記したら、200 桁以内に収めるか、200 桁超に半角スペースを残さないよう折り返す。

JavaScript の拡張子は配布有無で使い分ける（新規ファイルもこれに従う）。

- **配布物は `.mjs`**: 配布スキル一式（`skills/**`）に含まれる JavaScript。インストール先の `package.json` の `type` に依存せず Node が常に ESM として解釈するため。
- **非配布物は `.js`**: リポジトリ内ツール・設定・テスト（`scripts/**/*.js` / `vitest.config.js` / `commitlint.config.js` / `release.config.js`）と、配布しない private skill（`.private-skill`。`.agents/skills/<name>/` のみに存在）のスクリプト。
  `package.json` の `"type": "module"` 下で ESM として動くため拡張子で ESM を明示する必要がない。
- この規約は `scripts/check-js-extensions.js` が lefthook pre-commit と CI（`Lint` ジョブ）で検査する（`skills/**` 配下の `.js` と `scripts/**` 配下の `.mjs` を fail させる）。

`tests/**` はリント／フォーマット対象に含める。`.agents/**` と `.claude/**` はインストール済みコピー／エージェント用シンボリックリンクのため対象外にする。

## ディレクトリ構造

```text
skills/<name>/          スキル実体（gh skill publish の対象）
  SKILL.md              スキルのメイン指示
  references/           進行的開示の補助ドキュメント（コンポーネント手順等。SKILL.md から参照）
  evals/
    evals.json          回帰テスト定義
    README.md           テスト実行手順
tests/<name>/           テスト結果（git 管理はサマリーのみ）
  iteration-N/
    benchmark.json      結果サマリー
.agents/skills/<name>/          実体（Codex が直接参照）
.claude/skills/<name>           → ../../.agents/skills/<name>（Claude Code 用シンボリックリンク）
```

## ワークフロー

スキルの作成・改善・評価には `skill-creator` スキルを使う。

- **検証は目的を果たす最低限のツール実行で行う**。目的より広い一括実行（例: `lefthook run pre-commit --all-files`）は auto-fix・`stage_fixed` による staging などの副作用を伴う。絞り込み方が不明なら範囲を広げる前に `--help` 等で調べる。広い実行をした場合は直後に `git status --short` で意図しない変更を確認して戻す。
- **現状は verify してから言い切る**。ファイル・パス・成果物・ツール挙動・実行環境の現状は、述べる前に Read / grep / 実行で確かめる。記憶や一般論で断定しない（自明に見える一行ほど verify を省きやすい）。
- **規約の合否は、それを強制する実装をそのまま実行して測る**。文字数・バイト数・書式のような「数えれば分かる」規約ほど自前の近似（`awk 'length > N'` 等）を書きやすいが、
  単位（バイト / 文字 / 表示幅）は強制する実装ごとに違い、近似は偽陽性・偽陰性を出す。commit message は `pnpm exec commitlint --edit <file>`、Markdown は `pnpm exec markdownlint-cli2 <path>` で取る。
- **パイプ越しの成否判定に末尾 `$?` を使わない**。パイプで出力を整形する検証の成否は、`${PIPESTATUS[0]}` か `set -o pipefail` で対象コマンド自身の終了コードを取る（末尾 `$?` はパイプ最後のコマンドの終了コード）。
  **出力した終了コードは必ず主張として読まれる。判定に使わないなら出さない**——`cmd | tail -5; echo "exit=$?"` の `0` は `tail` のもので、添え物のつもりの印字が偽の合格報告になる。
  出力を絞りたいときは `cmd >out 2>&1 || rc=$?` と**分離して**から `tail out` する。
- **バッククォートや `$` を含む本文は、二重引用符の `-c` ではなく quoted heredoc（`<<'PY'`）でインタプリタへ渡す**。二重引用符の中のバッククォートはシェルが command substitution として解釈して落ちる（Markdown のコードフェンス・正規表現・テンプレート文字列で踏む）。検証コマンドに書きかけの実験断片を残さない——原因が重なって読めなくなるうえ、落ちた検証は「実行していない」ので別手段で取り直す。
- **「該当が無い」を根拠にする検査・走査は、陽性コントロールで検出能力を実証してから使う**。
  遮断・除外・フィルタ・シークレット走査・差分ゼロの判定は、「本当に無い」と「検査が動いていない」が同じ出力になる。
  **既知マーカーを遮断・除外の対象外に置いて検出できることを確かめ**（対象内に置いた確認は何も実証しない）、打ち切り（`timeout`）・非ゼロ終了は合格に倒さず FAIL にする。予算は実測時間から決める。
  **発動条件を「何も出ない検査」に限定しない。件数が非ゼロでも検出能力の証拠にはならない**——誤検知だけで埋まった真陽性 0 の走査器は、非ゼロ出力に化けて「動いている」ように見える。
  横断スコープ確認で書く使い捨ての grep ／スクリプトも対象。陽性コントロールは「何か出るか」ではなく**「標的パターンが出るか」**で取る（修正済みなら修正前の版を入力にする）。
  除外ロジック（フェンス・コメント等）を持つ走査器は、除外内と除外外の両方に標的インスタンスを置き、弁別できることまで確かめる。
- **ファイル移動＋索引再生成系の `set -e` スクリプトは冪等にする**。既に目的状態にある入力（同一ディレクトリへの `mv` 等）を明示スキップし、no-op で `set -e` が末尾のクリーンアップ／索引再生成に到達しない事態を防ぐ。到達性が重要なら `trap '...' EXIT` を検討する。
- **「常に壊れる／失敗する」系のレビュー指摘は、適用前に使い捨て環境で再現テストして裏取りする**。
  - **回帰（「この変更で壊れた」「以前は動いていた」）の主張は 2 版についての主張なので、旧版と現行版を同じ条件で測る**。
    旧版は `git show <base>:<path>` で取り出し、同じ入力・同じ環境変数で走らせる。現行版だけの再現では「壊れている」と「もともと動いていない」が同じ出力になる。
    差が出なければ回帰ではないので修正を当てず、**なぜ元から成立していないか**をコードへ 1 箇所注記する（次のレビューが同じ指摘を再提出するため）。
  - **両方 0 件は陽性コントロールで弁別する**。測定が動いていない可能性と区別できないので、成立するはずの構成（通常構成など）を同じ手順で測って観測側が見えることを示す。
  - **却下・保留するときも同じ裏取りを行う**。問いは「新しい挙動が妥当か」ではなく **「以前通っていた入力が落ちるか」**。
    他コンポーネントとの対称性（「B は前からそうだった」）は A を新たに壊してよい根拠にならない。保留すると決めた場合も、その形を再現するテストだけは同じ変更に入れる。
  - **修正の安さを着手順の根拠にしない**。8 行の修正でも、事実でない前提のコメントが一緒に入る。
- **等値比較を「正規化」で直すときは、両辺がズレうる軸を列挙して同じ正規化を両辺に当てる**。
  片側だけ・一軸だけの正規化は、別軸や別オプションが効いた瞬間に同じ故障へ戻る
  （例: Node の `--preserve-symlinks-main` では `import.meta.url` も未解決になり、`process.argv[1]` 側だけ realpath しても一致しない）。
  正規化に失敗したときのフォールバックを、直そうとしている故障モード（サイレントに成功扱い）へ倒さない。
- **階層マージされる設定（mise / git / npm 等）に依存する検証は、まず有効な設定ソースを列挙する**。`mise config ls` 等でどの階層由来かを切り分けてから原因を判断する（ユーザーグローバル設定はリポジトリ外なので、ローカルの失敗が CI と乖離する）。下位スコープを対象にする一括操作（`mise lock --global` 等）は上位設定の無いディレクトリから実行し、そのスコープの地点で再検証する（上位に同名エントリがあると下位側が隠れて取りこぼす）。
- **修正で新設した分岐・新たに受理する入力クラスは、その状態を作って実測する**。陽性コントロールは報告済みの欠陥だけを測る。入力の状態空間（候補探索なら 0 件 / 1 件 / 複数件、表記ゆれなら引用符・空白・改行・引数の有無）を列挙し、曖昧性を黙って先勝ちにしない。
- **集合を答えにする検査・0 件で no-op になりうる一括処理は、検出能力と対象件数を実証してから根拠にする**。既知要素の陽性コントロールと総数を突き合わせ、構造化形式の列挙には実パーサを使う。対象 0 件は成功に倒さず、絶対パスで対象と処理件数を出す。
- **縮退環境の検査は、対象コードが意図した分岐へ到達した証拠まで固定する**。終了コードだけでなく識別可能な stderr 等で理由を確かめ、削る依存は検査対象だけにする。
  **同梱物を相対パスで読むコンポーネントの検証は正本の場所で行う**——1 ファイルだけを別ディレクトリへコピーして実行すると、共通ライブラリが見つからず**無言で縮退**し、検証対象がすり替わる。
  コピーするならディレクトリ一式をコピーする。縮退する実装には、縮退した run と本番構成の run を出力で区別できる 1 行を持たせる。
- **切り離した仕事の生死は出力ファイルではなくプロセスの実在で判定する**。再起動・出力先の削除前に前のプロセスを確認し、多重実行や書き込み中の削除を避ける。
- **止まって見える子プロセスを経過時間で判断しない**。生死（`pgrep`）は「動いているか」しか答えず、ブロックと処理中を区別しない。
  最初に見るのは **stderr の最終行と出力サイズ**で、「何を待っているか」を確定してから待つ・落とす・直すを選ぶ
  （出力 0 バイトのまま無応答は、処理中ではなく入力待ちの疑いが濃い）。
  **切り離して起動する子プロセスの stdin は明示的に `</dev/null` へ倒す**——引数で入力を渡していても CLI が stdin も読む実装は珍しくなく、
  対話 TTY では即 EOF で顕在化せず、非対話・背景実行でだけ無限待機になる。
  **外部プロセス（ブラウザ・CLI・サーバ）を駆動するツールを書く前に、本体が使う能力を本体と同じ経路・同じ呼び出しで最小プローブして実測する**——
  別経路で取った実証は本体の経路を保証しない（`Page.setDocumentContent` で確かめて `Page.navigate` で書き、そこで無応答になった）。
  本体では全体 timeout でまとめず**呼び出し単位でタイムアウトを切り、どの呼び出しかを示す stderr をファイルへ出す**（止まった位置が出力に残る）。
- **切り離して起動するコマンドは、失敗が終了コードに残る形で書く**。`|| echo "exit $?"` のような握り潰しを付けると、
  起動自体が短絡しても完了通知が exit 0 に化け、1 コマンドも走らずに「実行した」と報告することになる。
  入力に正本があるならセッション寿命の一時ファイルへ写さず**正本から読む**（scratchpad はセッション再開でパスごと消える）。
  起動前に入力の非空（`[ -n "$VAR" ]`）を確認する。
- **終了コードを決める位置に条件式を置かない**。`done; [ $n -ge 30 ] && echo ...` や `[ $i -lt 3 ] && sleep 20` は、
  **成功したのに非 0** で終わって呼び出し側（Monitor・フック・`set -e`）が失敗として拾う。
  `if ... then ... fi` にするか、末尾を明示的な `true` / `:` で締める。出力だけを見ると成功に見えるため気づきにくい。
  待機は前景 Bash のループに置かず（ツール timeout で切られる）、完了で終わる背景コマンドか監視ツールへ渡す。
- **判定結果として期待される非 0 を、複数コマンドをまとめたツール呼び出しの終了コードへ漏らさない**。`grep` の該当なしや KEDB 検査の一致なしなど、
  終了コードが状態を表すコマンドは直後に値を保存し、`case` / `if` で正常な分岐を 0 に、仕様外・検査失敗だけを非 0 に写像する。
  期待する非 0 を裸の最終コマンドにすると、判定自体は成功していてもツールエラーとして記録され、Kaizen 候補・監視・後続の成否判定を汚染する。
  保存した状態変数は比較より先に非空・期待型を検証し、代入名と参照名を同じ短いブロック内で突き合わせる。別名を参照した空値を数値比較へ渡すと、
  検査対象ではなくラッパー自身のエラーを反復する。単発取得で足りる状態確認を shell ループへ広げず、取得結果を呼び出し側で判定する。
  **存在が実行構成で変わる成果物の確認も同じ位置に置かない**——`cat` / `ls` を終了コードを決める位置に置く前に実在を確かめるか `[ -f ]` で分岐する。
  artifact 一覧が config で変わらないことを確かめずに両構成へ同じ確認を当てると、本体が成功していてもツールエラーになる。
- **opaque ID・完全 SHA・長い prompt は表示結果から手で転記・補完しない**。構造化された正本（JSON・API 応答・`git rev-parse` 等）から、
  それを消費する同じ呼び出し内で機械取得し、非空・形式・比較対象との一致を検証してから渡す。短縮 SHA の残りを推測すると別 commit を指し、
  prompt の一字違いは別の eval 入力になる。stdin も読む CLI を非対話で起動するときは `</dev/null` を付け、引数以外の入力経路を閉じる。
  **名前で呼ぶ識別子（npm スクリプト名・ツール名・タスク名・スキル名）も同じ扱い**——意味のある単語でも記憶から組み立てず、正本（`package.json` の `scripts`・利用可能なツール一覧）を読んで写してから呼ぶ。
  **定型化した呼び出しの可変部は、毎回その場で取得した出力から埋める**。同じ形を繰り返すほど可変部（id・番号・SHA）の由来確認が抜け、前ラウンドのコマンドを写して可変部だけ書き換える形になる。
  **SHA で相関するポーリング（commit ↔ review ↔ check-run）は、各ツール呼び出しの中で完全 SHA を構造化レスポンスから取得し、形式と対象の現在 HEAD との一致を検証してから同じ呼び出しの API へ渡す**。
  「初回に完全 SHA を確認した」と「各ポーリングが正本から取る」は別物で、表示済みの短縮 SHA を変数初期値・フィルタ文字列・URL へ手入力すると、存在しない SHA で常に 0 件・422 が返る。
  **0 件を結論にする前に、その SHA で commit か check-suites を取得できることを陽性コントロールにする**（422 や対象不一致を「レビューなし」へ倒さない）。
- **本文を伴う外向き操作は、本文を先にファイルへ書いて渡す**。渡すフラグはコマンドごとに違う——`gh pr` / `gh issue` は `--body-file <path>`、`gh api` は `-F body=@<path>`（`--body-file` は無く unknown flag で落ちる）か `--input <path>`。失敗時は再実行前に部分的な作成を確認し、存在すれば新規作成でなく補完する。
- **順序依存のある外向き操作は `&&` で連鎖する**。前が失敗したら後が走らない形にする（`reply && resolve`）。
  ループで回すときはとくに効く——1 件失敗しても次の反復へ進むので、失敗を見逃すと不整合な状態だけが残る（返信の無いスレッドを解決済みにした記録がある）。
  **不可逆な操作の引数を、その操作と同じコマンド内のコマンド置換で作らない**。先に別コマンドで取って非空を確かめてから渡す。
  **確認を `||` / fallback に置かない**——引数の由来が不確かなら、確認を先に実行して値を確定させてから本番の外向き操作を撃つ（`id=$(...); [ -n "$id" ] && gh api .../$id/...`）。
  fallback へ回すと「不確かだと認識したまま本番を先に実行する」形になり、外向きの副作用が先に飛ぶ。
- **破壊的操作は allowlist で対象を定め、破壊フラグなしで対象と件数を確認してから実行する**。絞り込み条件を削った再実行では、破壊フラグも外して安全弁が残ることを確認する。
- **プロセス終了（`pkill` / `killall`）も破壊的操作として扱う**。自分で起動したプロセスは起動時に PID を保存し `kill "$PID"` で落とす。
  起動と後片付けが別のツール呼び出しに分かれるなら PID をファイルへ残し `kill "$(cat <file>)"` で撃つ（変数はツール呼び出しをまたいで残らないので、後片付けの段でパターンへ戻りやすい）。
  パターンで撃つのは PID を持っていない場合だけにし、その前に `pgrep -af <pattern>` で対象と件数を確認する。
  **`pkill -f` の照合対象は full command line なので、そのコマンドを実行している自分のシェルにも一致する**（3 回踏んで毎回シェルごと落ちた）。
  症状は非 0 終了だけで、対象が死んだのか自分が死んだのかは出力から読めない。自分の呼び出しが一致しない形（`[d]ump-dom` 等）にするか、PID 指定へ切り替える。
- **制限付き sandbox で子プロセス起動の `EPERM` を確認したら、待機・再試行せず承認付きの sandbox 外実行へ切り替える**。
- **文字列一致で編集するときは、置換元を直前に読んだ現在の中身から一字一句コピーする**（Edit の `old_string` も、`python` / `perl` などスクリプト経由の置換も同じ）。不一致時は目視調整で再試行せず対象を再読するか、行番号ベースの置換へ切り替える。
  **フォーマッタ（`oxfmt` 等）を通した後は特に効く**——自分が書いた文字列は整形で折り返し・引用符・空白が変わっており、記憶から組み立てた置換元は一致しない。整形を挟んだら置換前に読み直す。
- **複数の置換を 1 スクリプトにまとめるなら、置換ごとに書き戻すのを既定にする**（`p.write_text(s)` を各置換の直後に置く）。落ちても成功分は残り、再実行は残りだけで済む。
  末尾 1 回の書き込みにしてよいのは、**途中状態がファイルとして不正になる**など全件が一つの原子単位であるべき場合だけで、そのときは理由を 1 行書く。
  各 `assert` にはどの置換か分かるラベルを付ける（`assert s.count(old) == 1, '<置換名>'`）——行番号だけの AssertionError は、どの置換が古いのかをスクリプトを読み返すまで特定できない。
  「今回は不一致しないだろう」で粒度を落とさない（ラベルだけ守って書き込み粒度を落とし、8 件の置換を捨てた記録がある）。
- **網羅を指示する言い回し（「全て」「漏れなく」）を受けたら、着手前に取る解釈を 1 行で宣言してから動く**。
  「全件を検討し、妥当なものは直し、不要と判断したものは根拠を残して直さない」のように、**機械的な適用ではないこと**と**判断の残し方**を明示する。
  判断が分かれる余地のある指示ほど、宣言のコストは小さく、途中で訂正が入るコストは大きい。

スキルの追加・修正、リリース（CD）、修正後の再インストール、回帰テストの**詳細手順は [`docs/skill-development.md`](docs/skill-development.md) を参照**する。

## ブランチ運用

トランクベース（`main` 単一）の Issue 駆動・PR ベース運用とする。`issue-start` スキルがこのフローを標準化する。

- **ブランチ**: `main` から feature ブランチを切る（`develop` は持たない）
- **命名**: `feature/<issue番号>-<英語の短い説明>`（kebab-case）。日本語 Issue は短い英語に要約する
- **起点**: Issue 駆動。`gh issue develop <issue番号> --base main --checkout` で作成・checkout する
  - 作成前に同番号ブランチの重複を local / remote で確認する
- **マージ**: feature ブランチ → PR → `main`。PR には関連 Issue・変更概要・確認内容を含める
- **commit message**: conventional commits（`feat:` / `fix:` / `docs:` など）。commitlint と lefthook の commit-msg フックで検証される
  - body は 1 行 100 文字以内（`body-max-line-length`）。長い本文は `git commit -F <file>` で渡す
  - **`git commit` を含む呼び出しには、コミット前の準備（`git add`・message ファイルの作成）を混ぜない。**
    PreToolUse ゲート（kaizen 等）は `git commit` を含む**呼び出し全体**を実行前にブロックするため、
    同一コマンドに入れた準備も走らない。ゲート解消後に `git commit` だけ再実行すると、
    作られていない message ファイルを読もうとして `could not read log file` で落ちる
    （ブロックの症状と別物に見えるため原因を取り違えやすい）。準備は別コマンドで先に済ませる
  - **ゲートの判定は字面で決まるので、`git commit` を含まない呼び出しもリテラルだけで止まる。** テスト・コメント・置換文字列に
    検出語が現れるだけでブロックされるため、検出語を部分文字列に分けて構築する（python なら `"com" + "mit"`）か、ファイル編集ツールへ迂回する。
  - **実行中のセッション自身を検査する仕組み（PreToolUse hook 等）の検出範囲を広げるときは、自分のツール呼び出しが新たに何に当たるかを先に 1 行宣言する。**
    区切り文字クラスを広げた直後に自分の編集コマンドが 2 度ブロックされた記録がある
  - 使用する種別は `commit-types.js` を単一の真実として定義する（commitlint の `type-enum`・semantic-release の `releaseRules`・`.github/dependabot.yml` の `commit-message.prefix` が共有。`build` / `style` は使わない。依存更新は `chore`）
    - commitlint / semantic-release はコードで `commit-types.js` を import するが、dependabot.yml は手書きのため `scripts/commit-types-consistency.test.js` が型の整合を CI で検査する
- **禁止**: `main` への直接 push、commit の `--amend`、force push。無関係な変更を同一 commit に混ぜない
- **`main` の保護**: ルールセットで force push とブランチ削除をブロックし、PR と CI 必須チェック（`Supply chain` / `Lint` / `GitHub Actions lint` / `Secret scan`）の通過を要求する
  - CI は `pull_request` に加え `push: main`（マージ後の main）でも起動する。新設の `Secret scan` ジョブは GitHub のルールセットで必須チェックに追加する（リポジトリ設定側の手動作業）

## 脆弱性対応

Dependabot の pnpm 11 未対応期間の脆弱性確認・起票フロー（`pnpm-audit-alert-issue` / `dependabot-alert-issue` の連携）と、
major 更新に自動シグナルが出ない前提での手動確認方針は [`docs/vulnerability-handling.md`](docs/vulnerability-handling.md) を参照する。

## エージェントの自己設定編集について

コーディングエージェントは自身の設定ファイルの編集が制限される場合がある（自己改変ガード）。設定ファイルを書き換える作業（kaizen の Hook セットアップ等）でブロックされたら、適用すべき内容を一時ファイルに書き出し、ユーザーに `! cp <tmp> <設定ファイル>` 等での適用を依頼する。

**ブロックされないこともある。** ガードが効くかは版と権限モードに依るので、**権限・検査を緩める設定変更は、止められるかどうかに関わらず人に確認する。** 下表の可否は前提にせず、その場で実測した結果を優先する。

| エージェント   | 自己設定ファイル                                     | 編集可否                                                                              |
| -------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Claude Code    | `.claude/settings.json` と `~/.claude/settings.json` | **版と権限モードで変わる。前提にせず実測する**（ある版 × `defaultMode: auto` では確認なく両方書けた。1 環境 1 回の実測なので「可」の側にも一般化しない） |
| Codex          | `.codex/config.toml` / hooks                         | 現状は可（ただし credentials/auth/profile 等の上書きは制限）                          |
| GitHub Copilot | `.github/agents/`（指示）                            | 不可（ハードブロック）                                                                |
| GitHub Copilot | `.github/hooks/`（フック）                           | 可（手動承認ガードの設定を推奨）                                                      |

## コンポーネント選択基準

知識・規約・処理を追加、またはドキュメントを整理・分割するときは、まず skill / rule / hook / ドキュメントのどれに落とすかを判断する。

新しい仕組みを設計する前に、同じ問題の公開済みの解（上流の対応状況・既存スキル・Issue）を調べる。見つからなかった結果も提案に添え、調査未実施と区別できるようにする。

- **skill**: 人／エージェントが実行する一連の手順・ワークフロー
- **rule**: 特定のファイル群を触るときだけ関係する規約（`.agents/rules/`。paths を最小スコープで切って自動適用。ファイル種別だけで広く指定〈`**/*.ts` 等〉せず対象ディレクトリまで絞る）
- **hook**: 特定イベントで自動実行する決定論的な処理（ゲート・整形・検査）
- **ドキュメント**: 上記に当たらない知識・方針・仕様。作業対象に依らず常に必要なものは基底ドキュメント（本 `AGENTS.md`）へ集約し、スキル実行時のみ要る詳細は各 `SKILL.md` / `references/` へ置く

詳細な判断基準は `multiagent-setup` スキルの `references/component-selection.md` を参照する。

## 参照ルールガイド

- `.agents/rules/doc-altitude.md`: エージェント向けドキュメント（`AGENTS.md` / `SKILL.md` / `skills/*/references/` / `docs/`）の記載粒度（altitude）。行動に必須な情報だけを single source of truth で置き、重複・読み手のいない節を避ける
- `.agents/rules/github-actions-authoring.md`: GitHub Actions ワークフロー作成・変更時のレビュー観点（必要権限の突き合わせ・happy path 失敗時の fail-safe）。`.github/workflows/**` 編集時に適用
- `.agents/rules/skill-reinstall.md`: `skills/<name>/` 編集後は `scripts/reinstall-skill.sh <name>` でインストール済みコピーを再同期する。`skills/**` 編集時に適用
- `.agents/rules/external-tool-format-verification.md`: 外部ツール（Codex / Copilot / `gh` / GitHub API 等）の設定・Hook・API 形状は公式一次ドキュメントで構造とフィールド意味論を検証してから記述し、検証 URL を併記する。0 件・失敗時の分岐はその状態を作って実測する。`skills/**` 編集時に適用
- `.agents/rules/curl-data-urlencode.md`: 配布スキルの curl 例・スクリプトでは変数値を URL クエリ / フォームに直挿しせず `--data-urlencode`（GET は `-G` 併用）でエンコードする。秘密値は `k@file` で渡し argv 露出を塞ぐ。`skills/**` 編集時に適用
- `.agents/rules/distributed-skill-base-doc-generalization.md`: 配布スキルは基底ドキュメントを `AGENTS.md` に決め打ちせず `CLAUDE.md` / `.github/copilot-instructions.md` のみの下流でも成立させる。`skills/**` 編集時に適用
- `.agents/rules/distributed-skill-bundle-artifacts.md`: 配布スキルが実行時に参照する成果物（テンプレート・スクリプト等）はスキル内（`assets/` / `scripts/` / `references/`）に正本を同梱する。`skills/**` 編集時に適用
- `.agents/rules/api-pagination.md`: `gh api` 等の一覧取得は指定件数で暗黙に打ち切らずページネーションを処理する（`scripts/lint-pagination.js` が検査。単発は `# pagination-ok`）。`skills/**` 編集時に適用
- `.agents/rules/skill-file-format.md`: `SKILL.md` の frontmatter は Agent Skills 仕様（`name` / `description` 最大 1024 バイト / 任意 `argument-hint`）を維持する。`skills/*/SKILL.md` 編集時に適用
- `.agents/rules/eval-assertion-discrimination.md`: 回帰 eval のアサーション・fixture は書いた時点で「弁別・到達・材料・主価値・入力が答えを持っていないか・正本整合」の 6 点を検証し、採点は位置でなく assertion のテキストで対応づけ、出力内の矛盾を fail にする。`skills/*/evals/**` 編集時に適用
- `.agents/rules/eval-run-scope.md`: eval の実走は起動前に目的とスコープを宣言する。既定は入力が変わった eval だけを `with_skill` / `without_skill` 各 1 run で、
  benchmark（3 run × 2 config）へ広げるのと実走中の executor 切り替えは人が決める。正本は `docs/skill-development.md`。`skills/*/evals/**` 編集時に適用
- `.agents/rules/state-space-and-mutation-proof.md`: 検査を書く前に入力形式・一致の単位・証拠フィールド・期待集合の出所を決め、状態空間の軸は判定に使う全入力で引く
  （各軸に「読めない」を含める）。fail-closed なゲートは「落とす入力」と「通さねばならない入力」を同じ数だけ列挙し、
  変異実証は終了コードでなく「対象テストが走り狙った assertion が落ちたこと」で判定する。`scripts/**` / `skills/*/scripts/**` / `skills/*/evals/**` 編集時に適用
- `.agents/rules/skill-consistency-pass.md`: 配布スキルの変更時に、`docs/skill-development.md` の push 前整合パスを実行する入口。`skills/**` 編集時に適用

## 参照スキルガイド

- `multiagent-setup`: スキル・ルール・Hooks・ドキュメントをマルチエージェント対応構造でセットアップする
- `kaizen`: セッションから学びを抽出し根本原因を分析してスキル・ルール等に反映する
- `git-worktree`: git worktree による作業隔離の機構を担う。渡された branch に worktree を用意してセッションをそこへ移し（作るだけでは隔離にならない）、`.gitignore` 対象ファイルの運搬、検査ツールからの除外、clean 確認付きの後片付けまでを標準化する。branch の作成と Issue との紐付けは行わず呼び出し側に委ねる。
  作成手段に branch を作らせる経路（`EnterWorktree` の `name` / `git worktree add -b` 等）を PreToolUse で通知する branch guard hook を同梱し、`setup` で配線する
- `issue-create`: 短い説明から GitHub Issue を作成する。重複チェック・`.github/ISSUE_TEMPLATE/` 参照・ドラフト承認を経て起票する。着手は `issue-start` に引き継ぐ
- `issue-start`: GitHub Issue を起点に branch 作成・実装・commit・PR 作成までを標準化する。`--branch-only` は branch を用意した時点で返すモードで、実装を自分で持つスキル（`parity-component` / `parity-replace`）からの委譲に使う。
  worktree で着手する場合も branch は `gh issue develop`（`--checkout` なし）が作り、worktree の機構は `git-worktree` へ委譲する
- `issue-batch`: 複数 Issue を入力順に隔離 worktree・独立 branch / PR で連続処理し、ローカルレビュー、検証、Kaizen、PR 収束、
  merge（GitHub の auto-merge／エージェントが PR の状況を実測して merge、を `merge_mode` で選択）、Issue close、deployment、branch cleanup まで追跡する。
  初回は `setup` で無人実行ポリシーとマージ方式を確定する
- `pr-review-handle`: PR のレビューコメント（全レビュアー対象）を確認・妥当性判断・必要時のみ修正・返信・解決（resolve）する。`--push` で commit・push まで行う。対応後の再レビュー依頼先は `pr-review-handle` の `references/review-tool.md` で解決する
- `dependabot-merge`: Dependabot PR の CI 確認・影響レビュー・判断のコメント記録・マージを標準化する。PR 単体または `--all` で open な全 PR を処理。`>=1.0` の決定論的自動マージは `.github/workflows/dependabot-automerge.yml` が担い、本スキルは 0.x や自動マージ未設定リポジトリでの手動判断を受け持つ
- `dependabot-alert-issue`: Dependabot alerts を確認し、解消するための Issue を作成する。着手可否で分類し severity・パッケージ単位でグルーピング、着手できないものは着手可能条件を明記。設定で特定 alert の無視・dismiss も指定できる。起票後の着手は `issue-start` に引き継ぐ
- `pnpm-audit-alert-issue`: Dependabot の pnpm 11 対応（dependabot/dependabot-core#14794）完了までの private skill。`pnpm audit --json` を正規化し、`dependabot-alert-issue` の外部 audit findings mode で脆弱性対応 Issue を作る
- `pr-finalize-loop`: 作成済み PR の CI エラー解消とレビュー対応を CI 成功＋未解決なしまで自律ループ（修正・返信/解決・commit/push・再レビュー依頼）。
  依頼先は `pr-finalize-loop` の `references/review-tool.md` で解決し、`--max-iterations` は既定 5。単体対応は `pr-review-handle`
- `aws-architecture-diagram`: AWS 構成図を IaC（CDK/Terraform 等）や説明から spec に起こし SVG 生成する。作図ルール（交差最小・直交配線・軸整列）に従い、環境（prod/local 等）を単一ベース spec ＋ 変換で出し分け、PNG 化して目視確認しながら反復。初回は setup で対話導入、以降 update
- `box`: Box のファイル/フォルダを Box REST API（`curl` + `jq`）で参照・検索・更新する。フォルダ一覧・メタ取得・ダウンロード・検索・アップロード・新バージョン作成を、Dev Token または OAuth refresh のトークンで実行。MCP・SDK・追加ランタイム不要
- `replace-strategy`: 仕様を変えないアプリケーションリプレイスの入口。現行アプリを実測して戦略を決め、機能に分解して姉妹スキル
  （current-environment-bootstrap / golden-dataset / parity-component / parity-suite / parity-replace / parity-diff）へ振り分ける（自分では実装しない）。
  `setup` / `issues` / `status` / `evidence`（確定した要求単位の根拠を features.md へ書き戻す唯一の経路）の 4 モード。測定できなければ停止する
- `current-environment-bootstrap`: replace-strategy 姉妹。先方から受領した資産だけを起点に現行テスト環境（current target）を再構築する。
  資産の棚卸しと受領済み／導出可能／不足の分類、DB スキーマ・設定の復元、データ意味論の根拠収集、先方・SME 向け質問票、最小の暫定起動データ、起動・認証・到達の実測、空環境からの再実行検証。
  推測でドメイン値を確定せず来歴不明データは投入しない。`current.origin: received-assets` のとき setup が測定前に委譲
- `golden-dataset`: replace-strategy 姉妹。現新比較用の共通データセットを冪等・決定論的な投入ツール（TypeScript / SQL）で構築（本番非参照）。2 フェーズ（A: 現行テスト環境へ投入検証、B: 新側スキーマへ写像・現新一致検証）、バージョンで陳腐化検出。setup 完了が前提
- `parity-component`: replace-strategy 姉妹。共通 UI 部品を画面より先に作るときに、現行から部品インスタンス（部品 × ページ）単位で見た目の基準を採り（要素スクショ・状態別の計算後スタイル・当たっている CSS 規則・データ依存部品の実データ）、
  インスタンス間で割れた軸を可変＝引数として決定論的に割り出し、実装してカタログ上で照合する。`capture` / `build` の 2 モード。1 回で 1 部品。画面より先に作らない方針なら使わない
- `parity-suite`: replace-strategy 姉妹。新旧両実装に当てられる合否判定基準を Playwright で構築し故障注入で強度検証。論理名マッピング・寛容な aria スナップショット・API record/replay・視覚ベースライン/ノイズ基準を採取し parity-diff へ渡す。1 回で 1 機能。setup / golden-dataset(A) 前提
- `parity-replace`: replace-strategy 姉妹。parity-suite の論理名に新側を実装する薄い層（ページ単位分割・マッピング例外充填・敵対的レビュー）。branch/commit/PR は issue-start へ委譲、suite が新で green＋静的解析通過で完了。前提: setup・golden-dataset(A)・対象 slug の parity-suite
- `parity-diff`: replace-strategy 姉妹。現新差分を画素・特性照合・aria の 3 経路の差分器（強度検証済み）で検出し LLM は分類のみ。要対応は parity-replace へ差し戻し、収束は未説明差分ゼロ＋未修正回帰ゼロ。前提: setup・golden-dataset・parity-suite・parity-replace の新側 green
