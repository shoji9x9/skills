# 引数の設計（component-api）

- 対象 slug: button
- 部品: ボタン
- 採取したインスタンス: orders-search, users-create
- 採取した状態: default, hover, active, disabled
- 割り出しの出力: `.replace/components/button/axes.json` ／ `axis-diff.mjs` の exit: 0

## 引数（可変軸から起こしたもの）

| 引数 | 対応する軸（状態 / 軸名） | 値の集合 | 既定値 | 既定値の根拠 |
|---|---|---|---|---|
| `variant` | default / background-color, default / color, hover / background-color, hover / color, active / color, disabled / background-color | `primary`, `secondary` | `secondary` | users-create |
| `disabled` | disabled / color, disabled / cursor | `true`, `false` | `false` | 両インスタンス |

## 引数にしなかった可変軸

| 軸（状態 / 軸名） | 割れ方 | 扱い | 根拠 |
|---|---|---|---|
| default / rect/width、hover / rect/width、active / rect/width、disabled / rect/width | 文脈で決まる差 | 中身から決まる | 文言の長さに追従（「検索」96px / 「利用者を作成」132px。全状態で同じ差） |

## 状態の落とし先

| 採取した状態 | 落とし先 | 備考 |
|---|---|---|
| default | 基本のスタイル規則 | |
| hover | スタイル規則（`:hover`） | 背景色はインスタンスで割れる（可変軸。`variant` 経由で決まる） |
| active | スタイル規則（`:active`） | |
| disabled | 引数 `disabled` | `cursor` も `not-allowed` へ変わる |

## 実装方式の決定

- 標準コントロールを使っているか: `button` 要素をそのまま使っている
- `::before` / `::after` で描いている箇所: なし
- 新側で採る方式: 現行と同じく `button` 要素

## 未確定・確認待ち

なし
