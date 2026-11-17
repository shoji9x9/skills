# Skill Benchmark: dependabot-merge

**Model**: claude-code / opus、reasoning effort high
**Date**: 2026-11-17
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

PR #1070 のレビューの指摘で、`SKILL.md`「PR の本文とコメントの扱い」の 2 つの例外を確かめる eval 12 を足した。
1 つは、Dependabot が定型で書く案内を指示に見える文に数えないことである。もう 1 つは、差分が変えていない行に残る別のバージョンを、本文と差分の食い違いに数えないことである。
fixture の本文は定型の案内だけを含み、lockfile には推移的な依存が使う 2.8.0 が残る。同じ指摘で、定型の案内に Dependabot のコメントも含めるよう `SKILL.md` を直した。
他の eval の入力は変えていないので、実行していない。

## Summary

| eval | 入力の変更 | with_skill | without_skill |
| --- | --- | --- | --- |
| 12 | 新規 | 5/5 | 5/5 |

新しく足した eval なので、比べる前回の記録は無い。1 run どうしなので、Delta の値は扱わず、差が残っているかだけを見る。

- どちらの run も、定型の案内を指示として挙げず、残る 2.8.0 を食い違いとして挙げず、判断をコメントに書いてから SHA に固定してマージする手順を示した。
- この run では差が出ていない。eval 12 は、例外が後退して問題の無い PR まで止めるようになったときに検出するためのものである。

## 実行し直した run

なし。
