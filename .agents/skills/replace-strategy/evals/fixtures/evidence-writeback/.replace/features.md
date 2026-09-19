# 機能インベントリ（features）

- 最終更新: 2026-09-02T10:00:00+09:00
- ゴールデンデータセット Issue: #200

## その他の Issue（4 種以外）

なし

## 機能一覧

| slug | 機能名 | 依存順 | ページ | 新規実装 API | 要求単位の根拠 | 依存する横断 API（リソース slug） | テーブル | 副作用出力 | Issue | 受け入れ条件 |
|---|---|---|---|---|---|---|---|---|---|---|
| plan | 計画管理 | 2 | /plans, /plans/:id | GET /api/plans, POST /api/plans, PATCH /api/plans/:id, DELETE /api/plans/:id | GET /api/plans → 実測: /plans の入口 SELECT と応答への写像を読了（母集合=MST_PLAN のうち archived = false / 1 行=計画 1 件）／POST /api/plans → 推定: 同形の参照なし・要求単位は未確定／PATCH /api/plans/:id → 推定: 同形の参照なし・要求単位は未確定／DELETE /api/plans/:id → 推定: 同形の参照なし・要求単位は未確定 | user | MST_PLAN, REL_PLAN_MEMBER | なし | #210 | #210 |
| assignment | 割当管理 | 3 | /assignments | GET /api/assignments, PATCH /api/assignments/:id | GET /api/assignments → 推定: 出どころ不明・要求単位は未確定／PATCH /api/assignments/:id → 推定: 出どころ不明・要求単位は未確定 | user | REL_PLAN_MEMBER | なし | #211 | #211 |

## ページ一覧

| ページ | パス | 乗る機能（slug） |
|---|---|---|
| 計画一覧 | /plans | plan |
| 計画詳細 | /plans/:id | plan |
| 割当一覧 | /assignments | assignment |

## ページ要素の帰属

なし

## 横断 API（リソース単位）

| slug | リソース | API | 要求単位の根拠 | fan-out（利用機能 slug） | 参照テーブル | Issue | 受け入れ条件 |
|---|---|---|---|---|---|---|---|
| user | ユーザー | GET /api/users | GET /api/users → 実測: 共通ヘッダの入口 SELECT と応答への写像を読了（母集合=MST_USER / 1 行=ユーザー 1 件） | plan, assignment | MST_USER | #201 | #201 |

## バッチ

なし
