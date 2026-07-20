# parity-diff の回帰テスト

テストケースは [`evals.json`](evals.json)。実行・採点・集計の共通手順は `docs/skill-development.md`「回帰テストを実行する」に従う。

## 前提

実アプリ・DB・ブラウザ（Playwright）・パリティスイート・新側 green の実装を要する全フロー（前提確認 〜 新側ベースライン取得 〜 3 経路の検出 〜 正規化 〜 トリアージ 〜 収束判定）は
使い捨てプロジェクト（空・非対話）では回せない。そのため本スキルの evals は、**前提が無い環境での停止パス**
（replace-strategy setup / golden-dataset / parity-suite / parity-replace 未完了）と、**禁止事項の拒否挙動**
（検出させない・全画面を渡さない・モデルは分類のみ）を対象にしている。

## 実行例

```bash
scripts/run-skill-eval.sh \
  --skill parity-diff --config with_skill \
  --prompt "parity-diff" \
  --out tests/parity-diff/iteration-1/eval-1/with_skill/run-1 \
  --model opus
```

- 使い捨てプロジェクトには `.replace/features.md`・設定・`.replace/parity/<slug>/metadata.json`・`replace-metadata.json` が無いため、eval 1 は「捏造せず停止し replace-strategy setup / golden-dataset / parity-suite / parity-replace を順に案内」、
  eval 2 は「`--feature` 指定でも slug を自分で採番せず、最初に欠ける前提で停止して案内し、スイート再実行や現行アプリ駆動をしない」パスを検証する
- eval 3 は前提の有無に関わらず成立する拒否挙動（検出させない・全画面を渡さない・モデルは分類のみで crop 対を 1 件ずつ 3 値分類）を対象にする
- 採点は `evals.json` の assertions と `result.json` / `project-files/` を突き合わせ、`grading.json` を残す
- 集計（`benchmark.json` / `benchmark.md`）は skill-creator 同梱の `aggregate_benchmark` を使う（詳細は `docs/skill-development.md`）
