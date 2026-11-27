---
date: 2026-11-27
type: doc
priority: medium
confidence: medium
status: pending
applied-to: []
session: claude-code
---

# lint を通すために Playwright の雛形を書き換えたら、Playwright で一度読み込んで確かめる

## 事象

Issue #1155 で、`parity-diff` の新側の採取の雛形（`capture-new.spec.template.ts`）を、使い捨てのプロジェクトで Playwright から実行した。
雛形は、ファイルを読み込む時点で失敗した。`test.beforeEach` の第 1 引数を、分割代入でない `_fixtures` にしていたからである。
この形は d7ca8ac63 で、oxlint の no-empty-pattern を避けるために `({}, testInfo)` から書き換えたものだった。commit message には「挙動は変えない」とあり、雛形はそれ以来どのテストも実行できない状態だった。
雛形を直してから受け入れ条件を確かめ直す手戻りが起きた。

## 根本原因

- なぜ読み込めなかったか: Playwright は、フィクスチャを受け取る引数が分割代入であることを、読み込みの時点で検査する。
- なぜ書き換えたときに気付かなかったか: lint の指摘を直した後、oxlint と tsc が通ることだけを確かめ、雛形を Playwright で読み込まなかった。
- なぜ CI でも気付かなかったか: 雛形は利用者のプロジェクトへコピーして使うので、このリポジトリのテストとカバレッジは雛形を実行しない（`docs/tooling.md` の fallow の節）。lint と型の検査は、Playwright が実行時にだけ行う検査を持たない。

## 根拠

確信度は medium である。1 回の観測だが、lint の指摘を直した commit が原因だと git の履歴（`git log -S`）で絞れた。
使い捨てのプロジェクトで雛形を `playwright test` で実行し、読み込みの時点のエラーを観測した。`assertCaptureProject` に変えた後は、同じ実行が通った。
KEDB 照合は「雛形・template.ts」で `2026-11-09-new-file-sibling-registrations.md` に当たったが、これはファイルを足すときの登録の抜けで、原因が違う。「Playwright・雛形・読み込」では一致が無かった。

## 既存の規約

- 扱い: なし
- 場所: なし
- 照合した範囲: `AGENTS.md`・`docs/`・`.agents/rules/`・`skills/parity-diff/references/` を「雛形を実行」「playwright test --list」「template.ts」で検索した。
  `docs/tooling.md` が、雛形はユニットテストで実行できないのでベースラインに載せると書いているだけで、書き換えた後に実行して確かめる規約は無かった

## 食い違い

- 相手: なし
- 判断: なし

## 提案

lint や型の検査を通すために Playwright の雛形（`skills/*/assets/*.template.ts`）を書き換えたら、push の前に、使い捨てのプロジェクトで `playwright test --list` を実行し、雛形を読み込めることを確かめる。

- 適用先の候補: `docs/tooling.md` の、雛形を「ブラウザか e2e の実行の中でだけ動く関数」として挙げる箇条の隣。
- 機構（雛形を `--list` で読み込むテスト）は作らない。効果は 1 件の観測だけで、費用は雛形ごとに import 先の偽物と metadata を用意する手間になるので、見合わない。同じ種類の誤りが再発したら作るかを決め直す。
