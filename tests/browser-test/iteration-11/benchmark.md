# Skill Benchmark: browser-test

**Model**: claude-code / opus
**Date**: 2026-11-18
**Evals**: 2（`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

Issue #1073 で、設定に機能マップ（`features`）を足した。機能の呼び名で範囲を指定すると、機能マップの `path` と `checks` で確かめる。
それを確かめる eval 10（機能マップあり）と eval 11（機能マップなし）を新しく足した。2 つの fixture は同じアプリと環境の設定を持ち、違いは `features` の有無だけである。
他の eval の入力は変えていないので、実行していない。

## Summary

| eval | 入力の変更 | with_skill | without_skill |
| --- | --- | --- | --- |
| 10 | 新規 | 5/5 | 3/5 |
| 11 | 新規 | 5/5 | 3/5 |

新しく足した eval なので、比べる前回の記録は無い。1 run どうしなので、Delta の値は扱わず、差が残っているかだけを見る。

- 最初の 3 本（機能マップの `path` と `checks` を使う、機能マップが無いときはルーターの定義から導く、`features` を書かない）は、`without_skill` も満たした。
  `without_skill` も fixture の `browser-test.jsonc` を自分で読み、機能マップを使ったからである。この 3 本は後退の検出のためのもので、差は出ない。
- 差が出たのは後の 2 本である。`without_skill` は、どちらの eval でも起動コマンド `pnpm run dev` を自分で実行し、console の確認を観点に挙げなかった。
  `with_skill` は、起動コマンドを実行せずに促して止まり、ページを開いた直後の console の確認を、機能マップの `checks` と並べて挙げた。

## 実行し直した run

最初の 4 run は、最初の 3 本の assertion だけで実行した。4 run ともすべての assertion を満たし、差が出なかった。
そこで、差の出る 2 本を足し、最初の 4 run の出力を消して、同じ 4 run を実行し直した。この表はやり直した後の結果である。
