# Skill Benchmark: box

**Model**: claude-code / opus、reasoning effort high（harness `run-skill-eval/5`）
**Date**: 2026-11-14
**Evals**: 2（`with_skill` を 3 run ずつ）

## 何を変えたか

PR #1012 のレビューへの対応で、`SKILL.md` のアップロードと新しいバージョンのアップロードの例を作り直した。
ファイルはシェルのリダイレクトで stdin から送り、名前は `attributes` に `jq` で組み立てて `--form-string` で送る。新しいバージョンは、今の状態を取得してから `If-Match` を付けて送る。
レビューが収束した HEAD（711f5a1ba）で実行した。eval の入力（prompt・fixture・assertion）は変えていない。

利用者が 2026-11-14 に、iteration-4 の eval 3 の低下（7/7 から 3/7）を確かめるため、3 run を実行すると決めた。
3 run の前の検討では、低下は SKILL.md の文と結びつかず、run が応答にコードを書くかどうかのばらつきと判断した（PR のコメント <https://github.com/shoji9x9/skills/pull/1012#issuecomment-6845278998>）。

## 実行の前に確かめたこと

eval の sandbox の中で、`BOX_*` の環境変数は 0 件、`~/.config/box/refresh_token` は `test -r` で読めず、Box のホストは名前解決できないことを確かめた。

## Summary

| eval | 入力の変更 | with_skill（3 run） | 前回の with_skill |
| --- | --- | --- | --- |
| 2 | なし | 5/5・5/5・5/5 | iteration-4（5/5） |
| 3 | なし | 7/7・7/7・7/7 | iteration-4（3/7） |

assertion ごとに、3 run のすべてが満たした。iteration-4 の eval 3 で満たさなかった 4 本（`box-token.sh`・ヘッダーのファイル・`attributes`・`-F file=@`）も、3 run とも満たした。
3 run とも、応答に実行のコマンドを示した。iteration-4 の 1 run がコマンドを示さなかったのは、run ごとのばらつきだったと考える。

どの run も認証情報が無いので Box の API を呼んでいない。`raw/claude-code.jsonl` に、`box.com` に向けた `curl` を含む呼び出しは 1 件も無い。

## 実行し直した run

なし。
