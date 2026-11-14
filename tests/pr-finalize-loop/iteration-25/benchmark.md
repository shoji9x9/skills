# Skill Benchmark: pr-finalize-loop

**Model**: claude-code / opus / high（harness `run-skill-eval`）
**Date**: 2026-11-14
**Evals**: 5（`with_skill` を 1 run ずつ）

## 目的

Issue #1030 の PR B で、`review_tool` の値 `claude-code-action` を足し、`SKILL.md`（値の一覧・手順 1・2・6・「反復の段階と effort」・停止条件）と `references/` の 5 つを変えた。
変えた文書を読む既存の eval が、前と同じ結果になるかを確かめる変更確認である。prompt・fixture・assertion は変えていない。

選んだ eval と理由は次のとおりである。全件はやり直していない。

- eval 15・16（`claude-code`）: `review-status.md`「HEAD のレビュー済み判定」に `claude-code-action` の項を足した。
- eval 21（`copilot`、`--max-iterations 3`）: 「反復の段階と effort」と停止条件の表を変えた。
- eval 22（`local`、effort の段階）: effort を指定できるツールに `claude-code-action` を足した。
- eval 23（`none`）: 停止条件の表の「行き詰まり」の行を変えた。

## Summary

| eval | 今回 | 前回 |
|------|------|------|
| 15 | 6/6 | iteration-21 で同じ assertion がすべて pass |
| 16 | 5/5 | iteration-21 で同じ assertion がすべて pass |
| 21 | 6/7 | iteration-22 で 7/7 |
| 22 | 7/7 | iteration-21 で同じ assertion がすべて pass |
| 23 | 7/7 | iteration-21 で同じ assertion がすべて pass |

## 前回より下がったものと、その原因

eval 21 の「指摘を直さずに見送ってよい根拠を、4 つに限ると述べている」が、前回の pass から fail になった。
応答は「直さない根拠として認められる 4 つのどれにも当たりません」と書いたが、続けて 3 つしか挙げず、「基準で人に回さないと決まって推奨の案で見送った」が抜けた。
今回の変更は見送りの根拠の節を変えていない。1 run どうしの比較なので、回帰かばらつきかは区別できない。eval 21 の 3 run の実行を残りの作業に挙げる。

## 実行し直した run

無し。

## 集計から外したもの

無し。すべての run は `sandboxed` で、`invalid_run` は無い。
