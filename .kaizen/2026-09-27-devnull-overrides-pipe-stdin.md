---
date: 2026-09-27
type: doc
priority: low
status: pending
applied-to: []
session: claude-code
---

# stdin を入力に使う呼び出しへ </dev/null を付けてパイプを上書きした

## 事象

table-upsert.mjs の `--from -` へパイプで断片を渡すプローブに `</dev/null` も付けた。
後置のリダイレクトがパイプの stdin を置き換え、「断片を読めない: -（Unexpected end of JSON input）」rc=2。

## 根本原因

- なぜそうなったか → stdin を /dev/null にする癖を、stdin が本来の入力である呼び出しにも当てた
- なぜそうなったか → AGENTS.md の 2 箇所が「stdin も読む CLI には `</dev/null`」とだけ書き、
  stdin を入力に使う（`-` / パイプ / heredoc）場合の除外が無い
- なぜそうなったか → 規約が無限待機（stdin を使わない CLI）の事例だけから作られ、反対側を当てていない

## 提案

stdin を閉じる規約は「stdin を入力として使わない呼び出し」に限り、`-` やパイプ・heredoc で入力を渡す呼び出しには `</dev/null` を付けない（後置のリダイレクトがパイプを上書きする）。

- AGENTS.md の該当 2 箇所（切り離す子プロセス / 非対話の CLI）に除外を 1 句足す
