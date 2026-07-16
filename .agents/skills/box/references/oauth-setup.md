# OAuth refresh の初回セットアップ（一度だけ）

Dev Token（`BOX_ACCESS_TOKEN`）で足りる場合はこの手順は不要。持続的にトークンを更新したいときだけ行う。

1. Box Developer Console（<https://app.box.com/developers/console>）でアプリを新規作成する。
   - 「アプリの新規作成」→「カスタムアプリ」→ 認証方式は「ユーザー認証 (OAuth 2.0)」を選ぶ。
   - このアプリは **Client ID / Client Secret を取得するためだけ**に使い、連携の実装やアプリの公開・承認は行わない。**アプリ名は任意**でよい。
   - 作成後、Configuration（構成）画面の「OAuth 2.0 Credentials」に表示される **Client ID / Client Secret** を `.env` の `BOX_CLIENT_ID` / `BOX_CLIENT_SECRET` に設定する。
   - 同画面の「OAuth 2.0 Redirect URI」に登録されている値（例 `https://app.box.com`）を控える。次の認可 URL の `redirect_uri` と完全一致させる必要がある。
2. ブラウザで認可 URL を開いてログイン・承認する（`<CLIENT_ID>` を置換、`redirect_uri` はアプリ登録値と一致させる）。

   ```text
   https://account.box.com/api/oauth2/authorize?client_id=<CLIENT_ID>&response_type=code&redirect_uri=https://app.box.com
   ```

   承認後 `<redirect_uri>?code=...` に戻る。画面遷移で見えづらい場合は DevTools の Network（Preserve log ON）から `code` を取得する。

3. 取得した `code` を 30 秒以内に交換し refresh token を保存する（`<skill>` はインストール先のスキルディレクトリ）。

   ```bash
   bash <skill>/scripts/box-oauth-init.sh <code>
   ```

以後は `box-token.sh` が refresh token から access token を自動取得・更新するため、トークンの手動更新は不要。
`.env` は `BOX_CLIENT_ID` / `BOX_CLIENT_SECRET` のみでよい。
