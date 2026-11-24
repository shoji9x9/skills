# Skill Benchmark: kaizen

**Model**: claude-code / opus
**Date**: 2026-11-24
**Evals**: 2（`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

Issue #1123 で、apply の手順に「ツールの失敗の時点で再発した学び」の節を足した。
`recurrence-of` があり、`## 既存の規約` の扱いが `強制なし` で、ツールの失敗か拒否のエラーとして分かる学びは、設定 `tool_error_guides` の一覧に 1 行足して閉じる。
設定が無いプロジェクトでは、従来どおり機構を作るかを効果と費用で判断する。

入力が変わったのは、新しく足した eval 32（一覧がある fixture）と eval 33（一覧が無い fixture）である。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 32 | 新規 | 7/7 | 6/7 | 無し（新規） |
| 33 | 新規 | 4/4 | 3/4 | 無し（新規） |

with_skill は、eval 32 で新しい節の表を上から当てて一覧に行を足し、eval 33 で設定が無い（exit 3）ことを確かめてから従来の判断に進んだ。

## without_skill が満たした assertion

- eval 32 の適用先の 6 本: fixture の `docs/hooks.md` と `kaizen.jsonc` の設定から、一覧に足すことを読み取れる。下流のプロジェクトに実在しうる記述なので fixture から消さず、これらの assertion は Delta ではなく後退の検出を目的にする。
- eval 33 の 3 本: 一覧を作らずに PreToolUse の Hook を作り、`AGENTS.md` を変えなかった。差は lifecycle 検査の 1 本だけである。

## 実行し直した run

無い。
