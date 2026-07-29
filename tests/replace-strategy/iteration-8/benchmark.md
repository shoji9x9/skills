# Skill Benchmark: replace-strategy

**Model**: claude-opus-5
**Date**: 2026-07-29T06:41:22Z
**Evals**: 11 (1 run each per configuration)

## Summary

| Metric | With Skill | Without Skill | Delta |
|--------|------------|---------------|-------|
| Pass Rate | 100% ± 0% | 0% ± 0% | +1.00 |
| Time | 83.7s ± 0.0s | 142.4s ± 0.0s | -58.7s |
| Tokens | 226960 ± 0 | 415411 ± 0 | -188451 |

## Notes

- eval 11 のみ（本イテレーションの対象）。Issue #146 で追加した「`setup` が `references` をキーごと生成する／`dependency_policy` だけは空値の枠を置かない」の回帰。
- **without_skill run-1 は baseline 汚染のため集計から除外した（`grading.json` を置いていない）。** スキル未設置にもかかわらず、応答が
  `dependency_policy` の三値契約・各 references キーの読み手と読む工程・空値の枠の目的を正確に再現しており、4/4 で pass した（＝弁別ゼロ）。
  使い捨てプロジェクトは空（`project-tree.txt` は `.` のみ）でハーネス側の設置漏れではなく、`--dangerously-skip-permissions` の headless run が
  ローカルの作業ツリー（`skills/replace-strategy/**`）を読めることが原因と判断した。
- **without_skill run-2 が本イテレーションの baseline**。`SKILL_EVAL_RUNNER` に `bwrap --dev-bind / / --tmpfs <repo の親>` のラッパーを渡し、
  リポジトリを隠して同一プロンプトを実行した（ハーネス本体は未変更）。結果はスキル資産を発見できず 0/4——
  「未決なら references キーごと落とす」というユーザー指示をそのまま是認し、三値の区別にも未整備の可視化にも到達していない。汚染経路がローカル読み取りであることが確定した。
- なお対象リポジトリは PUBLIC のため、GitHub 経由（`gh` / WebFetch）でスキル本文を取得する経路は本サンドボックスでも塞げていない。
  run-2 の応答にはその形跡が無いが、baseline の隔離は今後も応答内容の確認が要る。関連: `.kaizen/2026-07-28-eval-baseline-read-contamination.md`（未適用）。
