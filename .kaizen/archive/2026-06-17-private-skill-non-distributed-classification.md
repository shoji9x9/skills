---
date: 2026-06-17
type: rule
priority: medium
status: applied
session: claude-code
---

## 事象

「配布物 = `.mjs` / 非配布 = `.js`」の拡張子ルールを適用する code-review で、
`.agents/skills/pnpm-audit-alert-issue/scripts/normalize-pnpm-audit.mjs` を
「配布物だから `.mjs` で正しい」と判断した。ユーザーから「これは配布しない
private skill なので `.js` であるべき」と修正された（Issue #37）。

## 根本原因

最低 3 階層の「なぜ」:

- なぜ誤判定したか? → `.agents/skills/` 配下にあること＝配布物（インストール済みコピー）と短絡した。
  - なぜ短絡したか? → `.agents/skills/` には 2 種が混在する（①`skills/<name>/` を正本とする
    配布スキルのミラー、②`skills/` に正本を持たず `.private-skill` でマークされた非配布
    private skill）ことを判定基準に織り込まなかった。
    - なぜ織り込めなかったか? → 「配布されるのは `skills/<name>/` 配下だけ」という既知事実を
      配布／非配布の判定（拡張子などのポリシー）に結びつける基準が明文化されていなかった ← 根本原因。

KEDB 照合: 関連 [[2026-06-02-distributable-skill-bundle-assets]]（配布されるのは `skills/<name>/` 配下のみ）、
[[2026-06-08-skills-agents-sync-drift]]（source + installed の二重構造に伴うドリフト）。

横断スコープ: 配布／非配布で扱いを分ける判断は拡張子以外にもあり得る（配布前提の堅牢化 vs
ローカル前提の簡素化など）。判定は「`skills/<name>/` に正本があるか」「`.private-skill` が
あるか」で機械的に決まる。今回追加した `check-js-extensions.js` ゲートは `skills/**` /
`scripts/**` のみ対象で、`.agents/skills/` 下の private skill はガード対象外（手動遵守）。

## 提案

配布／非配布の判定基準を明文化する。基準: 正本が `skills/<name>/` にあるものは配布物、
`.private-skill` を持ち `.agents/skills/<name>/` のみに存在するものは非配布。配布／非配布で
挙動・成果物（拡張子など）を変える判断は、`.agents/skills/` という置き場ではなくこの基準で行う。

適用先: `AGENTS.md`「リント／フォーマット」の拡張子ルールに、非配布物として
「配布しない private skill（`.private-skill`。`.agents/skills/<name>/` のみに存在）のスクリプト」を
明記済み（Issue #37 のコミットで反映）。
