# Skill Benchmark: spec-parity

**Model**: claude-code / opus / high
**Date**: 2026-11-12
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 目的

Issue #1003 で、収束の判定（`convergence-check.mjs`）が操作中のエラーの許容を承認の記録（`approvals` の `kind: runtime_errors`）と照合するようにした。
新しい eval 10（fixture `verify-carried-allowance`）を、変更確認として 1 run ずつ実行した。

## Summary

| eval | 入力の変更 | with_skill | without_skill |
| --- | --- | --- | --- |
| 10 | 新規 | 5/5 | 3/5 |

どちらの run も `isolation.txt` は `sandboxed` で、`without_skill` の汚染の判定は `clean` だった。新しい eval なので、比べる前の記録は無い。

## 観察

- with_skill は `convergence-check.mjs --write` の exit 1 で判定し、前のバージョンの許容を今のバージョンで承認し直すかを利用者に聞いた。`parity-replace` へは戻さなかった。
- without_skill は `convergence-check.mjs` を実行できなかった。承認の記録の `tree` が今のバージョンと違うことには気付いた。
  根拠は、`requires_skills` で置いた `replace-strategy` の `references/scope.md` の一覧の行である。そのため、2 つ目の assertion は区別しない。
- without_skill は差し戻しを推奨し、承認し直すことは選択肢の 1 つとして挙げただけだった。3 つ目の assertion は fail と採点した。
