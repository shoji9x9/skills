# 差分レポート（diff）

<!-- parity-diff が .replace/parity/<slug>/new/<target>/diff.md として生成する（新側の成果物は target ごとに分かれる）。このファイルの形式の正本は parity-diff が定義する。 -->
<!-- 収束の定義: 未説明差分ゼロ かつ 未修正回帰ゼロ（生の差分ゼロは求めない）。判定は差分器（diff-normalize の機械分類）が行い、モデルの主観を根拠にしない。 -->
<!-- 「確認済みにしない」原則: ベースラインに写らない箇所・宣言できない構造差・アニメーションは「未検証」として残す。 -->
<!-- 各行・各値は例。実際の検出結果・分類・根拠で置き換える。 -->

- 対象 slug: （features.md の slug）
- 対象 target: （skills.replace-strategy.targets のうち side: new の環境名）
- モード: （feature | api-resource | batch）
- 実施日時: （ISO 8601）
- 読んだ同 target の replace-metadata.json の loop.iterations: （数値）

## 1. 前提確認の結果

<!-- preflight の確認値。欠け・不一致があれば差分検出へ進まず停止していること。 -->
<!-- 視覚系の行（noise_baseline・baseline 実体・自己ノイズ・条件一致・差分器バージョン）は feature モードのみ。api-resource / batch は該当行を「対象外」にする。 -->

| 前提 | 確認値 | 判定 |
|---|---|---|
| replace-strategy setup（設定・features.md） | （あり／なし） | （OK／停止） |
| target の稼働確認（check_urls）と、落ちていた場合のみの起動（pre_commands → start） | （実行したもの／稼働中のため起動なし） | （OK／停止） |
| parity-suite 完了（suite.current_green・validated_by_strength_gate＋モード別の追加要求） | （値） | （OK／停止） |
| parity-replace 新側 green（同 target の suite.new_green・new.target 一致） | （true／false） | （OK／停止） |
| データセットバージョン三者整合（metadata / dataset changes / `phase_b.<slug>.<target>`） | （3 値と記録後に交差した affects。投入対象でない target〈db 無し／seedable 無しの読み取り専用〉は「免除」） | （影響変更なし／免除／陳腐化→差し戻し先／整合不能→停止） |
| 条件一致検証（viewports / animations / masks / states / environment の 5 項目） | （項目ごとの結果。environment は原則 unverified） | （OK／停止） |
| 新側の自己ノイズ（noise_baseline_new と現側 noise_baseline の対比） | （組ごとの値と source＝measured／reused の別・その組の measured_at。再測定した組はその失効条件） | （OK／乖離→停止） |
| 差分器バージョン一致（trait_capture・trait_compare・pixel_tool・aria_compare・align_tolerance） | （値） | （一致／不一致→parity-suite） |

## 2. 経路別サマリ

<!-- feature モードは画素／特性／aria。api-resource / batch は API／バッチの構造・バイト比較。 -->

| 経路 | 適用したノイズ基準値（page/state/viewport） | 検出件数 | 備考 |
|---|---|---|---|
| 画素 | （基準値） | （件数） | 名前無し要素の見た目差 |
| 特性照合 | （基準値） | （件数） | 論理名付き要素の computed style・相対幾何 |
| aria | — | （件数） | テーブル/フォームの内容パリティ（補助経路） |

## 3. 差分一覧

<!-- 分類は 要対応／許容／環境ノイズ の 3 値＋（未トリアージの）未説明。位置は論理名または bbox。 -->
<!-- 「許容」は承認後にだけ書く。承認前は 許容候補（要確認） と書き、収束判定では未説明として数える。 -->
<!-- 他機能の新側未実装に由来する差分は分類を 未説明 のままにし、次節「他機能待ち」へ帰属させる（分類の 4 値目にしない）。 -->
<!-- 根拠には測定・実験で得た結論を書くとき、どの条件（要素・サイズ・ウェイト・状態）で測ったかを併記する。条件を書けない結論は書かず未説明のまま残す。 -->
<!-- 正規化結果が absorbed_exception の行は、吸収した例外の cause（原因 id）と reason を根拠欄に書く（画素経路は bbox の実測ずれも併記する）。どの例外がどの候補を吸収したか追えるようにする。 -->

| ID | 経路 | ページ | 状態 | ビューポート | 位置（論理名 or bbox） | 内容 | 正規化結果 | 分類 | 根拠（測定条件を併記） |
|---|---|---|---|---|---|---|---|---|---|
| （例: 1） | 特性照合 | （ページ） | default | desktop | （論理名） | padding-left 差 | deviates_T | 要対応 | T の期待値から逸脱 |
| （例: 2） | 画素 | （ページ） | hover | mobile | （bbox） | 罫線色の微差 | noise_candidate | 環境ノイズ | ノイズ基準値と同程度 |
| （例: 3） | 画素 | （ページ） | default | desktop | （bbox） | 字形の濃度差 | unexplained | 許容候補（要確認） | 版・送り値は一致。600 の見出しで観測（400 の本文では差ゼロ） |

## 4. 要対応 — 差し戻し（on_diff で分岐）

<!-- 該当ページ・想定フェーズ（実装／新側マッピング／テーマ）を示す。修正はここで行わない。反復上限超過なら差し戻さず停止しユーザーへ。 -->
<!-- target の on_diff ドキュメントが無ければ parity-replace へ差し戻し、あればそのドキュメントに従う（起票して停止する運用なら issue-create へ委譲して起票し停止する）。 -->

| ID | ページ | 想定フェーズ | 差し戻し内容 |
|---|---|---|---|
| （例: 1） | （ページ） | テーマ | design token を寄せる or component_diffs を宣言 |

- 従った on_diff ドキュメント: （パス／無ければ none）と、それに応じた行き先（同じ target の parity-replace へ差し戻し／issue-create で起票した Issue の URL）
- 差し戻すときは入力としてこの diff.md を parity-replace へ渡す（再入手順は parity-replace の references/diff-loop.md）

## 5. 許容 — 記録先とユーザー承認

<!-- 「許容」の確定にはユーザー承認が要る。承認済みのものだけを記録先へ非破壊追記する。承認前の行は「許容候補（要確認）」のまま置き、記録先は空にする。 -->
<!-- 記録先はレジストリごとに効く経路が違う。画素経路でしか出ない差は component_diffs では吸収されず、インスタンス例外（property: pixel）へ書く。 -->
<!-- インスタンス例外の置き場所は設定ファイルではなく slug 成果物 .replace/parity/<slug>/component-diff-exceptions.json（原因は cause で参照し、根拠は同ディレクトリの component-diff-exceptions.md）。 -->
<!-- 同一原因の複数インスタンスに同じ文言を複製しない。原因を 1 回定義して cause 参照にし、インスタンス件数は畳まない（件数は検証の弱さのシグナル）。 -->
<!-- 承認は原因単位で取る（1 原因につき 1 回）。同一原因の N インスタンスはその承認で確定し、下の候補表の承認欄はその原因の承認を参照する。 -->

### 5.1 承認単位（原因ごと）

<!-- 束ねてよいのは観測条件で同一原因だと確かめた候補だけ。crop の見た目が似ているだけで束ねない（確かめていない候補は別の承認単位として残す）。 -->
<!-- 件数を畳まない規則は台帳の規則。承認を原因単位にしても、覆う件数 N と内訳は承認 UI とこの表に出す。 -->
<!-- 原因が確定していない候補はこの表に行を作らない（承認単位にしない）。5.2 に記録先も cause も空のまま未承認で残し、未説明として数える。 -->
<!-- 件数 N は承認時に提示した件数の累計。JSON 側の cause 参照数と一致すること（JSON 側が多ければ承認後に足された未承認インスタンスがあるので、増分の承認を取るまで収束させない）。 -->

| cause（原因 id） | 識別ラベル（`reason`） | 覆うインスタンス件数 N と内訳（ページ／状態／ビューポート／要素） | 承認 UI に提示した代表インスタンスと判断材料 | ユーザー承認（有無・日時） |
|---|---|---|---|---|
| （例: font-subset-weight600） | （例: フォントのサブセットビルド差による weight 600 のラスタライズ差） | （例: 7 件。一覧 default desktop の見出し 5 / 詳細 default desktop の見出し 2） | （例: 一覧 default desktop の見出し 1 件の crop 対 ＋ 観測条件の表 ＋ 源流で消せない理由） | 承認済み（ISO 8601） |
| （例: chip-radius-rounding） | （例: 角丸のサブピクセル丸め差） | （例: 3 件〈初回 2 ＋ 増分 1〉。一覧 default desktop の chip 2 / 一覧 default mobile の chip 1） | （例: 初回は一覧 default desktop の 1 件、増分は mobile の 1 件を提示） | 承認済み（初回 ISO 8601 ／増分 ISO 8601） |

### 5.2 候補ごとの記録先

| ID | 記録先（component_diffs / component-diff-exceptions.json / intentional_diffs） | cause（原因 id。例外へ書いた場合） | 根拠の宛先（`component-diff-exceptions.md` の節） | ユーザー承認（cause の承認を参照） |
|---|---|---|---|---|
| （例: 3） | （空。承認前は記録先を書かない。承認されれば component-diff-exceptions.json の property: pixel） | （空） | （空） | 未承認（許容候補のまま。未説明として数える） |
| （例: 4） | component-diff-exceptions.json | （例: font-subset-weight600） | component-diff-exceptions.md#font-subset-weight600 | 承認済み（5.1 の font-subset-weight600 の承認。ISO 8601） |

- 台帳の規模（原因数・インスタンス数・照合に使えなかった件数〈cause 未解決・evidence 空・slug 不一致・照合キー（page / viewport / element）欠落〉）: （diff-metadata.json の accepted_exceptions と一致させる）
- 台帳の不整合（cause 未解決・evidence 空・slug 不一致・照合キー〈page / viewport / element〉欠落で照合に使われなかった例外）: （あれば列挙。無ければ none。該当候補は吸収されず未説明のまま残っている）

## 6. 他機能待ち（blocked_by）

<!-- 他機能が新側に未実装であることに由来し、この target では解消できない差分。要対応でも許容でもない。 -->
<!-- 差し戻さず停止してユーザーへ報告する。分類は未説明のままで、results.unexplained から差し引かない。 -->
<!-- 帰属条件（features.md の slug・同 target で新側未達を読んで確認・要素が無いことで説明できる）を満たさないものは帰属させない。 -->

| ID | 依存先 slug | Issue | 新側未達の根拠（読んだパスと値） | 差分がその未実装で説明できる理由 |
|---|---|---|---|---|
| （例: 5） | （slug） | （番号／無ければ none） | （例: `new/<target>/replace-metadata.json` が無い） | （例: 同じページに乗るセクションが新側に無く親要素の高さが変わる） |

## 7. 未検証領域

<!-- ベースラインに写らない箇所・gaps.md の宣言できない構造差・アニメーション・撮影条件のうち照合できなかった項目・投入対象でない target のデータ依存差分・部品被覆表を判定しなかった場合。確認済みにしない。 -->

| 箇所 | 種別（写らない／宣言できない構造差／アニメーション／撮影条件／データ依存／部品被覆表未判定） | 理由 |
|---|---|---|
| （例: 保存ボタンのフォーカスリング） | 宣言できない構造差 | クラス/トークンのプロパティ差に還元できない |
| （例: 一覧のフェードイン） | アニメーション | 停止させて比較するため扱えない |
| （例: 撮影環境の一致） | 撮影条件 | capture_conditions.environment は自由記述で機械照合できない（unverified: 理由） |
| （例: 一覧の表示件数・並び） | データ依存 | 選択 target が投入対象外（db 無し／seedable 無し）でゴールデンデータ未投入。実装差かデータ差か判別できない |
| （例: データグリッドが持つ操作の網羅） | 部品被覆表未判定 | 現側 `metadata.json` に `component_coverage` が無い（旧成果物）ため未測定を判定できない。採取状態の外にある操作の欠落は差分ゼロとして通る |

## 8. 意図的差異の保留（intentional_diffs.pending）の棚卸し

<!-- 設定ファイルの intentional_diffs.pending のうち、この機能で棚卸しした保留。件数は diff-metadata.json の intentional_diffs_pending と一致させる。 -->
<!-- 対象は 3 群: この機能に帰属（slug 一致）／横断（cross-cutting。閉じる工程を持たないため毎回提示）／帰属不明（素の文字列の旧形式・slug 欠落）。他の機能に帰属する保留は対象外。 -->
<!-- 1 件ずつ人へ提示して決める。keep / may_change へ移すのは人間で、スキルは設定ファイルを書き換えない。対象 0 件でも「0 件」と書く（無記録にしない）。 -->

- 棚卸し対象: （件数。内訳: この機能 （件数） / 横断 （件数） / 帰属不明 （件数））
- 確定（keep / may_change へ移した）: （件数）
- 持ち越し: （件数。持ち越しは理由の記録が条件）

| 保留（item） | 帰属（slug / cross-cutting / 帰属不明） | 追記元（added_by / added_at） | 処置（keep / may_change / carried_over） | 移動後の文言（変えた場合） | 持ち越しの理由 |
|---|---|---|---|---|---|
| （例: 一覧の並び順が新側で安定ソートになる） | （slug） | parity-replace / 2026-09-03 | keep | （変えていなければ none） | （keep なので none） |
| （例: 日付の丸め方が新側 DB で変わる） | cross-cutting | golden-dataset / 2026-08-20 | carried_over | none | （例: DB 意味論の確認待ち） |

## 9. 収束判定

<!-- 差分器の集計で判定する。converged は diff-metadata.json と一致させる。 -->
<!-- 状態は 3 つ: 収束 / 他機能待ち（残る未説明がすべて blocked_by に帰属し要対応ゼロ）/ 未収束。 -->

- 未説明差分: （件数。ゼロが条件。うち他機能待ちに帰属: （件数））
- 未修正回帰（deviates_T / actionable）: （件数。ゼロが条件）
- 「許容」例外の確定（ユーザー承認）: （すべて済み／未済。承認は原因単位で数える〈承認済み原因数／承認単位の総数〉。`許容候補（要確認）` の残数: （件数。ゼロが条件））
- 承認記録が覆う件数と台帳の一致: （原因ごとに component-diff-exceptions.md の承認記録の累計 N ＝ JSON の cause 参照数。超過件数: （件数。ゼロが条件。超過分は未承認＝未説明として数える））
- インスタンス例外台帳の不整合（cause 未解決・evidence 空・slug 不一致・照合キー（page / viewport / element）欠落）: （件数。ゼロが条件。diff-metadata.json の accepted_exceptions.unresolved と一致させる）
- 意図的差異の保留の棚卸し: （棚卸し対象 （件数） / 確定 （件数） / 持ち越し （件数）。未棚卸しはゼロが条件。diff-metadata.json の intentional_diffs_pending と一致させる）
- 部品被覆表の未測定: （判定した／判定していない〈理由〉。判定したなら数え直した 期待セル数 と 未測定数。未測定数はゼロが条件。diff-metadata.json の component_coverage と一致させる）
- 収束状態: （収束／他機能待ち／未収束）と根拠
- 収束: （converged: true / false）
