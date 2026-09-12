# 部品の照合記録（parity）

- 対象 slug: button
- 新側 target: local-dev
- 基準の採取条件: `.replace/components/button/metadata.json` の `capture_conditions`
- 採取ツール版の一致: 一致（trait-capture 2 / css-rules-capture 1）

## 照合結果

| インスタンス | 状態 | 画素 | 特性 | 判定 |
|---|---|---|---|---|
| orders-search | default | 0 / 0 | 0 | 一致 |
| orders-search | hover | 0 / 0 | 0 | 一致 |
| orders-search | active | 0 / 0 | 0 | 一致 |
| orders-search | disabled | 0 / 0 | 0 | 一致 |
| users-create | default | 0 / 0 | 0 | 一致 |
| users-create | hover | 0 / 0 | 0 | 一致 |
| users-create | active | 0 / 0 | 0 | 一致 |
| users-create | disabled | 0 / 0 | 0 | 一致 |

## 収束の宣言

- 未説明差分: 0 件
- `verification_commands.full`: npm run lint / npm run typecheck ともに pass
- 見本の網羅: 8 組合せ ＝ 8 件照合
- 未検証として残るもの: なし
