# writing-style の回帰テスト

`docs/skill-development.md` の隔離手順に従い、with-skill / without-skill を同じ prompt・同じモデル条件で実行する。
prompt は手で書き写さず、同じ呼び出しの中で `evals.json` から取得する。

```bash
id=1
prompt=$(node -e 'const d=JSON.parse(require("fs").readFileSync("evals/writing-style/evals.json","utf8"));process.stdout.write(d.evals.find((e)=>e.id===Number(process.argv[1])).prompt)' "$id")
[ -n "$prompt" ] || { echo "eval $id の prompt を取得できない" >&2; exit 1; }
scripts/eval/run-skill-eval.sh \
  --skill writing-style --executor claude-code \
  --prompt "$prompt" \
  --config with_skill --eval-id "$id" \
  --out "tests/writing-style/iteration-N/eval-$id/with_skill/run-1"
```

`--config without_skill` でベースラインを同様に実行する。
`fixture` を持つ eval（3 と 4）は、`--fixture evals/writing-style/<fixture>` を付けて実行する。
`evals.json` の `id` が `tests/writing-style/iteration-N/eval-<id>/` に対応する。
集計とビューアの手順は `docs/skill-development.md` にある。

## 前提

- eval 1 と 2 は、規則 10 と読み直しの 3 つの問いを当てたかを検査する。
  ベースラインも一般的な感覚で文を直すので、差を測る assertion は、割り込む句の指摘・総称への例の追加・問いの名前を挙げた報告にしている。
- 次の assertion は、後退の検出のために置く。ベースラインも満たすので、差には寄与しない。
  - eval 1: 3 つとも conventional commits の接頭辞を保つ
  - eval 2: タイトルを書き直さず、直す箇所が無いと報告する
- eval 2 の入力のタイトルは、規則 10 のどの形にも当たらないことを確かめて選ぶ。
  当たるタイトルを置くと、スキルが正しく直したことを不合格として数える。
- eval 3 の fixture は、`.config/skills/shoji9x9/writing-style.jsonc` で `style_docs` と `word_list` を指定したプロジェクトである。
  ベースラインも作業ディレクトリの設定ファイルを自分で見つけて従うので、この eval は差を測るものではない。設定による拡張が使われることの回帰を確かめる。
- eval 4 の fixture のリンター（`tools/lint-docs.mjs`）は `.md` しかチェックせず、`.txt` を渡すと「OK（0 件）」を出して exit 0 で終わる。
  手順 5 の、渡したファイルをチェックしたかを出力で確かめる取り決めを検査する。
  ベースラインも設定のリンターを実行して 0 件に気づくので、eval 3 と同じく差を測るものではなく、回帰を確かめる。
- 設定はプロジェクトのルートで読む。スキルのディレクトリで読むと、eval の環境は git リポジトリではないので、設定を見つけられない。
