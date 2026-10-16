---
date: 2026-10-16
type: hook
priority: medium
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

## 根本原因

- なぜ英語になったか → 直前の入力が英語の出力スタイルの指示とツール出力で、2026-10-10-response-language-drift-to-english.md と同じ機序で英語に引きずられた
- なぜ止められなかったか → Stop の Hook は最後の応答の本文だけを読み、ツールの入力として渡す AskUserQuestion の question・label・description・preview を読まない
- なぜその範囲になったか → 前の学びの対策を「人への応答＝最後の応答の本文」として作り、利用者に表示されるもう一方の出口（確認の UI）を挙げなかった

## 提案

利用者に表示する文を出す出口（最後の応答・確認の UI・PR や Issue の本文）をすべて挙げ、言語の確かめをそれぞれの出口に置く。

- AskUserQuestion には PreToolUse の Hook（matcher: AskUserQuestion）で、question・label・description・preview に日本語が無ければ止める
- 判定は response-language-check.ts と同じ関数を使い、コードブロックやコマンドだけの preview は対象から外す
- Hook の入力の形（tool_input の構造）は、公式のドキュメントで確かめてから書く
- 外向きの本文（gh の --body-file）は、textlint の対象に入っているかを確かめる
