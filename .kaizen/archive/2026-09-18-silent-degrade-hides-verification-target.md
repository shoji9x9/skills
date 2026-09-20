---
date: 2026-09-18
type: skill
priority: medium
status: applied
applied-to: [skills/kaizen/scripts/kaizen-status-check.sh, scripts/kaizen-degraded-warning.test.js, AGENTS.md]
session: claude-code
---

# 同梱物を相対パスで読むコンポーネントは、コピーして実行すると無言で縮退し、検証対象がすり替わる

## 事象

Issue #344 のレビュー指摘（SessionStart のマーカー失効が自分のツリーだけ）の修正を
裏取る際、`kaizen-context-inject.sh` だけを scratchpad へ `cp` して実行した。
実行されたのは共通ライブラリ不在の**縮退経路**だったため、別ツリーのマーカーが残り、
「レビューの修正は効いていない」と一度結論した。正本の場所で実行し直すと修正は効いていた。

## 根本原因

- なぜ誤った結論が出たか → コピー先に `kaizen-hook-common.sh` が無く、関数群が未定義だった
  - なぜ気づけなかったか → スクリプトは `[ -r <lib> ] && . <lib>` で読めなければ**黙って**縮退する
    - なぜ無言か → 縮退は設計上の正常系（配布物の部分展開でも動く）だが、
      **縮退したこと自体を出力に残していない**（7 本中 6 本が無言）← 根本原因

同セッションの同型: `wt-probe.sh` へ scripts ディレクトリを相対パスで渡し、
cd 後に No such file で落ちた（こちらは声が出たので即座に直せた）。

KEDB: [[2026-08-17-degraded-env-test-needs-reachability-proof]]（applied）は
**意図して**劣化させた環境の到達性を扱う。本件は**意図せず**作った劣化で、
対策は検査側ではなく被検査側に置くところが違う。

## 提案

同梱ライブラリを読めず縮退したときは stderr に 1 行出し、縮退した run と本番構成の run を出力で区別できるようにする。

- `skills/kaizen/scripts/*.sh` の `[ -r "${kaizen_lib}" ] && . "${kaizen_lib}"` に else を付け、
  `<script>: 共通ライブラリを読めないため縮退します: <path>` を stderr へ出す（exit は変えない）
- 今回追加した「削除 0 件の警告」と同型——成功と縮退・空振りを終了コードではなく出力で分ける
- `scripts/*.test.js` に、ライブラリを除いた一時ディレクトリで走らせてこの警告が出ることを固定する
- 文章規約（AGENTS.md）: 同梱物を相対パスで読むコンポーネントの検証は**正本の場所**で行う。
  コピーするなら 1 ファイルではなくディレクトリ一式をコピーする
