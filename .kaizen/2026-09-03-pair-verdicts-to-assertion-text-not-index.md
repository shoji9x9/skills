---
date: 2026-09-03
type: rule
priority: high
status: pending
applied-to: []
session: claude-code
---

# 採点の判定は位置ではなく対象のテキストで対応づける

## 事象

eval 15 の assertion 配列へ新しい 1 本を **index 2 に挿入**した後、採点の判定リストを
挿入前の並びのまま書き、`zip(assertions, verdicts)` で `grading.json` を生成した。
index 6〜8（checkpoint 契約 / `-codex`＋`-copilot` 併存 / 未知 type の構造弁別）で
判定と assertion の対応がずれ、**応答が正しく説明していた構造弁別を FAIL、
一度も触れていない併存ケースを PASS** として記録した。

pass 件数（7/11）は偶然変わらなかったため、`summary` を見るかぎり異常が無く、
ユーザーへの報告でも「構造弁別は pass した」と本文で述べながら記録は FAIL のままだった。
`grading.json` の `text` と `evidence` を 1 行ずつ突き合わせて初めて気づいた。

## 根本原因

- なぜ誤った記録になったか: 判定を **assertion の位置（配列 index）** で対応づけたから。
- なぜ位置で対応づけたか: 判定リストを「前回の並び」を写して書き、挿入によって
  以降の index が 1 つずつ後ろへ動くことを反映しなかったから。
- なぜ気づかなかったか: **件数が保存される**ズレだったため `summary.passed` が変わらず、
  検算に使える不変量が無かった。個々の `evidence` は自然文なので、機械的な整合検査も無い ← 根本原因

KEDB を `ズレ` / `採点` / `インデックス` × `grading.json` で照合しヒット無し。
陽性対照として `unsupported` × `kaizen-candidate-scan.sh` では既存 2 件がヒットするので
照合器の検出能力はある。横断確認では、同じ形は「片側に挿入されうる 2 つの列を
位置で綴じる」全ての箇所（eval の assertion と判定、fixture 一覧と期待値、
レビュー指摘と対応状況）に起こりうる。

## 提案

**採点・突き合わせの判定は、対象のテキスト（または安定した id）をキーにして対応づける。**
配列 index で綴じない。判定リストを書くときは各要素に対象 assertion の冒頭を写し、
生成時に「その assertion と一致するか」を検査して不一致なら中断する。

`.agents/rules/eval-assertion-discrimination.md` へ次の趣旨を追記する:

> assertion を 1 本でも**追加・削除・並べ替え**したら、採点の判定リストは位置ではなく
> assertion のテキストで対応づけ直す。生成前に対応表を突き合わせ、
> `summary.passed` が変わらないことを正しさの根拠にしない
> （挿入によるズレは件数を保存するため、合計値では検出できない）。
