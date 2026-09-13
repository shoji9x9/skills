# Skill Benchmark: issue-start

**Model**: claude-code / opus
**Date**: 2026-09-13
**Evals**: 12（1 run each per configuration。変更確認スコープなので Delta の数値は語らない）

## Summary

| eval | with | without | 弁別した assertion 数 |
|---|---|---|---|
| 12 `--branch-only` | 6/6 | 4/6 | 2 |

## 経緯

eval 12 は `--branch-only` モードの新設に合わせて追加したもので、**最初の形は eval 環境で目的の挙動へ到達しなかった**。

- 当初の prompt は `issue-start 12 --branch-only`（実行させる形）だった。使い捨てプロジェクトは空で git リポジトリではないため、
  `with_skill` は issue-start のハード前提（現在の repo と Issue の repo の一致確認）で正しく停止し、
  ブランチ名の決定・`gh issue develop` の呼び出しといったモード固有の挙動まで届かなかった（6 件中 4 件が到達不能）。
- 既存の eval 7・8 と同じ「実行せず手順を説明させる」形へ prompt と assertion を書き直したところ、両 config とも到達した。
  リポジトリを要する eval は fixture（`pr-base-*`）を持つ eval 2・9・10・11 が担っており、モード契約の確認はこの形が適している。

## 読み取れたこと

- `with_skill` は 6/6。`--branch-only` を「ブランチ作成・checkout と現状検証まで行って手順 9 で呼び出し元へ返る」モードとして説明し、
  ベースブランチを規約から解決して `main` に固定しないこと、commit / push / PR がこのモードの対象外であることを明示した。
- `without_skill` は 4/6。スキル定義が無いため仕様としては答えられないと断ったうえで、名前から推測した流れを提示した。
  推測でも「ブランチを作って切り替えて返る」「commit / push / PR は省く」までは当てている。
  外したのは 2 本で、ブランチ名の形式（`issue-12-<slug>` と推測）と作成手段（`git switch -c` と推測。`gh issue develop` ではない）。
  後者は **Issue との紐付けが作られない作り方**で、このスキルが最も避けたい誤りがそのまま出ている。

### 採点の訂正と、assertion の弱さ

**当初 3/6・弁別 3 と記録したが 4/6・弁別 2 が正しい。** assertion 1（ブランチ作成・checkout まで行って返るモードとして説明している）を
`without_skill` は満たしていないと採点したが、応答は「`issue-12-<slug>` を作り、切り替える（`git switch -c`）」「ここで返す」と述べており、
`git switch -c` は作成と checkout を兼ねる。コミット前レビューの指摘で気付いて訂正した。

**assertion 1 と 4 は重なっている。** どちらも「ブランチを用意した後に返る」ことを問うており、
1 は「モードの説明として」、4 は「調査・実装へ進まない」と角度が違うだけで、片方が通れば他方も通りやすい。
弁別に効いているのは 2（ブランチ名の形式）と 3（`gh issue develop` とベースブランチの解決）の 2 本だけである。
次に触るときは 1 を、モードの**終わる位置**（手順 9 で返る／手順 10 の push 前確認は対象外）に絞ると重なりが取れる。
