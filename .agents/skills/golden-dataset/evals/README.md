# golden-dataset の回帰テスト

テストケースは [`evals.json`](evals.json)。実行・採点・集計の共通手順は `docs/skill-development.md`「回帰テストを実行する」に従う。

## 前提

実 DB・DDL・投入ツールの実行環境・現新 2 環境を要する全フロー（データ設計 〜 投入 〜 現新一致検証）は
使い捨てプロジェクト（空・非対話）では回せない。そのため本スキルの evals は、**前提が無い環境での停止パス**
（replace-strategy setup 未完了、フェーズ A 未完了でのフェーズ B 要求）と、**禁止事項の拒否挙動**
（本番参照・非決定論・非冪等の拒否）を対象にしている。

設定・成果物が揃った状態でしか判定できないケース（投入先 target の選択規則等）は、`evals.json` の `fixture` に置いた
使い捨てプロジェクトの初期状態を `--fixture` で流し込んで検証する（fixture 自体は実行で変更されない）。

## 実行例

```bash
scripts/run-skill-eval.sh \
  --skill golden-dataset --config with_skill \
  --prompt "golden-dataset" \
  --out tests/golden-dataset/iteration-1/eval-1/with_skill/run-1 \
  --model opus
```

fixture 付き eval（`evals.json` に `fixture` があるもの）は `--fixture skills/golden-dataset/<fixture の値>` を足して実行する（例: eval 6 は `--fixture skills/golden-dataset/evals/fixtures/dbless-target`）。

- 使い捨てプロジェクトには `.replace/features.md`・設定・`.replace/dataset/metadata.json` が無いため、eval 1 は「捏造せず停止し setup を促す」、eval 2 は「`--phase b` でも setup 未完了の停止が最優先で発火し（フェーズ A 未完了も合わせて案内）、写像・投入を始めない」パスを検証する
- eval 3〜5 は前提の有無に関わらず成立する拒否挙動（本番参照・非決定論・非冪等の拒否）を対象にする
- eval 6 は fixture `dbless-target`（フェーズ A 完了済み・`develop` は `db` を持たない新側 target）で、「`db.env_vars` を持たない target を投入先にせず停止し、db を持つ target を選ぶよう促す（勝手に読み替えない）」パスを検証する
- eval 7 は fixture `readonly-db-target`（`develop` が `db.env_vars` を持つが `seedable` を持たない読み取り専用 target）で、「接続を知っていること ≠ シードしてよいこと」の分離を検証する。
  投入せず停止し、`seedable: true` の追加をユーザーの判断として提示するか（スキルが自分で設定を書き換えないか）を見る
- eval 8 は fixture `static-dataset`（`dataset_mode: static`・DB を持つ target がゼロ・フェーズ A 完了済み・`gaps.md` にデータ不足 2 件）で、
  **DB レス・プロジェクトのフェーズ A 再実行がデッドロックしない**ことを検証する。実 DB を要さず生成先がリポジトリ内（`dataset_static_paths`）で完結するため、
  使い捨てプロジェクトでも設計追記 → ツール更新 → 再生成 → `version` +1 → ベースライン再取得の案内まで通しで実行できる
- eval 12 は fixture 無しで、`features.md` の抜粋を会話で与えて**対象テーブルの参照元**を問う。`db` モードのフェーズ A は使い捨てプロジェクトでは step 1 の
  接続確認で止まりデータ設計へ到達しないため、実行させず問いの形にして到達性を確保している。横断 API 行の**参照テーブルが空欄**という材料だけを与え、
  「空欄＝参照テーブル無し」と断定せず記録漏れを疑って確定を保留するかを見る（結論はプロンプトに書かない）
- eval 13 の fixture（`bootstrap-handoff`）は **`current.origin: received-assets` で `current-environment-bootstrap` が引き渡し済み**の状態
  （`.replace/bootstrap/metadata.json` の `status: handed-off`・確定済みと確認待ちが混在する `semantics.md`・暫定起動データ投入ツール `bootstrap/seed.sh`）を持たせ、
  **確定済みの意味論だけを根拠にすること**・**起動要件をフェーズ A の設計に引き継ぐこと**・**暫定起動データを流用しないこと**を検証する。
  fixture には「流用してはいけない」「この項目は確定扱いにしない」といった判定を書かない（書くとベースラインがそれを読んで assertion を満たす）
- 採点は `evals.json` の assertions と `result.json` / `project-files/` を突き合わせ、`grading.json` を残す
- 集計（`benchmark.json` / `benchmark.md`）は skill-creator 同梱の `aggregate_benchmark` を使う（詳細は `docs/skill-development.md`）
