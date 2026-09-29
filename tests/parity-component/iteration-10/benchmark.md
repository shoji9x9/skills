# Skill Benchmark: parity-component

**Model**: claude-code / opus（CLI 2.1.284 (Claude Code)、harness `run-skill-eval/3`）
**Date**: 2026-09-30
**Evals**: 8・9（`with_skill` / `without_skill` 各 1 run。変更確認スコープなので Delta の数値は語らない）

## 何を変えたか

iteration-9 で弁別の余地が見えた eval 8・9 の入力を直した。

- 1 本に 2 つの主張を束ねていた assertion（eval 8 の 2 回採る／揺れにする、自動で閉じる時間の測り方／観測値にしない、
  eval 9 の `data-*`／先に確かめる、`catalog.stories`／`unbaselined_stories`）を 1 主張ずつに分けた
- スキル固有の判断の assertion を足した（eval 8: 探針のコピー元と `motion_probe_version` の記録、
  eval 9: `lifecycle.applies` / `reason` の記録、名指しできない経路を `not_applicable_paths` へ）
- eval 9 の fixture で、部品の採否（`components.md`）・`docs/ui-library.md`・`component-api.md` の実装方式を、
  新側が使う `@vendor/ui` に揃え、`.replace/dependencies.md` を足した（iteration-9 で `without_skill` がこの食い違いを主な論点にしていた）
- `SKILL.md` の capture 手順 5 と build 手順 4 の要約に、落ちていた点を 1 句ずつ足した

## Summary

| eval | with_skill | without_skill | 弁別した assertion 数 |
|---|---|---|---|
| 8 現行の動きを数えて時系列を採る計画を立てる | 10/11 | 3/11 | 7 |
| 9 一生の順番で壊れる経路を完了判定の前に拾う | 7/11 | 2/11 | 5 |

4 run とも `isolation.txt` は `sandboxed`、`without_skill` の `contamination.txt` は `clean`、`with_skill` はどちらも Skill ツールで `parity-component` を呼んでいる。

## 読み取れたこと

- **eval 8 は弁別が 5 本から 7 本に増えた。** `with_skill` が落としたのは「2 回の差を揺れとして許容差の根拠にする」だけで、
  2 回採ること・揺れが大きいときに採り直すこと（`unstable`）は書いている
- **eval 9 は `with_skill` が同じ点をまた落とした。** 「経路に入ったことを症状より先に確かめる」順序と `unbaselined_stories` は iteration-9 に続いて 2 回目、
  今回は `catalog.stories` と `not_applicable_paths` も落とした。応答は `lifecycle.md`「完了判定」の条件（全件合格・回数 1 以上・`fix_removal_verified`）を
  そのまま「必要なこと」として並べており、「見本」の節にだけ書いた条件が報告に出てこない。
  完了判定の条件そのものにこれらを入れた（`lifecycle.md`「完了判定」と `SKILL.md` 手順 8）。効き目は iteration-11 で測った
- `without_skill` は fixture を揃えたことで食い違いを論点にしなくなり、実装の不具合（`disabled` の反映・古い `onClick`・Enter の二重実行）の列挙に寄った。
  それでも一生の順番の経路としての整理・順番を強制する見本・記録先はどれも出ない
