---
date: 2026-08-12
type: rule
priority: high
status: pending
applied-to: []
session: claude-code
---

# eval のプロンプトを変えたら、その eval の全 assertion の到達性を取り直す

## 事象

Issue #196 の実装後に eval 4 の assertion を 2 本追加し、回帰 eval を回したところ
プロンプトと assertion の対応が 2 度続けて壊れ、4 run（約 $5・40 分）を捨てた。

- 1 度目: 追加した assertion（`labelAt` を示す）を引き出す文がプロンプトに無く、
  with_skill は「ラベルに重なってたり」をノードラベルとして処理して 5/6 に留まった。
- 2 度目: プロンプトを「エッジのラベルが曲がり角に重なる」へ絞った結果、
  今度は既存 assertion（`lp` を空き辺へ移す）を引き出す文が消え、run は `lp` に一切触れなかった。

## 根本原因

- なぜ壊れたか? → assertion を追加したときも、プロンプトを変更したときも、
  その eval の**全** assertion について「プロンプトのどの文が引き出すか」を対応付け直さず、
  追加・変更した項目だけを見た。
  - なぜ? → 症状を絞る方向の書き換え（「ラベル」→「エッジのラベル」）が、
    絞った側に依存していた既存 assertion を到達不能にすると認識していなかった。
    - なぜ? → `.agents/rules/eval-assertion-discrimination.md` の到達性検証は
      「assertion を 1 本ずつ自問する」と書かれ、**assertion を書く時点**の手続きとして読める。
      プロンプト側を編集したときに全 assertion を取り直す規定が無い。← 根本原因（対策可能）

横断スコープ: 対象は `skills/*/evals/**` に閉じるため、既存 rule の paths でカバーできる。

KEDB 照合: [[2026-07-23-eval-assertion-discrimination]] /
[[2026-07-30-eval-discrimination-can-be-unmeasurable]] はいずれも `applied`。
両者は「書いた assertion が測れるか」を扱い、**プロンプト編集による既存 assertion の破壊**は扱っていない。

## 提案

eval のプロンプトを変更したら、その eval の**全** assertion について
「プロンプトのどの文が引き出すか」の対応を作り直す（追加・変更した項目だけを見ない）。

`.agents/rules/eval-assertion-discrimination.md` に追記する:

- **プロンプトと assertion は対で検査する。** assertion を足したときだけでなく、
  プロンプトを 1 語でも変えたら、その eval の全 assertion について
  「どの文が引き出すか」の対応表を作り直す。引き出す文が無い assertion は、
  プロンプトに問いを足すか assertion を落とす。
- **症状を絞る書き換えは、絞った側に依存する既存 assertion を到達不能にする。**
  「ラベル」→「エッジのラベル」のように限定語を足すときは、
  既存 assertion が依存していた語が残っているかを先に確認する。

---

## 事象（2 件目・2026-08-27）

Issue #222 の実装で `issue-start` に新規 eval を書き、
prompt「issue-start 91 に着手して。…worktree で作業してほしい。」で 2 run 回したところ、
with_skill / without_skill とも step 2（repo 一致確認）で停止し、
検査対象の step 7（branch と worktree の順序）へ到達せず採点不能になった。
レートリミット直前に 2 run を捨てた。

prompt を dry-run（「まだ何も実行しないで、手順だけ先に示して」）へ改めたら
両 configuration とも到達し、Delta 0.86（with 1.00 / without 0.14）が出た。

## 根本原因（2 件目）

- なぜ到達しなかった? → prompt が実行を要求し、sandbox に git リポジトリが無いので早期停止した
  - なぜ気付かなかった? → 新規 eval を書く時点で到達性を検証しなかった
    - なぜ? → この制約は**同じスキルの過去 benchmark の `notes`**
      （`tests/issue-start/iteration-3/benchmark.json`「使い捨てプロジェクトは git リポジトリでは
      ないため、実ブランチ作成・commit・PR を要求する assertion は with_skill でも構造的に
      満たせない」）に既にあった。一方 rule 側は「外部依存より先の工程を検査項目にしない」
      までで、**prompt の要求形が到達性を決める**という具体が無い ← 根本原因（対策可能）

1 件目（プロンプト編集で既存 assertion が壊れる）と同じ rule の同じ節が不足しており、
到達性の検証が「assertion を書く時点」の話としてしか読めない点が共通の原因。

## 提案（追記分）

`.agents/rules/eval-assertion-discrimination.md` の「到達」に追記する:

- **prompt の要求形も到達性を決める。** eval 環境の使い捨てプロジェクトは git リポジトリでは
  ないので、「実行して」「着手して」と実行を要求する prompt は、repo を前提とする手順へ
  到達せず早期停止する。手順・判断そのものを検査したいなら
  dry-run 形（「まだ実行しないで、手順だけ示して」）で問う。
- **新規 eval を書く前に、そのスキルの直近 benchmark の `notes` を読む。**
  到達しない工程は「構造的に満たせない」として既に記録されていることがある。
