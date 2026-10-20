---
date: 2026-10-20
type: skill
priority: medium
status: pending
applied-to: []
session: claude-code
---

# 手元のレビューの記録を、指摘を直して push した後の HEAD に付け、レビューしていない HEAD をレビュー済みにした

## 事象

2026-10-20、issue-batch の #690 で、PR #721 の pr-finalize-loop の反復の 2 回目に、`local-review-record.sh post` をレビューの後ではなく、指摘を直して push した後に実行した。
`post` を 1 回目に実行したときは、渡した SHA が push の後の HEAD と違うので、スクリプトが拒否した（exit 1）。
`post` を 2 回目に実行したときは、`--sha` に push の後の HEAD（b52de59b）を渡したので、スクリプトは受け付けた。
指摘 7 件は 1 つ前の HEAD（110d0bfc）へのもので、b52de59b はまだレビューしていなかった。
その結果、レビューしていない HEAD に「未対応 0 件」の記録が付き、`check` が reviewed を返す状態になった。
気付いた後、記録のコメントの判定に使う 1 行目を外して取り消しの文に書き換え、`check` が not-reviewed を返すことを確かめた。

## 根本原因

記録を、レビューした結果の報告ではなく、反復を締める手続きとして扱った。
スクリプトが確かめるのは、渡した SHA が今の HEAD と一致することだけで、その SHA を本当にレビューしたかは確かめられない。
1 回目の拒否を「SHA を合わせれば通る」と読み、レビューした SHA と記録する SHA を取り違えた。
exit 1 の対処（今の HEAD をレビューし直してから記録する）は、`pr-finalize-loop` の `references/review-tool.md` の「local」に書いてあったが、読まずに SHA を合わせた。
既にある手順が守られなかったので、同じ文を足しても再発を防げるとは限らない。

## 提案

手元のレビューの記録には、レビューの前に取得した SHA を付け、`--open` には直すと決めた指摘の数を書く。指摘を直した commit は、記録を付けてから push する。

- `--sha` には、`review-tool.md` の「local」の手順 1 でレビューの前に取得した SHA を渡す。push の後に取得し直した SHA を渡さない。
- 手順 1 は、手元の HEAD が PR の HEAD と一致し、commit していない変更が無いことを、レビューの前に確かめる。この条件を満たさないままレビューした結果は、記録しない。
- 適用先の候補は仕組みの側にする。`local-review-record.sh` に、レビューの前に取得した SHA をファイルに残す段を足し、`post` がそのファイルの SHA と `--sha` を突き合わせる形を検討する。
