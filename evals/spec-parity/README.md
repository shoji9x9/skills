# spec-parity の回帰テスト

テストケースは [`evals.json`](evals.json)。実行・採点・集計の共通手順は `docs/skill-development.md`「回帰テストを実行する」に従う。

## 前提

使い捨てのプロジェクトには、現行アプリ・新側・ブラウザ・e2e の実体（`node_modules`）が無い。
そのため、この eval が対象にするのは次の 2 つである。

- 前提が欠けた状態での停止（`style_policy` が `free` でない・e2e が入っていない・設定と features.md が無い・データセットが無い・`suite` の成果物が無い・新側の green が無い・横断 API の slug）
- 記録がそろった状態での収束の判定（承認の記録が無いと収束しない・横のはみ出しが残ると差し戻す）。同梱の `convergence-check.mjs` はブラウザも e2e も使わないので、使い捨てのプロジェクトでも実行できる

`package.json` に e2e を書いた fixture でも、`npx e2e --version` は通らない（実体を入れていない）。
前提の判定は、足りないものを依存の順にすべて案内する取り決めなので、e2e の実体が無いことで止まっても、ほかの欠けた前提を挙げているかで採点する。

## fixture

fixture の基は `evals/parity-diff/fixtures/style-free` の設定・features.md・データセットの記録である（機能 `order-list`・横断 API `user`・現行の `current-test`・新側の `local-dev`）。
同梱のツールが書く値（`metadata.json` の `strength` と `runtime_errors`、`verify-metadata.json` の `overflow` と `runtime_errors`）は、それぞれのツールを実行した出力である。
e2e の結果（`suite-report.json`・`strength-report.json`）と操作中のエラーの記録は、e2e 0.23.0 の結果の JSON（`schemaVersion: report-1`）と雛形の reporter が書く形に合わせて書いた。

| fixture | 状態 | 使う eval |
| --- | --- | --- |
| `reproduce` | 設定に `style_policy` が無い（`reproduce` として読む） | 1 |
| `no-e2e` | `free`。`package.json` に `@playwright/test` だけがあり、e2e と `@e2e-dev/web` が無い | 2 |
| `no-dataset` | `free`。e2e はあるが、`.replace/dataset/metadata.json` が無い | 4 |
| `verify-no-suite` | `free`。フェーズ B まであるが、`.replace/parity/order-list/` が無い | 5・7 |
| `verify-not-green` | `suite` を終えた記録はあるが、`replace-metadata.json` の `suite.new_green` が `false` | 6 |
| `verify-unapproved` | 記録はそろい、受け入れるデザインの指摘と人による確認に承認の記録が無い（雛形の値のまま） | 8 |
| `verify-overflow` | 記録と承認はそろい、`/orders` の幅 375 で新側が横にはみ出す | 9 |

`verify-unapproved` と `verify-overflow` は、ルートの `setup.sh` で新側のリポジトリ（設定の `new.repo: ./new-app`）を git で作る。
記録の `commit` の仮の値（`abc1234def5678`）はその HEAD の完全な SHA に、`tree` の仮の値（`def5678abc1234`）は HEAD のツリーのハッシュに置き換える。
`.replace/` は `new-app` の外にあるので、`source-version.mjs` が出す `tree` は HEAD のツリーのハッシュと同じになる。
verify の手順 7 は、収束を判定する直前に新側のバージョンを取得し直すので、新側のリポジトリが無いと判定の記録まで進めない。

fixture には、止まる理由・案内先・収束するかの結論を書かない。書くと baseline がそれを読んで assertion を満たす。

## eval ごとの観点

- eval 1 は、`style_policy` のキーが無いときに `free` と読まないことを見る。キーが無い設定は、`style_policy` を入れる前に作ったプロジェクトで実際に起きる
- eval 2 は、e2e を入れずに `@playwright/test` で代わりに書き始めないことと、「前提」に書いた外部へ送るデータと Playwright が 2 組になることを、導入の前に示すかを見る
- eval 3 は fixture を持たない。設定と features.md が無いときに、slug を自分で採番しないことを見る
- eval 7 は、横断 API の slug を `style_policy` の値に関わらず `parity-suite` と `parity-diff` へ戻すことを見る。eval 5 と同じ fixture なので、止まる理由が slug の種類であることを区別できる
- eval 8 と 9 は、`replace-strategy` の `pending-decisions-check.mjs` と `append-only-check.mjs` を前提の判定と収束の報告で使うので、`requires_skills` に `replace-strategy` を置く。
  `verify` の前提でデータセットのバージョンを確かめる `parity-diff` の `references/preflight.md` も読むので、`requires_skills` に `parity-diff` も置く。
  どちらも、モデルの判断を承認の代わりにしないことと、`converged` を手で書かないことを見る
  eval 9 は、収束しないときに `verify.md` を書くところまで進む
- `replace-strategy` の eval 43 は、`verify-overflow` と同じ中身の fixture（`evals/replace-strategy/fixtures/status-style-free`）を使う。
  `status` が `free` の機能を `verify-metadata.json` から導くかを見る
