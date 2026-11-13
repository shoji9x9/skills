# box の回帰テスト

テストケースは [`evals.json`](evals.json)。実行・採点・集計の共通の手順は `docs/skill-development.md`「回帰テストを実行する」に従う。

## eval 3 の prompt

eval 3 は Box への書き込みの依頼で、run はアップロードを実行しない。
そのため、prompt で「実行するコマンドを示して」と求め、応答に示したコマンドで採点する。

## Delta の根拠にしない assertion

eval 3 の次の 4 本は、スキルを使わなくても書ける内容なので、ベースラインも満たしうる。Delta の根拠にせず、後退の検出のために置く。

- `https://upload.box.com/api/2.0/files/content` に POST している
- `attributes` に `name` と `parent.id` を指定している
- `-F file=@` でファイル本体を送っている
- アップロード後に id/名前など結果を確認している

スキルの有無は、`box-token.sh` でトークンを取得すること・Authorization ヘッダーを自分だけが読めるファイルに書いて `-H @<ファイル>` で渡すこと・トークンを curl の引数に載せないことの 3 本で区別する。
