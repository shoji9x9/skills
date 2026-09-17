# Skill Benchmark: parity-diff

**Model**: claude-code / claude-opus-5（CLI 2.1.274 (Claude Code)）
**Date**: 2026-09-17
**Evals**: 26 のみ（`with_skill` / `without_skill` 各 1 run。変更確認スコープなので Delta の数値は語らない）

## 何を変えたか（Issue #384）

`triage.md` に「本経路の外で撮って比べるときは撮影条件を先に並べる」を新設した。
eval 26 は、利用者の指摘を受けて**別々の画面から**切り出した 2 枚の画素差を根拠に `parity-replace` へ差し戻す案を押し戻せるかを見る。

## Summary

| eval | with | without | 弁別した assertion |
|---|---|---|---|
| 26 本経路の外で撮った 2 枚 | **6/6** | 5/6 | 1（条件が揃うまで要対応として `diff.md` に書かない） |

2 run とも `isolation.txt` は `sandboxed`、`without_skill` の `contamination.txt` は `clean`。

## 読み取れたこと

- **弁別は 1 件だけ**。`without_skill` も CSS のクランプ規則と「別画面から撮った 2 枚は比較にならない」に自力で到達し、
  差し戻さない結論まで同じだった。**この eval は主に後退検知**として扱う（Delta を主張する材料ではない）
- 差が出たのは成果物側だけ——`with_skill` は「条件不一致で無効化された観測」として**差分報告の前で止め**、
  未検出の扱いを `parity-suite` へ戻す 3 分岐に整理した。`without_skill` は改善提案として別建てに出す案を示し、`diff.md` の扱いには触れなかった
- 初版（iteration-27）の assertion は「両側の矩形を並べて出す」「`child_inline_styles` を読む」を要求しており、
  **本経路で撮り直すという正しい答えが不合格になる**形だった。前者は撮り直しでも通る形へ、後者は削除して parity-suite eval 37 側へ移した
