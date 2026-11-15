# golden-dataset iteration-26

Issue #1052 で足した eval 23・24 の変更確認（各 config 1 run、claude-code / opus / medium）。

| eval | with_skill | without_skill |
| --- | --- | --- |
| 23（`new.stack` に言語が複数ある） | 4/4 | 2/4 |
| 24（`new.stack` が空で `--autonomous`） | 4/4 | 1/4 |

- 4 run とも contamination: clean・isolation: sandboxed。with_skill の 2 run はスキルを起動し、`references/seeding-tool.md` を読んだ
- eval 23 は baseline もバックエンドの言語として Java を選ぶ。差は記録のキー（`tool.language`）と SQL で書く選択に出た
- eval 24 は baseline も言語を推測で選ばない。差は保留の記録先（`pending-decisions.json`）・`metadata.json` を作らないこと・`new.stack` への追記に出た
