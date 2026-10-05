# ツールとチェック

`AGENTS.md`「技術スタック」の詳細。ツールの使い方と、pre-commit・CI で実行するチェックをまとめる。

<!-- Issue #372 で AGENTS.md から原文のまま移した。文章の書き換えは後の段階で行う。 -->

## 技術スタック

- **スキル管理**: GitHub CLI (`gh skill`、**v2.90.0+**)、Agent Skills 仕様
- **パッケージマネージャ**: pnpm（mise で管理）。版の正本は `mise.toml`・`package.json` の `packageManager` / `devEngines.packageManager`・`pnpm-lock.yaml` の 4 箇所。
  **npm は使わない**（`package-lock.json` を作らない。誤った PM 利用は `devEngines` が警告する）
  - bump 手順（正本 4 箇所の同期）・broken 版回避は [`docs/package-manager.md`](package-manager.md) を参照
- **フォーマッタ／リンタ**: 下表の通り（**prettier は使わない**）
- **テスト**: skill-creator（eval viewer に Python 3.8+）、集計は `scripts/eval/build-skill-eval-benchmark.js`（Node）
- **環境管理**: mise
- **ツール起動**: スクリプト・lefthook・CI からツールを起動する際は `./node_modules/.bin/<tool>` のハードパスで叩かず、`pnpm exec <tool>`（または mise の shim）経由で起動する
  - **例外: 1 回の実行で同じツールを数十回以上起動するスクリプト**は、`pnpm exec` の起動コスト（実測 1 回約 0.6 秒）が支配的になるため、
    Node のモジュール解決（`createRequire(...).resolve("<pkg>/package.json")` の `bin`）で entry を求めて `node` で起動してよい（現状は `scripts/mutation/check-mutation-proof.js` の子 vitest のみ）。
    この場合も `.bin` のハードパスは使わない
  - **mise の shim は cwd の設定階層で解決する。** リポジトリ外の cwd（`/tmp` 等）から素のコマンド名で起動すると
    `No version is set for shim` で落ちる（グローバル既定が無いため。untrusted とは別の失敗）。
    プロジェクト外で動かす検証は `mise which <tool>` で実体パスを解決して渡すか、cwd をプロジェクト内に保つ

### リント／フォーマット

| 対象                                              | リント              | フォーマット        | 補助検査                                                                                  |
| ------------------------------------------------- | ------------------- | ------------------- | ----------------------------------------------------------------------------------------- |
| Markdown (`*.md`)                                 | `markdownlint-cli2` | `markdownlint-cli2` | `scripts/gates/lint-pagination.js` で shell コードブロック内の `gh api` ページネーションを検査。`scripts/gates/lint-prose.js` で人が読む文章を textlint でチェック |
| JavaScript / TypeScript (`*.js`, `*.mjs`, `*.ts` 等) | `oxlint`          | `oxfmt`             | なし                                                                                      |
| JSON (`*.json`)                                   | `jsonlint`          | `oxfmt`             | duplicate key も検査                                                                      |
| YAML (`*.yml`, `*.yaml`)                          | `js-yaml`（`scripts/gates/lint-yaml.js` が API で 1 プロセスにまとめて読む） | `oxfmt` | なし |
| Shell (`*.sh`)                                    | `shellcheck`        | `shfmt`             | `scripts/gates/lint-pagination.js` で `gh api` ページネーションを検査                          |
| GitHub Actions (`.github/workflows/*.{yml,yaml}`) | `actionlint` + `ghalint` | `oxfmt` | `pinact` で SHA pinning を確認 |

表のうち `shellcheck`・`shfmt`・`actionlint`・`pinact`・`ghalint`・`gitleaks` は mise でインストールし（`mise.toml`）素のコマンド名で起動する。それ以外は pnpm devDependencies（`pnpm exec` で起動）。

- **`oxlint` / `oxfmt` の対象は JS/TS ファミリ全体**（`js` / `mjs` / `cjs` / `jsx` / `ts` / `tsx` / `mts` / `cts`）。CI は引数なし（`pnpm run lint:js`）で走らせるためこの範囲を自動で拾う。
  **lefthook の glob と `format:js*` スクリプトの glob もこの範囲に揃える**——片方だけ狭いと、その拡張子は手元で検査されず CI でだけ落ちる。
- **GitHub Actions のポリシー検査**: `actionlint`（構文）に加え `ghalint`（`permissions`・`timeout-minutes`・`persist-credentials` 等のポリシー）で多層検査する。`ghalint` は全走査のため pre-commit に入れず CI（`GitHub Actions lint`）専任。
- **横断ゲート（ファイル種別に依らない検査）**: pre-commit と CI の `Lint` ジョブで次を走らせる。いずれも対象 0 件を成功に倒さない。
  `scripts/gates/check-rule-symlinks.js`（rule の多エージェント配線）/ `scripts/gates/check-control-chars.js`（テキスト拡張子への制御バイト混入）/
  `scripts/gates/check-eval-reachability.js`（eval の assertion と prompt の対応）/ `scripts/gates/check-skills-sync.js` / `scripts/gates/check-js-extensions.js` /
  `scripts/gates/check-skill-frontmatter.js` / `scripts/gates/lint-pagination.js` /
  `scripts/gates/check-kaizen-refs.js`（`.kaizen/` の学びへの参照の実在。意図的な非実在は `scripts/gates/kaizen-refs-exemptions.json`）/
  `scripts/gates/check-identical-copies.js`（同一であるべきコピー。組は `scripts/gates/identical-copies.json`）/
  `scripts/gates/check-skill-checks.js`（配布スキルの検査〈`*-check.*`〉を、利用者の入口へ配線する〈`skills/<name>/checks.json`〉か
  しない〈理由付きで `scripts/gates/skill-checks-unwired.json`〉かのどちらかへ分類）/
  `scripts/gates/check-time-sensitive-prose.js`（日付・「現状は」「当面」を Tier 1〜3 の文書とコメントに書かない。変異の件数・全件の実測値の置き場は `mutation-proof.yml` だけ）/
  `scripts/gates/check-doc-tiers.js`（文書の階層。原本は `scripts/gates/doc-tiers.json`、`.agents/rules/doc-altitude.md` の表は `--fix` で生成する）/
  `scripts/gates/check-doc-refs.js`（リンクと節名の実在、参照の向き。導入先で生成するファイルは `scripts/gates/doc-refs.json`、保留は `scripts/gates/doc-pending.json`）/
  `scripts/gates/check-skill-index.js`（スキルガイド・README とスキル実体の対応）/
  `scripts/gates/lint-prose.js`（人が読む Markdown の文章。書き換え前のファイルは `scripts/gates/prose-lint-pending.json`）/
  `scripts/gates/check-word-list.js`（`.textlint/word-list.md` と `.textlint/words.json` の一致）/
  `scripts/gates/check-agents-md-size.js`（AGENTS.md のサイズ。ブランチで 30 KiB を超えたら 24 KiB 以下まで縮めさせる。超えたかは履歴で判定し、上限は `scripts/gates/agents-md-size.json`）。

### 変異実証（CI 専任）

`scripts/mutation/check-mutation-proof.js` が `scripts/**/*.mutations.json` の宣言を再実行し、
各変異について「置換が当たったこと」と「宣言したテストがそれだけ落ちたこと」を確かめる。
検査の検出能力の記録を散文コメントで持つと腐るため、データとして持ちここで機械的に取り直す。

- **PR では差分に当たる宣言だけ**を測る（`--changed-since origin/<base>`。当たり方は「実行器が変わった＝全件」
  「宣言ファイル自身」「その宣言の `test_file` か変異の対象ファイル」の 3 通り）。全件は毎 PR では払えない重さになる（実測値は `.github/workflows/mutation-proof.yml` のコメント）。
  1 変異 = 対象テストファイル 1 回の実行なので、対象テストは子プロセスを起動せず `main` を直接呼び、CLI としての起動は陽性コントロールの数本に絞る。
  CI では選んだ変異を matrix で 6 分割して並べて走らせ（`--shard i/N`）、必須チェック名 `Mutation proof (PR)` は全シャードの成功を確かめる集約ジョブが持つ。
  実行器のテストは本物の vitest を e2e の 3 本に絞り、残りはスタブで回す（`MUTATION_PROOF_TEST_COMMAND`）。
- **全件は週次の定期実行**（`.github/workflows/mutation-proof.yml`）。対象も検査も変わっていない宣言は前回の実証が
  有効だが、共有ライブラリやツールの版で前提が崩れることはあるので測り直す。
- pre-commit には入れない（実行中に対象ファイルを書き換えて戻すため、staged な変更と混ざると取り違える）。
  **並行して走らせない**——同時実行はロックで弾くが、無関係な `pnpm test` と重ねると変異中の中間状態を読んで無関係に赤くなる（実測）。
- **実行器自身を変異させる宣言があるときは、`--changed-since` を測るテストを `--only` で有界にする。**
  選択の判定を常に真にする変異が入ると、入れ子の runner が指数的に増える（実測で 30 分以上・21 プロセス以上、
  殺した後の作業ツリーに変異が残った）。

### その他のチェックと整形

- **実行前ゲート（PreToolUse）**: `scripts/hooks/bash-command-guard.sh` が、文章規約で防げず再発した 2 形を Bash 実行前に止める——
  `gh api` と同じセグメントの `--body-file`（`gh api` にこのフラグは無い。`gh pr` / `gh issue` の `--body-file` は通す）と、
  文字クラスで自分を避けていない `pkill -f` / `killall -f`（照合対象が full command line なので自分のシェルに一致する）。
  3 エージェントぶん配線してある（`.claude/settings.json` / `.codex/hooks.json` / `.github/hooks/kaizen-session.json`）。
- **シークレット走査**: `gitleaks` で行う。pre-commit はステージ差分（`gitleaks git --staged`）、CI はリポジトリ全体・全履歴（`Secret scan` ジョブ・`fetch-depth: 0`）を走査する。
- **整形の割り当ての正本は `lefthook.yml` の glob と `package.json` の `format:*`**。上表はその要約であって、ツールが扱える範囲の上限ではない。
  フォーマッタを当てる前に、そのファイル種別がそのフォーマッタに**割り当てられているか**を正本で確かめる。
  割り当て外のファイルに `--check` を当てて赤くなっても、それは誰も強制していない検査なので指摘ではない（直すと無関係な差分になる）。
- **`oxfmt` には Markdown を渡さない**。oxfmt は渡されたファイルを種類で判定して整形するため、`.md` を渡すと表の桁揃えまで行う。
  Markdown の整形は `markdownlint-cli2 --fix`。**oxfmt にディレクトリを渡さず対象ファイルを列挙する**（ディレクトリを渡すと目的外のファイルが黙って書き換わる）。
  生成物の整形は生成スクリプト自身が出力ファイルを列挙して行い、手順書で人に oxfmt を当てさせない。
- **Markdown の行長（MD013）**: `markdownlint-cli2` の MD013 は非 strict 運用（`line_length: 200`、`code_blocks` / `tables` / `headings` は除外）。
  200 桁超でも**半角スペース（改行可能点）が 200 桁を超えた位置に残る行だけ**を弾く。
  純 CJK の長行は分かち書きしないため通るが、英数字・ツール名など半角スペースを含む語を長行に足すと fail する。
  日本語長行に英数を追記したら、200 桁以内に収めるか、200 桁超に半角スペースを残さないよう折り返す。

JavaScript の拡張子は配布有無で使い分ける（新規ファイルもこれに従う）。

- **配布物は `.mjs`**: 配布スキル一式（`skills/**`）に含まれる JavaScript。インストール先の `package.json` の `type` に依存せず Node が常に ESM として解釈するため。
- **非配布物は `.js`**: リポジトリ内ツール・テスト（`scripts/**/*.js`）と、配布しない private skill（`.private-skill`。`.agents/skills/<name>/` のみに存在）のスクリプト。
  `package.json` の `"type": "module"` 下で ESM として動くため拡張子で ESM を明示する必要がない。
- **ツールが読む設定は `.ts`**: `vitest.config.ts` / `scripts/lib/vitest-global-setup.ts` / `commitlint.config.ts` / `release.config.ts` / `commit-types.ts` /
  `oxlint.config.ts` / `oxfmt.config.ts`。各ツールが `.ts` を自動探索して読む（commitlint と semantic-release の TypeScript loader が要る `typescript` は devDependencies に明示する。
  oxlint の `.ts` 設定は Node.js 経由の起動が前提なので、素のバイナリではなく `pnpm exec oxlint` で起動する）。
  `.ts` を読まないツールの設定は元の形式のまま（markdownlint-cli2 は `.mjs` / `.cjs` / JSON / YAML、lefthook は YAML / JSON / TOML、
  mise・pnpm・GitHub・各エージェントの設定は形式がツール側で決まっている）。
- この規約は `scripts/gates/check-js-extensions.js` が lefthook pre-commit と CI（`Lint` ジョブ）で検査する（`skills/**` 配下の `.js` と `scripts/**` 配下の `.mjs` を fail させる）。

`tests/**` はリント／フォーマット対象に含める。`.agents/skills/**` と `.claude/**` はインストール済みコピー／エージェント用シンボリックリンクのため対象外にする。
ただし `.agents/rules/`（rule の実体）と private skill（`.private-skill` を持つ `.agents/skills/<name>/`）は対象にし、rule へのリンクの `.github/instructions/` を対象外にする。
