# Skill Benchmark: current-environment-bootstrap

**Model**: claude-code / opus（harness `run-skill-eval/5`）
**Date**: 2026-11-02
**Evals**: 4（`with_skill` と `without_skill` を 1 run ずつ）

## 目的

Issue #856 で、iteration-14 で満たさなかった assertion の原因をスキルの記述で直した後の変更確認である。
変えた停止の取り決めと出所の扱いが判定に関わる eval 3・4 も実行した。
比べ方は `docs/skill-development.md`「前回の記録との比べ方」に従う。比べる記録は、opus で実行した、その eval を含む最も新しい iteration である。

## 入力の変更

iteration-14 の後に、スキルの記述を次のように変えた。

- 工程 3 の不足（スキーマを欠けなく作り直せない、DB の設定を判断できない）で止まるときも、不足の項目に依存しない工程 4・5・6 を続け、工程 7 の前で止まる。
  出所と利用の許可が分からないデータしか無いときは、この扱いに当たらず、後の工程へ進まない（`SKILL.md`・`references/schema-restoration.md`）。
- 受領した構築手順書が検証環境の構築で投入するよう指示しているデータ（公式の seed など）は、その手順書を出所と利用許可の根拠にできる（`references/data-semantics.md`）。
- マイグレーションの適用の手順は `<bootstrap_tool_dir>` に書いて示す。ツールの付属物（Entity Framework Core の `.Designer.cs` など）が欠けていても、それだけで止まらない（`references/schema-restoration.md`）。
- 接続文字列や設定ファイルが環境変数から受け取る値は、環境変数の名前を起動要件として記録する（`references/asset-inventory.md`）。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 1 | あり | 5/5 | 0/5 | 2/5（iteration-14） |
| 2 | あり | 6/6 | 0/6 | 4/6（iteration-14） |
| 3 | あり | 8/8 | 1/8 | 8/8・8/8・8/8（iteration-12） |
| 4 | あり | 10/10 | 9/10 | 10/10（iteration-11） |

## 変更の効果

- eval 1: 公式の seed を、手順書 4.2 を根拠に受領済みとして記録した。工程 3 の不足で止まらずに、データ辞書を根拠にした意味論の台帳と暫定の起動データまで作った。
- eval 2: `.Designer.cs` が無いまま適用する手順を `bootstrap/README.md` に書いた。接続文字列の環境変数名を `schema.md` と README に記録した。
- eval 4: 出所が分からない dump は開かずに、工程 1・2 で止まった。工程 4〜6 を続ける扱いは、出所が分からないデータには当たらないことを確かめた。

## 前回より下がったものと、その原因

- 無し

## 実行し直した run

- 無し

## 集計から外したもの

- 無し（with_skill はすべてスキルを読み、without_skill の汚染の判定はすべて `clean` だった）
