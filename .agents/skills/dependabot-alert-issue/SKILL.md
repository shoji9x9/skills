---
argument-hint: '[--repo <owner>/<repo>] [--source <name> --input <findings.json>]'
description: Dependabot alerts または外部 audit findings（例 pnpm audit の正規化 JSON）を確認し、解消 Issue を `gh` で作成するスキル。対象を「すぐ着手できるか」で分類し、着手可能なものは severity 毎、ブロック中のものは脆弱パッケージ＋解決バージョン毎にまとめる。既存 Issue/PR はスキップし、特定 alert の ignore/dismiss も設定できる。`pnpm.overrides` 等の品質が保証されない回避策は採らない。「Dependabot alerts から Issue」「pnpm audit の結果から Issue」「脆弱性対応の Issue」「dependabot-alert-issue」で必ず発動する。
license: MIT
name: dependabot-alert-issue
---
# Dependabot Alert Issue

リポジトリの Dependabot alerts か外部 audit findings を確認し、脆弱性を解消するための GitHub Issue を `gh` で作る。起票した Issue への着手は姉妹スキル [[issue-start]] が担う。

脆弱性を 1 件ずつ Issue にするのではなく、まず「すぐ着手できるか」で分類し、そのうえで severity やパッケージの単位でまとめる。
すぐ着手できないものも止めずに、着手できるようになる条件を Issue に書き残す。後から読んだ人が、その条件を見て動けるようにするためである。

## 使い方

```text
dependabot-alert-issue [--repo <owner>/<repo>] [--source <name> --input <findings.json>]
```

- `--repo <owner>/<repo>`: 対象のリポジトリ。省略すると現在の repo（`gh repo view --json nameWithOwner -q .nameWithOwner`）を対象にする。
- 入力ソースのデフォルト: `--source` と `--input` を渡さなければ、対象リポジトリの GitHub Dependabot alerts を読む。
- `--source <name> --input <findings.json>`: 渡したときだけ、外部 audit findings の JSON を入力にする（例: `--source pnpm-audit --input findings.json`）。
  JSON は、後述の「外部 audit findings 入力」を満たす正規化済みの形にする。
- dismiss・ignore・リリース年齢のようなリポジトリ固有の設定は、引数ではなく設定ファイルに書く（「セットアップ」を参照）。
- Issue の下書きをユーザーに見せ、承認を得てから起票と dismiss を行う。意図とずれた起票や却下を避けるためである。

例: `dependabot-alert-issue` / `dependabot-alert-issue --repo <owner>/<repo>` / `Dependabot alerts から対応 Issue を作って`

- 自然文でも起動する（「Dependabot alerts から Issue」「pnpm audit の結果から Issue」「脆弱性対応の Issue」）。

## 前提

- ツール: `gh`（GitHub CLI。`gh api` を含む）、`git`
- 前提スキル: なし（起票後の着手は `issue-start` に引き継ぐが、必須ではない）
- MCP: なし
- シェル: bash（POSIX 互換のシェル）。コマンド例は bash を前提にしているので、Windows では WSL や Git Bash などの bash の環境で実行する
- node・pnpm・python などのランタイムは要らない。

## ブランチ運用・commit 規約の参照

Issue のタイトルの規約（conventional commits に似た接頭辞など）は、リポジトリごとに異なる。
解決の手順（設定ファイル、標準のドキュメントの探索、ユーザーへの確認の順）と、設定ファイル `.config/skills/shoji9x9/skills.yml` の扱いは [`references/conventions.md`](references/conventions.md) にある。

## セットアップ（特別処理・リリース年齢の設定）

「このパッケージは使っていないので dismiss する」「この alert は無視する」のようなリポジトリ固有の特別処理は、長い文になることがある。
そのため、スキルの引数ではなく `.config/skills/shoji9x9/skills.yml` の `skills.dependabot-alert-issue.*` に書く。スキルは起動するたびにこの設定を読む。

```yaml
version: 1
skills:
  dependabot-alert-issue:
    # 解決バージョンが公開されてから着手するまでの最小の経過日数（任意）。
    # pnpm の pnpm.minimumReleaseAge などに当たる一般的な考え方。
    # 設定すると、解決バージョンの公開からの経過がこれより短い alert を「すぐ着手できない」に分類する。
    minimum_release_age_days: 3
    # 無視する alert（Issue を作らず、dismiss もしない）。条件を自由に書く。
    ignore:
      - "テストでしか使わない <pkg> の low は見送る"
    # dismiss する alert（Dismissal comment を付けて却下する）。理由は GitHub の dismissed_reason に合わせる。
    # 照合に使うキー（package / ecosystem / ghsa）は AND で評価し、書いたキーがすべて一致した alert だけを却下の対象にする。
    dismiss:
      # 特定の advisory 1 件だけが無関係なら、ghsa で絞る（もっとも狭い。推奨）
      - ghsa: "GHSA-xxxx-xxxx-xxxx"
        reason: "tolerable_risk"   # fix_started | inaccurate | no_bandwidth | not_used | tolerable_risk
        comment: "影響箇所を使っていないため許容する"
      # パッケージそのものを使っていないなら、package で指定する（ecosystem でさらに絞れる）
      - package: "<pkg>"
        ecosystem: "npm"           # 任意。別のエコシステムにある同名のパッケージを巻き込みたくないときに指定する
        reason: "not_used"
        comment: "このパッケージは本番の処理で使っていないため却下する"
```

- 作成と追記では、既にある内容を変えない。ファイルが無ければ `.config/skills/shoji9x9/` ごと作り、このスキルが使うキーだけを書く。
  ファイルがあれば、欠けているキーだけを該当するセクション（無ければ親も）に足す。既にあるキー・値・コメントは変えず、上書きしない。
- 設定が無くても動く。そのときは `ignore`・`dismiss`・`minimum_release_age_days` が無いものとして、open な alert をすべて Issue にする対象にする。

## 基本フロー

1. 対象のリポジトリを確かめる（省略すると現在の repo）。`--repo` が現在の repo と違うときは、そのことを伝えてから対象を決める
2. 入力のモードを決める
   - GitHub alerts mode: open な Dependabot alerts を取得する（後述「gh メカニクス」。ページネーションを処理する）
   - 外部 audit findings mode: 指定された JSON ファイルを読み、後述「外部 audit findings 入力」に従って findings を確かめる
3. 設定の特別処理を当てる
   - `ignore` に当たる脆弱性は対象から外す（Issue も dismiss もしない）
   - GitHub alerts mode で `dismiss` に当たる alert は dismiss の候補として分け、Issue にする対象から外す（実行はユーザーの承認の後。後述）
   - 外部 audit findings mode には GitHub の alert 番号が無いので、dismiss はしない。
     dismiss の設定に一致しても「dismiss できない」と報告し、Issue にする対象から外すかをユーザーに確認する
4. 既に解消の Issue・PR がある脆弱性は飛ばす。open な Issue と PR を検索し（後述）、同じパッケージ・GHSA・解決バージョンを扱うものがあれば対象から外す（Dependabot の更新 PR を含む）
5. 残った脆弱性を「すぐ着手できるか」で分類する（後述「着手可否の判定」）
6. まとめ方を決めて Issue を組み立てる（後述「グルーピング」）
7. タイトルと本文の下書きを作り、ユーザーに見せる
   - タイトルは規約の接頭辞に、severity を含める（例: `fix(deps): [critical] bump <pkg> to <ver> to resolve advisories`）
   - 本文は後述「Issue 本文の規約」に従う
   - dismiss の候補があれば、何をなぜ dismiss するかも一覧で見せる
   - 承認を求める確認の画面そのものに、判断に要るもの（下書きの全文と dismiss の候補の一覧）を入れる。
     その直前の通常のテキストが確認のダイアログと同時に見えるとは限らないからである（Claude Code の AskUserQuestion では、選択肢の preview フィールドに入れる）
8. ユーザーの承認を得てから、Issue の起票（`gh issue create --body-file`）と dismiss（`gh api`）を実行する
9. 作った Issue の URL、dismiss した alert とその理由、飛ばした alert とその理由をまとめて報告する

## 着手可否の判定

脆弱性ごとに「すぐ着手できる」か「すぐ着手できない」かを分類する。すぐ着手できない場合は、妨げになっているもの（着手できるようになる条件）を記録する。

「すぐ着手できない」と判定するのは、主に次の場合である。

- 解決バージョンが公開されていない。GitHub alerts mode では `first_patched_version` が無く、外部 audit findings mode では `patched_versions` も `patched` も無い（修正版がまだ出ていない）
- リリース年齢が足りない。`minimum_release_age_days` が設定されていて、解決バージョンの公開からの経過がそれより短い。
  公開日時はパッケージのレジストリで確かめる。取得できずに判断できないときは「すぐ着手できない」とし、その条件を明記する
- 依存のバージョンが固定されている。親の依存がバージョンを固定している transitive 依存などで、manifest を直接上げても解決できない
- transitive 依存が patched version に届くかを確かめていない。親の range が patched version を許していても、パッケージマネージャの実装によっては、通常の更新の操作で解決し直されないことがある（pnpm の詳細は [`references/pnpm-transitive-update.md`](references/pnpm-transitive-update.md)）。
  親の range が許していることだけを理由に、transitive 依存を「すぐ着手できる」に分類しない。
  実際に patched version に届くことを確かめるか、確かめられないなら「lockfile の更新で関係のない依存の版も上がりうる」ことを Issue に書いてから分類する

すぐ着手できない脆弱性については、妨げを解消する既存の Issue を調べる。
妨げになっているパッケージ（修正版を出す上流、またはバージョンを固定している親）に、それを取り除く Issue・PR が既にあることがある。
見つかれば、その Issue・PR の URL を着手できるようになる条件に書く（無ければ「見つからない」と書く）。

外部 audit findings mode では、finding の `dependency_paths`・`direct_dependencies`・`why_summary` を使って、direct 依存か transitive 依存かを見分ける。
補足の情報が足りないときは、入力元のスキルの調査結果を確かめるか、必要なコマンドを実行してから分類する。

すぐ着手できる例は次のとおりである。

- 脆弱なパッケージが direct 依存で、manifest を通常どおり更新すれば patched version に上げられる
- transitive 依存が、実際に更新の操作で patched version に届くことを確かめてある（親の range が許しているだけでは足りない）

すぐ着手できない例は次のとおりである。

- transitive 依存が、direct 依存の側で固定されている
- direct 依存を最新版にしても、patched version に上がらない
- transitive 依存が、親の range の上では許されているが、実際に patched version に届くかを確かめていない
- 解消には、既存の Issue の完了や上流のリリースを待つ必要がある

## グルーピング

複数の脆弱性を 1 つの Issue にまとめる。まず着手できるかどうかで分け、それぞれ次の基準でまとめる。

### すぐ着手できない脆弱性

- 脆弱なパッケージと解決バージョンの組ごとに、1 つの Issue にまとめる
- その中でもっとも高い severity をタイトルに使う
- 本文に、着手できるようになる条件（妨げと、それを解消する Issue の URL）を書く

### すぐ着手できる脆弱性

- パッケージごとに更新先のバージョンを決める。そのパッケージの「すぐ着手できる」脆弱性をすべて解消するバージョンを選ぶ（基本は patched version のうち最新のもの）。
  あわせて、そのパッケージのもっとも高い severity を記録する
- 記録した severity ごとに、1 つの Issue にまとめる（例: critical の Issue、high の Issue。1 つの Issue に同じ severity の複数のパッケージが入る）

## Issue 本文の規約

- GitHub alerts mode では、alert を `#N` で書かない。`#1` のように書くと、GitHub が Issue や PR へのリンクとして扱う。alert は必ず URL で参照する
- 外部 audit findings mode では alert の URL が無いことがあるので、GHSA の URL・advisory の URL・source を参照として書く。GitHub の alert が無いのに、alert の URL を作って書かない
- 書く情報は、対象のパッケージ、今のバージョンと更新先のバージョン、severity、該当する advisory（alert の URL か GHSA・advisory の URL）、影響範囲（`runtime` / `development` / `unknown`）である。
  すぐ着手できない場合は、着手できるようになる条件（妨げと、それを解消する Issue の URL）も書く
- 品質が保証されない回避策は提案しない。`pnpm.overrides` のような上書きで解決を強制するのは保証の外で、しかもこのスキルは pnpm 以外のエコシステムでも使われる。
  manifest の通常の更新で解決できないものは「すぐ着手できない」とし、着手できるようになる条件を書く（特定のパッケージマネージャに固有の回避策に頼らない）
- 実装の細部（具体的なコード片）を書きすぎない。実装はブランチの側（issue-start 以降）で扱う

## dismiss の扱い

GitHub alerts mode で設定の `dismiss` に当たる alert は、ユーザーの承認の後に Dismissal comment を付けて却下する。外部 audit findings mode には GitHub の alert 番号が無いので、dismiss の API を呼ばない。

- 照合は、書いたキーの AND で行う。ルールに書いた照合用のキー（`package` / `ecosystem` / `ghsa`）がすべて一致した alert だけを却下の対象にする。書いていないキーは条件にしない
  - 特定の脆弱性 1 件を消したいときは、`ghsa`（advisory の ID）で指定する（もっとも狭い）。パッケージそのものを使っていないなら、`package`（必要なら `ecosystem` も）で指定する
  - `package` だけの広いルールでは、同じ名前のパッケージに後から出る別の alert（後日の critical など）も却下の対象になりうる。意図しない巻き込みを避けるため、できるだけ `ghsa` か、`package` と `ecosystem` の組まで絞る
- `reason` は GitHub の `dismissed_reason`（`fix_started` / `inaccurate` / `no_bandwidth` / `not_used` / `tolerable_risk`）に合わせる。`comment` を Dismissal comment として渡す
- dismiss も Issue の起票と同じく、下書きを見せ、承認を得てから実行する。承認なしに却下しない
  - 下書きを見せるときは、ルールごとに今いくつの alert が当たるかを挙げる。`package` だけの広いルールが想定外の alert を巻き込んでいないかを、ユーザーが確かめられるようにする

## 外部 audit findings 入力

Dependabot alerts が作られない状況（例: pnpm 11 の複数ドキュメントの lockfile に Dependabot が対応していない）では、外部 audit findings を入力にして Issue を作る。
このモードでも、グルーピング・着手可否の判定・既存の Issue と PR を飛ばす処理は、GitHub alerts mode と同じ考え方で行う。

入力の JSON は次の形にする。

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

- 必須のフィールドは `source`・`findings[]`・`package`・`severity` である
- `ghsa` か `advisory_url` のどちらか、`patched_versions` か `patched` のどちらかを、できるだけ入れる
- `scope` は `runtime` / `development` / `unknown` のどれかにする。判定できなければ `unknown` にする
- `patched_versions` が範囲の表現で、1 つの具体的なバージョンに変えられない場合は、`patched` を空にしてよい。そのときは「解決バージョンの確認が要る」か「すぐ着手できない」に分類する
- 同じ `package` と `ghsa` の組の finding が複数あればまとめ、`current_versions` と `dependency_paths` の重複を除いて本文に書く
- `direct_dependencies`・`why_summary`・`context_note` は任意である。入力元のスキルが、依存のつながりや背景の情報を足せる場合に使う

外部 audit findings mode の Issue 本文には、次のものを必ず書く。

- source（例: `pnpm audit`）と、作成した日時
- GHSA・advisory の URL（無ければ advisory の title と package）
- 脆弱な範囲、patched の範囲、今検出されている version
- dependency path・direct dependency・why summary（ある場合）
- GitHub の Dependabot alert が無い理由が分かっていれば、その補足（例: Dependabot が pnpm 11 に対応していない）

## gh メカニクス

### open な alert の取得（全件。ページネーションを処理する）

```bash
gh api --paginate \
  "/repos/<owner>/<repo>/dependabot/alerts?state=open&per_page=100" \
  --jq '.[] | {number, url: .html_url, severity: .security_advisory.severity,
    ghsa: .security_advisory.ghsa_id, pkg: .security_vulnerability.package.name,
    ecosystem: .security_vulnerability.package.ecosystem,
    scope: .dependency.scope, manifest: .dependency.manifest_path,
    patched: .security_vulnerability.first_patched_version.identifier}'
```

- `per_page=100` と `--paginate` で、すべてのページを取得する。デフォルトの 30 件で打ち切らず、必要な範囲をすべてページネーションで取得する。
- `dependency.scope` は `runtime` か `development` である。`first_patched_version` が `null` なら、修正版は公開されていない。
- 取得が 403 や 404 で失敗したときは、Issue を作らずに原因を切り分け、ユーザーに見せて止まる。
  - 403 の場合は、Dependabot alerts が無効か、token に要る権限が無い。
    リポジトリの設定（Settings → Code security）で Dependabot alerts を有効にするか、`security_events` スコープを持つ token で認証し直す（例: `gh auth refresh -s security_events`）ように案内する
  - 404 の場合は、リポジトリ名が誤っているか、alerts を読める権限（admin・security manager）が無い。owner/repo と権限を確かめるように案内する
  - エラーの本文（`gh api ... 2>&1`）をそのまま見せる。推測で空の一覧として進めない（alert が 0 件であることと、取得に失敗したことを取り違えない）

### 既存の解消 Issue・PR の検索（飛ばすかの判定）

`gh issue list` と `gh pr list` には `--paginate` が無い。件数が `--limit` のデフォルト（30）を超えると取得できない分が出るので、`--limit` を十分大きくする（デフォルトの 30 で打ち切らない）。

```bash
gh issue list --repo <owner>/<repo> --state open --limit 200 --json number,title,url
gh pr list    --repo <owner>/<repo> --state open --limit 200 --json number,title,headRefName,url
```

- 同じパッケージ・GHSA・解決バージョンを扱う Issue・PR（Dependabot の更新 PR を含む）があれば飛ばす。
- 外部 audit findings mode で GHSA が無い場合は、パッケージ・advisory の title・patched の範囲の組で判断する。
- `direct_dependencies` があれば、それを扱う既存の Issue も関連する Issue として確かめる。
  例は、脆弱な transitive 依存を持ち込む direct 依存を置き換える Issue である。
- open の件数が `--limit` を超えうるリポジトリでは、値をさらに大きくする。取得できない分が出て、重複して起票するのを防ぐためである。

### Issue の作成（複数行の本文は body-file で渡す）

```bash
tmp=$(mktemp)
# 本文はバッククォートや $ を含みうるので、二重引用符ではなく quoted heredoc で書く
cat > "$tmp" <<'EOF'
<本文>
EOF
gh issue create --repo <owner>/<repo> --title "<severity を含むタイトル>" --body-file "$tmp" --label "<ラベル>"
rc=$?
rm -f "$tmp"
(exit "$rc")  # gh の失敗を、後片付けの終了コードで隠さない
```

- `--body` に長い文を直接入れると、改行や特殊文字が正しく渡らない。そのため `--body-file` を使う。

### alert の dismiss

```bash
gh api --method PATCH "/repos/<owner>/<repo>/dependabot/alerts/<number>" \
  -f state=dismissed \
  -f dismissed_reason="<not_used 等>" \
  -f dismissed_comment="<Dismissal comment>"
```

## 追加確認が必要な条件

次のときは処理を止めて、ユーザーに確認する。

- 対象のリポジトリが、現在の repo と違う可能性がある
- `dismiss` の候補が妥当か（本当に使っていないかなど）を、設定だけでは確信できない
- 着手できるか（解決バージョンの公開・リリース年齢・依存の固定の有無）を判断できない
- グルーピングや更新先のバージョンの選び方に、設計の判断が絡む
