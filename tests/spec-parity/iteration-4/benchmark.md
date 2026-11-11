# Skill Benchmark: spec-parity

**Model**: claude-code / opus / 指定なし（iteration-3 に合わせた）（harness `run-skill-eval/5`）
**Date**: 2026-11-11
**Evals**: 3（`with_skill` だけを 1 run ずつ）

## 目的

PR #996 のレビューの指摘で、verify の手順 1 の `new.dirty` の取り方・手順 7 の判定の直前の取得し直し・前提の段落を変えた後の変更確認である。
変えた段落と手順 7 を読む eval 6・8・9 を、`with_skill` だけで 1 run 実行した。

## Summary

| eval | 入力の変更 | with_skill | 前回の with_skill |
| --- | --- | --- | --- |
| 6 | なし（スキルの本文） | 3/3 | 3/3（iteration-3） |
| 8 | なし（スキルの本文） | 7/7 | 7/7（iteration-2） |
| 9 | なし（スキルの本文） | 5/6 | 6/6（iteration-2） |

すべての run で、`skill_usage.read` は true、`invalid_run` は false で、`isolation.txt` は `sandboxed` だった。

## 下がった assertion

eval 9 の「差し戻しの入力を verify.md の差し戻す内容に、ページ・幅・測定値を添えて書くとしている」が fail になった。
run は、手順 7 で新側の HEAD を取得し直そうとしたが、fixture に新側のリポジトリ（`./new-app`）が無いので取得できず、`--write` も `verify.md` も書かずに止まった。
eval 8 の run も同じ理由で `--write` を付けなかった（assertion は満たした）。
手順 7 が新側のリポジトリを読むようになったのに、fixture が新側のリポジトリを持たないことが原因で、eval の定義の不備である。
`verify-unapproved` と `verify-overflow` に、新側のリポジトリを作る `setup.sh` を足した。足した後の eval 8・9 の run は iteration-5 にある。
