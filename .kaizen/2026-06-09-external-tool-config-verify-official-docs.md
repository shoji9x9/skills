---
date: 2026-06-09
type: rule
priority: high
status: pending
session: claude-code
---

## 事象

kaizen の配布スキル `skills/kaizen/references/setup.md` が、Codex の Hook 設定を
「Codex はトップレベルにキーを併置」と記載し、3 つの Codex JSON 例（Stop / PreToolUse / SessionStart）も
`{"Stop":[{"command":...}]}` のようなフラット構造で、`hooks` オブジェクト入れ子・matcher グループ・
`type: "command"` を欠いていた。ユーザー指摘で公式ドキュメント（developers.openai.com/codex/hooks）を
WebFetch して照合した結果、**Codex も Claude Code と同じく `hooks` 配下にイベント→`matcher`＋`hooks` 配列→
`type:command` の入れ子構造**であり、記載が誤りだったと判明。修正後さらに、matcher の値も Claude から流用した
`""` のままで、公式例（SessionStart=`startup|resume`、Stop は matcher 無視、PreToolUse=`Bash`）と不一致だった
（2 周目の指摘で field レベルまで是正）。

## 根本原因

最低 3 階層の「なぜ」:

- なぜ誤った構造で配布スキルに書かれていたか? → Codex hooks の例を公式一次ドキュメントで裏取りせず、
  推測（「Claude と違ってフラットだろう」）で書いていた。
  - なぜ推測で書いたか? → 外部ツール（Codex / Copilot / gh 等）の設定・API フォーマットを例示するとき、
    公式一次情報で構造とフィールド意味論を検証する手順がスキル作成プロセスに無かった。
    - なぜ手順が無かったか? → 「自エージェント（Claude Code）の知識で外部ツールの形式も書ける」と暗黙に
      仮定し、配布物が他エージェント環境で実際に動くかの検証を義務化していなかった。← 根本原因（対策可能）

横断スコープ確認: 同じ `setup.md` の **Copilot** Hook JSON（`version` + camelCase イベント名 `sessionEnd`/
`preToolUse`/`sessionStart`）、`dependabot-alert-issue` の **gh API** shape（`dependabot/alerts` のフィールド・
`dismissed_reason` enum）、`dependabot-merge` の `gh pr list --author "app/dependabot"` など、
**外部ツールの一次仕様に依存する例示は全スキルに点在**する。いずれも「公式で裏取り済みか」が未検証のまま
配布され得る。matcher のような **field レベルの意味論**（空文字が match-all か、Stop で無視されるか）まで
検証しないと、構造を直しても挙動が静かにずれる。

KEDB 照合: `2026-06-05-verify-review-claims-against-source.md`（レビュー主張をソースで裏取り）と
**同じ「推測で断定せず一次情報で検証する」系**だが、対象が「レビュー主張 → ソースコード」ではなく
「外部ツールの設定/API フォーマット → 公式ドキュメント」で軸が異なるため新規記録とする。

## 提案

`type: rule`。配布スキルで外部ツールの設定・API フォーマットを例示する際の検証を義務化する。
`.agents/rules/` に新規ルール（例: `external-tool-format-verification.md`）を追加し、`AGENTS.md`
「参照ルールガイド」から参照する。ルール文面（案）:

> # 外部ツール設定・API フォーマットの一次情報検証
>
> 配布スキル（`skills/<name>/`）が Codex / GitHub Copilot / `gh` / GitHub API など**外部ツールの
> 設定ファイル・Hook・API レスポンス形状**を例示・前提にする箇所は、自エージェントの記憶で断定せず、
> **公式一次ドキュメントで構造とフィールド意味論を検証**してから記述する。
>
> - 構造（入れ子・キー名・必須/任意）だけでなく、**フィールドの意味論**（matcher が正規表現か・空文字が
>   match-all か・特定イベントで無視されるか、enum の許容値、null の意味）まで確認する。
> - 検証に使った一次ドキュメントの URL を該当箇所に併記する（例示の根拠を残し、次回の再検証を容易にする）。
> - 自エージェント（Claude Code）と他エージェント（Codex / Copilot）で**構造が同じだと仮定しない**。
>   各エージェントの公式ドキュメントを個別に確認する。

横断スコープの是正: 上記ルール適用時に、`setup.md` の Copilot JSON、`dependabot-alert-issue` の gh API 例、
`dependabot-merge` の `gh pr list` 例についても一次情報での裏取り状況を点検し、URL 併記する。
