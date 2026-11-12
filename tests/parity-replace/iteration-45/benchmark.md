# Skill Benchmark: parity-replace

**Model**: claude-code / opus / 指定なし（前回の run に合わせた）（harness `run-skill-eval/5`）
**Date**: 2026-11-12
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 目的

PR #1001 のレビューで、eval 6 の assertion 3 が、原本（`SKILL.md` の軽量な手順）が確かめる値と定める「今の `new.commit`」と違う値（記録の `new.commit`）も通していると指摘を受けた。
assertion 3 を、HEAD の commit の完全な SHA を尋ねるか、答えた commit の tree を `--rev` で比べる形に戻したので、変更確認として両方の configuration で 1 run ずつ実行した。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 6 | assertion 3 | 5/5 | 3/5 | 文が同じ assertion 4 件は前回（iteration-44）と同じ。assertion 3 は文を変えたので比べない |

すべての run で `isolation.txt` は `sandboxed`、`without_skill` の `contamination.txt` は `clean` だった。

## 観察

- 差は assertion 2・3 で出た。`with_skill` は `commit_check` が無いことを理由に、`source-version.mjs` が出した HEAD の完全な SHA がデプロイされているかを確かめるとした。
  baseline は remote が無いことを理由にし、ユーザーに尋ねず、短い SHA だけを挙げた。
