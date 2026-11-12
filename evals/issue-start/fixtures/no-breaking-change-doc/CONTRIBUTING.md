# 開発の規約

## ブランチ

`main` から `feature/<Issue の番号>-<英語の短い説明>` のブランチを作り、PR で `main` に取り込む。PR は通常の merge で取り込む。

## commit message

conventional commits（`feat:`・`fix:`・`docs:` など）で書く。
リリースのバージョンは、semantic-release が commit message から決める。
