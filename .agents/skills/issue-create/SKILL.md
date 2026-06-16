---
description: GitHub Issue の作成を `gh` で標準化するスキル。バグ・機能要望・タスクなどの短い説明を受け取り、対象リポジトリ確認・重複チェック・`.github/ISSUE_TEMPLATE/` のテンプレ検出・本文ドラフトのユーザー承認・`gh issue create` での起票までを進める。「Issue を作って」「課題として登録して」「バグを起票して」「issue-create」や、新しい機能要望・不具合・タスクを GitHub Issue にしたい依頼で必ず発動する。作業着手は姉妹スキル issue-start が担う。
license: MIT
name: issue-create
---
# Issue Create

GitHub Issue の作成を `gh` で標準化する。起票した Issue に着手する流れは姉妹スキル [[issue-start]] が担う。命名体系も `issue-create` / `issue-start` で揃えている。

このスキルは「何を」「なぜ」を簡潔に伝える Issue を作ることに集中する。実装の詳細はブランチ側（issue-start 以降）で扱うため、Issue 本文に書きすぎない。

## 使い方

```text
issue-create <説明> [--repo <owner>/<repo>]
```

- `<説明>`: Issue にしたい短い説明（バグ報告 / 機能要望 / タスクなど）。
- `--repo <owner>/<repo>`: 対象リポジトリ（省略時は現在の repo）。

例: `issue-create ログイン画面が SSO で落ちる` / `issue-create ダークモードを追加したい` / `issue-create README のインストール手順が古い --repo <owner>/<repo>`

- 自然文でも発動する:「Issue を作って」「課題として登録して」「バグを起票して」。

## 前提

- **ツール**: `gh`（GitHub CLI）
- **前提スキル**: なし（起票後の着手は `issue-start` に引き継ぐが必須ではない）
- **MCP**: なし
- **シェル**: bash（POSIX 互換シェル）。コマンド例は bash 前提のため、Windows では WSL / Git Bash 等の bash 環境で実行する
- node / pnpm / python などのランタイムは不要。

## 基本フロー

1. 対象リポジトリを確認する
   - 省略時は現在の repo（`gh repo view --json nameWithOwner -q .nameWithOwner`）を対象にする
   - 明示指定があればそれに従う
2. 重複・関連 Issue を確認する
   - `gh issue list --state open --limit 50` を取得し、同趣旨・重複の Issue がないか走査する
   - 重複や強く関連する Issue があれば、新規作成の前にユーザーへ知らせて方針を確認する
3. 種別を見極める（バグ / 機能要望 / タスク など）
4. テンプレートを検出して読む（詳細は「テンプレートの扱い」を参照）
   - まずインストール先リポジトリの `.github/ISSUE_TEMPLATE/` を確認し、種別に合うテンプレ（例: `bug_report.md` / `feature_request.md`）があればそれを優先して読む
   - 該当テンプレが無い場合は、スキル同梱の `assets/issue-templates/` を本文構成のひな型として使う。あわせて `.github/ISSUE_TEMPLATE/` へ同梱テンプレをコピー導入するか**ユーザーに尋ねる**（自動では入れない。既存ファイルは上書きしない）
   - 同梱にも種別が合うものが無ければ、汎用構成（背景・目的 / 提案内容 / スコープ / 受け入れ条件）で起票する
5. タイトルと本文をドラフトしてユーザーに提示する
   - タイトルは conventional commits 風の接頭辞（`fix:` / `feat:` / `docs:` など）を付け、60〜72 字程度・末尾ピリオドなしにする
   - 本文はテンプレのセクションに沿って埋める。空欄のまま残るプレースホルダーや実装詳細の書きすぎを避ける
   - ラベルはテンプレ由来（bug / enhancement など）を踏襲する
6. **ユーザーの承認を得てから**起票する
   - 多行本文はシェルのエスケープ崩れを避けるため一時ファイルに書き出し、`--body-file` で渡す

     ```bash
     tmp=$(mktemp)
     printf '%s' "<本文>" > "$tmp"
     gh issue create --title "<タイトル>" --body-file "$tmp" --label "<ラベル>"
     rm -f "$tmp"
     ```

   - 別リポジトリを対象にする場合は `--repo <owner>/<repo>` を付ける
7. 作成された Issue の URL を返す。続けて着手するなら `issue-start <番号>` を案内する

## テンプレートの扱い

テンプレの正本はスキルに同梱されている。これはこのスキルが `gh skill` で任意のプロジェクトに配布されるため、テンプレが付いて行かないと参照先が無くなるのを避けるため。

- **正本（同梱）**: `assets/issue-templates/bug_report.md` / `assets/issue-templates/feature_request.md`。配布時にスキルと一緒に運ばれる
- **インストール先を尊重**: 起票時はまずインストール先リポジトリの `.github/ISSUE_TEMPLATE/` を確認し、該当テンプレがあれば**それを優先**する。各リポジトリ固有のテンプレを上書き・無視しないため
- **無いときの導入**: インストール先に該当テンプレが無い場合は同梱テンプレをひな型に使う。さらに `.github/ISSUE_TEMPLATE/` へ同梱テンプレをコピー導入するかを**ユーザーに尋ねてから**行う。既存ファイルがあれば上書きしない
- **フォールバック**: 同梱・インストール先のいずれにも種別が合うテンプレが無いときだけ、汎用構成（背景・目的 / 提案内容 / スコープ / 受け入れ条件）で起票する

参考の導入コマンド（ユーザーが希望した場合のみ・既存は残す）:

```bash
mkdir -p .github/ISSUE_TEMPLATE
cp -n <skill>/assets/issue-templates/bug_report.md .github/ISSUE_TEMPLATE/
cp -n <skill>/assets/issue-templates/feature_request.md .github/ISSUE_TEMPLATE/
```

## ルール

- ドラフトをユーザーに見せ、承認を得るまで起票しない。意図とずれた Issue を作らないため
- スコープや種別が曖昧なら、推測で埋めずに確認する
- 重複チェックを必ず行う。同趣旨の Issue が乱立すると追跡コストが上がる
- 本文に実装の詳細（具体的なファイルパス・コード片）を書きすぎない。陳腐化しやすく、実装はブランチ側で扱うため
- 多行本文は `--body-file` で渡す。`--body` に直接長文を入れると改行や特殊文字で崩れやすい

## 追加確認が必要な条件

以下のときだけ起票前に確認する。

- 要件・スコープが曖昧で、本文を推測で埋めることになる
- 重複・関連 Issue が見つかり、新規作成すべきか判断できない
- 対象リポジトリが現在の repo と異なる可能性がある
