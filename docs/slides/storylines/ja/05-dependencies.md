# 5. 依存の更新と脆弱性

伝えること: 依存の更新と脆弱性に対応する。

含むスキル: dependabot-merge・dependabot-alert-issue

## スライド

1. 困りごと。CI が通っていても、0.x のマイナーの更新や major の更新には破壊的な変更がありうる。なぜ merge したかも後から追えない。
   脆弱性の alert を 1 件ずつ Issue にすると数が多くなり、すぐには直せないものが止まったまま残る。
   根拠: `skills/dependabot-merge/SKILL.md` の冒頭、`skills/dependabot-alert-issue/SKILL.md` の冒頭
2. dependabot-merge。CI の必須チェックの成功を確かめる → changelog と release notes から使用箇所への影響を読む → 判断と根拠を PR にコメントする → merge する。
   `--all` で、open な Dependabot の PR をすべて順に処理する。呼び出し方は `dependabot-merge <PR>` と `dependabot-merge --all`。
   根拠: `skills/dependabot-merge/SKILL.md` の冒頭・「使い方」・「基本フロー（単一 PR）」
3. merge するかの判断。`>=1.0` のマイナー・パッチ、0.x、major で、確かめることと扱いを分ける。CI が通っていなければ、どれも merge しない。
   根拠: `skills/dependabot-merge/SKILL.md`「マージ可否の判断ガイド」
4. dependabot-alert-issue。設定の `ignore` と `dismiss` を当て、既に Issue や PR があるものを飛ばす → 残りをすぐ着手できるかで分類してまとめる → 下書きと dismiss の候補を、承認を得てから実行する。
   Dependabot alerts のほかに、外部の audit の結果も入力にできる。呼び出し方は `dependabot-alert-issue`。
   根拠: `skills/dependabot-alert-issue/SKILL.md` の冒頭・「使い方」・「基本フロー」・「外部 audit findings 入力」
5. すぐ着手できるかで分ける。すぐ着手できないもの（修正版が無い、公開から日数がたっていない、親の依存がバージョンを固定している）は、着手できるようになる条件を Issue に書く。
   すぐ着手できるものは severity ごとに、すぐ着手できないものはパッケージと修正されたバージョンの組ごとにまとめる。
   根拠: `skills/dependabot-alert-issue/SKILL.md`「着手可否の判定」「グルーピング」
6. 設定。merge の方式（`merge_method`）、公開から着手までの最小の日数（`minimum_release_age_days`）、無視と dismiss の条件を、設定ファイルに書く。
   根拠: `skills/dependabot-merge/SKILL.md`「セットアップ（マージ方式の選択）」、`skills/dependabot-alert-issue/SKILL.md`「セットアップ（特別処理・リリース年齢の設定）」
7. 人が判断する点。changelog から破壊的な変更を判断できないとき、使用箇所に影響する変更でコードの修正が要るとき、影響が大きいか材料が足りないとき、Issue の下書きと dismiss を承認するとき。
   根拠: `skills/dependabot-merge/SKILL.md`「追加確認が必要な条件」、`skills/dependabot-alert-issue/SKILL.md`「基本フロー」の 7・8
8. 成果物。PR に残した判断の記録、merge した PR、脆弱性を解消する Issue、dismiss した alert とその理由。
   根拠: `skills/dependabot-merge/SKILL.md`「判断の記録（PR コメント）」、`skills/dependabot-alert-issue/SKILL.md`「基本フロー」の 9
9. つながるスキル。起票した Issue には issue-start で着手する（第 4 章）。Issue のタイトルと本文、PR に残す判断の記録は writing-style で読み直す（第 3 章）。
   根拠: `skills/dependabot-alert-issue/SKILL.md` の冒頭、writing-style を参照する `skills/dependabot-merge` と `skills/dependabot-alert-issue` の手順
