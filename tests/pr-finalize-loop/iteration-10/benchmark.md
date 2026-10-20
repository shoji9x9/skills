# Skill Benchmark: pr-finalize-loop

**Model**: claude-code / opus
**Date**: 2026-10-19
**Evals**: 3（`with_skill` を 1 run ずつ）

## 何を変えたか

Issue #697 の PR #715 のレビューを受けて、iteration-9 の後に次の 2 つを直した。

- `--defer-decisions` の判断待ちの基準と、「直さない根拠」と範囲の基準
- 「反復の段階と effort」（最初の effort を high にする、段階を切り替える前に CI を待つ、effort を指定できるのを `review_tool: local` の `/code-review` に限る、記録の `--reviewer` に effort を含める）

eval 20・21・22 の入力は変えていないが、これらの節を読む eval なので、後退が無いかを with_skill で確かめた。without_skill は入力が変わらないので実行していない。

## Summary

| eval | 入力の変更 | with_skill | 前回の with_skill |
| --- | --- | --- | --- |
| 20 | 無し | 8/8 | 8/8（iteration-6） |
| 21 | 無し | 7/7 | 7/7（iteration-7） |
| 22 | 無し | 7/7 | 7/7（iteration-9） |

eval 20 の with_skill は、設計の判断が絡むスレッド B を「影響が大きいか」「後で覆せるか」で評価し、判断待ちにした。
eval 22 の with_skill は、段階を切り替える前に CI の再実行を待ち、記録の `--reviewer` に effort を含めると答えた。

## with_skill で満たさなかった assertion

- 無し

## 実行し直した run

- 無し

## 集計から外したもの

- 無し
