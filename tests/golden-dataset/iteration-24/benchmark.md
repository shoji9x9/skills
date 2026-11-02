# Skill Benchmark: golden-dataset

**Model**: claude-code / opus（harness `run-skill-eval/5`）
**Date**: 2026-11-02
**Evals**: 2（`with_skill` と `without_skill` を 1 run ずつ）

## 目的

Issue #856 の変更確認（入力を変えた eval を 1 run ずつ）である。
比べ方は `docs/skill-development.md`「前回の記録との比べ方」に従う。比べる記録は、opus で実行した、その eval を含む最も新しい iteration である。

## 入力の変更

- eval 8: fixture の `features.md` と `design.md` を、テンプレートの形と網羅の検査が求める表で書き直した。
  static の単位名は `dataset_static_paths` のパス（`content/works`）で書き、同梱の `predicate-coverage-check.mjs` は exit 0 になる。
  検査は一覧のセルを `/` で区切らないようにした（検査のバージョン 5）。
  prompt に「content/works はテスト用のデータで、投入して書き換えてよい」を足した。
- eval 13: prompt で、投入先の DB に接続せず、投入もせずに、フェーズ A のデータ設計まで進めるよう求めた。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 8 | あり | 8/9 | 6/9 | 4/9・4/9・4/9（iteration-22） |
| 13 | あり | 5/5 | 2/5 | 2/5（iteration-23） |

## 前回より下がったものと、その原因

- 無し（前回に満たした assertion は、今回もすべて満たした）

## 前回より上がったもの

- eval 8: データの作り直しまで届いた。`content/works` を 8 件に作り直し、`metadata.json` を version 2 に上げ、`changes` に `content/works` を affects として足し、fingerprint を計算し直した。
  満たさなかったのは、affects と各 slug の実効参照データを照合したうえでのベースライン再取得の案内だけである。
- eval 13: 設計の段まで届き、`design.md` を作った。DB に接続するコマンドは実行していない。

## 実行し直した run

- eval 8 の 2 run は、prompt を直す前の版でも実行した。その版の with_skill は、SKILL.md の「投入の前の自己申告のチェックは自律実行でも省かない」に従って投入の前の確認を判断待ち（pd-1）にし、ドライランまでで止まった（4/9）。
  prompt にテスト環境であることの確認が無かったためで、スキルの振る舞いは正しい。
  prompt に確認の答えを足して実行し直した。前の版の prompt は commit していないので、前の 2 run は記録から外した。

## 集計から外したもの

- 無し（with_skill はすべてスキルを読み、without_skill の汚染の判定はすべて `clean` だった）
