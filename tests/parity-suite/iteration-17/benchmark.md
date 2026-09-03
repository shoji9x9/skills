# Skill Benchmark: parity-suite

**Model**: gpt-5.4
**Date**: 2026-09-03T04:09:15Z
**Evals**: 24, 25, 26, 27, 28 (1 run each per configuration)

## Summary

| Metric | With Skill | Without Skill | Delta |
|--------|------------|---------------|-------|
| Pass Rate | 100% ± 0% | 20% ± 35% | +0.80 |
| Time | 56.4s ± 19.9s | 47.0s ± 7.4s | +9.5s |
| Tokens | 177177 ± 62478 | 110960 ± 14558 | +66216 |

## Per-eval

| eval | 内容 | with_skill | without_skill |
|---|---|---|---|
| 24 | 代表列だけの確認を押し戻す（Issue #286） | 5/5 | 0/5 |
| 25 | コンテキストメニューの候補欠落 | 5/5 | 4/5 |
| 26 | 視覚採取の同値クラス削減（E2E は削減対象外） | 5/5 | 1/5 |
| 27 | 適合プロファイルが無い複雑部品を未検証で残す | 4/4 | 0/4 |
| 28 | 根拠付き不在（フラグ偽装の拒否） | 4/4 | 0/4 |

## Notes

- **eval 25 は Delta ではなく後退検知が目的。** baseline も 5 本中 4 本を第一原理から導けるため（右クリック対象・ロール／行状態・畳み込みによる欠落・完了拒否）、
  弁別しているのは「未測定ゼロを表の空欄ではなく同梱ツールの機械照合で確かめる」1 本だけ。この eval は契約の後退を検知する用途で維持する。
- **eval 26 は初回 2/5 でスキル欠陥を検出した。** with_skill が `SKILL.md` だけを読んで答え、同値クラスの記録要件（分類根拠・全候補の所属）に到達しなかった。
  `SKILL.md` の禁止事項へ当該契約を明記して 5/5。本 iteration の数値は修正後のもの。
- **本 iteration は全 eval を同一スキル版で測り直している。** eval 26 の修正が SKILL.md に及んだため、24・25・27・28 も修正後の版で再走した。
- **executor のハングに注意。** `scripts/run-skill-eval.sh` は executor の stdin をリダイレクトしないため、
  呼び出し側の stdin が EOF しないパイプ（バックグラウンド実行・エージェント経由）だと codex が
  `Reading additional input from stdin...` で無限に待つ（trace は 0 バイト、実行は timeout でしか終わらない）。
  本 iteration では eval 24・25 で発生し、`</dev/null` を付けて解消した。
