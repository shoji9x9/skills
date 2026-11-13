# box の回帰テスト

テストケースは [`evals.json`](evals.json)。実行・採点・集計の共通の手順は `docs/skill-development.md`「回帰テストを実行する」に従う。

## eval 3 がコマンドを求める理由

eval 3 は Box への書き込みの依頼で、run はアップロードを実行しない。
そのため、応答にコマンドを示さない run には、採点する材料が残らない。
prompt で「実行するコマンドを示して」と求め、応答に示したコマンドで採点する。

## Delta には寄与しない assertion

eval 3 の次の 3 本は、公開されている Box API の使い方で、スキルを使わなくても書ける。prompt がコマンドを求めるとベースラインも満たすので、Delta には寄与しない。後退の検出のために置く。

- `https://upload.box.com/api/2.0/files/content` に POST している
- `attributes` に `name` と `parent.id` を指定している
- `-F file=@` でファイル本体を送っている

「アップロード後に id/名前など結果を確認している」も一般的な確認で、ベースラインが満たすことがある。区別の根拠にしない。

スキルの有無は、次の 3 本で区別する。

- `box-token.sh` でアクセストークンを取得しようとしている
- Authorization ヘッダーを自分だけが読めるファイル（`mktemp` など）に書き、curl に `-H @<ファイル>` で渡している
- `-H "Authorization: Bearer $TOKEN"` の形で、トークンを curl の引数に載せていない
