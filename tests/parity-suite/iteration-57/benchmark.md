# Skill Benchmark: parity-suite

**Model**: claude-code / opus / high（harness `run-skill-eval/5`）
**Date**: 2026-11-12
**Evals**: 1（`with_skill` を 3 run）

## 目的

Issue #995 の受け入れ条件で、eval 42 の 2 つの assertion を `with_skill` の 3 run で確かめた。回帰かばらつきかを決めるためで、`without_skill` は実行していない。

- 「突き合わせの証拠を起点・当たり判定・完了の 3 点に分けると答え、3 点が揃うまで突き合わせ済みにしないと述べている」は、PR #1001 の変更確認（iteration-56）の 1 run で fail した
- 「ケースの文面（エクスポート・列のソート）には出てこない欠落であることに触れ、ケース一覧の網羅では拾えないと説明している」は、iteration-50 と iteration-56 の 1 run で fail した

このスキルの今回の変更（`artifact-health-check.mjs` の `new.dirty` の判定と、`runtime-errors.mjs compare --tree`）は、eval 42 が読む `references/coverage.md` を変えていない。

## Summary

| 対象の assertion | 3 run の結果 | 判定 |
| --- | --- | --- |
| 3 点が揃うまで突き合わせ済みにしない | 2/3（run-1 が「揃うまで」を述べない） | ばらつき。根拠の `references/coverage.md` の文は変えておらず、3 run のうち 2 run が満たした |
| ケースの文面に出てこない欠落 | 1/3（run-2・run-3 が触れない） | 回帰ではない（iteration-50 から fail が続き、今回 1 run が満たした）。満たす run が少ないので、案内の文面が弱い可能性がある |

| with_skill（run-1・run-2・run-3） |
| --- |
| 6/7・5/7・6/7 |

すべての run で `skill_usage.read` は true、`invalid_run` は false だった。

## 観察

- run-2 は、新側の突き合わせを書く工程が `parity-replace` だと示さなかった。ほかの 2 run は示した。
- 「ケースの文面に出てこない欠落」は、3 run とも、ベンダーの試験仕様書の粒度の不足（プロファイルで列ごとに展開する）には触れた。
  ケースの文面に現れない欠落（下位を持つ項目でメニューが閉じるなど）を名指ししたのは run-1 だけだった。
