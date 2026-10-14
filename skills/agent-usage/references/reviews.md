# PR のレビューの回数と費用

collect は、更新された PR のレビューを、レビューの作者からツールを判定して記録する。費用の取り方は、レビューが実行される場所で決まる。

| レビュー | 実行される場所 | 費用 |
| --- | --- | --- |
| Claude Code の Action（`anthropics/claude-code-action`） | 自分のリポジトリの GitHub Actions | 実行結果を artifact に残せば、モデル別の費用を記録する |
| Codex の Action（`openai/codex-action`） | 自分のリポジトリの GitHub Actions | ログを artifact に残せば、トークン数 × 単価表で記録する |
| `@codex review` | OpenAI のクラウド | 取得できない。回数を記録し、設定の `reviewPricing` があれば推定額を付ける |
| GitHub Copilot のレビュー | GitHub のクラウド | 取得できない。回数 × 1 回あたりの推定額（同梱の $0.52）。課金 API の実額は任意 |

## 1 回あたりの推定額

推定額は、リポジトリの設定の `reviewPricing`、同梱の `assets/pricing.json` の `reviews` の順に探す。どちらにも無いツールは、費用を空欄にして回数だけを記録する。
後から推定額を足せば、report が記録済みのレビューにも当てて推定し直す。

- Copilot: 1 回のレビューで premium request を 13 消費し、追加の premium request は 1 件 $0.04 なので、$0.52 を同梱する（[About premium requests](https://docs.github.com/en/copilot/concepts/billing/copilot-requests)）。
  プランの枠の中のレビューは追加の請求にならないので、上限の推定である
- `@codex review`: ChatGPT のプランの中で動き、1 回あたりの単価が公開されていないので、同梱しない

## レビューツールの判定

PR に付いたレビューの作者（GitHub の login）から決める。対応は同梱の `assets/review-tools.json` にあり、リポジトリの設定の `reviewTools` で足せる。

- 自分の Actions で実行するレビューは、workflow が使うトークンの持ち主（`github-actions[bot]` や、使っている GitHub App の bot）が作者になる。その login を `reviewTools` に足す
- 1 回のレビュー（PR に付いたレビュー 1 件）を 1 回として数える。人のレビューは数えない（自分のレビューは、人の活動として記録する）

## 自分の Actions で実行するレビューの費用を残す

レビューする job の最後に、同梱の [`assets/review-usage-steps.yml`](../assets/review-usage-steps.yml) の手順を足す。
手順は、使用量のファイルと `meta.json`（ツールの名前と PR の番号）を、名前 `agent-usage-review` の artifact にする。collect はこの名前の artifact を取得する。

- Claude Code の Action: Action の出力 `execution_file`（SDK のメッセージの配列で、最後の `result` が `total_cost_usd` と `modelUsage` を持つ）を残す
- Codex の Action: Action の入力 `codex-home` で置き場所を決め、その下の `sessions/` のログを残す
- artifact の保存期間（GitHub のデフォルトは 90 日）を過ぎる前に collect する。過ぎた artifact は取得できない

雛形は、Action の入力・出力の名前を公式の定義（`action.yml`）で確かめて書いたものである。実際の workflow で 1 回実行し、collect がその artifact を記録することを確かめてから使う。

## 課金 API の実額（任意）

`setup --billing user` を付けた人は、collect が GitHub の個人のプランの premium request の日別の実額（`/users/<login>/settings/billing/premium_request/usage`）を記録する。

- 内訳は日・モデル・製品の単位で、リポジトリや PR の単位ではない。レビュー以外の利用も含む
- 組織のプランの実額は、組織の管理者の権限が要るので取得しない
- 取得に失敗した日は、collect の出力に段の名前が出る（他の段は続ける）

参考: [REST API endpoints for billing usage](https://docs.github.com/en/rest/billing/usage)
