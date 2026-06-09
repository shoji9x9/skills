---
name: dependabot-merge
description: Dependabot が作成した PR のレビューとマージを `gh` で標準化するスキル。PR URL / PR 番号で 1 件、`--all` で open な全 Dependabot PR を対象にする。CI 成功の確認 → 更新内容（changelog/release notes）からマージ影響の確認 → 判断を PR コメントに記録 → 問題なければマージ、までを進める。特に 0.x（<1.0）依存はマイナー更新でも破壊的変更があり得るため影響を確認してから扱う。「Dependabot の PR をマージして」「依存更新 PR を確認してマージ」「dependabot-merge」「dependabot の PR を全部見て」や、`--all` を伴う依頼で必ず発動する。依存更新 PR を 1 件ずつ影響判断してからマージする。
license: MIT
---

# Dependabot Merge

Dependabot が作成した PR のレビューとマージを `gh` で標準化する。

依存更新は「CI が通っていること」だけでは安全と言い切れない。semver では `>=1.0` のマイナー/パッチは後方互換が期待できるが、**0.x（<1.0）はマイナー更新でも破壊的変更があり得る**。だから本スキルは、CI 成功の確認に加えて **changelog / release notes から影響を読み、判断の根拠を PR コメントに残してからマージ**する流れを固定する。判断を記録するのは、後から「なぜマージした/しなかったか」を追えるようにするためだ。

## 前提

- **ツール**: `gh`（GitHub CLI。`gh api` を含む）
- **前提スキル**: なし
- **MCP**: なし
- **シェル**: bash（POSIX 互換シェル）。コマンド例は bash 前提のため、Windows では WSL / Git Bash 等の bash 環境で実行する
- node / pnpm / python などのランタイムは不要。

## セットアップ（マージ方式の選択）

マージ方式（`squash` / `merge` / `rebase`）は利用者やリポジトリで好みが異なる。一度決めたら使い続けることが多いので、**スキル導入時に一度選び**、`.config/skills/shoji9x9/skills.yml` の `skills.dependabot-merge.merge_method` に保存する。スキルはマージのたびにこの設定を読む。

```yaml
version: 1
skills:
  dependabot-merge:
    merge_method: squash   # squash | merge | rebase
```

- **作成・追記は非破壊**: ファイルが無ければ `.config/skills/shoji9x9/` ごと作成し、`skills.dependabot-merge.merge_method` だけを書く。既にあれば欠けたキーだけを該当セクション（無ければ親も）に追記し、既存のキー・値・コメントは変更しない。**既存の設定があれば上書きしない**（尊重する）。
- インストール先に設定が無ければ、ユーザーに方式を確認してから書く。設定が無いまま起動した場合はデフォルトの `squash` を使い、その旨をユーザーに通知する（次回以降のために設定作成を促してよい）。
- リポジトリで許可されたマージ方式（`gh repo view --json squashMergeAllowed,mergeCommitAllowed,rebaseMergeAllowed`）と矛盾する場合は、許可された方式を案内して確認する。

## 入力

- 次のいずれかで対象を指定する:
  - PR URL（`https://github.com/<owner>/<repo>/pull/<番号>`）
  - PR 番号のみ（現在の repo を対象にする）
  - `--all`: 現在の repo の **open な Dependabot PR をすべて** 処理する（GitHub 自動マージを有効化していないリポジトリでの一括処理を想定）

`--all` は「open な Dependabot PR を順に確認してマージしてよい」という委譲の合図として扱う。それでも 1 件ずつ影響を確認し、安全と判断したものだけマージする。

## 基本フロー（単一 PR）

1. 入力から owner / repo / PR 番号を抽出する
2. 現在の repo と PR の owner / repo が一致するか確認する
   - 一致しない場合は、以降の確認・マージを行わず中断し、ユーザーに確認する
3. PR の著者が Dependabot か確認する（`gh pr view <番号> --json author --jq '.author.login'`）
   - bot の login 表記は揺れる（`dependabot[bot]` 等）ため `dependabot` を含むかで判定する。`app/dependabot` は `gh pr list --author` で絞るときの app slug であって、`author.login` の値とは別物
   - Dependabot 以外なら、本スキルの対象か中断して確認する（取り違え防止）
4. **CI 成功を確認する**（後述「gh メカニクス」）。必須チェックが
   - 成功 → 次へ
   - 実行中 → 完了を待つ（`--watch`）か、待たない場合はその旨を伝えて停止
   - 失敗 → **マージせず**、失敗内容と「どうすれば直せそうか」を PR コメントに記録してユーザーに報告
5. **マージ影響を確認する**。Dependabot が PR 本文に入れる Release notes / Changelog / Commits（`gh pr view <番号> --json title,body,files`）と、更新依存・バージョン差分（lockfile / manifest の差分）を読む
   - 特に **0.x 依存**は、マイナー更新でも破壊的変更があり得るため changelog を必ず確認する
   - devDependency か runtime か、リポジトリ内での使用箇所も踏まえて影響範囲を見積もる
6. **判断の根拠を PR コメントに記録する**（`gh pr comment`）。マージ可否いずれの場合も残す
   - **マージ不可と判断した場合は、何が課題か（例: 破壊的変更で X の対応が必要 / CI の失敗原因 / behind のため rebase が必要）と、どうすればマージできるかを必ず明記**する。次に見た人がそのまま動けるようにするため
7. **マージする / しない**
   - 安全 → 設定の `merge_method` でマージ（`gh pr merge --<method> <番号>`）
   - リスクあり / 影響が判断できない → マージせず、6 のコメントを残したうえでユーザーに報告
8. 実施結果（マージ有無・理由）を報告する

**返信（コメント）より先にマージしない。** 必ず「判断をコメントに記録 → マージ」の順にする。記録のないマージは経緯が追えなくなる。

## `--all` フロー（再作成・force-push を見込んだ逐次処理）

Dependabot は **1 件マージすると、残りの open PR を rebase / force-push で作り直す**ことがあり、さらに **"Dependabot Updates" のバックグラウンドジョブが新しい PR を後から作る**こともある。列挙した時点のスナップショットを信じて機械的に回すと、古い head を見たり、新しく出た PR を取りこぼす。だから次のように **状態を取り直しながら、新規が出なくなるまで**処理する。

1. open な Dependabot PR を列挙する（後述。**ページネーション順守**）
2. 1 件ずつ、**処理直前に最新状態を取り直して**から単一フローを適用する
   - 処理直前に `gh pr view <番号> --json headRefOid,mergeable,mergeStateStatus,state` と CI 状態を再取得する（列挙時の値を使い回さない）
   - `mergeStateStatus` が `BEHIND`（base に遅れている）なら `@dependabot rebase` で更新を促し、**更新後の CI 成功を確認してから**判断する
3. 1 件マージしたら、残り PR が rebase / force-push・CI 再実行される可能性を見込み、次の PR は **head が落ち着き CI が完走するのを待ってから**判断する（`gh pr checks <番号> --watch`）
4. 失敗 / リスクありはスキップし、理由を PR コメントに残す
5. **一連の処理後に再確認ループ**: open な Dependabot PR 一覧を取り直し、未処理 / 新規 PR が残っていないか確認する。残っていれば（in-flight な update ジョブの完了を待ったうえで）再度フローを回し、**新規が出なくなるまで繰り返す**
6. 最後に、マージした PR・スキップした PR（理由つき）のサマリーを報告する

## gh メカニクス

### Dependabot PR の列挙（`--all`・全件取得）

著者で絞って取得する。`gh pr list --author` には Dependabot の **app slug `app/dependabot`** を渡す。
**件数が `--limit` の既定（30）を超えると取りこぼす**ため、`--limit` を十分大きく取る（`gh pr list` に `--paginate` は無い）。既定 30 で暗黙に打ち切らないこと。

```bash
gh pr list --repo <owner>/<repo> --state open --author "app/dependabot" \
  --limit 200 --json number,title,headRefName,url
```

### 著者の確認（単一 PR）

```bash
gh pr view <番号> --repo <owner>/<repo> --json author --jq '.author.login'
```

- `author.login` の bot 表記は環境で揺れる（`dependabot[bot]` 等）ため、`dependabot` を含むかで緩く判定する。`app/dependabot` は `gh pr list --author` で使う app slug であり、`author.login` の値ではない（混同しない）。

### CI 成功の確認

```bash
gh pr checks <番号> --repo <owner>/<repo> --watch --fail-fast
```

- 全チェックの完了まで待ち、すべて成功なら終了コード 0、いずれか失敗なら非 0 で終わる。待ちたくない場合は `--watch` を外して現状だけ見る。
- push 直後はチェック未登録で `no checks` と即時に返ることがある。その場合は数秒待ってから再確認する。
- マージ可否そのものは `mergeStateStatus` でも確認できる。`CLEAN` はマージ可、`BLOCKED` は必須チェック未通過/要件未達、`BEHIND` は base に遅れ（要 rebase）、`UNSTABLE` は必須でないチェックが落ちているがマージ可、`DIRTY` はコンフリクト。

```bash
gh pr view <番号> --repo <owner>/<repo> --json mergeable,mergeStateStatus
```

### behind（base に遅れている）PR の更新

```bash
gh pr comment <番号> --repo <owner>/<repo> --body "@dependabot rebase"
```

- Dependabot がブランチを base に追従させ直す。**更新後に CI が再実行される**ので、その完了・成功を待ってから判断する。

### 判断の記録（PR コメント）

```bash
gh pr comment <番号> --repo <owner>/<repo> --body "<判断と根拠>"
```

- マージする場合: 何を確認し、なぜ安全と判断したか（例: `>=1.0` のパッチで changelog にバグ修正のみ）。
- マージしない場合: **課題と解決策**（例: `0.x のマイナーで API 変更あり。<該当箇所> の修正が必要`、`CI の <ジョブ> が <理由> で失敗。<対処> で直る`、`BEHIND のため @dependabot rebase 後に再評価が必要`）。

### マージ

設定 `.config/skills/shoji9x9/skills.yml` の `skills.dependabot-merge.merge_method` に従う（既定 `squash`）。

```bash
gh pr merge --squash <番号> --repo <owner>/<repo>   # または --merge / --rebase
```

- `BEHIND` でマージが拒否される場合は `@dependabot rebase` で更新 → CI 成功を確認してから再試行する。
- commit の `--amend` や force push は行わない。`@dependabot` への指示コメント以外で履歴を書き換えない。

## マージ可否の判断ガイド

機械的に全部マージするのでも全部止めるのでもなく、更新内容の事実に基づいて 1 件ずつ判断する。

- **CI が必須チェックを通過しているか**（最低条件。未通過ならマージしない）
- **`>=1.0` のマイナー/パッチか**: semver 上は後方互換が期待でき、changelog がバグ修正・小さな改善中心なら安全寄り
- **0.x（<1.0）のマイナー/パッチか**: マイナーでも破壊的変更があり得る。changelog / release notes で **API 変更・削除・挙動変更**の有無を確認する。判断できなければマージせずユーザーに確認する
- **影響範囲**: runtime 依存か devDependency か、リポジトリ内の使用箇所、ビルド/テストへの影響
- 判断材料が足りない・影響が大きい・設計判断が絡む場合は、勝手にマージせずユーザーに確認する

## 追加確認が必要な条件

以下のときは処理を止めてユーザーに確認する。

- 現在の repo と PR の owner / repo が一致しない
- PR の著者が Dependabot でない
- マージ方式の設定が無く、デフォルト以外を使いたい場合
- 設定のマージ方式がリポジトリで許可されていない
- 0.x 依存の破壊的変更の有無が changelog から判断できない
- 影響が大きい、または判断材料が不足している

## 例

- `dependabot-merge https://github.com/<owner>/<repo>/pull/12`
- `dependabot-merge 12`
- `dependabot-merge --all`
