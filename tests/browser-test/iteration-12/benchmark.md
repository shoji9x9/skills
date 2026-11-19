# Skill Benchmark: browser-test

**Model**: claude-code / opus
**Date**: 2026-11-18
**Evals**: 3（`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

PR #1080 の Copilot のレビューを受けて、機能マップの eval を作り直した。

- 2 つの fixture（`feature-map`・`no-feature-map`）で、`/settings` もサイドバーの検索の部品を import するようにした。`setup.sh` が、その部品の変更を commit していない差分として残す。
- eval 10（機能の呼び名で指定する `--scope custom`）は、fixture の変更で入力が変わった。
- eval 11 は、`--scope custom` で機能マップの無い呼び名から推測させる形をやめ、`--scope uncommitted` で差分からルーターの定義でページを導く形に作り直した。
- eval 12 を新しく足した。機能マップがある設定で `--scope uncommitted` を指定し、差分のファイルが `sources` に当たる機能の `checks` を足すかを見る。
- 他の eval の入力は変えていないので、実行していない。

## Summary

| eval | 入力の変更 | with_skill | without_skill |
| --- | --- | --- | --- |
| 10 | fixture | 5/5 | 3/5 |
| 11 | 作り直し | 5/5 | 3/5 |
| 12 | 新規 | 4/4 | 3/4 |

eval 10 の比べる記録は iteration-11 で、with_skill 5/5・without_skill 3/5 から変わっていない。eval 11 は作り直したので、iteration-11 の記録とは比べない。1 run どうしなので、Delta の値は扱わず、差が残っているかだけを見る。

- 機能マップの `path`・`checks`・`sources` を使う assertion は、`without_skill` も満たした。fixture の `browser-test.jsonc` を自分で読むからである。後退の検出のためのもので、差は出ない。
- 差が出たのは、起動コマンドを自分で実行しない、ページを開いた直後の console の確認を挙げる、の 2 本である。
  `without_skill` は、eval 10 と 11 で `pnpm run dev` を自分で実行した。eval 12 では実行しなかった（raw の tool_use で確かめた）ので、この 1 本は満たした。
  console の確認は、3 つの eval のどれでも `without_skill` が挙げなかった。

## 実行し直した run

eval 12 の最初の 2 run には、「`sources` を持たない機能（設定の通知の切り替え）の `checks` を挙げない」という assertion があった。
`with_skill` は、同じページの回帰の確認としてその機能の `checks` も挙げ、この assertion を満たさなかった。
`SKILL.md` は、`sources` に当たらない機能の `checks` を挙げることを禁じていないので、この assertion には仕様の根拠が無い。assertion を消し、eval 12 の 2 run を実行し直した。この表はやり直した後の結果である。
