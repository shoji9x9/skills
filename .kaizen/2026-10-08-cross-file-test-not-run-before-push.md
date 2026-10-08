---
date: 2026-10-08
type: hook
priority: medium
status: pending
applied-to: []
session: claude-code
---

# テストファイルを変えたら、テストファイルを走査する横断のテストも実行する

## 事象

Issue #572 で `normalize-skill-eval-result.test.js` に `mkdtempSync` を直に呼ぶテストを足した。
変えたテストファイル 2 つだけを実行して push し、CI の Unit tests が
`scripts/lib/test-tmpdir.test.js`（全テストファイルを走査して直呼びを落とす）で落ちた。
CI を 1 周失った。

## 根本原因

- なぜ落ちたか → リポジトリの規約（`makeTempDir` を使う）を知らずに直呼びした
  - なぜ手元で気付かなかったか → 「最小の範囲で検証する」に従い、変えたテストだけを実行した
    - なぜそれで足りないか → 他のファイルを入力にする横断のテストは、変えたファイルの名前からは選ばれず、
      pre-commit にも入っていない ← 根本原因（対策可能）

## 提案

他のファイルを入力にする横断のテストは、入力になるファイルが staged のときに pre-commit で実行する。

- lefthook の pre-commit に、`scripts/**/*.test.js` が staged のとき
  `scripts/lib/test-tmpdir.test.js` を実行する job を足す（`lint-scope.test.js` と同じ形）
- 同じ形の横断テスト（他のファイルを走査する `*.test.js`）を列挙し、同じ扱いにするか決める
