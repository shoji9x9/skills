---
date: 2026-09-17
type: rule
priority: high
status: applied
applied-to: [.agents/rules/state-space-and-mutation-proof.md]
session: claude-code
---

# 新設するゲートの状態空間には、正本が明示的に求める「通常運用の更新」を入れる

## 事象

Issue #382 / #278 / #310 で決定論的ゲートを 2 本新設した（`artifact-health-check.mjs` /
`append-only-check.mjs`）。判定行は変異実証つきで、陽性コントロール（落とすべき入力）も
39 本のテストで押さえて green にし、PR #398 として出した。

2 人のレビュアー（ローカル `/code-review` と codex）が、**正本が明示的に求める通常運用の更新を
違反として落とす**誤検出を 5 クラス見つけた。どれもテストに 1 件も無かった。

- `dataset_version: null` ＋ `dataset_version_exempt` は「投入対象でない target」の正規の記録
  （`parity-diff` の `references/preflight.md`）なのに無条件で finding
- 追記専用の突き合わせを「行の多重集合」で行ったため、テンプレートが明示的に求めるその場の更新が
  全部「失われた行」に化けた——データセットの版の +1、状態列 `未`→`済`、Issue 列 `未起票`→番号、
  `assets.md` の `有効`→`取り消し済み`、各台帳の `- 最終更新:`、空配列への最初の追記
- データセット版の完全一致要求が、`golden-dataset` の `references/versioning.md`
  「交差が無ければ数値が古くても有効」と矛盾
- `artifact_health.declared: false`（`api-resource` の免除）を旧成果物と同一視し、
  書き込み系こそ要る 2 回実行ゲートが丸ごと外れた（こちらは逆向きの fail-open）

修正には `unit`（突き合わせ単位）の新設と一覧の作り直しが要り、レビュー 2 往復ぶんの手戻りになった。

## 根本原因

1. なぜ通常運用の更新が落ちたか → テストが**違反側だけ**で、正規操作側の陰性コントロールが無かった。
2. なぜ陰性コントロールが無かったか → 状態空間を「このゲートが捕まえたい失敗」から列挙し、
   **「このゲートが通さねばならない正規操作」からは列挙しなかった**。
3. なぜその向きが漏れたか → 正規操作の定義は**ゲートの実装ではなく、守る対象の正本**
   （テンプレートの `_note`・`references/*.md`）にあり、実装時に読むのは「何を落とすか」の側だけで済んでしまう。
   既存規律 `.agents/rules/state-space-and-mutation-proof.md` は検出器の取りこぼし（fail-open）と
   緩和経路の列挙を求めているが、**fail-closed 側の誤検出＝正規操作の阻害**を状態空間へ入れる要求が無い ← 根本原因

`.kaizen/2026-09-08-quoted-separator-must-not-trigger-command-gate.md`（status: applied）の再発。
あちらは 1 本のゲートの誤検知だったが、同じ向きの欠落が別のスキル群で 5 クラス同時に出た。
`.kaizen/2026-09-08-overdetection-fix-is-itself-a-relaxation.md`（pending）は「誤検知を直すと
緩和経路が増える」側の規律で、本件はその手前——**誤検知をそもそも設計時に列挙する**側にあたる。

## 横断スコープ

同じ形（正本が別ファイルにあり、ゲートは違反側だけを見て書かれる）は他の同梱スクリプトにもありうる。
`skills/*/scripts/` の判定系（`coverage-check.mjs` / `pending-triage-check.mjs` /
`reaction-check.mjs` / `auto-wait-check.mjs` / `dimension-fit.mjs` 等）を同じ観点で棚卸しする価値がある。

## 提案

`.agents/rules/state-space-and-mutation-proof.md` の「1. 状態空間に入れるもの」へ次の 2 項目を足す（`paths` は `scripts/**` / `skills/*/scripts/**` / `skills/*/evals/**` で既に絞れている）。

> - **fail-closed なゲートを新設・変更したら、「落とす入力」と同じ数だけ「通さねばならない入力」を列挙する。**
>   正規操作の定義はゲートの実装側ではなく**守る対象の正本**（テンプレートの説明・`references/` の規約）にあり、
>   実装中に読むのは違反側だけで済んでしまう。**正本を開いて「この成果物に対して正規に行われる更新」を書き出し、
>   その 1 つ 1 つを陰性コントロール（exit 0 を期待するテスト）にしてから green を根拠にする。**
>   在りがちなのは、版番号の +1・状態列やフラグのその場の更新・空集合への最初の追記・
>   免除や `null` を正規値とする記録・後方互換のための欠落。
>   陽性コントロールだけのゲートは「常に落とす実装」と区別が付かないのと同様に、
>   **陰性コントロールの無いゲートは「通常運用を止める実装」と区別が付かない**。
> - **突き合わせの粒度は、守る対象ごとに正本から決める。** 1 つの粒度（行・要素・ファイル全体）を
>   全対象へ当てると、その粒度で正規に変わる対象が誤検出になる。粒度を機械可読な一覧に持たせ、
>   語彙外は fail-closed にする。
