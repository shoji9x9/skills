---
date: 2026-10-19
type: hook
priority: medium
status: pending
applied-to: []
session: claude-code
---

# 待つループの pgrep -f が自分のコマンドラインに一致し、終わらなかった

## 事象

eval のバックグラウンド実行の完了を待つために、`until ! pgrep -f "run-ws-final.sh"; do sleep 5; done; ...` をフォアグラウンドで実行した。
`pgrep -f` は、そのループを実行している自分のシェルのコマンドラインにも一致するので、本体が終わってもループは抜けず、600 秒のタイムアウトまで待った。
本体は run_in_background で起動しており、完了の通知が届くので、待つ必要自体が無かった。

## 根本原因

- なぜ終わらなかったか: `pgrep -f` のパターンが、同じ呼び出しのコマンドライン（`bash -c "until ! pgrep -f ..."`）に字面のまま含まれていた
- なぜそう書いたか: `docs/agent-workflow.md` の「待つ処理は、フォアグラウンドの Bash のループに置かない」と、
  「`pkill -f` は自分のシェルにも一致する」を、存在を確かめる `pgrep -f` に当てなかった。
  2026-09-11-pkill-f-matches-own-command-line の再発で、終了させる側だけに書いた規則を、対称な反対側（確かめる側）に当てていない
- なぜ防げなかったか: `scripts/hooks/bash-command-guard.sh` は `pkill -f` と `killall -f` を止めるが、`pgrep -f` を対象にしていない

## 提案

`scripts/hooks/bash-command-guard.sh` で、`pgrep -f` を待つループの条件（`until ! pgrep -f`・`while pgrep -f`）に置いた呼び出しを止める。

- パターンを同じ呼び出しのコマンドラインに字面で書くと、`pgrep -f` は自分のシェルに一致して 1 件以上を返す。変数で渡したパターンや、`[r]un-ws` の形のパターンは自分に一致しない
- 対象を `pgrep -f` 全体に広げない。`docs/agent-workflow.md` は、パターンで終了させる前に `pgrep -af <pattern>` で対象と件数を確かめるよう求めている。`pkill -f` を止める検査は `-af` にも一致するので、そのまま流用するとこの確認まで止める
- 既にあるもの: 規則の文（`docs/agent-workflow.md` の「待つ処理は、フォアグラウンドの Bash のループに置かない」と「`pkill -f` が照合するのはコマンドライン全体」）。足りないのは、待つループの条件にある `pgrep -f` を止める Hook の検査だけである
