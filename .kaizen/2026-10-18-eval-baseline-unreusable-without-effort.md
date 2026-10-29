---
date: 2026-10-18
type: hook
priority: medium
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

## 根本原因

- なぜ再利用できなかったか → 再利用の側は `--reasoning-effort` を必須にしているが、元の run は effort を空のまま記録していた
- なぜ空のまま記録されたか → 新しい run の実行では `--reasoning-effort` が任意で、付けなくても警告なしに成功する
- なぜ実行の時点で気づかないか → 「この run は後で再利用できない」ことを、ランチャーも `docs/skill-development.md` も実行の時点では示さない。
  再利用の可否は、次の iteration で再利用しようとして初めて分かる

## 提案

後で baseline として再利用しうる eval の run は、`--model` と `--reasoning-effort` を必ず明示して実行し、空の effort のまま記録しない。

- `run-skill-eval.sh` で、`--reasoning-effort` を付けない新しい run に「この run は `--reuse-baseline` で再利用できない」と stderr で警告するか、`--model` を付けた run では `--reasoning-effort` も必須にする
- または、元の run と再利用の側の effort がどちらも空なら一致として扱えるようにする（実行時のデフォルト値が変わりうるので、CLI のバージョンの一致を条件にする）
- `docs/skill-development.md` の「without-skill baseline の再利用」に、元の run も effort を明示して実行しておく必要があることを書く
