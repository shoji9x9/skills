# replace-strategy の回帰テスト

テストケースは [`evals.json`](evals.json)。実行・採点・集計の共通手順は `docs/skill-development.md`「回帰テストを実行する」に従う。

## 前提

実アプリ・DB・ブラウザを要する全フロー（測定〜起票）は使い捨てプロジェクト（空・非対話）では回せない。
そのため本スキルの evals は、**前提が無い環境での停止パス**（依存スキル・MCP 不足、`setup` 未完了）と、
**前提を満たせる部分の挙動**（シークレット値の拒否、成果物からの `status` 導出など）を対象にしている。
`status` の正常系・`issues` の承認ゲート・機能インベントリの分解は、fixture で事前状態（設定・`.replace/`）を用意して検証する。

## 実行例

```bash
scripts/run-skill-eval.sh \
  --skill replace-strategy --config with_skill \
  --prompt "replace-strategy setup" \
  --out tests/replace-strategy/iteration-1/eval-1/with_skill/run-1 \
  --model opus

# fixture 付き eval（evals.json に `fixture` を持つ eval 6-9）は --fixture で事前状態を使い捨てプロジェクトへコピーして実行する
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
- eval 7 の fixture（`issues-approval-gate`）は全件未起票のインベントリを持たせ、**非対話実行では候補・依存関係・本文ドラフトの提示までで止まり起票しない**承認ゲートを検証する
- eval 8 / 9 の fixture（`inventory-multi-page` / `inventory-single-page`）は測定・戦略が完了した状態（`features.md` は未作成）を持たせ、
  **機能の分解基準**（複数ページを 1 機能にまとめる／表示セクションで割らない／単一機能の API を横断 API にしない）を複数ページ・単一ページの両方で検証する
- eval 10 の fixture（`dependency-decision`）は測定・戦略・インベントリまで完了し、**`references.dependency_policy` を持たない**（＝方針未確認）状態を持たせ、
  **依存パッケージの導入判断**（要件 → 素性・ライセンス → 詳細比較の順序、判断材料の記録、方針の要否をユーザーに確認）を検証する。
  fixture 無しでは「`setup` 未完了」で早期停止して判断材料の提示に到達しないため、fixture で到達性を担保している
- eval 15 は fixture 無しで会話だけで判定できる契約（設定キーの**書き手区分**・作業中に増え続ける slug スコープの台帳を設定に置かない・`component_diffs` を設定側に残す根拠・
  スキルキーを跨いだ YAML アンカー共有が課す分割不可制約）を対象にする
- 採点は `evals.json` の assertions と `result.json` / `project-files/` を突き合わせ、`grading.json` を残す
- 集計（`benchmark.json` / `benchmark.md`）は skill-creator 同梱の `aggregate_benchmark` を使う（詳細は `docs/skill-development.md`）
