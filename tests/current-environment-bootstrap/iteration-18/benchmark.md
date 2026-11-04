# Skill Benchmark: current-environment-bootstrap

**Model**: claude-code / opus（harness `run-skill-eval/5`）
**Date**: 2026-11-04
**Evals**: 2（`with_skill` と `without_skill` を 1 run ずつ）

## 目的

Issue #864 で、停止と再開・層の確認待ち・本番由来かの記録の形を決めた後の変更確認である。
入力を変えた eval 5（fixture と assertion 1）と、新しく足した eval 7 だけを実行した。
比べ方は `docs/skill-development.md`「前回の記録との比べ方」に従う。eval 5 と比べる記録は、eval 5 を含む最も新しい iteration-11 である。eval 7 は新しく足したので、比べる記録は無い。

## 入力の変更

- `metadata.json` に `resume`（`from_step` と `deferred`）を足し、`blocked_on` を `工程 <番号>: <理由>` の形にした。
  `resume` が無い既存の記録では、再開する工程を推測せず、`--autonomous` でも利用者に確かめて止まる（`SKILL.md`・`assets/metadata-template.json`）。
- `schema.md` の 1 節の区分に「層の確認待ち」を足し、SQL の解釈を変えるモード設定も層で行を分けた（`assets/schema-template.md`・`references/asset-inventory.md`）。
- 棚卸しの「出所」列を「受け取った経緯」に改め、「本番由来か」とその根拠の列を足した（`assets/assets-inventory-template.md`）。
- eval 5: prompt に `--target current-rebuilt` を、`requires_skills` に `replace-strategy` を足した。fixture の `metadata.json` に `resume`（`from_step: 6`）を足し、棚卸しと `schema.md` を新しいテンプレートの形にした。
  タイムゾーンと sql_mode は「層の確認待ち」にし、層を確かめる Q-4 に回答が返った状態にした。文字コードと照合順序は、受領物のヘッダと接続文字列で層ごとに確定させた。
  assertion 1 の「blocked_on を読んで」を「resume.from_step を読んで」に変えた。
- eval 7（新規）: eval 5 の変更前の fixture を、`resume` が無い既存の記録として使う。prompt は `--target current-rebuilt --resume --autonomous` で、`replace-strategy` を両方の config に置く（`requires_skills`）。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 5 | あり | 3/5 | 0/5 | 3/5（iteration-11） |
| 7 | 新規 | 3/4 | 3/4 | - |

eval 5 の assertion 1 は文を変えたので、前回とは比べない。assertion 2〜5 の with_skill は、前回と同じ判定（2・3 が pass、4・5 が fail）である。

## 変更の効果

- eval 7: with_skill は `resume` が無いことを理由に止まり、再開する工程の指定を求めた。回答は台帳に反映してから止まった。
  `status` は示したが、`blocked_on` は値を示さなかったので、assertion 2 は fail にした。
  without_skill は、`replace-strategy` の `SKILL.md` の「入っていなければ導入手順を示して止まる」に従って止まり、再開する工程は確かめなかった。
- eval 5: with_skill は `resume.from_step` を読んで工程 6 から再開し、Q-4 の回答で `schema.md` の層の確認待ちの 4 行を確定にした。止まるときも `from_step: 6` を書いた。
- eval 5 の without_skill は、`replace-strategy` の `SKILL.md` の「入っていなければ導入手順を示して止まる」に従って止まり、台帳を書き換えなかった。
  `replace-strategy` を置く前の run では、without_skill は fixture の `resume` を読んで工程 6 から再開し、4/5 だった。

## 前回より下がったものと、その原因

- 無し。eval 5 の assertion 4 と 5 は iteration-11 でも fail で、今回の変更とは関係しない。
  with_skill は `password_hash` の方式が分からないとして暫定データを作らずに止まり、`db.seedable` の確認にも触れなかった。
  `replace-strategy` を置く前の run では、without_skill がハッシュ済みの値を環境変数で受け取る投入ツールを作り、assertion 4 を満たした。
  assertion 4 と 5 の扱い（スキルが投入ツールを作らずに止まることが正しいか）は 1 run では判断できないので、eval 5 の 3 run の実行を残りの作業に挙げる。

## 区別しない assertion

- eval 5 の without_skill は、`current-environment-bootstrap` が入っていないことを理由に止まったので 0/5 になった。この差はスキルが無いことによるもので、スキルの効果ではない。
  `benchmark.json` の `delta` は eval 5 と eval 7 をまとめた値で、どちらの without_skill も前提スキルが無いことを理由に止まっているので、スキルの効果として読まない。

- eval 7 の assertion 2〜4 は、without_skill も満たした。`replace-strategy` を置いたので、without_skill はスキルが無いことを理由に止まるからである。
  区別するのは assertion 1（再開する工程を確かめるために止まる）だけである。2〜4 は、止まる代わりに推測で進む後退を検知するための assertion で、Delta には数えない。

## 実行し直した run

- eval 5 と eval 7: PR #884 の local レビューの指摘で、eval 5 の fixture（2 節の層の行）と eval 7 の prompt（`--target`）を直したので、両方を実行し直した。
- eval 7: 実行し直した run で、with_skill が `replace-strategy` の `autonomy.md` を読めないことも止まる理由に挙げた。`requires_skills` を足して、もう一度実行した。
- eval 5: 反復 2 の local レビューの指摘で、prompt に `--target` を、`requires_skills` に `replace-strategy` を足して、もう一度実行した。
- eval 5 と eval 7 の with_skill: 反復 5 で再開の扱いを表にまとめた後の `SKILL.md` で、もう一度実行した。without_skill はスキルを読まないので、前の run を使った。
- それより前の run は、入力が今と違うので集計から外した。

## 集計から外したもの

- 上の「実行し直した run」の前の run（入力が今と違う）。
