# ノイズ基準値・レジストリによる正規化とインスタンス例外

検出された候補（[`detect.md`](detect.md)）に、次の順で正規化を適用して機械分類する。**この工程は LLM に判断させない**（同梱 [`../scripts/diff-normalize.mjs`](../scripts/diff-normalize.mjs) が 1〜4 を機械分類する）。生き残った候補だけを [`triage.md`](triage.md) へ渡す。

## 適用順序

1. **意図的差異レジストリ** `intentional_diffs.{keep,may_change,pending}`: 宣言済みの差分を落とす。**`pending` 該当は未確定なので落とさず要確認扱い**（未収束として残す）。
   特性照合経路の照合キーは要素の `match`（下記「意図的差異の照合キー（`match`）」）。`match` を持たない散文だけの宣言は文全体の包含でしか当たらない
2. **コンポーネント系統差 T** `component_diffs[]`（`{component, property, current, new, reason}`）: 比較は「生の値が違うか」ではなく「新側の値が T から許容を超えて逸脱しているか」。
   **T に合致すれば吸収、逸脱すれば回帰候補として浮かせる。** 照合キーは `component`（対象要素の論理名 / glob）・`property`・値で、
   1 回の宣言が `component` に合致する全インスタンスに効く（下記「component_diffs T の照合方法」）。`references.ui_library`（旧→新 design token マッピング）を判断材料に読む
3. **インスタンス例外** `component_diff_exceptions`（本スキルが形式を定義する。フォールバック）: T が引けない箇所のみ。
   **置き場所は slug 成果物** `.replace/parity/<slug>/component-diff-exceptions.json`（設定ファイルではない。下記「インスタンス例外の置き場所」）
4. **ノイズ基準値** `metadata.json.noise_baseline[]`（page × state × viewport）: 現行を同一条件で 2 回撮った差分量。新側との差分がこれと同程度なら回帰ではない。
   レジストリで説明できなかった**残余へ集計で適用する**——個々の差分単位ではどれがノイズかを決められないため、残余の件数が該当組の `trait_diffs` 以下のときに限り全件を環境ノイズ候補に落とす。
   超えていれば 1 件も吸収しない（実回帰を黙って吸収しない）。基準値が無い組はノイズ判定せず候補として残す
5. **宣言できない構造差**: `.replace/parity/<slug>/gaps.md` の「宣言できない構造差」節にあるものは正規化対象外＝**未検証**として `diff.md` に転記する（確認済みにしない）

## レジストリの適用対象（どの経路の差に効くか）

**レジストリごとに効く経路が違う。** 効かない経路の差をそこへ宣言しても吸収されず、次の実行でも同じ差が `unexplained` として残る。

| レジストリ | 効く経路 | 適用する主体と照合キー |
|---|---|---|
| `intentional_diffs` | 全経路（散文の `item` を候補の説明に使う） | 特性照合経路は `diff-normalize.mjs`（要素の `match` で照合。下記「意図的差異の照合キー（`match`）」）、他経路は本スキルが `item` の語で照合する |
| `component_diffs`（T） | **特性照合経路のみ**（computed style・相対幾何を `component`〈論理名・glob〉 / `property` / `current` / `new` で照合する） | `diff-normalize.mjs`。**画素経路には効かない**（照合キーになる値の差が無いため）・aria にも効かない |
| `component_diff_exceptions`（`property` が CSS プロパティ） | 特性照合経路 | `diff-normalize.mjs`（page / state / viewport / element ＋ **値の一致**で照合） |
| `component_diff_exceptions`（`property: pixel`） | **画素経路のみ** | **本スキルが画素候補に対して適用する**（page / state / viewport / element / **`bbox`** で照合。値では照合しない） |

**`diff-normalize.mjs` の入力は `trait-compare.mjs` の出力だけであり、画素経路の候補（crop 対）は通らない。**
そのため `property: pixel` の例外を書いても同スクリプトは吸収しない——吸収は下記「画素経路の例外の適用」で本スキルが行う。
ここを取り違えると、承認して例外を書いたのに次の実行でも同じ crop が `unexplained` として再浮上する（この節が防ごうとしている状態そのもの）。

- **画素経路でしか出ない差**（現・新で computed style は一致するのにラスタライズ結果だけが違う。フォントのサブセットビルド差でグリッドフィッティングが変わる等）は、
  `component_diffs` に**系統差として 1 回で宣言できない**。T の照合は「baseline 値＝`current`・capture 値＝`new`」で行うため、両側の値が一致する差には掛かるキーが無い
- そのため画素経路のみの差は、系統的な原因であっても `component_diff_exceptions` へ**インスタンス単位**で書く（`property: pixel`）。
  同じ原因の複数インスタンスは、文言を揃えるのではなく `component_diff_exception_causes[]` に**原因を 1 回定義して `cause` で参照する**（下記「インスタンス例外のスキーマ」）。
  **命名規約ではなくスキーマで縛る**——「`reason` の冒頭を同じ原因ラベルで揃える」型の規約は守られなくても検出手段が無く、実際に同一原因の `reason` が全インスタンスへ複製される
- **SKILL.md の「インスタンス単位の無視リストで飲み込まない」はこの経路差の制約より優先されない。** 特性照合で値の差として出ている差分を、T を書かずにインスタンス例外へ落とすのが禁止対象であり、
  画素経路のみの差をインスタンス例外へ書くのは形式上の唯一の置き場所

## 意図的差異の照合キー（`match`）

**散文の宣言（`item`）は人が読むためのもので、照合キーにしない。** 宣言には理由・測定対象・決定者を書く（書くべきとされている）ので文が長くなり、
「文全体が差分の `"<name> <prop>"` に含まれるか」で照合すると、理由を添えた宣言は**原理的に一度も当たらない**（登録済みの差分が `unexplained` のまま残り、分類を人が手で書き直すことになる）。
特性照合経路の差分に効かせる宣言は、要素をオブジェクトにして照合キーを構造で持たせる。

```yaml
may_change:
  - item: "font-family の大文字小文字: 現行の計算後スタイルは Roboto（大文字）、新側は roboto。描画は同じ書体"
    match: { element: "grid-header-*", property: font-family }
```

| `match` のキー | 必須 | 照合 |
|---|---|---|
| `element` | 必須 | 差分の論理名（`trait-compare.mjs` の `name`）。`*` を含めば glob、含まなければ完全一致。幾何差分の `"A \| B"` は両側が照合候補（`component_diffs` の `component` と同じ規則。下記「component_diffs T の照合方法」） |
| `property` | 必須 | 差分の `prop`。`*` を含めば glob（`border-*-style`・`text[*]/font-family` 等）、含まなければ完全一致（大文字小文字は畳む） |
| `page` / `state` / `viewport` | 任意 | 書いたときだけ実行の組（`--page` / `--state` / `--viewport`）と完全一致で突き合わせる。**実行側に無ければ当たらない**（`state` だけは両側で既定値 `default` を補う） |

- **`match` のキーの欠落・空・未知のキー（`selector` 等）、`item` の欠落は「どれにでも合う」ではなく、その宣言を照合に使わない**（fail-closed。`item` が無いと棚卸しでも `matched_rule` でも宣言を追えない）。
  `diff-normalize.mjs` が `warning: intentional_diffs.<群>[<添字>]: ... — not used for matching` を stderr に出す
- **`match` を持つ宣言は `item` の文面では照合しない。** 文面が偶然 `"<name> <prop>"` を含んでも、`match` が指す要素・プロパティ以外には当たらない
- **`match` を持たない宣言**（素の文字列・`item` だけのオブジェクト）は、従来どおり文全体が `"<name> <prop>"` に含まれるときだけ当たる（`"heading border-top-style"` のような短い宣言は当たる）。
  **散文だけの宣言が 1 件の差分にも当たらず未説明が残った実行では**、`diff-normalize.mjs` が件数を stderr に出す
  （`warning: intentional_diffs: <N> of <M> prose-only declaration(s) (no match key) matched none ...`）。
  宣言の書き方の誤り（照合キーが無い）と本物の未説明の差を区別するためのもので、出たら該当しそうな宣言に `match` を足して実行し直す。
  **分母 `<M>` はレジストリ全体の散文だけの宣言**（レジストリは機能横断なので、この組・この機能に無関係な宣言も含む）。`<N>` が大きいこと自体は誤りではない
- **`matched_rule` には当たった宣言の `item` が入る**（`intentional_diffs.<群>: <item>`）。`diff.md` の根拠欄へそのまま写し、どの宣言で許容したかを追えるようにする
- **`match` を書き足すのは宣言の文言の変更ではない。** 照合の単位は `item` なので、`pending` から `keep` / `may_change` へ移すときも `match` ごと移してよい
  （要素の形の正本は `replace-strategy` の `references/project-config.md`「意図的差異レジストリ」）
- 画素経路・aria 経路の候補には `match` は効かない（論理名とプロパティを持たないため）。本スキルが `item` の語で候補を説明する

## component_diffs T の照合方法

**照合キーは `component`（要素）・`property`・値の 3 つ。** `component` は Diff の**論理名**（`trait-compare.mjs` の `name`）に対して照合する。DOM クラスの解決は行わない——宣言側が論理名の空間で要素を表す。

- **`kind: "text"` の Diff の `property` は `text[<i>]/<項目>`** で、`i` は要素の中で文字が現れる順番である。文言やデータで行の数が変わると同じ文字でも `i` がずれるので、
  複数のインスタンスへ効かせる宣言（`component_diffs`）に `text[<i>]/…` を書くときは、対象のインスタンスで文字の並びが同じことを確かめる
- **`kind: "scroll"` の Diff の `property` は `scroll/<項目>`**（`scroll/horizontal_bar_px`・`scroll/scrollbar-width`・`scroll/::-webkit-scrollbar-thumb/background-color` 等。器かどうかの差は `scroll`）。
  バーの厚み（`*_bar_px`）は採取環境のスクロールバーの厚みで決まるので、値を宣言に書くときは現側 `capture_conditions.scrollbar_environment` と同じ環境で撮った値であることを確かめる

- **`*` を含めば glob**（`*` は任意個の文字）、**含まなければ完全一致**。`filter-popup-*` のように書けば「1 回の宣言が全インスタンスに効く」T の性質を保ったまま、掛かる範囲が宣言に明示される（`*` 以外の正規表現メタ文字はリテラル）
- **幾何差分の `name` は `"A | B"` の対**（`trait-compare.mjs` が 2 要素の相対幾何をこの形で出す）。**両側が照合候補**で、片側が一致すれば掛かる
- `component` の一致を確かめたうえで、`property` が一致し baseline 値が `current`・capture 値が `new` と（単位正規化のうえ）一致するかを見る

| 条件 | 分類 |
|---|---|
| `component` 一致・`property` 一致・baseline＝`current`・capture＝`new` | 吸収（`absorbed_T`） |
| `component` 一致・`property` 一致・baseline＝`current`・capture≠`new` | **逸脱**（`deviates_T`。回帰候補として強調） |
| `component` が一致しない | 掛からない（`unexplained` として残りトリアージへ回る） |

**`component` の欠落・空は「どの要素にも合う」ではなく不一致として扱う（fail-closed）。** `component_diff_exceptions` の照合キー欠落と同じ規律で、`diff-normalize.mjs` は該当の宣言を照合に使わず、
`warning: component_diffs[<添字>]: missing component — not used for matching` を stderr に出す。

- 要素を照合しないと、**ある要素のために宣言した T が、値の偶然一致する別要素の差分にも当たる**。同じ `(property, current)` に複数の `new` が実在するのは珍しくない（余白のように初期値が要素間で共通なプロパティで、新側が要素ごとに違う値へ移ると自然にそうなる）
- 影響は 2 つで、**前者のほうが重大**:
  - **偽陰性**（`absorbed_T`・exit 0）: 別要素の本物の回帰を黙って吸収し、収束条件（[`convergence.md`](convergence.md)）を満たしてしまう＝**回帰を抱えたまま収束する**
  - **偽陽性**（`deviates_T`）: 本来 `unexplained`（トリアージ対象）である別要素の差分が「未修正回帰」へ格上げされ、`parity-replace` へ差し戻される
- 論理名を持たない Diff にも掛からない（特性照合の Diff は必ず論理名を持つため、名前が無い入力は照合キーを確かめられない＝不一致）

**既存宣言の移行**（`diff-normalize.mjs` の `VERSION` が `2` までの挙動＝`component` を照合に使わない、で書かれた宣言）:
`component` にコンポーネントクラス名を書いていて論理名と一致しない宣言は掛からなくなり、該当差分は `unexplained` として浮く（黙って吸収され続けるより安全側）。
**浮いた差分は「新しい回帰」ではなく「これまで要素を問わず吸収されていた差分」**なので、1 件ずつ対象要素を確かめて `component` を論理名 / glob へ書き換える。
書き換え後も残る差分は本物の未説明差分としてトリアージへ回す。

## インスタンス例外の置き場所（slug 成果物。設定ファイルではない）

**`component_diff_exceptions` は slug スコープのデータなので slug 成果物側に住む。** 設定ファイル（`.config/skills/shoji9x9/skills.yml`）には置かない——
設定は人間が確定させる方針の置き場所であり、本スキルが承認後に追記し続ける台帳を混ぜると、PR の diff で「環境設定の変更」と「差分を許容した記録」が区別できず、機能ブランチを並行させると同じファイル末尾で衝突する
（キーの書き手区分の正本は `replace-strategy` の `references/project-config.md`「キーの書き手とライフサイクル」）。

| ファイル | 内容 | 書き手 |
|---|---|---|
| `.replace/parity/<slug>/component-diff-exceptions.json` | 例外レジストリ本体（原因 ＋ インスタンス）。**パスは規約で固定**（設定で宣言しない。他の slug 成果物と同じ流儀） | 本スキル（ユーザー承認済みのみ・非破壊追記） |
| `.replace/parity/<slug>/component-diff-exceptions.md` | 承認済み例外の**根拠**（原因調査の経緯・観測条件・承認記録）。`component_diff_exception_causes[].evidence` の宛先 | 本スキル（様式の正本: [`../assets/component-diff-exceptions-template.md`](../assets/component-diff-exceptions-template.md)） |

- **根拠の宛先を `gaps.md` にしない。** `gaps.md` は未検証領域の台帳で、その「宣言できない構造差」節にあるものは正規化対象外＝未検証として毎回 `diff.md` へ転記される（上記「適用順序」5）。
  承認済み（説明済み・許容）の根拠を置くと未検証と混ざり、節の位置次第で収束判定の見え方が変わる
- **例外は環境非依存**（`new/<target>/` 配下に置かない）。slug 直下に置き、`gaps.md` / `porting.md` と同じ扱いにする。
  特定の target でだけ出る差は例外ではなく環境差であり、ノイズ基準値と新側の自己ノイズ（[`capture-new.md`](capture-new.md)）で扱う
- 旧スキーマ（設定ファイルの `skills.replace-strategy.component_diff_exceptions`）は**フォールバックとして読まない**。見つけたら移行手順を示して停止する
  （正本: `replace-strategy` の `references/project-config.md`「移行」。両方を読む・自動で移す、はしない）

## インスタンス例外のスキーマ（正本はここ）

T が引けない箇所のインスタンス単位フォールバック。**ユーザー承認済みのものだけを書く**（承認前の候補は `diff.md` 上の未説明差分のまま。`intentional_diffs.pending` にも書かない——未説明が残る＝未収束として扱う）。

**原因は 1 回だけ定義し、インスタンスはそれを参照する。** 同一原因の N インスタンスへ同じ文言を複製しない。

```json
{
  "version": 1,
  "slug": "<このファイルが住むディレクトリの slug>",
  "component_diff_exception_causes": [
    {
      "id": "<小文字英数とハイフン。このファイル内で一意。根拠 Markdown の見出しと同一文字列にする>",
      "reason": "<1〜2 行の識別ラベル。原因調査の経緯は書かず evidence 側に置く>",
      "evidence": "component-diff-exceptions.md#<同じ id>"
    }
  ],
  "component_diff_exceptions": [
    {
      "slug": "<slug。照合の安全弁として各インスタンスに持つ>",
      "page": "<ページ>",
      "element": "<論理名。無ければ none>",
      "state": "<状態。既定 default>",
      "viewport": "<viewport label>",
      "property": "<CSS プロパティ。画素経路のみで拾った差は pixel>",
      "bbox": "<property: pixel のときだけ必須。pixel-crops.mjs が出した候補の bbox「x,y,w,h」（regions[].bbox か strict_only_regions[].bbox。threshold_bbox ではない。現側 crop の座標）。照合キーはこれ>",
      "current": "<旧値。property: pixel のときは crop への相対パス（実行ごとに変わるため照合キーにしない＝根拠）>",
      "new": "<新値。同上>",
      "cause": "<component_diff_exception_causes[].id。必須>",
      "approved_at": "<ユーザー承認の日時（ISO 8601）。そのインスタンスを覆った原因単位の承認の日時>"
    }
  ]
}
```

- **インスタンスに `reason` を持たせない。** 原因の文言は `component_diff_exception_causes[]` にだけ置く（フィールドが無いので複製が構造的に起こらない）
- **`approved_at` は原因の承認日時。** 承認は原因単位で取るため（正本: [`triage.md`](triage.md)「承認の単位は原因」）、
  **同じ承認で覆ったインスタンス**には**同じ日時**が入る（承認後に増えたインスタンスは、その増分の承認の日時。承認記録の累計 N と `cause` 参照数を一致させる）
- **`cause` は単発の例外でも必須。** インスタンスが 1 件しか無い原因も `causes` に 1 件立てる（根拠の枠が常に付き、後から同原因が増えたときは薄い参照を足すだけで済む）
- **インスタンス件数を畳まない。** `page` / `element` / `bbox` にワイルドカードを置いて 1 エントリで N 箇所を吸収させない——
  **例外の件数は検証の弱さのシグナル**であり、行数削減のために件数を隠すと弱さが見えなくなる（1 原因 ＋ N 個の薄い参照にする）。
  **照合キーの省略もワイルドカードにならない**（`page` / `viewport` / `element` を省いた例外は照合に使われない。`state` だけはスキーマの既定値 `default` を補う）。
  **同じことが実行側にも効く**——`--page` / `--viewport` を省いた実行では「どの組の候補か」を確かめられないため例外は 1 件も適用されず、その旨が stderr に出る（下記「diff-normalize.mjs の実行」）
- **`element: none` は「論理名が無い要素」を指すスキーマ値で、match-all ではない。** 特性照合の Diff は必ず論理名を持つため `none` の例外はその経路では合致しない
  （画素経路の候補に対して本スキルが適用する。下記「画素経路の例外の適用」）
- **照合キーはインスタンス側にだけある。** `causes` は `reason` / `evidence` を共有するだけで照合に一切関与しない（原因を足しても吸収範囲は変わらない）
- **承認済み例外の件数は `diff-metadata.json` の `accepted_exceptions`（原因数・インスタンス数）に記録する**（`replace-strategy status` が読める形で件数を残す。様式の正本は [`../assets/diff-metadata-template.json`](../assets/diff-metadata-template.json)）
- **fail-closed の検証**: `cause` が `component_diff_exception_causes[].id` に解決できない／解決先の `evidence` が空／`slug` がファイルの `slug` と違う／照合キー（`page` / `viewport` / `element`）が欠けている——いずれのインスタンスも**照合に使わず**、
  該当候補は `unexplained` のまま残す。不整合は `diff.md` に明記する（黙って吸収しない・黙って捨てない）。検証の実施箇所は下記「registries.json の組み立て」と `diff-normalize.mjs`

## 画素経路の例外の適用（`property: pixel`）

`diff-normalize.mjs` は特性照合の Diff しか見ないため、画素候補への例外適用は**本スキルがこの工程で行う**。判断は挟まず、次の機械的な一致だけで落とす。

- **照合キーは `slug` / `page` / `state` / `viewport` / `element`（無ければ `none`）/ `bbox`。** `bbox` は `pixel-crops.mjs` が出した候補の `bbox`
  （`regions[].bbox` か `strict_only_regions[].bbox`）と、`metadata.json.differ.align_tolerance` の範囲で一致すること（座標は現側 crop 基準）
- **同じ場所の 1 つの差は 1 つの候補であり、台帳には 1 件で書く。** 芯がしきい値を超え縁がしきい値の内側に収まる差（アイコンの輪郭のにじみ等）は、
  `pixel-crops.mjs` が縁を芯の領域へ取り込み、**外側の bbox を持つ 1 件の `regions[]`** として出す（取り込んだ縁の画素数は `absorbed_strict_only_pixels`、芯を包む bbox は `threshold_bbox`。
  正本は [`detect.md`](detect.md)）。台帳の `bbox` にはこの**候補の `bbox`**（外側）を書き、`threshold_bbox` は書かない。
  芯＋`--pad` の範囲の縁と、候補の bbox の内側にある strict-only の画素は必ずその候補に入るので、**縁が `--pad` の内側に収まる差は 1 件になる**。
  **縁が `--pad` より外まで続く差**（box-shadow のぼかし差等）は、芯の `regions[]` と外側の `strict_only_regions[]` の 2 件に分かれうる
  （取り込みを芯＋`--pad` に限るのは、ページ全体に広がる差が全領域を画面大の候補 1 件に潰さないため）。分かれた外側の候補は
  `overlaps_regions` に隣り合う `regions[]` の `id` を持ち、stderr に警告が出る。**このときは候補ごとに 1 件ずつ台帳に書き、同じ `cause` を参照する**
  （照合は候補の bbox の一致なので、片方だけ書くともう片方が `unexplained` に残る。承認は原因単位なので 1 回で足りる）
  （`pixel-crops.mjs` の `VERSION` が `3` までの出力は分かれていた。その出力に合わせて書いた台帳は、取り直した候補の外側の bbox に書き換える）
- **`current` / `new`（crop への相対パス）は照合キーにしない。** 実行ごとに変わるため、値一致で照合すると毎回不一致になり例外が効かない。両者は承認時の根拠として保持する
- **キーが揃わない候補は落とさない**（`unexplained` のまま残す）。bbox が動いた＝差の位置が変わったということなので、同じ例外で吸収してよい保証がない
- **`cause` が解決できないインスタンスは照合に使わない**（上記「fail-closed の検証」と同じ扱い。画素経路は本スキルが適用するため、この解決も本スキルが行う）
- 適用した例外と、その `bbox` の実測ずれ・**吸収した原因（`cause` の id と `reason`）**を `diff.md` の差分一覧に残す（どの例外がどの候補を吸収したか、どの原因に帰属するかを追えるようにする）

## diff-normalize.mjs の実行

```text
node <スキルディレクトリ>/scripts/diff-normalize.mjs <trait-diffs.json> --registries <registries.json> --slug <slug> [--page <p> --state <s> --viewport <v>] [--noise <metadata.json>]
```

- `<trait-diffs.json>` は `trait-compare.mjs` の出力（Diff 配列）
- `--registries <registries.json>`: 下記「registries.json の組み立て」で作ったものを渡す（YAML パーサを同梱しないため。skills.yml も例外ファイルも直接渡さない）
- `--noise <metadata.json>`: `noise_baseline[]` を読むために `parity-suite` の `metadata.json` を渡す
- 出力は各 Diff に `classification`（`absorbed_registry` / `absorbed_T` / `deviates_T` / `absorbed_exception` / `noise_candidate` / `pending_review` / `unexplained`）と `matched_rule` を付けた JSON。
  `absorbed_exception` の `matched_rule` には解決済みの原因（`cause_reason` / `cause_evidence`）が入る
- **意図的差異の `match` の不整合は `intentional_diffs.<群>[<添字>]: ...` の形で stderr に警告として出る**（上記「意図的差異の照合キー（`match`）」）。
  警告が出た宣言は照合に使われていないので、設定ファイルの `match` を直して実行し直す。散文だけの宣言が当たらなかった件数（`intentional_diffs: <N> of <M> prose-only ...`）も同じく stderr に出る。
  どちらも台帳（例外）の不整合ではないので `diff-metadata.json.accepted_exceptions.unresolved` には数えない
- **T の不整合は `component_diffs[<添字>]: ...` の形で stderr に警告として出る**（`component` の欠落・空。上記「component_diffs T の照合方法」）。
  **警告が出た T は照合に使われていない**ので、設定ファイルの宣言に対象要素の論理名 / glob を補って実行し直す。
  台帳（例外）の不整合ではないので `diff-metadata.json.accepted_exceptions.unresolved` には数えない
- 例外の不整合（上記「fail-closed の検証」の各条件）は `component_diff_exceptions[<添字>]: ...` の形で stderr に警告として出る。**警告が出た例外は照合に使われていない**ので、`diff.md` の不整合として記録して直す。
  **`diff-metadata.json.accepted_exceptions.unresolved` に数えるのはこの添字つき警告（＝台帳のインスタンス単位の不整合）だけ**
- **`--page` / `--state` / `--viewport` は組ごとに必ず渡す。** `--page` / `--viewport` を省くと照合キーを確かめられず例外は 1 件も適用されないため、
  その旨も stderr に出る（`--state` の省略だけは両側で既定値 `default` として突き合わせる）。
  **この警告は実行側の誤りであって台帳の不整合ではないので `unresolved` に数えない**——キーを渡して実行し直す（数えると台帳が健全でも不整合に見え、収束判定が読めなくなる）
- 終了コード 0=全て吸収（要対応なし）/ 1=`unexplained` または `deviates_T` または `pending_review` あり / 2=入力エラー

### registries.json の組み立て

**2 つのソースからキーを名前を変えずに集めるだけ**にする（対応表を書かない——名前を付け替える工程は join のミスが混入する場所になる）。

| registries.json のキー | ソース |
|---|---|
| `intentional_diffs` | 設定ファイルの `skills.replace-strategy.intentional_diffs` |
| `component_diffs` | 同 `skills.replace-strategy.component_diffs` |
| `component_diff_exception_causes` | `.replace/parity/<slug>/component-diff-exceptions.json` の同名キー |
| `component_diff_exceptions` | 同ファイルの同名キー |

- **`intentional_diffs.pending` の要素はオブジェクト**（`item` / `slug` / `added_by` / `added_at`）で、**照合に使うのは `item`**（素の文字列の旧形式も読む。要素の形の正本は `replace-strategy` の `references/project-config.md`「`pending` 要素の形」）。
  **キーを名前を変えずに集める**原則どおり、`item` だけを抜き出して文字列配列へ潰さない——潰すと [`../scripts/pending-triage-check.mjs`](../scripts/pending-triage-check.mjs) が帰属（`slug`）を読めず、全件が帰属不明になる
- **棚卸しの判定に渡す `registries.json` は、人が `keep` / `may_change` へ移した後の設定ファイルから組み立て直す**（[`convergence.md`](convergence.md)「`intentional_diffs.pending` の棚卸し」）。
  正規化のときに作ったスナップショットを使い回すと、移動済みの要素が `pending` に残って見え、正しく確定させた記録が「移したと記録されているが `pending` に残っている」「移動先に見つからない」の不整合として落ちる（組み立て方は同じ、読む時点だけが違う）
- **例外ファイルが無ければ後者 2 キーは空配列**にする（例外ゼロ。停止しない）
- **ファイルの `slug` が対象 slug と違えば停止する**（別 slug の台帳を読んでいる。空として黙って進めない）
- **原因の文言をインスタンスへ展開しない。** 解決は `diff-normalize.mjs`（特性照合経路）と本スキル（画素経路）が照合時に行う。組み立て時に展開すると複製が復活する

## コンポーネント比較の方針

- **カタログサイト（コンポーネントライブラリの見本）・部品ベンダーの機能一覧を比較の正解にしない。** 正解は動いている現行アプリ
- どちらの用途も**状態網羅リスト**（どの状態・バリアント・操作が存在するかの参照）に限る（列挙の使い方の正本は `parity-suite` の `references/coverage.md`「状態網羅の導出源」）
- Storybook を使う場合も突き合わせるのは computed style のみ可で、**現行アプリから抽出した値と比較する**（Storybook 同士・カタログ同士で突き合わせない）
- **ピクセル比較系 VRT ツールで新旧を突き合わせない**（実装が違えば全面赤になり無意味）
