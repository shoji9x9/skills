---
date: 2026-10-06
type: rule
priority: high
status: pending
session: claude-code
---

# ミューテーションテストの検出の期待に、実リポジトリを読むテストを入れない

## 事象

文書の書き換えで、実リポジトリを読むテストが変異を検出しなくなり、ミューテーションテストが 2 回失敗した。

- 段階 ③: `check-time-sensitive-prose` の MC-ONE。`docs/tooling.md` の「1 変異 = …」の表記がなくなった（CI で検出）。
- 段階 ④-b: `check-doc-refs` の DR-SEC-ANCHOR と DR-NORM-QUOTE。『』で書いた節名の参照と、節名の不一致がなくなった（push の前に手元で検出）。

- 段階 ⑤-c: `check-doc-refs` の DS-PENDING-MATCH、`check-kaizen-refs` の KR-WRAP-JOIN、`check-time-sensitive-prose` の MC-DIRS-WIDE と TS-SLASH の 4 件。
  コメントの書き換えで、実リポジトリを読むテストが変異を検出しなくなった（push の前に手元で検出）。
  4 件とも合成した入力のテストは検出していたので、実リポジトリを読むテストを `expect_failing` から外した。
  ほかに約 40 件の定義が同じ種類のテストを `expect_failing` に持っている。今は通っているが、次の文書の変更で同じように失敗しうる。

どの回も `expect_failing` に「陰性: 実リポジトリ…」のテストが入っていた。

## 根本原因

- 誤った理由: 実リポジトリのテストが変異を検出するかは、その時点の文書の中身で決まる。
- 期待に入った理由: 定義を作ったときに、変異で落ちたテストをすべて `expect_failing` に書いた。
- その理由: 実リポジトリを読むテストが合成した入力のテストと違い、文書の変更で結果が変わることを、定義の書き方の規約が区別していない。

## 提案

文書を読むチェックのミューテーションテストでは、合成した入力のテストで検出を示し、実リポジトリを読むテストは `expect_failing` に入れない。

- 仕組みにするなら、ランナー（`scripts/mutation/check-mutation-proof.js`）が「実リポジトリ」を名前に持つテストを `expect_failing` の照合から外す（期待にあっても無くても、落ちても通っても数えない）。
- 段階 ④-c と ⑤ でも文書を書き換えるので、同じ失敗が続く見込みである。
- 3 回再発したので、規約ではなく、ランナー側の仕組み（1 つ目の箇条）で止める。
