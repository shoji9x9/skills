# golden-dataset iteration-29

PR #1053 の 3 回目のレビューを受けて、eval 24 の assertion 4 と eval 26 の assertion 2 から「既存の値を消さずに」を外した後の変更確認（各 config 1 run、claude-code / opus / medium）。
`new.stack` が空の状況では消す既存の値が無く、この部分は何も測っていなかった。

| eval | with_skill | without_skill |
| --- | --- | --- |
| 24 | 4/4 | 2/4 |
| 26 | 4/4 | 2/4 |

- 4 run とも isolation: sandboxed、without_skill の 2 run は contamination: clean。with_skill の 2 run はスキルを読んだ
- 結果は iteration-28 と同じで、外した部分は差に関わっていなかった
