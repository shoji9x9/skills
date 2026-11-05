# issue-start の回帰テスト

テストケースは [`evals.json`](evals.json)。実行・採点・集計の共通手順は `docs/skill-development.md`「回帰テストを実行する」に従う。
`--fixture` は、`evals.json` の該当する eval に `fixture` があるときだけ付ける。

## 区別できない eval と assertion

- eval 19 は、人に回すかの基準を持つ姉妹スキル（`pr-finalize-loop`・`pr-review-handle`）が無い環境で、仮の決定を実装の前に利用者に確認するかを確かめる。
  `requires_skills` を置かないので、with_skill の sandbox には `issue-start` だけが入る。prompt はその事実を書くが、姉妹スキルの名前は書かない。
  without_skill は、影響が小さいので確認を PR のレビューまで待つと答えた。区別できるのは「説明に留める」を除く 4 本である。
  「説明に留める」は without_skill も pass する。実行を求めない指示が消えた後退を検出するために置く。
