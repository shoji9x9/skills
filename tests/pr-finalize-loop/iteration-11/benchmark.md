# Skill Benchmark: pr-finalize-loop

**Model**: claude-code / opus
**Date**: 2026-10-28
**Evals**: 7（`with_skill` を 1 run ずつ）

## 何を変えたか

Issue #659 の PR #820 で、`SKILL.md` にあった次の手順を、`pr-review-handle` と同じ内容の `references/review-threads.md` へ移した。

- 未解決スレッドの全ページの取得（GraphQL）
- スレッドへの返信（REST）と、返信した後の解決（GraphQL）
- スレッドの外の指摘の形と、トップレベルのコメントから集める対象

eval 1・9・12・13・14・15・18 の入力は変えていないが、移した手順を読む eval なので、後退が無いかを with_skill で確かめた。without_skill は入力が変わらないので実行していない。

## Summary

| eval | 入力の変更 | with_skill | 前回の with_skill | main の版（同じ条件） |
| --- | --- | --- | --- | --- |
| 1 | 無し | 3/8 | 記録無し | 3/8 |
| 9 | 無し | 5/5 | 5/5（iteration-8） | 実行していない |
| 12 | 無し | 4/4 | 記録無し | 4/4 |
| 13 | 無し | 4/5 | 4/5（iteration-8） | 実行していない |
| 14 | 無し | 4/5 | 5/5（iteration-3、codex / gpt-5.6-sol） | 4/5 |
| 15 | 無し | 6/6 | 6/6（iteration-3、codex / gpt-5.6-sol） | 実行していない |
| 18 | 無し | 4/4 | 4/4（iteration-5） | 実行していない |

main の版は、origin/main（725931d1）の版のスキルを同じ条件で実行した。
条件は claude-code 2.1.312、opus、effort の指定なし、run-skill-eval/5 である。
対象は、比べる記録の無い eval 1・12 と、前回より下がった eval 14 である。

eval 14 は前回の 5/5 から 4/5 に下がった。しかし main の版も同じ assertion を満たさず 4/5 だったので、回帰ではない。
前回の記録は codex（gpt-5.6-sol）で実行したもので、executor が違う。

## with_skill で満たさなかった assertion

- eval 1: CI を `gh pr checks --watch` で確かめる、reviewThreads を `--paginate` で取得して未解決に絞る、返信してから解決する、関連ファイルだけを stage して commit/push する、完了条件でループを止める。
  使い捨てのプロジェクトは git リポジトリではなく、sandbox の中では GitHub に接続できない。そのため、着手前の確認で止まり、後の手順に触れなかった。main の版も同じ 5 本を満たさなかった。
- eval 13: トップレベルのコメントの指摘に、自分のトップレベルのコメントで判断と根拠を返す。前回の記録でも満たしていない。
- eval 14: 未解決スレッド・新しいか更新されたトップレベルのコメント・レビューの到着の判定に使う check-run の出力を全文で取得する。
  書き換え後の版は、check-run の出力を索引で返さないとし、全文を読む対象に挙げなかった。main の版も、check-run は未完了のものだけを索引に出し、出力を全文で読む対象に挙げなかった。

## 実行し直した run

- 無し

## 集計から外したもの

- 無し
