---
description: GitHub Issue を起点に作業開始フローを標準化するスキル。Issue URL や Issue 番号を受け取り、リポジトリ一致確認・feature ブランチ作成と checkout（gh issue develop）・調査・実装・commit・push・PR 作成までを段階的に進めたいときに使う。「Issue から始める」「この issue に着手」「issue-start」や、`--plan` / `--commit` / `--pr` を伴う依頼で発動する。
license: MIT
name: issue-start
---
# Issue Start

GitHub Issue 起点の作業開始を `gh` で標準化する。ブランチ命名・PR 運用・commit 規約は `AGENTS.md` の「ブランチ運用」に従う。

## 前提

- **ツール**: `gh`（GitHub CLI）, `git`
- **前提スキル**: なし
- **MCP**: なし
- node / pnpm / python などのランタイムは不要。

## 入力

- GitHub Issue URL または Issue 番号
- 任意モード（省略可）:
  - `--plan`: ブランチ切り替え後に詳細計画を作る
  - `--commit`: 実装後に commit まで行う
  - `--pr`: 実装後に commit・push・PR 作成まで行う

モードが明示されていない場合は通常実装モードとして扱い、**commit / push / PR 作成は行わない**。

## 基本フロー

1. Issue URL から owner / repo / issue 番号を抽出する（番号のみ渡された場合は現在の repo を対象にする）
2. 現在の repo と Issue の owner / repo が一致するか確認する
   - 一致しない場合は、以降の `gh issue view` やブランチ作成を行わず中断し、ユーザーに確認する
3. 一致を確認できた場合のみ `gh issue view <番号> --repo <owner>/<repo>` で title / body を確認する
4. ブランチ名を `feature/<番号>-<英語の短い説明>` で決める
   - title が日本語中心なら、転写せず作業内容を表す短い英語の kebab-case に要約する
5. 同じ issue 番号のブランチが既にないか確認する
   - local: `git --no-pager branch --list 'feature/<番号>-*'`
   - remote: `git --no-pager branch -r --list 'origin/feature/<番号>-*'`
6. 同番号ブランチが見つかった場合は重複作成せず分岐する
   - 1 本だけで意図が明確なら、その branch を checkout して継続する
   - 複数候補がある、または意図が不明ならユーザーに確認する
7. 見つからない場合のみ、`main` から作成して checkout する
   - `gh issue develop <番号> --name "feature/<番号>-<英語の短い説明>" --base main --checkout`
8. ブランチ切り替え後、選択されたモードに応じて後続へ進む

## モード別フロー

| モード | 挙動 |
| --- | --- |
| 省略時 | ブランチ切り替え後にそのまま調査・実装へ進む。commit / push / PR 作成は行わない |
| `--plan` | 関連ファイルと Issue を確認し、必要なことだけ追加確認して詳細計画を作る。実装はユーザーの開始指示後に進める |
| `--commit` | 実装、必要な確認、関連ファイルだけの staging、論理単位の commit まで行う |
| `--pr` | 実装、必要な確認、commit、push、PR 作成まで行う |

`--commit` と `--pr` は、その段階までの実行をユーザーが明示的に委譲した合図として扱う。指定がない限り commit しない。

## commit / PR の扱い

- commit message は conventional commits 規約（`feat:` / `fix:` / `docs:` など）に従う。このリポジトリでは commitlint と lefthook の commit-msg フックで検証される
- 無関係な変更を同じ commit に混ぜない。関連ファイルだけを stage する
- 既存 worktree に無関係な差分がある場合は巻き込まず、対象ファイルだけを扱う
- commit 時は lefthook の pre-commit と、設定されていれば kaizen のコミット前ゲートが走る。ゲートでブロックされた場合は指示に従って `kaizen --current` を実行してから再 commit する
- `--pr` 時はブランチを push し、関連 Issue・変更概要・確認内容を含む PR を作る
- commit の `--amend` と force push は行わない

## 追加確認が必要な条件

以下のときだけブランチ作成後に確認する。

- 要件のスコープが曖昧
- 挙動の選択肢が複数あり、実装に大きく影響する
- 既存ブランチが複数あり、どれを使うべきか判断できない
- `--plan` で詳細計画を立てる前提条件が不足している

## 例

- `issue-start https://github.com/<owner>/<repo>/issues/220`
- `issue-start 220 --plan`
- `issue-start https://github.com/<owner>/<repo>/issues/220 --commit`
- `issue-start 220 --pr`
