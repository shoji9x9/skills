# 差分レポート（diff）

<!-- parity-diff が .replace/parity/<slug>/diff.md として生成する。このファイルの形式の正本は parity-diff が定義する。 -->
<!-- 収束の定義: 未説明差分ゼロ かつ 未修正回帰ゼロ（生の差分ゼロは求めない）。判定は差分器（diff-normalize の機械分類）が行い、モデルの主観を根拠にしない。 -->
<!-- 「確認済みにしない」原則: ベースラインに写らない箇所・宣言できない構造差・アニメーションは「未検証」として残す。 -->
<!-- 各行・各値は例。実際の検出結果・分類・根拠で置き換える。 -->

- 対象 slug: （features.md の slug）
- モード: （feature | api-resource | batch）
- 実施日時: （ISO 8601）
- 読んだ replace-metadata.json の loop.iterations: （数値）

## 1. 前提確認の結果

<!-- preflight の確認値。欠け・不一致があれば差分検出へ進まず停止していること。 -->

| 前提 | 確認値 | 判定 |
|---|---|---|
| replace-strategy setup（設定・features.md） | （あり／なし） | （OK／停止） |
| parity-suite 完了（suite.current_green・validated_by_strength_gate・noise_baseline・baseline 実体） | （値） | （OK／停止） |
| parity-replace 新側 green（suite.new_green） | （true／false） | （OK／停止） |
| データセットバージョン三者一致（metadata / dataset.version / `phase_b.<slug>`） | （3 値） | （一致／陳腐化→差し戻し先） |
| 条件一致検証（viewport・アニメーション無効・マスク・states） | （検証済み／不一致） | （OK／停止） |
| 差分器バージョン一致（trait_capture・trait_compare・pixel_tool・aria_compare・align_tolerance） | （値） | （一致／不一致→parity-suite） |

## 2. 経路別サマリ

<!-- feature モードは画素／特性／aria。api-resource / batch は API／バッチの構造・バイト比較。 -->

| 経路 | 適用したノイズ基準値（page/state/viewport） | 検出件数 | 備考 |
|---|---|---|---|
| 画素 | （基準値） | （件数） | 名前無し要素の見た目差 |
| 特性照合 | （基準値） | （件数） | 論理名付き要素の computed style・相対幾何 |
| aria | — | （件数） | テーブル/フォームの内容パリティ（補助経路） |

## 3. 差分一覧

<!-- 分類は 要対応／許容／環境ノイズ の 3 値＋（未トリアージの）未説明。位置は論理名または bbox。 -->

| ID | 経路 | ページ | 状態 | ビューポート | 位置（論理名 or bbox） | 内容 | 正規化結果 | 分類 | 根拠 |
|---|---|---|---|---|---|---|---|---|---|
| （例: 1） | 特性照合 | （ページ） | default | desktop | （論理名） | padding-left 差 | deviates_T | 要対応 | T の期待値から逸脱 |
| （例: 2） | 画素 | （ページ） | hover | mobile | （bbox） | 罫線色の微差 | noise_candidate | 環境ノイズ | ノイズ基準値と同程度 |

## 4. 要対応 — parity-replace への差し戻し

<!-- 該当ページ・想定フェーズ（実装／新側マッピング／テーマ）を示す。修正はここで行わない。反復上限超過なら差し戻さず停止しユーザーへ。 -->

| ID | ページ | 想定フェーズ | 差し戻し内容 |
|---|---|---|---|
| （例: 1） | （ページ） | テーマ | design token を寄せる or component_diffs を宣言 |

- 差し戻し入力としてこの diff.md を parity-replace へ渡す（再入手順は parity-replace の references/diff-loop.md）

## 5. 許容 — 記録先とユーザー承認

<!-- 「許容」の確定にはユーザー承認が要る。承認済みのものだけを記録先へ非破壊追記する。 -->

| ID | 記録先（component_diffs / component_diff_exceptions / intentional_diffs） | ユーザー承認（有無・日時） |
|---|---|---|
| （例: 3） | component_diff_exceptions | 承認済み（ISO 8601） |

## 6. 未検証領域

<!-- ベースラインに写らない箇所・gaps.md の宣言できない構造差・アニメーション。確認済みにしない。 -->

| 箇所 | 種別（写らない／宣言できない構造差／アニメーション） | 理由 |
|---|---|---|
| （例: 保存ボタンのフォーカスリング） | 宣言できない構造差 | クラス/トークンのプロパティ差に還元できない |
| （例: 一覧のフェードイン） | アニメーション | 停止させて比較するため扱えない |

## 7. 収束判定

<!-- 差分器の集計で判定する。converged は diff-metadata.json と一致させる。 -->

- 未説明差分: （件数。ゼロが条件）
- 未修正回帰（deviates_T / actionable）: （件数。ゼロが条件）
- 「許容」例外の確定（ユーザー承認）: （すべて済み／未済）
- 収束: （converged: true / false）と根拠
