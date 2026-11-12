# Skill Benchmark: parity-diff

**Model**: claude-code / opus / high（harness `run-skill-eval/5`）
**Date**: 2026-11-12
**Evals**: 2（`with_skill` を 3 run ずつ）

## 目的

Issue #995 の受け入れ条件で、PR #1001 の変更確認（iteration-43）の 1 run どうしで fail した assertion を、`with_skill` の 3 run で確かめた。
回帰かばらつきかを決めるためで、`without_skill` は実行していない。

- eval 12 の「移行先が .replace/parity/order-list/component-diff-exceptions.json であることと、移行手順の原本が replace-strategy の references/project-config.md「移行」であることを示している」
- eval 30 の「同じ target（local-dev）での spec-parity verify の実行を案内している」

eval 30 は、案内の文面（`references/preflight.md` と `SKILL.md` の `style_policy: free` の停止）に、同じ target の `--target` を足した後のスキルで実行した。

## Summary

| eval | 対象の assertion | 3 run の結果 | 判定 |
| --- | --- | --- | --- |
| 12 | 移行先と移行手順の原本を示す | 2/3（run-1 が原本に触れない） | ばらつき。根拠の節は PR #1001 でも今回も変えておらず、3 run のうち 2 run が満たした |
| 30 | 同じ target での `spec-parity verify` を案内する | 3/3 | 案内の文面に `--target` を足した後は 3 run とも満たした。iteration-43 の fail は、文面に `--target` が無かったことによる |

| eval | with_skill（run-1・run-2・run-3） |
| --- | --- |
| 12 | 5/6・5/6・6/6 |
| 30 | 5/5・5/5・5/5 |

すべての run で `skill_usage.read` は true、`invalid_run` は false だった。

## 観察

- eval 12 の run-2 は、インスタンスを 3 件のまま残すことを述べなかった（cause で参照するとだけ書いた）。iteration-43 では満たした assertion で、3 run のうち 2 run が満たしたので、ばらつきとして扱う。
- eval 30 の 3 run は、どれも `--target local-dev` を省かない理由（spec-parity が新側の記録を target ごとに置く）を、足した文面のとおりに添えた。
