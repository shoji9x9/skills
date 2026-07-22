---
paths:
  - "skills/**"
applyTo: "skills/**"
---

# 配布スキルは基底ドキュメントを AGENTS.md に決め打ちしない

配布スキル（`skills/<name>/`）は、インストール先が必ずしも `AGENTS.md` を使うとは限らない
（Claude Code のみ＝`CLAUDE.md`、GitHub Copilot のみ＝`.github/copilot-instructions.md` の下流もある）。
学びの反映先・自己設定制約の追記先・「常に守る方針の置き場所」などを、**そのファイルが存在する前提に
機能が依存する形で `AGENTS.md` へ決め打ちしない**。

- 「プロジェクトが常時ロードする**基底ドキュメント**（`AGENTS.md`、無ければ `CLAUDE.md` /
  `.github/copilot-instructions.md`）」へ読み替えられる表現にする。AGENTS.md を持たない下流でも伝播が効くようにする。
- `AGENTS.md` を単なる**例**として挙げる（`AGENTS.md` 等 / 探索候補の一つ）のは可。避けるのは、
  その名前のファイルが在る前提に機能が依存する書き方。
- 基底ドキュメントの定義・`**` ルールにせず基底ドキュメントへ寄せる判断・skill / rule / hook / doc の
  振り分け基準は、`multiagent-setup` の `references/component-selection.md` を single source of truth として参照する
  （本ルールで再定義しない）。
