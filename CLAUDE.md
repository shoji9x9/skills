# Claude Code 設定

プロジェクトの概要・ディレクトリ構造・ワークフロー・スキル開発・テスト実行・リリースは、全エージェント共通の `AGENTS.md` を参照する。

このファイルには Claude Code 固有の設定だけを置く。

## モデル運用方針（Fable 5 サブスク提供期間中・2026-07-19 まで）

Fable 5 は **2026-07-19 23:59:59 PT まで**（2026-07-07 → 07-12 → 07-19 と再延長）全有料プランに追加費用なしで含まれる（週次利用上限の最大 50%。以降はクレジット課金）。Claude Code の週次レート上限 50% 増も同日まで。
出典（一次情報）: 公式ヘルプ「Claude Fable 5 promotional access」<https://support.claude.com/en/articles/15424964-claude-fable-5-promotional-access>（"through July 19, 2026 at 11:59:59 PM PT" と時刻・タイムゾーンまで明記）。
再延長の告知は Claude 公式 X「We're extending Claude Fable 5 access on all paid plans, as well as keeping Claude Code's weekly rate limits 50% higher, through July 19.」<https://x.com/claudeai/status/2076351399999557669>。
当初条件は Anthropic「Redeploying Claude Fable 5」<https://www.anthropic.com/news/redeploying-fable-5>（同ページは 2026-07-17 時点でも 7/7 表記のまま未更新）。

- **このメインセッションが Fable 5 で動作している場合（上記期間内）**: トークン節約のため、実装は Opus / Sonnet を適切にサブエージェント（Agent ツール）として切り出して実行し、メインセッション（Fable 5）は**設計・監査・レビュー**に専念する。実装難易度が特に高い箇所はメインセッションで実装してよい。
- **メインセッションのモデルを明示的に Opus 4.8 等に指定している場合**: Fable 5 は原則利用しない（サブエージェントにも Fable 5 を指定しない）。メインセッションでそのまま実装・レビューを進める。
- **2026-07-19 を過ぎたら本節は見直す**（Fable 5 がクレジット課金になるため、既定の委譲方針は解除する）。
