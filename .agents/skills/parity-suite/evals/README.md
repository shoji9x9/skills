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

# fixture 付き eval（前提が揃った状態から始める。evals.json の "fixture" をスキルディレクトリ相対で解決する）
scripts/run-skill-eval.sh \
  --skill parity-suite --config with_skill \
  --prompt "parity-suite --feature order-list --target current-test" \
  --fixture skills/parity-suite/evals/fixtures/dataset-target-mismatch \
  --out tests/parity-suite/iteration-1/eval-6/with_skill/run-1 \
  --model opus
```

- 使い捨てプロジェクトには `.replace/features.md`・設定が無いため、eval 1・2 は「捏造せず停止し setup を促す」パスを検証する
- eval 3〜5 は前提の有無に関わらず成立する拒否挙動（Playwright 固有依存・取って diff しない・強度検証の省略拒否）を対象にする
- eval 6 は fixture（設定・`.replace/features.md`・`.replace/dataset/metadata.json`）で前提を揃え、データセットの投入先 target（`current.target`）と選択 target の不一致を検出して停止するパスを検証する
- eval 7 は fixture `static-dataset-null-target`（`dataset_mode: static`・DB を持つ target がゼロ・`current.target` が `null`）で、eval 6 の照合が**過剰に発火しない**ことを検証する。
  ゴールデンデータがリポジトリ内にあり特定環境に紐づかないため target 照合を行わず、DB レス・プロジェクトが環境不一致を理由に止まらないことを見る。
  **検査項目は実行フロー 4 までで到達できる範囲に限る**——使い捨てプロジェクトには現行アプリが無く run はフロー 1（疎通不可）で正しく停止するため、
  フロー 8 の成果物記録（`dataset_version` の書き込み等）を検査項目にすると到達不能で必ず fail する（iteration-5 でこの設計不備により 3/4 になった）
- 採点は `evals.json` の assertions と `result.json` / `project-files/` を突き合わせ、`grading.json` を残す
- 集計（`benchmark.json` / `benchmark.md`）は skill-creator 同梱の `aggregate_benchmark` を使う（詳細は `docs/skill-development.md`）
