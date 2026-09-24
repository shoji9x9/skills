# 部品改修後の一括再検証（`--component-change`）

画面より先に作った共通部品を後から直したとき（`parity-component` の `references/amend.md`）、その部品を使う機能の検証を**影響する組だけ**やり直す手順。
入力は変更宣言 `.replace/components/<slug>/changes/<change-id>.json`（形式の正本は `parity-component` の `assets/component-change-template.json`）。

**何をやり直さないか**が要点である。部品を 1 行直しても、現行は変わっていないので正解の基準（現側ベースライン）はそのまま使える。
変わりうるのは新側の、影響するインスタンスが写る組だけで、その組も変更宣言から満たすべき条件が決まる。

## 使う場面と使わない場面

- **変更宣言があり、`catalog_verification` の 2 値（範囲の外は差分ゼロ・範囲の中は現行と一致）がどちらも `true`** のときだけこの手順を使う。
  宣言が無い・照合が済んでいないなら従来どおり、部品に触れた反復として `loop.changed_scope.global: true` で各機能の `parity-diff` を回す
- **新側の作業ツリーが clean で、動いている新側が宣言の `commits.after`（続けて当てた宣言があるなら最後の `after`）である**こと。
  `url_command` の target の `commit_check` もこの SHA と照合する（`new.commit` は改修前の記録のまま残るので、そちらと照合すると止まる。食い違いの正当性は手順 5 の鮮度検査が判定する）
- **1 セッションで影響する機能をまとめて回す。** 機能ごとに `parity-diff` のセッションを開き直さない。ただし機能は 1 つずつ順に処理し、並行させない（「1 回の実行につき 1 機能」の例外はこの一括再検証だけ）

## 手順

番号順に進める。前の手順の出力が次の入力になる。

1. **影響を導く。** インストール済みの `parity-suite` から実行する（コピーしない）:

   ```bash
   node <parity-suite の skill>/scripts/component-impact.mjs --change .replace/components/<slug>/changes/<change-id>.json \
     --component-metadata .replace/components/<slug>/metadata.json --parity-root .replace/parity \
     --out .replace/components/<slug>/changes/<change-id>.impact.json
   ```

   機能ごとに `affected`（影響する組の一覧）／`unaffected`（理由つき）／`undeterminable` が出る。
   **exit 2 は変更宣言か入力の不備**なので、直すまで先へ進まない（読み違えた宣言から導いた「影響なし」は撮り直しを黙って省かせる）。
   **exit 1（判定不能の機能がある）は、その機能だけ全組を従来の経路で回す**（下記「機械判定で通らない組がある機能」と同じ）——判定できないことを影響なしに倒さない
2. **影響なしの機能は撮り直しも `parity-diff` も回さない。** 選択 target の `new/<target>/evidence-carry.json` に
   `{"change": "<変更宣言のパス>", "amend_verify": null}` を `carries` へ追記する（様式の正本は `parity-suite` の `assets/evidence-carry-template.json`）。
   理由（どのページも影響インスタンスを持たない・その状態を撮っていない等）は出力のまま報告に載せる
3. **影響する機能の新側を、影響する組だけ撮り直す。**
   - **現側は撮り直さない。** 比較の相手は現側 `baseline/` の同じ組のまま
   - **撮る前に、影響する組の前回の新側採取物（`baseline-new/<page>/<state>/<viewport>/`）を `new/<target>/` の下の別ディレクトリへ写す。** 手順 4 の「改修前の新側」になる。
     **写しは消さない**——鮮度検査は判定記録にある画像の sha256 を今のファイルと突き合わせるので、消すと持ち越しが落ちる。
     前回の採取物が無い（`artifacts: local` で消えた等）組は機械判定できない（下記「機械判定で通らない組がある機能」）
   - 撮影条件・条件一致の先行検証・URL の配線は通常の実行と同じ（[`capture-new.md`](capture-new.md)）。撮るのは影響する組だけで、影響しない組の採取物と前回の分類はそのまま残す
   - 撮る組は新側採取スペック（`assets/capture-new.spec.template.ts` から作ったもの）の baseline パスへ `PARITY_CAPTURE_PAIRS`（影響する組の `page|state|viewport` をカンマ区切り）で渡す。
     影響する組の一覧は手順 1 の出力から機械的に作る（書き写さない）
   - **自己ノイズも影響する組だけ測り直す**（失効範囲の判定は [`capture-new.md`](capture-new.md)「失効条件」の部品改修の行）。ゲート判定は全組で毎回行う
   - `region_known: false` の組（ページが部品を使うが、どのインスタンスかが部品の記録に無い）は領域が決まらないので機械判定できない（同上）
4. **撮り直した組を機械で判定する。** `kind: align-to-current` の宣言に限る（`new-appearance` は満たすべき条件が宣言から決まらないので、影響する組は機械判定できない）。
   - **領域**は、撮り直した新側の組の `traits.json` で、影響インスタンスの `locator` が指す論理名の `rect` を宣言の `margin_px` だけ広げたもの。
     論理名が `traits.json` に無い・`rect` が面積 0 なら領域を推測で置かず、その組は機械判定できない
   - インストール済みの本スキルの [`../scripts/amend-verify.mjs`](../scripts/amend-verify.mjs) に、組ごとに改修前の新側・撮り直した新側・現側のスクリーンショットと領域を渡す
     （`--pair` / `--prev-new` / `--new` / `--current` / `--region` / `--margin`、複数の組は `--pairs <json>`。`--change-id` と `--out <記録>` で記録を残す）。
     `--region` には `traits.json` の `rect` を**広げずにそのまま**、`--margin` には宣言の `margin_px` を渡し、`--new` には撮り直した組の
     `baseline-new/<page>/<state>/<viewport>/screenshot.png` をそのまま渡す（写した先のパスにしない）。
     鮮度検査は記録の `margin` が `margin_px` と、`declared_regions` がその隣の `traits.json` の `rect` と一致することを確かめ、
     判定を弱めた記録（大きな margin・画面全体の領域）では持ち越さない。
     **プロジェクトルート（`.replace` の親）を作業ディレクトリにして実行する**（記録は渡したパスのまま残り、鮮度検査はそれをプロジェクトルートから解決する）。記録は `new/<target>/` の下に置く
   - **合格の組**（領域の外は改修前と画素が完全に一致し、領域の中の現行との不一致画素が増えていない）は、トリアージ・承認を省き、**前回の分類を組・領域・原因で引き継ぐ**。
     検出と正規化（[`detect.md`](detect.md) / [`normalize.md`](normalize.md)）は決定論的なので通常どおり回し、前回の分類に対応が無い候補だけをトリアージへ回す
     （領域の中は不一致の件数で判定しており、位置までは保証しないため）
   - **不合格の組**（寸法が変わった・外に差が出た・中の差が増えた）は機械判定で通らない。変更宣言の範囲が過小だった疑いとして `parity-component` へも報告する
   - exit 2（入力の不備・`pngjs` が無い）は判定していないので合格に倒さない。`pngjs` の導入はユーザーに確認する
5. **持ち越しを記録し、鮮度検査で確かめる。** 影響する機能の `evidence-carry.json` に `{"change": "<変更宣言のパス>", "amend_verify": "<手順 4 の記録のパス>"}` を追記し、
   `diff-metadata.json` の `new.commit` は**書き換えない**（改修前の記録のまま残す）。持ち越しは「記録の版 → 今の版」の向きで、
   変更宣言の `commits.before → after` をたどって判定するため、記録を `after` に書き換えると向きが逆になり、正しく宣言した改修まで説明できない差分として落ちる。
   撮った新側の SHA（`commits.after`）は `diff.md` の前提確認表に書く（下記「記録」）。そのうえで機能ごとに:

   ```bash
   node <parity-suite の skill>/scripts/artifact-health-check.mjs --metadata .replace/parity/<slug>/metadata.json --target <target> --stage diff --new-repo <新側リポジトリ>
   node <parity-suite の skill>/scripts/component-comparison-check.mjs --coverage <被覆表> --comparison <突き合わせ表> --metadata <現側 metadata.json> \
     --replace-metadata <new/<target>/replace-metadata.json> --target <target> --new-repo <新側リポジトリ>
   ```

   を通す（`component-comparison-check.mjs` は `component_coverage.declared: true` の機能だけ。
   `.replace` の場所は既定で `artifact-health-check.mjs` は `<root>/.replace`、`component-comparison-check.mjs` は `--replace-metadata` のパス中の `.replace` から決まり、
   `evidence-carry.json` は `replace-metadata.json` と同じディレクトリから読む——
   既定から外れる配置でだけ `--replace-root` / `--evidence-carry`〈後者は `component-comparison-check.mjs` のみ〉を渡す）。検査は SHA の食い違いを、そのページの描画入力（`replace-metadata.json` の `new.render_inputs`）の差分が
   持ち越した変更宣言の `files` に収まり、影響する組が合格の記録で覆われているときだけ通す。
   `replace-metadata.json` の `new.commit` がまだ改修前の版なら SHA は一致して持ち越しは評価されない——
   持ち越しが効くのは、その後 `new.commit` が改修後の版へ進んだとき（`evidence-carry.json` が改修の分を説明する）
   **落ちたら持ち越しは成立していない**——描画入力が無い・宣言の外のファイルが変わっている機能は、同じ target の `parity-replace` から従来どおり回し直す。
   収束の判定は通常どおり [`convergence.md`](convergence.md) に従う

### 機械判定で通らない組がある機能

不合格・領域不明・前回の採取物なし・`new-appearance` の組が 1 つでもある機能は、持ち越しが成立しない（鮮度検査は影響する組が全部合格の記録で覆われていることを求める）。
その機能は `evidence-carry.json` へ追記せず、同じ target の `parity-replace` で新側 green を記録し直してから（`new.commit` が進む）、通常の `parity-diff` でその組をトリアージする（[`triage.md`](triage.md)）

## 記録

- `diff.md` の前提確認表に、この実行が一括再検証であること・変更宣言のパス・撮った新側の SHA（`commits.after`）・撮り直した組と引き継いだ組の別を書く
- `noise_measurement.remeasure_reason` には部品改修による失効であることと変更宣言の id を書く
- 影響なしとした機能・判定不能で全組に倒した機能・持ち越しが落ちた機能を、機能ごとに報告する（黙って通さない）
