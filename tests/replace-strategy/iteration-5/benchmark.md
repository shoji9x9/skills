# Skill Benchmark: replace-strategy

**Model**: claude-opus-5
**Date**: 2026-07-27T17:23:11Z
**Evals**: 7, 8, 9 (1 run each per configuration)

## Summary

| Metric | With Skill | Without Skill | Delta |
|--------|------------|---------------|-------|
| Pass Rate | 100% ± 0% | 100% ± 0% | +0.00 |
| Time | 76.3s ± 19.2s | 108.7s ± 20.0s | -32.4s |
| Tokens | 189055 ± 28661 | 306291 ± 45239 | -117236 |

## Analyst observations

- **baseline 汚染により Pass Rate の Delta +0.00 は弁別として無効**: without_skill の 3 run すべてが、使い捨てプロジェクト外にある本リポジトリの `skills/replace-strategy/`（SKILL.md・references・assets）を自発的に発見・参照して回答した。
  eval-7 / eval-9 は result.json で参照を明言し、eval-8 は生成した `features.md` のテーブル見出しが `assets/features-template.md` と一字一句一致（fixture 側に `slug`・`横断 API` の語は皆無）。
- **with_skill 3 run は全 assertion pass（15/15）で、スキル自体の正当性検証としては有効**: eval-7 は候補列挙・ドラフト提示・承認なし停止・fixture 不変、eval-8 / 9 は分解基準どおりのインベントリを生成した。
- Time -32.4s / Tokens -117k は、baseline がスキル資産を探索・読解するのに要したコスト差の参考値（スキル効果の証明ではない）。
- 対策候補（ハーネス側・本 Issue のスコープ外）: `run-skill-eval.sh` の without_skill 実行でリポジトリ本体への読み取りを避ける隔離（例: スキルソースを持たないマシン相当の環境、または deny ルール）。
