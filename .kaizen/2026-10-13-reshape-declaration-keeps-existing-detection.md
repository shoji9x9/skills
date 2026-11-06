---
date: 2026-10-13
type: rule
priority: high
confidence: high
status: pending
applied-to: []
session: claude-code
---

# チェックの宣言を組み替えるときや別のツールへ移すときは、外れる既存の検出を先に確かめる

## 事象

PR #604 の e396ebf で、1 ファイルだけコピーして使う `trait-compare.mjs` と `header-normalize.mjs` を、`is-array.mjs` と範囲（region）で比べる組に入れようとした。
`check-identical-copies` の「1 ファイルは 1 組にだけ属する」に拒まれたので、6 つの `scripts/lib/is-array.mjs` をファイル全体で比べていた組に region を付けて、2 ファイルを合流させた。
チェックは OK を返し、region の中の差が検出されることも確かめた。
しかし、6 つのコピーどうしは印の間しか比べなくなっていた（印の外の `export` を変えても通る）。3 回目のレビューで指摘され、803776c でチェックを拡張して戻した。

2026-10-27 の Issue #659 で、oxlint の complexity・import/no-cycle・import-direction を外して fallow に移した。
fallow の entry に `.agents/skills/*/scripts/**/*.ts` を挙げ、新しい検出（使われていない export・境界・認知的複雑度）は scripts/ と skills/ で確かめた。
しかし fallow はドットで始まるディレクトリを走査しないので、private skill（`.agents/skills/<name>/` の `.ts`）は 1 件も対象に入っていなかった。
移す前は oxlint が検査していた循環参照と複雑度を、どのツールも検査しない状態になり、docs/tooling.md は対象になると書いていた。
commit 前の /code-review が `fallow list --files` で見つけ、ignorePatterns の `!` で含め直した。

## 根本原因

- なぜ組み替えたか: 制約に当たったとき、制約（チェックの仕様）を変える案より、宣言を組み替える案を先に取った。
- なぜ気付かなかったか: 新しく足したもの（region の中の差）が検出されることだけを確かめ、組み替えで変わった既存の組が、変更前に検出していた差（印の外の差）をまだ検出するかを確かめなかった。チェックの OK は、両者を区別しない。
- なぜ手順に無かったか: `.agents/rules/state-space-and-mutation-proof.md` の「分類を狭める変更も、同じ扱いにする」は判定の処理の分岐を想定していて、宣言（設定のデータ）の組み替えで比べる範囲が狭まる場合を挙げていない。
- 2026-10-27 の再発: チェックを別のツールへ移したとき、移す前のツールが検査していた範囲（.agents/ の private skill）を挙げなかった。そのため、移した先で範囲ごとに検出を確かめなかった。
  新しく足した検出だけを確かめ、移し替えで狭まった既存の範囲を確かめていない点が同じである。

## 根拠

- 2026-10-13: PR #604 のレビューの指摘と、803776c の修正。
- 2026-10-27: 同じ原因での再発（宣言の組み替えから、ツールの移し替えへ）。/code-review が `fallow list --files` に `.agents/` のファイルが 1 件も出ないことで確かめた。

## 提案

宣言を組み替えるときやチェックを別のツールへ移すときは、移す前に検査していた範囲（ディレクトリ・ファイルの種類）を挙げ、範囲ごとに違反を 1 件置いて検出されることを確かめる。

- `.agents/rules/state-space-and-mutation-proof.md` の「分類を狭める変更も、同じ扱いにする」に 1 行足す。宣言（`identical-copies.json` の組・lint の対象の glob など）を組み替えて範囲が狭まる場合と、チェックを別のツールへ移す場合も同じに扱う。
- 制約に当たったら、宣言を組み替える案と、制約そのものを変える案を並べて選ぶ。
- ツールの対象のファイルの一覧（`fallow list --files` など）を、移す前のツールの対象と突き合わせる。
