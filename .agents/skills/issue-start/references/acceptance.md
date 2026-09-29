# 受け入れ条件の突き合わせ

Issue の受け入れ条件を 1 項目ずつ根拠と突き合わせた表（突き合わせ表）を作り、同梱の検査で確かめてから完了・push する手順の正本。
`--acceptance` モード、`--pr` の push 前（基本フロー step 10）、実装を自分で持つスキル（`parity-replace` 等）の完了判定から使う。

テスト・リント・スイートの緑は**成果物の形**の検査で、Issue にだけ書かれた条件（「状態を URL で持つ」「失敗時にログを書く」等）はどの工程にも数えられない。
長い作業では文脈の要約を挟むので、着手時に読んだ受け入れ条件を完了の前に読み直す契機も無い。**完了の前に Issue を読み直して表にする**のがこの手順の役割。

## 前提

- **Node.js**（同梱の `scripts/acceptance-check.mjs` を実行する）。無ければ突き合わせを合格に倒さず、その旨を報告して止まる
- 表の様式の正本は [`../assets/acceptance-template.json`](../assets/acceptance-template.json)、検査の正本は [`../scripts/acceptance-check.mjs`](../scripts/acceptance-check.mjs)（どちらもコピーせずスキル配下から使う）

## 手順

1. **Issue を取り直す**（着手時の記憶で書かない）。本文とコメントに加えて、GitHub が本文を描画した HTML（`bodyHTML`）を取る。
   チェックリストの項目は、検査がこの HTML のチェックボックスから数える（画面にチェックボックスとして出たものだけが項目になり、
   コードフェンスや HTML コメントの中の `- [ ]` は数えない）。`gh issue view --json` は `bodyHTML` を返さないので GraphQL で取る

   ```bash
   gh issue view <番号> --repo <owner>/<repo> --json number,url,title,body,comments > <作業ディレクトリ>/issue.json
   gh api graphql -f owner=<owner> -f name=<repo> -F number=<番号> \
     -f query='query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { issue(number: $number) { body bodyHTML } } }' \
     --jq '.data.repository.issue' > <作業ディレクトリ>/issue-html.json
   ```

   2 つの取得の間に本文が編集されると、検査が本文の不一致として exit 2 で落とす（両方を取り直す）。
   `issue.json`・`issue-html.json` と、置き場（`--out`）が指定されていないときの表は、作業ツリーの外の一時ディレクトリに置く（リポジトリへ commit しない）。
2. **条件を列挙する**
   - 本文のチェックリストの項目は**全部**、`source: checklist` の行にする。`criterion` は、検査の出力の `checklist_items` から**そのまま写す**
     （描画後の文言なので、Markdown の記号・リンクの URL・タグは落ちている。本文の Markdown から写したり言い換えたりすると、検査が別の項目として数える）。
     初回は行の無い表で検査を 1 回通し、`checklist_items` と `expected_fingerprint` を得てから書く
   - チェックリストに無い条件（散文の要件・コメントでの追記や改訂）は `source: body` / `comment` の行にし、`quote` に原文を**一字一句**写す（要約すると検査が引用を見つけられない）。
     本文が空でタイトルだけが条件を述べる Issue は `source: title` の行にする
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
   判定はリポジトリ全体に対して行う（サブディレクトリから `.` で絞ると、その外の未コミット変更が見えない）。
   表をリポジトリ内（`--out`）に置く場合は**表自身のパスを除いて**判定する
   （`git -C "$(git rev-parse --show-toplevel)" status --porcelain -- . ':(exclude)<リポジトリのルートからの表のパス>'`）——
   表は書いた時点で未コミットの変更になり、表を commit すると HEAD が進んで `stale-commit` になるので、除かないと突き合わせが永久に通らない。
   表を commit した後に検査を取り直すときは、表を書き直して `commit` をその時点の HEAD にする
   空でなければ、`--pr` は規約どおり commit してから取る。`--acceptance` は commit しないので、未コミットの変更がある旨を報告して呼び出し元へ返す
5. **検査を通す**

   ```bash
   node <issue-start>/scripts/acceptance-check.mjs --issue <issue.json> --issue-html <issue-html.json> --table <acceptance.json> \
     --head "$(git rev-parse HEAD)" [--root <ファイル:行 の起点>] [--decisions <pending_decisions を持つ JSON>] \
     [--allow-later <後工程名,...>]
   ```

   - `source_fingerprint` は手で書かず、初回の出力の `expected_fingerprint` を写す。**表を書いた後に Issue の本文かコメントが変わると `stale-issue` で落ちる**ので、条件を読み直して表を直す
     （チェックを付けただけ・下の結果コメントを投稿しただけでは変わらない）
   - 終了コード: **0** ＝ 全行が `met` / `waived` / `deferred` / `later` で Issue と対応している、**1** ＝ 未充足・不整合が残る（`findings` を直す）、
     **2** ＝ 入力の誤り（別の Issue の表・短縮 SHA・JSON でない・`issue.json` と `issue-html.json` の本文が違う）。1 と 2 は完了にしない
   - `checklist-item-empty` は文言の無いチェックボックス（画像も代替テキストも無い等）で、行と対応づけられない。Issue の本文に文言を足すか利用者に確かめる
   - 出力の `closable` が `false`（`deferred` か `later` がある）なら、**PR で Issue を閉じない**（`Closes #<番号>` ではなく `Refs #<番号>`）
6. **受け入れ条件を変えたなら、類似 Issue の見直しの要否を利用者に確かめる**（下記「受け入れ条件を変えたとき」）。
   次のどれかに当たれば行う: 表に `waived` / `deferred` の行がある／コメントが条件を改訂・撤回した（`source: comment` の行のうち、条件を足しただけでなく既存の条件を変えたもの）／
   **本文の条件が着手時から書き換わった**（着手時に読んだ本文と手順 1 で取り直した本文のチェックリスト・条件の文言が違う。着手時の本文は `gh issue view --json body` の結果を残しておくか、編集履歴〈`userContentEdits`〉で確かめる）。
   自律実行の呼び出し元では確かめられないので、候補の一覧を添えて呼び出し元の保留に積む。結果の投稿（手順 7）より前に行う（結果のコメントに判断を載せるため）
7. **結果を Issue に残す**（外向きの操作）
   - 表を Markdown にしたコメントを投稿する。**本文の先頭に目印 `<!-- issue-start:acceptance -->` を入れる**（検査がこのコメントを指紋から外す）
   - 本文のチェックリストのうち `met` / `waived` の項目にチェックを付ける。本文を取り直し、該当行の `[ ]` だけを `[x]` にしたファイルを差分で確かめてから `gh issue edit <番号> --body-file <path>` で書く
   - `--pr` の実行では委譲の範囲として行う。`--acceptance` 単体の実行では投稿の前にユーザーに確認する。
     自律実行の呼び出し元（`parity-replace --autonomous` 等）では越えない線に当たるので行わず、呼び出し元の保留に積む

## 受け入れ条件を変えたとき（類似 Issue の見直し）

条件の変更（「移行元に合わせず URL で状態を持つ」と決めた・条件を撤回した・`waived` / `deferred` にした）は**着手中の Issue にしか書かれない**。
同じ前提を持つ別の Issue（同じ種類の画面・同じ部品を使う機能）の条件は古いまま残り、後から着手する Issue で同じ判断をやり直すか、食い違った実装になる。
**変えた条件ごとに類似 Issue の候補を挙げ、見直しの要否を利用者に確かめる。**

1. **候補を引く**。類似の判定基準は次の 3 つで、**どれか 1 つに当たれば候補**にする（当たった基準を候補ごとに残す）
   - **同じラベル**を持つ open な Issue（`bug` / `enhancement` のように全 Issue に付く種別ラベルは基準にしない。当てると全件が候補になり見直しが素通りになる）
   - 変えた条件に現れる**識別子**（バッククォートで囲まれた語・slug・パス・画面や部品の名前）を本文に含む open な Issue
   - 変えた条件と**同じ文言の条件**（空白を畳んで比べる）を持つ open な Issue

   ```bash
   # 検索 API は既定で 30 件で切るので --paginate で全ページを辿る。基準ごとに別の検索を回す
   # 同じラベル: 変えた Issue のラベルごとに 1 回（種別ラベルは除く）
   gh api -X GET search/issues --paginate \
     -f q='repo:<owner>/<repo> is:issue is:open label:"<ラベル名>"' \
     --jq '.items[] | [.number, .title] | @tsv'
   # 識別子・同じ文言の条件: 語ごとに 1 回（<語> は識別子か、条件の文言）
   gh api -X GET search/issues --paginate \
     -f q='repo:<owner>/<repo> is:issue is:open in:body "<語>"' \
     --jq '.items[] | [.number, .title] | @tsv'
   ```

   **本文の語の検索だけで済ませない**——条件の語を本文に含まない同じラベルの Issue が候補から落ちる。

   - **候補 0 件を「類似なし」の根拠にするのは、陽性コントロールが通ったときだけ**——同じ検索を `is:open` を外して回し、**変えた Issue 自身が結果に出る**ことを確かめる
     （自身は同じラベル・同じ語を持つので必ず当たるはず）。出なければ検索が効いていない（語の引用の誤り・索引の遅れ）ので、判定不能として利用者に伝え、「類似なし」と書かない。
     **本文を編集した直後は索引が追いつかず自身が出ないことがある**——時間を置いて取り直すか、編集前から本文にあった語で確かめる
   - 候補から変えた Issue 自身を除く。**閉じた Issue は候補にしない**（条件を書き換えても実装は変わらない。閉じた Issue の実装へ当て直すかは、
     プロジェクトにその工程があればそちらで扱う〈例: `replace-strategy` の `.replace/procedure-changes.md`〉）
2. **利用者に提示する**。候補ごとに番号・タイトル・当たった基準・**その Issue の該当する条件の原文**・変えた条件（変更前と変更後）を並べ、
   見直しが要るかを 1 件ずつ確かめる。確認 UI に判断材料を同梱する（直前のテキストが見えている前提を置かない）
3. **他の Issue を変えるのは承認の後だけ**（外向きの操作）。本文の書き換え・コメントでの追記のどちらにするかも利用者が決める。
   本文を書き換えるなら、取り直した本文を差分で確かめてから `gh issue edit <番号> --body-file <path>` で書く。**自動では書き換えない**
4. **結果を着手中の Issue の突き合わせのコメント（手順 7）に書く**——候補の一覧・当たった基準・利用者の判断（見直す／見直さない）と、
   候補 0 件なら陽性コントロールで自身が出たこと

## 呼び出し元が表の置き場を持つ場合

実装を自分で持つスキルは `issue-start <番号> --acceptance --out <path>` で委譲し、表を自スキルの成果物の場所に置く（例: `parity-replace` は `.replace/parity/<slug>/new/<target>/acceptance.json`）。
判断待ちの記録を持つなら `--decisions <path>` を渡し、`pending-decision` の行がその記録を指していることまで検査させる。
`later` を使わせる呼び出し元は `--allow-later <後工程名>` を渡す（`--pr` と単体の `--acceptance` は渡さないので `later` は落ちる）。
