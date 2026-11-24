---
date: 2026-10-18
type: hook
priority: high
confidence: high
status: pending
applied-to: []
session: claude-code
---

# reasoning effort を指定せずに実行した eval の run は、後で baseline として再利用できない

## 事象

PR #694 で、入力を変えていない eval 25 の without_skill を、iteration-11 の run から `--reuse-baseline` で再利用しようとした。
`run-skill-eval.sh` は `--reuse-baseline requires explicit --model and --reasoning-effort values` で exit 2 になった。
iteration-11 の run は `--reasoning-effort` を付けずに実行しており、fingerprint の `reasoning_effort` は空である。
再利用には空でない値が要るので、どの値を渡しても fingerprint が一致せず、LLM の run を 1 件余分に実行した。

再発（2026-11-24、Issue #1123）: eval 32・33 を iteration-36 で、`--reasoning-effort` を付けずに実行した。
`apply.md` を直した後に、iteration-37 で without_skill を `--reuse-baseline` で再利用しようとして、同じ exit 2 になった。
without_skill は実行せず、iteration-36 の結果と比べた。

## 根本原因

- なぜ再利用できなかったか → 再利用の側は `--reasoning-effort` を必須にしているが、元の run は effort を空のまま記録していた
- なぜ空のまま記録されたか → 新しい run の実行では `--reasoning-effort` が任意で、付けなくても警告なしに成功する
- なぜ実行の時点で気づかないか → 「この run は後で再利用できない」ことを、ランチャーも `docs/skill-development.md` も実行の時点では示さない。
  再利用の可否は、次の iteration で再利用しようとして初めて分かる

## 根拠

同じ原因の再発を確かめたので high にした。iteration-36 の fingerprint の `reasoning_effort` が空で、ランチャーが同じメッセージで止まった。
今回の実行では、`docs/skill-development.md` の例のコマンドにある `--reasoning-effort` を省いた。
KEDB 照合（`reuse-baseline`・`reasoning-effort`）で、このノートだけに一致した。

## 既存の規約

- 扱い: なし
- 場所: なし（`docs/skill-development.md`「without-skill baseline の再利用」は、再利用する側に指定を求めるだけで、元の run には求めていない）
- 照合した範囲: `AGENTS.md`・`docs/`・`.agents/rules/` を `reasoning-effort` で検索した

## 食い違い

- 相手: なし
- 判断: なし

## 提案

後で baseline として再利用しうる eval の run は、`--model` と `--reasoning-effort` を必ず明示して実行し、空の effort のまま記録しない。

- `run-skill-eval.sh` で、`--reasoning-effort` を付けない新しい run に「この run は `--reuse-baseline` で再利用できない」と stderr で警告するか、`--model` を付けた run では `--reasoning-effort` も必須にする
- または、元の run と再利用の側の effort がどちらも空なら一致として扱えるようにする（実行時のデフォルト値が変わりうるので、CLI のバージョンの一致を条件にする）
- `docs/skill-development.md` の「without-skill baseline の再利用」に、元の run も effort を明示して実行しておく必要があることを書く
