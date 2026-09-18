---
date: 2026-09-16
type: hook
priority: high
status: pending
applied-to: []
session: claude-code
---

# assertion の到達性は文章規約でなく決定論的ゲートで要求する

## 事象

Issue #389 の eval 36 で assertion 6 を「present は見た目の担保ではない／導出が出すのは集合まで／
見た目の合否は画素比較と特性照合が出す」と 3 主張を束ねて書いた。prompt は「撮る状態をどう決めて
何をどこに残すか」「あとで状態を足したら何が起きるか」しか聞いておらず、3 つ目を引き出す文が無い。
`with_skill` が 2 run とも同じ箇所で落ち、うち 1 run は「修正の効果確認」として追加で回したぶん。
さらに落ちた原因を assertion 側の欠陥と切り分けられず「問われていないことを要求している」と擁護し、
ユーザーの是正（「無理がある」）を要した。

## 事象（2026-09-17 の再発）

Issue #386 / #384 / #385 をまとめた PR で新設した 4 eval のうち **3 件が欠陥を持ったまま実走**し、
8 run 実走後に 6 run の取り直しが発生した（executor 実走が 1.75 倍）。形は 3 つで、うち 2 つはこの記録に無い形。

- **到達性**（既知の形）: `parity-replace` eval 19 の「この形の差は 3 経路のどれにも出ないことがある」を引き出す文が
  prompt に無く、`with_skill` でも 6/7 だった
- **正本整合（新しい形）**: `parity-suite` eval 37 の prompt に「34 プロパティが全部一致」と書いたが、
  同じ PR で `FIXED_PROPERTIES` を 36 へ増やしていた。`with_skill` は件数の不一致を手がかりに
  「採取が古いスキーマで行われている」という**別の筋**へ寄った（答えとしては妥当だが測りたい分岐ではない）
- **正しい答えを不合格にする assertion（新しい形）**: `parity-diff` eval 26 が「両側の要素の矩形を並べて出す」を要求し、
  スキルの契約どおり「使い捨ての 2 枚は捨てて本経路で撮り直す」と答えた run を落としていた（弁別も 0 だった）

## 事象（2026-09-18 の再発・3 度目）

Issue #388 / #239 / #337 の PR で新設した 5 eval のうち **3 eval・4 assertion が到達不能**のまま実走し、
初回 10 run のあと **切り分け 9 run ＋ 取り直し 6 run** が追加で必要になった（実走が 2.5 倍）。
形は 2 つで、どちらもこの記録に無い形。

- **選択肢が 1 つしか立たない状況で選択を要求**: `golden-dataset` eval 20 の
  「足すか gaps に記録するかを設計の段で選ぶ」は、prompt の分岐が消費側の使う分岐だけで、
  正解が常に「足す」になる。3 run 中 1 run しか到達しなかった
- **prompt が触れない工程の分担を要求**: `parity-suite` eval 42 の
  「収束判定で読むのは parity-diff」は prompt が下流工程に触れず 0/3。
  `parity-suite` eval 41 の「対応する穴の無い古い宣言も落ちる」も、
  prompt に古い宣言が出てこないため 0/3

対処は prompt へ材料を足す（guest 行・`unmeasured` へ戻す案）か、assertion を prompt の材料の
範囲へ絞るかの二択で、どちらも再実走を要した。

## 根本原因

- なぜ 2 run とも同じ箇所で落ちた? → assertion 6 の 3 つ目の主張を引き出す文が prompt に無い（到達不能）
  - なぜ気付かず確定させた? → assertion 追加時に、全 assertion について
    「引き出す prompt の文」を引用して並べた対応表を書かなかった
    - なぜ書かなかった? → その要求は `.agents/rules/eval-assertion-discrimination.md` の
      文章にしかなく、書いた証拠を残す場所も、書いていないことを検出する仕組みも無い。
      eval を足す commit は lint も test も素通りする ← 根本原因（対策可能）

KEDB 照合: [[2026-09-02-eval-assertion-reachability-must-be-written]]（`status: applied`）と同一の失敗。
その記録自身が [[2026-08-12-eval-prompt-change-breaks-assertion-reachability]] を「既に 3 件記録」と
書いており、規約を文章で強めた後の再発にあたる。applied ノートには追記しない。
[[2026-09-16-prose-rule-recurrence-needs-deterministic-gate]]（`status: pending`）が、この場合は同じ規約を
書き足さず決定論的ゲートへ上げよと言っている。

横断スコープ: 対象は `skills/*/evals/evals.json` 全体（parity-suite だけでなく全スキル）。
現存する全 eval が対応表を持たないため、ゲート導入には backfill が要る。

## 提案

eval の assertion は、それを引き出す prompt の文を機械検査できる形で併記し、検査に通らない eval を commit させない。

- 各 eval に `reachability` を足す。要素は
  `{ "assertion": "<assertion のテキスト>", "prompt_quote": "<その eval の prompt 内に実在する部分文字列>" }`
- `scripts/check-eval-reachability.js` を新設し、lefthook pre-commit と CI の `Lint` ジョブへ入れる。
  fail 条件: 対応要素が無い / `prompt_quote` が空 / `prompt_quote` が prompt の部分文字列でない /
  `assertion` がその eval の assertions に無い（テキスト一致。位置で対応づけない）
- 限界を明記する: 複数主張を束ねた assertion は 1 主張ぶんの引用で通る。compound 自体は検出しないので
  「1 assertion 1 主張」はレビュー観点として rule に残す
- backfill のコストが大きいため、apply 時に「全 eval を一度に / 変更した eval から段階的に」を決める
- **prompt に正本から導ける件数・バージョン値を書かない。** `FIXED_PROPERTIES` の件数・ツールの `VERSION` のような値は、
  正本を更新した瞬間に eval が別物になる（同じ PR で正本を変えるときは特に踏む）。書くなら「集合が全項目一致」のように
  値を持たない表現にする
- **assertion が「選ぶ」「どちらか」を要求するなら、選択肢それぞれを立たせる材料が prompt にあるかを見る。**
  材料が片方しか無いと正解が一意に決まり、選択の語彙は出てこない（機械検査は部分文字列の実在までしか見ないので、
  compound と同じくレビュー側で担保する）
- **下流工程・他スキルの分担を問う assertion は、その工程に触れる文が prompt にあるときだけ置く。**
  収束判定・差し戻し先のような「次の工程が何を読むか」は、prompt がその工程を話題にしない限り引き出されない
- **assertion を確定する前に「その契約を満たす正しい答えが複数あるとき、全部通るか」を見る。**
  1 つの手順だけを書いた assertion は、正本が許すもう一方の手順で答えた run を落とす
  （`docs/skill-development.md`「push 前の整合パス」項目 4 の「正しい回答が不合格になる回帰テストを埋め込まない」と同じ失敗）
