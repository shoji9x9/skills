# 視覚ベースラインとノイズ基準値

**視覚ベースラインは本スキルが現行アプリを駆動するついでに採取する。** 現行アプリを 1 回巡れば、実行可能なパリティスイートと `parity-diff` 用のベースラインが同時に得られる。**現行アプリを駆動するのは本スキルだけ**なので、ノイズ基準値の測定もここで行う。

## 3 点セット

スクリーンショット単独では不足する。3 点セット＋ネットワークログを、**ページ・状態・ビューポートごと**に採る。
ネットワークログは 3 点セットの補助（API・データ由来の差の調査材料）として `baseline/` に含める。認証情報・トークンをマスキングしたうえで（[`auth.md`](auth.md)）、
サイズが大きくなりうるためスクリーンショットと同じく保存は `artifacts` 設定に従う。

| 要素 | 中身 | 用途 |
|---|---|---|
| スクリーンショット | 画面の画素 | 名前の付かない要素の見た目差を `parity-diff` の画素経路＋トリアージが扱う |
| 論理名付き要素の特性 | 固定プロパティ集合（padding / margin / font 系 / color / background-color / border-radius ＋ `cursor` / `user-select` / `pointer-events`）＋擬似要素（`::before` / `::after`）＋`getBoundingClientRect()` の**相対幾何**（絶対座標は比較に使わない）＋1 段下の子の inline style（`child_inline_styles`。診断材料であり照合には使わない）。[`coverage.md`](coverage.md) で遷移させた各状態で採る | DOM 構造が同じで見た目だけ違う事象を、名前付き要素については決定論的に捉える |
| 参考 aria スナップショット | 採取した aria | **参考資料であって assertion ではない**（assertion は手書き。[`coverage.md`](coverage.md)） |

- **特性照合の対象は論理名付き要素に絞る。** 名前の付かない要素の見た目差はスクリーンショット（画素経路）が担う
- **論理名は「画面に描かれている要素」に付ける。** `getByRole` が返す要素が描かれているとは限らない——**市販部品は aria のための木を別に作る**ことがあり、
  そちらは画面の外（`y = -32000` 等）に置かれる。描かれていない写しから採ると**固定プロパティは全一致のまま緑になり、画素だけが差を出す**（実測: 列見出し 9 件を写しから採っていた）。
  採取ツールは矩形を文書座標へ直して**文書の外に丸ごと出ている要素で採取を失敗させる**ので、この失敗はロケータマッピングを直してから採り直す
  （**要素の欠落へ変換しない**。強度ゲートでの扱いは [`strength-gate.md`](strength-gate.md)）
- **この判定は「面積 0 の写し」を捕まえない。** 面積 0 の矩形は `display: none` 等を正当に採るため判定から外してあるので、
  **`width: 0; height: 0` で置かれた写しは素通りする**（判定が捕まえるのは `y = -32000` のように**文書の外へ動かした**写しだけ）。
  論理名が写しを指している疑いが残るなら、採取物の `rect` が面積 0 でないことも併せて確かめる
- **子に inline style が乗っている差は、名前を付けた要素の計算値には出ない。** 採取ツールは 1 段下の子の inline style だけを `child_inline_styles` に記録する
  （子の計算値は採らない）。**照合には使わない診断材料**で、読むのは「計算値が全一致なのに画素だけ差が出た」ときに**装飾がどこに乗っているかを先に確かめる**ため
  （実測: `<a><span style="font-weight: bold;">` の形で 34 プロパティが全一致し、画素差 62 だけが出た。読む手順の正本は `parity-diff` の `references/font-diff.md`）
- **画素経路へ委ねられるのは静止画に写るものだけ。** `cursor` / `user-select` / `pointer-events` は操作したときの手応えを決めるが撮影には写らないため、
  固定プロパティ集合から外すと**特性照合でも画素比較でも差が出ない**（どちらの経路にも現れない見た目になる）。
  **`parity-component` は要素の矩形だけを撮る**ので「写らないもの」がさらに増える——矩形の外に描かれる `box-shadow`、下地に依存して弁別できない `opacity`、
  切り出しが要素についてくるため矩形の中に出ない `position` / `top` / `right` / `bottom` / `left`、採取時の文字列が短ければ差にならない
  `white-space` / `overflow-x` / `overflow-y` / `text-overflow` / `word-break` も、同じ理由で固定集合に入れてある（Issue #434）。プロパティ集合の正本は
  [`../scripts/trait-capture.mjs`](../scripts/trait-capture.mjs) の `FIXED_PROPERTIES` で、増減させたら `VERSION` を上げる
- **`url()` を値に持つプロパティは、参照先の資産の中身までは照合していない。** 採取ツールは相対 URL の絶対化によるホスト違いを消すため
  同一オリジンの `url()` をオリジン非依存の印へ畳む（[`../scripts/trait-capture.mjs`](../scripts/trait-capture.mjs) の `foldOrigin`）。
  このため**現新が同じパスで別バイトの資産を配信していると、その見た目差は特性照合にも画素にも現れない**（カスタムカーソルの画像が該当する）。
  対象要素があれば `gaps.md` の「特性化できなかった箇所と理由」へ種別「採取値の射程外」として残し、確認済みにしない。
  強度ゲートで注入しても特性照合が赤にならないので、`strength.md` の「未検証の故障種別」にも同じ理由で残す
- **採取スキーマ（`FIXED_PROPERTIES` と採取形状。ツールの `VERSION` が上がる変更）を変えたら現側・新側の両方を採り直す。** `parity-diff` の前提確認はツールの `VERSION` と `metadata.json` の記録値の一致を要求するため、
  片側だけ採り直した成果物は比較に進めない（止まるのが正しい振る舞い）
- 採取には同梱 [`../scripts/trait-capture.mjs`](../scripts/trait-capture.mjs) をプロジェクト側 `<parity_suite_dir>/parity/lib/tools/vendor/`（既定。コピー専用のサブディレクトリ。配置指針は [`locator-mapping.md`](locator-mapping.md)）へコピーして使う。
  何を採ったか（対象要素・プロパティ集合・状態）を `metadata.json` に残し、`parity-diff` が同一条件で照合できるようにする

## 撮影条件の統制

**同一環境・同一ビューポート・アニメーション無効（`animations: 'disabled'`）・動的領域のマスク。** 条件を `metadata.json` に残し、`parity-diff` が新側を同一条件で撮れるようにする。
**撮影範囲（全画面かビューポート内か）も `capture_conditions.full_page` に残す**——記録しないと新側が決め打ちで撮り、画像サイズの違いが全面差分として出る。
**スクロールバーが場所を取ったかも `capture_conditions.scrollbars` に残す**——片側だけ場所を取ると見える幅と高さが厚みの分ずれる。隠れた撮影で拾えない差は下の「スクロールバーが場所を取る窓のはみ出し」が持つ。

マスクは用途を混ぜない。`capture_conditions.masks` は認証情報・トークン・個人情報・揮発項目を成果物へ残さないための**恒久マスク**とし、方針は [`auth.md`](auth.md) に従う。
同じページに乗る別機能の未実装領域は `capture_conditions.cofeature_masks` にページ・所有 slug と、現側で測った page × state × viewport ごとのルート論理名・`bbox` を記録する。対象は `.replace/features.md` のページ一覧から導出し、対象機能自身は含めない。

`cofeature_masks` は候補レジストリであり、この時点で正本の現側ベースラインへ焼き込まない。`parity-diff` が同じ target の `suite.new_green` を読んで実行ごとの有効集合を導出し、正本を変更せず現側・新側の作業コピーへ同じ領域マスクを適用する。
`bbox` は現側ベースラインと同時に実測する target 非依存の座標であり、新側に未実装機能の DOM が無くても両画像へ同じ矩形を適用できる。各撮影組に対応する矩形が無い、現側論理名が解決できない、領域が別機能まで覆う、またはページ一覧の共同居住 slug に候補が無い場合は、マスクで差分を隠さず `gaps.md` に不足を記録して停止する。
依存先が green になった次の実行では候補を自動的に外し、正本から全面比較へ戻せる。

### 撮影状態の決め方（1）被覆表から導く

**`capture_conditions.states` を「見た目が変わる状態を思いついた分」だけで決めない。** 挙げなかった状態は 3 点セット（スクリーンショット・特性・aria スナップショット）のどれも採られず、特性照合は名前を付けた要素しか見ない——
**3 経路のどれにも出ないまま「差分器が緑」になる**。**差分器は撮った 2 枚しか比べない**ので、**集合が足りないぶんは「差 0 件」と同じ見え方**になり、素通りと見分けが付かない。

**足りないことは工程の外でしか見つからない。** 利用者が画面を見るか、実装した側が気づくかのどちらかで、
**見つかった時点でベースラインを採り直す**ことになる（**現行側も撮り直し**なので反復が 1 つ増える）。
だから**撮る前に、思い付きではなく測った操作から集合を出す**。

- **必要集合は部品被覆表（`component-coverage.json`）から機械的に導く。** 被覆表には**画面に載っている部品とその操作**が
  `value: present` で並んでいるので、**操作 → 見た目が変わる状態**の写像を当てれば集合が出る。
  写像の語彙は 5 種——**器を開く（`opens-container`）・指を乗せる（`hover`）・焦点を当てる（`focus`）・押している最中（`active`）・不活性（`disabled`）**
- **種別は項目ごとに宣言する**（`items[].visual_states`。見た目が変わらないなら空配列と `no_visual_state_reason`）。
  被覆プロファイルを宣言した部品では**プロファイルの `candidate_rules[].visual_states` が正本**で、
  `coverage-expand.mjs --write` が項目へ書き戻すので手で書かない（[`coverage-profiles.md`](coverage-profiles.md)）
- **`--metadata` は対象機能のものを渡す。** `slug` が被覆表と違う `metadata.json` は exit 2 で落ちる——
  別機能の撮影条件でも状態名が汎用（`hover` 等）なら突き合わせが通ってしまい、
  `parity-diff` はこの `conformance` を信頼して比較をやり直さないため
- **導出は `node <skill>/scripts/coverage-expand.mjs --coverage <被覆表> --write` が行う。**
  **この時点では `metadata.json` がまだ無いので `--metadata` は渡さない**——渡すと読めずに exit 2 で止まり、行も書かれない
  （撮影条件との照合は `metadata.json` を書いた後の手順 8）。
  `value: present` のセルと項目の種別から **部品 × インスタンス × 要求元の操作 × 種別**の行を `visual_state_coverage.rows` へ起こし、
  **撮るなら `captured` に（手順 6 で `capture_conditions.states` へ書く）状態名、撮れないなら `reason`** を人／エージェントが埋める。
  **どちらも空の行は「撮影状態が未決」として報告される**——これが**足りない状態の一覧**にあたる
- **状態名も撮影単位の中で一意にする。** 撮影は **ページ × 状態名 × ビューポート**の単位なので、
  行のキーを要求元まで割っても**同じ状態名を指せば同じ 1 枚**になり、1 回の撮影で複数の操作が満たされてしまう
  （キーの粒度と同じ故障が値の側に残る）。別々の操作が**本当に同じ器を開く**場合だけ、
  共有する**全行**の `shared_capture_reason` に実 UI で確かめた根拠を書けば通る（片方だけでは通らない）。
  ページが違うインスタンス間では別の 1 枚になるので使い回してよい。
  **撮影状態を要求する行を持つインスタンスには `page` が要る**——撮影単位を決めるキーなので、
  欠けていると使い回しを判定できない（狭いスコープへ倒さず落とす）。
  **非空なだけでは足りず、`capture_conditions.pages[].name` に実在する名前でなければ落ちる**——
  採取は `pages` を外側のループにして回るので、宣言に無い名前（誤記・旧称）を書いた行は
  どのページでも撮られず、誤記は使い回しの判定単位も割る
- **行は要求元の候補ごとに分かれる（種別でもルール id でも束ねない）。** 列フィルタの吹き出しと右クリックメニューはどちらも `opens-container` を要求するが、
  **束ねると片方の状態名を書くだけで未決 0 になり、撮られなかった器の差は「差 0 件」と同じ見え方に戻る**。
  **ルール id でまとめるのも同じ誤り**——ルールは複数の軸の直積へ展開されるので、まとめると
  縮約してはいけない軸まで畳む（`datagrid` の `column-sort` は `sort-direction` へ展開されるが、その軸は `reducible_axes` に無く
  「代表 1 件では差分が見えなくなる」と明示されている）
- **行を減らすのは同値クラス経由だけ。** `equivalence_classes` に属する候補は代表の行へ寄り、
  行の撮影単位も代表のインスタンスで決まる。縮約してよい軸・所属の全体性・根拠・代表の妥当性は
  同じ実行の照合が検査するので、**宣言していない縮約も、縮約してはいけない軸での宣言も通らない**
  （[`coverage-profiles.md`](coverage-profiles.md)「視覚採取の同値クラス」）。
  クラスを宣言しなければ候補の数だけ行が立つ——**減らしたいなら根拠を書く**、が契約
- **撮れない状態には理由を書く**（押すと外部連携が起動する、不活性になる条件が現行に無い、など）。
  同じ文言を `gaps.md`「特性化できなかった箇所と理由」へ種別「撮影状態の対象外」として残す。
  **欄が無いと「導いたが撮らないと決めた」と「導けていない」が同じ見え方になる**
- **`--metadata` を渡した実行だけが `capture_conditions.states` との差を取れる。** 渡さない実行は
  `conformance.visual_states.checked: false` のままで、`parity-diff` はそれを収束の根拠にしない
  （照合していない記録を照合済みに倒さない）。**その照合は `metadata.json` を書いた手順 8 で通す**。
  記録には被覆表と撮影条件の指紋が入るので、**通した後に表・撮影条件を書き換えたら `--write` から通し直す**
  （書き換えたまま古い要約を残すと `parity-diff` が落とす）。
  **スキルを更新して導出の意味論が変わったときも通し直す**——`parity-diff` は記録に残った生成側の版が
  下限以上かを見るので、古い規則で作られた要約は指紋が合っていても収束させない。
  `kind: opens-container` は `states` に在るだけでは足りず、次節の `popup_inventory` にも行が要る
- **導出は下限であって上限ではない。** 操作から導けない状態（`selected` / `error` / 初期表示のバリアント）は
  従来どおり手で `states` へ足す。被覆表は**操作の有無を数える表**であり、開いた中身の見た目を突き合わせたかは見ていないので、
  導出を「見た目の担保」と読み替えない——**導出が出すのは「撮るべき状態の集合」までで、
  撮った結果が現行と合っているかは画素比較と特性照合（`parity-diff`）が出す**（[`coverage.md`](coverage.md)「被覆表は見た目を見ていない」）

**工程の順序**——**この導出は手順 5（authoring）の終わりに、手順 6 の採取より前に置く。**
**状態を後から足すと現行側も採り直しになる**（ベースライン 3 点セットに加え、
その状態のノイズ基準値も 2 回撮りからやり直す）。**採り直しは新側だけでは済まない**ので、
撮る前に集合を確定させるほうが反復は短い。**測った操作からしか導けない**ので、
被覆表のセルが埋まる前には回せない——この 2 つで位置が決まる。

### 撮影状態の決め方（2）器の棚卸し

**導いた `opens-container` の行は「器が要る」までしか言わない。** どの器が何段目にあり、
どの操作で開き、そのうちどれを撮るかは、器を再帰的に数えないと出ない。部品被覆表は操作の有無を数える表なので代替にならない。

- **操作で開く器（吹き出し・ダイアログ・メニュー・引き出し・ツールチップ等）を再帰的に数える。** 1 段目を開いたら、その中でさらに操作して開く器（吹き出しの中のコンボボックスの一覧、下位メニュー）と、
  一覧の項目に指を乗せた状態まで降りる。器を開く操作が見つからなくなった段で止める
- **数えた器を撮る／撮らないの両方で `capture_conditions.popup_inventory` に 1 行ずつ残す**（形式はテンプレート `assets/metadata-template.json`）。
  撮るなら `captured` に `states` の状態名と `reason: null`、撮らないなら `captured: null` と `reason` を書き（両方を埋めた行は撮る・撮らないが同時に成立するので不整合）、同じ理由を `gaps.md`「特性化できなかった箇所と理由」へ種別「撮影状態の対象外」として残す。
  **欄が無いと「数えたが撮らないと決めた」と「思いつかなかった」が同じ見え方になる**
- `opened_by` には開く操作を**操作アダプタの呼び出しの配列**で書く。要素は `<関数名>(<開く対象の論理名>)`（引数を取らない関数は `<関数名>()`。状態名で代用しない）で、
  2 段目以降は親の器の `name` を `parent` に書く。
  **1 つの器を複数の操作で開けるなら、その全てを要素に並べる**（クリックのアダプタとキーボードのアダプタ等）。
  **開き方を足すために行を分けない**——棚卸しの単位は器 1 つにつき 1 行であり、行を分けると同じ器が 2 回数えられ、`captured` / `reason` も器ごとに 1 つに決まらなくなる。
  **関数名だけにしない**——引数で開く対象を変える関数（`openCombo(page, name)` 等）は、1 行で全ての呼び出しを満たしたことになり、他の器の撮り漏れを突き合わせで拾えなくなる。
  **書くのは開く対象を決める引数だけ**で、それ以外の引数は**全て落とす**——`page` のように呼び出しごとに変わらない引数も、
  `ArrowDown` のような操作の詳細も落とす（`openCombo(page, 演算子)` は `openCombo(演算子)`、`pressKey(page, 演算子, ArrowDown)` は `pressKey(演算子)`）。
  **基準は 1 つだけにする**——照合の単位が「関数名 × 開く対象の論理名」である以上、それ以外の引数は識別に使われないので、
  残す／落とすの基準を「不変かどうか」で二重に持つと `pressKey(演算子, ArrowDown)` で答えが割れる。
  同じ関数で開き方だけが違う操作は、**引数ではなく関数名で分ける**（キーボード用のアダプタを別の名前で持つ。引数で分けると
  同じ器が 2 つの呼び出しに見えるか、同じ要素が 2 つ並ぶ不整合になる）。
  列挙側にも同じ正規化を当て、表記を混ぜない（混ぜると同じ呼び出しが 2 つの文字列になり、突き合わせが「現れない呼び出し」を作る）
- **`name` は機能の棚卸し全体で一意にする。** `parent` は親の器を `name` で指すので、`name` が一意でないと `parent` がどの行を指すか決まらない。
  **兄弟の範囲（同じ `parent` の中）だけで一意にしても足りない**——祖父が違えば同じ `name` の器を 2 行書けてしまい、
  その子は `parent` に同じ文字列を書くことになる。すると 3 段目以降で、別文脈の正当な 2 行が重複と読まれるか、1 行が両方の文脈を満たしたことになり、
  **`parent` を持たせた意味（撮り漏れを包含判定で潰さない）がその深さで失われる**。名前が衝突するなら文脈を含めて改名する（`列フィルタの吹き出し` / `一括編集の吹き出し`）。
- **呼び出しは文脈（どの器の中から呼ぶか）と組にして識別する。** 照合の単位は **`parent` × `opened_by` の要素**——同じ `openCombo(演算子)` でも、親の器が違えば別の呼び出しである。
  **書き終えたら操作アダプタ（`suite.interactions`）とスイートから器を開く呼び出しを「どの器の中から呼ぶか（1 段目は `null`）× 関数名 × 開く対象の論理名」の単位で列挙し、
  全てが同じ `parent` を持つ行の `opened_by` に現れることを突き合わせる**——追加した操作が撮影状態に反映されない抜けはここで拾う。
  次のいずれかは、撮り漏れが集合の包含判定で潰れるため不整合として止める
  - `opened_by` が空配列（器は必ず何かで開く。開き方を書けないなら数えられていない）
  - 同じ行の `opened_by` に同じ要素が 2 つ以上ある
  - 同じ `parent` × 同じ呼び出しが 2 行以上に現れる（その呼び出しでどちらの器が開くか決まらない。引数の論理名を器ごとに分けて書く）
  - 同じ `name` の行が 2 つ以上ある（1 つの器が 2 回数えられている。開き方が複数あるなら 1 行の `opened_by` に並べる）
- **旧形式の単一の文字列は 1 要素の配列と同義として読む**（`popup_inventory` 導入時の形）。読み替えるのは形だけで、上の突き合わせと不整合の判定は同じに当てる。新しく書くときは配列で書く
- **引数表記の移行も要る。** この節より前に書かれた `opened_by` には `openCombo(page, 演算子)` のように落とすべき引数が残っている
  （当時は違反ではなかった）。**突き合わせの前に記録側を新しい表記へ書き換える**——比較のときだけ正規化して記録を旧表記のまま残すと、
  次の実行でまた解釈が要る。書き換えずに突き合わせると列挙側だけが新しい正規化になり、**同じ呼び出しが「現れない呼び出し」として偽の停止を作る**
  （この移行は不整合ではないので、書き換えだけ行って止めない）
- 器が 1 つも無い機能は `popup_inventory: []` と書く（キーの欠落は「数えていない」と区別できない）
- **`popup_inventory` を持たない既存の `metadata.json` は、この節と次節の導入より前の採取として扱い、ベースラインとノイズ基準値を採り直す**（待たずに撮った 2 標本の「ノイズ 0」が残り続けるため）

### 撮る範囲の決め方（穴は採取の段で数える）

**範囲の狭さは「差分 0 件」と同じ見え方になる。** 差分器は撮った 2 枚しか比べないので、撮らなかった領域は
**永久に差が出ない**。足りないことは工程の外——利用者が画面を見るか、実装した側が気づくか——でしか見つからず、
**見つかった時点で現側から撮り直す**ことになる（反復が 1 つ増える。狭い範囲で採る → 実装 → 範囲外の差分が出る →
範囲を広げて採り直す → 直す、というループの原価がこれ）。**だから撮る段で穴を数える。**

**既定は全画面（`capture_conditions.full_page: true`）。** ビューポート内で撮るのは、全画面で撮れない理由があるときだけにする
（理由は下記の宣言に残す）。「1 画面に収まっているはず」を根拠にしない——収まっているなら穴は 0 件として数えられるので、宣言は要らない。

**撮影組（ページ × 状態 × ビューポート）ごとに範囲を実測して `capture_conditions.capture_scope` に残す**（様式の正本は
[`../assets/metadata-template.json`](../assets/metadata-template.json)）。突き合わせ相手は `noise_baseline`——
**ノイズ基準値を採った組に範囲の実測が無ければ「測っていない」**として落とす（穴が無い組と同じ見え方にしない）。

| 穴の種別（id） | 何が撮れていないか |
|---|---|
| `below-fold` / `beyond-right` | 文書（`scrollWidth` / `scrollHeight`）が撮影領域より大きい。`full_page: false` で下・右が切れている |
| `scroll:<器の名前>` | 内部スクロール器の中身が可視部より大きい（仮想スクロール・固定高のグリッド）。**画素にも特性にも出ない** |
| `offscreen:<論理名>` | 論理名付き要素が撮影領域の外にある。特性は採れても画素には写らない |

実測は撮る直前に 1 回で採る（`full_page: true` なら撮影領域は文書と同じ寸法になるので、穴は 0 件として数えられる）。

```ts
// 出典: https://playwright.dev/docs/api/class-page#page-screenshot（fullPage は文書全体を撮る）、
//       https://developer.mozilla.org/docs/Web/API/Element/scrollHeight（scrollHeight と clientHeight の差が隠れている分）
const scope = await page.evaluate(({ fullPage, namedSelectors }) => {
  const root = document.documentElement;
  const doc = { width: root.scrollWidth, height: root.scrollHeight };
  const captured = fullPage ? doc : { width: window.innerWidth, height: window.innerHeight };
  const scroll_containers = [...document.querySelectorAll("*")]
    .filter((el) => {
      const style = getComputedStyle(el);
      const scrollable = /(auto|scroll)/.test(`${style.overflowX} ${style.overflowY}`);
      return scrollable && (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth);
    })
    .map((el) => ({
      // name は書き手が付ける（論理名で引ける器はその論理名。hint は名前を決めるための手がかりで、記録には残さない）
      hint: `${el.tagName.toLowerCase()}.${el.className}`,
      client: { width: el.clientWidth, height: el.clientHeight },
      scroll: { width: el.scrollWidth, height: el.scrollHeight },
    }));
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

- **器の名前は論理名で付ける**（引けないときだけ構造で特定できる名前にする）。**この名前が宣言の鍵**なので、実行ごとに変わる名前にしない
- **器が 1 つも無い組は `scroll_containers: []` と書く**（キーの欠落は「数えていない」と区別できない。`named_elements_outside` も同じ）
- **寸法は実測値（正の数）で埋める。** テンプレートの `0` を残した組は「測っていない」として落ちる——
  0×0 のまま比較すると穴が 1 つも出ず、**測っていない組が穴の無い組と同じ見え方**になる
- **`metadata.json` の `mode` も要る**（`feature` / `api-resource` / `batch`）。欠落・語彙外は `feature` に倒さず落ちる
- **ページ名・状態名・ビューポート label・器の名前・論理名に `|` と `#` を使わない。** 撮影組の鍵（`<page>|<state>|<viewport>`）と
  穴の id（`<鍵>#<種別>:<名前>`）の区切りなので、含めると別々の組・別々の穴が同じ文字列に潰れ、
  **1 つの実測や 1 つの宣言が 2 つを満たしたことになる**（検査は名前の側で弾く。id は利用者が宣言へ書き写すので符号化しない）

- **撮るはずの組は `capture_conditions` の 3 軸（`pages` × `states` × `viewports`）の直積で決まる。**
  検査はこの直積を期待値にし、`noise_baseline` にも `capture_scope` にも無い組を穴
  （`<page>|<state>|<viewport>#not-captured`）として数える。**採った組の一覧を期待値にしない**——
  組ごと落とした範囲は一覧からも消えるので、穴が 1 つも出ないまま通る（範囲の狭さが差分 0 件と同じ見え方になる）。
  その組を撮らないなら、他の穴と同じく `#not-captured` の id で理由付きの宣言を残す。
  3 軸のいずれかが空・区切り文字入り・重複なら期待値を作れないので落ちる

**穴は消すか、対象外として宣言する。** 消すのは範囲を広げること（`full_page: true` にする、器の中身を段階的に撮る状態を足す、
論理名の要素が入る位置で撮る）。広げられないなら `capture_conditions.capture_scope_exemptions` に
**穴の id・理由・`gaps.md` の該当箇所**を書き、同じ内容を `gaps.md`「特性化できなかった箇所と理由」へ種別「撮影範囲の対象外」として残す。
**対応する穴の無い宣言は落とす**——古い宣言が残ると、範囲を狭めても静かに通る。

```bash
node <skill>/scripts/capture-scope-check.mjs --metadata .replace/parity/<slug>/metadata.json
```

終了コードは 0 ＝ 条件を満たす、1 ＝ 穴・不整合が残る（採取へ戻す）、2 ＝ 使い方の誤り・型崩れ。
**`capture_scope` をキーごと持たない成果物も落ちる**——この節より前に採った成果物は範囲を測っていないので、
範囲の実測を足して（必要なら撮り直して）から先へ進む。

### 撮る対象が動かなくなるまで待つ

**「出た」は「位置が確定した」ではない。** 中身を後から組む器や、大きさが決まってから位置を詰め直す実装（`ResizeObserver` 等）では、出現直後に撮ると 1 画素の上下で 2 つの結果に転ぶ。
**転ぶ採取は差分量を回ごとに跳ねさせ、実装を変えていない差を実装差として追わせる**（下記「ノイズ基準値」の 2 回撮りでは検出できない）。

- **操作アダプタの状態遷移（`applyState`）は、状態固有の assertion で状態が確定したあと、撮る対象の器の矩形が 2 回続けて同じ値になるまで待ってから返す。**
  器を開かない状態（default / hover 等）は、状態の変化を受ける要素の矩形で待つ。新側（`parity-diff` の採取）も同じ操作アダプタを通るので、待ちは両側に効く
- 固定時間の待機（`waitForTimeout`）は禁止（[`locator-mapping.md`](locator-mapping.md)）なので、`expect.poll` で矩形を読み比べる。落ち着かなければ例外にして撮らない
- **自動で消える器（トースト等）は、撮り終えた後にもう一度出ていることを assertion で確かめる。** 待っている間に消えると、消えた後の画面を「その状態」として撮ってしまい、
  **同じ操作で撮るたびに違う結論**になる。消えるまでの時間（[`coverage.md`](coverage.md)「操作の反応」の `dismissal.duration_ms_samples`）の内に撮り終えられなければ、その状態は撮らずに `gaps.md` へ「撮影状態の対象外」として残し、反応の被覆表の `capture` も `state: null` と理由へ切り替える

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

**3 経路（画素・特性照合・aria）は `capture_conditions.viewports` に宣言した点でしか比べない。** ビューポートが 1 つだと、
**その 1 点の実測 px を並べた新側の版組が 3 経路すべてで緑になる**。移行元が「割合 × 器の寸法 ＋ 定数」「窓の高さ − 定数」で決まっていれば、
別の窓で数十 px ずれるが、スイートも差分器も最後まで緑のまま人が触るまで気づけない。

**画素の比較点は増やさない。** 足すのは位置と寸法の式を読む工程だけで、`getBoundingClientRect()` の読み取りで済む。

- **いつ要るか**: feature モードで `capture_conditions.dimension_model` を**キーごと省略しない**。ビューポートが 1 つなら `status: measured` か `not_measured`（理由付き）のどちらか。
  ビューポートが 2 つ以上のときだけ `not_required`（理由付き）を選べる
- **`not_measured` は `gaps.md` に書いて済ませない。** `gaps.md` に書けば通る形は同じ穴を機能ごとに再生産するため、未測定は `parity-replace` への**引き渡し条件**として `dimension_model` に残す
  （`parity-replace` は完了判定で読み、写していない旨を `porting.md` に明示する。正本は `parity-replace` の `SKILL.md` 手順 8）
- **測る要素**: `traits.elements` の論理名の全て（各論理名が在るページで、default 状態）。自分で選ばない——`scripts/dimension-fit.mjs` が samples に無い論理名を落とす。
  **操作で現れる要素・操作で変わる組み方は式に入らない**——それは反応の被覆表の `layout` が持つ（[`coverage.md`](coverage.md)「操作で変わる頁の組み方（`layout`）」）
- **測る窓**: 撮影したビューポートを含む **4 窓以上**を、**幅と高さを独立に動かして**選ぶ（縦横比が一定の窓だけでは幅と高さのどちらに追従しているかを分けられず、スクリプトが落とす）。
  窓は撮影したビューポートと**同じブレークポイントの範囲内**に取る（ブレークポイントの導出は [`coverage.md`](coverage.md)「スクリーンサイズ」。またぐと式が変わるので当てはまらない）
- **当てはめ**: `値 = ratio.width × 窓の幅 ＋ ratio.height × 窓の高さ ＋ offset` を要素 × 軸（x / y / width / height）ごとに最小二乗で当てる。
  器（グリッド・パネル）が窓に対して線形なら、器に対して線形な要素も窓に対して線形になるので、器を選ぶ判断は要らない。
  残差が許容（既定 0.5px）内なら `fits`、超える・一部の窓で表示されないなら `unfit`（**式が読めない**）として記録する。`unfit` は失敗ではなく記録であり、消さない

採取は side 非依存の測定スペック `<parity_suite_dir>/parity/<slug>/dimension/` に置き、**`current` と `new` の両プロジェクトに含める**（`new-capture` は `testDir` が `new-only/` なので含まれない）。
出力先を project 名で分けるので、side 専用スペックの除外（[`locator-mapping.md`](locator-mapping.md)）が防ぐ「相手側の証跡の上書き」は起きない:

| project | 出力先 |
|---|---|
| `current` | `.replace/parity/<slug>/dimension-samples.json` |
| `new` | `.replace/parity/<slug>/new/<PARITY_NEW_TARGET>/dimension-samples.json`（`PARITY_NEW_TARGET` 未設定なら例外にして書かない） |

**書き出すのは `PARITY_DIMENSION_CAPTURE=1` を渡した実行だけ**で、それ以外はスキップする。強度ゲート（手順 7）は故障を注入した状態で同じ `current` を回し、
ノイズ測定の 2 回目や green の再確認も同じスイートを回すため、無条件に書くと**崩れた矩形で samples を上書きし、その値に式を当てはめる**ことになる。
採るのは本手順（`current`）と `parity-replace` の完了判定（`new`）の直前だけにし、採った直後に `fit` / `check` を通す（`--project` は複数の値を取るので、パスを後ろに置くとプロジェクト名として読まれて落ちる。パスを先に書く）:

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
  // 採取を宣言した実行だけ書く（強度ゲート・ノイズ測定・green 確認で samples を上書きしない）
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

採ったら、`traits.elements`・`capture_conditions.viewports`・`capture_conditions.pages` を書いた `metadata.json` に対して当てはめを通す（**コピーせずスキル配下から実行する**。手で転記しない）:

```bash
node <skill>/scripts/dimension-fit.mjs fit \
  --samples .replace/parity/<slug>/dimension-samples.json \
  --metadata .replace/parity/<slug>/metadata.json --write
```

- exit 0 で `capture_conditions.dimension_model` に `status: measured`・`measured_at`・`fits`・`unfit` が書かれる。exit 2（窓 4 未満・一直線上・撮影ビューポートを含まない・撮影ページや `traits.elements` の測り漏れ・全ての窓で表示されない要素・キーの欠落や重複・型崩れ）は採り直す
- `dimension-samples.json` はテキスト成果物として Git に入れる（`parity-replace` の照合は `metadata.json` の式を使い、samples は再当てはめの根拠）
- **要素・窓を変えて採り直したら、`fit` も通し直す**（`dimension_model.samples_fingerprint` はどの samples から当てた式かの記録。`parity-replace` の `check` は現側 `dimension-samples.json` とこの指紋を照合し、一致しなければ exit 2 で止まる）

### スクロールバーが場所を取る窓のはみ出し

**スクロールバーが隠れていると、頁の高さの決め方の違い（`height: 100%` と `100vh`）は 3 経路のどれにも写らない。**
Playwright はヘッドレスの Chromium を `--hide-scrollbars` 付きで起動する（出典: <https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/chromium/chromium.ts> の `headless` 分岐）。
隠れたスクロールバーは場所を取らないので、横スクロールバーが出る窓でも「見える高さ」が減らない。そのため `100vh` と `height: 100%` はどの窓でも同じ値になる。
上の「寸法の決まり方」を何窓で測っても、この差は 0 のまま。

スクロールバーが場所を取る窓では次の差が出る。移行元の `html`・`body` と器が `height: 100%` で、新側の器が `min-height: 100vh` の場合:

- 窓の幅が頁の最小幅より狭いと横スクロールバーが出て、見える高さ（`100%`）はその厚みだけ減る。`100vh` は減らない
- 中身が窓の高さに収まる頁でも、新側だけ横スクロールバーの厚みの分はみ出して縦スクロールバーが出る

**最小幅を持つ業務画面では、狭い窓で必ず踏む差**なので、feature モードでは次の 2 つを `metadata.json` の `capture_conditions` に残す（形式はテンプレート `assets/metadata-template.json`）。

- **`scrollbars`**: ベースラインを撮ったときにスクロールバーが場所を取ったか（`hidden` / `shown`）。Playwright のヘッドレス Chromium の既定は `hidden`。
  `parity-diff` の新側採取は同じ扱いで撮る（片側だけ場所を取ると、見える幅と高さが厚みの分ずれて全面差分になる）
- **`overflow`**: スクロールバーを表示させた窓（`scrollbars: shown`）での縦・横のはみ出し。**キーごと省略しない**——測れないなら `status: not_measured` と `reason` を書き、同じ理由を `gaps.md` に残す

測る窓は測定スペックが頁ごとに導く。撮影したビューポートに加えて、頁が最小幅を持つなら次の 2 窓を足す（**幅と高さを手で選ばない**）:

1. 最小幅より狭く、撮影したビューポートと同じ高さの窓（横スクロールバーが出る）
2. 1 と同じ幅で、中身が収まる高さの窓。**縦のはみ出しが頁の高さの決め方だけで決まる**ので、`100%` と `100vh` の差がここに出る

最小幅は、320px から撮影ビューポートの幅まで 40px 刻みの窓と、頁のスタイルシート（`@import` で読み込んだものを含む）から読んだ**メディアクエリの幅の境界の前後**の窓で、文書の `scrollWidth` を読んで決める。
横にはみ出した窓のうち最も広いものを 1 の幅にする（中間のブレークポイントでだけ最小幅が効くレスポンシブな頁を、1 窓や刻みだけの探索で見落とさないため）。
**読めないスタイルシート**（別オリジンで CORS の無いもの等）があれば、その境界は探索できていない。件数は `probe.unreadable_stylesheets` に残り、`gaps.md` に「採取環境依存の未検証」として書いて `probe.gaps_ref` に該当箇所を入れる。
JavaScript やコンテナクエリで最小幅を変える頁も拾えないので、同じく `gaps.md` に残す。
2 の高さは 1 の窓で読んだ文書の `scrollHeight`（`content_height` として記録する）より高くとり、検査はその窓があることを確かめる。
どの窓でも横にはみ出さない頁は `min_width: null`（最小幅を持たない）として、撮影したビューポートと 320px 幅の窓だけを測る。
各窓では縦・横のはみ出しの有無に加えて**はみ出し量**（`scrollHeight − clientHeight` 等）を残し、スペックは量で比べる——どの高さでも縦にはみ出す頁（`body { height: 100% }` と既定の margin）では、有無だけだと `100%` と `100vh` が両側とも「はみ出す」になり見分けられない。

測定スペックは `<parity_suite_dir>/parity/<slug>/overflow/overflow.spec.ts` に置き、**`current` と `new` の両プロジェクトに含める**。
同じスペックが 2 つの役を持つ——`PARITY_OVERFLOW_CAPTURE=1` を渡した `current` の実行では実測を `metadata.json` の `capture_conditions.overflow` へ書き、
それ以外の実行ではその記録を期待値として読み、現・新の両側に当てる（新側が現側と同じ窓で同じはみ出し方をすることを、スイートの green が保証する）。

- **ファイルを分けるのは、起動引数（`launchOptions`）がワーカー単位の設定だから。** `test.use({ launchOptions })` はファイルの最上位にしか書けず（`describe` の中では新しいワーカーが要るため使えない）、
  同じファイルの他のテストもスクロールバーを表示した状態になる。撮影・特性採取・寸法の採取は撮影時の扱い（`scrollbars`）のまま走らせる
  （出典: <https://github.com/microsoft/playwright/blob/main/packages/playwright/src/common/fixtures.ts> の「Cannot use({ … }) in a describe group, because it forces a new worker」）
- **プロジェクトの `launchOptions` を上書きする。** 設定に `launchOptions`（`args` 等）があるなら、下の `test.use` にその値を写したうえで `ignoreDefaultArgs` を足す（`test.use` はオブジェクトごと置き換える）
- **頁ごとに 1 テストにする。** `parity-replace` はページ単位のフェーズでスイートを回すので、頁で分けないと未実装の頁で最初のフェーズが完了できない

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
// 強度ゲート専用: 頁の高さの決め方を変える CSS を当てる（references/strength-gate.md の故障カタログ）。current 以外では使わない
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

採ったら `capture-scope-check.mjs` を通す（手順 8）。記録の形・最小幅と窓の矛盾・横にはみ出した窓で横スクロールバーが場所を取っていない記録（隠れたまま測った）を落とす。

- **採ったあとは、同じスペックを採取用の環境変数を外して `current` で回し、green になることを確かめる**（期待値と測り方が同じ実行系で一致することの確認）
- **頁・ビューポートを変えたら採り直す**（記録の頁は `capture_conditions.pages` と突き合わせる）

### 採取環境と利用者環境の乖離

**採取環境でだけ成立する一致は、差分器では捉えられない。** 現・新を同じ環境で撮る統制は、その環境に固有の解決（フォントのフォールバック先、システム UI 由来の既定値）を現・新の両側に等しく効かせるため、**環境が変われば壊れる差を差分ゼロとして通してしまう**。

- 典型例は**フォントスタックに総称ファミリー（`system-ui` / `sans-serif`）を含める**こと。CJK のフォールバック先は OS ごとに違うため、採取環境では現・新とも同じフォントに解決されて差分器はゼロを返し、**別 OS の利用者環境でだけ字幅が変わる**（実測で本文幅が 2 割以上ずれた事例がある）
- **撮影環境を記録するだけでは足りない**（記録した値を誰も読まないため）。`metadata.json.capture_conditions` に**採取環境（OS・ブラウザ・DPR）と想定利用者環境の一致**を `viewer_environment` として残し、次のいずれかを取る:
  1. **環境に依存しないフォントスタックにする**（総称ファミリーに解決を委ねず、CJK を含めて実体フォントを配信する）——採取環境と利用者環境の差そのものを消す
  2. **利用者環境でも採取する**（採取環境を増やす）
  3. どちらも取れないなら `gaps.md` に「採取環境依存の未検証」として残す（確認済みにしない）
- 総称ファミリー由来でなくても、**採取環境の既定値に解決される指定**（システムフォント・システム色・OS 既定のフォームコントロール外観）は同じ穴を持つ。フォントスタックだけを見て済ませない

## ノイズ基準値

時刻・乱数・ID・レンダリングの揺れは、同じアプリを 2 回撮るだけでも差分として現れる。**その差分量がノイズの基準**であり、`parity-diff` は「新側との差分がこれと同程度なら回帰ではない」と判定できる。

- 現行を**同一条件で 2 回撮り**、画素差分と特性照合（[`../scripts/trait-compare.mjs`](../scripts/trait-compare.mjs)）を 2 回分に対して回した差分量を、**ページ・状態・ビューポートごとに `metadata.json` へ記録する**（3 点セットと同じ粒度）
- **画素は 2 本とも記録する。** `pixel_diff`（記録済みツールのしきい値つき）だけでなく、`pixel_diff_strict` / `pixel_diff_strict_only`
  （しきい値なしの画素数と、そのうちツールがマークしなかった分）も記録する。`parity-diff` は現新差を**同じ軸の基準値**と対比するため、
  しきい値つきの値しか無いと strict の実測が必ず超過になり、通常の描画揺れまで要対応に化ける
- **strict の 2 本は同梱 [`../scripts/pixel-strict-count.mjs`](../scripts/pixel-strict-count.mjs) で数える**（スキルディレクトリ内から直接実行する。プロジェクトへコピーしない）:

  ```text
  node <スキルディレクトリ>/scripts/pixel-strict-count.mjs <baseline の PNG> <noise-pass2 の PNG> [--diff <記録済みツールの差分画像>]
  ```

  `--diff` を渡すと `strict_only_pixels`（しきい値の内側に隠れた分）も出る。渡さなければ `null`（0 と区別する）。
  `pngjs` に依存する（無ければ導入をユーザーに確認する。本スキルは勝手にインストールしない）。
  `parity-diff` の `scripts/pixel-crops.mjs` にも同じ計数があるが、**インストール先が別なので互いを import しない**（規則を変えたら両方直す）
- **2 回目の書き出し先は `.replace/parity/<slug>/noise-pass2/`**（1 回目＝`baseline/` と対称のレイアウト。同じ場所へ撮ると 1 回目を上書きして比較相手が消える）
- **2 標本の一致は採取が決定論的である証明ではない。** 2 値のどちらかに転ぶ採取は 1/2 の確率で「ノイズ 0」になる。
  上記「撮る対象が動かなくなるまで待つ」を 1 回目・2 回目の両方で満たしたうえで測る（標本を増やしても、待たずに撮る限り転ぶ採取は残る）。
  待ちが落ち着かず例外になった状態は基準値を記録せず、`capture_conditions.states` から外し、`gaps.md` に「撮影状態の対象外」として理由付きで残す（どの状態でも必須）。
  その状態を `captured` に持つ `popup_inventory` の行があれば、その行も `captured: null` と `reason` にする（器を開かない default / hover 等には該当行が無いので `gaps.md` だけでよい）。
  **同じ状態名を `captured` に持つ `visual_state_coverage.rows` の行も `captured: null` と `reason` へ切り替える**——
  切り替えないと `coverage-expand.mjs --metadata` が「`states` に無い状態名」として落とし、切り替えれば「撮れない状態」として理由が残る
  （`states` に残すと `parity-diff` の事前確認が `noise_baseline` の欠けで停止し、新側採取もその状態の `applyState` で例外になる）

### 2 回目の採取物は基準値を記録したら削除する

**残すのは基準値（数値）だけで、2 回目の採取物そのものは残さない。** 判定に使うのは `metadata.json.noise_baseline` の数値であり、
`parity-diff` が現新比較で読むのは 1 回目の `baseline/` だけ——**記録後の `noise-pass2/` はどの工程も読まない**。

- **削除は測定手順の一部**。`metadata.json.noise_baseline` へ書いた直後に `noise-pass2/` を削除し、そこまで済ませて測定完了とする
- **コミットしない。** 「テキスト成果物は Git」の区分（下記「保存先」）が対象にするのは 1 回目の `baseline/` であり、2 回目には適用しない
  （特性 JSON・aria はテキストなので、区分をそのまま当てると `baseline/` と同量の重複がリポジトリへ入る）
- **不在は欠落ではない。** 後続工程は `noise-pass2/` の実体を要求せず（`parity-diff` の前提確認を含む）、不足として `gaps.md` にも記録しない。
  中断で残っていた場合も入力ではないので破棄してよい
- **再測定はいつでもできる**——撮影条件は `capture_conditions` に記録済みなので、基準値を検算したくなったら同じ条件で撮り直す（次の測定は同じ場所へ書く）
- **`artifacts` 設定（`retention` / `storage`）の対象ではない。** `retention` は版（撮り直した過去の版を残すか）の話で、`storage` は残す大きなバイナリの保存先の話。
  2 回目は同一版の一時作業物であり、どちらの軸にも乗らない
- **新側も同じ扱い**（`parity-diff` が測る自己ノイズの 2 回目。正本は `parity-diff` の `references/capture-new.md`）

## 採取物の健全性

**採取物は工程の出力であり、次の工程の入力である。** ところが「その入力が実際に読まれたか」「いま正しいか」を数える段が無いと、
**採っただけのファイル**と**元が採り直されたのに古いままの加工物**が、どちらも緑のまま残る（中身の差がどの経路にも出ない）。

**採取物ごとに、読むスペックと「何から作ったか」を `metadata.json` の `artifact_health` に宣言する**（様式の正本は [`../assets/metadata-template.json`](../assets/metadata-template.json)）。
数え直しは [`../scripts/artifact-health-check.mjs`](../scripts/artifact-health-check.mjs) が行う（`parity-diff` が収束判定で同じスクリプトを呼ぶ）:

```bash
node <skill>/scripts/artifact-health-check.mjs --metadata .replace/parity/<slug>/metadata.json --stage suite
```

終了コードは 0 ＝ 条件を満たす（判定しない節を含む）、1 ＝ 未検証・不整合が残る、2 ＝ 使い方の誤り・型崩れ。
**`declared: false`（視覚採取物を持たない `api-resource` 等）が免除するのは採取物の節だけで、反復実行の節は免除しない**
——書き込み系 API のスイートこそ 2 回続けての緑が要る側なので、`artifact_health` を書いた成果物は `suite.state_mutating` も必ず書く
（免除で外れるのは「何を採ったか」の宣言であって「状態を変えるか」の宣言ではない）。
`--stage` は呼び出し元の工程で、**既定は `diff`**（`parity-diff` の収束判定。未測定の `blocking` を落とす）。本スキルからは `suite` を渡す
——`blocking` は本スキルが書く出力そのものなので完了を止めない（記録の不備は `suite` でも落ちる）。

### 読み手を宣言する（`read_by`）

- **照合は字面で足りる**——`read_by` が指すスペックの中に採取物の basename が**ファイル名として**現れるかだけを見る。
  **assertion に使っているかまでは見なくても、「採っただけの採取物」は止まる**
- **一致は名前の境界で取る**——前後がファイル名を構成する文字（英数・`.` `_` `-`）なら別のファイルとして扱う。
  素の部分文字列一致にすると `orders.xlsx` が `orders.xlsx.json` にも当たり、**実際には読まれていない元の実体が読み手ありで素通りする**
- **参照しない採取物は在りえる**（補助資料・決定論性を見るだけの記録・展開結果の元になる実体）。
  その場合は `read_by` を空にして `unread_reason` を書く——**宣言の口を持たせ、宣言の無いものだけを落とす**
- `baseline_dir` に在るのに `entries` に現れないファイルは**未宣言**として落ちる。採るだけ採って一覧に足し忘れた採取物がここで出る

### 加工は採る実行の中で最終形まで作る（`derived_from`）

**ベースラインは採る実行の中で最終形まで作る。** 採取（実体の書き出し）と加工（展開して JSON にする等）を別の道具・別のタイミングに分けると、
**実体だけ採り直して加工結果が旧いまま**になり、突き合わせる段が無ければ緑にも赤にも出ない（実測: 書き出した xlsx は新しいレコード、その展開結果の JSON は前日の旧いレコードだった）。

- 分けるなら、加工物（`kind: derived`）に `derived_from`（元の実体のパスと `sha256`）を書かせる。検査は**元を読み直して数え直す**ので、
  元が採り直されていれば一致しなくなる
- **書けないなら `freshness_unverified_reason` を書いて「古いかもしれない」を未検証として残す**（黙って通さない）

## 状態を変えるスイートは 2 回続けて緑にする

**記録は「どの版のスイートを回したか」に結びつける。** 2 回緑を記録した後にスペックを書き換えたり後始末を外したりしても、
実行結果と時刻だけを見る検査は緑のまま通る——**いまのスイートは 1 度も 2 回続けて回っていない**のに、
後始末の壊れたスイートが現行アプリを書き換え続ける。
`runs[]` に `suite_fingerprint`（`suite.specs` / `locator_map` / `expectations` / `interactions` / `tools` の宣言パスから計算した `sha256-nc:`）を記録し、
連続する 2 回で同じ値であること、かつ現在のスイートから再計算した値と一致することを
[`../scripts/artifact-health-check.mjs`](../scripts/artifact-health-check.mjs) が確かめる。
**スイートを変えたら 2 回続けて回し直す。**
TypeScript（`.ts` / `.mts` / `.cts`）のファイルは**コメントを除いた内容**で数えるので、注記（登録簿の分類名など）を書き換えただけでは取り直しにならない。
文字列（`test.skip` の理由を含む）・テンプレート・正規表現の中身は動きに効かないと言い切れないため除かない。
ツールへの指示コメント（`// @ts-expect-error`・`///`・`/*! */`・`eslint-` などで始まるもの）も動きを変えうるので除かない。
JavaScript（`.js` / `.mjs` / `.cjs`。トランスパイルで拡張子に関係なく JSX を書ける）と `.jsx` / `.tsx` は、JSX のテキストの `//` をコメントと区別できないため生バイトで数える。
TypeScript でも、`)` の後の `/` が正規表現にも読めて同じ行に `//` `/*` がある形など、字句だけで読みが決まらないファイルは生バイトで数える。
旧方式 `sha256:` で記録済みの `runs[]` はコメントも含めた生バイトで照合する（記録し直すと `sha256-nc:` になる）。

### スペック単位で記録する（`repeat_run.specs`）

**2 回目が意味を持つのは、現行の状態を変えるスペックだけ。** スイート全体の 1 つの指紋に記録を結びつけると、
状態を変えないスペックを 1 行変えただけで全件の 2 回実行へ戻る（実測: 2 回で約 35 分のうち、2 回目が要るのは状態を変えるスペックの約 1.5 分だけだった）。
`repeat_run.specs` を書いた成果物は、検査がスペック単位で判定する（書いていない成果物は上のとおりスイート全体の指紋で判定する）。

- **`suite.specs` の下のスペックをすべて分類する**（`path` / `state_mutating` / `reason`。`reason` は必須）。
  スペックとして数えるのは Playwright の既定の `testMatch`（`*.spec.*` / `*.test.*`）に当たるファイルと、分類表に書いたファイル。
  **分類されていないスペックは落ちる**——足したスペックが分類されないまま 1 回の緑で素通りしないようにする。`testMatch` を変えたプロジェクトは、当たらないスペックも分類表に書く。
  命名規則にも分類表にも当たらないのに `test(` / `test.describe(` などでテストを定義しているファイルも落ちる（土台に紛れると 2 回続けての緑を求められないため。`test.extend(` だけの fixture は当たらない）
- **`runs[]` には `shared_fingerprint` と `spec_fingerprints`（その回に回したスペックの分だけ）を書く**。値は手で計算せず、次の出力から写す:

  ```bash
  node <skill>/scripts/artifact-health-check.mjs --metadata .replace/parity/<slug>/metadata.json --fingerprint
  ```

- **判定**: 状態を変えるスペックごとに、そのスペックを含む直近 2 回が緑・別の日時で順に始まり、どちらもそのスペックの指紋と `shared_fingerprint` が現在と一致すること。
  状態を変えないスペックは 1 回の緑（`current_green`）で足りる
- **変えたのが状態を変えるスペックなら、そのスペックだけを 2 回続けて回して `runs[]` に足す。** 状態を変えないスペックだけを変えたなら、2 回の取り直しは要らない
- **土台（`shared_fingerprint`）が変わったら、状態を変えるスペックをすべて 2 回続けて回し直す。** 土台は `locator_map` / `expectations` / `interactions` / `tools` と、
  `suite.specs` の下のスペック以外（スペックが読む共通の関数・fixture）。どのスペックが何を読むかは検査が追えないので、共有のものは全スペックに効くとみなす
- **現側専用スペック（`current-only/` の採取・ノイズ基準値測定・強度ゲート）と寸法の測定スペック**は、現行のデータを書き換えず成果物を書き出すだけなら
  `state_mutating: false` と理由を書く。書き出した成果物の決定論性は、ノイズ基準値の 2 回撮りと強度ゲートが別に確かめている。
  採る前に現行へ保存する操作を含むなら `true` にする
- **新側専用スペック（`new-only/`）の置き場所は `current_excluded` に書く**（`path` と `reason`。`current` プロジェクトが `testIgnore` で走らせないことの記録）。
  その下は分類も指紋も要らない——`parity-diff` が後から置いても記録は失効しない。**`reason` の無い行は外さずに数える**
- **「状態を変えない」の宣言を、検査は字面で裏づけない。** 画面経由の書き込み（ボタンを押すと保存される）はスペックの字面から判定できず、
  書き込み系 API の呼び出しを探す近似は見落としても何も言わないので、裏づけとして使うと安心材料に化ける。
  `reason` はレビューで読まれる判断の記録として書き、**迷ったら `true` にする**（2 回回すコストは、後始末の壊れたスペックを現行へ回し続けるコストより小さい）

**現行アプリの行を変えるスイート（書き込み・更新・削除を含むもの）は、2 回続けて回して両方緑であることを確かめる。**
**初期状態から始まる 1 回目には、後始末の有無が結果に現れない**——後始末を消しても 1 回目は緑のままで、2 回目で初めて落ちる。

- **戻す操作はスイートの中**に置く（反対の操作を同じテストで押す等）。**外の道具（手作業のクリーンアップ・別コマンド）に頼ると、
  回した人が忘れた時点で次の実行が壊れ**、しかも**壊れ方が「現行が変わった」と同じ見え方**になる
- 判断と記録は `metadata.json` の `suite.state_mutating` / `suite.repeat_run`。状態を変えないなら `state_mutating: false` と理由を書く
  （**書かないと「状態を変えるか決めていない」と区別が付かない**）。2 回の `started_at` は別の日時にする（同じ値は 1 回の記録の写しと区別が付かない）
- 後始末できない書き込み（hermetic でないテスト）は従来どおり `gaps.md` に残す。2 回続けて緑にできないことが分かった時点で、
  それは「後始末が効いていない」という測定結果であって、運用で守る話ではない

## 保存先

保存先の区分（テキスト成果物は Git／大きなバイナリは `artifacts` 設定・既定 `local`）・選択肢の意味論・上書きの規則は、
**`replace-strategy` の `references/project-config.md`「成果物の保存先」を正本**とし、ここでは再定義しない。本スキル固有の運用だけを定める:

- **撮影前に書き込み可否を検証**し、不可なら早期に失敗する（全部撮ってから保存できないと分かるのを避ける）。容量閾値超過で警告する
- **実際に選ばれた保存先を `metadata.json` に記録する**（スクリーンショットは足場であり、切替後に残っている必要はない）
- 画素差分ツールはプロジェクトで選び `metadata.json` に記録する（例: pixelmatch / odiff）
- **ファイル出力の解析ツール（xlsx / PDF）も同じ形**——プロジェクトが選び `metadata.json` の `differ.file_extract` に記録する（選定・候補の判断材料の正本は `replace-strategy` の `references/file-io.md`）。
  捕捉したバイト列と抽出結果は `baseline/` 配下に置き、保存は上記の区分に従う（抽出結果はテキストなので Git、元のバイナリは `artifacts` 設定）

## golden-dataset との連携

**`golden-dataset`（フェーズ A）が先に完了していること。** データセットを刷新すると、それ以前に取得した視覚ベースラインと特性化結果は土台のデータが変わった時点で無効になる。

- **取得時のデータセットバージョンを `metadata.json` に記録する**
- 記録されたバージョンが現在のデータセットより古ければ、**陳腐化として検出し再取得を促す**
- データ不足（空リストしか確認できない・ページネーションが 1 ページで終わる等）は `gaps.md` に「データ不足」として記録し `golden-dataset` へ戻す（確認済みにしない）。戻るとバージョンが上がり、影響を受けるベースラインを再取得する

## ライフサイクル

- **ワークツリーは最新のみ。** 同一機能の調査を繰り返してもイテレーションを並べない。履歴は Git が持ち、「いつ時点の現行か」は `metadata.json` の対象コミットで追える（古い調査結果は端的に劣る）
- **モデル・エフォートは必ず記録する。** これが無いと調査結果を後から比較できない（同じモデルでもエフォートで結果が変わるため）
