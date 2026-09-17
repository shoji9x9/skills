# Skill Benchmark: parity-suite

**Model**: claude-code / claude-opus-5（CLI 2.1.274 (Claude Code)）
**Date**: 2026-09-17
**Evals**: 37 のみ（`with_skill` / `without_skill` 各 1 run。変更確認スコープなので Delta の数値は語らない）

## 何を変えたか（Issue #392 / #393）

被覆表が立つ 3 つの集合のうち、**部品の集合**と**インスタンスの集合**にだけ来歴（`source`）と完全性（`complete`）の宣言が無く、
載せなかった部品が期待セルにすら現れないまま `unmeasured` 0 で収束していた。表の直下に `component_inventory`、
`components[]` ごとに `instance_inventory` を新設し、`components[].source.kind` に `current-source` を足して語彙・キー欠落を
記録側・判定側の両方で検査する。一次情報源（`current-source`）以外で列挙したときは
`stronger_source_unavailable_reason` を要求する（`fail_closed` の裏側＝読めるのに読まなかった）。

eval 37 は、受領ソースが読めるのに画面を歩いて部品とページを洗い出し、列数の一致と未検証領域の一行を根拠に
引き渡す案を押し戻せるかを見る。

## Summary

| eval | with | without | 弁別した assertion |
|---|---|---|---|
| 37 部品とインスタンスの集合の来歴 | **8/8** | 4/8 | 2（受領ソースから先に静的列挙し画面は期待値の確定に使う）・3（周辺部品が本体の軸に現れない機序）・5（一次情報源を使わなかった理由の申告）・7（現行側のベースラインまで採り直しになる） |

2 run とも `isolation.txt` は `sandboxed`、`without_skill` の `contamination.txt` は `clean`。

## 読み取れたこと

- `without_skill` も「母集団が自己申告なので未測定 0 は完全性の証拠にならない」「観測値と定義値は別」「注記は測定の代わりにならない」までは自力で到達した（assertion 1・4・6・8 は後退検知で、Delta には寄与しない）。
  eval 追加時の想定では 6（機械可読な欄に残す）が弁別すると書いていたが、実測では baseline も「下流は本体の数字を読む」まで述べたので弁別しなかった
- `without_skill` はソースへ一次情報源を切り替えるところまでは述べたが、**実 UI の役割を「突き合わせ用の二次資料」に置く**ため、
  集合の列挙をソースに、期待値の確定を画面に割り当てる形にはならなかった（assertion 2）
- 画面から見えない理由を権限・データ状態・フラグ・別モードで説明し、**周辺に置かれた部品が本体の軸に現れないので集合の側で落ちる**という機序には触れなかった（assertion 3）。
  取りこぼしの候補としては右クリックメニュー・エクスポートを「グリッドのオプション」として挙げている
- 弱い情報源を選んだ理由の申告（`stronger_source_unavailable_reason`）は baseline に無く、出典欄と母集団の確定度の記録で代替していた（assertion 5）
- 後戻りコストの見積りも、**現行側のベースラインとノイズ基準値の採り直し**（現行環境を撤去済みなら採り直せない）には届かなかった（assertion 7）。
  応答に「ベースライン」「ノイズ基準」の語は 0 件
- 宣言の欠落・語彙外・完全性の未宣言・理由の欠落を未測定として数える判定そのものは
  `scripts/coverage-check.test.js` / `scripts/coverage-expand.test.js` / `scripts/coverage-record-judge-parity.test.js` が担う（会話の eval では弁別できない）
