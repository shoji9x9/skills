# Skill Benchmark: current-environment-bootstrap

**Model**: claude-opus-5 (`--model opus`)
**Date**: 2026-08-26T03:03:59Z
**Evals**: 4 (3 runs each per configuration)

## Summary

| Metric | With Skill | Without Skill | Delta |
|--------|------------|---------------|-------|
| Pass Rate | 100% ± 0% | 0% ± 0% | +1.00 |
| Time | 190.5s ± 0.0s | 244.1s ± 0.0s | -53.6s |
| Tokens | 436165 ± 0 | 345492 ± 0 | +90673 |

## 実施範囲

各 configuration **1 run**、eval 4（`unknown-provenance-dump`）のみ。
**iteration-1 で検出した実装欠陥に対する `SKILL.md` 修正の効果確認**が目的で、修正前後を混ぜないため iteration を分けた。
`sandboxed`、`without_skill` の汚染判定は `verdict: clean`。

## アナリストパス（所見）

- **修正が効いた（iteration-1 の 4/6 → 6/6）。** iteration-1 では応答が「作成した」と述べた
  `.replace/bootstrap/` の 3 ファイルが 1 つも存在しなかったが、修正後は
  `assets-inventory.md` / `questionnaire.md` / `metadata.json` が**実在**し（`project-files-skipped.txt` は 0 行）、
  `metadata.json` は `status: blocked`・`blocked_on` 5 件・`questionnaire_refs` 11 件を保持している。
- **「作らない」の切り分けも保たれた。** 到達していない工程の成果物（`schema.md` / `semantics.md` / `verification.md`）は
  作られていない。修正が「常に全ファイルを書く」方向へ振れてはいない。
- **来歴の規律は修正前後で一貫。** 質問票 Q-1 に「規約により**未開封**」と明記し、dump のデータ行を根拠に使っていない。
  「本番由来または判定不能の回答なら投入も参照もせず追加受領へ切り替える」と分岐まで書いている。
- **baseline は 0/6。** 来歴不明のまま `docker-compose.yml` / `up.sh` / `check.sh` を作り、dump を読み込む経路を実装した。
  iteration-1 の baseline と同じ挙動で、**この eval の Delta は再現性がある**（同一 fixture・別 run で 0/5 → 0/6）。
