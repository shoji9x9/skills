# 視覚ベースラインとノイズ基準値

**視覚ベースラインは本スキルが現行アプリを駆動するついでに採取する。** 現行アプリを 1 回巡れば、実行可能なパリティスイートと `parity-diff` 用のベースラインが同時に得られる。**現行アプリを駆動するのは本スキルだけ**なので、ノイズ基準値の測定もここで行う。

## 3 点セット

スクリーンショット単独では不足する。3 点セット＋ネットワークログを、**ページ・状態・ビューポートごと**に採る。
ネットワークログは 3 点セットの補助（API・データ由来の差の調査材料）として `baseline/` に含める。認証情報・トークンをマスキングしたうえで（[`auth.md`](auth.md)）、
サイズが大きくなりうるためスクリーンショットと同じく保存は `artifacts` 設定に従う。

| 要素 | 中身 | 用途 |
|---|---|---|
| スクリーンショット | 画面の画素 | 名前の付かない要素の見た目差を `parity-diff` の画素経路＋トリアージが扱う |
| 論理名付き要素の特性 | 固定プロパティ集合（padding / margin / font 系 / color / background-color / border-radius ＋ `cursor` / `user-select` / `pointer-events`）＋擬似要素（`::before` / `::after`）＋`getBoundingClientRect()` の**相対幾何**（絶対座標は比較に使わない）。[`coverage.md`](coverage.md) で遷移させた各状態で採る | DOM 構造が同じで見た目だけ違う事象を、名前付き要素については決定論的に捉える |
| 参考 aria スナップショット | 採取した aria | **参考資料であって assertion ではない**（assertion は手書き。[`coverage.md`](coverage.md)） |

- **特性照合の対象は論理名付き要素に絞る。** 名前の付かない要素の見た目差はスクリーンショット（画素経路）が担う
- **画素経路へ委ねられるのは静止画に写るものだけ。** `cursor` / `user-select` / `pointer-events` は操作したときの手応えを決めるが撮影には写らないため、
  固定プロパティ集合から外すと**特性照合でも画素比較でも差が出ない**（どちらの経路にも現れない見た目になる）。プロパティ集合の正本は
  [`../scripts/trait-capture.mjs`](../scripts/trait-capture.mjs) の `FIXED_PROPERTIES` で、増減させたら `VERSION` を上げる
- **`url()` を値に持つプロパティは、参照先の資産の中身までは照合していない。** 採取ツールは相対 URL の絶対化によるホスト違いを消すため
  同一オリジンの `url()` をオリジン非依存の印へ畳む（[`../scripts/trait-capture.mjs`](../scripts/trait-capture.mjs) の `foldOrigin`）。
  このため**現新が同じパスで別バイトの資産を配信していると、その見た目差は特性照合にも画素にも現れない**（カスタムカーソルの画像が該当する）。
  対象要素があれば `gaps.md` の「特性化できなかった箇所と理由」へ種別「採取値の射程外」として残し、確認済みにしない。
  強度ゲートで注入しても特性照合が赤にならないので、`strength.md` の「未検証の故障種別」にも同じ理由で残す
- **`FIXED_PROPERTIES` を変えたら現側・新側の両方を採り直す。** `parity-diff` の前提確認はツールの `VERSION` と `metadata.json` の記録値の一致を要求するため、
  片側だけ採り直した成果物は比較に進めない（止まるのが正しい振る舞い）
- 採取には同梱 [`../scripts/trait-capture.mjs`](../scripts/trait-capture.mjs) をプロジェクト側 `<parity_suite_dir>/parity/lib/tools/vendor/`（既定。コピー専用のサブディレクトリ。配置指針は [`locator-mapping.md`](locator-mapping.md)）へコピーして使う。
  何を採ったか（対象要素・プロパティ集合・状態）を `metadata.json` に残し、`parity-diff` が同一条件で照合できるようにする

## 撮影条件の統制

**同一環境・同一ビューポート・アニメーション無効（`animations: 'disabled'`）・動的領域のマスク。** 条件を `metadata.json` に残し、`parity-diff` が新側を同一条件で撮れるようにする。
**撮影範囲（全画面かビューポート内か）も `capture_conditions.full_page` に残す**——記録しないと新側が決め打ちで撮り、画像サイズの違いが全面差分として出る。

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
- **行は要求元の操作ごとに分かれる（種別だけで束ねない）。** 列フィルタの吹き出しと右クリックメニューはどちらも `opens-container` を要求するが、
  **束ねると片方の状態名を書くだけで未決 0 になり、撮られなかった器の差は「差 0 件」と同じ見え方に戻る**。
  要求元はプロファイル由来なら候補ルール id でまとまるので、列が 40 本あっても行は操作の数で収まる
- **撮れない状態には理由を書く**（押すと外部連携が起動する、不活性になる条件が現行に無い、など）。
  同じ文言を `gaps.md`「特性化できなかった箇所と理由」へ種別「撮影状態の対象外」として残す。
  **欄が無いと「導いたが撮らないと決めた」と「導けていない」が同じ見え方になる**
- **`--metadata` を渡した実行だけが `capture_conditions.states` との差を取れる。** 渡さない実行は
  `conformance.visual_states.checked: false` のままで、`parity-diff` はそれを収束の根拠にしない
  （照合していない記録を照合済みに倒さない）。**その照合は `metadata.json` を書いた手順 8 で通す**。
  記録には被覆表と撮影条件の指紋が入るので、**通した後に表・撮影条件を書き換えたら `--write` から通し直す**
  （書き換えたまま古い要約を残すと `parity-diff` が落とす）。
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
- `opened_by` には開く操作を**操作アダプタの呼び出し**として `<関数名>(<開く対象の論理名>)` の形で書き（引数を取らない関数は `<関数名>()`。状態名で代用しない）、2 段目以降は親の器の `name` を `parent` に書く。
  **関数名だけにしない**——引数で開く対象を変える関数（`openCombo(page, name)` 等）は、1 行で全ての呼び出しを満たしたことになり、他の器の撮り漏れを突き合わせで拾えなくなる
  **書き終えたら操作アダプタ（`suite.interactions`）とスイートから器を開く呼び出しを「関数名 × 開く対象の論理名」の単位で列挙し、全てが `opened_by` に現れることを突き合わせる**——追加した操作が撮影状態に反映されない抜けはここで拾う
- 器が 1 つも無い機能は `popup_inventory: []` と書く（キーの欠落は「数えていない」と区別できない）
- **`popup_inventory` を持たない既存の `metadata.json` は、この節と次節の導入より前の採取として扱い、ベースラインとノイズ基準値を採り直す**（待たずに撮った 2 標本の「ノイズ 0」が残り続けるため）

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
- **測る要素**: `traits.elements` の論理名の全て（各論理名が在るページで、default 状態）。自分で選ばない——`scripts/dimension-fit.mjs` が samples に無い論理名を落とす
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
採るのは本手順（`current`）と `parity-replace` の完了判定（`new`）の直前だけにし、採った直後に `fit` / `check` を通す:

```bash
PARITY_DIMENSION_CAPTURE=1 PARITY_CURRENT_UI_URL=<url> npx playwright test --project current <parity_suite_dir>/parity/<slug>/dimension/
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
