# Skill Benchmark: parity-diff

**Model**: claude-code / opus / 指定なし（直近の iteration-42 に合わせた）（harness `run-skill-eval/5`）
**Date**: 2026-11-12
**Evals**: 3（`with_skill` を 1 run ずつ）

## 目的

新側のバージョンの照合を、`new.commit` から `.replace/` を除いたソースのツリーのハッシュ（`new.tree`）に変えた（Issue #998）。
eval 4・12・30 の fixture（`green-only-local-dev`・`legacy-exceptions-key`・`style-free`）の `replace-metadata.json` に `new.tree` を足し、前提の確認の手順（`references/preflight.md`）を変えたので、変更確認として `with_skill` で 1 run ずつ実行した。

## Summary

| eval | 入力の変更 | with_skill | 前回の with_skill |
| --- | --- | --- | --- |
| 4 | fixture | 4/4 | 前回（iteration-39）と同じ |
| 12 | fixture | 5/6 | 前回（iteration-40）pass の assertion 1 件が fail |
| 30 | fixture | 4/5 | 前回（iteration-42）pass の assertion 1 件が fail |

すべての run で `isolation.txt` は `sandboxed` だった。

## 観察

- eval 12 は、移行手順の原本（`replace-strategy` の `project-config.md`「移行」）に触れなかった。この eval が見る `SKILL.md` と `preflight.md` の節は今回変えていない。
- eval 30 は、`spec-parity verify` の案内に `--target local-dev` を書かなかった。スキルの案内の文面も `--target` を書いていないので、前回の pass はモデルが足したものと見られる。
- どちらも 1 run どうしの比較で、回帰かばらつきかは区別できない。両 eval の 3 run の実行を残りの作業に挙げる。
