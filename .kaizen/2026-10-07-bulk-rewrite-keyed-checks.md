---
date: 2026-10-07
type: doc
priority: high
status: pending
applied-to: []
session: claude-code
---

# 一括で書き換える前に、その内容を鍵にする他のチェックを列挙する

## 事象

Issue #567 で、evals.json の prompt と assertion の旧称（367 件）を Agent 5 本に分けて書き換えた。
書き換えた後で、Agent が `check-eval-reachability.ts` の失敗を報告した。
`eval-reachability-backlog.json` は免除を eval の指紋（prompt と assertions のハッシュ）で持つので、130 件の免除が外れていた。
指紋を更新するか reachability を書くかを、書き換えの途中で利用者に確認することになった。
eval の再実行の対象も、Issue の見積もり（24 件・約 50 か所）から 152 件に増えた。この見積もりは、チェックするツールを実行せずに出したものだった。

再発（2026-10-13・Issue #607）: `check-mutation-proof.test.ts` の「--shard 宣言をまたいだ通し番号で分け…」を置き換えて消した。
自分が書き換えた SHARD-* の `expect_failing` は直したが、同じテスト名を鍵に持つ別の変異（ONLY-SPAN）を grep しなかった。
ランナーが「expect_failing に実在しないテスト名がある」で exit 2 になり、全件の実行（約 7 分）を始め直した。

## 根本原因

- なぜ途中で判断が要ったか → 書き換える文字列（prompt・assertion）を、別のチェックが指紋として持っていた
- なぜ事前に分からなかったか → 書き換えの前に、対象のファイルを読むチェックを調べず、語のチェックだけを見ていた
- なぜ調べなかったか → 一括の書き換えを「意味を変えない言い換え」と捉え、内容のハッシュ・名前の参照・出現数（mutations の `find`・`expect_failing`）のような、文字列そのものを鍵にする仕組みを数えなかった
- 再発でなぜ見落としたか → 消したテストの名前を、自分が触った変異の中だけで探した。テスト名が宣言の外からも参照される鍵だと数えていなかった
- なぜ機械で止まらないか → `mutations-declaration.test.ts` は `find` の出現数は確かめるが、`expect_failing` の名前が実在するかは、ランナーの基準 run まで確かめない

## 提案

一括で書き換える前に、書き換える文字列を鍵や指紋として持つチェック（ハッシュ・名前の参照・`find` の出現数など）を grep で列挙し、影響する件数と扱い（追随するか、免除を更新するか）を先に決めてから着手する。

- 列挙のしかた: 対象のファイル名と、そのキー（`prompt`・`assertions`・テスト名）を `scripts/` 全体で grep する
- 件数の見積もりは、チェックするツールを実際に実行して出す（近似の grep で出さない）
- テストを消す・名前を変えるときは、その名前を `scripts/**/*.mutations.json` 全体で grep し、参照する変異をすべて直す
- 決定論的な対策の候補: `expect_failing` の名前が `test_file` に実在するかを、vitest の `--list` などで変異を当てずに確かめるチェックを、`mutations-declaration.test.ts` か pre-commit に足す
- 判断が利用者に要るもの（免除の更新は、チェックを緩める変更に当たる）は、着手前の確認にまとめる
