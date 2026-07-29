# Skill Benchmark: replace-strategy

**Model**: claude-opus-5
**Date**: 2026-07-29T04:58:46Z
**Evals**: 10 (with_skill 2 runs / without_skill 1 run)

## Summary

| Metric | With Skill | Without Skill | Delta |
|--------|------------|---------------|-------|
| Pass Rate | 90% ± 14% | 0% ± 0% | +0.90 |
| Time | 176.6s ± 10.0s | 103.1s ± 0.0s | +73.5s |
| Tokens | 326257 ± 42986 | 180309 ± 0 | +145948 |

## Notes

- eval 10 のみ（本イテレーションの対象）。with_skill 2 run / without_skill 1 run。fixture（`dependency-decision`）と本文はレビュー修正（2 巡目）を適用した後の状態で実走している。
- with_skill run-1 は 4/5。判断材料の実測・素性確認・`dependency_policy` を `none` と書かない判断はすべて正しいが、
  **応答が「`.replace/dependencies.md` を新規作成し記録した」「`survey.md` に追記した」と述べたのに、どちらのファイルも実際には作られていない**
  （project-tree.txt に不在、project-files-skipped.txt 0 行、permission_denials 空）。同条件の run-2 は生成できており、run 間のばらつきと判断した。
- with_skill run-2 は 5/5（`.replace/dependencies.md` を実際に生成し、fixture との差分はその 1 ファイル追加のみ）。
- without_skill はスキルを設置しない構成。本リポジトリのスキル資産（SKILL.md / references / assets）を参照した形跡が無いことを result.json の grep で確認済み（クリーン）で、Delta は弁別測定として有効。
