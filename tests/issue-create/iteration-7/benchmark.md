# Skill Benchmark: issue-create

**Model**: claude-code / claude-opus-5-5 / high（harness `run-skill-eval`）
**Date**: 2026-11-19
**Evals**: 4（`with_skill` と `without_skill` を 1 run ずつ）

## 目的

Issue #1063 で、eval 1・2・4・5 を、テンプレートの選び方と起票のコマンドの形を検査する assertion に作り直し、テンプレートの有無だけを変えた fixture を足した。eval 3 は消した。その変更確認として実行した。

## Summary

| eval | with_skill | without_skill |
| --- | --- | --- |
| 1 | 3/3 | 2/3 |
| 2 | 3/3 | 0/3 |
| 4 | 2/2 | 0/2 |
| 5 | 2/2 | 0/2 |

## 前回より下がったものと、その原因

- assertion の文を変えたので、前回の記録とは比べない。

## 気付いたこと

- eval 1 の、リポジトリのテンプレートの節とラベルを使う 2 つの assertion は、without_skill も通った。リポジトリにテンプレートがあれば、ベースラインも読んで使う。差が出たのは `--body-file` に一時ファイルを渡す assertion だけだった（without_skill は `--body-file -` に heredoc を渡した）。
- eval 2・4・5 の without_skill は、同梱のテンプレートが無いので独自の節で書き、タイトルの接頭辞も付けず、テンプレートのコピーも尋ねなかった。
- with_skill の 4 run は、すべてスキルの文書を読んだ。without_skill の 4 run の汚染の判定は、すべて clean だった。

## 実行し直した run

- 無し
