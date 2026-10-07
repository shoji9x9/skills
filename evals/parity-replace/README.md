# parity-replace の回帰テスト

テストケースは [`evals.json`](evals.json)。実行・採点・集計の共通手順は `docs/skill-development.md`「回帰テストを実行する」に従う。

## 前提

実アプリ・DB・ブラウザ（Playwright）・パリティスイート・新側のコードベースを要する全フロー（ページ分割 〜 実装 〜 新側マッピングの充填 〜 敵対的レビュー 〜 スイート green）は、
使い捨てプロジェクト（空・非対話）では回せない。
そのため本スキルの evals は、次の 2 つを対象にしている。

- **前提が無い環境での停止パス**（replace-strategy setup / golden-dataset / 対象 slug の parity-suite が未完了）
- **禁止事項の拒否挙動**（パリティスイート無しで実装しない・リント off / 推測実装の拒否・差異を確認なしで判断しない）

## 実行例

```bash
scripts/eval/run-skill-eval.sh \
  --skill parity-replace --config with_skill \
  --prompt "parity-replace" \
  --out tests/parity-replace/iteration-1/eval-1/with_skill/run-1 \
  --model opus

# fixture 付き eval（前提が揃った状態から始める。evals.json の "fixture" をスキルディレクトリ相対で解決する）
scripts/eval/run-skill-eval.sh \
  --skill parity-replace --config with_skill \
  --prompt "parity-replace --feature order-list --target develop （新側の作業ツリーは clean で、コミット SHA は local-dev で green になった abc1234def5678 と同一です）" \
  --fixture evals/parity-replace/fixtures/lightweight-deploy-target \
  --out tests/parity-replace/iteration-1/eval-6/with_skill/run-1 \
  --model opus
```

- 使い捨てプロジェクトには `.replace/features.md`・設定・`.replace/parity/<slug>/metadata.json` が無い。
  そのため eval 1 は「捏造せずに停止し、replace-strategy setup / golden-dataset / parity-suite を順に案内する」パスを検証する。
  eval 2 は「`--feature` を指定しても slug を自分で採番せず、最初に欠ける前提（replace-strategy setup）で停止して setup を促す（後続の前提も合わせて案内する）」パスを検証する
- eval 3〜5 / 7 は、前提の有無に関わらず成立する拒否挙動を対象にする。
  パリティスイート無しで実装しない・リント off / 推測実装を拒否する・発見した差異を確認なしで進めない・既存のパッケージを探さずに自前実装を始めない、の 4 つである。
  eval 7 は実装中に部品が必要になった場面で、判断材料の確認と `.replace/dependencies.md` への記録を省略しないことを検証する（基準は `replace-strategy` の `references/dependency-selection.md` で定義する）
- eval 6 は fixture（設定・`.replace/features.md`・データセット／パリティスイートのメタデータ・`new/local-dev/` の green 証跡）で前提を揃える。
  `start` も `commit_check` も持たない配信型の target（develop）へ、軽量な手順を確認なしに適用しないパスを検証する
- eval 13 は、前提の有無に関わらず成立する取り決めの説明として、**DB の方言差を実装前に点検する**取り決めを検証する。
  具体的には、`references.db_semantics` を書く前に読む・未整備でも推測で埋めない・`porting.md` の「DB 方言差の点検結果」へ該当なしも含めて記録する・吸収しない差は `intentional_diffs.pending` へ回す、の 4 つである。
  点検項目は `replace-strategy` の `references/project-config.md`「DB 意味論」で定義する
- eval 14 の fixture（`legacy-verification-list`）は、`verification_commands` の値が**旧形式のコマンドリスト**（実行する範囲が未宣言）の設定を持つ。
  未宣言を「全体の走査」として扱わず、実装工程に入らずに停止し、`full` / `diff` の 2 列への移行を促すパスを検証する。
  移行の手順は `replace-strategy` の `references/project-config.md`「`verification_commands` の形の変更」で定義する
- eval 15 の fixture（`diff-limited-hooks`）は、`full` と `diff` の 2 列を持つ設定を持つ。**差分限定の列が緑でも、完了判定にはならない**ことを検証する。
  定義元の削除は変更集合の外を壊すので、差分限定では捕まらない。そのため手順 7 も `full` へ前倒しし、実行した列を証跡へ記録する
- eval 20 は eval 15 と同じ fixture で、**前倒しの条件を操作名で覚えると抜ける側**（Issue #329）を対象にする。
  共有された型への必須プロパティの追加は、削除も改名も含まない。条件を「削除・改名」の一覧として読むと、差分限定のまま敵対的レビューへ進んでしまう。
  機構（変更集合の外の判定を変えるか）で判断すること・利用側のテストが緑でも根拠にしないこと・証跡（`escalated_to_full`）を検証する。
  15 が削除側、20 が追加側で対になっている。20 だけでは「型の話が出たら常に `full`」と区別できないので、15 が対照になる。プロンプトには前倒しの語彙・キー名を書かない
- eval 16 は fixture 無しで、実装中に見つけた差を保留へ足す場面と、「明らかなものは keep へ移しておいて」という依頼を同時に与える。
  保留を散文 1 行で足さず、追記元（`item` / `slug` / 追記したスキル名 / 追記日）が分かる形で書くことを検証する。
  `keep` へ移すのは人間で、スキルは移さないことも検証する（Issue #279。要素の形は `replace-strategy` の `references/project-config.md` で定義する）
- eval 17 は fixture 無しで、非同期の敵対的レビュー中に同じ対象の実装を続けたい場面を与える。
  レビュー対象を結果の受領まで固定すること、待ち時間の作業を対象外へ限定すること、途中で対象を変更した場合は古い結果を採用せず変更・検証後の差分と未追跡ファイルを新しいラウンドへ渡すことを検証する（Issue #327）
- eval 18 は fixture 無しで、実装中に台帳（`.replace/assets.md`）に無い静的資産（`display: none` の `img` の親が疑似要素のグリフで描くアイコン）に出会い、機能の中で同等物に決めて進めたい場面を与える。
  台帳へ方針を空欄で戻して確認すること、決まるまで依存する実装単位を進めないこと、`porting.md` に判断を書かないこと、同等物なら実装前に `may_change` へ宣言することを検証する（Issue #368）
- eval 19 は fixture 無しで、移行元の CSS の宣言を「当てる相手が無いから反映しない」と決め、根拠に文字の位置だけを測った場面を与える（Issue #385）。
  箱の作り方を変える宣言が複数の次元を同時に変えること・箱の寸法を両側で並べて測ること・結論が誤りなら違う値になる観測を選ぶこと・`porting.md` への記録を検証する。
  どの方法で気づけるかは prompt で問う（初版では問わず、`with_skill` でも 3 つの方法の assertion に到達しなかった。iteration-19）
- eval 21 は fixture 無しで、**新側 green ＋ `full` 通過 ＋ 網羅表の `unmeasured` 0** の完了直前を与え、`parity-diff` へ渡してよいかを問う（Issue #337）。
  次を検証する。網羅表が移行元側の測定であること、`present` セルごとの新側との突き合わせを本スキルが書くこと、起点・当たり判定・完了の 3 点、
  承認が要る未突合、`component-comparison-check.mjs` の通過である。prompt には「まだ足りない」という結論を書かない
- eval 22（Issue #428）は手順 3 で、`.replace/dependencies.md` に**採否に至っていない 3 つの値**（内蔵・機能固有・未確認）の行がある台帳を読む側を測る。
  fixture（`dependency-ledger-states`）はその 3 行と、内蔵の根拠になるデータグリッドの `パッケージ採用` 行を持つ。
  fixture には「単体では実装しない」「このフェーズで決める」といった結論を書かず、事実（どのパッケージが描くか・どのページでしか使わないか・なぜ出せなかったか）だけを置く。
  差が出るように仕込んだ点は 3 つある。内蔵の部品を**単体で実装しない**こと（assertion 1）、覆りを**既存行の書き換えではなく状態列 ＋ 追記**で表すこと（assertion 3・4）、
  新しい行の `決定時期` を `setup` と書き分けること（assertion 5）である。
  **iteration-24 で実測**（各 config 1 run・claude-code / opus。fixture の矛盾を直した後）: `with_skill` 5/5・`without_skill` 3/5。
  **差が出たのは assertion 1・4** である。baseline は `内蔵` の行に「据え置きが自然」と書きながら、**指示どおり 3 件とも自前実装で進める**表を作った。
  覆した行は「状態列は触らず理由欄で失効を表現する」とした（原本の `取り消し済み` に至らない）。
  assertion 2・3・5 は Delta ではなく、後退の検知の項目として残す。baseline は contamination: clean / isolation: sandboxed。
  **iteration-23（fixture が矛盾していた版）との違いを残す**。そのときに差が出たのは assertion 2・4 で、baseline は `機能固有` を
  「台帳は更新不要」と読んで、採否の決定そのものを回避していた。fixture の `適用範囲: order-list` と理由 `/orders/:id でしか使わない` の
  食い違いが、「このフェーズの対象外」への逃げ道になっていたためである。**矛盾を消したら、assertion 2 は baseline も到達した**。
  fixture の矛盾が差を作っていた実例なので、Delta の内訳は fixture の整合と合わせて読む
- eval 23（Issue #451）は fixture 無しで、feature モードの完了のチェックをすべて通した直後に、**`parity-diff` を実行していない**状態を与える。
  そのうえで、「数値も見た目も現行と一致した」で完了報告をまとめてよいかを問う。
  見た目の一致を主張しないこと・`parity-diff` の担当であること・`converged: true` まで比較の収束を名乗れないこと・同じ target を `--target` で渡した `parity-diff` の案内を検証する。
  assertion 5 は、一致の主張を避けるあまり**完了そのものを取り消す**過剰な後退を落とす。prompt には「まだ一致とは言えない」という結論を書かない
  **iteration-25 で実測**（各 config 1 run・claude-code / opus）: `with_skill` 5/5・`without_skill` 2/5。**差が出たのは assertion 2・3・4** である。
  baseline も一致の主張は避け（assertion 1）、完了も取り消さない（assertion 5）。しかし、スイートが見る範囲と `parity-diff` の担当を区別せず、
  `converged: true` に触れず、「parity-diff を回してから」とだけ書いて target とコマンドの形を示さなかった。
  assertion 1・5 は Delta ではなく、後退の検知の項目として残す。baseline は contamination: clean / isolation: sandboxed
- eval 25（Issue #458）は fixture 無しで、完了判定の場面を与える。台帳で「全ページ／実体をコピーする／有効」の favicon を、新側がファイルだけ置いて `index.html` から指していない。
  静的資産の突き合わせは exit 1 になっている。この場面で、`used: false` で外して完了にしてよいかを問う。
  検証するのは 5 点である。1 つ目は、`used: false` で外さないこと（記録に `used` は書けず、外せるのは利用者の承認〈`disposition: accepted`〉だけ）。
  2 つ目は exit 1 のまま完了を名乗らないこと、3 つ目は配信物を直してプローブからもう一度測ることである。
  4 つ目は参照に加えてバイト一致も確かめる対象であること、5 つ目は突き合わせないなら利用者の承認（`disposition: accepted`）が要ることである。

  prompt には「外せない」という結論を書かない。
  **iteration-28 で実測**（各 config 1 run・claude-code / opus）: `with_skill` 5/5・`without_skill` 2/5。**差が出たのは assertion 3・4・5** である。
  baseline も `used: false` を記録の改ざんとして退け（assertion 1）、未完了とした（assertion 2）。しかし、プローブからもう一度測ることに触れず、
  バイト一致を確かめる対象に挙げず、突き合わせないときの承認の形を示さなかった。assertion 1・2 は Delta ではなく、後退の検知の項目として残す。
  baseline は contamination: clean / isolation: sandboxed。
  **iteration-29 で再取得した**（`used: false` の廃止に合わせて assertion 1 を改訂。各 config 1 run・claude-code / opus）: `with_skill` 5/5・`without_skill` 2/5 で、差が出たのは同じ assertion 3・4・5 だった
- 採点は `evals.json` の assertions と `result.json` / `project-files/` を突き合わせ、`grading.json` を残す
- 集計（`benchmark.json`）は `node scripts/eval/build-skill-eval-benchmark.js` で生成する（判定は assertion テキストで突き合わせる。`benchmark.md` は人が書く。詳細は `docs/skill-development.md`）
