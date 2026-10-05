---
paths:
  - "skills/**"
applyTo: "skills/**"
---

# 配布スキルは基底ドキュメントを AGENTS.md に決め打ちしない

配布スキル（`skills/<name>/`）のインストール先が、`AGENTS.md` を使うとは限らない。
Claude Code だけを使うプロジェクトは `CLAUDE.md` を、GitHub Copilot だけを使うプロジェクトは `.github/copilot-instructions.md` を使う。
学びの反映先、自己設定の制約の追記先、常に守る方針の置き場所などを `AGENTS.md` に決め打ちして、そのファイルが無いと機能しない書き方にしない。

- 「プロジェクトが常に読み込む基底ドキュメント（`AGENTS.md`、無ければ `CLAUDE.md` か `.github/copilot-instructions.md`）」と読み替えられる書き方にする。
  そうすれば、`AGENTS.md` を持たないプロジェクトにも反映できる。
- `AGENTS.md` を例として挙げる書き方（「`AGENTS.md` など」「探す候補の 1 つ」）はよい。
  避けるのは、その名前のファイルがあることを前提に機能が動く書き方である。
- 基底ドキュメントの定義、`**` を対象にする rule にせず基底ドキュメントに書くかの判断、skill・rule・hook・ドキュメントの振り分けの基準は、`multiagent-setup` の `references/component-selection.md` で定義する。
  この rule では定義し直さない。
