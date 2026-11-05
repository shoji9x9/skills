# Skill Benchmark: pr-review-handle

**Model**: claude-code / opus / high（harness `run-skill-eval`）
**Date**: 2026-11-05
**Evals**: 13（`with_skill` を 1 run ずつ）

## 目的

Issue #901 の受け入れ条件のうち、既存の eval の実行し直しである。
PR #895 で `references/review-response.md` を書き換えたので、既存の eval を with_skill で実行し、前の記録から下がったものが無いかを確かめた。

## 入力の変更

- 無し

## Summary

前回は、それより前の iteration のうち、その eval の with_skill の結果を含む最も新しい記録である。

| eval | 前回（iteration） | 今回 |
| --- | --- | --- |
| 1 | 4/7（7） | 3/7 |
| 2 | 3/9 ×3（3） | 2/9 |
| 3 | 2/4・1/4・2/4（3） | 4/4 |
| 4 | 2/2 ×3（3） | 3/3 |
| 5 | 2/4 ×3（3） | 4/4 |
| 6 | 記録無し | 4/5 |
| 7 | 5/5（9） | 5/5 |
| 8 | 3/3（9） | 3/3 |
| 9 | 3/3（7） | 3/3 |
| 10 | 4/4（8） | 4/4 |
| 11 | 3/3（5） | 3/3 |
| 12 | 6/6（11） | 6/6 |
| 13 | 4/4（12） | 4/4 |

## 前回より下がったものと、その原因

- eval 1 の「各指摘をコードに照らして妥当性を判断する方針を示している」が fail になった。
- eval 2 の「未解決スレッドへの返信・解決まで行う手順になっている」が fail になった。前回の 3 run はすべて pass していた。

どちらの eval も実在の PR を前提にする prompt で、sandbox は git リポジトリでなく `GH_TOKEN` も無効なので、run は手順 2 の repo の確認で止まる。
今回の run は止まった理由と再開の方法だけを答え、その後の手順を説明しなかった。前回の run は、この 2 本の assertion が求める手順まで説明して pass していた。
PR #895 は repo の確認より前の手順を変えていないので、止まる位置は前回と同じである。
eval 1 は 1 run どうしの比べ方なので、回帰かばらつきかを区別できない。eval 1 と eval 2 の 3 run の実行を、残りの作業に挙げる。
eval 2 の前回の記録は executor のモデルが claude-opus-4-8 で、今回と違う。

## 気付いたこと

- eval 3 と eval 5 は前回より上がった。前回の記録は claude-opus-4-8 の 3 run である。
- eval 4 は前回の後に assertion を 1 本足したので、足した 1 本は前回と比べていない。
- eval 6 は、前の iteration に with_skill の記録が無いので、比べていない。

## 実行し直した run

- eval 1 の with_skill。1 回目は executor の OAuth の認証の失敗（`Failed to authenticate`）で評価にならなかったので、同じ条件で実行し直した。

## 集計から外したもの

- 無し
