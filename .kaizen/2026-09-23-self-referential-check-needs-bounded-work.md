---
date: 2026-09-23
type: rule
priority: high
status: applied
applied-to:
  [
    AGENTS.md,
    .agents/rules/state-space-and-mutation-proof.md,
    scripts/check-mutation-proof.test.js,
    vitest.config.js,
  ]
session: claude-code
---

# 自分自身を検査対象にする検査は、1 回の測定が起動する自分の数を縛らないと指数的に膨らむ

## 事象

PR #437 で、変異実行器（`scripts/check-mutation-proof.js`）に「差分に当たる宣言だけを測る」選択を足し、
その選択ロジックへ変異を当てた（`CHANGED-HITS`: 当たり判定を常に真にする）。

この変異を実証する run が **30 分以上終わらず、runner のプロセスが 21 本以上に膨らんだ**。
機序は自己参照:

1. 実行器の自己テスト（`check-mutation-proof.test.js`）は、テストごとに runner を起動する
2. その runner は対象テストファイル（＝自己テスト）を vitest で走らせる
3. 自己テストの中に `--changed-since` を `--only` 無しで呼ぶテストがあり、変異後は**全宣言**が選ばれる
4. 選ばれた宣言には自分自身の宣言が含まれるので、(1) へ戻る

強制終了したあと、殺された runner が当てていた変異が作業ツリーに残った（1 件は前回入れた復元機構が
次回起動で戻し、もう 1 件は別プロセスの復元情報が使い捨てディレクトリごと消えていて `git checkout` で戻した）。

## 根本原因

- なぜ膨らんだか? → 1 回の測定が起動する自分の数に上限が無かった
  - なぜ上限が無かったか? → 自己テストが `--only` 無しで実行器を呼んでおり、測る量が**選択の結果**に比例した
    - なぜそれを設計時に見なかったか? → 変異の**検出力**（狙ったテストが落ちるか）だけを見て、
      変異が**測定量**を変える経路を見ていなかった ← 根本原因（対策可能）

自己参照の検査では、変異が「判定の正しさ」ではなく「仕事の量」を変えうる。量が入力に比例する形だと、
自分を呼ぶ深さの分だけ掛け算になる。

## KEDB 照合

`kaizen-kedb-match.sh` は既存の記録にヒットなし（exit 1）。近縁は
[[2026-09-22-check-measured-installed-copy-not-canonical]]（検査対象の**場所**を実行時解決に委ねた）だが、
あちらは「何を測っているか」、本件は「どれだけ測るか」の軸で別物。

横断スコープ: 自分自身を対象に含む検査は現状この 1 本（変異実行器）。他の検査スクリプトは
対象が固定（`skills/**` や `scripts/*.mutations.json` の宣言）で、自分を起動しない。

## 提案

自分自身を検査対象にする検査では、変異が測定量を変えないよう、テスト側で 1 回の測定を有界にする（`--only` 等）。

- 自己テストから実行器を呼ぶときは、測る対象を明示して 1 件に絞る（選択の結果に比例させない）
- 変異を足すとき「この変異は判定を変えるか、仕事の量を変えるか」を 1 行で確かめる
- 反映済み: `AGENTS.md`・`.agents/rules/state-space-and-mutation-proof.md` に規約として追記し、
  `check-mutation-proof.test.js` の該当テストを `--only` 有界化（理由をコメントに明記）。
  あわせて `vitest.config.js` で `fileParallelism: false`（tracked ファイルを変異させるテストと兄弟テストの競合を消す）
