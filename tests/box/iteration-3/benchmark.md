# Skill Benchmark: box

**Model**: claude-code / opus、reasoning effort high（harness `run-skill-eval/5`）
**Date**: 2026-11-13
**Evals**: 2（`with_skill` を 1 run ずつ）

## 何を変えたか

Issue #1005 で、`SKILL.md` のダウンロード先を `mktemp` で作り、`trap` で認証のファイルと一緒に消す例にした。
アップロードの例は、固定のパス（`/tmp/report.txt`）と Box でのファイル名をプレースホルダにした。
eval の入力（prompt・fixture・assertion）は変えていない。エージェントが読む文書を変えたので、ダウンロードとアップロードの eval 2・3 を `with_skill` で実行した。

## 実行の前に確かめたこと

eval と同じ sandbox（`scripts/eval/sandbox/eval-sandbox.sh`）の中で、次のことを確かめた。

- `BOX_*` の環境変数は 0 件である。
- `~/.config/box/refresh_token` は `test -r` で読めない。ホストでは読める。
- `api.box.com`・`upload.box.com`・`account.box.com`・`dl.boxcloud.com` は名前解決できない。`curl https://api.box.com/2.0/users/me` は rc=6 で終わる。
- 名前解決そのものが動いていることは、`api.anthropic.com` が解決できることで確かめた。

## Summary

| eval | 入力の変更 | with_skill | 前回の with_skill |
| --- | --- | --- | --- |
| 2 | なし | 5/5 | iteration-2（5/5） |
| 3 | なし | 7/7 | iteration-2（7/7） |

文が同じ assertion で、前回満たして今回満たさなかったものは無い。
前回の記録は reasoning effort を指定していない run で、今回は high を指定した。

どちらの run も、認証情報が無いので Box の API を呼んでいない。採点は、run が示したコマンドで行った。
`raw/claude-code.jsonl` の tool_use は各 3 件で、`box.com` に向けた `curl` は 1 件も無い。eval 2 の run は `box-token.sh` を実行し、`BOX_CLIENT_ID` が無いので exit 1 で止まった。
eval 2 の run が示したダウンロードのコマンドは、`BOX_DOWNLOAD="$(mktemp)"` と、両方のファイルを消す `trap` を使っていた。

## 実行し直した run

なし。
