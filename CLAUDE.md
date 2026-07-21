# Claude Code 設定

@AGENTS.md

プロジェクトの概要・ディレクトリ構造・ワークフロー・スキル開発・テスト実行・リリースは、全エージェント共通の `AGENTS.md`（上の `@AGENTS.md` インポートでセッション開始時に自動注入される）を参照する。

このファイルには Claude Code 固有の設定だけを置く。

## モデル運用方針（2026-07-20 以降）

Fable 5 は **2026-07-20 から Max / Team Premium プランに恒久的に含まれる**（週次利用上限の最大 50%）。Pro / Team Standard はサブスクに含まれず、ユーセージクレジット課金（一時金 $100 クレジット付与）。
出典（一次情報）: Claude 公式 X「Beginning July 20, Claude Fable 5 will be included in all Max and Team Premium plans, at 50% of limits.
Pro and Team Standard users will continue to have access to Fable via usage credits, and will receive a one-time $100 credit.」
<https://x.com/claudeai/status/2078302415804379218>（2026-07-17）。
Claude Code の週次レート上限 50% 増は **2026-08-19 23:59:59 PT まで**延長。
出典: 公式ヘルプ「Claude Fable 5 promotional access」<https://support.claude.com/en/articles/15424964-claude-fable-5-promotional-access>。
同記事は 2026-07-19 時点でプロモーション終了（7/19）と Claude Code の 8/19 延長のみ記載で、7/20 以降の Max / Team Premium 恒久包含は未反映（恒久包含の一次情報は上記 X 投稿のみ）。

- **このメインセッションが Fable 5 で動作している場合**: Fable 5 の消費（サブスク包含プランでは週次上限の最大 50% 枠、非包含プランではクレジット）を抑えるため、実装は Opus / Sonnet を適切にサブエージェント（Agent ツール）として切り出して実行し、メインセッション（Fable 5）は**設計・監査・レビュー**に専念する。実装難易度が特に高い箇所はメインセッションで実装してよい。
- **メインセッションのモデルを明示的に Opus 4.8 等に指定している場合**: Fable 5 は原則利用しない（サブエージェントにも Fable 5 を指定しない）。メインセッションでそのまま実装・レビューを進める。
- **2026-08-19 を過ぎたら** Claude Code 週次レート上限 50% 増の記述を見直す。Fable 5 の提供条件・課金体系が変わった場合も本節全体（委譲方針を含む）を見直す。
