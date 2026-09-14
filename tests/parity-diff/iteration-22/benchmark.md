# Skill Benchmark: parity-diff

**Model**: claude-code / claude-opus-5（CLI 2.1.270 (Claude Code)）
**Date**: 2026-09-14
**Evals**: 22 のみ（`with_skill` / `without_skill` 各 1 run。変更確認スコープなので Delta の数値は語らない）

## 何を変えたか（PR #363 の Copilot レビュー 3 回目）

`popup_inventory` のキーが無い旧成果物を「停止せず未検証として記録」から「停止して `parity-suite` で採り直し。採り直せない理由をユーザーが承認した場合だけ、現側ノイズ基準値の吸収なしで続行」へ変えた（ユーザー判断）。
これに合わせて eval 22 の prompt に「現行環境が撤去されて撮り直せない機能」を足し、assertion 3・4・6 を新しい契約に合わせた。

## Summary

| eval | with | without | 弁別した assertion |
|---|---|---|---|
| 22 棚卸しの撮影前検査 | **6/6** | 2/6 | 4（開く関数と `opened_by` の突き合わせ・静止待ち前の採取として採り直し・承認時だけノイズ吸収なしで続行・`capture_conditions_verified` への記録） |

2 run とも `isolation.txt` は `sandboxed`、`without_skill` の `contamination.txt` は `clean`。

## 読み取れたこと

- `with_skill` は「撤去済みと聞いたことは承認の代わりにならない」として停止のまま扱い、例外の続行条件（`--noise` を渡さない・`noise_baseline` を差し引かない・`diff.md` 7 章への記録）まで答えた
- `without_skill` は撤去済みの機能を「比較不能」ステータスにする独自案で、ユーザー承認の例外・ノイズ吸収を止める観点・記録先の様式には到達しない
