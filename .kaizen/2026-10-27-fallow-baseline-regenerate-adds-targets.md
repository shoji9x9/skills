---
date: 2026-10-27
type: doc
priority: medium
confidence: high
status: applied
applied-to: [docs/tooling.md]
session: claude-code
---

# fallow のベースラインを作り直す手順を、`--help` で確かめずに書いて直し続けた

## 事象

PR #800 で認知的複雑度の指摘を直した後、`docs/tooling.md` の手順どおり `fallow health --save-baseline` でベースラインを作り直した。
1 回目は、既存のベースラインが関数ごとの識別を持つので、`--baseline-mode identity` が無いとして exit 2 で止まった。
2 回目は作り直せたが、`target_keys` に旧版に無い 21 件が入り、手元の `/code-review` が「除外が増えた」と指摘した。
その後、手順を「旧版と比べる」「`fallow baselines prune` で外す」と書き換えるたびに、レビューが手順の事実と違う点を指摘した。
保存先のパスが無い、`prune` は重さの枠を下げない、`target_keys` は合否に使われない、の 3 点である。

## 根本原因

- なぜ手順の書き換えが続いたか: 書き換えるたびに、fallow の振る舞いを実行して確かめる前に文書を書いた。
- なぜ確かめなかったか: 元の手順（`fallow health --save-baseline` で作り直す）が動くものと読み、`--help`（`--save-baseline` の値・`--baseline-mode`・`baselines prune` の説明）を読まなかった。
- なぜ元の手順を信じたか: 元の手順は、関数ごとの識別を持つベースラインに変えた後に直されておらず、その時点の振る舞いを示していなかった。

## 根拠

確信度は high とする。exit 2 の stderr と、4 回のレビューの指摘がどれも、手順と fallow の実際の振る舞いの食い違いを示すからである。

- `fallow health --save-baseline` の stderr: `refusing to overwrite health baseline ... Re-save with --baseline-mode identity`
- `target_keys` を空にしたベースラインでも `pnpm run lint:fallow` が exit 0 になることを確かめた
- `fallow baselines prune` は項目を外すが、残した項目の重さの枠（critical など）は下げない（PR #800 のレビュー）

## 提案

ツールの振る舞いを文書の手順に書くときは、書く前にそのコマンドを実行し、`--help` で引数と終了コードを確かめてから書く。

- `docs/tooling.md` には、確かめたコマンド（保存先のパスと `--baseline-mode identity`）と、作り直した後に件数が増えていないことを確かめる手順を書いた
- 作り直して件数が増えた項目は除外を増やす変更なので、PR に理由を書いて利用者に確かめる
