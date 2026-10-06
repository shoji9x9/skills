# ノイズの基準値とレジストリによる正規化と、インスタンス例外

検出した候補（[`detect.md`](detect.md)）に、次の順で正規化を当てて機械的に分類する。
この工程は LLM に判断させない（同梱の [`../scripts/diff-normalize.mjs`](../scripts/diff-normalize.mjs) が 1〜4 を機械的に分類する）。
残った候補だけを [`triage.md`](triage.md) へ渡す。

## 適用順序

1. 意図的差異のレジストリ `intentional_diffs.{keep,may_change,pending}`: 宣言した差分を除く。
   `pending` に当たるものはまだ決まっていないので、除かずに確認が要るものとして扱う（未収束として残す）。
   特性照合の差分の照合キーは、要素の `match` である（下の「意図的差異の照合キー（`match`）」）。`match` を持たない散文だけの宣言は、文全体を含むかどうかでしか当たらない
2. コンポーネントの系統差 T `component_diffs[]`（`{component, property, current, new, reason}`）: 「生の値が違うか」ではなく、「新側の値が T から許容を超えてずれているか」で比べる。
   T に合えば吸収し、ずれていれば回帰の候補として示す。照合キーは `component`（対象の要素の論理名か glob）・`property`・値である。
   1 回の宣言が、`component` に合うすべてのインスタンスに当たる（下の「component_diffs T の照合方法」）。`references.ui_library`（旧から新への design token の対応表）を判断の材料に読む
3. インスタンス例外 `component_diff_exceptions`（このスキルが形式を定める。T で扱えないときの代わりの手段）: T で扱えない箇所だけに使う。
   置き場所は slug の成果物 `.replace/parity/<slug>/component-diff-exceptions.json` である（設定ファイルではない。下の「インスタンス例外の置き場所」）
4. ノイズの基準値 `metadata.json.noise_baseline[]`（page × state × viewport）: 現行を同じ条件で 2 回撮ったときの差分の量である。新側との差分がこれと同じくらいなら、回帰ではない。
   レジストリで説明できなかった残りの差分に、まとめて当てる。差分を 1 件ずつ見ても、どれがノイズかは決められないからである。
   残りの件数がその組の `trait_diffs` 以下のときだけ、すべてを環境のノイズの候補にする。
   超えていれば 1 件も吸収しない（本物の回帰を警告なしに吸収しない）。基準値が無い組はノイズかどうかを判定せず、候補として残す
5. 宣言できない構造の差: `.replace/parity/<slug>/gaps.md` の「宣言できない構造差」の節にあるものは、正規化の対象外である。未検証として `diff.md` に転記する（確認済みにしない）

## レジストリの適用対象（どの比較の差に当たるか）

レジストリごとに、当たる比較の方法が違う。当たらない方法の差をそこへ宣言しても吸収されず、次の実行でも同じ差が `unexplained` として残る。

| レジストリ | 当たる比較 | 当てる主体と照合キー |
|---|---|---|
| `intentional_diffs` | すべての比較（散文の `item` を候補の説明に使う） | 特性照合は `diff-normalize.mjs` が当てる（要素の `match` で照合する。下の「意図的差異の照合キー（`match`）」）。他の比較は、このスキルが `item` の語で照合する |
| `component_diffs`（T） | 特性照合だけ（computed style と相対的な位置・大きさを、`component`〈論理名・glob〉・`property`・`current`・`new` で照合する） | `diff-normalize.mjs`。画素の比較には当たらない（照合キーになる値の差が無いため）。aria にも当たらない |
| `component_diff_exceptions`（`property` が CSS プロパティ） | 特性照合 | `diff-normalize.mjs`（page・state・viewport・element と、値の一致で照合する） |
| `component_diff_exceptions`（`property: pixel`） | 画素の比較だけ | このスキルが画素の候補に当てる（page・state・viewport・element・`bbox` で照合する。値では照合しない） |

`diff-normalize.mjs` が読むのは `trait-compare.mjs` の出力だけで、画素の比較の候補（crop の対）は通らない。
そのため、`property: pixel` の例外を書いても、このスクリプトは吸収しない。吸収は、下の「画素の比較の例外の適用」でこのスキルが行う。
ここを取り違えると、承認して例外を書いたのに、次の実行でも同じ crop が `unexplained` としてまた出る（この節が防ごうとしている状態である）。

- 画素の比較でしか出ない差は、`component_diffs` に系統差として 1 回で宣言できない。
  たとえば、現と新で computed style は一致するのに、ラスタライズした結果だけが違う差である（フォントのサブセットのビルドの差で、グリッドフィッティングが変わるなど）。
  T は「baseline の値が `current`、capture の値が `new`」で照合するので、両側の値が一致する差には当てるキーが無い
- そのため、画素の比較でしか出ない差は、系統的な原因があってもインスタンスごとに `component_diff_exceptions` へ書く（`property: pixel`）。
  同じ原因のインスタンスが複数あるときは、文言をそろえるのではなく、`component_diff_exception_causes[]` に原因を 1 回だけ定義して、`cause` で参照する（下の「インスタンス例外のスキーマ」）。
  名前の付け方の取り決めではなく、スキーマで縛る。「`reason` の先頭を同じ原因のラベルでそろえる」という取り決めは、守られなくても検出できず、実際に同じ原因の `reason` がすべてのインスタンスへ複製される
- SKILL.md の「インスタンス単位の無視リストで飲み込まない」は、この比較の方法による制約より優先されない。
  禁止しているのは、特性照合で値の差として出ている差分を、T を書かずにインスタンス例外にすることである。
  画素の比較でしか出ない差をインスタンス例外に書くのは、形式の上でそこが唯一の置き場所だからである

## 意図的差異の照合キー（`match`）

散文の宣言（`item`）は人が読むためのもので、照合キーにしない。
宣言には理由・測定の対象・決めた人を書くので、文が長くなる。
「文全体が差分の `"<name> <prop>"` に含まれるか」で照合すると、理由を添えた宣言は一度も当たらない。登録した差分が `unexplained` のまま残り、人が分類を手で書き直すことになる。
特性照合の差分に当てる宣言は、要素をオブジェクトにして、照合キーを構造で持たせる。

```yaml
may_change:
  - item: "font-family の大文字小文字: 現行の計算後スタイルは Roboto（大文字）、新側は roboto。描画は同じ書体"
    match: { element: "grid-header-*", property: font-family }
```

| `match` のキー | 必須 | 照合 |
|---|---|---|
| `element` | 必須 | 差分の論理名（`trait-compare.mjs` の `name`）。`*` を含めば glob、含まなければ完全一致。位置と大きさの差分の `"A \| B"` は、両側を照合の候補にする（`component_diffs` の `component` と同じ規則。下の「component_diffs T の照合方法」） |
| `property` | 必須 | 差分の `prop`。`*` を含めば glob（`border-*-style`・`text[*]/font-family` など）、含まなければ完全一致（大文字と小文字は区別しない） |
| `page` / `state` / `viewport` | 任意 | 書いたときだけ、実行の組（`--page`・`--state`・`--viewport`）と完全一致で突き合わせる。実行の側に無ければ当たらない。その件数を `warning: --page not given; <N> intentional_diffs declaration(s) with match.page / match.viewport ...` として stderr に出す。`state` だけは、両側でデフォルトの `default` を補う |

- `match` のキーが欠けている・空・知らないキー（`selector` など）であるとき、`item` が欠けているときは、「どれにでも合う」とは扱わず、その宣言を照合に使わない。
  判定できない宣言は、合わないものとして扱う。`item` が無いと、棚卸しでも `matched_rule` でも宣言を追えない。
  `diff-normalize.mjs` が `warning: intentional_diffs.<群>[<添字>]: ... — not used for matching` を stderr に出す
- `match` を持つ宣言は、`item` の文面では照合しない。文面がたまたま `"<name> <prop>"` を含んでいても、`match` が指す要素とプロパティ以外には当たらない
- `match` を持たない宣言（ただの文字列と、`item` だけのオブジェクト）は、これまでどおり、文全体が `"<name> <prop>"` に含まれるときだけ当たる（`"heading border-top-style"` のような短い宣言は当たる）。
  散文だけの宣言が 1 件の差分にも当たらず、説明の無い差分が残った実行では、`diff-normalize.mjs` がその件数を stderr に出す。
  出す警告は `warning: intentional_diffs: <N> of <M> prose-only declaration(s) (no match key) matched none ...` である。
  これは、宣言の書き方の誤り（照合キーが無い）と本物の説明の無い差を区別するためのものである。出たら、当たりそうな宣言に `match` を足して実行し直す。
  分母の `<M>` は、レジストリ全体の散文だけの宣言の数である（レジストリは機能をまたぐので、この組やこの機能に関係ない宣言も含む）。`<N>` が大きいこと自体は誤りではない
- `matched_rule` には、当たった宣言の `item` が入る（`intentional_diffs.<群>: <item>`）。`diff.md` の根拠の欄へそのまま転記し、どの宣言で許容したかを追えるようにする
- `match` を書き足すことは、宣言の文言を変えることではない。照合の単位は `item` なので、`pending` から `keep` や `may_change` へ移すときも、`match` ごと移してよい
  （要素の形の原本は、`replace-strategy` の `references/project-config.md`「意図的差異レジストリ」）
- 画素の比較と aria の比較の候補には、`match` は当たらない（論理名とプロパティを持たないため）。このスキルが `item` の語で候補を説明する

## component_diffs T の照合方法

照合キーは、`component`（要素）・`property`・値の 3 つである。`component` は、Diff の論理名（`trait-compare.mjs` の `name`）に対して照合する。
DOM のクラスは解決しない。宣言の側が、論理名で要素を表す。

- `kind: "text"` の Diff の `property` は `text[<i>]/<項目>` で、`i` は要素の中で文字が現れる順番である。
  文言やデータで行の数が変わると、同じ文字でも `i` がずれる。
  そのため、複数のインスタンスへ当てる宣言（`component_diffs`）に `text[<i>]/…` を書くときは、対象のインスタンスで文字の並びが同じことを確かめる
- `kind: "scroll"` の Diff の `property` は `scroll/<項目>` である。
  例は `scroll/horizontal_bar_px`・`scroll/scrollbar-width`・`scroll/::-webkit-scrollbar-thumb/background-color` である。スクロールする要素かどうかの差は `scroll` になる。
  バーの厚み（`*_bar_px`）は、採取した環境のスクロールバーの厚みで決まる。
  そのため、値を宣言に書くときは、現側の `capture_conditions.scrollbar_environment` と同じ環境で撮った値であることを確かめる

- `*` を含めば glob（`*` は任意の数の文字）で、含まなければ完全一致である。
  `filter-popup-*` のように書けば、「1 回の宣言がすべてのインスタンスに当たる」という T の性質を保ったまま、当たる範囲を宣言に明示できる（`*` 以外の正規表現のメタ文字は、文字どおりに扱う）
- 位置と大きさの差分の `name` は、`"A | B"` の対である（`trait-compare.mjs` は、2 つの要素の相対的な位置と大きさをこの形で出す）。両側を照合の候補にし、片側が一致すれば当たる
- `component` が一致することを確かめてから、`property` が一致し、baseline の値が `current`、capture の値が `new` と（単位をそろえたうえで）一致するかを見る

| 条件 | 分類 |
|---|---|
| `component` が一致し、`property` が一致し、baseline が `current`、capture が `new` と等しい | 吸収（`absorbed_T`） |
| `component` が一致し、`property` が一致し、baseline が `current` と等しく、capture が `new` と違う | ずれ（`deviates_T`。回帰の候補として強調する） |
| `component` が一致しない | 当たらない（`unexplained` として残り、トリアージへ回る） |

`component` が欠けているか空のときは、「どの要素にも合う」とは扱わず、一致しないものとして扱う。
`component_diff_exceptions` の照合キーが欠けているときと同じ扱いで、`diff-normalize.mjs` はその宣言を照合に使わない。
そして `warning: component_diffs[<添字>]: missing component — not used for matching` を stderr に出す。

- 要素を照合しないと、ある要素のために宣言した T が、値がたまたま一致する別の要素の差分にも当たる。
  同じ `(property, current)` に複数の `new` が実在するのは、珍しくない。余白のように初期値が要素の間で共通なプロパティで、新側が要素ごとに違う値に変わると、自然にそうなる
- 影響は 2 つあり、前者のほうが重い。
  - 見逃し（偽陰性。`absorbed_T`・exit 0）: 別の要素の本物の回帰を警告なしに吸収し、収束の条件（[`convergence.md`](convergence.md)）を満たしてしまう。**回帰を抱えたまま収束する**
  - 誤検知（`deviates_T`）: 本来は `unexplained`（トリアージの対象）である別の要素の差分が「直していない回帰」に格上げされ、`parity-replace` へ差し戻される
- 論理名を持たない Diff にも当たらない。特性照合の Diff は必ず論理名を持つので、名前が無い入力は照合キーを確かめられず、一致しないものとして扱う

既にある宣言の移行（`diff-normalize.mjs` の `VERSION` が `2` までの振る舞い、つまり `component` を照合に使わない前提で書いた宣言）は、次のようにする。
`component` にコンポーネントのクラス名を書いていて論理名と一致しない宣言は当たらなくなり、その差分は `unexplained` として出てくる（警告なしに吸収され続けるよりも安全である）。
出てきた差分は「新しい回帰」ではなく、「これまで要素に関係なく吸収されていた差分」である。1 件ずつ対象の要素を確かめて、`component` を論理名か glob に書き換える。
書き換えた後も残る差分は、本物の説明の無い差分として、トリアージへ回す。

## インスタンス例外の置き場所（slug 成果物。設定ファイルではない）

`component_diff_exceptions` は slug の範囲のデータなので、slug の成果物の側に置く。設定ファイル（`.config/skills/shoji9x9/skills.yml`）には置かない。
設定は、人が決めた方針を置く場所である。このスキルが承認の後に追記し続ける台帳をそこに入れると、PR の diff で「環境の設定の変更」と「差分を許容した記録」を区別できない。
機能のブランチを並行させると、同じファイルの末尾で衝突もする（キーの書き手の区分の原本は、`replace-strategy` の `references/project-config.md`「キーの書き手とライフサイクル」）。

| ファイル | 内容 | 書き手 |
|---|---|---|
| `.replace/parity/<slug>/component-diff-exceptions.json` | 例外のレジストリの本体（原因とインスタンス）。パスは取り決めで固定する（設定で宣言しない。他の slug の成果物と同じやり方） | このスキル（ユーザーが承認したものだけを、消さずに追記する） |
| `.replace/parity/<slug>/component-diff-exceptions.md` | 承認した例外の根拠（原因を調べた経緯・観測した条件・承認の記録）。`component_diff_exception_causes[].evidence` が指す先 | このスキル（様式の原本は [`../assets/component-diff-exceptions-template.md`](../assets/component-diff-exceptions-template.md)） |

- 根拠の置き先を `gaps.md` にしない。`gaps.md` は未検証領域の台帳で、その「宣言できない構造差」の節にあるものは正規化の対象外として、毎回 `diff.md` へ未検証として転記される（上の「適用順序」の 5）。
  承認した（説明して許容した）根拠を置くと未検証のものと混在し、節の位置によって収束の判定の見え方が変わる
- 例外は環境に依存しない（`new/<target>/` の下に置かない）。slug の直下に置き、`gaps.md` や `porting.md` と同じように扱う。
  特定の target でだけ出る差は、例外ではなく環境の差である。ノイズの基準値と新側の自己ノイズ（[`capture-new.md`](capture-new.md)）で扱う
- 旧スキーマ（設定ファイルの `skills.replace-strategy.component_diff_exceptions`）は、代わりに読むことをしない。見つけたら移行の手順を示して止まる
  （原本は `replace-strategy` の `references/project-config.md`「移行」。両方を読むことも、自動で移すこともしない）

## インスタンス例外のスキーマ（原本）

T で扱えない箇所に、インスタンスごとに当てる代わりの手段である。ユーザーが承認したものだけを書く。
承認の前の候補は、`diff.md` の上の説明の無い差分のままにする。`intentional_diffs.pending` にも書かない（説明の無い差分が残る状態は、未収束として扱う）。

原因は 1 回だけ定義し、インスタンスはそれを参照する。同じ原因の N 件のインスタンスへ、同じ文言を複製しない。

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
      "property": "<CSS プロパティ。画素の比較のみで拾った差は pixel>",
      "bbox": "<property: pixel のときだけ必須。pixel-crops.mjs が出した候補の bbox「x,y,w,h」（regions[].bbox か strict_only_regions[].bbox。threshold_bbox ではない。現側 crop の座標）。照合キーはこれ>",
      "current": "<旧値。property: pixel のときは crop への相対パス（実行ごとに変わるため照合キーにしない＝根拠）>",
      "new": "<新値。同上>",
      "cause": "<component_diff_exception_causes[].id。必須>",
      "approved_at": "<ユーザー承認の日時（ISO 8601）。そのインスタンスを覆った原因単位の承認の日時>"
    }
  ]
}
```

- インスタンスに `reason` を持たせない。原因の文言は `component_diff_exception_causes[]` にだけ置く（フィールドが無いので、複製が構造の上で起こらない）
- `approved_at` は、原因を承認した日時である。承認は原因ごとに取る（原本は [`triage.md`](triage.md)「承認の単位は原因」）。
  そのため、同じ承認で扱ったインスタンスには、同じ日時が入る。承認の後に増えたインスタンスには、その増えた分を承認した日時を入れる。承認の記録の累計 N と、`cause` の参照の数を一致させる
- `cause` は、例外が 1 件だけでも必須である。インスタンスが 1 件しか無い原因も、`causes` に 1 件立てる（根拠の枠が常に付き、後から同じ原因が増えたときは参照を足すだけで済む）
- インスタンスの件数をまとめない。`page`・`element`・`bbox` にワイルドカードを置いて、1 件のエントリで N か所を吸収させない。
  例外の件数は、検証が弱いことを示す。行数を減らすために件数を隠すと、弱さが見えなくなる（1 件の原因と、N 件の参照にする）。
  照合キーを省いても、ワイルドカードにはならない（`page`・`viewport`・`element` を省いた例外は照合に使われない。`state` だけはスキーマのデフォルトの `default` を補う）。
  同じことは実行の側にも当てはまる。`--page` か `--viewport` を省いた実行では「どの組の候補か」を確かめられないので、例外は 1 件も当たらず、そのことが stderr に出る（下の「diff-normalize.mjs の実行」）
- `element: none` は「論理名が無い要素」を指すスキーマの値で、すべてに合うという意味ではない。特性照合の Diff は必ず論理名を持つので、`none` の例外は特性照合では合わない
  （画素の比較の候補に対して、このスキルが当てる。下の「画素の比較の例外の適用」）
- 照合キーは、インスタンスの側にだけある。`causes` は `reason` と `evidence` を共有するだけで、照合にはまったく関わらない（原因を足しても、吸収する範囲は変わらない）
- 承認した例外の件数は、`diff-metadata.json` の `accepted_exceptions`（原因の数とインスタンスの数）に記録する。`replace-strategy status` が読める形で件数を残すためである（様式の原本は [`../assets/diff-metadata-template.json`](../assets/diff-metadata-template.json)）
- 判定できないインスタンスは照合に使わない。次のどれかに当たるインスタンスは照合に使わず、その候補は `unexplained` のまま残す。
  - `cause` が `component_diff_exception_causes[].id` に解決できない。
  - 解決した先の `evidence` が空である。
  - `slug` がファイルの `slug` と違う。
  - 照合キー（`page`・`viewport`・`element`）が欠けている。

  不整合は `diff.md` に書く（警告なしに吸収しない。警告なしに捨てない）。この確認をする場所は、下の「registries.json の組み立て」と `diff-normalize.mjs` である

## 画素の比較の例外の適用（`property: pixel`）

`diff-normalize.mjs` は特性照合の Diff しか見ないので、画素の候補への例外は、このスキルがこの工程で当てる。判断は挟まず、次の機械的な一致だけで除く。

- 照合キーは、`slug`・`page`・`state`・`viewport`・`element`（無ければ `none`）・`bbox` である。
  `bbox` は、`pixel-crops.mjs` が出した候補の `bbox`（`regions[].bbox` か `strict_only_regions[].bbox`）と、`metadata.json.differ.align_tolerance` の範囲で一致すること（座標は現側の crop を基準にする）
- 同じ場所の 1 つの差は 1 つの候補であり、台帳には 1 件で書く。
  芯がしきい値を超え、縁がしきい値の内側に収まる差（アイコンの輪郭のにじみなど）は、`pixel-crops.mjs` が縁を芯の領域に取り込み、外側の bbox を持つ 1 件の `regions[]` として出す。
  取り込んだ縁の画素の数は `absorbed_strict_only_pixels`、芯を包む bbox は `threshold_bbox` に出る（原本は [`detect.md`](detect.md)）。
  台帳の `bbox` には、この候補の `bbox`（外側）を書き、`threshold_bbox` は書かない。
  芯と `--pad` の範囲の縁と、候補の bbox の内側にある strict-only の画素は、必ずその候補に入る。そのため、縁が `--pad` の内側に収まる差は 1 件になる。
  縁が `--pad` より外まで続く差（box-shadow のぼかしの差など）は、芯の `regions[]` と、外側の `strict_only_regions[]` の 2 件に分かれることがある。
  取り込みを芯と `--pad` の範囲に限るのは、ページ全体に広がる差で、すべての領域が画面の大きさの候補 1 件にまとまってしまわないようにするためである。
  分かれた外側の候補は、`overlaps_regions` に隣り合う `regions[]` の `id` を持ち、stderr に警告が出る。このときは、候補ごとに 1 件ずつ台帳に書き、同じ `cause` を参照する。
  照合は候補の bbox の一致なので、片方だけを書くと、もう片方が `unexplained` に残る。承認は原因ごとなので、1 回で足りる。
  `pixel-crops.mjs` の `VERSION` が `3` までの出力では、分かれていた。その出力に合わせて書いた台帳は、取得し直した候補の外側の bbox に書き換える
- `current` と `new`（crop への相対パス）は、照合キーにしない。実行のたびに変わるので、値の一致で照合すると毎回一致せず、例外が当たらない。どちらも、承認したときの根拠として残す
- キーがそろわない候補は除かない（`unexplained` のまま残す）。bbox が動いたということは差の位置が変わったということなので、同じ例外で吸収してよいとは限らない
- `cause` を解決できないインスタンスは、照合に使わない（上の「インスタンス例外のスキーマ」の最後の項目と同じ扱い。画素の比較はこのスキルが当てるので、この解決もこのスキルが行う）
- `diff.md` の差分の一覧に、当てた例外・その `bbox` の実測のずれ・吸収した原因（`cause` の id と `reason`）を残す。どの例外がどの候補を吸収し、どの原因によるものかを追えるようにするためである

## diff-normalize.mjs の実行

```text
node <スキルディレクトリ>/scripts/diff-normalize.mjs <trait-diffs.json> --registries <registries.json> --slug <slug> [--page <p> --state <s> --viewport <v>] [--noise <metadata.json>]
```

- `<trait-diffs.json>` は、`trait-compare.mjs` の出力（Diff の配列）である
- `--registries <registries.json>`: 下の「registries.json の組み立て」で作ったものを渡す（YAML のパーサを同梱しないため。skills.yml も例外のファイルも、直接は渡さない）
- `--noise <metadata.json>`: `noise_baseline[]` を読むために、`parity-suite` の `metadata.json` を渡す
- 出力は、各 Diff に `classification` と `matched_rule` を付けた JSON である。
  `classification` は `absorbed_registry`・`absorbed_T`・`deviates_T`・`absorbed_exception`・`noise_candidate`・`pending_review`・`unexplained` のどれかである。
  `absorbed_exception` の `matched_rule` には、解決した原因（`cause_reason` と `cause_evidence`）が入る
- 意図的差異の `match` の不整合は、`intentional_diffs.<群>[<添字>]: ...` の形で stderr に警告として出る（上の「意図的差異の照合キー（`match`）」）。
  警告が出た宣言は照合に使われていないので、設定ファイルの `match` を直して実行し直す。散文だけの宣言が当たらなかった件数（`intentional_diffs: <N> of <M> prose-only ...`）も、同じように stderr に出る。
  どちらも台帳（例外）の不整合ではないので、`diff-metadata.json.accepted_exceptions.unresolved` には数えない
- T の不整合は、`component_diffs[<添字>]: ...` の形で stderr に警告として出る（`component` が欠けているか空のとき。上の「component_diffs T の照合方法」）。
  警告が出た T は照合に使われていないので、設定ファイルの宣言に対象の要素の論理名か glob を補って、実行し直す。
  台帳（例外）の不整合ではないので、`diff-metadata.json.accepted_exceptions.unresolved` には数えない
- 例外の不整合（上の「インスタンス例外のスキーマ」の最後の項目の各条件）は、`component_diff_exceptions[<添字>]: ...` の形で stderr に警告として出る。
  警告が出た例外は照合に使われていないので、`diff.md` に不整合として記録して直す。
  `diff-metadata.json.accepted_exceptions.unresolved` に数えるのは、この添字の付いた警告（台帳のインスタンスごとの不整合）だけである
- `--page`・`--state`・`--viewport` は、組ごとに必ず渡す。`--page` か `--viewport` を省くと照合キーを確かめられないので、例外は 1 件も当たらない。
  そのことも stderr に出る（`--state` を省いたときだけは、両側でデフォルトの `default` として突き合わせる）。
  この警告は実行の側の誤りで、台帳の不整合ではないので、`unresolved` には数えない。キーを渡して実行し直す（数えると、台帳が正しくても不整合に見え、収束の判定が読めなくなる）
- 終了コードは、0 がすべて吸収（対応は要らない）、1 が `unexplained` か `deviates_T` か `pending_review` がある、2 が入力の誤りである

### registries.json の組み立て

2 つの元から、キーを名前を変えずに集めるだけにする。対応表は書かない。名前を付け替える工程は、結合を誤る原因になる。

| registries.json のキー | 元 |
|---|---|
| `intentional_diffs` | 設定ファイルの `skills.replace-strategy.intentional_diffs` |
| `component_diffs` | 同じく `skills.replace-strategy.component_diffs` |
| `component_diff_exception_causes` | `.replace/parity/<slug>/component-diff-exceptions.json` の同じ名前のキー |
| `component_diff_exceptions` | 同じファイルの同じ名前のキー |

- `intentional_diffs.pending` の要素はオブジェクト（`item`・`slug`・`added_by`・`added_at`）で、照合に使うのは `item` である。
  ただの文字列の旧形式も読む（要素の形の原本は、`replace-strategy` の `references/project-config.md`「`pending` 要素の形」）。
  キーを名前を変えずに集める原則どおり、`item` だけを抜き出して文字列の配列にまとめない。
  まとめると、[`../scripts/pending-triage-check.mjs`](../scripts/pending-triage-check.mjs) が帰属（`slug`）を読めず、すべてが帰属不明になる
- 棚卸しの判定に渡す `registries.json` は、人が `keep` か `may_change` へ移した後の設定ファイルから組み立て直す（[`convergence.md`](convergence.md)「`intentional_diffs.pending` の棚卸し」）。
  正規化のときに作ったスナップショットを使い回すと、移した要素が `pending` に残っているように見える。
  正しく決めた記録が、「移したと記録されているが `pending` に残っている」「移した先に見つからない」という不整合として失敗する（組み立て方は同じで、読む時点だけが違う）
- 例外のファイルが無ければ、後ろの 2 つのキーは空の配列にする（例外は 0 件。止まらない）
- ファイルの `slug` が対象の slug と違えば止まる（別の slug の台帳を読んでいる。空として警告なしに進めない）
- 原因の文言を、インスタンスに展開しない。原因の解決は、`diff-normalize.mjs`（特性照合）とこのスキル（画素の比較）が照合するときに行う。組み立てるときに展開すると、複製がまた起きる

## コンポーネント比較の方針

- カタログサイト（コンポーネントライブラリの見本）と部品のベンダーの機能の一覧を、比較の正解にしない。正解は、動いている現行のアプリである
- どちらも、使い道は状態網羅のリスト（どの状態・バリアント・操作があるかの参照）に限る（列挙の使い方の原本は、`parity-suite` の `references/coverage.md`「状態網羅の導出源」）
- Storybook を使う場合も、突き合わせてよいのは computed style だけで、現行のアプリから取り出した値と比べる（Storybook 同士やカタログ同士で突き合わせない）
- ピクセルを比べる VRT のツールで、新旧を突き合わせない（実装が違えば全面が赤になり、意味が無い）
