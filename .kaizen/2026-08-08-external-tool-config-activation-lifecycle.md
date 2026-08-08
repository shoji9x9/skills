---
date: 2026-08-08
type: rule
priority: high
status: applied
session: codex
---

# 外部ツール設定は構造だけでなく有効化ライフサイクルまで検証する

## 事象

Codex の Hook 設定を現行の JSON 構造へ修正し、Stop / PreToolUse / SessionStart の定義と
コマンド形状を検証したが、初回セットアップに `/hooks` でのレビューと信頼を含めていなかった。
そのため設定ファイルが正しくても、Codex が非 managed command Hook をスキップする状態を
「セットアップ完了」と案内していた。レビューで指摘され、初回と定義変更後の信頼手順を追加した。

## 根本原因

- なぜ Hook が動かない状態を完了としたか → JSON の入れ子・キー・matcher・command が正しいことを
  セットアップ成功の判定にしていた
  - なぜ構造の確認だけで足りると考えたか → 外部ツール検証を「設定がパースされるか」と捉え、
    書き込み後に trust / approval を経て有効になる状態遷移を端から端まで追わなかった
    - なぜ状態遷移を追わなかったか → 既存ルールは構造とフィールド意味論を明記していたが、
      有効化・再読み込み・定義変更後の再承認をセットアップ完了条件として名指ししていなかった
      ← 根本原因

KEDB 照合: `.kaizen/2026-07-27-shared-contract-lifecycle-walkthrough.md` は共有契約の
ライフサイクル実走を扱う適用済みの学びであり、同じ「参照整合だけでは実行可能性を証明できない」型に当たる。
適用済みファイルには追記せず、外部ツール設定に閉じた恒久的なルールを直接強化する。

横断スコープ: Codex Hooks に限らず、feature flag、trust / approval、再起動・再読み込み、
定義変更後の再承認を持つ外部ツール設定を例示する全配布スキルに同じ抜けが起こり得る。

## 提案

外部ツール設定は、構造・フィールド意味論に加えて、書き込みから実際の有効化までの状態遷移を公式一次情報で確認し、trust / approval・feature flag・再読み込み・定義変更後の再承認が必要ならセットアップ完了条件と回帰評価へ含める。

`.agents/rules/external-tool-format-verification.md` にこの確認を追加する。個別対策として、
`skills/kaizen/references/setup.md` と eval 10 には Codex CLI の `/hooks` による初回信頼、
信頼前のスキップ、定義変更後の再レビューを反映済み。
