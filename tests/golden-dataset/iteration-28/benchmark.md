# golden-dataset iteration-28

PR #1053 の 2 回目のレビューを受けて、eval 23〜26 の prompt に問いを足した後の変更確認（各 config 1 run、claude-code / opus / medium）。
足した問いは、assertion が求める内容（SQL を代わりに使うとき・保留の記録先・設定と記録の更新・使い続ける理由）を引き出すためのもので、答えは書いていない。

| eval | with_skill | without_skill |
| --- | --- | --- |
| 23 | 4/4 | 2/4 |
| 24 | 4/4 | 2/4 |
| 25 | 3/3 | 3/3 |
| 26 | 4/4 | 2/4 |

- 8 run とも isolation: sandboxed、without_skill の 4 run は contamination: clean。with_skill の 4 run はスキルを読んだ
- eval 25 は差が出ない。言語の選択の手順 1 が外れたことを検知する後退の検知の eval として残す
