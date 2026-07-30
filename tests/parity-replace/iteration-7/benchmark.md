# Skill Benchmark: parity-replace

**Model**: claude-opus-5
**Date**: 2026-07-30T00:35:01Z
**Evals**: 6, 9 (1 run each per configuration)

## Summary

| Metric | With Skill | Without Skill | Delta |
|--------|------------|---------------|-------|
| Pass Rate | 100% ± 0% | 38% ± 53% | +0.62 |
| Time | 78.2s ± 45.3s | 74.7s ± 24.2s | +3.5s |
| Tokens | 171680 ± 64354 | 141710 ± 64702 | +29970 |

## ベースラインの read 汚染と再取得（Delta の有効性）

対象: Issue #158（新側アーキテクチャの事前定義）の回帰確認。**without_skill は eval 6・9 とも初回 run-1 が汚染したため除外し、遮断環境で取り直した run-2 を集計に採用している。**

- **汚染の根拠**（内容 grep。fixture に無くスキル本体にしか無い語）
  - eval 9 run-1: `SKILL.md`×4 / `references.architecture`×2 / `projects/skills`×2。応答中で「正本は `<repo>/skills/parity-replace/` にあり、今回はそこを直接読んで判定しました」と明言し、`SKILL.md:66-67` / `project-config.md:130` を引用していた
  - eval 6 run-1: `軽量経路`×5 / `references.architecture`×1（`commit_check` は fixture の設定コメント由来のため汚染判定に使わない）
- **原因**: 遮断を入れずに実行し、かつ with_skill と並列で回した（`.kaizen/2026-07-28-eval-baseline-read-contamination.md` が警告する 2 経路を両方踏んだ。同学びの 5 度目の再発）
- **再取得**: `SKILL_EVAL_RUNNER` に bwrap ラッパー（作業ツリー／`/tmp` の兄弟 run／WSL ミラー／エージェントの記録の 4 群を遮断）を渡し、**逐次**で再実行
- **遮断の検証**: サンドボックス内の内容 grep で `軽量経路` 0 件（`references.architecture` の唯一の一致は無関係な aws-cli 同梱ドキュメントの `references/architecture` パス）。再取得した run-2 は汚染マーカー 0 件
- **効果**: eval 9 の without_skill は run-1（汚染）なら実質満点相当だったが、run-2 は 0/4。汚染下では Delta が測れないことを再確認した

run-1 は証跡として残すが `grading.json` を置かず、`benchmark.json` にも含めていない。
