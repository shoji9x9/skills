# 部品カタログの契約

- 実体: Storybook
- URL: `<baseURL>/iframe.html?id=<story id>&viewMode=story`。story id は `components-<slug>--<インスタンス id>-<状態名>`。1 インスタンス × 1 状態が 1 つの固定 URL で開ける
- 見本の置き場: 実装と同じディレクトリの `<部品名>.stories.tsx`
- 見本の一覧: `<baseURL>/index.json` から機械可読で取得する
- データの注入: 採取した `data.json` を見本の `args` へ静的に import して渡す
- アニメーション: `.storybook/preview.tsx` のデコレータで `prefers-reduced-motion` を強制し、トランジションを無効化する
- 外部サービスへは接続しない（画像・フォントはリポジトリ内から配信する）
