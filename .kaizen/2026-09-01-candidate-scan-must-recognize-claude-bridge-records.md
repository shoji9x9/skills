---
date: 2026-09-01
type: hook
priority: high
status: pending
applied-to: []
session: codex
---

# candidate scanner は Claude の bridge record を識別する

## 事象

commit 前ゲートが残した Claude Code セッションを `kaizen-candidate-scan.sh` で走査したところ、`bridge-session`、`cost-state`、`last-prompt` 等の record を含む transcript に対して `unsupported or malformed record` の exit 2 となった。
候補の有無を判定できず commit が停まった。

## 根本原因

- なぜ commit が止まったか: scanner が transcript 全体の識別に失敗し、安全側の exit 2 にしたから。
- なぜ識別に失敗したか: Claude Code が新たに出力する bridge や session metadata の record type を、scanner の許可する構造として分類していなかったから。
- なぜ未分類のままだったか: transcript schema の変化を検知する fixture が従来の Claude record に閉じ、実セッションに新しい metadata record が追加された状態を回帰テストに持っていなかったから。

KEDB を `unsupported`・`kaizen-candidate-scan.sh`・`bridge-session` で照合したが、同一の学びは無かった。横断確認では Claude の transcript を読む candidate scanner とその fixture が直接の影響範囲で、未知 record を fail-closed にする契約自体は維持すべきと判断した。

## 提案

Claude transcript の新しい metadata record は実例 fixture で構造を固定してから candidate scanner の識別済み入力に追加し、既知候補を保持した混在入力と候補ゼロ入力の両方を回帰テストする。

`bridge-session`、`cost-state`、`last-prompt`、`ai-title`、`mode`、`permission-mode`、`atis-latch`、`pr-link` を単に無視するのではなく、候補を含まない metadata として許可する構造を fixture で確かめる。未知の record type は引き続き exit 2 にし、schema 変化を黙って見逃さない。
