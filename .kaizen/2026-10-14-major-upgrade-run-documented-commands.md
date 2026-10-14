---
date: 2026-10-14
type: doc
priority: medium
status: pending
applied-to: []
session: claude-code
---

# ツールの major 更新で、文書とスキルに書いたコマンドを新しい版で実行していなかった

## 事象

Issue #600 で pnpm を 11 から 12 に上げた。事前の確認では、依存の `engines`、pinact の破壊的変更とリポジトリの呼び出し、Dependabot の対応状況を調べた。
PR #618 の Copilot のレビューで、`pnpm update <pkg> --depth Infinity --lockfile-only` が pnpm 12 では exit 2 で止まると指摘された。
このコマンドは、配布スキル `dependabot-alert-issue` と private skill `pnpm-audit-alert-issue` の手順に書いてあった。
使い捨てのコピーで実測すると、pnpm 12.10.1 は `invalid digit found in string` で拒否し、pnpm 11.23.0 は受け付けた。

## 根本原因

- なぜ見落としたか → 新しい版で確かめたのは、テスト・型の検査・lint と、リポジトリが CI と Hook で呼ぶコマンドだけだった
- なぜそこで止めたか → 文書とスキルの手順に書いたコマンドは、テストも CI も実行しない。新しい版で拒否されても、何も失敗しない
- なぜ手順が無いか → `docs/package-manager.md` の bump の手順は、版をそろえる 4 か所と lockfile の差分の範囲だけを扱い、文書に書いたコマンドを新しい版で確かめる段が無い

## 提案

ツールの major 更新では、文書とスキル（`docs/`・`skills/`・private skill・`AGENTS.md`）に書いたそのツールのコマンドを grep で挙げ、新しい版と古い版の両方で使い捨てのコピーに実行して、受け付けられるかを確かめてから PR にする。

- 適用先の候補: `docs/package-manager.md` の bump の手順に 1 段足す。pnpm 以外の mise のツールの major 更新にも当てる
- 配布スキルの手順は、利用者が古い版も使うので、両方の版で受け付ける書き方（今回は `--depth 9999`）にする
