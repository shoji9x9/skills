---
date: 2026-10-31
type: hook
priority: high
confidence: medium
status: pending
applied-to: []
session: copilot
---

# Copilot のセッション記録を走査できず、コミットが停止した

## 事象

PR #852 の CI 失敗を修正し、コミットしようとしたところ、kaizen のコミット前チェックが未抽出の活動を判定できず停止した。
自分のセッションに対応するセンチネルは Copilot の記録を指していたが、エージェント名は `claude-code` だった。

## 根本原因

コミット前チェックは自分のセッションのセンチネルを検出し、活動の候補を走査しようとした。
候補走査は Claude Code と Codex の形式を対象にしているため、Copilot の記録を判定できなかった。
チェックは判定不能を成功として扱わず、手動での抽出を求めた。
Copilot CLI は `.github/hooks/*.json` に加えて、`.claude/settings.json` のフックも「repo settings」として読み込む（Copilot の hooks のリファレンス）。
そのため、Copilot のセッションでも引数なしの `kaizen-stop-mark.sh` が Stop で実行され、エージェント名 `claude-code` のセンチネルを作った。
同じ理由で、引数なしの `kaizen-precommit-gate.sh` も PreToolUse で実行される。他セッションのセンチネルの警告を exit 1 で返し、Copilot はこれを「hook errored」として commit を拒否した。

## 根拠

候補走査とコミット前チェックの判定不能は実行して再現した。拒否は CLI のログ（`Error in preToolUse hook from "repo settings" (fail-closed): Hook command failed with code 1` と kaizen の警告の stderr）で確かめた。
KEDB 照合では `.kaizen/2026-09-30-skill-body-injection-false-user-correction.md` が一致した。この記録は非発話レコードの誤検知についてで、今回とは原因が異なる。
`.kaizen/archive/2026-09-09-codex-transcript-schema-drift-blocks-kaizen.md` は Codex の未対応レコードで判定が止まった事例である。

## 提案

活動を記録するエージェント（Claude Code・Codex・Copilot）ごとに、セッション記録とエージェント名を正しく判定できるか確認する。

- `kaizen-candidate-scan.sh` とコミット前チェックについて、Copilot の記録形式と Hook の入力を調べる。
- `.claude/settings.json` のフックが Copilot でも実行されることを前提に、kaizen のスクリプトが Hook の入力からエージェントを判定し、Copilot では警告を exit 0 で返しエージェント名を `copilot` と記録するよう検討する。
- 判定できない記録を成功扱いにしない条件を維持し、候補を検出する場合と候補がない場合を確かめる。
- 効果は Copilot での手動抽出による中断を減らせることである。費用は記録形式の変更への追随とテストの保守である。実装前に再発頻度も確認する。
