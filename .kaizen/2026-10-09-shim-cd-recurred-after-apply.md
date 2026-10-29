---
date: 2026-10-09
type: hook
priority: high
status: applied
applied-to: [~/.config/mise/config.toml]
session: claude-code
---

# 外部ディレクトリへ cd して shim のツールを呼ぶ形は、文書では止まらないので PreToolUse で止める

## 事象

Issue #425 で 2026-09-30-temp-dir-cwd-breaks-mise-shim（適用先: AGENTS.md・acceptance.md・pnpm-transitive-update.md）を applied にした。
その同じセッションで、commit message を scratchpad へ heredoc で書くため、`cd /tmp/claude-1000 && cat > c1.txt ... ; pnpm --dir <repo> exec commitlint ...` を実行した。
`mise ERROR No version is set for shim: pnpm` で 4 回とも起動自体が失敗した（6 回目の再発）。
`--dir` を付ければリポジトリの設定で動くと考えたが、shim は pnpm 自体のバージョンを cwd で決めるので、`--dir` では変わらない。

## 根本原因

- なぜ失敗したか → cwd がリポジトリの外のまま、mise の shim の pnpm を名前で呼んだ
  - なぜ cd したか → 一時ファイルを相対パスで書く手間を省くため、書き込みとツールの起動を 1 回の呼び出しにまとめた
    - なぜ防げなかったか → 規約は AGENTS.md の文章だけで、適用した直後でも従えなかった。
      `--dir` のような「別の指定で補える」という誤った代替を、文章は止められない ← 根本原因（仕組みが無い）

KEDB: 2026-09-30-temp-dir-cwd-breaks-mise-shim（applied）、archive/2026-09-03-mise-shim-resolves-by-cwd（applied）の再発。

## 提案

`bash-command-guard.sh` に、同じ呼び出しでリポジトリの外へ `cd` した後に shim 経由のツール（`pnpm`・`node`・`npx`・`pnpx`）を名前で呼ぶ形を止めるルールを足す。

- 外の判定: `cd` の引数を hook の cwd から解決し、`git rev-parse --show-toplevel` の外なら対象
- 通す形: `cd` の後でも実体パス（`$(mise which pnpm)`・絶対パスの node）で呼ぶもの、リポジトリ内への cd、cd を含まない呼び出し
- 誤検知しないことの確認を、止める形と同じ数以上テストに置き、ミューテーションテストの定義も足す

## 適用（2026-10-14・Issue #601）

提案の guard のルールは作らず、原因の側で閉じた（利用者の決定）。
呼び出しの形を読むルールは列挙が尽きず（`2026-10-09-fix-at-cause-before-caller-check`）、失敗そのものは副作用の無い大きなエラーで気づけるので、止める費用に見合わないと判断した。

- 利用者のグローバルの mise 設定（`~/.config/mise/config.toml`）に `node` と `pnpm` のデフォルトのバージョンを置き、`mise lock --global` を `$HOME` から実行した
- 確かめた結果: `/tmp` から shim の `pnpm --version`・`node --version` が起動する。グローバル設定を外した同じ呼び出しは `No version is set for shim: pnpm` で失敗する
- 各プロジェクトの `mise.toml` のバージョンが優先されるので、プロジェクトの間でバージョンをそろえる必要はない
- 範囲はこの PC だけである。他の環境で同じ失敗が起きたら、同じ設定を入れるかをその環境の利用者が決める
