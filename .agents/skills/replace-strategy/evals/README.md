# replace-strategy の回帰テスト

テストケースは [`evals.json`](evals.json)。実行・採点・集計の共通手順は `docs/skill-development.md`「回帰テストを実行する」に従う。

## 前提

実アプリ・DB・ブラウザを要する全フロー（測定〜起票）は使い捨てプロジェクト（空・非対話）では回せない。
そのため本スキルの evals は、**前提が無い環境での停止パス**（依存スキル・MCP 不足、`setup` 未完了）と、
**前提を満たせる部分の挙動**（シークレット値の拒否、成果物からの `status` 導出など）を対象にしている。
`status` の正常系・`issues` の承認ゲート・機能インベントリの分解は、fixture で事前状態（設定・`.replace/`）を用意して検証する。

## 実行例

```bash
scripts/run-skill-eval.sh \
  --skill replace-strategy --config with_skill \
  --prompt "replace-strategy setup" \
  --out tests/replace-strategy/iteration-1/eval-1/with_skill/run-1 \
  --model opus

# fixture 付き eval（evals.json に `fixture` を持つもの）は --fixture で事前状態を使い捨てプロジェクトへコピーして実行する
scripts/run-skill-eval.sh \
  --skill replace-strategy --config with_skill \
  --fixture skills/replace-strategy/evals/fixtures/status-multi-target \
  --prompt "replace-strategy status" \
  --out tests/replace-strategy/iteration-1/eval-6/with_skill/run-1 \
  --model opus
```

- 使い捨てプロジェクトには chrome-devtools MCP が無いため、eval 1 は「導入手順を示して停止する」パスを検証する
- eval 6 の fixture は新側 target を 2 つ（`local-dev` は収束済み・`develop` は未実施かつ `db` 無し）持たせ、環境別の状態導出を検証する。
  `features.md` の Issue 列は未起票のため `gh` 呼び出しは発生しない
- eval 7 の fixture（`issues-approval-gate`）は全件未起票のインベントリを持たせ、**非対話実行では候補・依存関係・本文ドラフトの提示までで止まり起票しない**承認ゲートを検証する
- eval 23 は同じ fixture のページ一覧（2 機能が共同居住）を使い、実依存を保ったページ束の連続順、slug ごとの再実行回数・束の合計・最後の全面比較の事前提示と承認ゲートを検証する
- eval 8 / 9 の fixture（`inventory-multi-page` / `inventory-single-page`）は測定・戦略が完了した状態（`features.md` は未作成）を持たせ、
  **機能の分解基準**（複数ページを 1 機能にまとめる／表示セクションで割らない／単一機能の API を横断 API にしない）を複数ページ・単一ページの両方で検証する
- eval 10 の fixture（`dependency-decision`）は測定・戦略・インベントリまで完了し、**`references.dependency_policy` を持たない**（＝方針未確認）状態を持たせ、
  **依存パッケージの導入判断**（要件 → 素性・ライセンス → 詳細比較の順序、判断材料の記録、方針の要否をユーザーに確認）を検証する。
  fixture 無しでは「`setup` 未完了」で早期停止して判断材料の提示に到達しないため、fixture で到達性を担保している
- eval 15 は fixture 無しで会話だけで判定できる契約（設定キーの**書き手区分**・作業中に増え続ける slug スコープの台帳を設定に置かない・`component_diffs` を設定側に残す根拠・
  スキルキーを跨いだ YAML アンカー共有が課す分割不可制約）を対象にする
- eval 19 の fixture（`features-nonstandard-item`）は、**テンプレートに無いヘッダ項目（`スキーマ Issue: #47`）を利用者が足した features.md** を持たせ、
  4 種に還元できない Issue の記録先（「その他の Issue（4 種以外）」表）・非破壊更新の契約・`status` での扱いを検証する。
  fixture 側にはその項目がテンプレート外である旨も移設先も書かない（書くと baseline がそれを読んで assertion を満たす）
- eval 20 の fixture（`inventory-crosscut-tables`）は測定・戦略が完了した状態を持たせ、**どの機能も所有せず横断 API からしか読まれないテーブル**（`MST_*` 3 つ）が
  インベントリから落ちないことを検証する。fixture・プロンプトのどちらにも「横断 API 表の参照テーブル列に書く」という結論は書かない
  （書くと baseline がそれを読んで assertion を満たす）。機能一覧の列だけを見る実装では 3 テーブルの置き場所が無く落ちるため、弁別が立つ
- eval 21 の fixture（`origin-managed-legacy`）は **`current.origin` キーを持たない**設定（本キー導入前に `setup` を終えたプロジェクト）を持たせ、
  キー欠落＝`managed` として**従来フローが変わらない**こと（`current-environment-bootstrap` へ委譲せず、由来を推測で切り替えないこと）を検証する。
  fixture には由来に関する注記を書かない（書くとベースラインがそれを読んで assertion を満たす）
- eval 22 の fixture（`origin-received-assets`）は `current.origin: received-assets` と `url: none` の current target、受領した DDL だけを持たせ、
  **測定の前に `current-environment-bootstrap` へ委譲し、再構築を代行しない**ことを検証する。
  受領資産を fixture に置くのは、置かないと「再構築を代行しない」が「材料が無いからできない」と区別できないため
- eval 24 は fixture 無しで会話だけで判定できる契約として、**`verification_commands` を走る範囲で `full` / `diff` の 2 列に分けて確定する**こと
  （変更ファイルを渡しているフックのコマンドを機械的に `full` へ入れない・スクリプト側の引数の扱いまで読む・`references.coding_conventions` の項目を「`full` で落ちるか」で仕分けて未検査を記録する）を検証する
- eval 25 の fixture（`inventory-unowned-element`）は測定・戦略が完了した状態を持たせ、**どの機能のセクションにも収まらない可視要素**
  （ヘッダの外部サイト導線）が「ページ要素の帰属」表に残り、スコープ外の方針を理由に記録から落ちないことを検証する。
  1 ページに 2 機能が乗る構成にしてあるため**この要素の所有者は一意に決まらない**——所有者を確定するなら選定根拠、確定しないなら空欄＋候補 slug という
  「根拠の無い暫定値で埋めない」契約（assertion 5）がここで測れる。fixture・プロンプトのどちらにも記録先の表名・所有者の決め方は書かない
  （書くと baseline がそれを読んで assertion を満たす）。
  **assertion 2（配置することと挙動を作らないことの書き分け）は baseline も自前のスコープ表で到達した実測がある**ため、Delta ではなく**後退検知**が目的の項目として残している
- eval 26 の fixture（`features-stale-status-column`）は、**旧版テンプレート由来の「状態」列を持つ features.md**（`open` / `closed` を手書きで持ち、Issue 番号も入っている）を持たせ、
  **状態の根拠をトラッカーへの問い合わせだけに限る**こと（列の値を現況として報告しない・問い合わせに到達できない番号を「判定不能」として open / closed のどちらにも倒さない・列を黙って書き換えない）を検証する。
  使い捨てプロジェクトにはリポジトリが無く問い合わせが必ず失敗するため、**列を読めば「状態が分かる」・読まなければ「判定不能」**という弁別がここで立つ。
  fixture には列が古い旨も「読まない」という結論も書かない（書くと baseline がそれを読んで assertion を満たす）。
  成果物（`strength.md` / `gaps.md`）を持たせてあるのは、判定不能で報告全体を止めず導出を続けることまで測るため
- eval 27 は fixture 無しで会話だけで判定できる契約として、対象ブランチの ruleset 全ページ・全 rule type / classic branch protection から必須 status check と必須 workflow を取得し、
  status check context は実在 check run の name から workflow / job へ、必須 workflow は定義元・版・job の呼び先まで辿って `verification_commands.full` と突き合わせることを検証する。
  prompt には同名 job・matrix 展開・check run 未生成を一次情報として置き、context 文字列から job を推測せず一意な実測対応ができるまで確定しない分岐へ到達させる。
  既知の `Test` / required workflow 欠落を prompt に明示するのは診断当てではなく、
  **差がある状態で確定を拒むこと・共通集約コマンドまたは必須 CI 上の乖離検査まで将来の drift 対策として要求すること**を測るためである
- eval 28 は fixture 無しで、`setup` 手順 11 のプローブ結果（`rendered: 0` の `img`・私用領域のグリフ・本文用とアイコン用の `@font-face`）を与え、「出ない画像は写さない・書体は依存で決定済み・機能ごとに考える」という誘導に対して、
  疑似要素との突き合わせ、依存と別の台帳（`.replace/assets.md`）、書体の行の分離、実装前の一括決定、推測で埋めないこと、同等物を選んだ時点の `may_change` 宣言を検証する（Issue #368）
- eval 29 の fixture（`inventory-request-unit`）は測定・戦略が完了した状態を持たせ、**同じ表・同じ主キー（`REL_PLAN_MEMBER`）を触る 2 画面のうち、入口クエリが読めるのは片方だけ**という構成で、
  機能一覧の「要求単位の根拠」列に実測（母集合・1 行が表すもの）と推定を**口ごとに**書き分けること、**主キーが同じことを根拠に未読側の API を同形として確定しない**ことを検証する。
  推定のまま記録して進む（インベントリの作成自体は止めない）ことも測る。fixture・プロンプトのどちらにも「要求単位」という語も、未入手の範囲を推定と明記せよという指示も、2 画面の API を同形としてよいかの結論も書かない
  （書くと baseline がそれを読んで assertion を満たす）。未読であることは survey の「未測定の項目」と「現行コードの入手性」に一次情報として置く（Issue #376）。
  **1 画面（`/plans`）の中に読める `GET` と要求単位が決まらない更新・削除が同居する構成にしてある**ため、根拠を行に 1 つだけ書く実装では
  「`GET` が実測だから行は実測」となって未確定の口が落ちる——assertion 2 がここを測る（PR #379 の codex レビュー P1 で顕在化した欠陥）。
  **fixture は入口クエリだけを与え、応答への写像（マッパー／シリアライザ）を与えない**ので、assertion 1 は
  「クエリの母集合・行の単位は記録しつつ、それだけで API の外部単位を確定しない」を測る（同 P1 第 3 ラウンド。`(計画, メンバー)` の複数行が `{計画, メンバー: []}` へ畳まれうる）。
  **弁別するのは assertion 1・2**（iteration-31 で実測: `with_skill` 6/6・`without_skill` 3/6。iteration-30 は 6/6・4/6）——baseline は入口クエリの `LEFT JOIN` を読んで NULL 行まで分析し、
  未入手の `/assignments` も自前の gaps 表に載せるため、**assertion 4（同形として確定しない）・5（止めない）・6（単一画面 API を横断 API にしない）は baseline も自力で到達する**。
  **assertion 3（`/assignments` を推定として記録）は run 間でぶれる**——iteration-30 の baseline は独自の「根拠」列を作り `推定（入口クエリ未入手）` と書いて pass したが、
  iteration-31 の baseline が作ったのは「入口クエリ入手性」列（`あり（ソース）` / `無し（未入手）`）で、クエリの入手可否であって口の要求単位の根拠ではないため fail した。
  安定して弁別するのは 1・2 だけで、3〜6 は Delta ではなく**後退検知**が目的の項目として残している。
  スキル固有なのは「口ごとの根拠を機能一覧の列に残し、クエリの粒度を API の外部単位に短絡させない」ことで、そこだけが安定して Delta に出る。
  **assertion 2 の括弧書きは「根拠が同じ口をまとめてよい」という様式側の許可と矛盾しない形にしてある**——
  禁じているのは `GET` の根拠エントリに書き込み系の口を含めることであって、同一根拠の書き込み系どうしをまとめることではない
- eval 30 の fixture（`issues-acceptance-coverage`）は**全行が起票済み**（Issue 列が全て埋まっている）インベントリを持たせ、
  **起票の後に行と受け入れ条件を突き合わせる段**を検証する。`gh` が使えない環境のため各 Issue の受け入れ条件は prompt に貼って被覆集合の材料を与えている。
  仕込んだ欠落は 2 つ——`notification-banner` は Issue 列に `#102` があるが `#102` の受け入れ条件には現れない（**Issue 列を被覆の根拠にすると見つからない**）、
  `order`（`#102`）には横断 API `user` の配線の項が無い。**`report`（`#103`）には同じ配線の項がある**ので、
  assertion 3 は「落ちた配線だけを挙げる」弁別（全 fan-out を無差別に挙げると fail）になる。
  prompt の末尾で `.replace/features.md` への書き戻しを求めているのは assertion 6 の**到達**のため——
  採点材料は `project-files/.replace/features.md` なので、報告だけで終わる run では真偽を測れない。
  列名（`受け入れ条件`）・値の語彙（`未被覆` / 空欄の書き分け）は渡していないので弁別は残る。
  **iteration-32 で実測**（変更確認スコープ・各 config 1 run・claude-code / opus）: `with_skill` 6/6・`without_skill` 4/6。
  **弁別したのは assertion 4・6 だけ**——baseline も `notification-banner` の落ちた行（assertion 1・2）と `order` の落ちた配線（assertion 3）は自力で見つけた。
  fixture の features.md が空の「受け入れ条件」列を持つため、**列を埋めること自体は baseline にも誘導される**（列の存在は新テンプレート由来で、入力から外すと突き合わせの記録先が消える）。
  baseline が落ちたのは、横断の記述を**消費側のゲート**ではなく `#101` 自身の被覆不足として扱った点（assertion 4）と、
  列に Issue 本文の条件を散文で転記して番号・`未被覆`・`配線未達` の書き分けにしなかった点（assertion 6）。
  1 run なので Delta の数値は語らず、**baseline も通った assertion 1〜3・5 は後退検知**の項目として残している
  （assertion 5 は「承認を得てから本文を追記する」で、baseline も `gh` が使えないことを理由に外向き操作を控えたため通った。
  この eval の意味のある Delta は 4・6 の 2 本と数える）
- 採点は `evals.json` の assertions と `result.json` / `project-files/` を突き合わせ、`grading.json` を残す
- 集計（`benchmark.json` / `benchmark.md`）は skill-creator 同梱の `aggregate_benchmark` を使う（詳細は `docs/skill-development.md`）
