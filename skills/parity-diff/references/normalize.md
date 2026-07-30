# ノイズ基準値・レジストリによる正規化とインスタンス例外

検出された候補（[`detect.md`](detect.md)）に、次の順で正規化を適用して機械分類する。**この工程は LLM に判断させない**（同梱 [`../scripts/diff-normalize.mjs`](../scripts/diff-normalize.mjs) が 1〜4 を機械分類する）。生き残った候補だけを [`triage.md`](triage.md) へ渡す。

## 適用順序

1. **意図的差異レジストリ** `intentional_diffs.{keep,may_change,pending}`: 宣言済みの差分を落とす。**`pending` 該当は未確定なので落とさず要確認扱い**（未収束として残す）
2. **コンポーネント系統差 T** `component_diffs[]`（`{component, property, current, new, reason}`）: 比較は「生の値が違うか」ではなく「新側の値が T から許容を超えて逸脱しているか」。
   **T に合致すれば吸収、逸脱すれば回帰候補として浮かせる。** 1 回の宣言が全インスタンスに効く。`references.ui_library`（旧→新 design token マッピング）を判断材料に読む
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
  同じ原因の複数インスタンスは、文言を揃えるのではなく `component_diff_exception_causes[]` に**原因を 1 回定義して `cause` で参照する**（下記「インスタンス例外のスキーマ」）。
  **命名規約ではなくスキーマで縛る**——「`reason` の冒頭を同じ原因ラベルで揃える」型の規約は守られなくても検出手段が無く、実際に同一原因の `reason` が全インスタンスへ複製される
- **SKILL.md の「インスタンス単位の無視リストで飲み込まない」はこの経路差の制約より優先されない。** 特性照合で値の差として出ている差分を、T を書かずにインスタンス例外へ落とすのが禁止対象であり、
  画素経路のみの差をインスタンス例外へ書くのは形式上の唯一の置き場所

## component_diffs T の照合方法

`component_diffs` の `component` はコンポーネントクラス名だが、DOM クラスの解決は無理に行わない。**照合は「`property` が一致し、baseline 値が `current`・capture 値が `new` と（単位正規化のうえ）一致するか」で行う。** クラス名は補助メタとして `matched_rule` に出すだけ。

- `property` が一致し baseline＝`current`・capture＝`new` → 吸収（`absorbed_T`）
- `property` が一致し baseline＝`current` だが capture≠`new` → **逸脱**（`deviates_T`。回帰候補として強調）

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
      "bbox": "<property: pixel のときだけ必須。差分領域の bbox「x,y,w,h」（現側 crop の座標）。照合キーはこれ>",
      "current": "<旧値。property: pixel のときは crop への相対パス（実行ごとに変わるため照合キーにしない＝根拠）>",
      "new": "<新値。同上>",
      "cause": "<component_diff_exception_causes[].id。必須>",
      "approved_at": "<ユーザー承認の日時（ISO 8601）>"
    }
  ]
}
```

- **インスタンスに `reason` を持たせない。** 原因の文言は `component_diff_exception_causes[]` にだけ置く（フィールドが無いので複製が構造的に起こらない）
- **`cause` は単発の例外でも必須。** インスタンスが 1 件しか無い原因も `causes` に 1 件立てる（根拠の枠が常に付き、後から同原因が増えたときは薄い参照を足すだけで済む）
- **インスタンス件数を畳まない。** `page` / `element` / `bbox` にワイルドカードを置いて 1 エントリで N 箇所を吸収させない——
  **例外の件数は検証の弱さのシグナル**であり、行数削減のために件数を隠すと弱さが見えなくなる（1 原因 ＋ N 個の薄い参照にする）。
  **照合キーの省略もワイルドカードにならない**（`page` / `viewport` を省いた例外は照合に使われない。`state` だけはスキーマの既定値 `default` を補う）
- **`element: none` は「論理名が無い要素」を指すスキーマ値で、match-all ではない。** 特性照合の Diff は必ず論理名を持つため `none` の例外はその経路では合致しない
  （画素経路の候補に対して本スキルが適用する。下記「画素経路の例外の適用」）
- **照合キーはインスタンス側にだけある。** `causes` は `reason` / `evidence` を共有するだけで照合に一切関与しない（原因を足しても吸収範囲は変わらない）
- **承認済み例外の件数は `diff-metadata.json` の `accepted_exceptions`（原因数・インスタンス数）に記録する**（`replace-strategy status` が読める形で件数を残す。様式の正本は [`../assets/diff-metadata-template.json`](../assets/diff-metadata-template.json)）
- **fail-closed の検証**: `cause` が `component_diff_exception_causes[].id` に解決できない／解決先の `evidence` が空／`slug` がファイルの `slug` と違う／照合キー（`page` / `viewport`）が欠けている——いずれのインスタンスも**照合に使わず**、
  該当候補は `unexplained` のまま残す。不整合は `diff.md` に明記する（黙って吸収しない・黙って捨てない）。検証の実施箇所は下記「registries.json の組み立て」と `diff-normalize.mjs`

## 画素経路の例外の適用（`property: pixel`）

`diff-normalize.mjs` は特性照合の Diff しか見ないため、画素候補への例外適用は**本スキルがこの工程で行う**。判断は挟まず、次の機械的な一致だけで落とす。

- **照合キーは `slug` / `page` / `state` / `viewport` / `element`（無ければ `none`）/ `bbox`。** `bbox` は `pixel-crops.mjs` が出したクラスタの bbox と、
  `metadata.json.differ.align_tolerance` の範囲で一致すること（座標は現側 crop 基準）
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
- 例外の不整合（`cause` が解決できない・`evidence` が空・`slug` が `--slug` と違う）は stderr に警告として出る。**警告が出た例外は照合に使われていない**ので、`diff.md` の不整合として記録して直す
  （警告の件数が `diff-metadata.json.accepted_exceptions.unresolved` になる）
- 終了コード 0=全て吸収（要対応なし）/ 1=`unexplained` または `deviates_T` または `pending_review` あり / 2=入力エラー

### registries.json の組み立て

**2 つのソースからキーを名前を変えずに集めるだけ**にする（対応表を書かない——名前を付け替える工程は join のミスが混入する場所になる）。

| registries.json のキー | ソース |
|---|---|
| `intentional_diffs` | 設定ファイルの `skills.replace-strategy.intentional_diffs` |
| `component_diffs` | 同 `skills.replace-strategy.component_diffs` |
| `component_diff_exception_causes` | `.replace/parity/<slug>/component-diff-exceptions.json` の同名キー |
| `component_diff_exceptions` | 同ファイルの同名キー |

- **例外ファイルが無ければ後者 2 キーは空配列**にする（例外ゼロ。停止しない）
- **ファイルの `slug` が対象 slug と違えば停止する**（別 slug の台帳を読んでいる。空として黙って進めない）
- **原因の文言をインスタンスへ展開しない。** 解決は `diff-normalize.mjs`（特性照合経路）と本スキル（画素経路）が照合時に行う。組み立て時に展開すると複製が復活する

## コンポーネント比較の方針

- **カタログサイト（コンポーネントライブラリの見本）を比較の正解にしない。** 正解は動いている現行アプリ
- カタログの用途は**状態網羅リスト**（どの状態・バリアントが存在するかの参照）に限る
- Storybook を使う場合も突き合わせるのは computed style のみ可で、**現行アプリから抽出した値と比較する**（Storybook 同士・カタログ同士で突き合わせない）
- **ピクセル比較系 VRT ツールで新旧を突き合わせない**（実装が違えば全面赤になり無意味）
