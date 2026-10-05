# 同梱アイコンの出典

このディレクトリの直下にある AWS 以外のアイコンは、aws-architecture-diagram スキルのために新しく描いたオリジナルである。
単純な幾何図形だけで描いており、第三者のアイコンセットからの流用や派生ではない。このスキルの一部として、自由に利用・再配布・改変してよい。

- `browser.svg`: ブラウザ（利用者）
- `internet.svg`: 外部 API・インターネット

AWS 公式アイコンはここには同梱せず、スキルの `fetch-aws-icons.mjs` で公式パッケージから取得する。
取得したアイコンは `icons/aws-icons/` に置かれ、そこに別の NOTICE.md が生成される。
出典と利用条件は、aws-architecture-diagram スキルの `references/icons.md` にある。
