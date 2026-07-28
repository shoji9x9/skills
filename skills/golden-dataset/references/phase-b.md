# フェーズ B（新側への写像・投入・現新一致検証）

フェーズ B は対象機能の `parity-replace` が新側の受け皿を作った後に、slug ごとに再実行して進める。**フェーズ A の論理データが共通の正本であり、フェーズ B はそれを新側へ写像するだけ**で、新しいデータを作らない（`version` の運用は [`versioning.md`](versioning.md) が正本）。

「新側の受け皿」は設定の `dataset_mode` によって変わる——`db`（既定）では新側 DB スキーマ、`static` では新側リポジトリの静的データ形式である。

## 前提

- 対象 slug の**新側の受け皿**（`parity-replace` の実装したスキーマ／静的データ形式）が存在すること。無ければ停止する
- 投入先 target（`side: new`。`--target` の選択規則は `replace-strategy` の `references/project-config.md`「実行対象環境」の「選択規則」）が書き込みを許可されていること（契約の正本も同ファイル）:
  - **`dataset_mode: db`**: 対象は **`db.seedable: true` の `side: new` target のみ**。`db` を書かない target（DB に触れない）と `env_vars` だけの target（読み取り専用）は投入対象外であり、フェーズ B の記録も作らない
    （`parity-diff` がその target を「データ整合未検証」として扱う）。`db.env_vars` の接続を確認する（値は出さず存在確認のみ、`secrets.wrapper` 前置）
  - **`dataset_mode: static`**: `db` を要求しない。`dataset_static_paths` 配下が新側リポジトリで書き込めることを確認する
- `references.db_semantics` の reference が存在すること。無ければ停止して整備を促す（`static` では静的データ形式の対応と意味論差を記した同キーの reference）

## 論理データ → 新側への写像

現行と新側は型・意味論が異なりうる。写像層はこの差を吸収する。

- `references.db_semantics` の**型マッピングと意味論差**を適用する（現行 → 新の型変換、空文字と NULL の扱い、collation による並び順など。`static` ではフィールド構成・エンコーディング・日付表記・ファイル分割の差）
- 意図的差異レジストリ `intentional_diffs.may_change`（型変換に伴う差異など）に該当する差を写像で吸収する
- 論理データの**意味は保つ**。写像は表現形式の変換であって、値の意味を変えるものではない

## 新側投入

投入ツールに新側ターゲットを追加し（[`seeding-tool.md`](seeding-tool.md)）、フェーズ A と同じ 2 枚のゲート（設定由来・自己申告）を通してから、`db` では選択した新側 target の `db.env_vars` の接続先へ投入し、`static` では新側リポジトリの `dataset_static_paths` 配下へ生成する。削除 → 投入 → 検証の構造は共通のまま、書き込み先と写像層が新側向けになる。

**フェーズ B は新側 target ごとに実行する。** 同じ DB を複数 target が共有する場合も、target ごとに実行して記録を残す（投入ツールは冪等なので再実行は安全）。
`static` では生成物が target をまたいで同一になるため、target ごとに意味を持つのは**投入後の検証**（その target が実際にゴールデンデータを配信しているか）である。検証は target ごとに行い、記録も target ごとに残す。

## 現新一致検証

新側投入後、新側整合性に加えて**現行と新側に同じ論理データが入っていること**を検証する。ここが崩れるとパリティ比較の前提が崩れる。

- **正規化して突き合わせる**: 型・表現形式の差を `db_semantics` の規則で正規化したうえで、論理的に同じかを比較する
- **`db_semantics` で説明できる差は意図的差異**として `verification.md` に記録する（単純一致しない項目の一覧）
- **説明できない不一致は失敗として扱い、修正する**（写像の誤り・投入漏れ・設計の齟齬）。失敗を意図的差異に紛れ込ませない

## 新規の意図的差異の扱い

写像・検証の過程で、レジストリに未登録の意図的差異（新たに判明した型・意味論の差）を見つけたら:

- **勝手に確定しない**。設定の `intentional_diffs.pending` へ**非破壊で追記**し、ユーザー確認へ回す
- 確認が済むまでは `verification.md` に「保留（pending）」として残す

## 成果物

`metadata.json` の `phase_b.<slug>.<target>`（`<target>`＝投入先の新側 target 名）を更新する（`dataset_version`＝新側へ投入した version、`seeded_at`、`verified_at`）。
他の target の記録は残したまま、投入した target のキーだけを更新する。検証結果は `verification.md` のフェーズ B 節（slug ごと）に記録する。
