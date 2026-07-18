---
name: parity-suite
description: 仕様を変えないアプリケーションリプレイスで、新旧どちらの実装にも当てられる実行可能な合否判定基準（パリティスイート）を現行アプリに対して構築し、故障注入で強度を検証する replace-strategy の姉妹スキル。論理名のロケータマッピング層と手書きの寛容な aria スナップショットで Playwright スイートを書き、API を record/replay で特性化し、視覚ベースライン（スクリーンショット・computed style・参考 aria スナップショット）とノイズ基準値を採取して parity-diff へ引き渡す。1 回の実行で 1 機能（横断 API リソース・バッチも可）。replace-strategy setup と golden-dataset の完了が前提で、未完了・Playwright 不可なら停止する。「パリティスイートを作って」「現行アプリを特性化して」「parity-suite」や --feature <slug> を伴う依頼で発動する。
argument-hint: "[--feature <slug>]"
license: MIT
---

# Parity Suite

`replace-strategy` の姉妹スキル。**現行アプリに対してパリティスイート（新旧どちらの実装にも当てられる実行可能な合否判定基準）を構築し、故障注入で強度を検証するところまで**を担う。
**新側には触れない**——新側マッピングの充填は `parity-replace`、現・新の差分検出は `parity-diff` の担当。
視覚ベースラインとノイズ基準値は現行アプリを 1 回巡るついでに採取し、`parity-diff` へ引き渡す。

## 使い方

```text
parity-suite [--feature <slug>]
```

- **1 回の実行につき 1 機能。** 複数機能を並行して進めない（調査・特性化・強度検証が浅くなるため）
- `slug` は `.replace/features.md` が採番したもの。**自分で採番しない。** 省略時は features.md の未着手から対話選択する
- **モードは slug の種別で決まる**（フラグは無い）。features.md の 機能／横断 API リソース／バッチ のどの表にあるかで下表のモードになる

| モード | 起点 | 内容 |
|---|---|---|
| 機能（feature） | features.md の機能 | 画面駆動でスイート＋ベースラインを採取。全構成要素を使う |
| 横断 API（api-resource） | features.md の横断 API リソース | 画面を伴わない API のみの特性化。スイートは一度だけ書いて共有 |
| バッチ（batch） | features.md のバッチ | データセット＋入力ファイルで現行バッチを走らせ、出力を現行ベースラインに捕捉 |

- 自然文でも発動する:「パリティスイートを作って」「現行アプリを特性化して」「この機能を強度検証して」

## 前提

- **ツール**: `git`、Node.js（Playwright の実行環境）。`gh` は不要（本スキルは Issue を操作しない）
- **前提スキル**: `replace-strategy`（`setup` 完了）、`golden-dataset`（フェーズ A 完了）
- **MCP**: 不要（現行アプリの駆動は Playwright 自身が行う）
- **Playwright（TypeScript）前提**。好みではなく設計が Playwright 固有機能に依存するため。理由は 3 点:
  - `toMatchAriaSnapshot` の既定が部分一致であることを利用して「寛容なスナップショット」を手書きする
  - `getByRole` / `getByLabel` が ARIA とセマンティクスから role とアクセシブルネームを解決するため、マークアップが違っても同じ記述が両実装に当たりうる
  - `projects` で同一スイートを 2 つの baseURL（現・新）へ流せる。API 特性化も `request` フィクスチャで同じ仕組みに寄せられる

  **Playwright を使えないプロジェクトでは本スキルの設計は成立しない**ため、その旨を明示して停止する（代替ランナーでスイートを書かない）。

## 厳守の制約（禁止事項）

- **採取した aria スナップショットを assertion にしない。取って diff しない。** 新旧の取得物を機械的に突き合わせると、新実装が正しくなったことによる差とノイズが混ざりシグナルにならない。assertion は仕様が保証する項目だけを手書きした寛容なスナップショットのみ（採取物は参考資料）
- **タブ順の厳密一致（停止数・順序の完全一致）を assertion にしない。** 仕様が保証するのは到達可能性と論理的順序であり、停止数は実装方式で変わりうる
- **id / name を比較のアンカーにしない。** 原則は role ＋アクセシブルネーム（自動生成 id は変更対象）
- **強度検証（故障注入）を省いて「テストがあるから大丈夫」としない。** テストの存在自体は品質の証拠にならない
- **強度を手書き assertion 単体で判定しない。** 「手書き assertion ＋ ベースライン ＋ 差分器」の一式で判定する
- **故障注入の緑を「スイートは強い」と宣言しない。** カタログ外は射程外であり、緑は反例が見つからなかったことに過ぎない
- **現行アプリのデータを破壊しない**（`forbidden_actions` を尊重。読み取りを既定、書き込みは承認済みの範囲のみ）
- **ブラウザで確認していない挙動を「確認済み」と記録しない。** 未検証は理由付きで `gaps.md` に残す
- **シークレットの値をコード・コメント・ログ・成果物・スクリーンショット・スナップショットに残さない。** 設定・コードには環境変数名だけを置き、値は復唱しない

## プロジェクト設定の解決

設定ファイル `.config/skills/shoji9x9/skills.yml` の `skills.replace-strategy.*` を**直接読む**（転記しない）。スキーマの正本は `replace-strategy` の `references/project-config.md`。本スキルが読むキー:

| キー | 用途 |
|---|---|
| `parity_suite_dir` | パリティスイートの配置（未指定時 `e2e/`） |
| `artifacts.{retention,storage,size_threshold_mb,overrides.<slug>}` | 大きなバイナリの保存先既定と機能ごとの上書き |
| `auth.current.env_vars` / `auth.new.env_vars` | 認証情報の環境変数名（側ごとに分ける） |
| `secrets.wrapper` | シークレットが要るコマンドの前置ラッパー |
| `current.{url,db.env_vars}` | 現行テスト環境の URL・DB 接続の環境変数名 |
| `forbidden_actions` | 現行アプリに実施しない操作 |
| `references.db_semantics` | DB 意味論の差（並び順の特性化で読む） |

各キーの既定値・意味論の正本は上記スキーマ文書にある（ここへ転記しない。`parity_suite_dir` の既定だけは本スキルの受け入れ条件のため明記した）。

設定が無ければ `replace-strategy setup` を促して停止する。

## 実行フロー

詳細は各 reference へ委譲する。番号順に進める。

1. **前提検証と早期失敗**: `.replace/features.md`・設定が無ければ `replace-strategy setup` を促して停止。`.replace/dataset/metadata.json` が無ければ `golden-dataset`（フェーズ A）を促して停止。
   Playwright が使えない（Node が無い・導入不可）なら設計不成立を明示して停止。現行 URL への疎通と認証環境変数の存在確認（値は出さない）で早期に失敗する
2. **対象決定**: `slug` を features.md と突き合わせる（無い slug は停止。自分で採番しない）。種別からモードを決める
3. **保存先検証**: `artifacts`（`overrides.<slug>` を考慮）の書き込み可否を**撮影前に**検証し、不可なら早期に失敗する（詳細: [`references/baseline.md`](references/baseline.md)）
4. **データセットバージョン確認**: `.replace/dataset/metadata.json` の `version` を読み、成果物に `dataset_version` として記録する。既存の `.replace/parity/<slug>/metadata.json` の `dataset_version` が古ければ陳腐化として再取得を宣言する
5. **authoring**: ロケータマッピング（現側）→ 操作差分の吸収 → スイート（表示＋操作・状態カバレッジ）→ 手書き aria → API 特性化。
   詳細: [`references/locator-mapping.md`](references/locator-mapping.md) / [`references/coverage.md`](references/coverage.md) / [`references/api-batch.md`](references/api-batch.md) / [`references/auth.md`](references/auth.md)。
   **api-resource / batch モードは画面系工程（ロケータマッピング・手書き aria・状態遷移）を行わない**（[`references/api-batch.md`](references/api-batch.md) の該当モードに従う）
6. **ベースライン採取とノイズ基準値測定**（feature モードのみ）: 現行アプリを駆動するついでに 3 点セットを採り、2 回撮ってノイズ基準値を出す。詳細: [`references/baseline.md`](references/baseline.md)。
   api-resource / batch モードのベースラインは API 応答・出力（DB 状態・生成ファイル）の捕捉であり、視覚 3 点セットは採らない
7. **強度ゲート（故障注入）**: 既知の回帰分類から故障カタログを導出し注入する。素通りした故障は強化するか `gaps.md` へ。詳細: [`references/strength-gate.md`](references/strength-gate.md)
8. **成果物記録と完了報告**: スイートが**現に対して green** であることを確認し、`strength.md` / `gaps.md` / `metadata.json` を生成する。データ不足があれば `golden-dataset` へ戻す案内をする

## 成果物

すべて対象プロジェクト側に置く。**スキーマの正本は本スキル**（テンプレート: [`assets/`](assets/)）。

| 成果物 | 場所 | 正本テンプレート |
|---|---|---|
| パリティスイート | `<parity_suite_dir>` | — |
| ロケータマッピング・操作アダプタ | `<parity_suite_dir>` 配下（実際のパスは `metadata.json` に記録） | — |
| 強度レポート | `.replace/parity/<slug>/strength.md` | `assets/strength-template.md` |
| 未検証領域 | `.replace/parity/<slug>/gaps.md` | `assets/gaps-template.md` |
| 視覚ベースライン | `.replace/parity/<slug>/baseline/` | — |
| メタデータ・ノイズ基準値 | `.replace/parity/<slug>/metadata.json` | `assets/metadata-template.json` |

- テキスト成果物（特性 JSON・aria・`metadata.json`・`strength.md`・`gaps.md`）は Git。スクリーンショット等の大きなバイナリは `artifacts` 設定に従い、既定 `local`（コミットしない）
- 決定論的ツールは正本を本スキルに同梱する（[`scripts/trait-capture.mjs`](scripts/trait-capture.mjs) / [`scripts/trait-compare.mjs`](scripts/trait-compare.mjs)）。
  実行時はプロジェクト側 `<parity_suite_dir>/parity/lib/tools/`（既定。配置指針は [`references/locator-mapping.md`](references/locator-mapping.md)）へコピーして使い、実際のパスを `metadata.json` に記録する

## 姉妹スキルとの連携

- **`golden-dataset` との往復**: フェーズ A 完了が前提。探索でシード不足（空リストしか確認できない・ページネーションが 1 ページ等）を見つけたら `gaps.md` に「データ不足」として記録し `golden-dataset` へ戻す。戻るとバージョンが上がり、影響を受けるベースラインを再取得する
- **`parity-replace` へ引き渡すもの**: 論理名の契約（現・新をまたぐ）、現側 green のスイート、Playwright `projects` の `current` / `new` という名前（`new` の baseURL は `parity-replace` 段階で設定される）
- **`parity-diff` が再利用するもの**: 強度ゲートで健全性を確認済みの差分器（ツール・しきい値）、ノイズ基準値、撮影条件。すべて `metadata.json` 経由で引き渡す
- **`replace-strategy status`** が `strength.md` / `gaps.md` / `metadata.json` を読んで現況を導出する
