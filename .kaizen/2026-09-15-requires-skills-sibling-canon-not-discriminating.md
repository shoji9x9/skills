---
date: 2026-09-15
type: rule
priority: medium
status: pending
applied-to: []
session: claude-code
---

# requires_skills で両 config に設置した姉妹スキルの正本は弁別材料にならない

## 事象

parity-diff eval 24 に `requires_skills: ["replace-strategy"]` を宣言し、正本 `autonomy.md` の中身（原因単位の保留・承認を省かない・収束させない・終わりにまとめて聞く）を assertion にした。
iteration-25 で without_skill も正本を読んで 4/5 に到達し、弁別したのは parity-diff 固有の 1 本だけで、1 iteration を捨てて絞り直した（iteration-26 で 4/4 vs 0/4）。

## 根本原因

- なぜ弁別しなかった? baseline も `requires_skills` で設置された replace-strategy の `autonomy.md` を読めた
- なぜそれを assertion にした? 到達性を確保するため正本を読める状態にし、正本の中身をそのまま検査項目にした
- なぜ気づかなかった? `eval-assertion-discrimination.md` の「到達」は「姉妹スキルの references は run から読めない」前提のままで、`requires_skills` 導入後は姉妹の正本が両 config で読める＝弁別に使えない、が書かれていない

## 提案

requires_skills で姉妹スキルを設置する eval は、姉妹の正本だけで答えられる内容を assertion にせず、対象スキル側にだけ書かれた判断を検査する。

- `.agents/rules/eval-assertion-discrimination.md` の「弁別」「到達」に、`requires_skills` で設置した姉妹スキルは without_skill にも入るため、その正本の中身は弁別材料にならない旨を追記する
- 横断: `requires_skills` を宣言している既存 eval を grep し、姉妹の正本の中身だけを検査する assertion が無いか確認する
