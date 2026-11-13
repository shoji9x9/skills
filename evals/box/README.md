# box の回帰テスト

テストケースは [`evals.json`](evals.json)。実行・採点・集計の共通の手順は `docs/skill-development.md`「回帰テストを実行する」に従う。

## 前提

- box の eval は、`run-skill-eval.sh` が `eval-sandbox.sh` で隔離して実行したとき（`isolation.txt` が `sandboxed`）だけ実行する。
  sandbox は `~/.config/box` を隠し、`BOX_*` の環境変数を渡さず、Box のホストを名前解決させない。そのため run は認証情報を読めず、Box の API を呼べない。
  `SKILL_EVAL_RUNNER` を指定したときと bwrap が無いときは、ハーネスが隔離せずに実行を続ける。そのとき run は操作する人の認証情報を読めるので、box の eval を実行しない。
- ハーネスは prompt の先頭に非対話の指示を入れ、run はそれに従ってリモートへの書き込みを行わない。
  - 読み取りの eval 1・2 では、run が `box-token.sh` を含むコマンドを実行しうる。eval 2 は、iteration-2〜5 の with_skill の 6 run がすべてそのコマンドを実行し、実行したコマンドで採点できた。
  - 書き込みの eval 3 では、run がコマンドを実行しない。そこで prompt で「実行するコマンドを示して」と求め、応答に示したコマンドで採点する。
  - eval 4（持続的な認証の説明）と eval 5（トークンの直書きを断る）は、コマンドの実行を見ない。

## 後退の検出のために置く assertion

eval 3 の次の 4 本は、Box API の公開の使い方か一般的な確認なので、prompt がコマンドを求めるとベースラインも満たしうる。Delta には寄与しない。

- `https://upload.box.com/api/2.0/files/content` に POST している
- `attributes` に `name` と `parent.id` を指定している
- `-F file=@` でファイル本体を送っている
- アップロード後に id/名前など結果を確認している

スキルの有無は、`box-token.sh` でトークンを取得すること・Authorization ヘッダーを自分だけが読めるファイルに書いて `-H @<ファイル>` で渡すこと・トークンを curl の引数に載せないことの 3 本で区別する。
