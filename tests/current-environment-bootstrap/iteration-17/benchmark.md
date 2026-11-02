# Skill Benchmark: current-environment-bootstrap

**Model**: claude-code / opus（harness `run-skill-eval/5`）
**Date**: 2026-11-02
**Evals**: 2（`with_skill` と `without_skill` を 1 run ずつ）

## 目的

PR #863 のレビュー（反復 1）の指摘で、出所・再開・タイムゾーンの扱いを直した後の変更確認である。
直した取り決めが判定に関わる eval 1（公式の seed）と eval 4（出所が分からない dump）だけを実行した。
比べ方は `docs/skill-development.md`「前回の記録との比べ方」に従う。比べる記録は、opus で実行した、その eval を含む最も新しい iteration である。

## 入力の変更

- 中身を見る前に出所を確かめる対象を元の範囲に戻し、構築手順書の 3 つの条件を満たすデータだけを例外にした（`references/data-semantics.md`）。
- 出所か利用の許可が分からないデータは工程 4〜6 でも開かず使わず、確かめた資産だけで続ける。そうしたデータしか無いときだけ止まる（`SKILL.md`）。
- 工程 3 から再開することを、`blocked_on` と工程 4〜6 の成果物から決める（`SKILL.md`）。
- 接続設定などがタイムゾーンを上書きしていれば、上書きした後の値で復元する（`references/asset-inventory.md`・`references/schema-restoration.md`）。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 1 | あり | 5/5 | 0/5 | 5/5（iteration-16） |
| 4 | あり | 10/10 | 9/10 | 10/10（iteration-16） |

## 変更の効果

- eval 1: 受領した構築手順書を読んでから、別の呼び出しで seed を開いた。出所を確かめてから中身を読む順序に従っている。
- eval 4: dump には `ls -la` と `wc -c` だけを実行し、開かずに止まった。dump の値は成果物にも応答にも出ていない。

## 前回より下がったものと、その原因

- 無し

## 実行し直した run

- 無し

## 集計から外したもの

- 無し（with_skill はすべてスキルを読み、without_skill の汚染の判定はすべて `clean` だった）
