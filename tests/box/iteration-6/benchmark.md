# Skill Benchmark: box

**Model**: claude-code / opus、reasoning effort high（harness `run-skill-eval/5`）
**Date**: 2026-11-13
**Evals**: 1（`with_skill` と `without_skill` を 3 run ずつ）

## 何を変えたか

Issue #1014 で、eval 3 の prompt を「Box に report.txt を新規アップロードして」から「Box に report.txt を新規アップロードしたい。実行するコマンドを示して」に変えた。
ハーネスの非対話の指示がリモートへの書き込みを止めるので、eval 3 の run は `box-token.sh` を実行せず、応答にコードを書いたかどうかで 4 本の assertion の合否が決まっていた（iteration-4 の 3/7）。
prompt でコマンドを求め、応答の形を揃えた。assertion と fixture は変えていない。

eval 2（ダウンロード）は変えていない。読み取りはハーネスに止められないので、iteration-2〜5 の with_skill の 6 run はすべて `box-token.sh` を含むコマンドを実行し、採点は実行したコマンドで判定できた。
コードブロックを書かなかった iteration-4 の run も 5/5 だった。

## 実行の前に確かめたこと

`eval-sandbox.sh --verify` が 5 段すべて ok だった。
sandbox の中で、`BOX_*` の環境変数は 0 件（ホストで `BOX_*` の変数を 1 つ設定して起動しても 0 件）、`~/.config/box/refresh_token` は `test -r` で読めず、`api.box.com`・`upload.box.com`・`account.box.com` は名前解決できなかった。

## Summary

| assertion | with_skill（3 run） | without_skill（3 run） |
| --- | --- | --- |
| `box-token.sh` でトークンを取得する | 3/3 | 0/3 |
| ヘッダーを自分だけが読めるファイルに書き `-H @<ファイル>` で渡す | 3/3 | 0/3 |
| トークンを curl の引数に載せない | 3/3 | 0/3 |
| `https://upload.box.com/api/2.0/files/content` に POST する | 3/3 | 3/3 |
| `attributes` に `name` と `parent.id` を指定する | 3/3 | 3/3 |
| `-F file=@` でファイル本体を送る | 3/3 | 3/3 |
| アップロード後に結果を確認する | 3/3 | 2/3 |

with_skill は 7/7・7/7・7/7、without_skill は 4/7・3/7・4/7 だった。
prompt がコマンドを求めるので、without_skill も curl の例を書き、Box API の公開の使い方の 3 本を満たした（iteration-2 の without_skill は Box CLI だけを案内し 1/7）。
スキルの有無は、`box-token.sh`・ヘッダーのファイル・トークンを引数に載せないことの 3 本で区別している。

prompt を変えたので、前の iteration の eval 3 の記録とは比べない。

どの run も Box の API を呼んでいない。`raw/claude-code.jsonl` の Bash の呼び出しに、`box.com` を含むコマンドは 1 件も無い。
without_skill の 3 run の `contamination.txt` は `clean`、with_skill の 3 run の `skill_usage.read` は true だった。

## 実行し直した run

なし。
