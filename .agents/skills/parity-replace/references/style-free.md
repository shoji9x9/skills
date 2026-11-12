# `style_policy: free` の画面のある機能

設定の `style_policy` が `free` で、対象が画面のある機能（`metadata.json` の `mode: feature`）のときに、`SKILL.md` の手順のどこを置き換え、どこを行わないかを定める。
横断 API（api-resource）とバッチ（batch）は、`free` でも `SKILL.md` の手順のまま進める。`free` でも、この 2 つは `parity-suite` と `parity-diff` が扱うからである。
`style_policy` の意味の原本は、`replace-strategy` の `references/project-config.md`「スタイルの方針」である。

`free` の機能では、UI の仕様（操作・状態・role・テキスト・API）を現行に合わせ、見た目は現行に合わせない。
スイートは `spec-parity suite` が e2e で作り、見た目の確かめ（横のはみ出し・操作中のエラー・デザインの点検・人による確認）は `spec-parity verify` が行う。

## 相手のスキルと判定の置き換え

| 工程 | `reproduce` | `free` |
|---|---|---|
| 前提のスイート | `parity-suite` の Playwright のスイート | `spec-parity suite` の e2e のスイート |
| 新側の green | Playwright の `new` プロジェクトの実行 | e2e の `--target=new` の実行（下の「新側の green」） |
| 見た目 | 旧 design token を新側のテーマへ寄せ、テーマで消せない構造差を `component_diffs` へ宣言する | 利用者が選んだ UI ライブラリとデザインの規則に従う。トークンを寄せず、`component_diffs` を宣言しない |
| 完了の報告と往復の相手 | `parity-diff` | `spec-parity verify` |
| 受け入れ条件の `later` の担当 | `parity-diff` | `spec-parity` |

## 前提の判定

`SKILL.md`「前提」のうち、対象 slug の `parity-suite` の完了を、`spec-parity suite` の完了に置き換える。
`.replace/parity/<slug>/metadata.json` があり、次のすべてを満たすことを求める。

- `style_policy: free`・`mode: feature`・`suite.runner: e2e` である
- `suite.current_green` と `strength.validated` がどちらも `true` である
- 現行のスイートの結果（`suite.report`。デフォルトは `.replace/parity/<slug>/suite-report.json`）がある

強度の記録を計画と結果から判定し直すのは、`spec-parity verify` の手順 1 と収束の判定である。このスキルは判定を転記して持たず、`strength.validated` を前提の確認に使う。

満たさなければ、成果物を作らずに止まり、同じ slug の `spec-parity suite` を案内する。
`differ.validated_by_strength_gate` は `parity-suite` の強度の記録で、`spec-parity suite` の成果物には無いので求めない。`parity-suite` も案内しない（`parity-suite` は `free` の画面のある機能で止まる）。
`metadata.json` が `parity-suite` の形（`style_policy` が無いか、`suite.runner` が `e2e` でない）なら、設定と成果物の方針が食い違っている。
`style_policy` を機能の着手の後に変えたときに起き、作り直すかは利用者が機能ごとに決める（`replace-strategy` の `references/project-config.md`「スタイルの方針」）。止まって、食い違いを報告する。

e2e が入っていることも確かめる。確かめ方の原本は `spec-parity` の `references/e2e-runner.md`「バージョンと導入」である（ここへ転記しない）。
無ければ止まる。e2e を入れるのは `spec-parity suite` の工程なので、このスキルは入れない。

`replace-strategy setup`・`golden-dataset` のフェーズ A とフェーズ B・未解決の保留の判定は、`SKILL.md`「前提」のままである。
見る保留には、`spec-parity suite` の保留（`.replace/parity/<slug>/pending-decisions.json`）も含む（原本は `replace-strategy` の `references/autonomy.md`「下流の前提判定」）。

最後に、このファイルが参照する `spec-parity` の文書と節を、実装に入る前にまとめて読めることを確かめる。
対象は、`spec-parity` の `SKILL.md`「前提」と、`references/` の `e2e-runner.md`・`suite-authoring.md`・`convergence.md` の、このファイルが名前で挙げた節である。
どれかを読めないか節が無ければ、止まって `spec-parity` の導入か更新（`gh skill install` か `gh skill update`）を案内する。

## e2e を実行するときの注意

- このスキルが起動する e2e には、テレメトリと更新の確認を止める環境変数を必ず付ける。e2e はテレメトリをデフォルトで送るからである。
  付ける環境変数の原本は `spec-parity` の `references/e2e-runner.md`「外部へ送るデータと止め方」である。下の「新側の green」のコマンドの環境変数が原本と食い違ったら、原本に従う。
- スイートに agent のステップ（`agent.act` など）があると、実行のたびに、指示・画面のアクセシビリティツリー・URL をモデルの提供元へ送る。
  送ってよいかの承認と止め方は、`spec-parity` の `SKILL.md`「前提」の「外部へ送るデータ」と、`spec-parity` の `references/e2e-runner.md`「外部へ送るデータと止め方」に従う（ここへ転記しない）。
  この 2 つを読めないときは、e2e を実行せずに止まる。
- `.e2e/cache/` を commit しない。入力した値がそのまま残るからである（`spec-parity` の `references/e2e-runner.md`「`agent.act` のキャッシュ」）。
- e2e の結果の出力先（デフォルトは `.e2e/`）が新側の作業ツリーの中にあるなら、新側の `.gitignore` に入れる。
  入れないと、実行のたびに `new.dirty` が `true` になる（範囲の原本は `replace-strategy` の `references/project-config.md`「新側のバージョンの記録」）。

## 実行フローの置き換え

番号は `SKILL.md`「実行フロー」の手順である。書いていない手順は、`SKILL.md` のまま行う。

### 手順 5（新側マッピングと期待値の充填）

- 新側ロケータマッピングと期待値解決層の充填は行わない。e2e のスイートは、どちらの層も持たない。
- スイートのロケータが新側で解決しない（role やアクセシブルネームが違う）ときは、新側を現行の仕様に合わせて直す。スイートを書き換えない。
  スイートを変える必要があるなら、`spec-parity suite` へ戻す。スイートを変えたら、強度の確認をやり直す必要があるからである。
- フェーズ B・target の稼働の確認と起動は、`SKILL.md` のまま行う。
  解決した URL は、`PARITY_NEW_UI_URL`・`PARITY_NEW_API_URL` で e2e に渡す（解決の決まりの原本は `replace-strategy` の `references/project-config.md`「URL の引き渡し」）。
- Playwright の `testIgnore` と `suite.current_only` は確かめない。
  e2e のスイートの現行だけで動くテスト（横のはみ出し・故障注入）は、テストの本体の `test.skip()` で、決まった環境変数を渡した実行でだけ動く（`spec-parity` の `references/suite-authoring.md`「置き場所」）。
  green を確かめる実行には、`PARITY_OVERFLOW_CAPTURE`・`PARITY_STRENGTH`・`PARITY_RUNTIME_CAPTURE` を渡さない。渡すと、`spec-parity` の記録の置き場所に書き込む。

### 手順 6（見た目）

- 旧 design token を新側のテーマへ寄せる手順（[`theming.md`](theming.md)）は行わない。`component_diffs` を宣言せず、`gaps.md` に構造差を書かない。
- 代わりに、利用者が選んだ UI ライブラリとデザインの規則に従って作る。
  - UI ライブラリは `references.ui_library` から読む。整備されていなければ、`SKILL.md` と同じくここで止まり、整備を促す（ライブラリを自分で決めない）。
  - デザインの規則は、`references.ui_library` の文書・新側のリポジトリの基底ドキュメント・既存の画面から読み取る。推測で自分の流儀を持ち込まない。
- `web-design-guidelines` スキルが入っていれば、実装の後、敵対的レビューの前に、機能の画面を作る新側のソースを点検する。任意の依存である。
  入っているかは、エージェントが使えるスキルの一覧と、プロジェクトのスキルの置き場所（`.agents/skills/web-design-guidelines/SKILL.md` など）で確かめる。
  入っていなければ点検せず、このスキルからは入れない。デザインの指摘を受け入れるかは、`spec-parity verify` のデザインの点検で利用者が決める。
- 従った規則と点検の結果は、`porting.md`「デザインの規則」に書く。

### 手順 7（敵対的レビュー）

- [`adversarial-review.md`](adversarial-review.md) のまま行う。ただし、現側の反応の網羅表 `reactions.json` は `parity-suite` が書く記録で、`spec-parity suite` の成果物には無いので渡さない。
- 「画面から見えない振る舞い」（送る前の判定と、表への書き込み）の観点は、現行のコード（一次情報源）だけを材料にして見る。
  スイートに現れない書き込みは、新側で同じ表へ同じ値・時機・回数で書く箇所を、差分から名指しできるかまで見る。結果は手順 8 の `porting.md`「表への書き込み（読解のみの行）」に残す。
- `web-design-guidelines` の点検の結果（上の「手順 6（見た目）」）は、レビュー役に渡さない。実装役が行った点検で、レビュー役が独立に照合する外部の基準ではないからである。

### 手順 8（完了の判定）

#### 新側の green

- スイートを、スイートのパス（`metadata.json` の `suite.dir`）を付けて `--target=new` で実行する。

  ```bash
  E2E_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1 E2E_UPDATE_CHECK_DISABLED=1 \
  PARITY_NEW_UI_URL=<新側の UI の URL> PARITY_NEW_API_URL=<新側の API の URL> npx e2e run <suite.dir> --target=new </dev/null
  ```

  パスを付けないと、ほかの機能のテストも結果に入る。新側にまだ無い機能のテストは `failed` になり、この機能の green が成り立たない。
  `spec-parity` の suite（現行の結果）と verify（新側の結果）も同じパスで絞る（`spec-parity` の `references/convergence.md`「収束の条件」）。

- ログインが要るスイートでは、選んだ new target の `auth.roles` から e2e の資格情報の環境変数を作って渡す（`secrets.wrapper` があれば前に付ける）。
  作り方の原本は `spec-parity` の `references/suite-authoring.md`「認証」である（ここへ転記しない）。渡さないと、ログインが要るテストが新側で通らない。
- green の条件は、`spec-parity` の `references/convergence.md`「収束の条件」の最初の行（現行で通ったテストが、新側ですべて `passed`）で定義する。
  `spec-parity verify` が同じ条件で判定し直すので、ここへ転記しない。現行の結果は `suite.report`、新側の結果は e2e の出力先の `report.json`（デフォルトは `.e2e/report.json`）である。
  `spec-parity` の `references/convergence.md` と `references/suite-authoring.md` を読めないときは、green と判定せずに止まる。
- 新側の結果を `.replace/parity/<slug>/new/<target>/suite-report.json` に保存しない。このファイルは `spec-parity verify` が自分の実行の結果を書く場所である。

#### 行う判定と行わない判定

- `SKILL.md` のまま行うもの: `verification_commands.full`・静的資産の台帳の新側の突き合わせ・「要求単位の根拠」の取りこぼし・機能の Issue の受け入れ条件の突き合わせ
- 行わないもの: 寸法の決まり方の照合・部品網羅表の新側の突き合わせ・他の機能の在席チェック。
  どれも `parity-suite` が書く記録（`capture_conditions.dimension_model`・`component_coverage`・Playwright のスイートの在席チェック）を入力にし、`spec-parity suite` の成果物には無い。
  `porting.md` の「寸法の決まり方」「移行元の宣言を反映しないと決めた箇所」には、「該当なし（style_policy: free）」と書く。
- 表への書き込みの新側の根拠は、`reactions.json` が無いので、現行のコードから挙げる。
  手順 7 で突き合わせた、スイートに現れない書き込み（表・値・時機・回数）と、新側で同じように書く箇所（ファイル・シンボル）を、`porting.md`「表への書き込み（読解のみの行）」に 1 行ずつ書く。
  現行のコードに該当が無ければ「該当なし（現行のコードを読んだ範囲: <範囲>）」と書き、空欄のまま完了を名乗らない。

#### `replace-metadata.json`

`spec-parity verify` の前提と収束の判定（`spec-parity` の `scripts/convergence-check.mjs`）は、`replace-metadata.json` の次の値を読む。
様式は [`../assets/metadata-template.json`](../assets/metadata-template.json) のまま書く。

| 値 | 書くもの |
|---|---|
| `slug` | 対象の slug（`metadata.json` の `slug` と同じ） |
| `new.target` | 選んだ new target の名前（置き場所のディレクトリ名と同じ） |
| `new.commit`・`new.tree`・`new.dirty` | green を確かめた新側のバージョン。同梱の `scripts/source-version.mjs` の出力を書く。取り方と照合の規則の原本は `replace-strategy` の `references/project-config.md`「新側のバージョンの記録」 |
| `suite.new_green` | 上の「新側の green」が成り立ったときだけ `true` |

- 新側の変更を commit してから green を確かめ、そのときのバージョンを書く。`new.dirty` が `true` の記録では、`spec-parity verify` が前提の確認で止まる。
  `new.tree` と `new.dirty` は、その時点で取得した値で書く。雛形の値のまま残さない。`spec-parity verify` は、`new.tree` を持たない記録を、green を記録し直すまで前提として使わない。
- 記録（`.replace/`）は、新側と同じ git のリポジトリに置いて commit してよい。記録を書いても commit しても、`new.tree` は変わらない。
- `suite.locator_map_new` は `none` にする。`dimension_check` は、雛形のプレースホルダを残さず、キーごと省く。`loop.changed_scope` は `null` のままにする（`parity-diff` だけが読む値である）。

#### 受け入れ条件の突き合わせ

- `issue-start` の `--acceptance` には、`--allow-later spec-parity` を渡す（`SKILL.md` の `--allow-later parity-diff` の代わり）。
- `later` を使ってよいのは、`spec-parity verify` の収束を述べる条件だけである。行の `owner` に `spec-parity` と書く。

#### 完了の報告

- 通した判定を並べ、現行との一致は主張しない。
- 「見た目は、`spec-parity verify` のデザインの点検と人による確認が収束するまで確かめていない」と必ず書く。
  `free` では見た目を現行と比べないので、収束した後も「見た目が現行と一致した」とは書かない。
- 次の工程として、同じ target を渡した `spec-parity verify --feature <slug> --target <target>` を案内する（`--autonomous` の実行なら、そのまま委譲する）。
- 同じ target の `verify-metadata.json` がすでに `converged: true` でも、このスキルはそれを収束の報告に使わない。収束を報告するのは、そのとき `spec-parity verify` を実行して得た結果に基づく場合だけにする。

### 手順 9（往復ループ）

- 差し戻しの入力は、`spec-parity verify` が書く `.replace/parity/<slug>/new/<target>/verify.md` の差し戻す内容の表である。該当するページのフェーズから再開する（頭から作り直さない）。
- 反復の数え方・上限（`--max-iterations`）・`on_diff` の扱いは、[`diff-loop.md`](diff-loop.md) のまま行う。`loop.last_diff_report` には `verify.md` のパスを書く。
- `loop.changed_scope` は書かない（`null` のまま）。`spec-parity verify` はこの値を読まない。

### 軽量な手順（同じ実装で環境だけ違う場合）

`SKILL.md`「軽量な手順」のまま行う。スイートの green は、上の「新側の green」で確かめる。
