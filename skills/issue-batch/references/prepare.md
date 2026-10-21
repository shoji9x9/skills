# run の前に判断を決める（prepare）

`issue-batch prepare` は、run の途中で判断待ちの `BLOCKED` にならないよう、run の前に利用者の判断が要るものを決めてもらう。
決まった内容は Issue にコメントで記録し、最後に実行の順に並べた `issue-batch run` のプロンプトを示す。
run の preflight は、このコメントを読んで同じ判断を確認し直さない（`references/orchestration.md`「全体 preflight」の 10）。

prepare が変えるのは、決まった内容を書いた Issue のコメントだけである。branch・worktree・PR・manifest は作らず、担当者も割り当てない。
run の preflight の手順は `references/orchestration.md` で定義する。ここへ転記しない。読めなければ、判断を推測せずに停止する。

## 進め方

1. 入力を、`references/orchestration.md`「全体 preflight」の 1 と 2 のとおりに正規化して確かめる。
   repo が一致しない Issue があれば、何も確かめずに停止する。
2. 同じ preflight の 2・4・5・6・7・10 を、何も変更せずに行う。ここで `SKIPPED` や `BLOCKED` に当たる Issue は、判断を求めずに結果に載せる。
   4 で run なら全体を停止する場合（再開する対象の候補が複数ある・参照先を読めない）も、prepare は停止せず、その Issue を `BLOCKED` に当たるものとして結果に載せる。
   3・8・9（規約と設定・認証と権限・setup の設定が base に入っているか）は、確かめた結果を「run の前に直すこと」として報告に載せる。prepare 自身はこれらを理由に停止しない。
   ただし、設定を読めないと判定できない項目（browser-test の環境など）は、推測せずに run の preflight に任せると書く。
3. run の前に利用者の判断が要るものを挙げる。挙げるのは、preflight 10 の 4 種類と、依存の確認である。
   依存の確認は、run で preflight 6 の「確かめられない依存先」になる関係（循環している・run の外の依存先が base に merge されていない）である。選択肢は次のものである。
   - 依存先が同じ repo の OPEN な Issue なら、同じ run に加える
   - 依存ではないと記録する（本文の記述が前提を表していない場合など）
   - 依存元をこの run に入れない
   - run の外で依存先を merge してから run を始める

   すでに prepare のコメントがある Issue は、そのコメントを先に読み、決まっている論点を挙げない。
   読み方（決定として読むコメントの条件・記録を覆す場合の扱い）は、run の preflight と同じく「Issue に残すコメント」に従う。

   挙げた論点に、Issue に記録する選択肢（案の選択・方針と範囲・受け入れ条件・依存ではない・対象に残す）があれば、4 の確認の前に、自分の login がリポジトリに書き込めるかを確かめる。
   コマンドは、「Issue に残すコメント」の権限の確認と同じものを使う。
   `admin` か `write` でないか、取得できなければ、記録する選択肢を確認から外す。run はそのコメントを決定として読まないので、選んでも記録に使えないからである。
   記録しない選択肢（対象から外す・同じ run に加える・run の外で merge してから始める）は、そのまま確認に載せる。選択肢が 1 つも残らない論点は、確認に載せず、決まらなかったものとして扱う。
   報告には、書き込める人が prepare を実行し直せば決められる論点を載せる。
   確認に載せる論点が 0 件なら、4 と 5 を飛ばして 6 に進む。
4. 挙げたものを 1 回の確認にまとめ、Issue ごとに論点・選択肢・根拠・推奨を並べる。決まった内容を Issue にコメントで記録することも、同じ確認に書く。
   run と違って利用者が答えられる場面なので、答えが論点のどれを指すか分からないときは、聞き直してよい。
   答えが返らなかった論点は、決まらなかったものとして扱う。
   依存先を同じ run に加えると決まったら、加えた Issue にも 1〜3 を行い、判断が要るものがあれば、同じ形の確認をもう 1 回行う。行わないと、加えた Issue の判断が run の preflight で初めて挙がる。
   その確認でさらに依存先を加えたら、新しく加えた Issue が無くなるまで同じことを繰り返す。
5. 決まった内容を、Issue ごとに 1 つのコメントで記録する（形は「Issue に残すコメント」）。本文は書き換えない。
   本文を書き換えると作成者の文が変わり、いつ何が決まったかの履歴が残らないからである。
   本文は quoted heredoc で一時ファイルに書き、`gh issue comment <番号> --body-file <path>` で渡す。
   投稿に失敗したら、残りの Issue には投稿せずに停止し、投稿した Issue と投稿していない Issue を報告する。プロンプトは示さない。
   記録するかは、決定が Issue の内容についてのものか、この run の組み方についてのものかで決める。
   対象に残す決定は、不確実性があっても着手してよいという Issue の内容についての判断なので記録する。
   run の対象から外す・同じ run に加えるという決定と、決まらなかった論点は、この run の組み方についてのものなので記録せず、プロンプトに反映する。
6. 実行の順を、`references/orchestration.md`「全体 preflight」の 6 と同じ決め方で決める。4 の確認で決まった依存（依存ではない・run に加える）を反映してから決める。
   次の Issue は、プロンプトから外す。
   - 利用者が対象から外すと選んだ Issue
   - 決まらなかった論点がある Issue（run に入れると判断待ちの `BLOCKED` になる）
   - 2 で `SKIPPED` か `BLOCKED` に当たった Issue
   - 上の Issue に依存する Issue のうち、preflight 6 で依存先を確かめられないもの。
     依存先を閉じた PR が base に `MERGED` の場合と、依存元の PR がすでに base に `MERGED` の場合は、preflight 6 が依存元を進めるので残す
7. 報告の最後に、プロンプトをコードブロックで示す。

   ```text
   issue-batch run <実行の順に並べた Issue の番号>...
   ```

   prepare は run 用の option を受け付けないので、プロンプトにも付けない。option は、利用者が run を始めるときに足す。
   プロンプトの前に、並べ替えた依存、外した Issue とその理由、Issue に記録したコメントの URL、「run の前に直すこと」を載せる。
   run の外で依存先を merge してから run を始めると決めた依存は、merge する PR と依存元を「run の前に直すこと」に載せる。merge する前に run を始めると、依存元は判断待ちの `BLOCKED` になる。
   外した Issue が 0 件でも、無いことを書く。プロンプトに入る Issue が 0 件なら、プロンプトを示さずにその理由を書く。

## Issue に残すコメント

コメントの 1 行目は、固定の目印 `<!-- issue-batch:prepare -->` にする。run の preflight は、この目印で prepare のコメントを見分ける。
目印の後に、決まった論点を 1 件ずつ並べる。

```markdown
<!-- issue-batch:prepare -->
## issue-batch prepare で決めたこと

- 論点: <何を決めたか>
  - 種類: <案の選択 | 方針と範囲 | 受け入れ条件 | 依存 | 対象に残す>
  - 決定: <選んだ選択肢>
  - 決めた人: @<login>
  - 根拠: <本文やコメントの該当箇所と、選んだ理由>
```

- 受け入れ条件の決定は、対象の条件の文と、`waived`（外す）か `deferred`（別の作業に回す）かを書く。`deferred` なら残りの作業の置き場所も書く。
  run は、このコメントの URL を `approval.ref` に、決めた人を `approval.by` に、コメントの作成日時を `approval.at` に使う（`issue-start` の `references/acceptance.md`）。
  似た Issue を見直すかの判断（候補の番号と、見直す・見直さない）も書く（`issue-start` の `references/acceptance.md`「受け入れ条件を変えたとき」）。
  run は、記録した条件についてだけ、見直しの判断を得たものとして扱う。記録に無い条件を run の途中で変えたら、`acceptance.md` の手順 6 のとおりに確かめる。
- 依存の決定は、対象の Issue か PR の番号と、依存ではないと決めたことを書く。
- 対象に残す決定（不確実性が高い Issue を run に残す）は、同じ確認で決めた他の論点も同じコメントに並べる。

run の preflight は、次の条件をすべて満たすコメントだけを prepare の決定として読む。満たさないコメントは決定として使わず、無視したことを preflight の結果に書く。

- 1 行目が目印と一致する（Web の画面で書いたコメントは改行が CRLF になるので、行末の `\r` を除いて比べる）
- コメントの作成者が、リポジトリに書き込める（`gh api repos/{owner}/{repo}/collaborators/{login}/permission --jq .permission` が `admin` か `write`。
  [REST: Get repository permissions for a user](https://docs.github.com/en/rest/collaborators/collaborators#get-repository-permissions-for-a-user)）。
  公開リポジトリでは誰でもコメントを書けるので、目印だけでは決定として扱わない。権限を取得できなければ、そのコメントを決定として使わない

コメントの作成者・作成日時・編集の有無・本文は、次の 1 回の取得で読む（`lastEditedAt` は REST と `gh issue view --json comments` では取得できない。
[GraphQL: IssueComment](https://docs.github.com/en/graphql/reference/objects#issuecomment)）。

```bash
gh api graphql --paginate -f owner=<owner> -f name=<repo> -F number=<番号> \
  -f query='query($owner: String!, $name: String!, $number: Int!, $endCursor: String) {
    repository(owner: $owner, name: $name) { issue(number: $number) { comments(first: 100, after: $endCursor) {
      pageInfo { hasNextPage endCursor } nodes { url author { login } createdAt lastEditedAt body } }
      body lastEditedAt } } }'
```

同じ論点を記録した prepare のコメントが複数あれば、作成日時が新しいものを使う。`approval.at` にも、この作成日時を使う。
使うコメントが作成された後に編集されていれば（`lastEditedAt` が `null` でない）、決めた時点と内容が合っていると確かめられないので、その論点を決まっていないものとして扱う。このとき、古いコメントの決定は使わない。
編集や削除で prepare のコメントから論点か目印を消すと、そのコメントは記録として見えなくなり、前のコメントの決定が使われる。prepare は自分のコメントを編集も削除もせず、決定を変えるときは新しいコメントを投稿する。

次のどれかに当たる論点は、記録を使わず、決まっていない論点として扱う。run の preflight 10 は改めて確認に載せ、依存ではないという決定なら preflight 6 は記録が無いときと同じように依存を決める。

- 書き込める人が記録より後に作成した、目印の無いコメントが論点を変えた
- Issue の本文が、記録より後に編集された（Issue の `lastEditedAt` が記録の作成日時より後）。この場合は、その記録のすべての論点が当たる。
  誰が編集したかは問わない。決定が基づいた本文と今の本文が同じだと確かめられないからである。
  編集が誤って決定を使えなくしても、run は判断待ちで止まるだけで、決まっていない判断では進まない。
  受け入れ条件にチェックを付けるだけの編集も当たる。`issue-start` は PR を作った後にチェックを付けるので、PR を作った後の Issue で run をやり直すときは prepare を実行し直す

書き込めない人のコメントは、記録を覆す根拠にしない。コメントは Issue の内容を変えず、記録が基づいた本文は残っているからである。
