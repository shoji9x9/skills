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
| `catalog-unset` | 上記＋**採取成果物の実体**（`metadata.json` / `axes.json` / `component-api.md` / `gaps.md` / `baseline/`（2 インスタンス × 4 状態の特性と CSS 規則））。設定に `component_catalog` / `catalog_url` が無い | カタログ未宣言で `build` に入らず停止する |
| `breaking-change-request` | カタログ宣言済み・`build` 完了済み（`component-api.md` / `parity.md` / `build-metadata.json`） | 破壊的変更を自分で決めず判断を求める |

## fixture の前段ゲート

**対象分岐より手前で停止させないため、fixture は対象分岐までの全前段ゲートを満たす。**
`catalog-unset` は当初 `metadata.json` に `capture.complete: true` と書くだけで採取成果物の実体を置いておらず、
実走した run は「採取物の実体を伴わない記録」と正しく判定して `capture` からのやり直しを求めた
（カタログ未宣言という検証したい分岐へ到達しなかった）。成果物の実体を足して解消してある。

同様に、fixture の値どうしは整合させる。`breaking-change-request` の `component-api.md` は当初 `variant` の値集合を
6 値としていたが、採取済みインスタンスは 2 件で、2 件から割り出せるのは高々 2 値である
（「値の集合は採取物から列挙する」という本スキルの契約に反する）。実走した run がこの矛盾を指摘したため 2 値へ揃えた。

`catalog-unset` の `axes.json` は `axis-diff.mjs` を `baseline/` に対して実行した出力そのもの（手書きしない）。リポジトリのフォーマッタが JSON の空白を正規化するため整形は揃わないが、内容は実出力と一致する。`baseline/` を変えたら同じコマンドで取り直す。

## 実走の証拠の状態（この PR 時点）

**assertion の中には、まだ実走で裏取りしていないものがある。** 回帰テストとして扱う前にここを読む。

| 対象 | 状態 | 扱い |
|---|---|---|
| eval 1・2・4 に足した「停止の判断と矛盾する結論を述べていない」assertion | **未測定**。追加後に実走していない | **後退検知専用**として扱い、Delta の根拠にしない。到達性・弁別は次の実走で確かめる |
| eval 5 の 6/6 | **fixture の是正前に測った結果**（コントラスト比の修正・`axes.json` の実出力への差し替えより前） | 現 fixture がカタログ未宣言の分岐へ到達する証拠にはならない。**再走するまで被覆として数えない** |
| eval 6 の 5/5 | fixture 是正後に測定済み | 有効 |
| eval 3 | 弁別ゼロ（上記「eval 3 は Delta ではなく後退検知」） | 後退検知専用 |

**入力（prompt・fixture・assertion）を変えたら、その eval の過去の結果は使えない。**
`scripts/skill-eval-fingerprint.js` が assertions を含めて指紋を取るため、baseline の再利用も拒否される。
上表が空になるまでは、eval の結果を「この PR で検証済み」と報告しない。
