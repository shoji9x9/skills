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

# fixture 付き eval（前提が揃った状態から始める。evals.json の "fixture" をスキルディレクトリ相対で解決する）
scripts/run-skill-eval.sh \
  --skill parity-replace --config with_skill \
  --prompt "parity-replace --feature order-list --target develop （新側の作業ツリーは clean で、コミット SHA は local-dev で green になった abc1234def5678 と同一です）" \
  --fixture skills/parity-replace/evals/fixtures/lightweight-deploy-target \
  --out tests/parity-replace/iteration-1/eval-6/with_skill/run-1 \
  --model opus
```

- 使い捨てプロジェクトには `.replace/features.md`・設定・`.replace/parity/<slug>/metadata.json` が無いため、eval 1 は「捏造せず停止し replace-strategy setup / golden-dataset / parity-suite を順に案内」、
  eval 2 は「`--feature` 指定でも slug を自分で採番せず、最初に欠ける前提（replace-strategy setup）で停止して setup を促す（後続の前提も合わせて案内）」パスを検証する
- eval 3〜5 / 7 は前提の有無に関わらず成立する拒否挙動（パリティスイート無しで実装しない・リント off / 推測実装の拒否・発見した差異を確認なしで進めない・既存パッケージを探さず自前実装を始めない）を対象にする。
  eval 7 は実装中に部品が必要になった場面で、判断材料の確認と `.replace/dependencies.md` への記録を省略しないことを検証する（基準の正本は `replace-strategy` の `references/dependency-selection.md`）
- eval 6 は fixture（設定・`.replace/features.md`・データセット／パリティスイートのメタデータ・`new/local-dev/` の green 証跡）で前提を揃え、
  `start` も `commit_check` も持たない配信型 target（develop）へ軽量経路を確認なしに適用しないパスを検証する
- eval 13 は前提の有無に関わらず成立する契約説明として、**DB の方言差を実装前に点検する**契約（`references.db_semantics` を書く前に読む・未整備でも推測で埋めない・`porting.md` の「DB 方言差の点検結果」へ該当なしも含めて記録する・吸収しない差は `intentional_diffs.pending` へ回す）を検証する。
  点検項目の正本は `replace-strategy` の `references/project-config.md`「DB 意味論」
- 採点は `evals.json` の assertions と `result.json` / `project-files/` を突き合わせ、`grading.json` を残す
- 集計（`benchmark.json` / `benchmark.md`）は skill-creator 同梱の `aggregate_benchmark` を使う（詳細は `docs/skill-development.md`）
