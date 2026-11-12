---
name: spec-parity
description: 仕様を変えないアプリケーションリプレイスで、UI のスタイルを現行に合わせない方針（replace-strategy の style_policy が free）のときに、parity-suite と parity-diff の代わりに画面のある機能を確かめる姉妹スキル。suite は現行に対して e2e のスイート（操作・状態・role ごとの assertion・API）を作り、故障注入で強度を確かめ、操作中のエラーの基準と現行が保証する幅を記録する。verify は新側だけを確かめ、スイート・横のはみ出し・操作中のエラーをツールで、デザインの点検と人による確認を承認の記録で判定し、要対応を parity-replace へ差し戻す。画面を現行と比べない。1 回で 1 機能。style_policy が free でない・e2e が無い・前提が無いときは止まる。「スタイルは自由でリプレイスを確かめて」「spec-parity」や suite / verify を伴う依頼で発動する。
argument-hint: "<suite|verify> [--feature <slug>] [--target <name>] [--autonomous]"
license: MIT
---

# Spec Parity

`replace-strategy` の姉妹スキル。UI の仕様は現行と同じにするが、スタイルは同じでなくてよい（人が見て違和感の無いスタイルは要る）リプレイスで、画面のある機能を確かめる。

- 合否はロケータと assertion で決定論的に書く。LLM に「差分があるか」を聞かない。操作は、自然文の目的（`agent.act`）で書いてもよい。
- 現行と新側の画面は比べない。スクリーンショットと計算後スタイルは、比較のために採らない。確かめるための画面の記録は、人による確認のために採ってよい。
- 見た目が自由になった分、横のはみ出し・操作中のエラー・デザインの点検・人による確認で、新側に違和感や不具合が出ていないかを確かめる。
- 1 回の実行で扱うのは 1 機能である。このスキルは新側を直さない。要対応は `parity-replace` へ差し戻す。

## 使い方

```text
spec-parity suite  [--feature <slug>] [--target <name>] [--autonomous]
spec-parity verify [--feature <slug>] [--target <name>] [--autonomous]
```

| モード | 対象の側 | 内容 |
|---|---|---|
| `suite` | 現行（`targets` の `side: current`） | 現行に対して e2e のスイートを作って通し、故障注入で強度を確かめ、操作中のエラーの基準と、現行が保証している幅を記録する |
| `verify` | 新側（`targets` の `side: new`） | 新側だけを確かめる。スイート・横のはみ出し・操作中のエラー・デザインの点検・人による確認を記録し、収束を判定する |

- `slug` は `.replace/features.md` が採番したものを使い、自分では採番しない。省いたときは、features.md の機能一覧の未着手の機能から対話で選ぶ。
- 対象は、features.md の機能一覧の行（画面のある機能。成果物の `mode: feature`）だけである。
  横断 API リソースとバッチの slug なら、成果物を作らずに止まり、`parity-suite` と `parity-diff` を案内する。`style_policy` は画面の見た目にだけ関わるからである。
- `--target` を省いたときのデフォルト・候補の提示・存在しない名前や側の違いでの停止は、`replace-strategy` の `references/project-config.md`「実行対象環境」の「選択規則」に従う（ここへ転記しない）。
- `--autonomous` は、その実行だけを自律で進める宣言である（下記「自律実行」）。省いたときは、判断のたびに確認する。
- 自然文でも発動する。「スタイルは自由でいいのでスイートを作って」「新側を確かめて収束を判定して」など。

## 前提

前提が欠けていたら、成果物を作らずに止まり、足りないものを依存の順に案内する（スイート・記録・判定の結果を作り出さない）。前提があるかは、決まったパスを読んで判定する。

- 設定の `style_policy` が `free` である（読み方は下記「プロジェクト設定の解決」）。`free` でないとき（キーが無いときの `reproduce` を含む）は止まり、`parity-suite` と `parity-diff` を案内する。
- e2e: プロジェクトの devDependencies に `e2e` と `@e2e-dev/web` があり、プロジェクトに入った e2e が `--version` に答える。
  レジストリから取得させない確かめ方は、[`references/e2e-runner.md`](references/e2e-runner.md)「バージョンと導入」にある。確かめたバージョンは e2e 0.23.0・`@e2e-dev/web` 0.15.5 で、Node.js 24.8 以上（22 なら 22.22.3 以上）が要る。
  無ければ止まり、導入を案内する（導入は利用者の承認を得てから行う）。詳しくは [`references/e2e-runner.md`](references/e2e-runner.md) にある。
- 外部へ送るデータ: e2e はテレメトリをデフォルトで送り、`agent.act` などの agent のステップでは指示・アクセシビリティツリー・URL（求められたときはスクリーンショット）をモデルの提供元へ送る。
  このスキルが起動する e2e には、必ず `E2E_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1 E2E_UPDATE_CHECK_DISABLED=1` を付ける。
  agent のステップは、送る内容を利用者が承認したときだけ使う（[`references/e2e-runner.md`](references/e2e-runner.md)「外部へ送るデータと止め方」）。
- `agent.act` のキャッシュ: `.e2e/cache/` に、入力した値がそのまま残る。commit せず、再生を合否の根拠にしない（[`references/e2e-runner.md`](references/e2e-runner.md)「`agent.act` のキャッシュ」）。
- Playwright との共存: e2e は `*.e2e.ts` だけを集めるので、Playwright のスイートと互いのテストを拾わない。`@e2e-dev/web` が自分の `playwright-core` を持つので、`playwright-core` と Chromium が 2 組になる。
- ツール: `git`、Node.js。判定のスクリプトと、新側のバージョンを取る `scripts/source-version.mjs` は依存パッケージを使わない。
- 前提スキル（依存の順）: `replace-strategy`（`setup` が完了）→ `golden-dataset`（`suite` はフェーズ A、`verify` は選んだ target のフェーズ B）。
  `verify` では、さらに `suite` の完了 → `parity-replace`（選んだ target で新側が green）が要る。
  前提スキルが入っていなければ、`gh skill install shoji9x9/skills <name>` で入れてから実行する。
  `replace-strategy` が `references/` で、このスキルが読む設定のスキーマ・自律実行の規約・対応範囲を定義し、`parity-suite` が `references/` で強度の確認の考え方を定義している。そのため、このスキルは 2 つのスキルが入っていないと動かない。
  `verify` は、さらに `parity-diff` の `references/preflight.md` と `scripts/pending-triage-check.mjs`（意図的差異の保留の棚卸し）を使うので、`parity-diff` も入っていないと動かない。
- `suite` は、`parity-suite` がスイートを作る前に確かめる 2 つの条件を同じように確かめ、どちらかが成り立てば止まる。条件の原本は `parity-suite` の `SKILL.md`「2. 対象決定」と「4. データセットの投入先・バージョン確認」である。
  1 つは、`current.origin: received-assets` で現行の環境が引き渡されていないか、対象の slug の意味論が確定していないことである。
  もう 1 つは、`.replace/dataset/metadata.json` の `current.target` が選んだ target と違うことである（`null` なら照合しない）。
  `parity-suite` の `SKILL.md` を読めないときは、この 2 つを確かめたことにせず止まる。
- `verify` は、データセットのバージョンが古くなっていないことを、`parity-diff` の `references/preflight.md`「データセットバージョンの三者整合」と同じ表で確かめる（ここへ転記しない）。
  読むのは、`metadata.json` の `dataset_version`（`suite` を作ったときのバージョン）と、`.replace/dataset/metadata.json` の `phase_b.<slug>.<target>.dataset_version` である。
  `suite` を作った後の変更が対象の slug に影響するなら、`spec-parity suite` をやり直すよう促して止まる。フェーズ B の側が古ければ、同じ target の `golden-dataset`（フェーズ B）を案内して止まる。
  投入の対象でない target の扱いも同じ表に従い、免除したときは、データに依存する確かめを `verify-metadata.json` の `unverified` に理由と一緒に書く。`parity-diff` の `references/preflight.md` を読めないときは、確かめたことにせず止まる。
- `verify` は、選んだ target の `.replace/parity/<slug>/new/<target>/replace-metadata.json` の `suite.new_green` が `true` であることを前提にする。
  記録の `slug`・`new.target`・`new.tree` が、対象の slug・選んだ target・確かめる新側のバージョンと同じで、`new.dirty` が `false` であることも前提にする。
  新側のバージョンは `new.tree`（`.replace/` を除いた新側のソースのツリーのハッシュ）で照合し、`new.commit` は照合に使わない。
  値の意味と取り方の原本は `replace-strategy` の `references/project-config.md`「新側のバージョンの記録」である（ここへ転記しない）。読めないときは、確かめたことにせず止まる。
  記録と新側を同じ git のリポジトリに置いてよい。記録を書いても commit しても、`new.tree` は変わらないので止まらない。
  `new.tree` を持たない記録は、`new.commit` が同じでも合格として扱わず、もう一度測る（`parity-replace` で green を記録し直す）。
  commit していない変更で green にした記録は、バージョンを特定できないので止まる。
  確かめる新側のバージョン（`verify-metadata.json` の `new.tree`）が `none`（新側が git で管理されていない）でも止まる。どの記録のバージョンも特定できないからである。
  `spec-parity` は git で管理されていない新側を確かめないので、新側を git で管理して commit するよう利用者に示す。
  確かめる新側の作業ツリーに commit していない変更があるとき（`verify-metadata.json` の `new.dirty` が `false` でないとき）も止まる。採った記録が `new.tree` のバージョンのものと言えないからである。
  利用者には、変更を退避して green にしたバージョンに戻してから verify をやり直す手を示す。
  退避は、記録を退避しないように `.replace/` を除いた pathspec で行う（形は同じ節にある）。
  変更を残すなら、commit してから、同じ `--target` の `parity-replace` で green を記録し直す。commit してから verify をやり直すだけでは、`new.tree` が green の記録と違うので止まる。
  ファイルが無いか `true` でないとき、または上の鍵が違うか `replace-metadata.json` の `new.dirty` で止まったときは、「その環境ではまだ green の証跡が無い」として止まる。
  止まったら、同じ `--target` での `parity-replace` を案内する（新側を commit してから green を記録し直す）。
  インストール済みの `parity-replace` が `references/style-free.md` を持たない古いバージョンなら、`free` の画面のある機能で止まるので、先に `gh skill update` で `parity-replace` を更新するよう案内する。差し戻しのときも同じである。
  `new.tree` だけが違い、記録が `dirty: false` なら、確かめるバージョンを green にしたバージョンに戻す手も、利用者に示す。
- 前提スキルの未解決の保留が無い。見る記録先と範囲の原本は `replace-strategy` の `references/autonomy.md`「下流の前提判定」で、`suite` の保留（`.replace/parity/<slug>/pending-decisions.json`）を含む。
  数えるのは `replace-strategy` の `scripts/pending-decisions-check.mjs` で、exit 0 でなければ、保留を抱えたスキルを案内して止まる。`replace-strategy` の文書を読めないときも止まる。
- 任意: `web-design-guidelines` スキル（デザインの点検に使う。無ければ同梱の観点で点検する。[`references/design-review.md`](references/design-review.md)）。

## 厳守の制約（禁止事項）

- LLM に「差分があるか」「問題ないか」を聞いて合否を決めない。合否は、e2e の結果・判定のスクリプトの終了コード・利用者の承認の記録で決める。
- モデルの「違和感は無いように見える」を、デザインの点検や人による確認の代わりにしない。人による確認は利用者が行い、承認を記録する。
- 現行と新側のスクリーンショットや計算後スタイルを比べない。採った画面の記録を、比較の材料としてモデルに渡さない。
- `agent.assert`・`agent.extract` で合否を決めない。`agent.act` の後には、結果を確かめるロケータの assertion を置く。
- 合否の期待値を、新側に合わせて書き換えない。期待値は現行で観測した値から決める（[`references/suite-authoring.md`](references/suite-authoring.md)）。
- e2e は、テレメトリと更新の確認を止めて実行する（`E2E_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1 E2E_UPDATE_CHECK_DISABLED=1` を付ける）。agent のステップを、送る内容の承認なしに書かない。テストのデータに秘密の値を入れない。
- 強度の確認を通っていないスイートで、`verify` を始めない。注入しても緑のままの故障・注入が届かなかった故障・実行が止まった故障を、検出として数えない（[`references/strength.md`](references/strength.md)）。
- 横のはみ出しを、現行と比べて判定しない。現行が保証している幅（現行がはみ出さないと確かめた幅）で、新側だけを測る。測っていない組を合格にしない（[`references/overflow.md`](references/overflow.md)）。
- 操作中のエラーを、0 件かどうかやモデルの判断で決めない。現行と新側を同じランナー（e2e）で 2 回以上記録し、`runtime-errors.mjs compare` で現行に無かったエラーだけを差分にする（[`references/runtime-errors.md`](references/runtime-errors.md)）。
  Playwright で採った基準（`parity-suite` の記録）と混ぜない。
- 受け入れるデザインの指摘と許容するエラーを、承認の前に確定として書かない。承認の前は収束の判定で未説明として数える。
- `converged` を手で `true` にしない。`convergence-check.mjs --write` だけが書く（[`references/convergence.md`](references/convergence.md)）。
- 性能（初期表示の読み込みの速さとレイアウトの揺れ）と見た目の一致を、確かめたことにしない。性能は `verify-metadata.json` の `unverified` に `performance` として書く。
- 未検証の箇所を「確認済み」にしない。確かめていない箇所は、`gaps.md` と `verify-metadata.json` の `unverified` に理由と一緒に残す。
- 1 つの機能の中で、Playwright のパリティスイートと e2e のスイートを混在させない。
- シークレットの値を、コード・コメント・ログ・成果物・スクリーンショットに残さない（原本は `replace-strategy` の `references/project-config.md`「シークレットの扱い」）。

## プロジェクト設定の解決

このスキルは設定を書かない。`replace-strategy` の設定（`.config/skills/shoji9x9/replace-strategy.jsonc`）を、同梱の `scripts/skill-config/skill-config.mjs` で読むだけである。

```bash
node <このスキルのディレクトリ>/scripts/skill-config/skill-config.mjs get replace-strategy style_policy --raw
```

設定の置き場所と層の原本は [`references/config-files.md`](references/config-files.md)、キーの意味の原本は `replace-strategy` の `references/project-config.md` である。
読み取りが終了コード 1（知らないキー・型の誤り）を返したときは、デフォルトの値に置き換えずに止まる。読むキーは次の表のとおりである。

| キー | 用途 |
|---|---|
| `style_policy` | `free` でなければ止まる（キーが無ければ `reproduce`）。意味は `replace-strategy` の `references/project-config.md`「スタイルの方針」にある |
| `targets[]` | `suite` は `side: current`、`verify` は `side: new` の target。`url` / `api_url` を `PARITY_CURRENT_*` / `PARITY_NEW_*` に解決し、`pre_commands` / `start` / `check_urls` で起動を確かめる。`forbidden_actions` で書き込みを許していない target では、書き込みのテストを実行せず未検証にする。`on_diff` は差し戻しの分岐に使う |
| `targets[].auth.roles` | 選んだ target のロールごとの資格情報（値は環境変数の名前）。ロールごとにログインの状態を分け、e2e の `credentials` へ実行のたびに環境変数で渡す（[`references/suite-authoring.md`](references/suite-authoring.md)「認証」）。認証が要らない環境では `auth` ごと省かれる |
| `artifacts.{storage,overrides.<slug>}` | 人による確認のために撮った画面の保存先（デフォルトでは commit しない） |
| `verification_commands` | 書いたスイートと部品に通す検証コマンド。通すのは `full` だけで、`diff` は使わない。`full` が無くても、値がリスト（古い形式）でも止まらず、その旨を `gaps.md` に記録して進む。スイートの合否は、現行の green と強度の確認が決める（`parity-suite` の同じキーと同じ扱い） |
| `references.coding_conventions` | スイートと部品を書くときに従うコーディング規約。スイートは対象のプロジェクトの側のコードなので、そのリポジトリの規約に従う。整っていなくても止まらないが、推測で自分の流儀を持ち込まない（`parity-suite` の同じキーと同じ扱い） |
| `references.dependency_policy` | e2e と `web-design-guidelines` を入れるときの方針 |
| `secrets.wrapper` | シークレットが要るコマンドの前に付けるラッパー |

`parity_suite_dir` は読まない。これは Playwright のパリティスイートの置き場所で、`free` でも横断 API とバッチのスイートを `parity-suite` がそこに置く。e2e のスイートの置き場所は、e2e の設定の `tests` で決まる（[`references/suite-authoring.md`](references/suite-authoring.md)「置き場所」）。

設定と `.replace/features.md` が無ければ、`replace-strategy setup` を促して止まる。古いスキーマや古いレイアウトを見つけたら、`replace-strategy` の `references/project-config.md`「移行」に従って移行を案内し、止まる。

## 自律実行（`--autonomous`）

自律実行の規約の原本は `replace-strategy` の `references/autonomy.md` で、宣言の復唱・越えない線・停止の分け方・保留の記録の形・最後にまとめて聞く手順を定める（ここへ転記しない）。
`replace-strategy` の `references/autonomy.md` を読めないときは、`--autonomous` を無視し、確認のたびに止まる。`spec-parity` に固有の扱いだけを次に挙げる。

- 判断待ち（保留として記録する）にするもの
  - e2e・`web-design-guidelines` を入れるか（越えない線）
  - agent のステップでモデルの提供元へ画面の内容を送るか
  - 現行もはみ出した幅を、保証する幅から外すか（`suite`）
  - デザインの指摘を受け入れるか、許容するエラーの確定（原因の単位）
  - 人による確認（自律実行でも省かない。承認の記録が無い間は収束しない）
  - `on_diff` のドキュメントが指示する起票（越えない線）
- 保留にしても進める工程: スイートの実行・記録・判定のスクリプトの実行・成果物の更新・要対応の `parity-replace` への差し戻し（同じ `--autonomous` を引き継ぐ）
- `suite` の記録先は、`.replace/parity/<slug>/pending-decisions.json` である。`metadata.json` は完了の証拠なので、保留を書かない。
  `verify` の記録先は、`verify-metadata.json` の `pending_decisions[]` と `run.autonomous`、`verify.md` の判断待ちの節である。
  未解決の保留が残る間は、`suite.current_green` を `true` にせず、`converged` も `true` にならない。

## 実行フロー

詳細は各 reference に書いてある。番号の順に進める。どの工程も、前の工程の判定が通ってから次へ進む。

### suite

1. 前提の確認。`style_policy`・features.md の機能一覧の行か・e2e・`golden-dataset` のフェーズ A を、データセットの確認と target の起動より先に確かめる（上記「前提」）。
   target を解決し、`check_urls` で稼働を確かめる。
2. 部品と設定を置く。`tests/parity/` の部品と `e2e.config.ts` を雛形から置く（既にあれば上書きしない）。置き場所は [`references/suite-authoring.md`](references/suite-authoring.md)「置き場所」にある。
3. スイートを書く。操作・状態・role ごとの assertion・API を、[`references/suite-authoring.md`](references/suite-authoring.md) に従って `tests/<slug>/` に書く。
   スイートと部品は、`references.coding_conventions` の規約に従って書く。ログインが要る画面は、同じ reference の「認証」に従う。
   API の特性化では、確定した口の features.md への書き戻しを `replace-strategy evidence` に任せ、確定できなかった口を `metadata.json` の `unmeasured` に宣言する（同じ reference「API の要求単位の根拠と未測定」）。このスキルは features.md を自分では書かない。
4. スイートを現行で通す。スイートのパス（`metadata.json` の `suite.dir`）を付けて、`npx e2e run tests/<slug>/ --target=current` の形で実行する。
   全件が通ったら、結果の JSON を `.replace/parity/<slug>/suite-report.json` に保存する。状態を変えるスイートは 2 回続けて通す。
   パスを付けないと、ほかの機能のテストも結果に入り、収束の判定（`convergence-check.mjs`）が判定できないとして止まる。手順 5 の記録と、`parity-replace` の新側の green の確認も、同じパスで絞る。
5. 操作中のエラーの基準を採る。2 回以上記録して `runtime-errors.mjs summarize --write` で `metadata.json` の `runtime_errors` に書く（[`references/runtime-errors.md`](references/runtime-errors.md)）。
6. 強度を確かめる。故障注入のテストと強度の計画を書き、`strength-check.mjs --write` で `metadata.json` の `strength` に書く。exit 0 になるまで、assertion を強めるか注入を直す（[`references/strength.md`](references/strength.md)）。
7. 現行が保証している幅を記録する。候補の幅を現行で測り、`overflow-check.mjs --side current` が exit 0 になる幅を `capture_conditions.viewports` に残す（[`references/overflow.md`](references/overflow.md)）。
8. 仕上げる。`verification_commands.full` をスイートと部品に通す（無ければ `gaps.md` に記録して進む）。
   `strength.md`・`gaps.md` を書き、`metadata.json` の `suite.current_green` を `true` にし、`unmeasured` が `gaps.md` と同じ文言になっていることを確かめる。保留が残るなら `true` にしない。

### verify

1. 前提の確認。`style_policy`・機能一覧の行か・e2e・フェーズ B・データセットのバージョン・`replace-metadata.json` の `suite.new_green`・`slug`・`new.target`・`new.tree`・`new.dirty` を確かめる。
   確かめる新側のバージョンが `none`（新側が git で管理されていない）なら、ここで止まる（上の「前提」）。
   `suite` の完了は、`metadata.json` の `style_policy: free`・`suite.current_green`・`strength.validated` で確かめる。
   強度は `strength.validated` を信じず、`strength-check.mjs` を `--write` なしで `strength-plan.json` と `strength-report.json` に当て、exit 0 であることも確かめる（手順 7 の判定も同じに判定し直す）。
   このとき `--metadata .replace/parity/<slug>/metadata.json` を渡し、計画の slug も照合する。
   `verify-metadata.json` を雛形から作る。前の記録があれば、保留と承認の記録（`approvals`）を読んでから更新し、`approvals` を引き継ぐ。
   同梱の [`scripts/source-version.mjs`](scripts/source-version.mjs) の出力の `commit`・`tree`・`dirty` を `new.commit`・`new.tree`・`new.dirty` に書く。
   `new.dirty` が `false` でなければ、ここで止まる（上の「前提」）。
   起動の形と取り方の原本は `replace-strategy` の `references/project-config.md`「新側のバージョンの記録」で、`parity-replace` の `replace-metadata.json` と `parity-diff` の前提の確認も同じ取り方を使う（ここへ転記しない）。
   除くのは `.replace/` だけである。e2e の結果の出力先（`.e2e/`）と人による確認で撮った画面が新側のディレクトリの中にあるなら、`.replace/` の下に置くか新側の `.gitignore` に入れる。
   どちらでもないと、書くたびに `new.dirty` が `true` になり、verify は止まる（同じ節）。
2. スイートを新側で実行する。suite の手順 4 と同じスイートのパスを付けて `--target=new` で実行し、結果の JSON を `new/<target>/suite-report.json` に保存し、実行した新側の `new.tree` を `suite.tree` に書く。
3. 横のはみ出しを測る。記録した幅で新側を測り、`overflow-check.mjs --write` で `overflow` に書く（[`references/overflow.md`](references/overflow.md)）。
4. 操作中のエラーを比べる。新側で 2 回以上記録し、`runtime-errors.mjs compare --write <verify-metadata.json> --tree <new.tree>` で比べる。`--tree` には、記録を採った新側の `new.tree` を渡す。現行に無かった署名は 3 値に分類する。許容は利用者が承認し、承認を `approvals` に追記する（[`references/runtime-errors.md`](references/runtime-errors.md)）。
5. デザインを点検する。`web-design-guidelines` があれば使い、無ければ同梱の観点で点検する。指摘は「直す」か「受け入れる」に分け、受け入れるものは利用者が承認し、承認を `approvals` に追記する（[`references/design-review.md`](references/design-review.md)）。
6. 人に確かめてもらう。新側の画面を記録した幅で見てもらい、承認を記録して `approvals` に追記する（[`references/design-review.md`](references/design-review.md)「人による確認」と「承認の記録」）。
7. 収束を判定し、差し戻す。判定の直前に、手順 1 と同じ `source-version.mjs` で新側のバージョンを取得し直す。
   出力の `tree` が `new.tree` と違えば、手順 2〜6 の記録がどのバージョンのものか分からないので、止まって手順 1 からやり直す。
   出力の `commit` だけが違うとき（記録を commit したときなど）は、やり直さずに `new.commit` を書き直す。作業ツリーの状態は `new.dirty` に書き直す（`true` なら、判定は前提の欠落で止まる）。
   `convergence-check.mjs --write` の終了コードで決める。`send-back` の理由が残れば `verify.md` を差し戻しの入力にして `parity-replace` へ渡し、`remeasure` は該当する手順をやり直し、`approval` は利用者に確かめる（[`references/convergence.md`](references/convergence.md)）。
   exit 0 でも、次の 2 つが exit 0 になることを確かめてから収束と報告する（[`references/convergence.md`](references/convergence.md)）。
   1 つは `replace-strategy` の `append-only-check.mjs` で、追記専用の成果物が縮んでいないことを確かめる。
   対象は、`replace-strategy` の `assets/append-only-manifest.json` に項目があるもの（`gaps.md`・`metadata.json` の `unmeasured`・`verify-metadata.json` の `approvals` など）である。
   もう 1 つは `parity-diff` の `pending-triage-check.mjs` で、意図的差異の保留（設定の `intentional_diffs.pending`）を棚卸ししたことを確かめる。

## 成果物

すべて対象のプロジェクトの側に置く。テンプレートの原本は [`assets/`](assets/) である。

| 成果物 | 場所 | 原本のテンプレート |
|---|---|---|
| メタデータ（suite） | `.replace/parity/<slug>/metadata.json`（`style_policy: free`・`mode: feature`・`suite.runner: e2e`・`suite.dir`・`suite.current_green`・`strength`・`capture_conditions`・`runtime_errors`・`unmeasured`） | [`assets/metadata-template.json`](assets/metadata-template.json) |
| 現行のスイートの結果 | `.replace/parity/<slug>/suite-report.json` | — |
| 強度の計画・結果・レポート | `.replace/parity/<slug>/strength-plan.json`・`strength-report.json`・`strength.md` | [`assets/strength-plan-template.json`](assets/strength-plan-template.json)・[`assets/strength-template.md`](assets/strength-template.md) |
| 未検証の領域 | `.replace/parity/<slug>/gaps.md` | [`assets/gaps-template.md`](assets/gaps-template.md) |
| 操作中のエラーの記録 | 現行は `.replace/parity/<slug>/runtime-errors/run-<回>/`、新側は `.replace/parity/<slug>/new/<target>/runtime-errors/run-<回>/` | 記録は雛形の init script と reporter が書く |
| 横のはみ出しの測定 | 現行は `.replace/parity/<slug>/overflow-current.json`、新側は `.replace/parity/<slug>/new/<target>/overflow.json` | [`assets/overflow.e2e.template.ts`](assets/overflow.e2e.template.ts) |
| メタデータ（verify） | `.replace/parity/<slug>/new/<target>/verify-metadata.json`（`converged`・`overflow`・`runtime_errors`・`design_review`・`human_review`・`approvals`・`intentional_diffs_pending`・`unverified`・`pending_decisions`） | [`assets/verify-metadata-template.json`](assets/verify-metadata-template.json) |
| 新側のスイートの結果と確認のレポート | `.replace/parity/<slug>/new/<target>/suite-report.json`・`verify.md` | [`assets/verify-template.md`](assets/verify-template.md) |
| 保留の記録（suite の自律実行） | `.replace/parity/<slug>/pending-decisions.json` | 形の原本は `replace-strategy` の `references/autonomy.md` |
| スイートと部品 | `e2e.config.ts`・`tests/parity/`・`tests/<slug>/` | [`assets/e2e.config.template.ts`](assets/e2e.config.template.ts)・[`assets/sides.template.ts`](assets/sides.template.ts)・[`assets/test.template.ts`](assets/test.template.ts)・[`assets/runtime-errors-init.template.mjs`](assets/runtime-errors-init.template.mjs)・[`assets/runtime-errors-reporter.template.ts`](assets/runtime-errors-reporter.template.ts)・[`assets/strength.e2e.template.ts`](assets/strength.e2e.template.ts) |

- テキストの成果物（JSON・Markdown・操作中のエラーの記録）は Git に入れる。人による確認のために撮った画面は `artifacts` の設定に従い、デフォルトでは commit しない。`.e2e/` は commit しない。
  commit しない成果物が新側のディレクトリの中にあるなら、新側の `.gitignore` に入れる（入れないと `new.dirty` が `true` になる。上の verify の手順 1）。
- 新側の成果物は環境ごとに置く（`new/<target>/` の下）。環境を切り替えても、他の環境の記録を上書きしない。
- 同梱の判定のスクリプトは、プロジェクトへコピーせず、スキルのディレクトリの中から実行する（`gh skill update` で更新されるようにするため）。
  対象は [`scripts/runtime-errors.mjs`](scripts/runtime-errors.mjs)・[`scripts/strength-check.mjs`](scripts/strength-check.mjs)・
  [`scripts/overflow-check.mjs`](scripts/overflow-check.mjs)・[`scripts/convergence-check.mjs`](scripts/convergence-check.mjs)・[`scripts/source-version.mjs`](scripts/source-version.mjs) である。
  `runtime-errors.mjs` は `parity-suite` のものと、`source-version.mjs` は `parity-replace`・`parity-diff` のものと同じ中身である。
  `scripts/lib/pending-state.mjs`（保留の判定）は `replace-strategy` のものと同じ中身である。

## 姉妹スキルとの連携

- 依存の順: 全体の依存の順は、`replace-strategy` の `SKILL.md`「姉妹スキルと依存順」で定義する（ここへ転記しない）。
  `style_policy: free` では、`spec-parity suite` → `parity-replace` → `spec-parity verify` の順で、`verify` は `parity-replace` と行き来する。
- `parity-replace` に渡すもの: スイート（`metadata.json` の `suite`）と、差し戻しの入力の `verify.md`。新側の green（`replace-metadata.json` の `suite.new_green`）と反復の回数（`loop.*`）は、`parity-replace` が記録する。
  スイートの起動のコマンドなど、`parity-replace` の側の分岐は `parity-replace` が定める（`parity-replace` の `references/style-free.md`）。`replace-metadata.json` が無い間は、`verify` は止まって案内する。
- `parity-suite`（`suite` の代わり）と `parity-diff`（`verify` の代わり）は、`style_policy: free` の画面のある機能では止まり、このスキルを案内する。横断 API とバッチは、`parity-suite` と `parity-diff` が扱う。
  `parity-component` は、`free` ではモードに関わらず止まる。部品は、機能ごとに `parity-replace` が作る。
- `golden-dataset`: スイートが前提にするデータを投入する。データの扱いは `parity-suite` の `references/data-discipline.md` に従う。
- `issue-create` に任せるもの: target の `on_diff` のドキュメントが「起票して止まる」運用を指示するとき、差し戻す代わりに要約を渡して起票する（`gh` で直接起票しない）。
- `replace-strategy status` が、`metadata.json`・`verify-metadata.json`・`verify.md` を読んで今の状態を導く。対応範囲（見た目の一致と性能を確かめないこと）の原本は、`replace-strategy` の `references/scope.md` である。

## 利用者への確認

このスキルが利用者に確認する段・承認を得る段・選んでもらう段は、すべて [`references/user-confirmation.md`](references/user-confirmation.md) の手順で行う。
確認のツールを使えないエージェントでは、判断の材料と選択肢を本文に出して返事を待ち、返事を受け取る前に、その返事で決まる操作へ進まない。
