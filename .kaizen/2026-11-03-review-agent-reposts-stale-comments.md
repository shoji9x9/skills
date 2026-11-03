---
date: 2026-11-03
type: skill
priority: medium
confidence: medium
status: pending
applied-to: []
session: claude-code
---

# 繰り返すレビューのエージェントが、前の回の作業ファイルを投稿の対象に含め、解決済みの指摘を PR に重ねて投稿した

## 事象

PR #865 の pr-finalize-loop（依頼先は local）で、反復 5 の `/code-review high 865 --comment` が、前の回（be51e9a9 向け）の指摘 8 件も PR に投稿した。
投稿のスクリプトが、scratchpad の同じディレクトリにある `c` で始まる JSON をすべて投稿する作りで、前の回が残したファイルを拾った。
未解決のスレッドが 8 件増え、利用者の承認を得て削除した（取り消せない操作）。

## 根本原因

- 重ねて投稿したのは、投稿の対象を「ディレクトリの中のファイル」で決め、今回作ったものだけに絞らなかったからである
- 前の回のファイルが残っていたのは、反復ごとのレビューが同じ scratchpad を使い、回ごとに新しいディレクトリを使う取り決めが無かったからである
- その取り決めが無いのは、pr-finalize-loop の local の手順が、レビューの機能に何を渡すか（差分の範囲・前の指摘）だけを定め、投稿するものをその回の結果に限ることを定めていないからである

## 根拠

1 回の観測だが、原因を投稿のスクリプトの対象の選び方に絞れたので medium とする。
観測: 反復 5 のレビューの結果が、投稿した 8 件の original_commit_id が be51e9a9 で、作成の時刻がその回の投稿と同じだと報告した。
KEDB 照合: 「重ねて投稿」「code-review」では一致が無かった。「投稿」「scratchpad」では `2026-10-14-worktree-bash-literal-guard-recurs.md` と `2026-10-30-review-record-sha-typed-by-hand.md` が当たったが、どちらも原因が違う。

## 提案

繰り返し起動するレビューのエージェントには、回ごとに新しい作業ディレクトリを使わせ、外向きの投稿はその回に作った指摘だけに限るように依頼する。

- 反映先の候補: pr-finalize-loop の `references/review-tool.md`「local」の手順 2
- 横断: pr-review-handle と issue-batch の、レビューのエージェントを繰り返し起動する流れ
