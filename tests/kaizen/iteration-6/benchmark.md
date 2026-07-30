# Skill Benchmark: kaizen

**Model**: claude-opus-5
**Date**: 2026-07-30T10:38:43Z
**Evals**: 9 (3 runs each per configuration)

## Summary

| Metric | With Skill | Without Skill | Delta |
|--------|------------|---------------|-------|
| Pass Rate | 80% ± 0% | 40% ± 0% | +0.40 |
| Time | 115.8s ± 17.5s | 169.1s ± 105.2s | -53.3s |
| Tokens | 6774 ± 1576 | 10212 ± 7190 | -3438 |

## Notes

- Executor & analyzer model: claude-opus-5. 3 runs per configuration.
- **両 configuration を同一のサンドボックス（scripts/eval-sandbox.sh）で実行した初回**。iteration-5 までは without_skill だけを隔離していたため、with_skill は $HOME 配下（~/.claude/projects
  のトランスクリプト＝スキル本文と eval 設計そのもの、グローバルインストール済みスキル）を読めていた（実測で、それを根拠にした run がある）。対称化後は差が「使い捨てプロジェクトにスキルがあるか」だけになる。
- 隔離の実測（スタブ probe）: 両 config とも repo / transcripts / global skills = hidden、user CLAUDE.md = present、project skills のみ with=kaizen / without=none。6 run
  すべて isolation=sandboxed、baseline 3 run の contamination.txt は verdict=clean。
- Delta = **+0.40**（with 80% ± 0% / without 40% ± 0%）。両 config とも分散ゼロで、iteration-5 の +0.47 から下がった分は with_skill 側の非対称な優位（トランスクリプト読み）が消えたことによる可能性がある。
- アサーション別の弁別: #1 機構を第一候補 = with 3/3・without 3/3（ゼロ）、#2 判定法の根拠 = with 3/3・without 3/3（ゼロ）、#3 承認/却下/スキップ = **with 0/3・without 0/3（両方 fail）**、#4 status +
  grep 取りこぼし = with 3/3・without 0/3、#5 Step 5 の二択 = with 3/3・without 0/3。
- #3 は本 iteration で with_skill も 0/3 になり、「測れないアサーション」であることが確定した（非対話ハーネスは「確認が必要でも質問で停止せず続行」を指示するため、3 分岐の列挙は起きにくい。3 run
  すべて承認の必要性自体には触れている）。.agents/rules/eval-assertion-discrimination.md の「到達」に該当するため、**この iteration の採点後に evals.json から #3 を削除した**（以降の iteration は 4
  アサーション）。本 benchmark の数値は 5 アサーションでの採点。
- #1 / #2 が弁別しないのは iteration-5 と同じ理由で、fixture の cue ではなく事象そのもの（5 回とも同一のラッパーを組み直した）から強いモデルが自力で到達するため。ベースライン 3 run
  はそれぞれ「実体の欠落」「決定論的で反復される手順は実行可能な成果物にすべき」「判断の余地がないのに人間が毎回介在している」と独自の言葉で述べた。apply.md「機構」行の効果はこの eval では測れず、行の価値は判断の一貫性と後退検知にある。
- 弁別を作っているのは skill 固有の手順（#4 の grep -l "^status: pending" による取りこぼし確認、#5 の Step 5 二択）で、ベースラインは 3 run とも 0/3。status を applied
  にすること自体は両者が述べるが、取りこぼし確認と継続方針の二択はスキルを読まないと出てこない。
