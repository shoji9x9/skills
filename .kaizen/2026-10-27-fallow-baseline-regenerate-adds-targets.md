---
date: 2026-10-27
type: doc
priority: medium
confidence: high
status: applied
applied-to: [docs/tooling.md]
session: claude-code
---

# fallow health --save-baseline で作り直すと、直した関数と関係しない target_keys の項目まで足される

## 事象

PR #800 で認知的複雑度の指摘を直した後、`docs/tooling.md` の手順どおり `fallow health --save-baseline` でベースラインを作り直した。
1 回目は、既存のベースラインが関数ごとの識別を持つので、`--baseline-mode identity` が無いとして exit 2 で止まった。
2 回目に `--baseline-mode identity` を付けて作り直すと、指摘の件数は減ったが、`target_keys` に 21 件の新しい項目（`skill-config.mjs:hidden coupling` など）が足された。
手元の `/code-review` が「この PR の目的と関係しない除外が入った」と指摘し、足された項目を外しても `pnpm run lint:fallow` が exit 0 になることを確かめて外した。

## 根本原因

- なぜ除外が足されたか: `--save-baseline` はその時点の結果をすべて書き出し、直した分を消すだけの更新ができない。
- なぜ気付かずに commit したか: 作り直した後に、`finding_counts` と `identity_finding_counts` だけを旧版と比べ、`target_keys` を比べなかった。
- なぜその比べ方になったか: `docs/tooling.md` の手順は「直したら `fallow health --save-baseline` で作り直す」とだけ書き、`--baseline-mode identity` も、作り直すと増える項目がありうることも書いていない。

## 根拠

確信度は high とする。exit 2 の stderr と、足された 21 件をレビューが指摘した記録の両方が、同じ手順の抜けを示すからである。

- `fallow health --save-baseline` の stderr: `refusing to overwrite health baseline ... Re-save with --baseline-mode identity`
- 作り直した後の `target_keys` は 83 件から 44 件になったが、旧版に無い 21 件を含んでいた（PR #800 のレビューの指摘）

## 提案

`docs/tooling.md` で fallow のベースラインを作り直す手順に、health は `--baseline-mode identity` で作り直すことと、作り直した後に旧版と全項目（`target_keys` を含む）を比べて、旧版に無い項目を外すことを書く。

- 作り直しは除外を緩める変更になりうるので、旧版に無い項目が要るなら、PR に理由を書いて利用者に確かめる
- dead-code のベースライン（`fallow --save-baseline`）も同じ形で比べる
