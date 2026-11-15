# Skill Benchmark: pr-finalize-loop

**Model**: claude-code / opus / high（harness `run-skill-eval`）
**Date**: 2026-11-15
**Evals**: 1（`with_skill` と `without_skill` を 3 run ずつ）

## 目的

Issue #1033 で、push せずに返信だけをした反復で再レビューを依頼するかを選ぶ設定 `rereview_after_reply` と引数 `--rereview-after-reply` を足した。
新しく足した eval 30（fixture `rereview-after-reply-false`）で、`false` のときの止まり方を測る benchmark である。

## Summary

| config | run-1 | run-2 | run-3 |
|------|------|------|------|
| with_skill | 8/8 | 8/8 | 8/8 |
| without_skill | 4/8 | 4/8 | 4/8 |

without_skill は 3 run とも、設定のファイルを読んで「依頼しない」とし、止まった理由を「完了」とした。
差が出たのは次の 4 本で、without_skill は 3 run ともすべて fail した。

- 止まった理由を「返信済み・再レビューなしで終了」として報告する
- 読まれていない返信として discussion_r101 の URL を載せる
- 読まれていない返信として discussion_r102 の URL を載せる
- 今の HEAD にレビューが付いていなければ、「返信済み・再レビューなしで終了」では止まらないと述べる

without_skill は 2 件の URL を「この反復での対応」として載せたが、レビュアーが読んでいない返信としては扱わなかった。
依頼しない・設定を根拠に挙げる・HEAD が未レビューなら依頼する・説明に留める、の 4 本は without_skill も pass した。

新しく足した eval なので、比べる前の記録は無い。

## 実行し直した run

無し。

## 集計から外したもの

無し。すべての run は `sandboxed` で、`invalid_run` は無い。without_skill の汚染の判定はすべて `clean` である。
