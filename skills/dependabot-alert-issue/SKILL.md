---
name: dependabot-alert-issue
description: Dependabot alerts または外部 audit findings（例 pnpm audit の正規化 JSON）を確認し、解消 Issue を `gh` で作成するスキル。対象を「すぐ着手できるか」で分類し、着手可能なものは severity 毎、ブロック中のものは脆弱パッケージ＋解決バージョン毎にまとめる。既存 Issue/PR はスキップし、特定 alert の ignore/dismiss も設定できる。`pnpm.overrides` 等の品質が保証されない回避策は採らない。「Dependabot alerts から Issue」「pnpm audit の結果から Issue」「脆弱性対応の Issue」「dependabot-alert-issue」で必ず発動する。
argument-hint: "[--repo <owner>/<repo>] [--source <name> --input <findings.json>]"
license: MIT
---

# Dependabot Alert Issue

リポジトリの Dependabot alerts、または外部 audit findings を確認し、解消するための GitHub Issue を `gh` で作成する。起票した Issue への着手は姉妹スキル [[issue-start]] が担う。

脆弱性を機械的に 1 件 1 Issue にするのではなく、**「すぐ着手できるか」で分類してから severity・パッケージ単位でまとめる**。すぐ着手できないものは止めるのではなく、**着手可能になる条件を Issue に書き残す**ことで、後から見た人がそのまま動けるようにする。

## 使い方

```text
dependabot-alert-issue [--repo <owner>/<repo>] [--source <name> --input <findings.json>]
```

- `--repo <owner>/<repo>`: 対象リポジトリ（省略時は現在の repo。`gh repo view --json nameWithOwner -q .nameWithOwner`）。
- 入力ソース（既定）: `--source` / `--input` を渡さなければ対象リポジトリの **GitHub Dependabot alerts** を参照する。
- `--source <name> --input <findings.json>`: 渡したときだけ外部 audit findings JSON を入力にする（例: `--source pnpm-audit --input findings.json`。後述「外部 audit findings 入力」を満たす正規化済み JSON とする）。
- dismiss / ignore / リリース年齢などリポジトリ固有の設定は引数ではなく設定ファイルに書く（「セットアップ」参照）。
- Issue の**ドラフトをユーザーに見せ、承認を得てから**起票・dismiss する（意図とずれた起票・却下を避けるため）。

例: `dependabot-alert-issue` / `dependabot-alert-issue --repo <owner>/<repo>` / `Dependabot alerts から対応 Issue を作って`

- 自然文でも発動する:「Dependabot alerts から Issue」「pnpm audit の結果から Issue」「脆弱性対応の Issue」。

## 前提

- **ツール**: `gh`（GitHub CLI。`gh api` を含む）, `git`
- **前提スキル**: なし（起票後の着手は `issue-start` に引き継ぐが必須ではない）
- **MCP**: なし
- **シェル**: bash（POSIX 互換シェル）。コマンド例は bash 前提のため、Windows では WSL / Git Bash 等の bash 環境で実行する
- node / pnpm / python などのランタイムは不要。

## ブランチ運用・commit 規約の参照

Issue のタイトル規約（conventional commits 風の接頭辞など）はリポジトリごとに異なる。解決手順（設定ファイル → 標準ドキュメント探索 → ユーザー確認）と設定ファイル `.config/skills/shoji9x9/skills.yml` の扱いは [`references/conventions.md`](references/conventions.md) を参照する。

## セットアップ（特別処理・リリース年齢の設定）

「特定パッケージは未使用なので dismiss する」「この alert は無視する」といった**リポジトリ固有の特別処理は長文になり得る**ため、スキルの引数ではなく `.config/skills/shoji9x9/skills.yml` の `skills.dependabot-alert-issue.*` に書く。スキルは起動のたびにこの設定を読む。

```yaml
version: 1
skills:
  dependabot-alert-issue:
    # 解決バージョンが公開されてから着手するまでの最小経過日数（任意）。
    # pnpm の pnpm.minimumReleaseAge 等に相当する一般的な概念。
    # 設定したら、解決バージョンの公開からの経過がこれ未満の alert は「すぐ着手できない」に分類する。
    minimum_release_age_days: 3
    # 無視する alert（Issue を作らない・dismiss もしない）。自由記述で条件を書く。
    ignore:
      - "テストでしか使わない <pkg> の low は当面見送る"
    # dismiss する alert（Dismissal comment を付けて却下）。理由は GitHub の dismissed_reason に対応させる。
    # マッチ用キー（package / ecosystem / ghsa）を AND 条件で評価し、指定したキーが全て一致した alert だけを却下対象にする。
    dismiss:
      # 「特定 advisory 1 件だけ無関係」→ ghsa で限定（最も precise・推奨）
      - ghsa: "GHSA-xxxx-xxxx-xxxx"
        reason: "tolerable_risk"   # fix_started | inaccurate | no_bandwidth | not_used | tolerable_risk
        comment: "影響箇所を使っていないため許容する"
      # 「パッケージ自体が未使用」→ package（＋ecosystem で更に限定）
      - package: "<pkg>"
        ecosystem: "npm"           # 任意。同名異エコシステムの巻き込みを避けたいとき指定
        reason: "not_used"
        comment: "このパッケージは本番経路で利用していないため却下する"
```

- **作成・追記は非破壊**: ファイルが無ければ `.config/skills/shoji9x9/` ごと作成し、このスキルが使うキーだけを書く。既にあれば欠けたキーだけを該当セクション（無ければ親も）に追記し、既存のキー・値・コメントは変更しない。**既存値は尊重し上書きしない**。
- 設定が無くても動作する。`ignore` / `dismiss` 無し・`minimum_release_age_days` 無しとして全 open alert を Issue 化対象にする。

## 基本フロー

1. 対象リポジトリを確認する（省略時は現在の repo）。`--repo` 指定が現在の repo と異なる場合は、その旨を伝えてから対象を確定する
2. 入力モードを決める
   - GitHub alerts mode: open な Dependabot alerts を取得する（後述「gh メカニクス」。**ページネーション順守**）
   - 外部 audit findings mode: 指定された JSON ファイルを読み、後述「外部 audit findings 入力」に従って findings を検証する
3. 設定の特別処理を適用する
   - `ignore` に該当する脆弱性は対象から外す（Issue も dismiss もしない）
   - GitHub alerts mode で `dismiss` に該当する alert は **dismiss 候補**として分け、Issue 化対象から外す（実行は後述・ユーザー承認後）
   - 外部 audit findings mode では GitHub alert 番号が無いため dismiss は行わない。dismiss 設定に一致しても「dismiss 不可」として報告し、Issue 化対象からは外すかユーザーに確認する
4. **既に解消 Issue/PR がある脆弱性はスキップする**。open な Issue / PR を検索し（後述）、同じパッケージ・GHSA・解決バージョンを扱うものがあれば対象から外す（Dependabot の更新 PR を含む）
5. 残った脆弱性を **「すぐ着手できるか」で分類する**（後述「着手可否の判定」）
6. **グルーピングして Issue を組み立てる**（後述「グルーピング」）
7. **タイトル・本文をドラフトしてユーザーに提示する**
   - タイトルは規約の接頭辞 + **severity を含める**（例: `fix(deps): [critical] bump <pkg> to <ver> to resolve advisories`）
   - 本文は後述「Issue 本文の規約」に従う
   - dismiss 候補があれば、何を・なぜ dismiss するかも一覧で提示する
   - 承認を求める確認 UI 自体に判断材料（ドラフトの全文・dismiss 候補一覧）を同梱する。直前の通常テキストが確認ダイアログと同時に見えることを前提にしない（Claude Code の AskUserQuestion では選択肢の preview フィールドに入れる）
8. **ユーザーの承認を得てから**、Issue 起票（`gh issue create --body-file`）と dismiss（`gh api`）を実行する
9. 作成した Issue の URL、dismiss した alert（理由つき）、スキップした alert（理由つき）をサマリーで報告する

## 着手可否の判定

各脆弱性を「すぐ着手できる / できない」に分類する。**できない場合はその障害（着手可能条件）を記録する**。

「すぐ着手できない」と判定する主な条件:

- **解決バージョンが未公開**: GitHub alerts mode では `first_patched_version` が無い、外部 audit findings mode では `patched_versions` / `patched` が無い（修正版がまだ出ていない）
- **リリース年齢が足りない**: `minimum_release_age_days` が設定されており、解決バージョンの公開からの経過がそれ未満（公開日時はパッケージレジストリで確認する。取得できず判断不能なら「すぐ着手できない」扱いにして条件に明記）
- **依存バージョンが固定されている**: 親依存がバージョンを固定している transitive 依存などで、manifest を直接上げても解決できない
- **transitive dependency が patched へ到達するか未確認**: 親 range が patched version を許容していても、パッケージマネージャの実装によっては通常の更新操作で再解決されないことがある（pnpm の詳細は [`references/pnpm-transitive-update.md`](references/pnpm-transitive-update.md)）。
  **「親 range が許容している」だけで transitive を「すぐ着手できる」に分類しない**。実際に patched へ到達することを確認するか、確認できない場合は「lockfile 更新で無関係な依存も float する可能性がある」前提を Issue に明記してから分類する

**着手できない脆弱性は、障害を解消する既存 Issue を調査する。** 障害となっているパッケージ（修正版を出す上流、またはバージョンを固定している親）に、その障害を取り除く Issue/PR が既にある可能性がある。見つかればその **Issue/PR の URL を着手可能条件に記載**する（無ければ「未発見」と書く）。

外部 audit findings mode では、finding の `dependency_paths` / `direct_dependencies` / `why_summary` を使って direct dependency と transitive dependency を見分ける。補助情報が足りない場合は、入力元 skill（例: `pnpm-audit-alert-issue`）の調査結果を確認するか、必要なコマンドを実行してから分類する。

すぐ着手できる例:

- vulnerable package が direct dependency で、manifest の正規更新で patched version に上げられる
- transitive dependency が、実際に更新操作で patched version へ到達することを確認済み（親 range が許容しているだけでは不十分）

すぐ着手できない例:

- transitive dependency が direct dependency 側で固定されている
- direct dependency の最新版でも patched version に上がらない
- transitive dependency が親 range 上は許容されているが、実際に patched へ到達するか未確認
- 解消には既存 Issue の完了や上流リリース待ちが必要

## グルーピング

複数の脆弱性を 1 Issue にまとめる。**まず着手可否で分け**、それぞれ次の基準でまとめる。

### すぐ着手できない脆弱性

- **脆弱パッケージ × 解決バージョン**ごとに 1 Issue にまとめる
- その中で**最も高い severity** をタイトルに使う
- 本文に着手可能条件（障害・その解消 Issue の URL）を明記する

### すぐ着手できる脆弱性

- **パッケージごとに更新先バージョンを決める**: そのパッケージの「すぐ着手できる」全脆弱性を解消するバージョンを選ぶ（基本はパッチ済みバージョンのうち最新）。あわせてそのパッケージの**最も高い severity** を記録する
- 記録した **severity ごとに 1 Issue** にまとめる（例: critical の Issue・high の Issue …。1 Issue に同 severity の複数パッケージが入る）

## Issue 本文の規約

- GitHub alerts mode では **alert は `#N` で書かない**。`#1` のように書くと GitHub 上で Issue/PR とリンク誤認されるため、必ず **alert の URL** で参照する
- 外部 audit findings mode では alert URL が無いことがあるため、**GHSA URL / advisory URL / source** を参照として記載する。GitHub alert が無いのに alert URL を捏造しない
- 含める情報: 対象パッケージ・現状バージョン → 更新先バージョン・severity・該当 advisory（alert URL または GHSA/advisory URL）・影響範囲（`runtime` / `development` / `unknown`）。着手できない場合は**着手可能条件**（障害＋解消 Issue の URL）
- **品質が保証されない回避策は提案しない**。`pnpm.overrides` のような上書きでの強制解決は、保証外であり、かつこのスキルは pnpm 以外のエコシステムでも使われる。manifest の正規の更新で解決できないものは「すぐ着手できない」として着手可能条件を書く方針にする（特定パッケージマネージャ固有の回避策に依存しない）
- 実装の細部（具体的なコード片）を書きすぎない。実装はブランチ側（issue-start 以降）で扱う

## dismiss の扱い

GitHub alerts mode で設定 `dismiss` に該当する alert は、**ユーザー承認後に** Dismissal comment 付きで却下する。外部 audit findings mode では GitHub alert 番号が無いため dismiss API を呼ばない。

- **マッチは指定キーの AND 条件**。ルールに書かれたマッチ用キー（`package` / `ecosystem` / `ghsa`）が**すべて一致**した alert だけを却下対象にする。書いていないキーは条件にしない
  - **特定の脆弱性 1 件**を消したいときは `ghsa`（advisory ID）で指定する（最も precise）。**パッケージ自体が未使用**なら `package`（必要なら `ecosystem` も）で指定する
  - `package` のみの広いルールは、その同名パッケージに**将来出る別 alert（後日の critical 等）も却下対象になり得る**。意図せぬ巻き込みを避けるため、可能な限り `ghsa` か `package`＋`ecosystem` まで絞る
- `reason` は GitHub の `dismissed_reason`（`fix_started` / `inaccurate` / `no_bandwidth` / `not_used` / `tolerable_risk`）に対応させる。`comment` を Dismissal comment として渡す
- dismiss は Issue 起票と同様、ドラフト提示 → 承認 → 実行の順にする。勝手に却下しない
  - ドラフト提示時は、**各ルールが現在いくつの alert に該当するか**を列挙する。広い（`package` のみの）ルールが想定外の alert を巻き込んでいないかをユーザーが確認できるようにする

## 外部 audit findings 入力

Dependabot alerts が生成されない状況（例: pnpm 11 の multi-document lockfile を Dependabot が未対応）では、外部 audit findings を入力として Issue 化する。この mode でもグルーピング・着手可否判定・既存 Issue/PR スキップは GitHub alerts mode と同じ考え方で行う。

入力 JSON は次の形を期待する:

```json
{
  "source": "pnpm-audit",
  "generated_at": "2026-06-11T00:00:00.000Z",
  "findings": [
    {
      "package": "example",
      "ecosystem": "npm",
      "severity": "high",
      "ghsa": "GHSA-xxxx-xxxx-xxxx",
      "advisory_url": "https://github.com/advisories/GHSA-xxxx-xxxx-xxxx",
      "title": "Advisory title",
      "vulnerable_versions": "<1.2.3",
      "patched_versions": ">=1.2.3",
      "patched": "1.2.3",
      "current_versions": ["1.0.0"],
      "dependency_paths": ["project>example"],
      "direct_dependencies": ["parent-package"],
      "why_summary": "parent-package > example",
      "context_note": "Dependabot pnpm 11 support is pending",
      "manifest": "pnpm-lock.yaml",
      "scope": "unknown"
    }
  ]
}
```

- 必須フィールド: `source`, `findings[]`, `package`, `severity`
- 強く推奨: `ghsa` または `advisory_url`, `patched_versions` または `patched`
- `scope` は `runtime` / `development` / `unknown` のいずれか。判定できなければ `unknown` とする
- `patched_versions` が範囲表現で具体的な単一バージョンに変換できない場合、`patched` は空でよい。その場合は「解決バージョン要確認」または「すぐ着手できない」に分類する
- 同じ `package + ghsa` の finding が複数ある場合は統合し、`current_versions` / `dependency_paths` を重複排除して本文にまとめる
- `direct_dependencies`, `why_summary`, `context_note` は任意。入力元 skill が依存経路や背景を補強できる場合に使う

外部 audit findings mode の Issue 本文には、次を必ず含める:

- source（例: `pnpm audit`）と生成日時
- GHSA/advisory URL（無い場合は advisory title と package）
- vulnerable range / patched range / 現在検出された version
- dependency path / direct dependency / why summary（ある場合）
- GitHub Dependabot alert が存在しない理由が分かっている場合は補足（例: Dependabot の pnpm 11 未対応）

## gh メカニクス

### open alert の取得（全件・ページネーション順守）

```bash
gh api --paginate \
  "/repos/<owner>/<repo>/dependabot/alerts?state=open&per_page=100" \
  --jq '.[] | {number, url: .html_url, severity: .security_advisory.severity,
    ghsa: .security_advisory.ghsa_id, pkg: .security_vulnerability.package.name,
    ecosystem: .security_vulnerability.package.ecosystem,
    scope: .dependency.scope, manifest: .dependency.manifest_path,
    patched: .security_vulnerability.first_patched_version.identifier}'
```

- `per_page=100` ＋ `--paginate` で全ページを辿る。既定の 30 件で暗黙に打ち切らない（一覧取得は指定件数で暗黙に打ち切らず、必要範囲をすべてページネーションで辿る）。
- `dependency.scope` は `runtime` / `development`。`first_patched_version` が `null` なら修正版未公開。
- **取得が 403 / 404 で失敗する場合**は、Issue 化を進めず原因を切り分けてユーザーに提示し停止する:
  - **403**: Dependabot alerts が無効、または token に必要権限が無い。リポジトリ設定（Settings → Code security）で Dependabot alerts を有効化するか、`security_events` スコープを持つ token で再認証する（例: `gh auth refresh -s security_events`）よう案内する
  - **404**: リポジトリ名の誤り、または alerts を参照できる権限（admin / security manager）が無い。owner/repo と権限を確認するよう案内する
  - エラー本文（`gh api ... 2>&1`）をそのまま見せ、推測で空一覧として進めない（alert ゼロと取得失敗を取り違えない）

### 既存の解消 Issue / PR の検索（スキップ判定）

`gh issue list` / `gh pr list` には `--paginate` が無く、**件数が `--limit` の既定（30）を超えると取りこぼす**ため、`--limit` を十分大きく取る（既定 30 で暗黙に打ち切らない）。

```bash
gh issue list --repo <owner>/<repo> --state open --limit 200 --json number,title,url
gh pr list    --repo <owner>/<repo> --state open --limit 200 --json number,title,headRefName,url
```

- 同じパッケージ・GHSA・解決バージョンを扱う Issue/PR（Dependabot の更新 PR を含む）があればスキップする。
- 外部 audit findings mode で GHSA が無い場合は、パッケージ・advisory title・patched range の組み合わせで判断する。
- `direct_dependencies` がある場合は、それを扱う既存 Issue も関連 Issue として確認する。
  例: 脆弱 transitive dependency を持ち込む direct dependency の置き換え Issue。
- open 件数が `--limit` を超えうるリポジトリではさらに大きい値にし、取りこぼしで重複起票しないようにする。

### Issue の作成（多行本文は body-file）

```bash
tmp=$(mktemp)
printf '%s' "<本文>" > "$tmp"
gh issue create --repo <owner>/<repo> --title "<severity を含むタイトル>" --body-file "$tmp" --label "<ラベル>"
rm -f "$tmp"
```

- `--body` に長文を直接入れると改行・特殊文字で崩れるため `--body-file` を使う。

### alert の dismiss

```bash
gh api --method PATCH "/repos/<owner>/<repo>/dependabot/alerts/<number>" \
  -f state=dismissed \
  -f dismissed_reason="<not_used 等>" \
  -f dismissed_comment="<Dismissal comment>"
```

## 追加確認が必要な条件

以下のときは処理を止めてユーザーに確認する。

- 対象リポジトリが現在の repo と異なる可能性がある
- `dismiss` 候補の妥当性（本当に未使用か等）が設定だけでは確信できない
- 着手可否（解決バージョンの公開・リリース年齢・依存固定の有無）が判断できない
- グルーピングや更新先バージョンの選定に設計判断が絡む
