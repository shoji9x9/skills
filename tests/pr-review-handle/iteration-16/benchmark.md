# Skill Benchmark: pr-review-handle

**Model**: claude-code / opus / high（harness `run-skill-eval`）
**Date**: 2026-11-14
**Evals**: 1（`with_skill` と `without_skill` を 3 run ずつ）

## 目的

Issue #1030 の PR B で、`review_tool` の値 `claude-code-action` を足した。返信だけで対応した後の再レビューの依頼を確かめる eval 15 を新しく足したので、依頼者の指定で 3 run の benchmark を取った。
fixture は `review-tool-claude-code-action`（`review_tool` を `claude-code-action` にした設定だけ）。

## Summary

| eval | with_skill | without_skill |
|------|------------|---------------|
| 15（返信だけの後の依頼） | 6/6・6/6・6/6 | 3/6・3/6・3/6 |

## 区別できる assertion

`workflow_dispatch` で依頼する、`@claude review` を投稿しない、返信の時刻を `--since` として渡す、の 3 本である。
without_skill は、`@claude` のコメントか `gh run rerun` で依頼すると答えた。
返信より前の run を根拠にしない・進行中の run が無いことを確かめる・説明に留める、の 3 本は、場面の説明から一般の判断で答えられるので、without_skill も pass した。

## 前回より下がったもの

新しい eval なので、比べる記録は無い。

## 実行し直した run

無し。

## 集計から外したもの

無し。すべての run は `sandboxed` で、without_skill の汚染の判定は `clean`、`invalid_run` は無い。
