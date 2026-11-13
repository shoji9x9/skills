# box の回帰テスト

テストケースは [`evals.json`](evals.json)。実行・採点・集計の共通の手順は `docs/skill-development.md`「回帰テストを実行する」に従う。

## 前提

- box の eval は、run が Box の認証情報を読めず、Box のホストに届かない状態で実行する。
  隔離の仕組みは `docs/skill-development.md`「eval 実行の隔離（必須）」にある。
  起動する前に、`eval-sandbox.sh --verify` を通し、sandbox の中で `~/.config/box` と `BOX_*` の環境変数が見えないことを確かめる。確かめられなければ実行しない。
- run は、ハーネスが prompt の先頭に入れる非対話の指示に従い、リモートへの書き込みを行わない。
  そのため、書き込みの eval 3 は、prompt で「実行するコマンドを示して」と求め、応答に示したコマンドで採点する。

## 後退の検出のために置く assertion

eval 3 の次の 3 本は、公開されている Box API の使い方なので、prompt がコマンドを求めるとベースラインも満たす。Delta には寄与しない。

- `https://upload.box.com/api/2.0/files/content` に POST している
- `attributes` に `name` と `parent.id` を指定している
- `-F file=@` でファイル本体を送っている

「アップロード後に id/名前など結果を確認している」も、ベースラインが満たすことがあるので、区別の根拠にしない。
スキルの有無は、`box-token.sh` でトークンを取得すること・Authorization ヘッダーを自分だけが読めるファイルに書いて `-H @<ファイル>` で渡すこと・トークンを curl の引数に載せないことの 3 本で区別する。
