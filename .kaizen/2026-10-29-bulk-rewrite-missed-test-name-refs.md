---
date: 2026-10-29
type: doc
priority: high
confidence: high
status: pending
applied-to: []
session: claude-code
---

# 一括の置き換えでテスト名を変え、そのテスト名を参照する expect_failing を合わせなかった

## 事象

issue-batch の run の #767 で、lint-prose が指した 710 か所の単独の `版` を、位置を指定して「バージョン」に置き換えた。
置き換えの前に確かめたのは、ミューテーションテストの定義の `find` の出現数と、eval の reachability だけだった。
テスト名（`test("...")` の文字列）も置き換えの対象に入っていたが、6 つの定義ファイルの `expect_failing` 16 件が古い名前のまま残った。
手元の vitest は緑で、ローカルレビューが見つけた。CI の `Mutation proof (PR)` は、実在しないテスト名で exit 2 になるところだった。

2026-11-20 に再発した（Issue #1095・PR #1098）。一括の置き換えではなく、指標を 1 つ足したのに合わせて、テスト名「3 つの指標を集める」を手で「4 つの指標を集める」に変えた。
`check-cost-metrics.mutations.json` の `expect_failing` が古い名前のまま残り、push した後の CI の `Mutation proof (PR)` が exit 2 で失敗した。
手元の vitest・pre-commit・`/code-review` のどれもこれを検出しなかった。

## 根本原因

- なぜ残ったか: 置き換えの対象を lint-prose の指摘から作り、その指摘がテスト名の文字列に当たることを、鍵を持つ側（`expect_failing`）から挙げ直さなかった。
- なぜ挙げ直さなかったか: `AGENTS.md`「編集」の一括の書き換えの規約は、内容のハッシュ・テスト名の参照・`find` の出現数の 3 つを挙げている。そのうち `find` だけを確かめ、規約の一覧と突き合わせなかった。
- なぜ手元で気付かなかったか: `mutations-declaration.test.ts` は定義の形を見るが、テスト名の実在は見ない。実在はランナーの実行でしか分からない。

## 根拠

2 回の観測（2026-10-29・2026-11-20）。どちらも、テスト名を変えて `expect_failing` を合わせなかったという同じ原因で起きたので、確信度を high にした。
1 回目は一括の置き換えで、規約の一覧のうち 1 つだけを確かめて終えた。2 回目は 1 件の名前を手で変えたもので、一括の書き換えを対象にした規約には当たらなかった。
KEDB 照合は「一括」「expect_failing」「テスト名」で行った。`docs/agent-workflow.md`「一括で書き換える前に、その文字列を鍵にする他のチェックを挙げる」が同じ事例（テストの名前を変えて別の定義の参照を見落とした）を持つ。

## 既存の規約

- 扱い: 埋もれている
- 場所: `AGENTS.md`「編集」の一括の書き換えの箇条（鍵にする他のチェックを grep で挙げる）。`docs/testing.md` の、消すテストの名前が `expect_failing` から参照されているときの箇条。`docs/agent-workflow.md` の同じ事例
- 照合した範囲: `AGENTS.md`「編集」、`.agents/rules/state-space-and-mutation-proof.md`、`docs/testing.md`、`docs/agent-workflow.md` を「テスト名」「expect_failing」で読んだ。
  `AGENTS.md` は一括の書き換えだけを、`docs/testing.md` はテストを消すときだけを対象にしており、1 件のテストの名前を変えるときを書いた規約は無い

## 食い違い

- 相手: なし
- 判断: なし

## 提案

テストの名前を変えるときも（一括でも 1 件でも）、変える前に古い名前で `*.mutations.json` の `expect_failing` を grep し、同じ変更で新しい名前に直す。

- 適用先の候補: `docs/testing.md` の「消すテストの名前が `*.mutations.json` の `expect_failing` から参照されているときは」の箇条を、「消す・名前を変える」に広げる。`AGENTS.md`「編集」の一括の書き換えの箇条にも、1 件の名前の変更が当たることを足す。
- 機構の候補（作るかは apply で決める）: pre-commit で、stage した `*.test.ts` の隣の `*.mutations.json` の `expect_failing` が、そのテストファイルに実在する名前かを確かめるチェック。
  効果は、2 回起きたこと。ただし、どちらも CI の `Mutation proof (PR)` が exit 2 で止めたので、merge される前に気付ける。失うのは push から CI の失敗までの 1 往復（数分）である。
  費用は、pre-commit でテストの一覧（`vitest list` など）を取る実行時間（対象のテストファイルごとに数秒）と、`test.each` で組み立てる名前を一覧と同じ形で扱う処理である。例外の一覧は要らない。
  文書を直した後で 3 回目が起きたら作る、という順序を推奨する。
