# issue-batch の回帰テスト

`docs/skill-development.md` の隔離手順に従い、with-skill / without-skill を同じ prompt・同じ fixture・同じモデル条件で実行する。

```bash
scripts/eval/run-skill-eval.sh \
  --skill issue-batch \
  --prompt '<evals.json の該当 eval の prompt>' \
  --config with_skill \
  --fixture evals/issue-batch/fixtures/<fixture名> \
  --out tests/issue-batch/iteration-N/eval-<id>/with_skill/run-1
```

`--fixture` は `evals.json` の当該 eval に `fixture` がある場合だけ付ける。`--config without_skill` でベースラインを同様に実行する。

`evals.json` の `id` が `tests/issue-batch/iteration-N/eval-<id>/` に対応する。集計とビューアの手順は `docs/skill-development.md` にある。

## 前提

- fixture は入力状態だけを持つ。判定・分類・あるべき置き場所を書かない（ベースラインが読んで assertion を満たすと Delta が消える）。
- 外部 GitHub 状態より先の工程は、実操作ではなく dry-run の最終報告として 1 つのメッセージに収めさせる（`result.json` には最終アシスタントメッセージしか残らない）。
- eval 23 の「条件を外す承認と #108 の見直しを、1 つの判断待ちにまとめる」は、`requires_skills` で入る `issue-start` の `references/acceptance.md` から読めるので、without_skill も pass する。Delta には寄与せず、issue-batch 側の取り決めが消えたり食い違ったりした後退を検出するために置く。
- eval 25 の「兆候と根拠を添える」「manifest と最終報告に残す」「説明に留める」は、prompt の問い方から答えられるので without_skill も pass する。兆候の数え方と記録の項目が消えた後退を検出するために置く。
- eval 26 の「#108 の外した理由に #107 を書く」「#109 を進める」「`--stop-on-blocked` でも止めない」は、prompt の問い方から答えられるので without_skill も pass する。依存元の理由の書き方と、preflight の `BLOCKED` で `continue_on_blocked` を使わない取り決めが消えた後退を検出するために置く。
- eval 27 の 1〜3 本目（守っていない規約・反復を理由に直さなかった指摘・Issue にしていない見送りを載せる）と「説明に留める」は、prompt が事実を挙げているので without_skill も pass する。4 つの欄の取り決めが消えた後退を検出するために置く。
- eval 28 の「#101 を省かずに実行する」「#102 は省いてよい条件に当たる」は、prompt が事実を挙げているので without_skill も pass する。ローカルレビューを変更の大きさで省かない取り決めと、省いてよい条件の一覧が消えた後退を検出するために置く。
- eval 29 の 10 本のうち 8 本は、iteration-30 で without_skill も pass した。差が出たのは「記録の `git diff` で範囲を確かめる」「学びだけを対象にしてレビューしない」の 2 本だけである。
  残りの 8 本は、prompt が事実を挙げているか、範囲を指定してレビューするのが一般的なやり方なので、baseline も自力で満たす。
  ローカルレビューを省いてよいかの数え方と、範囲を確かめられないときに止める取り決めが消えた後退を検出するために置く。
- eval 30 の「branch・worktree・PR・manifest を作らず、担当者を割り当てない」「本文は書き換えない」「固定の目印を付ける」「説明に留める」は、prompt の問い方から答えられるので without_skill も pass する。prepare が変えるものを Issue のコメントだけに絞る取り決めが消えた後退を検出するために置く。
- eval 32 の「#130 の記録を使う」「@guest のコメントは記録を覆さない」「コメントを投稿しない」「説明に留める」は、prompt に答えの材料があるので without_skill も pass しうる。記録を読む条件と、書き込めない login の扱いが消えた後退を検出するために置く。
