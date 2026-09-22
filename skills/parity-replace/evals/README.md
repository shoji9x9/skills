# parity-replace の回帰テスト

テストケースは [`evals.json`](evals.json)。実行・採点・集計の共通手順は `docs/skill-development.md`「回帰テストを実行する」に従う。

## 前提

実アプリ・DB・ブラウザ（Playwright）・パリティスイート・新側コードベースを要する全フロー（ページ分割 〜 実装 〜 新側マッピング充填 〜 敵対的レビュー 〜 スイート green）は
使い捨てプロジェクト（空・非対話）では回せない。そのため本スキルの evals は、**前提が無い環境での停止パス**
（replace-strategy setup / golden-dataset / 対象 slug の parity-suite 未完了）と、**禁止事項の拒否挙動**
（パリティスイート無しで実装しない・リント off / 推測実装の拒否・差異を確認なしで判断しない）を対象にしている。

## 実行例

```bash
scripts/run-skill-eval.sh \
  --skill parity-replace --config with_skill \
  --prompt "parity-replace" \
  --out tests/parity-replace/iteration-1/eval-1/with_skill/run-1 \
  --model opus

# fixture 付き eval（前提が揃った状態から始める。evals.json の "fixture" をスキルディレクトリ相対で解決する）
scripts/run-skill-eval.sh \
  --skill parity-replace --config with_skill \
  --prompt "parity-replace --feature order-list --target develop （新側の作業ツリーは clean で、コミット SHA は local-dev で green になった abc1234def5678 と同一です）" \
  --fixture skills/parity-replace/evals/fixtures/lightweight-deploy-target \
  --out tests/parity-replace/iteration-1/eval-6/with_skill/run-1 \
  --model opus
```

- 使い捨てプロジェクトには `.replace/features.md`・設定・`.replace/parity/<slug>/metadata.json` が無いため、eval 1 は「捏造せず停止し replace-strategy setup / golden-dataset / parity-suite を順に案内」、
  eval 2 は「`--feature` 指定でも slug を自分で採番せず、最初に欠ける前提（replace-strategy setup）で停止して setup を促す（後続の前提も合わせて案内）」パスを検証する
- eval 3〜5 / 7 は前提の有無に関わらず成立する拒否挙動（パリティスイート無しで実装しない・リント off / 推測実装の拒否・発見した差異を確認なしで進めない・既存パッケージを探さず自前実装を始めない）を対象にする。
  eval 7 は実装中に部品が必要になった場面で、判断材料の確認と `.replace/dependencies.md` への記録を省略しないことを検証する（基準の正本は `replace-strategy` の `references/dependency-selection.md`）
- eval 6 は fixture（設定・`.replace/features.md`・データセット／パリティスイートのメタデータ・`new/local-dev/` の green 証跡）で前提を揃え、
  `start` も `commit_check` も持たない配信型 target（develop）へ軽量経路を確認なしに適用しないパスを検証する
- eval 13 は前提の有無に関わらず成立する契約説明として、**DB の方言差を実装前に点検する**契約（`references.db_semantics` を書く前に読む・未整備でも推測で埋めない・`porting.md` の「DB 方言差の点検結果」へ該当なしも含めて記録する・吸収しない差は `intentional_diffs.pending` へ回す）を検証する。
  点検項目の正本は `replace-strategy` の `references/project-config.md`「DB 意味論」
- eval 14 の fixture（`legacy-verification-list`）は `verification_commands` の値が**旧形式のコマンドリスト**（走る範囲が未宣言）の設定を持たせ、
  未宣言を「全体走査」に倒さず実装工程に入らず停止し、`full` / `diff` の 2 列への移行を促すパスを検証する（移行の正本は `replace-strategy` の `references/project-config.md`「`verification_commands` の形の変更」）
- eval 15 の fixture（`diff-limited-hooks`）は `full` と `diff` の 2 列を持つ設定を持たせ、**差分限定の列が緑でも完了判定にはならない**こと
  （定義元の削除は変更集合の外を壊すため差分限定では捕まらない・手順 7 も `full` へ前倒しする・実行した列を証跡へ記録する）を検証する
- eval 20 は eval 15 と同じ fixture で、**前倒しの条件を操作名で覚えると抜ける側**（Issue #329）を対象にする——共有された型への必須プロパティの追加は削除も改名も含まないため、
  条件を「削除・改名」の一覧として読むと差分限定のまま敵対的レビューへ進んでしまう。機構（変更集合の外の判定を変えるか）での判断・利用側のテストが緑でも根拠にしないこと・証跡（`escalated_to_full`）を検証する。
  15 が削除側、20 が追加側で対になっており、20 だけでは「型の話が出たら常に `full`」と区別できないため 15 が対照になる。プロンプトには前倒しの語彙・キー名を書かない
- eval 16 は fixture 無しで、実装中に見つけた差を保留へ足す場面と「明らかなものは keep へ移しておいて」という依頼を同時に与える。
  保留を散文 1 行で足さず追記元（`item` / `slug` / 追記スキル名 / 追記日）が分かる形で書くこと、`keep` へ移すのは人間でありスキルは移さないことを検証する（Issue #279。要素の形の正本は `replace-strategy` の `references/project-config.md`）
- eval 17 は fixture 無しで、非同期の敵対的レビュー中に同じ対象の実装を続けたい場面を与える。
  レビュー対象を結果受領まで固定すること、待ち時間の作業を対象外へ限定すること、途中で対象を変更した場合は古い結果を採用せず変更・検証後の差分と未追跡ファイルを新しいラウンドへ渡すことを検証する（Issue #327）
- eval 18 は fixture 無しで、実装中に台帳（`.replace/assets.md`）に無い静的資産（`display: none` の `img` の親が疑似要素のグリフで描くアイコン）に出会い、機能の中で同等物に決めて進めたい場面を与える。
  台帳へ方針空欄で戻して確認すること、決まるまで依存する実装単位を進めないこと、`porting.md` に判断を書かないこと、同等物なら実装前に `may_change` へ宣言することを検証する（Issue #368）
- eval 19 は fixture 無しで、移行元の CSS の宣言を「当てる相手が無いから写さない」と決め、根拠に文字の位置だけを測った場面を与える（Issue #385）。
  箱の作り方を変える宣言が複数の次元を同時に変えること・箱の寸法を両側で並べて測ること・結論が誤りなら違う値になる観測を選ぶこと・`porting.md` への記録を検証する。
  「どの経路で気づけるのか」は prompt で問う（初版では問わず、`with_skill` でも 3 経路の assertion に到達しなかった。iteration-19）
- eval 21 は fixture 無しで、**新側 green ＋ `full` 通過 ＋ 被覆表 `unmeasured` 0** の完了直前を与え、`parity-diff` へ渡してよいかを問う（Issue #337）。
  被覆表が移行元側の測定であること・`present` セルごとの新側突き合わせを本スキルが書くこと・入口・当たり判定・完了の 3 点・
  承認が要る未突合・`component-comparison-check.mjs` の通過を検証する。prompt には「まだ足りない」という結論を書かない
- eval 22（Issue #428）は手順 3 で、`.replace/dependencies.md` に**採否に至っていない 3 つの値**（内蔵・機能固有・未確認）の行がある台帳を読む側を測る。
  fixture（`dependency-ledger-states`）はその 3 行と、内蔵の根拠になるデータグリッドの `パッケージ採用` 行を持たせる。
  fixture には「単体では実装しない」「このフェーズで決める」といった結論を書かず、事実（どのパッケージが描くか・どのページでしか使わないか・なぜ出せなかったか）だけを置く。
  仕込んだ弁別は 3 つ——内蔵の部品を**単体で実装しない**こと（assertion 1）、覆りを**既存行の書き換えではなく状態列 ＋ 追記**で表すこと（assertion 3・4）、
  新しい行の `決定時期` を `setup` と書き分けること（assertion 5）。
  **iteration-24 で実測**（各 config 1 run・claude-code / opus。fixture の矛盾を直した後）: `with_skill` 5/5・`without_skill` 3/5。
  **弁別したのは assertion 1・4**——baseline は `内蔵` の行に「据え置きが自然」と書きながら**指示どおり 3 件とも自前実装で進める**表を作り、
  覆した行は「状態列は触らず理由欄で失効を表現する」とした（正本の `取り消し済み` に至らない）。
  assertion 2・3・5 は Delta ではなく後退検知の項目として残す。baseline は contamination: clean / isolation: sandboxed。
  **iteration-23（fixture が矛盾していた版）との違いを残す**: あのときの弁別は assertion 2・4 で、baseline は `機能固有` を
  「台帳は更新不要」と読んで採否の決定そのものを回避していた。fixture の `適用範囲: order-list` と理由 `/orders/:id でしか使わない` の
  食い違いが「このフェーズの対象外」への逃げ道になっていたためで、**矛盾を消したら assertion 2 は baseline も到達した**。
  fixture の矛盾が弁別を作っていた実例なので、Delta の内訳は fixture の整合と合わせて読む
- 採点は `evals.json` の assertions と `result.json` / `project-files/` を突き合わせ、`grading.json` を残す
- 集計（`benchmark.json`）は `node scripts/build-skill-eval-benchmark.js` で生成する（判定は assertion テキストで突き合わせる。`benchmark.md` は人が書く。詳細は `docs/skill-development.md`）
