# Skill Benchmark: parity-suite

**Model**: claude-code / opus（CLI 2.1.270 (Claude Code)）
**Date**: 2026-09-14
**Evals**: 32・33（新設。`with_skill` / `without_skill` 各 1 run。変更確認スコープなので Delta の数値は語らない）

## 何を変えたか（PR #363 の Copilot レビュー指摘）

Issue #361（撮る対象の矩形が落ち着くまで待つ・2 標本の一致は決定論の証明ではない）と Issue #360（操作で開く器の棚卸し `capture_conditions.popup_inventory`）の契約に回帰 eval が無かった。
eval 32 は静止待ち、eval 33 は器の棚卸しを、それぞれ誤った前提の依頼を押し戻す形で追加した。

## Summary

| eval | with | without | 弁別した assertion |
|---|---|---|---|
| 32 静止待ち | **7/7** | 4/7 | 3（expect.poll 等での読み比べ・操作アダプタに置く・落ち着かない状態の扱い） |
| 33 器の棚卸し | **6/6** | 1/6 | 5（3 経路に出ない説明・再帰的に数える・`popup_inventory` の記録・`gaps.md` の種別・開く関数との突き合わせ） |

4 run とも `isolation.txt` は `sandboxed`、`without_skill` の `contamination.txt` は `clean`。

## 読み取れたこと

- **eval 32**: `without_skill` も「2 回では少なすぎる」「位置とサイズが 2 フレーム続けて変わらないこと」を自力で挙げ、assertion 1・2 は弁別しない（一般的な flaky 対策の範囲）。
  固定待機の禁止と自動リトライでの読み比べ、待ちを操作アダプタに置いて新側採取にも効かせること、落ち着かない状態を撮影状態から外して `gaps.md` に残すことはスキル固有で、baseline は出さなかった
- **eval 33**: `without_skill` は「present は見た目を保証しない」「黙って外すのは危ない」までは言うが、記録先を独自の状態一覧にし、撮り漏れ検出も被覆表の操作と突き合わせる形になった。
  スキル固有の棚卸し（再帰・`popup_inventory`・`gaps.md` の種別・操作アダプタとの突き合わせ）は満たさない
