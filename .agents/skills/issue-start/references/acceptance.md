# 受け入れ条件の突き合わせ

Issue の受け入れ条件を 1 項目ずつ根拠と突き合わせた表（突き合わせ表）を作り、同梱の検査で確かめてから完了・push する手順の正本。
`--acceptance` モード、`--pr` の push 前（基本フロー step 10）、実装を自分で持つスキル（`parity-replace` 等）の完了判定から使う。

テスト・リント・スイートの緑は**成果物の形**の検査で、Issue にだけ書かれた条件（「状態を URL で持つ」「失敗時にログを書く」等）はどの工程にも数えられない。
長い作業では文脈の要約を挟むので、着手時に読んだ受け入れ条件を完了の前に読み直す契機も無い。**完了の前に Issue を読み直して表にする**のがこの手順の役割。

## 前提

- **Node.js**（同梱の `scripts/acceptance-check.mjs` を実行する）。無ければ突き合わせを合格に倒さず、その旨を報告して止まる
- 表の様式の正本は [`../assets/acceptance-template.json`](../assets/acceptance-template.json)、検査の正本は [`../scripts/acceptance-check.mjs`](../scripts/acceptance-check.mjs)（どちらもコピーせずスキル配下から使う）

## 手順

1. **Issue を取り直す**（着手時の記憶で書かない）。本文とコメントを同じ取得でファイルへ保存する

   ```bash
   gh issue view <番号> --repo <owner>/<repo> --json number,url,body,comments > <作業ディレクトリ>/issue.json
   ```

   `issue.json` と、置き場（`--out`）が指定されていないときの表は、作業ツリーの外の一時ディレクトリに置く（リポジトリへ commit しない）。
2. **条件を列挙する**
   - 本文のチェックリスト（`- [ ]` / `- [x]` / 番号付き。コードフェンスの中は除く）の項目は**全部**、`source: checklist` の行にする。`criterion` は項目の文言をそのまま写す（言い換えると検査が別の項目として数える）
   - チェックリストに無い条件（散文の要件・コメントでの追記や改訂）は `source: body` / `comment` の行にし、`quote` に原文を**一字一句**写す（要約すると検査が引用を見つけられない）
   - コメントが条件を改訂・撤回していれば最新の決定に従う。撤回されたチェックリスト項目も行は残し、`waived` にして `approval.ref` に撤回したコメントを書く
   - **検査が保証するのは「チェックリストの項目と行が 1 対 1」と「散文の行の引用が Issue に在る」までで、散文の条件を漏れなく拾ったかは保証しない**。本文とコメントを最後まで読んで拾う
3. **1 行ずつ根拠を付ける**。`status` は次のどれか

   | `status` | 意味 | 要るもの |
   |---|---|---|
   | `met` | 満たした | `evidence`（`command`: `command` と `result` / `file`: `ref` に `パス:行` か `パス:開始-終了`）と `strength`（`measured`＝結果を記録したコマンドを 1 件以上持つ / `read`＝読解だけ） |
   | `unmet` | 満たしていない | —（完了にしない） |
   | `pending-decision` | 利用者の判断待ち | `decision_ref`（判断待ちの記録の id）。完了にしない |
   | `waived` | 利用者が外すと決めた | `approval`（`by` / `at` / `ref`＝決定の記録） |
   | `deferred` | 利用者が別の作業へ回すと決めた | `approval` と `tracked_in`（残作業の置き場）。Issue は閉じない |
   | `later` | 同じ流れの後工程が満たす（呼び出し元のスキルが使ってよいと定めた条件だけ。例: `parity-replace` の完了時点での `parity-diff` の収束） | `owner`（満たす後工程。呼び出し元が `--allow-later` で許した名前と完全一致。許可の無い実行では使えない）。Issue は閉じない。後工程が済んだら表を取り直して `met` にする |

   - **満たせない条件を自分で外さない・飛ばさない。** `waived` / `deferred` は利用者が決めたときだけ書く（承認の無い行は検査が落とす）。
     決まるまでは利用者に確認するか、呼び出し元が判断待ちの記録を持つなら `pending-decision` にして積む
   - `file` の根拠は `--root`（既定は作業ディレクトリ）から解決し、ファイルの実在と行の範囲を検査が確かめる
4. **根拠を取った版を固定する**。未コミットの変更が残っていると HEAD が根拠の版を表さないので、`git status --porcelain` が空のときだけ `commit` に HEAD の完全 SHA を書く。
   表をリポジトリ内（`--out`）に置く場合は**表自身のパスを除いて**判定する（`git status --porcelain -- . ':(exclude)<表のパス>'`）——
   表は書いた時点で未コミットの変更になり、表を commit すると HEAD が進んで `stale-commit` になるので、除かないと突き合わせが永久に通らない。
   表を commit した後に検査を取り直すときは、表を書き直して `commit` をその時点の HEAD にする
   空でなければ、`--pr` は規約どおり commit してから取る。`--acceptance` は commit しないので、未コミットの変更がある旨を報告して呼び出し元へ返す
5. **検査を通す**

   ```bash
   node <issue-start>/scripts/acceptance-check.mjs --issue <issue.json> --table <acceptance.json> \
     --head "$(git rev-parse HEAD)" [--root <ファイル:行 の起点>] [--decisions <pending_decisions を持つ JSON>] \
     [--allow-later <後工程名,...>]
   ```

   - `source_fingerprint` は手で書かず、初回の出力の `expected_fingerprint` を写す。**表を書いた後に Issue の本文かコメントが変わると `stale-issue` で落ちる**ので、条件を読み直して表を直す
     （チェックを付けただけ・下の結果コメントを投稿しただけでは変わらない）
   - 終了コード: **0** ＝ 全行が `met` / `waived` / `deferred` / `later` で Issue と対応している、**1** ＝ 未充足・不整合が残る（`findings` を直す）、**2** ＝ 入力の誤り（別の Issue の表・短縮 SHA・JSON でない）。1 と 2 は完了にしない
   - 出力の `closable` が `false`（`deferred` か `later` がある）なら、**PR で Issue を閉じない**（`Closes #<番号>` ではなく `Refs #<番号>`）
6. **結果を Issue に残す**（外向きの操作）
   - 表を Markdown にしたコメントを投稿する。**本文の先頭に目印 `<!-- issue-start:acceptance -->` を入れる**（検査がこのコメントを指紋から外す）
   - 本文のチェックリストのうち `met` / `waived` の項目にチェックを付ける。本文を取り直し、該当行の `[ ]` だけを `[x]` にしたファイルを差分で確かめてから `gh issue edit <番号> --body-file <path>` で書く
   - `--pr` の実行では委譲の範囲として行う。`--acceptance` 単体の実行では投稿の前にユーザーに確認する。
     自律実行の呼び出し元（`parity-replace --autonomous` 等）では越えない線に当たるので行わず、呼び出し元の保留に積む

## 呼び出し元が表の置き場を持つ場合

実装を自分で持つスキルは `issue-start <番号> --acceptance --out <path>` で委譲し、表を自スキルの成果物の場所に置く（例: `parity-replace` は `.replace/parity/<slug>/new/<target>/acceptance.json`）。
判断待ちの記録を持つなら `--decisions <path>` を渡し、`pending-decision` の行がその記録を指していることまで検査させる。
`later` を使わせる呼び出し元は `--allow-later <後工程名>` を渡す（`--pr` と単体の `--acceptance` は渡さないので `later` は落ちる）。
