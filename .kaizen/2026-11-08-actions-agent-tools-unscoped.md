---
date: 2026-11-08
type: skill
priority: high
confidence: high
status: pending
applied-to: []
session: claude-code
---

# GitHub Actions で動かすエージェントのツールを、リポジトリの中に限っていなかった

## 事象

Issue #940 の PR #951 で、週次のセルフ点検のワークフロー `self-review.yml` を足した。
エージェント（`anthropics/claude-code-action`）に許すツールは、`kaizen-schedule.yml` と同じ `Read,Grep,Glob,Write` にした。
レビューで、次の 2 つが指摘された。

- `Read` はリポジトリの外（`/proc/self/environ`・`~/.claude`）も読める。入力に仕込まれた指示に従うと、OAuth トークンを結果に書き、公開の追跡 Issue に載せうる
- `Write` は `.git/config` にも書ける。書き換えた設定で、後の段の git（checkout の post 段など）にコマンドを実行させうる

結果を検査する正規表現（トークンの値と形）を足しても、区切り文字を挟むなどの加工で通り抜けられるという指摘が続いた。
`Read(./**)`・`Grep(./**)`・`Glob(./**)`・`Edit(./<結果のファイル>)` に絞ると、手元の `claude -p` で、外のファイルの読み取りと、挙げたファイルのほかへの書き込みが拒否された。
`Write(<path>)` の形の規則は一致しなかった（`Edit(<path>)` の規則が Write にも当たる）。

## 根本原因

- なぜ広いツールを許したか → 同じリポジトリの `kaizen-schedule.yml` の設定を、そのままコピーした。そのワークフローも、エージェントの結果を Issue に載せる
- なぜ問題に気付かなかったか → ジョブの権限（`contents: read`）を最小にしたことで、安全だと考えた。エージェントのツールが読める範囲と、結果が公開されることの組み合わせを確かめていなかった
- なぜ出力の検査で塞ごうとしたか → 出力の側の検査は形ごとに抜けが出る。入力の範囲（読める場所）を絞るほうが、共通の原因を無くす

## 提案

GitHub Actions でエージェントを動かし、その出力を Issue や PR に載せるワークフローでは、ツールをパスで限る（`Read(./**)` などと、結果のファイルへの `Edit(./<file>)`）。

- `kaizen-schedule.yml`（と配布する `skills/kaizen/assets/kaizen-schedule.yml`）の `--allowed-tools Read,Grep,Glob,Write` を、同じ形に絞る Issue を作る
- `.agents/rules/github-actions-authoring.md` に「エージェントのツールの範囲」を足し、ジョブの権限とは別に、ツールが読める・書ける場所を確かめると書く
- 規則の形（`Edit(./path)` は Write に当たり、`Write(path)` は当たらない）は、確かめた Claude Code のバージョン（2.1.319）と一緒に書く

## 追記: 拒否するツールを、ツールの一覧と突き合わせていなかった

PR #954 のマージ後、`self-review.yml` のエージェントが、サブエージェント（`Agent`）をバックグラウンドで起動したままターンを終え、結果のファイルを書かずに成功として終わった（Issue #956）。
`--allowed-tools` に無い `Agent` は、確認なしで使えた（手元の Claude Code 2.1.319 で、拒否しなければ使われ、`--disallowed-tools` に足すと使えないことを確かめた）。
`--disallowed-tools` は、レビューで危険を指摘されたツール（Bash・WebFetch など）だけから作り、Claude Code が持つツールの一覧と突き合わせていなかった。

提案に次を足す。

- 拒否するツールは、危険を指摘されたものだけで決めない。Claude Code のツールの一覧（公式のドキュメント）から、許すもの以外を挙げる。
  実行の最初に出る `system` の `init` の `tools` は一覧の原本にならない。手元の 2.1.319 では、`Agent` を含まないのに `Agent` を使えた
- 拒否が機能するかは、そのツールを使うよう指示した `claude -p` で、拒否しない場合と拒否する場合の両方を実行して確かめる
