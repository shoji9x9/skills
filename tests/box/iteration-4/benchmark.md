# Skill Benchmark: box

**Model**: claude-code / opus、reasoning effort high（harness `run-skill-eval/5`）
**Date**: 2026-11-13
**Evals**: 2（`with_skill` を 1 run ずつ）

## 何を変えたか

PR #1012 のレビューへの対応で、`SKILL.md` の次の例を直した。iteration-3 は直す前のバージョンで実行している。

- ダウンロード: `curl` が失敗したら、空の一時ファイルを読まずに止まる（`|| exit 1`）。
- アップロード: パスと Box に置くファイル名を単引用符で変数に入れ、`attributes` の JSON を `jq` で組み立てる。`-F` のパスを二重引用符で囲む。
- 認証: 呼び出しごとにシェルが終わる環境では、認証の例と API の呼び出しを 1 つの呼び出しにまとめ、並列に実行しない。

eval の入力（prompt・fixture・assertion）は変えていない。

## 実行の前に確かめたこと

iteration-3 と同じく、eval の sandbox の中で次のことを確かめた。`BOX_*` の環境変数は 0 件で、`~/.config/box/refresh_token` は `test -r` で読めず、Box のホストは名前解決できない。

## Summary

| eval | 入力の変更 | with_skill | 前回の with_skill |
| --- | --- | --- | --- |
| 2 | なし | 5/5 | iteration-3（5/5） |
| 3 | なし | 3/7 | iteration-3（7/7） |

eval 3 で、iteration-3 が満たして今回満たさなかった assertion は 4 本である。

- `box-token.sh` でアクセストークンを取得しようとしている
- Authorization ヘッダーを自分だけが読めるファイル（mktemp など）に書き、curl に -H @<ファイル> で渡している
- attributes に name と parent.id を指定している
- -F file=@ でファイル本体を送っている

今回の run は、`report.txt` と認証情報が無いことを確かめた後、実行のコマンドを示さずに手順を文章で書いて終えた。`box-token.sh` も実行していない。
iteration-3 の run は、同じ状況で実行のコマンドを示していた。
1 run どうしの比較なので、下がったのが直した例によるのか、run ごとのばらつきなのかは区別できない。eval 3 の 3 run の実行を残りの作業に挙げる。

`raw/claude-code.jsonl` で、`box.com` に向けた `curl` を含む呼び出しは eval 2 の 1 件だけである。その呼び出しは `box-token.sh` が exit 1 で止まり、`curl` まで進んでいない。eval 3 には 1 件も無い。

## 実行し直した run

なし。
