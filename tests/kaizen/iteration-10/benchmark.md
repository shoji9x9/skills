# Skill Benchmark: kaizen

**Model**: claude-opus-5[1m]
**Date**: 2026-08-20T08:47:44Z
**Evals**: 16 (1 run each per configuration)

## Summary

| Metric | With Skill | Without Skill | Delta |
|--------|------------|---------------|-------|
| Pass Rate | 100% ± 0% | 0% ± 0% | +1.00 |
| Time | 179.8s ± 0.0s | 282.9s ± 0.0s | -103.1s |
| Tokens | 5468 ± 0 | 4344 ± 0 | +1124 |

## 実行条件

- 実行日: 2026-08-20（Issue #176）
- ハーネス: `scripts/run-skill-eval.sh`（両 configuration とも `scripts/eval-sandbox.sh` の bwrap サンドボックス経由）
- 隔離: 両 run とも `isolation: sandboxed`。baseline の `contamination.txt` は `verdict: clean`
- run 数: 1 run / configuration（レート予算の制約。3 runs は未取得で、分散 ± 0 は run 数 1 の帰結であり安定性の証拠ではない）
- 対象: eval 16 のみ（`--record-pending` 限定非対話モードの新規追加分）。eval 1〜15 は本 iteration の対象外

## analyst notes

### 弁別

7 assertion すべてが弁別した（with 7/7、baseline 0/7）。baseline は実装不在を正直に申告し推測で埋めなかったため、非弁別項目はゼロ。
特に強い弁別は次の 2 点。

- **未知形式の扱いが逆**: baseline は「パースできても解釈できないスキーマは候補なし側へ落とす」と結論した。
  スキルの契約は未知形式を scanner exit 2 の fail closed（BLOCKED）とすることで、no-op に倒さない。
  「候補ゼロ」を安全側に見せる誤りは baseline が自力で踏むため、この assertion は後退検知としても機能する。
- **agent 軸の不在**: baseline の議論は transcript の**レコード形式**（Claude 形式 / Codex 形式 / 未知）に閉じ、
  「current transcript を同定できる agent か」という軸を持たない。Copilot の BLOCKED 条件へ到達する経路が無い。

### 時間・token のトレードオフ

with_skill は baseline より **103.1s 速く**（179.8s vs 282.9s）、出力 token は **+1124** 多い。
baseline は参照スキャナ・採点・ablation の 3 スクリプトを自作して実測したため時間を消費した。
with_skill は同梱の `kaizen-candidate-scan.sh` / `kaizen-extract-done.sh` / `kaizen-status-check.sh` を実行するだけで済み、
その分を報告の密度（両分岐の実行トレース・fail closed 一覧・通常モードとの比較表）に充てている。

### flaky 懸念

run 数 1 のため run 間のばらつきは測れていない。以下は次 iteration で観測したい箇所。

- assertion 1 の「候補を最大 1 件に制限する」は §1 の 1 文にのみ現れる。プロンプトが件数を直接問うていないため、
  自発的言及に依存しており run 間で落ちうる。
- assertion 3 の陽性コントロールは、プロンプトが「fixture の candidate scanner で検出能力も実測して」と
  明示的に問うている。ここは到達が保証されている。

### eval / fixture へのフィードバック

baseline が自作スキャナに対する ablation で、`skills/kaizen/evals/fixtures/candidate-scan/claude-no-candidate.jsonl` は
どの検出ルールを壊しても回帰せず弁別力を持たない、と指摘した。
実スキルの `kaizen-candidate-scan.sh` に対しては「Claude 形式の真陰性」と「`scanned-bytes` / `scanned-lines` の出力」を
確認する役割があるため無価値ではないが、ノイズレコード種別を増やしても検出ルールを縛れていない点は fixture 強化の余地として残す。
本 iteration では変更していない。
