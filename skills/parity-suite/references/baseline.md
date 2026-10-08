# 視覚ベースラインとノイズ基準値

視覚ベースラインは、このスキルが現行アプリを操作するときに一緒に採る。
現行アプリを 1 回巡れば、実行できるパリティスイートと、`parity-diff` が使うベースラインが同時に得られる。
**現行アプリを操作するのはこのスキルだけ**なので、ノイズ基準値もここで測る。

## 3 点セット

スクリーンショットだけでは足りない。3 点セットとネットワークログを、**ページ・状態・ビューポートごと**に採る。
ネットワークログは 3 点セットの補助で、API やデータが原因の差を調べる材料として `baseline/` に含める。
認証情報とトークンはマスクする（[`auth.md`](auth.md)）。サイズが大きくなることがあるので、保存はスクリーンショットと同じく `artifacts` の設定に従う。

| 要素 | 中身 | 用途 |
|---|---|---|
| スクリーンショット | 画面の画素 | 名前の付かない要素の見た目の差を、`parity-diff` の画素の比較とトリアージが扱う |
| 論理名付きの要素の特性 | 固定のプロパティの集合（padding / margin / font 系 / color / background-color / border-radius と `cursor` / `user-select` / `pointer-events`）、擬似要素（`::before` / `::after`）、`getBoundingClientRect()` の**相対的な幾何**（絶対座標は比較に使わない）、1 段下の子の inline style（`child_inline_styles`。診断の材料で、照合には使わない）、文字の持ち主（`text_owners`。部分木で文字を描いている要素ごとの書体・大きさ・行の高さと文字の寸法。照合する）、スクロール領域の特性（`scroll`。はみ出しの有無、スクロールバーが取った幅と高さ、スクロールバーの見た目の宣言。照合する）。[`coverage.md`](coverage.md) で移した各状態で採る | DOM の構造が同じで見た目だけが違う事象を、名前付きの要素について決定論的に捉える |
| 参考の aria スナップショット | 採った aria | **参考の資料で、assertion ではない**（assertion は手で書く。[`coverage.md`](coverage.md)） |

- 特性を照合する対象は、論理名付きの要素に絞る。名前の付かない要素の見た目の差は、スクリーンショット（画素の比較）が受け持つ。
- **論理名は「画面に描かれている要素」に付ける。** `getByRole` が返す要素が描かれているとは限らない。
  市販の部品は、aria のための木を別に作ることがあり、その木は画面の外（`y = -32000` など）に置かれる。
  描かれていないコピーから採ると、固定のプロパティはすべて一致したまま緑になり、画素だけが差を出す（実測では、列見出し 9 件をコピーから採っていた）。
  採取ツールは矩形を文書の座標に直し、文書の外に丸ごと出ている要素では採取を失敗させる。
  この失敗は、ロケータマッピングを直してから採り直す。要素の欠落として扱わない（強度のチェックでの扱いは [`strength-gate.md`](strength-gate.md)）。
- この判定は「面積 0 のコピー」を捕まえない。面積 0 の矩形は `display: none` などを正しく採るために判定から外してある。
  そのため、`width: 0; height: 0` で置かれたコピーは判定を通る。判定が捕まえるのは、`y = -32000` のように文書の外へ動かしたコピーだけである。
  論理名がコピーを指している疑いが残るなら、採取物の `rect` が面積 0 でないことも確かめる。
- 子に inline style が付いている差は、名前を付けた要素の計算値には出ない。採取ツールは、1 段下の子の inline style だけを `child_inline_styles` に記録する（子の計算値は採らない）。
  これは照合に使わない診断の材料である。
  「計算値はすべて一致するのに画素だけ差が出た」ときに、装飾がどこに付いているかを先に確かめるために読む。
  実測では、`<a><span style="font-weight: bold;">` の形で 34 のプロパティがすべて一致し、画素の差 62 だけが出た。読む手順は `parity-diff` の `references/font-diff.md` で定義する。
- 文字を描いているのが子孫の要素だと、名前を付けた要素の font 系の計算値は文字の見た目を表さない。
  採取ツールは、部分木のテキストノードの親要素（文字の持ち主）ごとに、次の値を `text_owners` に記録する。
  書体・大きさ・字形・太さ・行の高さの計算値と、文字の寸法（行の断片の幅の合計 `advance`、高さ `glyph_height`、縦に重ならない行の数 `lines`）である。
  差分ツール（trait-compare.mjs）は、これを**並び順（i 番目どうし）**で照合して `kind: "text"` の差を出す。
  外接矩形（`rect`）は、折り返しや間に挟まる子要素で大きくなるので、照合に使わない。
  DOM の入れ子の深さでは突き合わせないので、現行の `<button><div><span>設定</span></div></button>` と新側の `<button>設定</button>` でも、書体と大きさの差が出る。
  この例では、要素自身の計算値は一致し、文字の幅が 26px と 30.4px で違っていた。文字列が違う組は寸法を比べず、行数が違う組は行数の差だけを出す。
  描画に使われた書体の実体（フォールバックの解決先）は計算値に出ないので採らない。下の「採取環境と利用者環境の乖離」で確かめる。
  視覚的に隠した文字（1px の箱に閉じ込めた sr-only や、`text-indent` で箱の外へ出した文字）は数えない。ボタンとして描く `<input>`（submit / button / reset）の `value` は数える。
  寸法は、持ち主の端の空白を除いて測る。境目の空白がどちらの持ち主に付くかで、幅を変えないためである。
  `value` 属性の無い submit / reset のデフォルトの文言は DOM から読めないので、文字列を空にした行として数える（書体だけを照合する）。
  閉じたシャドウルートの中の文字と、文字の入力欄の `value` は採れない。
- スクロールバーが場所を取ったか、取った結果はみ出したかは、`overflow-x` / `overflow-y` の計算値には出ない。
  採取ツールは、スクロール領域ごとに `scroll` を記録する。
  ここでのスクロール領域は、`overflow-x` / `overflow-y` の片方でも `visible` / `clip` でなく、`display: inline` でもない HTML 要素である。記録するのは次の値である。
  - はみ出しの有無（`overflowing_x`: `scrollWidth > clientWidth`、`overflowing_y`）
  - 縦のバー（とガター）が取った幅 `vertical_bar_px` と、横のバーが取った高さ `horizontal_bar_px`（`offsetWidth − clientWidth` から枠を除く）
  - 見た目の宣言（`scrollbar-width` / `scrollbar-color` / `scrollbar-gutter` と、`::-webkit-scrollbar` / `-thumb` / `-track` / `-corner` / `-button` の幅・高さ・背景・角の丸み・枠の計算値）

  差分ツールは `kind: "scroll"` で照合する（厚みは `align_tolerance` 付き）。スクロール領域でない要素は `null` にする。
  `::-webkit-scrollbar` を持たないブラウザでは、擬似要素の値を `"unsupported"` にする。空の値で両側が一致したように見せないためである。
  実例では、ダイアログの中のデータグリッドが、現行は `overflow: auto`、新側は `overflow-x: hidden` だった。
  バーが場所を取ると、現行は縦のバーの 15px のぶん中身（628px）がはみ出して横のバーが出る。新側は右端の 15px が切れる。
  バーを隠して撮ると、両側とも「はみ出し無し・厚み 0」にそろい、この差は消える。
  `scroll` が機能するのは、撮影時の扱いが `scrollbars: shown` のときだけである（下の「スクロールバーが場所を取る窓のはみ出し」）。
  スクロール領域に論理名が無いと `scroll` は採られない。
  そのため、`capture_scope` が数えた内部のスクロール領域の名前は `traits.elements` に入れる。入れない領域は `untraced:<名前>` の抜けになる（下の「撮る範囲の決め方」）。
- 画素の比較に任せられるのは、静止画に記録されるものだけである。
  `cursor` / `user-select` / `pointer-events` は操作したときの手応えを決めるが、撮影には記録されない。
  そのため、固定の集合から外すと、特性の照合でも画素の比較でも差が出ない（どちらの方法にも現れない見た目になる）。
  `parity-component` は要素の矩形だけを撮るので、「記録されないもの」がさらに増える。次のものも、同じ理由で固定の集合に入れてある。
  - 矩形の外に描かれる `box-shadow`
  - 下地に左右されて区別できない `opacity`
  - 切り出しが要素についてくるので矩形の中に出ない `position` / `top` / `right` / `bottom` / `left`
  - 採取時の文字列が短ければ差にならない `white-space` / `overflow-x` / `overflow-y` / `text-overflow` / `word-break`

  プロパティの集合の原本は [`../scripts/trait-capture.mjs`](../scripts/trait-capture.mjs) の `FIXED_PROPERTIES` で、増減させたら `VERSION` を上げる。
- `url()` を値に持つプロパティは、参照先の資産の中身までは照合していない。
  採取ツールは、相対 URL を絶対にしたときのホストの違いを消すため、同じオリジンの `url()` をオリジンに依らない印にまとめる（[`../scripts/trait-capture.mjs`](../scripts/trait-capture.mjs) の `foldOrigin`）。
  そのため、**現新が同じパスで別のバイトの資産を配っていると、その見た目の差は特性の照合にも画素にも現れない**（カスタムカーソルの画像が当たる）。
  対象の要素があれば、`gaps.md` の「特性化できなかった箇所と理由」に種別「採取値の射程外」として残し、確認済みにしない。
  強度のチェックで注入しても特性の照合が赤にならないので、`strength.md` の「未検証の故障種別」にも同じ理由で残す。
- 採取のスキーマ（`FIXED_PROPERTIES` と採取の形。ツールの `VERSION` が上がる変更）を変えたら、現側と新側の両方を採り直す。
  `parity-diff` の前提の確認は、ツールの `VERSION` と `metadata.json` の記録値が一致することを求める。
  そのため、片側だけ採り直した成果物は比較に進めない（止まるのが正しい振る舞いである）。
- 採取には、同梱の [`../scripts/trait-capture.mjs`](../scripts/trait-capture.mjs) をプロジェクト側の `<parity_suite_dir>/parity/lib/tools/vendor/` にコピーして使う。
  この場所はデフォルトで、コピー専用のサブディレクトリである（置き方の方針は [`locator-mapping.md`](locator-mapping.md)）。
  何を採ったか（対象の要素・プロパティの集合・状態）を `metadata.json` に残し、`parity-diff` が同じ条件で照合できるようにする。

## 撮影条件の統制

同じ環境・同じビューポートで、アニメーションを無効にし（`animations: 'disabled'`）、動的な領域をマスクして撮る。
条件は `metadata.json` に残し、`parity-diff` が新側を同じ条件で撮れるようにする。

- 撮影範囲（全画面かビューポートの中か）も `capture_conditions.full_page` に残す。記録しないと新側が決め打ちで撮り、画像のサイズの違いが全面の差分として出る。
- スクロールバーが場所を取ったかも `capture_conditions.scrollbars` に残す。片側だけ場所を取ると、見える幅と高さが厚みのぶんずれる。
  **デフォルトは `shown`**（`--hide-scrollbars` を外して撮る）で、`hidden` で撮るなら理由を `scrollbars_reason` に書く。詳細は下の「スクロールバーが場所を取る窓のはみ出し」にある。
- 表示を切り替える軸（ロケール・配色テーマなど）の値と、撮影に使ったブラウザも残す。
  デフォルトの 1 つの値だけで撮った差や、採取環境でだけ成り立つ一致は、3 つの比較方法のどれにも記録されない
  （下の「表示を切り替える軸（掛け合わせずに撮る）」「採取環境と利用者環境の乖離」）。

マスクは用途を混ぜない。
`capture_conditions.masks` は、認証情報・トークン・個人情報・揮発する項目を成果物に残さないための**恒久マスク**とし、方針は [`auth.md`](auth.md) に従う。
同じページに載る別の機能の未実装の領域は、`capture_conditions.cofeature_masks` に記録する。
記録するのは、ページ、持ち主の slug、現側で測った page × state × viewport ごとのルートの論理名と `bbox` である。
対象は `.replace/features.md` のページの一覧から導き、対象の機能自身は含めない。

`cofeature_masks` は候補の一覧であり、この時点で原本の現側ベースラインに埋め込まない。
`parity-diff` が、同じ target の `suite.new_green` を読んで実行ごとの有効な集合を導く。そして、原本を変えずに、現側と新側の作業用のコピーへ同じ領域のマスクを当てる。
`bbox` は、現側ベースラインと同時に実測する、target に依らない座標である。新側に未実装の機能の DOM が無くても、両方の画像に同じ矩形を当てられる。
次のどれかに当たる場合は、マスクで差分を隠さず、`gaps.md` に不足を記録して止まる。

- 撮影の組に対応する矩形が無い
- 現側の論理名を解決できない
- 領域が別の機能まで覆う
- ページの一覧で同じページに載る slug に、候補が無い

依存先が green になった次の実行では、候補を自動で外し、原本のまま全面の比較に戻れる。

### ページの path の解決規則

`capture_conditions.pages[].path` は、**target の baseURL（`target.ui_url`）からの相対パス**で、次の規則で 1 つの URL に解決する。
規則の原本はこの節で、照合の実装は [`scripts/page-identity.mjs`](../scripts/page-identity.mjs) である。
`reaction-check.mjs` は、押した後に撮ったページの照合と、撮る状態の使い回しの数え方にこの実装を使う。

- 解決の仕方は Playwright の `page.goto(path)` と同じ（WHATWG URL の相対解決 `new URL(path, baseURL)`）で、撮影が開いたページと同じ URL になる。
  - `/` で始まる path は、baseURL のパスの接頭辞を捨てる（`https://host/portal/` に `/orders` は `https://host/orders`）。
    接頭辞の下のページは、`orders` と相対で書く。根のページは空文字列にする。
  - 末尾に `/` の無い baseURL（`https://host/portal`）では、最後の区間が置き換わる（`orders` は `https://host/orders`）。接頭辞の下で撮るなら、baseURL を `/` で終える。
  - スキームとホストを持つ path（`https://…` / `//host/…`）と、バックスラッシュを含む path は書かない。書くと失敗する。
    http(s) ではバックスラッシュが `/` と同じに読まれ、`\\host\\x` は別のホストに解決される。押した後の URL も同じである。
- ページはパスの完全一致で識別する。末尾の `/` と大文字小文字は正規化しない（`orders` と `orders/` は別、`orders` と `archive/orders` も別）。
- クエリとフラグメントは、path に書いたときだけ識別に含め、書いたものとの完全一致を求める。書かなければ、押した後の URL のクエリとフラグメントは何でも合う。
  - 1 つの URL に複数のページが合うなら、クエリとフラグメントを多く書いた方（狭い方）を採る。
    `orders` と `orders?tab=orders` なら、`/portal/orders?tab=orders` は後者に合う。
  - 同じ狭さで別のページが残る URL は、曖昧として失敗にする。path のクエリかフラグメントで分ける。
  - ハッシュルーティングのページは、フラグメントまで書く（`#/orders`）。フラグメントの中の `?` はクエリではない。
- path が同じ別の名前（別名）は、同じページである。撮る状態の使い回しは、名前ではなく、解決したページ × 状態名で数える。
- `target.ui_url` が `runtime`（url_command の target。URL を成果物に残さない）なら、baseURL が無い。
  この場合は `/` で始まる path だけを解決し、相対の path が 1 つでもあれば、押した後の URL との照合をしない（`reaction-check.mjs` の出力の `capture_page_urls.checked: false` に理由が出る）。
  照合させるなら、path を baseURL のパスの接頭辞を含めて `/` から書く（オリジンは照合に使わないので、ホストは成果物に残らない）。
  - 照合しない場合も、撮る状態の使い回しは相対の path の文字列で数える。同じ path を書いた別名は同じ 1 枚になる。
    `orders` と `/portal/orders` のように、書き方の違う同じページはまとまらない。

**撮る状態を持つ操作は、押した後の URL（`reactions.json` の `aftermath.returns_to.url_after`）が、この規則で名乗ったページ（`capture_page`。ページが 1 つなら省いてよい）に解決できなければ失敗する**
（[`coverage.md`](coverage.md)「押した後に残るもの」）。

### 撮影状態の決め方（1）網羅表から導く

`capture_conditions.states` を、「見た目が変わる状態を思い付いたぶん」だけで決めない。
挙げなかった状態は、3 点セット（スクリーンショット・特性・aria スナップショット）のどれも採られない。特性の照合は、名前を付けた要素しか見ない。
そのため、3 つの比較方法のどれにも出ないまま、差分ツールは緑になる。
**差分ツールは撮った 2 枚しか比べないので、集合が足りないぶんは「差 0 件」と同じ見え方になり**、見逃しと区別できない。

足りないことは、工程の外でしか見つからない。利用者が画面を見るか、実装した側が気づくかのどちらかで、見つかった時点でベースラインを採り直すことになる。
現行側も撮り直しになるので、反復が 1 つ増える。だから、撮る前に、思い付きではなく測った操作から集合を出す。

- 必要な集合は、部品網羅表（`component-coverage.json`）から機械的に導く。
  網羅表には、画面に載っている部品とその操作が `value: present` で並んでいる。そこに「操作 → 見た目が変わる状態」の対応づけを当てれば、集合が出る。
  対応づけの語彙は 6 種ある。
  - 操作の途中の見た目: ポップアップを開く（`opens-container`）、指を乗せる（`hover`）、焦点を当てる（`focus`）、押している最中（`active`）、不活性（`disabled`）
  - 操作を終えた後に残る見た目（`after-operation`）: 選択の塗り、絞り込み中の見出しの印、並べ替えの印

  途中だけを導くと、終えた後の見た目は撮られない。
  行を選んだ後に現行が特定の列だけを塗らない、絞り込んだ列の見出しが赤くなる、といった差は 3 つの比較方法のどれにも出ない。
- 種別は項目ごとに宣言する（`items[].visual_states`。見た目が変わらないなら、空の配列と `no_visual_state_reason`）。
  網羅プロファイルを宣言した部品では、プロファイルの `candidate_rules[].visual_states` が原本である。
  `coverage-expand.mjs --write` が項目に書き戻すので、手で書かない（[`coverage-profiles.md`](coverage-profiles.md)）。
- `--metadata` には、対象の機能のものを渡す。`slug` が網羅表と違う `metadata.json` は、exit 2 で失敗する。
  別の機能の撮影条件でも、状態名が汎用（`hover` など）なら突き合わせが通ってしまう。`parity-diff` はこの `conformance` を信頼して比較をやり直さないので、ここで止める。
- 導出は `node <skill>/scripts/coverage-expand.mjs --coverage <網羅表> --write` が行う。
  この時点では `metadata.json` がまだ無いので、`--metadata` は渡さない。渡すと読めずに exit 2 で止まり、行も書かれない（撮影条件との照合は、`metadata.json` を書いた後の手順 8 で行う）。
  - `value: present` のセルと項目の種別から、**部品 × インスタンス × 要求元の操作 × 種別**の行を `visual_state_coverage.rows` に起こす。
  - 人かエージェントが、撮るなら `captured` に状態名（手順 6 で `capture_conditions.states` に書く名前）を、撮れないなら `reason` を埋める。
  - どちらも空の行は「撮影状態が未決」として報告される。これが、足りない状態の一覧にあたる。
- 状態名も、撮影の単位の中で一意にする。撮影はページ × 状態名 × ビューポートの単位で行う。
  そのため、行のキーを要求元まで分けても、同じ状態名を指せば同じ 1 枚になり、1 回の撮影で複数の操作が満たされてしまう（キーの粒度と同じ故障が、値の側に残る）。
  - 別々の操作が本当に同じポップアップを開く場合だけ、共有する**すべての行**の `shared_capture_reason` に、実際の UI で確かめた根拠を書けば通る（片方だけでは通らない）。
  - ページが違うインスタンスの間では別の 1 枚になるので、使い回してよい。
  - 反応の網羅表（`reactions.json`）の撮る状態とも、同じ集合で数える。
    部品から導いた行と、反応・残る見た目・状態表示の行が同じページ × 状態名を指すなら、両方の表のすべての行に `shared_capture_reason` が要る
    （`reaction-check.mjs` が部品網羅表を読んで数える）。
  - 撮影状態を求める行を持つインスタンスには、`page` が要る。撮影の単位を決めるキーなので、欠けていると使い回しを判定できない。狭い範囲として扱わず、失敗にする。
  - 空でないだけでは足りず、`capture_conditions.pages[].name` に実在する名前でなければ失敗にする。
    採取は `pages` を外側のループにして回るので、宣言に無い名前（誤記・旧称）を書いた行はどのページでも撮られない。誤記は、使い回しの判定の単位も分けてしまう。
- 行は、要求元の候補ごとに分かれる（種別でもルール id でも束ねない）。
  列フィルタの吹き出しと右クリックのメニューは、どちらも `opens-container` を求める。
  束ねると、片方の状態名を書くだけで未決が 0 になり、撮られなかったポップアップの差は「差 0 件」と同じ見え方に戻る。
  ルール id でまとめるのも同じ誤りである。ルールは複数の軸の直積に展開されるので、まとめると、まとめてはいけない軸まで畳んでしまう。
  たとえば `datagrid` の `column-sort` は `sort-direction` に展開されるが、その軸は `reducible_axes` に無く、「代表 1 件では差分が見えなくなる」と明示されている。
- 行を減らせるのは、同値クラスを使うときだけである。`equivalence_classes` に属する候補は代表の行に寄り、行の撮影の単位も代表のインスタンスで決まる。
  まとめてよい軸、所属が全部そろっているか、根拠、代表が妥当かは、同じ実行の照合が検査する。
  そのため、宣言していないまとめ方も、まとめてはいけない軸での宣言も通らない（[`coverage-profiles.md`](coverage-profiles.md)「視覚採取の同値クラス」）。
  クラスを宣言しなければ、候補の数だけ行が立つ。減らしたいなら根拠を書く、という取り決めである。
- 撮れない状態には、理由を書く（押すと外部との連携が始まる、不活性になる条件が現行に無い、など）。
  同じ文言を、`gaps.md` の「特性化できなかった箇所と理由」に種別「撮影状態の対象外」として残す。
  欄が無いと、「導いたが撮らないと決めた」と「導けていない」が同じ見え方になる。
- `capture_conditions.states` との差を取れるのは、`--metadata` を渡した実行だけである。
  渡さない実行は `conformance.visual_states.checked: false` のままで、`parity-diff` はそれを収束の根拠にしない（照合していない記録を照合済みとして扱わない）。
  - この照合は、`metadata.json` を書いた手順 8 で通す。
  - 記録には網羅表と撮影条件の指紋が入るので、通した後に表や撮影条件を書き換えたら、`--write` から通し直す（書き換えたまま古い要約を残すと、`parity-diff` が失敗にする）。
  - スキルを更新して導出の意味が変わったときも、通し直す。
    `parity-diff` は記録に残った生成側の版が下限以上かを見るので、古い規則で作った要約は、指紋が合っていても収束させない。
  - `kind: opens-container` は、`states` にあるだけでは足りず、次の節の `popup_inventory` にも行が要る。
- 導出は下限であって、上限ではない。操作から導けない状態（`error` や、初期表示のバリアント）は、手で `states` に足す。
  部品に依らない操作（ロゴ、Clear など）の後に残る見た目と戻り先は、反応の網羅表の `aftermath` が操作ごとに数える（[`coverage.md`](coverage.md)「押した後に残るもの（`aftermath`）」）。
  網羅表は操作の有無を数える表で、開いた中身の見た目を突き合わせたかは見ていない。導出を「見た目を保証するもの」と読み替えない。
  導出が出すのは「撮るべき状態の集合」までで、撮った結果が現行と合っているかは、画素の比較と特性の照合（`parity-diff`）が出す
  （[`coverage.md`](coverage.md)「網羅表は見た目を見ていない」）。

この導出は、手順 5（authoring）の終わりで、手順 6 の採取より前に行う。この位置は次の 2 つで決まる。

- 状態を後から足すと、現行側も採り直しになる。ベースラインの 3 点セットに加えて、その状態のノイズ基準値も 2 回撮りからやり直す。
  採り直しは新側だけでは済まないので、撮る前に集合を確定させるほうが反復は短い。
- 集合は測った操作からしか導けないので、網羅表のセルが埋まる前には回せない。

### 撮影状態の決め方（2）コンテナの棚卸し

導いた `opens-container` の行は、「コンテナが要る」までしか言わない。
この節では、操作で開くコンテナをポップアップと呼ぶ（記録するキー `popup_inventory` に合わせる）。
どのポップアップが何段目にあり、どの操作で開き、そのうちどれを撮るかは、ポップアップを再帰的に数えないと出ない。部品網羅表は操作の有無を数える表なので、代わりにならない。

- 操作で開くポップアップ（吹き出し・ダイアログ・メニュー・引き出し・ツールチップなど）を、再帰的に数える。
  1 段目を開いたら、その中でさらに操作して開くポップアップ（吹き出しの中のコンボボックスの一覧、下位のメニュー）と、一覧の項目に指を乗せた状態まで降りる。
  ポップアップを開く操作が見つからなくなった段で止める。
- 数えたポップアップは、撮る場合も撮らない場合も、`capture_conditions.popup_inventory` に 1 行ずつ残す（形式はテンプレート `assets/metadata-template.json`）。
  撮るなら `captured` に `states` の状態名と `reason: null` を書く。撮らないなら `captured: null` と `reason` を書く。
  両方を埋めた行は、撮る・撮らないが同時に成り立つので不整合である。
  撮らない理由は、`gaps.md` の「特性化できなかった箇所と理由」にも種別「撮影状態の対象外」として残す。
  欄が無いと、「数えたが撮らないと決めた」と「思い付かなかった」が同じ見え方になる。
- `opened_by` には、開く操作を、操作アダプタの呼び出しの配列で書く。
  要素は `<関数名>(<開く対象の論理名>)` で、引数を取らない関数は `<関数名>()` と書く（状態名で代わりにしない）。2 段目以降は、親のポップアップの `name` を `parent` に書く。
  - 1 つのポップアップを複数の操作で開けるなら、そのすべてを要素に並べる（クリックのアダプタとキーボードのアダプタなど）。
    開き方を足すために行を分けない。棚卸しの単位は、ポップアップ 1 つにつき 1 行である。
    行を分けると同じポップアップが 2 回数えられ、`captured` / `reason` もポップアップごとに 1 つに決まらなくなる。
  - 関数名だけにしない。引数で開く対象を変える関数（`openCombo(page, name)` など）は、1 行ですべての呼び出しを満たしたことになり、他のポップアップの撮り忘れを突き合わせで拾えなくなる。
  - 書くのは、開く対象を決める引数だけで、それ以外の引数はすべて除く。
    `page` のように呼び出しごとに変わらない引数も、`ArrowDown` のような操作の詳細も除く（`openCombo(page, 演算子)` は `openCombo(演算子)`、`pressKey(page, 演算子, ArrowDown)` は `pressKey(演算子)`）。
  - 基準は 1 つだけにする。照合の単位が「関数名 × 開く対象の論理名」なので、それ以外の引数は識別に使われない。
    残すか除くかの基準を「変わらないかどうか」でも持つと、`pressKey(演算子, ArrowDown)` で答えが分かれる。
  - 同じ関数で開き方だけが違う操作は、引数ではなく関数名で分ける（キーボード用のアダプタを別の名前で持つ）。
    引数で分けると、同じポップアップが 2 つの呼び出しに見えるか、同じ要素が 2 つ並ぶ不整合になる。
  - 列挙する側にも同じ正規化を当て、書き方を混ぜない。混ぜると同じ呼び出しが 2 つの文字列になり、突き合わせが「現れない呼び出し」を作る。
- `name` は、機能の棚卸し全体で一意にする。`parent` は親のポップアップを `name` で指すので、`name` が一意でないと `parent` がどの行を指すか決まらない。
  兄弟の範囲（同じ `parent` の中）だけで一意にしても足りない。祖父が違えば、同じ `name` のポップアップを 2 行書けてしまい、その子は `parent` に同じ文字列を書くことになる。
  すると 3 段目以降で、別の文脈の正しい 2 行が重複と読まれるか、1 行が両方の文脈を満たしたことになる。
  `parent` を持たせた目的（撮り忘れを包含の判定で見えなくしない）が、その深さで失われる。名前が衝突するなら、文脈を含めて名前を変える（`列フィルタの吹き出し` / `一括編集の吹き出し`）。
- 呼び出しは、文脈（どのポップアップの中から呼ぶか）と組にして識別する。照合の単位は **`parent` × `opened_by` の要素**で、同じ `openCombo(演算子)` でも、親のポップアップが違えば別の呼び出しである。
  書き終えたら、操作アダプタ（`suite.interactions`）とスイートから、ポップアップを開く呼び出しを列挙する。
  列挙の単位は「どのポップアップの中から呼ぶか（1 段目は `null`）× 関数名 × 開く対象の論理名」である。
  そのすべてが、同じ `parent` を持つ行の `opened_by` に現れることを突き合わせる。足した操作が撮影状態に反映されない抜けは、ここで拾う。
  次のどれかに当たると、撮り忘れが集合の包含の判定で見えなくなるので、不整合として止める。
  - `opened_by` が空の配列（ポップアップは必ず何かで開く。開き方を書けないなら、数えられていない）
  - 同じ行の `opened_by` に、同じ要素が 2 つ以上ある
  - 同じ `parent` × 同じ呼び出しが、2 行以上に現れる（その呼び出しでどちらのポップアップが開くか決まらない。引数の論理名をポップアップごとに分けて書く）
  - 同じ `name` の行が 2 つ以上ある（1 つのポップアップが 2 回数えられている。開き方が複数あるなら、1 行の `opened_by` に並べる）
- 古い形式の単一の文字列は、1 要素の配列と同じ意味として読む（`popup_inventory` を入れた当時の形）。
  読み替えるのは形だけで、上の突き合わせと不整合の判定は同じに当てる。新しく書くときは配列で書く。
- 引数の書き方も移す必要がある。この節より前に書かれた `opened_by` には、`openCombo(page, 演算子)` のように除くべき引数が残っている（当時は違反ではなかった）。
  突き合わせの前に、記録の側を新しい書き方に書き換える。比べるときだけ正規化して記録を古い書き方のまま残すと、次の実行でまた解釈が要る。
  書き換えずに突き合わせると、列挙する側だけが新しい正規化になり、同じ呼び出しが「現れない呼び出し」として誤って止まる。
  この移行は不整合ではないので、書き換えだけを行って止めない。
- ポップアップが 1 つも無い機能は、`popup_inventory: []` と書く（キーが無いと、「数えていない」と区別できない）。
- `popup_inventory` を持たない既存の `metadata.json` は、この節と次の節を入れる前の採取として扱い、ベースラインとノイズ基準値を採り直す。
  待たずに撮った 2 つの標本の「ノイズ 0」が、残り続けるためである。

### 撮る範囲の決め方（抜けは採取の段で数える）

範囲の狭さは、「差分 0 件」と同じ見え方になる。差分ツールは撮った 2 枚しか比べないので、撮らなかった領域には決して差が出ない。
足りないことは工程の外でしか見つからない。利用者が画面を見るか、実装した側が気づくかのどちらかで、見つかった時点で現側から撮り直すことになる。
反復が 1 つ増え、「狭い範囲で採る → 実装する → 範囲外の差分が出る → 範囲を広げて採り直す → 直す」というループの手間がかかる。
だから、撮る段で抜けを数える。`capture-scope-check.mjs` の出力では、この抜けを `穴` と表示する。

デフォルトは全画面（`capture_conditions.full_page: true`）である。ビューポートの中で撮るのは、全画面で撮れない理由があるときだけにする（理由は下の宣言に残す）。
「1 画面に収まっているはず」を根拠にしない。収まっているなら抜けは 0 件として数えられるので、宣言は要らない。

撮影の組（ページ × 状態 × ビューポート）ごとに範囲を実測し、`capture_conditions.capture_scope` に残す
（様式の原本は [`../assets/metadata-template.json`](../assets/metadata-template.json)）。
突き合わせる相手は `noise_baseline` である。
ノイズ基準値を採った組に範囲の実測が無ければ、「測っていない」として失敗にする（抜けが無い組と同じ見え方にしない）。

| 抜けの種別（id） | 何が撮れていないか |
|---|---|
| `below-fold` / `beyond-right` | 文書（`scrollWidth` / `scrollHeight`）が撮影の領域より大きい。`full_page: false` で下か右が切れている |
| `scroll:<器の名前>` | 内部のスクロール領域の中身が、見えている部分より大きい（仮想スクロール、高さが固定のグリッド）。**画素にも特性にも出ない** |
| `untraced:<器の名前>` | 内部のスクロール領域の名前が `traits.elements` に無い。スクロールバーの有無・厚み・見た目（trait-capture.mjs の `scroll`）が、特性の照合に記録されない |
| `scrollbar-hidden:<器の名前>` | `scrollbars: shown` で撮ったのに、`auto` / `scroll` の向きにはみ出したスクロール領域で、その向きのバーの厚みが 0 である。`--hide-scrollbars` が残っているか、オーバーレイ型か `scrollbar-width: none` のバーである（後者なら理由を宣言する） |
| `offscreen:<論理名>` | 論理名付きの要素が撮影の領域の外にある。特性は採れても、画素には記録されない |

id の `<器の名前>` には、スクロール領域の名前が入る。

実測は、撮る直前に 1 回で採る（`full_page: true` なら撮影の領域は文書と同じ寸法になるので、抜けは 0 件として数えられる）。

```ts
// 出典: https://playwright.dev/docs/api/class-page#page-screenshot（fullPage は文書全体を撮る）、
//       https://developer.mozilla.org/docs/Web/API/Element/scrollHeight（scrollHeight と clientHeight の差が隠れている分）
const scope = await page.evaluate(({ fullPage, namedSelectors }) => {
  const root = document.documentElement;
  const doc = { width: root.scrollWidth, height: root.scrollHeight };
  const captured = fullPage ? doc : { width: window.innerWidth, height: window.innerHeight };
  // はみ出した器に加えて、はみ出していなくてもスクロールバー（とガター）が場所を取っている器も数える
  // （overflow: scroll・scrollbar-gutter: stable。クラシックのバーでは中身が収まっていても幅を取る）。
  // 器の判定は trait-capture.mjs と同じ（overflow-x / overflow-y の片方でも visible / clip でない、inline でない）。
  // ただし hidden の向きではみ出しただけの器（省略記号で切った文字等）は、バーもガターも取らないので数えない
  // 開いたシャドウルートの中の器も数える（document.querySelectorAll は light DOM しか返さない）
  const allElements = (root) =>
    [...root.querySelectorAll("*")].flatMap((el) => [el, ...(el.shadowRoot ? allElements(el.shadowRoot) : [])]);
  const scroll_containers = allElements(document)
    .map((el) => {
      const style = getComputedStyle(el);
      const clipsNothing = (value) => value === "visible" || value === "clip";
      if (clipsNothing(style.overflowX) && clipsNothing(style.overflowY)) return null;
      // inline の要素には overflow が効かず client が 0 になり、bar が文字の寸法に化ける（trait-capture.mjs と同じ除外）
      if (style.display === "inline") return null;
      const border = (side) => parseFloat(style.getPropertyValue(`border-${side}-width`)) || 0;
      // スクロールバー（とガター）が取った幅・高さ。枠を除く（trait-capture.mjs の scroll と同じ式）
      const bar = {
        vertical: Math.round(el.offsetWidth - el.clientWidth - border("left") - border("right")),
        horizontal: Math.round(el.offsetHeight - el.clientHeight - border("top") - border("bottom")),
      };
      // バーを描く向き（auto / scroll）でのはみ出し。hidden の向きのはみ出しは切っているだけ
      const scrolls = (value) => value === "auto" || value === "scroll";
      const overflowing =
        (scrolls(style.overflowY) && el.scrollHeight > el.clientHeight) ||
        (scrolls(style.overflowX) && el.scrollWidth > el.clientWidth);
      if (!overflowing && bar.vertical === 0 && bar.horizontal === 0) return null;
      return {
        // name は書き手が付ける（論理名で引ける器はその論理名。hint は名前を決めるための手がかりで、記録には残さない）
        hint: `${el.tagName.toLowerCase()}.${el.className}`,
        client: { width: el.clientWidth, height: el.clientHeight },
        scroll: { width: el.scrollWidth, height: el.scrollHeight },
        overflow_x: style.overflowX,
        overflow_y: style.overflowY,
        bar,
      };
    })
    .filter(Boolean);
  const outside = Object.entries(namedSelectors).filter(([, selector]) => {
    const el = document.querySelector(selector);
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    // 撮影領域の原点に合わせて比べる。full_page では文書座標（左上が原点）、ビューポート内では
    // **撮るのは今見えている矩形**なので viewport 座標のまま比べる（scrollY を足すと、下へスクロールした
    // 状態で撮った組の可視要素まで領域外に化ける）。上・左へはみ出した分も数える（負の側も領域外）。
    const top = fullPage ? rect.top + window.scrollY : rect.top;
    const left = fullPage ? rect.left + window.scrollX : rect.left;
    return (
      top < 0 || left < 0 || top + rect.height > captured.height || left + rect.width > captured.width
    );
  });
  return {
    document: doc,
    captured,
    scroll_containers,
    named_elements_outside: outside.map(([name]) => name),
  };
}, { fullPage, namedSelectors });
```

- スクロール領域の名前は、論理名で付ける（論理名で引けないときだけ、構造で特定できる名前にする）。この名前が宣言のキーなので、実行ごとに変わる名前にしない。
  論理名はロケータマッピングに足し、`traits.elements` にも入れる。入れないと、スクロールバーの差が特性の照合に記録されず、`untraced:<名前>` の抜けになる。
- はみ出していないスクロール領域でも、スクロールバー（とガター）が場所を取っていれば数える
  （`overflow: scroll`・`scrollbar-gutter: stable`。`overflow: hidden` でガターを取る領域も含む）。場所を取るバーも、特性の照合の対象になる。
- スクロール領域ごとに、`overflow_x` / `overflow_y`（計算値）と `bar`（`vertical` は縦のバーの幅、`horizontal` は横のバーの高さ。枠を除く）も書く。
  欠けている値、語彙の外の値、負の値は失敗にする。
  `scrollbars: shown` で撮ったのに、`auto` / `scroll` の向きにはみ出した領域で、その向きの `bar` が 0 なら、`scrollbar-hidden:<名前>` の抜けになる（バーが場所を取らないまま測っている）。
- スクロール領域が 1 つも無い組は、`scroll_containers: []` と書く（キーが無いと、「数えていない」と区別できない。`named_elements_outside` も同じ）。
- 寸法は、実測値（正の数）で埋める。テンプレートの `0` を残した組は、「測っていない」として失敗にする。
  0×0 のまま比べると抜けが 1 つも出ず、測っていない組が、抜けの無い組と同じ見え方になる。
- `metadata.json` の `mode`（`feature` / `api-resource` / `batch`）も要る。欠けている値と語彙の外の値は、`feature` として扱わず失敗にする。
- ページ名・状態名・ビューポートの label・スクロール領域の名前・論理名には、`|` と `#` を使わない。
  これらは、撮影の組のキー（`<page>|<state>|<viewport>`）と抜けの id（`<キー>#<種別>:<名前>`）の区切りである。
  含めると、別々の組や別々の抜けが同じ文字列になり、1 つの実測や 1 つの宣言が 2 つを満たしたことになる。
  チェックは名前の側で弾く。id は利用者が宣言に転記するので、符号化しない。

- 撮るはずの組は、`capture_conditions` の 3 つの軸（`pages` × `states` × `viewports`）の直積で決まる。
  チェックは、この直積を期待値にし、`noise_baseline` にも `capture_scope` にも無い組を抜け（`<page>|<state>|<viewport>#not-captured`）として数える。
  - 採った組の一覧を期待値にしない。組ごと外した範囲は一覧からも消えるので、抜けが 1 つも出ないまま通る（範囲の狭さが、差分 0 件と同じ見え方になる）。
  - その組を撮らないなら、他の抜けと同じく `#not-captured` の id で、理由付きの宣言を残す。
  - 3 つの軸のどれかが空か、区切り文字を含むか、重複していると、期待値を作れないので失敗にする。
  - 逆の向きも数える。`noise_baseline` / `capture_scope` に記録があるのに、宣言した組に無い組（消したか名前を変えた変種や、窓の古い記録）も失敗にする。
  - 表示の軸の変種（`display_axes.variants`）も、ビューポートの位置で期待値に入る。
    `pages` × `states` × 変種の label で、その軸を `not_applicable` と宣言したページは除く（下の「表示を切り替える軸（掛け合わせずに撮る）」）。

抜けは、なくすか、対象外として宣言する。
なくすには範囲を広げる。たとえば、`full_page: true` にする、スクロール領域の中身を段階的に撮る状態を足す、論理名の要素が入る位置で撮る。
広げられないなら、`capture_conditions.capture_scope_exemptions` に、抜けの id・理由・`gaps.md` の該当箇所を書く。
同じ内容を、`gaps.md` の「特性化できなかった箇所と理由」に種別「撮影範囲の対象外」として残す。
対応する抜けの無い宣言は失敗にする。古い宣言が残っていると、範囲を狭めてもチェックはエラーを出さない。

```bash
node <skill>/scripts/capture-scope-check.mjs --metadata .replace/parity/<slug>/metadata.json
```

終了コードは、0 が条件を満たす、1 が抜けや不整合が残る（採取に戻す）、2 が使い方の誤りか型の誤りである。
`capture_scope` のキーを持たない成果物も失敗にする。
この節より前に採った成果物は範囲を測っていないので、範囲の実測を足して（必要なら撮り直して）から先に進む。

### 撮る対象が動かなくなるまで待つ

「出た」は「位置が確定した」と同じではない。
中身を後から組むポップアップや、大きさが決まってから位置を詰め直す実装（`ResizeObserver` など）では、出た直後に撮ると、1 画素の上下で 2 つの結果のどちらかになる。
結果が揺れる採取は差分の量を回ごとに変え、実装を変えていない差を実装の差として追わせる（下の「ノイズ基準値」の 2 回撮りでは検出できない）。

- 操作アダプタの状態の移し方（`applyState`）は、状態に固有の assertion で状態が確定した後、撮る対象のポップアップの矩形が 2 回続けて同じ値になるまで待ってから返す。
  ポップアップを開かない状態（default / hover など）は、状態の変化を受ける要素の矩形で待つ。
  新側（`parity-diff` の採取）も同じ操作アダプタを通るので、待ちは両側に反映される。
- 固定時間の待機（`waitForTimeout`）は禁止なので（[`locator-mapping.md`](locator-mapping.md)）、`expect.poll` で矩形を読み比べる。落ち着かなければ例外にして撮らない。
- 自動で消えるポップアップ（トーストなど）は、撮り終えた後にもう一度出ていることを assertion で確かめる。
  待っている間に消えると、消えた後の画面を「その状態」として撮ってしまい、同じ操作で撮るたびに違う結論になる。
  消えるまでの時間（[`coverage.md`](coverage.md)「操作の反応」の `dismissal.duration_ms_samples`）の内に撮り終えられなければ、その状態は撮らない。
  そのときは `gaps.md` に「撮影状態の対象外」として残し、反応の網羅表の `capture` も `state: null` と理由に切り替える。

```ts
import { expect, type Locator } from "@playwright/test";

// 出典: https://playwright.dev/docs/test-assertions#expectpoll（intervals / timeout）、
//       https://playwright.dev/docs/api/class-locator#locator-bounding-box（非表示なら null）
export async function waitForStableRect(target: Locator): Promise<void> {
  let previous = "";
  await expect
    .poll(
      async () => {
        // 1 回の読み取りにも上限を付ける（対象が DOM に無いと既定のアクションタイムアウトまで待ち、poll の期限で止まる保証が無い）
        const now = JSON.stringify(await target.boundingBox({ timeout: 1_000 }));
        const stable = now !== "null" && now === previous;
        previous = now;
        return stable;
      },
      { message: "撮る対象の位置が落ち着かない", intervals: [100], timeout: 3_000 },
    )
    .toBe(true);
}
```

### 寸法の決まり方（窓への追従）

3 つの比較方法（画素・特性の照合・aria）は、`capture_conditions.viewports` に宣言した点でしか比べない。
ビューポートが 1 つだと、その 1 点の実測の px を並べた新側の組み方が、3 つの比較方法すべてで緑になる。
移行元が「割合 × 領域の寸法 ＋ 定数」や「窓の高さ − 定数」で決まっていれば、別の窓では数十 px ずれる。
それでもスイートも差分ツールも最後まで緑のままで、人が触るまで気づけない。

画素の比較の点は増やさない。足すのは位置と寸法の式を読む工程だけで、`getBoundingClientRect()` の読み取りで済む。

- 要る条件: feature モードでは、`capture_conditions.dimension_model` のキーを省かない。
  ビューポートが 1 つなら、`status: measured` か `not_measured`（理由付き）のどちらかにする。ビューポートが 2 つ以上のときだけ、`not_required`（理由付き）を選べる。
- `not_measured` は、`gaps.md` に書いて済ませない。`gaps.md` に書けば通る形では、同じ抜けを機能ごとにくり返し作ってしまう。
  未測定は、`parity-replace` への引き渡しの条件として `dimension_model` に残す。
  `parity-replace` は完了の判定でこれを読み、移していないことを `porting.md` に明示する（原本は `parity-replace` の `SKILL.md` の手順 8）。
- 測る要素: `traits.elements` の論理名のすべて（各論理名があるページで、default 状態）。自分で選ばない。`scripts/dimension-fit.mjs` は、samples に無い論理名を失敗にする。
  操作で現れる要素と、操作で変わる組み方は、式に入らない。それは反応の網羅表の `layout` が持つ（[`coverage.md`](coverage.md)「操作で変わる頁の組み方（`layout`）」）。
- 測る窓: 撮影したビューポートを含む 4 つ以上の窓を、幅と高さを別々に動かして選ぶ。
  縦横比が一定の窓だけでは、幅と高さのどちらに追従しているかを分けられず、スクリプトが失敗にする。
  窓は、撮影したビューポートと同じブレークポイントの範囲の中に取る。
  ブレークポイントの導き方は [`coverage.md`](coverage.md)「スクリーンサイズ」にある。またぐと式が変わるので当てはまらない。
- 当てはめ: `値 = ratio.width × 窓の幅 ＋ ratio.height × 窓の高さ ＋ offset` を、要素 × 軸（x / y / width / height）ごとに最小二乗で当てる。
  領域（グリッド・パネル）が窓に対して線形なら、領域に対して線形な要素も窓に対して線形になるので、領域を選ぶ判断は要らない。
  残差が許容の範囲（デフォルトは 0.5px）の中なら `fits` として記録する。
  超えるか、一部の窓で表示されないなら、`unfit`（式が読めない）として記録する。`unfit` は失敗ではなく記録なので、消さない。

採取は、側に依らない測定のスペック `<parity_suite_dir>/parity/<slug>/dimension/` に置き、`current` と `new` の両方のプロジェクトに含める
（`new-capture` は `testDir` が `new-only/` なので含まれない）。
出力先を project 名で分けるので、側専用のスペックの除外（[`locator-mapping.md`](locator-mapping.md)）が防いでいる「相手側の証跡の上書き」は起きない。

| project | 出力先 |
|---|---|
| `current` | `.replace/parity/<slug>/dimension-samples.json` |
| `new` | `.replace/parity/<slug>/new/<PARITY_NEW_TARGET>/dimension-samples.json`（`PARITY_NEW_TARGET` が無ければ例外にして書かない） |

書き出すのは、`PARITY_DIMENSION_CAPTURE=1` を渡した実行だけで、それ以外はスキップする。
強度のチェック（手順 7）は故障を注入した状態で同じ `current` を回し、ノイズの測定の 2 回目や green の再確認も同じスイートを回す。
そのため、条件なしに書くと、乱れた矩形で samples を上書きし、その値に式を当てはめることになる。
採るのは、この手順（`current`）と、`parity-replace` の完了の判定（`new`）の直前だけにし、採った直後に `fit` / `check` を通す。
`--project` は複数の値を取るので、パスを後ろに置くとプロジェクト名として読まれて失敗する。パスを先に書く。

```bash
PARITY_DIMENSION_CAPTURE=1 PARITY_CURRENT_UI_URL=<url> npx playwright test <parity_suite_dir>/parity/<slug>/dimension/ --project current
```

```ts
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
// スペックは <parity_suite_dir>/parity/<slug>/dimension/ に置くので、共有ライブラリ（<parity_suite_dir>/parity/lib/）は 2 階層上
import { waitForStableRect } from "../../lib/wait"; // 上記「撮る対象が動かなくなるまで待つ」の関数（実際のパスはスイートに合わせる）
import { resolveLocator as resolveCurrent } from "../../lib/locator-map/<slug>"; // 実際のパスは metadata.json の suite.locator_map
// 新側のロケータ例外（replace-metadata.json の suite.locator_map_new）。
// 例外ゼロで parity-replace がファイルを作っていなければ、次の import を消し、代わりに
// `const resolveNewException = (_page: Page, _name: string): Locator | undefined => undefined;` を置く（resolveFor はそのまま使える）
import { resolveLocator as resolveNewException } from "../../lib/locator-map/<slug>.new";

// 撮影ビューポートを含み、幅と高さを独立に動かした 4 窓以上（同じブレークポイントの範囲内）
const WINDOWS = [
  { width: 1366, height: 768 },
  { width: 1600, height: 900 },
  { width: 1280, height: 1024 },
  { width: 1920, height: 800 },
];
// traits.elements の全論理名を、在るページごとに並べる（capture_conditions.pages[].name / path と同じ語彙）
const TARGETS = [{ page: "<ページ名>", path: "<相対パス>", elements: ["<論理名>"] }];

// 新側は「新側例外 → 現側マッピング」の順で解決し、両側で同じ論理名の要素を測る（parity-diff の新側採取雛形と同じ順）
function resolveFor(side: string, page: Page, name: string): Locator {
  return (side === "new" ? resolveNewException(page, name) : undefined) ?? resolveCurrent(page, name);
}

test("寸法の決まり方の採取", async ({ page }, testInfo) => {
  // 採取を宣言した実行だけ書く（強度チェック・ノイズ測定・green 確認で samples を上書きしない）
  test.skip(process.env.PARITY_DIMENSION_CAPTURE !== "1", "PARITY_DIMENSION_CAPTURE=1 の実行でだけ採る");
  const slug = "<slug>";
  const side = testInfo.project.name;
  if (side !== "current" && side !== "new") throw new Error(`current / new 以外の project で走った: ${side}`);
  const root = join(process.cwd(), ".replace", "parity", slug);
  const out =
    side === "current" ? join(root, "dimension-samples.json") : join(root, "new", requireTarget(), "dimension-samples.json");
  // slug・target に `..` や区切り文字が混じると .replace/parity/<slug>/ の外へ書く。書く前に落とす
  const rel = relative(root, out);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`出力先 ${out} が ${root} の外を指す`);
  type Sample = { window: (typeof WINDOWS)[number]; rect: { x: number; y: number; width: number; height: number } | null };
  const elements: { page: string; element: string; rects: Sample[] }[] = [];
  for (const t of TARGETS) {
    const rects = new Map<string, Sample[]>(t.elements.map((e): [string, Sample[]] => [e, []]));
    for (const w of WINDOWS) {
      await page.setViewportSize(w);
      await page.goto(t.path);
      for (const name of t.elements) {
        const locator = resolveFor(side, page, name);
        // 即時読み取り（isVisible）は描画前に false を返す。自動で待つ assertion を上限つきで通し、
        // 出なかった窓は toBeHidden で「見えない」を確かめてから null にする。ロケータの曖昧さ・ページのクローズ等は
        // toBeHidden も失敗するので、その例外はそのまま投げて採取を止める（壊れた採取を hidden として記録しない）
        const visible = await expect(locator)
          .toBeVisible({ timeout: 5_000 })
          .then(
            () => true,
            async () => {
              await expect(locator).toBeHidden({ timeout: 1_000 });
              return false;
            },
          );
        if (visible) await waitForStableRect(locator);
        // 出典: https://developer.mozilla.org/docs/Web/API/Element/getBoundingClientRect（ビューポート基準。スクロール量を足してページ座標にする）
        const rect = visible
          ? await locator.evaluate((el) => {
              const r = el.getBoundingClientRect();
              return { x: r.x + window.scrollX, y: r.y + window.scrollY, width: r.width, height: r.height };
            })
          : null;
        rects.get(name)!.push({ window: w, rect });
      }
    }
    for (const [element, r] of rects) elements.push({ page: t.page, element, rects: r });
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify({ windows: WINDOWS, elements }, null, 2)}\n`);
});

function requireTarget(): string {
  const v = process.env.PARITY_NEW_TARGET;
  if (!v) throw new Error("PARITY_NEW_TARGET が未設定（新側の出力先 new/<target>/ を決められない）");
  // target 名は 1 つのディレクトリ名に限る（設定 targets の名前。`..`・区切り文字を通さない）
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(v) || v.includes("..")) {
    throw new Error(`PARITY_NEW_TARGET が target 名の形でない: ${v}`);
  }
  return v;
}
```

採ったら、`traits.elements`・`capture_conditions.viewports`・`capture_conditions.pages` を書いた `metadata.json` に対して、当てはめを通す。
スクリプトはコピーせず、スキルの下から実行する。値を手で転記しない。

```bash
node <skill>/scripts/dimension-fit.mjs fit \
  --samples .replace/parity/<slug>/dimension-samples.json \
  --metadata .replace/parity/<slug>/metadata.json --write
```

- exit 0 なら、`capture_conditions.dimension_model` に `status: measured`・`measured_at`・`fits`・`unfit` が書かれる。
  exit 2 なら採り直す。exit 2 になるのは、窓が 4 つ未満、一直線上の窓、撮影したビューポートを含まない、撮影したページや `traits.elements` の測り忘れ、
  すべての窓で表示されない要素、キーの欠けや重複、型の誤りのときである。
- `dimension-samples.json` は、テキストの成果物として Git に入れる。`parity-replace` の照合は `metadata.json` の式を使い、samples は当てはめ直すときの根拠になる。
- 要素や窓を変えて採り直したら、`fit` も通し直す。
  `dimension_model.samples_fingerprint` は、どの samples から当てた式かの記録である。
  `parity-replace` の `check` は、現側の `dimension-samples.json` とこの指紋を照合し、一致しなければ exit 2 で止まる。

### スクロールバーが場所を取る窓のはみ出し

スクロールバーが隠れていると、頁の高さの決め方の違い（`height: 100%` と `100vh`）は、3 つの比較方法のどれにも記録されない。
Playwright は、ヘッドレスの Chromium を `--hide-scrollbars` 付きで起動する（出典: <https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/chromium/chromium.ts> の `headless` の分岐）。
隠れたスクロールバーは場所を取らないので、横スクロールバーが出る窓でも「見える高さ」が減らない。そのため、`100vh` と `height: 100%` はどの窓でも同じ値になる。
上の「寸法の決まり方」をいくつの窓で測っても、この差は 0 のままである。

スクロールバーが場所を取る窓では、次の差が出る。移行元の `html`・`body` と領域が `height: 100%` で、新側の領域が `min-height: 100vh` の場合である。

- 窓の幅が頁の最小幅より狭いと横スクロールバーが出て、見える高さ（`100%`）はその厚みだけ減る。`100vh` は減らない。
- 中身が窓の高さに収まる頁でも、新側だけが横スクロールバーの厚みのぶんはみ出し、縦スクロールバーが出る。

最小幅を持つ業務画面では、狭い窓で必ず当たる差である。
そのため、feature モードでは、次の 3 つを `metadata.json` の `capture_conditions` に残す（形式はテンプレート `assets/metadata-template.json`）。

- `scrollbars`: ベースラインを撮ったときに、スクロールバーが場所を取ったか（`hidden` / `shown`）。
  - **デフォルトは `shown`** である。Playwright のヘッドレス Chromium のデフォルトは `hidden` なので、撮影・特性の採取・範囲の実測をするプロジェクトの `use.launchOptions` に `ignoreDefaultArgs: ["--hide-scrollbars"]` を足して撮る。
    対象は `current` と、`parity-diff` の `new-capture` である。プロジェクトに `launchOptions` がすでにあれば、その値に足す。
  - `parity-diff` の新側の採取も、同じ扱いで撮る。片側だけ場所を取ると、見える幅と高さが厚みのぶんずれて、全面の差分になる。
  - `hidden` で撮るなら、`scrollbars_reason` に理由を書き、同じ内容を `gaps.md` に残す。
    隠して撮ると、次の差が 3 つの比較方法のどれにも記録されない。バーが場所を取って中身がはみ出す差、横のバーが出るか出ないかの差、バーの見た目の差である。
    スクロール領域の `scroll` も、両側とも「厚み 0」にそろう（上の「3 点セット」）。理由の無い `hidden` は、`capture-scope-check.mjs` が失敗にする。
  - 起動の引数を設定しただけで、「shown で撮った」としない。`cdp`（利用者環境のブラウザへの接続）では `launchOptions` が機能せず、接続先の起動の仕方で決まる。
    撮影の最初に、撮影に使うページに `overflow: scroll` の箱を 1 つ置いて、バーの幅（`offsetWidth − clientWidth`）を読む。
    このページは頁に移動する前の `about:blank` である。確かめるのはブラウザの起動の仕方で、頁の CSS ではないからである。
    `shown` なのに 0、または `hidden` なのに 0 でなければ、撮らない（`parity-diff` の新側の採取のひな形も、同じ実測で止める）。
- `scrollbar_environment`（`shown` のとき）: どの OS・ブラウザの、どの種類（クラシック / オーバーレイ）のスクロールバーで撮ったか（例: `Linux の headless Chromium 140（クラシック・15px）`）。
  スクロールバーの描き方は OS とブラウザで変わるので、採取環境で撮ったバーの画素や厚みを、利用者環境の見え方の根拠にしない。
  利用者環境のバーが違う種類なら（例: 利用者は macOS のオーバーレイ）、`viewer_environment` を「乖離」にして `gaps.md` に残す。
  または、表示の軸の候補 `scrollbar-appearance` として値ごとに撮る（下の「表示を切り替える軸」）。欠けている値とプレースホルダは、`capture-scope-check.mjs` が失敗にする。
- `overflow`: スクロールバーを表示させた窓（`scrollbars: shown`）での、縦と横のはみ出し。
  キーを省かない。測れないなら、`status: not_measured` と `reason` を書き、同じ理由を `gaps.md` に残す。

測る窓は、測定のスペックが頁ごとに導く。撮影したビューポートに加えて、頁が最小幅を持つなら、次の 2 つの窓を足す。幅と高さは手で選ばない。

1. 最小幅より狭く、撮影したビューポートと同じ高さの窓（横スクロールバーが出る）
2. 1 と同じ幅で、中身が収まる高さの窓。縦のはみ出しが頁の高さの決め方だけで決まるので、`100%` と `100vh` の差がここに出る

最小幅は、次の窓で文書の `scrollWidth` を読んで決める。
320px から撮影したビューポートの幅まで 40px 刻みの窓と、頁のスタイルシート（`@import` で読み込んだものを含む）から読んだ、メディアクエリの幅の境界の前後の窓である。
横にはみ出した窓のうち、最も広いものを 1 の幅にする。中間のブレークポイントでだけ最小幅が有効になるレスポンシブな頁を、1 つの窓や刻みだけの探索で見落とさないためである。

- 読めないスタイルシート（別のオリジンで CORS の無いものなど）があれば、その境界は探索できていない。
  件数は `probe.unreadable_stylesheets` に残る。`gaps.md` に「採取環境依存の未検証」として書き、`probe.gaps_ref` に該当箇所を入れる。
- JavaScript やコンテナクエリで最小幅を変える頁も拾えないので、同じく `gaps.md` に残す。
- 2 の高さは、1 の窓で読んだ文書の `scrollHeight`（`content_height` として記録する）より高く取る。チェックは、その窓があることを確かめる。
- どの窓でも横にはみ出さない頁は、`min_width: null`（最小幅を持たない）として、撮影したビューポートと 320px 幅の窓だけを測る。
- 各窓では、縦と横のはみ出しの有無に加えて、はみ出しの量（`scrollHeight − clientHeight` など）を残し、スペックは量で比べる。
  どの高さでも縦にはみ出す頁（`body { height: 100% }` とデフォルトの margin）では、有無だけだと、`100%` と `100vh` が両側とも「はみ出す」になり区別できない。

測定のスペックは `<parity_suite_dir>/parity/<slug>/overflow/overflow.spec.ts` に置き、`current` と `new` の両方のプロジェクトに含める。
同じスペックが 2 つの役を持つ。
`PARITY_OVERFLOW_CAPTURE=1` を渡した `current` の実行では、実測を `metadata.json` の `capture_conditions.overflow` に書く。
それ以外の実行では、その記録を期待値として読み、現と新の両側に当てる。新側が現側と同じ窓で同じはみ出し方をすることを、スイートの green が保証する。

- ファイルを分けるのは、起動の引数（`launchOptions`）がワーカー単位の設定だからである。
  `test.use({ launchOptions })` はファイルの最上位にしか書けない（`describe` の中では新しいワーカーが要るので使えない）。
  そのため、同じファイルの他のテストも、スクロールバーを表示した状態になる。撮影・特性の採取・寸法の採取は、撮影時の扱い（`scrollbars`）のまま実行する
  （出典: <https://github.com/microsoft/playwright/blob/main/packages/playwright/src/common/fixtures.ts> の「Cannot use({ … }) in a describe group, because it forces a new worker」）。
- プロジェクトの `launchOptions` を上書きする。設定に `launchOptions`（`args` など）があるなら、下の `test.use` にその値を転記したうえで、`ignoreDefaultArgs` を足す（`test.use` はオブジェクトごと置き換える）。
- 頁ごとに 1 つのテストにする。`parity-replace` はページ単位のフェーズでスイートを回すので、頁で分けないと、未実装の頁があるために最初のフェーズを完了できない。

```bash
PARITY_OVERFLOW_CAPTURE=1 PARITY_CURRENT_UI_URL=<url> npx playwright test <parity_suite_dir>/parity/<slug>/overflow/ --project current
```

```ts
import { readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, test, type Page } from "@playwright/test";
// スペックは <parity_suite_dir>/parity/<slug>/overflow/ に置くので、共有ライブラリ（<parity_suite_dir>/parity/lib/）は 2 階層上
import { waitForStableRect } from "../../lib/wait"; // 上記「撮る対象が動かなくなるまで待つ」の関数（実際のパスはスイートに合わせる）

// スクロールバーが場所を取る状態で起動する（ヘッドレス Chromium の既定の --hide-scrollbars を外す）。
// launchOptions はワーカー単位の設定なので、ファイルの最上位に置く。プロジェクトに launchOptions があれば、その値をここへ写してから足す
test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

const slug = "<slug>";
const metadataPath = join(process.cwd(), ".replace", "parity", slug, "metadata.json");
// 頁と撮影したビューポートは metadata.json（capture_conditions.pages / viewports）から引く。手で書き写さない
const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
const { pages, viewports } = metadata.capture_conditions as {
  pages: { name: string; path: string }[];
  viewports: { width: number; height: number }[];
};
const capturing = process.env.PARITY_OVERFLOW_CAPTURE === "1";
// 強度チェック専用: 頁の高さの決め方を変える CSS を当てる（references/strength-gate.md の故障カタログ）。current 以外では使わない
const faultCss = process.env.PARITY_OVERFLOW_FAULT_CSS;
/** 最小幅を読む狭い窓の幅 */
const PROBE_WIDTH = 320;
/** 最小幅を探す窓の刻み。これより狭い帯でだけ効く最小幅は、下のメディアクエリの境界で拾う */
const PROBE_STEP = 40;

/**
 * 頁のスタイルシートからメディアクエリの幅の境界を集める。最小幅が変わるのは境界だけなので、その前後を探索に足す。
 * 読めないスタイルシート（別オリジンで CORS の無いもの等。cssRules が例外を投げる）は件数を返し、gaps.md へ回す。
 * 拾えないもの: JavaScript（matchMedia・ResizeObserver）やコンテナクエリで最小幅を変える頁
 */
async function readBreakpoints(page: Page): Promise<{ widths: number[]; unreadable: number }> {
  return page.evaluate(() => {
    const widths = new Set<number>();
    let unreadable = 0;
    // min-width / max-width と範囲構文（width >= 768px、768px <= width）。em / rem はメディアクエリでは初期値 16px で換算する
    const collect = (text: string) => {
      const px = (value: string, unit: string) => Number(value) * (unit === "px" ? 1 : 16);
      for (const m of text.matchAll(/(?:min|max)-width\s*:\s*([\d.]+)(px|em|rem)/g)) widths.add(px(m[1], m[2]));
      for (const m of text.matchAll(/width\s*[<>]=?\s*([\d.]+)(px|em|rem)/g)) widths.add(px(m[1], m[2]));
      for (const m of text.matchAll(/([\d.]+)(px|em|rem)\s*[<>]=?\s*width/g)) widths.add(px(m[1], m[2]));
    };
    const walk = (rules: CSSRuleList) => {
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSMediaRule) collect(rule.conditionText);
        // @import は cssRules を持たず、読み込んだ規則は styleSheet の下、読み込みの条件は media にある。
        // 読めない読み込み先（別オリジン等）は unreadable に数える（黙って読み飛ばさない）
        if (rule instanceof CSSImportRule) {
          collect(rule.media.mediaText);
          try {
            if (!rule.styleSheet) throw new Error("読み込み先が無い");
            walk(rule.styleSheet.cssRules);
          } catch {
            unreadable += 1;
          }
          continue;
        }
        // @supports・@layer・入れ子の @media も辿る
        if ("cssRules" in rule) walk((rule as CSSGroupingRule).cssRules);
      }
    };
    for (const sheet of Array.from(document.styleSheets)) {
      collect(sheet.media.mediaText); // <link media="..."> で読み込み自体が切り替わるもの
      try {
        walk(sheet.cssRules);
      } catch {
        unreadable += 1;
      }
    }
    return { widths: [...widths].sort((a, b) => a - b), unreadable };
  });
}

type Window = { width: number; height: number };
type Measured = {
  horizontal: boolean;
  vertical: boolean;
  horizontal_bar_px: number;
  overflow_x_px: number;
  overflow_y_px: number;
};

async function measure(page: Page, path: string, w: Window): Promise<Measured> {
  await page.setViewportSize(w);
  await page.goto(path);
  if (faultCss) await page.addStyleTag({ content: faultCss });
  // 頁の描画が落ち着くまで待つ（はみ出しは文書の寸法で決まるので、文書の根の矩形が動かなくなるまで）
  await waitForStableRect(page.locator("body"));
  // 出典: https://developer.mozilla.org/docs/Web/API/Document/scrollingElement（quirks なら body、標準なら html）
  return page.evaluate(() => {
    const el = document.scrollingElement ?? document.documentElement;
    // 根で横を切っている頁（html か、html が visible なら伝播する body の overflow-x が hidden / clip）は、
    // scrollWidth が大きくても横スクロールバーが出ない。はみ出しとして数えると「隠れたまま測った」と取り違える
    const rootX = getComputedStyle(document.documentElement).overflowX;
    const viewportX = rootX === "visible" && document.body ? getComputedStyle(document.body).overflowX : rootX;
    const clipsX = viewportX === "hidden" || viewportX === "clip";
    const overflowX = clipsX ? 0 : Math.max(0, el.scrollWidth - el.clientWidth);
    const overflowY = Math.max(0, el.scrollHeight - el.clientHeight);
    return {
      horizontal: overflowX > 0,
      vertical: overflowY > 0,
      // はみ出し量。真偽値だけだと、どの高さでも縦にはみ出す頁（body の height: 100% と既定の margin）で
      // 100% と 100vh が両側とも vertical: true になり見分けられない
      overflow_x_px: overflowX,
      overflow_y_px: overflowY,
      // 横スクロールバーの厚み。横にはみ出して 0 なら、スクロールバーが隠れたまま測っている
      horizontal_bar_px: window.innerHeight - el.clientHeight,
    };
  });
}

function assertBarTakesSpace(m: Measured, label: string): void {
  if (m.horizontal && m.horizontal_bar_px <= 0) {
    throw new Error(`${label}: 横にはみ出しているのに横スクロールバーが場所を取っていない（--hide-scrollbars が残っている）`);
  }
}

if (capturing) {
  test("はみ出しの採取", async ({ page }, testInfo) => {
    if (testInfo.project.name !== "current") throw new Error("採取は current でだけ行う（期待値は現側の実測）");
    if (faultCss) throw new Error("故障を注入したまま採取しない");
    const records = [];
    for (const p of pages) {
      const base = viewports[0];
      // 最小幅は 1 窓では決まらない（中間のブレークポイントでだけ min-width が効くレスポンシブな頁は、320px でも撮影幅でも
      // はみ出さない）。PROBE_WIDTH から撮影ビューポートの幅まで PROBE_STEP 刻みで読み、横にはみ出した窓のうち最も広いものを狭い窓にする
      const maxWidth = Math.max(...viewports.map((v) => v.width));
      await page.setViewportSize({ width: base.width, height: base.height });
      await page.goto(p.path);
      await waitForStableRect(page.locator("body"));
      const breakpoints = await readBreakpoints(page);
      // 刻みの格子に、各境界の前後（境界で規則が切り替わる両側）を足す
      const probeWidths = new Set<number>();
      for (let width = PROBE_WIDTH; width < maxWidth; width += PROBE_STEP) probeWidths.add(width);
      for (const b of breakpoints.widths) {
        for (const width of [Math.floor(b) - 1, Math.floor(b), Math.ceil(b), Math.ceil(b) + 1]) {
          if (width >= PROBE_WIDTH && width < maxWidth) probeWidths.add(width);
        }
      }
      let minWidth: number | null = null;
      let narrowWidth: number | null = null;
      for (const width of [...probeWidths].sort((a, b) => a - b)) {
        await page.setViewportSize({ width, height: base.height });
        await page.goto(p.path);
        await waitForStableRect(page.locator("body"));
        const probe = await page.evaluate(() => {
          const el = document.scrollingElement ?? document.documentElement;
          // measure と同じ判定（根で横を切っている頁は横スクロールバーが出ないのではみ出しに数えない）
          const rootX = getComputedStyle(document.documentElement).overflowX;
          const viewportX = rootX === "visible" && document.body ? getComputedStyle(document.body).overflowX : rootX;
          const clipsX = viewportX === "hidden" || viewportX === "clip";
          return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, clipsX };
        });
        if (!probe.clipsX && probe.scrollWidth > probe.clientWidth) {
          minWidth = Math.max(minWidth ?? 0, probe.scrollWidth);
          narrowWidth = width;
        }
      }
      const windows: Window[] = viewports.map((v) => ({ width: v.width, height: v.height }));
      // 最小幅より狭い窓で読んだ中身の高さ（capture-scope-check が「これより高い狭い窓」があることを確かめる）
      let contentHeight: number | null = null;
      if (minWidth === null || narrowWidth === null) {
        windows.push({ width: PROBE_WIDTH, height: base.height });
      } else {
        // 最小幅より狭い窓（横スクロールバーが出る）と、同じ幅で中身が収まる高さの窓
        const narrow = { width: narrowWidth, height: base.height };
        await page.setViewportSize(narrow);
        await page.goto(p.path);
        await waitForStableRect(page.locator("body"));
        contentHeight = await page.evaluate(
          () => (document.scrollingElement ?? document.documentElement).scrollHeight,
        );
        windows.push(narrow, { width: narrow.width, height: contentHeight + 100 });
      }
      const seen = new Set<string>();
      const measured = [];
      for (const w of windows) {
        const key = `${w.width}x${w.height}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const m = await measure(page, p.path, w);
        assertBarTakesSpace(m, `${p.name} ${key}`);
        measured.push({ ...w, ...m });
      }
      records.push({
        page: p.name,
        min_width: minWidth,
        content_height: contentHeight,
        // 探索の範囲。読めないスタイルシートがあれば、その境界は探索できていない。gaps.md の該当箇所を gaps_ref に書く
        probe: {
          step: PROBE_STEP,
          breakpoints: breakpoints.widths,
          unreadable_stylesheets: breakpoints.unreadable,
          gaps_ref: null,
        },
        windows: measured,
      });
    }
    // 他の採取と並行して metadata.json を書き換えない（このディレクトリだけを単独で回す）
    const current = JSON.parse(readFileSync(metadataPath, "utf8"));
    current.capture_conditions.overflow = {
      status: "measured",
      scrollbars: "shown",
      spec: relative(process.cwd(), testInfo.file),
      pages: records,
      reason: null,
    };
    writeFileSync(metadataPath, `${JSON.stringify(current, null, 2)}\n`);
  });
} else {
  const overflow = metadata.capture_conditions.overflow;
  if (overflow?.status !== "measured") {
    throw new Error("capture_conditions.overflow が measured でない。PARITY_OVERFLOW_CAPTURE=1 で current に採ってから回す");
  }
  for (const record of overflow.pages as { page: string; windows: (Window & Measured)[] }[]) {
    const p = pages.find((x) => x.name === record.page);
    if (!p) throw new Error(`capture_conditions.pages に無い頁: ${record.page}`);
    test(`はみ出し: ${record.page}`, async ({ page }, testInfo) => {
      if (faultCss && testInfo.project.name !== "current") throw new Error("故障の注入は current でだけ行う");
      for (const w of record.windows) {
        const label = `${record.page} ${w.width}x${w.height}`;
        const m = await measure(page, p.path, w);
        assertBarTakesSpace(m, label);
        // 量で比べる（±1px はサブピクセルの丸め）。真偽値の一致だけでは、両側ともはみ出す頁で高さの決め方の差を見逃す
        expect.soft(Math.abs(m.overflow_x_px - w.overflow_x_px), `${label} の横のはみ出し量`).toBeLessThanOrEqual(1);
        expect.soft(Math.abs(m.overflow_y_px - w.overflow_y_px), `${label} の縦のはみ出し量`).toBeLessThanOrEqual(1);
      }
    });
  }
}
```

採ったら、`capture-scope-check.mjs` を通す（手順 8）。
記録の形の誤り、最小幅と窓の矛盾、横にはみ出した窓で横スクロールバーが場所を取っていない記録（隠れたまま測った記録）を、失敗にする。

- 採った後は、同じスペックを採取用の環境変数を外して `current` で回し、green になることを確かめる。期待値と測り方が、同じ実行の仕組みで一致することの確認である。
- 頁やビューポートを変えたら、採り直す（記録の頁は `capture_conditions.pages` と突き合わせる）。

### 表示を切り替える軸（掛け合わせずに撮る）

利用者が表示を切り替えられる軸（ロケール・配色テーマなど）を数えずに撮ると、デフォルトの 1 つの値での差しか、3 つの比較方法のどれにも記録されない。
撮影条件の `viewports` / `states` / `pages` はこの軸を持たない。網羅表からの状態の導出（上の「撮影状態の決め方（1）」）も、部品ごとの状態しか出さない。
頁全体の表示を切り替える軸は網羅表に行を持たないので、どの導出の外にも残る。
実測では、English / Japanese の 2 つの値を持つ画面を English だけで作り、新側がロケールに追従しないまま、`parity-replace` の完了の判定と `parity-diff` の反復を通った。
利用者が Japanese で開いて、初めて気づいた。

軸は数えて、`capture_conditions.display_axes` に残す（形式はテンプレート `assets/metadata-template.json`）。数えるときは、同梱の候補の一覧から始める。
候補の一覧の原本は `scripts/capture-scope-check.mjs` の `AXIS_CANDIDATES` で、ここには転記しない。
ロケール、文字の方向、数値と日付の書式、配色テーマ、`forced-colors`、`prefers-contrast`、文字の大きさと拡大率、DPR、`prefers-reduced-motion`、権限やロールで変わる表示、印刷、スクロールバーの出方が入っている。
すべての候補を、`axes`（ある）か `absent`（無い）のどちらかに 1 回だけ振り分ける。
振り分けていない候補は失敗にする。思い付かなかった軸と、無いと確かめた軸を、同じ見え方にしないためである。
一覧に無い軸は、`candidate: "other"` で足す。
スクロールバーの出方（常に表示・オーバーレイ）は利用者の OS とブラウザの設定で変わるので、候補 `scrollbar-appearance` として数える
（採取環境で撮るバーが場所を取るかは、別に `scrollbars` / `overflow` が持つ）。

- ある軸には、出所を付ける。付けるのは、値の一覧（`values`）、基準の組を撮った値（`default`）、値の一覧をどこから数えたか（`source`）、値の当て方（`apply`）である。
  根拠の欄に、テンプレートの `<…>` や TODO、未確認のまま残した値は数えない。
  デフォルトの値も、ブラウザや OS に任せず、明示して当てる。Playwright のデフォルトのロケールや OS の配色で決まる値は、採取環境と新側の撮影環境で変わることがある。
- 掛け合わせずに撮る。すべての軸を掛け合わせると、組み合わせが急に増える（ロケール 2 × 配色 2 × 窓 4 × 状態 10 で 160 組、現と新で倍）。そのため、次の規則で撮る組を決める。
  1. 基準の組: すべての軸をデフォルトの値にして、すべてのページ × すべての状態 × すべての窓を撮る。
  2. 1 つの軸ずつ変える: デフォルト以外の値ごとに、他の軸はデフォルトのまま、すべてのページ × すべての状態を 1 つの窓で撮る。
     これを `variants` に 1 行ずつ書く（`values` にはその軸だけを書く）。軸が機能する範囲は頁全体なので、ページと状態は減らさない。
  3. 互いに作用する組だけを掛け合わせる: 軸と軸、軸と窓（`viewport`）の、すべての組について、掛けたか（`crossed`）と理由を `pairs` に書く。
     掛けた組は、軸 × 窓ならすべての窓で、軸 × 軸ならデフォルト以外の値の組み合わせごとに、変種を足す（例: 文言の長さで折り返しが変わる `locale` × `viewport`）。
  4. 軸が機能しないページは、理由を付けて外す: その軸の `not_applicable` に、ページと出所を書く。そのページは変種で撮らない。
- 変種の撮り方: 変種の `label` を、ビューポートの label と同じ位置に書く。`noise_baseline` / `capture_scope` の `viewport` と、書き出し先のディレクトリである。
  - label は書き出し先のディレクトリ名と、`PARITY_NOISE_PAIRS` などのカンマ区切りの組にもなるので、`.` / `..` / パスの区切り・カンマは使えない。
  - 窓の寸法は、変種の `viewport` が指す窓のものを使う。
  - 変種の軸がすべてのページで機能しない変種（`not_applicable` がすべてのページを覆う）は、撮る組が 0 件になるので失敗にする。
  - 変種も、基準の組と同じく、ノイズ基準値の 2 回撮りと範囲の実測を採る。
  - 採取のスペックは、窓と変種を外側のループにして回す。ページを開いたら、状態に移す前に、操作アダプタ `applyDisplayAxes(page, 値)` ですべての軸の値を当てる。
    基準の組ではすべての軸の `default` を、変種ではそれに `values` を重ねたものを当てる。
    当て方は `apply` に書いたとおりで、ロケールの cookie を書いて読み込み直す、`page.emulateMedia({ colorScheme })` を使う、などがある
    （出典: <https://playwright.dev/docs/api/class-page#page-emulate-media>）。当てた後は、`applyState` と同じく、撮る対象の矩形が落ち着くまで待つ。
- スイートにも反映する。視覚ベースラインだけでは、スイートはデフォルトの値でしか緑を示さない。
  値ごとに変わる文言や振る舞いは、期待値を解決する層に軸の値の次元を足して持ち（[`locator-mapping.md`](locator-mapping.md)「期待値解決層」）、そのパスを軸の `suite_expectations` に書く。
  値で文言も振る舞いも変わらない軸（配色だけが変わるなど）だけ、`suite_reason` に根拠を書く。
- 抜けは `capture-scope-check.mjs` が数える（手順 8。`parity-diff` の収束の判定も、同じスクリプトを呼ぶ）。
  変種は撮るはずの組に入るので、撮っていない組は、他の撮影の組と同じく `#not-captured` の抜けになる。撮らないなら、`capture_scope_exemptions` に理由と `gaps.md` の該当箇所を書く。
  次のものも失敗にする。候補の振り分け忘れ、1 つの軸ずつの変種の欠け、組の判断の欠け、掛けると宣言した組の変種の欠け、スイートへの反映の仕方が決まっていないこと、である。
- `display_axes` を持たない既存の `metadata.json` では、軸を数えて変種を撮り足す（基準の組はそのまま使える。軸が 1 つも無ければ、候補をすべて `absent` に書くだけでよい）。

### 採取環境と利用者環境の乖離

採取環境でだけ成り立つ一致は、差分ツールでは捉えられない。
現と新を同じ環境で撮る統制は、その環境に固有の解決（フォントのフォールバック先、システムの UI から来るデフォルトの値）を、現と新の両側に等しく当てる。
そのため、環境が変われば現れる差を、差分 0 として通してしまう。

- 典型的な例は、フォントスタックに総称ファミリー（`system-ui` / `sans-serif`）や、利用者環境にしか無い書体を含めることである。
  CJK のフォールバック先は OS ごとに違うので、採取環境では現と新とも同じフォントに解決され、差分ツールは 0 を返す。そして、別の OS の利用者環境でだけ、字の幅が変わる。
  実測では、本文の幅が 2 割以上ずれた事例がある。
  和文 6 文字のボタンが、採取環境でだけ 88px の領域からはみ出し、利用者環境では収まった事例もある。
  後者では、採取環境の画面を見たエージェントが、利用者環境では起きない文字の切れを、差の候補として報告した。
- 撮影環境を記録するだけでは足りない（記録した値を誰も読まないため）。
  `metadata.json.capture_conditions` に、採取環境（OS・ブラウザ・DPR）と、想定する利用者環境が一致するかを `viewer_environment` として残し、次のどれかを取る。
  1. 環境に依存しないフォントスタックにする。総称ファミリーに解決を任せず、CJK を含めて実体のフォントを配る。採取環境と利用者環境の差そのものをなくす方法である。
     リプレイスの現行の側には使えない。正解は現行の描画で、現行のフォントスタックは変えられないからである（新側だけを実体のフォントにすると、現行と比べる前提が成り立たなくなる）。
     リプレイスでは 2 か 3 になる。
  2. 利用者環境のブラウザで採る。スイートを回す環境は移さず、利用者環境で起動したブラウザ（デバッグのポートを開けた Chromium 系）に、Playwright の `connectOverCDP` で接続して撮る。
     スイート・差分ツール・成果物は今の環境のままで、描画だけが利用者環境で行われる。
     接続先は target ごとの `browser.cdp_url` である（スキーマの原本は `replace-strategy` の `references/project-config.md`「実行対象環境」）。
     設定の仕方は [`locator-mapping.md`](locator-mapping.md)「利用者環境のブラウザへ接続する」にある。
     現と新の両側に同じ宣言が要る。片側だけ利用者環境で撮ると、環境の差がそのまま差分に出る。
     実際に描いた書体は、CDP の `CSS.getPlatformFontsForNode` で読んで確かめる（出典: <https://chromedevtools.github.io/devtools-protocol/tot/CSS/#method-getPlatformFontsForNode>）。
  3. どちらも取れないなら、`gaps.md` に「採取環境依存の未検証」として残す（確認済みにしない）。
- 記録の形は、`一致: <確かめ方>` か `乖離: <内容と gaps.md の該当箇所>` の 2 つだけで、`capture-scope-check.mjs` が数える（手順 8。`parity-diff` の収束の判定も、同じスクリプトを呼ぶ）。
  乖離は、`gaps.md` の該当箇所を書かないと失敗にする。
  「未確認」と、確かめ方の無い「一致」も失敗にする。`一致: 未確認` / `一致: TODO` のように、後ろがプレースホルダの形も失敗にする（語彙の原本は `capture-scope-check.mjs` の `UNCONFIRMED_BODY`）。
  未確認のまま収束すると、採取環境でだけ成り立つ一致が、誰にも見えないまま残る。
  撮影に使ったブラウザ（`launched` か `cdp`）は `capture_conditions.browser` に、`cdp` では接続先の同一性を `browser_identity` に残す。
  `parity-diff` の新側の採取は、同じ扱い・同じ利用者環境で撮るために、これを読む。
- 総称ファミリーから来るものでなくても、採取環境のデフォルトの値に解決される指定（システムのフォント、システムの色、OS のデフォルトのフォームコントロールの外観）には、同じ抜けがある。
  フォントスタックだけを見て済ませない。
- スクロールバーも、OS のデフォルトの外観に解決される。クラシック（場所を取る）かオーバーレイ（場所を取らない）か、厚みや色は、OS・ブラウザ・利用者の設定で変わる。
  そのため、採取環境で撮ったバーを、利用者環境の見え方の根拠にしない。
  撮ったバーの出どころは `scrollbar_environment` に残し、利用者環境のバーと種類が違えば `viewer_environment` を「乖離」にする
  （上の「スクロールバーが場所を取る窓のはみ出し」。値ごとに撮るなら、表示の軸 `scrollbar-appearance` を使う）。

## ノイズ基準値

時刻・乱数・ID・描画の揺れは、同じアプリを 2 回撮るだけでも差分として現れる。
この差分の量がノイズの基準で、`parity-diff` は「新側との差分がこれと同じくらいなら、回帰ではない」と判定できる。

- 現行を同じ条件で 2 回撮り、2 回分に対して画素の差分と特性の照合（[`../scripts/trait-compare.mjs`](../scripts/trait-compare.mjs)）を回す。
  その差分の量を、ページ・状態・ビューポートごとに `metadata.json` に記録する（3 点セットと同じ粒度）。
- 画素は 2 種類とも記録する。
  `pixel_diff`（記録済みのツールのしきい値つき）だけでなく、`pixel_diff_strict` / `pixel_diff_strict_only`（しきい値なしの画素数と、そのうちツールが印を付けなかったぶん）も記録する。
  `parity-diff` は現新の差を同じ軸の基準値と比べるので、しきい値つきの値しか無いと、strict の実測が必ず超えてしまう。そうなると、ふつうの描画の揺れまで、対応が必要と判定される。
- strict の 2 種類は、同梱の [`../scripts/pixel-strict-count.mjs`](../scripts/pixel-strict-count.mjs) で数える。スキルのディレクトリから直接実行し、プロジェクトにコピーしない。

  ```text
  node <スキルディレクトリ>/scripts/pixel-strict-count.mjs <baseline の PNG> <noise-pass2 の PNG> [--diff <記録済みツールの差分画像>]
  ```

  `--diff` を渡すと、`strict_only_pixels`（しきい値の内側に隠れたぶん）も出る。渡さなければ `null` になる（0 と区別する）。
  `pngjs` に依存する。無ければ、入れてよいかをユーザーに確かめる（このスキルは勝手にインストールしない）。
  `parity-diff` の `scripts/pixel-crops.mjs` にも同じ数え方があるが、インストール先が別なので、互いを import しない（規則を変えたら両方を直す）。
- 2 回目の書き出し先は `.replace/parity/<slug>/noise-pass2/` にする。1 回目（`baseline/`）と対称のレイアウトで、同じ場所に撮ると 1 回目を上書きして、比べる相手が消える。
- 2 つの標本が一致しても、採取が決定論的であることの証明にはならない。2 つの値のどちらかになる採取は、1/2 の確率で「ノイズ 0」になる。
  上の「撮る対象が動かなくなるまで待つ」を、1 回目と 2 回目の両方で満たしたうえで測る（標本を増やしても、待たずに撮る限り、揺れる採取は残る）。
  - 待ちが落ち着かずに例外になった状態は、基準値を記録しない。`capture_conditions.states` から外し、`gaps.md` に「撮影状態の対象外」として理由付きで残す（どの状態でも必須）。
  - その状態を `captured` に持つ `popup_inventory` の行があれば、その行も `captured: null` と `reason` にする。
    ポップアップを開かない default / hover などには該当する行が無いので、`gaps.md` だけでよい。
  - 同じ状態名を `captured` に持つ `visual_state_coverage.rows` の行も、`captured: null` と `reason` に切り替える。
    切り替えないと、`coverage-expand.mjs --metadata` が「`states` に無い状態名」として失敗にする。切り替えれば、「撮れない状態」として理由が残る。
    `states` に残すと、`parity-diff` の事前の確認が `noise_baseline` の欠けで止まり、新側の採取もその状態の `applyState` で例外になる。

### 2 回目の採取物は基準値を記録したら削除する

残すのは基準値（数値）だけで、2 回目の採取物そのものは残さない。
判定に使うのは `metadata.json.noise_baseline` の数値で、`parity-diff` が現新の比較で読むのは 1 回目の `baseline/` だけである。
記録した後の `noise-pass2/` は、どの工程も読まない。

- 削除は測定の手順の一部である。`metadata.json.noise_baseline` に書いた直後に `noise-pass2/` を削除し、そこまで済ませて測定を完了とする。
- コミットしない。「テキスト成果物は Git」の区分（下の「保存先」）が対象にするのは 1 回目の `baseline/` で、2 回目には当てない。
  特性の JSON と aria はテキストなので、区分をそのまま当てると、`baseline/` と同じ量の重複がリポジトリに入る。
- 無いことは欠けではない。後の工程は `noise-pass2/` の実体を求めず（`parity-diff` の前提の確認を含む）、不足として `gaps.md` にも記録しない。
  中断で残っていた場合も入力ではないので、捨ててよい。
- 測り直しはいつでもできる。撮影条件は `capture_conditions` に記録してあるので、基準値を検算したくなったら、同じ条件で撮り直す（次の測定も同じ場所に書く）。
- `artifacts` の設定（`retention` / `storage`）の対象ではない。`retention` は版（撮り直した過去の版を残すか）の設定で、`storage` は残す大きなバイナリの保存先の設定である。
  2 回目は同じ版の一時的な作業物で、どちらの軸にも当たらない。
- 新側も同じ扱いにする（`parity-diff` が測る自己ノイズの 2 回目。原本は `parity-diff` の `references/capture-new.md`）。

## 採取物の健全性

採取物は工程の出力で、次の工程の入力でもある。
ところが、「その入力が実際に読まれたか」「いま正しいか」を数える段が無いと、2 種類のファイルが緑のまま残る。
採っただけのファイルと、元が採り直されたのに古いままの加工物である（中身の差は、どの方法にも出ない）。

採取物ごとに、読むスペックと「何から作ったか」を、`metadata.json` の `artifact_health` に宣言する（様式の原本は [`../assets/metadata-template.json`](../assets/metadata-template.json)）。
数え直しは [`../scripts/artifact-health-check.mjs`](../scripts/artifact-health-check.mjs) が行う（`parity-diff` も、収束の判定で同じスクリプトを呼ぶ）。

```bash
node <skill>/scripts/artifact-health-check.mjs --metadata .replace/parity/<slug>/metadata.json --stage suite
```

終了コードは、0 が条件を満たす（判定しない節を含む）、1 が未検証や不整合が残る、2 が使い方の誤りか型の誤りである。

- `declared: false`（視覚の採取物を持たない `api-resource` など）が免除するのは、採取物の節だけで、反復の実行の節は免除しない。
  書き込み系の API のスイートこそ、2 回続けての緑が要る。そのため、`artifact_health` を書いた成果物は、`suite.state_mutating` も必ず書く。
  免除で外れるのは「何を採ったか」の宣言で、「状態を変えるか」の宣言ではない。
- `--stage` は呼び出し元の工程で、デフォルトは `diff`（`parity-diff` の収束の判定。未測定の `blocking` を失敗にする）である。このスキルからは `suite` を渡す。
  `blocking` はこのスキルが書く出力そのものなので、完了を止めない（記録の不備は `suite` でも失敗にする）。

### 読み手を宣言する（`read_by`）

- 照合は文字列で足りる。`read_by` が指すスペックの中に、採取物の basename がファイル名として現れるかだけを見る。
  assertion に使っているかまで見なくても、「採っただけの採取物」は止まる。
- 一致は名前の境界で取る。前後がファイル名を作る文字（英数字・`.` `_` `-`）なら、別のファイルとして扱う。
  ただの部分文字列の一致にすると、`orders.xlsx` が `orders.xlsx.json` にも当たり、実際には読まれていない元の実体が、読み手ありとして通ってしまう。
- 参照しない採取物もありうる（補助の資料、決定論性を見るだけの記録、展開した結果の元になる実体）。
  その場合は、`read_by` を空にして `unread_reason` を書く。宣言できる欄を持たせ、宣言の無いものだけを失敗にする、という考え方である。
- `baseline_dir` にあるのに `entries` に現れないファイルは、未宣言として失敗にする。採っただけで一覧に足し忘れた採取物が、ここで見つかる。

### 加工は採る実行の中で最終形まで作る（`derived_from`）

ベースラインは、採る実行の中で最終形まで作る。
採取（実体の書き出し）と加工（展開して JSON にするなど）を、別のツールや別のタイミングに分けると、実体だけを採り直して加工の結果が古いままになる。
突き合わせる段が無ければ、それは緑にも赤にも出ない。実測では、書き出した xlsx は新しいレコードで、それを展開した JSON は前日の古いレコードだった。

- 分けるなら、加工物（`kind: derived`）に `derived_from`（元の実体のパスと `sha256`）を書かせる。チェックは元を読み直して数え直すので、元が採り直されていれば一致しなくなる。
- 書けないなら、`freshness_unverified_reason` を書いて、「古い可能性がある」ことを未検証として残す（警告なしに通さない）。

## 状態を変えるスイートは 2 回続けて緑にする

記録は、「どの版のスイートを回したか」に結びつける。
2 回緑を記録した後にスペックを書き換えたり、後始末を外したりしても、実行の結果と時刻だけを見るチェックは緑のまま通る。
今のスイートは一度も 2 回続けて回っていないのに、後始末の誤ったスイートが現行アプリを書き換え続けることになる。

`runs[]` に `suite_fingerprint` を記録する。これは、`suite.specs` / `locator_map` / `expectations` / `interactions` / `tools` の宣言したパスから計算した `sha256-nc:` である。
[`../scripts/artifact-health-check.mjs`](../scripts/artifact-health-check.mjs) は、続く 2 回で同じ値であることと、今のスイートから計算し直した値と一致することを確かめる。
スイートを変えたら、2 回続けて回し直す。

- TypeScript（`.ts` / `.mts` / `.cts`）のファイルは、コメントを除いた内容で数える。そのため、注記（登録簿の分類名など）を書き換えただけでは、回し直しにならない。
  - 文字列（`test.skip` の理由を含む）、テンプレート、正規表現の中身は除かない。動きに影響することがあるためである。
  - ツールへの指示のコメント（`// @ts-expect-error`・`///`・`/*! */`・`eslint-` などで始まるもの）も、動きを変えることがあるので除かない。
- JavaScript（`.js` / `.mjs` / `.cjs`）と `.jsx` / `.tsx` は、そのままのバイト列で数える。JSX のテキストの `//` をコメントと区別できないためである（JavaScript はトランスパイルで、拡張子に関係なく JSX を書ける）。
- TypeScript でも、字句だけでは読み方が決まらないファイルは、そのままのバイト列で数える。たとえば、`)` の後の `/` が正規表現にも読めて、同じ行に `//` `/*` がある形である。
- 古い方式の `sha256:` で記録した `runs[]` は、コメントも含めたそのままのバイト列で照合する（記録し直すと `sha256-nc:` になる）。

### スペック単位で記録する（`repeat_run.specs`）

2 回目が意味を持つのは、現行の状態を変えるスペックだけである。
スイート全体の 1 つの指紋に記録を結びつけると、状態を変えないスペックを 1 行変えただけで、すべてのスペックを 2 回実行し直すことになる。
実測では、2 回で約 35 分のうち、2 回目が要るのは、状態を変えるスペックの約 1.5 分だけだった。
`repeat_run.specs` を書いた成果物は、チェックがスペック単位で判定する（書いていない成果物は、上のとおりスイート全体の指紋で判定する）。

- `suite.specs` の下のスペックを、すべて分類する（`path` / `state_mutating` / `reason`。`reason` は必須）。
  スペックとして数えるのは、Playwright のデフォルトの `testMatch`（`*.spec.*` / `*.test.*`）に当たるファイルと、分類表に書いたファイルである。
  分類されていないスペックは失敗にする。足したスペックが、分類されないまま 1 回の緑で通ってしまわないようにするためである。
  `testMatch` を変えたプロジェクトでは、当たらないスペックも分類表に書く。
- 命名の規則に当たらない JS / TS 系のファイルは、スペックか共有のファイルかを必ず宣言する。
  スペックなら `repeat_run.specs` に、テストを定義しない共通の関数や fixture なら `repeat_run.shared_files`（`path` / `reason`。`reason` は必須）に書く。どちらにも無いファイルは失敗にする。
  本文の文字列（`test(` の呼び出し）から、スペックかどうかを推測しない。
  別名の import（`import { test as it }`）や再エクスポートで判定をすり抜け、状態を変えるスペックが 2 回続けての緑を求められないまま、共有のファイルに紛れ込む。
  JS / TS 系でないファイル（データ・画像など）には、宣言を求めない。
- `runs[]` には、`shared_fingerprint` と `spec_fingerprints`（その回に回したスペックのぶんだけ）を書く。値は手で計算せず、次の出力から転記する。

  ```bash
  node <skill>/scripts/artifact-health-check.mjs --metadata .replace/parity/<slug>/metadata.json --fingerprint
  ```

- 判定の仕方は次のとおりである。
  - 状態を変えるスペックは、そのスペックを含む直近の 2 回が緑で、別の日時に順に始まり、どちらもそのスペックの指紋と `shared_fingerprint` が今と一致すること。
  - 状態を変えないスペックは 1 回の緑で足りるが、その 1 回も記録に残す。直近の記録が緑で、スペックの指紋と `shared_fingerprint` が今と一致すること。
    結びつけないと、状態を変えないスペックを書き換えたり誤らせたりした後も、状態を変えるスペックの記録だけで通ってしまう。
- 変えたのが状態を変えるスペックなら、そのスペックだけを 2 回続けて回し、`runs[]` に足す。
  状態を変えないスペックだけを変えたなら、そのスペックを 1 回回して足せば足りる（状態を変えるスペックの 2 回は、やり直さない）。
- 共有部分（`shared_fingerprint`）が変わったら、状態を変えるスペックはすべて 2 回続けて回し直し、状態を変えないスペックはすべて 1 回回し直す。
  共有部分は、`locator_map` / `expectations` / `interactions` / `tools` と、`suite.specs` の下のスペック以外のもの（`shared_files` に宣言した共通の関数や fixture と、JS / TS 系でないデータなど）である。
  どのスペックが何を読むかはチェックが追えないので、共有のものはすべてのスペックに影響するとみなす。
- 現側専用のスペック（`current-only/` の採取・ノイズ基準値の測定・強度のチェック）と寸法の測定のスペックは、現行のデータを書き換えずに成果物を書き出すだけなら、`state_mutating: false` と理由を書く。
  書き出した成果物の決定論性は、ノイズ基準値の 2 回撮りと強度のチェックが別に確かめている。採る前に現行に保存する操作を含むなら、`true` にする。
- 新側専用のスペック（`new-only/`）の置き場所は、`current_excluded` に書く（`path` と `reason`。`current` プロジェクトが `testIgnore` で実行しないことの記録）。
  - その下のスペックには、分類も指紋も要らない。`parity-diff` が後から置いても、記録は失効しない。
  - `reason` の無い行は、外さずに数える。
  - 外せるのは、`suite.specs` の下のスペックだけである。`suite.specs` の外と `suite.specs` そのものは、外さずに数える。
    共有部分の宣言したパスも、下にあっても外さない。共有部分を外すと、変えても記録が失効しなくなる。
- 「状態を変えない」の宣言を、チェックは文字列で裏づけない。画面からの書き込み（ボタンを押すと保存される）は、スペックの文字列からは判定できない。
  書き込み系の API の呼び出しを探す近似は、見落としても何も言わないので、裏づけとして使うと誤った安心材料になる。
  `reason` は、レビューで読まれる判断の記録として書く。**迷ったら `true` にする**（2 回回す手間は、後始末の誤ったスペックを現行に回し続ける損失より小さい）。

現行アプリの行を変えるスイート（書き込み・更新・削除を含むもの）は、2 回続けて回し、両方とも緑であることを確かめる。
初期状態から始まる 1 回目には、後始末の有無が結果に現れない。後始末を消しても 1 回目は緑のままで、2 回目で初めて失敗する。

- 戻す操作はスイートの中に置く（反対の操作を同じテストで押すなど）。
  外のツール（手作業の片付け・別のコマンド）に頼ると、回した人が忘れた時点で次の実行が失敗する。しかも、その失敗は「現行が変わった」と同じ見え方になる。
- 判断と記録は、`metadata.json` の `suite.state_mutating` / `suite.repeat_run` に書く。状態を変えないなら、`state_mutating: false` と理由を書く。
  書かないと、「状態を変えるかを決めていない」と区別できない。2 回の `started_at` は別の日時にする（同じ値は、1 回の記録のコピーと区別できない）。
- 状態を変えるスイートでは、戻す操作をスイートの中に置いたことを `repeat_run.cleanup_in_suite: true` として記録し、2 回分の実行を `repeat_run.runs` に記録する。
  [`../scripts/artifact-health-check.mjs`](../scripts/artifact-health-check.mjs) は、`cleanup_in_suite` が `true` でないことと、実行の記録が 2 回分に満たないことを、それぞれ未検証として exit 1 にする。
  2 回分の数え方は、`repeat_run.specs` を書かない成果物では `runs` の件数、書いた成果物では状態を変えるスペックごとに、そのスペックを含む記録の件数である（上の「スペック単位で記録する」）。
  この 2 つは `--stage suite` でも外れない。外のツールで後始末を流して 2 回とも緑にしたなら、`cleanup_in_suite` を `true` と記録しないので通らない。
  チェックが読むのは記録した値だけで、戻す操作が本当にスイートの中にあるかまでは確かめない。`true` は、スペックの中に戻す操作があることを確かめてから記録する。
- 後始末できない書き込み（hermetic でないテスト）は、`gaps.md` に残す。
  2 回続けて緑にできないと分かった時点で、それは「後始末が機能していない」という測定の結果であり、運用で守る話ではない。

## 保存先

保存先の区分（テキストの成果物は Git、大きなバイナリは `artifacts` の設定。デフォルトは `local`）、選択肢の意味、上書きの規則は、
`replace-strategy` の `references/project-config.md`「成果物の保存先」で定義する。ここでは定義し直さず、このスキルに固有の運用だけを決める。

- 撮影の前に、書き込めるかを確かめ、書き込めなければ早めに失敗させる（すべて撮ってから保存できないと分かるのを避ける）。容量のしきい値を超えたら警告する。
- 実際に選ばれた保存先を、`metadata.json` に記録する（スクリーンショットは足場で、切り替えた後に残っている必要はない）。
- 画素の差分ツールは、プロジェクトで選んで `metadata.json` に記録する（例: pixelmatch / odiff）。
- ファイル出力の解析ツール（xlsx / PDF）も同じ形にする。プロジェクトが選び、`metadata.json` の `differ.file_extract` に記録する
  （選定と候補の判断材料の原本は、`replace-strategy` の `references/file-io.md`）。
  捕捉したバイト列と抽出した結果は `baseline/` の下に置き、保存は上の区分に従う（抽出した結果はテキストなので Git に、元のバイナリは `artifacts` の設定に従う）。

## golden-dataset との連携

`golden-dataset`（フェーズ A）が先に完了していること。
データセットを新しくすると、それより前に取った視覚ベースラインと特性化の結果は、基になるデータが変わった時点で無効になる。

- 取ったときのデータセットのバージョンを、`metadata.json` に記録する。
- 記録されたバージョンが今のデータセットより古ければ、古くなったものとして検出し、もう一度取るよう促す。
- データが足りない場合（空のリストしか確かめられない場合や、ページネーションが 1 ページで終わる場合など）は、`gaps.md` に「データ不足」として記録し、`golden-dataset` に戻す（確認済みにしない）。
  戻るとバージョンが上がるので、影響を受けるベースラインをもう一度取る。

## ライフサイクル

- ワークツリーには最新のものだけを置く。同じ機能の調査をくり返しても、イテレーションを並べない。
  履歴は Git が持ち、「いつの時点の現行か」は `metadata.json` の対象のコミットで追える（古い調査結果は、ただ劣るだけである）。
- モデルとエフォートは必ず記録する。同じモデルでもエフォートで結果が変わるので、これが無いと、調査結果を後から比べられない。
