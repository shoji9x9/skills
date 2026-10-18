# agent-usage の回帰テスト

`docs/skill-development.md` の隔離手順に従い、with-skill / without-skill を同じ prompt・同じモデル条件で実行する。

```bash
scripts/eval/run-skill-eval.sh \
  --skill agent-usage \
  --prompt '<evals.json の該当 eval の prompt>' \
  --config with_skill \
  --out tests/agent-usage/iteration-N/eval-<id>/with_skill/run-1
```

`--config without_skill` でベースラインを同様に実行する。
`evals.json` の `id` が `tests/agent-usage/iteration-N/eval-<id>/` に対応する。
集計とビューアの手順は `docs/skill-development.md` にある。

## 前提

- 全 eval が手順の説明で完結する。prompt は「コマンドの実行やファイルの変更はせず」と副作用だけを禁じ、スキルの文書を読むことは妨げない。
- assertion は、このスキルの取り決め（ブランチごとの判断・`collect --stage` と `decline`・GitHub の取得の期間・単価の解決順）でしか答えられない点を検査する。
  一般論で当たる表現へ緩めるとベースラインが通り、差が消える。
- eval 1 の次の 2 つの assertion は、後退の検出のために置く。一般的な判断でも答えられるので、ベースラインも通り、Delta には寄与しない。
  - 記録するかを自分で決めず、利用者に確かめる
  - 無人の実行では、記録しない側を選ばずに止まって報告する

  無人の実行での扱いのうち、スキル固有の取り決めは、`defaultDecision` を前もって置くという assertion で検査する。
- スクリプトの挙動（解析・集計・Hook の判定）は `scripts/skills/agent-usage/` のユニットテストで確かめる。eval はエージェントの判断だけを見る。
