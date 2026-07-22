---
date: 2026-07-22
type: skill
priority: medium
status: applied
session: claude-code
---

# `gh issue view --comments` はコメント専用ビューで body を出さない（0 件だと空出力）

## 事象

issue-start Step 3 の手順どおり `gh issue view 112 --repo shoji9x9/skills --comments` を実行したが、
0 バイト（exit 0）で何も表示されず body を確認できなかった。`--comments` を外して再実行してようやく
title / body を取得できた。

## 根本原因

`gh issue view --comments` は body を出さず**コメントのみ**を表示する専用ビュー。対象 Issue #112 は
コメント 0 件だったため出力が 0 バイトになった。gh 2.93.0 で再現（コメント有りの #94 では
`--comments` = コメントのみ 11163B / 無指定 = title + body 22236B）。issue-start Step 3 は
「`--comments` で title / body に加えコメントも確認する」と記述しており、`--comments` が body を
出さない（＝別ビュー）ことを誤認していた。

## 提案

`gh issue view` は title/body とコメントを別ビューで扱い 1 コマンドで両取得できないため、両方が要るときは
2 コールするか `--json` で一括取得する（コメント 0 件の `--comments` は空出力になり得ることを許容する）。

`skills/issue-start/SKILL.md` の Step 3 を次のいずれかに修正する:

- (a) title/body は `gh issue view <n> --repo <owner>/<repo>`、コメントは別途
  `gh issue view <n> --repo <owner>/<repo> --comments` の 2 コール（0 件なら後者は空を許容）。
- (b) `gh issue view <n> --repo <owner>/<repo> --json title,body,comments --jq ...` で一括取得。

横断スコープ: `--comments` を使う配布スキルは issue-start のみ（`grep -rn 'view .*--comments' skills/`
で確認済み。pr-review-handle 等は未使用）。編集は配布スキルのソース `skills/issue-start/` に対して行い、
`scripts/reinstall-skill.sh issue-start` で installed copy を同期する（[[2026-06-10-skill-edit-reinstall-rule]]）。

## 適用

2026-07-22、`skills/issue-start/SKILL.md` の Step 3 を (a) 2 コール / (b) `--json` 一括の案内へ修正し、
installed copy を同期した（Issue #116）。
