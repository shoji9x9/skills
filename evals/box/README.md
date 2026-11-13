# box の回帰テスト

テストケースは [`evals.json`](evals.json)。実行・採点・集計の共通の手順は `docs/skill-development.md`「回帰テストを実行する」に従う。

## 前提

- Box の認証情報は、eval の sandbox から読めない（`~/.config/box` を隠し、`BOX_*` の環境変数を渡さず、Box のホストを名前解決させない）。
  そのため、どの eval も Box の API には届かず、`box-token.sh` の失敗か、コマンドを示すところまでを見る。
- ハーネスが prompt の先頭に入れる非対話の指示は、リモートへの書き込みを止める。
  読み取りの eval 2 は、run が `box-token.sh` を含むコマンドを実行するので、実行したコマンドで採点できる。
  書き込みの eval 3 は、run がコマンドを実行しないので、prompt で「実行するコマンドを示して」と求め、応答に示したコマンドで採点する。

## 後退の検出のために置く assertion

eval 3 の次の 3 本は、Box API の公開の使い方なので、prompt がコマンドを求めるとベースラインも満たす。Delta には寄与しない。

- `https://upload.box.com/api/2.0/files/content` に POST している
- `attributes` に `name` と `parent.id` を指定している
- `-F file=@` でファイル本体を送っている

スキルの有無は、`box-token.sh` でトークンを取得すること・Authorization ヘッダーを自分だけが読めるファイルに書いて `-H @<ファイル>` で渡すこと・トークンを curl の引数に載せないことの 3 本で区別する。
