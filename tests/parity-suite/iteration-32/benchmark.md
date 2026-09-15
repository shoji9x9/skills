# Skill Benchmark: parity-suite

**Model**: claude-code / claude-opus-5（CLI 2.1.270 (Claude Code)）
**Date**: 2026-09-15
**Evals**: 34 のみ（`with_skill` / `without_skill` 各 1 run。変更確認スコープなので Delta の数値は語らない）

## 何を変えたか（Issue #351）

操作の被覆の単位を「操作 → 反応」にし、反応の被覆表 `reactions.json` と照合スクリプト `reaction-check.mjs` を新設した。
eval 34 は、押した直後と時間を置いた再観測を根拠に「トーストは無い」とし、反応が無い操作を書かずに完了とする案を押し戻せるかを見る。

## Summary

| eval | with | without | 弁別した assertion |
|---|---|---|---|
| 34 操作の反応 | **6/6** | 3/6 | 3（全フレームでの出現待ち・消える時間の複数標本と assertion 化・設定の呼び出し一覧での突き合わせ） |

2 run とも `isolation.txt` は `sandboxed`、`without_skill` の `contamination.txt` は `clean`。

## 読み取れたこと

- `without_skill` も「見つからない＝無いではない」「何も起きない操作も観測窓付きで記録する」には自力で到達した（assertion 1・4 は後退検知）
- `without_skill` は document 全体の監視までは述べたが iframe を含む全フレームには触れず、表示時間は記録するだけで assertion にしなかった。ソースの grep は挙げたが設定で宣言した一覧を使う形ではなかった
