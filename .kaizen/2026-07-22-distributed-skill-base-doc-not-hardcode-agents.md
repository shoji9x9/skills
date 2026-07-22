---
date: 2026-07-22
type: rule
priority: high
status: pending
session: claude-code
---

# 配布スキルは基底ドキュメントを AGENTS.md に決め打ちしない

## 事象

issue #107 対応中、multiagent-setup が「常に守るべき方針の置き場所」を AGENTS.md 前提で
書いていた。ユーザー指摘で、インストール先は AGENTS.md を使わず CLAUDE.md のみ／
`.github/copilot-instructions.md` のみのことがあると判明。横断調査で kaizen も AGENTS.md を
機能的に決め打ちしており（自己設定制約の追記先・学び配置指針）、下流で伝播しないと分かった
（issue #108 起票）。

## 根本原因

最低 3 階層の「なぜ」:

- なぜ AGENTS.md 前提で書いたか? → 配布元リポジトリが AGENTS.md 基底のマルチエージェント構成で、
  その前提を無意識に配布スキルへ持ち込んだ。
  - なぜ気づかなかったか? → 「基底ドキュメント」という抽象（AGENTS.md／CLAUDE.md／
    `.github/copilot-instructions.md` のどれか）で考えず、具体名 AGENTS.md で書いた。
    - なぜ抽象で考えなかったか? → 配布スキル編集時に「下流の構成は多様」という前提を想起させる
      仕組み（rule 等）が無かった ← 根本原因

KEDB 照合: 既存 `.kaizen/*.md` に基底ドキュメント一般化の同種学びなし（初出）。
横断スコープ: 全配布スキル（`skills/**`）。multiagent-setup は #107 で一般化、kaizen ほかは #108。

## 提案

配布スキル（`skills/**`）を編集するときは、基底ドキュメントを AGENTS.md に決め打ちせず、
AGENTS.md が無い下流（`CLAUDE.md` / `.github/copilot-instructions.md` のみ）でも成立するよう
一般化する（判定は multiagent-setup の `references/component-selection.md` を single source of
truth として参照する）。
実現案: 上記を `skills/**` スコープの rule（`paths: skills/**`）として追加する。
