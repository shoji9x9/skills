# 前提確認・陳腐化検出・条件一致検証

前提が欠けたら**捏造せず停止**し、依存順（`replace-strategy setup` → `golden-dataset` → 対象 slug の `parity-suite` → `parity-replace`）で案内する。検出・成果物・ベースラインを作り出さない。判定は指定パスの Read で行う（jq は必須ではない）。

## 対象 target の解決（前提確認より先）

成果物のパスも疎通先も target で決まるため、最初に対象環境を確定する。候補は `skills.replace-strategy.targets` のうち **`side: new`** のものだけ。

- **選択規則**（`--target` 省略時の既定・候補提示・存在しない名前や側違いでの停止）は `replace-strategy` の `references/project-config.md`「実行対象環境」の「選択規則」に従う（ここへ転記しない）
- `url_command` の target は**ここで 1 回だけ**コマンドを実行して URL を解決する（失敗・空出力は停止）。以降の工程（疎通・撮影・API 発行）は解決済みの値を再利用する
- 旧スキーマ・旧レイアウトは**フォールバックとして読まない**。見つけたら移行を案内して停止する（自動で移さない・両方を読まない）。
  検出対象の旧キー・旧レイアウトの一覧と移行手順は `replace-strategy` の `references/project-config.md`「移行」を正本として参照する（ここで個別に列挙しない）

## 対象 target の起動・稼働確認（疎通確認より先）

選択 target の `check_urls`（省略時は `url`。`url_command` の target は解決後の URL）で**稼働判定を先に行い**、落ちているときだけ `pre_commands` → `start` の順で起動して再度疎通確認する
（各キーの意味論と条件付きの実行順・失敗時の早期停止の正本は `browser-test` の `references/project-config.md`）。

- **稼働していれば `pre_commands` / `start` はどちらも実行しない**（`pre_commands` は `start` の前提であり、稼働中の環境に build 等の副作用を起こさない）
- **最初の稼働判定が落ちていることは停止条件ではなく起動の合図**（`start` を持たない target ではそこで早期停止する）
- `pre_commands` / `start` の失敗、**起動後**の稼働確認の失敗はいずれも**早期停止**する（撮り始めてから落ちるのを避ける）
- 配信型 target は `start` を持たないため、稼働確認のみで判定する
- シークレットが要るコマンドには `secrets.wrapper` を前置する（値は表示しない）

## 確認するキー（フルパス）

`<target>` は解決済みの新側 target 名。現側の成果物（`metadata.json` / `baseline/`）は 1 環境なので slug 直下のまま。次は**全モード共通**の前提。

| 前提 | 確認するパス・キー | 欠け/偽のときの差し戻し先 |
|---|---|---|
| replace-strategy setup | `.config/skills/shoji9x9/skills.yml` の `skills.replace-strategy` の存在／`.replace/features.md` の存在 | `replace-strategy setup` |
| slug の妥当性 | `slug` が `.replace/features.md` に載っている（自分で採番しない） | 停止（未採番なら `replace-strategy` へ） |
| parity-suite 完了 | `.replace/parity/<slug>/metadata.json` の `suite.current_green: true`・`differ.validated_by_strength_gate: true` | 対象 slug の `parity-suite` |
| parity-replace 新側 green | `.replace/parity/<slug>/new/<target>/replace-metadata.json` の `suite.new_green: true` | `parity-replace`（**同じ `--target`** で新側 green にする） |
| target 名の一致 | 同ファイルの `new.target` が解決した target 名と一致する | 停止（別環境の green 証跡を流用しない） |
| Node.js と新側疎通 | Node.js が使える／選択 target の `url`（＝ `new.ui_url`）に疎通できる。api-resource モードは `api_url`（＝ `new.api_url`。省略時 `ui_url`）にも疎通できる。`url_command` の target は解決後の URL へ疎通する（`new.ui_url` の記録は `"runtime"`） | 停止（環境を整える） |

- 選択 target の `replace-metadata.json` が無い／`suite.new_green` が偽なら「**その環境ではまだ green 証跡が無い**」として停止する。別環境の証跡で代替しない（環境ごとに独立）
- **parity-replace の「完了」を待つのではなく `suite.new_green` を前提とする。** 差分ゼロは本スキルとの往復で達成されるため、`parity-replace` 単体の完了条件に差分ゼロは含まれない
- **スイートは再実行しない。** 新に対して green かは `suite.new_green` キーで判定する

## モード別の追加要求（`metadata.json.mode` で分岐）

視覚系の前提（ノイズ基準値・視覚ベースライン・画素／特性の差分器）は **`feature` モードだけが要求する**。
`api-resource` / `batch` は画面系 3 経路を動かさないため、`parity-suite` がこれらを記録していないのが正常であり、**欠落を停止条件にしない**（無いものを理由に差し戻さない）。

| モード | 追加で要求するもの | 欠けたときの差し戻し先 |
|---|---|---|
| feature | `metadata.json` の `noise_baseline[]` が対象 page/state/viewport 分ある・`artifacts_storage.baseline_pointer` の実体（`baseline/`）がある・下記「差分器バージョンの一致確認」 | `parity-suite`（ノイズ基準値の測定は現行アプリを駆動する `parity-suite` の仕事） |
| api-resource | 現行応答の record（`metadata.json.suite.specs` のスイートと録画）が実体としてある。比較は同梱 `json-normalize-diff.mjs` 系のみ | `parity-suite` |
| batch | 現行バッチの出力ベースライン（DB 状態・生成ファイル）が実体としてある | `parity-suite` |

## データセットバージョンの三者整合

`.replace/dataset/metadata.json` の `changes[].affects` を `golden-dataset` の `references/versioning.md` に従って読む。
`metadata.json.dataset_version` と `phase_b.<slug>.<target>.dataset_version`（**選択した新側 target のエントリ**）のそれぞれについて、その版より後に対象 slug へ影響する変更が無いことを確認する。
`version` は 1 始まりの単調増加の整数で、論理データが変わったときだけ +1（フェーズ B では上がらない）。
影響判定の前に、dataset の現在 version と各記録 version が整数で、各記録が `1..現在 version` に収まることを確認する。将来 version、0 以下、非整数、欠落は整合不能として差分検出を開始せず停止する。

| 状態 | 意味 | 対応 |
|---|---|---|
| 両記録後に対象 slug への影響変更が無い | ベースラインも新側投入も対象データに追随（数値が現在版より古くてもよい） | 差分検出へ進む |
| ベースライン記録後の `affects` が対象 slug と交差 | ベースライン側が陳腐化 | `parity-suite` にベースライン再取得を促し停止 |
| phase B 記録が欠落、または記録後の `affects` が対象 slug と交差 | その target への新側投入が未実施または対象データが古い | `golden-dataset`（フェーズ B）へ**同じ target** で差し戻し停止 |
| `changes` が欠落／不正、slug の実効参照テーブルが判定不能 | 影響なしを証明できない | 全体影響として上記の古い側を差し戻す |
| いずれかの記録 version が現在 version より大きい、0 以下、非整数 | metadata の破損または dataset metadata の巻き戻し | 整合不能として停止し、成果物と dataset metadata の復元・再生成を促す |

- データ起因の差で `.replace/dataset/verification.md` のフェーズ B 節に説明済みのものは許容。説明されていないデータ差は `golden-dataset`（フェーズ B）へ差し戻す（[`api-batch.md`](api-batch.md)）

### 選択 target が投入対象でない場合（phase B 整合の免除）

免除するのは**その target がゴールデンデータの投入対象でないとき**だけである（投入契約の正本は `replace-strategy` の `references/project-config.md`）。設定の `dataset_mode` で判定が変わる。

| `dataset_mode` | 選択した新側 target | phase B との整合 |
|---|---|---|
| `db`（既定） | `db` 未定義（DB に触れない）／`db.env_vars` はあるが `seedable` が無い（読み取り専用） | **免除**（投入対象外） |
| `db` | `db.seedable: true` | 要求する |
| `static` | すべて | 要求する（データはリポジトリ内にあり、target の `db` に依存しない） |

- 免除するときは**phase B との整合（`phase_b.<slug>.<target>`）を要求しない**。フェーズ B 未実施を理由に `golden-dataset` へ差し戻さない
- 代わりに「**ゴールデンデータ未投入のため、データ依存の差分は実装差かデータ差か判別できない＝未検証**」を `diff.md` の未検証領域に明記し、
  確認をデータ非依存の範囲（レイアウト・スタイル・構造など、投入データの内容に依存しない差分）に限定する。`diff-metadata.json.dataset_version_exempt` に免除理由（DB 未定義か読み取り専用か）を記録する
- **`seedable` が無いだけの target を「投入対象にできる」と読み替えない**（設定の修正はユーザーの判断。免除して未検証と記録するか、ユーザーに `seedable: true` の追加を促して停止するかのどちらかで、勝手に投入しない）
- ベースライン記録後の変更が対象 slug に影響しないことの確認は**免除の有無に関わらず**行う

## 差分器バージョンの一致確認（feature モードのみ）

`parity-diff` は `parity-suite` が強度ゲートで健全性を確認済みの差分器を**そのまま**再利用する。ここが崩れると「検証済み」の前提が崩れるため一致を確認する。
`api-resource` / `batch` は画素・特性照合の差分器を使わないため**この節は確認しない**（比較は同梱 `json-normalize-diff.mjs` が担い、そのバージョンは `diff-metadata.json.differ_versions` に記録する）。

- プロジェクト側 `trait-compare.mjs` の `VERSION` ＝ `metadata.json.differ.trait_compare` に記録された値
- プロジェクト側 `trait-capture.mjs` の `VERSION` ＝ `metadata.json.traits.tool` に記録された値
- `metadata.json.differ.{pixel_tool,pixel_threshold,align_tolerance,aria_compare,validated_by_strength_gate}` が揃っている
- 不一致なら `parity-suite` へ戻す（差分器を更新したなら強度ゲートを回し直す必要がある）
- **CLI 実行時は記録値を必ず渡す**（`trait-compare.mjs` は `--align-tolerance` を省略すると既定 1 になる。`differ.align_tolerance` の記録値と一致させる）

## 反復上限

往復ループの反復回数と上限は `parity-replace` が選択 target の `.replace/parity/<slug>/new/<target>/replace-metadata.json` の
`loop.{iterations,max_iterations,last_diff_report}` に記録する（**環境ごとに独立**。上限管理の正本は `parity-replace` の `references/diff-loop.md`）。

- `loop.iterations >= loop.max_iterations` のとき、本スキルは**新しい差分検出は行ってよい**が、**要対応が残る場合の差し戻しは行わず停止してユーザーへ上げる**（頭から作り直さない）
- 差し戻しの可否判定は [`convergence.md`](convergence.md)

## シークレット規律

`replace-strategy` の `references/project-config.md`「シークレットの扱い」に従う。環境変数名だけを扱い、**値をログ・標準出力・成果物に出さない**。ユーザーが値を提示しても復唱しない。新側 URL への疎通・DB 環境変数の存在確認は値を表示せず行う。
