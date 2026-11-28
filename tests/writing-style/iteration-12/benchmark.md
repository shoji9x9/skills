# writing-style iteration-12

Issue #1126 の取り決め（`docs/skill-development.md`「改善に使うケースと判定に使うケース」）に沿って、判定に使うケースを実行した記録。

- 判定に使うケース: eval 2（PR のタイトルの読み直し）と eval 4（lint が読まないファイルの読み直し）。`evals.json` に `"split": "judge"` を書いた。
- 改善に使うケース: eval 1 と 3（`split` を書いていないので improve）。
- スキルの本文は変えていない。取り決めの流れを確かめるための実行なので、直す部品は無い。
- run の数: 判定に使う 2 件 × `with_skill`・`without_skill` × 1 run = 4 run。
- executor: claude-code、model は opus、reasoning effort は medium。CLI は 2.1.332（比べる記録は 2.1.303）。
- 4 run とも `isolation: sandboxed`。`without_skill` の `contamination.txt` は 2 run とも `clean`、`unexpected_read` は false。`with_skill` は 2 run ともスキルを読んだ（`read: true`）。

## 前回の記録との比較

| eval | configuration | 比べる記録 | 前回 | 今回 | token（前回 → 今回） |
| --- | --- | --- | --- | --- | --- |
| 2 | with_skill | iteration-10 | 2/2 | 2/2 | 68487 → 66526 |
| 2 | without_skill | なし（iteration-10 は with_skill だけ） | - | 0/2 | - → 64380 |
| 4 | with_skill | iteration-11 | 3/3 | 3/3 | 88891 → 119012 |
| 4 | without_skill | iteration-11 | 3/3 | 3/3 | 84820 → 90038 |

assertion ごとの合否は、`with_skill` で下がったものが無い。assertion の文は前回と同じである。

eval 4 の `with_skill` の token は、前回より 30121（約 34%）増えた。
スキルの本文を変えていないので、増えた理由はスキルの変更ではない。CLI のバージョンの違いか、run ごとのばらつきである。1 run どうしなので、どちらかは区別できない。
スキルを直した後に同じ増え方をしたときは、この記録を前回として比べるので、増えた分がスキルの変更によるものかを読み分けられない。区別するには eval 4 を 3 run 実行する（実行するかは依頼者が決める）。

eval 4 は `without_skill` も 3/3 で、スキルの有無で差が出ていない（前回も同じ）。判定に使うケースとしては、退行の検出には使えるが、スキルの効果は示さない。
