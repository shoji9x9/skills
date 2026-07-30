# Skill Benchmark: kaizen

**Model**: claude-opus-5
**Date**: 2026-07-30T09:56:31Z
**Evals**: 9 (3 runs each per configuration)

## Summary

| Metric | With Skill | Without Skill | Delta |
|--------|------------|---------------|-------|
| Pass Rate | 80% ± 20% | 33% ± 12% | +0.47 |
| Time | 182.2s ± 88.5s | 137.0s ± 25.3s | +45.2s |
| Tokens | 11081 ± 6251 | 7714 ± 987 | +3367 |

## Notes

- Executor & analyzer model: claude-opus-5. 3 runs per configuration.
- iteration-4 の弁別ゼロを受けた再測。fixture（evals/fixtures/apply-mechanism）の根本原因欄からメタ診断「対策が手順の記述で終わっていた」を除去してドメイン層の why 連鎖に差し替え、アサーションを 4 本 → 5 本に改訂した（#3
  の但し書き削除、#4 に grep 取りこぼし確認を追加、#5 に Step 5 の二択を新設）。
- read 隔離: without_skill 3 run すべて scripts/eval-sandbox.sh（$HOME read-only ＋ ~/.claude 全体 tmpfs へ強化した版）経由、contamination.txt verdict=clean。iteration-4
  で起きたグローバル資産への書き込みは再発していない。
- Delta は +0.17（iteration-4）から **+0.47** へ改善（with 80% / without 33%）。改善分は skill 固有の手順（#4 の grep 取りこぼし確認・#5 の Step 5 二択）が弁別したことによる。
- アサーション別の弁別: #1 機構を第一候補 = with 3/3・without 3/3（**依然ゼロ**）、#2 判定法の根拠 = with 3/3・without 3/3（**依然ゼロ**）、#3 承認/却下/スキップ = with 1/3・without 0/3、#4 status +
  grep 取りこぼし = with 3/3・without 0/3、#5 Step 5 の二択 = with 2/3・without 0/3。
- #1 / #2 が弁別しない理由は fixture の cue ではなく**事象そのもの**にある: 「5 回とも同一のラッパーを組み立て直した」という事実だけで、十分に強いモデルは「定数の置き場所はコード」「知識ではなく未実装の部品」と自力で到達する（ベースライン 3 run
  すべてがこの推論を独自の言葉で示した）。この事実を fixture から削ると学びとして成立しないため、apply.md の「機構」行の効果はこの eval では原理的に測れない。行の価値は Delta ではなく、判断の一貫性と後退検知にある。
- #3 が with 1/3 に留まったのは実際のシグナル: apply.md Step 2 の承認段階（承認/却下/スキップ）を、3 run のうち 2 本が示さなかった（run-2 は承認を取らずに status を applied
  へ書き換えた）。ただしハーネスは非対話プリアンブルで「確認が必要でも質問で停止せず続行」と指示しているため、この項目は環境要因を含む。承認段階の強制力を上げるかは別途判断が必要。
- with_skill run-3 は ~/.claude/skills/skill-creator への書き込みを「プロジェクト外のグローバル資産なので承認が要る」として自ら見送った（iteration-4 のベースラインが実行してしまった操作）。
