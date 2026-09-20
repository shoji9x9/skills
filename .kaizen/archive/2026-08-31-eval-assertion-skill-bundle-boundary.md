---
date: 2026-08-31
type: rule
priority: medium
status: applied
applied-to: [.agents/rules/eval-assertion-discrimination.md]
session: claude-code
---

# eval の assertion は、そのスキルのバンドル内にある知識だけを要求する

## 事象

Issue #265 で `parity-replace` に eval 14 を新設し、assertion に
「各コマンドが全体走査かをフック設定だけでなくスクリプト側の引数の扱いまで読んで確かめるよう述べている」
を置いた。実走でこの 1 本だけが不合格になり、assertion を書き換えた（run・採点分を捨てた）。

## 根本原因

- なぜ不合格か? → 要求した知識は `replace-strategy` の `references/project-config.md`「走る範囲」にあり、
  `parity-replace` の run からは読めない
  - なぜ? → `with_skill` は対象スキルの成果物だけを被験体へコピーする
    （`docs/skill-development.md`「被験体へコピーするのは `SKILL.md`、`references/`、`assets/`、`scripts/` など
    実行に必要な成果物だけ」）
    - なぜ気付かなかった? → doc-altitude に従って正本を姉妹スキル側に置いた（正しい判断）が、
      その altitude 判断が eval の到達性を決めることを結びつけなかった
      - なぜ? → `.agents/rules/eval-assertion-discrimination.md` の「到達」は外部依存（現行アプリ・実 DB・
        外部サービス）と prompt の要求形しか挙げておらず、**同リポ内の skill バンドル境界**という
        到達不能が無い ← 根本原因（対策可能）

横断スコープ: 全 `evals.json` を走査した。姉妹スキル名を含む assertion は 50 件超あるが、いずれも
「委譲先として案内する」「正本のパスを示す」型で自スキルの `SKILL.md` が持つ知識
（例: `parity-diff` #12「移行手順の正本が `replace-strategy` の `references/project-config.md` だと示している」）。
姉妹の `references` の**中身**を要求していたのは今回の 1 件だけで、修正済み。

KEDB: [[2026-08-12-eval-prompt-change-breaks-assertion-reachability]]（applied）は同じ rule の同じ節だが、
機構が違う（prompt 編集・prompt の要求形 vs バンドル境界）。applied のため追記せず恒久側を強化する。

## 提案

assertion は、そのスキルのバンドル（`SKILL.md` / `references/` / `assets/` / `scripts/`）内にある知識だけを要求する。
姉妹スキルの `references` に正本がある契約は、「その中身を述べるか」ではなく「正本を示して委ねるか」で検査する。

`.agents/rules/eval-assertion-discrimination.md` の「到達」に追記する:

- **到達不能はリポジトリの外だけにあるのではない。** `with_skill` は対象スキルの成果物だけを被験体へコピーするため、
  姉妹スキルの `references` の中身は run から読めない。doc-altitude に従って正本を姉妹スキル側へ置いた契約は、
  自スキルの `SKILL.md` に残るのが「正本のパスと委ねる判断」だけなので、**assertion もその粒度で書く**
  （「正本を示して委ねているか」を検査し、「正本の中身を述べているか」を検査しない）。
