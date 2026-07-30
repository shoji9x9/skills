# Skill Benchmark: parity-suite

**Model**: claude-opus-5
**Date**: 2026-07-30T03:16:07Z
**Evals**: 16 (1 run each per configuration)

## Summary

| Metric | With Skill | Without Skill | Delta |
|--------|------------|---------------|-------|
| Pass Rate | 100% ± 0% | 0% ± 0% | +1.00 |
| Time | 77.3s ± 0.0s | 52.1s ± 0.0s | +25.2s |
| Tokens | 186772 ± 0 | 123408 ± 0 | +63364 |

## 対象と結果（Issue #159 ファイル入出力・ストレージ）

eval 16 は「未実行のアップロードを特性化済みにして gaps に書かない」「ドラッグ & ドロップも対象に入れる」という 2 つの逸脱要求への応答を見る。

- with_skill 4/4: 操作可能性と特性化済みの混同を拒否し未検証は `gaps.md` へ、D&D は対象外（`DataTransfer` 合成の脆さ）、アップロードは書き込みとして `data-discipline.md` の規律（一意プレフィックス＋後始末・hermetic でない旨の明示）に乗せる、を提示
- without_skill 0/4: 詐称は拒んだものの `gaps` ではなく独自の「assumptions」節を提案し、指示があれば gaps 非記載に従うとした。D&D は「対象に含める点は承知しました」と受け入れた（対象外の線引きがスキル由来であることの確証）

## ベースラインの read 汚染について

`without_skill` は `scripts/eval-sandbox.sh`（4 群遮断）経由・逐次で取得。事前 2 段検証と事後のマーカー grep（15 語）はいずれも 0 件で汚染なし。
経緯と手順は `tests/replace-strategy/iteration-10/benchmark.md` の同節を参照。
