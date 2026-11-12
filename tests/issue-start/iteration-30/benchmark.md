# Skill Benchmark: issue-start

**Model**: claude-code / opus / high（harness `run-skill-eval`）
**Date**: 2026-11-12
**Evals**: 2（`with_skill` と `without_skill` を 1 run ずつ）

## 目的

PR #1000 の判断待ち（r4544224845）に、利用者が C を選んだ。
定義が無いときは当たるかを判断しない。一般の意味で破壊的に見える変更なら、その見立てと理由を PR の本文の節に書き、規約の文書に定義を置くことを勧める。
`!` と `BREAKING CHANGE:` は付けない。破壊的に見えない変更なら、勧めを書かない。
この取り決めを `references/breaking-change.md` に足した後の変更確認である。

## 入力の変更

- eval 22 に assertion を 3 本足した（見立てと理由を節に書く・定義を置くことを勧める・`!` も `BREAKING CHANGE:` も書かない）
- eval 25 を足した。fixture は eval 22 と同じ `no-breaking-change-doc` で、変更はデフォルトが従来と同じ任意のキーの追加である

## Summary

| eval | with_skill | without_skill |
| --- | --- | --- |
| 22 | 6/6 | 2/6 |
| 25 | 3/3 | 2/3 |

## 前回より下がったものと、その原因

- eval 22 は assertion を変えたので、文が同じ 3 本だけを前回（iteration-26）と比べた。with_skill は 3 本すべて pass で、下がっていない
- eval 25 は新規なので、比べる記録は無い

## 気付いたこと

- eval 22 の without_skill は、一般の判断で `feat!:` と `BREAKING CHANGE:` を書き、定義が無いことにも勧めにも触れなかった。
  区別できるのは、定義が無いことを書く 2 本・勧め・`!` を書かないの 4 本である。見立てと理由を書く 1 本は without_skill も pass した
- eval 25 の with_skill は、破壊的に見えないので見立ても勧めも書かないと述べた。without_skill も勧めを書かなかった。
  区別できるのは、定義が無いことを書く 1 本だけである。勧めを書かない 1 本は、書きすぎる後退を検出するために置く

## 実行し直した run

- 無し

## 集計から外したもの

- 無し
