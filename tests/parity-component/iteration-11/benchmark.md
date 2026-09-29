# Skill Benchmark: parity-component

**Model**: claude-code / opus（CLI 2.1.284 (Claude Code)、harness `run-skill-eval/3`）
**Date**: 2026-09-30
**Evals**: 9 の `with_skill` 1 run のみ

## 何を変えたか

iteration-10 で eval 9 の `with_skill` が 2 回続けて落とした点（経路に入ったことを症状より先に確かめる順序、順番の見本を `unbaselined_stories` に数えない）を、
`references/lifecycle.md`「完了判定」と `SKILL.md` 手順 8 の完了条件に入れた。eval の入力（prompt・fixture・assertion）は iteration-10 と同じなので、
スキルを変えた効き目だけを測るため `with_skill` だけを取った（`without_skill` はスキルを読まないので iteration-10 の 2/11 がそのまま比較相手になる）。

## Summary

| eval | with_skill | without_skill（iteration-10） |
|---|---|---|
| 9 一生の順番で壊れる経路を完了判定の前に拾う | 11/11 | 2/11 |

`isolation.txt` は `sandboxed`、Skill ツールで `parity-component` を呼んでいる。

## 読み取れたこと

- 完了条件に入れた 2 点（症状より先に入ったことを確かめる、`catalog.stories` にも `unbaselined_stories` にも入れない）が、どちらも「残っている工程」に出た
- `prop-identity` を「名指しできなければ `not_applicable_paths[]` に理由付きで残す」とも書いた
- 1 run なので、ばらつきは測っていない
