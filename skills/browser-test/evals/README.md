# browser-test の回帰テスト

テストケースは [`evals.json`](evals.json)。実行・採点・集計の共通手順は `docs/skill-development.md`「回帰テストを実行する」に従う。

## 前提

実ブラウザ（chrome-devtools MCP）と稼働中のアプリを要する全フロー（ページ巡回・console 確認・クロス環境切り分け）は
使い捨てプロジェクト（空・非対話）では回せない。そのため本スキルの evals は、**MCP が無い環境での停止パス**と、
**前提の有無に関わらず成立する挙動**（設定解決の順序・スコープ導出の方針・副作用操作の拒否／承認・呼び出し元からの環境受け渡し契約）を対象にしている。

## 実行例

```bash
scripts/run-skill-eval.sh \
  --skill browser-test --config with_skill \
  --prompt "ブラウザで動作確認して" \
  --out tests/browser-test/iteration-1/eval-1/with_skill/run-1 \
  --model opus

# fixture 付き eval（eval 7）は --fixture で事前状態を使い捨てプロジェクトへコピーして実行する
scripts/run-skill-eval.sh \
  --skill browser-test --config with_skill \
  --fixture skills/browser-test/evals/fixtures/handoff-ignores-config \
  --prompt "<evals.json の eval 7 の prompt>" \
  --out tests/browser-test/iteration-1/eval-7/with_skill/run-1 \
  --model opus
```

- eval 7 の fixture は `skills.browser-test.environments` だけを持つ設定を置く**囮**で、呼び出し元から環境を渡されたときに設定解決を行わない契約（`references/project-config.md`）を検証する
- 採点は `evals.json` の assertions と `result.json` / `project-files/` を突き合わせ、`grading.json` を残す
- 集計（`benchmark.json` / `benchmark.md`）は skill-creator 同梱の `aggregate_benchmark` を使う（詳細は `docs/skill-development.md`）
