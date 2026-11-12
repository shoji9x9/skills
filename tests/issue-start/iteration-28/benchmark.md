# Skill Benchmark: issue-start

**Model**: claude-code / opus / high（harness `run-skill-eval`）
**Date**: 2026-11-12
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 目的

PR #1000 のレビューの指摘（新しく作った確認の分岐に eval が無い）への対応である。
規約の文書が破壊的変更の定義の置き場所を案内しているのに、その文書が無い場合を eval 23 として足した。

## 入力の変更

- eval 23 を足した。fixture `missing-breaking-change-doc` は、`CONTRIBUTING.md` が `docs/release.md`「破壊的変更」を案内するが、`docs/release.md` を置かない

## Summary

| eval | with_skill | without_skill |
| --- | --- | --- |
| 23 | 3/3 | 3/3 |

## 前回より下がったものと、その原因

- 無し（eval 23 は新規なので、比べる記録は無い）

## 気付いたこと

- 差が出なかった。without_skill も `docs/release.md` が無いことに気付き、commit の前に利用者に確認すると答えた。
  案内先が無いことは fixture を読めば分かるので、一般のエージェントも止まる。eval 23 は、スキルが「定義が無い」として確認せずに進むようになったときの後退を検出するために置く。

## 実行し直した run

- 無し

## 集計から外したもの

- 無し
