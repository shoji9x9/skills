---
name: pnpm-audit-alert-issue
description: Dependabot alerts と `pnpm audit` が同じ advisory を挙げるかを確かめる間、`pnpm audit --json` の結果を正規化して Dependabot alerts と比べ、open の alert にも却下された alert にも無い advisory だけを `dependabot-alert-issue` の外部 audit findings mode に渡して脆弱性 Issue を作る private skill。比べた結果は、この private skill をやめる条件の判定に使う。「pnpm audit から Issue」「pnpm の脆弱性を起票」「pnpm audit と Dependabot alerts を比べて」「pnpm-audit-alert-issue」で必ず使用する。
license: MIT
---

# PNPM Audit Alert Issue

`pnpm audit --json` の結果を Dependabot alerts と比べ、open の alert にも却下された alert にも無い advisory の Issue を作る private skill。
Dependabot alerts と `pnpm audit` が同じ advisory を挙げることを確かめるまで、配布スキル `dependabot-alert-issue` の Dependabot alerts を読むモードと並べて使う。
並べて使う理由・起票の順・やめる条件は、`docs/vulnerability-handling.md`「脆弱性の確認と起票」で定義する。ここへ転記しない。読めないときは、起票に進まずに止まる。

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
4. `dependabot-alert-issue` を Dependabot alerts を読むモードで実行したかを、同じ作業の中の記録か利用者への確認で確かめる。実行していなければ、先にそちらで起票する。
   findings の件数に関わらず、これを確かめる。
   open の alert の Issue はそのモードだけが作るので、この順にすると、同じ advisory の Issue を二重に作らない（`docs/vulnerability-handling.md`「脆弱性の確認と起票」）。
   そのモードが alert を却下した後に、次の手順で alerts を取得する。
5. Dependabot alerts を状態を絞らずに取得し、正規化した findings と比べる（後述「Dependabot alerts との比較」）。
   比べた結果は、findings の件数に関わらず最後の報告に添える
6. findings から、GHSA とパッケージの組が open の alert と同じものと、却下された alert（`dismissed`・`auto_dismissed`）と同じものを除く。
   open の alert の Issue は、`dependabot-alert-issue` の Dependabot alerts を読むモードが作る。却下された alert は、人と GitHub の自動トリアージの判断に従って起票しない（`docs/vulnerability-handling.md`「起票の対象にする alert の状態」）。
   残りが 0 件なら「起票する findings なし」と報告して終える（手順 5 の比較の結果と、手順 11 の一覧は添える）
7. `pnpm install --frozen-lockfile` で、node_modules を lockfile に合わせる。
   これは、後の `pnpm why` で依存のつながりを補うための前提である。今の version の判定は lockfile と `pnpm audit` で行い、`pnpm why` や `pnpm list` を根拠にしない
8. package ごとに `pnpm why <package>` を実行し、依存のつながりを補足の情報として整理する
9. 手順 6 で残した findings と `pnpm why` の結果を、`dependabot-alert-issue` の外部 audit findings mode に渡す
10. その後の重複の確認、着手できるかの分類、Issue の下書き、起票は `dependabot-alert-issue` に任せる
11. findings の件数に関わらず、無視している GHSA の一覧と件数を、最後の報告に添える。
    一覧は `pnpm-workspace.yaml` の `auditConfig.ignoreGhsas` から読む。`pnpm audit --json` の出力と正規化した JSON には、無視した advisory が含まれない
12. 手順 5 の比べた結果を、記録する Issue にコメントする（後述「比べた結果の記録」）。
    findings の件数に関わらず、これを行う。手順 6 で終える場合も、手順 11 の後に行う

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

node .agents/skills/pnpm-audit-alert-issue/scripts/normalize-pnpm-audit.ts \
  "$audit_json" \
  "$findings_json"
```

- `status` が 0 でも findings があることがあり、`status` が 0 以外でも JSON が正しく出ていることがある。必ず JSON の中身で判断する
- audit の終了コード（例: `audit_status=1`）は報告に残す。脆弱性を見つけたことによる 0 以外の終了と、JSON を取得できなかったことを取り違えない
- `tmpdir` は作業を終えたら消してよい。ユーザーが中身を確かめたい場合は、パスを伝える

## Dependabot alerts との比較

基本フローの手順 5 と 6 で、正規化した findings を Dependabot alerts と比べ、起票に渡す findings を残す。
比べる 2 つの集合と一致の定義は、`docs/vulnerability-handling.md`「private skill をやめる条件」で定義する。ここへ転記しない。
無視している GHSA は、pnpm が実際に読んだ一覧（`pnpm config get audit --json` の `ignore`）から同じ呼び出しの中で取得する。手で書き写さない。

```bash
alerts_tsv="$tmpdir/dependabot-alerts.tsv"
ignored_json="$tmpdir/pnpm-audit-ignored.json"
to_file_json="$tmpdir/pnpm-audit-findings-to-file.json"

# state を付けずに取得すると、すべての状態の alert が返る。
# pnpm audit が読むのはルートの pnpm-lock.yaml だけなので、ほかの manifest（eval の fixture の package.json など）の alert は除く
if ! gh api --paginate "/repos/<owner>/<repo>/dependabot/alerts?per_page=100" \
  --jq '.[] | select(.dependency.manifest_path == "pnpm-lock.yaml")
    | [.state, .security_advisory.ghsa_id, .security_vulnerability.package.name] | @tsv' \
  > "$alerts_tsv"; then
  echo "failed to fetch Dependabot alerts; stop without comparing" >&2
  exit 1
fi

# 一覧が空のときやキーが無いとき、pnpm は空の出力か null を返す
if ! pnpm config get audit --json </dev/null > "$ignored_json"; then
  echo "failed to read pnpm audit config; stop without comparing" >&2
  exit 1
fi

node .agents/skills/pnpm-audit-alert-issue/scripts/compare-dependabot-alerts.ts \
  "$findings_json" "$alerts_tsv" "$ignored_json" "$to_file_json" \
  > "$tmpdir/compare-summary.json"
cat "$tmpdir/compare-summary.json"
```

- alerts の取得が 403 や 404 で失敗したら、比べずに止まる。取得に失敗したことを、alert が 0 件として扱わない（原因の切り分けは `dependabot-alert-issue` の「gh メカニクス」に従う）
- `pnpm config get audit` が失敗したときも、比べずに止まる。無視の一覧を 0 件として比べると、却下した alert が `only_in_alerts` に出る
- 比べた結果は、組の一覧（`matched`・`matched_ignored`・`only_in_audit`・`only_in_alerts`・`skipped_dismissed`・`without_ghsa`）と、`ignored_without_alert` と、`findings_to_file` である。
  `ignored_without_alert` は alert の無い無視の GHSA で、`findings_to_file` は起票に渡す件数である。
  GHSA は GitHub の表記（接頭辞だけ大文字）で出す。終了コードは、比べられたら 0、入力を読めなければ 1、引数の誤りは 2 になる
- `ghsa` の無い finding は、alerts と比べられないので `without_ghsa` に 1 件ずつ出て、起票に渡す側に残る。報告では、GHSA が無くて比べられなかったと書く
- `skipped_dismissed` は、却下された alert（`dismissed`・`auto_dismissed`）と同じ組の finding で、組に一致した alert の状態（`state`）を付けて出す。起票に渡さない。`matched` にも数える。
  報告では、却下された alert なので起票しなかったと、状態とともに書く。`fixed` の alert の組は、起票に渡す
- 無視している GHSA の advisory は `pnpm audit` に出ないので、alert と組になっても `matched` に数えず、`matched_ignored` に出す。`fixed` でない alert が無いものは、`ignored_without_alert` に出す。どちらも片方にしか無い組にしない
- `only_in_audit` か `only_in_alerts` が 1 件以上なら、`docs/vulnerability-handling.md`「private skill をやめる条件」に従って原因を調べ、報告に書く
- 起票には `$to_file_json` を `dependabot-alert-issue` の外部 audit findings mode に渡す。`$findings_json` を渡すと、open の alert の Issue を二重に作る

## 比べた結果の記録

比べた結果は、やめる時期を判断する Issue にコメントして記録する。
記録する Issue の条件・コメントに書く内容・新しい advisory の数え方は、`docs/vulnerability-handling.md`「private skill をやめる条件」で定義する。ここへ転記しない。
基本フローの手順 5 で比較のスクリプトが出した JSON は、`$tmpdir/compare-summary.json` に残してある。
記録の元にするのは、その `matched`・`matched_ignored`・`only_in_audit`・`only_in_alerts` の 4 つの組である。`skipped_dismissed` の組は `matched` にも入っているので、記録には別に書かない。
`ignored_without_alert` は GHSA の一覧であり、`without_ghsa` は GHSA が無く GHSA とパッケージの組として比べられないので、どちらもコメントに書かず、報告にだけ添える。

1. 記録先の Issue を、タイトルで探す。open の Issue を取得してから、タイトルが `pnpm-audit-alert-issue:` で始まるものに絞る。

   ```bash
   gh issue list --state open --limit 100 --search 'in:title pnpm-audit-alert-issue' \
     --json number,title --jq '[.[] | select(.title | startswith("pnpm-audit-alert-issue:"))]'
   ```

   - 1 件ならそれを記録先にする
   - 0 件か複数件なら、記録先を選ばず、利用者に確かめる。複数件のときは候補を示し、0 件のときは見つからなかったことを伝える。
     0 件で利用者が作ると決めたら、`issue-create` で作る。docs は「見つからなければ作る」と書くが、勝手に作らず、作る前に確かめる。
     タイトルは `pnpm-audit-alert-issue:` で始める。別の題で作ると、次の回の検索で見つからない
   - 検索は件数の上限（100 件）を置く。タイトルで絞るので、上限に達するほど該当する Issue があれば、絞り込みの誤りを疑って利用者に確かめる
2. 前の回の記録を、その Issue の本文とコメントから読む。コメントは `gh issue view <番号> --json body,comments` で取得する。
   記録として読むのは、Issue の本文と、見出しが `## 最初の記録`（`## 最初の記録の基準` を含む）か `## 比べた結果` で始まるコメントである。
   これらをすべて読み、載っている組を全部集める。最後の 1 件だけを読むと、前の回に載った組が後の回から消えたとき、同じ組を新しい advisory に数え直す。
   読めないときは、新しい advisory を数えず、コメントもせずに止まる。
   本文にも該当する見出しのコメントにも組が載っていないときは、今回の組を最初の記録（以後の基準）として投稿し、新しい advisory は数えない。
   このときの見出しも `## 比べた結果（YYYY-MM-DD）` にし、「新しい advisory」の節は空にする。`only_in_*` があれば、その原因はこの節の手順 3 のとおり書く
3. 新しい advisory として数えるのは、今回の `matched` の組のうち、この節の手順 2 で集めた組に無いものである。
   `only_in_audit`・`only_in_alerts`・`matched_ignored` の組は一致していないので数えない。
   `only_in_audit` か `only_in_alerts` が 1 件以上なら、「Dependabot alerts との比較」の箇条に従って調べた原因も書く
4. コメントの本文を先にファイルへ書き、`gh issue comment <番号> --body-file <path>` で投稿する。
   見出しは `## 比べた結果（YYYY-MM-DD）` にする。本文に書く内容は、`docs/vulnerability-handling.md`「private skill をやめる条件」に従う。
   本文に節「新しい advisory」を置き、今回数えた組を載せる。累計は、集めた記録のこの節に載った組の数と今回の数の合計である。
   累計を利用者への報告に添え、2 件に達したら、やめる条件を満たしたと報告する。やめるかの判断は `docs/vulnerability-handling.md` に従う。
   外向きの操作なので、投稿の前に本文を利用者に見せて確かめる

## PNPM 補強手順

### 依存のつながりの確認

起票に渡す findings（`$to_file_json` の `findings[].package`）の重複を除き、package ごとに `pnpm why` を実行する。
これは、pnpm audit の結果に pnpm に固有の依存のつながりの情報を足すための手順である。Issue の重複の確認や分類は `dependabot-alert-issue` に任せる。

実行する前に、基本フローの手順 7 で node_modules を lockfile に合わせておく。
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
- できれば使い捨てのコピーで、バージョンを付けない `pnpm update <package> --depth 9999 --lockfile-only` を試し（pnpm 12 は `--depth Infinity` を拒否する）、patched version に届くか。
  届かなくても「作り直すしかない」とは書かない。`references/pnpm-transitive-update.md` の手段の優先順に従って判定する

pnpm の transitive 依存の更新に特有の制約と手段は、`dependabot-alert-issue` の `references/pnpm-transitive-update.md` にある。たとえば次の内容である。

- peer-keyed は、通常の update では解決し直されない
- lockfile を作り直すと、関係のない依存もまとめて上がる
- plain transitive でも、`pnpm update` が range の中にある関係のない依存を一緒に上げることがある
- 親を remove して同じ range で add し直すと、その下の依存だけを解決し直せる
- 最小の差分が要る場合に、lockfile を手で編集する手順
- 手段の優先順
- 今の状態の判定も更新の結果の判定も、node_modules から得た出力ではなく lockfile を根拠にすること

補える場合は、起票に渡す findings の JSON（`$to_file_json`）の各 finding に、次の任意のフィールドを足してよい。

- `direct_dependencies`: 脆弱な package を持ち込む direct 依存の名前の配列
- `why_summary`: `pnpm why` から分かる、依存のつながりの短いまとめ（`pnpm install --frozen-lockfile` で node_modules を合わせた後に取る）
- `context_note`: open の Dependabot alert が無い理由（`fixed` の alert だけがあり、lockfile に古いバージョンが残っているなど）の短い補足

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

- Dependabot が複数ドキュメントの `pnpm-lock.yaml` を読めなかった問題は、<https://github.com/dependabot/dependabot-core/issues/15904> が close されたときに直った。
  公式の文書の pnpm の節の記述と、取得した dependency graph と alerts が食い違うときの扱いは、`docs/vulnerability-handling.md` の冒頭にある
- この private skill は、新しい advisory が 2 件、Dependabot alerts と `pnpm audit` の両方に出て一致したらやめ、`dependabot-alert-issue` の Dependabot alerts を読むモードだけに戻す。
  比べる集合・新しい advisory の数え方・比べた結果を記録する先・やめる前に決めることは、`docs/vulnerability-handling.md`「private skill をやめる条件」で定義する。読めないときは、やめると判断しない
