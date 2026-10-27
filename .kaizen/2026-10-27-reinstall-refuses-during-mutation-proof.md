---
date: 2026-10-27
type: hook
priority: high
confidence: high
status: pending
applied-to: []
session: claude-code
---

# reinstall-skill.sh は、ミューテーションテストの実行中に起動されたら止まる

## 提案

`scripts/tools/reinstall-skill.sh` は、ミューテーションテストのロックの PID が生きていれば、原本をコピーせずに exit 1 で止まる。

ロックは `node_modules/.cache/mutation-proof/lock`（環境変数 `MUTATION_PROOF_LOCK` があればそれ）である。止まるときは、ミューテーションテストが終わるまで待つよう案内する。

- 効果: 同じ誤りの記録が 4 回ある（`2026-09-28-mutation-proof-owns-worktree.md` の事象と、2026-10-02・2026-10-20・2026-10-27 の再発）。
  4 回とも、規約（`docs/tooling.md`）とその学びがあっても起きた。skills-sync とレビューが後から見つけたが、見つけるまでの間、インストール済みのスキルが変異したまま使われた
- 費用: 例外の一覧は要らない。分岐は、ロックが無い・PID が生きている・PID が死んでいる（古いロック）の 3 つ。実行時間は、ファイルを 1 つ読み、`kill -0` を 1 回実行するだけである
- 古いロック（PID が死んでいる）は止めずに進める。ランナーは次の起動で古いロックを取り除くので、reinstall が判定する必要は無い
- 横断: 原本を読んでコピーするほかの処理（`--all` を含む reinstall のすべての呼び出し方）も、同じスクリプトを起点にするので対象になる

## 事象

PR #802 で、parity-suite の全ミューテーションテストをバックグラウンドで起動した直後に、`reinstall-skill.sh parity-suite` を実行した。
インストール済みの `artifact-health-check.mjs` に、実行中の変異（`if (false)`）がコピーされた。push の前の `/code-review --fix` が見つけ、再インストールして直した。

## 根本原因

- なぜコピーに変異が入ったか → reinstall は作業ツリーの原本をそのまま読み、ミューテーションテストが原本を書き換えている最中かを確かめない
- なぜ規約で防げなかったか → 待つ間に別の検査をまとめて実行する段取りでは、reinstall を検査の 1 つとして並べやすい。規約を読み返す機会が、起動する前に無い
