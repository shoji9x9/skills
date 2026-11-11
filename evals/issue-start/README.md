# issue-start の回帰テスト

テストケースは [`evals.json`](evals.json)。実行・採点・集計の共通手順は `docs/skill-development.md`「回帰テストを実行する」に従う。
`--fixture` は、`evals.json` の該当する eval に `fixture` があるときだけ付ける。

## 区別できない eval と assertion

- eval 19 は、人に回すかの基準を持つ姉妹スキル（`pr-finalize-loop`・`pr-review-handle`）が無い環境で、仮の決定を実装の前に利用者に確認するかを確かめる。
  `requires_skills` を置かないので、with_skill の sandbox には `issue-start` だけが入る。prompt はその事実を書くが、姉妹スキルの名前は書かない。
  without_skill は、影響が小さいので確認を PR のレビューまで待つと答えた。区別できるのは「説明に留める」を除く 4 本である。
  「説明に留める」は without_skill も pass する。実行を求めない指示が消えた後退を検出するために置く。
- eval 20 は、`decision_policy_doc` が指す文書の基準を、PR がまだ無いときの手順で仮の決定に当てるかを確かめる。
  `requires_skills` に `pr-finalize-loop` を置くので、`review-response.md` は without_skill の sandbox にも入る。
  without_skill は、状況 a の 2 本（migration を人に回す・1 ページの件数は自分で決める）と「説明に留める」を pass した。
  区別できるのは、状況 b・状況 c・確認と実装の順序・「仮に決めたこと」の節の 4 本である。状況 a の 2 本は、基準を当てる処理が後退したときに検出するために置く。
- eval 21 は、規約の文書が案内する破壊的変更の定義に照らして、commit message と PR の本文を書くかを確かめる。
  without_skill も規約の文書から定義をたどり、6 本すべてを pass した。どの assertion も区別できない。スキルが定義を読む手順を失ったときの後退を検出するために置く。
- eval 22 は、規約の文書に破壊的変更の定義が無いときに、PR の本文の節にそのことと読んだ文書を書くかを確かめる。
  without_skill は一般の判断で破壊的変更として書き、定義が無いことに触れなかった。区別できるのは「説明に留める」を除く 2 本である。
