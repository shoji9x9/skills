---
date: 2026-10-24
type: hook
priority: high
confidence: high
status: applied
applied-to: [scripts/mutation/check-mutation-proof.ts, scripts/mutation/test-group-wrapper.ts, docs/tooling.md]
---

# ミューテーションテストのランナーが子の vitest にタイムアウトを付けず、無限ループになる変異で終わらない

## 事象

PR #775（#758）で element-shot.mjs のフレームを遡るループを関数に分けたところ、ループを抜ける条件が `walk.frameError` の代入だけになった。
変異 `unreadable`（代入を消す）を入れると、テストの中でループが終わらなくなる。
サブエージェントが自分で書いた変異のループ（timeout なし）が、この変異で 18:21 から 20:54 まで止まり、作業ツリーの element-shot.mjs を変異させたまま残した。
公式のランナー `scripts/mutation/check-mutation-proof.ts` も、子の vitest を `spawnSync` で timeout なしに起動するので、同じ変異で終わらない（CI の `Mutation proof (PR)` も止まる）。

## 根本原因

- なぜ止まったか → 変異でテストの中に同期の無限ループができ、vitest の testTimeout では止められない（同期の処理は割り込めない）
- なぜランナーが止めないか → `runTests` の `spawnSync` に `timeout` が無く、子が終わらない場合を状態として扱っていない
- なぜ想定されていないか → 変異の失敗の形を「赤くなる」「当たらない」「起動が止まる（Failed Suites）」の 3 つでしか挙げておらず、「終わらない」を挙げていない（`.agents/rules/state-space-and-mutation-proof.md`「両方の向きに誤る」）

## 根拠

- element-shot.mjs の変異 `unreadable` で、`pnpm exec vitest run .../element-shot.test.ts` が 2 時間半終わらなかった（`pgrep` で確認。PID 3111292）
- `check-mutation-proof.ts` の `spawnSync(command.file, [...], { cwd, encoding, stdio, env })` に `timeout` が無い（1090 行付近）
- 修正（`stepOutOfFrame` の戻り値でもループを抜ける）の後は、同じ定義が 24 proven / 0 failed で 17 秒で終わった

## 提案

`check-mutation-proof.ts` の `runTests` で子の vitest に `timeout`（変異を入れない実行の所要時間から決めた上限）を付け、時間切れを「確かめられない（ran: false、理由は時間切れ）」として扱い、FAIL にしてどの変異かを出す。

- 時間切れの後は作業ツリーの変異を必ず戻す（既存の後片付けの処理が時間切れでも通ることをテストで確かめる）
- 上限の決め方（固定値か、変異を入れない実行の何倍か）は、`scripts/mutation/mutation-durations.json` の実測から決める
- サブエージェントへの指示に「変異の検証は公式のランナーで行い、自作のループを書かない」を足す（今回の指示には無かった）
