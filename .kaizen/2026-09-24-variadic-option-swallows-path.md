---
date: 2026-09-24
type: hook
priority: high
status: pending
applied-to: []
session: claude-code
---

# 手順書のコマンドは前例をコピーするときも実走し、可変長オプションの後ろに位置引数を置かない

## 事象

parity-suite の baseline.md にあった `npx playwright test --project current <dir>` は、
Playwright 1.61 / 1.63 の両方で `Project(s) "<dir>" not found` になって落ちる。
`--project` は複数の値を取るので、後ろのパスをプロジェクト名として飲み込む。
Issue #449 ではこの既存の形をコピーして新しいコマンドを書き、実ブラウザで回した時点で初めて発覚した。

再発（2026-10-14・Issue #601）: テスト名を変異なしで集めるため、`vitest list --json scripts/skills/kaizen/kaizen-precommit-gate.test.ts` を実行した。
`--json` は値を任意に取るオプションで、後ろのテストファイルのパスを出力先として受け取り、追跡しているテストファイル（未 commit の追加を含む）を一覧の JSON で上書きした。
終了コードは 0 で、続けて実行した `vitest list` が「このファイルのテストは 0 件」と返したことで気づいた。HEAD から戻し、追加分を入れ直した（手戻り 1 回）。
Markdown の手順書ではなく、エージェントが直接打つコマンドで起きた。値を任意に取るオプション（`--json[=<path>]`）は、可変長と同じく直後の位置引数を飲み込む。

## 根本原因

- なぜ落ちるか → 可変長オプションの直後に位置引数を置いた
- なぜ書かれたか → 手順書のコマンドは実行されず、テスト・lint も Markdown 内のコマンドを検証しない
- なぜコピーしたか → 既存の前例を「検証済み」と扱った。実走の規約（external-tool-format-verification）は新規の記述にしか意識されず、強制点も無い

## 提案

Markdown のシェルコードブロックで、可変長オプション（`playwright test --project` 等）の直後に位置引数が続く形を落とす lint を、`scripts/gates/code/lint-pagination.ts` と同じ起点に足す。

- 対象 CLI とオプションは表で持ち、陽性（パスを後ろに置いた形）と陰性（パスを先に置いた形・`--project=a`）の両方をテストに置く
- 横断: skills/ 内の `--project <名前> <パス>` 形は 2 件（今回修正済み）
- 再発（2026-10-14）を受けて: 値を任意に取るオプション（vitest の `--json`・`--outputFile` など）は、値を `=` でつなぐ形だけを書く。
  エージェントが直接打つコマンドも対象にするなら、手順書の lint ではなく PreToolUse で `--json <位置引数>` の形を止める機構が要る。
  ただし `2026-10-09-fix-at-cause-before-caller-check` の観点（呼び出しの形を読む検査は列挙が尽きない）に照らして、置き場所を apply で決める
