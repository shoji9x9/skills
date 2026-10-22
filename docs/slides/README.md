# スライド

リポジトリと各スキルを説明するスライドの元になるファイルを置く。

| パス | 置くもの |
| --- | --- |
| `storylines/ja/` | 章ごとのストーリーライン。スライドごとに、伝えることと根拠にした文書を書く |
| `decks/ja/` | 章ごとのデッキ。`deck.json`（題名・スライドの順序・書体）と、1 枚ずつの `slides/<id>.html`。ストーリーラインと同じ名前で並べる |
| `decks/en/` | `decks/ja/` の英訳。スライドの数・id・スタイルは日本語版と同じにし、文言だけを訳す |
| `design-system/` | スライドの色・書体・大きさの決まり（`tokens.json`）と、その使い方（`README.md`） |
| `prompts/` | 作るときにエージェントへ渡した指示。日本語のデッキは、ストーリーラインを指示にして 1 章ずつ人と確かめながら作った。英語版は `translate-decks-en.md` の指示で訳した |
| `repo-size.md` | リポジトリの規模のスキルごとの内訳（`scripts/tools/repo-size.ts` の出力） |

スキルを変えたら、そのスキルを根拠に挙げたストーリーラインを `storylines/ja/` で grep して探し、対応するスライドを直す。

`decks/ja/` のスライドは、Slides の Artifact が 1920×1080 の枠・書体・基本のスタイルを当てて描画する前提の断片で、単独で開いても元のスライドと同じ見た目にはならない。
スライドに表示する文言とレイアウトの原本はこのファイルで、Artifact へはここから送る。

スライドは、ある commit のスキルと文書を根拠にして作る。その commit を、第 1 章の表紙に書く。
スライドを直して根拠の commit が変わったら、第 1 章の表紙の commit も書き換え、下の手順で規模を数え直す。

## 閲覧ページと GitHub Pages

`index.html`・`viewer.js`・`viewer.css` は、`decks/` のデッキを 1920×1080 の枠に描いて表示する閲覧ページである。
章の一覧は `decks/index.json` に並べる。スライドが Artifact にアップロードした画像（`/_blob/...`）を使うときは、リポジトリの中の同じ画像を `viewer.js` の `ASSETS` に書く。
手元では、リポジトリのルートで `python3 -m http.server` を実行し、`http://localhost:8000/docs/slides/` を開いて確かめる。
`main` に merge すると、`.github/workflows/pages.yml` が GitHub Pages に載せる。

## リポジトリの規模を数え直す

第 10 章の「リポジトリの規模」のスライドと `repo-size.md` は、`scripts/tools/repo-size.ts` の出力から作る。
数え方（何を本体・テスト・fixture とし、何を数えないか）は、スクリプトの冒頭のコメントで定義する。

```bash
node scripts/tools/repo-size.ts            # HEAD を数え、スキルごとの Markdown の表を出す
node scripts/tools/repo-size.ts <rev>      # 指定した commit を数える
node scripts/tools/repo-size.ts --json     # 同じ内容を JSON で出す
```

作業ツリーではなく commit の中身を数えるので、同じ commit なら同じ結果になる。
第 1 章の表紙に書いた commit を `<rev>` に渡して実行し、出力をそのまま `repo-size.md` に保存する。
スライドには、出力の合計の行の数字を転記する。
