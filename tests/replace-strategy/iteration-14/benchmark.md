# Skill Benchmark: replace-strategy

**Model**: claude-opus-5 (`--model opus`)
**Date**: 2026-08-25T21:10:59Z
**Evals**: 21 (3 runs each per configuration)

## Summary

| Metric | With Skill | Without Skill | Delta |
|--------|------------|---------------|-------|
| Pass Rate | 100% ± 0% | 60% ± 0% | +0.40 |
| Time | 79.1s ± 0.0s | 75.4s ± 0.0s | +3.7s |
| Tokens | 326456 ± 0 | 272135 ± 0 | +54321 |

## 実施範囲

**ヘッダの「3 runs each per configuration」は定型文。** 各 configuration **1 run**、eval 21 のみ
（`current.origin` 導入に伴う**後方互換**の確認が目的で、他 eval は本変更の影響を受けない）。
`sandboxed`、`without_skill` の汚染判定は `verdict: clean`。

## アナリストパス（所見）

- **受け入れ条件「既存 current target の場合は従来フローが変わらない」を満たす。** with は
  `current.origin` の欠落を `managed` として扱い、`current-environment-bootstrap` へ委譲せず、
  `.replace/` を 1 ファイルも作らず、MCP 不在で測定へ進まず停止した。fixture の `skills.yml` も無変更（diff 一致）。
- **落ちた 2 本は baseline が `current.origin` という契約自体を知らないことに起因**（由来の分岐と MCP 停止条件）。
  残る 3 本は「委譲していない」「由来を誤断定していない」「設定を書き換えていない」という否定形で、
  由来の概念を持たない baseline も自動的に満たす。**否定形 assertion は弁別しない**という既知の傾向がここでも出ている。
