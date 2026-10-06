# 部品を直した後の一括の再検証（`--component-change`）

画面より先に作った共通の部品を後から直したとき（`parity-component` の `references/amend.md`）に、その部品を使う機能の検証を、影響する組だけやり直す手順である。
入力は変更宣言 `.replace/components/<slug>/changes/<change-id>.json` である（形式の原本は `parity-component` の `assets/component-change-template.json`）。

要点は、何をやり直さないかである。部品を 1 行直しても現行は変わっていないので、正解の基準（現側のベースライン）はそのまま使える。
変わりうるのは、新側のうち、影響するインスタンスが画面に含まれる組だけである。その組も、満たすべき条件は変更宣言から決まる。

## 使う場面と使わない場面

- この手順を使うのは、変更宣言があり、`catalog_verification` の 2 つの値（範囲の外は差分ゼロ、範囲の中は現行と一致）がどちらも `true` のときだけである。
  宣言が無いときや照合が済んでいないときは、部品に触れた反復として、`loop.changed_scope.global: true` で各機能の `parity-diff` を実行する
- 新側の作業ツリーが clean で、動いている新側が宣言の `commits.after` であること。続けて当てた宣言があるなら、最後の宣言の `after` である。
  target の `commit_check` も、この SHA と照合する（固定の `url` か `url_command` かに関わらない）。
  `new.commit` は改修前の記録のまま残るので、そちらと照合すると止まる。食い違いが正当かどうかは、手順 5 の鮮度の検査が判定する
- 影響する機能は、1 つのセッションでまとめて処理する。機能ごとに `parity-diff` のセッションを開き直さない。
  ただし、機能は 1 つずつ順に処理し、並行させない。「1 回の実行につき 1 つの機能」の例外は、この一括の再検証だけである

## 手順

番号の順に進める。前の手順の出力が、次の手順の入力になる。

1. 影響を導く。インストール済みの `parity-suite` から、次のように実行する（コピーしない）。

   ```bash
   node <parity-suite の skill>/scripts/component-impact.mjs --change .replace/components/<slug>/changes/<change-id>.json \
     --component-metadata .replace/components/<slug>/metadata.json --parity-root .replace/parity \
     --out .replace/components/<slug>/changes/<change-id>.impact.json
   ```

   機能ごとに、`affected`（影響する組の一覧）、`unaffected`（理由つき）、`undeterminable` が出る。
   exit 2 は変更宣言か入力の不備なので、直すまで先に進まない。読み違えた宣言から導いた「影響なし」は、撮り直しを警告なしに省かせる。
   exit 1（判定できない機能がある）なら、その機能だけ、すべての組を通常の手順で処理する（下の「機械判定で通らない組がある機能」と同じ）。判定できないことを、影響なしとして扱わない
2. 影響の無い機能は、撮り直しも `parity-diff` もしない。選んだ target の `new/<target>/evidence-carry.json` の `carries` に、`{"change": "<変更宣言のパス>", "amend_verify": null}` を追記する。
   様式の原本は `parity-suite` の `assets/evidence-carry-template.json` である。
   理由（どのページも影響するインスタンスを持たない、その状態を撮っていない、など）は、出力のまま報告に載せる。
   追記した持ち越しも、手順 5 の鮮度の検査（`--carry-to` 付き）で確かめる。影響なしと判定しても、追記した記録が不正でないことは保証されない
3. 影響する機能の新側を、影響する組だけ撮り直す。
   - 現側は撮り直さない。比べる相手は、現側の `baseline/` の同じ組のままである
   - 撮る前に、影響する組の前回の新側の採取物（`baseline-new/<page>/<state>/<viewport>/`）を、`new/<target>/pre-change/<change-id>/<page>/<state>/<viewport>/` にコピーする。これが手順 4 の「改修前の新側」になる。
     コピー先はこのパスに固定する。鮮度の検査は、この置き場所で入力の役割を確かめる。
     コピーは消さない。鮮度の検査は、判定の記録にある画像の sha256 を今のファイルと突き合わせるので、消すと持ち越しが失敗する。
     前回の採取物が無い組（`artifacts: local` で消えたなど）は、機械で判定できない（下の「機械判定で通らない組がある機能」）
   - 撮影条件、条件の一致の事前の検証、URL の設定は、通常の実行と同じである（[`capture-new.md`](capture-new.md)）。
     撮るのは影響する組だけで、影響しない組の採取物と前回の分類はそのまま残す
   - 撮る組は、新側の採取スペック（`assets/capture-new.spec.template.ts` から作ったもの）の baseline のパスに、`PARITY_CAPTURE_PAIRS` で渡す。値は、影響する組の `page|state|viewport` をカンマで区切ったものである。
     影響する組の一覧は、手順 1 の出力から機械的に作る（手で書き写さない）
   - 自己ノイズも、影響する組だけ測り直す（失効する範囲の判定は、[`capture-new.md`](capture-new.md)「失効条件」の部品の改修の行）。チェックの判定は、すべての組で毎回行う
   - `region_known: false` の組（ページは部品を使うが、どのインスタンスかが部品の記録に無い）は、領域が決まらないので機械で判定できない（同上）
4. 撮り直した組を、機械で判定する。対象は `kind: align-to-current` の宣言に限る。
   `new-appearance` は、満たすべき条件が宣言から決まらないので、影響する組を機械で判定できない。
   - 領域は、撮り直した新側の組の `traits.json` で、影響するインスタンスの `locator` が指す論理名の `rect` を、宣言の `margin_px` だけ広げたものである。
     論理名が `traits.json` に無いときや、`rect` の面積が 0 のときは、領域を推測で決めない。その組は機械で判定できない
   - インストール済みのこのスキル（`parity-diff`）の [`../scripts/amend-verify.mjs`](../scripts/amend-verify.mjs) に、組ごとに、改修前の新側・撮り直した新側・現側のスクリーンショットと、領域を渡す。
     オプションは `--pair`・`--prev-new`・`--new`・`--current`・`--region`・`--margin` で、複数の組は `--pairs <json>` で渡す。`--change-id` と `--out <記録>` で記録を残す。
     `--region` には `traits.json` の `rect` を広げずにそのまま渡し、`--margin` には宣言の `margin_px` を渡す。画像の置き場所は、役割ごとに決まっている。
     - `--new`: 撮り直した組の `baseline-new/<page>/<state>/<viewport>/screenshot.png`
     - `--prev-new`: 手順 3 のコピーの `pre-change/<change-id>/<page>/<state>/<viewport>/screenshot.png`
     - `--current`: 現側の基準（`.replace/parity/<slug>/baseline/` の下）の同じ組。基準の下のパスを `/` と `.` で区切った語に、その組の page・state・viewport がこの順で現れること。
       `list/hover/desktop/screenshot.png` と `list.hover.desktop.png` のどちらでもよい

     鮮度の検査は、各入力がこの置き場所を指すことと、記録の計数が合格の条件（外の不一致が 0、中の不一致が増えていない）と食い違わないことを確かめる。
     画像のハッシュはバイトを確かめるだけで、役割も判定も確かめない。そのため、取り違えた記録や書き換えた記録では持ち越さない。
     鮮度の検査は、記録の `margin` が `margin_px` と一致することと、`declared_regions` が隣の `traits.json` の `rect` と一致することも確かめる。
     判定を弱めた記録（大きな margin、画面全体の領域）では持ち越さない。
     プロジェクトのルート（`.replace` の親）を作業ディレクトリにして実行する。記録は渡したパスのまま残り、鮮度の検査はそれをプロジェクトのルートから解決する。記録は `new/<target>/` の下に置く
   - 合格の組では、トリアージと承認を省き、前回の分類を組・領域・原因で引き継ぐ。
     合格とは、領域の外は改修前と画素がすべて一致し、領域の中で現行との不一致の画素が増えていないことである。
     検出と正規化（[`detect.md`](detect.md)・[`normalize.md`](normalize.md)）は決定論的なので、通常どおり実行する。前回の分類に対応する候補が無いものだけを、トリアージに回す。
     領域の中は不一致の件数で判定していて、位置までは保証しないためである
   - 不合格の組（寸法が変わった、外に差が出た、中の差が増えた）は、機械の判定を通らない。変更宣言の範囲が狭すぎた疑いがあるので、`parity-component` にも報告する
   - exit 2（入力の不備、`pngjs` が無い）は判定していないので、合格として扱わない。`pngjs` を導入してよいかは、ユーザーに確認する
5. 持ち越しを記録し、鮮度の検査で確かめる。影響する機能の `evidence-carry.json` に `{"change": "<変更宣言のパス>", "amend_verify": "<手順 4 の記録のパス>"}` を追記する。
   `diff-metadata.json` の `new.commit` は書き換えず、改修前の記録のまま残す。
   持ち越しは「記録の版から今の版へ」の向きで、変更宣言の `commits.before` から `after` をたどって判定する。
   記録を `after` に書き換えると向きが逆になり、正しく宣言した改修まで、説明できない差分として失敗する。
   撮った新側の SHA（`commits.after`）は、`diff.md` の前提確認の表に書く（下の「記録」）。そのうえで、機能ごとに次の検査を通す。

   ```bash
   # 先の検査の失敗を後の検査の成功で上書きしない（非 0 をそのまま返す）。対話シェルを閉じないよう ( ) で囲む
   (
     # 検証先の版は変更宣言から機械的に取る（表示から書き写さない）。続けて当てた宣言があるなら最後の宣言を渡す
     AFTER=$(node -e 'const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); process.stdout.write(String(c.commits?.after ?? ""))' \
       .replace/components/<slug>/changes/<change-id>.json)
     [ -n "$AFTER" ] || { echo "変更宣言の commits.after が読めない" >&2; exit 2; }
     node <parity-suite の skill>/scripts/artifact-health-check.mjs --metadata .replace/parity/<slug>/metadata.json --target <target> --stage diff \
       --new-repo <新側リポジトリ> --carry-to "$AFTER" || exit $?
     # component_coverage.declared: true の機能だけ
     node <parity-suite の skill>/scripts/component-comparison-check.mjs --coverage <網羅表> --comparison <突き合わせ表> --metadata <現側 metadata.json> \
       --replace-metadata <new/<target>/replace-metadata.json> --target <target> --new-repo <新側リポジトリ> --carry-to "$AFTER"
   )
   ```

   - `component-comparison-check.mjs` を実行するのは、`component_coverage.declared: true` の機能だけである。
     宣言の無い機能には突き合わせ表が無いので、`--carry-to` は `artifact-health-check.mjs` だけが判定する
   - `.replace` の場所は、デフォルトでは次のように決まる。`artifact-health-check.mjs` は `<root>/.replace` を使う。
     `component-comparison-check.mjs` は `--replace-metadata` のパスに含まれる `.replace` を使い、`evidence-carry.json` は `replace-metadata.json` と同じディレクトリから読む。
     デフォルトから外れる配置のときだけ、`--replace-root` と `--evidence-carry` を渡す（`--evidence-carry` は `component-comparison-check.mjs` だけ）
   - 検査は、SHA の食い違いを、次の 2 つが成り立つときだけ通す。
     そのページの描画の入力（`replace-metadata.json` の `new.render_inputs`）の差分が、持ち越した変更宣言の `files` に収まること。影響する組が、合格の記録で覆われていること
   - `--carry-to` を省かない。一括の再検証の直後は、`replace-metadata.json` の `new.commit` も改修前の版のままで、記録と一致する。
     そのため `--carry-to` が無いと持ち越しは評価されず、`evidence-carry.json` が無い・不正・宣言で説明できない差分がある状態でも通ってしまう。
     `--carry-to` を渡すと、記録の版からその版への持ち越しを、SHA の一致に関わらず判定する（記録の版が `none` なら判定できないので失敗する）
   - 失敗したら、持ち越しは成り立っていない。描画の入力が無い機能や、宣言の外のファイルが変わっている機能は、同じ target の `parity-replace` からやり直す。
     収束の判定は、通常どおり [`convergence.md`](convergence.md) に従う

### 機械判定で通らない組がある機能

不合格・領域が分からない・前回の採取物が無い・`new-appearance` の組が 1 つでもある機能は、持ち越しが成り立たない。鮮度の検査は、影響する組がすべて合格の記録で覆われていることを求めるからである。
その機能は `evidence-carry.json` に追記しない。同じ target の `parity-replace` で新側の green を記録し直してから（`new.commit` が進む）、通常の `parity-diff` でその組をトリアージする（[`triage.md`](triage.md)）。

## 記録

- `diff.md` の前提確認の表に、次のことを書く。この実行が一括の再検証であること、変更宣言のパス、撮った新側の SHA（`commits.after`）、撮り直した組と引き継いだ組の別
- `noise_measurement.remeasure_reason` には、部品の改修による失効であることと、変更宣言の id を書く
- 影響なしとした機能、判定できずにすべての組を処理した機能、持ち越しが失敗した機能を、機能ごとに報告する（警告なしに通さない）
