# Skill change verification: parity-suite eval 29

- 実行日時: 2026-09-09 18:11–18:13 JST
- Executor / model: Codex / `gpt-5.6-sol`（reasoning effort: medium）
- スコープ: eval 29、`with_skill` / `without_skill` 各 1 successful run
- 隔離: 両方 sandboxed、`without_skill` の contamination は clean

| Configuration | 結果 | 時間 | Tokens |
|---|---:|---:|---:|
| with_skill | 4/5（80%） | 78.3s | 176546 |
| without_skill | 2/5（40%） | 44.7s | 55641 |
| Delta | +40 points | +33.5s | +120905 |

`with_skill` は、待たない API の危険、Locator と自動リトライ assertion への置換、`auto-wait-check.mjs`、遅延描画の故障注入まで到達した。
未達の 1 assertion は、`retries` は明示的に退けた一方で `waitForTimeout` を回答中に明示しなかったもの。
`without_skill` も一般的な Playwright 知識から競合と `retries` の問題を説明できたが、即時読み取りの全面禁止、同梱検査、故障注入には到達しなかったため、弁別は残っている。

18:00 JST に開始した `run-1` は、従来の比較モデル `gpt-5.4` が現在の ChatGPT 認証では非対応となり、両 configuration とも入力・出力 0 token で失敗した。
executor は変更せず、利用可能な `gpt-5.6-sol` で `run-2` を取り直した。これは変更確認であり、3 run の benchmark には広げていない。
