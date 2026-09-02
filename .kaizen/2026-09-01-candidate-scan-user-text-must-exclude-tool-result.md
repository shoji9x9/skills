---
date: 2026-09-01
type: hook
priority: high
status: pending
applied-to: []
session: claude-code
---

# candidate scanner はユーザー発話に tool_result を混ぜない

## 事象

commit 前ゲートが `kaizen-candidate-scan.sh` の候補「user correction: transcript line 59」で commit をブロックした。
実体は Read の tool_result（`kaizen-context-inject.sh` の本文）であり、ユーザーの修正指示ではない。
本文中の「行動リマインダーではなく」の「ではなく」が修正語として拾われていた。

最小 fixture で弁別を実測した。tool_result だけを持つ `type: "user"` レコードに「ではなく」を含めると
`user correction: transcript line 2` が出て、同じ構造のまま語を「であり」に替えると候補 0 件（exit 1）になる。

## 根本原因

- なぜ誤検知したか: `type == "user"` の分岐が `message.content` 全体を `content_text` で連結し `U`（ユーザー発話）
  として出力しているから。tool_result のテキストがそのまま発話として修正語 grep にかかる。
- なぜ連結しているか: Claude Code の transcript ではツール結果も `role: "user"` のレコードに載る。
  ユーザー発話と工具出力が同じ `type` を共有する構造を、抽出側が区別していなかった。
- なぜ区別が漏れたか: 同じ分岐の `E`（tool error）抽出は `select(.type == "tool_result")` で正しく絞っているのに、
  `U` 抽出にだけそのフィルタが無い。tool_result に修正語が現れる混在入力の fixture を持たず、
  この非対称が回帰テストで露見しなかった ← 根本原因

KEDB を `user correction` / `誤検知` / `tool_result` × `kaizen-candidate-scan.sh` で照合しヒットなし。
照合器の陽性コントロールとして `unsupported` × 同スクリプトでは既存 pending がヒットするので、検出能力はある。
横断確認では Codex 側の user 発話抽出は `response_item.payload.role == "user"` と `function_call_output` が
別 type に分かれており同じ混同は起きない。影響は Claude 分岐の `U` 抽出に閉じる。

## 提案

エージェント発話とツール出力が同じレコード型に同居する入力を走査するときは、抽出カテゴリ間でレコード種別のフィルタを揃え、片方だけ緩い非対称を fixture で潰す。

`kaizen-candidate-scan.sh` の `type == "user"` 分岐では、`U` 抽出を text 要素（および content が文字列の場合）
に限定し、`tool_result` 要素を除外する。`E` 抽出の `select(.type == "tool_result")` と対称にする。

回帰 fixture は 2 本置く。(1) tool_result にだけ修正語があり実ユーザー発話が無い入力 → 候補 0 件、
(2) 同じ tool_result に加えて本物のユーザー修正発話がある入力 → 候補 1 件。
弁別できることまで確かめ、「候補が減った」ではなく「正しい行だけが出る」を検証する。

## 再発（2026-09-02）

Issue #276 のコミット時に再発し、**2 セッション分**でゲートが止まった。

- 自セッション（8ca3783e）: `user correction: transcript line 198 / 203 / 296 / 429` の 4 件はすべて
  tool_result（`evals/README.md` の追記内容、`docs/skill-development.md` の抜粋、
  `run-skill-eval.sh` の先頭、`evals.json` の eval 19）で、ユーザー発話は 1 件も無い。
- 他セッション（d3e4cb5d）: `user correction: transcript line 828` も tool_result（`parity-suite` の
  references 本文）だった。

**副作用としてゲートが連鎖する**: 他セッションのセンチネルは自セッションで解消するまで commit を通さないため、
誤検知 1 件が別セッションの commit を止める。実際 d3e4cb5d の transcript 685 行目には、
そのセッションが**さらに別の 2 セッション**のセンチネルでブロックされたゲート出力が残っている
（誤検知が連鎖の入口になり、抽出しても次のセッションで同じ誤検知が積み上がる）。

同一セッションの 2 回目の commit でも再発した（`user correction: transcript line 631`）。実体は **この学びファイル自身を Read した tool_result** であり、誤検知を記録したノートを読むこと自体が次の誤検知を生む。

提案は変更なし。誤検知が commit の連鎖ブロックを生む点を踏まえ、優先度は `high` のまま維持する。
