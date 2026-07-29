# ノイズ基準値・レジストリによる正規化とインスタンス例外

検出された候補（[`detect.md`](detect.md)）に、次の順で正規化を適用して機械分類する。**この工程は LLM に判断させない**（同梱 [`../scripts/diff-normalize.mjs`](../scripts/diff-normalize.mjs) が 1〜4 を機械分類する）。生き残った候補だけを [`triage.md`](triage.md) へ渡す。

## 適用順序

1. **意図的差異レジストリ** `intentional_diffs.{keep,may_change,pending}`: 宣言済みの差分を落とす。**`pending` 該当は未確定なので落とさず要確認扱い**（未収束として残す）
2. **コンポーネント系統差 T** `component_diffs[]`（`{component, property, current, new, reason}`）: 比較は「生の値が違うか」ではなく「新側の値が T から許容を超えて逸脱しているか」。
   **T に合致すれば吸収、逸脱すれば回帰候補として浮かせる。** 1 回の宣言が全インスタンスに効く。`references.ui_library`（旧→新 design token マッピング）を判断材料に読む
3. **インスタンス例外** `component_diff_exceptions`（本スキルが形式を定義する。フォールバック）: T が引けない箇所のみ
4. **ノイズ基準値** `metadata.json.noise_baseline[]`（page × state × viewport）: 現行を同一条件で 2 回撮った差分量。新側との差分がこれと同程度なら回帰ではない。
   レジストリで説明できなかった**残余へ集計で適用する**——個々の差分単位ではどれがノイズかを決められないため、残余の件数が該当組の `trait_diffs` 以下のときに限り全件を環境ノイズ候補に落とす。
   超えていれば 1 件も吸収しない（実回帰を黙って吸収しない）。基準値が無い組はノイズ判定せず候補として残す
5. **宣言できない構造差**: `.replace/parity/<slug>/gaps.md` の「宣言できない構造差」節にあるものは正規化対象外＝**未検証**として `diff.md` に転記する（確認済みにしない）

## レジストリの適用対象（どの経路の差に効くか）

**レジストリごとに効く経路が違う。** 効かない経路の差をそこへ宣言しても吸収されず、次の実行でも同じ差が `unexplained` として残る。

| レジストリ | 効く経路 | 適用する主体と照合キー |
|---|---|---|
| `intentional_diffs` | 全経路（散文の宣言を候補の説明に使う） | 特性照合経路は `diff-normalize.mjs`、他経路は本スキルが同じ語で照合する |
| `component_diffs`（T） | **特性照合経路のみ**（computed style・相対幾何の**値**を `property` / `current` / `new` で照合する） | `diff-normalize.mjs`。**画素経路には効かない**（照合キーになる値の差が無いため）・aria にも効かない |
| `component_diff_exceptions`（`property` が CSS プロパティ） | 特性照合経路 | `diff-normalize.mjs`（page / state / viewport / element ＋ **値の一致**で照合） |
| `component_diff_exceptions`（`property: pixel`） | **画素経路のみ** | **本スキルが画素候補に対して適用する**（page / state / viewport / element / **`bbox`** で照合。値では照合しない） |

**`diff-normalize.mjs` の入力は `trait-compare.mjs` の出力だけであり、画素経路の候補（crop 対）は通らない。**
そのため `property: pixel` の例外を書いても同スクリプトは吸収しない——吸収は下記「画素経路の例外の適用」で本スキルが行う。
ここを取り違えると、承認して例外を書いたのに次の実行でも同じ crop が `unexplained` として再浮上する（この節が防ごうとしている状態そのもの）。

- **画素経路でしか出ない差**（現・新で computed style は一致するのにラスタライズ結果だけが違う。フォントのサブセットビルド差でグリッドフィッティングが変わる等）は、
  `component_diffs` に**系統差として 1 回で宣言できない**。T の照合は「baseline 値＝`current`・capture 値＝`new`」で行うため、両側の値が一致する差には掛かるキーが無い
- そのため画素経路のみの差は、系統的な原因であっても `component_diff_exceptions` へ**インスタンス単位**で書く（`property: pixel`）。
  同じ原因で複数インスタンスに書くときは `reason` の冒頭を同じ原因ラベルで揃え、後から系統差として辿れるようにする
- **SKILL.md の「インスタンス単位の無視リストで飲み込まない」はこの経路差の制約より優先されない。** 特性照合で値の差として出ている差分を、T を書かずにインスタンス例外へ落とすのが禁止対象であり、
  画素経路のみの差をインスタンス例外へ書くのは形式上の唯一の置き場所

## component_diffs T の照合方法

`component_diffs` の `component` はコンポーネントクラス名だが、DOM クラスの解決は無理に行わない。**照合は「`property` が一致し、baseline 値が `current`・capture 値が `new` と（単位正規化のうえ）一致するか」で行う。** クラス名は補助メタとして `matched_rule` に出すだけ。

- `property` が一致し baseline＝`current`・capture＝`new` → 吸収（`absorbed_T`）
- `property` が一致し baseline＝`current` だが capture≠`new` → **逸脱**（`deviates_T`。回帰候補として強調）

## インスタンス例外のスキーマ（正本はここ）

`component_diff_exceptions` は T が引けない箇所のインスタンス単位フォールバック。共有契約キーで、非破壊追記（`replace-strategy` の `references/project-config.md` の規約）。**ユーザー承認済みのものだけを書く**（承認前の候補は `diff.md` 上の未説明差分のまま。`pending` には書かない——未説明が残る＝未収束として扱う）。

```yaml
component_diff_exceptions: # T が引けない箇所のインスタンス単位フォールバック。スキーマ正本は parity-diff
  - slug: <slug>
    page: <ページ>
    element: <論理名。無ければ none>
    state: <状態。既定 default>
    viewport: <viewport label>
    property: <CSS プロパティ。画素経路のみで拾った差は pixel>
    bbox: <property: pixel のときだけ必須。差分領域の bbox「x,y,w,h」（現側 crop の座標）。照合キーはこれ>
    current: <旧値。property: pixel のときは crop への相対パス（実行ごとに変わるため照合キーにしない＝根拠）>
    new: <新値。同上>
    reason: <T にできない理由と許容の根拠>
```

## 画素経路の例外の適用（`property: pixel`）

`diff-normalize.mjs` は特性照合の Diff しか見ないため、画素候補への例外適用は**本スキルがこの工程で行う**。判断は挟まず、次の機械的な一致だけで落とす。

- **照合キーは `slug` / `page` / `state` / `viewport` / `element`（無ければ `none`）/ `bbox`。** `bbox` は `pixel-crops.mjs` が出したクラスタの bbox と、
  `metadata.json.differ.align_tolerance` の範囲で一致すること（座標は現側 crop 基準）
- **`current` / `new`（crop への相対パス）は照合キーにしない。** 実行ごとに変わるため、値一致で照合すると毎回不一致になり例外が効かない。両者は承認時の根拠として保持する
- **キーが揃わない候補は落とさない**（`unexplained` のまま残す）。bbox が動いた＝差の位置が変わったということなので、同じ例外で吸収してよい保証がない
- 適用した例外と、その `bbox` の実測ずれを `diff.md` の差分一覧に残す（どの例外がどの候補を吸収したか追えるようにする）

## diff-normalize.mjs の実行

```text
node <スキルディレクトリ>/scripts/diff-normalize.mjs <trait-diffs.json> --registries <registries.json> --slug <slug> [--page <p> --state <s> --viewport <v>] [--noise <metadata.json>]
```

- `<trait-diffs.json>` は `trait-compare.mjs` の出力（Diff 配列）
- `--registries <registries.json>`: `skills.yml` から `intentional_diffs` / `component_diffs` / `component_diff_exceptions` の該当キーを読み取り JSON に変換したものを渡す（YAML パーサを同梱しないため。skills.yml を直接渡さない）
- `--noise <metadata.json>`: `noise_baseline[]` を読むために `parity-suite` の `metadata.json` を渡す
- 出力は各 Diff に `classification`（`absorbed_registry` / `absorbed_T` / `deviates_T` / `absorbed_exception` / `noise_candidate` / `pending_review` / `unexplained`）と `matched_rule` を付けた JSON。
  終了コード 0=全て吸収（要対応なし）/ 1=`unexplained` または `deviates_T` または `pending_review` あり / 2=入力エラー

## コンポーネント比較の方針

- **カタログサイト（コンポーネントライブラリの見本）を比較の正解にしない。** 正解は動いている現行アプリ
- カタログの用途は**状態網羅リスト**（どの状態・バリアントが存在するかの参照）に限る
- Storybook を使う場合も突き合わせるのは computed style のみ可で、**現行アプリから抽出した値と比較する**（Storybook 同士・カタログ同士で突き合わせない）
- **ピクセル比較系 VRT ツールで新旧を突き合わせない**（実装が違えば全面赤になり無意味）
