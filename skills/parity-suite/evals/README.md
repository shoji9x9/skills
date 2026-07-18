# parity-suite の回帰テスト

テストケースは [`evals.json`](evals.json)。実行・採点・集計の共通手順は `docs/skill-development.md`「回帰テストを実行する」に従う。

## 前提

実アプリ・DB・ブラウザ（Playwright）・ゴールデンデータセットを要する全フロー（authoring 〜 ベースライン採取 〜 強度ゲート）は
使い捨てプロジェクト（空・非対話）では回せない。そのため本スキルの evals は、**前提が無い環境での停止パス**
（replace-strategy setup / golden-dataset 未完了、Playwright 不可）と、**禁止事項の拒否挙動**
（取って diff しない・強度検証を省略しない）を対象にしている。

## 実行例

```bash
scripts/run-skill-eval.sh \
  --skill parity-suite --config with_skill \
  --prompt "parity-suite" \
  --out tests/parity-suite/iteration-1/eval-1/with_skill/run-1 \
  --model opus
```

- 使い捨てプロジェクトには `.replace/features.md`・設定が無いため、eval 1・2 は「捏造せず停止し setup を促す」パスを検証する
- eval 3〜5 は前提の有無に関わらず成立する拒否挙動（Playwright 固有依存・取って diff しない・強度検証の省略拒否）を対象にする
- 採点は `evals.json` の assertions と `result.json` / `project-files/` を突き合わせ、`grading.json` を残す
- 集計（`benchmark.json` / `benchmark.md`）は skill-creator 同梱の `aggregate_benchmark` を使う（詳細は `docs/skill-development.md`）
