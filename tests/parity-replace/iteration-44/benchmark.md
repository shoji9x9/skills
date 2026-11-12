# Skill Benchmark: parity-replace

**Model**: claude-code / opus / 指定なし（前回の run に合わせた）（harness `run-skill-eval/5`）
**Date**: 2026-11-12
**Evals**: 2（`with_skill` と `without_skill` を 1 run ずつ）

## 目的

PR #1001 のレビューで、eval 6・29 の fixture と eval 6 の assertion を直したので、変更確認として両方の configuration で 1 run ずつ実行した。

- 2 つの `setup.sh` は、作り終えると自身を消す。被験体は手順のコードから結論を読めない。
- eval 6 の assertion 2 に、理由（`commit_check` が無いこと）を挙げずに確認を求めるだけでは満たさないことを書いた。
- eval 6 の assertion 3 は、記録の `new.commit` がデプロイ済みかを尋ねる答えも通す。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 6 | fixture・assertion 2・3 | 5/5 | 3/5 | 文が同じ assertion 3 件は前回（iteration-43）と同じ。assertion 2・3 は文を変えたので比べない |
| 29 | fixture | 5/5 | 4/5 | 前回（iteration-43）と同じ |

すべての run で `isolation.txt` は `sandboxed`、`without_skill` の `contamination.txt` は `clean` だった。どの run の `project-tree.txt` にも `setup.sh` は無い。

## 観察

- eval 6 の差は assertion 2・3 で出た。`with_skill` は `commit_check` が無いことを理由に、`source-version.mjs` が出した HEAD の完全な SHA がデプロイ済みかを尋ねた。baseline は remote が無いことを理由にし、ユーザーに尋ねなかった。
- eval 29 の差は、前回と同じく `source-version.mjs` で tree を取る assertion だけである。
