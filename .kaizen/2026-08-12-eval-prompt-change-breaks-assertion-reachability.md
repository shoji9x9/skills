---
date: 2026-08-12
type: rule
priority: medium
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
