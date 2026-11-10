# Skill Benchmark: current-environment-bootstrap

**Model**: claude-code / opus / high（harness `run-skill-eval/5`）
**Date**: 2026-11-10
**Evals**: 2（`with_skill` と `without_skill` を 1 run ずつ）

## 目的

Issue #892 で、引き渡した後の記録に回答や資産が届いたときの扱い、工程 7・8 を通し直す範囲、`blocked_on` の書き方を決めた後の変更確認である。
新しく足した eval 8・9 だけを実行した。どちらも新しく足したので、比べる記録は無い。
既存の eval（5・7）は fixture・prompt・assertion を変えておらず、`blocked` の記録の再開の表も行を変えていないので、実行していない。

## 入力の変更

- `SKILL.md`「停止と再開」に「引き渡した後に届いたとき」を足した。
  作り直しのツールか、暫定の起動データとその投入ツールを直す必要があるか、`schema.md` に「不足」の行ができるかで分ける。
  どちらも無ければ、台帳と `metadata.json` の対応する値だけを直して `handed-off` のまま終える。
  どちらかがあるか迷うなら、`blocked` に戻し（`from_step` は 3 か 6）、設定の `url` と `default` の取り消しを利用者に確かめる。
- 再開するときに工程 3 か工程 6 のツールやデータを直し、`from_step` が 8 か 9 なら 7 に書き直す。
- `blocked_on` は再開するときに書き換えない。利用者が答えた工程が `blocked_on` の最も小さい工程より後なら、前の理由が解けたかを確かめる。
- 設定に書く箇所を「引き渡しと、その取り消し」の 2 か所にした（`SKILL.md`・`references/verification-handoff.md`・`replace-strategy` の `references/project-config.md`）。
- eval 8（新規、`handed-off-layer-confirmed`）・eval 9（新規、`handed-off-layer-session`）: eval 5 の受領物を引き渡した後の記録に、Q-4 の回答が届いた状態。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 8 | 新規 | 4/4 | 2/4 | - |
| 9 | 新規 | 5/5 | 1/5 | - |

汚染の判定は 4 run ともファイルの読み取りが無く、with_skill の `invalid_run` は 2 run とも false だった。

## 変更の効果

- eval 8: with_skill は、`bootstrap/schema.sh` が元からヘッダの値をインスタンスに設定していることを確かめ、ツールを直さずに `handed-off` のまま終えた。
  `schema.md` の 4 行を確定にし、`handoff.unconfirmed` と `questionnaire_refs` から Q-4 だけを外した。工程を聞いて止まることも無かった。
- eval 9: with_skill は、インスタンスの 2 行を「不足」にし、`blocked` に戻して `from_step: 3` を書いた。
  設定の `url` と `default` は書き換えず、取り消してよいかを 2 つのコマンドと選択肢で確かめた。
  工程 3 で不足のためもう一度止まったので、設定の取り消し・工程 6 の投入・工程 7・8 の実測を `deferred` に書いた。後回しにした操作を書く既存の規則どおりである。
- without_skill は 2 run とも、`replace-strategy` の `SKILL.md` の「入っていなければ導入手順を示して止まる」に従って止まり、ファイルを変えなかった。
  eval 8 の assertion 1・2 と eval 9 の assertion 5 は、何もしなくても満たすので、区別には使えない。それぞれ、`blocked` に戻す後退、工程を聞いて止まる後退（#892 の前の挙動）、`handoff` を消す後退を検知する。
  差はスキルが無いことによる停止で生じたもので、止まらない baseline に対して差が残るかは、複数の run で確かめていない。

## run の後にスキルを変えた箇所

この 4 run の後に、`/code-review --fix` の指摘で `SKILL.md` と `references/verification-handoff.md` を直した。実行し直していない。

- 取り消しの書き込みの順序を、`default: false` を先、`url: none` を後に変えた
- `blocked` に戻すときに `from_step` を決められなければ、`resume` を `null` にして再開の表の 2 行目で確かめる、と書いた
- `blocked_on` を再開するときに書き換えない規則に、解けた理由を消す場合を除くと書いた
- `status` の表と終わり方の記述に、`handed-off` のまま終える流れを足した

eval 8・9 の assertion が見る値（`status`・`blocked_on`・`from_step`・`schema.md` の区分・取り消しを確かめること・`handoff`）は、どの変更でも変わらない。

## 捨てた run

最初の 4 run は集計に入れていない。fixture と assertion を直してから、同じ条件で実行し直した。

- eval 8 の fixture の `bootstrap/schema.sh` は、インスタンスのタイムゾーンと sql_mode を設定していなかった。
  with_skill はこれを「ツールを直す必要がある」と判断して `blocked` に戻した。規則どおりの判断なので、確認待ちを確定させるだけの場面になるよう、ヘッダの値をインスタンスに設定する形に直した（eval 9 の fixture も同じ）。
- eval 9 の assertion 2 は「空の `deferred`」も求めていた。`blocked` に戻した後、工程 3 から再開して不足で止まれば、後回しにした操作を `deferred` に書くのが規則どおりなので、`from_step` だけを求める文に直した。
