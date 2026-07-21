---
date: 2026-06-09
type: rule
priority: high
status: applied
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

## 追記（再発: 2026-07-01・新スキル pr-finalize-loop）

新スキル `skills/pr-finalize-loop/SKILL.md` の CI 失敗判定で、`gh pr checks` の出力 state を記憶から
列挙して `select(.state=="FAILURE" or .state=="ERROR")` と書いた。code-review で、完了系 conclusion の
`TIMED_OUT` / `CANCELLED` / `STARTUP_FAILURE` / `ACTION_REQUIRED` / `STALE` を取りこぼし、それらで CI が
落ちると `--watch --fail-fast` は非 0（失敗）で返るのにフィルタは空を返す、と判明。`gh pr checks --help`
を実機確認したところ、各チェックには `state` を `pass`/`fail`/`pending`/`skipping`/`cancel` に正規化する
**`bucket` フィールド**があり、`select(.bucket=="fail")` が上記失敗群をまとめて内包する。`bucket` 採用で是正。

- **同じ根本原因の再発**: 外部 CLI（`gh`）の出力モデル（enum の全許容値・正規化フィールドの有無）を一次情報
  （`gh <cmd> --help`／公式 doc）で確認せず、記憶で enum を部分列挙した。本ファイルの根本原因と同型。
- **横断スコープ（gh の出力 enum 列挙）**: 他スキルでも `gh` 出力の状態値・enum をハードコードしている箇所
  （`dependabot-merge` の `mergeStateStatus`=`CLEAN`/`BLOCKED`/`BEHIND`/`UNSTABLE`/`DIRTY` 列挙、`gh pr checks`
  利用箇所、`dependabot-alert-issue` の `dismissed_reason` enum 等）は、正規化フィールド（`bucket` 等）の有無と
  enum の全許容値を一次情報で点検する。ルール文面に「**CLI/API の出力 enum を部分列挙せず、ツールが提供する
  正規化フィールド（例 `gh pr checks` の `bucket`）を優先し、全許容値を `--help`/公式 doc で確認する**」を追加する。
