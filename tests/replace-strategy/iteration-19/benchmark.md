# Skill Benchmark: replace-strategy

**Model**: claude-opus-5
**Date**: 2026-09-02T02:28:37Z
**Evals**: 25 (1 run each per configuration)

## Summary

| Metric | With Skill | Without Skill | Delta |
|--------|------------|---------------|-------|
| Pass Rate | 100% ± 0% | 20% ± 0% | +0.80 |
| Time | 99.9s ± 0.0s | 108.5s ± 0.0s | -8.6s |
| Tokens | 257695 ± 0 | 133010 ± 0 | +124685 |

## Notes

- iteration-18 の実測（`with_skill` が契約に反して所有者へ暫定値を入れ、理由に `issues` モードのゲートによる起票ブロックを挙げた）を受けて、**ゲート粒度と assertion を見直した後の回**。
- ゲートの変更: 所有者が空欄でも**起票は止めず**、候補 slug を添えて確定を求め、確定しなければ機能 Issue 本文へ「配置の所有者が未確定の要素」として持ち越す。実際の停止点は `parity-replace` の差し戻しと `parity-suite` の `gaps.md`。
- 変更後の `with_skill` は 2 行とも所有者を**空欄のまま**残し、候補と決められない理由を備考に書いて着手前確認を求めた（暫定値の記録は消えた）。assertion 5 がこの挙動を直接測っている。
- **assertion 1 は本 iteration の実行後に文言を修正した**（空欄を許す形へ緩めた際に弁別が落ちていたため、「そのページに乗る機能のどれが配置するか」を要求する形へ戻した）。修正後の文言で両 run の成果物を採点しており、再実行はしていない。
- assertion 2 は `without_skill` も独自のスコープ表で到達（2 回連続）。Delta ではなく**後退検知**目的の項目として `evals/README.md` に明記済み。
- `without_skill` はボタンを独立した機能行 `X-01`（green 化の順序 `-`）にし、**どの機能の実装フェーズでも配置されない**状態を作った——本 eval が対象にしている故障モードそのもの。
