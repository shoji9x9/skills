---
date: 2026-10-16
type: hook
priority: medium
status: pending
applied-to: []
session: claude-code
---

# ツールの呼び出しの合間に書いた人への文が英語になり、Stop の Hook は最後の 1 件しか確かめなかった

## 事象

Issue #655 の作業（`issue-start --pr` から `pr-finalize-loop`）で、ツールの呼び出しの合間に書いた人への短い文が、何度も英語になった。
例は「Both commits are done. Running `code-review --fix` before pushing.」「PR is up. Posting the acceptance result ...」「Preconditions pass ...」である。
Stop の Hook（`scripts/hooks/response-language-check.ts`）が止めたのは、ターンの最後の「All 6 required CI checks passed. ...」の 1 回だけだった。
合間の文は利用者の画面に出ているのに、どれも確かめられなかった。
直前の入力は、英語のツール出力・英語の Hook のエラー・英語のバックグラウンドの完了通知で、`.kaizen/2026-10-10-response-language-drift-to-english.md`（applied）と同じ機序である。

## 根本原因

1. なぜ英語になったか → 応答を書く直前の入力が英語のツール出力と通知だった（applied の記録と同じ）。
2. なぜ Hook が止めなかったか → Hook はターンの最後の assistant の本文だけを読み、ツールの呼び出しの前に書いた文を対象にしていない。
3. なぜ対象から外れたか → applied の記録の提案が「最後の応答の本文」と書き、利用者に表示する文の出口（ツールの呼び出しの合間の文・確認の UI・PR や Issue の本文）を挙げずに Hook の範囲を決めた ← 根本原因

## 提案

人への応答の言語を確かめる Hook は、ターンの最後の本文だけでなく、そのターンで assistant が書いたすべての文（ツールの呼び出しの合間を含む）を対象にする。

- 置き場所: `scripts/hooks/response-language-check.ts`。transcript から、直前の利用者の入力より後の assistant の text ブロックをすべて読み、それぞれに同じ判定を当てる。
- 誤検知しないことの確認: コード・コマンドだけの短い文、ツールの呼び出しだけのブロックを対象から外すテストを、既存のテストと同じ形で置く。
- KEDB 照合: `.kaizen/2026-10-10-response-language-drift-to-english.md`（applied。同じ機序）。applied なので追記せず、この記録を新しく作った。
