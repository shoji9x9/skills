---
date: 2026-10-16
type: hook
priority: medium
confidence: medium
status: pending
applied-to: []
session: claude-code
---

# 確認の UI（AskUserQuestion）の文が英語のまま利用者に届いた

## 事象

Issue #626 の作業で、違反したディレクトリの扱いを確かめる AskUserQuestion の質問・選択肢・preview を英語で書いた。
利用者に「日本語で説明して下さい」と言い直させた。
同じセッションで、最後の応答が英語になったものは Stop の Hook（response-language-check）が 4 回止め、日本語で書き直した。
確認の UI だけが、どの仕組みにも止められずに利用者に届いた。

再発（2026-11-08、Issue #937・#938、PR #943・#944）: 使わない語が、`gh api` で投稿した本文に入ったまま GitHub に届いた。
PR #943 ではスレッドへの返信に、一覧で「バージョン」と言い換える語が入った。PR #944 では、`local-review-record.sh post --details` で投稿したレビューの記録に、一覧で「抜け」と言い換える語が入った。
どちらも投稿の後に自分で気付き、PATCH で直した。本文はファイルに書いて渡していたが、投稿の前に `lint-prose.ts` を当てていなかった。
同じセッションの最後の応答は、Stop の Hook（使わない語の確かめ）が止めていた。外向きの本文の出口だけが、どの仕組みにも止められなかった。

## 根本原因

- なぜ英語になったか → 直前の入力が英語の出力スタイルの指示とツール出力で、2026-10-10-response-language-drift-to-english.md と同じ機序で英語に引きずられた
- なぜ止められなかったか → Stop の Hook は最後の応答の本文だけを読み、ツールの入力として渡す AskUserQuestion の question・label・description・preview を読まない
- なぜその範囲になったか → 前の学びの対策を「人への応答＝最後の応答の本文」として作り、利用者に表示されるもう一方の出口（確認の UI）を挙げなかった

## 優先度の見直し（Issue #966）

2026-11-11、Issue #966 で high から medium に下げた。
確認の UI が英語になったのは 1 回で、再発していない。外向きの本文に使わない語が入った 2 回は、投稿の後に自分で気付いて直せた。
提案の PreToolUse の Hook は、コマンドの形（`--body-file`・`-F body=@`・`--details`）を読む検査で、形を挙げても尽きない（`references/apply.md`「機構の置き場所は原因を持つ側から選ぶ」）。
再発したら、外向きの本文を書くスクリプトや手順の側で `lint-prose.ts` を当てる形を先に検討する。

## 提案

利用者に表示する文を出す出口（最後の応答・確認の UI・PR や Issue の本文）をすべて挙げ、言語の確かめをそれぞれの出口に置く。

- AskUserQuestion には PreToolUse の Hook（matcher: AskUserQuestion）で、question・label・description・preview に日本語が無ければ止める
- 判定は response-language-check.ts と同じ関数を使い、コードブロックやコマンドだけの preview は対象から外す
- Hook の入力の形（tool_input の構造）は、公式のドキュメントで確かめてから書く
- 外向きの本文（gh の --body-file）は、textlint の対象に入っているかを確かめる
- 外向きの本文には、言語に加えて使わない語の確かめも置く。2026-11-08 の再発は、どちらも本文のファイルを渡す呼び出しだった
  - PreToolUse の Hook（matcher: Bash）で、`--body-file <path>`・`-F body=@<path>`・`--details <path>` のファイルに `lint-prose.ts` の使わない語の規則を当て、当たれば止める
  - 文字列で渡す本文（`--body "..."`・`--comment "..."`）は読めないので、ファイルで渡すよう促す
  - 根拠は、2 つの出口（最後の応答・確認の UI）に加えて、外向きの本文を 3 つ目の出口として挙げていなかったことである
