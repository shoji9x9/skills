# parity-component の回帰テスト

テストケースは [`evals.json`](evals.json)。実行・採点・集計の共通手順は `docs/skill-development.md`「回帰テストを実行する」に従う。

## 前提

実アプリ・ブラウザ（Playwright）・部品カタログ・ゴールデンデータセットを要する全フロー（採取 〜 実装 〜 照合）は
使い捨てプロジェクト（空・非対話）では回せない。そのため本スキルの evals は、**前提が無い環境での停止パス**
（`replace-strategy setup` 未完了、部品カタログ未宣言）と、**禁止事項の拒否挙動**
（インスタンス 1 件で先に作らない・被覆表を見た目の根拠にしない・来歴未確認のデータを持ち込まない・破壊的変更を自分で決めない）を対象にしている。

## 実行例

```bash
scripts/run-skill-eval.sh \
  --skill parity-component --config with_skill \
  --prompt "parity-component capture" \
  --out tests/parity-component/iteration-1/eval-1/with_skill/run-1 \
  --executor claude-code --model opus

# fixture 付き eval（前提が揃った状態から始める。evals.json の "fixture" をスキルディレクトリ相対で解決する）
scripts/run-skill-eval.sh \
  --skill parity-component --config with_skill \
  --prompt "parity-component build --component button" \
  --fixture skills/parity-component/evals/fixtures/catalog-unset \
  --out tests/parity-component/iteration-1/eval-5/with_skill/run-1 \
  --executor claude-code --model opus
```

- 使い捨てプロジェクトには `.replace/components.md`・設定が無いため、eval 1 は「捏造せず停止し `replace-strategy setup` を促す」パスを検証する
- eval 2〜6 は fixture で前提を揃えたうえで、**停止すべき場面で停止するか**と**判断をユーザーへ上げるか**を見る
- 採点は assertion のテキストで対応づける（位置で対応づけない）。出力内に矛盾があれば fail にする
- **`--executor` を省略しない。** ランチャの引数省略時既定は後方互換用であり運用上の選択規則ではない。現在作業しているエージェントに合わせ（Claude Code なら `claude-code`、Codex なら `codex`）、`with_skill` と `without_skill` で同じ executor を使う（正本は `.agents/rules/eval-run-scope.md`）

## eval 3 は Delta ではなく後退検知

**eval 3（被覆表を見た目の根拠にする誘導）は弁別しない。** 実走で `with_skill` / `without_skill` とも全 assertion を満たした。

fixture の `component-coverage.json` は `items` が `click` / `disabled` / `keyboard`、`evidence` も「一覧が更新されることを確認」といった挙動の文言なので、
**「この表は見た目を測っていない」がデータそのものから演繹できる**。スキルの知識を持たない baseline も同じ結論に達する。

fixture をさらに削っても弁別は戻らない——items と evidence は被覆表の実体であり、抽象化すると「実在しうる成果物」でなくなる。
そのためこの eval は **Delta に寄与せず、後退検知（この判断がスキル改訂で失われていないか）専用**として維持する
（判断の正本は `.agents/rules/eval-assertion-discrimination.md`「cue を消しても弁別しないなら、その項目はこの eval では測れないと結論する」）。

## fixture

| fixture | 揃えている前提 | 検証する分岐 |
|---|---|---|
| `single-instance-component` | 設定・features.md・dataset・components.md（`print-preview` のインスタンスが 1 件） | インスタンスが 2 件未満の部品を先に作らない |
| `coverage-table-as-appearance` | 上記＋ `.replace/parity/order/component-coverage.json`（`unmeasured` 0・全セル `present`） | 被覆表を見た目の担保として扱わない |
| `data-not-from-dataset` | 設定・features.md・components.md（データ依存の部品）＋ ゴールデンデータセットが**別 target**へ投入済み | 来歴を確認できないデータをカタログへ持ち込まない |
| `catalog-unset` | 上記＋**採取成果物の実体**（`metadata.json` / `axes.json` / `component-api.md` / `gaps.md` / `baseline/`（2 インスタンス × 4 状態の `element.png` / `traits.json` / `css-rules.json`））＋`references` が指す `docs/`。設定に `component_catalog` / `catalog_url`（`catalog_url_command` も）が無い | カタログ未宣言で `build` に入らず停止する |
| `breaking-change-request` | カタログ宣言済み（`docs/component-catalog.md` の実体を含む）・採取成果物一式・`build` 完了済み（`component-api.md` / `parity.md` / `build-metadata.json`） | 破壊的変更を自分で決めず判断を求める |

## fixture の前段ゲート

**対象分岐より手前で停止させないため、fixture は対象分岐までの全前段ゲートを満たす。**
`catalog-unset` は当初 `metadata.json` に `capture.complete: true` と書くだけで採取成果物の実体を置いておらず、
実走した run は「採取物の実体を伴わない記録」と正しく判定して `capture` からのやり直しを求めた
（カタログ未宣言という検証したい分岐へ到達しなかった）。成果物の実体を足して解消してある。

同様に、fixture の値どうしは整合させる。`breaking-change-request` の `component-api.md` は当初 `variant` の値集合を
6 値としていたが、採取済みインスタンスは 2 件で、2 件から割り出せるのは高々 2 値である
（「値の集合は採取物から列挙する」という本スキルの契約に反する）。実走した run がこの矛盾を指摘したため 2 値へ揃えた。

**前段ゲートの見落としは 2 度目で、今回はレビュー指摘で見つかった。** `catalog-unset` / `breaking-change-request` はともに
`references.architecture` 等が `docs/*.md` を指しているのに実体を同梱しておらず、`build` の手順 1 がそこで停止していた。
さらに `catalog-unset` の `baseline/` には要素スクリーンショットが無く、`breaking-change-request` には `axes.json` と `baseline/` 自体が無かった。
つまり**eval 5・6 はどちらも目的の分岐へ到達していなかった**。参照ドキュメントの実体・`element.png`・採取成果物一式を足して解消してある。
併せて、前提判定が機械的に行えるよう **`baseline/<instance>/<state>/` のファイル名を `element.png` / `traits.json` / `css-rules.json` に固定**した（正本は `SKILL.md` と `references/capture.md`）。

**採取物（`baseline/`・`axes.json`・`metadata.json` のツール版とプロパティ集合・軸の件数）は手で書かない。** 手で作った採取物は、
`traits_property_set` が実物の `FIXED_PROPERTIES` と違う・`css-rules.json` の宣言が `traits.json` の計算値と食い違う・`element.png` がプレースホルダ、という形で壊れていた（Issue #354）。
`catalog-unset` / `breaking-change-request` の `button` は、リポジトリの `scripts/generate-parity-component-fixtures.js` が headless Chrome で最小のページに
trait-capture.mjs・css-rules-capture.mjs・要素スクリーンショットを当てて生成したもの（2 回採って一致を確かめている）。ツールや採取条件を変えたら同スクリプトで取り直し、`pnpm exec oxfmt` で整形する。
生成物どうしの整合（プロパティ集合・ツール版・計算値と規則の宣言・PNG の寸法・`axes.json` の再導出）は `scripts/parity-component-fixtures.test.js` が CI で検査する。
`component-api.md` / `parity.md` などエージェントが書く成果物は、生成物の値（幅・ツール版）に合わせて手で揃える。

**`build` の前段には姉妹スキル `parity-suite` もある。** 陳腐化の判定（`traits_version` / `traits_property_set` の突き合わせ）はインストール済み `parity-suite` の同梱ツールを読むので、
ハーネスが対象スキルしか設置しないと、先にそこで止まってカタログ未宣言を調べない run がスキルの記述に反せず出うる（Issue #357。iteration-4 の with は全部調べてから報告したので表面化しなかった）。
eval 5・6 は `evals.json` の `requires_skills` で `parity-suite` を両 configuration に併設させ（ハーネス側の契約は `docs/skill-development.md`「eval 実行の隔離（必須）」）、
`SKILL.md` の `build` 手順 1 に「宣言と採取物の実体を先に全部調べてから陳腐化へ進む」順序を定めてある。

## 実走の証拠の状態（iteration-2）

**前段ゲートを解消したうえで全 6 eval を再走した**（`with_skill` / `without_skill` 各 1 run、executor `claude-code`、model `opus`）。
1 run では分散を測れないので **Delta の数値は語らず、弁別が残っているかだけ**を見る（正本: `.agents/rules/eval-run-scope.md`）。

| eval | with | without | 弁別した assertion 数 |
|---|---|---|---|
| 1 前提未整備で停止 | 5/5 | 3/5 | 2 |
| 2 インスタンス 1 件 | 6/6 | 3/6 | 3 |
| 3 被覆表を見た目の根拠にしない | 4/4 | 4/4 | **0** |
| 4 来歴を確認できないデータ | 5/5 | 4/5 | 1 |
| 5 カタログ未宣言で停止 | 6/6 | 1/6 | **5** |
| 6 破壊的変更の判断を上げる | 4/5 → **5/5**（iteration-3） | 2/5 | 2 → **3** |

結果は `tests/parity-component/iteration-2/` にある。読み取れたことは 4 つ。

- **eval 5 は目的の分岐へ到達し、最も強く弁別した。** `with_skill` はカタログの契約ドキュメントと baseURL の欠落を挙げて停止し、
  併せて `build` の前提検証（採取物 8 組の実在確認・`--baseline` での軸の再導出と `axes.json` の一致・スクリプト版の突き合わせ）を実行している。
  `without_skill` は停止せず**部品を実装して見本まで書いた**（1/6）。前段ゲートを解消したことで、この eval が測りたかった差がそのまま出た
- **eval 3 は今回も弁別ゼロ**（上記「eval 3 は Delta ではなく後退検知」の再確認）。`without_skill` も被覆表が動作しか数えていないことを自力で述べた
- **eval 6 は iteration-2 で 4/5 だったのを直して iteration-3 で 5/5 にした。**
  落ちていたのは「引数を足して既定値を据え置く形で解けるか」という代替案（assertion 4）で、
  原因はスキルの記述不足ではなく **`with_skill` が明示の依頼を承認とみなし、「判断を求めるときは 3 つを示す」手順ごと飛ばしていた**こと。
  `references/amend.md` に「依頼を承認とみなさない（示したうえで改めて指示されたら従う）」を足したところ、
  3 点すべてを示すようになり弁別も 2 → 3 になった。詳細は [`tests/parity-component/iteration-3/benchmark.md`](../../../tests/parity-component/iteration-3/benchmark.md)。
  **以前記録していた 5/5・弁別 4 は到達しない fixture で測った値なので、これらと比較できない**
- **eval 1・2・4 に足した「停止の判断と矛盾する結論を述べていない」assertion は、今回いずれも `with_skill` / `without_skill` の両方が満たした。**
  否定形の assertion は停止した run では自動的に満たされやすく、弁別には寄与しない。**後退検知専用**として扱う

- **iteration-4（#354）で採取物を作り直した後、eval 5・6 を再走した。** eval 5 は with 6/6・without 1/6、eval 6 は with 5/5・without 2/5 で、
  どちらも目的の分岐へ到達した（`with_skill` は `axes.json` の再導出一致とツール版の一致を確かめたうえでカタログ未宣言で停止）。詳細は [`tests/parity-component/iteration-4/benchmark.md`](../../../tests/parity-component/iteration-4/benchmark.md)

- **iteration-5（PR #358 のレビュー対応）で `metadata.json` の `null` だった撮影条件・ノイズ基準値を採取から埋めて再走した。** 得点は iteration-4 と同じ（eval 5: 6/6 vs 1/6、eval 6: 5/5 vs 2/5）。詳細は [`tests/parity-component/iteration-5/benchmark.md`](../../../tests/parity-component/iteration-5/benchmark.md)

- **iteration-6（#357）で `requires_skills` による `parity-suite` の併設と `build` 手順 1 の判定順を入れ、カタログ記述を揃えて再走した。** 得点は同じ（eval 5: 6/6 vs 1/6、eval 6: 5/5 vs 2/5）。eval 5 は `parity-suite` 無しでもカタログ未宣言の分岐へ届いた。詳細は [`tests/parity-component/iteration-6/benchmark.md`](../../../tests/parity-component/iteration-6/benchmark.md)

- **iteration-7（PR #362 のレビュー対応）で `parity-suite` を baseline にも設置して `without_skill` を取り直した。** eval 5: 6/6 vs 3/6（弁別 3）、eval 6: 5/5 vs 3/5（弁別 2）。iteration-6 の Delta の一部は姉妹スキルの有無によるものだった。詳細は [`tests/parity-component/iteration-7/benchmark.md`](../../../tests/parity-component/iteration-7/benchmark.md)

### `without_skill` が見つけた fixture の欠陥（別 Issue へ）

eval 5 の `without_skill` は停止せず実装まで進んだため、fixture の中身を実装の材料として読み、こちらが気付いていなかった不整合を 3 件挙げた。
いずれも**採取物として不自然**で、`build` が採取物を材料にする以上は直す価値がある。**#354 で、採取物を実物のツールの出力で作り直して解消した**（上記「fixture の前段ゲート」）。

- `css-rules.json` の内容が `traits.json` の計算値と食い違う（users-create の hover で規則は `rgb(0, 70, 130)`、計算値は `rgb(221, 221, 221)`）。disabled の規則に `:disabled` が付いていないのに `unresolved` は 0 件
- `capture.tools.traits_property_set` に挙げた 6 プロパティ（`border-width` / `box-shadow` / `opacity` / `letter-spacing` / `text-align` / `text-transform`）が `computed` にも `axes.json` にも無い
- `element.png` が実際のボタンの画像ではなくプレースホルダなので、画素比較の入力にはならない

**入力（prompt・fixture・assertion）を変えたら、その eval の過去の結果は使えない。**
`scripts/skill-eval-fingerprint.js` が assertions を含めて指紋を取るため、baseline の再利用も拒否される。
