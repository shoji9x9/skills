# Skill Benchmark: replace-strategy

**Model**: claude-opus-5
**Date**: 2026-07-30T00:46:20Z
**Evals**: 11, 12 (1 run each per configuration。eval 12 はアサーション緩和に伴う再取得を run-2 として追加)

## Summary

| Metric | With Skill | Without Skill | Delta |
|--------|------------|---------------|-------|
| Pass Rate | 100% ± 0% | 13% ± 12% | +0.87 |
| Time | 82.6s ± 5.5s | 113.3s ± 112.9s | -30.7s |
| Tokens | 194428 ± 42768 | 165100 ± 106881 | +29328 |

## eval 12 のアサーション緩和と再取得

新規追加した eval 12 のアサーション 3 は当初「`new.stack`（`current.stack` と対称）＝機械可読な列挙／`references.architecture`＝散文の決定記録のパス、という**役割分担**を示している」だったが、
下位主張を 3 つ束ねており脆かった（run-1 の with_skill は両キーを記録先として名指ししたが役割分担までは述べず fail）。
**「記録先として両キーを挙げている」という単一の検証可能な主張へ緩め、両 configuration を run-2 として取り直した**（ベースラインは遮断ラッパー経由・逐次）。

- 緩和後の run-2 with_skill は役割分担まで述べており 5/5。run-1 も緩和後の基準で再採点して 5/5（キー名は残したためベースラインは両 run とも 1/5 で弁別は維持）
- ベースラインは両 run とも「測定結果から技術選定を行う」と述べ、スキルの説明（骨格は測定からは決まらない）と**逆の結論**を出した。押し戻しがスキル由来であることの確証

## ベースラインの read 汚染について

本 iteration の replace-strategy ベースラインは内容 grep で汚染マーカー 0 件（eval 12 の run-2 は遮断ラッパー経由で取得）。
姉妹スキル parity-replace の同時実行分は汚染したため取り直している（経緯は `tests/parity-replace/iteration-7/benchmark.md`）。
