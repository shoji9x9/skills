---
date: 2026-09-17
type: hook
priority: medium
status: applied
applied-to:
  [
    scripts/build-skill-eval-benchmark.js,
    scripts/build-skill-eval-benchmark.test.js,
    scripts/build-skill-eval-benchmark.mutations.json,
    docs/skill-development.md,
  ]
session: claude-code
---

# eval の集計を毎回手組みしたため、判定を位置で対応づけて件数を誤った

## 事象

新規 eval 4 本の採点で、判定を `[passed, evidence, …]` の配列で持つ構造にして集計したところ、
要素の意味（`passed` / `counted`）を混同し、`parity-diff` #27 の `without_skill` を 1/6 と 2/6 の両方で数えた。
自分で気づき、assertion テキストをキーにした形へ作り直した。

## 根本原因

- なぜ件数を誤ったか? → assertion と判定の対応づけが構造で保証されていなかった
  - なぜ保証されていなかったか? → `benchmark.json` を毎 iteration その場の書き捨てスクリプトで組み立てている
    （集計の正本が repo に無い。`docs/skill-development.md` は skill-creator 同梱の `aggregate_benchmark` を指すが未インストール）
    - なぜ文章規約で防げなかったか? → 「判定は位置でなく対象のテキストで対応づける」が
      `.agents/rules/eval-assertion-discrimination.md`「採点（grading）の規律」の文章にしか無く、決定論的に強制されていない ← 根本原因（対策可能）

## KEDB 照合

[[2026-09-03-pair-verdicts-to-assertion-text-not-index]]（**`status: applied`**）の再発。
applied なので追記せず恒久側を強化する。
[[2026-09-16-prose-rule-recurrence-needs-deterministic-gate]]（`status: pending`）が
「同じ規約の 2 度目の違反は文章の追記でなく決定論的なゲートへ上げる」と定めており、本件はその適用ケースに当たる。

横断スコープ: `benchmark.json` は全スキルの `tests/` にあり、同じ手組みが毎 iteration で起きる。
assertion の追加・削除・並べ替えのたびに再発しうる。同じ実行で、置き換わった記録（`tests/parity-diff/iteration-29/`）を
「assertion が現在の `evals.json` と合わないから」という理由で一度削除しかけた——
run 時点の正本が各 run の `eval_metadata.json` に在ることに気づいていなかったためで、これも同じ根本原因の別の現れ。

## 提案

eval の採点集計は書き捨てスクリプトで組み立てず、assertion テキストをキーにした入力だけを受理する repo のスクリプトで生成する。

- `scripts/build-skill-eval-benchmark.js` を新設する
- assertion テキストは各 run の `eval_metadata.json`（run 時点の正本）から取る——`evals.json` から取ると、
  後から assertion を変えたときに過去の記録のテキストがずれる
- 判定は assertion テキストをキーにしたマップで受け取り、位置配列を受理しない
- キー集合の不一致・件数の不一致で exit 2
- `scripts/build-skill-eval-benchmark.test.js` で境界を固定し、判定行を無効化する変異で赤くなることを実証する
- `docs/skill-development.md` の集計手順をこのスクリプトへ差し替える

別作業へ切り出した（Issue #421）。Issue #416 の apply では、本 PR の範囲外として pending のまま残していた。

## 適用（Issue #421）

`scripts/build-skill-eval-benchmark.js` を新設し、`docs/skill-development.md` の集計手順をそこへ差し替えた。
判定は assertion テキストをキーにして突き合わせ、位置配列・`text` の無い要素・キー集合の不一致・
`summary` と採点内訳の食い違いを exit 2 で落とす。テキストの正本は各 run の `eval_metadata.json`。
境界は `scripts/build-skill-eval-benchmark.test.js` で固定し、判定行を無効化する変異が狙ったテストを落とすことを
`scripts/check-mutation-proof.js` で実証した（変異の一覧と件数は `scripts/build-skill-eval-benchmark.mutations.json` が正本。
ここに件数を書くと、変異を足したときに記録だけが古くなる）。

既存の `tests/**/benchmark.json` 2 件（`tests/parity-diff/iteration-13` / `iteration-24`）を成果物から
再生成して内容が一致することを実測した。同じ実測で、`tests/issue-batch/iteration-5` の 1 run が
`eval_metadata.json` の 4 assertion に対し判定 3 件で 3/3（100%）と集計されていたことを検出した
（この集計器なら exit 2 で落ちる）。
