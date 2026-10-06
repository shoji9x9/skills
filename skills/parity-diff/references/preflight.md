# 前提確認・古くなった成果物の検出・条件一致の検証

前提が欠けていたら、作り出さずに止まる。依存の順（`replace-strategy setup` → `golden-dataset` → 対象の slug の `parity-suite` → `parity-replace`）に案内する。
検出の結果・成果物・ベースラインを作り出さない。判定は、指定したパスを Read して行う（jq は必須ではない）。

## 対象 target の解決（前提確認より先）

成果物のパスも疎通先も target で決まるので、最初に対象の環境を決める。候補は、`skills.replace-strategy.targets` のうち `side: new` のものだけである。

- 選び方（`--target` を省いたときのデフォルト、候補の提示、存在しない名前や側が違う名前で止まること）は、`replace-strategy` の `references/project-config.md`「実行対象環境」の「選択規則」に従う。ここへ転記しない
- `url_command` の target は、ここで 1 回だけコマンドを実行して URL を解決する（失敗したときと、出力が空のときは止まる）。後の工程（疎通・撮影・API の呼び出し）は、解決した値を使い回す
- 旧スキーマと旧レイアウトは、代わりに読むことをしない。見つけたら移行を案内して止まる（自動で移さない。両方を読まない）。
  検出する旧キーと旧レイアウトの一覧と、移行の手順は、`replace-strategy` の `references/project-config.md`「移行」を原本として参照する（ここで 1 つずつ挙げない）

## 対象 target の起動と稼働の確認（疎通の確認より先）

選んだ target の `check_urls`（省いたときは `url`。`url_command` の target は解決した後の URL）で、先に稼働を判定する。
落ちているときだけ、`pre_commands` → `start` の順に起動し、もう一度疎通を確かめる。
各キーの意味、条件付きの実行の順序、失敗したときに早めに止まることの原本は、`browser-test` の `references/project-config.md` にある。

- 稼働していれば、`pre_commands` と `start` はどちらも実行しない（`pre_commands` は `start` の前提なので、稼働中の環境に build などの副作用を起こさない）
- 最初の稼働の判定で落ちていても、止まる条件ではなく、起動の合図である（`start` を持たない target は、そこで早めに止まる）
- `pre_commands` か `start` が失敗したとき、起動した後の稼働の確認が失敗したときは、どれも早めに止まる（撮り始めてから落ちるのを避ける）
- 配信型の target は `start` を持たないので、稼働の確認だけで判定する
- シークレットが要るコマンドには、`secrets.wrapper` を前に付ける（値は表示しない）

## 確認するキー（フルパス）

`<target>` は、解決した新側の target の名前である。現側の成果物（`metadata.json` と `baseline/`）は 1 つの環境のものなので、slug の直下に置いたままにする。
次の表は、すべてのモードに共通する前提である。

| 前提 | 確認するパスとキー | 欠けているか偽のときの差し戻し先 |
|---|---|---|
| replace-strategy setup | `.config/skills/shoji9x9/skills.yml` に `skills.replace-strategy` があり、`.replace/features.md` がある | `replace-strategy setup` |
| slug が正しい | `slug` が `.replace/features.md` に載っている（自分で番号を振らない） | 止まる（番号が無ければ `replace-strategy` へ） |
| parity-suite の完了 | `.replace/parity/<slug>/metadata.json` の `suite.current_green: true` と `differ.validated_by_strength_gate: true` | 対象の slug の `parity-suite` |
| 前提スキルの未解決の保留 | setup・`golden-dataset` のフェーズ A・選んだ target のフェーズ B・対象の slug の `parity-suite`・選んだ target の `parity-replace` について、範囲が一致する未解決の保留が無い。`.replace/parity/<slug>/new/<target>/pending-decisions.json` も含める。ファイルが無ければ保留は無い。`resolution` があっても、`blocks` の工程が済んでいなければ未解決である。見る記録先と範囲の原本は、`replace-strategy` の `references/autonomy.md`「下流の前提判定」である。数え方の原本は、同じファイルの「保留の状態」の `pending-decisions-check.mjs` である | 保留を抱えたスキル |
| parity-replace の新側の green | `.replace/parity/<slug>/new/<target>/replace-metadata.json` の `suite.new_green: true` | `parity-replace`（同じ `--target` で新側を green にする） |
| target の名前の一致 | 同じファイルの `new.target` が、解決した target の名前と一致する | 止まる（別の環境の green の証跡を使い回さない） |
| 新側の版の一致 | 同じファイルの `new.commit`（green を取った版）が、これから撮る新側の版と一致する（下の「新側の版の一致」） | `parity-replace`（同じ `--target` で、撮る版の green を記録し直す） |
| Node.js と新側への疎通 | Node.js が使え、選んだ target の `url`（`new.ui_url` と同じ）に疎通できる。api-resource モードでは、`api_url`（`new.api_url` と同じ。省いたときは `ui_url`）にも疎通できる。`url_command` の target は、解決した後の URL へ疎通する（`new.ui_url` の記録は `"runtime"`） | 止まる（環境を整える） |

- 選んだ target の `replace-metadata.json` が無いか、`suite.new_green` が偽なら、「その環境ではまだ green の証跡が無い」として止まる。別の環境の証跡で代えない（環境ごとに独立している）
- `parity-replace` の「完了」を待つのではなく、`suite.new_green` を前提にする。差分ゼロはこのスキルとの往復で達成するので、`parity-replace` 単体の完了の条件には差分ゼロが含まれない
- スイートは実行し直さない。新側に対して green かどうかは、`suite.new_green` のキーで判定する

### 新側の版の一致

`suite.new_green` は、その green を取った版（`new.commit`）でしか成り立たない。
新側のコードを変えた後にこのスキルだけを実行し直すと、採取・自己ノイズの 2 回の撮影・検出を最後まで実行した後で、収束の判定の `artifact-health-check` で失敗する。
撮る前に、ここで止める。

- 撮る版は、次のように決まる。
  - ローカルで起動する target（`start` を持つ）は、新側のリポジトリ（設定の `new.repo`）の作業ツリーの `HEAD`。
  - 配信型の target（`start` を持たない）で `commit_check` を持つものは、URL の書き方（固定の `url` か `url_command` か）に関わらず、その出力。
    照合の原本は [`capture-new.md`](capture-new.md)「URL の受け渡し」、`commit_check` の定義の原本は `replace-strategy` の `references/project-config.md` にある。
  - 配信型の target で `commit_check` を持たないものは、撮る版を機械で知る方法が無い。
    「対象の環境に commit `<照合相手の SHA>` がデプロイ済みか」を利用者に確かめ、確認が取れるまで撮らない。
    これは `parity-replace` の軽い方法と同じ扱いである。`--autonomous` では判断待ちの保留に記録し、この機能の撮影を始めない。確かめたことと回答は、`diff.md` の前提確認の表に書く
- 部品の改修をまとめて再検証する場合（`--component-change`）は、照合相手が変更宣言の `commits.after` になる。
  `new.commit` は改修前の記録のままである（原本は [`component-change.md`](component-change.md)「使う場面と使わない場面」）。
  下の照合は、`CHANGE` に変更宣言のパスを入れると、照合相手を `commits.after` に切り替える。
  `new.commit` のまま照合すると、正しい一括の再検証でも止まってしまう
- 照合相手（ふつうは `new.commit`、一括の再検証では `commits.after`）を原本から読み、撮る版と完全な SHA で突き合わせる（表示から書き写さない）。
  撮る版は、`COMMIT_CHECK` が空ならローカルの作業ツリーの `HEAD` で、配信型の target の `commit_check` を入れればその出力である（完全な SHA を出すこと。短縮した SHA は一致しないものとして止まる）。
  `commit_check` を持たない配信型の target は、`DELIVERED=1` にする（ローカルの `HEAD` と比べず、利用者の確認が要るとして止まる）。

  ```bash
  CHANGE=""   # --component-change の実行だけ変更宣言のパス（続けて当てた宣言があるなら最後の宣言）。通常の実行は空のまま
  if [ -n "$CHANGE" ]; then
    RECORDED=$(node -e 'const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); process.stdout.write(String(c.commits?.after ?? ""))' "$CHANGE")
  else
    RECORDED=$(node -e 'const m = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); process.stdout.write(String(m.new?.commit ?? ""))' \
      .replace/parity/<slug>/new/<target>/replace-metadata.json)
  fi
  COMMIT_CHECK=""   # start を持たない配信型 target で commit_check を持つなら、そのコマンド（secrets.wrapper が要るなら前置する）。ローカルの target は空のまま
  DELIVERED=""      # start を持たない配信型 target なら 1（commit_check の有無に依らない）。ローカルの target は空のまま
  # 停止する分岐は非 0 で終える（手順に組み込んだときに停止を表示したまま撮影へ進ませない）。対話シェルを閉じないよう ( ) で囲む
  (
    if [ -n "$DELIVERED" ] && [ -z "$COMMIT_CHECK" ]; then
      # 稼働中の版を機械で確かめる手段が無い。ローカルの HEAD はデプロイ済みの版を表さないので比べない
      echo "停止: commit_check が無い配信型 target。commit ${RECORDED:-（読めない）} がデプロイ済みか利用者に確認する"; exit 1
    elif [ -n "$COMMIT_CHECK" ]; then
      # 配信型 target: 稼働中のコードの版は commit_check だけが知っている（HEAD はデプロイ済みの版を表さない）
      # 終了コードはパイプへ流す前に検査する（パイプの末尾の tr に隠れて、失敗した確認を成功扱いしない）
      RAW=$(bash -c "$COMMIT_CHECK" </dev/null) || { echo "停止: commit_check が失敗した（撮る版を特定できない）"; exit 1; }
      CAPTURE=$(printf '%s' "$RAW" | tr -d '[:space:]' | tr 'A-F' 'a-f')
      WANT=$(printf '%s' "$RECORDED" | tr 'A-F' 'a-f')
    else
      CAPTURE=$(git -C <新側リポジトリ> rev-parse --verify HEAD)
      if [ -n "$CAPTURE" ] && [ -n "$(git -C <新側リポジトリ> status --porcelain)" ]; then
        echo "停止: 新側の作業ツリーに未コミットの変更がある（撮る版を特定できない）"; exit 1
      fi
      WANT=$(git -C <新側リポジトリ> rev-parse --verify --quiet "${RECORDED}^{commit}")
    fi
    if [ -z "$CAPTURE" ]; then
      # リポジトリのパス違い・commit_check の失敗等で空になると、下の比較が空同士で「一致」に倒れる
      echo "停止: 撮る版を読めない（新側リポジトリの HEAD / commit_check の出力が空）"; exit 1
    elif [ "$RECORDED" = none ]; then
      echo "照合しない: 照合相手が none（版の対応は反復回数で取る）"
    elif ! printf '%s' "$RECORDED" | grep -Eqix '[0-9a-f]{40}|[0-9a-f]{64}'; then
      # rev-parse は短縮 SHA や参照名（main 等）も完全 SHA へ展開するので、展開する前の値を検査する
      echo "停止: 照合相手が完全な SHA でない（${RECORDED:-（読めない）}）"; exit 1
    elif ! printf '%s' "$CAPTURE" | grep -Eqx '[0-9a-f]{40}|[0-9a-f]{64}' || ! printf '%s' "$WANT" | grep -Eqx '[0-9a-f]{40}|[0-9a-f]{64}'; then
      # 短縮 SHA・16 進でない値同士の一致（両方 deadbeef 等）を版の一致にしない
      echo "停止: 完全な SHA でない（照合相手 ${RECORDED:-（読めない）} / 撮る版 $CAPTURE）"; exit 1
    elif [ "$WANT" = "$CAPTURE" ]; then
      echo "一致: $CAPTURE"
    else
      echo "停止: 照合相手の版 ${RECORDED:-（読めない）} と撮る版 $CAPTURE が違う"; exit 1
    fi
  )
  ```

- 一致しなければ撮らずに止まり、同じ `--target` で `parity-replace` を実行するよう案内する（撮る版で新側の green を記録し直す）。
  `new.commit` が読めないときと、リポジトリに無い版のときも、一致しないものとして扱う（合格として扱わない）
- 収束の判定の `artifact-health-check` の照合（[`convergence.md`](convergence.md)）は残す。撮った後に版が変わったときに、ここで見つかる

## モード別の追加要求（`metadata.json.mode` で分岐）

画面の比較に関わる前提（ノイズの基準値・画面のベースライン・画素と特性の差分ツール）を求めるのは、`feature` モードだけである。
`api-resource` と `batch` は画面を比べる 3 つの比較方法を使わない。そのため、`parity-suite` がこれらを記録していないのが正常で、欠けていても止まる条件にしない（無いものを理由に差し戻さない）。

| モード | 追加で求めるもの | 欠けたときの差し戻し先 |
|---|---|---|
| feature | `metadata.json` に `capture_conditions.popup_inventory` のキーがあること（無い旧成果物は、静止を待つ処理を入れる前の採取である。承認済みの例外の扱いは [`capture-new.md`](capture-new.md)「条件一致の先行検証」）。`noise_baseline[]` が対象の page・state・viewport の数だけあること。`artifacts_storage.baseline_pointer` の実体（`baseline/`）があること。下の「差分ツールの版の一致確認」 | `parity-suite`（ノイズの基準値の測定は、現行のアプリを動かす `parity-suite` の仕事である） |
| api-resource | 現行の応答の record（`metadata.json.suite.specs` のスイートと録画）が実体としてある。比べるのは、同梱の `json-normalize-diff.mjs` などだけ | `parity-suite` |
| batch | 現行のバッチの出力のベースライン（DB の状態と生成ファイル）が実体としてある | `parity-suite` |

- ノイズを測るための 2 回目の採取物（現側の `noise-pass2/` と、新側の `new/<target>/noise-pass2/`）は、実体を求めない。
  基準値と自己ノイズは記録した数値であり、採取物は測った後に消す一時的なものである（原本は `parity-suite` の `references/baseline.md`、新側は [`capture-new.md`](capture-new.md)）。
  無いことを、差し戻しや測り直しの理由にしない

## データセットバージョンの三者整合

`.replace/dataset/metadata.json` の `changes[].affects` を、`golden-dataset` の `references/versioning.md` に従って読む。
`metadata.json.dataset_version` と `phase_b.<slug>.<target>.dataset_version`（選んだ新側 target のエントリ）のそれぞれについて、その版より後に、対象の slug に影響する変更が無いことを確かめる。
`version` は 1 から始まり単調に増える整数で、論理データが変わったときだけ 1 増える（フェーズ B では増えない）。
影響を判定する前に、dataset の今の version と各記録の version が整数で、各記録が `1..今の version` に収まることを確かめる。
今より先の version、0 以下、整数でない値、欠けた値のときは、整合が取れないものとして差分検出を始めずに止まる。

| 状態 | 意味 | 対応 |
|---|---|---|
| 両方の記録の後に、対象の slug に影響する変更が無い | ベースラインも新側への投入も、対象のデータに追いついている（数値が今の版より古くてもよい） | 差分検出へ進む |
| ベースラインを記録した後の `affects` が、対象の slug と重なる | ベースラインの側が古くなった | `parity-suite` にベースラインをもう一度取得するよう促して止まる |
| phase B の記録が無いか、記録した後の `affects` が対象の slug と重なる | その target への新側の投入をしていないか、対象のデータが古い | `golden-dataset`（フェーズ B）へ、同じ target で差し戻して止まる |
| `changes` が無いか不正、または slug が実際に参照するテーブルを判定できない | 影響が無いことを示せない | 全体に影響するものとして扱い、記録の version が今より古い側（ベースラインなら `parity-suite`、phase B なら `golden-dataset` のフェーズ B）へ差し戻して止まる。`changes` と実際に参照するテーブルは、次に `golden-dataset` のフェーズ A を実行したときに作り直す（原本は `golden-dataset` の `references/versioning.md`） |
| どれかの記録の version が今の version より大きい、0 以下、整数でない | metadata が不正な値になっているか、dataset の metadata が前の状態に戻った | 整合が取れないものとして止まり、成果物と dataset の metadata を元に戻すか、作り直すよう促す |

- データが原因の差のうち、`.replace/dataset/verification.md` のフェーズ B の節で説明済みのものは許容する。説明されていないデータの差は、`golden-dataset`（フェーズ B）へ差し戻す（[`api-batch.md`](api-batch.md)）

### 選んだ target が投入の対象でない場合（phase B との整合の免除）

免除するのは、その target がゴールデンデータの投入の対象でないときだけである（投入の取り決めの原本は `replace-strategy` の `references/project-config.md`）。
判定は、設定の `dataset_mode` で変わる。

| `dataset_mode` | 選んだ新側の target | phase B との整合 |
|---|---|---|
| `db`（デフォルト） | `db` が定義されていない（DB に触れない）か、`db.env_vars` はあるが `seedable` が無い（読み取り専用） | 免除する（投入の対象外） |
| `db` | `db.seedable: true` | 求める |
| `static` | すべて | 求める（データはリポジトリの中にあり、target の `db` に依存しない） |

- 免除するときは、phase B との整合（`phase_b.<slug>.<target>`）を求めない。フェーズ B を実行していないことを理由に、`golden-dataset` へ差し戻さない
- 代わりに、「ゴールデンデータを投入していないので、データに依存する差分は、実装の差かデータの差かを区別できない。そのため未検証である」と `diff.md` の未検証領域に書く。
  確かめる範囲は、データに依存しない範囲（レイアウト・スタイル・構造など、投入したデータの内容に依存しない差分）に限る。
  `diff-metadata.json.dataset_version_exempt` に、免除した理由（DB が定義されていないのか、読み取り専用なのか）を記録する
- `seedable` が無いだけの target を、「投入の対象にできる」と読み替えない。設定を直すかどうかはユーザーが決める。
  免除して未検証と記録するか、ユーザーに `seedable: true` を足すよう促して止まるかのどちらかにし、勝手に投入しない
- ベースラインを記録した後の変更が対象の slug に影響しないことは、免除するかどうかに関わらず確かめる

## 差分ツールの版の一致確認（feature モードのみ）

`parity-diff` は、`parity-suite` が強度チェックで健全なことを確かめた差分ツールを、そのまま使い回す。
ここが一致しないと「検証済み」という前提が成り立たなくなるので、一致を確かめる。
`api-resource` と `batch` は、画素と特性照合の差分ツールを使わないので、この節の確認はしない。
比べるのは同梱の `json-normalize-diff.mjs` で、その版は `diff-metadata.json.differ_versions` に記録する。

- プロジェクト側の `trait-compare.mjs` の `VERSION` が、`metadata.json.differ.trait_compare` に記録した値と等しい
- プロジェクト側の `trait-capture.mjs` の `VERSION` が、`metadata.json.traits.tool` に記録した値と等しい
- `metadata.json.differ.{pixel_tool,pixel_threshold,align_tolerance,aria_compare,validated_by_strength_gate}` がそろっている
- 一致しなければ `parity-suite` へ戻す（差分ツールを更新したなら、強度チェックを実行し直す必要がある）
- CLI で実行するときは、記録した値を必ず渡す（`trait-compare.mjs` は `--align-tolerance` を省くとデフォルトの 1 になる。`differ.align_tolerance` の記録値と一致させる）

## 反復上限

往復ループの反復の回数と上限は、`parity-replace` が記録する。
記録先は、選んだ target の `.replace/parity/<slug>/new/<target>/replace-metadata.json` の `loop.{iterations,max_iterations,last_diff_report}` である。
環境ごとに独立している。上限を管理する手順の原本は、`parity-replace` の `references/diff-loop.md` にある。

- `loop.iterations >= loop.max_iterations` のとき、このスキルは新しい差分検出をしてよい。ただし、対応が要る差分が残っても差し戻さずに止まり、ユーザーに判断を求める（最初から作り直さない）
- 差し戻してよいかの判定は [`convergence.md`](convergence.md) にある

## シークレットの扱い

`replace-strategy` の `references/project-config.md`「シークレットの扱い」に従う。
扱うのは環境変数の名前だけで、値をログ・標準出力・成果物に出さない。ユーザーが値を示しても、繰り返さない。
新側の URL への疎通と、DB の環境変数があることの確認は、値を表示せずに行う。
