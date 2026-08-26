# Skill Benchmark: golden-dataset

**Model**: claude-opus-5 (`--model opus`)
**Date**: 2026-08-26T02:27:08Z
**Evals**: 13 (3 runs each per configuration)

## Summary

| Metric | With Skill | Without Skill | Delta |
|--------|------------|---------------|-------|
| Pass Rate | 100% ± 0% | 20% ± 0% | +0.80 |
| Time | 606.4s ± 0.0s | 368.7s ± 0.0s | +237.7s |
| Tokens | 1514221 ± 0 | 884932 ± 0 | +629289 |

## 実施範囲

ヘッダの「3 runs each per configuration」は定型文。各 configuration **1 run**、eval 13 のみ。
`current-environment-bootstrap` からの引き継ぎ（禁止事項 13 / 14 とフェーズ A 手順 1・2・6）の確認が目的。
`sandboxed`、`without_skill` の汚染判定は `verdict: clean`。

## アナリストパス（所見）

- **本セットで最大の弁別（5/5 対 1/5、Delta +0.80）。** 決定的だったのは `orders` の扱い:
  **baseline は 26 件を投入し、`coverage.md` に「状態別表示・絞り込み（status 全候補値）を踏める」と記載した。**
  `orders.status` の意味は `semantics.md` で確認待ち（Q-2・先方も現物を持たない）であり、
  確認待ちの意味論を確定扱いにしてデータを作った——禁止事項 14 が想定した誤りがそのまま出た。
  with は `orders` を **0 件**とし、`design.md` に「`status` の意味論が未確定のため 1 件も入れない」と明記した。
- **起動要件の引き継ぎでも差が出た。** with は `app_users` 3 件を「`handoff.boot_requirements` 由来。推測で足したのではない」と
  根拠付きで設計に含めた。baseline も `app_users` を入れたが、根拠は `semantics.md` 4 章（＝**暫定起動データ**）で、
  引き継ぎ契約ではなく既存データの踏襲になっている（禁止事項 13 が禁じた流用に近い経路）。
- **投入ツールの分離は両者とも守った**（`bootstrap/seed.sh` は diff 一致で無改変、`seed/` へ新規作成）。
  ディレクトリが設定で分かれているため、この 1 本は弁別しない。
- baseline は `.replace/dataset/coverage.md` という**独自様式**を作った。テンプレート（`design.md` / `verification.md`）を
  知らないためで、下流の `parity-suite` は「意味論が未確定の機能」節を読めない。
