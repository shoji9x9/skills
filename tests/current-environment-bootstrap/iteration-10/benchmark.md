# Skill Benchmark: current-environment-bootstrap

**Model**: claude-code / opus（harness `run-skill-eval/4`）
**Date**: 2026-10-15
**Evals**: 2（`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

Issue #614 で、evals.json などの全角ダッシュを 2 つ続けた記号（U+2014 の連続）を書き換えた（意味を変えない表記の変更）。
あわせて eval 3・4 の prompt・assertion・fixture・`requires_skills` を直した。

- prompt に `--target current-rebuilt` と、各 assertion を引き出す問いを足した。
- eval 3 の fixture に、接続の設定（`context.xml`）とサーバーの設定の生の出力（`my.cnf`・`*.txt`）を足し、`schema.sql` を mysqldump の出力の形にそろえた。
- 複数の主張を束ねた assertion を分け、成果物の有無だけを見る assertion を、停止理由の判断を見る形にした。
- 両方の eval に `requires_skills: ["replace-strategy"]` を宣言した。

スキル本文（SKILL.md・references）は変えていない。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 3 | prompt・assertion・fixture・requires_skills | 8/8 | 4/8 | 4/6（iteration-7） |
| 4 | prompt・assertion・requires_skills | 10/10 | 6/10 | 6/6（iteration-8） |

with_skill の平均 pass_rate は 1.00、without_skill は 0.55。どちらの eval も、スキルの有無の差は残っている。

## 前回から変わった assertion

assertion の数と文が変わったので、文の対応で比べた。

- eval 3 の with_skill: スキーマと DB 設定と、データ意味論を分けて判定する assertion（1 行目）が、iteration-7 の F から P になった。
  iteration-7 は、スキーマと DB 設定の根拠が fixture に無く、工程 3 で不足として止まっていた。
  この run は工程 3 を「値はすべて根拠付きで確定。構築は docker が無いため未実施」として通過し、工程 4・5 を終えて工程 6 で止まった（`status: blocked`）。
- eval 3 の with_skill: 引き継ぎを見る assertion を 3 つ（`blocked_on`・`handoff.boot_requirements`・`semantics.pending_features`）に分けた。3 つとも P である。
  iteration-7 では 1 つにまとめた assertion が F だった。
- eval 4 の with_skill: 分けた後の 10 行とも P である。iteration-8 は前提スキルが無いことも停止理由に挙げていたが、この run は出所と利用許可が不明なことだけを理由に工程 2 で止まった。

## 差が消えた assertion

この run で `without_skill` も満たした assertion は次のとおりである。1 run の結果なので、確定ではない。

- eval 3: 1 行目（スキーマ・DB 設定とデータ意味論を分けて判定）、2 行目（enum の値を確認待ちとして記録）、4 行目（起動に必須の項目とそうでない項目を区別）、6 行目（`blocked_on` に起動に必須でない確認待ちを挙げない）。
  `without_skill` は宣言した `replace-strategy` の SKILL.md を読み、取り決めに沿って `metadata.json` を手で作っていた。
- eval 4: 2 行目（dump の行を確定根拠にしない）、3 行目（ドメイン値を暫定データへ転記しない）、6〜9 行目（投入しない・建ったと報告しない・個人データを書き出さない・空のテンプレートを置かない）。
  `without_skill` は current-environment-bootstrap が無いことを理由に止まり、ファイルを作らなかったので、これらを満たした。

差が残った assertion は、eval 3 の 3・5・7・8 行目と、eval 4 の 1・4・5・10 行目である。

eval 4 の `without_skill` は、`replace-strategy` の `references/scope.md` を読んでいない。
raw にあるのは SKILL.md への `grep` と `sed -n 140,240p` だけで、dump は `head` と `sed` で開いて「ダミーのデータ数件」と述べている。
停止の理由は current-environment-bootstrap が無いことで、出所と利用許可ではない。

## 集計から外したもの

- 無し
