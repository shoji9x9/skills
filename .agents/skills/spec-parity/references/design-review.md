# デザインの点検と人による確認

`style_policy: free` では、スタイルが現行と同じでなくてよい。ただし、人が見て違和感の無いスタイルは要る。
これはツールの終了コードでは決められないので、`verify` は 2 つの段で確かめ、どちらも利用者の承認の記録で判定する。
モデルの「問題ないように見える」を収束の根拠にしない。

1. デザインの点検: 新側の UI を規則に照らして点検し、指摘を「直す」か「受け入れる」に分ける
2. 人による確認: 利用者が新側の画面を見て、違和感が無いことを承認する

## デザインの点検

### 使う規則を選ぶ

- `web-design-guidelines` スキルがエージェントに入っていれば、それで点検する。入っているかは、エージェントが使えるスキルの一覧と、
  プロジェクトのスキルの置き場所（`.agents/skills/web-design-guidelines/SKILL.md` など）で確かめる。記憶で決めない。
- 入っていなければ、導入するかを利用者に確かめる。導入は依存の追加なので、`references.dependency_policy` に従い、承認を得てから `gh skill install vercel-labs/agent-skills web-design-guidelines` で入れる（<https://cli.github.com/manual/gh_skill_install>）。
  `npx skills` では入れない。
- 導入しないとき、または導入しても使えないとき（ネットワークが無い・規則を取得できない）は、下の「同梱の観点」で点検する。`design_review.source` に `bundled` と書く。

`web-design-guidelines` は、点検のたびに規則を GitHub の main（`vercel-labs/web-interface-guidelines` の `command.md`）から取得する。
取得のしかたは、`gh skill preview vercel-labs/agent-skills web-design-guidelines`（<https://cli.github.com/manual/gh_skill_preview>）で確かめた。
スキルの本体は <https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines> にあり、その `SKILL.md` が規則の取得先（<https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md>）を書いている。
規則が変わると、同じ新側でも指摘が変わるので、結果を固定できない。そのため必須にせず、使ったときは取得した日時を `design_review.rules_note` に書く。
このスキルは、指摘を `ファイル:行` の形で出す。点検の対象は、機能の画面を作る新側のソース（部品・スタイル・マークアップ）である。

### 同梱の観点

規則のスキルを使わないときの最小の観点である。各観点を、機能の画面（`capture_conditions.pages`）の新側のソースと、人による確認のために撮った画面で確かめる。

| 観点 | 指摘にするもの |
|---|---|
| 操作の手がかり | 押せる要素が押せるように見えない・押せない要素が押せるように見える |
| キーボード | 焦点が見えない・Tab の順序が画面の並びと違う・キーボードで操作できない部品 |
| 名前 | アイコンだけのボタンや入力欄に、アクセシブルネームやラベルが無い |
| 読みやすさ | 背景と文字の明るさが近くて読めない・文字が小さすぎる・行が長すぎる |
| 重なりと切れ | 文字や部品が重なる・はみ出して切れる・省略の印が無いまま切れる（記録した幅のどれでも） |
| 揃え | 同じ種類の要素の余白・揃え・大きさが、同じ画面の中でばらつく |
| 状態の表示 | 読み込み中・0 件・失敗・送信中の表示が無いか、どれか分からない |
| フォーム | 必須の印・入力の誤りの文言が無い・誤りがどの欄のものか分からない |
| 画像 | 意味を持つ画像に代わりの文言が無い・縦横の比が崩れる |
| 一貫性 | 同じ操作の部品が、機能をまたいで違う見た目や位置になる（既に置き換えた機能の新側と比べる。現行とは比べない） |

### 指摘を分ける

- 指摘は 1 件ずつ、`verify-metadata.json` の `design_review.findings[]` に書く（`id`・`rule`・`page`・`summary`・`decision`）。
- `decision` は `fix`（直す）か `accept`（受け入れる）である。
  `fix` は、要対応として `parity-replace` へ差し戻す。直した後の新側で、点検をやり直す（前の点検の記録は、新側のバージョンが変わると古い記録になる）。
  `accept` は、利用者の承認（`approval` の `approved_by`・`approved_at`・`reason`）で確定する。承認の前は `accept` と書いても収束しない。
  承認を書いたら、同じ値を承認の記録（下の「承認の記録」）にも追記する。
- 受け入れるかの確認は、同じ原因の指摘をまとめて 1 回にしてよい。承認は指摘ごとの `approval` に同じ内容で書く（件数をまとめて 1 件にしない）。
- 点検を終えたら、点検したページを `pages_reviewed` に、終えた日時を `completed_at` に、点検した新側のバージョン（`verify-metadata.json` の `new.tree` の値）を `tree` に書く。指摘が 0 件でも、この 3 つは書く。

## 人による確認

- 新側の画面を、記録した幅（`capture_conditions.viewports`）で開き、利用者に見てもらう。確かめるための画面の記録（スクリーンショット）は採ってよいが、比較には使わない。
  撮るときは、e2e のテストの外で撮るか、利用者の環境のブラウザで開いてもらう。撮った画面のパスを `human_review.screens[]` に書く。
  画面を新側のディレクトリの中に保存するなら、`.replace/` の下に置くか新側の `.gitignore` に入れる（入れないと `new.dirty` が `true` になる）。
- 判断の材料（ページ・幅・画面の記録のパス・デザインの点検の結果）を、確認のツールに入れて聞く（[`user-confirmation.md`](user-confirmation.md)）。
  選択肢は「違和感が無い（承認する）」「違和感がある（箇所を書いてもらう）」「承認しない」である。
- 承認したら、`human_review.approval` に `verdict: approved` と、承認した人・日時を書く。違和感があれば `verdict: rejected` と `notes` を書き、`parity-replace` へ差し戻す。
  どちらの返事も、同じ値を承認の記録（下の「承認の記録」）に追記する。
- 見せた画面の新側のバージョン（`verify-metadata.json` の `new.tree` の値）を `human_review.tree` に書く。新側を直したら、確認をやり直す。
- 返事をする人がいない実行（非対話・subagent・`--autonomous`）では、確認を飛ばさずに判断待ちとして記録する。承認の記録が無い間は収束しない。

## 承認の記録

デザインの指摘を受け入れた承認と、人による確認の返事と、操作中のエラーの許容の承認は、`verify-metadata.json` の `approvals[]` に 1 件ずつ追記する。
`design_review.findings[].approval` と `human_review.approval` と `runtime_errors.new_signatures[]` の承認の欄は、新側を直して確かめ直すたびに書き直す。
そのため、承認を後から書き換えても、その欄だけでは検出できない。`approvals[]` は追記専用の記録で、既にある要素を消したり書き換えたりしない。

| 承認 | 追記する要素 |
|---|---|
| デザインの指摘を受け入れた | `kind: design_review`・指摘の `id`・点検した新側のバージョン（`tree`）・`approved_by`・`approved_at`・`reason` |
| 人による確認の返事 | `kind: human_review`・見せた新側のバージョン（`tree`）・`verdict`・`approved_by`・`approved_at`・`notes` |
| 操作中のエラーの許容 | `kind: runtime_errors`・署名の `test` と `id`・記録を採った新側のバージョン（`tree`。`compare --tree` で渡した値）・`approved_by`・`approved_at`・`reason` |

- 収束の判定（[`../scripts/convergence-check.mjs`](../scripts/convergence-check.mjs)）は、`design_review`・`human_review`・`runtime_errors` のどれかの承認について、同じ値の要素が `approvals[]` に無ければ、その承認を数えない（`approval` の理由で止まる）。
- `approvals[]` が縮んでいないこと（要素の削除と書き換え）は、`replace-strategy` の `append-only-check.mjs` が確かめる。対象の一覧は `replace-strategy` の `assets/append-only-manifest.json` にある。
  このチェックが検出するのは、比較元（`--base`）のバージョンに在る要素の削除と書き換えだけである。
  比較元より後に積んだ要素の書き換えは、commit した後でも、その比較元での実行では検出しない。
  その要素を承認の欄と一緒に同じ値へ書き換えると、収束の判定も食い違いを見つけないので、どちらのチェックも検出しない。
  そのため、承認を積んだら、その `verify-metadata.json` を commit する。その後の書き換えは、その要素を含む commit を `--base` にした実行で検出できる。
- 収束の判定は、`approvals[]` の中の、`kind` が `runtime_errors`・`design_review`・`human_review` でない要素とオブジェクトでない要素を承認として数えない。
  消せないので止めず、件数を `convergence.checks.approvals.ignored` に残す。
- 操作中のエラーの許容は、承認した人（`approved_by`）を書いた `runtime_errors` の要素とだけ照合する。分類の欄は承認した人を持たないからである。
- 承認の欄（承認した人・日時・理由）が雛形のプレースホルダ（`<...>`）のままなら、収束の判定は 3 つの承認のどれでも書いていないものとして扱う。
- 新側を直して点検や確認をやり直したときも、前のバージョンの要素は残し、新しいバージョンの要素を足す。
  `verify-metadata.json` を雛形から作り直すときも、前の `approvals[]` をそのまま引き継ぐ。
- `approvals[]` をキーごと持たない記録（この記録を始める前のもの）は、承認が積まれていないものとして扱う。利用者に承認し直してもらい、要素を追記する。
