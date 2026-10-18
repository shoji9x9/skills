# Skill Benchmark: issue-batch

**Model**: claude-code / opus
**Date**: 2026-10-18
**Evals**: 2（`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

PR #694 のレビューを受けて、Issue の間の依存を全体 preflight の 6 で定義し直し、10 の外す候補の評価からそれを参照するようにした。
依存先を外したときは、未着手の依存元を `EXCLUDED` に、再開する依存元を `BLOCKED` にする。依存先が決まらなかったときは、依存元も `BLOCKED` にする。
preflight で `BLOCKED` にした Issue は処理せず、残りの Issue は `continue_on_blocked` の値に関わらず進める。
依存の扱いを測る eval 26 を新しく足した。eval 25 の入力は変えていないが、SKILL.md と `references/orchestration.md` を書き換えたので、もう一度実行した。

## Summary

| eval | 入力の変更 | with_skill | without_skill |
| --- | --- | --- | --- |
| 25 | なし | 8/8 | 3/8 |
| 26 | 新規 | 7/7 | 3/7 |

## iteration-11 との比較

iteration-11 の eval 25 の with_skill は 7/8 で、「外した Issue は branch と worktree を作らない」に触れなかった。
この iteration では同じ prompt・fixture・executor・model で 8/8 になり、その assertion も満たした。
書き換え後の版で下がっていないので、後退は無い。旧版をもう一度同じ条件で実行していないので、差が版の違いか 1 run のばらつきかは区別していない。1 run ずつなので、分散も測っていない。

## 備考

- eval 25 の without_skill は、iteration-11 の run を再利用できなかった。iteration-11 は `--reasoning-effort` を付けずに実行しており、再利用には空でない値が要るためである。同じ条件（effort なし）で新しく実行した。
- eval 25 の without_skill は、iteration-11 と同じ 3 つの assertion を満たした。#105 は自分の判断で保留にし、利用者に外すかを確かめなかった。
- eval 26 の without_skill は、#108 を外すかを別の質問として尋ね、#107 を外す選択の影響として示さなかった。答えが無いときの #108 は「保留」で、`BLOCKED` の状態にはしなかった。
- eval 26 の without_skill は、`--stop-on-blocked` でも #109 を進めると述べた。止めない理由は preflight の扱いではなく、#107 を run に入れないことだった。
- eval 26 は、依存の表のうち、未着手の依存元の 2 行（外した・決まらなかった）だけを測る。再開する依存元・入力の順の逆・循環・推移的な依存は、eval では確かめていない。
