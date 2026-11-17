---
date: 2026-11-17
type: doc
priority: medium
confidence: medium
status: pending
applied-to: []
session: claude-code
---

# シェルの変数を渡すために heredoc を unquoted にし、本文のバッククォートが展開された

## 事象

PR #1070 の本文に受け入れ条件の表を入れる python を、`python3 - <<PY`（unquoted）で渡した。
python の文字列にあるバッククォートをシェルがコマンド置換として解釈し、表の根拠の列と検査の結果の文が空になった。
エラーは数件出たが、python は最後まで動いて崩れた本文を書いたので、本文を読み直して気付き、python のスクリプトをファイルに書いて作り直した。

## 根本原因

- なぜ表が崩れたか → unquoted の heredoc の中で、シェルがバッククォートを展開した
- なぜ unquoted にしたか → 作業ディレクトリのパス（シェルの変数 `$W`）を python のソースに埋め込みたかった
- なぜ埋め込む形を選んだか → 値を引数か環境変数で渡せば quoted のままにできるのに、規約は「quoted で渡す」とだけ書き、変数を渡したいときの書き方を示していない。そのため、quoted にすると変数を使えないと考えて unquoted を選んだ

## 根拠

1 回の観測だが、unquoted を選んだ理由（変数の埋め込み）と崩れた箇所（バッククォート）が一致するので、原因を 1 つに絞れる。
KEDB 照合（語: heredoc・バッククォート・unquoted）では `2026-09-21-japanese-body-built-from-codepoints.md`（applied）だけが当たった。扱うのは、エスケープで日本語を組み立てた誤りで、原因が違う。

## 既存の規約

- 扱い: 明確
- 場所: `AGENTS.md`「シェルの書き方」の「バッククォートや `$` を含む本文は、quoted heredoc（`<<'PY'`）でインタプリタに渡す」と、`docs/agent-workflow.md`「バッククォートや `$` を含む本文は、quoted heredoc で渡す」
- 照合した範囲: `AGENTS.md`・`docs/agent-workflow.md` を、語「heredoc」「バッククォート」で検索した

## 食い違い

- 相手: なし
- 判断: なし

## 提案

`docs/agent-workflow.md`「バッククォートや `$` を含む本文は、quoted heredoc で渡す」に、変数を渡したいときも quoted のままにして値を引数か環境変数で渡すことを、破るときの言い訳とあわせて書く。

- 足す文の案: 「シェルの変数を本文に渡したいことは、unquoted にする理由にならない。値は引数（`python3 - "$W" <<'PY'` と `sys.argv[1]`）か環境変数（`W="$W" python3 - <<'PY'`）で渡す。」
- 機構は作らない。1 回の観測で、同じ種類の誤りの繰り返しを確かめていないため
