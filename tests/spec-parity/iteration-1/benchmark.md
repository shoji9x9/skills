# Skill Benchmark: spec-parity

**Model**: claude-code / opus / 指定なし（`parity-diff` の直近の iteration-41 に合わせた）（harness `run-skill-eval/5`）
**Date**: 2026-11-11
**Evals**: 9（`with_skill` だけを 1 run ずつ）

## 目的

Issue #565（`style_policy: free` と `spec-parity` の追加）で新しく足した eval の変更確認である。`with_skill` だけを 1 run 実行し、`without_skill` と既存の eval は実行していない。新しく足した eval なので、比べる記録は無い。

## Summary

| eval | 入力の変更 | with_skill | 前回の with_skill |
| --- | --- | --- | --- |
| 1 | 新規 | 4/4 | - |
| 2 | 新規 | 6/6 | - |
| 3 | 新規 | 2/2 | - |
| 4 | 新規 | 3/3 | - |
| 5 | 新規 | 3/3 | - |
| 6 | 新規 | 3/3 | - |
| 7 | 新規 | 3/3 | - |
| 8 | 新規 | 7/7 | - |
| 9 | 新規 | 6/6 | - |

すべての run で、`skill_usage.read` は true、`invalid_run` は false で、`isolation.txt` は `sandboxed` だった。

## 実行し直した run

eval 6 と 9 の最初の run は、実行の途中で executor の認証が失効し（`authentication_failed`・`OAuth token revoked`）、評価として成り立たなかった。
同じ条件で実行し直した run を採点した。最初の run は集計に含めていない。

その後、eval 6 と 9 の assertion を書き換えた（`parity-replace` が `style_policy: free` の画面のある機能で止まることを踏まえ、`parity-replace` へそのまま渡さないことを見る形にした）。
書き換える前の run は fingerprint が合わないので残さず、書き換えた後に実行した run に差し替えた。

差し替えの run のうち、eval 9 の最初の run は `verify.md` を書かずに止まった（6 件中 5 件を満たした）。
`spec-parity` は、`parity-diff` の `references/preflight.md` を読めないときは確かめたことにせず止まると定めている。eval 9 の `requires_skills` に `parity-diff` が無く、run はこの規定どおりに止まっていた。
スキルではなく eval の前提の不足なので、`requires_skills` に `parity-diff` を足して実行し直した。最初の run は集計に含めていない。
eval 8 も `verify` の前提で同じ `references/preflight.md` を読むので、`requires_skills` に `parity-diff` を足した。
入力（fingerprint）が変わったので、eval 8 の `with_skill` だけを同じ条件で実行し直し、その run に差し替えた（7 件中 7 件を満たした）。前の run は集計に含めていない。
実行し直した run は、`parity-diff` の `references/preflight.md` の「データセットバージョンの三者整合」を読んでから収束を判定した。

## 観察

- eval 1〜7 は、`requires_skills` を持たないので、前提スキル（`replace-strategy` など）が入っていない環境で実行される。どの run も、それを足りない前提の 1 つに挙げたうえで、eval が狙う前提の欠けも挙げた。
- eval 4〜7 の fixture は `package.json` に e2e を書くが、`node_modules` は無い。どの run も e2e の段で先に止まらず、足りない前提を依存の順にすべて挙げた。
