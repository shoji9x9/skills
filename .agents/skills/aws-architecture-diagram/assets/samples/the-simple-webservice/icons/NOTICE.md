# 同梱アイコンの出典

このディレクトリ直下の非 AWS アイコンは、**aws-architecture-diagram スキルのために新規に
描き起こしたオリジナル**（単純な幾何図形のみ。第三者のアイコンセットからの流用や派生では
ない）。本スキルの一部として自由に利用・再配布・改変してよい。

- `browser.svg` — ブラウザ（利用者）
- `internet.svg` — 外部 API / インターネット

AWS 公式アイコンはここには同梱せず、スキルの `fetch-aws-icons.mjs` で公式パッケージから
取得する（`icons/aws-icons/` に配置され、そちらに別途 NOTICE.md が生成される）。出典・利用
条件は aws-architecture-diagram スキルの `references/icons.md` を参照。
