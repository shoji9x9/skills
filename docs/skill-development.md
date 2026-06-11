# スキル開発ワークフロー

スキルの作成・改善・評価・リリースに関する詳細手順。全エージェント共通の前提・規約は `AGENTS.md` を参照する。

スキルの作成・改善・評価には `skill-creator` スキルを使う。

## スキルを追加・修正する

1. `skills/<name>/` を作成または編集する
2. `skills/<name>/evals/evals.json` にテストケースを追加・更新する
3. `scripts/reinstall-skill.sh <name>` でインストール済みスキルを更新する
4. スキルにセットアップ手順が定義されている場合は実行する。既存ファイルや既存 Hook がある場合は上書きせず、更新するか確認する
5. skill-creator で回帰テストを実行し `tests/<name>/iteration-N/` に結果を保存する
6. `gh skill publish --dry-run` でバリデーションを確認する
7. PR を作成してレビュー・マージする（リリースは CD が自動で行う）

## リリース（CD）

`skills/**` を含む変更が `main` にマージされると `.github/workflows/release.yml` が自動公開する（詳細は同ファイル参照）。**手動でのタグ付け・publish は不要**。

- バージョンはリポジトリ単位の git タグ（conventional commits から決定）が唯一の真実。スキル毎の独立バージョンは持たない
- `package.json` の `version` はリリースに使わないため `0.0.0` 固定（書き換えない）

## スキル修正後の再インストール

このリポジトリでは Claude Code / Codex / GitHub Copilot の3エージェントを使うため、開発中スキルは `--agent codex` で `.agents/skills/<name>/` に実体を置き、`.claude/skills/<name>` にシンボリックリンクを張る単一ソース構成でドッグフードする。スキルを修正した場合は、手作業ではなくスクリプトで再インストールする:

```bash
scripts/reinstall-skill.sh <name>
```

このスクリプトは `.agents/skills/<name>/` に実体をインストールし、`.claude/skills/<name>` にシンボリックリンクを作成する。
また、`gh skill install --from-local` が自動追加する `metadata.local-path` をインストール済み `SKILL.md` から削除する。
現時点の `gh skill install --help` には、このメタデータ追加を無効化するオプションはない。

このスクリプトは **このリポジトリ専用の開発ツール**であり、配布スキルには同梱されない（インストール先には付いて行かない）。
**ローカル未公開の編集**を `.agents/` / `.claude/` に反映するためのもので、**リモート公開版**を更新する `gh skill update` とは役割が異なり代替もできない。
配布スキルの利用者は `gh skill install` / `gh skill update` を使う（README のインストール手順を参照）。

## 回帰テストを実行する

各スキルのテストケースと手順は `skills/<name>/evals/`（`evals.json` / `README.md`）にある。

### eval 実行の隔離（必須）

eval プロンプトはファイルを生成・改変する（スキル・ルール・Hooks・`AGENTS.md` 等）。**このリポジトリの作業ツリーで直接実行してはならない。**

**落とし穴**: コーディングエージェントに「`/tmp` で作業して」と `cd` で指示しても安全にならない。
エージェントの Bash ツールは **`cd` を呼び出し間で保持せず、各呼び出しで cwd が（リポジトリルートに）リセットされる**。
スキルの手順は `mkdir -p .agents/skills/<name>` や `ln -s ../../...` のような**相対パス**なので、後続の呼び出しでこのリポジトリを汚染する。
実際にこの方式で `.agents/skills/` を汚した事例がある（[.kaizen/2026-06-08-eval-isolation-cd-not-persisted.md](../.kaizen/2026-06-08-eval-isolation-cd-not-persisted.md)）。

**対策**: `scripts/run-skill-eval.sh` を使う。
ランチャ側で cwd を固定したヘッドレス `claude -p` を**使い捨ての空プロジェクト**（`/tmp` 配下）で実行するため、相対パス操作も cwd リセットも常にその dir 内に収まる。
`with_skill` はその dir にスキルを設置し、`without_skill` は設置しない（親に `.claude/skills` が無いので**公正なベースライン**になる）。

```bash
# 1 run を隔離実行（生成物は --out 配下に保存され、リポジトリは汚れない）
scripts/run-skill-eval.sh \
  --skill <name> --config with_skill \
  --prompt "<evals.json の prompt>" \
  --out tests/<name>/iteration-N/eval-<id>/with_skill/run-1 \
  --model opus
# without_skill も同様に --config without_skill で実行する。
```

各 run の `result.json`、`project-tree.txt`、`project-files/` を `evals.json` の assertions と突き合わせて採点し、`grading.json` を残す。`project-files/` には採点に使う軽量なテキスト生成物だけを保存し、使い捨てプロジェクト全体は `tests/` 配下へコピーしない。採点後に下記の集計へ進む。

### eval 環境の前提（runtime / repo / 非対話）

`run-skill-eval.sh` の使い捨てプロジェクトは「空・未 trust・非対話」だ。スキルの**前提条件**をハーネス側で用意しないと、失敗がスキル欠陥か環境かを切り分けられずシグナルが汚れる。eval を組むとき次を満たす:

- **ランタイム（mise shim）**: 使い捨てプロジェクトに `mise.toml` が無く、mise shim（`python3` / `node` / `jq` 等）は untrusted／未設定で `No version is set for shim` で落ちる。
  スキルが叩くランタイムは shim 単一依存にせず、システムランタイムへフォールバックするか、fixture 側で `mise trust` 済みの runtime を PATH 前段に置く。
- **対象リポジトリのコンテキスト**: `gh` / `git` 系スキルは cwd の repo 文脈に暗黙依存しない（引数の URL/番号から `OWNER/REPO` を確定し `--repo` で明示する）。
  シナリオでは**実在する** PR/Issue 番号を使い、必要なら fixture で対象 repo を clone するか `gh repo set-default OWNER/REPO` する。架空の `PR#42` / `other-org/other-repo` は `Could not resolve` で必ず落ちる。
- **非対話**: ヘッドレス `claude -p` には `AskUserQuestion` の応答者がいない。質問を投げるとツールがエラーし進行が止まる。
  eval プロンプトは意図が一意に決まる形（フラグ・URL を明示）で与え、ハーネス側（`run-skill-eval.sh`）がプロンプト先頭に非対話の縮退指示を注入する（配布スキルには載せない）。

### 集計

集計スクリプト（skill-creator 同梱）で結果を `tests/<name>/iteration-N/` に集約する:

```bash
# skill-creator のインストール先を自動検索（各エージェントのスキルディレクトリを横断）
REPO=$(git rev-parse --show-toplevel)
SKILL_CREATOR=$(find ~/.claude/skills .claude/skills .agents/skills -maxdepth 1 -name skill-creator -type d 2>/dev/null | head -1)
cd "$SKILL_CREATOR"
# benchmark_dir は実在パスを読むので絶対パスで渡す（cd 後に相対パスだと解決できない）。
# --skill-path は metadata 用の表示文字列。絶対パスを避け <repo> プレースホルダ形式で渡す
#（下記の絶対パス除去方針に合わせる。未指定だと <path/to/skill> になる）。
mise exec python -- python -m scripts.aggregate_benchmark \
  "$REPO/tests/<name>/iteration-N" \
  --skill-name <name> \
  --skill-path '<repo>/skills/<name>'
```

`aggregate_benchmark.py` は `executor_model` / `analyzer_model`（= `<model-name>`）と `runs_per_configuration`（= `3`）をハードコードしており、これらを設定する CLI 引数は無い。生成後に手動で実値へ直してからコミットする:

- `benchmark.json` / `benchmark.md` の `<model-name>` を実際のモデル名（例: `claude-opus-4-8`）に置換する（モデル名は秘匿情報ではないのでマスクしない）。
- `runs_per_configuration` と `benchmark.md` ヘッダの「N runs each per configuration」を実際の run 数に合わせる。

スキルのインストールまたはセットアップ手順を変更した場合も、そのスキルで定義された評価を実行する。テスト結果にローカル絶対パスやユーザー固有情報が含まれる場合は、コミット前に `<repo>` や `<home>` などのプレースホルダーへ置換する。

未コミットの skill 変更をベンチする場合、worktree 分離を使うと HEAD の古い版を測ってしまう。読み取り専用ドライランなら分離なしで作業ツリー版を測る（または先に commit する）。
