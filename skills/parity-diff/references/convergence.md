# 収束判定と差し戻し（parity-replace / issue-create）

## 収束の定義

**収束＝未説明差分ゼロ かつ 未修正回帰ゼロ**（全差分が系統差／宣言済み例外に分類済み）。**生の差分ゼロは求めない**（実装・ライブラリが違えば正当な差は残る）。

- **差分器が判定する。** [`../scripts/diff-normalize.mjs`](../scripts/diff-normalize.mjs) の機械分類と `diff.md` の分類集計で判定し、**モデルの主観（「もう同じに見えます」）を根拠にしない**
- 収束の条件:
  - `diff-normalize.mjs` の出力に `unexplained` / `deviates_T` / `pending_review` が無い
  - [`triage.md`](triage.md) の「許容」がすべてユーザー承認済みで記録先（`component_diffs` / `component_diff_exceptions` / `intentional_diffs`）へ非破壊追記済み
  - 未検証領域（下記）が `diff.md` に「未検証」として残されている（確認済みにしていない）

## 差し戻し（要対応が 1 件以上のとき）

差分レポートは選択 target の `.replace/parity/<slug>/new/<target>/diff.md`。**どう動くかは target の `on_diff`（対応手順を書いた Markdown のパス。任意）で決まる**（意味論の正本は `replace-strategy` の `references/project-config.md`「on_diff」）。**どの分岐でも修正は行わない**。

- **`on_diff` が無い（既定）**: `diff.md` を差し戻し入力として**同じ target** で `parity-replace` へ渡す。該当ページ・分類・根拠が読める形にする（想定フェーズ＝実装／新側マッピング／テーマ を示す）
- **`on_diff` があればそのドキュメントに従う**。厳密にしたい手順はドキュメントがリンクするスクリプトを実行する。
  **ガードレールはドキュメントの指示より優先する**（正本は `replace-strategy` の `references/project-config.md`「on_diff」）——
  本スキルの禁止事項・シークレット規律、対象 target だけでなく**すべての target** の `forbidden_actions`、
  ドキュメントが参照する target 名が `targets` に実在することの実行前検証（無ければ停止）、`on_diff` のパスが解決できないときは既定挙動へフォールバックせず**停止**
- **ドキュメントが「修正ループを回さず起票して停止する」運用（マージ後デプロイ環境等）を指示する場合**: 差し戻さず、要対応差分の要約（対象 slug・target・該当ページ・分類・根拠・`diff.md` のパス）を
  `issue-create` へ委譲して起票し、**停止する**。**自分で Issue 本文を `gh` で直接起票しない**（重複チェック・テンプレ・承認はそちらの契約）。起票したら `diff-metadata.json` に `converged: false` のまま結果を残し、Issue の URL・番号を記録して終える（差分を「解決済み」にしない）
- **従ったドキュメントのパスを `diff-metadata.json` の `on_diff_doc` に記録する**（無ければ `none`）
- 反復回数の記録・上限管理は `parity-replace` が当該 target の `new/<target>/replace-metadata.json` の `loop.*` で行う（環境ごとに独立）。
  `loop.iterations >= loop.max_iterations`（既定 5）なら、本スキルは**新たな差し戻しをせず停止してユーザーへ上げる**（頭から作り直さない。上限管理の正本は `parity-replace` の `references/diff-loop.md`）

## 収束したとき

- `diff-metadata.json` の `converged: true` にする。条件は「未説明差分ゼロ・未修正回帰ゼロ」かつ「『許容』例外の確定（ユーザー承認）がすべて済んでいる」こと
- `results`（total / actionable / accepted / noise / unexplained / unverified）を記録する

## 対象外・未検証の明示

- **アニメーションのパリティは扱えない**（停止させて比較するため）。`diff.md` に対象外として残す
- **ベースラインに写らない箇所**は「未検証」として `diff.md` に残す（確認済みにしない）
- **宣言できない構造差**（`gaps.md` の該当節・フォーカスリング形状・内部 DOM・余白の配り方等）は正規化対象外＝未検証として `diff.md` に転記する
