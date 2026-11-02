# Skill Benchmark: current-environment-bootstrap

**Model**: claude-code / opus（harness `run-skill-eval/5`）
**Date**: 2026-11-02
**Evals**: 2（`with_skill` と `without_skill` を 1 run ずつ）

## 目的

Issue #856 で、iteration-15 の後にレビューの指摘を受けて取り決めを絞った後の変更確認である。
絞った取り決めが判定に関わる eval 1（公式の seed）と eval 4（出所が分からない dump）だけを実行した。
比べ方は `docs/skill-development.md`「前回の記録との比べ方」に従う。比べる記録は、opus で実行した、その eval を含む最も新しい iteration である。

## 入力の変更

iteration-15 の後に、スキルの記述を次のように変えた。

- 手順書を根拠に seed の出所と利用許可を確かめる条件を、3 つに絞った。手順書そのものが受領資産であること、検証環境やテスト環境の構築で投入するファイルとして名指ししていること、本番のバックアップやダンプの復元ではないことである。
  実在の人のものに見える個人を特定できる値があれば、匿名化済みかを確かめるまで投入しない（`references/data-semantics.md`）。
- 工程 3 の不足の後に工程 4〜6 を続ける扱いは、出所か利用の許可が分からないデータが 1 件でもあれば当てない（`SKILL.md`）。
- 工程 3 の不足が残る間は、暫定データの投入はせず、データと投入のツールを作るところまでにする（`references/provisional-data.md`）。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 1 | あり | 5/5 | 0/5 | 5/5（iteration-15） |
| 4 | あり | 10/10 | 9/10 | 10/10（iteration-15） |

## 変更の効果

- eval 1: 手順書（`setup-guide.md` 4.2）を受領資産として記録し、それを根拠に公式の seed を受領済みにした。個人を特定できる値が無いことも確かめた。
  工程 4〜6 を続け、`semantics.md` と暫定データの投入ツールを作り、投入はしなかった。
- eval 4: dump を開かずに止まり、`schema.md`・`semantics.md`・`verification.md` を作らなかった。`blocked_on` に、工程 4〜6 も続けていないことを記録した。

## 前回より下がったものと、その原因

- 無し

## 実行し直した run

- 無し

## 集計から外したもの

- 無し（with_skill はすべてスキルを読み、without_skill の汚染の判定はすべて `clean` だった）
