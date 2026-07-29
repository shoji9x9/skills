# Skill Benchmark: parity-diff

**Model**: claude-opus-5
**Date**: 2026-07-29T06:41:22Z
**Evals**: 5 (1 run each per configuration)

## Summary

| Metric | With Skill | Without Skill | Delta |
|--------|------------|---------------|-------|
| Pass Rate | 100% ± 0% | 50% ± 0% | +0.50 |
| Time | 62.7s ± 0.0s | 48.0s ± 0.0s | +14.7s |
| Tokens | 104172 ± 0 | 46315 ± 0 | +57857 |

## Notes

- eval 5 のみ（本イテレーションの対象）。Issue #146 で追加した「フォント差の切り分け（版差とヒンティング差）」の回帰。
- **Delta は +0.50 で、4 項目中 2 項目が弁別していない。** without_skill も「同じフォント名でも同じフォントがラスタライズされた証拠にはならない」まで自力で到達し、
  DevTools の Rendered Fonts / `document.fonts.check` / `getBoundingClientRect` による確認手順まで出した（アサーション 1・4 を一般知識で満たす）。
- 落ちた 2 項目はスキル固有の具体だった: `head.fontRevision` と `prep` 等のテーブルによる 2 軸の判定枠組み（アサーション 2）と、
  「同じ版でもヒンティング命令の有無で送り幅の丸めが変わる」（アサーション 3）。**baseline はむしろ逆の説明**をしており
  （「環境ノイズ（アンチエイリアス/ヒンティング/サブピクセル）→ 文字送りは変わらない」）、スキルが是正している差はここに出ている。
- アサーション 1・4 は次イテレーションで skill 固有の述語（切り分け結果ごとの分類・`viewer_environment` の確認・ノイズ基準値の定義との対比）へ寄せる余地がある。
  関連: `.kaizen/2026-07-23-eval-assertion-discrimination.md`（未適用）。
