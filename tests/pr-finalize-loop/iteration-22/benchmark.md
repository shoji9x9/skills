# Skill Benchmark: pr-finalize-loop

**Model**: opus（claude-code、reasoning effort high）
**Evals**: 21（Issue #901 で assertion を直した eval の変更確認。configuration ごとに 1 run）

## Summary

| eval | with_skill | without_skill |
|------|------------|---------------|
| 21（最後の反復でも規約の違反の指摘を直す） | 7/7 | 4/7 |

## assertion を直した理由

eval 21 の assertion「見送ってよい根拠を 3 つに限る」は、PR #895 で `SKILL.md` の直さない根拠が 4 つ（基準で人に回さないと決まり、推奨の案で見送ったもの）になった後も、3 つのままだった。
iteration-21 の with_skill は根拠を正しく 4 つと答え、古い assertion で fail になっていた。assertion を 4 つに直し、両方の configuration を実行し直した。

## 差が出た項目

without_skill は、スキルの定義を読めず、根拠の一覧を持たないので、根拠を 4 つに限ることと、指摘がそのどれにも当たらないことを述べなかった。
返信してから解決する手順も述べず、解決をレビュアーに任せるとした。
