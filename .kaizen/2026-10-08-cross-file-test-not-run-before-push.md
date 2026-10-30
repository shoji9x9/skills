---
date: 2026-10-08
type: hook
priority: high
confidence: high
status: pending
applied-to: []
session: claude-code
---

# テストファイルを変えたら、テストファイルを走査する横断のテストも実行する

## 事象

Issue #572 で `normalize-skill-eval-result.test.ts` に `mkdtempSync` を直に呼ぶテストを足した。
変えたテストファイル 2 つだけを実行して push し、CI の Unit tests が
`scripts/lib/testing/test-tmpdir.test.ts`（全テストファイルを走査して直呼びを落とす）で落ちた。
CI を 1 周失った。

再発（2026-10-15、Issue #614）: 応答の使わない語を確かめる Hook のテストで `mkdtempSync` を直に呼び、
ミューテーションテストの定義を 3 件足したのに `mutation-durations.json` に見積もりを足さなかった。
pre-commit はどちらも通った。commit の前に全件の vitest を流して初めて見つかった。
見つけたのは `scripts/lib/testing/test-tmpdir.test.ts` と `scripts/mutation/mutations-declaration.test.ts` で、どちらも他のファイルを走査する。
新しい `*.mutations.json` も、横断のテストの入力になるファイルである。

再発（2026-10-27、Issue #659・PR #792）: `fallow-boundaries.test.ts` を新しく足し、`spawnSync` の `timeout` を 60_000（テストの timeout の 30 秒以上）にした。
手元では `scripts/gates` のテストだけを実行して push し、CI の Unit tests が `scripts/lib/testing/child-timeout.test.ts`（全テストファイルの子プロセスの起動を走査する）で落ちた。
pre-commit は通り、CI を 1 周失った。

再発（2026-10-30、Issue #766・PR #832）: FIFO を作るテストで `execFileSync("mkfifo", …)` に `timeout` を付けずに push し、CI の Unit tests が `child-timeout.test.ts` で落ちた。
手元では変えた `run-skill-eval.test.ts` だけを実行していた。
直す途中で socket のテストに `mkdtempSync` を直に書き、この学びを読み直して `test-tmpdir.test.ts` を実行するまで気付かなかった。
こちらは push の前に見つけて直した。

## 根本原因

- なぜ落ちたか → リポジトリの規約（`makeTempDir` を使う）を知らずに直呼びした
  - なぜ手元で気付かなかったか → 「最小の範囲で検証する」に従い、変えたテストだけを実行した
    - なぜそれで足りないか → 他のファイルを入力にする横断のテストは、変えたファイルの名前からは選ばれず、
      pre-commit にも入っていない ← 根本原因（対策可能）

## 根拠

- 2026-10-08・2026-10-15: 上の 2 件。
- 2026-10-27: 同じ原因での 3 回目の再発（横断のテストが、変えたファイルの名前からは選ばれず、pre-commit にも入っていない）。

## 提案

他のファイルを入力にする横断のテストは、入力になるファイルが staged のときに pre-commit で実行する。

- lefthook の pre-commit に、`scripts/**/*.test.ts` が staged のとき
  `scripts/lib/testing/test-tmpdir.test.ts` を実行する job を足す（`lint-scope.test.ts` と同じ形）
- 同じ形の横断テスト（他のファイルを走査する `*.test.ts`）を列挙し、同じ扱いにするか決める
- 対象に `scripts/mutation/mutations-declaration.test.ts` も含める（`**/*.mutations.json` が staged のとき）
- 対象に `scripts/lib/testing/child-timeout.test.ts` も含める（`scripts/**/*.test.ts` が staged のとき）
