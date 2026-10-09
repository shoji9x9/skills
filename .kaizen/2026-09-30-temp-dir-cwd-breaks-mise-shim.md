---
date: 2026-09-30
type: skill
priority: high
status: applied
applied-to: [skills/issue-start/references/acceptance.md, skills/dependabot-alert-issue/references/pnpm-transitive-update.md, AGENTS.md]
session: claude-code
---

# 作業ツリー外の一時ディレクトリを使う手順でも、mise 管理のツールはリポジトリの cwd か実体パスで起動する

## 事象

issue-start の受け入れ条件の突き合わせで、`issue.json` 等を指示どおり作業ツリー外（`$CLAUDE_JOB_DIR/tmp/acc`）に置いた。
そのディレクトリへ cd して `acceptance-check.mjs` を起動したところ、`mise ERROR No version is set for shim: node` で起動自体が落ちた（1 往復の手戻り）。

### 追記（2026-09-30・再発）

pnpm-audit-alert-issue / dependabot-alert-issue の着手可否判定で、`package.json` / `pnpm-lock.yaml` / `pnpm-workspace.yaml` を scratchpad に複製した。
そこへ cd して `pnpm update <pkg> --depth Infinity --lockfile-only` を実行したところ、`mise ERROR No version is set for shim: pnpm` で起動自体が落ちた。
`pnpm config get minimumReleaseAge` も空で返り、診断が 1 往復無駄になった。リポジトリ内で `mise which pnpm` の実体パスを解決して渡し直すと通った。

### 追記（2026-10-05・再発）

Issue #372 の ②-a で、`.claude/settings.json` が oxfmt の整形済みかを確かめるため、
scratchpad へ複製して cd し、`/home/.../node_modules/.bin/oxfmt --check` を実行した。
`mise ERROR No version is set for shim: node` で起動自体が落ちた。

`AGENTS.md`「技術スタック」には「リポジトリの外では `mise which <tool>` で実体のパスを取得して使う」
「`./node_modules/.bin/<tool>` を直接指定しない」が既にある。基底ドキュメントの規約があっても再発した。

- なぜ 1: node の shim は cwd がリポジトリの外だと版を決められない
- なぜ 2: 複製先で確かめる形を選び、`node_modules/.bin` を絶対パスで指定すれば動くと考えた（bin のシバンが `node` の shim を通ることを見落とした）
- なぜ 3: 規約は文章だけで、`cd <リポジトリ外>` と shim 経由のツールの組み合わせを止める仕組みが無い

### 追記（2026-10-08・再発）

Issue #575 の起票前に、`pnpm-transitive-update.md`「親を remove して同じ range で add し直す」を scratchpad の複製で試した。
pnpm は `mise which pnpm` で実体パスを解決して渡したが、手順 1 の `node -e`（親の依存の種類の記録）をそのままコピーしたため、
`mise ERROR No version is set for shim: node` で起動自体が落ちた（1 往復の手戻り）。`mise which node` を渡し直すと通った。

- なぜ 1: 複製先へ cd した状態で、shim の node を裸で呼んだ
- なぜ 2: 実体パスを解決したのは、自分が「主に使う」と意識した pnpm だけだった。手順書の断片が呼ぶ他のツール（node）を列挙しなかった
- なぜ 3: この学びは pending のままで、`pnpm-transitive-update.md` の断片に実体パスの解決が書かれていない（注入された要約を読んでも、複製先で使う全ツールに当てるところまで届かない）

## 根本原因

- なぜ落ちたか → `node` は mise の shim で、cwd がプロジェクト外だとバージョンを決められない
- なぜ cd したか → `acceptance.md` が入力を「作業ツリーの外の一時ディレクトリに置く」と指示し、
  コマンド例が相対の `<issue.json>` なので、置き場へ cd して相対で渡す形を取った
- なぜ既存の規律で防げなかったか → `AGENTS.md`「ツール起動」に shim の cwd 依存は書いてある（[[2026-09-03-mise-shim-resolves-by-cwd]] applied）。
  しかし、置き場を外に指定する手順（`acceptance.md`）側に「cwd はリポジトリに保ち、入力は絶対パスで渡す」が無い ← 根本原因
- 再発（追記）: dependabot-alert-issue の `references/pnpm-transitive-update.md` の、リリース年齢チェックで何も変わらない場合を切り分ける手順 2・3 にも同じ形がある。
  一時ディレクトリへの複製と「リポジトリと同じ pnpm 実体」を求めるが、その実体の取り方（shim は cwd で解決されるので実体パスを先に解決する）が無い
- 同じ形が `acceptance.md` と `pnpm-transitive-update.md` の 2 箇所で同じ日に踏まれた → 手順書ごとの個別対応ではなく横断で直す

## KEDB 照合

[[2026-09-03-mise-shim-resolves-by-cwd]]（applied）の再発。applied には追記しない。
同日の再発はこのファイルへ追記した（`kaizen-kedb-match.sh "shim" "mise"` でヒット）。

## 提案

作業ツリー外の一時ディレクトリでツールを実行する手順は、起動前にリポジトリ内で実体パス（mise なら `mise which <tool>`）を解決して使うか、cwd をリポジトリに保って入力を絶対パスで渡す、と手順書に明記する。

- 対象: issue-start の `references/acceptance.md` 手順 1・5、dependabot-alert-issue の `references/pnpm-transitive-update.md`「リリース年齢チェック」手順 2・3
- 配布スキルなので mise に決め打ちせず「バージョンマネージャの shim は cwd で解決される。実体パスを先に解決する」と一般化して書く
- 横断: 「作業ツリーの外に置く」「一時ディレクトリへ複製する」を指示する手順を `skills/` 配下で grep して同じ形を洗い出す（parity 系・pr-finalize-loop の一時ファイル）
- 追記（2026-10-05）: 確かめたいだけならリポジトリの中で設定を一時的に変えて実行する方法を優先する（今回もその方法で確かめられた）。
  3 回目の再発なので、apply では PreToolUse で `cd` 先がリポジトリの外かつ shim 経由のツールを呼ぶ形を警告する案も検討する。
- 追記（2026-10-05）: `pnpm-transitive-update.md` の、リリース年齢チェックで何も変わらない場合を切り分ける節は、Issue #372 で「リリース年齢の制限で何も変わらない場合を切り分ける」に改めた（手順の番号は同じ）。
- 追記（2026-10-08）: 対象に `pnpm-transitive-update.md`「親を remove して同じ range で add し直す」手順 1 の `node -e` を加える。4 回目の再発で、うち 2 回はこのファイル。
  複製先で実行する断片は、使うツールをすべて列挙して実体パスを先に解決する形（`pnpm_bin=$(mise which pnpm)` と `node_bin=$(mise which node)` をリポジトリ内で取得してから cd）で書く。apply を先延ばしにしない。
