---
name: pnpm-audit-alert-issue
description: pnpm 11 と devEngines.packageManager の組み合わせで Dependabot が pnpm-lock.yaml を解析できず Dependabot alerts が出ない間、`pnpm audit --json` を一次情報として脆弱性 Issue を作る private skill。pnpm audit の結果を正規化し、`dependabot-alert-issue` の外部 audit findings mode に渡す。「pnpm audit から Issue」「pnpm の脆弱性を起票」「dependabot-core#14794 回避」「pnpm-audit-alert-issue」で必ず使用する。
license: MIT
---

# PNPM Audit Alert Issue

pnpm 11 の複数ドキュメントの `pnpm-lock.yaml` に Dependabot が対応するまでの間、`pnpm audit --json` を元の情報として、脆弱性に対応する Issue を作る private skill。

このスキルは、`pnpm audit` の検出結果を、Issue にするのに要る情報を付けた外部 audit findings として整理する。
Issue のまとめ方と起票は、配布スキル `dependabot-alert-issue` の外部 audit findings mode に任せる。

## 前提

- ツール: `pnpm`、`node`、`gh`
- 対象: pnpm を使うリポジトリ
- 前提スキル: `dependabot-alert-issue`
- 禁止すること: `pnpm audit --fix`、`pnpm.overrides` による一時的な回避、`pnpm-lock.yaml` の変更。
  このスキルは起票までを行い、lockfile を変えない。解決するときの手段は、`dependabot-alert-issue` の `references/pnpm-transitive-update.md` に従う

## 基本フロー

1. 対象の repo を確かめる
   - 省略すると現在の repo を対象にする
   - `package.json` の `packageManager` が `pnpm@...` であることを確かめる
   - `pnpm-lock.yaml` が無ければ止まる
2. `pnpm audit --json` を実行する
   - audit は脆弱性を見つけると 0 以外で終わることがあるので、終了コードだけで失敗と判断しない
   - JSON が空か、解析できない場合だけ止まり、原因を報告する
3. 同梱のスクリプトで、外部 audit findings の JSON に正規化する
4. 正規化した結果を読み、findings が 0 件なら「検出なし」と報告して終える
5. `pnpm install --frozen-lockfile` で、node_modules を lockfile に合わせる。
   これは、後の `pnpm why` で依存のつながりを補うための前提である。今の version の判定は lockfile と `pnpm audit` で行い、`pnpm why` や `pnpm list` を根拠にしない
6. package ごとに `pnpm why <package>` を実行し、依存のつながりを補足の情報として整理する
7. 正規化した JSON と `pnpm why` の結果を、`dependabot-alert-issue` の外部 audit findings mode に渡す
8. その後の重複の確認、着手できるかの分類、Issue の下書き、起票は `dependabot-alert-issue` に任せる

## コマンド手順

```bash
tmpdir=$(mktemp -d)
audit_json="$tmpdir/pnpm-audit.json"
findings_json="$tmpdir/pnpm-audit-findings.json"

set +e
pnpm audit --json > "$audit_json"
status=$?
set -e

if [ ! -s "$audit_json" ]; then
  echo "pnpm audit produced no JSON output (exit: $status)" >&2
  exit 1
fi

node .agents/skills/pnpm-audit-alert-issue/scripts/normalize-pnpm-audit.js \
  "$audit_json" \
  "$findings_json"
```

- `status` が 0 でも findings があることがあり、`status` が 0 以外でも JSON が正しく出ていることがある。必ず JSON の中身で判断する
- audit の終了コード（例: `audit_status=1`）は報告に残す。脆弱性を見つけたことによる 0 以外の終了と、JSON を取得できなかったことを取り違えない
- `tmpdir` は作業を終えたら消してよい。ユーザーが中身を確かめたい場合は、パスを伝える

## PNPM 補強手順

### 依存のつながりの確認

正規化した JSON の `findings[].package` の重複を除き、package ごとに `pnpm why` を実行する。
これは、pnpm audit の結果に pnpm に固有の依存のつながりの情報を足すための手順である。Issue の重複の確認や分類は `dependabot-alert-issue` に任せる。

実行する前に、基本フローの手順 5 で node_modules を lockfile に合わせておく。
`pnpm why` と `pnpm list` は lockfile ではなく、node_modules に実際にインストールされたものを読む。そのため、合わせる前の出力は過去の解決の状態を示す（ブランチを作った直後は特にずれる）。
合わせた後も、使い道は依存のつながりを補うことに限る。今の version の判定は、lockfile と `pnpm audit` を根拠にする。
この取り決めは、`dependabot-alert-issue` の `references/pnpm-transitive-update.md`「判断の根拠は lockfile にする（今の状態も、更新の結果も）」で定義する。

```bash
pnpm install --frozen-lockfile   # まだなら先に実行する
pnpm why <package>
```

確かめることは次のとおりである。

- direct 依存か transitive 依存か
- transitive の場合、どの direct 依存が持ち込んでいるか
- 複数の advisory が、同じ package や同じ依存のつながりに集まっているか

`pnpm why` が sandbox や store DB の制約で失敗したら、同じコマンドを通常の権限で実行し直す。結果は、findings の `dependency_paths` の確認と補足に使う。

### transitive 依存を解決できるかの確認

transitive 依存は、親の range が patched version を許していても、`pnpm update <pkg>` で解決し直されないことがある。
lockfile で `pkg@x.y.z(peer@a.b.c)` の形を持つ peer-keyed transitive で、特によく起きる。
着手できるかの分類（`dependabot-alert-issue` が受け持つ）を誤らせないように、次のことを確かめて `context_note` に書く。

- 対象が peer-keyed か plain か
- できれば使い捨てのコピーで、バージョンを付けない `pnpm update <package> --depth Infinity --lockfile-only` を試し、patched version に届くか。
  届かなくても「作り直すしかない」とは書かない。`references/pnpm-transitive-update.md` の手段の優先順に従って判定する

pnpm の transitive 依存の更新に特有の制約と手段は、`dependabot-alert-issue` の `references/pnpm-transitive-update.md` にある。たとえば次の内容である。

- peer-keyed は、通常の update では解決し直されない
- lockfile を作り直すと、関係のない依存もまとめて上がる
- plain transitive でも、`pnpm update` が range の中にある関係のない依存を一緒に上げることがある
- 親を remove して同じ range で add し直すと、その下の依存だけを解決し直せる
- 最小の差分が要る場合に、lockfile を手で編集する手順
- 手段の優先順
- 今の状態の判定も更新の結果の判定も、node_modules から得た出力ではなく lockfile を根拠にすること

補える場合は、外部 audit findings の JSON の各 finding に、次の任意のフィールドを足してよい。

- `direct_dependencies`: 脆弱な package を持ち込む direct 依存の名前の配列
- `why_summary`: `pnpm why` から分かる、依存のつながりの短いまとめ（`pnpm install --frozen-lockfile` で node_modules を合わせた後に取る）
- `context_note`: Dependabot が依存グラフを読めない間の回避など、pnpm audit を使う理由の短い補足

これらの補助のフィールドは、Issue にするときの判断の材料である。最終的な重複の確認、着手できるかの分類、本文の作成は `dependabot-alert-issue` が受け持つ。

## 正規化 JSON

出力の形は、`dependabot-alert-issue` の「外部 audit findings 入力」と同じである。

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
      "manifest": "pnpm-lock.yaml",
      "scope": "unknown"
    }
  ]
}
```

## 注意

- Dependabot 側の対応は、<https://github.com/dependabot/dependabot-core/issues/15904> で追う。dependabot/dependabot-core#14794 は close されたが、依存グラフには devDependencies が載らないままである
- 依存グラフ（`gh api repos/<owner>/<repo>/dependency-graph/sbom`）に devDependencies（例: `vitest`）が載り、Dependabot alerts が安定して作られるようになったとする。
  そうなったら、この private skill を使うのをやめ、通常の `dependabot-alert-issue` に戻す
