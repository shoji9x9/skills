# writing-style の回帰テスト

`docs/skill-development.md` の隔離手順に従い、with-skill / without-skill を同じ prompt・同じモデル条件で実行する。

```bash
scripts/eval/run-skill-eval.sh \
  --skill writing-style \
  --prompt '<evals.json の該当 eval の prompt>' \
  --config with_skill \
  --out tests/writing-style/iteration-N/eval-<id>/with_skill/run-1
```

`--config without_skill` でベースラインを同様に実行する。
eval 3 は、`--fixture evals/writing-style/fixtures/project-style` を付けて実行する。
`evals.json` の `id` が `tests/writing-style/iteration-N/eval-<id>/` に対応する。
集計とビューアの手順は `docs/skill-development.md` にある。

## 前提

- eval 1 と 2 は、規則 10 と読み直しの 3 つの問いを当てたかを検査する。
  ベースラインも一般的な感覚で文を直すので、assertion は、割り込む句の指摘・総称への例の追加・問いの名前を挙げた報告のように、このスキルの取り決めでしか答えられない点にしている。
- eval 2 の入力のタイトルは、規則 10 のどの形にも当たらないことを確かめて選ぶ。
  当たるタイトルを置くと、スキルが正しく直したことを不合格として数える。
- eval 3 の fixture は、`.config/skills/shoji9x9/writing-style.jsonc` で `style_docs` と `word_list` を指定したプロジェクトである。
  ベースラインも作業ディレクトリの設定ファイルを自分で見つけて従うので、この eval は差を測るものではない。設定による拡張が使われることの回帰を確かめる。
- 設定はプロジェクトのルートで読む。スキルのディレクトリで読むと、eval の環境は git リポジトリではないので、設定を見つけられない。
