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

LLM run の前に、変更したランチャー・fixture・採点器の unit test と、判定行を無効化して赤くなる mutation test を完了する。
開発中は決定論的検証で反復し、LLM run は原則として最終候補の変更確認まで遅らせる。
既存 `without_skill` run の再利用は、prompt・fixture・assertion・executor・model・reasoning effort・CLI / harness version の fingerprint が一致し、成功・汚染なし・必須 artifact 完備であることをランチャーに検証させる。手作業で同一と判断しない。

executor は invocation ごとの `--executor` 指定だけで決まる。**運用上の既定は現在作業しているエージェントと同じ executor** とし、
Codex は `codex`、Claude Code は `claude-code` を省略せず指定する（ランチャの引数省略時既定は後方互換用であり、運用上の選択規則ではない）。
ユーザー指定・スキル固有契約を優先し、対応 executor が無いエージェントではユーザーに確認する。**実走中の executor 切り替えは人が決める**（利用上限到達は executor 非対応の証拠ではない）。
切り替えるなら iteration ごと破棄して最初から取り直し、`with_skill` と `without_skill` を別 executor にしない。

判断表・手順・切り替え時の運用の正本は
[`docs/skill-development.md`](../../docs/skill-development.md) の「実走の既定スコープ」と
「eval が失敗したとき executor を変えない」を参照する（ここで再定義しない）。
