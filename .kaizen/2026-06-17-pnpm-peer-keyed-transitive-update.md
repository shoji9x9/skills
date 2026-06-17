---
date: 2026-06-17
type: skill
priority: high
status: pending
session: claude-code
---

## 事象

Issue #39（pnpm audit findings の `vite` を 8.0.16 へ）の着手で、`pnpm update vite` /
`pnpm update vite@8.0.16` / 親の `pnpm update vitest` のいずれでも `vite` が 8.0.14 のまま
再解決されず、原因切り分け（メタデータキャッシュ・ネットワーク・`minimumReleaseAge`・`engines`・
peer 範囲）に多数の試行を要した。最終的に `rm -rf node_modules pnpm-lock.yaml && pnpm install`
の完全再生成でのみ 8.0.16 を取得できたが、その再生成は ~20 パッケージ（vitest / oxlint /
semantic-release / @types/node ほか）を一斉に float させ、vite 以外の無関係な更新を巻き込んだ。

## 根本原因

最低 3 階層の「なぜ」（証拠付き）:

- なぜ `vite` が上がらなかったか? → pnpm は peer-keyed transitive
  （`vite@8.0.14(@types/node@25.9.1)(jiti@2.6.1)`）を、lockfile を保持したままの
  `pnpm update <pkg>` では再解決しない。名前一致しても peer-key 付きインスタンスは更新されず、
  同時に無関係な plain transitive（@napi-rs/wasm-runtime）だけが bump された。
  - なぜ何度も無駄に試したか? → `pnpm-audit-alert-issue` →
    `dependabot-alert-issue` の着手可否分類が「direct devDep の vitest が vite range
    （^8）を許容 → lockfile 更新で patched に上げられる（vitest 更新不要）」と判定し、
    Issue #39 本文にもその誤前提を記載したため。
    - なぜ誤判定したか? → pnpm で transitive（特に peer-keyed）を patched version へ
      上げる手順・制約がスキルに明文化されていない。← 根本原因（対策可能）

KEDB 照合: 既存 `2026-06-08-pnpm-is-the-package-manager.md`（applied）は「npm でなく
pnpm を使う」話で別件。本件は新規。

横断スコープ: 同じ誤前提は `dependabot-alert-issue` の外部 audit findings mode・GitHub
alerts mode 双方の「着手可否の判定」に潜む。pnpm を使う任意リポジトリで transitive 脆弱性を
扱うたびに再発しうる。

## 提案

`pnpm-audit-alert-issue` と `dependabot-alert-issue`（着手可否の判定 / 外部 audit findings
mode）に、pnpm で transitive 依存を patched version へ上げる際の注意を追記する:

1. `pnpm update <pkg>` は **peer-keyed transitive を再解決しない**ことがある。親依存の range が
   patched を許容していても lockfile 更新だけでは上がらない。
2. 確実に上げるには lockfile 完全再生成（`rm -rf node_modules pnpm-lock.yaml && pnpm install`）が
   必要になる場合があり、これは**無関係な依存も float させる**。`pnpm.overrides` / lockfile 手動編集
   なしに「対象 1 件だけ surgical に上げる」ことは不可能なことがある。
3. よって着手可否分類で transitive を安易に「すぐ着手できる」としない。**direct dependency で
   patched に直接上げられる場合に限って**「すぐ着手できる」とし、transitive は実際に
   `pnpm update`／再生成で patched に到達するかを確認するか、「lockfile refresh で他依存も
   float する」前提を Issue に明記してから分類する。
4. （補強）判定時の裏取りとして、完全再生成での float 範囲を
   `git diff` の base `name@version` 比較で確認する手順を例示する。
