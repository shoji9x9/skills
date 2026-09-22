# parity-diff の回帰テスト

> **この手順は shoji9x9/skills リポジトリでの開発専用。** ハーネス（`scripts/run-skill-eval.sh`）と
> 集計器（`scripts/build-skill-eval-benchmark.js`）はこのリポジトリのツールで配布物ではないため、
> スキルをインストールした下流リポジトリには存在しない。

テストケースは [`evals.json`](evals.json)。実行・採点・集計の共通手順は `docs/skill-development.md`「回帰テストを実行する」に従う。

## 前提

実アプリ・DB・ブラウザ（Playwright）・パリティスイート・新側 green の実装を要する全フロー（前提確認 〜 新側ベースライン取得 〜 3 経路の検出 〜 正規化 〜 トリアージ 〜 収束判定）は
使い捨てプロジェクト（空・非対話）では回せない。そのため本スキルの evals は、**前提が無い環境での停止パス**
（replace-strategy setup / golden-dataset / parity-suite / parity-replace 未完了）と、**禁止事項の拒否挙動**
（検出させない・全画面を渡さない・モデルは分類のみ）を対象にしている。

設定・成果物が揃った状態でしか判定できないケース（環境別の green 証跡の扱い等）は、`evals.json` の `fixture` に置いた
使い捨てプロジェクトの初期状態を `--fixture` で流し込んで検証する（fixture 自体は実行で変更されない）。

## 実行例

```bash
scripts/run-skill-eval.sh \
  --skill parity-diff --config with_skill \
  --prompt "parity-diff" \
  --out tests/parity-diff/iteration-1/eval-1/with_skill/run-1 \
  --model opus
```

fixture 付き eval（`evals.json` に `fixture` があるもの）は `--fixture skills/parity-diff/<fixture の値>` を足して実行する（例: eval 4 は `--fixture skills/parity-diff/evals/fixtures/green-only-local-dev`）。

- 使い捨てプロジェクトには `.replace/features.md`・設定・`.replace/parity/<slug>/metadata.json`・`replace-metadata.json` が無いため、eval 1 は「捏造せず停止し replace-strategy setup / golden-dataset / parity-suite / parity-replace を順に案内」、
  eval 2 は「`--feature` / `--target` 指定でも slug を自分で採番せず・存在しない target を読み替えず、最初に欠ける前提で停止して案内し、スイート再実行や現行アプリ駆動をしない」パスを検証する
- eval 3 は前提の有無に関わらず成立する拒否挙動（検出させない・全画面を渡さない・モデルは分類のみで crop 対を 1 件ずつ 3 値分類）を対象にする
- eval 4 は fixture `green-only-local-dev`（local-dev だけ新側 green・`develop` は db 無しの配信型 target）で、「別環境の green 証跡を流用せず、その環境では green 証跡が無いとして停止し同じ `--target` の parity-replace を案内する」パスを検証する
- eval 5〜11・13・15・16 は前提の有無に関わらず会話で判定できる契約を対象にする（eval 15 は同一原因の N インスタンスに対する承認の粒度と、台帳の件数を畳まない規則の両立。
  eval 16 は `component_diffs` T の照合キーが要素を含むこと＝別要素の同値の差分を吸収しない・`component` の欠落は wildcard ではない）。eval 14 は fixture で共同居住機能の新側 root が存在しない状態を作り、現側由来の矩形による target ごとの再導出・両画像への適用・解除へ到達することを検証する
- eval 12 は fixture `legacy-exceptions-key`（他の前提は揃っているが、設定側に旧キー `component_diff_exceptions` が残り同一原因の `reason` が 3 インスタンスへ複製されている）で、
  「旧キーをフォールバックとして読まず、移行先の slug 成果物と `cause` へ畳む対応表を示して停止する（自動移行しない・件数は畳まない）」パスを検証する。
  他の前提が揃っているため、停止理由が旧キー**以外**（疎通失敗・green 証跡欠落）にすり替わっていれば弁別できる
- eval 17・18 は部品被覆表を収束条件に入れる契約（Issue #274）の回帰で、**対になっている**——
  17 は宣言がある場合に未測定を数え直して収束させない（差し戻し先は `parity-suite`）、18 は `component_coverage` をキーごと持たない旧成果物では判定に入れず**収束させる**（後方互換）。
  17 だけでは「被覆表が無ければ常に止める」実装と区別できないため、18 が陽性コントロールになる。
  どちらのプロンプトにも被覆表のファイル名・キー名を書かない（書くとベースラインがそれを読んで assertion を満たす）
- eval 19 は新側の自己ノイズの 2 回目の採取物（`new/<target>/noise-pass2/`）の扱い（Issue #277）の回帰。記録後に削除しコミットしないこと、
  再利用の判断材料が記録値（`noise_baseline_new` / `noise_measurement`）であって採取物ではないこと、不在が失効条件でも前提確認の停止理由でもないことを対象にする。
  プロンプトは**残す案と、消すと全組再測定になるという誤解**を持ち込む形にしてあり、前提が無い環境でも会話で採点できる
- eval 20・21 は意図的差異の保留（`intentional_diffs.pending`）の棚卸しを収束条件に入れる契約（Issue #279）の回帰で、**対になっている**——
  20 は保留が積まれた状態で棚卸しを済ませるまで収束させない（対象は この機能に帰属 / `cross-cutting` / 帰属不明 の 3 群で、別機能の保留は対象外）、
  21 は保留 0 件では棚卸しを理由に止めず**収束させる**（ただしゼロ件数の記録は残す）。
  20 だけでは「保留の話題が出たら常に止める」実装と区別できないため、21 が陽性コントロールになる。
  どちらのプロンプトにもキー名・スクリプト名・`cross-cutting` の語を書かない（書くとベースラインがそれを読んで assertion を満たす）
- eval 22 は撮影状態の器の棚卸し（`capture_conditions.popup_inventory`。Issue #360 / #361）を撮影前に検査する契約の回帰。不整合な棚卸しを注記で済ませて撮影を進める案を持ち込み、
  停止・器を開く呼び出し（関数名 × 開く対象の論理名）と `opened_by` の突き合わせ・キーごと無い旧成果物を停止して採り直しへ戻すこと・採り直せない場合のユーザー承認の例外（ノイズ吸収なし）・`capture_conditions_verified` への記録を対象にする。
  入力に既存のキー名が要るためプロンプトに `popup_inventory` / `captured` / `reason` は書くが、停止・未検証・記録先の判断は書かない。
  呼び出し単位の突き合わせ（assertion 2）へ到達させるため `openCombo(page, name)` の事実を置いたところ、iteration-23 で `without_skill` も自力で到達したため、assertion 2 は**後退検知**であり Delta には寄与しない。
  Issue #364 で `opened_by` が配列になったのに合わせ、空の `opened_by`・1 つの器を 2 行に分けた棚卸し・同じ `parent` の中で 2 行が同じ呼び出しを持つ棚卸し・別の親の器から呼ぶ同じ呼び出しをプロンプトへ足した。
  **前 3 つは不整合なので撮影前に停止する側、最後は正当なので停止しない側**で、assertion 6（空の `opened_by` と同じ `parent` × 同じ `name` の 2 行で停止し、複数の開き方は 1 行の配列に並べる）・
  7（同じ `parent` × 同じ呼び出しの 2 行で停止し、開く対象の論理名を器ごとに分ける）・
  8（親の器 × 関数名 × 開く対象の単位で突き合わせ、別の親から呼ぶ同じ呼び出しを 1 つに潰さない）が受ける。プロンプトには停止の判断と照合の単位を書かない。
  **停止する 3 条件と停止しない 1 条件を同じ `openCombo(page, 演算子)` で作ってある**ので、7 と 8 の取り違えは検出できる。
  ただし iteration-33 では assertion 7 も 8 も `without_skill` が到達したため、この 2 つは（assertion 2 と同じく）**後退検知**であり Delta には寄与しない
  （同じ `parent` × 同じ呼び出しの曖昧さも、親が違えば別の器であることも、正本を読まなくても導ける）。弁別は 1・3・4・5・6・9 が担う
- eval 23 は反応の被覆表（Issue #351）を収束条件に入れる契約の回帰。差分器の未説明ゼロと、parity-suite 側のスクリプトが見当たらないことを根拠に判定を飛ばして収束させる案を押し戻せるかを見る。
  インストール済みの `parity-suite` のスクリプトを記録済み照合で呼ぶこと・見つからなければ停止すること・照合後の手直しが表の指紋で落ちること・記録先を対象にする。
  入力に既存のキー名が要るためプロンプトに `declared` / `converged` は書くが、スクリプト名・判定の手段・記録先は書かない
- eval 24 は自律実行（`--autonomous`。Issue #369）の parity-diff 固有の対応の回帰。規約の正本は `replace-strategy` の `references/autonomy.md` にあり `requires_skills` で**両 config に設置される**ため、
  正本だけで答えられること（原因単位で保留を立てる・承認を省かない・未解決の保留があれば収束させない・終わりにまとめて聞く）は assertion にしない（iteration-25 で without_skill も到達し弁別しなかった）。
  対象は parity-diff 側にだけある判断——要対応が残るときの収束状態（判断待ちではなく未収束）・承認前の候補を未説明に数えること・棚卸しを自律で `carried_over` にしないこと・記録先（`pending_decisions[]` と `diff.md` の節）。
  プロンプトには状態名・スクリプト名・節名を書かない
- eval 25 は画素の量の報告（Issue #384）の回帰。しきい値つきの数だけを見て「ほぼ一致」と要約し収束扱いにする案を押し戻せるかを見る。
  しきい値の内側に差が隠れること・しきい値なしの数の併記・`diff.md` への両方の記載・ノイズ基準値との対比・他 2 経路が色の微差を見ないことを対象にする。
  しきい値つき／なしの計数そのものは `scripts/pixel-crops.test.js` が担う
- eval 26 は本経路の外で撮った 2 枚の扱い（Issue #384）の回帰。別々の画面から切り出した 2 枚の画素差を根拠に差し戻す案を押し戻せるかを見る。
  **弁別は 1 件（条件が揃うまで要対応として `diff.md` に書かない）だけで、主に後退検知**——`without_skill` も CSS のクランプ規則と撮影条件の不一致から同じ結論へ自力で到達する（iteration-28）。
  初版の assertion は「両側の矩形を並べて出す」「`child_inline_styles` を読む」を要求しており、**本経路で撮り直すという正しい答えが不合格になる**形だったので直した（前者は撮り直しでも通る形へ、後者は `parity-suite` の eval 37 へ移した）
- eval 27 は未測定の機械可読な宣言（Issue #278）の回帰。`gaps.md` に「測っていない」と正しく書いてある状態で、
  散文は収束条件の一覧に無いことを根拠に `converged: true` にする案を押し戻せるかを見る。`unmeasured` への宣言・
  `disposition: blocking` の扱い・承認記録が空なら `blocking`（fail-closed）・キーごと無い旧成果物の後方互換・
  `gaps.md` を人向けの説明としてそのまま残すことを対象にする。
  **assertion は 2 度直している**——初版（iteration-29）の強度ゲートの assertion は prompt が強度ゲートに触れないため
  両 config が無条件 pass する空振りだったので削除し、2 版目（iteration-30）で要求していた `approved_by` / `approved_at` というキー名は
  **正本が `parity-suite` の `metadata-template.json` にあり、`with_skill` には対象スキルの成果物しかコピーされないため原理的に到達できない**
  （`.agents/rules/eval-assertion-discrimination.md`「到達」が名指ししている失敗）。本スキルの `references/convergence.md` で読める粒度
  （承認記録が空なら `blocking`）へ直して iteration-31 で取り直し、`with_skill` 6/6 / `without_skill` 2/6。
  **ただし「`gaps.md` を降格させない」の弁別は run 間で揺れる**——iteration-30 の baseline は `gaps.md` の生成物への降格を提案し、
  iteration-31 の baseline は散文のまま残すと答えた。1 run では分散を測れないので、弁別の根拠をこの 1 本に置かない
- eval 28 は追記専用の成果物の縮小（Issue #310）の回帰。承認記録を「いま有効な分だけ」に書き直しても検査が全部通る状態から、
  そのまま収束させる案を押し戻せるかを見る。過去の決定の喪失・収束判定が現在の状態しか見ないこと・
  `append-only-check.mjs` と `append-only-manifest.json`・対象 0 件を合格に倒さないこと・git の履歴からの復元を対象にする。
  初版（iteration-29）では `with_skill` が一覧の所在（`append-only-manifest.json` が正本）に到達しなかったため、
  prompt に「そもそもどのファイルが追記専用なのかは、どこで決まっている？」を足した（iteration-30 で `with_skill` 6/6）。
  検査そのもの（単位の喪失・消失・整形だけでは落ちない・多重度・サブディレクトリ root・`unit` 別の突き合わせ）は
  `scripts/append-only-check.test.js` が担う。
  **PR #398 のレビューで、行の多重集合が正本の求めるその場の更新（版の +1・状態列の `未`→`済`・Issue 列の `未起票`→番号・
  空配列への最初の追記）を「失われた行」に化けさせることが実測された**——一覧の `unit`（`lines` / `markdown-structure` / `json-arrays`）で
  突き合わせの単位を分け、誤検出で収束が止まらないようにした（回帰はテスト側の陽性・陰性コントロール両方で押さえている）
- 採点は `evals.json` の assertions と `result.json` / `project-files/` を突き合わせ、`grading.json` を残す
- 集計（`benchmark.json`）は `node scripts/build-skill-eval-benchmark.js` で生成する（判定は assertion テキストで突き合わせる。`benchmark.md` は人が書く。詳細は `docs/skill-development.md`）
