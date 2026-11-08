# Skill Benchmark: issue-create

**Model**: opus（claude-code）
**Evals**: 10（Issue #937 で足した `--parent` の eval の変更確認。configuration ごとに 1 run）

## Summary

| Metric | With Skill | Without Skill | Delta |
|--------|------------|---------------|-------|
| Pass Rate | 100% | 80% | +0.20 |
| Time | 38.8s | 36.4s | +2.4s |
| Tokens | 97958 | 76139 | +21819 |

| eval | with_skill | without_skill |
|------|------------|---------------|
| 10（作った Issue を既存の Issue の sub-issue にする） | 5/5 | 4/5 |

## 差が出なかった項目

without_skill も、REST の `sub_issues` に Issue の `id` を渡し、紐付ける前に親を確かめ、別の親が付いていれば `replace_parent` で置き換えずに止めた。
sub-issue の API と、親を置き換えない判断は、一般の知識で答えられる。eval 10 は、手順を消したり変えたりしたときの後退の検出のために置く。

without_skill が落ちた 4 つ目の assertion は、紐付けた後の確認を親の sub-issue の一覧で行ったためである。
同じ関係を確かめる別の正しい方法なので、スキルの手順の差ではない。
この assertion は、どちらの方法も通る文に直した。次の実行からは、文が変わったので、この記録とは比べない。

## 実行の条件

with_skill の run を始めた後に、`references/split.md` に `parent.md` への案内を 1 行足した。
eval 10 は Issue を分けない場合なので、run が読んだのは `references/parent.md` だけで、この 1 行は結果に関わらない。
