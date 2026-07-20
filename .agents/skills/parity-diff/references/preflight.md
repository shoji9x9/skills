# 前提確認・陳腐化検出・条件一致検証

前提が欠けたら**捏造せず停止**し、依存順（`replace-strategy setup` → `golden-dataset` → 対象 slug の `parity-suite` → `parity-replace`）で案内する。検出・成果物・ベースラインを作り出さない。判定は指定パスの Read で行う（jq は必須ではない）。

## 確認するキー（フルパス）

| 前提 | 確認するパス・キー | 欠け/偽のときの差し戻し先 |
|---|---|---|
| replace-strategy setup | `.config/skills/shoji9x9/skills.yml` の `skills.replace-strategy` の存在／`.replace/features.md` の存在 | `replace-strategy setup` |
| slug の妥当性 | `slug` が `.replace/features.md` に載っている（自分で採番しない） | 停止（未採番なら `replace-strategy` へ） |
| parity-suite 完了 | `.replace/parity/<slug>/metadata.json` の `suite.current_green: true`・`differ.validated_by_strength_gate: true`・`noise_baseline` が記録済み・`artifacts_storage.baseline_pointer` の実体（`baseline/`）がある | 対象 slug の `parity-suite` |
| parity-replace 新側 green | `.replace/parity/<slug>/replace-metadata.json` の `suite.new_green: true` | `parity-replace`（新側 green にする） |
| Playwright と新側疎通 | Node.js が使える／`replace-metadata.json` の `new.url` に疎通できる | 停止（環境を整える） |
| ノイズ基準値 | `metadata.json` の `noise_baseline[]` が対象 page/state/viewport 分ある | `parity-suite`（測定は現行アプリを駆動する parity-suite の仕事） |

- **parity-replace の「完了」を待つのではなく `suite.new_green` を前提とする。** 差分ゼロは本スキルとの往復で達成されるため、`parity-replace` 単体の完了条件に差分ゼロは含まれない
- **スイートは再実行しない。** 新に対して green かは `suite.new_green` キーで判定する

## データセットバージョンの三者一致

`metadata.json.dataset_version` ＝ `.replace/dataset/metadata.json.version` ＝ 同 `phase_b.<slug>.dataset_version` の三者一致を確認する。`version` は 1 始まりの単調増加の整数で、論理データが変わったときだけ +1（フェーズ B では上がらない）。

| 状態 | 意味 | 対応 |
|---|---|---|
| 三者一致 | ベースラインも新側投入も現行データセットに追随 | 差分検出へ進む |
| `metadata.json.dataset_version` ＜ `dataset.version` | ベースライン側が陳腐化 | `parity-suite` にベースライン再取得を促し停止 |
| `phase_b.<slug>.dataset_version` が欠落 or ＜ `dataset.version` | 新側投入（フェーズ B）が未実施 or 古い | `golden-dataset`（フェーズ B）へ差し戻し停止 |

- データ起因の差で `.replace/dataset/verification.md` のフェーズ B 節に説明済みのものは許容。説明されていないデータ差は `golden-dataset`（フェーズ B）へ差し戻す（[`api-batch.md`](api-batch.md)）

## 差分器バージョンの一致確認

`parity-diff` は `parity-suite` が強度ゲートで健全性を確認済みの差分器を**そのまま**再利用する。ここが崩れると「検証済み」の前提が崩れるため一致を確認する。

- プロジェクト側 `trait-compare.mjs` の `VERSION` ＝ `metadata.json.differ.trait_compare` に記録された値
- プロジェクト側 `trait-capture.mjs` の `VERSION` ＝ `metadata.json.traits.tool` に記録された値
- `metadata.json.differ.{pixel_tool,pixel_threshold,align_tolerance,aria_compare,validated_by_strength_gate}` が揃っている
- 不一致なら `parity-suite` へ戻す（差分器を更新したなら強度ゲートを回し直す必要がある）
- **CLI 実行時は記録値を必ず渡す**（`trait-compare.mjs` は `--align-tolerance` を省略すると既定 1 になる。`differ.align_tolerance` の記録値と一致させる）

## 反復上限

往復ループの反復回数と上限は `parity-replace` が `replace-metadata.json` の `loop.{iterations,max_iterations,last_diff_report}` に記録する（上限管理の正本は `parity-replace` の `references/diff-loop.md`）。

- `loop.iterations >= loop.max_iterations` のとき、本スキルは**新しい差分検出は行ってよい**が、**要対応が残る場合の差し戻しは行わず停止してユーザーへ上げる**（頭から作り直さない）
- 差し戻しの可否判定は [`convergence.md`](convergence.md)

## シークレット規律

`replace-strategy` の `references/project-config.md`「シークレットの扱い」に従う。環境変数名だけを扱い、**値をログ・標準出力・成果物に出さない**。ユーザーが値を提示しても復唱しない。新側 URL への疎通・DB 環境変数の存在確認は値を表示せず行う。
