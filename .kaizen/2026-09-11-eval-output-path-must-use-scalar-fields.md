---
date: 2026-09-11
type: rule
priority: medium
status: pending
applied-to: []
session: codex
---

# Eval の出力パスは scalar field から組み立てて実行前に検証する

## 事象

複数 eval の起動コードで spec オブジェクト全体をテンプレート文字列へ展開し、出力先が
`tests/[object Object]/iteration-...` になった。外部 API 送信の安全審査が同時に拒否したため実行前に止まったが、
承認を取り直す手戻りになった。

## 根本原因

1. なぜ不正なパスになったか: skill 名を入れる位置で scalar の `spec.skill` ではなく spec オブジェクトを展開した。
2. なぜ起動前に検出できなかったか: 組み立てた全出力先の絶対パス・対象 skill・eval id の対応を preflight で表示・検証しなかった。
3. なぜ同じ呼び出しで外部送信まで進めようとしたか: 複数 run の構造化 spec をコマンドへ写像する処理と、妥当性検査を分離していなかった。

KEDB を「出力パス」「run-skill-eval.sh」「[object Object]」で照合したが直接一致はなかった。
横断スコープは、複数の eval・target・worktree など構造化 spec から動的な出力先を組み立てる一括処理。

## 提案

構造化 spec から複数処理の出力パスを組み立てるときは scalar field だけを使い、全パスが期待ルート配下・相互に一意・`[object Object]` を含まないことを起動前の preflight で検証する。

`.agents/rules/eval-run-scope.md` に、複数 eval 起動前の対象一覧と出力先検証を追加する。
