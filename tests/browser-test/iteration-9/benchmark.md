# Skill Benchmark: browser-test

**Model**: claude-code / opus、reasoning effort high（harness `run-skill-eval/5`）
**Date**: 2026-11-13
**Evals**: 2（`with_skill` を 1 run ずつ）

## 何を変えたか

Issue #1005 で、サーバーの稼働の確認をローカルの環境を選んだときだけ行うという限定を、`SKILL.md` のフローの手順 2 と `references/project-config.md` の「環境エントリの実行順」でそろえた。
eval の入力（prompt・fixture・assertion）は変えていない。エージェントが読む文書を変えたので、関係する eval を `with_skill` で実行した。

- eval 4: ローカルでない環境（`--env dev`）を選ぶ
- eval 7: 呼び出し元からローカルの環境を渡される。稼働の判定を先に行うかを見る

run の後に、`references/project-config.md` の追記を「この実行順の 1〜4（稼働の判定と起動）を」と言い直した。browser-test が当てる範囲は変わらないので、実行し直していない。

## Summary

| eval | 入力の変更 | with_skill | 前回の with_skill |
| --- | --- | --- | --- |
| 4 | なし | 3/3 | iteration-1（0/3） |
| 7 | なし | 4/4 | iteration-7（4/4） |

文が同じ assertion で、前回満たして今回満たさなかったものは無い。
前回の記録は reasoning effort を指定していない run で、今回は high を指定した。1 run どうしなので、上がった分が effort によるのかスキルによるのかは区別できない。

eval 4 の run は dev の設定が無いので、フローの手順 1（環境を決める）で止まった。変えた手順 2 には届いていないので、この run は限定が読み手に届くかを確かめていない。
ローカルでない環境を手順 2 まで進める eval は無い。
eval 7 の run は `http://localhost:5173/` に `curl` でつながるかを先に確かめ（HTTP 000）、`npm run build` と `npm run dev` は実行せずに利用者に頼んだ。

## 実行し直した run

なし。
