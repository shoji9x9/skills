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
  使い捨てプロジェクトでも設計追記 → ツール更新 → 再生成 → `version` +1 → ベースライン再取得の案内まで通しで実行できる。
  `current-site/src/works-list.ts` は現行実装としてページサイズ、絞り込み、並び順、tag 変更時の page 保持を持つ。fixture のコメントは実装挙動だけを述べ、必要件数や追加すべきデータという答えは書かない。
  これを読まずにページサイズ等を推測しても成果物の存在 assertion は通るため、消費側パラメータと根拠の assertion を独立に置く
- eval 12 は fixture 無しで、`features.md` の抜粋を会話で与えて**対象テーブルの参照元**を問う。`db` モードのフェーズ A は使い捨てプロジェクトでは step 1 の
  接続確認で止まりデータ設計へ到達しないため、実行させず問いの形にして到達性を確保している。横断 API 行の**参照テーブルが空欄**という材料だけを与え、
  「空欄＝参照テーブル無し」と断定せず記録漏れを疑って確定を保留するかを見る（結論はプロンプトに書かない）
- eval 13 の fixture（`bootstrap-handoff`）は **`current.origin: received-assets` で `current-environment-bootstrap` が引き渡し済み**の状態
  （`.replace/bootstrap/metadata.json` の `status: handed-off`・確定済みと確認待ちが混在する `semantics.md`・暫定起動データ投入ツール `bootstrap/seed.sh`）を持たせ、
  **確定済みの意味論だけを根拠にすること**・**起動要件をフェーズ A の設計に引き継ぐこと**・**暫定起動データを流用しないこと**を検証する。
  fixture には「流用してはいけない」「この項目は確定扱いにしない」といった判定を書かない（書くとベースラインがそれを読んで assertion を満たす）
- eval 14 は fixture 無しで、1 ページ 20 件と次／前・ページ番号・最終ページ遷移に加え、古い設計書と受領ログがある条件を材料として与える。2 ページ分で固定せず、
  3 ページを識別できる最小件数 `(3 - 1) × 20 + 1 = 41` を導き、ページ送り方式・表示件数・必要ページ数・確認経路を設計へ記録するかを見る。
  古い設計書・受領ログを現行挙動の確定根拠にせず、選択した現行 target から取得した観測だけをログ経路の根拠にすることに加え、調査コストが高くなる順序だから必要な証拠が得られた時点で止める意図も検証する
- eval 15 は fixture 無しで、ベースラインが複数 version を跨ぐ状態と、影響テーブルが異なる機能・sentinel `-` の機能を同時に与える。最新変更だけでなく記録後の全履歴を和集合で評価し、交差する slug だけを陳腐化すること、影響なしの成果物の採取 version を書き換えないことを検証する
- eval 16 は fixture 無しで、旧 metadata に `changes` が無く過去の変更根拠も無い移行状態を与える。欠落を影響なしへ倒さず、推測した個別テーブルで履歴を捏造せず、復元不能な版を `*` で保守的に埋めることを検証する
- eval 17 は fixture 無しで、DDL と古い仕様書だけがある設計相談を与える。テーブル列だけで設計を終えず、消費側の絞り込み・並び替え・ページサイズを現行コード／実測から導いて `design.md` に根拠付きで残すことを検証する
- eval 18 は fixture 無しで、baseline と phase B の記録 version が現在の dataset version より大きい不可能な状態を与える。空の変更区間を影響なしに倒さず、整数かつ `1..現在 version` の範囲検証で差分検出前に停止することを検証する
- eval 19 は fixture 無しで、`--feature order-list` の実行中に「その機能に固有の差」と「どの機能にも固有でない差」を同時に与え、
  まとめて横断扱いにしてよいかを問う。帰属できる差には slug を書き、`cross-cutting` は帰属できないときだけ使うこと
  （まとめて横断にするのは安全側ではなく、閉じる担当が決まらず毎回の棚卸しに出続けること）、空欄・素の文字列は帰属不明になることを検証する
  （Issue #279。要素の形の正本は `replace-strategy` の `references/project-config.md`）
- 採点は `evals.json` の assertions と `result.json` / `project-files/` を突き合わせ、`grading.json` を残す
- 集計（`benchmark.json` / `benchmark.md`）は skill-creator 同梱の `aggregate_benchmark` を使う（詳細は `docs/skill-development.md`）
