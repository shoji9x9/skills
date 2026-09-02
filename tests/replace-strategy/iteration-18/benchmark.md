# Skill Benchmark: replace-strategy

**Model**: claude-opus-5
**Date**: 2026-09-02T02:06:56Z
**Evals**: 25 (1 run each per configuration)

## Summary

| Metric | With Skill | Without Skill | Delta |
|--------|------------|---------------|-------|
| Pass Rate | 100% ± 0% | 25% ± 0% | +0.75 |
| Time | 118.8s ± 0.0s | 121.0s ± 0.0s | -2.2s |
| Tokens | 245409 ± 0 | 135918 ± 0 | +109491 |

## Notes

- eval 25（ページ要素の帰属）の新規追加回。両 configuration とも `scripts/eval-sandbox.sh` で隔離し、`without_skill` の `contamination.txt` は `verdict: clean`。
- `with_skill` は「ページ要素の帰属」表に会員登録ボタンを `スコープ外（配置のみ）`・所有者 `shipment` で記録し、所有者を一意に決められない旨を着手前確認として上げた。
  ただし契約（所有者は空欄のまま確認）に反して暫定値を入れており、理由に「空欄で止めると `issues` モードが `/shipments` に乗る全機能の起票をブロックするため」を挙げている。
  **`issues` モードのゲート粒度（ページ単位で全機能をブロック）が空欄回避のインセンティブになっている**可能性があり、スキル側の検討事項。
- assertion 2（要素を置くことと挙動を作らないことの書き分け）は `without_skill` も満たした（独自の「スコープ境界」表で到達）。弁別に効いたのは assertion 1 / 3 / 4。
- 使い捨てプロジェクトには現行環境・現行コードが無いため、可視要素の列挙は `survey.md` とプロンプトの申告に依拠する。`with_skill` はこれを未検証として `features.md` に記録した。
