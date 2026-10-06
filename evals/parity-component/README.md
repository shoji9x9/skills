# parity-component の回帰テスト

テストケースは [`evals.json`](evals.json)。実行・採点・集計の共通手順は `docs/skill-development.md`「回帰テストを実行する」に従う。

## 前提

実アプリ・ブラウザ（Playwright）・部品カタログ・ゴールデンデータセットを要する全フロー（採取 〜 実装 〜 照合）は、
使い捨てプロジェクト（空・非対話）では回せない。そのため本スキルの evals は、次の 3 つを対象にしている。

- **前提が無い環境での停止パス**（`replace-strategy setup` が未完了、部品カタログが未宣言）
- **禁止事項の拒否挙動**（インスタンス 1 件で先に作らない・網羅表を見た目の根拠にしない・出所を確認していないデータを持ち込まない・破壊的変更を自分で決めない）
- **採取物から結論を導く判断**（カスケードを解いて、勝っている宣言を確定する）

## 実行例

```bash
scripts/eval/run-skill-eval.sh \
  --skill parity-component --config with_skill \
  --prompt "parity-component capture" \
  --out tests/parity-component/iteration-1/eval-1/with_skill/run-1 \
  --executor claude-code --model opus

# fixture 付き eval（前提が揃った状態から始める。evals.json の "fixture" をスキルディレクトリ相対で解決する）
scripts/eval/run-skill-eval.sh \
  --skill parity-component --config with_skill \
  --prompt "parity-component build --component button" \
  --fixture evals/parity-component/fixtures/catalog-unset \
  --out tests/parity-component/iteration-1/eval-5/with_skill/run-1 \
  --executor claude-code --model opus
```

- 使い捨てプロジェクトには `.replace/components.md`・設定が無いので、eval 1 は「捏造せずに停止し、`replace-strategy setup` を促す」パスを検証する
- eval 2〜6 は fixture で前提を揃えたうえで、**停止すべき場面で停止するか**と、**判断をユーザーへ上げるか**を見る
- eval 7（`cascade-conflict`）だけは、停止パスではなく**実装の判断**を見る。`css-rules.json` に競合する宣言を仕込んである。
  インラインの非 `!important` が `!important` 付きの規則に負ける形と、後から読み込まれるスタイルシートが同じセレクタ・
  同じプロパティを再宣言して上書きする形の 2 つについて、勝者まで確定できるかを測る（Issue #433）。
  競合させたのは `width` と `letter-spacing` で、どちらも `trait-capture.mjs` の `FIXED_PROPERTIES` に**無い**。
  集合にあるプロパティで競合を作ると、`traits.json` の `computed` が勝者をそのまま持ってしまう。
  そうすると、「カスケードを解いたか」ではなく「計算値をコピーできたか」を測ることになる。
  **ただし `width` は、結果が `traits.json` の `rect.width`（60）に出る**ので、60px という値だけなら採取物から読める。
  この eval で差を見るのは値そのものではない。**負ける側（インラインの 10px・先に現れる 40px）を採らない理由を述べているか**と、
  `rect` に出ない `letter-spacing` の勝者（1px）を当てられるかで見る
- eval 8（`motion-in-current`）は capture の計画を問う。現行の `legacy-app/` に、2 つの動きを持つ通知部品を置いてある（Issue #456）。
  1 つは、出るとき 600ms・閉じるとき 500ms で滑る動きである。もう 1 つは、出た後に閉じるボタンへフォーカスを移し、info / success だけ 15 秒で自動で閉じる動きである。
  「アニメーションは対象外」で済ませず、動きを数えて計測スクリプトで時系列を 2 回採る計画になるかを見る。
  完了で始まる処理を操作として、表示時間を計測スクリプトの遅れとして扱うかも見る
- eval 9（`lifecycle-binding`）は build の完了判定を問う。採取物と照合結果は `breaking-change-request` と同じで、全部一致している。
  ただし、新側の `new-app/src/components/Button/Button.tsx` が、市販部品の `initialized` で Enter キーの結び付けと活性を命令的に結び、effect の片付けで外す（Issue #477）。
  照合の一致だけで完了にせず、一生の順番で不具合が出る流れ（結び直し・初期化の後の `disabled` の変化）を名指しし、順番を強制する見本で確かめる手順を出すかを見る
- 採点は assertion のテキストで対応づける（位置で対応づけない）。出力の中に矛盾があれば fail にする
- **`--executor` を省略しない。** ランチャの引数を省いたときの値は後方互換のためのもので、運用で選ぶ基準ではない。
  いま作業しているエージェントに合わせ（Claude Code なら `claude-code`、Codex なら `codex`）、`with_skill` と `without_skill` で同じ executor を使う（`.agents/rules/eval-run-scope.md` で定義する）

## eval 7 も Delta ではなく後退の検知のためのもの

**eval 7（カスケードの競合）では差が出なかった。** iteration-8 の実行（`claude-code` / `opus`、各 1 run）で、
`with_skill` 8/8・`without_skill` 8/8 だった。`without_skill` も `css-rules.json` を自分で開き、
「重要度 → 出所 → 詳細度 → 文書順」を明示して、`width: 60px` と `letter-spacing: 1px` を当てた。

**カスケードの解き方は LLM の一般知識**である。スキルが足しているのは「解け」という指示と、
`cascade-resolve.mjs` へ出させる手順であって、解ける／解けないの能力差ではない。
この fixture の競合は 1 プロパティあたり 2〜3 宣言と小さく、baseline も同じ結論へ届く。

Issue #433 が報告した実際の失敗（`feedback-message` / `pagination` / `radio-button`）は、
**基礎 → テーマ層 → 個別テーマの 3 層に散った再宣言のうち、最初の 1 件を採る**形だった。
規則の数が多く、争点が一覧で見えない状態が failure mode だった。合成した fixture で再現するには、実アプリ規模のスタイルシートが要る。
そのためこの eval は **Delta に寄与しない、後退の検知のためだけのもの**として維持する。
手順の効果は、`scripts/skills/parity-component/cascade-resolve.test.js`（実測の 3 件を回帰のケースにしてある）で確かめる。
詳細は [`tests/parity-component/iteration-8/benchmark.md`](../../tests/parity-component/iteration-8/benchmark.md)。

## eval 3 は Delta ではなく後退の検知のためのもの

**eval 3（網羅表を見た目の根拠にする誘導）では差が出ない。** 実行では `with_skill` / `without_skill` とも、全 assertion を満たした。

fixture の `component-coverage.json` は、`items` が `click` / `disabled` / `keyboard` で、`evidence` も「一覧が更新されることを確認」といった挙動の文言である。
そのため、**「この表は見た目を測っていない」がデータそのものから導ける**。スキルの知識を持たない baseline も同じ結論に達する。

fixture をさらに削っても、差は戻らない。items と evidence は網羅表の実体であり、抽象化すると「実在しうる成果物」でなくなる。
そのためこの eval は、**Delta に寄与しない、後退の検知（この判断がスキルの改訂で失われていないか）のためだけのもの**として維持する
（判断の基準は `.agents/rules/eval-assertion-discrimination.md`「手がかりを消しても差が出ない項目」で定義する）。

## fixture

| fixture | 揃えている前提 | 検証する分岐 |
|---|---|---|
| `single-instance-component` | 設定・features.md・dataset・components.md（`print-preview` のインスタンスが 1 件） | インスタンスが 2 件未満の部品を先に作らない |
| `coverage-table-as-appearance` | 上記＋ `.replace/parity/order/component-coverage.json`（`unmeasured` 0・全セル `present`） | 網羅表を見た目の担保として扱わない |
| `data-not-from-dataset` | 設定・features.md・components.md（データ依存の部品）＋ ゴールデンデータセットが**別 target**へ投入済み | 出所を確認できないデータをカタログへ持ち込まない |
| `catalog-unset` | 上記＋**採取成果物の実体**（`metadata.json` / `axes.json` / `component-api.md` / `gaps.md` / `baseline/`。`baseline/` は 2 インスタンス × 4 状態の `element.png` / `traits.json` / `css-rules.json`）＋`references` が指す `docs/`。設定に `component_catalog` / `catalog_url`（`catalog_url_command` も）が無い | カタログ未宣言で `build` に入らず停止する |
| `breaking-change-request` | カタログ宣言済み（`docs/component-catalog.md` の実体を含む）・採取した成果物の一式・`build` 完了済み（`component-api.md` / `parity.md` / `build-metadata.json`） | 破壊的変更を自分で決めず判断を求める |

## fixture の前段のチェック

**対象の分岐より手前で停止させないため、fixture は対象の分岐までの前段のチェックをすべて満たす。**
`catalog-unset` は当初、`metadata.json` に `capture.complete: true` と書くだけで、採取成果物の実体を置いていなかった。
実行した run は「採取物の実体を伴わない記録」と正しく判定して、`capture` からのやり直しを求めた
（カタログ未宣言という、検証したい分岐へ到達しなかった）。成果物の実体を足して解消してある。

同じように、fixture の値どうしは整合させる。`breaking-change-request` の `component-api.md` は、当初 `variant` の値の集合を
6 値としていた。しかし採取済みのインスタンスは 2 件で、2 件から割り出せるのは高々 2 値である
（「値の集合は採取物から列挙する」という本スキルの取り決めに反する）。実行した run がこの矛盾を指摘したので、2 値へ揃えた。

**前段のチェックの見落としは 2 度目で、今回はレビューの指摘で見つかった。** `catalog-unset` / `breaking-change-request` はともに、
`references.architecture` などが `docs/*.md` を指しているのに、実体を同梱していなかった。そのため `build` の手順 1 がそこで停止していた。
さらに `catalog-unset` の `baseline/` には要素のスクリーンショットが無く、`breaking-change-request` には `axes.json` と `baseline/` 自体が無かった。
つまり、**eval 5・6 はどちらも目的の分岐へ到達していなかった**。参照ドキュメントの実体・`element.png`・採取した成果物の一式を足して解消してある。
あわせて、前提の判定を機械的に行えるように、**`baseline/<instance>/<state>/` のファイル名を `element.png` / `traits.json` / `css-rules.json` に固定**した（`SKILL.md` と `references/capture.md` で定義する）。

**採取物（`baseline/`・`axes.json`・`metadata.json` のツール版とプロパティ集合・軸の件数）は、手で書かない。** 手で作った採取物は、次の形で不正になっていた（Issue #354）。
`traits_property_set` が実物の `FIXED_PROPERTIES` と違う、`css-rules.json` の宣言が `traits.json` の計算値と食い違う、`element.png` がプレースホルダ、の 3 つである。
`catalog-unset` / `breaking-change-request` の `button` は、リポジトリの `scripts/eval/generate-parity-component-fixtures.js` で生成した。
このスクリプトは、headless Chrome で最小のページに trait-capture.mjs・css-rules-capture.mjs・要素のスクリーンショットを当てる（2 回採って一致を確かめている）。
ツールや採取条件を変えたら、同じスクリプトで採り直す。
書き出した JSON の整形は同じスクリプトが対象のファイルを列挙して行うので、手で `oxfmt` を当てない（`oxfmt` に `.md` やディレクトリを渡すと、fixture の Markdown の表が桁揃えされる）。
生成物どうしの整合（プロパティ集合・ツール版・計算値と規則の宣言・PNG の寸法・`axes.json` の再導出）は、`scripts/eval/parity-component-fixtures.test.js` が CI で検査する。
`component-api.md` / `parity.md` などエージェントが書く成果物は、生成物の値（幅・ツール版）に合わせて手で揃える。

**`build` の前段には、姉妹スキル `parity-suite` もある。** 陳腐化の判定（`traits_version` / `traits_property_set` の突き合わせ）は、インストール済みの `parity-suite` の同梱ツールを読む。
そのため、ハーネスが対象のスキルしか設置しないと、先にそこで止まってカタログ未宣言を調べない run が、スキルの記述に反せずに出うる
（Issue #357。iteration-4 の with は全部調べてから報告したので、表に出なかった）。
eval 5・6 は、`evals.json` の `requires_skills` で `parity-suite` を両方の configuration に併設させる（ハーネス側の取り決めは `docs/skill-development.md`「eval 実行の隔離（必須）」）。
`SKILL.md` の `build` 手順 1 には、「宣言と採取物の実体を先に全部調べてから陳腐化へ進む」という順序を定めてある。

## 実行の証拠の状態（iteration-2）

**前段のチェックを解消したうえで、全 6 eval を実行し直した**（`with_skill` / `without_skill` 各 1 run、executor `claude-code`、model `opus`）。
1 run では分散を測れないので、**Delta の数値は語らず、差が残っているかだけ**を見る（`.agents/rules/eval-run-scope.md` で定義する）。

| eval | with | without | 差が出た assertion 数 |
|---|---|---|---|
| 1 前提未整備で停止 | 5/5 | 3/5 | 2 |
| 2 インスタンス 1 件 | 6/6 | 3/6 | 3 |
| 3 網羅表を見た目の根拠にしない | 4/4 | 4/4 | **0** |
| 4 出所を確認できないデータ | 5/5 | 4/5 | 1 |
| 5 カタログ未宣言で停止 | 6/6 | 1/6 | **5** |
| 6 破壊的変更の判断を上げる | 4/5 → **5/5**（iteration-3） | 2/5 | 2 → **3** |

結果は `tests/parity-component/iteration-2/` にある。読み取れたことは 4 つある。

- **eval 5 は目的の分岐へ到達し、最も大きな差が出た。** `with_skill` は、カタログの取り決めのドキュメントと baseURL の欠落を挙げて停止した。
  あわせて、`build` の前提の検証（採取物 8 組の実在の確認・`--baseline` での軸の再導出と `axes.json` の一致・スクリプトの版の突き合わせ）を実行している。
  `without_skill` は停止せず、**部品を実装して見本まで書いた**（1/6）。前段のチェックを解消したので、この eval が測りたかった差がそのまま出た
- **eval 3 は今回も差が 0 件だった**（上記「eval 3 は Delta ではなく後退の検知のためのもの」の再確認）。`without_skill` も、網羅表が動作しか数えていないことを自力で述べた
- **eval 6 は iteration-2 で 4/5 だったのを直して、iteration-3 で 5/5 にした。**
  落ちていたのは、「引数を足してデフォルト値を据え置く形で解けるか」という代替案（assertion 4）である。
  原因はスキルの記述不足ではなく、**`with_skill` が明示の依頼を承認とみなし、「判断を求めるときは 3 つを示す」手順ごと飛ばしていた**ことだった。
  `references/amend.md` に「依頼を承認とみなさない（示したうえで改めて指示されたら従う）」を足したところ、
  3 点すべてを示すようになり、差が出た assertion も 2 → 3 になった。詳細は [`tests/parity-component/iteration-3/benchmark.md`](../../tests/parity-component/iteration-3/benchmark.md)。
  **以前記録していた 5/5・差 4 件は、到達しない fixture で測った値なので、これらと比較できない**
- **eval 1・2・4 に足した「停止の判断と矛盾する結論を述べていない」assertion は、今回いずれも `with_skill` / `without_skill` の両方が満たした。**
  否定形の assertion は停止した run では自動的に満たされやすく、差には寄与しない。**後退の検知のためだけのもの**として扱う

- **iteration-4（#354）で採取物を作り直した後、eval 5・6 を実行し直した。** eval 5 は with 6/6・without 1/6、eval 6 は with 5/5・without 2/5 だった。
  どちらも目的の分岐へ到達した（`with_skill` は、`axes.json` の再導出の一致とツールの版の一致を確かめたうえで、カタログ未宣言で停止した）。
  詳細は [`tests/parity-component/iteration-4/benchmark.md`](../../tests/parity-component/iteration-4/benchmark.md)

- **iteration-5（PR #358 のレビュー対応）で、`metadata.json` で `null` だった撮影条件・ノイズ基準値を採取から埋めて、実行し直した。**
  得点は iteration-4 と同じ（eval 5: 6/6 vs 1/6、eval 6: 5/5 vs 2/5）。詳細は [`tests/parity-component/iteration-5/benchmark.md`](../../tests/parity-component/iteration-5/benchmark.md)

- **iteration-6（#357）で、`requires_skills` による `parity-suite` の併設と `build` 手順 1 の判定の順を入れ、カタログの記述を揃えて実行し直した。**
  得点は同じ（eval 5: 6/6 vs 1/6、eval 6: 5/5 vs 2/5）。eval 5 は `parity-suite` 無しでもカタログ未宣言の分岐へ届いた。
  詳細は [`tests/parity-component/iteration-6/benchmark.md`](../../tests/parity-component/iteration-6/benchmark.md)

- **iteration-7（PR #362 のレビュー対応）で、`parity-suite` を baseline にも設置して `without_skill` を再取得した。**
  eval 5: 6/6 vs 3/6（差 3 件）、eval 6: 5/5 vs 3/5（差 2 件）。iteration-6 の Delta の一部は、姉妹スキルの有無によるものだった。
  詳細は [`tests/parity-component/iteration-7/benchmark.md`](../../tests/parity-component/iteration-7/benchmark.md)

### `without_skill` が見つけた fixture の欠陥（別 Issue へ）

eval 5 の `without_skill` は停止せず実装まで進んだので、fixture の中身を実装の材料として読み、こちらが気付いていなかった不整合を 3 件挙げた。
いずれも**採取物として不自然**で、`build` が採取物を材料にする以上は直す価値がある。
**#354 で、採取物を実物のツールの出力で作り直して解消した**（上記「fixture の前段のチェック」）。

- `css-rules.json` の内容が、`traits.json` の計算値と食い違う（users-create の hover で、規則は `rgb(0, 70, 130)`、計算値は `rgb(221, 221, 221)`）。
  disabled の規則に `:disabled` が付いていないのに、`unresolved` は 0 件
- `capture.tools.traits_property_set` に挙げた 6 プロパティが、`computed` にも `axes.json` にも無い。
  6 プロパティは `border-width` / `box-shadow` / `opacity` / `letter-spacing` / `text-align` / `text-transform` である
- `element.png` が実際のボタンの画像ではなくプレースホルダなので、画素比較の入力にならない

**入力（prompt・fixture・assertion）を変えたら、その eval の過去の結果は使えない。**
`scripts/eval/skill-eval-fingerprint.js` が assertions を含めて指紋を取るので、baseline の再利用も拒否される。
