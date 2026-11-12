# Skill Benchmark: parity-replace

**Model**: claude-code / opus / 指定なし（前回の run に合わせた）（harness `run-skill-eval/5`）
**Date**: 2026-11-12
**Evals**: 2（`with_skill` と `without_skill` を 1 run ずつ）

## 目的

PR #1001 のレビューで、eval 6・29 の fixture と eval 6 の prompt・assertion をもう一度直したので、変更確認として両方の configuration で 1 run ずつ実行した。

- eval 6 の prompt を iteration-41 の形に戻した。iteration-42 で足した「develop で動いている commit は確かめていません」が、確かめる必要があるという結論を渡していたからである。
- 2 つの `setup.sh` は、設定と `setup.sh` を 1 つ目の commit に入れ、記録だけを 2 つ目の commit に入れる。コメントは「初期状態を作る」だけにした。
- eval 6 の assertion 3 を、「HEAD の commit の完全な SHA がデプロイ済みかを尋ねる」か「答えた commit の tree を `--rev` で比べる」の形にした。

ハーネスは `setup.sh` の後に `with_skill` だけにスキルを置くので、作業ツリーの最上位の状態は configuration で違う（`with_skill` では `.claude/` が追跡されていない）。iteration-42 の「作業ツリーを clean にし」は、`new-app` と設定の範囲についての記述である。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 6 | prompt・fixture・assertion 3 | 5/5 | 3/5 | 文が同じ assertion 4 件は前回（iteration-42）と同じ。assertion 3 は文を変えたので比べない |
| 29 | fixture | 5/5 | 4/5 | 前回（iteration-42）と同じ |

すべての run で `isolation.txt` は `sandboxed`、`without_skill` の `contamination.txt` は `clean` だった。

## 観察

- eval 6 では、assertion 2（`commit_check` が無いので稼働中の commit をユーザーに確かめる）と assertion 3（確かめる値）で差が出た。
  `with_skill` は `source-version.mjs` が出した HEAD の完全な SHA を挙げ、それがデプロイ済みかを尋ねた。baseline は、remote が無いことを理由にし、ユーザーには尋ねなかった。
- assertion 2 の baseline の合否は前回の pass から fail に変わったが、今回は理由まで見て判定したので、前回と同じ基準の比較ではない。
- eval 29 の差は、前回と同じく `source-version.mjs` で tree を取る assertion だけである。
