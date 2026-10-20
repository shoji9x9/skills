---
date: 2026-10-21
type: doc
priority: medium
confidence: high
status: pending
applied-to: []
session: claude-code
---

# eval の新しい iteration の番号を、ディレクトリの一覧の文字列順の末尾から決めて、既にある iteration に結果を書いた

## 事象

issue-batch の run の Issue #725 で、eval 29 の結果を置く iteration を決めるために `ls tests/issue-batch/ | tail -3` を実行し、末尾の `iteration-9` を最新と読んだ。
文字列順では `iteration-9` が `iteration-23` より後に並ぶので、実際の最新は `iteration-23` だった。
そのため、#623 の結果が入った `iteration-10` の下に `eval-29` を書いた。
集計のスクリプトが「`benchmark.json` が既にある」で止まったので気づき、`iteration-24` に移して集計し直した。

## 根本原因

- なぜ既にある iteration に書いたか → 最新の番号を、文字列順の一覧の末尾から読んだ
- なぜ文字列順で読んだか → 番号の決め方が手順に書かれておらず、一覧の末尾を最新とみなす読み方を確かめずに使った
- なぜ起動の前に気づかなかったか → 出力先の iteration が無いことを、起動の前に確かめる手順が無い。集計のスクリプトの上書きの防止で、起動の後に初めて気づいた

## 根拠

番号を文字列順で読んだことと、出力先が既にあったことを、同じ作業の中で一覧と集計のエラーで確かめたので、確信度は高い。
KEDB 照合では、iteration の番号の決め方を扱う既存の学びは見つからなかった（`.kaizen/` を `iteration` と `tail`・文字列順で検索して 0 件）。

## 提案

eval の新しい iteration の番号は、`tests/<name>/` の `iteration-N` の N を数値として比べた最大値に 1 を足して決め、起動の前に出力先のディレクトリが無いことを確かめる。

`ls | tail` のような文字列順の末尾から決めない。
`benchmark.json` が無いことだけでは足りない。集計の前の iteration や、別の worktree で実行中の iteration は `eval-*` だけを持つ（`eval-*` は git の対象外なので、別の worktree のものは見えない）。
`docs/skill-development.md` の実走の手順に、番号の決め方と、出力先のディレクトリが無いことの確かめを書く。
`scripts/eval/run-skill-eval.sh` が、出力先の run のディレクトリが既にあるときに止まるかを確かめ、止まらなければ止めるようにするかも検討する。
