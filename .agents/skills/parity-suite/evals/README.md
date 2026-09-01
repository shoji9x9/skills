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
- eval 10〜15 は静的サイト移行で見つかった 6 件の不足（Issue #145）に対する回帰。いずれも**誤った前提での依頼を押し戻す形**にしてあり、
  現行アプリ・ブラウザを要する工程まで到達しなくても採点できる（aria の粒度・side 別期待値の置き場所・ポジティブコントロール・
  解決不能ロケータとタイムアウト・API を持たない場合の上流・同梱ツールのコピー先）
- eval 18 の fixture（`semantics-pending`）は `current.origin: received-assets` でフェーズ A まで完了し、
  `.replace/dataset/verification.md` の「意味論が未確定の機能」と `.replace/bootstrap/semantics.md` の確認待ちに **`order-list` が残った**状態を持たせ、
  **その機能のスイート構築を開始しない**ことを検証する。fixture には開始可否の判定そのものを書かない（書くとベースラインがそれを読んで assertion を満たす）
- eval 19 は eval 18 と**同じ fixture** に対し、意味論が**確定済み**の `customer-list` を対象にする陽性コントロール。
  「`received-assets` なら一律で止まる」「確認待ちが 1 件でもあれば全機能を止める」実装を弾く（eval 18 だけでは、全部止める実装と区別できない）。
  この環境では Playwright・現行アプリに到達できないため、**停止するとしてもその理由が意味論の確認待ちでないこと**を見る
- eval 20・21 は部品被覆表（Issue #274）の回帰。前提の有無に関わらず会話で判定できる契約を対象にする——
  20 はベンダー資料を列挙の生成源に留めること・部品 × ページのインスタンスごとに測ること・3 値と `covered_by` の記録、
  21 は未測定を行の削除で消せないこと（fail-closed）と `metadata.json` の `component_coverage` をキーごと省略しないこと。
  どちらのプロンプトにも被覆表のファイル名・キー名を書かない（書くとベースラインがそれを読んで assertion を満たす）
- 採点は `evals.json` の assertions と `result.json` / `project-files/` を突き合わせ、`grading.json` を残す
- 集計（`benchmark.json` / `benchmark.md`）は skill-creator 同梱の `aggregate_benchmark` を使う（詳細は `docs/skill-development.md`）
