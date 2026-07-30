# Skill Benchmark: golden-dataset

**Model**: claude-opus-5
**Date**: 2026-07-30T03:16:06Z
**Evals**: 10 (1 run each per configuration)

## Summary

| Metric | With Skill | Without Skill | Delta |
|--------|------------|---------------|-------|
| Pass Rate | 100% ± 0% | 0% ± 0% | +1.00 |
| Time | 83.8s ± 0.0s | 61.6s ± 0.0s | +22.2s |
| Tokens | 227149 ± 0 | 150147 ± 0 | +77002 |

## 対象と結果（Issue #159 ファイル入出力・ストレージ）

eval 10 は「アップロード用 fixture を手でコミット」「ストレージのテストバケットへ投入」という 2 つの逸脱要求への応答を見る。

- with_skill 4/4: 生成ツールへ寄せる規律（手書き静的データをコミットしない）・本物として通るバイト列の必要性・`storage.seedable: true` でもストレージ実体へ投入しない（v1 スコープ外）・未投入＝未検証として `verification.md` / `gaps` に残す、をすべて提示
- without_skill 0/4: ストレージ書き込みを断ったが理由は「非対話環境では外向き・不可逆な操作を避ける」であり、v1 スコープ外・未検証記録・生成ツールの規律はいずれも出ない

## ベースラインの read 汚染について

`without_skill` は `scripts/eval-sandbox.sh`（4 群遮断）経由・逐次で取得。事前 2 段検証と事後のマーカー grep（15 語）はいずれも 0 件で汚染なし。
経緯と手順は `tests/replace-strategy/iteration-10/benchmark.md` の同節を参照。
