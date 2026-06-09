---
date: 2026-06-09
type: doc
priority: high
status: pending
session: claude-code
---

## 事象

PR #17 のレビューで、同一ドキュメント内の**用語・構造の不整合**が複数ラウンドにわたり指摘された。

- `dependabot-alert-issue/SKILL.md`: gh メカニクスで `dependency.scope` を `runtime` / `development`
  （API の値）と説明しているのに、「Issue 本文の規約」では影響範囲を `devDependency`（npm の語）と書き、
  同じ概念を別表記にしていた。
- `kaizen/references/setup.md`: 構造説明文で「イベント→`matcher`＋`hooks` 配列」と書いたため matcher が
  必須に読めるが、直下の Codex Stop 例では matcher を省略し、次行では「Stop は matcher 無視」と説明していて、
  散文と例が食い違っていた。

いずれも自分の編集で持ち込んだ内部不整合で、レビュー（Copilot）で初めて発覚した。前ラウンドの未定義参照リンク
（[[2026-06-09-markdown-shortcut-reference-link-pitfall]]）と合わせ、**同一ドキュメント編集後の自己整合チェック漏れ**が
3 ラウンド連続で繰り返された。

## 根本原因

- なぜ不整合が混入したか? → ある概念を一箇所で書いた後、同じ概念を別の節で書くときに既出の表記・前提を
  見直さず、その場の言葉で書いた。
  - なぜ見直さなかったか? → 編集後に「同じ用語/構造を別の場所で違う形で書いていないか」を**ドキュメント全体で
    突き合わせる確認ステップ**を踏んでいなかった。
    - なぜ踏まなかったか? → 個々の編集（Edit）単位で正しさを確認し、ドキュメント全体の整合は
      レビュー任せになっていた。← 根本原因（自分で閉じられる確認の不在）

KEDB 照合: `2026-06-08-skills-agents-sync-drift.md` は skills/↔.agents/ の**ファイル間コピー同期**の話で軸が違う
（こちらは**単一ドキュメント内**の用語・散文/例の整合）。同種は初出のため新規記録。

## 提案

`type: doc`。ドキュメント（SKILL.md / references）を編集して push する前に、**自己整合パス**を 1 回入れることを
執筆プロセスに明記する（`docs/skill-development.md` か `.agents/rules/`）。具体的には:

- API 値・enum・コマンドのフラグ名など**外部由来の語**は、ドキュメント内で 1 つの表記に統一する
  （例: `dependency.scope` は `development`。npm の `devDependency` と混在させない。混ぜるなら対応関係を併記）。
- **散文の説明と直後のコード例を突き合わせる**（「常に必要」と書いたフィールドを例で省略していないか等）。
- 編集した概念のキーワードで対象ファイルを `grep` し、別表記・矛盾記述が残っていないか確認してから push する。

## 追記（2026-06-10: 同根の再発 — 整合パスのスコープを「リポジトリ横断」へ拡張）

Issue #18 の対応で同じ根本原因が**ファイル間**で再発していたことを確認した。

- Issue が報告したのは `multiagent-setup/evals/README.md` の skill-creator 探索先漏れ（`.agents/skills` 欠落）のみだが、
  リポジトリ横断 grep で `dependabot-merge` / `dependabot-alert-issue` の evals/README.md にも同じ欠陥を発見した。
- さらに後者 2 ファイルは、過去の修正で `find` コマンド側だけ `.agents/skills` が追加され、直前の散文（前提条件）は
  旧記述のままという**部分適用ドリフト**になっていた。複製ボイラープレートへの修正が「報告されたファイル単位」で
  止まり、他の複製に波及していなかった証拠。

**提案の拡張**: 自己整合パスは単一ドキュメント内に閉じず、**複製ボイラープレート（スキル間で複製された
evals/README.md 等）はリポジトリ横断で grep してから修正する**。修正対象の文字列・コマンド断片で
`grep -rn <キーワード> skills/` を実行し、全複製に同じ修正を適用してから push する。
恒久対策としては、evals/README.md の共通節を単一ソース（テンプレート）化するか、スキル間の共通節一致を
検査するスクリプトを lint に追加することを検討する（`scripts/check-skills-sync.mjs` と同系の決定論的ゲート）。
