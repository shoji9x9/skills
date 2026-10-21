# 複数の Issue を順に処理する取り決め

## 状態モデル

```text
PENDING -> PREFLIGHTED -> IMPLEMENTING -> LOCAL_REVIEWING -> VERIFYING
  -> PR_OPEN -> FINALIZING -> READY_TO_MERGE -> MERGE_QUEUED -> MERGED
  -> DEPLOYMENT_WAITING -> DEPLOYED -> BRANCH_CLEANUP -> DONE

DEPLOYMENT_WAITING -- failure --> DEPLOYMENT_FIXING
  -> LOCAL_REVIEWING -> VERIFYING -> PR_OPEN -> FINALIZING

READY_TO_MERGE -- base 遅れ / head 更新 --> FINALIZING

任意の進行状態 -> BLOCKED | FAILED
未着手かつ前提不成立 -> SKIPPED
PENDING -- preflight の確認で利用者が対象から外した、または外した依存先に依存する --> EXCLUDED
```

`MERGE_QUEUED` は、merge の要求を送った後に待っている状態を表す。
`merge_mode: auto` では、auto-merge を予約したか merge queue に入れた状態を指す。
`merge_mode: agent` では、merge queue が必須の base で、queue に入った状態を指す。queue が要らない base の `agent` mode は、
`READY_TO_MERGE` から直接 `MERGED` に進む。どちらの mode でも、要求を送ったことを `MERGED` の根拠にしない。
`READY_TO_MERGE` から `FINALIZING` に戻ること（base が遅れた、待っている間に head が更新された）は前進ではない。
`max_pr_iterations` を上限として、同じ PR で戻った回数を数える。上限を超えたら、merge の要求を送らずに BLOCKED にする。

状態を進める直前に実際の状態を取得し直し、満たした条件と証拠の URL や SHA を manifest に記録する。状態のファイルは、判断のキャッシュではない。

## 全体 preflight

branch や設定を変更する前に、すべての Issue について次を済ませる。

1. Issue の URL と番号を正規化し、入力の順を保って、重複を拒否する。
2. 現在のリポジトリと、すべての Issue の owner/repo が一致することを確かめる。新しく着手するのは、Issue が OPEN の場合だけである。
   再開するときは、次のことを実際の状態から確かめられれば、CLOSED の Issue も受け付ける。
   一意に決まる linked PR が MERGED で、Issue がその merge で CLOSED になり、残りの作業が deployment と cleanup だけである。
   それ以外の CLOSED の Issue は、SKIPPED か BLOCKED にする。本文とすべてのコメントを取得し、最新の決定を優先する。
3. 規約の文書、base branch、`issue-batch` の設定（`merge_mode` と `merge_method` を含む）、エージェントごとのローカルレビューの機能、Kaizen が読む現在の transcript を決める。
   リモートの AI レビュアーはここでは固定せず、pr-finalize-loop の決め方に任せる。
   `--record-pending` が transcript を特定できないエージェントでは、候補が 0 件であることを確かめられないので、何かを変更する前に BLOCKED にする。
   transcript を提供しないエージェント（例: Copilot）は、この方法を使えない。
4. local と remote の branch、open と closed の PR、worktree を挙げる。再開する対象が 1 つに決まれば使い回し、候補が複数あれば全体を停止する。
   再開する PR の作成者でも担当者でもない（判定は `pr-finalize-loop` の `references/pr-ownership.md`）なら、その Issue を BLOCKED にする。
   他の人の PR に、無人で push や resolve をしない。参照先を読めなければ、判定を推測せずに全体を停止する。
   判定できない場合（自分の login や、PR の作成者と担当者を取得できない。ユーザーでないトークンを含む）も、利用者に確認できない。
   確認の代わりに、その Issue を BLOCKED にして理由を残す。
5. 各 Issue の担当者を読む（`gh issue view <番号> --json assignees`。手順は `issue-start` の `references/assignee.md` で定義する）。
   自分以外が付いている Issue は、何かを変更する前に BLOCKED にして、担当者の login を残す。ここでは読むだけで、割り当てない（割り当ては着手の直前に行う）。
   担当者を判定できない Issue（自分の login や担当者を取得できない）も、同じく BLOCKED にして理由を残す。
6. Issue の本文とコメントにある linked Issue・linked PR と blocking relationship を確かめ、依存を決める。
   Issue X の変更が Issue Y の変更を前提にするとき、X は Y に依存する（Y を依存先、X を依存元と呼ぶ）。片方向の依存も依存として扱う。
   Issue に紐づかない PR（「別の PR の merge の後に着手」と書かれたものなど）が前提なら、その PR も依存先として扱う。
   Issue 自身を解決する PR（4 で挙げた、再開する PR など）は依存先にしない。
   依存は推移的にたどる。C が B に、B が A に依存するなら、C も A に依存する。
   `prepare` が Issue に記録した決定で依存ではないとされた関係は、依存として扱わない。決定として読むコメントの条件（目印・書き込める権限）と、記録を覆す場合の扱いは、`references/prepare.md`「Issue に残すコメント」に従う。
   依存を決めたら、実行の順を決める。run に含まれる依存先を依存元より先に置き、先に置ける Issue が複数あれば、入力の順で前の Issue を先に置く。
   依存が 1 つも無ければ、実行の順は入力の順と同じになる。依存があると、互いに依存の無い Issue の順が入れ替わることがある。
   例えば、入力の順が A・B・C で A が C に依存するなら、実行の順は B → C → A になる。
   循環している Issue と、それに依存する Issue は順を決められないので、入力の順の位置に置いたまま、下の「確かめられない場合」として扱う。
   入力の順と実行の順は、両方を manifest に記録する。並べ替えたときは、どの依存で並べ替えたかも記録する。後の手順の「順」は、実行の順を指す。
   依存元に着手するのは、すべての依存先の PR（依存先が Issue なら、その Issue を閉じた PR）が run の base branch に `MERGED` だと、着手の直前に確かめられたときだけである。
   同じ run で実行の順が前にある依存先は、preflight では確かめずに待ち、依存元の番が来たときに確かめる。依存元の PR がすでに base branch に `MERGED` なら、この判定を当てずに残りの作業を進める。
   確かめられない依存先が 1 つでもあれば、全体を停止せず、その依存元だけを `BLOCKED`（判断待ち）にし、確かめられなかった依存先と理由を記録する。
   ただし、確かめられない依存先そのものが判断待ちの `BLOCKED` なら、依存元に新しい判断待ちを作らず、停止の理由に依存先の番号を書く。依存先の判断待ちが決まれば、依存元も進められるからである。
   確かめられない場合（run の外で merge されていない・循環している・fork・revert・stacked PR・default 以外の base・Issue を閉じた PR が linked PR でないなど）を書き分けず、迷ったら `BLOCKED` にする。
   - 確かめられない依存先を 10 の確認で利用者が外した（`EXCLUDED`）なら、未着手の依存元は `EXCLUDED` にし、対象から外した理由に依存先の番号を書く。再開する依存元は `BLOCKED` にし、作った branch と PR を残す。
   - 依存先を理由に `BLOCKED` にした依存元は、`continue_on_blocked` の対象にせず、run を止める理由にしない。
   - 依存元を外したときや、依存元の判断が決まらなかったときは、依存先の前提は変わらないので、依存先はそのまま進める。
7. browser-test が要る可能性がある場合は、先に環境を決める。
   `auth: user`、設定されていない環境、ログインの待ち、禁止した操作の解除、課金・通知・データの作成や変更や削除の承認が要るなら、BLOCKED にする。
8. GitHub の認証と、push・PR・merge・workflow の読み取りに要る権限を確かめる。決まった `merge_mode` が `auto` の場合だけ、
   auto-merge の権限とリポジトリの許可（`gh api repos/{owner}/{repo} --jq .allow_auto_merge`。
   [REST: Get a repository](https://docs.github.com/en/rest/repos/repos#get-a-repository)）も確かめる。
   `false` なら、設定を無人で書き換えずに全体を停止し、`issue-batch setup` を案内する。
   `--merge-mode agent` でやり直すよう案内できるのは、設定に `merge_ready_timeout_minutes` が既にある場合だけである。
   無ければ `agent` に要る待機の上限が決まらず、やり直しても preflight で止まる（設定を読んで、どちらかを案内する）。
   `agent` でも、base で merge queue が必須なら、`gh pr merge` は queue への投入（条件を満たしていなければ auto-merge の有効化）になる。
   その base では、同じ確認をする。共有の障害では全体を停止する。
9. setup の設定が base branch に入っていることを確かめる。
   worktree は base から作るので、共有ツリーにだけある設定（commit・push・merge していない）は worktree に届かず、run の途中で設定の扱いを決める判断が要る。
   比べるのは、issue-batch が読むリポジトリの層のファイルである。`issue-batch.jsonc` は必須で、`common.jsonc` と `browser-test.jsonc` は在れば比べる。

   `<base>` は 3 で決めた base branch である。

   ```bash
   top=$(git rev-parse --show-toplevel) || { echo '判定不能: リポジトリの直下を特定できない' >&2; exit 1; }
   git fetch --quiet origin '+refs/heads/<base>:refs/remotes/origin/<base>' || { echo '判定不能: base を取得できない' >&2; exit 1; }
   for cfg in .config/skills/shoji9x9/issue-batch.jsonc .config/skills/shoji9x9/common.jsonc .config/skills/shoji9x9/browser-test.jsonc; do
     base_blob=$(git rev-parse --verify --quiet "origin/<base>:$cfg") || base_blob=''
     work_blob=''
     if [ -e "$top/$cfg" ]; then
       work_blob=$(git -C "$top" hash-object --path="$cfg" "$cfg") || { echo "判定不能: $cfg を読めない" >&2; exit 1; }
     fi
     if [ -z "$base_blob" ] && [ -z "$work_blob" ]; then
       case "$cfg" in
       */issue-batch.jsonc) echo "$cfg: base にも作業ツリーにも無い（issue-batch setup が要る）" ;;
       *) echo "$cfg: base にも作業ツリーにも無い（比べるものが無い）" ;;
       esac
     elif [ "$base_blob" = "$work_blob" ]; then
       echo "$cfg: base に入っている"
     else
       echo "$cfg: base と作業ツリーで一致しない（どちらかに無いか、内容が違う）"
     fi
   done
   ```

   判定の結果は、ファイルごとの出力の行で読む。入っていない状態は期待される結果の 1 つなので、終了コードを 0 以外にしない。exit 1 は判定できない場合だけである。
   refspec を明示するのは、single-branch の clone でも `origin/<base>` を更新するためである。
   作業ツリーのファイルをリポジトリの直下から `git hash-object --path` で base の blob と同じ変換（改行・filter）にかけて比べるので、サブディレクトリから実行しても、追跡されていない同じ内容のファイルでも、`core.autocrlf` の環境でも正しく判定する。
   1 つでも「一致しない」か、`issue-batch.jsonc` が「無い」なら、run を始めずに全体を停止し、設定を base に入れるよう案内する。設定を無人で commit・push しない。
   base を取得できず判定できないときも、入っているとは扱わずに全体を停止する。
   人ごと・リポジトリ限定の層（`*.local.jsonc`）は commit しないので、ここでは比べない。
   共有ツリーにあれば、worktree に入った後に、`git-worktree` の carry-in で運ばれて同じ内容であることを確かめる。運ばれていないと、worktree の中ではリポジトリの層の値が警告なしに使われる。
10. run の前に利用者の判断が要るものを、すべての Issue について洗い出す。本文とすべてのコメントを読み、次のものを挙げる。
    - 提案に複数の案が並んでいて、どれを採るかが書かれていない
    - 方針や範囲が書かれていない。本文とコメントの決定が食い違い、どれに従うかを決められない
    - 受け入れ条件が、試していない機構を約束している。決めてもらうのは、試して採らなかったときの扱い（外す＝`waived`、別の作業に回す＝`deferred` と残りの作業の置き場所）である。
      決まった条件は、run の途中で採らないと決めても判断待ちにせず、決まった状態にする。`approval.ref` には、着手のときに Issue に残した承認のコメント（下）を書く。`prepare` が記録した決定なら、そのコメントを書く
    - 不確実性が高すぎて、事前に論点を決めても、実装を始めた後に新しい判断が続くと見込まれる。決めてもらうのは、run の対象から外すか、論点を決めたうえで対象に残すかである

    4 つ目の判断に当たる不確実性は、Issue ごとに次の兆候を数えて評価する。2 つ以上に当たる Issue を、対象から外す候補として提案する。
    評価するのは、再開しない未着手の Issue（4 で使い回す branch・PR・worktree が無いもの）だけである。
    再開する Issue は、すでに作った branch や PR を追う必要があるので、外す候補にしない。
    兆候は Issue ごとに数え、依存先や依存元（6）に当たった兆候を足さない。本文やコメントの 1 つの記述は、1 つの兆候にだけ数える。
    - 決まっていない論点が 2 つ以上ある（「検討する」「決める」と書かれたまま、決め方も書かれていない）
    - 主な作業が、調査か、設計の案の比較である
    - 試していない機構（新しい外部の API・新しいワークフロー・導入していないツール）に依存する
    - 影響する範囲が、Issue に書かれた範囲を大きく超える見込みである（Issue が挙げていない別のスキル・パッケージ・サービスにも変更が要るなど）

    外す候補の Issue に依存元があれば、確認に依存元の一覧を並べる。
    外すと依存元が 6 のとおり `EXCLUDED` か `BLOCKED` になることを、選択肢の影響として示す。
    依存元が再開する Issue でも、依存先は外す候補にできる。
    依存元 X だけが外す候補で、その依存先 Y が候補でないなら、X だけを外し、Y は進める。
    提案には、当たった兆候と、その根拠になる本文やコメントの記述を Issue ごとに添える。1 つだけに当たる Issue は、外す候補にしない。その兆候が上の 1〜3 つ目の判断のどれかに当たるなら、その判断として確認に載せる。
    外す候補の Issue でも、1〜3 つ目の判断に当たる論点は同じ確認に並べ、対象に残すと選んだときの決定もその確認で受け取る。並べないと、残すと選んだ Issue の論点を決める 2 回目の確認が要る。
    利用者の確認なしに、Issue を対象から外さない。
    利用者が外すと選んだ Issue は、`EXCLUDED` にし、対象から外した理由（当たった兆候と利用者の選択）を manifest と最終報告に残す。
    依存先を外したために外した依存元は、当たった兆候の代わりに、外した依存先の番号を理由に書く。
    `EXCLUDED` の Issue には着手しないので、担当者の割り当て・Issue へのコメント・branch と worktree の作成をしない。
    対象に残すと選んだ Issue は、同じ確認で決めた論点を、1〜3 つ目の判断と同じように記録して進める。

    挙げたものは、何かを変更する前に、1 回の確認にまとめて利用者に決めてもらう。Issue ごとに、論点・選択肢・根拠・推奨を並べる。
    この確認に載せるのは、上の 4 種類の判断だけである。
    preflight の他の手順で SKIPPED や BLOCKED にした Issue（CLOSED、持ち主や担当者を判定できない、他の人が担当している、無人では実行しない操作が要るなど）は、確認に載せない。
    受け入れ条件を変える決定を求めるなら、`issue-start` の `references/acceptance.md`「受け入れ条件を変えたとき」の似た Issue の候補を先に探し、見直すかを同じ確認に載せる。
    載せないと、コメントでの条件の改訂が push の前の突き合わせ（`acceptance.md` の手順 6）で再び判断待ちになり、run の途中で止まる。
    決まった内容は、manifest を作ったときに記録する。受け入れ条件や範囲を変える決定と、条件を外してよいという前もっての承認は、その Issue に着手するとき（branch を作る前）に Issue にコメントで残す。
    preflight で Issue を書き換えないのは、全体を停止した場合に、run が何もしていないのに Issue だけが変わるのを避けるためである。
    この洗い出しは読むだけで何も変えないので、preflight の他の手順で全体を停止する場合も、停止を決めた後に行う。
    そのうえで確認を求めずに、ここで挙げたものを停止の報告に載せる。決めてもらうのは、やり直した run の preflight で 1 回だけである。
    決まらなかった Issue は、BLOCKED（判断待ち）にする。その依存元は 6 のとおりに扱う。
    `prepare` が Issue に記録した決定（`references/prepare.md`「Issue に残すコメント」）は、洗い出しの前に読む。記録した論点は、決まったものとして確認に載せない。
    決定として読むコメントの条件と、記録を覆す場合の扱いは、`references/prepare.md`「Issue に残すコメント」に従う。
    記録した見直しの判断（似た Issue の候補）は、記録した条件について、`issue-start` の `acceptance.md` の手順 6 の判断を得たものとして扱う。
    記録した受け入れ条件の決定は、そのコメントを `approval.ref` にする。記録した受け入れ条件と範囲の決定は、着手のときに同じ内容のコメントを重ねて残さない。
    run を始めた後は、ここで挙げなかった判断も利用者に確認しない（「判断の扱い」）。

preflight で `BLOCKED`・`SKIPPED`・`EXCLUDED` にした Issue は処理しない。残りの Issue は `continue_on_blocked` の値に関わらず進め、そのうち未着手の Issue は manifest を作るときに `PREFLIGHTED` にする。
`continue_on_blocked` を使うのは、run の途中で Issue が `BLOCKED`（判断待ちに限らない）か `FAILED` になったときだけである。依存先を理由に `BLOCKED` にした依存元には使わない（6）。
true なら次の Issue に進み、止まった Issue の依存元は 6 のとおりに扱う。
false なら残りの Issue に着手せずに run を止めて、最終報告を出す。着手しなかった Issue（依存元を含む）は、最後の状態（未着手なら `PREFLIGHTED`、再開する Issue ならその時点の状態）のまま表に載せ、停止の理由に止めた Issue の番号を書く。

## 判断の扱い

run を始めた後（全体 preflight を終え、manifest の作成などの最初の変更に進んだ後）は、利用者に確認を送らない。
利用者が不在でも run を最後まで進め、判断は最終報告でまとめて受け取る。preflight 10 の確認は、この前に行う 1 回だけの確認である。
前提スキル（`issue-start` など）が「利用者に確認する」と定める箇所も、run の中ではこの扱いに読み替える。
`pr-finalize-loop` の人の判断が要る指摘は、`--defer-decisions` を渡して判断待ちとして受け取る（「pr-finalize-loop への handoff」）。

- 途中で利用者の判断が要る状態になったら、確認を送る代わりに、その Issue を BLOCKED（判断待ち）にして manifest に記録する。
  そのうえで、`continue_on_blocked` に従って次の Issue に進むか run を止める（「全体 preflight」の最後の段落）。
  記録するのは、一意な `id`・論点・選択肢・それぞれの根拠と影響・推奨・決まった後に残る作業である（`id` は受け入れ条件の表の `decision_ref` が指す）。利用者が最終報告だけを読んで決められるようにする。
- 1 つの変更から生じる判断は、1 つの判断待ちにまとめる。
  受け入れ条件を外す承認と似た Issue の見直しは、`issue-start` の `references/acceptance.md` の手順 3 のとおり、1 つの判断待ちに載せる。
- 自分で判断して進めたものも、manifest に記録する。記録するのは、判断・根拠・覆すときに戻る工程である。
  当たるのは、受け入れ条件を `met` にした判断（特に `strength: read`）、レビューの指摘を採らなかった判断、
  browser-test や deployment を `not-applicable` にした判断、Issue の記述と今の状態のずれの扱いなどである。
  判断として意識しなかったものも抜けないように、次の 4 つの欄を run 全体で 1 組持たせ、該当する事柄をそれぞれに記録する。
  各欄と、どの欄にも当たらない判断（`others`）の項目には、Issue の番号・判断・根拠・覆すときに戻る工程と、覆したときの手戻りの大きさ（大・中・小）を記録する。
  複数の Issue に当たる判断は、当たる Issue の番号をすべて書く。
  受け入れ条件に入った形を承認なしに扱わなかったときは、どの欄にも載せず、判断待ちにする。
  1 つの事柄は 1 つの欄にだけ載せ、どの欄にも当たらなければ `others` に載せる。
  複数の欄に当たりうる境目の事柄は、どの欄に置くかを自分で判断し、その判断を項目に書く。
  指摘の URL が無いもの（ローカルレビューの指摘）は、URL の代わりにファイルと行と指摘の要旨を書く。
  - 守っていない規約: 指摘を受けずに守らなかった、リポジトリの文書が定める書き方や手順と、その理由。
    利用者の指示でローカルレビューを省いたことも、ここに載せる。省いてよい条件と、記録に添える内容は「ローカルレビュー」で定義する
  - 速度や反復の回数を理由に直さなかった指摘: 指摘の URL と、直さなかった理由。欄は指摘の種類ではなく直さなかった理由で決めるので、規約に反するという指摘もここに入る
  - 見送った指摘のうち Issue にしていないもの: 速度や反復の回数以外の理由（範囲の外など）で見送った指摘の URL と、Issue にしなかった理由
  - Issue の対象から外した形: Issue が挙げた範囲や形（対象のファイル・入力の種類・書き方の変種など）のうち、扱わなかったもので、受け入れ条件に入っていないか、外すこと（`waived`）か別の作業に回すこと（`deferred`）に承認を得たもの。
    扱わなかった根拠と、レビューで指摘されたならその指摘の URL と直さなかった理由も書く。
    承認を得た形は、`approval.ref` を添える。`deferred` なら、残りの作業の置き場所（`tracked_in`）も書く。
    preflight で Issue ごと run の対象から外した（`EXCLUDED`）ものは、最終報告の表の「対象から外した理由」に書き、この欄には載せない
  これらの欄は、起きたことを記録する場所である。欄を足しても、この文書の「ローカルレビュー」の「妥当なものだけ直す」と、受け入れ条件を外すのに承認が要る取り決め（`issue-start` の `references/acceptance.md`）は変わらない。
  最終報告を作る前に、PR のスレッドの返信と受け入れ条件の突き合わせの表を読み直し、欄に記録し忘れた事柄を足す。
- 範囲を自分で Issue やコメントに書くとき（影響範囲を確かめ直して範囲を書き直すなど）は、試していない機構を「候補（試して採否を決める）」と書き、受け入れ条件に入れない。
  約束として書くと、試して採らないと決めた時点で、条件を外す承認が要る判断待ちになる。

## worktree と manifest

`mktemp -d` で run root を作り、その下に manifest を置く。run root のパスは、最終報告まで保持する。

worktree の仕組み（置き場所、セッションの移動、`.gitignore` 対象ファイルの運搬、チェックからの除外、clean を確かめてからの後片付け）は、
`git-worktree` スキルに任せ、ここには書き写さない。branch を先に作ってから、`git-worktree enter <branch>` と同じ取り決めで入る。
**`git worktree add` を実行しただけで、隔離できたとしない。** セッションを移さないと、subagent・フォークして動くスキル・
バックグラウンドの Bash が、呼び出し元の作業ツリーで動く。参照先を読めなければ停止する。

**worktree は run root（`mktemp -d`）の下に置かない。** リポジトリの外の worktree には、
起動したディレクトリからの 1 回しか入れない。そのため、Issue ごとに worktree を移るこのスキルの進め方が、2 件目で成り立たない。
移るたびに利用者の承認も要り、無人の実行では止まる（根拠は `git-worktree` の `references/isolation.md`）。
置き場所には、`git-worktree setup` が決めたリポジトリの中のディレクトリを使う。
その除外が、リポジトリ全体を読むすべてのジョブに入っていることを、preflight で確かめる。設定されていないか、除外されていなければ BLOCKED にする。

manifest に書いてよいのは、次のものだけである。

- run ID、入力順と実行順（並べ替えた依存）、Issue URL / 番号
- 状態、branch、worktree、PR URL
- 検証名・結果・証拠 URL / SHA
- `local_review`: ローカルレビューを最後に当てた範囲の終わりの commit の SHA（「ローカルレビュー」）
- BLOCKED / FAILED の停止の理由と残作業
- `BRANCH_CLEANUP` のまま残した worktree の、引き継ぐファイルの一覧（「worktree に残った記録の引き継ぎ」）
- SKIPPED の飛ばした理由
- EXCLUDED の対象から外した理由（当たった兆候と利用者の選択、または外した依存先の番号）
- 判断待ちの項目と、自分で判断して進めたもの（「判断の扱い」の 4 つの欄を含む）。
  4 つの欄は、`self_decisions` の下に `unfollowed_rules`（守っていない規約）・`unfixed_for_speed_or_iterations`（速度や反復の回数を理由に直さなかった指摘）・
  `skipped_without_issue`（Issue にしていない見送り）・`excluded_forms`（対象から外した形）の名前で置き、どの欄にも当たらない判断は同じ `self_decisions` の下の `others` に置く。
  manifest を作るときに、空の欄も空の配列として置く。

token・cookie・認証の header・秘密の環境変数・設定から渡された変わる URL は、記録しない。
やり直すときは、manifest を起点に候補を得ても、branch・PR・CI の今の状態を、GitHub と git から確かめ直す。

## issue-start への handoff

Issue ごとの専用の worktree で、`issue-start <Issue URL> --pr` と同じ取り決めを使う。
ただし、PR を作る前にローカルレビューと検証を挟むので、次の区切りで段階に分ける。

1. repo の一致、本文とコメント、規約、base branch、担当者、同じ番号の branch を、`issue-start` と同じ順で確かめる。
   担当者は着手の直前に、`issue-start` の `references/assignee.md` の 3 段（確かめる・空なら自分を割り当てる・読み直す）で扱う。
   利用者への確認に当たる結果（自分以外が付いている・割り当てができない・読み直して自分以外も付いていた）は、確認の代わりに BLOCKED にして担当者の login を残す。
   読み直して自分以外も付いていた場合も、自分を無人で外さない。外すかの判断を、残りの作業として最終報告に載せる。
2. branch を使い回すか、`gh issue develop` で作る。Issue を作った時刻より後の base の変更と、今のコードから独立に導き直した影響範囲を突き合わせる。
3. すべて解決済みなら `SKIPPED` にする。書かれた範囲の外に大きく広がる場合や、要件の選択が要る場合は `BLOCKED` にする。
4. 実装し、リポジトリの規約が求める最小の範囲の lint と test を実行する。

`issue-start` の規約の決め方・影響範囲の確かめ直し・commit と PR の規約を、ここには書き写さない。参照先を読めなければ停止する。

## ローカルレビュー

実装したときの文脈から切り離したレビューを、今使っているエージェント自身の機能で行う。別のエージェントに自動で切り替えない。

- Codex: `codex review --uncommitted`。staged・unstaged・untracked が対象であることを、ローカルの `--help` でも確かめる（[OpenAI Developers](https://developers.openai.com/codex/cli/reference)）。
- Claude Code: 組み込みの `/code-review high` に、レビューする commit の範囲を `<from>..<to>` の形で渡す。
  範囲の指定は文書に例がある（`/code-review HEAD~15..HEAD`。[Claude Code の文書](https://code.claude.com/docs/en/code-review-local.md)）。
  範囲を省くと、upstream より先の commit と commit していない変更が対象になり、upstream が無ければローカルの `main` と比べる。
  ローカルの `main` が古いと、取り込み済みの他の PR の変更まで対象に入るので、範囲を必ず渡す。範囲を渡すために、レビューの前に変更を commit する。
  非対話の `claude -p` で呼ぶ方法は、今の CLI で実際に実行して動いた場合だけ使う。動かなければ BLOCKED にする（[Claude Code commands](https://code.claude.com/docs/en/commands)）。
- GitHub Copilot CLI: `/review` の後に、レビューの対象を文で書いて渡す（[GitHub Docs](https://docs.github.com/en/copilot/how-tos/copilot-cli/automate-copilot-cli/run-cli-programmatically#code-review-a-branch)）。
  文書は対象を指定する構文を定めていないので、commit していない差分には次のコマンドを使う。

  ```bash
  copilot -p '/review the uncommitted changes (staged, unstaged, and untracked files). Focus on bugs and security issues. List the files you reviewed.' -s --allow-tool='shell(git:*)'
  ```

ローカルレビューは、変更の大きさに関わらず、push の前に必ず行う。
差分が設定の 1 行だけ・記録や文書だけ・機械的な置換だけといった理由で省かない。
省いてよいのは、次のどちらかに当たる場合だけである。この 2 つ以外の理由では省かない。

- 利用者が、run の指示か preflight 10 の確認への回答で、その Issue のローカルレビューを省くよう明示した
- base branch に入っていない変更が 0 行である。commit していない差分（staged・unstaged・追跡されていないファイル）と、base branch に入っていない commit（push 済みのものを含む）をすべて数える。
  比べる相手は、取得し直した remote の base branch（`git fetch` の後の `origin/<base>` など）にする。ローカルの base branch は、remote より古いか、push していない commit を持つことがある

Codex と GitHub Copilot CLI では、commit する前に、commit していない差分（staged・unstaged・追跡されていないファイル）を対象にして、上のコマンドでレビューする。
Claude Code では、変更を commit してから、`<base との merge-base>..HEAD` を範囲に渡す。merge-base は、取得し直した remote の base branch（`git fetch` の後の `origin/<base>`）と HEAD から `git merge-base` で求める。
再開した Issue のように、ローカルレビューを始める時点で base branch に入っていない commit が残っていることがある。
そのとき Codex と Copilot CLI では、上のレビューに加えて、base branch との差分を対象にするレビューも行う。
Claude Code では、それらの commit は merge-base からの範囲に入っているので、別のレビューは要らない。
base branch に入っていない commit が残っているかの判定は、ローカルレビューを始める時点で 1 回だけ行う。レビューの修正や Kaizen の記録をその後に commit しても、やり直さない。
base branch との差分は、Codex と Copilot CLI では次の方法でレビューする。

- Codex: `codex review --base <base>`（`--help` の「Review changes against the given base branch」）
- GitHub Copilot CLI: 次のコマンドを使う。

  ```bash
  copilot -p '/review the changes on this branch compared to <base>. Focus on bugs and security issues. List the files you reviewed.' -s --allow-tool='shell(git:*)'
  ```

レビューが指定した対象に当たったことは、次の方法で確かめる。

- Claude Code: `/code-review` の出力の本文は、レビューした範囲を示さない。
  `/code-review` はレビューを別のエージェントでバックグラウンドに実行し、その記録を出力ファイルに残す。
  その記録に、渡した範囲と同じ commit の組を指す `git diff` の実行があることを確かめる（短い SHA で書いた形も、同じ commit を指せば当たる）。
  出力ファイルが無いか、そうした実行が無いときは、範囲を確かめられないとして扱う。
- GitHub Copilot CLI: 対象を文で渡すだけで、指定する構文を持たないので、指示で挙げさせたレビューしたファイルを見る。

指摘の有無ではなく範囲で、指定した対象に当たっていることを確かめる。指摘が 0 件の出力でも、範囲はこの方法で確かめられる。
範囲を確かめられないか対象に当たっていないときと、base branch との差分をレビューできないエージェントでは、その Issue を BLOCKED にする。
レビューした変更を含む commit の SHA を、manifest の `local_review` に記録する。「ローカルレビューの後に生じた変更」のレビューの範囲の起点にする。
Claude Code では、渡した範囲の終わり（`<to>`）の SHA である。Codex と Copilot CLI では、レビューした差分を commit した後の HEAD の SHA である。
レビューの前の HEAD を記録すると、レビュー済みの実装の commit が次の範囲に入り、同じ変更をもう一度レビューすることになる。

利用者の指示で省いたときは、manifest の `self_decisions` の `unfollowed_rules`（「判断の扱い」の守っていない規約の欄）に、その指示を添えて記録する。
変更が 0 行で省いたときは、レビューする対象が無いだけで規約には従っているので、この欄には載せない。

指摘をコードと実測に照らして 1 件ずつ判断し、妥当なものだけ直す。直した後は、検証とレビューをやり直す。
直さなかった指摘は、その時点で、「判断の扱い」の 4 つの欄か `others` のうち当たるものに manifest へ記録する。
上限までに収束しない場合、機能を使えない場合、人の判断が要る場合は BLOCKED にする。

### ローカルレビューの後に生じた変更

最後のローカルレビューの後に生じた変更も、push の前にレビューする。
`writing-style` の読み直しで直した文書や、レビューの後に足した修正がこれに当たる。
次の 2 つは例外とし、ローカルレビューにかけない。

- Kaizen の学び（`kaizen extract` が作る学びのファイル）
- commit を記録する Hook が、commit のたびに自動で足す記録（利用実績の記録の行など）。ツールが生成するデータで、手で書いた変更を含まない

どちらも PR に入るので、`pr-finalize-loop` のレビューが merge の前に見る。
学びをローカルレビューの後に作るのは、ローカルレビューで見つかった学びを記録に入れるためである。
`pr-finalize-loop` の `review_tool` が `none` のときは、PR のレビューが無いので、この例外を当てない。学びも Hook の記録も、ほかの変更と同じにレビューする。

レビューする範囲は、最後にレビューした SHA から HEAD まで（`<最後にレビューした SHA>..HEAD`）にする。
Claude Code は `/code-review high` にこの範囲を渡す。
Codex は、範囲の commit ごとに `codex review --commit <SHA>` を実行する（`--help` の「Review the changes introduced by a commit」。[OpenAI Developers](https://developers.openai.com/codex/cli/reference)）。
Copilot CLI は、範囲を文で渡し、レビューしたファイルを挙げさせる。
範囲に例外のファイルが含まれても構わない。範囲で変わったファイルが例外のファイルだけなら、このレビューは行わない。
範囲の確かめ方・指摘の扱い・BLOCKED の条件は、上のローカルレビューと同じにする。
このレビューは、受け入れ条件の突き合わせ（「Kaizen、commit、PR」）の表を作る前に行う。表を作った後に指摘を直す commit を足すと、表が `stale-commit` で失敗する。
このレビューの 1 回目は、ローカルレビューの上限（`max_local_review_iterations`）の回数に数えない。指摘を直した後のやり直しにだけ、上限を当てる。
利用者がその Issue のローカルレビューを省くよう明示したときは、このレビューも省く（記録は省いてよい条件の 1 つ目と同じ）。

## browser-test への handoff

差分から、UI や API を通して影響する画面を逆にたどる。

- 影響なし: 変更したパスと、逆にたどった結果を根拠に、`not-applicable` にする
- 影響あり: preflight で確かめた `{url, pre_commands, start, check_urls, forbidden_actions}` だけを渡し、`browser-test --scope branch` と同じ方法で確かめる。handoff の後に設定ファイルを読み直させない

console、主要な要素、Network と API、副作用の無い操作を確かめる。回帰は、同じ Issue の実装に戻す。副作用が要る受け入れ条件は BLOCKED にする。

## Kaizen、commit、PR

検証の後に、`kaizen extract --current --record-pending` を使う。候補は最大 1 件で、`status: pending` として記録するだけである。apply・archive・delete は行わない。
候補が 0 件のときは、現在の transcript とスキャナの検出能力を確かめたうえで、何もしないで進む。
transcript を特定できないエージェントでは、何もしないで進むことにせず、BLOCKED にする。

学びが作られた場合は、実装の変更とは別の commit にする。
記録の commit では、学びのファイルだけを stage し、規約どおりに commit する。commit を記録する Hook がその commit に自動で足す記録は、そのまま入れてよい。
学びはローカルレビューにかけず、PR のレビューに任せる（「ローカルレビュー」の「ローカルレビューの後に生じた変更」）。

kaizen の commit の前のチェックが実装の commit を止めたときは、次の順にする。

1. `kaizen extract --current --record-pending` で候補を確かめ、記録する。チェックが促す `kaizen --current` は利用者の承認を求めるので、run の中では使わない。
   `--record-pending` は、記録の後の `kaizen-extract-done.sh` まで行うので、同じ commit をもう一度実行すればチェックを通る。
2. 学びのファイルを stage から外し、実装の変更だけを commit し直す。
   止められた commit のために Hook が stage した記録（利用実績の記録など）は、stage したまま実装の commit に入れる。
3. 学びのファイルを、別の commit にする。

Claude Code では、ローカルレビューの前に実装を commit するので、このチェックはレビューの前に止めることがある。
そのときに作った学びには、ローカルレビューで見つかったことが入らない。
そのため、チェックが止めて学びを記録した場合も、ローカルレビューの後の通常の抽出（この節の最初）は省かない。
通常の抽出は、前の抽出の後の活動だけを走査するので、レビューで見つかったことがあれば、もう 1 件の学びになる。
1 つの Issue で学びが 2 件になることはありうる。「候補は最大 1 件」は、1 回の抽出についての取り決めである。
commit message の 1 行目、PR のタイトルと本文、Issue へのコメントは、外に出す前に `writing-style` スキルの手順で読み直す（スキルが無ければ省く）。
**すべての commit の後、push の直前に**、`issue-start` の受け入れ条件の突き合わせ（基本フローの step 10。手順は `issue-start` の `references/acceptance.md` で定義する）を通す。
ローカルレビューの修正や Kaizen の commit で HEAD が進む（「ローカルレビュー」）。
そのため、それより前に作った表は、`commit-missing` か `stale-commit` で失敗する。
次のどれかに当たれば `BLOCKED` にする。

- exit 0 にならない
- 満たせない条件に、利用者の判断が要る（判断待ち）。その行は `pending-decision` にし、`decision_ref` に manifest の判断待ちの id を書く。検査は exit 1 のままになる
  manifest の判断待ちを、`id` を持つ項目の配列 `pending_decisions` として JSON に書き出し、検査に `--decisions <path>` で渡して、`decision_ref` が記録を指すことまで確かめさせる
- `closable: false`（Issue を閉じられない）
- 受け入れ条件を変えたので、似た Issue を見直すかを確かめる必要がある（同じ `acceptance.md` の手順 6。すべての行が `met` でも、コメントでの条件の改訂や本文の書き換えで起きる）。
  preflight 10 で、その変更と見直しの判断をすでに得ていれば当たらない

見直すかどうかは、候補の一覧を添えて、判断待ちとして記録する。満たせない条件と同時に起きたら、「判断の扱い」のとおり 1 つの判断待ちにまとめる。
exit 0 だけを見て push すると、確認がどこにも残らずに消える。
通ったら push する。PR の本文には、`Closes #<Issue番号>`、変更の概要、静的な検査、受け入れ条件の突き合わせの表、browser-test の結果か対象外の根拠、Kaizen の結果を含める。

## pr-finalize-loop への handoff

PR の URL と、決まった `max_pr_iterations` を、`pr-finalize-loop <PR URL> --max-iterations <N> --defer-decisions` に渡す。`wait_ci_before_review: true` の場合だけ、`--wait-ci-before-review` を足す。
レビューツールは pr-finalize-loop が決めるので、issue-batch は値を先に固定したり渡したりしない。pr-finalize-loop の参照先を読めなければ、handoff の前に停止する。

CI、すべてのレビュアーの thread と review の本文、再レビューの依頼は、`pr-finalize-loop` が扱う。issue-batch 自身からは、リモートの AI レビューを依頼しない。
収束しなければ BLOCKED か FAILED にし、影響をその Issue の中に留められるなら、方針に従って次の Issue に進む。

issue-batch の run では、常に `--defer-decisions` を付けて渡す。`pr-finalize-loop` が人の判断が要るとする指摘は、利用者に確認されず、解決されないまま判断待ちとして返る。
返った判断待ち（指摘の URL・選択肢とそれぞれの根拠と影響・推奨）には、issue-batch の側で `id`・論点・決まった後に残る作業（判断を反映して PR を収束させ、merge する）を補う。
そのうえで manifest に記録し、その Issue を BLOCKED（判断待ち）にして merge に進まない。
pr-finalize-loop が指摘を採らずに根拠を返信して解決したものも、PR のスレッドの返信から集め、「自分で判断して進めたもの」として manifest に記録する。
`--defer-decisions` で判断待ちにするかは、利用者への影響の大きさと後で覆せるかで決まる（`pr-finalize-loop` の「自律性ポリシー」）。
影響が小さく覆せるとして推奨の案で進めた指摘も、pr-finalize-loop の報告の一覧から、選んだ案と根拠を「自分で判断して進めたもの」に記録する。
pr-finalize-loop がレビューの effort を下げて反復を足したときは、「判断の扱い」の `others` の項目として記録する。
記録するのは、段階ごとの effort と反復の回数（例: high 5 回 → medium 2 回 → low 1 回）と、段階を下げた時点ごとの HEAD の完全な SHA である。
手戻りの大きさは中とする。低い effort のレビューが指摘しなかった不具合が、見送った指摘として PR に残らないまま merge されることがあるからである。
根拠は最初の段階で収束しなかったことで、覆すときに戻る工程は、最初に段階を下げた時点の SHA から PR の HEAD までの差分を、最初の effort でレビューし直すことである。
pr-finalize-loop が進み具合のメモを失って段階が分からなくなったと報告したときも、`others` に記録する。
記録するのは、報告にある段階ごとの回数と SHA、上限を 1 回超えて反復したかである。手戻りの大きさは中とし、根拠はメモを失ってどの effort でレビューを終えたかを確かめられないことである。
覆すときに戻る工程は、報告に段階を下げた時点の SHA があればその最初の SHA から、無ければ PR の base から、HEAD までの差分を最初の effort でレビューし直すことである。
返信の根拠が速度や反復の回数であるものと、Issue にしていない見送りは、「判断の扱い」の該当する欄に記録する。

## merge、close、deployment

merge の実行方法だけが、`merge_mode` で分かれる。head の SHA の固定、`--admin` を使わないこと、`MERGED` の確認、その後の close と deployment は、どちらの mode でも同じである。

1. 収束した後に PR の `headRefOid` を取得し直して、`READY_TO_MERGE` にする。この後のコマンドにはすべてこの SHA を `--match-head-commit` で渡し、収束した後に入った push と取り違えない。
   `pr-finalize-loop` が報告した `review_tool`（同梱の解決スクリプトの出力）が `local` なら、`READY_TO_MERGE` にする前に、`pr-finalize-loop` の `scripts/local-review-record.sh check --pr <PR URL>` を実行する。
   exit 0 で、出力の `head` が固定した `headRefOid` と一致するときだけ進める。exit 1（記録が無い、前の HEAD の記録しか無い、または今の HEAD の記録に未対応の指摘が残っている `status=open`）は、merge せずに BLOCKED にする。
   exit 2（判定できない）は、間隔を空けて数回取得し直し（`merge_ready_timeout_minutes` があれば、それを上限にする）、0 か 1 にならなければ BLOCKED にする。
   出力の `findings` は、見送った指摘も数えるので、merge の条件に使わない。指摘への対応は、`pr-finalize-loop` の収束（解決していないスレッドが無いこと）で確かめる。
   `merge_mode: auto` でも省かない。GitHub の auto-merge はこの記録を見ないので、ここで確かめないと、直した commit を手元でレビューしないまま merge される。
   `READY_TO_MERGE` にする前に、その Issue の worktree の `git status --porcelain=v1 --untracked-files=all` が空であることも確かめる。
   commit を記録する Hook（`agent-usage` の利用実績の記録など）は、commit が別の Hook や pre-commit に止められたときも記録を stage するので、止められた commit の後に記録が残ることがある。
   残っている行がすべて、下の「worktree に残った記録の引き継ぎ」が定める引き継げる記録（状態とパスの両方で決める）なら、PR の branch に commit し、「Kaizen、commit、PR」の受け入れ条件の突き合わせを通してから push して、`FINALIZING` に戻す（戻した回数は `max_pr_iterations` に含める）。
   記録だけの commit でも HEAD が進むので、前の表は `stale-commit` で失敗する。
   それ以外の変更があれば、merge せずに BLOCKED にする。
2. 決まった `merge_mode` で merge する。
   - `auto`: `gh pr merge <PR URL> --auto --<method> --match-head-commit <headRefOid>`。条件を満たしたかの判定は GitHub に任せる（[gh pr merge](https://cli.github.com/manual/gh_pr_merge)）。
   - `agent`: 下の「agent mode の merge 前判定」を通してから、`gh pr merge <PR URL> --<method> --match-head-commit <headRefOid>` を実行する（`--auto` を付けない）。

   どちらでも `--admin` は使わない。**merge queue が必須の base では、`--auto` を付けなくても gh は auto-merge を有効にするか queue に入れる**。
   required check を通っていなければ auto-merge に、通っていれば queue への投入になる（`gh pr merge --help` に書かれている）。
   `agent` mode でも、すぐに merge されると決めつけず、`MERGE_QUEUED` を通ることがあるものとして扱う。
3. 上限を決めて PR を取得し直し、`MERGED` を確かめる。auto-merge の要求の作成、queue への投入、merge のコマンドの成功は、どれも完了の根拠にしない。
   merge の後は、その Issue の worktree を対象にする `git commit` を実行しない（止められる commit と、`git commit` の文字列を含むだけのコマンドも含む）。
   対象には、`git -C <その worktree> commit` や `cd <その worktree> && git commit` のようにパスで指す形と、セッションの作業ディレクトリがその worktree にある間の `git commit` の両方が入る。
   commit を記録する Hook は、コマンドの文字列で commit かどうかを判定し、パスで指したリポジトリか、セッションが作業しているリポジトリに記録を書く。どちらに書くかは、その Hook を持つスキルの定め（`agent-usage` なら `agent-usage` の `references/setup.md`「Hook の振る舞い」）に従う。
   次の Issue の worktree に入るまでの間（deployment の確認と片付け）は、セッションを移せるエージェントでは呼び出し元の作業ツリーに移す（Claude Code なら `git-worktree` の後片付けと同じく `ExitWorktree` の `action: "keep"`）。移せないエージェントでは、上の禁止を守るだけにする。
   ただし、「deployment 修復」で同じ branch に follow-up の commit を作る場合は除く。
   その commit は、セッションを merge した Issue の worktree に `path` で移してから作る。commit は follow-up PR に入り、上の 1 の確認を通る。
   移るのは、worktree に隔離したセッションの git の操作を、ハーネスがその worktree の中に限ることがあるからである。Claude Code では、別の worktree を指す `git -C` の呼び出しが拒否された（実測）。
   上の禁止の例外は、この follow-up の commit だけである。
4. Issue の `state` と linked PR を取得し直し、`CLOSED` を確かめる。OPEN なら、手で close して隠さず、BLOCKED にする。
5. PR から merge commit の OID と mergedAt を取得する。workflow ごとに
   `gh run list --workflow <file> --commit <OID> --event <event> --limit <N> --json ...` を使い、`headSha == OID`、event、base branch をすべて照合する（[gh run list](https://cli.github.com/manual/gh_run_list)）。
   `--limit` は明示する。デフォルトの 20 件で警告なしに打ち切られ、やり直しで同じ commit の run が増えると見逃す。
   返った件数が `--limit` に達したら、打ち切られたことを疑い、範囲を広げて取得し直す。
6. 対象の run が登録の待ち時間（registration timeout）の内に現れなければ BLOCKED にする。
   `gh run watch <id> --exit-status` を完了の待ち時間（completion timeout）で打ち切り、すべての対象が `completed/success` のときだけ `DEPLOYED` にする（[gh run watch](https://cli.github.com/manual/gh_run_watch)）。

workflow の `branches` と `paths` から、変更したファイルが確実に外れる場合だけ `not-applicable` にする。設定で空の配列が明示されていれば `not-configured` にする。
同じ名前の最新の run や、別の SHA での成功を、代わりに使わない。

## agent mode の merge 前判定

`merge_mode: agent` のときだけ実行する。判定はすべて PR の実際の状態から取り、`pr-finalize-loop` の報告や manifest の記憶で代えない。

```bash
gh pr view "$PR_URL" --json state,mergeable,mergeStateStatus,reviewDecision,headRefOid

# --required は非 0 終了し得るので、終了コードと stderr を捕まえてから区別する。
# `cmd && rc=0 || rc=$?` は set -e 下でも止まらない（実測）。
req_err=$(mktemp); all_err=$(mktemp)
trap 'rm -f "$req_err" "$all_err"' EXIT

fields=name,bucket,state,link
req_json=$(gh pr checks "$PR_URL" --required --json "$fields" 2>"$req_err") && req_rc=0 || req_rc=$?
# 突き合わせ用。こちらも rc を保持する（両方失敗なら「必須が無い」ではなく「取得に失敗した」）
all_json=$(gh pr checks "$PR_URL" --json "$fields" 2>"$all_err") && all_rc=0 || all_rc=$?
```

`gh pr checks --json` の `bucket` は、`state` を `pass`・`fail`・`pending`・`skipping`・`cancel` に正規化した値で、
この 5 つが取りうる値のすべてである（`gh pr checks --help`）。生の `state` を自分で分類せず、`bucket` を使う。
`req_rc` は次のように区別する。**0 以外を「失敗」として扱わない。**

| `req_rc` | 観測 | 意味 |
| --- | --- | --- |
| `0` | `req_json` に JSON | 必須チェックを取得できた |
| `8` | — | checks pending（`gh pr checks --help` の Additional exit codes） |
| それ以外（実測は `1`） | `req_json` は**空**、`req_err` に `no (required )?checks reported on the '<branch>' branch` | 必須チェックが 0 件。内訳は下表で `all_rc` と `all_err` から決める |

`req_rc != 0` のときの内訳は、次の 3 通りである。**`all_rc != 0` を、すべて「取得の失敗」として扱わない。** CI が 1 件も無いリポジトリでも、`all_rc` は 0 以外になる（実測）。

| `all_rc` | `all_err` | 状態 |
| --- | --- | --- |
| `0` | — | 必須チェックは 0 件だが check はある。`all_json` の `bucket` へ規則を当てる |
| 非 0 | `no checks reported on the '<branch>' branch` | **check が 1 件も無い**（CI 未設定）。pass 扱いにせず、check を根拠にしていない旨を manifest に残す |
| 非 0 | それ以外（認証・ネットワーク等） | 取得に失敗した。0 件と読み替えず BLOCKED |

`req_json` と `all_json` が空のまま、JSON として解析しない（`rc != 0` のとき、stdout は空になる。実測）。
**必須チェックが 0 件のときは、required が pass したことを merge の根拠にできない。**
branch protection の無いリポジトリは常にこの状態で、「required がすべて pass」は対象が空なので当然に成り立ってしまう。
この場合は、`--required` なしのすべての check の `bucket` に下の規則を当て、`UNSTABLE` の免除も当てない。
すべての check も 0 件なら、「CI が設定されていないので、check を根拠にしていない」と manifest に明記し、check が pass したことにしない。

判定と分岐は次のとおりである。`mergeable` は GraphQL の `MergeableState`、`mergeStateStatus` は `MergeStateStatus` で、どちらも下の表が取りうる値のすべてである。
`gh api graphql` の introspection で確かめた（[GraphQL enums](https://docs.github.com/en/graphql/reference/enums)）。

| 観測 | 扱い |
| --- | --- |
| `state` が `OPEN` でない | 実際の状態に従う。`MERGED` なら merge 済みとして次に進み、`CLOSED` なら BLOCKED にする |
| required check に `fail` か `cancel` がある | `pr-finalize-loop` の収束が成り立っていない。merge せずに BLOCKED にする |
| required check に `pending` がある | `merge_ready_timeout_minutes` を上限として、取得し直しを繰り返す。上限を超えたら BLOCKED にする |
| `mergeable: UNKNOWN` か `mergeStateStatus: UNKNOWN` | GitHub が計算している。同じ待機の上限の内で取得し直す |
| `mergeable: CONFLICTING`（`mergeStateStatus: DIRTY`） | 競合の解消を無人では判断せず、BLOCKED にする |
| `mergeStateStatus: BEHIND` | base が遅れている。rebase・force push・別の branch を使わず、同じ feature branch に最新の base を merge して、`FINALIZING` に戻す（「deployment 修復」の 2 と同じ扱い）。戻した回数は `max_pr_iterations` を上限に数え、超えたら BLOCKED にする |
| `mergeStateStatus: BLOCKED` | 保護の条件を満たしていない（review が足りない、解決していない thread があるなど）。`reviewDecision` を足りないものの根拠として manifest に残し、条件を無人で外さずに BLOCKED にする |
| `mergeStateStatus: UNSTABLE` | 必須でない check が失敗している。必須チェックが 1 件以上あり、そのすべてが `pass` なら merge してよい。どの check が失敗したかを、判断の根拠として manifest に残す |
| `mergeStateStatus: CLEAN` か `HAS_HOOKS`、`mergeable: MERGEABLE` | merge に進む |

待機の上限は分の単位で持ち、超えたら merge のコマンドを送らずに BLOCKED にする。
待っている間に `headRefOid` が変わったら、その時点の PR は収束していないので、merge せずに `FINALIZING` に戻す（戻した回数は、上の `max_pr_iterations` の上限に含める）。

## deployment 修復

失敗した run の log から、コードの変更で直せる根拠がある場合だけ直す。

1. Issue を reopen し、失敗した run の URL と理由をコメントする。
2. 元の feature branch と worktree を残し、最新の base を同じ branch に merge する。rebase・force push・別の branch の作成は禁止する。
3. 最小の修正、local review、検証、commit と push、`Closes #<番号>` の follow-up PR、PR の収束、merge、close の順に進め、新しい merge の SHA の deployment に戻る。

外部の障害は、リポジトリの取り決めで安全な rerun が許されている場合だけ rerun する。修正の上限、認証と権限、人の判断、競合、timeout は BLOCKED にする。

## branch cleanup

次のすべてを満たすときだけ進む。
すべての deployment が success・not-configured・根拠のある not-applicable のどれかで、Issue が CLOSED、worktree が clean、同じ branch のすべての PR が MERGED である。

manifest の worktree と branch が期待する Issue と完全一致し、branch がデフォルトでも保護されてもおらず、`feature/<Issue番号>-` で始まることを確かめ直す。
解除と削除は、`git-worktree cleanup` と同じ取り決めに従う。clean を確かめ、解除し、`git worktree list` をもう一度実行して確かめ、完全一致した local branch、remote ref の順に削除する。
glob と `gh pr merge --delete-branch` は使わない。解除か削除のどちらかが失敗したら BLOCKED にする。
`git worktree remove --force` は使わない。dirty な worktree を消す判断は、次の「worktree に残った記録の引き継ぎ」で clean にするか、利用者が決める。

### worktree に残った記録の引き継ぎ

merge の後に worktree が dirty になっていることがある。commit を記録する Hook（`agent-usage` の利用実績の記録など）が、merge の後にその worktree を対象にした commit で、記録を stage したときに起きる。
変更をすべて挙げる（`git status --porcelain=v1 --untracked-files=all`）。
各行の 2 文字の状態（index の列と作業ツリーの列）がどちらも空白・`A`・`M`・`?` のどれかで、パスがその Hook の定める記録の置き場所にあれば、引き継げる記録である。
stage しただけの新しいファイル、stage した後に書き足した `AM`、変更した `MM`、追跡していない `??` などがこれに当たる。
すべての行が引き継げる記録なら、次の手順で次の Issue の branch に引き継ぐ。
それ以外の行（記録の置き場所の外のファイル、どちらかの列が `D`・`R`・`C`・`U` の行）が 1 つでもあれば、引き継がずに BLOCKED にし、worktree を残す。
`agent-usage` は、別のブランチの明細があるときはコミットせずに利用者に確かめると定めている。run の中では、この節の手順をその確認の代わりにする（「判断の扱い」）。

1. この Issue の片付けは後に回し、worktree を残したまま次の Issue に進む。manifest には、状態を `BRANCH_CLEANUP` のまま、引き継ぐファイルの一覧を残りの作業として記録する。
2. 次の Issue の worktree に入った後、最初の commit の前に、その branch がこの Issue の merge commit を含むことを `git merge-base --is-ancestor <merge commit の OID> HEAD` で確かめる。
   含まない branch（再開した branch など）に複製すると、base にある同じパスの記録（merge の前の版）と内容が違うので、base との merge で add/add の競合になる。その Issue には引き継がずに、さらに次の Issue に回す。
   引き継がない branch でも、その Issue の commit で Hook が同じ応答の行を書くことがあり、後で引き継ぐと同じ行が 2 つのファイルに入る。この重なりは、その Hook を持つスキルの定め（`agent-usage` なら `agent-usage` の `references/records.md`「重複の扱い」）で扱う。
   含むなら、引き継ぐファイルを同じ相対パスに複製する。
3. 複製したファイルは、次の Issue の作業の commit に入れる。記録だけの branch と PR は作らない。
   複製したファイルを commit に入れずに次の Issue が止まったとき（最初の commit の前に `BLOCKED` か `FAILED` になった、など）は、複製したファイルを複製の前の状態に戻し、さらに次の Issue に回す。
   一度 commit に入れたら、その Issue が後で止まっても、さらに次の Issue には回さない。同じ記録が 2 つの branch に入るのを避けるためである。
4. 元の worktree は、記録を入れた次の Issue の PR が `MERGED` になるまで残す。
   次の Issue の「merge、close、deployment」の 3 で PR が `MERGED` になったことを確かめた後、4 の Issue の close の確認に進む前に、元の worktree を次のように片付ける。
   PR が `MERGED` なら記録は base に入っているので、4 の結果（次の Issue が `CLOSED` になるか）は待たない。
   元の worktree が複数あるときは、1 つずつ片付ける。1 つが止まったときも、セッションを呼び出し元の作業ツリーに移してから（Claude Code なら `ExitWorktree` の `action: "keep"`）、残りの元の worktree と 4 に進む。
   - 比べる前に、次の Issue の PR から merge commit の OID を取得し（`gh pr view <PR URL> --json mergeCommit`）、`git fetch origin <OID>` でその commit を手元に取得する。merge commit は GitHub の側で作られるので、取得しないと手元に無い。
   - ファイルごとに、`git rev-parse <次の Issue の PR の merge commit の OID>:<パス>` の blob の id と、元の worktree で `git hash-object <パス>` を実行した id を比べる。
     `git hash-object` は改行の変換や clean フィルタ（`core.autocrlf`・`.gitattributes` の `eol`）を当ててから id を作るので、作業ツリーと blob で改行が違うだけのファイルを、一致しないと判定しない。
     `git rev-parse` か `git fetch` が失敗したときは、一致しないとは扱わず、判定できないとして元の worktree を残し、元の Issue を BLOCKED にする。最終報告には「merge commit の記録を読めない」と、一致しない場合とは別の理由で書く。
     1 つでも一致しなければ（引き継いだ後に元の worktree の記録が書き足された、など）、元の worktree を戻さずに残し、元の Issue を BLOCKED にする。
     次の Issue は、そのまま 4 に進む。最終報告には、元の worktree の絶対パスと、一致しなかったファイルと、残りの作業（branch は merge 済みなので、違いを確かめてから戻して片付ける）を書く。
   - すべて一致したら、元の worktree に `path` で入り直し（`git-worktree` の取り決めでは、移った後は前の worktree に書き込めない）、引き継いだファイルだけを戻す。
     HEAD か index にあるファイル（stage しただけの新しいファイルを含む）は `git restore --staged --worktree -- <パス>` で、`??` のファイルは削除して戻す。
   - 戻した後も `git status --porcelain=v1 --untracked-files=all` が空にならなければ、元の worktree を残し、元の Issue を BLOCKED にする。最終報告には残った行を書く。
   - 元の worktree が clean になったことを確かめたら、セッションを呼び出し元の作業ツリーに移してから（上の「merge、close、deployment」の 3 と同じ）、上の「branch cleanup」の手順で元の worktree を片付ける（中にいるまま解除しない）。
     片付けが済んだら、元の Issue を `DONE` にする。
   セッションを移せないエージェントでは、元の worktree に入り直さず、呼び出し元の作業ツリーから `git -C <元の worktree>` で同じ確かめ（比べる・戻す・clean を確かめる）を行い、「branch cleanup」の手順で片付ける。
   戻す操作（`git restore` とファイルの削除）は commit ではないので、「merge、close、deployment」の 3 の禁止には当たらない。
   ハーネスや sandbox が別の worktree を指す `git -C` を拒否したときは、元の worktree を残し、5 と同じく最終報告に書く。
5. 次の Issue の PR が merge されずに run が終わったとき（BLOCKED・FAILED を含む）と、run の最後の Issue のように引き継ぐ先の branch が無いときは、元の worktree を消さずに残す。
   最終報告に、元の worktree の絶対パスと、記録を入れた branch（入れていれば）と、残りの作業（その branch の merge の後に元の worktree を戻して片付ける）を書く。
