# parity-diff の回帰テスト

テストケースは [`evals.json`](evals.json)。実行・採点・集計の共通手順は `docs/skill-development.md`「回帰テストを実行する」に従う。

## 前提

実アプリ・DB・ブラウザ（Playwright）・パリティスイート・新側 green の実装を要する全フロー（前提確認 〜 新側ベースライン取得 〜 3 つの比較方法による検出 〜 正規化 〜 トリアージ 〜 収束判定）は、
使い捨てプロジェクト（空・非対話）では回せない。そのため本スキルの evals は、次の 2 つを対象にしている。

- **前提が無い環境での停止パス**（replace-strategy setup / golden-dataset / parity-suite / parity-replace が未完了）
- **禁止事項の拒否挙動**（検出させない・全画面を渡さない・モデルは分類のみ）

設定・成果物が揃った状態でしか判定できないケース（環境別の green 証跡の扱い等）は、`evals.json` の `fixture` に置いた
使い捨てプロジェクトの初期状態を `--fixture` で流し込んで検証する（fixture 自体は実行で変更されない）。

## 実行例

```bash
scripts/eval/run-skill-eval.sh \
  --skill parity-diff --config with_skill \
  --prompt "parity-diff" \
  --out tests/parity-diff/iteration-1/eval-1/with_skill/run-1 \
  --model opus
```

fixture 付きの eval（`evals.json` に `fixture` があるもの）は、`--fixture evals/parity-diff/<fixture の値>` を足して実行する。
例えば eval 4 は `--fixture evals/parity-diff/fixtures/green-only-local-dev` を足す。

- 使い捨てプロジェクトには `.replace/features.md`・設定・`.replace/parity/<slug>/metadata.json`・`replace-metadata.json` が無い。
  そのため eval 1 は「捏造せずに停止し、replace-strategy setup / golden-dataset / parity-suite / parity-replace を順に案内する」パスを検証する。
  eval 2 は「`--feature` / `--target` を指定しても slug を自分で採番せず、存在しない target を読み替えず、最初に欠ける前提で停止して案内し、スイートの再実行や現行アプリの操作をしない」パスを検証する
- eval 3 は、前提の有無に関わらず成立する拒否挙動（検出させない・全画面を渡さない・モデルは分類のみで crop 対を 1 件ずつ 3 値に分類する）を対象にする
- eval 4 は fixture `green-only-local-dev` を使う（local-dev だけ新側 green・`develop` は db 無しの配信型 target）。
  「別環境の green 証跡を流用せず、その環境では green 証跡が無いとして停止し、同じ `--target` の parity-replace を案内する」パスを検証する
- eval 5〜11・13・15・16 は、前提の有無に関わらず会話で判定できる取り決めを対象にする。
  eval 15 は、同一原因の N インスタンスに対する承認の粒度と、台帳の件数を畳まない規則の両立を見る。
  eval 16 は、`component_diffs` T の照合キーが要素を含むこと（別要素の同値の差分を吸収しない）と、`component` の欠落が wildcard ではないことを見る。
  eval 14 は fixture で共同居住機能の新側 root が存在しない状態を作り、現側由来の矩形による target ごとの再導出・両画像への適用・解除へ到達することを検証する
- eval 12 は fixture `legacy-exceptions-key` を使う。他の前提は揃っているが、設定側に旧キー `component_diff_exceptions` が残り、同一原因の `reason` が 3 インスタンスへ複製されている。
  「旧キーをフォールバックとして読まず、移行先の slug 成果物と `cause` へ畳む対応表を示して停止する（自動移行しない・件数は畳まない）」パスを検証する。
  他の前提が揃っているので、停止理由が旧キー**以外**（疎通失敗・green 証跡の欠落）にすり替わっていれば区別できる
- eval 17・18 は、部品網羅表を収束条件に入れる取り決め（Issue #274）の回帰で、**対になっている**。
  17 は、宣言がある場合に未測定を数え直して収束させない（差し戻し先は `parity-suite`）。
  18 は、`component_coverage` をキーごと持たない旧成果物では判定に入れず、**収束させる**（後方互換）。
  17 だけでは「網羅表が無ければ常に止める」実装と区別できないので、18 で誤検知しないことを確かめる。
  どちらのプロンプトにも網羅表のファイル名・キー名を書かない（書くとベースラインがそれを読んで assertion を満たす）
- eval 19 は、新側の自己ノイズの 2 回目の採取物（`new/<target>/noise-pass2/`）の扱い（Issue #277）の回帰である。
  記録後に削除してコミットしないこと、再利用の判断材料が記録値（`noise_baseline_new` / `noise_measurement`）であって採取物ではないこと、
  不在が失効条件でも前提確認の停止理由でもないことを対象にする。
  プロンプトは、**残す案と、消すと全組の再測定になるという誤解**を持ち込む形にしてあり、前提が無い環境でも会話で採点できる
- eval 20・21 は、意図的差異の保留（`intentional_diffs.pending`）の棚卸しを収束条件に入れる取り決め（Issue #279）の回帰で、**対になっている**。
  20 は、保留が積まれた状態では棚卸しを済ませるまで収束させない（対象は、この機能に帰属 / `cross-cutting` / 帰属不明 の 3 群で、別機能の保留は対象外）。
  21 は、保留 0 件では棚卸しを理由に止めず、**収束させる**（ただし 0 件の記録は残す）。
  20 だけでは「保留の話題が出たら常に止める」実装と区別できないので、21 で誤検知しないことを確かめる。
  どちらのプロンプトにもキー名・スクリプト名・`cross-cutting` の語を書かない（書くとベースラインがそれを読んで assertion を満たす）
- eval 22 は、撮影状態のポップアップの棚卸し（`capture_conditions.popup_inventory`。Issue #360 / #361）を撮影前に検査する取り決めの回帰である。
  不整合な棚卸しを注記で済ませて撮影を進める案を持ち込む。対象にするのは次の 5 つである。
  停止すること、ポップアップを開く呼び出し（関数名 × 開く対象の論理名）と `opened_by` を突き合わせること、キーごと無い旧成果物では停止して採り直しへ戻すこと、
  採り直せない場合のユーザー承認の例外（ノイズ吸収なし）、`capture_conditions_verified` への記録。
  入力に既存のキー名が要るので、プロンプトに `popup_inventory` / `captured` / `reason` は書くが、停止・未検証・記録先の判断は書かない。
  呼び出し単位の突き合わせ（assertion 2）へ到達させるため `openCombo(page, name)` の事実を置いたところ、iteration-23 で `without_skill` も自力で到達した。
  そのため assertion 2 は**後退の検知**のためのもので、Delta には寄与しない。
  Issue #364 で `opened_by` が配列になったのに合わせて、次の 4 つをプロンプトへ足した。
  空の `opened_by`、1 つのポップアップを 2 行に分けた棚卸し、同じ `parent` の中で 2 行が同じ呼び出しを持つ棚卸し、別の親のポップアップから呼ぶ同じ呼び出しである。
  **前の 3 つは不整合なので撮影前に停止する側、最後は正当なので停止しない側**である。これを assertion 6〜8 が受ける。
  6 は、空の `opened_by` と、同じ `parent` × 同じ `name` の 2 行で停止し、複数の開き方は 1 行の配列に並べることを見る。
  7 は、同じ `parent` × 同じ呼び出しの 2 行で停止し、開く対象の論理名をポップアップごとに分けることを見る。
  8 は、親のポップアップ × 関数名 × 開く対象の単位で突き合わせ、別の親から呼ぶ同じ呼び出しを 1 つにまとめないことを見る。プロンプトには停止の判断と照合の単位を書かない。
  **停止する 3 条件と停止しない 1 条件を、同じ `openCombo(page, 演算子)` で作ってある**ので、7 と 8 の取り違えは検出できる。
  ただし iteration-33 では assertion 7 も 8 も `without_skill` が到達したので、この 2 つも（assertion 2 と同じく）**後退の検知**のためのもので、Delta には寄与しない。
  同じ `parent` × 同じ呼び出しの曖昧さも、親が違えば別のポップアップであることも、原本を読まなくても導けるからである。差を出すのは 1・3・4・5・6・9 である
- eval 23 は、反応の網羅表（Issue #351）を収束条件に入れる取り決めの回帰である。
  差分ツールの未説明が 0 件で、parity-suite 側のスクリプトが見当たらないことを根拠に、判定を飛ばして収束させる案を押し戻せるかを見る。
  インストール済みの `parity-suite` のスクリプトを記録済み照合で呼ぶこと・見つからなければ停止すること・照合後の手直しが表の指紋で落ちること・記録先を対象にする。
  入力に既存のキー名が要るので、プロンプトに `declared` / `converged` は書くが、スクリプト名・判定の手段・記録先は書かない
- eval 24 は、自律実行（`--autonomous`。Issue #369）での parity-diff 固有の対応の回帰である。
  規約は `replace-strategy` の `references/autonomy.md` で定義し、`requires_skills` で**両方の config に設置される**。
  そのため、原本だけで答えられること（原因単位で保留を立てる・承認を省かない・未解決の保留があれば収束させない・終わりにまとめて聞く）は assertion にしない（iteration-25 で without_skill も到達し、差が出なかった）。
  対象は、parity-diff 側にだけある判断である。要対応が残るときの収束状態（判断待ちではなく未収束）、承認前の候補を未説明に数えること、
  棚卸しを自律で `carried_over` にしないこと、記録先（`pending_decisions[]` と `diff.md` の節）の 4 つを見る。
  プロンプトには状態名・スクリプト名・節名を書かない
- eval 25 は、画素の量の報告（Issue #384）の回帰である。しきい値つきの数だけを見て「ほぼ一致」と要約し、収束扱いにする案を押し戻せるかを見る。
  しきい値の内側に差が隠れること・しきい値なしの数の併記・`diff.md` への両方の記載・ノイズ基準値との対比・他の 2 つの比較方法が色の微差を見ないことを対象にする。
  しきい値つき／なしの計数そのものは、`scripts/skills/parity-diff/pixel-crops.test.js` が確かめる
- eval 26 は、通常の撮影手順の外で撮った 2 枚の扱い（Issue #384）の回帰である。別々の画面から切り出した 2 枚の画素差を根拠に差し戻す案を押し戻せるかを見る。
  **差が出るのは 1 件（条件が揃うまで要対応として `diff.md` に書かない）だけで、主に後退の検知のためのもの**である。
  `without_skill` も、CSS のクランプ規則と撮影条件の不一致から、同じ結論へ自力で到達する（iteration-28）。
  初版の assertion は「両側の矩形を並べて出す」「`child_inline_styles` を読む」を要求しており、**通常の撮影手順で撮り直すという正しい答えが不合格になる**形だった。
  そのため直した（前者は撮り直しでも通る形へ、後者は `parity-suite` の eval 37 へ移した）
- eval 27 は、未測定の機械可読な宣言（Issue #278）の回帰である。`gaps.md` に「測っていない」と正しく書いてある状態で、
  散文は収束条件の一覧に無いことを根拠に `converged: true` にする案を押し戻せるかを見る。
  対象は、`unmeasured` への宣言、`disposition: blocking` の扱い、承認記録が空なら `blocking`（判定できないときは失敗として扱う）、
  キーごと無い旧成果物の後方互換、`gaps.md` を人向けの説明としてそのまま残すことである。
  **assertion は 2 度直している**。初版（iteration-29）の強度チェックの assertion は、prompt が強度チェックに触れないので、
  両方の config が無条件に pass する空振りだった。そのため削除した。
  2 版目（iteration-30）で要求していた `approved_by` / `approved_at` というキー名は、**`parity-suite` の `metadata-template.json` で定義されている**。
  `with_skill` には対象スキルの成果物しかコピーされないので、**原理的に到達できない**
  （`.agents/rules/eval-assertion-discrimination.md`「到達できるか」が名指ししている失敗）。
  そこで、本スキルの `references/convergence.md` で読める粒度（承認記録が空なら `blocking`）へ直し、iteration-31 で測り直した。結果は `with_skill` 6/6 / `without_skill` 2/6 である。
  **ただし、「`gaps.md` を降格させない」で差が出るかは run の間で揺れる**。iteration-30 の baseline は `gaps.md` の生成物への降格を提案し、
  iteration-31 の baseline は散文のまま残すと答えた。1 run では分散を測れないので、差の根拠をこの 1 本に置かない
- eval 28 は、追記専用の成果物の縮小（Issue #310）の回帰である。承認記録を「いま有効な分だけ」に書き直しても検査が全部通る状態から、
  そのまま収束させる案を押し戻せるかを見る。過去の決定の喪失・収束判定が現在の状態しか見ないこと・
  `append-only-check.mjs` と `append-only-manifest.json`・対象 0 件を合格として扱わないこと・git の履歴からの復元を対象にする。
  初版（iteration-29）では、`with_skill` が一覧の所在（`append-only-manifest.json` で定義する）に到達しなかった。
  そのため prompt に、どのファイルが追記専用なのかをどこで決めているかを問う一文を足した（iteration-30 で `with_skill` 6/6）。
  検査そのもの（単位の喪失・消失・整形だけでは落ちない・多重度・サブディレクトリ root・`unit` 別の突き合わせ）は、
  `scripts/skills/replace-strategy/append-only-check.test.js` が確かめる。
  **PR #398 のレビューで、行の多重集合で比べると、原本が求めるその場の更新が「失われた行」と誤って判定されることを実測した**。
  その場の更新とは、版の +1・状態列の `未`→`済`・Issue 列の `未起票`→番号・空配列への最初の追記である。
  一覧の `unit`（`lines` / `markdown-structure` / `json-arrays`）で突き合わせの単位を分け、誤検出で収束が止まらないようにした。
  回帰は、テスト側で検出されることの確認と、誤検知しないことの確認の両方で押さえている
- 採点は `evals.json` の assertions と `result.json` / `project-files/` を突き合わせ、`grading.json` を残す
- 集計（`benchmark.json`）は `node scripts/eval/build-skill-eval-benchmark.js` で生成する（判定は assertion テキストで突き合わせる。`benchmark.md` は人が書く。詳細は `docs/skill-development.md`）
