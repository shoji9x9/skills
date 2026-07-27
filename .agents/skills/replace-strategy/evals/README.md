# replace-strategy の回帰テスト

テストケースは [`evals.json`](evals.json)。実行・採点・集計の共通手順は `docs/skill-development.md`「回帰テストを実行する」に従う。

## 前提

実アプリ・DB・ブラウザを要する全フロー（測定〜起票）は使い捨てプロジェクト（空・非対話）では回せない。
そのため本スキルの evals は、**前提が無い環境での停止パス**（依存スキル・MCP 不足、`setup` 未完了）と、
**前提を満たせる部分の挙動**（シークレット値の拒否、成果物からの `status` 導出など）を対象にしている。
`status` の正常系は fixture で成果物一式（設定・`.replace/`）を用意して検証する。

## 実行例

```bash
scripts/run-skill-eval.sh \
  --skill replace-strategy --config with_skill \
  --prompt "replace-strategy setup" \
  --out tests/replace-strategy/iteration-1/eval-1/with_skill/run-1 \
  --model opus

# fixture 付き eval（eval 6）は --fixture で事前状態を使い捨てプロジェクトへコピーして実行する
scripts/run-skill-eval.sh \
  --skill replace-strategy --config with_skill \
  --fixture skills/replace-strategy/evals/fixtures/status-multi-target \
  --prompt "replace-strategy status" \
  --out tests/replace-strategy/iteration-1/eval-6/with_skill/run-1 \
  --model opus
```

- 使い捨てプロジェクトには chrome-devtools MCP が無いため、eval 1 は「導入手順を示して停止する」パスを検証する
- eval 6 の fixture は新側 target を 2 つ（`local-dev` は収束済み・`develop` は未実施かつ `db` 無し）持たせ、環境別の状態導出を検証する。
  `features.md` の Issue 列は未起票のため `gh` 呼び出しは発生しない
- 採点は `evals.json` の assertions と `result.json` / `project-files/` を突き合わせ、`grading.json` を残す
- 集計（`benchmark.json` / `benchmark.md`）は skill-creator 同梱の `aggregate_benchmark` を使う（詳細は `docs/skill-development.md`）
