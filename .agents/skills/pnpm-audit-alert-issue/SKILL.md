---
name: pnpm-audit-alert-issue
description: pnpm 11 と devEngines.packageManager の組み合わせで Dependabot が pnpm-lock.yaml を解析できず Dependabot alerts が出ない間、`pnpm audit --json` を一次情報として脆弱性 Issue を作る private skill。pnpm audit の結果を正規化し、`dependabot-alert-issue` の外部 audit findings mode に渡す。「pnpm audit から Issue」「pnpm の脆弱性を起票」「Dependabot #14794 回避」「pnpm-audit-alert-issue」で必ず使用する。
license: MIT
---

# PNPM Audit Alert Issue

pnpm 11 の multi-document `pnpm-lock.yaml` に Dependabot が未対応な間、`pnpm audit --json` を一次情報として脆弱性対応 Issue を作成する private skill。

この skill は `pnpm audit` の検出結果を、Issue 化に必要な文脈つきの外部 audit findings として整理する。
Issue のグルーピング・起票は配布 skill `dependabot-alert-issue` の外部 audit findings mode に委譲する。

## 前提

- **ツール**: `pnpm`, `node`, `gh`
- **対象**: pnpm を使うリポジトリ
- **前提スキル**: `dependabot-alert-issue`
- **禁止**: `pnpm audit --fix`, `pnpm.overrides` による暫定回避、`pnpm-lock.yaml` の手動編集

## 基本フロー

1. 対象 repo を確認する
   - 省略時は現在の repo
   - `package.json` の `packageManager` が `pnpm@...` であることを確認する
   - `pnpm-lock.yaml` が無ければ停止する
2. `pnpm audit --json` を実行する
   - audit は脆弱性検出時に non-zero exit になり得るため、終了コードだけで失敗扱いにしない
   - JSON が空、または parse 不能な場合だけ停止して原因を報告する
3. 同梱 script で外部 audit findings JSON に正規化する
4. 正規化結果を読み、findings が 0 件なら「検出なし」と報告して終了する
5. 各 package について `pnpm why <package>` を実行し、依存経路を補強情報として整理する
6. 正規化 JSON と `pnpm why` の結果を `dependabot-alert-issue` の外部 audit findings mode に渡す
7. 以降の重複確認・着手可否分類・Issue ドラフト作成・起票は `dependabot-alert-issue` に委譲する

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

- `status` が 0 でも findings がある可能性、`status` が non-zero でも JSON が正しく出ている可能性がある。必ず JSON の中身で判断する
- audit の終了コード（例: `audit_status=1`）は報告に残す。脆弱性検出による non-zero と、JSON 取得失敗を混同しない
- `tmpdir` は作業終了後に削除してよいが、ユーザーが確認したい場合はパスを伝える

## PNPM 補強手順

### 依存経路の確認

正規化 JSON の `findings[].package` を重複排除し、各 package について `pnpm why` を実行する。これは pnpm audit の結果に、pnpm 固有の依存経路コンテキストを付与するための手順であり、Issue の重複確認や分類は `dependabot-alert-issue` に任せる。

```bash
pnpm why <package>
```

確認すること:

- direct dependency か transitive dependency か
- transitive の場合、どの direct dependency が持ち込んでいるか
- 複数 advisory が同じ package / 同じ依存経路に集中しているか

`pnpm why` が sandbox や store DB の制約で失敗したら、同じコマンドを通常権限で再実行する。結果は findings の `dependency_paths` の確認・補足として扱う。

### transitive dependency の解決可否確認

transitive dependency は、親 range が patched version を許容していても `pnpm update <pkg>` で再解決されないことがある（lockfile 上で `pkg@x.y.z(peer@a.b.c)` の形を持つ peer-keyed transitive で顕著）。着手可否分類（`dependabot-alert-issue` 側の責務）を誤らせないよう、次を確認して `context_note` に記録する。

- 対象が peer-keyed か plain か
- 可能なら使い捨てで `pnpm update <package>` を試し、patched version に到達するか（到達しなければ完全再生成が必要になる可能性を記録する）

pnpm の transitive 更新特有の制約（peer-keyed は通常の update で再解決されない・完全再生成は無関係な依存も float させる・plain transitive でも `pnpm update` が in-range の無関係依存を巻き込み得る・最小差分が必要な場合の surgical hand-edit 手順）の詳細は `dependabot-alert-issue` の `references/pnpm-transitive-update.md` を参照する。

補強できる場合は、外部 audit findings JSON の各 finding に次の任意フィールドを追加してよい:

- `direct_dependencies`: 脆弱 package を持ち込む direct dependency 名の配列
- `why_summary`: `pnpm why` から分かる短い依存経路要約
- `context_note`: Dependabot #14794 回避など、pnpm audit を使う理由の短い補足

これらの補助フィールドは Issue 化の判断材料であり、最終的な重複確認・着手可否分類・本文作成は `dependabot-alert-issue` の責務とする。

## 正規化 JSON

出力は `dependabot-alert-issue` の「外部 audit findings 入力」と同じ形式:

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

- Dependabot 側の pnpm 11 対応は https://github.com/dependabot/dependabot-core/issues/14794 を追跡する
- #14794 が解消し Dependabot alerts が安定して生成されるようになったら、この private skill の利用をやめ、通常の `dependabot-alert-issue` に戻す
