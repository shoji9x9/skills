# Skill Benchmark: pr-finalize-loop

**Model**: claude-code / opus / high（harness `run-skill-eval`）
**Date**: 2026-11-15
**Evals**: 3（`with_skill` を 1 run ずつ）

## 目的

Issue #1033 で、`SKILL.md`（手順 2・4・6、自律性ポリシー、反復の段階と effort、停止条件）と `references/review-request.md`・`review-status.md` を変えた。
デフォルト（`rereview_after_reply: true`）の振る舞いが変わらないかを、変えた節を読む既存の eval で確かめる変更確認である。prompt・fixture・assertion は変えていない。

- eval 20（`--defer-decisions`）: 自律性ポリシーの判断待ちと「判断待ちで終了」の行を変えた。
- eval 27（`claude-code-action`、返信だけの反復）: 手順 2 の時刻の条件と、手順 6 の push しなかった反復を変えた。
- eval 29（`claude-code-action`、push した反復）: 手順 6 を変えた。

eval 21 は 3 run で比べるので、iteration-28 に分けた。

## Summary

| eval | 今回 | 前回 |
|------|------|------|
| 20 | 8/8 | iteration-21 で同じ assertion がすべて pass |
| 27 | 7/7 | iteration-24 の 3 run で同じ assertion がすべて pass |
| 29 | 6/6 | iteration-24 の 3 run で同じ assertion がすべて pass |

下がった assertion は無い。

## 実行し直した run

無し。

## 集計から外したもの

無し。すべての run は `sandboxed` で、`invalid_run` は無い。
