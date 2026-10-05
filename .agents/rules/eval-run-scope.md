---
paths:
  - "evals/**"
applyTo: "evals/**"
---

# eval を実行する前に目的と範囲を述べる

eval の実行には費用がかかるので、起動する前に目的と範囲を述べてから実行する。
デフォルトの範囲は、入力が変わった eval だけを `with_skill` と `without_skill` で 1 run ずつ実行する変更確認である。
`benchmark.json` を更新する 3 run × 2 config に広げるのは、そう決めたときだけにする。
前の iteration が benchmark だったことは、範囲を広げる理由にしない。

LLM の run の前に行う決定論的な検証と、`without_skill` の baseline の再利用は、下に挙げる原本の preflight と fingerprint のチェックを通す。

複数の eval をまとめて起動する前に、対象の一覧と出力先を preflight で確かめる。
構造化した spec から出力パスを組み立てるときは、文字列や数値のフィールドだけを使う。
オブジェクトをテンプレートリテラルに展開すると、`tests/[object Object]/iteration-N` のようなパスがエラーにならずに通る。
起動する前に、すべてのパスが期待するルートの下にあり、互いに重複せず、`[object Object]` を含まないことを確かめる。
承認を伴う外向きの実行では、ここで止まると承認をもう一度もらうことになる。

executor は、invocation ごとに指定する `--executor` だけで決まる。
運用では、いま作業しているエージェントと同じ executor を使う。Codex なら `codex`、Claude Code なら `claude-code` を省略せずに指定する。
ランチャの引数を省いたときの値は後方互換のためのもので、運用で選ぶ基準ではない。
ユーザーの指定とスキル固有の取り決めを優先し、対応する executor が無いエージェントではユーザーに確認する。
実行中に executor を切り替えるかは人が決める。利用上限に達したことは、その executor が対応していない証拠にならない。
切り替えるなら iteration をまとめて破棄して最初からやり直し、`with_skill` と `without_skill` を別の executor にしない。

判断の表、手順、切り替えるときの運用は、[`docs/skill-development.md`](../../docs/skill-development.md) の
「実走の既定スコープ」「without-skill baseline の再利用」「eval が失敗したとき executor を変えない」で定義する。ここでは定義し直さない。
