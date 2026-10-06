# replace-strategy の回帰テスト

テストケースは [`evals.json`](evals.json)。実行・採点・集計の共通手順は `docs/skill-development.md`「回帰テストを実行する」に従う。

## 前提

実アプリ・DB・ブラウザを要する全フロー（測定〜起票）は、使い捨てプロジェクト（空・非対話）では回せない。
そのため本スキルの evals は、**前提が無い環境での停止パス**（依存スキル・MCP の不足、`setup` 未完了）と、
**前提を満たせる部分の挙動**（シークレット値の拒否、成果物からの `status` の導出など）を対象にしている。
`status` の正常系・`issues` の承認待ちでの停止・機能インベントリの分解は、fixture で事前の状態（設定・`.replace/`）を用意して検証する。

## 実行例

```bash
scripts/eval/run-skill-eval.sh \
  --skill replace-strategy --config with_skill \
  --prompt "replace-strategy setup" \
  --out tests/replace-strategy/iteration-1/eval-1/with_skill/run-1 \
  --model opus

# fixture 付き eval（evals.json に `fixture` を持つもの）は --fixture で事前状態を使い捨てプロジェクトへコピーして実行する
scripts/eval/run-skill-eval.sh \
  --skill replace-strategy --config with_skill \
  --fixture evals/replace-strategy/fixtures/status-multi-target \
  --prompt "replace-strategy status" \
  --out tests/replace-strategy/iteration-1/eval-6/with_skill/run-1 \
  --model opus
```

- 使い捨てプロジェクトには chrome-devtools MCP が無いので、eval 1 は「導入手順を示して停止する」パスを検証する
- eval 6 の fixture は、新側 target を 2 つ（`local-dev` は収束済み・`develop` は未実施かつ `db` 無し）持ち、環境別の状態の導出を検証する。
  `features.md` の Issue 列は未起票なので、`gh` の呼び出しは発生しない
- eval 7 の fixture（`issues-approval-gate`）は、全件未起票のインベントリを持つ。
  **非対話の実行では、候補・依存関係・本文ドラフトの提示までで止まり、起票しない**ことを検証する
- eval 23 は同じ fixture のページ一覧（2 機能が共同居住）を使う。実依存を保ったページ束の連続順と、slug ごとの再実行回数・束の合計・最後の全面比較の事前提示を検証する。
  承認を待って止まることも検証する
- eval 8 / 9 の fixture（`inventory-multi-page` / `inventory-single-page`）は、測定・戦略が完了した状態（`features.md` は未作成）を持つ。
  **機能の分解基準**（複数ページを 1 機能にまとめる／表示セクションで割らない／単一機能の API を横断 API にしない）を、複数ページ・単一ページの両方で検証する
- eval 10 の fixture（`dependency-decision`）は、測定・戦略・インベントリまで完了し、**`references.dependency_policy` を持たない**（＝方針を未確認の）状態を持つ。
  **依存パッケージの導入判断**（要件 → 素性・ライセンス → 詳細比較の順序、判断材料の記録、方針の要否をユーザーに確認）を検証する。
  fixture 無しでは「`setup` 未完了」で早期に停止し、判断材料の提示に到達しないので、fixture で到達できるようにしている
- eval 15 は fixture 無しで、会話だけで判定できる取り決めを対象にする。
  設定キーの**書き手の区分**、作業中に増え続ける slug スコープの台帳を設定に置かないこと、`component_diffs` を設定側に残す根拠、
  スキルキーをまたいだ YAML アンカーの共有が課す分割できない制約、の 4 つである
- eval 19 の fixture（`features-nonstandard-item`）は、**テンプレートに無いヘッダ項目（`スキーマ Issue: #47`）を利用者が足した features.md** を持つ。
  4 種に還元できない Issue の記録先（「その他の Issue（4 種以外）」表）・非破壊の更新の取り決め・`status` での扱いを検証する。
  fixture 側には、その項目がテンプレートの外である旨も、移設先も書かない（書くと baseline がそれを読んで assertion を満たす）
- eval 20 の fixture（`inventory-crosscut-tables`）は、測定・戦略が完了した状態を持つ。
  **どの機能も所有せず、横断 API からしか読まれないテーブル**（`MST_*` 3 つ）がインベントリから落ちないことを検証する。
  fixture・プロンプトのどちらにも、「横断 API 表の参照テーブル列に書く」という結論は書かない（書くと baseline がそれを読んで assertion を満たす）。
  機能一覧の列だけを見る実装では 3 テーブルの置き場所が無く落ちるので、差が出る
- eval 21 の fixture（`origin-managed-legacy`）は、**`current.origin` キーを持たない**設定（このキーを導入する前に `setup` を終えたプロジェクト）を持つ。
  キーの欠落を `managed` として扱い、**従来のフローが変わらない**ことを検証する。`current-environment-bootstrap` へ委譲せず、由来を推測で切り替えないことである。
  fixture には由来に関する注記を書かない（書くとベースラインがそれを読んで assertion を満たす）
- eval 22 の fixture（`origin-received-assets`）は、`current.origin: received-assets` と `url: none` の current target、受領した DDL だけを持つ。
  **測定の前に `current-environment-bootstrap` へ委譲し、再構築を代行しない**ことを検証する。
  受領資産を fixture に置くのは、置かないと「再構築を代行しない」と「材料が無いからできない」を区別できないためである
- eval 24 は fixture 無しで会話だけで判定できる取り決めとして、**`verification_commands` を、実行する範囲で `full` / `diff` の 2 列に分けて確定する**ことを検証する。
  変更ファイルを渡しているフックのコマンドを機械的に `full` へ入れないこと、スクリプト側の引数の扱いまで読むこと、
  `references.coding_conventions` の項目を「`full` で落ちるか」で仕分けて未検査を記録すること、の 3 つである
- eval 25 の fixture（`inventory-unowned-element`）は、測定・戦略が完了した状態を持つ。
  **どの機能のセクションにも収まらない可視要素**（ヘッダの外部サイトへの導線）が「ページ要素の帰属」表に残り、スコープ外の方針を理由に記録から落ちないことを検証する。
  1 ページに 2 機能が乗る構成にしてあるので、**この要素の所有者は一意に決まらない**。
  そのため、「根拠の無い暫定値で埋めない」取り決め（assertion 5）をここで測れる。所有者を確定するなら選定の根拠を、確定しないなら空欄＋候補 slug を書く。
  fixture・プロンプトのどちらにも、記録先の表名・所有者の決め方は書かない（書くと baseline がそれを読んで assertion を満たす）。
  **assertion 2（配置することと、挙動を作らないことの書き分け）は、baseline も自前のスコープ表で到達した実測がある**。
  そのため、Delta ではなく**後退の検知**が目的の項目として残している
- eval 26 の fixture（`features-stale-status-column`）は、**旧版のテンプレート由来の「状態」列を持つ features.md**（`open` / `closed` を手書きで持ち、Issue 番号も入っている）を持つ。
  **状態の根拠を、トラッカーへの問い合わせだけに限る**ことを検証する。列の値を現況として報告しないこと、
  問い合わせに到達できない番号を「判定不能」として open / closed のどちらとも判定しないこと、列を警告なしに書き換えないこと、の 3 つである。
  使い捨てプロジェクトにはリポジトリが無く、問い合わせが必ず失敗する。そのため、**列を読めば「状態が分かる」、読まなければ「判定不能」**という差がここで出る。
  fixture には、列が古い旨も「読まない」という結論も書かない（書くと baseline がそれを読んで assertion を満たす）。
  成果物（`strength.md` / `gaps.md`）を持たせてあるのは、判定不能でも報告全体を止めずに導出を続けることまで測るためである
- eval 27 は fixture 無しで、会話だけで判定できる取り決めを検証する。
  対象ブランチの ruleset の全ページ・全 rule type / classic branch protection から、必須 status check と必須 workflow を取得する。
  status check の context は、実在する check run の name から workflow / job へたどる。
  必須 workflow は、定義元・版・job の呼び先までたどる。そのうえで `verification_commands.full` と突き合わせることを検証する。
  prompt には同名の job・matrix の展開・check run の未生成を一次情報として置き、context の文字列から job を推測せず、一意な実測の対応ができるまで確定しない分岐へ到達させる。
  既知の `Test` / required workflow の欠落を prompt に明示するのは、診断を当てさせるためではない。
  **差がある状態で確定を拒むこと、共通の集約コマンドまたは必須 CI 上の乖離の検査まで、将来の drift への対策として要求すること**を測るためである
- eval 28 は fixture 無しで、`setup` 手順 11 のプローブの結果（`rendered: 0` の `img`・私用領域のグリフ・本文用とアイコン用の `@font-face`）を与える。
  そのうえで、「出ない画像はコピーしない・書体は依存で決定済み・機能ごとに考える」という誘導に対して、次を検証する（Issue #368）。
  疑似要素との突き合わせ、依存と別の台帳（`.replace/assets.md`）、書体の行の分離、実装前の一括決定、推測で埋めないこと、同等物を選んだ時点の `may_change` の宣言である
- eval 29 の fixture（`inventory-request-unit`）は、測定・戦略が完了した状態を持つ。
  **同じ表・同じ主キー（`REL_PLAN_MEMBER`）を触る 2 画面のうち、起点のクエリが読めるのは片方だけ**という構成である。
  機能一覧の「要求単位の根拠」列に、実測（母集合・1 行が表すもの）と推定を**口ごとに**書き分けること、**主キーが同じことを根拠に、未読側の API を同形として確定しない**ことを検証する。
  推定のまま記録して進む（インベントリの作成自体は止めない）ことも測る。
  fixture・プロンプトのどちらにも、「要求単位」という語も、未入手の範囲を推定と明記せよという指示も、2 画面の API を同形としてよいかの結論も書かない
  （書くと baseline がそれを読んで assertion を満たす）。未読であることは、survey の「未測定の項目」と「現行コードの入手性」に一次情報として置く（Issue #376）。
  **1 画面（`/plans`）の中に、読める `GET` と、要求単位が決まらない更新・削除が同居する構成にしてある**。
  そのため、根拠を行に 1 つだけ書く実装では、「`GET` が実測だから行は実測」となって未確定の口が落ちる。assertion 2 がここを測る（PR #379 の codex レビュー P1 で表に出た欠陥）。
  **fixture は起点のクエリだけを与え、応答への変換（マッパー／シリアライザ）を与えない**。
  そのため assertion 1 は、「クエリの母集合・行の単位は記録しつつ、それだけで API の外部単位を確定しない」を測る
  （同じ P1 の第 3 ラウンド。`(計画, メンバー)` の複数行が `{計画, メンバー: []}` へ畳まれうる）。
  **差が出るのは assertion 1・2** である（iteration-31 で実測: `with_skill` 6/6・`without_skill` 3/6。iteration-30 は 6/6・4/6）。
  baseline は起点のクエリの `LEFT JOIN` を読んで NULL 行まで分析し、未入手の `/assignments` も自前の gaps 表に載せる。
  そのため、**assertion 4（同形として確定しない）・5（止めない）・6（単一画面の API を横断 API にしない）は、baseline も自力で到達する**。
  **assertion 3（`/assignments` を推定として記録）は run の間でぶれる**。
  iteration-30 の baseline は独自の「根拠」列を作り、`推定（入口クエリ未入手）` と書いて pass した。
  iteration-31 の baseline が作ったのは `入口クエリ入手性` 列（`あり（ソース）` / `無し（未入手）`）で、クエリの入手の可否であって、口の要求単位の根拠ではないので fail した。
  安定して差が出るのは 1・2 だけで、3〜6 は Delta ではなく、**後退の検知**が目的の項目として残している。
  スキル固有なのは、「口ごとの根拠を機能一覧の列に残し、クエリの粒度を API の外部単位に短絡させない」ことで、そこだけが安定して Delta に出る。
  **assertion 2 の括弧書きは、「根拠が同じ口をまとめてよい」という様式側の許可と矛盾しない形にしてある**。
  禁じているのは `GET` の根拠のエントリに書き込み系の口を含めることであって、同じ根拠の書き込み系どうしをまとめることではない
- eval 30 の fixture（`issues-acceptance-coverage`）は、**全行が起票済み**（Issue 列が全て埋まっている）のインベントリを持つ。
  **起票の後に、行と受け入れ条件を突き合わせる段**を検証する。`gh` が使えない環境なので、各 Issue の受け入れ条件は prompt に貼って、引き受け集合の材料を与えている。
  仕込んだ欠落は 2 つある。1 つ目は `notification-banner` で、Issue 列に `#102` があるが、`#102` の受け入れ条件には現れない（**Issue 列を引き受けの根拠にすると見つからない**）。
  2 つ目は `order`（`#102`）で、横断 API `user` の呼び出しの項が無い。**`report`（`#103`）には同じ呼び出しの項がある**ので、
  assertion 3 は「落ちた呼び出しだけを挙げる」ことで差が出る（全 fan-out を区別なく挙げると fail）。
  **iteration-32 の実測は、assertion 2 を変更する前のもの**である（塞ぎ方を「#102 へ足す / 別 Issue」の両方で可としていた）。
  機能行が Issue 番号を共有しない規則を足したので、assertion 2 を「別 Issue を起こす」へ狭め、番号の共有の検出を assertion 7 として追加した。
  **assertion を変えたので、既存の run は再利用せずに再取得する**（`docs/skill-development.md`「without-skill baseline の再利用」）。
  旧 run はその規則を持たない版のスキルで実行しており、読み直して採点すると旧仕様を固定することになる。
  **iteration-36 で実測**（変更確認のスコープ・各 config 1 run・claude-code / opus）: `with_skill` 7/7・`without_skill` 4/7。
  baseline は contamination: clean / isolation: sandboxed。**差が出たのは assertion 2・6・7** である。
  **iteration-39 で再実測**（fixture の横断 API 行の根拠を、口の明示的な列挙へ変えたため。同じスコープ）: `with_skill` 7/7・`without_skill` 3/7。
  **差が出たのは assertion 4・5・6・7** である。baseline は、落ちた行・落ちた呼び出しまでは自力で挙げる。
  しかし、「全機能から使われる」が消費側の確認にならない理由・本文への追記の承認・受け入れ条件列の書き分け・番号を共有した結果には届かない。
  iteration-36 で pass した assertion 2 は今回も pass で、差の出どころは run の間でぶれる（1 run なので Delta の数値は語らない）。
  baseline は `#102` への相乗りを見つけながら、「**原因は相乗りそのものではなく、相乗り先の受け入れ条件が主機能の slug 名で書かれている点**」と書いた。
  そして、「案 B: 相乗り維持」を実行できる選択肢として残した（assertion 2・7 が赤くなった理由）。assertion 1・3・4・5 は baseline も到達する。
  実測で見えた揺れがある。`with_skill` は受け入れ条件列へ `被覆（#102）／配線未記載: user` と書き、
  原本が定める値の形（`#102（呼び出し未達: user）`）とは違う独自の表記になった。書き分け自体は満たすが、
  **値の形を原本どおりに書かせるには、記述か assertion を締める必要がある**（未対応）。
  prompt の末尾で `.replace/features.md` への書き戻しを求めているのは、assertion 6 に**到達**させるためである。
  採点材料は `project-files/.replace/features.md` なので、報告だけで終わる run では真偽を測れない。
  列名（`受け入れ条件`）・値の語彙（`未対応` / 空欄の書き分け）は渡していないので、差は残る。
  **（以下は、assertion 2 を狭めて 7 を追加する前＝6 assertion の版の履歴である。現行の評価は上の iteration-36 を見る。この段落を現行の eval の根拠に使わない）**
  iteration-32: `with_skill` 6/6・`without_skill` 4/6 で、差が出たのは当時の assertion 4・6 だけだった。
  当時から変わらない観察は 2 つある。1 つは、fixture の features.md が空の「受け入れ条件」列を持つので、**列を埋めること自体は baseline にも誘導される**ことである。
  もう 1 つは、baseline が横断の記述を、**消費側の確認**ではなく `#101` 自身の引き受けの不足として扱いがちなことである。
- eval 31 の fixture（`issues-acceptance-part-coverage`）は、**全行が起票済みで、受け入れ条件が行の一部しか名指ししていない状態**を持つ。
  eval 30 が作らない 3 つの分岐を検証する。**部分（ページ ＋ 新規実装の API の口）の集合差分**、**否定の言及を引き受けに数えない**こと、**呼び出しの欠落**である。
  仕込みは 3 つある。
  1 つ目は `#210` で、`order` の `/orders` と `GET /api/orders` しか名指ししておらず、`/orders/:id` と `GET /api/orders/:id` が落ちた部分になる。
  2 つ目は `#212`（`report`）で、横断 API `user` の呼び出しの項が無い（**#210 にはある**）。
  3 つ目は `notification-banner` で、`#210` の受け入れ条件に「対象外」として**現れるだけ**である（出現を引き受けに数えると、落ちた行が消える）。
  assertion 2・4 は、正常な側（部分を覆えている `report`・呼び出しの項がある `#210`）を挙げないことまで見て、差を出す。
  **fixture は取り決めに適合する状態にする**。横断 API 表は 2 つ以上の機能が使うリソースだけを載せる規則なので、
  `user` の fan-out は `order` と `report` の 2 件にしてある。起票の単位は行（ページ単位の分割は Issue 内のフェーズ）なので、
  **1 行に複数の Issue 番号を置く fixture は作らない**（`parity-replace` は行の Issue 番号 1 つでブランチを作る取り決め）。
  **iteration-35 で実測**（変更確認のスコープ・各 config 1 run・claude-code / opus）: `with_skill` 5/5・`without_skill` 4/5。
  **差が出たのは assertion 5 だけ**である。baseline も 3 つの抜け（落ちた行・落ちた部分・落ちた呼び出し）を自力で挙げ、正常な側も挙げなかった。
  落ちたのは記録の形で、受け入れ条件列に Issue 本文の条件文と `⚠ …（取りこぼし B）` の注記を書き、
  `notification-banner` の **Issue 列**まで `未割当` に書き換えている。
  **assertion 1〜4 はガードではない。変異させた run で実証した**（iteration-38・`with_skill` × 3 軸）。
  **iteration-39 で再実測**（fixture の根拠列を「両方 →」から口の明示的な列挙へ変えたため。変更確認・各 config 1 run・claude-code / opus）: `with_skill` 5/5・`without_skill` 4/5 で、iteration-35 と同じだった。
  差が出たのも assertion 5 のままで、baseline は再び受け入れ条件列へ条件の本文を転記し、**Issue 列**を書き換えた（記録の形だけが安定した Delta である、という読みが 2 回の実測で一致した）。
  各軸の判定の記述を `SKILL.md` / `references/features-issues.md` / `references/status.md` の**全出現から削除**したスキルに、同じ入力を与えて実行した結果は次のとおりである。

  | 変異した軸 | 赤くなった assertion |
  |---|---|
  | 引き受けの判定（出現ではなく引き受けの形だけを数える） | **0 本**（5/5 のまま） |
  | 部分の集合差分 | **assertion 5 のみ**（列の `（未被覆: …）` の併記が消えた。判断自体は語彙を変えて到達） |
  | 呼び出しの検査 | **0 本**（5/5 のまま） |

  つまりこの eval が測れているのは、**到達できるか**と**記録の形**（assertion 5）だけで、判定の記述の有無は結論を変えない。
  prompt に貼った受け入れ条件から、モデルが同じ欠落を自力で導いてしまう。
  **1 回目の変異（iteration-37）は `features-issues.md` の 1 か所しか消しておらず、同じ判断が他のファイルに残っていたので、無効**として破棄した
  （変異は軸ごとに全出現を消し、残っていないことを grep で確かめてから実行する）。
  判断そのものをガードしたいなら、**prompt から結論の材料を減らす**か、**決定論的な検査のスクリプト**（インベントリと Issue 本文を読んで差分を出すもの）へ上げる必要がある。
  iteration-33 / 34 は「1 行を複数の Issue へ割る」前提の fixture で、その前提を原本から外したので作り直した
- eval 32 の fixture（`evidence-writeback`）は、**起票済みで実装に入る直前**のインベントリを持ち、`evidence` モード（確定した要求単位の根拠の書き戻し）を検証する。
  `plan` の 4 つの口のうち `GET` だけが `実測` で、`POST` / `PATCH` / `DELETE` が `推定` として並んでいる。prompt は、実装者が現行コードを読んだ報告だけを与える。
  **どれを昇格させてよいか、どれが口の見直しに当たるかは書かない**（書くと baseline がそれを読んで assertion を満たす）。差が出るように仕込んだ点は 3 つある。
  `POST` は要求の組み立てとハンドラの両方が読めており、**そのまま昇格する**。`PATCH` は**画面側しか読めていない**ので、昇格させてはならない。
  `DELETE` は両方とも読めているが、**確定した単位（複数件を 1 要求・全戻し）を、`:id` をパスに持つ口では再現できない**。そのため、根拠の更新ではなく口の見直しへ回す必要がある。
  `assignment` 行と横断 API 行を、**触ってはいけない対照**として置いてある。セル単位・行単位でまとめて昇格させる実装は、assertion 1 で落ちる。
  **fixture の `current.repo` は実在するパス**にしてある。`none`（現行コードを入手できない）のままだと、
  「現行コードを読んだ」という prompt の前提と設定が矛盾し、設定を読むスキルが前提を問い返して assertion に到達しない。
  **iteration-40 で再実測**（`current.repo` を直した後の入力。変更確認・各 config 1 run・claude-code / opus）: `with_skill` 5/5・`without_skill` 2/5 で、
  iteration-39（修正前の入力）と同じだった。**差が出たのも同じ assertion 1・3・5** で、baseline は再び `DELETE` の食い違いをセルの本文に書きながら、根拠を `実測` へ昇格させた。
  設定の矛盾は、baseline の到達に影響していなかったことになる（前提を問い返さずに答えていた）。baseline は contamination: clean / isolation: sandboxed。
  **差が出たのは assertion 1・3・5** である。baseline は `DELETE` の食い違いをセルの本文に書きながら、**その根拠を `実測` へ昇格させた**（口の形が再現できないことを認めたうえで、確定扱いにした）。
  `PATCH` を推定のまま残すこと（assertion 2）と、口の見直しへ回すこと（assertion 4）は baseline も自力で到達するので、この 2 つは Delta ではなく、後退の検知の項目として残す
- eval 33（Issue #414）は、手順 10 の**洗い出しの網羅**を測る。fixture は eval 10 と同じ `dependency-decision`（測定・戦略・インベントリまで完了）を使う。
  fixture 無しでは「`setup` 未完了」で早期に停止し、洗い出しの進め方に到達しない（eval 10 と同じ理由）。
  prompt は「共通で使う部品を洗い出したい」と、ソースの grep で十分かを念押しする問いだけを与える。
  **assertion 1 が求める種類名（セレクト・ページネーション・モーダルダイアログ・トースト通知）は 1 つも書かない**（書くと baseline がそれを読み上げて assertion を満たす）。
  prompt に置いた種類名は、新側で採る候補の「データグリッド」だけで、これは assertion 4（内蔵の部品の二重作成）の材料として意図的に与えている。差が出るように仕込んだ点は 3 つある。
  基盤の種類だけでなく、個々のプリミティブを列挙すること（assertion 1）。ページを実際に開いて確かめ、ソースの grep で済ませないこと（assertion 2）。
  該当なしを空欄にせず記録すること（assertion 3）。候補のデータグリッドを置いてあるので、内蔵の部品を単独の行として二重に作る回答は assertion 4 で落ちる。
  **iteration-41 で実測**（各 config 1 run・claude-code / opus）: `with_skill` 5/5・`without_skill` 0/5 で、**全 assertion で差が出た**。
  縮小（Issue #428 への切り出し）で、assertion 4 を台帳の値（`内蔵`）に依らない文言へ直した。**prompt と fixture は変えていない**ので実行し直さず、
  同じ run の応答を新しい文言で採点し直した（採点基準の変更であって、入力の変更ではない。結果は 5/5・0/5 のまま）。
  baseline は、洗い出しを npm の依存（`package.json` / lock・推移依存・env 変数・外部 API）の棚卸しとして組み立て、UI プリミティブの区分・種類を 1 つも挙げなかった。
  grep だけでは足りないとは述べるが、代替は「マニフェストを起点に列挙 → grep で裏取り」で、ページを開く方法へ移らない。baseline は contamination: clean / isolation: sandboxed。
  **assertion 4 の差は、「行選択チェックボックス」という語では取れていない**。共用の fixture の `survey.md` が、名前の無い代表例として
  この語をすでに持っており（`dependency-decision/.replace/survey.md`）、baseline も実際にそれを使った。差を出しているのは語ではなく扱いである
  （内蔵として単体の部品と二重に作らない、内蔵の判定は新側の候補で決まるので採否の確定後に当て直す）。baseline はその語をロケータの方針の文脈で使い、assertion 4 に到達していない。
  この eval を触るときは、assertion 4 を語の一致で採点しない（fixture 側にある語なので、一致だけでは skill の寄与にならない）。
  **未対応**: 「初期表示に出ない種類は、状態を作ってから判定する」「`forbidden_actions` を確かめてから操作する」は assertion に入っていない。次にこの eval を触るときの候補である。
  台帳の状態値（`内蔵` / `機能固有` / `未確認`）は Issue #428 へ切り出したので、この eval の対象ではない
- eval 34（Issue #419）は、手順 8 で `intentional_diffs.pending` を書くときの**帰属の形**を測る。
  fixture（`pending-writer-at-setup`）は、測定・戦略が完了して **`features.md` が無い**（slug が未採番の）状態と、`references.db_semantics` の下書きを持つ。
  下書きは、点検項目 5 節のうち NULL の並び順と照合順序だけが、新 DB 側で「未実測」になっている。
  この 2 つが揃っていないと、「採番前だから `cross-cutting`」と「未実測だから保留」のどちらも材料が無く、判定できない。fixture には `pending` の書き方も許可値も書かない。
  `references` には、この eval の判断に要る `db_semantics` だけを置いてある。`setup` が本来キーごと生成する残りのパス型のキーは省いた最小の構成で、
  姉妹の fixture の `inventory-multi-page` も `references` を持たない。
  **そのため、この fixture を他の eval へ流用するときは、そのキーの有無が判断材料になる eval には使えない**。
  prompt は「機能インベントリはこの後の手順なのでまだ無い」状態を明示し、**`added_by` / `slug` / `cross-cutting` の語も許可値も書かない**。差が出るように仕込んだ点は 2 つある。
  書き手として自分の名前を書くこと（assertion 3。空欄・`unknown`・下流のスキル名は、いずれも帰属不明と判定されてしまう）と、
  採番前なので `cross-cutting` にすること（assertion 4。採番前の slug を推測で書く回答が落ちる）である。
  **iteration-41 で実測**（各 config 1 run・claude-code / opus）: `with_skill` 5/5・`without_skill` 2/5。**差が出たのは assertion 2・3・4** である。
  baseline は、`pending` へ 2 件に分けて置くこと（assertion 1）と、確定を実測後の人の判断に任せること（assertion 5）には自力で到達する。
  しかし、要素を `id` / `ref` / `current` / `new` / `resolve_by` / `impact` / `gate` の**自作のスキーマ**で書き、`added_by` も `slug` も持たない（「キー名はスキル定義に合わせてください」と断っている）。
  assertion 1・5 は Delta ではなく、後退の検知の項目として残す。baseline は contamination: clean / isolation: sandboxed
- eval 35（Issue #428）は、手順 10 の洗い出しで**採否に至らない 3 つの結果**（内蔵・機能固有・未確認）の記録先を測る。
  fixture（`component-primitive-states`）は、測定・戦略・インベントリが完了し、**データグリッドの採用が決まった `.replace/dependencies.md`** を持つ。
  「採る候補が決まっている」状態が無いと、`内蔵` の判定材料が揃わない。現行 target の `forbidden_actions` に削除・更新を置いて、確認ダイアログを出せない状態を作る。
  fixture には値の語彙も、列の意味のコメントも書かない（書くとベースラインが読んで埋める）。
  差が出るように仕込んだ点は 3 つある。
  1 つ目は、3 件とも**台帳の行として残す**こと（assertion 4。報告だけで済ませる回答が落ちる）。
  2 つ目は、確かめられなかった種類を `該当なし` として扱わないこと（assertion 1）。
  3 つ目は、`--autonomous` でも**保留にせずに `setup` を完了できる**こと（assertion 5。保留にする回答は下流を全部止める）。
  **iteration-42 で実測**（各 config 1 run・claude-code / opus）: `with_skill` 5/5・`without_skill` 1/5。**差が出たのは assertion 2・3・4・5** である。
  baseline は、確認ダイアログを `該当なし` として扱わない（assertion 1）ところまでは自力で到達する。
  しかし、行選択チェックボックスは**行を作らず**データグリッドの節へ追記し（「独立行を立てると二重計上」）、印刷プレビューは「自前実装なら自律的に確定してよい」とした。
  確認ダイアログは `pending_decisions` へ入れて、「保留 2 件を setup 完了報告に列挙する」と締めた。
  assertion 1 は Delta ではなく、後退の検知の項目として残す。baseline は contamination: clean / isolation: sandboxed
- eval 36（Issue #451）は fixture `issues-approval-gate` を使い、機能 order の Issue 本文ドラフトの受け入れ条件が、
  「新側スイート green」と「`verification_commands.full`」の 2 つで足りるかを問う。受け入れ条件に `parity-diff` の収束（`converged: true`）を入れること・
  スイートが見た目を見ない理由・承認前に起票しないことを検証する。prompt は「見た目も含めて一致と言えるはず」という誤った前提を置き、結論は書かない。
  assertion 3 は、prompt が起票を止めているので差を出すことは狙わず、後退の検知の項目として置く
  **iteration-43 で実測**（各 config 1 run・claude-code / opus）: `with_skill` 3/3・`without_skill` 1/3。**差が出たのは assertion 1・2** である。
  baseline も、スイート green が見た目の一致を示さないことには自力で気付く。しかし受け入れ条件には「スクリーンショット比較などの視覚差分チェック」を置き、
  `parity-diff` の収束（`converged: true`）には至らなかった。baseline は contamination: clean / isolation: sandboxed
- 採点は `evals.json` の assertions と `result.json` / `project-files/` を突き合わせ、`grading.json` を残す
- 集計（`benchmark.json`）は `node scripts/eval/build-skill-eval-benchmark.js` で生成する（判定は assertion テキストで突き合わせる。`benchmark.md` は人が書く。詳細は `docs/skill-development.md`）
