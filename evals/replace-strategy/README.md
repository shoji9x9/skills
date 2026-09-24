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
  --fixture evals/replace-strategy/fixtures/status-multi-target \
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
  **iteration-32 の実測は assertion 2 の変更前のもの**（塞ぎ方を「#102 へ足す / 別 Issue」の両可としていた）。
  機能行が Issue 番号を共有しない規則を足したため assertion 2 を「別 Issue を起こす」へ狭め、番号共有の検出を assertion 7 として追加した。
  **assertion を変えたので既存 run は再利用せず取り直す**（`docs/skill-development.md`「without-skill baseline の再利用」）——
  旧 run はその規則を持たない版のスキルで走っており、読み直して採点すると旧仕様を固定することになる。
  **iteration-36 で実測**（変更確認スコープ・各 config 1 run・claude-code / opus）: `with_skill` 7/7・`without_skill` 4/7。
  baseline は contamination: clean / isolation: sandboxed。**弁別したのは assertion 2・6・7**。
  **iteration-39 で再実測**（fixture の横断 API 行の根拠を口の明示列挙へ変えたため。同スコープ）: `with_skill` 7/7・`without_skill` 3/7。
  **弁別は assertion 4・5・6・7**——baseline は落ちた行・落ちた配線までは自力で挙げるが、
  「全機能から使われる」が消費側のゲートにならない理由・本文追記の承認・受け入れ条件列の書き分け・番号共有の帰結には届かない。
  iteration-36 で pass した assertion 2 は今回も pass で、差の出どころは run 間でぶれる（1 run なので Delta の数値は語らない）。
  baseline は `#102` への相乗りを見つけながら「**原因は相乗りそのものではなく、相乗り先の受け入れ条件が主機能の slug 名で書かれている点**」と書き、
  「案 B: 相乗り維持」を実行可能な選択肢として残した（assertion 2・7 が赤くなった理由）。assertion 1・3・4・5 は baseline も到達する。
  実測で見えた揺れ: `with_skill` は受け入れ条件列へ `被覆（#102）／配線未記載: user` と書き、
  正本が定める値の形（`#102（配線未達: user）`）とは違う独自表記になった。書き分け自体は満たすが、
  **値の形を正本どおりに書かせるには記述か assertion を締める必要がある**（未対応）。
  prompt の末尾で `.replace/features.md` への書き戻しを求めているのは assertion 6 の**到達**のため——
  採点材料は `project-files/.replace/features.md` なので、報告だけで終わる run では真偽を測れない。
  列名（`受け入れ条件`）・値の語彙（`未被覆` / 空欄の書き分け）は渡していないので弁別は残る。
  **（以下は assertion 2 を狭め 7 を追加する前＝6 assertion 版の履歴。現行の評価は上の iteration-36 を見る。この段落を現行 eval の根拠に使わない）**
  iteration-32: `with_skill` 6/6・`without_skill` 4/6、弁別は当時の assertion 4・6 のみ。
  当時から変わらない観察は 2 つ——fixture の features.md が空の「受け入れ条件」列を持つため**列を埋めること自体は baseline にも誘導される**こと、
  baseline は横断の記述を**消費側のゲート**ではなく `#101` 自身の被覆不足として扱いがちなこと。
- eval 31 の fixture（`issues-acceptance-part-coverage`）は**全行が起票済みで、受け入れ条件が行の一部しか名指ししていない状態**を持たせ、
  eval 30 が作らない 3 つの分岐を検証する——**部分（ページ ＋ 新規実装 API の口）の集合差分**・**否定の言及を被覆に数えない**・**配線の欠落**。
  仕込みは 3 つ: `#210` は `order` の `/orders` と `GET /api/orders` しか名指ししておらず `/orders/:id` と `GET /api/orders/:id` が落ちた部分、
  `#212`（`report`）には横断 API `user` の配線項が無い（**#210 にはある**）、
  `notification-banner` は `#210` の受け入れ条件に「対象外」として**現れるだけ**（出現を被覆に数えると落ちた行が消える）。
  assertion 2・4 は正常な側（部分を覆えている `report`・配線のある `#210`）を挙げないことまで見る弁別になっている。
  **fixture は契約に適合する状態にする**——横断 API 表は 2 つ以上の機能が使うリソースだけを載せる規則なので、
  `user` の fan-out は `order` と `report` の 2 件にしてある。起票の単位は行（ページ単位の分割は Issue 内のフェーズ）なので、
  **1 行に複数の Issue 番号を置く fixture は作らない**（`parity-replace` は行の Issue 番号 1 つでブランチを作る契約）。
  **iteration-35 で実測**（変更確認スコープ・各 config 1 run・claude-code / opus）: `with_skill` 5/5・`without_skill` 4/5。
  **弁別したのは assertion 5 だけ**——baseline も 3 つの穴（落ちた行・落ちた部分・落ちた配線）を自力で挙げ、正常側も挙げなかった。
  落ちたのは記録の形で、受け入れ条件列に Issue 本文の条件文と `⚠ …（取りこぼし B）` の注記を書き、
  `notification-banner` の **Issue 列**まで `未割当` に書き換えている。
  **assertion 1〜4 はガードではない——変異 run で実証した**（iteration-38・`with_skill` × 3 軸）。
  **iteration-39 で再実測**（fixture の根拠列を「両方 →」から口の明示列挙へ変えたため。変更確認・各 config 1 run・claude-code / opus）: `with_skill` 5/5・`without_skill` 4/5 で iteration-35 と同じ。
  弁別も assertion 5 のままで、baseline は再び受け入れ条件列へ条件本文を転記し **Issue 列**を書き換えた（記録の形だけが安定した Delta である、という読みが 2 回の実測で一致した）。
  各軸の判定記述を `SKILL.md` / `references/features-issues.md` / `references/status.md` の**全出現から削除**したスキルで同じ入力を走らせた結果:

  | 変異した軸 | 赤くなった assertion |
  |---|---|
  | 引き受け判定（出現ではなく引き受けの形だけを数える） | **0 本**（5/5 のまま） |
  | 部分の集合差分 | **assertion 5 のみ**（列の `（未被覆: …）` 併記が消えた。判断自体は語彙を変えて到達） |
  | 配線の検査 | **0 本**（5/5 のまま） |

  つまりこの eval が測れているのは**到達性**と**記録の形**（assertion 5）だけで、判定記述の有無は結論を変えない——
  prompt に貼った受け入れ条件から、モデルが同じ欠落を自力で導いてしまう。
  **1 回目の変異（iteration-37）は `features-issues.md` の 1 箇所しか消しておらず、同じ判断が他ファイルに残っていたため無効**として破棄した
  （変異は軸ごとに全出現を消し、残存を grep で確認してから走らせる）。
  判断そのものをガードしたいなら、**prompt から結論の材料を減らす**か、**決定論的な検査器**（インベントリと Issue 本文を読んで差分を出すスクリプト）へ上げる必要がある。
  iteration-33 / 34 は「1 行を複数 Issue へ割る」前提の fixture で、その前提を正本から外したため作り直した
- eval 32 の fixture（`evidence-writeback`）は**起票済みで実装に入る直前**のインベントリを持たせ、`evidence` モード（確定した要求単位の根拠の書き戻し）を検証する。
  `plan` の 4 口のうち `GET` だけが `実測` で、`POST` / `PATCH` / `DELETE` が `推定` として並んでいる。prompt は実装者が現行コードを読んだ報告だけを与え、
  **どれを昇格させてよいか・どれが口の見直しに当たるかは書かない**（書くと baseline がそれを読んで assertion を満たす）。仕込んだ弁別は 3 つ——
  `POST` は要求の組み立てとハンドラの両方が読めており**そのまま昇格する**、`PATCH` は**画面側しか読めていない**ので昇格させてはならない、
  `DELETE` は両方読めているが**確定した単位（複数件を 1 要求・全戻し）が `:id` を経路に持つ口では再現できない**ため、根拠の更新ではなく口の見直しへ回す必要がある。
  `assignment` 行と横断 API 行を**触ってはいけない対照**として置いてあるので、セル単位・行単位でまとめて昇格させる実装は assertion 1 で落ちる。
  **fixture の `current.repo` は実在するパス**にしてある——`none`（現行コードを入手できない）のままだと、
  「現行コードを読んだ」という prompt の前提と設定が矛盾し、設定を読むスキルが前提を問い返して assertion に到達しない。
  **iteration-40 で再実測**（`current.repo` を直した後の入力。変更確認・各 config 1 run・claude-code / opus）: `with_skill` 5/5・`without_skill` 2/5 で、
  iteration-39（修正前の入力）と同じ。**弁別も同じ assertion 1・3・5** で、baseline は再び `DELETE` の食い違いをセル本文に書きながら根拠を `実測` へ昇格させた。
  設定の矛盾は baseline の到達性に効いていなかったことになる（前提を問い返さずに答えていた）。baseline は contamination: clean / isolation: sandboxed。
  **弁別したのは assertion 1・3・5**——baseline は `DELETE` の食い違いをセルの本文に書きながら、**その根拠を `実測` へ昇格させた**（口の形が再現できないことを認めたうえで確定扱いにした）。
  `PATCH` を推定のまま残すこと（assertion 2）と口の見直しへ回すこと（assertion 4）は baseline も自力で到達するので、この 2 つは Delta ではなく後退検知の項目として残す
- eval 33（Issue #414）は手順 10 の**洗い出しの網羅**を測る。fixture は eval 10 と同じ `dependency-decision`（測定・戦略・インベントリまで完了）を使う——
  fixture 無しでは「`setup` 未完了」で早期停止して洗い出しの進め方に到達しない（eval 10 と同じ理由）。prompt は「共通で使う部品を洗い出したい」「ソースの grep で十分だよね？」だけを与え、
  **assertion 1 が求める種類名（セレクト・ページネーション・モーダルダイアログ・トースト通知）を 1 つも書かない**（書くと baseline がそれを読み上げて assertion を満たす）。
  prompt に置いた種類名は新側で採る候補の「データグリッド」だけで、これは assertion 4（内蔵部品の二重作成）の材料として意図的に与えている。仕込んだ弁別は 3 つ——
  基盤の種類だけでなく個々のプリミティブを列挙すること（assertion 1）、ページを実際に開いて確認しソースの grep で済ませないこと（assertion 2）、
  該当なしを空欄にせず記録すること（assertion 3）。候補のデータグリッドを置いてあるので、内蔵部品を単独の行として二重に作る回答は assertion 4 で落ちる。
  **iteration-41 で実測**（各 config 1 run・claude-code / opus）: `with_skill` 5/5・`without_skill` 0/5 で**全 assertion が弁別した**。
  縮小（Issue #428 への切り出し）で assertion 4 を台帳の値（`内蔵`）に依らない文言へ直したが、**prompt と fixture は変えていない**ので再実走せず、
  同じ run の応答を新しい文言で採点し直した（採点基準の変更であって入力の変更ではない。結果は 5/5・0/5 のまま）。
  baseline は洗い出しを npm の依存（`package.json` / lock・推移依存・env 変数・外部 API）の棚卸しとして組み立て、UI プリミティブの区分・種類を 1 つも挙げなかった——
  grep だけでは足りないとは述べるが、代替が「マニフェスト起点で列挙 → grep で裏取り」で、ページを開く経路へ移らない。baseline は contamination: clean / isolation: sandboxed。
  **assertion 4 の弁別は「行選択チェックボックス」という語では取れていない**——共用 fixture の `survey.md` が unnamed の代表例として
  この語を既に持っており（`dependency-decision/.replace/survey.md`）、baseline も実際にそれを引いた。弁別しているのは語ではなく扱い
  （内蔵として単体の部品と二重に作らない・内蔵判定は新側の候補で決まるので採否確定後に当て直す）で、baseline はその語をロケータ方針の文脈で使って assertion 4 に到達していない。
  この eval を触るときは、assertion 4 を語の一致で採点しない（fixture 側にある語なので、一致だけでは skill の寄与にならない）。
  **未被覆**: 「初期表示に出ない種類は状態を作ってから判定する」「`forbidden_actions` を確かめてから操作する」は assertion に入っていない。次にこの eval を触るときの候補。
  台帳の状態値（`内蔵` / `機能固有` / `未確認`）は Issue #428 へ切り出したので、この eval の対象ではない
- eval 34（Issue #419）は手順 8 で `intentional_diffs.pending` を書くときの**帰属の形**を測る。fixture（`pending-writer-at-setup`）は測定・戦略が完了し
  **`features.md` が無い**（slug 未採番）状態と、`references.db_semantics` の下書き（点検項目 5 節のうち NULL の並び順と照合順序だけが新 DB 側「未実測」）を持たせる——
  この 2 つが揃っていないと「採番前だから `cross-cutting`」と「未実測だから保留」のどちらも材料が無く判定できない。fixture には `pending` の書き方も許可値も書かない。
  `references` はこの eval の判断に要る `db_semantics` だけを置いてある（`setup` が本来キーごと生成する残りのパス型キーは省いた最小構成で、姉妹 fixture の `inventory-multi-page` も `references` を持たない）——
  **fixture を他の eval へ流用するときは、そのキーの有無が判断材料になる eval には使えない**。
  prompt は「機能インベントリはこの後の手順なのでまだ無い」状態を明示し、
  **`added_by` / `slug` / `cross-cutting` の語も許可値も書かない**。仕込んだ弁別は 2 つ——書き手として自分の名前を書くこと（assertion 3。空欄・`unknown`・下流のスキル名はいずれも帰属不明へ倒れる）と、
  採番前なので `cross-cutting` にすること（assertion 4。採番前の slug を推測で書く回答が落ちる）。
  **iteration-41 で実測**（各 config 1 run・claude-code / opus）: `with_skill` 5/5・`without_skill` 2/5。**弁別したのは assertion 2・3・4**——
  baseline は `pending` へ 2 件に分けて置くこと（assertion 1）と確定を実測後の人の判断に委ねること（assertion 5）には自力で到達するが、
  要素を `id` / `ref` / `current` / `new` / `resolve_by` / `impact` / `gate` の**自作スキーマ**で書き、`added_by` も `slug` も持たない（「キー名はスキル定義に合わせてください」と断っている）。
  assertion 1・5 は Delta ではなく後退検知の項目として残す。baseline は contamination: clean / isolation: sandboxed
- eval 35（Issue #428）は手順 10 の洗い出しで**採否に至らない 3 つの結果**（内蔵・機能固有・未確認）の記録先を測る。
  fixture（`component-primitive-states`）は測定・戦略・インベントリが完了し、**データグリッドの採用が決まった `.replace/dependencies.md`** を持たせる——
  「採る候補が決まっている」状態が無いと `内蔵` の判定材料が揃わない。現行 target の `forbidden_actions` に削除・更新を置いて、確認ダイアログを出せない状態を作る。
  fixture には値の語彙も列の意味のコメントも書かない（書くとベースラインが読んで埋める）。
  仕込んだ弁別は 3 つ——3 件とも**台帳の行として残す**こと（assertion 4。報告だけで済ませる回答が落ちる）、
  確かめられなかった種類を `該当なし` に倒さないこと（assertion 1）、`--autonomous` でも**保留に落とさず `setup` を完了できる**こと（assertion 5。
  保留に落とす回答は下流を全部止める）。
  **iteration-42 で実測**（各 config 1 run・claude-code / opus）: `with_skill` 5/5・`without_skill` 1/5。**弁別したのは assertion 2・3・4・5**——
  baseline は確認ダイアログを `該当なし` に倒さない（assertion 1）ところまでは自力で到達するが、
  行選択チェックボックスは**行を作らず**データグリッドの節へ追記し（「独立行を立てると二重計上」）、印刷プレビューは「自前実装なら自律的に確定してよい」とし、
  確認ダイアログは `pending_decisions` へ落として「保留 2 件を setup 完了報告に列挙する」と締めた。
  assertion 1 は Delta ではなく後退検知の項目として残す。baseline は contamination: clean / isolation: sandboxed
- eval 36（Issue #451）は fixture `issues-approval-gate` で、機能 order の Issue 本文ドラフトの受け入れ条件を
  「新側スイート green」と「`verification_commands.full`」の 2 つで足りるかを問う。受け入れ条件に `parity-diff` の収束（`converged: true`）を入れること・
  スイートが見た目を見ない理由・承認前に起票しないことを検証する。prompt は「見た目も含めて一致と言えるはず」という誤った前提を置き、結論は書かない。
  assertion 3 は prompt が起票を止めているので弁別を狙わず、後退検知の項目として置く
  **iteration-43 で実測**（各 config 1 run・claude-code / opus）: `with_skill` 3/3・`without_skill` 1/3。**弁別したのは assertion 1・2**——
  baseline もスイート green が見た目の一致を示さないことには自力で気付くが、受け入れ条件には「スクリーンショット比較などの視覚差分チェック」を置き、
  `parity-diff` の収束（`converged: true`）には至らなかった。baseline は contamination: clean / isolation: sandboxed
- 採点は `evals.json` の assertions と `result.json` / `project-files/` を突き合わせ、`grading.json` を残す
- 集計（`benchmark.json`）は `node scripts/build-skill-eval-benchmark.js` で生成する（判定は assertion テキストで突き合わせる。`benchmark.md` は人が書く。詳細は `docs/skill-development.md`）
