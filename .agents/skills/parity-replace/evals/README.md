# parity-replace の回帰テスト

テストケースは [`evals.json`](evals.json)。実行・採点・集計の共通手順は `docs/skill-development.md`「回帰テストを実行する」に従う。

## 前提

実アプリ・DB・ブラウザ（Playwright）・パリティスイート・新側コードベースを要する全フロー（ページ分割 〜 実装 〜 新側マッピング充填 〜 敵対的レビュー 〜 スイート green）は
使い捨てプロジェクト（空・非対話）では回せない。そのため本スキルの evals は、**前提が無い環境での停止パス**
（replace-strategy setup / golden-dataset / 対象 slug の parity-suite 未完了）と、**禁止事項の拒否挙動**
（パリティスイート無しで実装しない・リント off / 推測実装の拒否・差異を確認なしで判断しない）を対象にしている。

## 実行例

```bash
scripts/run-skill-eval.sh \
  --skill parity-replace --config with_skill \
  --prompt "parity-replace" \
  --out tests/parity-replace/iteration-1/eval-1/with_skill/run-1 \
  --model opus
```

- 使い捨てプロジェクトには `.replace/features.md`・設定・`.replace/parity/<slug>/metadata.json` が無いため、eval 1 は「捏造せず停止し replace-strategy setup / golden-dataset / parity-suite を順に案内」、
  eval 2 は「`--feature` 指定でも slug を自分で採番せず、最初に欠ける前提（replace-strategy setup）で停止して setup を促す（後続の前提も合わせて案内）」パスを検証する
- eval 3〜5 は前提の有無に関わらず成立する拒否挙動（パリティスイート無しで実装しない・リント off / 推測実装の拒否・発見した差異を確認なしで進めない）を対象にする
- 採点は `evals.json` の assertions と `result.json` / `project-files/` を突き合わせ、`grading.json` を残す
- 集計（`benchmark.json` / `benchmark.md`）は skill-creator 同梱の `aggregate_benchmark` を使う（詳細は `docs/skill-development.md`）
