# Skill Benchmark: pr-review-handle

**Model**: claude-code / opus / high（harness `run-skill-eval`）
**Date**: 2026-11-10
**Evals**: 2（`with_skill` と `without_skill` を 3 run ずつ）

## 目的

Issue #918 の 4 の確認である。
eval 1・eval 2 は実在の PR を前提にした prompt で、sandbox では repo の確認で止まり、止まった後の手順を説明するかが run ごとに揺れていた（#901 の変更確認）。
prompt を、場面を書いて説明させる形に書き直し、結果が揺れないかを見るために 3 run ずつ実行した。

## 入力の変更

- eval 1: prompt に、作業ツリーが `shoji9x9/skills` の clone で PR の head ブランチにいること、スレッドが未解決 2 件・解決済み 1 件であることを書いた。assertion を説明させる形の文に直し、「実行はせず手順の提示に留めている」を足した
- eval 2: prompt に、設定ファイルが無いこと、未解決のスレッドが 1 件であること、レビューと関係の無い commit していない変更があることを書いた。「実行はせず手順の提示に留めている」を足した
- eval 2 の「conventional commits 規約で commit すると述べている」は、スキルの取り決めに合わない（スキルは規約を固定せず、`conventions_doc` か `AGENTS.md` などの文書から決める）。
  最初の実行で with_skill が 3 run とも fail し、without_skill だけが pass したので、「commit message の規約を、設定の conventions_doc か AGENTS.md などの文書から決め、見つからなければ利用者に確かめると述べている」に直して、eval 2 だけを実行し直した
- 2 つの eval に reachability を書き、`eval-reachability-backlog.json` から外した

## Summary

| eval | with_skill（run 1 / 2 / 3） | without_skill（run 1 / 2 / 3） |
| --- | --- | --- |
| 1 | 8/8・8/8・8/8 | 5/8・5/8・5/8 |
| 2 | 10/10・10/10・10/10 | 5/10・4/10・4/10 |

## 前回より下がったものと、その原因

- 比べない。prompt と assertion の文を変えたので、前回の記録（`tests/pr-review-handle/iteration-13`）とは assertion の文で対応づけられない

## 結果が揺れたか

- with_skill は、2 つの eval とも 3 run の合否が全項目で一致した。
- without_skill は、eval 2 の「commit --amend や force push を行わないと述べている」だけが揺れた（run 1 が pass、run 2・3 が fail）。

## 気付いたこと

- eval 1 の without_skill は、URL から owner・repo・番号を取り出す工程と、今の repo と PR の一致の確認を置かなかった。`--push` が無いのに、承認を得て commit と push まで進めると答えた。
- eval 2 の without_skill は、resolve をレビュアーに任せて返信だけにすると答えた。再レビューを利用者に 3 択で確かめず、`gh pr edit --add-reviewer` で依頼した。

## 実行し直した run

- eval 2 の 6 run。assertion を直したため。直す前の 6 run は集計に入れていない

## 集計から外したもの

- 無し
