# Skill Benchmark: pr-finalize-loop

**Model**: claude-code / opus / high（harness `run-skill-eval`）
**Date**: 2026-11-14
**Evals**: 3（`with_skill` と `without_skill` を 3 run ずつ）

## 目的

Issue #1030 の PR B で、`review_tool` の値 `claude-code-action` を足した。その依頼と完了の判定を確かめる eval 27〜29 を新しく足したので、依頼者の指定で 3 run の benchmark を取った。

## 入力

- eval 27: 返信だけで終わった反復で、effort の段階が medium のときの依頼の方法と、依頼に渡す値（effort・`--since`・`--sha-file`）。
- eval 28: `github-actions[bot]` の目印の候補 4 件（人が書いたもの、別のワークフローの run、失敗した run、成功した run）の扱いと、指摘 0 件での収束。
- eval 29: push の直後から自動の run が終わるまでの 3 つの時点で、依頼するかどうか。
- fixture は `review-tool-claude-code-action`（`review_tool` を `claude-code-action` にした設定だけ）。

## Summary

| eval | with_skill | without_skill |
|------|------------|---------------|
| 27（依頼の方法と渡す値） | 7/7・7/7・7/7 | 4/7・4/7・4/7 |
| 28（目印の突き合わせ） | 8/8・8/8・8/8 | 6/8・6/8・6/8 |
| 29（重ねて依頼しない） | 6/6・6/6・6/6 | 6/6・5/6・5/6 |

## 区別できる assertion

- eval 27: `@claude review` を投稿しない（without_skill は代わりの方法として挙げた）、`--since` に返信の時刻を渡す、SHA を `--sha-file` で渡す。
- eval 28: 突き合わせを同梱の `claude-review-action.sh` の `check` で行う、スレッドの外（トップレベルのコメント A〜C の本文を含む）の指摘の条件。
- eval 29: `findings=2` の指摘を集めて対応に進む（without_skill は 3 run 中 2 run が `open=0` を理由に直す指摘は無いと結論した）。

ほかの assertion は、場面の説明から一般の判断で答えられるので、without_skill も pass した。後退の検出のために置く（`evals/pr-finalize-loop/README.md`）。

## 前回より下がったもの

新しい eval なので、比べる記録は無い。

## 実行し直した run

無し。

## 集計から外したもの

無し。すべての run は `sandboxed` で、without_skill の汚染の判定は `clean`、`invalid_run` は無い。
