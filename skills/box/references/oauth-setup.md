# OAuth refresh の最初のセットアップ（一度だけ）

Dev Token（`BOX_ACCESS_TOKEN`）で足りる場合は、この手順は要らない。トークンを自動で更新し続けたいときだけ行う。

1. Box Developer Console（<https://app.box.com/developers/console>）で、アプリを新しく作る。
   - 「アプリの新規作成」→「カスタムアプリ」と進み、認証方式は「ユーザー認証 (OAuth 2.0)」を選ぶ。
   - このアプリは、Client ID と Client Secret を取得するためだけに使う。連携の実装や、アプリの公開・承認はしない。アプリ名は何でもよい。
   - 作った後、Configuration（構成）画面の「OAuth 2.0 Credentials」に出る Client ID と Client Secret を、`.env` の `BOX_CLIENT_ID` と `BOX_CLIENT_SECRET` に設定する。
   - 同じ画面の「OAuth 2.0 Redirect URI」に登録されている値（例: `https://app.box.com`）を控える。次の認可 URL の `redirect_uri` は、この値と一字一句同じにする。
2. ブラウザで認可 URL を開き、ログインして承認する。`<CLIENT_ID>` を置き換え、`redirect_uri` はアプリに登録した値と一字一句同じにして URL エンコードする。
   パスや `?` を含む redirect URI では、エンコードが特に欠かせない。

   ```text
   https://account.box.com/api/oauth2/authorize?client_id=<CLIENT_ID>&response_type=code&redirect_uri=https%3A%2F%2Fapp.box.com
   ```

   この例では、`redirect_uri` の値 `https://app.box.com` を `https%3A%2F%2Fapp.box.com` にエンコードしている。
   登録した値が違う場合は、その値をエンコードして置き換える。手順 3 のトークンの交換でも同じ値を使うように、`BOX_REDIRECT_URI` にも設定する。
   `box-oauth-init.sh` は、`BOX_REDIRECT_URI` が無ければ `https://app.box.com` を使う。認可 URL の値と違うと、交換に失敗する。

   承認すると `<redirect_uri>?code=...` に戻る。画面が切り替わって見えにくい場合は、DevTools の Network（Preserve log を ON）から `code` を取得する。

3. 取得した `code` を 30 秒以内に交換し、refresh token を保存する（`<skill>` はインストール先のスキルのディレクトリ）。
   認可コードを `ps` や `/proc` から読めないように、引数では渡さない。プロンプトに貼り付けるか、stdin で渡す。

   ```bash
   # 対話で実行する場合: 実行した後、プロンプトに認可コードを貼り付けて Enter を押す
   bash <skill>/scripts/box-oauth-init.sh
   ```

   自動で実行する場合は、stdin でも渡せる。ただし、`ps` や `/proc` から確実に読めないようにするには、認可コードを argv に載せない形で渡す。
   `printf '%s' '<code>' | ...` は、`printf` が外部コマンドである環境では argv に見えることがある。そのため、コードをファイルに置いて stdin に流すほうが安全である。
   ファイルは、他のユーザーから読めない権限で作る。カレントディレクトリに `code.txt` を作ると、デフォルトの umask 0022 では 0644 になり、消すまで他のユーザーから読める。
   `mktemp` は 0600 で作るので、そこに置く。書き込むときも、`cat >` に貼り付けるなど、argv に載せない方法を使う。
   削除は `trap ... EXIT` で行う。`bash ...; rm -f` のように `;` でつなぐと、`set -e` のスクリプトでは交換に失敗したときに `rm` まで進まず、認可コードが残る（実測した）。

   ```bash
   # 0600 の一時ファイルに置いて stdin に流す（成否に関わらず trap で消す）
   code_file="$(mktemp)" # mktemp は 0600 で作る。カレントディレクトリの code.txt はデフォルトの umask では 0644
   trap 'rm -f "$code_file"' EXIT
   cat >"$code_file"     # 認可コードを貼り付けて Ctrl-D を押す（argv に載る printf '<code>' は使わない）
   bash <skill>/scripts/box-oauth-init.sh <"$code_file"
   ```

これ以降は、`box-token.sh` が refresh token から access token を自動で取得・更新するので、トークンを手で更新する必要はない。
`.env` には `BOX_CLIENT_ID` と `BOX_CLIENT_SECRET` だけを書けばよい（`BOX_REDIRECT_URI` は、最初に `box-oauth-init.sh` を実行するときだけ使う）。
