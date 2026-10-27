---
date: 2026-10-27
type: rule
priority: medium
confidence: high
status: pending
applied-to: []
session: claude-code
---

# docs/ にツールの手順を書くときに、外部ツールの形を確かめる rule が読み込まれない

## 事象

PR #800 で認知的複雑度の指摘を直した後、`docs/tooling.md` の手順どおり `fallow health --save-baseline` でベースラインを作り直した。
既存のベースラインが関数ごとの識別を持つので、`--baseline-mode identity` が無いとして exit 2 で止まった。保存先のパスも手順に無かった。
そこで手順を直そうとしたが、書き換えるたびに、レビューが手順と fallow の実際の振る舞いの食い違いを指摘し、6 回の反復を使った。
指摘の例は次のとおりである。

- 保存先のパスが無い
- `baselines prune` は残した項目の重さの枠を下げない
- `target_keys` は合否に使われない
- 引数なしの `fallow --save-baseline` は health も実行する

最後は手順の変更を PR から外し、この学びに残した。

## 根本原因

- なぜ書き換えが続いたか: 書き換えるたびに、fallow のコマンドを実行して確かめる前に文書を書いた。
- なぜ確かめなかったか: 外部ツールの形と振る舞いを確かめる rule（`.agents/rules/external-tool-format-verification.md`）が読み込まれなかった。
  この rule の `paths` は `skills/**` だけで、`docs/tooling.md` を編集したときには読み込まれない。
- なぜ元の手順が古かったか: health のベースラインを関数ごとの識別を持つ形に変えたときに、`docs/tooling.md` の作り直すコマンドを直さなかった。

## 根拠

確信度は high とする。exit 2 の stderr と、6 回のレビューの指摘がどれも、手順と fallow の振る舞いの食い違いを示すからである。

- `fallow health --save-baseline` の stderr: `refusing to overwrite health baseline ... Re-save with --baseline-mode identity`
- `target_keys` を空にしたベースラインでも `pnpm run lint:fallow` が exit 0 になることを確かめた
- rule の frontmatter は `paths: ["skills/**"]`・`applyTo: "skills/**"` である

## 提案

`external-tool-format-verification.md` の `paths` と `applyTo` に `docs/**` を足し、`docs/tooling.md` の fallow のベースラインを作り直す手順を、実行して確かめたコマンドで書き直す。

- 手順には、保存先のパス・`--baseline-mode identity`・終了コード（残りの指摘があれば exit 1）・作り直した後にファイルごとの件数が増えていないことの確かめ方を書く
- dead-code は `fallow dead-code --save-baseline` を使う（引数なしの `fallow` は health も実行する）
- CRAP のベースラインの更新は、CI と同じカバレッジを使う条件と一緒に、#659 の CRAP の作業で決める
