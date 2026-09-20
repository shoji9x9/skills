---
date: 2026-09-18
type: rule
priority: medium
status: applied
applied-to: [.agents/rules/state-space-and-mutation-proof.md]
session: claude-code
---

# 実 trace を採って parser を設計したのに、同じ trace から stub を作り直さなかった

## 事象

Issue #377 で claude-code の stream-json を解析する実装を書く際、**実 CLI を叩いて trace を採取し**、
イベント形状（`system`/`init`・`assistant` の `tool_use`・`user` の `tool_result`・末尾の `result`）を確認した。
実装とドキュメントはその実測に基づいて書いた。

**ところがハーネスのテスト stub（`scripts/run-skill-eval.test.js`）は更新しなかった。**
stub は `tool_use` だけを出し、**`tool_result` を 1 件も出さない**形のままで、
それでもテストは緑だった——当時の実装が `tool_result` を読んでいなかったため。

レビュー 2 巡目で「読んだ証拠は成功した結果と相関させよ」という指摘を受け、`tool_result` を読むようにしたところ、
**ハーネスのテストだけが落ちた**。stub が実 executor の出さない形（結果の無い呼び出し）を出していたと分かった。
`tool_result` を足す修正の中で、stub の JSON 文字列に書いた `\n` が JS テンプレートリテラルで実改行へ展開され、
JSON 行が 2 行に割れる別の欠陥も踏んだ。

## 根本原因

1. なぜ stub がずれたか → 実 trace を採ったとき、**parser の設計にだけ使い、stub の更新入力として使わなかった**。
2. なぜ気づけなかったか → stub は**現在のコードが読むフィールドだけ**を持っていれば緑になる。
   読まないフィールドの欠落は、コードがそれを読み始めるまで**テストの緑と区別が付かない**。
3. なぜその構造を許したか → 「実測で検証する」規律は**本体の実装**に向いており、
   **fake / stub / fixture を実測から作り直す**という要求がどこにも無い ← 根本原因（対策可能）

## KEDB 照合

`stub` / `契約`、`fixture` / `実測` / `乖離` で照合。直接一致は
[[2026-09-01-matching-key-material-state-space]]（`applied`）のみで、あちらはキー材料の状態空間の話で別軸。
`.agents/rules/state-space-and-mutation-proof.md` の「2. fixture に持たせるもの」は
**前段ゲートの入力**と**一次情報を持たせる**ことを要求するが、
**「外部ツールを模した fake は実測 trace から作り直す」は含まれていない。**

横断スコープ: 同型は外部ツールを模す全ての fake。本リポジトリでは `scripts/run-skill-eval.test.js` の executor stub、
`scripts/eval-sandbox.test.js`、parity 系スキルが同梱する record/replay の固定応答が該当する。

## 提案

外部ツールの出力を模した fake（stub・fixture・record/replay）は、実測 trace を採ったその実行の中で同じ trace から作り直す。

- 反映先: `.agents/rules/state-space-and-mutation-proof.md` の「2. fixture に持たせるもの」へ 1 項目追加する
- 文面の骨子: **fake は「いま読んでいるフィールド」ではなく「実物が出すレコードの単位」で作る。**
  呼び出しと結果、開始と完了のように**対で出るレコードは対で持たせる**（片方だけの fake は、
  コードが相手側を読み始めるまで緑のまま通り、そのとき初めてずれが露見する）
- **実測して形を確認したら、その trace を fake の更新にも使う。** 確認に使っただけで終えない
- fake を文字列として埋め込む場合（テンプレートリテラル内のシェルスクリプト等）は、
  **埋め込み先のエスケープ規則**を通った後の実バイト列で 1 度検証する（`\n` が実改行へ展開されて行が割れる形を踏んだ）
