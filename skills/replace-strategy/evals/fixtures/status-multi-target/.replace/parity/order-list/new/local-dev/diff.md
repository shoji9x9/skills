# 差分レポート（diff）

- 対象 slug: order-list
- 対象 target: local-dev
- モード: feature
- 実施日時: 2026-07-06T08:30:00Z
- 読んだ同 target の replace-metadata.json の loop.iterations: 1

## 1. 前提確認の結果

| 前提 | 確認値 | 判定 |
|---|---|---|
| parity-suite 完了（suite.current_green・validated_by_strength_gate） | true / true | OK |
| parity-replace 新側 green（同 target の suite.new_green・new.target 一致） | true / local-dev | OK |
| データセットバージョン三者整合（metadata / dataset.version / phase_b.order-list.local-dev） | 1 / 1 / 1 | 影響変更なし |

## 3. 差分一覧

| ID | 経路 | ページ | 状態 | ビューポート | 位置（論理名 or bbox） | 内容 | 正規化結果 | 分類 | 根拠 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 特性照合 | /orders | default | desktop | 検索ボタン | border-radius 差 | matches_T | 許容 | component_diffs の期待値どおり（承認済み） |
| 2 | 画素 | /orders | default | desktop | (12,340,180,24) | 罫線色の微差 | noise_candidate | 環境ノイズ | ノイズ基準値と同程度 |

## 6. 未検証領域

| 箇所 | 種別 | 理由 |
|---|---|---|
| 一覧の空状態 | データ依存 | ゴールデンデータに該当パターンが無く比較できない |

## 7. 収束判定

- 未説明差分: 0 件
- 未修正回帰（deviates_T / actionable）: 0 件
- 「許容」例外の確定（ユーザー承認）: すべて済み
- 収束: converged: true（差分器の集計が上記のとおりゼロ）
