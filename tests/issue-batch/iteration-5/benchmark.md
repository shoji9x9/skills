# Skill Benchmark: issue-batch

**Model**: claude-opus-5（`--model` 未指定の既定）
**Date**: 2026-08-28
**Evals**: 10, 16, 17, 18, 19, 20（1 run each per configuration）

## Summary

| Metric | With Skill | Without Skill | Delta |
|--------|------------|---------------|-------|
| Pass Rate | 100% ± 0% | 47% ± 29% | +0.53 |
| Time | 89.3s ± 6.5s | 97.4s ± 21.4s | -8.2s |
| Tokens | 138275 ± 30828 | 107210 ± 32947 | +31065 |

数値は `benchmark.json` の `run_summary` と同じ入力（各 run の `timing.json`）から算出している。

## 実行条件

- 実行日: 2026-08-28（Issue #241 / merge mode の選択制化）
- 対象: 今回変更した eval 10 と新規追加した eval 16〜20 のみ（eval 1〜9・11〜15 は未再実行）
- ハーネス: `scripts/run-skill-eval.sh`。**両 configuration とも** `scripts/eval-sandbox.sh` の bwrap サンドボックス経由（全 12 run の `isolation.txt` が `sandboxed`）
- executor: `claude-code` CLI 2.1.250、`--model` 未指定（両 configuration 同一）
- run 数: 1 run / configuration
- 全 baseline の `contamination.txt` は `verdict: clean`
- 採点: 応答（`result.json`）に対する手採点。今回の 6 eval はいずれも dry-run 報告のみを求めるため成果物は生成されない（`project-tree.txt` は空、`project-files-skipped.txt` は 0 行）
- eval 10 は assertion を 4 本から 3 本へ減らしたが、プロンプトは変えていないため**再実行せず同一 run を再採点**している

### eval 別 Delta

| eval | 内容 | with | without | Delta |
| --- | --- | --- | --- | --- |
| 10 | auto mode の merge 完了判定（既存 eval を mode 明示に改訂・assertion 1 を eval 20 へ移設） | 3/3 (100%) | 2/3 (67%) | +33pt |
| 16 | agent mode の merge 前判定（新規） | 6/6 (100%) | 4/6 (67%) | +33pt |
| 17 | `--merge-mode` の解決と auto mode の preflight（新規） | 4/4 (100%) | 2/4 (50%) | +50pt |
| 18 | 必須チェック 0 件での agent 判定（新規） | 4/4 (100%) | 3/4 (75%) | +25pt |
| 19 | 新キー欠落の旧設定での停止（新規） | 4/4 (100%) | 0/4 (0%) | +100pt |
| 20 | pr-finalize-loop への handoff（新規・移設先） | 4/4 (100%) | 1/4 (25%) | +75pt |

## 所見

### eval 10 assertion 1 の移設（この iteration 中に実施）

当初の実行では「pr-finalize-loop だけに remote AI review を委譲する」が with / without ともに FAIL した。
原因は assertion の内容ではなく**置き場所**で、eval 10 のプロンプト（merge 直前〜Issue close）はレビュー委譲を問うていない。
iteration-3 で with が通っていたのは「PR finalize 済み」という語から前フェーズを自発的に語ったためで、
`.agents/rules/eval-assertion-discrimination.md` が警告する「プロンプトが問うていない話題の自発的言及に賭ける」状態だった
（測っていたのは契約知識ではなく冗長さ）。

対応として eval 10 から当該 assertion を落とし、handoff を正面から問う **eval 20 を新設して移設**した。
移設後は with 4/4・without 1/4（+75pt）で、契約が意図どおり弁別されている。
移設前の eval 10 は with 3/4・without 2/4（+25pt）、移設後は with 3/3・without 2/3（+33pt）。

### baseline が強かった項目

- eval 18（3/4・+25pt）: baseline も「必須チェック 0 件を全 pass と読み替えない」「CI 皆無を記録に残す」へ自力で到達した。
  弁別できたのは `gh pr checks --required` の 0 件時非 0 終了という**ツール固有の挙動**のみ。
  baseline は branch protection / ruleset の 2 API から required 集合を再構成する別解を取っており、目的は達している。
- eval 16（4/6・+33pt）: baseline は `bucket`（正規化フィールド）を使わず生の `conclusion` を自前分類し、
  merge 後の `MERGED` 実測を欠いた。BEHIND の扱い（rebase を退けて同一 branch へ base を merge）は自力で正解している。

### 弁別が効いた項目

- eval 19（0/4・+100pt）: baseline は欠落キー `merge_ready_timeout_minutes` を認識できず、
  `--merge-mode` を `merge_method` の上書きと誤推測した。新キー導入時の停止契約はスキル無しでは再現しない。
- eval 20（1/4・+75pt）: baseline は収束フェーズを自作の A〜H に分解し、**担当を全て「オーケストレータ」に置いた**。
  再レビュー依頼もオーケストレータ自身が Copilot へ出す設計で、依頼主体の一本化と逆行する。
  `--wait-ci-before-review` の転送にも到達せず、委譲先が持つ責務を「設定の穴」と誤診した。
- eval 17（2/4・+50pt）: baseline は auto-merge 許可の確認に `gh repo view --json autoMergeAllowed` を提示したが、
  **このフィールドは gh に存在しない**（実測: `Unknown JSON field: "autoMergeAllowed"`）。
  さらに許可が無い場合に「当該 run だけ agent へ自動フォールバック」を推奨しており、無人での方式切り替えを禁じる契約と逆行した。
- eval 10（+33pt の実体）: baseline は Issue が close されないとき手動 close コマンドを提示し、BLOCKED に倒さなかった。
