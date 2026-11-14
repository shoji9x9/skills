# Skill Benchmark: parity-component

**Model**: claude-code / opus / high
**Date**: 2026-11-14
**Evals**: 1（`with_skill` と `without_skill` を 3 run ずつ）

## 目的

Issue #1019（部品の幅と高さの差を `shot-size-compare.mjs` で突き合わせる）で新しく足した eval 12 の確認である。
入力を新しく作ったので、`without_skill` も 3 run 実行し、差が出るかを見た。既存の eval は実行していない。新しく足した eval なので、比べる記録は無い。

## Summary

| eval | 入力の変更 | with_skill | without_skill |
| --- | --- | --- | --- |
| 12 | 新規 | 9/9・9/9・9/9 | 6/9・6/9・6/9 |

すべての run で、`isolation.txt` は `sandboxed` だった。`with_skill` は `skill_usage.read` が true、`without_skill` は `contamination.txt` が `clean` で、`skill_usage.read` が false だった。
どの run も、fixture の `.replace/` を書き換えていない（`project-files/.replace` を fixture と `diff -rq` で比べて差が無い）。

## 差が出た assertion

`without_skill` は 3 run とも、次の 3 本を落とした。

- 見本の置き場所: `new/local-dev/users-create/default/` と推測し、`catalog/` を挟まなかった
- 寸法の確かめ方: `shot-size-compare.mjs` に触れず、`element.shot.json` を並べて読む方法だけを示した
- 枠の幅を合わせてよいかの判断: 勝っている宣言（`css-rules.json`・`cascade-resolve.mjs`）を確かめて決めるとはしなかった

残りの 6 本（画素の exit 2 を一致や許容にしない、`trait-compare.mjs` の `[]` を根拠にしない、PNG の寸法の対、枠では直らない判断、`parity.md` の行、fixture を変えない）は、`without_skill` も満たした。
これらは、prompt と fixture の材料（`inline-block` で幅の宣言が無い `css-rules.json`、基準の `element.shot.json`）から一般の推論で答えられる。後退の検知のための assertion である。

## 採点の後に直したこと

採点の後に、スキルの次の箇所を直した。eval 12 の prompt が問う内容（判定・置き場所・ツール・枠の幅・`parity.md` の行）の答えは変わらない。

- `SKILL.md` の「コピーせず実行するスクリプト」の一覧に `shot-size-compare.mjs` を足した
- `assets/component-api-template.md` に「見本を置く入れ物」の節を足した
- `references/compare.md` に、2 回目のノイズの採取物の置き場所（`new/<target>/noise-pass2/`）と、許容にした寸法の差の組を `gaps.md` に残すことを足した
