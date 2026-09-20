---
date: 2026-07-23
type: rule
priority: high
status: applied
session: claude-code
---

# 回帰 eval のアサーションは「測れるか」を書いた時点で検証する

## 事象

同じ「アサーションが信号にならない」失敗が 3 通りの形で再発している。

**1. 弁別しない**（2026-07-23・dependabot-merge iteration-3）

eval 2・6 が with-skill / without-skill（baseline）とも pass_rate 1.00 となり、スキルの有無を
弁別できなかった（Delta に寄与しない空振り）。グレーダーも「一般知識で満たせる」と指摘した。
後からアサーションを skill 固有（設定ファイル `.config/skills/shoji9x9/skills.yml` の
`merge_method` 参照・`--watch` exit0 罠回避の終了条件）へ強化して同一 output を再採点し、
初めて baseline が落ちて弁別した（without 1.00→0.67）。

**2. 到達できない**（2026-07-28・parity-suite iteration-5 eval 7）

新規追加した「`dataset_version` として metadata.json の version を成果物へ記録する方針を示している」は
実行フロー 8（成果物記録）の工程だが、使い捨てプロジェクトには現行アプリが無く、run はフロー 1
（`http://localhost:8080` へ疎通不可）で**正しく**停止する。スキル挙動は正しいのに必ず fail し 3/4 になった。

**3. 採点材料が無い**（2026-07-28・golden-dataset iteration-4 eval 8）

「投入ツール（`seed/src/main.ts`）を更新して再生成している」を検査したが、`run-skill-eval.sh` の
スナップショット対象拡張子に `.ts` が無く、成果物から直接確認できなかった（`verification.md` の
記述と `project-tree.txt` で代替判定した）。さらに漏れたファイルが記録されないため、
「`project-files/` に無い ＝ スキルが作らなかった」と読む他のアサーションを誤判定させる穴でもあった。

## 根本原因

いずれも、アサーションを「**スキルが正しく動けば true になるか**」だけで書き、
**「その真偽を実際に測れるか」を書いた時点で検証していない**ことに帰着する。測れない形は 4 つある——
baseline も満たす（弁別できない）／fixture が用意できない外部依存の先の工程を検査している（到達できない）／
採点入力（`project-files/`）にその成果物が入らない（材料が無い）／
**fixture 自身が答えを述べている**（ベースラインがそれを読んで満たす。2026-07-30 に追加）。
eval 作成の手順に、この 4 点を書いた時点で確認する検証ステップが明文化されていない。

## 提案

回帰 eval のアサーションと fixture は、書いた時点で次の 4 点を検証してから確定する。

- **弁別**: baseline（スキル無し）が満たせない skill 固有の具体を検査項目にする。一般的な振る舞い
  （behind を検出、changelog を見る等）は baseline も自力で満たすため弁別しない。スキル固有の設定パス・
  正確な述語・固有コマンド・固有ガードを検査し、可能なら with/without 両 output を grep で突き合わせる
- **到達**: その fixture でスキルがそこまで到達できるかを確認する。fixture が揃えられるのは
  リポジトリ内の前提成果物だけで、現行アプリの稼働・実 DB・外部サービスは揃えられない。
  **外部依存より先の工程を検査項目にしない**（正常系 eval を足すときに踏みやすい）
- **材料**: 判定に要る成果物が採点入力に入るかを確認する。`run-skill-eval.sh` の `project-files/` は
  拡張子で絞り込むため、スキルが対象プロジェクトへ生成する言語（`.ts` / `.sql` 等）が対象に
  入っているかを見る。`project-files-skipped.txt` が 0 行でないときは「無い ＝ 作らなかった」と読まない
- **入力が答えを持っていないか**: fixture（設定・成果物・そのコメント）が、その eval の検査している結論を
  述べていないかを見る。判定・分類・あるべき置き場所・「意図的にそう作った」旨を fixture に書くと、
  **ベースラインがそれを読んで assertion を満たし Delta が消える**。fixture に置いてよいのは
  下流プロジェクトに実在しうる記述（調査メモ・運用上の但し書き）だけ。
  否定形の assertion（「〜を理由に停止していない」等）は「意図的」の 1 行で通ってしまうため特に危うい

`.agents/rules/` に `paths: skills/*/evals/evals.json` で絞ったルールとして追加する（eval 編集時に
確定ロード）。skill-creator の `grader.md`「Critique the Evals」は採点後の批評だが、本指針は
アサーションを書く時点に効かせる。関連: [[2026-07-20-eval-grading-schema-contract]]。

## 2026-07-30 の再発（到達 2 件と、4 つ目の「測れない形」）

Issue #160 の eval 整備で、上記「到達」が**同一セッション内に 2 件再発**した。いずれも
**プロンプトが問うていない話題の自発的言及**を assertion が要求しており、検査していたのは契約知識ではなく冗長さだった。

- `parity-diff` eval 8: 「`intentional_diffs.pending` へ退避させるのも禁止」を要求したが、プロンプトは `pending` に触れていなかった
- `replace-strategy` eval 15: 「`pending` が設定に残る唯一の作業中記録」「`component_diffs` は設定側に残す根拠」を要求したが、
  プロンプトはどちらも問うていなかった（`with_skill` が 4/6。落ちた 2 本はこれ）

どちらも**プロンプト側に質問を足して到達可能化**することで解決した（assertion を弱めるのではなく、問う形にした）。
結果として eval 15 は設計上の決定（`pending` を設定側に残す）そのものを検査する形になり、弁別も強まった（5/5 対 0/5）。

加えて、**入力（fixture）が答えを持っている**という 4 つ目の「測れない形」が見つかった。
`parity-diff` の新設 fixture が YAML コメントに移行先パスと「同一原因の `reason` が複製されている」診断を書いており、
ベースラインがそれを読んで正答していた（assertion 2 本の弁別がゼロ）。同種の cue はリポジトリ内の 7 fixture に
`（意図的）` 注記として存在しており、横断で除去した。

- 規約は `docs/skill-development.md`「回帰テストを実行する」の「fixture に『期待する答え』を書かない」に明文化済み
- **到達性の検証手段**: assertion を書いたら「この要求は**プロンプトのどの文が引き出すか**」を 1 本ずつ言えるか確かめる。
  言えないものは、プロンプトに問いを足すか assertion を落とす（自発的言及に賭けると run 間で揺れて flaky になる）
- 関連: [[2026-07-28-eval-baseline-read-contamination]]（同じ Delta の妥当性を、読み取り経路の側から壊す機構）

## 適用（2026-07-30・Issue #143）

`.agents/rules/eval-assertion-discrimination.md`（`paths` / `applyTo` = `skills/*/evals/**`）を新設し、
`.claude/rules/` と `.github/instructions/` にシンボリックリンク、`AGENTS.md` の参照ルールガイドに追記して 3 エージェントへ配線した。
4 点の検証（弁別・到達・材料・入力が答えを持っていないか）と到達性の検証手段（プロンプトのどの文が引き出すかを 1 本ずつ言えるか）を規定し、
read 隔離とは別機構であることを明記した。
