---
date: 2026-10-20
type: doc
priority: medium
status: pending
applied-to: []
session: claude-code
---

# 手元のレビューの記録を、指摘を直して push した後の HEAD に付け、レビューしていない HEAD をレビュー済みにした

## 事象

2026-10-20、issue-batch の #690 で、PR #721 の pr-finalize-loop の 2 回目に、`local-review-record.sh post` をレビューの後ではなく push の後に実行した。
1 回目は、指摘を直して push した後だったので、SHA が HEAD と違うとスクリプトが拒否した（exit 1）。
2 回目は、同じ順で `--sha` に push 後の HEAD（b52de59b）を渡したので、スクリプトは受け付けた。
指摘 7 件は 1 つ前の HEAD（110d0bfc）へのもので、b52de59b はまだレビューしていなかった。
その結果、レビューしていない HEAD に「未対応 0 件」の記録が付き、`check` が reviewed を返す状態になった。
気付いた後、記録のコメントの判定に使う 1 行目を外して取り消しの文に書き換え、`check` が not-reviewed を返すことを確かめた。

## 根本原因

記録を、レビューした結果の報告ではなく、反復を締める手続きとして扱った。
スクリプトが確かめるのは、渡した SHA が今の HEAD と一致することだけで、その SHA を本当にレビューしたかは確かめられない。
1 回目の拒否を「SHA を合わせれば通る」と読み、レビューした SHA と記録する SHA を取り違えた。

## 提案

手元のレビューの記録は、レビューのサブエージェントが報告した SHA で、push の前に投稿する。push の後に記録が無いことに気付いたら、新しい HEAD をレビューしてから記録する。

- `--sha` には、レビューの報告にある完全な SHA を構造化された出力から取って渡す。今の HEAD を `git rev-parse` で取って渡さない。
- `post` が exit 1（SHA が HEAD と違う）を返したら、HEAD をレビューし直す。SHA を合わせて通さない。
