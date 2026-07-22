---
argument-hint: <Issue URL | 番号> [--plan | --commit | --pr]
description: GitHub Issue を起点に作業開始フローを標準化するスキル。Issue URL や Issue 番号を受け取り、リポジトリ一致確認・feature ブランチ作成と checkout（gh issue develop）・調査・実装・commit・push・PR 作成までを段階的に進めたいときに使う。「Issue から始める」「この issue に着手」「issue-start」や、`--plan` / `--commit` / `--pr` を伴う依頼で発動する。
license: MIT
name: issue-start
---
# Issue Start

GitHub Issue 起点の作業開始を `gh` で標準化する。ブランチ命名・ベースブランチ・PR 運用・commit 規約は後述「ブランチ運用・commit 規約の参照」で解決する。

## 使い方

```text
issue-start <Issue URL | 番号> [--plan | --commit | --pr]
```

- モード未指定（`--plan` / `--commit` / `--pr` なし）: ブランチ作成・checkout 後そのまま調査・実装へ進む。commit / push / PR はしない
- `--plan`: 関連ファイルと Issue を確認し、必要なことだけ追加確認して詳細計画を作る。実装はユーザーの開始指示後に進める
- `--commit`: 実装、必要な確認、関連ファイルだけの staging、論理単位の commit まで行う
- `--pr`: 実装、必要な確認、commit、push、PR 作成まで行う

`--commit` / `--pr` は、その段階までの実行をユーザーが明示的に委譲した合図。指定がない限り commit しない。

例: `issue-start 220` / `issue-start 220 --plan` / `issue-start https://github.com/<owner>/<repo>/issues/220 --pr`

- 自然文でも発動する:「Issue から始める」「この issue に着手」。

## 前提

- **ツール**: `gh`（GitHub CLI）, `git`
- **前提スキル**: なし
- **MCP**: なし
- **シェル**: bash（POSIX 互換シェル）。コマンド例は bash 前提のため、Windows では WSL / Git Bash 等の bash 環境で実行する
- node / pnpm / python などのランタイムは不要。

## ブランチ運用・commit 規約の参照

ブランチ運用・commit 規約はリポジトリごとに異なる。解決手順（設定ファイル → 標準ドキュメント探索 → ユーザー確認）と設定ファイル `.config/skills/shoji9x9/skills.yml` の扱いは [`references/conventions.md`](references/conventions.md) を参照する。
`--amend` / force push をしない・関連ファイルだけを stage する・長い commit 本文は `git commit -F <file>` で渡す、といった汎用の操作メカニクスは規約解決の結果に依らず常に守る。

## 基本フロー

1. Issue URL から owner / repo / issue 番号を抽出する（番号のみ渡された場合は現在の repo を対象にする）
2. 現在の repo と Issue の owner / repo が一致するか確認する
   - 一致しない場合は、以降の `gh issue view` やブランチ作成を行わず中断し、ユーザーに確認する
3. 一致を確認できた場合のみ title / body とコメントの両方を確認する。**非 TTY（パイプ／エージェント経由）では** `gh issue view --comments` はコメントのみを出力し body を含めない（コメント 0 件だと出力が空になる。TTY では body も表示される）。エージェント実行では次のいずれかで確実に両方を得る:
   - `gh issue view <番号> --repo <owner>/<repo> --json title,body,comments --jq ...` で 1 コマンド一括取得する（推奨）
   - または title / body は `gh issue view <番号> --repo <owner>/<repo>`、コメントは `gh issue view <番号> --repo <owner>/<repo> --comments`（0 件なら空でよい）の 2 コール
   - 設計の改訂・実測に基づく方針変更はコメントに追記されることが多い。本文が最新とは限らないため、本文とコメントで改訂・追記・両論併記があれば最新の決定を優先し、計画・実装に反映する
4. ブランチ名を `feature/<番号>-<英語の短い説明>` で決める（リポジトリの規約に別の命名があればそれに従う）
   - title が日本語中心なら、転写せず作業内容を表す短い英語の kebab-case に要約する
5. 同じ issue 番号のブランチが既にないか確認する
   - local: `git --no-pager branch --list 'feature/<番号>-*'`
   - remote: `git --no-pager branch -r --list 'origin/feature/<番号>-*'`
6. 同番号ブランチが見つかった場合は重複作成せず分岐する
   - 1 本だけで意図が明確なら、その branch を checkout して継続する
   - 複数候補がある、または意図が不明ならユーザーに確認する
7. 見つからない場合のみ、ベースブランチから作成して checkout する
   - ベースブランチは「ブランチ運用・commit 規約の参照」で解決する。規約に統合ブランチの指定（例: `main` / `master` / `develop`）があればそれに従い、`main` に固定しない
   - 規約から判断できなければ、既定のベースブランチを勝手に決めず、リポジトリのデフォルトブランチ（`gh repo view --json defaultBranchRef --jq .defaultBranchRef.name`）を候補として提示してユーザーに確認する
   - `gh issue develop <番号> --name "feature/<番号>-<英語の短い説明>" --base <ベースブランチ> --checkout`
8. ブランチ切り替え後、選択されたモードに応じて後続へ進む（各モードの挙動は「使い方」を参照）

## commit / PR の扱い

- commit message は「ブランチ運用・commit 規約の参照」で解決した規約に従う（commit-msg 検証＝commitlint/lefthook 等がリポジトリにあればそれにも従う）
- 無関係な変更を同じ commit に混ぜない。関連ファイルだけを stage する
- 既存 worktree に無関係な差分がある場合は巻き込まず、対象ファイルだけを扱う
- commit 時に pre-commit フック（lefthook 等）や kaizen のコミット前ゲートが設定されていれば走る。ゲートでブロックされた場合は指示に従って `kaizen --current` を実行してから再 commit する
- `--pr` 時はブランチを push し、関連 Issue・変更概要・確認内容を含む PR を作る
- commit の `--amend` と force push は行わない

## 追加確認が必要な条件

以下のときだけブランチ作成後に確認する。

- 要件のスコープが曖昧
- 挙動の選択肢が複数あり、実装に大きく影響する
- 既存ブランチが複数あり、どれを使うべきか判断できない
- `--plan` で詳細計画を立てる前提条件が不足している
- 本文とコメントに齟齬があり、どの決定に従うか判断できない（特に `--plan`）
