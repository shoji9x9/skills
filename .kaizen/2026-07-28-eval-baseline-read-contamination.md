---
date: 2026-07-28
type: other
priority: medium
status: pending
session: claude-code
---

# eval の without_skill ベースラインは read 汚染を防止・検知してから弁別を測る

## 事象

replace-strategy の回帰評価 iteration-5 で、without_skill（baseline）の 3 run すべてが、
使い捨てプロジェクト外にある本リポジトリの skills/replace-strategy/（SKILL.md・references・assets）を
自発的に発見・参照して回答した（eval-7/9 は result.json で明言、eval-8 は生成物の
テーブル見出しがテンプレートと一字一句一致）。全 assertion を baseline も満たし、
Pass Rate の Delta +0.00 は弁別測定として無効になった。

## 根本原因

- なぜ baseline がスキルを参照できたか? → run-skill-eval.sh の使い捨てプロジェクトは
  cwd と skill 設置有無を隔離するが、claude -p はマシン上の任意パスを read でき、
  prompt 中のスキル名から探索してリポジトリ本体を発見できる
- なぜ防げなかったか? → 公正性の根拠が「親に .claude/skills が無い」（docs/skill-development.md）
  のみで、read 面の隔離も汚染検知も設計されていない
- なぜ設計されなかったか? → 「エージェントが自発的にスキルソースを探索する」経路が
  想定・検証されていなかった ← 根本原因

関連: [[2026-07-23-eval-assertion-discrimination]]（アサーション設計の弁別）とは別機構。
アサーションを skill 固有にしても read 汚染下では baseline が満たしてしまう。

## 提案

スキル eval の without_skill ベースラインは、スキル資産への read アクセスを遮断または検知してから弁別（Delta）を測る。汚染した run の Delta は無効として benchmark に明記する。

- run-skill-eval.sh: without_skill 実行時に使い捨てプロジェクトの settings で
  スキルソース（本リポジトリ配下）の Read を deny する、または実行後に result.json /
  生成物へスキルソース参照・テンプレ一致がないかの汚染検知を組み込む
- docs/skill-development.md: 「公正なベースライン」の記述に read 汚染の限界と
  汚染検知の採点手順を追記する
- 横断スコープ: 本ハーネスで測定する全スキルの benchmark に共通（過去の Delta も
  汚染有無は未検証）。採点者（grader）にも「baseline がスキル資産を参照した形跡」の
  確認を標準項目にする
