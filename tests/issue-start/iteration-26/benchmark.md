# Skill Benchmark: issue-start

**Model**: claude-code / opus / high（harness `run-skill-eval`）
**Date**: 2026-11-12
**Evals**: 2（`with_skill` と `without_skill` を 1 run ずつ）

## 目的

Issue #999 の変更確認である。
`issue-start` が最初の commit の前に破壊的変更に当たるかを判断し、PR の本文に「破壊的変更」の節を置くようにした。
規約の文書が定義を案内する場合を eval 21、規約の文書に定義が無い場合を eval 22 として足した。

## 入力の変更

- eval 21 を足した。fixture `breaking-change-doc` は、`conventions_doc` が `CONTRIBUTING.md` を指し、そこから `docs/release.md`「破壊的変更」の定義へ案内する
- eval 22 を足した。fixture `no-breaking-change-doc` は、`CONTRIBUTING.md` が conventional commits と semantic-release を使うとだけ書き、破壊的変更の定義を持たない

## Summary

| eval | with_skill | without_skill |
| --- | --- | --- |
| 21 | 6/6 | 6/6 |
| 22 | 3/3 | 1/3 |

## 前回より下がったものと、その原因

- 無し（eval 21・22 は新規なので、比べる記録は無い）

## 気付いたこと

- eval 21 は差が出なかった。without_skill も `CONTRIBUTING.md` から `docs/release.md` をたどり、定義に照らして 2 つの commit を分類し、PR の本文に破壊的変更の節を置いた。
  定義を読める環境では、定義に従う判断は一般のエージェントにもできる。eval 21 は、スキルが定義を読む手順を失ったときの後退を検出するために残す。
- eval 22 で差が出た。without_skill は、規約に定義が無いことに触れず、一般の判断で `BREAKING CHANGE:` を書いた。
  with_skill は、定義が無いことと読んだ `CONTRIBUTING.md` を PR の本文の節に書くと述べ、一般の意味では破壊的変更に見えることも利用者に伝えた。

## 実行し直した run

- with_skill の 2 本は、レビューの指摘で `references/breaking-change.md` を直した後に実行し直した。どちらの直しも、run を評価として成り立たせるためではなく、スキルの取り決めのあいまいさを直すためである。
  - 1 回目の後、定義の文書を読めない場合と定義が無い場合の区別と、PR を作った後の修正の扱いを足した
  - 2 回目の後、commit message の書き方の仕様（conventional commits など）を定義に数えないことを足した。直す前の eval 22 の with_skill は、conventional commits の仕様を定義に数えるかで迷い、「定義が無い」と書くかを条件付きでしか述べなかった
- 直す前の run は集計に入れていない。without_skill の 2 本はスキルを読まないので、実行し直していない

## 集計から外したもの

- 無し
