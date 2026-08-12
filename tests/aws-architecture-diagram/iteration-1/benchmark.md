# Skill Benchmark: aws-architecture-diagram

**Model**: claude-opus-5
**Date**: 2026-08-12T12:02:48Z
**Evals**: 4 (1 run each per configuration)

## Summary

| Metric | With Skill | Without Skill | Delta |
|--------|------------|---------------|-------|
| Pass Rate | 100% ± 0% | 33% ± 0% | +0.67 |
| Time | 442.5s ± 0.0s | 1399.2s ± 0.0s | -956.7s |
| Tokens | 28855 ± 0 | 96745 ± 0 | -67890 |

## Notes

- Issue #196（エッジラベルの屈曲点回避・`labelAt` 追加・直交検査のエンジン強制・`preview-diagram.mjs` のコンテナ安定化）実装後の回帰。
  対象は assertion を書き換えた eval 4 のみ。未変更の eval 1/2/3 は今回走らせていない。
- with_skill は 6 アサーション全通過。without_skill は 2/6。Delta +0.67 は eval ごとの pass_rate 平均差。
- 1 run/configuration のため configuration 内の分散は測っていない（表の ± は eval 間のばらつきで、今回は 1 eval なので 0）。
- eval 4 のプロンプトは今回 2 度直している。
  1 度目は「エッジラベルが屈曲点に重なる」手掛かりが無く `labelAt` のアサーションに到達しなかった（with_skill が 5/6）。
  2 度目はエッジラベルだけを問う形にしたため、今度はノードラベルの手掛かりが消えて `lp` のアサーションに到達しなくなった。
  最終形は斜め線・ノードラベル・エッジラベルの 3 症状すべてを問う。到達しなかった run は採用していない。
- 最終プロンプトでの初回実行は両 configuration ともセッション上限で失敗した。
  `result.json` が `is_error: true`・本文がセッション上限メッセージで、`subtype` は `success`・ハーネスの exit も 0 のため、
  **終了コードだけでは無効を判別できない**（採点前に `is_error` を見る必要がある）。
  上限リセット後に同一プロンプトで取り直し、その結果を採用している。
- read 隔離: without_skill は contamination verdict = clean。
  baseline はスキル資産に到達せず、独自の Python ジェネレータ（グリッド吸着・レーン配線・ラベル位置のコスト最小化）を自作している。
- 非弁別アサーション（baseline も満たした 2 項目）: 「再生成 → PNG 目視確認のループ」「推測せず PNG を実際に確認」。
  baseline は headless Chrome で `preview.png` を出して反復修正しており、スキル非依存の一般的振る舞いで到達できる。
  Delta ではなく**後退検知**の項目として残す。
- 弁別している 4 項目（with_skill 4/4・baseline 0/4）は conventions.md 参照・`waypoints`/`lp` の語彙・
  `diagram-engine.mjs` が斜めをエラーで止める契約・`labelAt`。
  今回の変更で追加した 2 項目（直交検査・`labelAt`）は、with_skill が原因条件
  （端点 waypoint は接続先ノード中心の ±20px 以内）まで説明して満たした。
- 時間・トークンは baseline が 1399s / 96.7k tokens と大きいが、これは自作ジェネレータを書き切ったためで、
  スキルの優位として読むには 1 run では足りない。
