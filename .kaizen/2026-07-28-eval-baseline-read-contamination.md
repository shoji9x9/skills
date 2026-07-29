---
date: 2026-07-28
type: other
priority: high
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

**2026-07-29 に再発（Issue #146 の回帰評価）。** replace-strategy eval-11 の without_skill run-1 が、
スキル未設置にもかかわらず `dependency_policy` の三値契約・各 references キーの読み手・空値の枠の目的を
正確に再現し 4/4 で pass した（弁別ゼロ）。使い捨てプロジェクトは空（`project-tree.txt` は `.` のみ）で、
ハーネスの設置漏れではない。

**このとき汚染経路を実測で確定した。** ハーネスの `SKILL_EVAL_RUNNER` に bwrap ラッパー
（`--dev-bind / / --tmpfs <リポジトリの親ディレクトリ>`）を渡して同一プロンプトを再実行すると、
baseline はスキル資産を発見できず 0/4 へ落ちた（`grep` でファイルシステム全体を探索した旨を自ら報告）。
汚染経路はローカル作業ツリーの read であり、隔離すれば弁別は回復する。

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

2026-07-29 の実測を踏まえた具体化:

- **遮断は `SKILL_EVAL_RUNNER` で実装できる**（ハーネス本体を変えずに検証済み）。without_skill では既定で
  サンドボックス経由の runner を使い、リポジトリを `--tmpfs` で隠す。bwrap が無い環境はフォールバックし、
  遮断できなかったことを run に記録して汚染検知へ回す
- **汚染が疑われる baseline は、遮断した環境で再実行して切り分ける**（run を捨てる前に経路を確定させる）。
  汚染した run は `grading.json` を置かず集計から除外し、benchmark.md に経緯（汚染の根拠・再実行の結果）を残す
- **残る穴を明記する**: 対象リポジトリが PUBLIC の場合、`gh` / WebFetch 経由でスキル本文を取得する経路は
  ローカル遮断では塞げない。採点時に「baseline 応答がスキル固有の語彙・契約を再現していないか」を確認する項目は残す
