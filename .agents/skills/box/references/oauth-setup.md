# OAuth refresh の初回セットアップ（一度だけ）

Dev Token（`BOX_ACCESS_TOKEN`）で足りる場合はこの手順は不要。持続的にトークンを更新したいときだけ行う。

1. Box Developer Console（<https://app.box.com/developers/console>）でアプリを新規作成する。
   - 「アプリの新規作成」→「カスタムアプリ」→ 認証方式は「ユーザー認証 (OAuth 2.0)」を選ぶ。
   - このアプリは **Client ID / Client Secret を取得するためだけ**に使い、連携の実装やアプリの公開・承認は行わない。**アプリ名は任意**でよい。
   - 作成後、Configuration（構成）画面の「OAuth 2.0 Credentials」に表示される **Client ID / Client Secret** を `.env` の `BOX_CLIENT_ID` / `BOX_CLIENT_SECRET` に設定する。
   - 同画面の「OAuth 2.0 Redirect URI」に登録されている値（例 `https://app.box.com`）を控える。次の認可 URL の `redirect_uri` と完全一致させる必要がある。
2. ブラウザで認可 URL を開いてログイン・承認する（`<CLIENT_ID>` を置換、`redirect_uri` はアプリ登録値と完全一致させ、URL エンコードして指定する。パスや `?` を含む redirect URI では特に必須）。

   ```text
   https://account.box.com/api/oauth2/authorize?client_id=<CLIENT_ID>&response_type=code&redirect_uri=https%3A%2F%2Fapp.box.com
   ```

   （`redirect_uri` の値 `https://app.box.com` を `https%3A%2F%2Fapp.box.com` にエンコードしている。登録値が異なる場合はその値をエンコードして差し替える）

   承認後 `<redirect_uri>?code=...` に戻る。画面遷移で見えづらい場合は DevTools の Network（Preserve log ON）から `code` を取得する。

3. 取得した `code` を 30 秒以内に交換し refresh token を保存する（`<skill>` はインストール先のスキルディレクトリ）。認可コードは `ps` / `/proc` への露出を避けるため引数では渡さず、プロンプトに貼り付けるか stdin で渡す。

   ```bash
   # 対話: 実行後、プロンプトに認可コードを貼り付けて Enter
   bash <skill>/scripts/box-oauth-init.sh
   ```

   自動実行では stdin でも渡せる。ただし `ps` / `/proc` 露出を確実に避けるには、認可コードを argv に載せない形で流し込むこと。`printf '%s' '<code>' | ...` は `printf` が外部コマンドの環境では argv に見え得るため、コードをファイルに置いて stdin に流すのが安全。ファイルは交換の成否に関わらず削除する（`;` で連結し、失敗時に認可コードが残留しないようにする）。

   ```bash
   # コードをファイルに置いて stdin に流す（成否に関わらず後始末する）
   bash <skill>/scripts/box-oauth-init.sh < code.txt; rm -f code.txt
   ```

以後は `box-token.sh` が refresh token から access token を自動取得・更新するため、トークンの手動更新は不要。
`.env` は `BOX_CLIENT_ID` / `BOX_CLIENT_SECRET` のみでよい。
