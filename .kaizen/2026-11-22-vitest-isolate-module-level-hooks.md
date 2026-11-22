---
date: 2026-11-22
type: doc
priority: medium
confidence: medium
status: pending
applied-to: []
session: claude-code
---

# vitest の isolate: false では、共有のヘルパーがモジュールの最上位で登録した後始末が、最初のテストファイルの終わりにだけ実行される

## 事象

Issue #1108 で、vitest の parallel プロジェクトを `isolate: false` にした。
1 回目の全件の実行（カバレッジなし）は、14,211 件がすべて通った。
カバレッジ付きの 2 回目の実行では、`scripts/skills/agent-usage/worktree-branches.test.ts` の 15 件が `ENOENT: mkdtemp '/tmp/agent-usage-cli-…/t-XXXXXX'` で落ちた。
旧版（`isolate` がデフォルト）を同じ条件で実行すると、この 15 件は通った。
`makeTempDirFactory` を直して 15 件が通った後、PR #1111 の CI で、fallow の CRAP の検査（`lint:crap`）が `code-comments.ts` の関数をカバレッジ 0% と読んで落ちた。
`isolate: false` では、`takeCoverage()` がテストファイルごとにカウンタを書き出してリセットする。fallow は、同じスクリプトの記録が複数のファイルに分かれると合算しない（手元で `isolate` の有無を比べて確かめた）。
記録を合算する処理を足すのは PR の範囲から外れるので、PR #1111 では `isolate: false` を採らず、`makeTempDirFactory` の修正も戻した。

## 根本原因

- なぜ落ちたか: `cli-helpers.ts` がモジュールの最上位で `makeTempDirFactory` を呼び、共有のディレクトリを作っていた。後始末の `afterAll` は、最初にこのモジュールを読み込んだテストファイルに登録される。
- なぜ後のファイルで消えていたか: `isolate: false` では、同じワーカーの後のテストファイルがモジュールを読み直さずに使い回す。後始末は最初のファイルの終わりに実行され、後のファイルは消えたディレクトリを使った。
- なぜ 1 回目の実行で見つからなかったか: 落ちるかは、同じワーカーに割り当てられたテストファイルの並び順で決まる。1 回の全件の成功は、モジュールの状態を使い回しても安全だという根拠にならない。
- 根本原因: テストの共有のヘルパーに、モジュールの最上位で vitest の hook（`afterAll` など）を登録したり、一時ディレクトリを作ったりする書き方が許されていた。その書き方は、テストファイルごとにモジュールを読み直す前提（`isolate` が有効）でしか正しく動かない。

## 根拠

- 同じ条件で旧版と現行版を 1 回ずつ実行し、差が `worktree-branches.test.ts` の 15 件だけだったことを確かめた（`test:coverage` の比較）。
- 同じ形のヘルパーは、`scripts/` の `*-helpers.ts` などに 8 ファイルあった（すべて `makeTempDirFactory` をモジュールの最上位で呼ぶ）。
- `makeTempDirFactory` を消えていたら作り直す形に直し、作り直したものを setupFiles の `afterAll` で消すと、15 件とも通った。PR #1111 では、この修正を `isolate: false` と一緒に戻した。
- `makeSharedTempDir` をヘルパーのモジュールの最上位で呼ぶものは、今は無い。ただし、足すと同じ失敗が起き、その時点の並び順で落ちなければ気付けない。

## 既存の規約

- 照合した範囲: `AGENTS.md`、`docs/`、`.agents/rules/` を `makeSharedTempDir`・`isolate`・`モジュールの最上位` で検索した
- 扱い: `なし`
- `docs/testing.md`「並列実行」は、tracked のファイルを書き換えるテストを `ISOLATED` に入れることだけを決めている。モジュールの状態を使い回すときの書き方の決まりは無い。

## 食い違い

- 相手: 無し（pending の学び・規約・利用者の指示に、反対の振る舞いを求めるものは見つからなかった）

## 提案

`docs/testing.md`「並列実行」に、共有のヘルパー（`*.test.ts` でないファイル）はモジュールの最上位で vitest の hook を登録せず、`makeSharedTempDir` を呼ばないことを書き、`test-tmpdir.test.ts` の直呼びの検査でそれを落とす。

- `isolate: false` を採るときは、`makeTempDirFactory` を作り直しに対応させ（PR #1111 の 2 つ目の commit）、V8 の記録を fallow に渡す前に合算する。
- `makeSharedTempDir` はテストファイルの収集の時点（`describe` の本体）でだけ呼ぶ。ヘルパーが共有のディレクトリを要るなら、`makeTempDirFactory` を使う。
- 検査を作るかは、`references/apply.md`「機構を作る前に効果と費用を書く」で決める。効果は、今回の 15 件の失敗と、同じ形のヘルパーが 8 ファイルあったこと。費用は、`test-tmpdir.test.ts` の既存の直呼びの検査に、`*.test.ts` でないファイルの `makeSharedTempDir(` と最上位の hook の呼び出しを探す条件を足すだけである。
