# Skill Benchmark: pr-finalize-loop

**Model**: claude-code / opus / high（harness `run-skill-eval`）
**Date**: 2026-11-05
**Evals**: 21（`with_skill` と `without_skill` を 1 run ずつ）

## 目的

Issue #901 で eval 21 の assertion を直したので、変更確認として両方の configuration を実行した。

## 入力の変更

eval 21 の assertion「見送ってよい根拠を 3 つに限る」を、「事実と違う・範囲の外・人の判断が要る・基準で人に回さないと決まって推奨の案で見送った、の 4 つに限る」に直した。
PR #895 で `SKILL.md` の直さない根拠が 4 つになった後も、assertion が 3 つのままだった。
prompt は変えていない。assertion の文が違うので、iteration-21 以前の eval 21 の結果とは、この 1 本を比べない。

## Summary

| eval | with_skill | without_skill |
|------|------------|---------------|
| 21（最後の反復でも規約の違反の指摘を直す） | 7/7 | 4/7 |

## 前回より下がったものと、その原因

無し。iteration-21 の with_skill は、根拠を正しく 4 つと答えたのに、古い assertion で fail になっていた。直した assertion では pass する。

## 気付いたこと

without_skill は、スキルの定義を読めず、根拠の一覧を持たないので、根拠を 4 つに限ることと、指摘がそのどれにも当たらないことを述べなかった。
返信してから解決する手順も述べず、解決をレビュアーに任せるとした。

## 実行し直した run

無し。

## 集計から外したもの

無し。
