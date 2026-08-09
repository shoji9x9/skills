# Skill Benchmark: kaizen

**Model**: claude-opus-5
**Date**: 2026-08-09T22:14:57Z
**Evals**: 1, 4, 7, 8, 9, 11, 12, 13, 14, 15 (1 run each per configuration)

## Summary

| Metric | With Skill | Without Skill | Delta |
|--------|------------|---------------|-------|
| Pass Rate | 100% ± 0% | 19% ± 19% | +0.81 |
| Time | 125.3s ± 77.2s | 153.8s ± 131.5s | -28.5s |
| Tokens | 8325 ± 5316 | 9304 ± 8919 | -979 |

## Notes

- Issue #183（frog の設計取り込み・ライフサイクル機構化）実装後の回帰。
  対象は assertion を変更した eval 1/4/7/8/9 と新規 eval 11-15 の 10 件。
  未変更の eval 2/3/5/6/10 は今回走らせていない。
- with_skill は 48 アサーション全通過（10 eval すべて 1.00）。without_skill は 10/48。
  Delta +0.81 は eval ごとの pass_rate 平均差。
- 1 run/configuration のため configuration 内の分散は測っていない（表の ± は eval 間のばらつき）。
  run 間の揺れを見るなら 3 run へ増やす必要がある。
- 初回実行で eval-14 without_skill・eval-15 両 configuration がセッション上限（api_error）で失敗した。
  上限リセット後に同一プロンプト・同一 fixture で再実行し、その結果を採用している。
- PR #184 のレビュー対応で測定対象スクリプトは 9 回変更された。
  最終 HEAD（ゲート正規表現の許容リスト化まで）に対して eval-14 と eval-15 を取り直しており、両者が今回の変更（applied-to の空白入り空配列・未知 status の検出・mktemp フォールバック・checkpoint 4 行・ゲート正規表現）を直接踏む。
  契約（終了コード・出力様式・設定様式）が変わっていない他の eval は取り直していない。
- 修正 1（fixture の答え漏れ）: lifecycle-inconsistent の archive/INDEX.md の summary が、eval-14 のアサーションが検査している結論そのものを英語で書いていた（.agents/rules/eval-assertion-discrimination.md「入力が答えを持っていないか」に抵触）。
  下流に実在しうる日本語の summary へ置換し、バッククォート付き basename を別エントリの summary に置く罠は維持した。
- 修正 2（採点材料の穴）: run-skill-eval.sh の project-files スナップショットが拡張子ベースで .gitignore を拾わず、eval-8 のアサーション 5 が内容照合できなかった。
  .gitignore / .gitattributes を名前で対象に追加し docs/skill-development.md も更新。
  再実行では with_skill の .gitignore が実際に採取され 3 パターンを直接照合して採点している。
- 修正 3（非弁別項目の差し替え）: 修正 1 の後も eval-14 の旧アサーション 2 は baseline が満たした（INDEX 1 行と archive 実ファイルを突き合わせれば演繹でき、否定形は満たしやすい）。
  ルールの「検査項目を skill 固有側へ替える」に従い、プロンプトへ問いを追加し、アサーションを後退検知（両方検出）と弁別（kaizen-status-check.sh の sed 式を引用）の 2 本へ分割した。
  最終 run でも with_skill は該当行と sed 式を引いて PASS、baseline は自作の grep -oP を「本実装では」と断って FAIL。
  狙いどおり弁別している。
- 修正 4（アサーション 5 の到達性）: 「--reindex 後に再検査する」は run 間で言及が揺れた。プロンプトへ確認手順を問う一文を足した。
  最初の文言「修正をすべて適用した後に…」は適用の指示と読まれて run が読み取り専用でなくなり、result.json（最終メッセージのみ）に前半の根拠が残らず採点不能になったため、「その修正手順には、整合が取れたことをどう確認するかまで含めて」へ直して取り直した。
- ハーネスの制約（今回判明）: run の採点材料になるのは result.json の最終アシスタントメッセージと project-files / project-tree だけ。
  プロンプトが作業の実行を誘発すると回答が複数メッセージに分かれ、前半の根拠が採取物から落ちる。eval プロンプトは「実行させる」より「1 つの報告にまとめさせる」形にする。
- read 隔離: without_skill 10 run すべて contamination verdict = clean。
  baseline は 10 run 中 8 run で「kaizen スキルがこの環境に無い」と明示的に報告しており、スキル資産への到達は起きていない。
- 非弁別アサーション（baseline も満たした 10 項目）: eval-1 の .kaizen 作成／根本原因記述、eval-4 の「Stop に echo が無い」（Stop Hook 自体が無く空振りで成立）、
  eval-9 の決定性の言及、eval-12 の既存ノート特定と追記方針、eval-14 の archive 不整合検出と旧形式の扱い、eval-15 の Codex transcript 弁別 2 項目。
  いずれも汎用の grep / 自作スクリプトで到達できる。後退検知として残す。
- 時間・トークンは with_skill 側が短く少ないが、eval-4 without_skill が 392.9s / 34k tokens（自作 hook 実装）と外れ値で、両者のばらつきが大きい。
  この差は有意と読まない。
