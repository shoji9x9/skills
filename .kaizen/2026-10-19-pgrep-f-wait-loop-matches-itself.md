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

- なぜ終わらなかったか: `pgrep -f` のパターンが、同じ呼び出しのコマンドライン（`bash -c "until ! pgrep -f ..."`）に含まれていた
- なぜそう書いたか: 「pkill -f は自分のシェルにも一致する」は、終了させる操作の規則としてだけ書かれ、存在を確かめる `pgrep -f`（待つループ）には当てていなかった。
  2026-09-11-pkill-f-matches-own-command-line の再発で、対称な反対側を当てていない
- なぜ防げなかったか: 文書の規則だけで、同じ呼び出しの中で自分に一致するパターンを止める決定論的なチェックが無い

## 提案

`pgrep -f`・`pkill -f` のパターンが、同じコマンドの中で自分に一致する形を、Bash の PreToolUse の Hook で止める。

- `scripts/hooks/bash-command-guard.sh` に、`pgrep -f` / `pkill -f` の引数がエスケープの無い字面のままコマンドに含まれる形（`[r]un` のような、自分に一致しない書き方にしていないもの）を検出して止める
- `AGENTS.md` の「プロセスは、起動時に保存した PID で終了させる」に、存在の確認と待つループも同じだと足す
- run_in_background で起動した処理は、完了の通知を待つ。フォアグラウンドのループで待たない
