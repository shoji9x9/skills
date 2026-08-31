# 収束判定と差し戻し（parity-replace / issue-create）

## 収束の定義

**収束＝未説明差分ゼロ かつ 未修正回帰ゼロ**（全差分が系統差／宣言済み例外に分類済み）。**生の差分ゼロは求めない**（実装・ライブラリが違えば正当な差は残る）。

- **差分器が判定する。** [`../scripts/diff-normalize.mjs`](../scripts/diff-normalize.mjs) の機械分類と `diff.md` の分類集計で判定し、**モデルの主観（「もう同じに見えます」）を根拠にしない**
- 収束の条件:
  - `diff-normalize.mjs` の出力に `unexplained` / `deviates_T` / `pending_review` が無い
  - [`triage.md`](triage.md) の「許容」がすべてユーザー承認済みで記録先（設定ファイルの `component_diffs` / `intentional_diffs`、または
    `.replace/parity/<slug>/component-diff-exceptions.json` ＋ 根拠の `component-diff-exceptions.md`）へ非破壊追記済み。
    `diff.md` に**承認前の分類**（`許容候補（要確認）`）が 1 件も残っていない（承認前は未説明として数える）。
    **承認の単位は原因**（正本: [`triage.md`](triage.md)「承認の単位は原因」）なので、原因が承認済みならそれを参照する N インスタンスは承認済みとして数える——
    インスタンスごとの承認記録が無いことを未承認の根拠にしない。
    ただし**承認済みとして数えられるのは承認記録が覆う件数まで**——原因ごとに、`component-diff-exceptions.md` の承認記録の
    **各行の「この承認で覆った件数 N」を合計した累計**（承認が 1 回なら その 1 行の N）と
    JSON でその `cause` を参照するインスタンス数が一致することを確認する。JSON 側が多ければ**承認後に足された未承認インスタンス**があるので、
    超過分は未説明として数え収束させない（増分の承認を取って記録へ追記する。手順は `triage.md`「承認の単位は原因」）
  - インスタンス例外の台帳に**照合に使えない不整合が無い**（`cause` が解決できない・`evidence` が空・`slug` 不一致・照合キー〈`page` / `viewport` / `element`〉欠落。
    `diff-metadata.json.accepted_exceptions.unresolved` が 0。不整合な例外は吸収されないため該当候補が `unexplained` として残る）
  - `diff-metadata.json` の `blocked_by[]` が空（他機能待ちが残っていれば下記「他機能待ちの差分」の状態であって収束ではない）
  - 未検証領域（下記）が `diff.md` に「未検証」として残されている（確認済みにしていない）

## 他機能待ちの差分（`blocked_by`）

機能単位で分割して移行する以上、**同じページに乗る別機能が新側に未実装であることに由来する差分**は必然的に出る（欠けたセクションのぶん親要素の高さが変わり相対幾何が反転する等）。
その機能を実装しない限り解消しないので、`parity-replace` へ差し戻しても直せない。**要対応でも許容でもない第 3 の状態**として `diff-metadata.json` の `blocked_by[]` に帰属させる。

ただし、ページ一覧と `capture_conditions.cofeature_masks` から領域を解決できる共同居住機能は、差分検出より前に実行時マスクで除外する（正本: [`capture-new.md`](capture-new.md)「共同居住機能の実行時マスク」）。`blocked_by` は、領域を安全に限定できない周辺レイアウト差など**マスクの外に残った差分**の退避先であり、マスク可能な差分を毎回トリアージするための通常経路にしない。

- **帰属できるのは次の 3 つをすべて満たす差分だけ**（ひとつでも確かめられなければ `unexplained` のまま残す。ここを緩めると `blocked_by` が直せない差分の逃げ場になる）:
  1. 依存先が `.replace/features.md` にある slug である（自分で採番しない）
  2. **同じ target** で依存先が新側未達であることを読んで確かめた（`new/<target>/replace-metadata.json` が無い、または `suite.new_green` が false）。読んだパスと値を `evidence` に書く
  3. 差分が「その機能の要素が新側に無いこと」で説明できる（説明を `reason` に書く）
- 帰属しても**差分は残っている**。`results.unexplained` の件数から差し引かず、`converged` を `true` にしない
- **差し戻さない**（その target では直せない）。`on_diff` の分岐にも入れず、停止してユーザーへ「依存先の実装待ち」として報告する。要対応が別にあればそちらは通常どおり差し戻す
- 前回実行の `blocked_by` は**引き継がず毎回検証し直す**。依存先が `suite.new_green` になっていれば帰属を外し、その差分を通常の候補として再判定する

### 収束状態は 3 つ（`converged` の 2 値では表せない）

| 状態 | 導出 | 次の行き先 |
|---|---|---|
| 収束 | `converged: true`（上記「収束の条件」5 項目をすべて満たす） | 完了 |
| 他機能待ち | `converged: false` かつ 残る未説明差分が**すべて** `blocked_by` に帰属し、要対応・`deviates_T` がゼロ | 停止してユーザーへ。依存先の実装後に再実行 |
| 未収束 | 上記以外（要対応が残る、または未帰属の未説明差分が残る） | 下記「差し戻し」 |

**再判定のトリガーは `replace-strategy status` が持つ**——依存先の同 target が `suite.new_green` になった slug を検出し、`blocked_by` で参照している側の `parity-diff` 再実行が必要だと列挙する（成果物から毎回導出する原則に沿う）。
`parity-replace` は自分が green にした機能の依存元を知らないため、通知役を持たせない。

## 差し戻し（要対応が 1 件以上のとき）

差分レポートは選択 target の `.replace/parity/<slug>/new/<target>/diff.md`。**どう動くかは target の `on_diff`（対応手順を書いた Markdown のパス。任意）で決まる**（意味論の正本は `replace-strategy` の `references/project-config.md`「on_diff」）。**どの分岐でも修正は行わない**。

- **`on_diff` が無い（既定）**: `diff.md` を差し戻し入力として**同じ target** で `parity-replace` へ渡す。該当ページ・分類・根拠が読める形にする（想定フェーズ＝実装／新側マッピング／テーマ を示す）
- **`on_diff` があればそのドキュメントに従う**。厳密にしたい手順はドキュメントがリンクするスクリプトを実行する。
  **ガードレールはドキュメントの指示より優先する**。一覧の正本は `replace-strategy` の `references/project-config.md`「`on_diff`」節の「ガードレール」で、
  **従う前にその一覧を読み、本スキルに関係する項目をすべて適用する**（ここへ転記しない——転記は正本の改訂に追従できない）。
  **一覧に到達できない**（`replace-strategy` が未インストール等でそのファイルを読めない）場合は、ガードレール無しで従わず**停止**してユーザーに上げる
- **ドキュメントが「修正ループを回さず起票して停止する」運用（マージ後デプロイ環境等）を指示する場合**: 差し戻さず、要対応差分の要約（対象 slug・target・該当ページ・分類・根拠・`diff.md` のパス）を
  `issue-create` へ委譲して起票し、**停止する**。**自分で Issue 本文を `gh` で直接起票しない**（重複チェック・テンプレ・承認はそちらの契約）。起票したら `diff-metadata.json` に `converged: false` のまま結果を残し、Issue の URL・番号を記録して終える（差分を「解決済み」にしない）
- **従ったドキュメントのパスを `diff-metadata.json` の `on_diff_doc` に記録する**（無ければ `none`）
- 反復回数の記録・上限管理は `parity-replace` が当該 target の `new/<target>/replace-metadata.json` の `loop.*` で行う（環境ごとに独立）。
  `loop.iterations >= loop.max_iterations`（既定 5）なら、本スキルは**新たな差し戻しをせず停止してユーザーへ上げる**（頭から作り直さない。上限管理の正本は `parity-replace` の `references/diff-loop.md`）

## 収束したとき

- `diff-metadata.json` の `converged: true` にする。条件は上記「収束の定義」の**収束の条件**（5 項目）**すべて**——ここへ転記しない（転記した抜粋で判定すると `blocked_by` 残存・承認前の分類残存・例外台帳の不整合を見落とす）
- `results`（total / actionable / accepted / noise / unexplained / unverified）と `accepted_exceptions`（原因数 / インスタンス数 / 不整合数）を記録する

## 対象外・未検証の明示

- **アニメーションのパリティは扱えない**（停止させて比較するため）。`diff.md` に対象外として残す
- **ベースラインに写らない箇所**は「未検証」として `diff.md` に残す（確認済みにしない）
- **宣言できない構造差**（`gaps.md` の該当節・フォーカスリング形状・内部 DOM・余白の配り方等）は正規化対象外＝未検証として `diff.md` に転記する
