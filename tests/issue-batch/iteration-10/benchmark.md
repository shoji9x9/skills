# Skill Benchmark: issue-batch

**Model**: claude-code / opus
**Date**: 2026-10-14
**Evals**: 2（`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

Issue #623 で、run の途中で利用者に確認せず判断待ち（BLOCKED）として記録する取り決めと、最終報告の「判断待ち」「自分で判断して進めたもの」の一覧を足した。
preflight には、設定が base branch に入っているかの確認と、run の前に要る判断の洗い出しを足した。
これを測る eval 23（run の途中で条件を満たせなくなった場面）と eval 24（preflight）を新しく足した。

## Summary

| eval | 入力の変更 | with_skill | without_skill |
| --- | --- | --- | --- |
| 23 | 新規 | 9/9 | 6/9 |
| 24 | 新規 | 6/6 | 3/6 |

without_skill が落とした項目は次のとおりである。

- eval 23: 判断待ちを manifest に記録すると述べない。判断待ちに推奨を示さない。`met`（read）の判断を「自分で判断して進めたもの」の一覧に載せない
- eval 24: 設定が base に無くても警告だけで run を続ける。案 A・B の選択を停止の報告に載せず、やり直した run の preflight で決めてもらう手順にもならない

## 備考

- eval 24 は PR レビューの指摘で assertion を分けたので、eval 24 だけをやり直した。
- eval 23 の「1 つの判断待ちにまとめる」は、`requires_skills` で入る `issue-start` の `references/acceptance.md` から読めるので、without_skill も pass した。Delta には寄与せず、後退の検出のために置く。
