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
  --model opus

# fixture 付き eval（前提が揃った状態から始める。evals.json の "fixture" をスキルディレクトリ相対で解決する）
scripts/run-skill-eval.sh \
  --skill parity-component --config with_skill \
  --prompt "parity-component build --component button" \
  --fixture skills/parity-component/evals/fixtures/catalog-unset \
  --out tests/parity-component/iteration-1/eval-5/with_skill/run-1 \
  --model opus
```

- 使い捨てプロジェクトには `.replace/components.md`・設定が無いため、eval 1 は「捏造せず停止し `replace-strategy setup` を促す」パスを検証する
- eval 2〜6 は fixture で前提を揃えたうえで、**停止すべき場面で停止するか**と**判断をユーザーへ上げるか**を見る
- 採点は assertion のテキストで対応づける（位置で対応づけない）。出力内に矛盾があれば fail にする

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
