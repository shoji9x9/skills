---
date: 2026-07-22
type: skill
priority: medium
status: applied
session: claude-code
---

# 非 TTY では `gh issue view --comments` が body を出さずコメントのみ（0 件だと空出力）

## 事象

issue-start Step 3 の手順どおり `gh issue view 112 --repo shoji9x9/skills --comments` を（エージェント経由＝
非 TTY で）実行したが、0 バイト（exit 0）で何も表示されず body を確認できなかった。`--comments` を外して
再実行してようやく title / body を取得できた。

## 根本原因

**非 TTY（パイプ／エージェント経由）では** `gh issue view --comments` が body を出さず**コメントのみ**を
出力する（TTY では body も表示される）。対象 Issue #112 はコメント 0 件だったため非 TTY 出力が 0 バイトに
なった。gh 2.93.0 で実測 ―― 非 TTY: コメント有りの #94 は `--comments` = コメントのみ 11163B /
無指定 = title + body 22236B、#112 = 0B。TTY（`script` で pty 割当）: #112 の `--comments` でも body を
表示し 33362B。issue-start Step 3 は「`--comments` で title / body に加えコメントも確認する」と記述して
おり、非 TTY で `--comments` が body を出さないことを誤認していた。

## 提案

非 TTY では既定表示・`--comments` で title/body とコメントを同時に得られないため、エージェント実行では
`--json title,body,comments` で **1 コマンド一括取得**する（推奨）か、既定表示（body）と `--comments`
（0 件なら空を許容）の 2 コールで確実に両方を得る。

`skills/issue-start/SKILL.md` の Step 3 を次のいずれかに修正する:

- (a) title/body は `gh issue view <n> --repo <owner>/<repo>`、コメントは別途
  `gh issue view <n> --repo <owner>/<repo> --comments` の 2 コール（0 件なら後者は空を許容）。
- (b) `gh issue view <n> --repo <owner>/<repo> --json title,body,comments --jq ...` で一括取得。

横断スコープ: `--comments` を使う配布スキルは issue-start のみ（`grep -rn 'view .*--comments' skills/`
で確認済み。pr-review-handle 等は未使用）。編集は配布スキルのソース `skills/issue-start/` に対して行い、
`scripts/reinstall-skill.sh issue-start` で installed copy を同期する（[[2026-06-10-skill-edit-reinstall-rule]]）。

## 適用

2026-07-22、`skills/issue-start/SKILL.md` の Step 3 を非 TTY 前提の明示＋`--json` 一括取得（推奨）／
2 コールの案内へ修正し、installed copy を同期した（Issue #116 / PR #117）。PR #117 の Copilot レビューで
「非 TTY 前提を明示」「`--json` は 1 コマンドで両取得できるため『1 コマンド不可』は矛盾」の 2 点を反映した。
