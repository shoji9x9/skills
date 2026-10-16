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

Issue #655 の作業（Issue の起票の後のターンから `pr-finalize-loop` まで）で、ツールの呼び出しの合間に書いた人への短い文が、何度も英語になった。
例は「Each issue's unblock condition is known; ...」「No drift on main since the issue was created. ...」である。
「Both commits are done. Running `code-review --fix` before pushing.」「PR is up. ...」も同じである。
Stop の Hook（`scripts/hooks/response-language-check.ts`）が止めたのは、ターンの最後の「All 6 required CI checks passed. ...」の 1 回だけだった。
合間の文は利用者の画面に出ているのに、どれも確かめられなかった。
ターンの最後の本文でも、「I'll wait for the CI and review to finish.」は英語のまま通った。ラテン文字が 32 字で、Hook が判定の対象にする下限（`MIN_LATIN_LETTERS` の 40 字）に届かなかった。
合間の文の例の「Both commits are done. ...」も、インラインコードを除くと 38 字で下限に届かない。読む範囲を広げても、この長さの英文は判定の対象から外れる。
英語の文の多くは、英語のツール出力・英語の Hook のエラー・英語のバックグラウンドの完了通知の直後に書いた。`.kaizen/2026-10-10-response-language-drift-to-english.md`（applied）と同じ機序である。
ただし、最初の英語の文（「Each issue's unblock condition is known; ...」）は、利用者の日本語のプロンプトの直後に書いた。間にツールの結果は無い。

## 根本原因

1. なぜ英語になったか → 多くは、応答を書く直前の入力が英語のツール出力と通知だった（applied の記録と同じ）。英語の出力スタイルの指示と、それまでの英語の文脈も続いていた。
2. なぜ Hook が止めなかったか → Hook は Stop の入力の `last_assistant_message` だけを読み、ツールの呼び出しの前に書いた文を対象にしていない。
   加えて、ラテン文字が 40 字に届かない短い英文は、最後の本文でも判定の対象から外す。
3. なぜ対象から外れたか → applied の記録の提案が「最後の応答の本文」と書き、利用者に表示する文の出口を挙げずに Hook の範囲を決めた ← 根本原因

出口のうち、確認の UI（AskUserQuestion）と PR・Issue の本文は、`.kaizen/2026-10-16-ask-user-question-language-unchecked.md`（#626 で記録）が同じ根本原因として扱う。
この記録は、残りの出口であるツールの呼び出しの合間の文を扱う。apply のときに、2 件を 1 つにまとめる。

## 提案

人への文を確かめる Stop の Hook（言語と使わない語）は、最後の本文に加えて、そのターンでツールの呼び出しの合間に書いた文も対象にする。

- 対象の Hook: `scripts/hooks/response-language-check.ts` と、同じく `last_assistant_message` だけを読む `scripts/hooks/response-word-check.ts` の 2 本。
- 読む範囲: transcript の、人が入力した最後のプロンプトより後の assistant の text ブロックである。transcript ではツールの結果（`tool_result`）も type が `user` のエントリになるので、それを境界にしない。
- 最後の本文: これまでどおり `last_assistant_message` から読む。Stop の時点の transcript は、最後のメッセージを含まないことがある（`response-language-check.ts` の冒頭のコメント）。
- 止め方: 合間の文は画面に出ていて書き直せないので、exit 2 にしない。stderr に警告を出し、最後の本文で同じ内容を日本語で書くように促す。exit 2 で書き直させるのは、最後の本文だけにする。
- 誤検知しないことの確認: コード・コマンドだけの短い文と、`tool_result` の後の text ブロックの境界を、既存のテストと同じ形でテストにする。
- KEDB 照合: `.kaizen/2026-10-10-response-language-drift-to-english.md`（applied。同じ機序）。applied なので追記せず、この記録を新しく作った。

### apply のときに確かめること

PR #656 のレビューで出た指摘である。上の提案の細部は、apply の時点で次のことを確かめてから決める。

- Stop の Hook が exit 0 で書いた stderr は、モデルに渡らない。警告をモデルに届けるなら、exit 2 か JSON の `decision: block` を使う。
- 「人が入力した最後のプロンプト」の見分け方を決める。バックグラウンドの完了通知・タスクの通知・Hook の exit 2 のフィードバックも、type が `user` のエントリとして transcript に入る。
- Stop の Hook の範囲を広げる案と、ツールの呼び出しごと（PreToolUse か PostToolUse）に直前の text ブロックを確かめて `additionalContext` で伝える案を比べる。後者なら、最初の英語の文の直後に伝えられる。
