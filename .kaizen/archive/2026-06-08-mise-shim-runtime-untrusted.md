---
date: 2026-06-08
type: doc
priority: medium
status: applied
session: claude-code
---

## 事象

eval セッション横断集計で、エージェントが直接叩くランタイムが mise shim 経由で落ちる失敗が **7 件**:

- `mise ERROR No version is set for shim: python3` （kaizen で多発）
- `mise ERROR No version is set for shim: node`

kaizen スキルは JSONL セッションログの解析に `python3` の使用を前提とする（`references/extract.md`）ため、
**スキル自身が依存するランタイムが起動できず自家中毒**する場面があった。

## 根本原因

最低 3 階層の「なぜ」:

- なぜ python3/node が起動しないか? → `python3` が mise の shim で、その時点のディレクトリの
  `mise.toml` が untrusted（または version 未設定）のため shim がエラー終了する。
  - なぜ untrusted か? → eval/worktree の使い捨てプロジェクトでは `mise trust` が走っておらず、
    mise が安全側に倒してツールを解決しないため。
    - なぜ代替が無いか? → スキルがランタイムを **mise shim 単一依存**で呼び、shim 失敗時の
      フォールバック（システム python3 / `mise exec` / 明示パス）が無いため。← 根本原因

KEDB 照合（**強ヒット＝再発**）: `[[2026-06-04-gate-jq-dependency]]`（jq shim、status: applied）と
`[[2026-06-08-pnpm-is-the-package-manager]]`（pnpm/mise shim、PATH 解決の誤解）が同根。
ただし既存は **ゲートの jq** と **pnpm** のみ対応で、**エージェントが直接叩く python3 / node** は未カバー。
横断スコープ: mise 管理の全ランタイム（python3 / node / jq / 他）に共通する untrusted 環境での落とし穴。

## 提案

applied 済みの `[[2026-06-04-gate-jq-dependency]]` には追記しない（参照注入は pending のみ供給するため死蔵する）。
恒久側を更新して再発防止を一般化する:

1. **eval fixture / setup（type: doc）**: 使い捨てプロジェクト生成時に対象に対して `mise trust` を実行する
   （または mise に依存しないシステムランタイムを PATH 前段に置く）。`docs/skill-development.md` の
   eval 隔離手順に「mise shim は untrusted 環境で失敗する → trust する」を追記。
2. **スキル（kaizen 等）**: ランタイム呼び出しを多段フォールバックにする
   （`gate-jq-dependency` で jq に施した jq → python3 → 生 JSON と同じ思想を python3/node にも展開）。

教訓（一般化）: **mise shim 経由のツール（python3 / node / jq）は untrusted な worktree/eval で必ず落ちうる。
スキルが依存するランタイムは、shim 単一依存にせず trust 前提か多段フォールバックで起動する。**
