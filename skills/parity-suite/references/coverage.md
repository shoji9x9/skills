# 手書き aria スナップショットと操作・状態カバレッジ

**ページを表示して終わりにしない。** 表示は仕様のごく一部でしかない。操作・状態・副作用出力まで特性化する。

## 寛容な aria スナップショット（手書き）

- **取って diff しない。仕様として書く。** 新旧のスナップショットを機械的に突き合わせると、差分の多くが「新実装が正しくなったこと」（`div` → `role=alert`、リンク偽装タブ → 正しい `tablist`）に由来し、ノイズと改善が混ざってシグナルにならない
- `toMatchAriaSnapshot` の既定が部分一致であることを利用し、**仕様が保証する項目だけ**を列挙する

### 部分一致で許容されること・されないこと

「部分一致だから寛容」ではない。**寛容なのは書いていない兄弟が在ることだけ**（テンプレートに書いた子が実際に無ければ一致しない）で、階層と順序は厳密に効く（既定 `/children: contain` ＝「指定した子がその順序で存在すれば一致」。`equal` / `deep-equal` で厳密化もできるが本スキルでは使わない。出典: <https://playwright.dev/docs/aria-snapshots>）。

| 差異 | 既定の部分一致での扱い |
|---|---|
| テンプレートに書いていない兄弟が実際には在る | 許容される |
| 中間の階層を省略して孫を直接書く | **一致しない**（照合は直下の子関係で行われ、深さは飛ばせない） |
| 兄弟の順序が違う | 一致しない（順序は厳密） |

**帰結: ページ全体を 1 枚のスナップショットで書かない。** 深さを飛ばせない以上、1 枚で書くと現行の平坦な DOM 階層をそのまま契約に焼き込むことになり、**新側がセクションを landmark 化するなど構造を改善しただけで赤くなる**（仕様は変わっていないのに落ちる＝パリティ判定として誤り）。

- **セクション単位でアンカーして複数枚に分ける。** ページ本体ではなく、論理名で引いたセクションのロケータ（ランドマーク・見出しで引ける単位）に対して `toMatchAriaSnapshot` を当て、そのセクション内で仕様が保証する構造だけを書く
- アンカーより上（セクション同士の並び・ページの外枠）は契約に含めない。**セクションの在席そのものは別 assertion で見る**（「同じページに乗る他機能の在席」と同じ形）
- セクション内でも階層が実装都合で決まっている箇所（装飾のための入れ子など）は**書かない**——書くと深さが契約に入る
- 現行が非セマンティックな箇所と、実装機構が異なる箇所は**意図的に書かない**
- **ビューポートごとに書けば、レスポンシブの構造パリティも押さえられる**（ブレークポイントでの `display:none` 等の表示切替は aria スナップショットに現れる）。余白・色の変化は写らないため、そこは `parity-diff` の担当
- ベースライン採取時に取得する aria スナップショット（[`baseline.md`](baseline.md)）は**参考資料であって assertion ではない**。判定に使うと「取って diff する」失敗に逆戻りする

## 操作・状態のカバレッジ

以下を対象とする。

| 観点 | 内容 |
|---|---|
| 初期表示と初期値 | フォーム・フィルターの初期選択値、リセット後の値、保存済み条件を適用したときのフォールバック値 |
| マウス操作 | クリック、hover、ドラッグ。**hover / focus / active / disabled / selected / error の状態へ遷移させるのは本スキルの責務**（見た目の比較自体は `parity-diff`） |
| キーボード操作 | Tab による到達可能性、focus 表示、Enter / Space の発火、ショートカット。**タブ順の厳密一致は判定基準にしない**（到達可能性と論理的順序に留める） |
| スクリーンサイズ | 対象ブレークポイントごとに確認する。**対象は現行アプリの実測（CSS のメディアクエリ・実 UI の表示切替点）から導出し**、採用したビューポートを `metadata.json` の撮影条件に記録する（実行ごとに場当たりで選ばない）。表示切替は aria スナップショットに現れる。余白・色は `parity-diff` に委ねる |
| 検索・フィルター・ソート・ページネーション | 条件を変えたときの挙動。ページネーションは 2 ページ目があれば実遷移まで |
| バリデーション | エラーメッセージの**文言**と**発火タイミング**（onChange / onBlur / onSubmit のどれか）、初回入力前は出さない等の UX パターン |
| 状態表示 | 空データ、エラー、トースト、ダイアログ。**ローディングは明示的な loading UI がある場合のみ対象**とし、indicator が無い画面は対象外として記録する。**操作が返すトースト・ダイアログの開閉等は下記「操作の反応」の被覆表で押さえる** |
| 権限による差異 | ロールごとに表示・操作が変わる箇所（[`auth.md`](auth.md)） |
| ドキュメントレベルの要素 | `<head>` 側とドキュメント属性。**ページごとに 1 回**: `title`、favicon（`link[rel~="icon"]` の解決先 URL）、現行が持つ主要な `meta`（`description` / `viewport` / OGP 等）、`html[lang]`。いずれも決定論的に取れるため手書き assertion に向く |
| ファイル入力（アップロード） | 選択・複数選択・選択解除、バリデーション（形式・サイズ上限）、成功／失敗表示、保存結果（バイト列・派生物・保存 path の規則）。**操作は書き込みであり [`data-discipline.md`](data-discipline.md) の規律に従う。** 操作手段・fixture の生成・検証対象の正本は `replace-strategy` の `references/file-io.md`（ドラッグ & ドロップは対象外） |

- **アニメーションのパリティは対象外。** 差分比較では `animations: 'disabled'` で停止させるため、この手法では原理的に扱えない。対象外であることを明記する
  （対象・対象外・条件付きの一覧は `replace-strategy` の `references/scope.md` が正本。本ファイルは各項目の**行動**を持つ）
- **ページ本文の要素だけを対象にしない。** `<head>` 側は視覚ベースラインにも aria スナップショットにも写らないため、対象から外すとスイートでも差分器でも捕まらない
  （新側テンプレートの既定 favicon・既定 `title` のまま置き換わっても、誰も赤くならない）

### 機能の在否は「器と文言がある」で確かめない

移行元の部品は、使わない機能の器を高さ 1px などに畳んだまま DOM に残すことがある。文言も残る。
**「器があり、文言を含む」だけの観点は移行元で緑になり、無い機能が「ある」と読まれる**——新側で赤くなり、不要な依存の追加や無い機能の実装を求めることになる（Issue #461）。
`toBeVisible()` も足りない。Playwright は矩形が空でなく `visibility: hidden` でなければ可視と判定するので、高さ 1px の器は可視になる
（出典: <https://playwright.dev/docs/actionability#visible>）。

- 機能が「ある」ことは、次のどれかで確かめて観点にする
  - **使える大きさで見えている**: 矩形の幅と高さが、その機能の中身（文言・操作要素）を収める大きさである
  - **操作が効く**: 操作して、その機能の反応（並び替わる・開く・値が変わる）が出る
  - **移行元がその機能を有効にしている設定値**（ソース・設定）を読み、その箇所を根拠に書く
- 確かめた結果、移行元で機能が無効なら、観点は**「その機能は出ない」**にする（器の畳まれ方を新側へ写させない）
- 強度ゲートでは「器を畳む」故障で、在否だけの観点が素通りしないことを確かめる（[`strength-gate.md`](strength-gate.md)「故障カタログ」）

## 操作の反応（押した直後で止めない）

**被覆の単位は「操作 → 直後の状態」ではなく「操作 → 反応」にする。** 操作が返す反応は、次の 3 つが重なると
直後のスナップショットにも操作した要素の近くにも現れず、**被覆表が埋まったまま取りこぼされる**（未測定の欄すら立たない）。

| 性質 | 取りこぼし方 |
|---|---|
| 遅れて出る | 往復のあとに出る（例: 押してから約 0.5 秒）。直後に見ると無い |
| 操作した器の外に出る | ダイアログの中の操作で、トーストが**親文書**（iframe の外）の最上部に出る。操作対象の近傍を探しても見つからない |
| 自動で消える | 出てから一定時間で消える。**測る時刻を外すと「無い」が返り、同じ操作で違う結論が出る** |

塞ぐのは **反応の被覆表** `.replace/parity/<slug>/reactions.json`
（正本テンプレート: [`../assets/reactions-template.json`](../assets/reactions-template.json)、照合: [`../scripts/reaction-check.mjs`](../scripts/reaction-check.mjs)）。feature モードのみ作る。

- **操作は操作アダプタ（`suite.interactions`）とスイートの呼び出しから列挙する**（`trigger` に `<関数名>(<論理名>)` で書く）。1 操作につき `reactions`・`layout`・`aftermath` を必ず持たせる
- **反応の欄は空にしない。** 反応が無いなら `kind: none` を**実測の結果として**書く——`observation` に見続けた時間（表の `observation_window_ms` 以上）と、
  **見た文書**・見方を残す。見た文書は表の `documents`（対象ページの最上位の文書 `top` と全フレームの棚卸し）を全て含める（欠けると落ちる）。欄が無ければ「見ていない」と「無い」が同じ見え方になる。測れなければ `kind: unmeasured` と理由（`gaps.md` にも残す）
  **「反応なし」もスイートの assertion にする**（`covered_by`）。新側が遅れて出て消える反応を足しても、静止画にも特性照合にも写らないため。
  固定待機ではなく、全文書の変化を記録する監視を仕掛けてから操作し、`page.waitForFunction` が観測時間内に成立しない（タイムアウトする）ことで不在を確かめる
- **文書を棚卸しするときに、各文書のオリジンが対象 URL（`targets[].url`）のオリジンと同じかを `document_origins` に記録する**（`same-origin` / `cross-origin`）。
  値そのもの（ホスト・ポート）は書かない——`url_command` の target は URL を成果物に残さないため、関係だけを残す。
  移行元が自分の URL を絶対 URL で組み立てる（埋め込みフレームの読み込み先・遷移先）と、`targets[].url` にホストやポートの別名を書いた環境では、そのフレームだけが別オリジンになる。
  別オリジンのフレームの中の処理は親の文書に届かない（同一オリジンポリシー）。そのため**移行元に実在する反応が測った環境では現れず、`kind: none` として記録される**。
  差分器は「無い」同士で一致させるので、この取り違えを検出できない
  - 測り方: `page.frames()` の各フレームで `frame.evaluate(() => self.origin)` を読み、`new URL(<targets[].url>).origin` と比べる。
    フレームの URL ではなく実効オリジンで比べる（`about:blank` や `srcdoc` のフレームは親のオリジンを継ぐ。出典: <https://developer.mozilla.org/docs/Web/API/Window/origin>）
  - **`cross-origin` の文書があれば、反応を記録する前に、移行元がその読み込み先を組み立てる絶対 URL（設定・ソース）を確かめる。**
    移行元の本来の配置でも別オリジンになるなら、確かめた根拠を `cross_origin_evidence` に**文書ごとに**書く（`{ "<文書>": "<根拠>" }`。別オリジンの文書が無ければ `{}`）。表全体で 1 本にしない——意図して別オリジンにした文書の根拠が、環境の都合で別オリジンになった文書まで通してしまう。
    環境の都合（別名のホスト・ポート）で別オリジンになっているなら、反応を記録せずに停止する。`targets[].url` を移行元が組み立てるオリジンに揃えるようユーザーに促し（設定の正本は `replace-strategy` の `references/project-config.md`）、揃えてから測り直す
  - `kind: none` には操作した文書（`observation.source_document`）も書く。見た文書と合わせて、どのオリジンの間で「無い」を確かめたかが残る
- **観測は「出るまで待ち、消えるまで測る」。1 回のスナップショットで判定しない**
  - 出現: 上限つきで待ち（`appearance.wait_limit_ms`）、操作から出るまでの時間を `delay_ms_samples` に残す。**操作した器の中だけでなく、最上位の文書と全フレームを探す**。出た先を `destination`（文書と論理名）に書く
  - 消え方: 自動で消えるなら出現から消えるまでを **2 回以上**測って `duration_ms_samples` に残し、標本の幅以上の `tolerance_ms` を決める。
    **消える時間を測らないと、新側が「出しっぱなし」でも静止画にも特性照合にも差が出ない**（どの経路にも現れない振る舞いになる）。消えないなら `mode: persistent` と確かめた記録。
    **標本は下の assertion と同じ測り方（出現の assertion が解けた時刻から消える assertion が解けた時刻まで）で採る**——測り方が違うと、ポーリングの遅れの分だけ assertion が許容幅を外す
  - 画面に出ない反応（クリップボードへの書き込み等）は `visible: false` と確かめ方（`observation`）
- **観測した反応はスイートの assertion にする**（`covered_by`）。`parity-replace` が新側でスイートを green にする時点で反応のパリティも担保される。消える時間は固定待機（[`locator-mapping.md`](locator-mapping.md) が禁じる）ではなく自動リトライ assertion と経過時間で押さえる:

  ```ts
  // 出典: https://playwright.dev/docs/api/class-locatorassertions（toBeVisible / toBeHidden の timeout）
  await trigger();
  await expect(toast).toBeVisible({ timeout: waitLimitMs });
  const shownAt = Date.now();
  await expect(toast).toBeHidden({ timeout: durationMs + toleranceMs });
  expect(Date.now() - shownAt).toBeGreaterThanOrEqual(durationMs - toleranceMs);
  ```

- **画面に出る反応は撮る／撮らないを `capture` に決める**（撮るなら `capture_conditions.states` の状態名、撮らないなら理由を書いて `gaps.md` へ「撮影状態の対象外」）。
  自動で消える反応を撮るときの注意は [`baseline.md`](baseline.md)「撮る対象が動かなくなるまで待つ」
- **表は操作ごとに `scripts/table-upsert.mjs` で書く**（本文ごと書き直さない。[`checkpoints.md`](checkpoints.md)「大きな JSON 成果物は 1 行ずつ書く」）

### 操作で変わる頁の組み方（`layout`）

**寸法の式（`dimension_model`）と視覚ベースラインは初期表示の状態しか見ない。** 操作で現れる要素の位置や、操作のたびに器の高さを書き直す振る舞い
（例: 検索条件の行を足すたびに、グリッドの高さを窓の高さから計算し直して頁を窓に収める）は、寸法の照合にも 3 経路にも入らない。
新側が組み方を変えない実装でも全経路が緑になり、利用者が画面を触って初めて見つかる（Issue #460）。

- **操作ごとに `layout` を必ず書く**（欠けると未測定）。操作の前と後で、頁の `document.documentElement.scrollHeight` / `clientHeight` と主な論理名
  （操作で動く・現れる要素と、窓の寸法で決まる器）の矩形を測る
  - 変わらないなら `changes: false` と、変わらないことを確かめた記録（`evidence`）、それを確かめる assertion（`covered_by`）
  - 変わるなら `changes: true` と、操作の前（`before`）・**同じ操作を 2 回以上繰り返した後**（`samples`。`repeat` は 1 からの連番）の測定と assertion。
    **1 回の差分では「窓から書き直す絶対値」と「前の値からの相対」を区別できない**——相対で写すと 2 往復目からずれる。その時点で表示されない要素の矩形は `null`
  - 測れなければ `changes: null` と理由（`gaps.md` にも残す）。未測定として数えられる
- **頁が窓に収まるかは高さで見る。** Playwright はスクロールバーを隠すので、新側の頁が窓を超えて縦スクロールバーが出ても、その分の横幅のずれは測った矩形に出ない
  （[`baseline.md`](baseline.md)「スクロールバーが場所を取る窓のはみ出し」と同じ根）。`scroll_height` が `client_height` を超えるかを assertion に入れる
- assertion は `samples` の最後の回と同じ回数だけ操作してから、頁の高さと矩形を確かめる（途中の回だけを見ない）
- 測るのは撮影したビューポートだけでよい。窓を変えたときの追従は初期表示の寸法の式だけが持つので、操作の後の組み方の追従は `gaps.md` に残す

### 押した後に残るもの（`aftermath`）

**撮影状態の導出は操作の途中（器を開く・指を乗せる・焦点・押している最中・不活性）を導き、反応は出て消えるものを測る。** どちらも、操作を**終えた後に残る**見た目と、**どこへ戻るか**を列挙させない。
行を選んだ後の列ごとの塗り・絞り込み中の見出しの色・複数列の並べ替えの印・ロゴを押した後の遷移・Clear が戻す範囲は、撮っていなければ 3 経路のどれにも差が出ず、
スイートが両側で緑・`parity-diff` が収束したまま、利用者が並べて操作して初めて見つかる（Issue #471）。

- **操作ごとに `aftermath` を必ず書く**（欠けると未測定）。`look`（残る見た目）と `returns_to`（戻り先）の両方を**現行で 1 度ずつ測って**書く
- **`look`**: 押した後に残る塗り・色・印・焦点を、要素（論理名）ごとに `items` へ 1 行ずつ列挙する。`observed` に現行で測った値
  （計算後スタイルの値・印の文言）を書く——**付かないことも値として書く**（現行が特定の列だけ選択の塗りを付けないなら、その列の行に「付かない」を書く。付く列だけを見ると、新側が全列を塗っても差が出ない）
  - 各行は**撮る状態（`captured` に `capture_conditions.states` の状態名）か assertion（`covered_by`。`toHaveCSS`・印の文言など）に割り当てる**（両方でもよい）。
    どちらにもしないなら `reason` を書いて `gaps.md` の「撮影状態の対象外」へ残す。割り当ても理由も無い行は未測定
  - 残らないなら `changes: false` と確かめた記録（`evidence`）と、残らないことを確かめる assertion（`covered_by`。新側が塗り・焦点の輪を残しても撮っていない状態には写らない）。測れなければ `changes: null` と理由
  - 部品の操作から立つ残る見た目（選択の塗り・絞り込みの印・並べ替えの印）は、被覆プロファイルの `after-operation` が撮影状態の行を導く
    （[`baseline.md`](baseline.md)「撮影状態の決め方（1）被覆表から導く」）。`look` は部品に依らず操作ごとに数える側で、導いた行と同じ状態名を `captured` に書いてよい
- **`returns_to`**: 押す前後の URL（`url_before` / `url_after`。`/` で始まるオリジンを除いたパス。ホスト・ポートは書かない）と、
  **押す前に既定から動かした状態**（`probed`）のうち押した後に既定へ戻ったもの（`reset`）を書く
  - **画面が持つ状態（検索条件・並べ替え・列フィルター・列の変更・行の選択・ページ送り等）を表の `screen_states` に 1 回だけ棚卸しし**（出どころを `source` に）、
    **押す前にその全てを既定から動かしてから押す。** 動かしていない状態が戻るかは測れない——検索条件だけを入れて Clear を押すと、並べ替え・列フィルターも戻す現行と、検索条件だけを戻す新側が同じ記録になる。
    操作ごとの自己申告にしないのは、1 つだけ動かして 1 つだけ確かめた記録を通さないため。動かせない状態は `not_probed` に状態ごとの理由を書く（棚卸しにあって `probed` にも `not_probed` にも無い状態は落ちる）。
    `reset` に `probed` に無い状態を書くと落ちる。状態を持たない画面なら `screen_states.states: []`
  - 遷移しない操作は `url_after` を `url_before` と同じ値にする（遷移しないことも実測の結果として書く）
  - URL と、戻る状態・戻らない状態（`probed` と `reset` の差）をスイートの assertion にする（`covered_by`）。測れなければ `measured: false` と理由（未測定として数えられる）

### 移行元のフィードバック呼び出しと突き合わせる

**反応の存在を知らなければ欄は作れない。** 利用者に見える副作用を出す呼び出し（トースト・画面を直接触るスクリプト・ダイアログの開閉等）は
プラットフォームごとに決まった名前を持つので、**移行元ソースの字面から機械的に列挙して被覆表と突き合わせる**。

- 呼び出しの一覧は設定 `current.feedback_calls`（パターン id・正規表現・種類。正本は `replace-strategy` の `references/project-config.md`「フィードバック呼び出し」）。
  被覆表の `feedback_calls.patterns` へ転記し、対象 slug の操作のハンドラを含む範囲を `source.paths` に絞って走査する。
  **走査する版は測定した現行の版に揃える**——`source.version` が `metadata.json` の `target.commit` と違えば落ち、どちらかが `none` なら `version_unverified_reason` が要る。
  **操作ごとにハンドラ（`handlers[].file` / `symbol`）を記録する**——ファイルが走査範囲に無い・シンボルがファイルに無ければ落ちる。
  走査範囲の書き漏れを操作単位で見えるようにするためで、**操作そのものの書き漏れまでは検出しない**（操作の列挙は上の「操作アダプタとスイートの呼び出しから」が担う）。
  **転記が設定と一致しているかは照合スクリプトが検査しない（規約）**——設定を変えたら被覆表へ転記し直して `--write` から通し直す
- 走査で見つかった呼び出しは**全て** `call_sites` に 1 行ずつ記録し（ファイル・行・列・パターンで 1 件。同じ行の複数の呼び出しも列で分けて全て）、観測した反応（`<操作 id>/<反応 id>`）へ対応付けるか、この機能の反応でない理由（`excluded_reason`）を書く。
  **呼び出しがあるのに `none` の反応へ対応付けない**（ソースが反応を出すと言っているのに観測で見落としている）
- **走査 0 件を「呼び出しが無い」と読まない。** パターンごとの `example`（実際の呼び出しの字面）に `regex` が一致することを照合で確かめ、それでも 0 件なら根拠を `zero_calls_reason` に書く（空なら落ちる）
- 設定にキーが無い（未確認）ときは、移行元ソースから候補を挙げて**ユーザーに確認し、確定した値を設定へ 1 回記録する**。移行元ソースを読めない（`current.repo: none` 等）なら
  `feedback_calls.declared: false` と理由を書き、`gaps.md` に残す（突き合わせを省いた事実を黙らない）。設定が空リスト（呼び出しが無いと確認済み）のときも `declared: false` とその旨を理由に書く

### 照合と宣言

- `metadata.json` に `reaction_coverage` と撮影状態（`capture_conditions.states`）を書いたら
  `node <skill>/scripts/reaction-check.mjs --metadata .replace/parity/<slug>/metadata.json --root <移行元ソースのルート> --write` を**exit 0 まで**通す
  （コピーせずスキル配下から実行する。`--root` の既定は cwd）。空欄・証拠の欠け・消える時間の単一標本・`layout` の欠けと 1 回だけの標本・`aftermath` の欠け（割り当ての無い残る見た目・動かしていない状態の `reset`・オリジン付きの URL）・呼び出しの記録漏れ・走査対象 0 件・
  `/` を含む id・observed の遅れの最大値以下の `observation_window_ms`・`slug` / `measured_target` が `metadata.json` の `slug` / `target.name` と違う表は落ちる
  （`metadata.json` にこれらと撮影状態・`target.commit`〈入手不可なら `none`〉が無ければ exit 2）。
  終了コードは 0 ＝ 通過、1 ＝ 未測定・不整合、2 ＝ 使い方の誤り・型崩れ
- `metadata.json` の `reaction_coverage` に `declared: true` と `path` を書く。**操作を持たない機能だけ** `declared: false` ＋理由
  （画面駆動の機能で `default` 以外の撮影状態・空でない `popup_inventory`・`component_coverage.declared: true` のいずれかがあれば、操作の痕跡との矛盾として exit 2）（`gaps.md` にも残す）。**キーごと省略しない**——欠落は旧成果物の意味になり、`parity-diff` が判定を飛ばす
- `parity-diff` は同じスクリプトを `--recorded` で呼び（移行元ソースは読まず、`conformance.ok` と表の指紋を要求する）、未測定が残る間は収束させない。**照合後に表を手で直したら `--write` から通し直す**

## 状態網羅の導出源

**確認すべき状態の網羅は部品の規範的な資料から導出してよい**（「これは Tabs パターンだから hover / focus / disabled / selected の状態があるはずだ」というチェックリストの生成源）。導出源は 2 系統ある。

| 導出源 | 具体 | 効くところ |
|---|---|---|
| コンポーネントカタログ | 自作・OSS の UI ライブラリの見本（カタログサイト等） | 状態・バリアントの列挙 |
| 部品ベンダーの機能一覧 | 市販部品の公式サンプル、ベンダーや CoE が配る非互換検証用の試験仕様書、版更新の前後比較用の資料 | **1 つの部品が持つ数十の操作**の列挙 |

- **版更新の前後比較用の資料は、採取状態の列挙としてそのまま使える**——「更新の前後で同じケースを実行して結果を比較する」という方針がパリティ検証と同じで、ケースが比較用の識別子付きで列挙されている
- ただし**どちらも比較の正解にしない**——資料はライブラリ／部品の規範的な姿であり、テーマ・カスタム CSS・上書き・バージョン差・そのインスタンスの設定で実際の描画とズレる。**正解は動いている現行アプリ**
- **資料が 1 つの状態として挙げるものでも、現行が種類ごとに描き分けるなら別の状態として採る**。
  典型は選択で、データグリッドのように**単一選択と範囲選択・複数選択（複数セル・複数行）で塗りが違う**部品は、`selected` を 1 セルの選択だけで作ると範囲選択の見た目が採取にも照合にも一度も現れない。
  描き分けの有無は現行 UI で実際に作って確かめる（同じ状態の中で別の論理名として採ってもよい）
- 資料が無い場合は現行アプリの実 UI から状態を洗い出す。**その場合も洗い出した項目を列挙として残す**（下記の被覆表の `source.kind: app-ui`）——列挙が残らないと「何を測っていないか」が後から誰にも見えない

### 部品被覆表（同じ部品でもインスタンスごとに測る）

**1 つの部品が数十の操作を持ち、画面ごとに設定が違う**とき、**あるインスタンスで測った結果を「その部品の挙動」として他のインスタンスへ流用すると、実装側がその画面で使っていない操作が採取状態から丸ごと落ちる**。
落ちた状態は撮られず assertion も無く、強度ゲートは**採った状態の中でしか**故障を注入できない（射程の正本は [`strength-gate.md`](strength-gate.md)「カタログの外は射程外」）。結果として、部品が持つ操作の欠落を抱えたまま `parity-diff` が収束しうる。

塞ぐのは**インスタンス単位の被覆表**。`.replace/parity/<slug>/component-coverage.json` に
**機能表の項目 × 部品インスタンス（ページ）** の表を持つ（正本テンプレート: [`../assets/component-coverage-template.json`](../assets/component-coverage-template.json)）。

#### 被覆表は移行元側の測定である（新側の欠落は示さない）

**3 値が数えるのは「移行元でその操作が在るか」だけ**で、「新側で同じ操作を実施して移行元と差が無いか」は数えていない。
**この 2 つは別の測定**であり、**欠落を見つけるのは後者だけ**——**前者をいくら積んでも新側の欠落は 1 件も示されない**（移行元の記録だから）。

- `evidence` / `covered_by` にも**どちら側で測ったかを書く欄は無い**。`covered_by` が指す採取状態（`metadata.json.capture_conditions.states`）は
  **測定対象（current target）に紐づく 1 つ**で、`measured_target` も `components[]` の直下に 1 つ。**1 つの被覆表は 1 つの測定対象のもの**である
- したがって**`unmeasured` 0 は「新側で操作を完了できる」を意味しない。** 新側の突き合わせは別の成果物
  `new/<target>/component-comparison.json` が持ち（様式の正本: [`../assets/component-comparison-template.json`](../assets/component-comparison-template.json)）、
  **`value: present` のセル 1 つにつき 1 行**を要求する。書くのは `parity-replace`（新側を操作する工程）で、
  読むのは `parity-diff` の収束判定（未突合が残る間は収束させない）。検査は同梱の
  [`../scripts/component-comparison-check.mjs`](../scripts/component-comparison-check.mjs):

  ```bash
  node <skill>/scripts/component-comparison-check.mjs \
    --coverage .replace/parity/<slug>/component-coverage.json \
    --comparison .replace/parity/<slug>/new/<target>/component-comparison.json \
    --metadata .replace/parity/<slug>/metadata.json \
    --replace-metadata .replace/parity/<slug>/new/<target>/replace-metadata.json --target <target>
  ```

- **`--replace-metadata` は必須。** 省けるようにすると、記録の後に新側を変えても鮮度の照合（`comparison-implementation-stale`）が
  一度も評価されず古い証拠で収束する。突き合わせ表の `new_implementation.commit` は `replace-metadata.json` の `new.commit` と一致し
  （例外は部品改修の持ち越しだけ——`--new-repo` を渡し、同じディレクトリの `evidence-carry.json` が覆う違いを
  [`../scripts/evidence-carry.mjs`](../scripts/evidence-carry.mjs) が認めたときに通す。手順の正本は `parity-diff` の `references/component-change.md`）、
  **両方の `dirty` が `false`** であることまで求める（未コミットの変更を抱えた作業ツリーの記録は commit で版を特定できない）
- **`new.commit` が `none`（新側が git 管理を持たない）なら反復回数で判定する。** 文字列の比較は両側 `none` で常に一致し、
  実装を変えても古い記録が鮮度検査を永久に素通りするため、`new_implementation.iteration` と `replace-metadata.json` の
  `loop.iterations` を突き合わせる。**どちらかが読めなければ合格に倒さず** `comparison-implementation-unversionable` で落とす。
  **片側だけが `none`** のとき（git 管理の有無が記録の後に変わった）は、反復回数が一致しても
  `comparison-implementation-stale` で落とす——`none` と実在の SHA は同じ版を指さない
- **`component` / `item` / `instance` の id に `|` を使わない。** 突き合わせの鍵（`<component>|<item>|<instance>`）の区切りなので、
  含めると別のセルの記録が別のセルの証拠として通る（被覆表の指紋も同じ潰れた鍵を数えるため一致してしまう）
- **セルの値は動かさない。** 新側で突き合わせていないことを理由に `present` を `unmeasured` へ落とすと、
  移行元で測った操作が未測定として数えられ、移行元側の被覆が読めなくなる（見た目の穴と同じ扱い）

##### 突き合わせの証拠は入口・当たり判定・完了に分ける

**ケースの一覧では拾えない。** 実測された欠落——**下位を持つ項目を押すとメニューが閉じて下位が出ない**・
**下位を示す三角が押せる要素の外にあり `cursor` も変わらない**・**並び替えの印が省略された文字に重なる**——は、
どれも「機能は在る」が「操作を最後まで完了できない」形で、**ケースの文面（「エクスポート」「列のソート」）には出てこない**。
そこで**ケースに依らない 3 つの軸**で観測する（3 点すべてが揃うまで突き合わせ済みにしない）。

| 軸 | 何を見るか |
|---|---|
| **入口**（`entry`） | 新側でその操作を**始められる**か（操作を送れる要素へ到達し、反応が起きる） |
| **当たり判定**（`hit_area`） | **押せる範囲**と `cursor` が移行元と同じか（印が `::after` で行全体が 1 項目なのか、別要素なのか） |
| **完了**（`completion`） | 操作が**最後まで通る**か（下位が開く・並び替えが反映される・器が閉じない） |

- **重なりと省略も完了の側で見る**——絶対配置の印は、余白を宣言していても幅が足りなければ文字に乗る（省略が切るのは文字の領域の端）
- **市販部品のクラスの意味は確かめてから読み替える**（名前が近くても条件が違う）
- 突き合わせで差が出たら `parity-replace` の実装へ戻す。**突き合わせないことを選ぶなら利用者の承認**（`disposition: accepted` ＋ `approved_by` / `approved_at`）が要る

#### 被覆表は見た目を見ていない

**この表が数えるのは操作と状態の「有無」だけで、色・寸法・余白・書体は 1 つも見ていない。**
**機能が揃っていて見た目が全部違う部品も、全セルが `present` で埋まる。**「部品の被覆表」という名前から見た目も含むと読まれやすいので、ここで区切る。

- 見た目の担保は**別の経路が持つ**。同じページの中では画素比較と特性照合（`parity-diff`）が、
  **画面より先に作った共通部品では `parity-component`**（現行の要素から採った基準とカタログ上の見本の照合）が担う
- したがって**`unmeasured` 0 は「見た目が現行と合っている」を意味しない。** `parity-diff` の収束判定が被覆表を見るのは
  「測っていない操作が差分ゼロとして通る」のを防ぐためであって、見た目の合否はあくまで画素・特性照合が出す
- **見た目の穴はセルの値を動かさない。** 見た目の担保が**どの経路にも無い**箇所（画素にも写らず特性照合の対象でもない）は、
  `gaps.md` の未検証領域へ**別立てで**残す。セルの値はあくまで操作・状態を測ったかで決める——
  見た目の経路が無いことを理由に `present` を `unmeasured` へ落とすと、測った操作が未測定として数えられ、
  `parity-diff` が**見た目とは別の理由で**収束できなくなる（被覆表は見た目を測っていないので、落としても見た目の担保は 1 つも増えない）
- **ただし「どの状態を撮るか」はこの表から導く。** 表に並んだ操作は、器を開く・指を乗せる・焦点を当てる・押している最中・不活性の
  どれを立てるかを決める材料になり、`value: present` のセルから撮影状態の必要集合が機械的に出る
  （手順と語彙の正本は `parity-suite` の [`baseline.md`](baseline.md)「撮影状態の決め方（1）被覆表から導く」）。
  **導くのは「撮るべき状態の集合」までで、撮った結果が現行と合っているかは引き続き画素・特性照合が出す**

- **インスタンスは「部品 × ページ」で数える。** 同じ部品を 2 画面で使っていればインスタンスは 2 つで、セルもそれぞれ測る。**片方で測った結果を共有部品の値として固定しない**
- **値は 3 値**（`present` / `absent` / `unmeasured`）。**`absent` も測った結果として記録する**——「無いことを確かめた」と「測っていない」を同じ空欄にしない
  - `present`: 現行インスタンスにその操作が在り、**採取状態（`metadata.json.capture_conditions.states`）か assertion に落として押さえた**（落とし先を `covered_by` に書く）
  - `absent`: 現行インスタンスにその操作が無いことを、次のどちらかの経路で確かめた。
    - **操作可能な要素が在る:** **(1)** 操作用に引いた可視要素へ操作を送る、**(2)** 操作イベントの到達または操作に応じる DOM・状態変化で発火を別途確認する、
      **(3)** 送り方・発火確認・観測結果の 3 点を**機械可読な `absence_evidence`（`action` / `fired` / `observation`）に記録する**（`evidence` は非空要約にしか使われず、構造化値を入れても検査されない）、
      **(4)** 1 つでも満たせなければ「無い」と判定せず `unmeasured` にする。
      **この経路で `absent` に進める順序は「発火確認済み」→「期待する UI 応答なし」であり、発火自体を確認できない結果を `absent` と結論しない。**
    - **どの到達状態にも操作可能な要素が無い:** 非表示確認用には `getByRole(..., { includeHidden: true })`、または同等に一意な構造ロケータを使い、対象の部品インスタンスの操作要素を一意に指すことを確認する（確認結果は後述の `locator_match_count` に実測値で残す。散文の確認だけでは検査されない）。
      **hidden を含む引き方であることを `absence_evidence.locator_includes_hidden: true` に実測として残す**——通常の `getByRole` は hidden 要素を除外するため、
      `display: none` の要素でも一致数は 0 になる。これを実証しないと、非表示の状態を DOM 不在と読み替えて `absent` に収束できてしまう。
      通常の操作・表示判定に使う role ＋アクセシブルネームの原則は変えない。次に、被覆プロファイルの候補と導出源、現行 UI から、
      その候補を表示しうる適用可能な状態と遷移（トリガー、ビューポート、スクロール、データ、権限等）を列挙して到達させ、すべての状態で要素または祖先が非表示、もしくは矩形の幅・高さの一方が 0 であることを実測する。
      ロケータ、状態の導出源、試した状態と遷移、各状態の矩形と `offsetParent`、非表示原因となった要素または祖先とその computed style は、
      **`evidence` ではなく `absence_evidence` へ機械可読に記録する**（`evidence` は非空かどうかしか検査されない散文の要約で、構造化値を入れても読まれない）。
      `offsetParent: null` だけを非表示の証拠にせず、矩形と非表示原因も突き合わせる。セルの `absence_evidence` は `kind: non-renderable`、`states_exhaustive: true` とし、
      インスタンスの `applicable_states` に、セルとは独立した状態manifest（完全な source と `complete: true`、一意な `items[].id` と遷移）を置く。
      `applicable_states.source.kind` は `profile` / `vendor-spec` / `current-source` / `app-ui` のいずれかで、それ以外は出所不明として `unmeasured` にする。`state_source` から導出した重複のない状態 id を
      `expected_states` に列挙し、`applicable_states.items[].id`・`states[].name` の一意な集合と完全一致させ、遷移もmanifestと一致させる。`locator` が対象の操作要素へ一意に当たることは散文では担保されないため、**状態ごとに**実測した一致数を `states[].locator_match_count` として記録する。
      2 件以上は一意に引けていないので `unmeasured`。0 件はその状態で DOM に無いことの実測として扱い、このとき矩形・`offset_parent`・`hidden_by` は全て `null` にする
      測定手順は次のとおり。**`toHaveCount(n)` は期待値 `n` を先に渡す照合で件数を発見できず、`count()` は `expect.poll` で包んでも
      [`locator-mapping.md`](locator-mapping.md) と `scripts/auto-wait-check.mjs` が禁止する**（実測）。そこで 0 / 1 の二値判定にする。
      **このセルを `current-only/` で測る場合も `count()` は使わない**——検査は採取スペックの `immediate-read` を免除するが、
      免除は報告を止めるだけで待たないことは変わらず、描画完了前の件数を `locator_match_count` に書くと誤った `locator` と区別できなくなる。
      **(1)** その状態へ遷移し、状態が確定したことをその状態固有の assertion（開閉フラグの `toHaveAttribute`、一覧の `toHaveCount` など）で先に確立する。
      **(2)** 確立後に `await expect(locator).toHaveCount(1)` を試し、成立すれば `locator_match_count: 1`。
      **(3)** 成立しなければ `await expect(locator).toHaveCount(0)` を試し、成立すれば `locator_match_count: 0`。
      **(4)** どちらも成立しなければ対象を一意に引けていないので、値を推測せずそのセルを `unmeasured` にする（2 以上を自己申告で書かない）。
      （値が入っていれば矛盾として `unmeasured`）。全状態が 0 件だと `locator` が対象を引けている実証が一度も無く、誤った `locator` と区別できないため `unmeasured` とする。同じ証拠を `locator` / `state_source` /
      `states[]`（状態名・遷移・矩形・`offset_parent`・`hidden_by`）へ機械可読に記録する。`hidden_by` は `target_locator`、`relation: self | ancestor`、`relationship_verified: true` で対象との関係を記録し、
      `computed_style` が `display: none` または `visibility: hidden | collapse` を含む場合だけ非表示原因とする。`hidden_by` があるのに矩形が `null` でなければ矛盾として `unmeasured` にする。
      これらを満たした場合だけ、操作を送らず `absent` とする。
      未確認の適用可能状態がある、状態へ到達できない、対象要素の引き方が不確か、または非描画の理由を実測できない場合は `unmeasured` とする。一時点の非表示や 0 寸法だけで `absent` にすると、
      メニューを開く前、レスポンシブ切替前、仮想スクロール前、状態・権限の変更前に存在する操作を被覆から落とすためである。
    操作可能な要素へ発火を確認する経路では `absence_evidence.kind: fired-without-response` を記録する。
    **送り方・発火確認・観測結果の 3 点は散文 `evidence` ではなく機械可読に残す**——`action`（`locator` / `method`（`locator-api` | `coordinate`）/ `detail`）、
    `fired`（`signal`（`event-listener` | `dom-change` | `state-change`）/ `detail` / `verified: true`）、`observation`。
    この経路の前提は可視要素への操作なので、`method` に関わらず `bounding_box`（幅・高さがともに正）、`visible: true`、`actionability_bypassed: false` を実測値で記録する
    （`force` や `dispatchEvent` で actionability を迂回した操作は可視要素への操作の証拠にならない）。`method: coordinate` では加えて `hit_test_target` と
    `hit_test_is_target_or_descendant: true` も記録する。
    どれかが欠ける・`true` にならない場合は `absent` にせず `unmeasured` とする。コンテキストメニューで `locator.click({ button: 'right' })` が発火しない場合は、
    [`locator-mapping.md`](locator-mapping.md)「操作の実装差を吸収する層」に従い、
    判定用と操作用のロケータを分ける。操作用要素の `boundingBox()` が `null` でなく幅・高さがともに正で、中心座標の hit-test がその要素または子孫を指す状態まで `expect.poll` で自動リトライし、
    条件成立直後だけ中心座標へ `page.mouse.click(x, y, { button: 'right' })` を送って再測定する。前提を満たさない座標へ操作を送ると重なった別要素の発火を誤認するため、座標操作へ進めない
  - `unmeasured`: 測っていない。`unmeasured_reason` に理由を書き、`gaps.md` にも残す
- **行が無い組み合わせは `unmeasured` として数える**（fail-closed）。`present` / `absent` なのに `evidence` が空、`present` なのに `covered_by` が空のセルも同じ——測った証拠が無いものを測った扱いにしない
- 期待セル数と未測定数を `metadata.json` の `component_coverage` に書く（期待セルはプロファイルを宣言していない部品なら 項目数 × インスタンス数、宣言した部品ならインスタンスごとの候補数の合計）。
  **`declared: true` のときだけ `parity-diff` の収束判定に入り、未測定が残る間は収束しない**（判定の正本は `parity-diff` の `references/convergence.md`）
- **部品を使っていない、または資料にも実 UI にも到達できず列挙を起こせない場合は `declared: false` と理由を書き、同じ理由を `gaps.md` に残す。理由は必須で、空だと `parity-diff` 側が落とす。キーごと省略しない**——キーの欠落は「旧版の `parity-suite` が作った成果物」の意味で、`parity-diff` が後方互換のため判定を飛ばす経路になる（測らなかった事実がそこへ紛れる）
- 被覆表は現側の測定結果なので **slug 直下に 1 つ**（環境別に分けない）。`api-resource` / `batch` モードは画面部品を持たないため作らない

#### 3 つの集合に来歴と完全性を要求する

**被覆表は 3 つの集合の上に立つ**——**部品の集合**（`components[]`）・**インスタンスの集合**（`components[].instances[]`）・
**軸の要素**（`instances[].enumeration` と `applicable_states`）。**列挙しなかった要素は期待セルにも現れない**ので、
**来歴と完全性を宣言させない集合は、測り漏れが `unmeasured` 0 のまま収束する**（「載せなかった」と「本当に無い」が同じ見え方になる）。
**どの集合も同じ形**（`source` の `kind` / `ref` / `version` / `condition` ＋ `complete` ＋ `false` のときの `incomplete_reason`）で宣言する。

| 集合 | 宣言する場所 |
|---|---|
| 部品 | `component_inventory`（表の直下。この機能の画面に載っている部品の全体） |
| インスタンス | `components[].instance_inventory`（その部品をどの画面に何個置いたか） |
| 項目 | `components[].source`（`kind` は `vendor-feature-list` / `vendor-test-spec` / `official-sample` / `current-source` / `app-ui`） |
| 軸の要素 | `instances[].enumeration.source` |
| 適用可能状態 | `instances[].applicable_states.source`（`kind` の語彙は前述の非描画 `absent` の規定に従う。**強い順の語彙と `stronger_source_unavailable_reason` は当てない**） |

- **集合の来歴の `kind` は強い順に `current-source` → `config` → `app-ui`**（`component_inventory` / `instance_inventory` / `enumeration.source` の 3 つ。
  項目集合の `components[].source` と適用可能状態は上の表の語彙を使う）**。** 先頭の**受領した現行ソースが一次情報源**で、
  **読めるなら、そこから部品の配置を静的に列挙してから画面を開く**——サーバー側テンプレート（`.aspx` / `.ascx` / `.jsp` 等）や
  部品定義には「どの画面にどの部品を何個置いたか」がそのまま並ぶ。**画面は期待値の確定に使い、集合の列挙には使わない**
- **実 UI の歩行（`app-ui`）が拾えるのは、その画面がその時描いたものだけ。** **本体の周りに置かれた部品**
  （ページャ・設定の保存と復元・右クリックの器）は**本体の軸には現れず**、**集合の側で落ちると誰も数えない**
- **一次情報源以外で列挙したときは `stronger_source_unavailable_reason` に理由を書く**（未受領・難読化・動的生成で追えない等）。
  **「読めなかった」と「実 UI から起こした」は別の事実**で、機械には区別できないため申告させる。
  これは `complete: false`（読めないときの fail-closed）の**裏側**——**読めるのに読まなかった**——を残す欄で、
  一次情報源で列挙したのに理由が書かれている場合は**効いていない免除**として落とす
- **効いていない免除はどの欄でも落とす**（集合の来歴とインスタンスの `enumeration` の両方）。
  `complete: true` なのに `incomplete_reason` が残っている記録も同じ扱い——
  機械は収束させるのに、成果物を読む側には「まだ読み切れていない集合」と見え、`gaps.md` の行も同じ文言で残り続ける。
  `complete: true` にしたら `incomplete_reason` は `null` にする
- **`components[].source.kind` に `current-source` がある**のは、受領ソースから起こした項目集合を `app-ui` に倒さないため——
  倒すと**静的に全部読んだのか、画面に出ていたものを数えたのか**が後から区別できない
- 検査するのは記録側 `coverage-expand.mjs` と判定側 `coverage-check.mjs` の**両方**（`SET_SOURCE_KINDS` / `ITEM_SOURCE_KINDS` は
  両スクリプトで同一に保つ契約領域に置く）。欠落・語彙外・完全性の未宣言・理由の欠落は**未測定**として数え、
  粒度は宣言の置き場所に揃える——`component_inventory` は表全体で 1 件、`instance_inventory` と `components[].source` は**その部品で合算して 1 件**
- **この宣言をツールが自動で埋めることはしない**（来歴は捏造できない）。既存の被覆表には人／エージェントが追記し、
  追記するまでは未測定として残る——`--write` が黙って埋めると、どこから列挙したかを誰も測っていない表が収束する

### 項目集合そのものを導出する（被覆プロファイル）

**被覆表は登録された項目しか数えない。** データグリッドで代表列だけを操作して「フィルターあり」「ソートあり」の
2 項目を登録すれば、他の列・非表示列・横スクロール先の列・コンテキストメニューは**期待セルにすら現れず**、
未測定 0 で収束する。項目の粒度が実行エージェントの判断に委ねられている限り、この欠落は機械的に残らない。

塞ぐのは **UI 部品ごとの被覆プロファイル**。部品の構成要素（列・メニュー項目等）を来歴付きで列挙し、
プロファイルが宣言する軸との直積から候補集合を機械的に展開して、被覆表と照合する。

- **部品固有の軸をこのファイルに書かない。** 軸・候補の列挙方法・必須組み合わせ・同値クラスの制約は
  各プロファイルが宣言し、共通処理はプロファイルを解釈するだけにする
  （Chart・Tree・DatePicker 等を、共通処理・中心ドキュメントを変えずに足せるようにするため）
- **契約の正本は [`coverage-profiles.md`](coverage-profiles.md)**、照合ツールは
  [`../scripts/coverage-expand.mjs`](../scripts/coverage-expand.mjs)、同梱プロファイルは
  [`../assets/coverage-profiles/`](../assets/coverage-profiles/)
- **適合するプロファイルが無い複雑な部品を、暗黙に汎用扱いにしない。** `profile: null` ＋
  `profile_absent_reason` を書き、同じ理由を `gaps.md` の未検証領域に残す（`profile` キーの省略は落ちる）
- 上の 3 値・`evidence`・`covered_by`・fail-closed の規則は、候補由来の期待セルにもそのまま当たる

## 同じページに乗る他機能の在席

**機能単位に分けて 1 機能ずつ green にする設計の裏返しとして、同じページに乗る別機能のセクションが丸ごと欠けていても、どのスイートも赤くならない**（各スイートは自分の担当範囲しか見ないため）。対象機能のスイートに在席チェックを置いて塞ぐ。

- **根拠は `.replace/features.md` の「ページ一覧」**（ページ × 乗る機能 slug）。対象機能のページに乗る**他機能ごとに 1 つ**、そのセクションが在ることだけを確認する assertion を置く
- **`.replace/features.md` の「ページ要素の帰属」表で、対象ページの要素を他 slug が所有していれば、その要素にも在席チェックを置く**——共通ヘッダ・外部システムへの導線・**スコープ外と決めた操作要素**は機能のセクションを持たないため、セクション単位の在席チェックからは漏れる（`扱い` が `スコープ外（配置のみ）` の要素も在ることは確かめる）。
  **対象 slug 自身が所有する要素は在席ではなく自分のスイートの assertion で押さえる**（在席側に置くと、自分の担当分がスキップ対象になる）
- **在ることだけを見る**（ランドマーク・見出しの role ＋アクセシブルネーム）。中身のパリティは当該機能のスイートの担当なので踏み込まない
- **新側で未実装の機能の在席チェックは `new` プロジェクトでスキップする**（現側では全機能が在るのでスキップしない）。スキップの注記に**対象機能の slug を書く**——実装が済んだ時点で `parity-replace` が自分の slug を手がかりにスキップを外し、在席を green で確認する。
  **要素単位の在席チェックの注記には「配置の所有者」slug を書く**（要素の内容を提供する機能ではなく、その要素を置く機能。`parity-replace` は自分の slug で検索して外すため、別の slug を書くと永久に外されない）
  - スキップは**テスト単位**（`new` プロジェクトのときだけ飛ばす条件付きスキップ）で置く。現側専用スペックの**ファイル単位の除外**（`testIgnore`。[`locator-mapping.md`](locator-mapping.md)）とは別物で、ここでは条件分岐が正しい手段（成果物を書き出さず、外し忘れは在席が緑にならないことで見える）
  - 注記は `parity-replace` が**機械的に引ける形**にする（例: 注記に `presence:<slug>` を含め、その文字列で検索して外す）。自然文だけだと外す対象を見つけられない。
    **`<slug>` に入れるのは上の 2 つが決める**——機能単位の在席チェックは対象機能の slug、要素単位の在席チェックは**配置の所有者**の slug（要素の内容を提供する機能ではない）
- ページ一覧に無いページ・在席を確認できない機能は `gaps.md` に残す（確認済みにしない）
- **ページ一覧を持たない `.replace/features.md`**（更新前のインベントリ）では、機能一覧の「ページ」列から逆引きできる範囲で在席チェックを置き、ページ一覧の追加を `replace-strategy` 側で行うようユーザーに促す（本スキルは features.md を書かない）。
  **唯一の例外も「自分で書く」ではなく委譲**で、要求単位の根拠の書き戻しは `replace-strategy evidence` が行う（[`api-batch.md`](api-batch.md)「要求単位を確定したら features.md へ書き戻す」）
- **「ページ要素の帰属」表を持たない `.replace/features.md`**（この節を持たない版のインベントリ）では、要素の所有者を推測で埋めない。所有者不明の要素を `gaps.md` に残し、表の追加を `replace-strategy` 側で行うようユーザーに促す
  - 表はあるが**所有者が空欄の行**（`replace-strategy` が確認待ちにした行）も同じ扱いにする。空欄を自分で埋めず、その要素の在席を確認済みにせず `gaps.md` に残す

## 副作用出力の特性化

機能ページ／バッチが生成する**ファイル出力・帳票/PDF**を、現行アプリを操作して read-only で捕捉しベースライン化する。

- 比較の観点: 文字コード・BOM・改行コード・列順・数値/日付書式・PDF の抽出テキストと構造
- **揮発項目（生成日時等）は意図的差異として除外する**——xlsx は ZIP 内に生成日時等が入るため**バイト一致を取らず**シート × セル値と構造で比較する（本節の適用対象）
- **バイト列の取得経路（ダウンロードイベント／`page.request`／batch はファイルシステム直読み）・形式別の扱い・xlsx / PDF の解析ツールの選定と記録は
  `replace-strategy` の `references/file-io.md` が正本**（ここへ転記しない）。到達できない出力は「対象」と判定せず `gaps.md` に残す
- 採用した解析ツールとバージョンは `metadata.json` の `differ.file_extract` に記録する（`parity-diff` が同じツールで新側を抽出するため）
- **メール・外部連携はスコープ外**（捕捉に現行アプリの変更が要る）で、`gaps.md` に記録する。対象／対象外の一覧は `replace-strategy` の `references/scope.md` が正本

## 未測定を機械可読にする（収束判定の入力にする）

**`gaps.md` は人向けの散文で、収束判定の入力ではない。** そのため「この状態は測っていない」と正しく書いてあっても、
`parity-diff` は**採った差分の分類が終わっているか**だけを見て `converged: true` にできる
（実測: 6 機能すべてが収束した状態で、利用者が手作業で 8 件の差を見つけた。うち 1 件は機能の欠落で、
**見つかった差の多くは `gaps.md` に「測っていない」と正しく書かれていた領域**だった）。

**強度ゲートも助けにならない**——故障注入は**採った状態の中で**行うため、採っていない状態には故障を仕込めず、
素通り 0 件という結果は**網の広さの証拠にならない**。

**そこで、未測定を `metadata.json` の `unmeasured` に機械可読で宣言する**（様式の正本は [`../assets/metadata-template.json`](../assets/metadata-template.json)）。
**書き手は本スキル**——`gaps.md` に未検証として残した項目のうち、**測るまで機能を閉じさせないもの**をここへ写す
（`item` / `reason` は `gaps.md` の該当行と同じ文言にし、成果物の片側だけに残さない）。

- **`disposition: blocking` が 1 件でも残る間は `parity-diff` を収束させない**（数え直しは [`../scripts/artifact-health-check.mjs`](../scripts/artifact-health-check.mjs)）。
  **止まるのは `parity-diff` だけ**——本スキルの完了判定は `--stage suite` で通すので、blocking を書いたこと自体が自分のゲートを止めることはない
  （書き手が記録を消す方向のインセンティブを作らない）
- **API の要求単位を確定できなかった項目は `endpoint` に口を書く**——`.replace/features.md` の API 列に書いた口をそのまま完全一致で入れる。
  `replace-strategy` の `scripts/evidence-gap-check.mjs` が**この値の完全一致だけを宣言として数える**ので、
  `item` の散文に口が含まれるだけでは宣言にならない（部分一致を許すと、別の口が宣言済みに化ける）。
  書かないと、その口は `parity-replace` の完了判定で「書き戻しの漏れ」として落ちる（口に紐づかない未測定では `null`）
- **`accepted` は「測らないことをユーザーが承認した」記録**で、`approved_by` / `approved_at` が要る。
  **語彙外・欠落・承認記録が空のものは `blocking` として数える**（fail-closed）
- **後方互換のため、既定は現状維持**——`unmeasured` を**キーごと持たない**成果物は判定に入れない。
  「宣言が無ければ未収束」にすると既存の全機能が一斉に未収束へ転じるので、**宣言を持つ成果物から順に厳しくなる**形にする
- **`gaps.md` は残す。** 散文の説明（測れなかった事情・戻し先）はそのままで、ここへ写すのは判定に入れる項目だけ
- **`entries` は追記専用**——`item` を消すと `replace-strategy` の `scripts/append-only-check.mjs` が落とす
  （一覧の `parity-unmeasured`。同一性は `item` で取るので `blocking` → `accepted` の承認追記は正規の遷移として通る）。
  この保護が無いと、**`gaps.md` を触らずに `entries` から 1 件消すだけで**`checkUnmeasured` が空の一覧を見て収束してしまう
  （散文と機械可読の対のうち、判定に入るのは後者だけなので、片側を消す書き換えは両方の検査を通る）
