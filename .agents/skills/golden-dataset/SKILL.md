---
argument-hint: '[--phase <a|b>] [--feature <slug>...]'
description: 仕様を変えないアプリケーションリプレイスで、現行と新側の比較を成立させるための共通ゴールデンデータセットを構築する replace-strategy の姉妹スキル。データそのものではなく、冪等・決定論的な投入ツール（TypeScript か SQL）を作る。本番環境は参照せずデータを一から作る。新側スキーマは後から出来るため 2 フェーズに分ける（A は論理データ設計と現行テスト環境への投入・検証、B は新側スキーマへの写像・投入・現新一致検証）。データセットにバージョンを持たせ parity-suite / parity-diff のベースライン陳腐化検出に使う。replace-strategy setup 完了が前提。「ゴールデンデータセットを作って」「テストデータを投入して」「golden-dataset」や --phase を伴う依頼で発動する。
license: MIT
name: golden-dataset
---
# Golden Dataset

`replace-strategy` の姉妹スキル。**現行と新側の比較を成立させるための共通データセットを構築する**。共通データが両側に無ければ「一覧に 3 件出る」という現行の正解を新側で検証できず、**構造しか比べられない**。

**作るのはデータそのものではなく、投入ツールである。** データはその出力にすぎない。ツールは冪等・決定論的で、何度実行しても同じ状態になり、現行と新側に同じ論理データを入れる。

**新側スキーマは `parity-replace` が実装するまで存在しない**ため、両側への投入を 1 回で完結できない。作業を 2 フェーズに分ける。

## 使い方

```text
golden-dataset [--phase <a|b>] [--feature <slug>...]
```

| モード | 起点 | 内容 |
|---|---|---|
| フェーズ A（初回） | `.replace/dataset/metadata.json` が無い | 論理データ設計 → 投入ツール生成 → 現行テスト環境へ投入 → 現行側検証 |
| フェーズ A（再実行） | `parity-suite` の `gaps.md`「データ不足」行 | 設計追記 → ツール更新 → 再投入 → 再検証。`version` を +1 し、影響ベースラインの再取得（`parity-suite` 再実行）を案内する |
| フェーズ B（`--phase b --feature <slug>...`） | 対象 slug の新側スキーマが揃った | 新側スキーマへの写像 → 新側環境へ投入 → 新側整合性＋現新一致検証。**論理データは変えないので `version` は上げない** |

- **無指定**: `.replace/dataset/metadata.json` が無ければフェーズ A（初回）。あれば用途を確認する（データ追加＝フェーズ A 再実行か、フェーズ B か）
- フェーズ A の論理データが共通の正本で、**フェーズ B は写像するだけ**（新しいデータを作らない）
- `slug` は `.replace/features.md` が採番したものを使う。**自分で採番しない**
- 自然文でも発動する:「ゴールデンデータセットを作って」「テストデータを投入して」

## 前提

- **ツール**: `git`。投入ツールの実行手段（DB クライアント・言語ランタイム）はプロジェクト側の前提
- **前提スキル**: `replace-strategy`（`setup` 完了）
- **MCP**: 不要
- **固定の技術スタック前提**: 投入ツールは TypeScript が既定。難しければ SQL（まとめてコミットできる形）

設定（`skills.replace-strategy.*`）または `.replace/features.md` が無ければ、成果物を捏造せず停止して `replace-strategy setup` を促す。

## 厳守の制約（禁止事項）

1. **本番環境を参照しない・本番へ投入しない。** 投入前に接続先の環境変数**名**を提示し（値は表示しない）、テスト環境であることをユーザーに確認してから実行する
2. **非冪等なツールを作らない。** 事前削除 → 投入で、何度実行しても同じ状態にする
3. **非決定論的なデータを生成しない。** ID・連番・UUID・基準時刻を固定する
4. **代表性を「確認済み」と宣言しない。** 何を含めなかったかを理由付きで必ず残す
5. **本番データ移行ツールを兼ねさせない**（要件が異なる: データ量・性能・停止時間・実データの取り扱い）
6. **非現実的な値ばかりにしない**（文字幅・桁数・改行が表示比較に影響する。`テスト1` のような値ばかりにしない）
7. **シークレットの値をログ・成果物・応答に出さない**（変数名のみ扱う。ユーザーが値を提示しても復唱しない）
8. **データは一から作る。** 例外として非本番の既存データを参考にする場合のみ、本番コピーの可能性を前提にマスキング方針を適用する（**既定は新規作成**）

## プロジェクト設定の解決

設定ファイル `.config/skills/shoji9x9/skills.yml` の `skills.replace-strategy.*` を**直接読む**（転記しない）。スキーマの正本は `replace-strategy` の `references/project-config.md`。本スキルが読むキー:

| キー | 用途 |
|---|---|
| `current.db.env_vars` / `new.db.env_vars` | 現行・新側 DB 接続の環境変数**名**（値は読まない・出力しない） |
| `secrets.wrapper` | シークレットが要るコマンドの前置ラッパー |
| `references.db_semantics` | フェーズ B の写像・現新一致検証で読む型マッピングと意味論差 |
| `dataset_tool_dir` | 投入ツールの配置先（未指定時は `seed/`） |
| `forbidden_actions` | 現行・新側環境に実施しない操作 |

対象テーブル・リソースドメインは `.replace/features.md` から引く。

- **本スキルは設定を生成しない**（読むだけ）。ただしフェーズ B で見つかった新規の意図的差異は `intentional_diffs.pending` へ**非破壊で追記**しユーザー確認へ回す

## 実行フロー

詳細は各 reference へ委譲する。番号順に進める。

### フェーズ A（現行フェーズ）

1. **前提確認と早期失敗**: 設定・`.replace/features.md`・DDL の入手性を確認。DDL（またはスキーマを決定論的に得る手段）が無ければ停止してユーザーに確認する。DB 接続の環境変数の存在確認（値は出さない）を `secrets.wrapper` 前置で最初に行い、繋がらなければ早期に失敗する
2. **データ設計**: DDL の制約と機能インベントリを起点に、エッジケースを意図的に含めて設計する。詳細: [`references/data-design.md`](references/data-design.md)
3. **投入ツール生成**: 削除（FK 依存の逆順）→ 投入（依存順）→ 検証の構造で、冪等・決定論的に作る。詳細: [`references/seeding-tool.md`](references/seeding-tool.md)
4. **本番でないことの確認ゲート**: 厳守の制約 1 の確認を経てから投入する
5. **投入**: 現行テスト環境へ投入する（新側スキーマは存在しないため新側へは投入しない）
6. **検証**: FK 整合・必須項目・件数を検査し、カバレッジ（どのテーブルのどのパターンを含んだか）を報告する
7. **成果物記録**: `design.md` / `verification.md` / `metadata.json` を生成し、**投入ツールとデータをコミットする**（本番由来でなく PII を含まないため。大きなバイナリをコミットしない規約は視覚ベースラインの話でここには当てはまらない）

### フェーズ B（新側フェーズ・slug ごと）

1. **前提確認**: 対象 slug の新側スキーマ（`parity-replace` の実装）・`new.db.env_vars` 接続・`references.db_semantics` を確認し、無ければ停止する（`db_semantics` は整備を促す）。`.replace/dataset/metadata.json`（フェーズ A 完了）が無ければフェーズ A を先に実行するよう案内する
2. **写像設計**: 論理データ → 新側スキーマの写像を設計する（`db_semantics` の型マッピング・意味論差、`intentional_diffs.may_change` の型変換等を適用）。詳細: [`references/phase-b.md`](references/phase-b.md)
3. **投入**: 投入ツールに新側ターゲットを追加し、新側環境へ投入する
4. **検証**: 新側整合性＋現新一致を検査する。`db_semantics` で説明できる差は意図的差異として `verification.md` に記録し、**説明できない不一致は失敗として扱い修正する**。新規の意図的差異は `intentional_diffs.pending` へ追記しユーザー確認へ回す
5. **成果物記録**: `metadata.json` の `phase_b.<slug>` を更新する（`version` は上げない）

## 成果物

すべて対象プロジェクト側に置く。**スキーマの正本は本スキル**（テンプレート: [`assets/`](assets/)）。**投入ツールは対象プロジェクト側の成果物**であり、スキル本体に同梱する配布物ではない（位置づけの詳細: [`references/seeding-tool.md`](references/seeding-tool.md)）。

| 成果物 | 場所 | 内容・正本 |
|---|---|---|
| 投入ツール | `<dataset_tool_dir>`（既定 `seed/`） | 削除・投入・検証。冪等・決定論的・**コミットする** |
| データ設計 | `.replace/dataset/design.md` | 正本: [`assets/design-template.md`](assets/design-template.md) |
| 検証レポート | `.replace/dataset/verification.md` | 正本: [`assets/verification-template.md`](assets/verification-template.md) |
| メタデータ | `.replace/dataset/metadata.json` | 正本: [`assets/metadata-template.json`](assets/metadata-template.json) |

- `version` の運用（上げる条件・フェーズ B で不変・陳腐化検出）は [`references/versioning.md`](references/versioning.md) が正本

## 姉妹スキルとの連携

- **依存順**: `replace-strategy`（setup）→ **golden-dataset（フェーズ A）** → 各機能で〔`parity-suite` → `parity-replace` → **golden-dataset（フェーズ B）** → `parity-diff`（`parity-replace` と往復）〕
- **`parity-suite`**: フェーズ A 完了（＝`.replace/dataset/metadata.json` の存在）が前提。探索でシード不足を見つけると `gaps.md`「データ不足」で本スキルへ戻る。戻ると `version` が上がり、影響ベースラインを再取得する
- **`parity-replace`**: フェーズ B の前提となる新側スキーマを作る
- **`parity-diff` / `replace-strategy status`**: `metadata.json` の `version` で陳腐化を検出する（記録 < 現在なら再取得）
