---
date: 2026-09-03
type: doc
priority: medium
status: applied
applied-to: [AGENTS.md]
session: claude-code
---

# mise の shim は cwd の設定階層で解決する（プロジェクト外では実体パスを渡す）

## 事象

`coverage-expand.mjs` が cwd に依存せずプロファイルを解決することを実証するため
`cd /tmp && node <絶対パス>/coverage-expand.mjs --list-profiles` を実行したところ、
スクリプトではなく起動そのものが落ちた:

```text
mise ERROR No version is set for shim: node
```

`mise which node` で実体パスを取り直して再実行し、意図どおり実証できた（1 往復の手戻り）。

## 根本原因

- なぜ落ちたか → `node` は mise の shim で、解決に使う設定階層は**その時点の cwd**で決まる。
  `/tmp` にはプロジェクトの `mise.toml` が効かず、グローバル既定も無いのでバージョンを決められない
- なぜ気付かなかったか → 「PATH に node がある」と扱っていた。実体は cwd 依存の shim である
- なぜ既存の規律で防げなかったか → `AGENTS.md`「ツール起動」は**どう起動するか**（`pnpm exec` / shim）
  しか書いておらず、**どこから起動するか**で shim の解決が変わることを書いていなかった ← 根本原因

## KEDB 照合

[[2026-06-08-mise-shim-runtime-untrusted]]（`status: applied`）と同じ「shim 経由の起動が落ちる」故障だが、
原因が違う。あちらは**untrusted な使い捨てプロジェクト**で mise が安全側に倒す形、本件は
**設定階層の外に出た**ためバージョンを決められない形。applied ファイルには追記せず
（参照注入は pending のみ供給するため死蔵する）、恒久側の `AGENTS.md` を直接更新した。

[[2026-07-28-merged-config-scope-verification]] も近縁（階層マージされる設定の切り分け）で、
`AGENTS.md` には既に「有効な設定ソースを列挙する」規律がある。本件はその**起動側**にあたる。

横断スコープ: mise 管理の全ツール（node / python3 / shellcheck / shfmt / gitleaks 等）に共通する。
リポジトリ内で動く検証は影響を受けない。

## 提案

`AGENTS.md`「ツール起動」に追記済み（本ノートは恒久側を更新した記録）。

- mise の shim は cwd の設定階層で解決するため、リポジトリ外の cwd から素のコマンド名で起動すると
  `No version is set for shim` で落ちる
- プロジェクト外で動かす検証は `mise which <tool>` で実体パスを解決して渡すか、cwd をプロジェクト内に保つ
