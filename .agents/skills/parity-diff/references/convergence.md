# 収束判定と parity-replace への差し戻し

## 収束の定義

**収束＝未説明差分ゼロ かつ 未修正回帰ゼロ**（全差分が系統差／宣言済み例外に分類済み）。**生の差分ゼロは求めない**（実装・ライブラリが違えば正当な差は残る）。

- **差分器が判定する。** [`../scripts/diff-normalize.mjs`](../scripts/diff-normalize.mjs) の機械分類と `diff.md` の分類集計で判定し、**モデルの主観（「もう同じに見えます」）を根拠にしない**
- 収束の条件:
  - `diff-normalize.mjs` の出力に `unexplained` / `deviates_T` / `pending_review` が無い
  - [`triage.md`](triage.md) の「許容」がすべてユーザー承認済みで記録先（`component_diffs` / `component_diff_exceptions` / `intentional_diffs`）へ非破壊追記済み
  - 未検証領域（下記）が `diff.md` に「未検証」として残されている（確認済みにしていない）

## 差し戻し

- **要対応が 1 件以上** → `.replace/parity/<slug>/diff.md` を差し戻し入力として `parity-replace` へ渡す。該当ページ・分類・根拠が読める形にする（想定フェーズ＝実装／新側マッピング／テーマ を示す）。**修正は行わない**
- 反復回数の記録・上限管理は `parity-replace` が `replace-metadata.json` の `loop.*` で行う。`loop.iterations >= loop.max_iterations`（既定 5）なら、本スキルは**新たな差し戻しをせず停止してユーザーへ上げる**（頭から作り直さない。上限管理の正本は `parity-replace` の `references/diff-loop.md`）

## 収束したとき

- `diff-metadata.json` の `converged: true` にする。条件は「未説明差分ゼロ・未修正回帰ゼロ」かつ「『許容』例外の確定（ユーザー承認）がすべて済んでいる」こと
- `results`（total / actionable / accepted / noise / unexplained / unverified）を記録する

## 対象外・未検証の明示

- **アニメーションのパリティは扱えない**（停止させて比較するため）。`diff.md` に対象外として残す
- **ベースラインに写らない箇所**は「未検証」として `diff.md` に残す（確認済みにしない）
- **宣言できない構造差**（`gaps.md` の該当節・フォーカスリング形状・内部 DOM・余白の配り方等）は正規化対象外＝未検証として `diff.md` に転記する
