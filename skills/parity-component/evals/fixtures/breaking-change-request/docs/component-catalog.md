# 部品カタログの契約

- 実体: 自前のカタログページ（`/catalog`）
- URL: `<baseURL>/catalog?component=<slug>&instance=<インスタンス id>&state=<状態名>`。1 インスタンス × 1 状態が 1 つの固定 URL で開ける
- 見本の置き場: 実装と同じディレクトリの `<部品名>.stories.tsx`
- データの注入: クエリ `?data=<採取した data.json のパス>` で静的データを読み込む
- アニメーション: カタログは `prefers-reduced-motion` を強制し、トランジションを無効化する
- 外部サービスへは接続しない（画像・フォントはリポジトリ内から配信する）
