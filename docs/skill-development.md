# スキル開発ワークフロー

スキルの作成・改善・評価・リリースの手順を書く。全エージェントに共通の前提と規約は `AGENTS.md` にある。

スキルの作成・改善・評価には `skill-creator` スキルを使う。

## スキルを追加・修正する

1. `skills/<name>/` を作るか編集する。
2. `evals/<name>/evals.json` のテストケースを追加・更新する。eval は配布しないので、`skills/<name>/` の外に置く。
   - `parity-suite` の手順に確かめる軸を足したときは、同じ変更で `skills/parity-suite/assets/procedure-revisions.json` の `revision` を 1 上げ、`changes` に 1 要素を追記する。
     確かめる項目の候補・撮影条件・反応の数え方など、収束した機能の成果物で測定が足りなくなる変更が当たる。
     下流の `replace-strategy status` は、この一覧を見て古い手順で収束した機能を挙げる。上げ忘れると、前に収束した機能が古い手順のまま収束した扱いで残る。
     軸を足したかどうかは差分から機械的に決められないので、これはチェックの無い規約である。
     一覧の形は `scripts/skills/replace-strategy/procedure-staleness-check.test.js` がチェックする。
3. `scripts/tools/reinstall-skill.sh <name>` で、インストール済みのスキルを更新する。
4. スキルにセットアップ手順があれば実行する。既存のファイルや Hook があるときは上書きせず、更新するかを確認する。
5. skill-creator で回帰テストを実行し、結果を `tests/<name>/iteration-N/` に保存する。
6. `gh skill publish --dry-run` で検証する。
   - `name "..." does not match directory name "."` のエラーは、このリポジトリで実行すると全スキルで出る誤検知である。
     公開済みの既存のスキルで同じコマンドを実行し、license などの warning の差分を比べて、実際の問題だけを扱う。
7. PR を作り、レビューを受けてマージする。リリースは CD が自動で行う。

## push 前の整合パス

ドキュメントやスキルを push する前に、次の項目を突き合わせて、文書の中と文書の間の食い違いを直す。レビューに任せない。

1. 同じ成果物の中で食い違いが無いかを確かめる。
   外部から来た語（API の値・enum・フラグ名）は、ドキュメントの中で 1 つの表記にそろえる。
   散文の説明と、その直後のコード例を突き合わせる。編集した概念のキーワードで対象のファイルを `grep` し、別の表記や矛盾する記述が残っていないかを確かめる。
   文字数・バイト数・書式のように数えれば分かる規約は、その規約をチェックする実装をそのまま実行して確かめる。自分で近似のスクリプトを書かない。
   単位（バイト・文字・表示幅）はチェックする実装ごとに違うので、近似は誤検知と見逃しを出す。
   commit message は `pnpm exec commitlint --edit <file>`、Markdown は `pnpm exec markdownlint-cli2 <path>`、
   `SKILL.md` の frontmatter は `node scripts/gates/check-skill-frontmatter.js <path>` で確かめる。
2. スキルの間でコピーしたファイルに、同じ修正を当てる。
   `evals/<name>/README.md` のようにスキルごとにコピーしたファイルは、直す文字列で `grep -rn <キーワード> skills/ evals/` を実行し、すべてのコピーに同じ修正を当てる。
3. ルールに書いた規律を、チェックが実際に強制しているかを確かめる。
   まず、その規律を破ったときにどのコード・lint・hook がエラーにするかを 1 つ挙げる。
   挙げられない規律は、仕組みで強制したものではなく規約である。散文に何か所書いても強制にはならない。
   挙げられないなら、チェックを実装するか、規約であることを明記する。
   チェックがあると書いたら、違反する最小の入力を置いてエラーになることと、正しい入力が通ることの両方を確かめる。
   正しい入力を通さないと、すべてを失敗にするだけのチェックと区別できない。
   判定できないときに失敗にするチェックは、失敗にするだけでなく、失敗したことが見えるように作る。
   警告なしに入力を捨てる実装は機械が読む値に 0 を記録し、レポートにも出ないので、後の判定で確かめられなくなる。
   そのうえで、ルールとそれを強制する lint・チェック・スクリプトを同じ変更で追加・更新したら、両方の対象（glob と条件）が一致しているかを確かめる。
4. `SKILL.md` の本文と eval が食い違っていないかを確かめる。
   スキルの挙動や手順を変えたら、変えた概念のキーワードで同じスキルの `evals/<name>/` を `grep` し、古い仕様を前提にした assertion を直す。
   変えたのが姉妹スキルの読む共通の取り決め（`replace-strategy/references/project-config.md` など）や、他のスキルが根拠として引用しうる記述なら、`grep` を同じスキルに限らず `evals/` 全体に広げる。
   `grep` する語は、変えた後の新しい語ではなく、変える前の語や既存の要素の名前にする。古い assertion は変える前の語で書かれているので、新しい語では見つからない。
   見つかった assertion は、直した後のドキュメントに沿った回答が pass するかを 1 件ずつ読み直す。
   直さずに置くと、正しい回答を不合格にし、今は誤りになった主張を合格にする回帰テストが残る。
5. 実装と、それを使う側の仕様が食い違っていないかを確かめる。
   共通の取り決め（設定キー・成果物のスキーマ・プロパティの集合・パス・名前）を定義したり変えたりしたら、使う側の仕様（姉妹 Issue の本文とコメント、下流のスキルの前提の節）と 1 項目ずつ突き合わせる。
   突き合わせる箇所は、既知のキーワードの grep だけで挙げず、その項目を読む箇所と書く箇所から挙げる。
   姉妹スキルの同じ名前の references と、`assets/` のテンプレート（成果物のスキーマの原本）も含める。`--include="*.md"` のように拡張子で絞って、成果物のテンプレートを外さない。
   「値を成果物に書かない」という規律は、キーワードと違う表現で値を記録する成果物を見逃しやすい。
   取り決めを新しく作ったときだけでなく、既存の条件のリストに項目を足したときも、grep で見つからないことがある。
   足した語は定義元にしか無く、条件を書き直した箇所は変える前の語で書かれているからである。
   このときは、足した語ではなく既存の要素の名前で grep する。古いリストは変える前の語で書かれているので、既存の要素の名前を必ず含む。
   表のセル・原則の行・要約の行・テンプレートのコメント・設定ファイルの YAML のコメントなど、同じ集合を要約や短い形で書き直した箇所がここで見つかる。
   そのうえで、足した語が出てくる箇所は起点にしない。その運用を義務づけた記述と、条件のリストを書き直し・要約・例外にしている箇所を起点にして、使う側のコンポーネントをたどる。
   条件を減らす分岐の完了条件、要約の行、追加したコマンドのプレースホルダの値の取得元、姉妹スキルにコピーした実例の値も、1 件ずつ確かめる。
   使う側ごとに、何を読み何を書くかの宣言（設定キーの表・成果物の表）を新しく作り、既存の権限の宣言（「読むだけ」「設定を生成しない」など）と矛盾しないかを確かめる。
   義務がキーを読むことではなく、どこかに書くことなら、たどる先は記録先の様式になる。
   書き込み先のテンプレート（`assets/` の成果物の様式）に、その節があることまで確かめる。
   節が無いと、記録の義務が警告なしに抜け、「確認済みにしない」という制限が機能しない。
   配布スキルが作る様式を増やしたら、作る側は既存のファイルを壊さずに列や節を足して埋め、読む側は欠けた項目を「値が無い」ではなく記録の抜けとして扱う、と書く。
6. 共通の取り決めを変えたら、使う側の手順を通してたどる。
   設定のスキーマや成果物のパスのような共通の取り決めを変えたら、使う側のスキルの代表的な手順（正常な場合と境界の場合）を、ドキュメントの記述だけで順にたどる。
   途中で途切れる・矛盾する・先に進めなくなる（デッドロック）箇所が無いかを確かめる。
   項目 5 の突き合わせで見つかるのは、誤った参照だけである。参照がすべて合っていても、手順としては成り立たないことがある。
7. 実行をまたいで状態を持ち越す仕組みは、繰り返してたどる。
   キャッシュ・再利用・反復の回数のように、実行をまたいで状態を持ち越す仕組みを設計したり変えたりしたら、1 回の手順をたどるだけで終えない。
   反復 N から N+1 へ進む場合と途中で止めた反復を通して、判定に使う値ごとに次の 2 つを突き合わせる。
   誰がいつ書くか（回数の加算と範囲の記録のどちらが先か）と、値の単位（全体で 1 つか、再利用の単位ごとか）である。無効にすべきなのに無効にならない場合が無いことを、1 件ずつ確かめる。
   単位の粗い値は、一部の更新で全体を新しく見せる。書く順序が逆になると、前の反復の値が今の反復の値として扱われる。項目 6 の 1 回だけのたどり方では、反復の間で持ち越す値を追えない。
8. 止める条件と、未確定のまま残す様式は、eval を実行して確かめる。
   進行を止める条件（チェック・停止・ブロック）や、「空欄のまま確認に回す」様式を新しく作ったり変えたりしたら、その条件を満たせない状況を作った eval を実行する。
   エージェントが条件を避けて進まないかを確かめる。
   項目 3 で確かめるのはチェックの実装で、ここで確かめるのは、条件を満たせないときにエージェントが何をするかである。
   これは記述の突き合わせ（項目 1・5）でも、文書の上でたどる確認（項目 6）でも見つからない。
   たとえば「空欄のまま確認に回す」と「空欄なら起票を止める」は記述として合っていて、突き合わせても文書の上でたどっても矛盾は出ない。
   実行すると、エージェントは暫定の値で埋め、理由に「空欄で止めると全機能の起票がブロックされるため」と書いた。
   条件を満たせない状況とは、非対話で実行していて、判断に要る情報が手元に無い状況のことである。
   条件を避ける振る舞いとは、暫定の値で埋める・行を消す・条件を読み替えるのどれかである。
   チェックは、値が実際に必要になる地点に置く。記録の様式と進行のブロックを同じ地点に置くと、記録を消す方向に動く理由ができる。

リンクにしない注記に ASCII の `[text]` を使わない。
対応する `[text]: URL` の定義が無いと、Markdown の未定義の shortcut 参照リンクになり、GitHub で正しく表示されない。
markdownlint のデフォルトの MD052 は shortcut の構文をチェックしないので、この誤りを検出しない。
注記には全角の『』や丸括弧を使う。リンクにするなら、定義か URL を必ず付ける。

## 禁止事項の執筆

配布スキルの禁止事項は、ワークフローの中の手順の制約だけでなく、スキルの外で代わりの方法を提供することも禁止する。
「スキルを使わずに私が直接やりましょうか」のような提案で、禁止をすり抜けるのを防ぐためである。
断る場合を確かめる eval には、代わりの方法の提供を検出する assertion を入れる。

## リリース（CD）

`skills/**` を含む変更が `main` にマージされると、`.github/workflows/release.yml` が自動で公開する。詳細はこのワークフローのファイルにある。
タグ付けと publish を手で行う必要は無い。

- バージョンはリポジトリ単位の git タグで決まり、conventional commits から決める。スキルごとのバージョンは持たない。
- `package.json` の `version` はリリースに使わないので、`0.0.0` のまま変えない。

## スキル修正後の再インストール

このリポジトリでは Claude Code・Codex・GitHub Copilot の 3 つのエージェントを使う。
開発中のスキルは `--agent codex` で `.agents/skills/<name>/` に実体を置き、`.claude/skills/<name>` にシンボリックリンクを張って、1 つの実体を全エージェントで使う。
スキルを直したら、手で直さずに次のスクリプトで再インストールする。

```bash
scripts/tools/reinstall-skill.sh <name>
```

このスクリプトは `.agents/skills/<name>/` に実体をインストールし、`.claude/skills/<name>` にシンボリックリンクを作る。
また、`gh skill install --from-local` が自動で足す `metadata.local-path` を、インストールした `SKILL.md` から消す。
`gh skill install` には、このメタデータを足さないようにするオプションが無い（`gh skill install --help` で確かめる）。

このスクリプトはこのリポジトリの開発用のツールで、配布スキルには含めない。
まだ公開していない手元の編集を `.agents/` と `.claude/` に反映するためのもので、公開済みの版を更新する `gh skill update` とは役割が違い、代わりにもならない。
配布スキルの利用者は `gh skill install` と `gh skill update` を使う（README のインストール手順にある）。

## 回帰テストを実行する

各スキルのテストケースと手順は `evals/<name>/` の `evals.json` と `README.md` にある。

新しく作った eval と変えた eval には `reachability` を書く。
各 assertion を引き出す prompt の文を、`{ "assertion": "<assertions に実在するテキスト>", "prompt_quote": "<prompt 内の部分文字列>" }` の形で並べる。
`scripts/gates/check-eval-reachability.js` が pre-commit と CI で次のものをエラーにする。
対応する要素が無いもの、引用が空のもの、prompt に無い引用、assertions に無い assertion である。対応はテキストで付け、位置では付けない。
既存の eval は `scripts/gates/eval-reachability-backlog.json` に載せて、順に適用している。
この一覧の各項目は eval の指紋（prompt と assertions のハッシュ）を持つ。その eval を書き換えると一覧から外れたものとして扱われ、`reachability` が必要になる。
そのため、触った eval から順に `reachability` が埋まる。新しい eval をこの一覧に足さない。

### 実走の既定スコープ（変更確認と benchmark を分ける）

LLM の eval を最初のデバッグに使わない。
先に、変えたランチャー・fixture・採点のスクリプトの unit test を通し、判定を反転したり削除したりするミューテーションでテストが失敗することまで確かめる。
開発中はこの決定論的な検証で繰り返し、LLM の eval は最後の候補に対する変更確認まで遅らせる。

eval の実行には 2 つの目的があり、必要な run の数が大きく違う。起動する前に、どちらの目的かを書く。

| 目的 | 範囲 | run の数 |
|---|---|---|
| 変更確認（デフォルト） | 入力が変わった eval だけを、`with_skill` と `without_skill` で 1 run ずつ | 変えた eval の数 × 2 |
| benchmark の更新 | `benchmark.json` を更新すると決めたときだけ。対象の eval × 2 つの config × 3 run | 対象の eval の数 × 6 |

- 入力が変わった eval だけを実行する。入力とは、prompt（`evals.json`）・fixture・assertion のどれかである。
  触っていない eval は実行しない。
- 変更確認でも `without_skill` を 1 run 実行する。
  prompt や fixture を変えると、ベースラインの入力も変わる。
  `with_skill` が assertion に届くかだけを見ると、新しい prompt でベースラインも自力で届くようになり、スキルの有無で差が出なくなったことを見逃す。
  1 run では分散を測れないので、Delta の値は扱わず、差が残っているかだけを見る。
- 前の iteration が benchmark だったことを理由に、benchmark に広げない。
  Issue や依頼が「実行して挙動を確かめる」までしか求めていないなら、デフォルトの範囲で止める。
  benchmark に広げると executor の利用上限を使い切ることがある。コストを伴う判断なので、エージェントが前例に合わせて決めず、依頼者に確認する。
- 起動する前に、どの eval のどの入力が変わったかと、run の総数を書き出してから実行する。
  数えずに並列で起動すると、上限に達して最後まで実行できず、成功した run と失敗した run が混在した、集計できない iteration が残る。
- executor は今作業しているエージェントに合わせ、`--executor` で指定する。Codex のセッションなら `codex`、Claude Code のセッションなら `claude-code` をデフォルトにする。
  ユーザーの指定やスキル固有の指定があればそれを優先し、対応する executor が無いエージェントではユーザーに確認する。
  選び方は [`skill-eval-executors.md`](skill-eval-executors.md)「Executor の選択」で定義する。

#### without-skill baseline の再利用

次のものがすべて同じなら、成功した既存の `without_skill` の run を再利用できる。
prompt、対象の eval の assertion と `requires_skills`、fixture の相対パス・内容・実行権限、executor、model、reasoning effort、CLI の版、ハーネスの版である。
同じかどうかは `scripts/eval/run-skill-eval.sh` が作る `eval-fingerprint.json` で判断し、目で見たりファイル名だけで判断したりしない。
再利用するときは、assertion が欠けないように `--eval-id` を、実行時のデフォルト値が変わらないように `--model` と `--reasoning-effort` を指定する。
executor の CLI の版を取得できなければ止める。

```bash
scripts/eval/run-skill-eval.sh \
  --skill <name> --config without_skill \
  --executor <executor> --model <model> --reasoning-effort <effort> \
  --eval-id <id> --prompt '<prompt>' --fixture <fixture-dir> \
  --out tests/<name>/iteration-N/eval-<id>/without_skill/run-1 \
  --reuse-baseline tests/<name>/iteration-M/eval-<id>/without_skill/run-1
```

再利用するときは executor を起動しない。
コピーする前に次のことを確かめる。元の run が成功したこと。`contamination.txt` が `clean` で `isolation.txt` が `sandboxed` であること。
必要な成果物が揃っていること。fingerprint のすべての項目が一致すること。
`baseline-reuse.json` に、再利用元・fingerprint・executor・model・reasoning effort・CLI とハーネスの版を記録する。
一致しない・欠けている・汚染の判定が不正のいずれかなら exit 6 で止め、新しい run を求める。
自動で新しい LLM の run を実行すると、かかったコストが見えなくなるので、そうしない。

assertion・prompt・fixture・executor・model・reasoning effort・CLI とハーネスのどれかを変えたら、再利用しない。
benchmark を確かめるときは `baseline-reuse.json` をたどり、元の run と再利用した run を別々の反復として数えない。

`with_skill` の run の前に、対象の `SKILL.md` が references をどう案内しているかを確かめる。
その eval の処理に必要な `references/` だけを読むように、本文に読む条件が書いてあるかを見る。
すべての reference をまとめて読ませる案内は、トークンを増やすうえに、必要な分だけ段階的に読ませる構成を成り立たなくするので直す。

### eval 実行の隔離（必須）

eval の prompt は、スキル・ルール・Hook・`AGENTS.md` などのファイルを作ったり変えたりする。このリポジトリの作業ツリーで直接実行しない。

コーディングエージェントに `cd` で「`/tmp` で作業して」と指示しても安全にはならない。
エージェントの Bash ツールの cwd は呼び出しをまたいで残ることがあるが、ターンの区切りやプロジェクトの外に出たときにリセットされることもあるので、前提にできない。
スキルの手順は `mkdir -p .agents/skills/<name>` や `ln -s ../../...` のような相対パスなので、後の呼び出しでこのリポジトリを汚す。

`scripts/eval/run-skill-eval.sh` を使う。
このランチャーは cwd を固定したヘッドレスの executor を、`/tmp` の下の使い捨ての空のプロジェクトで実行する。相対パスの操作も cwd のリセットも、そのディレクトリの中で起きる。
`with_skill` は executor がスキルを読む場所にスキルを置き、`without_skill` は置かない。
スキルを置かないだけでは、公平なベースラインにならない。CLI はマシンの任意のパスを読めるので、読み取りの遮断と汚染の判定まで揃って、初めて Delta が意味を持つ（後述）。
被験体にコピーするのは `SKILL.md`・`references/`・`assets/`・`scripts/` など実行に要る成果物だけにし、`evals/` の assertion・採点の基準・トピックの表は含めない。

Claude Code と Codex の選び方、共通の成果物のスキーマ、executor がスキルを見つける仕組み、NVIDIA SkillEvaluator を試すかの判断は、[`skill-eval-executors.md`](skill-eval-executors.md) で定義する。

```bash
# 1 run を隔離して実行する（生成物は --out の下に保存され、リポジトリは汚れない）
scripts/eval/run-skill-eval.sh \
  --skill <name> --executor <claude-code|codex> --config with_skill \
  --prompt "<evals.json の prompt>" \
  --out tests/<name>/iteration-N/eval-<id>/with_skill/run-1 \
  --eval-id <id> --model <model> --reasoning-effort <effort>
# without_skill も同じように --config without_skill で実行する。
# 前提が揃った状態を確かめる eval は、--fixture <dir> で使い捨てのプロジェクトに
# 事前の状態（設定・.replace/ の成果物など）をコピーして実行する。fixture の原本は
# evals/<name>/fixtures/<fixture名>/ に置き、evals.json のその eval に
# "fixture": "fixtures/<fixture名>"（evals/<name>/ からの相対パス）を書く。fixture は実行しても変わらない。
```

fixture のルートに実行権限のある `setup.sh` があれば、ハーネスはコピーの後、executor を起動する前に、使い捨てのプロジェクトの中でそれを実行する。
Git の管理領域や手元の bare remote のように、普通のファイルとして置けない前提の状態は、ここで決定論的に作る。
setup が 0 以外で終わったら、executor を起動せずに eval を失敗にする。setup が作ったファイルは、run の前の入力として扱う。

対象の分岐が姉妹スキルの同梱物に依存する eval は、`evals.json` のその eval に `"requires_skills": ["<姉妹スキル名>"]` を書く。
ハーネスは書かれたスキルを両方の configuration に同じ形で置き、対象のスキルだけを `with_skill` に足す。
比べる差を対象のスキルの有無だけにするためである。`with_skill` だけに姉妹スキルを置くと、姉妹スキルの指示の効果が対象のスキルの Delta に含まれる。
書かないと、姉妹スキルが無いことによる停止が対象の分岐より先に起き、分岐に届くかが前提を調べる順序で決まってしまう。姉妹スキルの成果物を fixture に手で置いて代わりにしない。

- 宣言したスキルは、`isolation.txt` の `required_skills:` と、fingerprint の `required_skills`（名前と、置いた内容のハッシュ）に記録される。
  姉妹スキルを変えると、baseline の再利用は拒否される。宣言の無い eval の fingerprint は変わらない。
- `without_skill` の汚染の目印は、対象のスキルの同梱物だけにする。姉妹スキルの同梱物に同じパスがあるものと、姉妹スキルの本文に出てくるものは除く。
  baseline は置かれた姉妹スキルから、それらを正当に読めるからである。
- 宣言が次のどれかに当たると、executor を起動せずに失敗する。配列でない・空・kebab-case でない・重複している・対象のスキル自身を含む・`skills/<name>/SKILL.md` が無い。

読み取りの遮断と汚染の判定は、ハーネスがデフォルトで行う。オペレータがラッパーを組む必要は無い。

- `run-skill-eval.sh` は両方の configuration を `scripts/eval/eval-sandbox.sh` を通して起動する。
  このスクリプトは bwrap で、作業ツリー・兄弟の run の `/tmp`・OS のミラー・エージェントの記録の 4 つを読めなくする。
  各 run には、遮断できたかを書いた `isolation.txt` を必ず残す。`without_skill` には、判定を書いた `contamination.txt` も残す。
  `SKILL_EVAL_RUNNER` を指定したときはそれを優先し、遮断は確かめていないものとして記録する。
- `with_skill` も隔離するのは、比べる差をスキルの有無だけにするためである。
  隔離しないと、`with_skill` はエージェントの履歴（スキルを書いたセッションや eval を設計したセッションのトランスクリプト）や、グローバルにインストールしたスキルを読めてしまい、Delta が実際より大きくなる。
  実際に、それを読んで根拠にした run があった。使い捨てのプロジェクトの中のスキルはサンドボックスの中でも読めるので、`with_skill` は成り立つ。
- `contamination.txt` の `verdict` が `clean` 以外（`CONTAMINATED`・`CHECK-BROKEN`・`SKIPPED`）のときは、run が成功していても exit 4 になる。
  その run の Delta は無効として扱う。`grading.json` を置かずに集計から外し、遮断か判定の前提を直してから実行し直し、benchmark に経緯を残す。
  `SKIPPED` は判定が実行されなかったことを表し、`clean` ではない。
- bwrap か `eval-sandbox.sh` が無い環境では `UNISOLATED` を記録し、`flock` で `with_skill` の実行と排他にして、1 つずつ実行する。
  並列に実行できるのは、`/tmp` の隔離が有効なときだけである。
- 遮断そのものを確かめるときは `scripts/eval/eval-sandbox.sh --verify <marker>...` を使う。確かめるのは次の 3 つである。
  リポジトリがサンドボックスの中から見えないこと。目印が 1 件も見つからないこと（探す場所ごとに既知の目印を置いて、見つけられることを先に確かめる）。
  `$HOME` への書き込みが拒否され、書き込める場所に書いたものがホストに出てこないこと。
- 対象のリポジトリが public なら、`gh` や WebFetch でスキルの本文を取得する方法は、ローカルの遮断では防げない。
  採点のときに、baseline がスキル固有の語や取り決めを再現していないかを確かめる。

fixture に期待する答えを書かない。
fixture はスキルが読む入力で、取り決めの知識ではない。
設定や成果物に置いたコメントや注記が、その eval が確かめる結論を書いていると、ベースラインがそれを読んで assertion を満たし、Delta が無くなる。
結論とは、移行先のパス・意図してそう作ったこと・こう扱うのが正しいという診断などである。
fixture に書いてよいのは、下流のプロジェクトに実際にありうる記述（調査のメモ、運用の但し書き）だけで、判定・分類・あるべき置き場所は書かない。
「〜を理由に停止していない」のような否定形の assertion は、「意図的」と書いたコメント 1 行で通ってしまうので、特に注意する。

各 run の `result.json`・`project-tree.txt`・`project-files/` を `evals.json` の assertions と突き合わせて採点し、`grading.json` を残す。
`project-files/` には採点に使う小さなテキストの生成物だけを保存し、使い捨てのプロジェクト全体を `tests/` の下にコピーしない。採点した後は、後述の集計に進む。

- 生成物が `project-files/` に無いことを「作らなかった」と判定する前に、`project-files-skipped.txt` を見る。
  サイズの上限や読み取りの失敗でスナップショットから外れたファイルは、理由と一緒にここに記録される。0 行なら外れたファイルは無い。
  スナップショットの対象の拡張子は `.md`・`.txt`・`.json`・`.yml`・`.yaml`・`.toml`・`.sh`・`.js`・`.mjs`・`.ts`・`.tsx`・`.sql` である。
  拡張子の無い設定ファイルは、`.gitignore` と `.gitattributes` だけを名前で対象にする。
  これ以外のファイルは最初から対象の外で、`project-files-skipped.txt` にも載らない。その有無は、全パスを並べた `project-tree.txt` で判定する。
  内容を確かめる assertion を書くときは、その成果物がスナップショットの対象かを先に確かめる。
  対象でなければ、対象に足すか、`project-tree.txt` で測れる形に assertion を変える。
- `result.json` の `result` に残るのは最後のアシスタントのメッセージだけで、途中のメッセージやツールの出力は含まれない。
  executor 固有の記録は `raw/` に残るが、共通の採点と集計を raw の形式に依存させない。
  `raw/` の細かさは executor で違う。
  claude-code は `raw/claude-code.jsonl`（`--output-format stream-json --verbose`）で、`system`/`init`・`assistant` の `tool_use`・最後の `result` を含むイベントの列である。
  codex は `raw/codex.jsonl`（`exec --json`）で、`command_execution` を含むイベントの列である。同じコマンドが `item.started` と `item.completed` の 2 行に出る。
- エージェントが X を実行していないことを、raw で 0 件だったことで示さない。抽出するスクリプトが対象を拾えていないときも 0 件になる。
  副作用が無いこと（`project-tree.txt`・`project-files/`）、`permission_denials`、環境の条件（認証、存在しない対象）、応答の記述で示す。
  raw から判定できない executor では、そのことを `grading.json` に書く。
  prompt が作業の実行を促すと、回答が複数のメッセージに分かれる。前半に書いた根拠（実行した終了コード、引用した実装）が記録から消え、採点できなくなる。
  eval の prompt は、実行してから報告させる形にせず、1 つの報告にまとめさせる形にする。「〜した後に」のような完了を前提にした言い方も避ける。

`grading.json` は、集計スクリプトやビューアが実際に読むスキーマで作る。スキーマが違うと、後の集計が 0.0% や「No runs found」になる。
必須のフィールドは `summary.{pass_rate,passed,failed,total}` と、各 expectation の `text`・`passed`・`evidence` である。
判定は assertion のテキストで対応を付けるので、`text` は `eval_metadata.json` の宣言と一字一句同じにする。
位置で並べた配列や `text` の無い要素は、集計スクリプト（`scripts/eval/build-skill-eval-benchmark.js`）が受け付けない。
ビューアを使うときは、run の下の構成（`outputs/` と `eval_metadata.json`）も揃える。
スキーマは skill-creator の `references/schemas.md`（インストール先の skill-creator の下）で定義している。無ければ skill-creator のドキュメントを見る。

### 対象スキルを読まなかった run を集計から外す

`with_skill` の run でも、スキルが見えているだけで使われず、スキルが無いときと同じ答えを返すことがある。
これを含めると、Delta が小さいのはスキルの中身が足りないからか、スキルを読まなかったからかを区別できない。そのため、採点の前に分ける。

判定には `result.json` の `skill_usage` を使う。`run-skill-eval.sh` が run ごとに書く。

| フィールド | 意味 | `null` になるとき |
| --- | --- | --- |
| `visible` | 対象のスキルが提示されていたか（claude-code の `system`/`init` の `skills`） | executor が提示の一覧を出さない（codex） |
| `invoked` | Skill として起動したか | 起動の仕組みが無い（codex はシェルで読む） |
| `files_read` | 中身を返す操作で開いた、スキルの下のパス（`Read`・`Grep` の引数、`cat`・`head`・`sed` などのシェルのコマンド） | ツールの記録が無い |
| `content_seen` | ツールの出力にスキルの文が現れた、スキルの Markdown のファイル | ツールの記録が無いか、`--skills-root` が渡されていない |
| `read` | 起動したか、スキルの下のパスを読んだか、スキルの文が出力に現れたか | `invoked` と `files_read` がどちらも判定できない |
| `invalid_run` | `with_skill` なのに `read` が false | `read` が判定できない |

- `invalid_run: true` の run は採点と集計から外す。汚染した run と同じ扱いである。
  外した件数と run のパスを `benchmark.json` の備考に残し、同じ条件で run を追加する。
- `null` を false として扱わない。`undeterminable` に挙がった軸は、測れなかったことを表し、起きなかったことは表さない。
  `invalid_run: null` の run は自動では外さず、`raw/` を見て人が判断する。
- パスを挙げただけの run を、読んだものとして数えない。
  baseline が `test ! -e <スキルの下のパス>` で無いことを確かめる、報告にパスを書く、`echo` する、といった操作は読み取りではない。
  証拠にするのは中身を返す操作だけである。名前を返すだけの `ls`・`stat`・`find`・`rm`・`Glob` と、書く側の `Write`・`Edit` は除く。
- 成功した呼び出しだけを証拠にする。コマンドの文字列は、読もうとしたことしか示さない。
  claude-code は `tool_result` を `tool_use` の id で突き合わせ、`is_error` でないものだけを採る。codex は `exit_code` が 0 のものだけを採る。
  スキルが無い baseline で `cat <スキルの下のパス>` を実行しても失敗するので、汚染にはならない。結果が返らなかった呼び出しも数えない。
  Skill の起動も同じように扱い、結果がエラーか届かなかったときは `invoked` にしない。
- 複数のコマンドをつないだ呼び出しからは、`&&` だけでつないだリストの中の、単純な読み取りだけを採る。
  `a && b` が成功したなら、すべての要素が実行されて成功しているので、その中の `cat X` は読んでいる。
  それ以外のつなぎ方では、全体の成否から各要素の成否が分からない。
  `test -f X && cat X || echo absent` は X が無くても終了コードが 0 になり、`a && b; c` や `a && b & c` も最後の要素で終了コードが決まる。
  `printf '%s' 'note; cat X'` のように、引用符や `$( )` の中の区切り文字は区切りではない。
  トップレベルに `||`・`;`・改行・単独の `&`・括弧・コメントのどれかがあるコマンドと、要素そのものがパイプ・リダイレクト・置換を含む読み取りは採らない。
  `exit 0 && cat X` のように、シェルを終えうる要素（`exit`・`return`・`exec`・`eval` など、後述の許可リストを通らない要素）より後の読み取りも採らない。
- `cd` した後の相対パスは、cwd で解決してから照合する。
  claude-code の Bash は呼び出しをまたいでシェルを保つので、`cd <スキルの下のパス>` の後の `cat SKILL.md` は読んでいる。
  cwd を進めるのは、成功した `&&` のリストの中の、単純な `cd <リテラル>` だけである。行き先は、絶対パスか、`./` か `../` で始まるパス（CDPATH を使わない形）に限る。起点は init の `cwd` である。
  cwd を保つ条件は、許可リストで書く。
  呼び出しの中のすべてのコマンド名が、引用符・展開・グロブ・エスケープを含まない字面のままで、移動するコマンド（`cd`・`pushd`・`source`・`eval` など）や予約語でないときだけ保つ。
  移動するコマンドの綴りを拒否リストで並べると、`\cd`・`c'd'`・`c$'d'`・`c$(printf d)` のように綴りの数だけ見逃しが出る。
  失敗した呼び出し、結果が届かなかった呼び出し、バックグラウンドでの実行、並行して出た移動とその前後の呼び出しの後は、cwd を不明として扱い、相対パスを解決しない。
  ツールが `Shell cwd was reset` を返した後も同じである。
  `..` を含む読み取りは cwd で解決しない。シンボリックリンクを通ると、実際の親ディレクトリが字面と違い、記録からは分からないからである。
  codex は呼び出しごとに独立しているので、1 つのコマンドの中でだけ追う。
- 逆向きの見逃しは許す。
  実際に読んだが 0 以外で終わる形（一致しない `grep`）や、複数のコマンドをつないだ中の読み取り（`cat X | head`、`cd X && …; …` の後の相対パス）は、`files_read` に入らない。
  この誤りは run を 1 つ `invalid_run` として外すだけで、汚染を作り出す方向の誤りではない。外した run は見えるので、run を追加できる。
- コマンドから読んだと言えない呼び出しは、ツールの出力で拾う（`content_seen`）。
  `cd <スキルのディレクトリ>; cat SKILL.md` や `grep … SKILL.md | head` は、コマンドの文字列からは各要素の成否が分からない。
  しかし出力にはファイルの文が現れ、run はファイルを開かずにその文を手に入れられない。
  そこで、スキルの文が出力に 1 行でも現れたら読んだとする。呼び出しの成否は問わない（`cat X; false` は失敗しても X を表示している）。
  ただし、開かずに手に入る文は、照合の候補から外す。
  - frontmatter。executor がスキルの説明として agent に示す
  - 他のスキルのファイルにある文。run が正当に読みうる
  - fixture と prompt にある文。run に渡される
  - 20 文字未満の行と、ASCII だけの行。ファイル名・コマンド・設定の値（`max_pr_iterations: 5` など）は、スキルを読まない run も自分で書いて出力に出せる（Edit の結果はファイルの一部を表示する）。
    `find` や `ls` が出すファイル名も、これで外れる。このリポジトリのスキルは日本語で書くので、文は候補に残る
  候補にするのは `SKILL.md` と、`references/`・`assets/` の Markdown だけである。スクリプトの使い方の文は、実行すれば表示され、読んだことにならない。
  外すものの照合は部分文字列で行う。JSON の文字列や表のセルに埋め込まれた文も外す。
  `run-skill-eval.sh` は、`--skills-root <repo>/skills`・`--prompt`・`--fixture` を normalize に渡す。
  導入の時点で、手元にある 571 run（`with_skill` 367、`without_skill` 204）を同じ規則で判定し直し、`read` が true から false に変わった run と、`unexpected_read` が新たに立った baseline が無いことを確かめた。
  `;` でつないで読むために `invalid_run` が続き、iteration から外していた 5 件（kaizen:15、parity-diff:27、parity-suite:25・28、replace-strategy:16）は、この判定ですべての run が `read: true` になり、測れるようになった。
  kaizen:15 の 1 run は `cat -n <スキルのスクリプト>` だけで読んでいた。`cat` には値を取るオプションが無いので、フラグの次の語をファイルとして扱うように直した。
- `without_skill` の側で対になるのは `unexpected_read` で、ベースラインがスキルを読んだこと、つまり汚染を表す。`contamination.txt` と合わせて見る。
  claude-code の `raw/` は目印の走査の対象から外している。
  stream-json には途中のメッセージとツールの入力が入るので、目印の語を口にしただけの baseline が CONTAMINATED（exit 4）になり、正当な測定が捨てられるからである（実際に起きた）。
  読み取りは `skill_usage.unexpected_read` で判定する。成功した読み取りから判定するので、名前を挙げただけでは立たない。
  codex の `raw/` はイベントの列なので、走査の対象に含める。

### eval 環境の前提（runtime / repo / 非対話）

`run-skill-eval.sh` の使い捨てのプロジェクトは、空で、mise の trust が無く、非対話である。
スキルの前提をハーネスの側で用意しないと、失敗がスキルの欠陥か環境のせいかを区別できず、結果が信用できなくなる。eval を作るときは次の 3 つを満たす。

- ランタイム（mise の shim）を用意する。
  使い捨てのプロジェクトには `mise.toml` が無いので、mise の shim（`python3`・`node`・`jq` など）は trust も設定も無く、`No version is set for shim` で失敗する。
  スキルが使うランタイムを shim だけに頼らせず、システムのランタイムを使うようにするか、fixture の側で `mise trust` 済みのランタイムを PATH の前に置く。
- 対象のリポジトリを明示する。
  `gh` と `git` を使うスキルは、cwd のリポジトリに頼らない。引数の URL や番号から `OWNER/REPO` を決めて、`--repo` で指定する。
  シナリオでは実在する PR と Issue の番号を使い、必要なら fixture で対象のリポジトリを clone するか、`gh repo set-default OWNER/REPO` を実行する。
  架空の `PR#42` や `other-org/other-repo` は、`Could not resolve` で必ず失敗する。
- 非対話で動くようにする。
  ヘッドレスの executor には、対話の確認に答える人がいない。質問するとツールがエラーになり、進まなくなる。
  eval の prompt は、フラグや URL を書いて意図が 1 つに決まる形で渡す。
  ハーネス（`run-skill-eval.sh`）が prompt の先頭に、非対話で動くための指示を入れる。この指示は配布スキルには書かない。

### eval が失敗したとき executor を変えない

比べる executor を変えると、Delta を測る対象が変わる。そのため、失敗を避ける方法として executor を切り替えない。
途中で見えたエラーが、止まった直接の原因とは限らない。利用上限に達したなど、別の原因が raw の記録に残っていることがある。
途中のエラーだけを見て「この executor では評価できない」と判断すると誤る。

失敗したら、次の順に原因を絞ってから対処する。

1. `raw/` の記録で、最後に何で失敗したかを確かめる。
   `result.json` の途中の報告は、run が止まった原因とは限らない。`turn.failed` の理由・利用上限・サンドボックスの制約は raw にしか出ない。
   claude-code では、最後の `result` イベントの `stop_reason`・`terminal_reason`・`is_error`・`permission_denials`・`usage` を読む。
2. そのスキルの executor の指定（Codex だけで実行する、など）を確かめる。指定があるなら executor は変えず、直すのは fixture かハーネスである。
3. サンドボックスの中で使える、書き込まない別のコマンドを探す。
   たとえば Codex の `.git` の保護の下で到達できるかを測るなら、fixture の setup で remote-tracking ref を用意し、`git fetch --no-write-fetch-head` で確かめる。

評価の前提を満たす別のコマンドに差し替えることと、executor を変えることは、同じ対処ではない。
前者は測る対象を変えないが、後者は比べられるかどうかそのものを変える。

#### それでも executor を切り替えるときの運用

利用上限に達したなど、原因を絞った結果 executor が対応していないためではないと分かり、待たずに別の executor で実行し直すと人が判断したときだけ、次を守る。

1. 切り替えるかは人が決め、エージェントは決めない。
   上限に達したことは、executor が対応していない証拠ではない。「失敗したから別の executor で」は理由にならない。上限がリセットされる時刻を添えて、待つという選択肢と一緒に確認する。
2. 切り替える前の run は、iteration ごと捨てる。
   1 つの iteration に 2 つの executor を含めない（[`skill-eval-executors.md`](skill-eval-executors.md)）。一部が成功した run を、新しい executor の run と一緒に集計しない。
3. 新しい executor で最初から実行し直す。eval・config・run の数は同じにする。
   `with_skill` と `without_skill` を別の executor にしない。そうすると、Delta はスキルの有無ではなく executor の違いを測る。
4. 切り替えたことと、その理由を成果物に残す。
   `benchmark.md` と `benchmark.json` に、executor と切り替えた理由（利用上限に達した、など）を書く。
   前の iteration と executor が違うなら、その Delta を前の iteration と直接比べないことを書く。
   変更確認だけで benchmark を作らないときも、実行の報告に executor と切り替えた理由を書く。
5. 切り替えた先でも上限に達すると考えて、run の数を数える。
   起動する前に run の総数を書き出し、「実走の既定スコープ」を超えるなら、実行する前に確認する。

### 採点（一次資料は成果物、応答は補助）

採点ではまず `project-files/` と `project-tree.txt` を見る。応答（`result.json` の `result`）は補助として読む。
eval はスキルの欠陥を見つけるためのものである。
モデルの完了の報告を根拠に採点すると、「報告はできるが実行できていない」という種類の欠陥を検出できなくなる。
パスや件数まで書いた「作成した」という報告は、ファイルを 1 つも書いていない run からも出る。

- 「作成した」「記録した」「更新した」という報告は、対応するファイルが実在することを確かめてから pass にする。
  完了の報告は具体的なほど信じやすくなるが、パス・件数・キーの名前まで書いてあっても、それはモデルが書いた文字列で、観測した結果ではない。
- 成果物が無い理由は 2 つあり、区別する。
  `project-files-skipped.txt` に行があるなら、拡張子で外れた可能性があり、作らなかったとは読めない。0 行なら、本当に書いていない。
- 実在だけでなく中身も見る。
  「`status: blocked` を記録した」なら、そのキーが実際にその値で入っていることまで確かめる。空のテンプレートが置かれただけのことがある。
- 応答にしか出ない主張（判断の理由、停止の説明）を確かめる assertion は、応答で判定する項目であることを assertion の文に書く。成果物を確かめる assertion と混在させない。

### 集計

集計はリポジトリのスクリプトで行う。使い捨てのスクリプトで組み立てると、判定を配列の位置で対応させて、件数を誤る。

```bash
node scripts/eval/build-skill-eval-benchmark.js tests/<name>/iteration-N \
  --skill-name <name> \
  --skill-path '<repo>/skills/<name>' \
  --executor-model <model-id> \
  --analyzer-model <model-id> \
  [--notes-file <備考のテキスト>] [--ungraded skip] [--force] [--stdout]
```

- 判定は assertion のテキストをキーにして突き合わせる。
  位置で並べた配列（`[true, ...]` や `[[passed, evidence], ...]`）と、`text` を持たない要素は受け付けない（exit 2）。
  `grading.json` は `expectations: [{text, passed, evidence}]` と `verdicts: {"<assertion テキスト>": {passed, evidence}}` のどちらの形でもよい。
- assertion のテキストは、各 run の `eval_metadata.json`（run の時点の宣言）から取る。`evals.json` からは取らない。
  後で assertion を変えると、過去の記録とテキストが合わなくなるからである。出力の `expectations` はこの宣言の順に並ぶ。
- 次のどれかに当たると exit 2 になる。キーの集合が一致しない（判定の無い assertion や、宣言に無い判定がある）。テキストが重複している。`summary` と採点の内訳が合わない。
- `runs_per_configuration` は成果物から数える。手で直さない。
  `eval × configuration` ごとの run の数が揃っていないときと、`timing.json` の executor・model・effort が混在しているときは exit 2 になる。この場合は iteration を分ける。
- 採点の無い run（汚染や `invalid_run` で `grading.json` を置かなかった run）があると、デフォルトでは exit 2 になる。
  外して進めるなら `--ungraded skip` を付け、外した件数とパスを `--notes-file` の備考に残す。
- `notes` は文章なので、スクリプトは作らない。`--notes-file`（1 行に 1 つの note を書いたテキストか、文字列の配列の JSON）で渡す。
- 既存の `benchmark.json` は、`--force` を付けない限り上書きしない。手で足した備考を消さないためである。
- `time_seconds` と `tokens` は `timing.json` から、`tool_calls` と `errors` は `outputs/metrics.json` から取る。
  model・reasoning effort・CLI とハーネスの版は、各 run の `result.json` と `timing.json` にある。
- `benchmark.md` は人が書く。このスクリプトが作るのは `benchmark.json` だけである。
  テストの結果に手元の絶対パスやユーザー固有の情報が含まれるときは、commit の前に `<repo>` や `<home>` などのプレースホルダに置き換える。

スキルのインストールの手順やセットアップの手順を変えたときも、そのスキルの eval を実行する。
テストの結果に手元の絶対パスやユーザー固有の情報が含まれるときは、commit の前に `<repo>` や `<home>` などのプレースホルダに置き換える。

まだ commit していないスキルの変更で benchmark を取るとき、worktree で分けると HEAD の古い版を測ってしまう。
読み取りだけの試し実行なら、分けずに作業ツリーの版を測るか、先に commit する。
