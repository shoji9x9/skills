---
paths:
  - "skills/*/evals/**"
applyTo: "skills/*/evals/**"
---

# eval の実走スコープは起動前に宣言する

eval の実走はコストを伴うため、**起動前に目的とスコープを宣言してから走らせる**。
既定は**入力が変わった eval だけを `with_skill` / `without_skill` 各 1 run**（変更確認）で、
`benchmark.json` を更新する 3 run × 2 config へ広げるのは**明示的に決めたときだけ**。
前 iteration が benchmark だったことを理由に自動で広げない。

executor は invocation ごとの `--executor` 指定だけで決まり（既定 `claude-code`）、
リポジトリ側に固定するキーは無い。**実走中の executor 切り替えは人が決める**（利用上限到達は executor 非対応の証拠ではない）。
切り替えるなら iteration ごと破棄して最初から取り直し、`with_skill` と `without_skill` を別 executor にしない。

判断表・手順・切り替え時の運用の正本は
[`docs/skill-development.md`](../../docs/skill-development.md) の「実走の既定スコープ」と
「eval が失敗したとき executor を変えない」を参照する（ここで再定義しない）。
