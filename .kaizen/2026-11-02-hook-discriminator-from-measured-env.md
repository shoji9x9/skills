---
date: 2026-11-02
type: rule
priority: medium
confidence: medium
status: pending
applied-to: []
session: claude-code
---

# 別のエージェントの Hook の入力と環境変数を実測せずに、判定の条件を決めた

## 事象

Issue #853 で、`.claude/settings.json` の kaizen の Hook が Copilot から呼ばれたことを見分ける条件を、「入力に `timestamp` があり、`CLAUDE_PROJECT_DIR` が空」と決めて実装した。
テストとミューテーションテストは通ったが、Copilot CLI で実際に動かすと判定が働かず、commit は拒否されたままだった。
Hook の入力と環境変数をファイルに残して調べると、Copilot も `CLAUDE_PROJECT_DIR` を渡していた。条件を `COPILOT_CLI` に替え、テスト・文書・ミューテーションテストの定義を直すことになった。

## 根本原因

- 判定が働かなかったのは、Copilot が `CLAUDE_PROJECT_DIR` を Hook に渡していたからである。
- 渡さないと考えたのは、Copilot の公式のリファレンスに記載が無かったからである。記載が無いことを、渡さないことの根拠にした。
- テストで気づけなかったのは、Copilot の呼び出しを、自分の想定した環境（`CLAUDE_PROJECT_DIR=""`）で組み立てたからである。偽物を実測した記録から作っていなかった。
- 設計を決める前に、実際のエージェントで Hook を 1 回起動して入力と環境変数を記録する手順が無かった。そのため、実測は実装をすべて終えた後の動作確認まで遅れた。

## 根拠

1 回の観測だが、Hook の入力と環境変数を記録して原因を 1 つに絞った（`CLAUDE_PROJECT_DIR` は Copilot のプロジェクトのパスと同じ値だった）。
KEDB 照合では、「環境変数」と「Copilot」、「実測」と「Hook」と「偽物」、「CLAUDE_PROJECT_DIR」と「Copilot」で一致は無かった。
「Copilot」と「hook」では `.kaizen/2026-10-31-copilot-kaizen-transcript-recognition.md` が一致した。#853 の起点になった記録で、根本原因は違う。

## 提案

別のエージェントから呼ばれる Hook の呼び出し元を見分ける条件（入力の項目・環境変数）は、そのエージェントで Hook を 1 回起動して受け取った入力と環境変数を記録し、その記録から条件とテストの偽物を作る。

- 公式のドキュメントに記載が無いことを、その項目や環境変数が「無い」根拠にしない。
- 適用先の候補は `.agents/rules/external-tool-format-verification.md`。「分岐を書いたら、その分岐に入る状態を作って実測する」の項に、呼び出し元を見分ける条件は設計の前に実測する、と足す。
- 記録の取り方の例は、Hook のスクリプトの冒頭で `env` と標準入力を一時ファイルに追記する 1 行である。確かめた後で消す。
- チェック（Hook・lint）は作らない。1 回の観測で、機械で判定できる形が無いからである。
