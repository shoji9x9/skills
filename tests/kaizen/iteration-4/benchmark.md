# Skill Benchmark: kaizen

**Model**: claude-opus-5
**Date**: 2026-07-30T09:36:37Z
**Evals**: 9 (3 runs each per configuration)

## Summary

| Metric | With Skill | Without Skill | Delta |
|--------|------------|---------------|-------|
| Pass Rate | 92% ± 14% | 75% ± 0% | +0.17 |
| Time | 248.5s ± 118.2s | 384.8s ± 241.3s | -136.3s |
| Tokens | 15368 ± 8173 | 23526 ± 14831 | -8158 |

## Notes

- Executor & analyzer model: claude-opus-5. 3 runs per configuration.
- 採点は意図・ナレーション基準: 使い捨ての空 /tmp プロジェクト（fixture = evals/fixtures/apply-mechanism）で実行し、各アサーションは「エージェントが正しい判断・手順を示したか」で判定した。
- read 隔離: without_skill 3 run すべて scripts/eval-sandbox.sh 経由（isolation.txt = sandboxed）、事後の汚染判定は 3 run とも contamination.txt verdict=clean（マーカー 9
  種）。ベースラインはスキル本文を読んでいない。
- **この eval は弁別していない（Delta +0.17 は実質 1 アサーションに由来）**。アサーション別: #1 機構を第一候補 = with 3/3・without 3/3、#2 判定法の根拠 = with 3/3・without 3/3、#4 status
  pending→applied = with 3/3・without 3/3、#3 承認/却下/スキップ = with 2/3・without 0/3。差が出たのは #3 のみで、これは apply フロー一般の項目であって今回追加した「機構」行・「判定法」の弁別ではない。
- 原因は fixture が答えを持っていたこと: 根本原因欄の「対策が『次に測るときはこうする』という手順の記述で終わっていた」と事象欄の「5 回とも同一のラッパーを組み直した」が結論（散文ではなく機構へ）の根拠そのもので、ベースライン 3 run すべてがこれを引用して正答した。新設ルール
  .agents/rules/eval-assertion-discrimination.md の 4 点目「入力が答えを持っていないか」に該当する。
- アサーション #3 の但し書き（「非対話環境では確認できない旨と置いた仮定の明示でもよい」）は解釈幅がある。without_skill run-2 は「非対話環境のため、確認せずに進めました」と仮定を置くが承認/却下/スキップの段階は手順に現れないため fail
  と判定した。再測時は但し書きを削り「承認/却下/スキップの 3 分岐を示す」に絞るべき。
- 弁別が出た skill 固有シグナル（次の反復でアサーション化の候補）: grep -l "^status: pending" による取りこぼし確認（with 3/3・without 0/3）、`/kaizen archive` の存在（with 3/3・without 0/3）、Step 5
  のブランチ継続 or Issue 作成の二択（with 2/3・without 0/3）。
- with_skill run-3 の #3 fail は挙動の揺れ（承認段階を飛ばして適用した）。3 run 中 1 本のため flaky 寄りで、スキル側の Step 2 の強制力が弱い可能性がある。
- 副作用: without_skill run-3 が ~/.claude/skills/skill-creator（ベンダ配布物）を実際に書き換えた。サンドボックスは read だけを塞いでおり $HOME への write を塞いでいなかったため。復旧済み（pin された
  github-tree-sha の内容へ）、scripts/eval-sandbox.sh を $HOME read-only ＋ ~/.claude 全体 tmpfs へ強化した。
