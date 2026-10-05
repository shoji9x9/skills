---
argument-hint: <説明> [--repo <owner>/<repo>]
description: GitHub Issue の作成を `gh` で標準化するスキル。バグ・機能要望・タスクなどの短い説明を受け取り、対象リポジトリ確認・重複チェック・`.github/ISSUE_TEMPLATE/` のテンプレ検出・本文ドラフトのユーザー承認・`gh issue create` での起票までを進める。「Issue を作って」「課題として登録して」「バグを起票して」「issue-create」や、新しい機能要望・不具合・タスクを GitHub Issue にしたい依頼で必ず発動する。作業着手は姉妹スキル issue-start が担う。
license: MIT
name: issue-create
---
# Issue Create

GitHub Issue の作成を `gh` で標準化する。起票した Issue に着手する流れは、姉妹スキル [[issue-start]] が担う。名前も `issue-create` と `issue-start` で揃えている。

このスキルは、「何を」「なぜ」を簡潔に伝える Issue を作ることに集中する。実装の詳細はブランチを作った後（issue-start 以降）で扱うので、Issue の本文に書きすぎない。

## 使い方

```text
issue-create <説明> [--repo <owner>/<repo>]
```

- `<説明>`: Issue にしたい短い説明（バグ報告・機能要望・タスクなど）。
- `--repo <owner>/<repo>`: 対象のリポジトリ。省略したら現在の repo を対象にする。

例: `issue-create ログイン画面が SSO で落ちる` / `issue-create ダークモードを追加したい` / `issue-create README のインストール手順が古い --repo <owner>/<repo>`

自然文でも発動する（「Issue を作って」「課題として登録して」「バグを起票して」）。

## 前提

- ツール: `gh`（GitHub CLI）
- 前提スキル: なし。起票した後の着手は `issue-start` に引き継げるが、必須ではない
- MCP: なし
- シェル: bash（POSIX 互換シェル）。コマンド例は bash で書いているので、Windows では WSL や Git Bash などの bash 環境で実行する
- ランタイム: 要らない（node・pnpm・python など）

## 基本フロー

1. 対象のリポジトリを確かめる。
   - 指定が無ければ、現在の repo（`gh repo view --json nameWithOwner -q .nameWithOwner`）を対象にする。
   - 指定があれば、それに従う。
2. 重複する Issue と関連する Issue を確かめる。
   - 説明のキーワードで絞って一覧を取得し、同じ趣旨の Issue や重複する Issue が無いかを見る。

     ```bash
     gh issue list --state open --search "<キーワード>" --limit 100 --json number,title,url
     ```

   - `gh issue list` には `--paginate` が無く、`--limit` の件数で警告なしに打ち切られる。
     返った件数が `--limit` に達したら打ち切られたものとして扱い、キーワードを絞るか `--limit` を上げて再取得する。
     言い換えがありそうなら、別のキーワードでも検索する。
   - 重複する Issue や強く関連する Issue があれば、新しく作る前に利用者に知らせて方針を確かめる。
3. 種別（バグ・機能要望・タスクなど）を見極める。
4. テンプレートを探して読む（詳しくは「テンプレートの扱い」）。
   - まず、インストール先のリポジトリの `.github/ISSUE_TEMPLATE/` を見る。種別に合うテンプレート（例: `bug_report.md`・`feature_request.md`）があれば、それを優先して読む。
   - 合うテンプレートが無ければ、スキルに同梱した `assets/issue-templates/` を本文の構成のひな型にする。
     あわせて、同梱のテンプレートを `.github/ISSUE_TEMPLATE/` にコピーするかを利用者に尋ねる。自動ではコピーせず、既存のファイルは上書きしない。
   - 同梱のテンプレートにも種別に合うものが無ければ、汎用の構成（背景・目的、提案内容、スコープ、受け入れ条件）で起票する。
5. タイトルと本文の下書きを作り、利用者に見せる。
   - タイトルには conventional commits と同じ形の接頭辞（`fix:`・`feat:`・`docs:` など）を付け、60〜72 字程度にし、末尾にピリオドを付けない。
   - 本文はテンプレートの節に沿って埋める。空欄のままのプレースホルダーを残さず、実装の詳細を書きすぎない。
   - ラベルはテンプレートのもの（bug・enhancement など）を使う。
6. 利用者の承認を得てから起票する。
   - 承認を求める確認の UI そのものに、判断の材料（下書きの全文）を入れる。
     直前の通常のテキストが確認のダイアログと同時に見えるとは限らない（Claude Code の AskUserQuestion では、選択肢の preview フィールドに入れる）。
   - 複数行の本文は、シェルのエスケープで崩れないよう一時ファイルに書き出し、`--body-file` で渡す。

     ```bash
     tmp=$(mktemp)
     # 本文はバッククォートや $ を含みうるので、二重引用符ではなく quoted heredoc で書く
     cat > "$tmp" <<'EOF'
     <本文>
     EOF
     gh issue create --title "<タイトル>" --body-file "$tmp" --label "<ラベル>"
     rc=$?
     rm -f "$tmp"
     (exit "$rc")  # gh の失敗を後片付けの終了コードで隠さない
     ```

   - 別のリポジトリを対象にするときは、`--repo <owner>/<repo>` を付ける。
7. 作った Issue の URL を返す。続けて着手するなら、`issue-start <番号>` を案内する。

## テンプレートの扱い

テンプレートの原本はスキルに同梱している。このスキルは `gh skill` で任意のプロジェクトに配布されるので、テンプレートをスキルと一緒に配らないと参照先が無くなる。

| 場面 | 扱い |
| --- | --- |
| 原本（同梱） | `assets/issue-templates/bug_report.md` と `assets/issue-templates/feature_request.md`。配布するときにスキルと一緒に運ばれる |
| インストール先にテンプレートがある | 起票するときは、まずインストール先のリポジトリの `.github/ISSUE_TEMPLATE/` を見て、合うテンプレートがあればそれを優先する。リポジトリ固有のテンプレートを上書きしたり無視したりしないため |
| インストール先にテンプレートが無い | 同梱のテンプレートをひな型に使う。`.github/ISSUE_TEMPLATE/` に同梱のテンプレートをコピーするのは、利用者に尋ねて承認を得てからにする。既存のファイルは上書きしない |
| どちらにも合うものが無い | このときだけ、汎用の構成（背景・目的、提案内容、スコープ、受け入れ条件）で起票する |

利用者がコピーを希望したときは、次のコマンドで導入する。`cp -n` は既存のファイルを残す。

```bash
mkdir -p .github/ISSUE_TEMPLATE
cp -n <skill>/assets/issue-templates/bug_report.md .github/ISSUE_TEMPLATE/
cp -n <skill>/assets/issue-templates/feature_request.md .github/ISSUE_TEMPLATE/
```

## ルール

- 下書きを利用者に見せ、承認を得るまで起票しない。意図とずれた Issue を作らないためである。
- スコープや種別がはっきりしないときは、推測で埋めずに確かめる。
- 重複の確認は必ず行う。同じ趣旨の Issue が並ぶと、追いかける手間が増える。
- 本文に実装の詳細（具体的なファイルパスやコード片）を書きすぎない。すぐ古くなるうえ、実装はブランチを作った後で扱う。
- 複数行の本文は `--body-file` で渡す。`--body` に長い文を直接入れると、改行や特殊文字で崩れやすい。

## 追加確認が必要な条件

次のときだけ、起票する前に確認する。

- 要件やスコープがはっきりせず、本文を推測で埋めることになる。
- 重複する Issue や関連する Issue が見つかり、新しく作るべきかを判断できない。
- 対象のリポジトリが現在の repo と違う可能性がある。
