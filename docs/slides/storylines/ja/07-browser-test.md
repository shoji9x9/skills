# 7. browser-test

伝えること: 変更の影響を、実際のブラウザで確かめる。

## スライド

1. 困りごと。テストが通っても、画面の表示・console・API の応答に回帰が残ることがある。
   エージェントに画面を操作させると、データの書き込みや課金を伴う操作をしてしまうおそれがある。
   根拠: `skills/browser-test/SKILL.md` の冒頭と「厳守の制約」
2. 呼び出し方。`browser-test --env <環境名> --scope <uncommitted|branch|custom>`。初回は `browser-test setup` で環境・起動の方法・認証・禁止する操作を記録する。
   根拠: `skills/browser-test/SKILL.md`「使い方」
3. 流れ。環境とスコープを決める → サーバーが動いているかを確かめる → 変更から影響するページを導く → ページごとに表示と console と API を確かめる → 課題を別の環境で切り分ける → 報告する。
   根拠: `skills/browser-test/SKILL.md`「フロー」
4. 安全のための決まり。環境ごとに禁止する操作（`forbidden_actions`）を決め、決めていない環境は読み取り専用として扱う。副作用を伴う操作は、実施する前に承認を得る。
   根拠: `skills/browser-test/SKILL.md`「厳守の制約」「インタラクションの区分」
5. 設定。環境ごとに、名前・URL・起動の方法・認証の有無・禁止する操作を `environments` に書く。
   根拠: `skills/browser-test/references/project-config.md`、`skills/browser-test/config-schemas/browser-test.schema.json`
6. 人が判断する点。ログイン、サーバーの起動、副作用を伴う操作の承認、禁止する操作の代行。
   根拠: `skills/browser-test/SKILL.md`「フロー」の 1・2 と「厳守の制約」
7. 成果物。確認の観点 × ページ × 結果の表、課題ごとの切り分けの結果、利用者に実施を頼んだ操作の一覧。
   根拠: `skills/browser-test/SKILL.md`「フロー」の 6
8. つながるスキル。issue-batch が画面に影響する変更で呼ぶ（第 4 章）。replace-strategy は現行アプリの操作でこの作法に従う（第 6 章）。
   根拠: `skills/issue-batch/SKILL.md`「前提」、`skills/replace-strategy/SKILL.md`「前提」
