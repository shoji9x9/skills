# Skill Benchmark: parity-component

**Model**: claude-code / opus（CLI 2.1.278 (Claude Code)、harness `run-skill-eval/3`）
**Date**: 2026-09-22
**Evals**: 7 のみ（`with_skill` / `without_skill` 各 1 run。変更確認スコープなので Delta の数値は語らない）

## 何を変えたか

Issue #433（build 手順が `css-rules.json` の `matched` のカスケード解決を求めていない）に対して、
手順 4 と `references/catalog.md` に確定の手順を足し、同梱ツール `scripts/cascade-resolve.mjs` を新設した。
その挙動を測るために eval 7（fixture `cascade-conflict`）を新設した。

fixture は実ブラウザで生成し、現行アプリで実際に起きた 2 形を仕込んである。

| 競合 | 仕込み | 勝者 | 素朴な読み方が採る値 |
|---|---|---|---|
| `width`（orders-search） | インライン `10px` ／ `.searchbox-btn { width: 40px }`(order 7) ／ `.searchbox-btn { width: 60px !important }`(order 9) | `60px` | `10px`（インラインだけ読む）／ `40px`（matched の最初） |
| `letter-spacing`（両インスタンス） | `.btn { letter-spacing: normal }`(order 8) ／ `.btn { letter-spacing: 1px }`(order 10) | `1px` | `normal` |

どちらも `trait-capture.mjs` の `FIXED_PROPERTIES` に無いプロパティを選んである
（集合にあるプロパティで競合を作ると `traits.json` の `computed` が勝者をそのまま持ち、
「カスケードを解いたか」ではなく「計算値を写せたか」を測ることになる）。

## Summary

| eval | with_skill | without_skill | 弁別した assertion 数 |
|---|---|---|---|
| 7 カスケードを解いて勝っている宣言を確定する | 8/8 | **8/8** | **0** |

2 run とも `isolation.txt` は `sandboxed`、`without_skill` の `contamination.txt` は `clean`
（マーカーは `parity-component` の同梱物 12 件。`parity-suite` にも同じパスがある `assets/metadata-template.json` は除外された）。
`skill_usage` は `with_skill` が `invoked: true` / `read: true`、`without_skill` が `read: false` / `unexpected_read: false` で、
どちらも `invalid_run: false`。除外した run は無い。

## 読み取れたこと

- **eval 7 は弁別しない。** `without_skill` も `css-rules.json` を自分で開き、
  「重要度 → 出所 → 詳細度 → 文書順」を明示して `width: 60px` と `letter-spacing: 1px` を当てた。
  負けた宣言（インライン `10px`・order 7 の `40px`・order 8 の `normal`）を新側へ写さない判断も、
  users-create が内容幅である対照も、両 config で同じように出た。
- **原因は「カスケードの解き方」が LLM の一般知識だから。** スキルが足しているのは
  「解け」という指示と、手で解かずに `cascade-resolve.mjs` へ出させる経路であって、
  解ける／解けないの能力差ではない。この fixture の競合は 1 プロパティあたり 2〜3 宣言と小さく、
  prompt が「採取物のどこを根拠に」と読む先を示しているため、baseline も同じ結論へ届く。
- **Issue #433 が報告した実際の失敗は、この eval が作った状況より難しい。**
  `feedback-message` / `pagination` / `radio-button` の 3 件は「`matched` を読んではいたが、
  基礎 → テーマ層 → 個別テーマの 3 層に散った再宣言のうち最初の 1 件を採った」形だった。
  規則数が多く、どの宣言が同一プロパティを争っているかが一覧では見えない状態が failure mode で、
  合成 fixture でそれを再現するには「実アプリ規模のスタイルシート」が要る。
- **`with_skill` は `cascade-resolve.mjs` を 8 組合せすべてで実行し `undecidable` 0 を確認した**うえで結論を出しており、
  導線自体は機能している（手作業の読解に戻っていない）。`without_skill` は手で解いた。
  つまり測れたのは「ツールが使われるか」であって「結論が変わるか」ではない。
- **assertion 2 の文言が緩い。** 「`width` の最終値として 60px を採っており」に対し、両 config とも
  「勝者は 60px。ただし部品には `width` を書かず、呼び出し側（story ローカルクラス）へ落とす」と答えた。
  これは正しい判断だが、assertion の字面は「部品に 60px を書く」とも読める。次に触るときに書き分ける。

## 次にどうするか（未実施）

- **eval 7 は Delta に寄与しない。** eval 3 と同じく**後退検知**（この判断がスキル改訂で失われていないか）専用として扱うか、
  cue を落とした prompt で取り直して弁別が戻るかを見るかを決める必要がある
  （判断の正本は `.agents/rules/eval-assertion-discrimination.md`
  「cue を消しても弁別しないなら、その項目はこの eval では測れないと結論する」）。
- 実アプリ規模の競合（3 層 × 多数の規則）を fixture に持ち込めるかは未検討。
  持ち込めないなら、この Issue の効果は eval ではなく `cascade-resolve.mjs` のユニットテスト
  （`scripts/cascade-resolve.test.js`。実測 3 件を回帰ケースにしてある）で担保する。
