# golden-dataset iteration-27

PR #1053 のレビューで足した eval 25・26 の変更確認（各 config 1 run、claude-code / opus / medium）。

| eval | with_skill | without_skill |
| --- | --- | --- |
| 25（`tool.language` が記録済みで `new.stack` が変わった） | 3/3 | 2/3 |
| 26（`new.stack` が空で対話） | 4/4 | 0/4 |

- 4 run とも contamination: clean・isolation: sandboxed。with_skill の 2 run はスキルを読んだ
- eval 25 は baseline も記録済みの言語を使い続ける。差は使い続ける理由（同じデータを作り直せることを確かめ直す必要）に出た
- eval 26 は baseline が新側の言語を避けて SQL を勧め、`new.stack` への追記も `tool.language` への記録も述べない
