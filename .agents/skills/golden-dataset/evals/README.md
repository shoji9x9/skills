# golden-dataset の回帰テスト

テストケースは [`evals.json`](evals.json)。実行・採点・集計の共通手順は `docs/skill-development.md`「回帰テストを実行する」に従う。

## 前提

実 DB・DDL・投入ツールの実行環境・現新 2 環境を要する全フロー（データ設計 〜 投入 〜 現新一致検証）は
使い捨てプロジェクト（空・非対話）では回せない。そのため本スキルの evals は、**前提が無い環境での停止パス**
（replace-strategy setup 未完了、フェーズ A 未完了でのフェーズ B 要求）と、**禁止事項の拒否挙動**
（本番参照・非決定論・非冪等の拒否）を対象にしている。

## 実行例

```bash
scripts/run-skill-eval.sh \
  --skill golden-dataset --config with_skill \
  --prompt "golden-dataset" \
  --out tests/golden-dataset/iteration-1/eval-1/with_skill/run-1 \
  --model opus
```

- 使い捨てプロジェクトには `.replace/features.md`・設定・`.replace/dataset/metadata.json` が無いため、eval 1 は「捏造せず停止し setup を促す」、eval 2 は「`--phase b` でも setup 未完了の停止が最優先で発火し（フェーズ A 未完了も合わせて案内）、写像・投入を始めない」パスを検証する
- eval 3〜5 は前提の有無に関わらず成立する拒否挙動（本番参照・非決定論・非冪等の拒否）を対象にする
- 採点は `evals.json` の assertions と `result.json` / `project-files/` を突き合わせ、`grading.json` を残す
- 集計（`benchmark.json` / `benchmark.md`）は skill-creator 同梱の `aggregate_benchmark` を使う（詳細は `docs/skill-development.md`）
