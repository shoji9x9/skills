---
date: 2026-06-05
type: other
priority: high
status: applied
session: claude-code
---

## 事象

`.github/dependabot.yml` の `commit-message.prefix` に `build` を設定したが、これは
`commit-types.js`（許可型 `feat/fix/docs/refactor/test/ci/chore`、`build` は不使用、
依存更新は `chore`）に違反していた。ユーザーの指摘で `chore` に修正した。

## 根本原因

conventional-commits の一般的慣習（依存更新＝`build(deps)`）に引きずられ、プロジェクトの
コミット型の単一の真実である `commit-types.js` を参照せずに prefix を選んだ。

AGENTS.md には「使用する種別は `commit-types.js` を単一の真実として定義する」という
ルールが既にあったが効かなかった。理由は2つ:

1. ルールの列挙範囲が `commitlint` と `semantic-release` の2消費者だけで、両者は**コードで**
   `commit-types.js` を import して結合している（ドリフト不能）。一方
   `.github/dependabot.yml` の `commit-message.prefix` は**手書きの文字列**でコード未結合の
   第3の消費者なのに、ルールがそれを射程に含めていなかった。
2. ドキュメントのルールは確率論的で、開いて結びつけない限り効かない。

→ 根本原因: コミットメッセージの type を決める「手書き・コード未結合」の設定面
（dependabot.yml）に対する**決定論的な整合チェックが無かった**こと。

## 提案（適用済み）

仕組みで再発を防ぐ。

- `scripts/commit-types-consistency.test.mjs` を追加。`commit-types.js` の `types` を import し、
  `.github/dependabot.yml` の全 `commit-message.prefix` / `prefix-development` を抽出して
  `types` の部分集合か検証する（CI の Lint = `pnpm test` で実行）。将来コミットメッセージを
  生成する設定面が増えたら、このテストの抽出関数配列に追加する（1か所で拡張）。
- `AGENTS.md`「ブランチ運用」のルール文面を更新し、dependabot.yml の `commit-message.prefix`
  も `commit-types.js` 準拠の対象であること、手書きのため上記テストで検査することを明記した。

横断スコープ: 他のコミットメッセージ生成面は `commitlint.config.js` / `release.config.js` の
2つだが、どちらも `commit-types.js` を import 済みで構造的に安全。現状の手書き面は
dependabot.yml のみ。関連: [[2026-06-03-commitlint-body-line-length]]。
