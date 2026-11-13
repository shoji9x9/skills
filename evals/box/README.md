# box の回帰テスト

テストケースは [`evals.json`](evals.json)。実行・採点・集計の共通の手順は `docs/skill-development.md`「回帰テストを実行する」に従う。

## eval 3 がコマンドを求める理由

eval 3 は Box への書き込みの依頼で、run はアップロードを実行しない。
そのため、応答にコマンドを示さない run には、採点する材料が残らない。
prompt で「実行するコマンドを示して」と求め、応答に示したコマンドで採点する。

下の 2 つの一覧は、evals.json の eval 3 の assertion の原文を、コマンドとパスだけバッククォートで囲んで挙げる。assertion を変えたら、一覧も直す。

## eval 3 の Delta には寄与しない assertion

次の 4 本は、スキルを使わなくても書ける内容なので、prompt がコマンドを求めるとベースラインも満たしうる。Delta には寄与しない。後退の検出のために置く。

- `https://upload.box.com/api/2.0/files/content` に POST している
- `attributes` に `name` と `parent.id` を指定している
- `-F file=@` でファイル本体を送っている
- アップロード後に id/名前など結果を確認している

## eval 3 でスキルの有無を区別する assertion

- `box-token.sh` でアクセストークンを取得しようとしている
- Authorization ヘッダーを自分だけが読めるファイル（`mktemp` など）に書き、curl に `-H @<ファイル>` で渡している
- `-H "Authorization: Bearer $TOKEN"` の形で、トークンを curl の引数に載せていない

3 本目は否定の形なので、別の形でトークンを引数に載せる応答（`--oauth2-bearer` など）も満たしうる。2 本目と合わせて読む。
