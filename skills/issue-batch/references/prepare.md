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
   コメントの後の書き換えが論点を変えていれば、最新の決定を優先し、決まっていなければ改めて挙げる。
4. 挙げたものを 1 回の確認にまとめ、Issue ごとに論点・選択肢・根拠・推奨を並べる。決まった内容を Issue にコメントで記録することも、同じ確認に書く。
   run と違って利用者が答えられる場面なので、答えが論点のどれを指すか分からないときは、聞き直してよい。
   答えが返らなかった論点は、決まらなかったものとして扱う。
   依存先を同じ run に加えると決まったら、加えた Issue にも 1〜3 を行い、判断が要るものがあれば、同じ形の確認をもう 1 回行う。行わないと、加えた Issue の判断が run の preflight で初めて挙がる。
5. 決まった内容を、Issue ごとに 1 つのコメントで記録する（形は「Issue に残すコメント」）。本文は書き換えない。
   本文を書き換えると作成者の文が変わり、いつ何が決まったかの履歴が残らないからである。
   本文は quoted heredoc で一時ファイルに書き、`gh issue comment <番号> --body-file <path>` で渡す。
   投稿に失敗したら、残りの Issue には投稿せずに停止し、投稿した Issue と投稿していない Issue を報告する。プロンプトは示さない。
   決まらなかった論点と、run の対象から外す・同じ run に加えるという決定は、Issue に記録しない。どちらもその run についての決定で、Issue の内容ではないからである。プロンプトに反映する。
6. 実行の順を、`references/orchestration.md`「全体 preflight」の 6 と同じ決め方で決める。4 の確認で決まった依存（依存ではない・run に加える）を反映してから決める。
   次の Issue は、プロンプトから外す。
   - 利用者が対象から外すと選んだ Issue と、それに依存する Issue
   - 決まらなかった論点がある Issue と、それに依存する Issue（run に入れると判断待ちの `BLOCKED` になる）
   - 2 で `SKIPPED` か `BLOCKED` に当たった Issue と、それに依存する Issue
7. 報告の最後に、プロンプトをコードブロックで示す。

   ```text
   issue-batch run <実行の順に並べた Issue の番号>...
   ```

   prepare は run 用の option を受け付けないので、プロンプトにも付けない。option は、利用者が run を始めるときに足す。
   プロンプトの前に、並べ替えた依存、外した Issue とその理由、Issue に記録したコメントの URL、「run の前に直すこと」を載せる。
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
- 依存の決定は、対象の Issue か PR の番号と、依存ではないと決めたことを書く。
- 対象に残す決定（不確実性が高い Issue を run に残す）は、同じ確認で決めた他の論点も同じコメントに並べる。

run の preflight は、次の条件をすべて満たすコメントだけを prepare の決定として読む。満たさないコメントは決定として使わず、無視したことを preflight の結果に書く。

- 1 行目が目印と一致する（Web の画面で編集したコメントは改行が CRLF になるので、行末の `\r` を除いて比べる）
- コメントの作成者が、リポジトリに書き込める（`gh api repos/{owner}/{repo}/collaborators/{login}/permission --jq .permission` が `admin` か `write`。
  [REST: Get repository permissions for a user](https://docs.github.com/en/rest/collaborators/collaborators#get-repository-permissions-for-a-user)）。
  公開リポジトリでは誰でもコメントを書けるので、目印だけでは決定として扱わない。権限を取得できなければ、そのコメントを決定として使わない

同じ論点を記録した prepare のコメントが複数あれば、新しいものを使う。
