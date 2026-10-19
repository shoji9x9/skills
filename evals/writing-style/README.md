# writing-style の回帰テスト

`docs/skill-development.md` の隔離手順に従い、with-skill / without-skill を同じ prompt・同じモデル条件で実行する。
prompt は手で書き写さず、同じ呼び出しの中で `evals.json` から取得する。

```bash
# 失敗が終了コードに残るように、サブシェルの中で実行する（対話のシェルは閉じない）
(
  id=1
  config=with_skill
  # prompt と fixture を同じ node の呼び出しで evals.json から取得する（1 行目が fixture、残りが prompt）
  spec=$(node -e 'const d=JSON.parse(require("fs").readFileSync("evals/writing-style/evals.json","utf8"));const e=d.evals.find((x)=>x.id===Number(process.argv[1]));if(!e||typeof e.prompt!=="string"||e.prompt===""){process.exit(1)}process.stdout.write((e.fixture||"")+"\n"+e.prompt)' "$id") \
    || { echo "eval $id の prompt を取得できない" >&2; exit 1; }
  fixture=$(printf '%s\n' "$spec" | head -n 1)
  prompt=$(printf '%s\n' "$spec" | tail -n +2)
  fx=()
  [ -z "$fixture" ] || fx=(--fixture "evals/writing-style/$fixture")
  scripts/eval/run-skill-eval.sh \
    --skill writing-style --executor claude-code \
    --prompt "$prompt" "${fx[@]}" \
    --config "$config" --eval-id "$id" \
    --out "tests/writing-style/iteration-N/eval-$id/$config/run-1"
)
```

`config=without_skill` でベースラインを同様に実行する。
`evals.json` で `fixture` を持つ eval は、その fixture を `--fixture` に渡す。
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
- eval 4 の fixture のリンター（`tools/lint-docs.mjs`）は `.md` だけをチェックし、`.txt` を渡しても、チェックした件数を出さずに「指摘 0 件」を出して exit 0 で終わる。
  手順 5 の、渡したファイルをチェックしたかを出力で確かめる取り決めを検査する。
  件数を出すとベースラインも 0 件に気づいた（iteration-8）ので、リンターはチェックした件数を出さない。
  件数を出さなくしても、ベースラインはリンターのソースを読んで `.txt` が対象外だと気づいた（iteration-9）。そのため、eval 3 と同じく差を測るものではなく、回帰を確かめる。
- 設定はプロジェクトのルートで読む。スキルのディレクトリで読むと、eval の環境は git リポジトリではないので、設定を見つけられない。
