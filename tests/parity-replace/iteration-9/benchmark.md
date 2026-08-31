# Skill Benchmark: parity-replace

**Model**: claude-opus-5
**Date**: 2026-08-31T06:53:28Z
**Evals**: 13 (1 run each per configuration)

## Summary

| Metric | With Skill | Without Skill | Delta |
|--------|------------|---------------|-------|
| Pass Rate | 100% ± 0% | 17% ± 0% | +0.83 |
| Time | 102.1s ± 0.0s | 128.7s ± 0.0s | -26.6s |
| Tokens | 266200 ± 0 | 37665 ± 0 | +228535 |

## 対象と結果（Issue #262 DB 方言差の点検表）

eval 13 は「DB 製品が違うが SQL は標準に近いので素直に書き写し、DB 固有の差は実装後の敵対的レビューで拾う。
パリティスイートが green なら問題ない。点検表は未整備。何を見ればいいか／全部見れば差は出尽くすか／吸収すれば記録は要らないか」への応答を見る。

- with_skill 6/6: 「点検せずにクエリを書かない」の禁止事項を引いて書く前の工程だと答え、5 つの点検項目を列挙、
  点検表は網羅でも実測の代替でもなく実測は `golden-dataset` フェーズ B と `parity-suite` が担うと述べ、
  `references.db_semantics` 未整備でも停止せず一次ドキュメントで確認、`porting.md` の「DB 方言差の点検結果」へ該当なしも含めて記録、
  吸収しない差は `intentional_diffs.pending` へ回す、スイート green を点検の代替にしない、をすべて満たした
- without_skill 1/6: 点検クラスの列挙は一般知識で網羅的に到達し（NULL 順序・照合順序・暗黙変換・丸め・TZ 等）、
  「出尽くさない」「記録は必要」も自力で到達する。通ったのはスイート green を根拠にしない項のみ。
  設定キー `references.db_semantics`、記録先の `porting.md`「DB 方言差の点検結果」、`intentional_diffs.pending`、
  実測の担い手（`golden-dataset` フェーズ B / `parity-suite`）はいずれも出ない

## アサーション 2 の弁別性（初版からの修正）

初版のアサーション 2 は点検項目 5 つの列挙だけを問うていたが、これは**汎用の移植知識でベースラインも自力で満たす**
（`.agents/rules/eval-assertion-discrimination.md` の「弁別」）。実測でもベースラインは A〜F の 6 分類で 5 項目すべてを含む点検表を出しており、
初版のままなら弁別しなかった。

- 「点検表は網羅ではなく実測の代替にもならず、**実測は `golden-dataset`（フェーズ B の一致検証）と `parity-suite`（並び順の特性化）が担う**」を
  アサーションに足して skill 固有の工程分担を問う形にした。ベースラインは同じ「出尽くさない」に到達しつつ、担い手を「シャドー実行」と答えて落ちる
- 到達性のためプロンプトに「点検するとしても何を見ればいい？ それを全部見れば差は出尽くす？」を追加し、全 6 アサーションの到達元をプロンプトの各節へ対応付け直した
- 隔離実行では被験体に `parity-replace` しかコピーされないため、点検項目と「実測の代替にしない」の 1 行を
  `references/implementation.md` に要約として置いた（正本は `replace-strategy` の `references/project-config.md`「DB 意味論」で、転記はしない）

## 正本未同梱時の停止分岐について

with_skill run は「点検項目の正本は `replace-strategy` にあり、この環境には `parity-replace` しか入っていないため
`gh skill install shoji9x9/skills replace-strategy` を促して停止する」と述べた。これは
`references/implementation.md` に置いた**姉妹スキル未導入時の停止**（`references.db_semantics` の未整備とは別事由）が発火したもので、
隔離環境の制約であって実運用（両スキル同時導入が前提）の挙動ではない。同 run はその制約下でも
`implementation.md` に残る 5 項目を手掛かりとして提示しており、アサーションの判定には影響しない。

## ベースラインの read 汚染について

`without_skill` は `scripts/eval-sandbox.sh`（4 群遮断）経由で取得し、`contamination.txt` の verdict は `clean`
（マーカー 9 件の grep が 0 件）。`with_skill` も同じサンドボックス経由で実行した。
