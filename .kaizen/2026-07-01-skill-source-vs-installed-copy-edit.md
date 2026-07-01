---
date: 2026-07-01
type: rule
priority: medium
status: applied
session: claude-code
---

# installed copy を直接編集させないため skill-reinstall ルールの scope を広げる

## 事象

Issue #62（pr-finalize-loop の更新）でスキル編集手順を確認したところ、`multiagent-setup` の
`references/skills.md`「スキル更新手順」が「`.agents/skills/<name>/SKILL.md` を直接編集するだけでよい」と
案内しており、本リポの適用済みルール `.agents/rules/skill-reinstall.md`（`skills/<name>/` ソースを編集して
`scripts/reinstall-skill.sh` で同期）と食い違っていた。ガイドに従うと installed copy を直接編集し、
`skills-sync` が commit をブロックする導線になっていた。

## 根本原因

3 階層の「なぜ」:

- なぜ矛盾したガイドが残っていたか? → `multiagent-setup` は配布スキルで、下流（`skills/` ソースを持たない
  プロジェクト）では `.agents/skills/` が実体ゆえ「直接編集」が正しい。本リポ（配布元）にだけ当てはまらない。
  - なぜ本リポでその誤誘導を止められなかったか? → `skill-reinstall` ルールの scope が `skills/**` のみで、
    エージェントが `.agents/skills/**`（installed copy）を編集しようとしても発火せず、訂正が届かなかった。
    - なぜ scope が狭かったか? → ルール新設（[[2026-06-10-skill-edit-reinstall-rule]]）時は「ソース編集後の
      再同期漏れ」だけを想定し、「installed copy を直接編集する導線」を想定していなかった。← 根本原因

KEDB 照合: [[2026-06-10-skill-edit-reinstall-rule]] / [[2026-06-08-skills-agents-sync-drift]]（いずれも applied、
source ↔ installed 同期の同軸）。決定論ゲート `skills-sync` は悪い結末を commit 時に捕捉するが、
「そもそも installed copy を編集させない」編集時の誘導が欠けていた。配布スキル側は下流のため変更しない方針。

## 提案（適用済み）

配布スキル（`multiagent-setup`）は触らず、本リポ側の `.agents/rules/skill-reinstall.md` を強化した:

- scope を `skills/**` に加え `.agents/skills/**` / `.claude/skills/**` へ拡張（`paths` と `applyTo` 両方）。
  installed copy を編集しようとした時点でルールが発火し、ソース編集へ誘導する。
- 本文に「唯一のソースは `skills/<name>/`。installed copy は生成物なので直接編集しない」節と、
  `multiagent-setup` の直接編集案内は配布先向けである旨の注記を追加。

一般化: **source + 生成コピーの二重構造では、生成コピー側のパスにもルール scope を広げ、
コピーを直接編集する導線自体をルール発火で塞ぐ**（決定論ゲートと二段構え）。
