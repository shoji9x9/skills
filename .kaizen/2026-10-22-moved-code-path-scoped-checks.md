---
date: 2026-10-22
type: doc
priority: high
confidence: high
status: applied
applied-to: ["AGENTS.md", "docs/agent-workflow.md"]
session: claude-code
---

# テストのヘルパーを別のファイルへ移したら、ファイルの名前で対象を決めるチェックの扱いが変わった

## 事象

Issue #757 で、51 件のテストのトップレベルのヘルパーを `*-helpers.ts` に切り出した。
`*.test.ts` から出たコードに、名前で対象を決める 2 つのチェックの扱いが変わり、どちらも後になって分かった。

- カバレッジ: `*.test.ts` は測らず、`*-helpers.ts` は閾値の対象になる。型だけを確かめる `narrow` の true の側と、呼ばれない想定の偽物 `noGh` が実行されず、pre-push で止まった。
  切り出した subagent は、別のヘルパー `caught` の振る舞いを変えて閾値を満たしていた（レビューで指摘されて戻した）。
- 変異の差分選択: `--changed-since` は定義・`test_file`・変異の対象だけを見ていた。表明をヘルパーへ移したので、ヘルパーだけを変える PR で定義が選ばれなくなった（`/code-review` で指摘された）。

Issue #1071 では、vitest の setup ファイルを `scripts/lib/testing/vitest-setup/` に移し、古いパスを grep して参照を直した。
そのうち 1 件が `scripts/mutation/check-mutation-proof.ts` のコメントだった。ランナーが変わったとして、PR の Mutation proof が全 1057 件の変異を測った。
shard 1 が 20 分の上限で 3 回 cancel され、CI を 3 回待った。コメントの変更を取り消して直した。

## 根本原因

- なぜ後で分かったか → 移す前に、移した先のファイルにどのチェックが当たるかを挙げていなかった
- なぜ挙げなかったか → 作業の取り決めには、文字列を鍵にするチェック（`find`・テスト名・ハッシュ）を挙げる手順はあるが、ファイルのパスや名前の形で対象を決めるチェックを挙げる手順が無い
- なぜそれで困るか → パスの形で対象を決めるチェック（カバレッジの対象と閾値、変異の差分選択、oxlint の override、ディレクトリのファイル数）は、移したコードの中身が同じでも扱いを変え、警告なしに外れるか、新しく失敗する

## 根拠

同じ PR の中で、同じ原因の事象が 2 つの別のチェックで起きた（カバレッジは pre-push の失敗、差分選択はレビューの指摘）。
KEDB 照合（ヘルパー・coverage、切り出・changed-since、カバレッジ・helpers、移・mutation・test_file）で、同じ原因の学びは無かった。
再発（Issue #1071）: 同じ原因である。パスで対象を決めるチェック（変異の差分選択の「ランナーが変わったら全宣言を測る」規則）を挙げずに、移したファイルの参照を直した。
一致した `2026-10-17-mutation-find-mismatch-found-late.md` は、移した行に `find` が当たらない事象で、文字列を鍵にするチェックの側である。

## 既存の規約

- 扱い: なし
- 場所: なし（`AGENTS.md`「編集」は、文字列を鍵にするチェックだけを挙げる）
- 照合した範囲: `AGENTS.md`・`docs/agent-workflow.md`・`docs/tooling.md` を「全宣言」「パスの形」で検索した

## 食い違い

- 相手: なし
- 判断: なし

## 提案

コードを別のファイルへ移す・分ける前に、パスや名前の形で対象を決めるチェックを grep で挙げ、移した先での扱い（新しく当たる・外れる）を決めてから始める。

- 適用先候補: `AGENTS.md`「編集」の「一括で書き換える前に、その文字列を鍵にする他のチェックを挙げる」の隣に 1 行、理由と実例を `docs/agent-workflow.md`「編集」に置く
- 挙げる先の例: カバレッジの対象（`scripts/coverage/coverage-thresholds.json` と `run-coverage.ts`）と、変異の差分選択（`selectChangedSpecs`）
- 挙げる先の例: `oxlint.config.ts` の `overrides` と、`scripts/gates/layout/dir-file-count.json`
- 挙げる先の例: 変異の差分選択は、ランナー（`scripts/mutation/check-mutation-proof.ts`）を変えると全宣言を測る。参照を直す一括の置換で、ランナーのコメントを変えない
