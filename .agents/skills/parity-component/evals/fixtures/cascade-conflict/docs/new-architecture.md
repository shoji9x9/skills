# 新側アーキテクチャ

- 構成: 単一の Web アプリ。`src/components/` に共通 UI 部品、`src/pages/` に画面を置く
- 共通 UI 部品は画面より先に作り、`src/components/<部品名>/` に実装と見本を同じ階層で置く
- 見本（story）は実装と同じディレクトリに `<部品名>.stories.tsx` として置く
