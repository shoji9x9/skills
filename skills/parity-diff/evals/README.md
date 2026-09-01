# parity-diff の回帰テスト

テストケースは [`evals.json`](evals.json)。実行・採点・集計の共通手順は `docs/skill-development.md`「回帰テストを実行する」に従う。

## 前提

実アプリ・DB・ブラウザ（Playwright）・パリティスイート・新側 green の実装を要する全フロー（前提確認 〜 新側ベースライン取得 〜 3 経路の検出 〜 正規化 〜 トリアージ 〜 収束判定）は
使い捨てプロジェクト（空・非対話）では回せない。そのため本スキルの evals は、**前提が無い環境での停止パス**
（replace-strategy setup / golden-dataset / parity-suite / parity-replace 未完了）と、**禁止事項の拒否挙動**
（検出させない・全画面を渡さない・モデルは分類のみ）を対象にしている。

設定・成果物が揃った状態でしか判定できないケース（環境別の green 証跡の扱い等）は、`evals.json` の `fixture` に置いた
使い捨てプロジェクトの初期状態を `--fixture` で流し込んで検証する（fixture 自体は実行で変更されない）。

## 実行例

```bash
scripts/run-skill-eval.sh \
  --skill parity-diff --config with_skill \
  --prompt "parity-diff" \
  --out tests/parity-diff/iteration-1/eval-1/with_skill/run-1 \
  --model opus
```

fixture 付き eval（`evals.json` に `fixture` があるもの）は `--fixture skills/parity-diff/<fixture の値>` を足して実行する（例: eval 4 は `--fixture skills/parity-diff/evals/fixtures/green-only-local-dev`）。

- 使い捨てプロジェクトには `.replace/features.md`・設定・`.replace/parity/<slug>/metadata.json`・`replace-metadata.json` が無いため、eval 1 は「捏造せず停止し replace-strategy setup / golden-dataset / parity-suite / parity-replace を順に案内」、
  eval 2 は「`--feature` / `--target` 指定でも slug を自分で採番せず・存在しない target を読み替えず、最初に欠ける前提で停止して案内し、スイート再実行や現行アプリ駆動をしない」パスを検証する
- eval 3 は前提の有無に関わらず成立する拒否挙動（検出させない・全画面を渡さない・モデルは分類のみで crop 対を 1 件ずつ 3 値分類）を対象にする
- eval 4 は fixture `green-only-local-dev`（local-dev だけ新側 green・`develop` は db 無しの配信型 target）で、「別環境の green 証跡を流用せず、その環境では green 証跡が無いとして停止し同じ `--target` の parity-replace を案内する」パスを検証する
- eval 5〜11・13・15・16 は前提の有無に関わらず会話で判定できる契約を対象にする（eval 15 は同一原因の N インスタンスに対する承認の粒度と、台帳の件数を畳まない規則の両立。
  eval 16 は `component_diffs` T の照合キーが要素を含むこと＝別要素の同値の差分を吸収しない・`component` の欠落は wildcard ではない）。eval 14 は fixture で共同居住機能の新側 root が存在しない状態を作り、現側由来の矩形による target ごとの再導出・両画像への適用・解除へ到達することを検証する
- eval 12 は fixture `legacy-exceptions-key`（他の前提は揃っているが、設定側に旧キー `component_diff_exceptions` が残り同一原因の `reason` が 3 インスタンスへ複製されている）で、
  「旧キーをフォールバックとして読まず、移行先の slug 成果物と `cause` へ畳む対応表を示して停止する（自動移行しない・件数は畳まない）」パスを検証する。
  他の前提が揃っているため、停止理由が旧キー**以外**（疎通失敗・green 証跡欠落）にすり替わっていれば弁別できる
- 採点は `evals.json` の assertions と `result.json` / `project-files/` を突き合わせ、`grading.json` を残す
- 集計（`benchmark.json` / `benchmark.md`）は skill-creator 同梱の `aggregate_benchmark` を使う（詳細は `docs/skill-development.md`）
